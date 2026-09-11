import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 3091);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.md':'text/plain; charset=utf-8', '.txt':'text/plain; charset=utf-8' };
http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let target = path.resolve(root, `.${urlPath}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end('Forbidden'); return; }
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type':types[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(bytes);
  } catch { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`规范设计 → http://127.0.0.1:${port}`));
