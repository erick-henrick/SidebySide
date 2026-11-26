import { createLiveSource } from './live-source.mjs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { createQueue } from './cinema-queue.mjs';
import { youtubeVideoId, videoMetadata, searchVideos } from './youtube-search.mjs';

const execute = promisify(execFile);
const directory = fileURLToPath(new URL('.', import.meta.url));
const dataDirectory = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : directory;
await mkdir(dataDirectory, { recursive: true });
let runtime = {};
try {
  runtime = JSON.parse(await readFile(directory + 'neko-runtime.json', 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const container = process.env.NEKO_CONTAINER || runtime.container || 'side-by-side-neko-qa';
const nekoPort = Number(process.env.NEKO_HTTP_PORT || runtime.httpPort || 8097);
const useTailnet = Boolean(process.env.NEKO_TAILNET_IP);
const nekoHost = useTailnet ? 'tailscale' : (process.env.NEKO_HTTP_HOST || '127.0.0.1');
const nekoControlUrl = useTailnet ? 'http://tailscale:8765' : process.env.NEKO_CONTROL_URL;
const hlsOrigin = process.env.CINEMA_HLS_ORIGIN;
const serveLive = hlsOrigin ? createLiveSource(hlsOrigin, process.env.CONTROL_TOKEN) : null;
const appPort = Number(process.env.PORT || 3114);
const appOrigin = new URL(process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:' + appPort).origin;
const listenHost = process.env.HOST || '127.0.0.1';
const queue = await createQueue(join(dataDirectory, 'cinema-session.json'));
let playbackSnapshot = null;
let pendingEntry = null;
let autoAdvanceAttemptedFor = '';
let notice = { text: '', at: 0 };
function setNotice(text) { notice = { text, at: Date.now() }; }
function sessionState() {
  return { ...queue.snapshot(), playback: playbackSnapshot, busy: controlling, notice };
}
const playbackKeys = new Map([
  ['play', 'k'],
  ['back', 'j'],
  ['forward', 'l'],
  ['restart', '0'],
]);
let controlling = false;
async function remoteCommand(method, params) {
  let result;
  if (nekoControlUrl) {
    const response = await fetch(nekoControlUrl + '/command', {
      method: 'POST', headers: {
        'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.CONTROL_TOKEN,
      },
      body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(25000),
    });
    result = await response.json();
    if (!response.ok) throw new Error(result.error || 'O navegador remoto não respondeu.');
  } else {
    const { stdout } = await execute(process.platform === 'win32' ? 'docker.exe' : 'docker', ['exec', container,
      'python3', '/tmp/inspect-browser.py', method, JSON.stringify(params)],
      { windowsHide: true, timeout: 10000 });
    result = JSON.parse(stdout);
  }
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Falha ao controlar o player.');
  }
  return result;
}
async function pressPlayerKey(key) {
  await remoteCommand('Runtime.evaluate', {
    expression: "(()=>{const player=document.querySelector('#movie_player');if(!player)throw new Error('Abra um vídeo do YouTube.');player.focus()})()",
    userGesture: true,
  });
  const code = key === '0' ? 'Digit0' : 'Key' + key.toUpperCase();
  const keyCode = key.toUpperCase().charCodeAt(0);
  const event = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await remoteCommand('Input.dispatchKeyEvent', { ...event, type: 'keyDown' });
  await remoteCommand('Input.dispatchKeyEvent', { ...event, type: 'keyUp' });
}
async function navigateVideo(url) {
  await remoteCommand('Page.bringToFront', {});
  const navigation = await remoteCommand('Page.navigate', { url });
  if (navigation.errorText) throw new Error('O YouTube não conseguiu abrir o vídeo.');
  if (!navigation.loaderId) return;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const tree = await remoteCommand('Page.getFrameTree', {});
    if (tree.frameTree.frame.loaderId === navigation.loaderId) return;
    await wait(150);
  }
  throw new Error('O YouTube está demorando para abrir o vídeo.');
}

const cinemaScript = await readFile(directory + 'youtube-cinema.js', 'utf8');
let lastPlaybackError = '';
let checkingPlayback = false;
let lastHealthyPlayback;
let recoveryAttemptedFor = '';
async function evaluateCinema(expression, userGesture = false) {
  const result = await remoteCommand('Runtime.evaluate', {
    expression: cinemaScript + '\n' + expression,
    returnByValue: true,
    userGesture,
    awaitPromise: true,
  });
  return result.result.value;
}
async function recordPlaybackError() {
  const snapshot = await evaluateCinema('window.sideBySideCinema.diagnostics()');
  playbackSnapshot = { ...snapshot, observedAt: Date.now() };
  if (!snapshot.error) {
    lastPlaybackError = '';
    if (!snapshot.isAd && [0, 1, 2, 3].includes(snapshot.playerState)) lastHealthyPlayback = snapshot;
    return snapshot;
  }
  const signature = JSON.stringify([snapshot.videoId, snapshot.error]);
  if (signature === lastPlaybackError) return snapshot;
  await appendFile(join(dataDirectory, 'playback-errors.jsonl'), JSON.stringify({
    recordedAt: new Date().toISOString(), browser: container, ...snapshot,
  }) + '\n', 'utf8');
  lastPlaybackError = signature;
  return snapshot;
}
async function recoverPlayback(snapshot) {
  controlling = true;
  recoveryAttemptedFor = snapshot.videoId;
  const previous = lastHealthyPlayback?.videoId === snapshot.videoId ? lastHealthyPlayback : undefined;
  const position = previous?.position || 0;
  const playing = previous ? !previous.paused : true;
  try {
    await appendFile(join(dataDirectory, 'playback-errors.jsonl'), JSON.stringify({
      recordedAt: new Date().toISOString(), browser: container, type: 'recovery-start',
      videoId: snapshot.videoId, position, playing,
    }) + '\n', 'utf8');
    await navigateVideo('https://www.youtube.com/watch?v=' + snapshot.videoId + '&t=' + Math.floor(position) + 's');
    await wait(400);
    await prepareCinema(snapshot.videoId);
    await waitForVideo(snapshot.videoId, 120000, true);
    await prepareCinema(snapshot.videoId);
    await evaluateCinema('window.sideBySideCinema.restorePlayback(' + position + ',' + playing + ')');
    await appendFile(join(dataDirectory, 'playback-errors.jsonl'), JSON.stringify({
      recordedAt: new Date().toISOString(), browser: container, type: 'recovery-complete',
      videoId: snapshot.videoId, position,
    }) + '\n', 'utf8');
    return true;
  } catch (error) {
    await appendFile(join(dataDirectory, 'playback-errors.jsonl'), JSON.stringify({
      recordedAt: new Date().toISOString(), browser: container, type: 'recovery-failed',
      videoId: snapshot.videoId, message: error.message.slice(0, 500),
    }) + '\n', 'utf8');
    return false;
  } finally {
    controlling = false;
  }
}
const playbackMonitor = setInterval(async () => {
  if (checkingPlayback || controlling) return;
  checkingPlayback = true;
  try {
    const snapshot = await recordPlaybackError();
    if (controlling) return;
    if (!controlling && snapshot.error?.code === 'ump.spsrejectfailure' &&
        /^[A-Za-z0-9_-]{11}$/.test(snapshot.videoId) &&
        recoveryAttemptedFor !== snapshot.videoId) {
      await recoverPlayback(snapshot);
      return;
    }
    if (!snapshot.error && !snapshot.isAd && snapshot.videoId && snapshot.playerState !== -1) {
      const state = queue.snapshot();
      const requested = pendingEntry?.videoId === snapshot.videoId ? pendingEntry : null;
      if (requested || state.current?.videoId !== snapshot.videoId) {
        const current = requested || queue.entry({ videoId: snapshot.videoId, title: snapshot.title });
        await queue.begin({ ...current, title: snapshot.title || current.title });
        if (requested) pendingEntry = null;
      }
      const nextState = queue.snapshot();
      const ended = snapshot.ended && snapshot.playerState === 0 && !snapshot.isLive &&
        snapshot.duration > 0 && (!snapshot.contentDuration ||
          Math.abs(snapshot.duration - snapshot.contentDuration) < 3);
      if (ended && nextState.items.length && autoAdvanceAttemptedFor !== nextState.current?.id) {
        autoAdvanceAttemptedFor = nextState.current.id;
        controlling = true;
        try { await playEntry(nextState.items[0]); }
        catch (error) { setNotice(error.message); }
        finally { controlling = false; }
      }
    }
  } catch {
    // A navegação pode encerrar a inspeção em andamento. A próxima verificação tenta de novo.
  } finally {
    checkingPlayback = false;
  }
}, 5000);
playbackMonitor.unref();
async function expandCinema() {
  const result = await evaluateCinema('window.sideBySideCinema.expand()', true);
  if (!result.fullscreen) throw new Error('Não foi possível ajustar o vídeo ao telão.');
}
class YouTubeLoginRequired extends Error {
  constructor() {
    super('O YouTube exigiu login no navegador do servidor para liberar este vídeo.');
  }
}

async function waitForVideo(expectedVideoId, timeout = 25000, contentOnly = false) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const playback = await evaluateCinema('window.sideBySideCinema.readiness(' +
      JSON.stringify(expectedVideoId || '') + ',' + contentOnly + ')').catch(() => null);
    if (playback?.loginRequired) throw new YouTubeLoginRequired();
    if (playback?.ready) return;
    await wait(400);
  }
  throw new Error('O YouTube ainda não carregou o vídeo. Tente Ajustar telão.');
}
async function prepareCinema(expectedVideoId) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await waitForVideo(expectedVideoId, Math.max(1, deadline - Date.now()));
    const result = await evaluateCinema('window.sideBySideCinema.prepare()');
    if (!result.ready) {
      await wait(250);
      continue;
    }
    await expandCinema();
    if (result.audio.selected) return 'Vídeo no telão com áudio original. ' + result.audio.name;
    return 'Vídeo ajustado ao telão. O YouTube não identificou a faixa original neste vídeo.';
  }
  throw new Error('O YouTube ainda está preparando o vídeo. Tente Ajustar telão.');
}
async function playEntry(entry) {
  pendingEntry = entry;
  setNotice('Carregando ' + entry.title + '…');
  lastHealthyPlayback = undefined;
  recoveryAttemptedFor = '';
  await navigateVideo('https://www.youtube.com/watch?v=' + entry.videoId);
  await wait(400);
  const message = await prepareCinema(entry.videoId);
  const snapshot = await evaluateCinema('window.sideBySideCinema.diagnostics()');
  playbackSnapshot = { ...snapshot, observedAt: Date.now() };
  await queue.begin({ ...entry, title: snapshot.title || entry.title });
  pendingEntry = null;
  autoAdvanceAttemptedFor = '';
  setNotice(message);
  return message;
}
const project = process.env.PROJECT_DIR ? resolve(process.env.PROJECT_DIR) + '/' : directory + 'web/';
const password = process.env.NEKO_USER_PASSWORD || (await readFile(directory + 'viewer.secret', 'utf8')).trim();
const localFiles = new Map([
  ['/app.js', ['app.js', 'text/javascript']],
  ['/cast-viewer.js', ['cast-viewer.js', 'text/javascript']],
  ['/cast-common.js', ['cast-common.js', 'text/javascript']],
  ['/cinema.css', ['cinema.css', 'text/css']],
  ['/home.css', ['home.css', 'text/css']],
  ['/design.css', ['design.css', 'text/css']],
  ['/icons.svg', ['icons.svg', 'image/svg+xml']],
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, appOrigin);
  try {
    if (serveLive && url.pathname.startsWith('/live/')) {
      await serveLive(req, res, url.pathname);
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (url.pathname === '/session-state' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(sessionState()));
      return;
    }
    if (url.pathname === '/video-search' && req.method === 'GET') {
      const videos = await searchVideos(url.searchParams.get('q'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ videos }));
      return;
    }
    if (url.pathname === '/remote-control') {
      if (req.method !== 'POST' || req.headers.origin !== appOrigin) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) { res.writeHead(413).end(); return; }
      }
      const action = JSON.parse(body);
      if (action.type === 'queue-add') {
        const videoId = youtubeVideoId(action.videoId || action.url);
        if (!videoId) { res.writeHead(400).end('Cole um link válido do YouTube.'); return; }
        const video = typeof action.title === 'string' && action.title.trim()
          ? { videoId, title: action.title.slice(0, 200),
              channel: String(action.channel || '').slice(0, 120), duration: String(action.duration || '').slice(0, 20) }
          : await videoMetadata(videoId);
        await queue.add(video);
        setNotice('Adicionado à fila.');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(notice.text);
        return;
      }
      if (action.type === 'queue-remove' || action.type === 'queue-move') {
        if (action.type === 'queue-remove') await queue.remove(action.id);
        else {
          if (![-1, 1].includes(action.offset)) { res.writeHead(400).end('Movimento inválido.'); return; }
          await queue.move(action.id, action.offset);
        }
        setNotice(action.type === 'queue-remove' ? 'Vídeo removido da fila.' : 'Ordem da fila atualizada.');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(notice.text);
        return;
      }
      if (action.type === 'skip-ad') {
        const target = await evaluateCinema('window.sideBySideCinema.adSkipTarget()');
        if (target.available) {
          const click = { x: target.x, y: target.y, button: 'left', clickCount: 1 };
          await remoteCommand('Input.dispatchMouseEvent', { ...click, type: 'mousePressed' });
          await remoteCommand('Input.dispatchMouseEvent', { ...click, type: 'mouseReleased' });
        }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(target.available ? 'Comando enviado ao botão de pular do YouTube.' : 'O YouTube ainda não disponibilizou a opção de pular.');
        return;
      }
      if (controlling) { res.writeHead(409).end('Aguarde o comando anterior.'); return; }
      controlling = true;
      try {
        let message = 'Comando enviado ao navegador remoto.';
        if (action.type === 'open') {
          const id = youtubeVideoId(action.url);
          if (!id) {
            res.writeHead(400).end('Cole um link de vídeo do YouTube.');
            return;
          }
          await recordPlaybackError().catch(() => {});
          message = await playEntry(queue.entry({ videoId: id }));
        } else if (action.type === 'queue-next' || action.type === 'queue-play') {
          const state = queue.snapshot();
          const entry = action.type === 'queue-next' ? state.items[0] :
            state.items.find(item => item.id === action.id);
          if (!entry) { res.writeHead(400).end('Não há vídeo disponível nessa posição da fila.'); return; }
          message = await playEntry(entry);
        } else if (action.type === 'play' && !playbackSnapshot?.videoId) {
          const state = queue.snapshot();
          const entry = state.current || state.items[0];
          if (!entry) { res.writeHead(400).end('Adicione um vídeo à fila primeiro.'); return; }
          message = await playEntry(entry);
        } else if (action.type === 'retry') {
          const snapshot = await recordPlaybackError();
          if (!/^[A-Za-z0-9_-]{11}$/.test(snapshot.videoId)) {
            res.writeHead(400).end('Abra um vídeo do YouTube primeiro.');
            return;
          }
          const recovered = await recoverPlayback(snapshot);
          if (!recovered) throw new Error('O YouTube ainda não conseguiu carregar o vídeo. Tente novamente em instantes.');
          recoveryAttemptedFor = '';
          message = 'Vídeo retomado no ponto salvo.';
        } else if (action.type === 'expand' || action.type === 'original-audio') {
          message = await prepareCinema();
        } else if (playbackKeys.has(action.type)) {
          await pressPlayerKey(playbackKeys.get(action.type));
          await recordPlaybackError();
        } else {
          res.writeHead(400).end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        }).end(message);
        setNotice(message);
      } finally {
        controlling = false;
      }
      return;
    }
    if (url.pathname === '/join') {
      const viewer = 'Amigo-' + Math.random().toString(36).slice(2, 8);
      const query = new URLSearchParams({ usr: viewer, pwd: password, cast: '1', volume: '0' });
      res.writeHead(302, { Location: '/neko/?' + query, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(project + 'home.html'));
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      const relative = decodeURIComponent(url.pathname.slice('/assets/'.length));
      if (!/^[a-zA-Z0-9_.-]+$/.test(relative)) { res.writeHead(404).end(); return; }
      const types = { jpg: 'image/jpeg', png: 'image/png', json: 'application/json' };
      const extension = relative.split('.').pop();
      if (!types[extension]) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': types[extension], 'Cache-Control': 'public, max-age=3600' });
      res.end(await readFile(project + 'assets/' + relative));
      return;
    }
    if (url.pathname === '/cinema' || url.pathname === '/sala') {
      let html = await readFile(project + 'cinema.html', 'utf8');
      if (serveLive) {
        html = html.replace('<body class="cinema-page">', '<body class="cinema-page" data-hls>');
        html = html.replace('</head>', '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.light.min.js" defer></script></head>');
      }
      html = html.replace('</head>', '<link rel="stylesheet" href="/vr-controls.css"><script src="/proof.js" type="module"></script></head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (url.pathname === '/proof.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(directory + 'proof.js'));
      return;
    }
    if (url.pathname === '/vr-controls.js' || url.pathname === '/vr-controls.css' || url.pathname === '/cinema-connection.js' || url.pathname === '/live-cinema.js') {
      const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css';
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(directory + url.pathname.slice(1)));
      return;
    }
    if (localFiles.has(url.pathname)) {
      const [file, type] = localFiles.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
      res.end(await readFile(project + file));
      return;
    }
    if (!url.pathname.startsWith('/neko/')) {
      res.writeHead(404).end();
      return;
    }
    const path = req.url.slice('/neko'.length);
    const upstream = request({ hostname: nekoHost, port: nekoPort, method: req.method,
      path, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  } catch (error) {
    console.error(error.message);
    if (url.pathname === '/remote-control') setNotice(error.message);
    if (!res.headersSent) res.writeHead(error instanceof YouTubeLoginRequired ? 422 : 500);
    res.end(error.message || 'Falha no teste local.');
  }
});

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/neko/')) { socket.destroy(); return; }
  const upstream = connect(nekoPort, nekoHost, () => {
    let headers = req.method + ' ' + req.url.slice('/neko'.length) + ' HTTP/1.1\r\n';
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      headers += req.rawHeaders[index] + ': ' + req.rawHeaders[index + 1] + '\r\n';
    }
    upstream.write(headers + '\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  socket.on('error', () => upstream.destroy());
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
});
server.listen(appPort, listenHost, () => console.log('Cinema em ' + appOrigin));
