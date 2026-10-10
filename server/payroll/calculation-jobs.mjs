import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

const fail = (status, message) => Object.assign(new Error(message), {status});
export const MAX_INPUT_BYTES = 12 * 1024 * 1024;
export function validateCalculation(input) {
  if (!input || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month || '') ||
      !Number.isFinite(input.workdays) || input.workdays <= 0 || input.workdays > 31 ||
      !['gross','net'].includes(input.stage) || !Array.isArray(input.profiles) ||
      !Array.isArray(input.makeupWorkdays) || !input.sourceRows || !input.sourceStatus || !input.batch)
    throw fail(400, '工资计算资料或计薪设置无效');
  if (input.profiles.length > 20000 || Object.values(input.sourceRows).some(rows =>
    !Array.isArray(rows) || rows.length > 40000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))))
    throw fail(413, '工资源表过大或格式无效，请分批核算');
  if (input.makeupWorkdays.length > 31 || !input.batch.workbench ||
      !['gross','netGenerated','netUploaded'].every(key => input.batch.workbench[key] && typeof input.batch.workbench[key] === 'object'))
    throw fail(400, '工资批次或人工调整资料无效');
  return input;
}

export function createCalculationJobs({root = process.cwd(), concurrency = 1, maxJobs = 6,
  timeoutMs = 120000, retentionMs = 300000, workerFactory = input =>
    new Worker(join(root, 'server/payroll/calculation-thread.mjs'), {
      workerData: {root, input}, resourceLimits: {maxOldGenerationSizeMb: 256},
    })} = {}) {
  const jobs = new Map();
  let running = 0, closed = false;
  function prune() {
    for (const [id, job] of jobs) if (job.finished && Date.now() - job.finished > retentionMs) jobs.delete(id);
  }
  const cleaner = setInterval(prune, Math.min(retentionMs, 30000));
  cleaner.unref();
  function finish(job, status, payload = {}) {
    if (job.status !== 'running') return;
    clearTimeout(job.timer);
    job.worker?.removeAllListeners();
    job.worker?.on('error',()=>{});
    void job.worker?.terminate();
    delete job.worker;delete job.timer;
    Object.assign(job, {status, finished: Date.now()}, payload);
    running--;
    const completed=[...jobs.values()].filter(item=>item.result);
    for(const old of completed.slice(0,Math.max(0,completed.length-6)))jobs.delete(old.id);
    pump();
  }
  function pump() {
    if (closed) return;
    for (const job of jobs.values()) {
      if (running >= concurrency) break;
      if (job.status !== 'queued') continue;
      job.status = 'running';running++;
      try {
        job.worker = workerFactory(job.input);
        delete job.input;
        job.timer = setTimeout(() => finish(job, 'failed', {error: '计算超时，任务已停止，请分批核算后重试'}), timeoutMs);
        job.worker.once('message', message => message.result
          ? finish(job, 'completed', {result: message.result})
          : finish(job, 'failed', {error: message.error || '工资计算失败'}));
        job.worker.once('error', () => finish(job, 'failed', {error: '工资计算服务异常，请稍后重试'}));
        job.worker.once('exit', () => finish(job, 'failed', {error: '工资计算任务中断，请重新计算'}));
      } catch {delete job.input;finish(job, 'failed', {error: '工资计算服务无法启动，请稍后重试'});}
    }
  }
  function owned(owner, id) {
    prune();const job = jobs.get(id);
    if (!job || job.owner !== owner) throw fail(404, '计算任务不存在或已过期，请重新计算');
    return job;
  }
  return {
    submit(owner, input) {
      if (closed) throw fail(503, '计算服务正在重启，请稍后重试');
      validateCalculation(input);prune();
      if ([...jobs.values()].some(job => job.owner === owner && ['queued','running'].includes(job.status)))
        throw fail(409, '你已有工资计算任务，请等待或取消后重试');
      if ([...jobs.values()].filter(job => ['queued','running'].includes(job.status)).length >= maxJobs)
        throw fail(429, '服务器计算任务较多，请稍后重试');
      // Retain at most one finished result per user and bounded total memory.
      for (const [id, job] of jobs) if (job.owner === owner && job.finished) jobs.delete(id);
      if (jobs.size >= 30) throw fail(429, '计算服务繁忙，请稍后重试');
      const job = {id: randomUUID(), owner, input: structuredClone(input), status: 'queued'};
      jobs.set(job.id, job);pump();return {id: job.id, status: job.status};
    },
    get(owner, id) {
      const job = owned(owner, id);
      return {id, status: job.status, ...(job.result ? {result: job.result} : {}), ...(job.error ? {error: job.error} : {})};
    },
    cancel(owner, id) {
      const job = owned(owner, id);
      if (job.status === 'running') finish(job, 'cancelled');
      else if (job.status === 'queued') {delete job.input;job.status = 'cancelled';job.finished = Date.now();pump();}
      // Successful cancellation also removes any already-completed sensitive result.
      delete job.result;return {id, status: job.status};
    },
    close() {
      closed = true;clearInterval(cleaner);
      for (const job of jobs.values()) {clearTimeout(job.timer);void job.worker?.terminate();}
      jobs.clear();
    },
  };
}
