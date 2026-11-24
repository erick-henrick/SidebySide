(() => {
  if (window.sideBySideCinema?.version === 10) return;
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  function isAdPlaying(player) {
    return Boolean(player?.classList.contains('ad-showing') ||
      (typeof player?.getAdState === 'function' && player.getAdState() !== -1));
  }

  function trackInfo(track) {
    if (!track) return {};
    return Object.values(track).find(value =>
      value && typeof value === 'object' && typeof value.name === 'string'
    ) || track;
  }

  async function selectOriginal(player, video) {
    const tracks = player.getAvailableAudioTracks?.() || [];
    const originals = tracks.filter(track => trackInfo(track).isAutoDubbed === false);
    const original = tracks.find(track =>
      trackInfo(track).isOriginal === true || /\boriginal\b/i.test(trackInfo(track).name || '')
    ) || (originals.length === 1 ? originals[0] : undefined);
    if (!original) return { selected: false, name: '', reason: 'not-identified' };

    const current = player.getAudioTrack?.();
    if (current?.id !== original.id) {
      const position = video.currentTime;
      const paused = video.paused;
      player.setAudioTrack(original);
      await wait(400);
      const deadline = Date.now() + 5000;
      while (video.readyState < 3 && Date.now() < deadline) await wait(100);
      if (Number.isFinite(video.duration) && Math.abs(video.currentTime - position) > 0.5) {
        player.seekTo(position, true);
      }
      if (paused) player.pauseVideo();
      else player.playVideo();
    }
    const selected = player.getAudioTrack?.();
    return {
      selected: selected?.id === original.id,
      name: trackInfo(selected).name || '',
      autoDubbed: trackInfo(selected).isAutoDubbed === true,
    };
  }

  window.sideBySideCinema = {
    version: 10,
    ready(expectedVideoId, contentOnly = false) {
      const player = document.querySelector('#movie_player');
      const video = player?.querySelector('video');
      const matches = !expectedVideoId ||
        (new URL(location.href).searchParams.get('v') === expectedVideoId &&
          player?.getVideoData?.().video_id === expectedVideoId);
      const contentReady = !contentOnly || (!isAdPlaying(player) && player?.getPlayerState?.() !== -1);
      return Boolean(matches && contentReady && player && video && video.readyState >= 2);
    },
    async prepare() {
      const player = document.querySelector('#movie_player');
      const video = player?.querySelector('video');
      if (!player || !video || video.readyState < 2) return { ready: false };
      const audio = await selectOriginal(player, video);
      const subtitles = player.querySelector('.ytp-subtitles-button');
      if (subtitles?.getAttribute('aria-pressed') === 'true') subtitles.click();
      if (subtitles?.getAttribute('aria-pressed') === 'true') player.unloadModule?.('captions');
      const autoplay = player.querySelector('.ytp-autonav-toggle-button');
      if (autoplay?.getAttribute('aria-checked') === 'true') autoplay.closest('button')?.click();
      return { ready: true, audio, captions: subtitles?.getAttribute('aria-pressed') === 'true',
        autoplay: autoplay?.getAttribute('aria-checked') === 'true' };
    },
    diagnostics() {
      const player = document.querySelector('#movie_player');
      const video = player?.querySelector('video');
      const errorPanel = player?.querySelector('.ytp-error-content-wrap');
      const visibleError = errorPanel?.getClientRects().length
        ? errorPanel.innerText.trim().slice(0, 700) : '';
      const mediaError = video?.error;
      const failed = Boolean(visibleError || mediaError);
      const stats = player?.getVideoStats?.() || {};
      let details = stats.debug_error;
      if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch { details = {}; }
      }
      const videoId = player?.getVideoData?.().video_id || '';
      const position = video?.currentTime || 0;
      const previousPosition = Number(stats.cmt);
      const savedPosition = failed && stats.debug_videoId === videoId &&
        Number.isFinite(previousPosition) && previousPosition > position
        ? previousPosition : position;
      return {
        videoId,
        title: player?.getVideoData?.().title || '',
        position: savedPosition,
        duration: Number.isFinite(video?.duration) ? video.duration : null,
        contentDuration: Number(player?.getPlayerResponse?.()?.videoDetails?.lengthSeconds) || null,
        ended: video?.ended ?? false,
        isLive: player?.getVideoData?.().isLive === true,
        paused: video?.paused ?? true,
        isAd: isAdPlaying(player),
        playerState: player?.getPlayerState?.(),
        error: failed ? {
          message: visibleError || mediaError.message || 'Falha na reprodução.',
          code: details?.errorCode || '',
          mediaCode: mediaError?.code || null,
          networkState: video?.networkState,
          readyState: video?.readyState,
        } : null,
      };
    },
    restorePlayback(position, playing) {
      const player = document.querySelector('#movie_player');
      const video = player?.querySelector('video');
      if (!video) throw new Error('O vídeo ainda está carregando.');
      if (!player.getVideoData().isLive && Number.isFinite(video.duration) && position > 0) {
        player.seekTo(Math.min(position, Math.max(0, video.duration - 0.2)), true);
      }
      if (playing) player.playVideo();
      else player.pauseVideo();
      return { position: video.currentTime, paused: video.paused };
    },
    adSkipTarget() {
      const buttons = document.querySelectorAll(
        '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button'
      );
      const button = Array.from(buttons).find(candidate =>
        !candidate.disabled && candidate.getClientRects().length > 0
      );
      if (!button) return { available: false };
      const bounds = button.getBoundingClientRect();
      return { available: true, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    },
    async expand() {
      const player = document.querySelector('#movie_player');
      if (!player) throw new Error('O player do YouTube ainda está carregando.');
      if (document.fullscreenElement !== player) await player.requestFullscreen();
      return { fullscreen: document.fullscreenElement === player };
    },
  };
})();
