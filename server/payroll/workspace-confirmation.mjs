import { createHash } from 'node:crypto';
import { withTransaction } from '../../database/payroll/pool.mjs';
import { normalizePayrollValues, payrollFields } from '../../database/payroll/fields.mjs';
import { validateWorkspaceSnapshot } from './workspaces.mjs';
import '../../public/salary/payroll-engine.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fieldKeys=new Set(payrollFields.map(field=>field.key));
const sourceType={roster:'roster',salary:'salary',performance:'performance',attendance:'attendance',other:'other',
  social:'social',fund:'fund',grossUpload:'gross_upload',netSocial:'social',netFund:'fund',tax:'tax',afterTax:'after_tax'};
const grossKeys=new Set(['roster','salary','performance','attendance','other','social','fund']);
const rosterEngine=globalThis.PayrollEngine;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
function fail(message,code='PAYROLL_VALIDATION') {const e=new Error(message);e.code=code;throw e;}
function required(value,label,max=300) {if(typeof value!=='string'||!value.trim()||value.length>max) fail(`${label}缺失或格式无效`);return value.trim();}
function date(value,label) {
  if(!datePattern.test(String(value||''))||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)
    fail(`${label}不是有效日期`);
  return value;
}
function hash(value) {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function dataDate(value) {return value==null?null:value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);}
function monthEnd(month) {const [year,m]=month.split('-').map(Number);return new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);}
function moneyNumber(value,label) {
  const number=Number(value);
  if(value===null||value===undefined||value===''||!Number.isFinite(number)||Math.abs(number)>1e15||Math.abs(number*100-Math.round(number*100))>1e-6) fail(`${label}缺失或不是两位小数金额`);
  return Math.round(number*100)/100;
}
function itemValues(result,netRun) {
  const input=result._input&&typeof result._input==='object'?result._input:{};
  const values={};
  for(const key of fieldKeys) {
    if(!netRun && ['net','tax','utility','mealDeduct','otherDeduct','afterTaxTotal','companyCost','companySocial','companyFund','computedNet','netAdjustment','netTarget'].includes(key)) continue;
    const value=result[key] ?? input[key];
    if(value===undefined||value===null||value==='') continue;
    values[key]=value;
  }
  values.gross=moneyNumber(result.gross,`${result.name}的应发工资`);
  if(netRun) values.net=moneyNumber(result.net,`${result.name}的实发工资`);
  return normalizePayrollValues(values);
}
function validateResult(result,month,workdays,index) {
  if(!result||typeof result!=='object'||Array.isArray(result)) fail(`第 ${index+1} 名员工的核算结果无效`);
  required(result.name,`第 ${index+1} 名员工姓名`);
  required(result.company,`${result.name}的签约公司`);
  if(!['在职','入职','离职'].includes(result.status)) fail(`${result.name}的计薪月员工状态无法判定`);
  if(typeof result.isIntern!=='boolean') fail(`${result.name}的员工类型无法判定`);
  date(result.join,`${result.name}的入职日期`);
  if(result.leave) date(result.leave,`${result.name}的离职日期`);
  if(result.regularizationDate) date(result.regularizationDate,`${result.name}的转正日期`);
  if(result.payrollSourceBlocked||result.regularizationBlocked||result.regularizationConflict||result.payrollBlocked)
    fail(`${result.name}存在影响工资计算的来源或转正冲突：${String(result.exception||'请检查花名册、工资表和考勤表').slice(0,300)}`);
  const issues=Array.isArray(result.rosterIssues)?result.rosterIssues:[];
  if(issues.length) fail(`${result.name}的花名册字段尚需人工核对：${issues.map(issue=>issue.message||issue.reason).join('；').slice(0,500)}`);
  const payMonth=result.regularizationDate?.slice(0,7);
  if(payMonth===month && !result.isIntern && (!result.payrollTags || result.payrollTags.includes('转正'))) {
    const before=Number(result.probationWorkdays),after=Number(result.regularWorkdays);
    if(!Number.isFinite(before)||!Number.isFinite(after)||before<0||after<0||Math.abs(before+after-workdays)>1e-6)
      fail(`${result.name}转正前后应出勤天数之和必须等于当月应出勤天数`);
    moneyNumber(result.probationSalary,`${result.name}的转正前分段工资`);
    moneyNumber(result.regularSalary,`${result.name}的转正后分段工资`);
  }
  moneyNumber(result.gross,`${result.name}的应发工资`);
  moneyNumber(result.net,`${result.name}的实发工资`);
}
function validateRosterSource(raw,result,month) {
  // Re-read the frozen original row with exactly the same field dictionary the
  // personnel page and salary calculator use. A saved browser result cannot
  // silently replace the roster's identity or payroll-month facts.
  const {values,issues}=rosterEngine.normalizeRosterRow(raw,undefined,month);
  if(issues.length) fail(`${result.name}的原始花名册尚需核对：${issues.map(issue=>issue.message).join('；').slice(0,500)}`);
  const compared=[['name','姓名'],['employeeNumber','工号'],['company','签约公司'],
    ['dept','一级部门'],['subdept','二级部门'],['thirdDept','三级部门'],['position','职位'],
    ['status','员工状态'],['employmentType','员工类型'],['isIntern','实习标识'],
    ['join','入职日期'],['leave','离职日期'],['regularizationDate','转正日期'],
    ['bankCard','银行卡号'],['bankName','开户行']];
  for(const [field,label] of compared) {
    if(!Object.hasOwn(values,field)) continue;
    if(String(values[field])!==String(result[field]??''))
      fail(`${result.name}的原始花名册“${label}”与工资核算结果不一致，请重新核对来源行及字段映射`);
  }
}
function cleanMappings(mappings,count) {
  if(!Array.isArray(mappings)||mappings.length!==count) fail('请逐名确认工资员工与企微人员身份');
  const ordered=Array(count),ids=new Set(),rows=new Set();
  for(const mapping of mappings) {
    if(!mapping||!Number.isInteger(mapping.resultIndex)||mapping.resultIndex<0||mapping.resultIndex>=count||ordered[mapping.resultIndex]) fail('身份确认行号重复或越界');
    if(!UUID.test(mapping.employeeId||'')) fail('请选择有效的工资员工 ID');
    const reason=required(mapping.reason,'身份关联确认原因',1000);
    const rosterRow=mapping.rosterRow==null?null:Number(mapping.rosterRow);
    if(rosterRow!==null&&(!Number.isInteger(rosterRow)||rosterRow<1)) fail('花名册行号无效');
    if(ids.has(mapping.employeeId)) fail('同一工资员工不能在同月确认两次');
    if(rosterRow!==null&&rows.has(rosterRow)) fail('同一花名册行不能对应两名工资员工');
    ids.add(mapping.employeeId);if(rosterRow!==null) rows.add(rosterRow);
    ordered[mapping.resultIndex]={resultIndex:mapping.resultIndex,employeeId:mapping.employeeId,reason,rosterRow};
  }
  if(ordered.some(value=>!value)) fail('存在尚未确认的员工身份');
  return ordered;
}
async function companyFor(client,name,actorId) {
  const matches=(await client.query('SELECT id FROM payroll.companies WHERE name=$1 ORDER BY id LIMIT 2',[name])).rows;
  if(matches.length>1) fail(`签约公司“${name}”在工资库中存在多个候选，请管理员先整理公司关联`);
  if(matches.length) return matches[0].id;
  const code='ROSTER_'+hash(name).slice(0,16).toUpperCase();
  await client.query(`INSERT INTO payroll.companies(code,name,short_name,created_by)
    VALUES($1,$2,$2,$3) ON CONFLICT(code) DO NOTHING`,[code,name,actorId]);
  const row=(await client.query('SELECT id,name FROM payroll.companies WHERE code=$1',[code])).rows[0];
  if(row.name!==name) fail('签约公司代码冲突');
  return row.id;
}
async function employmentFor(client,{employeeId,companyId,joinedOn,leftOn,employeeNumber,department,subdepartment,employeeType,regularizationDate,month,actorId}) {
  const last=monthEnd(month);
  if(joinedOn>last) fail('入职日期晚于计薪月');
  const rows=(await client.query(`SELECT * FROM payroll.employments WHERE employee_id=$1 AND company_id=$2
    AND joined_on<=$3 AND (left_on IS NULL OR left_on>=$4) ORDER BY joined_on DESC,id LIMIT 2`,
    [employeeId,companyId,last,month+'-01'])).rows;
  if(rows.length>1) fail('同一员工计薪月存在多个任职记录，请先核对');
  let employment=rows[0];
  if(!employment) employment=(await client.query(`INSERT INTO payroll.employments(employee_id,company_id,joined_on,left_on,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,[employeeId,companyId,joinedOn,leftOn||null,actorId])).rows[0];
  const prior=(await client.query(`SELECT * FROM payroll.employment_changes WHERE employment_id=$1
    AND effective_on<=$2 ORDER BY effective_on DESC LIMIT 1`,[employment.id,last])).rows[0];
  const wanted={employee_number:employeeNumber||null,department:department||null,subdepartment:subdepartment||null,
    employee_type:employeeType,regularization_date:regularizationDate||null};
  const differs=!prior||Object.entries(wanted).some(([key,value])=>
    (key==='regularization_date'?dataDate(prior[key]):prior[key]??null)!==(key==='regularization_date'?dataDate(value):value));
  if(differs) {
    const effective=joinedOn>month+'-01'?joinedOn:month+'-01';
    const exists=(await client.query('SELECT id FROM payroll.employment_changes WHERE employment_id=$1 AND effective_on=$2',[employment.id,effective])).rowCount;
    if(!exists) await client.query(`INSERT INTO payroll.employment_changes
      (employment_id,effective_on,employee_number,department,subdepartment,employee_type,regularization_date,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[employment.id,effective,wanted.employee_number,wanted.department,
      wanted.subdepartment,wanted.employee_type,wanted.regularization_date,'已确认计薪月花名册快照',actorId]);
  }
  return employment.id;
}
function employeeType(result) {
  if(result.isIntern) return 'intern';
  if(result.employmentType==='试用') return 'probation';
  if(result.employmentType==='正式') return 'regular';
  return result.regularizationDate?'probation':'regular';
}
async function insertRun(client,{batchId,version,scope,ruleId,previousRunId,grossRunId,basisRevision,snapshot,actorId,importIds,people,sourceRows,netRun,workspaceId,workspaceRevision}) {
  const row=(await client.query(`INSERT INTO payroll.runs
    (batch_id,version,scope,rule_version_id,previous_run_id,gross_run_id,input_snapshot,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[batchId,version,scope,ruleId,previousRunId||null,grossRunId||null,
      JSON.stringify({basisRevision,month:snapshot.batch.month,workdays:snapshot.batch.workdays,
        makeupDates:snapshot.batch.data.makeupWorkdays||[],settings:{workspaceId,workspaceRevision},
        context:{source:'confirmed-real-workspace'}}),actorId])).rows[0];
  for(const importId of importIds) await client.query('INSERT INTO payroll.run_sources(run_id,import_id,batch_id) VALUES($1,$2,$3)',[row.id,importId,batchId]);
  for(const person of people) {
    const result=netRun?person.result:(snapshot.results.gross.find(g=>g.rosterRow===person.rosterRow)||person.result);
    const values=itemValues(result,netRun), columns=Object.keys(values), parameters=Object.values(values);
    const employeeSnapshot={employeeId:person.employeeId,name:person.result.name,companyId:person.companyId,
      companyName:person.result.company,employeeNumber:person.result.employeeNumber||null,
      department:person.result.dept||null,subdepartment:person.result.subdept||null,
      thirdDepartment:person.result.thirdDept||null,position:person.result.position||null,
      employeeType:person.result.employmentType||null,status:person.result.status,
      joinedOn:person.result.join,leftOn:person.result.leave||null,
      regularizationDate:person.result.regularizationDate||null,
      sourceSnapshot:{workspaceId,workspaceRevision,rosterRow:person.rosterRow,
        rosterSources:person.result.rosterSources||{},identityReason:person.reason}};
    const issues=[];
    if(person.result.exception) issues.push({source:'payroll-calculation',message:String(person.result.exception).slice(0,1000)});
    const columnsSql=columns.length?','+columns.join(','):'';
    const inserted=(await client.query(`INSERT INTO payroll.items
      (run_id,batch_id,employee_id,employment_id,company_id,employee_snapshot,source_row_ids,calculation_detail,issues${columnsSql})
      VALUES(${Array.from({length:9+parameters.length},(_,i)=>'$'+(i+1)).join(',')}) RETURNING id`,
      [row.id,batchId,person.employeeId,person.employmentId,person.companyId,JSON.stringify(employeeSnapshot),
        [sourceRows.get(person.rosterRow)],JSON.stringify({source:'payroll-workbench',scope,workspaceId,workspaceRevision}),
        JSON.stringify(issues),...parameters])).rows[0];
    if(netRun) person.netItemId=inserted.id;
  }
  await client.query("UPDATE payroll.runs SET status='draft' WHERE id=$1",[row.id]);
  if(netRun) for(const person of people) await client.query(`INSERT INTO payroll.reviews(run_id,item_id,outcome,note,created_by)
    VALUES($1,$2,'accepted',$3,$4)`, [row.id,person.netItemId,person.reason,actorId]);
  return row.id;
}

export function createWorkspaceConfirmationService({pool,corpId}) {
  return {
    async confirm({actorId,workspaceId,revision,requestKey,mappings}) {
      if(!corpId) fail('企微只读通讯录尚未配置，不能确认人员身份','WECOM_NOT_CONFIGURED');
      if(!UUID.test(workspaceId||'')) fail('服务器草稿编号无效');
      if(!Number.isInteger(revision)||revision<1) fail('请提供待确认的服务器草稿版本');
      required(requestKey,'请求标识',200);
      const operation='workspace.confirm',payloadHash=hash({workspaceId,revision,mappings,actorId});
      return withTransaction(pool,async client=>{
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`payroll-request:${requestKey}`]);
        const prior=(await client.query('SELECT * FROM payroll.requests WHERE request_key=$1',[requestKey])).rows[0];
        if(prior) {
          if(prior.operation!==operation||prior.actor_id!==actorId||prior.payload_hash!==payloadHash) fail('请求标识已用于其他内容','PAYROLL_IDEMPOTENCY_CONFLICT');
          return prior.result;
        }
        const actor=(await client.query('SELECT enabled FROM payroll.users WHERE id=$1',[actorId])).rows[0];
        if(!actor?.enabled) fail('管理员登录已失效','PAYROLL_FORBIDDEN');
        const workspace=(await client.query(`SELECT w.*,v.snapshot FROM payroll.workspaces w
          JOIN payroll.workspace_versions v ON v.workspace_id=w.id AND v.revision=w.revision
          WHERE w.id=$1 AND w.owner_id=$2 FOR UPDATE OF w`,[workspaceId,actorId])).rows[0];
        if(!workspace) fail('未找到当前管理员的服务器草稿','PAYROLL_NOT_FOUND');
        if(workspace.revision!==revision) fail('服务器草稿已有新版本，请重新保存并核对','PAYROLL_STALE');
        if((await client.query('SELECT 1 FROM payroll.workspace_confirmations WHERE workspace_id=$1 AND workspace_revision=$2',[workspaceId,revision])).rowCount)
          fail('此版本已确认入库；请保存新版本再修订','PAYROLL_CONFLICT');
        const snapshot=validateWorkspaceSnapshot(workspace.snapshot),net=snapshot.results.net;
        if(snapshot.provenance!=='user-import'||snapshot.batch.data.liveImport!==true||snapshot.batch.data.payrollStage!=='net'||!net.length)
          fail('仅可确认真实导入、完成实发阶段计算的批次');
        const roster=snapshot.sources.roster;
        if(!roster?.rows?.length) fail('正式工资必须包含计薪月花名册来源');
        const ordered=cleanMappings(mappings,net.length),workdays=Number(snapshot.batch.workdays);
        const sourceByRow=new Map(roster.rows.map((row,index)=>[roster.sourceStartRow+index,row]));
        const people=[],rowUsed=new Set();
        for(const mapping of ordered) {
          const uploaded=net[mapping.resultIndex];
          const rosterRow=mapping.rosterRow??uploaded.rosterRow;
          if(!Number.isInteger(rosterRow)||!sourceByRow.has(rosterRow)||rowUsed.has(rosterRow)) fail(`第 ${mapping.resultIndex+1} 名员工未能唯一对应源花名册行，请人工核对`);
          const sourceGross=snapshot.results.gross.find(item=>item.rosterRow===rosterRow);
          if(!sourceGross) fail(`源花名册第 ${rosterRow} 行没有同批应发核算结果，不能确认身份与工资来源`);
          if(sourceGross.name!==uploaded.name || (uploaded.company && sourceGross.company!==uploaded.company))
            fail(`源花名册第 ${rosterRow} 行与实发结果的人员或公司不一致`);
          // Uploaded amounts inherit verified roster diagnostics only through
          // the explicitly selected source row, never through a repeated name.
          const result={...sourceGross,...uploaded,rosterRow,
            rosterSources:sourceGross.rosterSources,rosterIssues:sourceGross.rosterIssues,
            regularizationConflict:sourceGross.regularizationConflict||uploaded.regularizationConflict,
            payrollSourceBlocked:sourceGross.payrollSourceBlocked||uploaded.payrollSourceBlocked,
            regularizationBlocked:sourceGross.regularizationBlocked||uploaded.regularizationBlocked,
            payrollBlocked:sourceGross.payrollBlocked||uploaded.payrollBlocked};
          validateResult(result,snapshot.batch.month,workdays,mapping.resultIndex);
          rowUsed.add(rosterRow);
          const raw=sourceByRow.get(rosterRow);
          validateRosterSource(raw,result,snapshot.batch.month);
          const link=(await client.query(`SELECT l.userid,e.name FROM payroll.wecom_employee_links l
            JOIN payroll.employees e ON e.id=l.employee_id WHERE l.corp_id=$1 AND l.employee_id=$2`,[corpId,mapping.employeeId])).rows[0];
          if(!link) fail(`${result.name}尚未由管理员关联工资员工 ID 与企微 UserID`);
          people.push({result,rosterRow,employeeId:mapping.employeeId,userid:link.userid,reason:mapping.reason});
        }
        const month=snapshot.batch.month;
        const previous=(await client.query(`SELECT c.batch_id,c.workspace_revision,b.month,b.status,b.revision,b.current_run_id
          FROM payroll.workspace_confirmations c JOIN payroll.batches b ON b.id=c.batch_id
          WHERE c.workspace_id=$1 ORDER BY c.workspace_revision DESC LIMIT 1`,[workspaceId])).rows[0];
        let batchId,basisRevision,previousRunId=null;
        if(previous && dataDate(previous.month).slice(0,7)===month) {
          const batch=(await client.query('SELECT * FROM payroll.batches WHERE id=$1 FOR UPDATE',[previous.batch_id])).rows[0];
          if(!['confirmed','archived'].includes(batch.status)||batch.revision!==previous.revision) fail('上次确认批次已被其他操作修订，请核对后重试','PAYROLL_CONFLICT');
          previousRunId=batch.current_run_id;
          const updated=(await client.query("UPDATE payroll.batches SET status='draft',revision=revision+1,updated_at=now() WHERE id=$1 RETURNING revision",[batch.id])).rows[0];
          batchId=batch.id;basisRevision=updated.revision;
        } else {
          const batch=(await client.query(`INSERT INTO payroll.batches(month,name,workdays,makeup_dates,settings,created_by)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING id,revision`,[month+'-01',snapshot.batch.name,workdays,
              snapshot.batch.data.makeupWorkdays||[],JSON.stringify({source:'confirmed-real-workspace',workspaceId}),actorId])).rows[0];
          batchId=batch.id;basisRevision=batch.revision;
        }
        const companyIds=new Map();
        for(const person of people) {
          const name=required(person.result.company,'签约公司');
          if(!companyIds.has(name)) companyIds.set(name,await companyFor(client,name,actorId));
          person.companyId=companyIds.get(name);
          await client.query('INSERT INTO payroll.batch_companies(batch_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[batchId,person.companyId]);
          person.employmentId=await employmentFor(client,{employeeId:person.employeeId,companyId:person.companyId,
            joinedOn:person.result.join,leftOn:person.result.leave,employeeNumber:person.result.employeeNumber,
            department:person.result.dept,subdepartment:person.result.subdept,
            employeeType:employeeType(person.result),regularizationDate:person.result.regularizationDate,
            month,actorId});
        }
        const sourceRows=new Map(),imports=[];
        for(const [key,source] of Object.entries(snapshot.sources)) {
          const type=sourceType[key];if(!type) continue;
          const scope=grossKeys.has(key)?'gross':key==='grossUpload'?'net_uploaded':snapshot.sources.grossUpload?'net_uploaded':'net_generated';
          const payload=JSON.stringify(source),fileHash=createHash('sha256').update(payload).digest('hex');
          const filename=snapshot.batch.data.sourceStatus?.[key]?.filename||`${key}.json`;
          const file=(await client.query(`INSERT INTO payroll.files
            (batch_id,kind,original_name,storage_profile,object_key,sha256,byte_size,content_type,status,created_by)
            VALUES($1,'source',$2,'workspace_parsed_json',$3,$4,$5,'application/json','ready',$6) RETURNING id`,
            [batchId,filename,`${workspaceId}/${revision}/${key}`,fileHash,Buffer.byteLength(payload),actorId])).rows[0];
          const next=(await client.query(`SELECT COALESCE(MAX(version),0)+1 AS version FROM payroll.imports
            WHERE batch_id=$1 AND scope=$2 AND source_type=$3`,[batchId,scope,type])).rows[0].version;
          const imported=(await client.query(`INSERT INTO payroll.imports
            (batch_id,file_id,scope,source_type,version,parser_version,field_mapping,issues,created_by)
            VALUES($1,$2,$3,$4,$5,'payroll-roster-keywords-v1',$6,'[]',$7) RETURNING id`,
            [batchId,file.id,scope,type,next,JSON.stringify(key==='roster'?people[0]?.result.rosterSources||{}:{}),actorId])).rows[0];
          imports.push({key,id:imported.id});
          for(let index=0;index<source.rows.length;index++) {
            const row=source.rows[index],rowNumber=source.sourceStartRow+index;
            let person=key==='roster'?people.find(value=>value.rosterRow===rowNumber):null;
            if(key!=='roster') {
              const sourceName=String(row['姓名']??row['员工姓名']??'').trim();
              const candidates=people.filter(value=>value.result.name===sourceName);
              if(candidates.length!==1) fail(`${filename} 第 ${rowNumber} 行不能唯一对应已确认人员，请核对姓名及源表`);
              person=candidates[0];
            }
            const rosterFields=person?Object.fromEntries(['name','company','dept','subdept','status','join','leave','regularizationDate','bankCard','bankName','employeeNumber','isIntern']
              .filter(field=>person.result[field]!==undefined&&person.result[field]!==null&&person.result[field]!=='')
              .map(field=>[field,person.result[field]])):{};
            const normalized=normalizePayrollValues(rosterFields);
            const inserted=(await client.query(`INSERT INTO payroll.source_rows
              (import_id,batch_id,sheet_name,row_number,raw_values,normalized_values,mapping_status,
                employee_id,employment_id,company_id,mapping_reason,issues)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
              [imported.id,batchId,row._rosterSource?.sheetName||source.sheetName||'Sheet1',row._rosterSource?.rowNumber||rowNumber,JSON.stringify(row),JSON.stringify(normalized),
                person?'matched':'unmatched',person?.employeeId||null,person?.employmentId||null,person?.companyId||null,
                person?.reason||null,JSON.stringify(person?.result.rosterIssues||[])] )).rows[0];
            // Item provenance must point to the confirmed roster row. Other
            // source sheets commonly reuse row 2, row 3, ... and must not
            // overwrite that association.
            if(person && key==='roster') sourceRows.set(rowNumber,inserted.id);
          }
          await client.query('UPDATE payroll.imports SET sealed=true WHERE id=$1',[imported.id]);
        }
        if(sourceRows.size!==people.length) fail('花名册来源与人员核算结果不完整');
        await client.query(`INSERT INTO payroll.rule_versions
          (version,effective_from,engine_version,parameters,created_by)
          VALUES('workbench-js-2026-09-24','1900-01-01','payroll-workbench-v1','{}',$1)
          ON CONFLICT(version) DO NOTHING`,[actorId]);
        const rule=(await client.query("SELECT id FROM payroll.rule_versions WHERE version='workbench-js-2026-09-24'")).rows[0];
        const maxVersion=Number((await client.query('SELECT COALESCE(MAX(version),0) AS version FROM payroll.runs WHERE batch_id=$1',[batchId])).rows[0].version);
        let grossRunId=null,netVersion=maxVersion+1;
        if(!snapshot.sources.grossUpload) {
          grossRunId=await insertRun(client,{batchId,version:maxVersion+1,scope:'gross',ruleId:rule.id,
            basisRevision,snapshot,actorId,importIds:imports.filter(item=>grossKeys.has(item.key)).map(item=>item.id),
            people,sourceRows,netRun:false,workspaceId,workspaceRevision:revision});
          netVersion++;
        }
        const netScope=snapshot.sources.grossUpload?'net_uploaded':'net_generated';
        const netRunId=await insertRun(client,{batchId,version:netVersion,scope:netScope,ruleId:rule.id,
          previousRunId,grossRunId,basisRevision,snapshot,actorId,
          importIds:imports.filter(item=>!grossRunId||!grossKeys.has(item.key)).map(item=>item.id),
          people,sourceRows,netRun:true,workspaceId,workspaceRevision:revision});
        await client.query('UPDATE payroll.batches SET current_run_id=$2,stage=$3,revision=$4,updated_at=now() WHERE id=$1',
          [batchId,netRunId,netScope,basisRevision+1]);
        await client.query("UPDATE payroll.runs SET status='confirmed',confirmed_by=$2,confirmed_at=clock_timestamp() WHERE id=$1",[netRunId,actorId]);
        await client.query("UPDATE payroll.batches SET status='confirmed',updated_at=now() WHERE id=$1",[batchId]);
        await client.query(`INSERT INTO payroll.workspace_confirmations
          (workspace_id,workspace_revision,batch_id,run_id,identity_mapping,confirmed_by)
          VALUES($1,$2,$3,$4,$5,$6)`,[workspaceId,revision,batchId,netRunId,
            JSON.stringify(people.map(person=>({rosterRow:person.rosterRow,employeeId:person.employeeId,userid:person.userid,reason:person.reason}))),actorId]);
        await client.query(`INSERT INTO payroll.audit_events(actor_id,batch_id,action,entity_type,entity_id,details)
          VALUES($1,$2,'workspace.confirm','run',$3,$4)`,[actorId,batchId,netRunId,
            JSON.stringify({workspaceId,revision,count:people.length,previousRunId})]);
        const response={workspaceId,revision,batchId,runId:netRunId,status:'confirmed',employeeCount:people.length,month};
        await client.query(`INSERT INTO payroll.requests(request_key,operation,actor_id,payload_hash,result)
          VALUES($1,$2,$3,$4,$5)`,[requestKey,operation,actorId,payloadHash,JSON.stringify(response)]);
        return response;
      });
    }
  };
}
