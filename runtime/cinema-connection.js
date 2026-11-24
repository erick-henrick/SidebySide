export function connectCinema({ media, screen, poster, join, sound, status }) {
  let receiver;
  let stream;
  let audioContext;
  let audioSource;
  let analyser;
  let gain;
  let attaching = false;
  let hasVideo = false;
  let stopped = false;
  let muted = false;
  let streamGeneration = 0;

  // Only the video track goes to the video element. A single Web Audio graph
  // plays the sound, and can be unlocked by the entrance gesture before any
  // stream or YouTube link exists.
  media.autoplay = true;
  media.playsInline = true;
  media.loop = false;
  media.muted = true;
  join.hidden = true;

  function updateSound() {
    const blocked = audioContext?.state !== 'running';
    media.dataset.audioBlocked = String(blocked);
    media.dataset.viewerMuted = String(muted);
    if (gain) gain.gain.value = muted ? 0 : media.volume;
    sound.hidden = false;
    const label = blocked || muted || media.volume === 0 ? 'Ativar som' : 'Silenciar';
    sound.setAttribute('aria-label', label);
    sound.title = label;
    const soundIcon = sound.querySelector('use');
    if (soundIcon) soundIcon.setAttribute('href', '/icons.svg#' + (blocked || muted || media.volume === 0 ? 'mute' : 'volume'));
    else sound.textContent = label;
    media.dispatchEvent(new CustomEvent('cinema-audio-state'));
  }

  function ensureAudio() {
    if (audioContext) return audioContext;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return null;
    audioContext = new Audio();
    analyser = audioContext.createAnalyser();
    gain = audioContext.createGain();
    analyser.connect(gain);
    gain.connect(audioContext.destination);
    audioContext.addEventListener('statechange', updateSound);
    updateSound();
    return audioContext;
  }

  function activateSound() {
    const context = ensureAudio();
    if (context && context.state !== 'running' && context.state !== 'closed') {
      // Do not await this: a browser may keep resume() pending until a real tap.
      void context.resume().then(updateSound).catch(updateSound);
    }
    updateSound();
    if (media.srcObject && media.paused) void media.play().catch(() => {});
  }

  function showScreen() {
    const visible = Boolean(hasVideo && media.videoWidth && stream);
    screen.setAttribute('visible', visible);
    poster.setAttribute('visible', !visible);
  }

  function connectAudio() {
    const context = ensureAudio();
    audioSource?.disconnect();
    audioSource = null;
    if (context && stream?.getAudioTracks().length) {
      audioSource = context.createMediaStreamSource(stream);
      audioSource.connect(analyser);
    }
    updateSound();
  }

  function ensureConnected() {
    if (receiver || stopped) return;
    receiver = document.createElement('iframe');
    receiver.id = 'cinema-receiver';
    receiver.title = 'Conexão com a sala';
    receiver.src = '/join';
    receiver.allow = 'autoplay';
    receiver.tabIndex = -1;
    receiver.setAttribute('aria-hidden', 'true');
    receiver.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:360px';
    document.body.append(receiver);
    join.disabled = true;
    status.textContent = 'Conectando à sala…';
  }

  async function attachStream(next) {
    stream?.removeEventListener('addtrack', refreshTracks);
    stream?.removeEventListener('removetrack', refreshTracks);
    stream = next;
    streamGeneration++;
    stream.addEventListener('addtrack', refreshTracks);
    stream.addEventListener('removetrack', refreshTracks);
    await refreshTracks();
    status.textContent = hasVideo ? 'Você está assistindo à sessão.' :
      'Você está na sala. Aguardando o vídeo do anfitrião…';
  }

  async function refreshTracks() {
    media.removeAttribute('src');
    media.srcObject = new MediaStream(stream.getVideoTracks());
    connectAudio();
    try {
      await media.play();
      showScreen();
    } catch {
      status.textContent = 'Toque na sala para retomar a reprodução.';
    }
  }

  function entranceGesture(event) {
    if (!event.isTrusted || event.target.closest?.('#sound-cast')) return;
    activateSound();
  }

  document.addEventListener('pointerdown', entranceGesture, true);
  document.addEventListener('keydown', entranceGesture, true);
  join.addEventListener('click', () => { ensureConnected(); activateSound(); });
  sound.addEventListener('click', () => {
    const blocked = audioContext?.state !== 'running';
    muted = blocked || media.volume === 0 ? false : !muted;
    if (!muted && media.volume === 0) media.volume = 1;
    activateSound();
  });
  media.addEventListener('volumechange', updateSound);
  media.addEventListener('loadeddata', showScreen);
  media.addEventListener('resize', showScreen);
  window.addEventListener('cinema-session-state', event => {
    hasVideo = Boolean(event.detail.playback?.videoId);
    showScreen();
    if (status.textContent === 'Você está na sala. Aguardando o vídeo do anfitrião…' && hasVideo) {
      status.textContent = 'Você está assistindo à sessão.';
    }
  });

  const monitor = setInterval(async () => {
    if (attaching || !receiver || stopped) return;
    try {
      const source = receiver.contentDocument?.querySelector('video');
      if (!source?.srcObject || !source.videoWidth || source.srcObject === stream) return;
      attaching = true;
      source.volume = 0;
      await attachStream(source.srcObject);
    } catch {
      status.textContent = 'Reconectando à sala…';
    } finally { attaching = false; }
  }, 200);

  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    stopped = true;
    clearInterval(monitor);
    receiver?.remove();
    void audioContext?.close();
  });

  window.nekoCheck = () => {
    const samples = new Uint8Array(analyser?.fftSize || 0);
    analyser?.getByteTimeDomainData(samples);
    const audioPeak = samples.length ? Math.max(...samples.map(value => Math.abs(value - 128))) : 0;
    return {
      connected: Boolean(stream), streamGeneration, width: media.videoWidth, height: media.videoHeight,
      time: media.currentTime, paused: media.paused, muted, volume: media.volume,
      audioGain: gain?.gain.value,
      audioPeak, audioState: audioContext?.state, audioBlocked: media.dataset.audioBlocked === 'true',
      frames: media.getVideoPlaybackQuality().totalVideoFrames,
      tracks: stream?.getTracks().map(track => ({ kind: track.kind, state: track.readyState })),
      screenVisible: screen.getAttribute('visible'), status: status.textContent,
    };
  };

  ensureConnected();
  activateSound();
  return { ensureConnected, activateSound };
}
