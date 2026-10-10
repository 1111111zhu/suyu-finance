/* IndexedDB operations run exclusively in this worker; transactions are atomic. */
const DB_NAME='payroll-workbench-local';
const request=req=>new Promise((resolve,reject)=>{let blocked=false;req.onsuccess=()=>{if(blocked)req.result.close();else resolve(req.result);};req.onerror=()=>reject(req.error);req.onblocked=()=>{blocked=true;reject(new Error('本地草稿被其他旧页面占用，请关闭其他财务系统页面后重试'));};});
const done=tx=>{const result=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('本地保存已中止'));tx.onerror=()=>reject(tx.error||new Error('本地保存失败'));});result.catch(()=>{});return result;};
let database;
async function open() {
  if(database)return database;
  const req=indexedDB.open(DB_NAME,2);
  req.onupgradeneeded=()=>{for(const name of ['workspace','batchRecords','batchSources','batchMetadata'])if(!req.result.objectStoreNames.contains(name))req.result.createObjectStore(name);};
  database=await request(req);database.onversionchange=()=>{database.close();database=null;};return database;
}
const sourceId=(id,key)=>JSON.stringify([id,key]);
function split(id,batch) {
  const data={...batch.data},rows=data.sourceRows||{},status=data.sourceStatus||{};delete data.sourceRows;
  data.sourceStatus=Object.fromEntries(Object.entries(status).map(([key,value])=>{const clean={...value};delete clean.previews;return [key,clean];}));
  return {id,batch:{...batch,data},sources:Object.entries(rows).map(([key,rows])=>({key,rows,sheetName:rows.sheetName||'',sourceStartRow:rows.sourceStartRow||2,previews:status[key]?.previews}))};
}
async function migrate(db) {
  const tx=db.transaction(['workspace','batchRecords','batchSources','batchMetadata'],'readwrite'),finished=done(tx),meta=tx.objectStore('batchMetadata');
  const existing=await request(meta.get('workspace'));
  if(!existing) {
    const legacy=await request(tx.objectStore('workspace').get('batches'));
    const batches=Array.isArray(legacy)?legacy:[], order=[];let activeId;
    batches.forEach((batch,index)=>{const id='legacy-'+index;order.push(id);if(batch.active)activeId=id;const item=split(id,batch);tx.objectStore('batchRecords').put(item.batch,id);for(const source of item.sources)tx.objectStore('batchSources').put(source,sourceId(id,source.key));});
    meta.put({order,activeId:activeId||order[0]},'workspace');
  }
  await finished;
}
async function save(db,payload) {
  const tx=db.transaction(['workspace','batchRecords','batchSources','batchMetadata'],'readwrite'),finished=done(tx);
  const records=tx.objectStore('batchRecords'),sources=tx.objectStore('batchSources'),meta=tx.objectStore('batchMetadata');
  const recordKeys=await request(records.getAllKeys()),sourceKeys=await request(sources.getAllKeys());
  const order=payload.order;
  if(order) {
    const retained=new Set(order);
    for(const id of recordKeys)if(!retained.has(id))records.delete(id);
    for(const key of sourceKeys)if(!retained.has(JSON.parse(key)[0]))sources.delete(key);
    meta.put({order,activeId:payload.activeId},'workspace');
  }
  for(const item of payload.batches||[]) {
    records.put(item.batch,item.id);
    if(item.sourceKeys)for(const key of sourceKeys){const [id,module]=JSON.parse(key);if(id===item.id&&!item.sourceKeys.includes(module))sources.delete(key);}
    for(const source of item.sources||[]){if(source.remove)sources.delete(sourceId(item.id,source.key));else sources.put(source,sourceId(item.id,source.key));}
  }
  if(payload.trash!==undefined)tx.objectStore('workspace').put(payload.trash,'deletedBatch');
  if(payload.clearTrash)tx.objectStore('workspace').delete('deletedBatch');
  await finished;return true;
}
async function load(db) {
  const tx=db.transaction(['batchRecords','batchSources','batchMetadata'],'readonly'),finished=done(tx);
  const [meta,recordKeys,records,sourceKeys,sources]=await Promise.all([request(tx.objectStore('batchMetadata').get('workspace')),request(tx.objectStore('batchRecords').getAllKeys()),request(tx.objectStore('batchRecords').getAll()),request(tx.objectStore('batchSources').getAllKeys()),request(tx.objectStore('batchSources').getAll())]);
  await finished;
  const byId=new Map(recordKeys.map((id,i)=>[id,records[i]]));
  for(const batch of records){batch.data||={};batch.data.sourceRows={};batch.data.sourceStatus||={};}
  sources.forEach((source,index)=>{const [id,key]=JSON.parse(sourceKeys[index]),batch=byId.get(id);if(!batch)return;const rows=source.rows;rows.sheetName=source.sheetName;rows.sourceStartRow=source.sourceStartRow;batch.data.sourceRows[key]=rows;if(source.previews!==undefined){batch.data.sourceStatus[key]||={};batch.data.sourceStatus[key].previews=source.previews;}});
  const ids=meta?.order||[];
  if(ids.some(id=>!byId.has(id)))throw new Error('本地草稿记录不完整，请保留页面并检查本机存储');
  const batches=ids.map(id=>byId.get(id));batches.forEach((batch,i)=>batch.active=ids[i]===meta.activeId);
  return {batches,ids};
}
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.catch(()=>{}).then(async()=>{try{const db=await open();await migrate(db);let result;if(data.type==='save')result=await save(db,data.payload);else if(data.type==='load')result=await load(db);else if(data.type==='readTrash'){const tx=db.transaction('workspace');const finished=done(tx);result=await request(tx.objectStore('workspace').get('deletedBatch'));await finished;}else throw new Error('未知本地保存操作');self.postMessage({id:data.id,result});}catch(error){self.postMessage({id:data.id,error:error.message||'无法保存到本机'});}});};
