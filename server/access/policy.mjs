export function canonicalPath(path){
 for(let i=0;i<3;i++){try{const decoded=decodeURIComponent(path);if(decoded===path)break;path=decoded;}catch{return '/salary/invalid-path';}}
 path=path.replaceAll('\\','/').replace(/\/+/g,'/');
 return new URL(path,'http://internal.invalid').pathname;
}
export function routeCapability(path,method='GET'){
 path=canonicalPath(path);
 if(path==='/salary'||path.startsWith('/salary/')||path.startsWith('/salary-directory')||path.startsWith('/salary-preview')||path.startsWith('/api/payroll/'))return 'payroll';
 if(path.startsWith('/api/rd/'))return 'rd';
 if(path.startsWith('/projects')||path.startsWith('/rd-cost')||path.startsWith('/scenario')||path.startsWith('/calculate')||path.startsWith('/api/ai/'))return 'rd';
 return null;
}
