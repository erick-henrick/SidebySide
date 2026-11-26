const liveDelayMs = 1600;

export function connectLiveCinema({ media, screen, poster, join, sound, status }) {
  let player;
  let started = false;
  let local = false;
  let retryAt = 0;
  let hasVideo = false;
  let clock;
  let nextClockRead = 0;
  let lastSeekAt = -Infinity;
  let lastSyncAt = -Infinity;
  const manifest = '/live/live.m3u8';

  media.autoplay = true;
  media.playsInline = true;
  media.muted = true;
  join.hidden = true;
  sound.hidden = false;

  function paintSound() {
    const silent = media.muted || media.volume === 0;
    media.dataset.audioBlocked = String(media.muted);
    media.dataset.viewerMuted = String(media.muted);
    const label = silent ? 'Ativar som' : 'Silenciar';
    sound.setAttribute('aria-label', label);
    sound.title = label;
    sound.querySelector('use')?.setAttribute('href', '/icons.svg#' + (silent ? 'mute' : 'volume'));
    media.dispatchEvent(new CustomEvent('cinema-audio-state'));
  }

  function updateScreen() {
    if (local) return;
    const visible = Boolean(hasVideo && media.videoWidth && media.readyState >= 2);
    screen.setAttribute('visible', visible);
    poster.setAttribute('visible', !visible);
    if (visible && status.textContent.startsWith('Conectando')) status.textContent = 'Você está assistindo à sessão.';
  }

  async function readClock(now) {
    nextClockRead = now + 5000;
    try {
      const response = await fetch('/live/clock', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!response.ok) return;
      const { now: serverTime } = await response.json();
      if (!Number.isFinite(serverTime)) return;
      const receivedAt = performance.now();
      clock = { serverTime: serverTime + (receivedAt - now) / 2, receivedAt };
      nextClockRead = receivedAt + 45000;
    } catch {
      // Keep the last estimate until a fresh reading is available.
    }
  }

  function syncLiveTimeline() {
    if (!player || local || media.paused || media.seeking) return;
    const now = performance.now();
    if (now - lastSyncAt < 200) return;
    lastSyncAt = now;
    if (now >= nextClockRead) void readClock(now);
    const capturedAt = player.playingDate?.getTime();
    if (!clock || !Number.isFinite(capturedAt)) return;

    const target = clock.serverTime + (now - clock.receivedAt) - liveDelayMs;
    const difference = (target - capturedAt) / 1000;
    media.dataset.liveDriftMs = String(Math.round(difference));
    const seekTo = media.currentTime + difference;
    if (Math.abs(difference) > 0.28 && now - lastSeekAt > 3000) {
      for (let i = 0; i < media.buffered.length; i++) {
        if (seekTo < media.buffered.start(i) + 0.05 || seekTo > media.buffered.end(i) - 0.25) continue;
        lastSeekAt = now;
        media.playbackRate = 1;
        media.currentTime = seekTo;
        return;
      }
    }
    media.playbackRate = Math.abs(difference) < 0.07
      ? 1 : 1 + Math.max(-0.04, Math.min(0.04, difference * 0.3));
  }

  function ensureConnected() {
    if (started || local || Date.now() < retryAt) return;
    if (window.Hls?.isSupported()) {
      player = new Hls({ liveSyncDuration: liveDelayMs / 1000, liveMaxLatencyDuration: 8 });
      player.on(Hls.Events.ERROR, (_event, error) => {
        if (!error.fatal) return;
        player.destroy();
        player = undefined;
        media.playbackRate = 1;
        started = false;
        retryAt = Date.now() + 3000;
        status.textContent = 'Transmissão indisponível. Tentando reconectar…';
      });
      player.loadSource(manifest);
      player.attachMedia(media);
    } else if (media.canPlayType('application/vnd.apple.mpegurl')) {
      media.src = manifest;
    } else {
      status.textContent = 'Este navegador não consegue reproduzir a transmissão.';
      return;
    }
    started = true;
    status.textContent = 'Conectando à transmissão…';
  }

  function activateSound() {
    if (!local && started) void media.play().catch(() => {});
  }

  sound.addEventListener('click', () => {
    if (media.volume === 0) {
      media.volume = 1;
      media.muted = false;
    } else {
      media.muted = !media.muted;
    }
    activateSound();
  });
  media.addEventListener('volumechange', paintSound);
  media.addEventListener('playing', updateScreen);
  media.addEventListener('timeupdate', syncLiveTimeline);
  media.addEventListener('loadeddata', () => {
    if (!local && started && media.paused) void media.play().catch(() => {});
    updateScreen();
  });
  window.addEventListener('cinema-session-state', event => {
    hasVideo = Boolean(event.detail.playback?.videoId);
    if (hasVideo) ensureConnected();
    updateScreen();
  });
  document.querySelector('#video-file').addEventListener('change', event => {
    if (!event.target.files[0]) return;
    local = true;
    media.playbackRate = 1;
    player?.destroy();
  }, { capture: true });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) player?.destroy();
  });
  paintSound();
  return { ensureConnected, activateSound, isConnected: () => started && media.readyState >= 2 && !local };
}
