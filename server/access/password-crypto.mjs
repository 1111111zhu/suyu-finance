import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';

const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
export function hashPassword(password){
 if(typeof password!=='string'||password.length<12||password.length>1024)throw new Error('密码长度必须为 12 至 1024 个字符');
 const salt=randomBytes(16).toString('hex');
 return `scrypt$32768$8$1$${salt}$${scryptSync(password,salt,64,options).toString('hex')}`;
}
export function verifyPassword(password,encoded){
 if(typeof password!=='string'||password.length>1024||typeof encoded!=='string')return false;
 const match=/^scrypt\$32768\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
 return !!match&&timingSafeEqual(scryptSync(password,match[1],64,options),Buffer.from(match[2],'hex'));
}
