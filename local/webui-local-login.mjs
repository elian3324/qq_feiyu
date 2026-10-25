// Local WebUI convenience only. Existing NapCat API/OneBot authentication stays enabled.
import fs from 'node:fs/promises';
import path from 'node:path';

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function isLocalWebUiRequest(req, { navigation = false } = {}) {
  if (!loopback.has(req.socket?.remoteAddress)) return false;
  try {
    const url = new URL('http://' + req.headers.host);
    if (!hosts.has(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
    if (Number(url.port || 80) !== req.socket.localPort) return false;
    const topNavigation = navigation && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate';
    if (!topNavigation && req.headers.origin && req.headers.origin !== url.origin) return false;
    if (!topNavigation && req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch { return false; }
}

export function installLocalWebUiLogin(app, { staticPath, getCredential }) {
  app.post('/api/local-session', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isLocalWebUiRequest(req) || req.headers['x-napcat-local-login'] !== '1') return res.status(403).json({ code: -1, message: 'Local access required' });
    try {
      const credential = await getCredential();
      if (!credential) return res.status(503).json({ code: -1, message: 'Local session unavailable' });
      return res.json({ code: 0, data: { Credential: credential } });
    } catch { return res.status(503).json({ code: -1, message: 'Local session unavailable' }); }
  });
  app.get('/webui/local-login.mjs', async (req, res, next) => {
    if (!isLocalWebUiRequest(req)) return res.status(403).end();
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/javascript').send(await fs.readFile(new URL('./webui-local-client.mjs', import.meta.url), 'utf8'));
    } catch (error) { next(error); }
  });
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' || !isLocalWebUiRequest(req, { navigation: true })) return next();
    const pathname = req.path;
    if (!(pathname === '/webui' || pathname.startsWith('/webui/'))) return next();
    if (path.posix.extname(pathname) && pathname !== '/webui/index.html') return next();
    try {
      const html = await fs.readFile(path.join(staticPath, 'index.html'), 'utf8');
      const entry = /<script\s+type="module"\s+crossorigin\s+src="([^"]+)"><\/script>/;
      if (!entry.test(html)) throw new Error('WebUI entry changed; local login integration needs review');
      const patched = html.replace(entry, (_, src) => `<script type="module" src="/webui/local-login.mjs" data-napcat-app="${src}"></script>`);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-NapCat-Local-Login', 'enabled');
      res.type('html').send(patched);
    } catch (error) { next(error); }
  });
}
