// Official Web login: https://developer.work.weixin.qq.com/document/path/98152
export function wecomLoginURL({ userAgent = '', corpId, agentId, origin, state, handoff = false }) {
  const embedded = /\bwxwork\b/i.test(userAgent);
  const callback = new URL('/api/auth/callback', origin);
  if (handoff) callback.searchParams.set('handoff', '1');
  const url = new URL(embedded
    ? 'https://open.weixin.qq.com/connect/oauth2/authorize'
    : 'https://login.work.weixin.qq.com/wwlogin/sso/login');
  const params = {
    appid: corpId,
    agentid: agentId,
    redirect_uri: callback.toString(),
    state,
    ...(embedded
      ? { response_type: 'code', scope: 'snsapi_base' }
      : { login_type: 'CorpApp', lang: 'zh' }),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (embedded) url.hash = 'wechat_redirect';
  return url;
}

// auth/getuserinfo returns lowercase userid; accept the legacy spelling too.
export function wecomMemberId(identity) {
  const current = identity?.userid;
  const legacy = identity?.UserId;
  if (current && legacy && current !== legacy) return null;
  const userid = current ?? legacy;
  return typeof userid === 'string' && /^[A-Za-z0-9_.@-]{1,64}$/.test(userid) ? userid : null;
}

// Same QR iframe and handshake as Tencent's official wwLogin-1.2.7.js.
export function wecomQrURL({corpId,agentId,origin,state}) {
 const url=new URL('https://open.work.weixin.qq.com/wwopen/sso/qrConnect');
 for(const [key,value] of Object.entries({appid:corpId,agentid:agentId,redirect_uri:new URL('/api/auth/callback',origin).toString(),state,version:'1.2.7',login_type:'jssdk',lang:'zh'}))url.searchParams.set(key,value);
 return url.toString();
}
// Only the expected first-party callback may navigate the host page.
export function wecomQrCallback(value,origin,state) {
 if(typeof value!=='string')return null;
 try {
  const url=new URL(value);
  if(url.origin!==origin||url.pathname!=='/api/auth/callback'||url.username||url.password||url.hash||url.searchParams.getAll('state').length!==1||url.searchParams.get('state')!==state||url.searchParams.getAll('code').length!==1||!url.searchParams.get('code'))return null;
  return url.toString();
 }catch{return null;}
}
