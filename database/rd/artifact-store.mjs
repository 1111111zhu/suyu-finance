import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Object.assign(new Error('归档文件校验失败或存储不可用，请联系管理员'),{code:'RD_ARTIFACT_INTEGRITY'});};
async function storageRoot() {
 const root=resolve(process.env.RD_STORAGE_DIR||'.local/artifacts');
 await mkdir(root,{recursive:true,mode:0o700});
 if((await lstat(root)).isSymbolicLink()||await realpath(root)!==root) fail();
 return root;
}
async function verifiedBytes(path,sha256,size) {
 let handle;
 try {
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size!==Number(size)||stat.size>31457280)fail();
  const bytes=await handle.readFile();
  if(digest(bytes)!==sha256)fail();
  return bytes;
 }catch{fail();}finally{await handle?.close();}
}
/** Files are content addressed, never named by user input; registry writes share caller's transaction. */
export async function storeArtifact(client,{kind,objectId,content,sha256}) {
 if(!['project_document','result_file','source_document'].includes(kind)||typeof objectId!=='string'||!objectId||!Buffer.isBuffer(content)||!content.length||content.length>31457280)fail();
 const actual=digest(content);if(sha256&&sha256!==actual)fail();
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['rd-artifact:'+actual]);
 const filename=actual+'.bin',path=join(await storageRoot(),filename);
 let handle;
 try {
  handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  await handle.writeFile(content);await handle.sync();
 }catch(error){if(error.code!=='EEXIST')throw error;}finally{await handle?.close();}
 await verifiedBytes(path,actual,content.length);
 await client.query('INSERT INTO rd.artifact_registry(kind,object_id,sha256,byte_size,relative_path) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,object_id) DO NOTHING',[kind,objectId,actual,content.length,filename]);
 const row=(await client.query('SELECT sha256,byte_size FROM rd.artifact_registry WHERE kind=$1 AND object_id=$2',[kind,objectId])).rows[0];
 if(!row||row.sha256!==actual||Number(row.byte_size)!==content.length)fail();
 return {sha256:actual,byteSize:content.length};
}
/** Only historical objects lacking a registry mapping use bytea fallback. */
export async function readArtifact(client,{kind,objectId,content,sha256}) {
 const row=(await client.query('SELECT sha256,byte_size,relative_path FROM rd.artifact_registry WHERE kind=$1 AND object_id=$2',[kind,objectId])).rows[0];
 if(!row){if(!Buffer.isBuffer(content)||sha256&&digest(content)!==sha256)fail();return content;}
 if(!/^[a-f0-9]{64}\.bin$/.test(row.relative_path)||row.relative_path!==row.sha256+'.bin'||sha256&&sha256!==row.sha256)fail();
 return verifiedBytes(join(await storageRoot(),row.relative_path),row.sha256,row.byte_size);
}
