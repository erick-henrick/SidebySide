import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';

const prefix = '/teste-chromium/';
const cookie = 'sbs-chromium-test';
const maxAge = 20 * 60;
const proxyPort = 16080;

export function createChromiumLab(origin, secret) {
  if (new URL(origin).protocol !== 'https:' || !secret || secret.length < 24) {
    throw new Error('O Chromium de teste exige uma origem HTTPS e o token de controle.');
  }
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  const proxyAuth = 'Basic ' + Buffer.from('sidebyside:' + sign('side-by-side:chromium-lab:proxy')).toString('base64');
  const page = readFile(new URL('./chromium-lab.html', import.meta.url));

  function allow(value) {
    const match = /^(\d{10})\.([0-9a-f]{64})$/.exec(value || '');
    if (!match) return 0;
    const now = Math.floor(Date.now() / 1000);
    const expires = Number(match[1]);
    if (expires <= now || expires > now + maxAge) return 0;
    const expected = sign('side-by-side:chromium-lab:session:' + match[1]);
    return timingSafeEqual(Buffer.from(match[2]), Buffer.from(expected)) ? expires : 0;
  }

  function session(req) {
    const value = (req.headers.cookie || '').split(';').map(entry => entry.trim())
      .find(entry => entry.startsWith(cookie + '='));
    return allow(value?.slice(cookie.length + 1));
  }

  async function handle(req, res, path) {
    if (req.method === 'POST' && path === prefix + 'session') {
      if (req.headers.origin !== 'http://127.0.0.1:3120') {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 512) {
          res.writeHead(413).end();
          return;
        }
      }
      const token = new URLSearchParams(body).get('code');
      const expires = allow(token);
      if (!expires) {
        res.writeHead(403).end('O acesso ao teste expirou.');
        return;
      }
      res.writeHead(303, {
        Location: prefix,
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie + '=' + token + '; Path=' + prefix + '; Secure; HttpOnly; SameSite=Lax; Max-Age=' +
          (expires - Math.floor(Date.now() / 1000)),
      }).end();
      return;
    }

    if (req.method !== 'GET' || !session(req)) {
      res.writeHead(403, { 'Cache-Control': 'no-store' }).end('Abra o acesso de teste no PC.');
      return;
    }
    if (path === prefix) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      }).end(await page);
      return;
    }
    const asset = path.slice(prefix.length);
    if (!/^(core|vendor)\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.js$/.test(asset)) {
      res.writeHead(404).end();
      return;
    }
    const upstream = request({
      hostname: 'browser', port: proxyPort, path: '/' + asset, headers: { Authorization: proxyAuth },
    }, response => {
      res.writeHead(response.statusCode, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.pipe(res);
    });
    upstream.setTimeout(5000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    upstream.end();
  }

  function upgrade(req, socket, head) {
    const expires = session(req);
    if (req.url !== prefix + 'websockify' || req.headers.origin !== origin || !expires) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect(proxyPort, 'browser', () => {
      let headers = 'GET /websockify HTTP/1.1\r\nHost: browser:' + proxyPort +
        '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: ' + proxyAuth + '\r\n';
      for (const key of ['origin', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol']) {
        if (req.headers[key]) headers += key + ': ' + req.headers[key] + '\r\n';
      }
      upstream.write(headers + '\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const expiry = setTimeout(() => socket.destroy(), Math.max(0, expires * 1000 - Date.now()));
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    socket.on('close', () => {
      clearTimeout(expiry);
      upstream.destroy();
    });
  }

  return { prefix, handle, upgrade };
}
