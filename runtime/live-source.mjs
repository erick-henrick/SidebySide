export function createLiveSource(origin, token) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || !base.pathname.endsWith('/')) {
    throw new Error('Configure CINEMA_HLS_ORIGIN com um endereço HTTP interno terminado em /.');
  }

  const chunks = new Map();
  async function load(name) {
    const upstream = await fetch(new URL(name, base), {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(6000),
    });
    return { ok: upstream.ok, bytes: await upstream.arrayBuffer() };
  }

  return async (req, res, path) => {
    if (req.method === 'GET' && path === '/live/clock') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ now: Date.now() }));
      return;
    }
    const name = path.slice('/live/'.length);
    if (!['GET', 'HEAD'].includes(req.method) || !/^(live\.m3u8|chunk-\d+\.ts)$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const playlist = name === 'live.m3u8';
    try {
      let pending = playlist ? undefined : chunks.get(name);
      if (!pending) {
        pending = load(name);
        if (!playlist) {
          chunks.set(name, pending);
          if (chunks.size > 18) chunks.delete(chunks.keys().next().value);
        }
      }
      const result = await pending;
      if (!result.ok) {
        chunks.delete(name);
        res.writeHead(503, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        'Content-Length': result.bytes.byteLength,
        'Cache-Control': playlist ? 'no-store' : 'public, max-age=10',
      });
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(result.bytes));
    } catch {
      chunks.delete(name);
      res.writeHead(502, { 'Cache-Control': 'no-store' }).end();
    }
  };
}
