import { castRequest, closeCast, sendDescription, waitForCast } from './cast-common.js';

export function receiveCast(code, { onMedia, onStatus, onEnd }) {
  const controller = new AbortController();
  const { signal } = controller;
  let session;
  let peer;
  let stream;

  function end(message = 'Você saiu da transmissão.') {
    if (signal.aborted) return;
    controller.abort();
    peer?.close();
    if (session) void closeCast(session);
    onEnd(message);
  }

  async function connect() {
    try {
      session = await castRequest('/' + code + '/join', { method: 'POST', signal });
      onStatus('Aguardando o vídeo do anfitrião.');
      const { offer } = await waitForCast(session, state => state.offer, signal);
      peer = new RTCPeerConnection({ iceServers: session.iceServers });
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed') end('A rede não conseguiu conectar os aparelhos.');
      });
      peer.addEventListener('track', event => {
        if (stream) return;
        stream = event.streams[0];
        onMedia(stream);
      });
      await peer.setRemoteDescription(offer);
      await sendDescription(peer, session, 'answer', signal);
      await waitForCast(session, () => false, signal);
    } catch (error) {
      if (!signal.aborted) end(error.message);
    }
  }
  void connect();
  return end;
}
