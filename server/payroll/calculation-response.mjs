import {requireAccess} from '../access/session.mjs';
import {createCalculationJobs, MAX_INPUT_BYTES} from './calculation-jobs.mjs';

let runtime;
const response = (data, status = 200) => Response.json(data, {status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
}});
export const isCalculationPath = path => /^\/api\/payroll\/calculations(?:\/|$)/.test(path);
export function createCalculationResponse({authorize = requireAccess, jobs} = {}) {
  return async request => {
    try {
      const user = await authorize(request, 'payroll');
      const owner = user?.userid;
      if (!owner) return response({error: '请登录后计算工资'}, 401);
      const path = new URL(request.url).pathname;
      const match = path.match(/^\/api\/payroll\/calculations(?:\/([a-f0-9-]{36}))?\/?$/);
      if (!match) return response({error: '计算接口不存在'}, 404);
      const id = match[1];
      if ((!id && request.method !== 'POST') || (id && !['GET','DELETE'].includes(request.method)))
        return response({error: '请求方法不支持'}, 405);
      const service = jobs || (runtime ??= createCalculationJobs());
      if (id) return response(request.method === 'DELETE' ? service.cancel(owner, id) : service.get(owner, id));
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return response({error: '请提交 JSON 格式的工资资料'}, 415);
      if (Number(request.headers.get('content-length')) > MAX_INPUT_BYTES)
        return response({error: '工资资料过大，请分批核算'}, 413);
      const reader = request.body?.getReader();
      if (!reader) return response({error: '工资资料不能为空'}, 400);
      const chunks = [];let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();if (done) break;
          size += value.byteLength;
          if (size > MAX_INPUT_BYTES) {await reader.cancel();return response({error: '工资资料过大，请分批核算'}, 413);}
          chunks.push(Buffer.from(value));
        }
      } finally {reader.releaseLock();}
      let input;
      try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      catch {return response({error: '工资资料格式无效'}, 400);}
      return response(service.submit(owner, input), 202);
    } catch (error) {
      const status = error.status || 503;
      return response({error: status < 500 ? error.message : '工资计算服务暂不可用，请稍后重试'}, status);
    }
  };
}
export const calculationResponse = createCalculationResponse();
