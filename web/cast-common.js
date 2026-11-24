export async function castRequest(path, { token, data, signal, method = 'GET', keepalive = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (data) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/casts' + path, {
    method, headers, body: data && JSON.stringify(data), signal, keepalive, cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'A transmissão não está disponível.');
  return result;
}

export async function waitForCast(session, condition, signal) {
  while (!signal.aborted) {
    const state = await castRequest('/' + session.code, { token: session.token, signal });
    if (condition(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw signal.reason;
}

export async function sendDescription(peer, session, type, signal) {
  const description = type === 'offer' ? await peer.createOffer() : await peer.createAnswer();
  await peer.setLocalDescription(description);

  if (peer.iceGatheringState !== 'complete') {
    await new Promise(resolve => {
      function complete() {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', observe);
        signal.removeEventListener('abort', complete);
        resolve();
      }
      function observe() {
        if (peer.iceGatheringState === 'complete') complete();
      }
      const timer = setTimeout(complete, 7000);
      peer.addEventListener('icegatheringstatechange', observe);
      signal.addEventListener('abort', complete, { once: true });
    });
  }
  signal.throwIfAborted();

  await castRequest('/' + session.code + '/' + type, {
    token: session.token, method: 'POST', data: peer.localDescription, signal,
  });
}

export function closeCast(session) {
  return castRequest('/' + session.code, {
    token: session.token, method: 'DELETE', keepalive: true,
  }).catch(() => {});
}
