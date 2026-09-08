import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPolicyFeed,assertViablePolicyFeed,feedCollections} from '../scripts/policy-feed.mjs';
import {evaluatePolicy} from '../scripts/policy-matcher.mjs';
import {extractApplicationTiming,displayPolicyTime} from '../scripts/policy-time.mjs';
import {reviewQueue,originalBinding,inferPolicyRegion,supportKinds,fundingDirections,DISCOVERY_SIGNAL} from '../scripts/policy-integrity.mjs';
import {allFeedItems,selectPolicyItems,paginatePolicies,canonicalSelections,effectiveDisposition,safeSourceHref,collectionLabels,isExpiredPolicy} from '../scripts/policy-view.mjs';
import {companyFitItems,qualificationNotes} from '../app/policy/presentation.mjs';
import {dedupe,verifyOriginalDocument} from '../scripts/sync-policies.mjs';
import {candidateContentHash,expandApplicationItems} from '../scripts/policy-records.mjs';
import {collectPagedRecords,officialBody} from '../scripts/policy-collection.mjs';

const now=new Date('2026-09-08T09:00:00+08:00');
const base={id:'grant',title:'企业研发补助申报通知',region:'国家',publishDate:'2026-09-01',url:'https://example.gov.cn/grant',content:'企业研发补助申报通知。现组织企业研发补助项目申报。申报单位为本市企业，申报条件为独立法人。企业申请时间为2026年9月1日至9月20日，请登录申报系统提交申请材料。符合条件的企业给予研发费用补助。',originalVerification:{retrievalStatus:'parsed',parserVersion:3,bindingStatus:'matched',titleMatched:true,checkedAt:now.toISOString()}};
const build=rows=>assertViablePolicyFeed(buildPolicyFeed(rows,[],null,now));
test('43个资金方向为复核范围，而非43个可申报项目',()=>assert.equal(fundingDirections.length,43));
test('裸奖补、申领、领用、兑付、预评审和旧年标题均进入读取队列',()=>{
  const rows=['研发费用奖补','2025年数改券申领','中小微企业服务券领取','创新券兑付','科技攻关项目预评审'].map((title,i)=>({...base,id:String(i),title,deadline:'2024-01-01',originalVerification:{retrievalStatus:'not_checked'}}));
  assert.equal(reviewQueue(rows,now).length,rows.length);
});
test('未尝试记录先于重复失败记录，低排序记录不会每轮被同一前N挤掉',()=>{
  const rows=[{...base,id:'a',originalVerification:{},lastAttemptAt:'2026-09-08T00:00:00Z'},{...base,id:'b',originalVerification:{}},{...base,id:'c',originalVerification:{}}];
  assert.equal(reviewQueue(rows,now)[0].id,'b');
  rows[1].lastAttemptAt=now.toISOString();
  assert.equal(reviewQueue(rows,now)[0].id,'c');
});
test('错配PDF和标题绑定未知不进入真实项目列表',()=>{
  const v=verifyOriginalDocument(base,'浙江省发展改革委关于政策服务案例的函。请各单位提交案例。',now.toISOString());
  assert.equal(v.bindingStatus,'unknown');
  const feed=build([{...base,originalVerification:v}]);
  assert.equal(feed.policies.length,0);assert.equal(feed.reviewQueue.length,1);
  assert.equal(originalBinding('【杭州市】企业研发补助申报通知',base.content),'matched');
});
test('培训否定正文不会被泛词企业、材料、资助骗过',()=>{
  const p=evaluatePolicy({...base,content:'本次仅为企业政策培训，申报条件课程讲解，请企业提交培训报名材料。本次不受理任何项目申请，不产生资助或立项结果，企业可以了解研发补助有关知识。'},now);
  assert.equal(p.visible,false);
});
test('商业中介页面不自动确认官方项目',()=>assert.equal(evaluatePolicy({...base,url:'https://example.com/grant'},now).visible,false));
for (const title of ['企业职业技能培训补贴申领通知','企业招聘补助申报通知','会展会议项目资助申报通知']) test('费用类型不能被普通活动黑名单误排：'+title,()=>{
  const p={...base,title,content:base.content.replaceAll(base.title,title)};
  assert.equal(build([p]).policies.length,1);
});
test('裸奖补经费不需要行业词也进入发现入口',()=>{
  for(const title of ['关于专项奖补的通知','关于专项经费的通知','担保费支持措施'])assert.equal(DISCOVERY_SIGNAL.test(title),true);
});
for (const title of ['奖励资金拨付名单的通知','研发项目验收通知','项目需求摸排通知','企业供给能力征集通知','研发奖补名单公示','企业免申即享补助通知']) test('非申报不混入主表：'+title,()=>assert.equal(build([{...base,title}]).policies.length,0));
test('年度市是解析异常，不是三家均不适用',()=>{
  assert.equal(evaluatePolicy({...base,region:'年度市'},now).companyAssessments.some(c=>c.status==='needs_review'),true);
  assert.equal(inferPolicyRegion('关于2026年度市级科技计划的通知',{region:'连云港市'}),'连云港市');
});
for (const [content,date,status] of [
  ['申报企业设备购置须于2025年1月1日至2025年12月31日完成，企业申请时间为2026年9月1日至2026年9月20日。','2026-09-20','open'],
  ['本办法有效期至2028年12月31日，企业申报时间为2026年9月1日至9月20日。','2026-09-20','open'],
  ['企业申报时间为9月15日至9月20日，请提交材料。','2026-09-20','upcoming'],
  ['2026年1月1日至2026年12月31日期间发生的贷款，可申请贴息补助。','','unknown'],
  ['首批企业于2026年6月1日前提交申报材料。后续批次企业于2026年9月20日前提交申报材料。','2026-09-20','open'],
  ['项目绩效申报表：项目开始时间2026年1月1日，项目结束时间2026年12月31日。','','unknown'],
]) test('费用期／有效期／批次与申请期分离：'+content,()=>{
  const t=extractApplicationTiming({...base,content},now);assert.equal(t.deadlineDate,date);assert.equal(t.applicationWindowStatus,status);
});
test('未经行内证据支持的缓存截止日不可作为过期依据',()=>assert.equal(extractApplicationTiming({...base,content:'企业申请窗口待通知。',deadline:'2024-12-31'},now).applicationWindowStatus,'unknown'));
test('过期主体不得保留eligible',()=>{
  const p=evaluatePolicy({...base,content:base.content.replaceAll('9月20日','9月1日')},now);
  assert.ok(p.companyAssessments.every(c=>c.status!=='eligible'));
});
test('四分区守恒，未读线索、新闻与历史分开',()=>{
  const feed=build([base,{...base,id:'clue',title:'研发奖补',content:'',originalVerification:{}},{...base,id:'news',title:'喜报：企业获得研发奖补'},{...base,id:'old',content:base.content.replaceAll('9月20日','9月1日')}]);
  assert.deepEqual(feed.collectionCounts,{policies:1,reviewQueue:1,historyPolicies:1,excludedRecords:1});
  assert.equal(feed.recordLedger.length,4);
  assert.equal(new Set(feedCollections.flatMap(k=>feed[k].map(p=>p.id))).size,4);
});
test('人为丢弃已输出记录，即使调整数量也必须校验失败',()=>{
  const feed=build([base]);feed.policies=[];feed.candidateCount=0;feed.collectionCounts.policies=0;
  assert.throws(()=>assertViablePolicyFeed(feed),/去向/);
});
test('重复输入ID必须失败',()=>assert.throws(()=>build([base,base]),/ID/));
test('一个PDF中的不同子项不会按URL去重丢失',()=>assert.equal(dedupe([base,{...base,id:'child',title:'创新券申领'}]).length,2));
test('有原文定位的独立子项分别输出，父通知作为关联容器',()=>{
  const a=base.content,b=base.content.replaceAll('研发补助','设备补助');
  const parent={...base,content:a+b,applicationItems:[{id:'a',title:base.title,content:a,sourceEvidence:{excerpt:a}},{id:'b',title:'企业设备补助申报通知',content:b,sourceEvidence:{excerpt:b}}]};
  const feed=build(expandApplicationItems([parent]));
  assert.equal(feed.policies.length,2);assert.equal(feed.excludedRecords.length,1);
  assert.throws(()=>expandApplicationItems([{...parent,applicationItems:[{id:'bad',title:'杜撰',content:'不存在',sourceEvidence:{excerpt:'不存在'}}]}]),/原文定位/);
});
test('正文或附件状态改变必须改变资格绑定哈希',()=>{
  assert.notEqual(candidateContentHash(base),candidateContentHash({...base,content:base.content+'新条件'}));
  assert.notEqual(candidateContentHash(base),candidateContentHash({...base,attachments:[{url:'https://example.gov.cn/a.pdf',status:'failed'}]}));
});
test('搜索正文独有词、未知主体、资金券类型不漏',()=>{
  const rows=[{...base,id:'clue',collection:'reviewQueue',disposition:'needs_review',title:'研发支持通知',content:'申领数改券补贴',companyAssessments:undefined}];
  assert.equal(selectPolicyItems(rows,[],{query:'数改券',company:'hangzhou',collection:'reviewQueue',funding:'voucher'}).length,1);
  assert.ok(supportKinds(rows[0]).includes('voucher'));
  assert.equal(companyFitItems({...base,applicableCompanies:['hangzhou']})[1].label,'资格待核实');
});
test('搜索关联附件及条件，不仅卡片摘要',()=>{
  const rows=[{...base,disposition:'needs_review',applicationRequirements:'认证专属词',attachments:[{title:'附件专属词'}]}];
  for (const query of ['认证专属词','附件专属词']) assert.equal(selectPolicyItems(rows,[],{query}).length,1);
});
const annotatedPolicy = {
  id: 'jiangsu-scitech-xml-613fbf6', collection: 'policies',
  contentHash: '43014e57d50588fbcf6a1a3047ba421fa32d9e33e20aeca4a8235b430d200983',
  subprojectReviewRequired: true,
  companyAssessments: ['suzhou','hangzhou','lianyungang'].map(companyId => ({
    companyId, status: companyId === 'hangzhou' ? 'ineligible' : 'needs_review',
    missing: companyId === 'hangzhou' ? [] : ['该主体注册／纳税属地及本项目全部申报条件待核实'],
  })),
};
test('四处浏览器标注仅调整对应通知展示，不改变后台资格或删除证据',()=>{
  const before=JSON.stringify(annotatedPolicy);
  const fit=companyFitItems(annotatedPolicy);
  assert.deepEqual(fit.map(c=>c.label),['适配','不适配','适配']);
  assert.deepEqual(fit.map(c=>c.status),['pending','ineligible','pending']);
  assert.match(fit[0].description,/资格尚未核实/);
  assert.deepEqual(qualificationNotes(annotatedPolicy),[]);
  assert.equal(JSON.stringify(annotatedPolicy),before);
  assert.deepEqual(qualificationNotes({...annotatedPolicy,verificationIssues:['附件尚未读取']}),['附件尚未读取']);
});
test('展示标注不扩大到其他项目、新版本、历史或不适用结论',()=>{
  for (const changed of [{id:'other'},{contentHash:'new-version'},{contentHash:undefined}]) {
    const policy={...annotatedPolicy,...changed};
    assert.equal(companyFitItems(policy)[0].label,'资格待核实');
    assert.equal(qualificationNotes(policy).length,2);
  }
  assert.equal(companyFitItems({...annotatedPolicy,collection:'historyPolicies'})[0].label,'本批已截止');
  assert.equal(companyFitItems({...annotatedPolicy,companyAssessments:[{companyId:'suzhou',status:'ineligible'}]})[0].label,'不适配');
  assert.equal(companyFitItems({...annotatedPolicy,companyAssessments:[{companyId:'suzhou',status:'eligible'}]})[0].label,'可申报（已核实）');
  assert.equal(companyFitItems({...annotatedPolicy,id:'merged',aliases:[annotatedPolicy.id]})[0].label,'适配');
  const original={...annotatedPolicy,id:'most-notices-483b0995',aliases:[annotatedPolicy.id],contentHash:'dae8686d684320b75fd2ba030d0554b3a0cf8ec6ab73218c0e998f3ab72cebc1'};
  assert.deepEqual(companyFitItems(original).map(c=>c.label),['适配','不适配','适配']);
  assert.deepEqual(qualificationNotes(original),[]);
});
test('有效收藏别名迁移，截止收藏后台保留但不再上架',()=>{
  const f=build([base,{...base,id:'old',title:'研发补助历史批次',content:base.content.replaceAll('9月20日','9月1日')},{...base,id:'news',title:'企业奖补名单公示'}]);
  const all=allFeedItems(f,now);all.find(p=>p.id==='grant').aliases=['alias'];
  const ids=canonicalSelections(all,['alias','old','news']);
  assert.deepEqual(new Set(selectPolicyItems(all,ids,{tab:'selected',collection:'policies',now}).map(p=>p.id)),new Set(['grant','news']));
  assert.equal(f.historyPolicies[0].id,'old');assert.ok(ids.includes('old'));
  assert.equal(canonicalSelections(all,{bad:true}).length,0);
});
test('跨日截止自动下架，不能从搜索或收藏恢复',()=>{
  const f=build([base]),all=allFeedItems(f,new Date('2026-10-01'));
  assert.equal(all.length,0);assert.equal(f.policies.length,1);
  for (const tab of ['all','pending','selected']) assert.equal(selectPolicyItems(f.policies,['grant'],{tab,query:'研发',now:new Date('2026-10-01')}).length,0);
});
test('没有历史入口，所有分区都移除已截止记录',()=>{
  assert.equal('historyPolicies' in collectionLabels,false);
  for (const collection of feedCollections) {
    const p={...base,collection,timing:{applicationWindowStatus:'expired'}};
    assert.equal(allFeedItems({[collection]:[p]},now).length,0);
    assert.equal(selectPolicyItems([p],[p.id],{tab:'selected',now}).length,0);
  }
});
test('只给截止日期时保留当日，次日下架；明确时刻过后即下架',()=>{
  const p={...base,timing:{applicationWindowStatus:'open',deadlineDate:'2026-09-08'}};
  assert.equal(isExpiredPolicy(p,new Date('2026-09-08T23:59:00+08:00')),false);
  assert.equal(isExpiredPolicy(p,new Date('2026-09-09T00:00:00+08:00')),true);
  const timed={...p,timing:{...p.timing,deadlineTime:'17:00'}};
  assert.equal(isExpiredPolicy(timed,new Date('2026-09-08T17:00:01+08:00')),true);
});
test('未知窗口不凭往年日期删除，常年受理和后续开放批次保留',()=>{
  assert.equal(isExpiredPolicy({...base,deadline:'2025-01-01',timing:{applicationWindowStatus:'unknown'}},now),false);
  assert.equal(isExpiredPolicy({...base,deadline:'2025-01-01',timing:{applicationWindowStatus:'ongoing'}},now),false);
  assert.equal(displayPolicyTime({...base,deadline:'2025-01-01',timing:{applicationWindowStatus:'unknown'}},now).label,'');
  assert.equal(displayPolicyTime({...base,deadline:'2025-01-01',timing:{applicationWindowStatus:'ongoing'}},now).label,'常年受理');
  const p={...base,content:'首批企业于2026年9月1日前提交申报材料。后续批次企业于2026年9月20日前提交申报材料。'};
  p.timing=extractApplicationTiming(p,new Date('2026-08-25'));
  const all=allFeedItems({policies:[p]},now);
  assert.equal(all.length,1);assert.equal(all[0].timing.deadlineDate,'2026-09-20');
});
test('分页全集等于筛选全集，超界页夹紧',()=>{
  const rows=Array.from({length:97},(_,i)=>({...base,id:String(i).padStart(3,'0'),disposition:'needs_review'}));
  const filtered=selectPolicyItems(rows,[],{query:'研发'}), paged=[];
  for (let page=1;page<=4;page++) paged.push(...paginatePolicies(filtered,page,30).items);
  assert.deepEqual(paged.map(p=>p.id),filtered.map(p=>p.id));assert.equal(paginatePolicies(filtered,20,30).page,4);
});
test('HTTP成功和零结果均不能声称全覆盖',()=>{
  for (const sources of [[],[{id:'mof-finance',ok:true,count:0}],[{id:'mof-finance',ok:true,count:100,incomplete:true}]]) assert.equal(buildPolicyFeed([base],sources,null,now).coverage.status,'partial');
});
test('旧数据缺少正文绑定字段不得直接确认为真实项目',()=>assert.equal(build([{...base,originalVerification:{retrievalStatus:'parsed'}}]).policies.length,0));
test('同名项目资格不同不能用待核记录吞掉已核实主体组合',()=>{
  const profile={companies:{suzhou:{version:'v1'}}};
  const approved={...base,id:'z',contentHash:'v1',qualificationReviews:{suzhou:{status:'verified',complete:true,policyHash:'v1',profileVersion:'v1',checkedAt:now.toISOString(),conditions:[{label:'全部适用条件',status:'met',evidence:'verified-doc'}]}}};
  const feed=assertViablePolicyFeed(buildPolicyFeed([{...base,id:'a',contentHash:'v1'},approved],[],profile,now));
  assert.equal(feed.policies.length,2);assert.equal(feed.eligibleCombinations.length,1);
  const p=feed.policies.find(p=>p.id==='z');
  assert.equal(effectiveDisposition(p,'hangzhou'),'needs_review');
  assert.equal(effectiveDisposition(p,'suzhou'),'eligible');
  p.companyAssessments.find(c=>c.companyId==='suzhou').status='needs_review';
  assert.throws(()=>assertViablePolicyFeed(feed),/主体组合/);
});
test('子项不得继承父通知其他方向的截止日',()=>{
  const parent={...base,applicationWindows:[{date:'2026-06-01',role:'applicant'}],applicationItems:[{id:'a',title:base.title,content:base.content,sourceEvidence:{excerpt:base.content}}]};
  assert.equal(extractApplicationTiming(expandApplicationItems([parent])[1],now).deadlineDate,'2026-09-20');
});
test('独立开始日、截止日不可提前开放',()=>{
  const p={...base,content:'企业申报开始时间为2026年9月15日。企业申报截止时间为2026年9月20日。'};
  assert.equal(extractApplicationTiming(p,now).applicationWindowStatus,'upcoming');
});
test('企业在日期范围内登录平台提交材料是申报窗口',()=>{
  const p={...base,content:'企业于2026年9月1日至9月20日登录平台提交申请材料。'};
  assert.equal(extractApplicationTiming(p,now).deadlineDate,'2026-09-20');
});
test('缺少原文或非网页协议不可生成空跳转',()=>{
  assert.equal(safeSourceHref({url:''}),'');assert.equal(safeSourceHref({url:'javascript:alert(1)'}),'');
  assert.equal(safeSourceHref({url:base.url}),base.url);
});
test('标题在正文容器外仍保留同一官方页的标题证据',()=>{
  const text=officialBody('<html><h1>'+base.title+'</h1><article class="article-content">企业可提交研发补助材料</article></html>');
  assert.equal(originalBinding(base.title,text),'matched');
});
test('未知总页数时不能把服务端较短页当作穷尽',async()=>{
  const p=await collectPagedRecords({pageSize:100,maxPages:1,fetchPage:async page=>({rows:[page]})});
  assert.equal(p.paginationExhausted,false);assert.equal(p.nextPage,3);
});
test('后页失败保留已读记录及失败页续查位置',async()=>{
  const p=await collectPagedRecords({pageSize:1,maxPages:3,fetchPage:async page=>{if(page===3)throw Error('403');return {rows:[page],total:5};}});
  assert.deepEqual(p.rows,[1,2]);assert.equal(p.nextPage,3);assert.equal(p.paginationExhausted,false);assert.equal(p.error,'403');
});
test('分页预算耗尽后续跑，始终重叠首页，不漏后页',async()=>{
  const calls=[],fetchPage=async page=>{calls.push(page);return {rows:[page*2-1,page*2],total:10};};
  const first=await collectPagedRecords({fetchPage,pageSize:2,maxPages:1});
  assert.equal(first.paginationExhausted,false);assert.equal(first.nextPage,3);
  const next=await collectPagedRecords({fetchPage,pageSize:2,maxPages:3,startPage:first.nextPage});
  assert.equal(next.paginationExhausted,true);
  assert.deepEqual(new Set([...first.rows,...next.rows]),new Set([1,2,3,4,5,6,7,8,9,10]));
});
