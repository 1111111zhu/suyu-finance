export function canonicalPath(path){
 for(let i=0;i<3;i++){try{const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}catch{return '/salary/invalid-path';}}
 path=path.replaceAll('\\','/').replace(/\/+/g,'/');
 return new URL(path,'http://internal.invalid').pathname;
}
export function routeCapability(path,method='GET'){
 path=canonicalPath(path);
 if(path==='/salary'||path.startsWith('/salary/')||path.startsWith('/salary-directory')||path.startsWith('/salary-preview')||path.startsWith('/api/payroll/'))return 'payroll';
 if(path.startsWith('/api/rd/')){
  if(path.startsWith('/api/rd/compute'))return 'payroll';
  if(path.startsWith('/api/rd/payroll-sync'))return 'rd'; // route itself separates source reads and aggregate reads.
  if(method!=='GET'||/\/(?:export|result-exports|import|calculations|calculation-batches|ledger|documents|manage|charter-ocr)(?:\/|$)/.test(path))return 'payroll';
  return 'rd';
 }
 if(path.startsWith('/projects')||path.startsWith('/rd-cost')||path.startsWith('/scenario')||path.startsWith('/calculate')||path.startsWith('/api/ai/'))return 'rd';
 return null;
}
