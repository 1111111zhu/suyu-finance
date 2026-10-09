import {randomBytes,scryptSync} from 'node:crypto';
const payrollActorUsername = access => access.local ? process.env.SUYU_LOCAL_PAYROLL_ACTOR || 'admin' : access.authMethod==='password' ? 'account:'+access.accountId : access.deviceId ? 'netbird:'+access.deviceId : 'wecom:'+access.userid;
function randomPasswordHash() {
  const salt=randomBytes(16).toString('hex');
  return 'scrypt$32768$8$1$'+salt+'$'+scryptSync(randomBytes(32),salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
}
export async function payrollActor(pool, access) {
  const username = payrollActorUsername(access);
  if (['payroll', 'finance_payroll'].includes(access.role) && !access.authMethod && !access.deviceId && !access.local) {
    // Audit identity only; no usable password is distributed and disabled actors
    // are never re-enabled by tag membership.
    await pool.query('INSERT INTO payroll.users(username,display_name,password_hash) VALUES($1,$2,$3) ON CONFLICT(username) DO NOTHING',
      [username, access.displayName || access.userid, randomPasswordHash()]);
  }
  const {rows: [user]} = await pool.query('SELECT id,username,display_name FROM payroll.users WHERE enabled AND username=$1', [username]);
  if (!user) throw Object.assign(new Error('工资操作账号尚未配置或已停用'), {status:403, code:'PAYROLL_AUTH_REQUIRED'});
  return user;
}
