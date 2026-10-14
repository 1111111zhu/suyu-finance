const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function authFailureResponse(request, error) {
  const status = [400,401,403,405,413,415,429,503].includes(error?.status) ? error.status : 503;
  const message = error?.code?.startsWith('ACCESS_') ? error.message : '登录服务暂时不可用，请稍后重试。';
  const headers = {'Cache-Control':'no-store',...(status===429?{'Retry-After':'900'}:{})};
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/auth/callback') {
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>企业微信登录</title></head><body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.7"><h1>请重新登录</h1><p>${escapeHTML(message)}</p><p>如果刚从浏览器切换到企业微信，请在此客户端重新发起登录。</p><a href="/api/auth/login">重新进入企业微信登录</a></body></html>`, {status,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
  }
  return Response.json({error:message},{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
}
