export function mountCinemaControls({ command }) {
  const scene = document.querySelector('a-scene');
  const stage = document.querySelector('#cinema-stage');
  const camera = document.querySelector('#spectator');
  const rig = document.querySelector('#seat-rig');
  const media = document.querySelector('#test-media');
  const dock = document.querySelector('#seat-panel');
  const dockArt = document.querySelector('#seat-panel-art');
  const status = document.querySelector('#live-status');
  const surfaces = new Map();
  let state = { items: [], current: null, playback: null, busy: false, notice: { at: 0 } };
  let open = false;
  let view = 'player';
  let page = 0;
  let query = '';
  let results = [];
  let selected = null;
  let selectedQueueId = null;
  let message = '';
  let working = false;
  let gazeEnabled = false;
  let cardboard = false;
  let searchController;
  let panel;
  let launcher;
  let gaze;
  let gazeLatch = null;
  let gazeTarget = null;
  let gazeStarted = 0;
  let stereo;
  let originalRender;
  let previousPixelRatio;
  let previousFov;
  let alreadyFullscreen = false;
  let lastNotice = 0;
  let polling = false;
  let desktopView = null;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.id = 'open-cinema-controls';
  openButton.className = 'cinema-controls-button';
  openButton.textContent = 'Controles';
  openButton.addEventListener('click', () => setOpen(!open, true));
  stage.append(openButton);

  const cardboardButton = document.createElement('button');
  cardboardButton.type = 'button';
  cardboardButton.id = 'cardboard-mode';
  cardboardButton.className = 'button primary';
  cardboardButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="/icons.svg#headset"/></svg>Entrar em VR';
  cardboardButton.addEventListener('click', () => void toggleCardboard());
  document.querySelector('.cinema-actions').append(cardboardButton);

  function clock(seconds) {
    if (!Number.isFinite(seconds)) return 'Ao vivo';
    const value = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(value / 60);
    return minutes + ':' + String(value % 60).padStart(2, '0');
  }

  function lines(context, text, maxWidth, count) {
    const words = String(text || '').split(/\s+/);
    const result = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (line && context.measureText(next).width > maxWidth) {
        result.push(line);
        line = word;
      } else line = next;
    }
    if (line) result.push(line);
    const visible = result.slice(0, count);
    if (result.length > count) {
      let last = visible[count - 1];
      while (last && context.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      visible[count - 1] = last + '…';
    }
    return visible;
  }

  function surface(id, x, y, width, height, title, subtitle, action, disabled = false) {
    let item = surfaces.get(id);
    if (!item) {
      const canvas = document.createElement('canvas');
      canvas.id = 'cinema-ui-art-' + id;
      canvas.width = width < 0.3 ? 256 : 768;
      canvas.height = Math.max(48, Math.round(canvas.width * height / width));
      canvas.hidden = true;
      document.body.append(canvas);
      const plane = document.createElement('a-plane');
      plane.id = 'cinema-ui-' + id;
      plane.setAttribute('material', {
        shader: 'flat', src: '#' + canvas.id, toneMapped: false, color: '#ffffff', transparent: true,
      });
      panel.append(plane);
      item = { plane, canvas, key: '', action: null, disabled: false };
      surfaces.set(id, item);
      plane.addEventListener('click', event => {
        event.stopPropagation();
        if (item.disabled) return;
        item.action?.();
      });
      plane.addEventListener('mouseenter', () => {
        if (!item.disabled) plane.setAttribute('material', 'color', '#dbcaff');
      });
      plane.addEventListener('mouseleave', () => plane.setAttribute('material', 'color', '#ffffff'));
    }
    item.used = true;
    item.action = action;
    item.disabled = disabled || !action;
    item.plane.classList.toggle('cinema-interactive', Boolean(action) && !disabled);
    item.plane.setAttribute('visible', true);
    item.plane.setAttribute('position', { x, y, z: 0.012 });
    item.plane.setAttribute('width', width);
    item.plane.setAttribute('height', height);
    const active = id === 'tab-' + view || (id === 'tab-search' && view === 'results');
    const primary = active || id === 'play';
    const key = JSON.stringify([title, subtitle, disabled, Boolean(action), width, height, active]);
    if (item.key !== key) {
      item.key = key;
      const canvasWidth = item.canvas.width;
      const canvasHeight = Math.max(48, Math.round(canvasWidth * height / width));
      if (item.canvas.height !== canvasHeight) item.canvas.height = canvasHeight;
      const context = item.canvas.getContext('2d');
      const pixelsPerMeter = canvasWidth / width;
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.fillStyle = disabled ? '#1c1c23' : primary ? '#c2acf5' : action ? '#2b2a33' : '#19191f';
      context.beginPath();
      context.roundRect(1, 1, canvasWidth - 2, canvasHeight - 2, pixelsPerMeter * 0.012);
      context.fill();
      if (action && !primary) {
        context.strokeStyle = '#ffffff22';
        context.lineWidth = Math.max(1, canvasWidth / 380);
        context.stroke();
      }
      context.fillStyle = disabled ? '#92909c' : primary ? '#21182e' : '#f1eff7';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const fontSize = pixelsPerMeter * (action ? 0.032 : 0.027);
      context.font = '600 ' + fontSize + 'px system-ui';
      const rows = lines(context, title, canvasWidth * 0.94, subtitle ? 2 : 3);
      const lineHeight = fontSize * 1.15;
      const first = (subtitle ? canvasHeight * 0.34 : canvasHeight / 2) - (rows.length - 1) * lineHeight / 2;
      rows.forEach((line, index) => context.fillText(line, canvasWidth / 2, first + index * lineHeight));
      if (subtitle) {
        context.fillStyle = '#aaa6b6';
        context.font = pixelsPerMeter * 0.022 + 'px system-ui';
        context.fillText(lines(context, subtitle, canvasWidth * 0.92, 1)[0] || '', canvasWidth / 2, canvasHeight * 0.84);
      }
      const texture = item.plane.getObject3D('mesh')?.material.map;
      if (texture) texture.needsUpdate = true;
    }
    return item.plane;
  }

  function navigate(next) {
    view = next;
    page = 0;
    message = '';
    render();
  }

  function setOpen(value, focus = false) {
    const wasOpen = open;
    open = value;
    stage.toggleAttribute('data-cinema-controls', open);
    openButton.setAttribute('aria-expanded', String(open));
    openButton.textContent = open ? 'Fechar controles' : 'Controles';
    if (!panel) return;
    panel.setAttribute('visible', open);
    launcher?.setAttribute('visible', !open);
    launcher?.classList.toggle('cinema-interactive', !open);
    if (!cardboard && !scene.xrSession) {
      const controls = camera.components['look-controls'];
      if (controls) {
        if (open) {
          if (!wasOpen) desktopView = { yaw: controls.yawObject.rotation.y,
            pitch: controls.pitchObject.rotation.x, fov: camera.getAttribute('camera').fov };
          controls.yawObject.rotation.y = -0.52;
          controls.pitchObject.rotation.x = -0.11;
          camera.setAttribute('camera', 'fov', 62);
        } else if (desktopView) {
          controls.yawObject.rotation.y = desktopView.yaw;
          controls.pitchObject.rotation.x = desktopView.pitch;
          camera.setAttribute('camera', 'fov', desktopView.fov);
          desktopView = null;
        }
        scene.resize();
      }
    }
    if (!open && wasOpen) window.dispatchEvent(new Event('cinema-controls-closed'));
    render();
  }

  async function refresh() {
    if (polling) return;
    polling = true;
    try {
      const response = await fetch('/session-state', { cache: 'no-store' });
      if (!response.ok) return;
      state = await response.json();
      window.dispatchEvent(new CustomEvent('cinema-session-state', { detail: state }));
      if (state.notice.at > lastNotice) {
        lastNotice = state.notice.at;
        if (open) message = state.notice.text;
      }
      render();
    } catch {
      if (open) { message = 'Reconectando à sala…'; render(); }
    } finally { polling = false; }
  }

  async function run(action) {
    const blocks = action.type !== 'skip-ad';
    if (working && blocks) return;
    if (blocks) working = true;
    message = 'Aguarde…';
    render();
    try {
      const outcome = await command(action);
      message = outcome.message;
      await refresh();
      message = outcome.message;
      if (outcome.ok && ['queue-play', 'queue-next'].includes(action.type)) view = 'player';
      if (outcome.ok && action.type === 'queue-remove') view = 'queue';
    } finally {
      if (blocks) working = false;
      render();
    }
  }

  async function search() {
    if (query.trim().length < 2) { message = 'Digite algo para buscar.'; render(); return; }
    searchController?.abort();
    const request = new AbortController();
    searchController = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    view = 'results';
    page = 0;
    results = [];
    message = 'Buscando vídeos…';
    render();
    try {
      const response = await fetch('/video-search?' + new URLSearchParams({ q: query }), {
        signal: request.signal, cache: 'no-store',
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = await response.json();
      if (searchController !== request) return;
      results = payload.videos;
      message = results.length ? '' : 'Nenhum vídeo encontrado.';
    } catch (error) {
      if (searchController !== request) return;
      message = error.name === 'AbortError' ? 'A busca demorou. Tente novamente.' :
        error.message || 'A busca está indisponível.';
    } finally {
      clearTimeout(timeout);
    }
    render();
  }

  function volume(offset) {
    const slider = document.querySelector('#viewer-volume');
    slider.value = String(Math.max(0, Math.min(100, Math.round(media.volume * 100) + offset)));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    render();
  }

  function paintDock() {
    if (!dockArt) return;
    const context = dockArt.getContext('2d');
    context.fillStyle = '#17171c';
    context.fillRect(0, 0, dockArt.width, 185);
    context.fillStyle = '#292830';
    context.fillRect(22, 24, 436, 137);
    context.strokeStyle = '#c2acf5';
    context.lineWidth = 4;
    context.strokeRect(22, 24, 436, 137);
    context.fillStyle = '#f1e4ff';
    context.font = '650 48px system-ui';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('Controles', 240, 94);
    const texture = dock.getObject3D('mesh')?.material.map;
    if (texture) texture.needsUpdate = true;
  }

  function setGaze(value) {
    gazeEnabled = value;
    document.querySelector('#seat-mouse').setAttribute('raycaster', 'enabled', !value && !scene.xrSession);
    if (!value) {
      gaze.setAttribute('visible', false);
      gazeTarget?.emit('mouseleave', { cursorEl: gaze }, false);
      gazeTarget = null;
      gazeLatch = null;
    }
    render();
  }

  function renderPlayer() {
    const playback = state.playback;
    const busy = working || state.busy;
    const source = playback?.videoId || state.current?.videoId;
    const title = playback?.title || state.current?.title || 'Escolha um vídeo';
    const elapsed = playback && !playback.paused && !playback.error && !playback.ended
      ? Math.max(0, (Date.now() - playback.observedAt) / 1000) : 0;
    const position = (playback?.position || 0) + elapsed;
    const timing = playback?.isAd ? 'Anúncio do YouTube' :
      playback?.isLive ? 'Ao vivo' : clock(position) + ' / ' + clock(playback?.duration || 0);
    surface('now', 0, 0.255, 0.87, 0.115, title, timing, null);
    surface('back', -0.30, 0.135, 0.27, 0.085, '−10 s', '', () => void run({ type: 'back' }), busy || !source);
    surface('play', 0, 0.135, 0.27, 0.085, playback?.paused ? 'Reproduzir' : 'Pausar', '',
      () => void run({ type: source ? 'play' : 'queue-next' }), busy || (!source && !state.items.length));
    surface('forward', 0.30, 0.135, 0.27, 0.085, '+10 s', '', () => void run({ type: 'forward' }), busy || !source);
    surface('next', -0.225, 0.035, 0.42, 0.085, 'Próximo vídeo', '',
      () => void run({ type: 'queue-next' }), busy || !state.items.length);
    surface('retry', 0.225, 0.035, 0.42, 0.085, 'Recarregar e retomar', '',
      () => void run({ type: 'retry' }), busy || !source);
    surface('volume-down', -0.30, -0.065, 0.27, 0.085, 'Volume −', '', () => volume(-10));
    surface('mute', 0, -0.065, 0.27, 0.085,
      media.dataset.audioBlocked === 'true' || media.dataset.viewerMuted === 'true' || media.volume === 0 ? 'Ativar som' : Math.round(media.volume * 100) + '% · Silenciar',
      '', () => document.querySelector('#sound-cast').click());
    surface('volume-up', 0.30, -0.065, 0.27, 0.085, 'Volume +', '', () => volume(10));
    surface('seat-left', -0.30, -0.165, 0.27, 0.085, 'Poltrona ←', '',
      () => document.querySelector('#previous-seat').click(), document.querySelector('#previous-seat').disabled);
    surface('seat-label', 0, -0.165, 0.27, 0.085, document.querySelector('#seat-number').value, '', null);
    surface('seat-right', 0.30, -0.165, 0.27, 0.085, 'Poltrona →', '',
      () => document.querySelector('#next-seat').click(), document.querySelector('#next-seat').disabled);
    surface('light-down', -0.30, -0.265, 0.27, 0.085, 'Luz −', '', () => light(-10));
    surface('gaze', 0, -0.265, 0.27, 0.085, gazeEnabled ? 'Usar mouse' : 'Usar olhar', '',
      () => setGaze(!gazeEnabled), cardboard);
    surface('light-up', 0.30, -0.265, 0.27, 0.085, 'Luz +', '', () => light(10));
    surface('skip', -0.225, -0.365, 0.42, 0.085, 'Pular anúncio', '',
      () => void run({ type: 'skip-ad' }));
    surface('options', 0.225, -0.365, 0.42, 0.085, 'Mais controles', '', () => navigate('options'));
  }

  function light(offset) {
    const slider = document.querySelector('#light-intensity');
    slider.value = String(Math.max(0, Math.min(100, Number(slider.value) + offset)));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pagination(total, height = -0.32) {
    const pages = Math.max(1, Math.ceil(total / 4));
    page = Math.max(0, Math.min(page, pages - 1));
    surface('page-before', -0.30, height, 0.22, 0.075, '←', '', () => { page--; render(); }, page === 0);
    surface('page-number', 0, height, 0.30, 0.075, (page + 1) + ' / ' + pages, '', null);
    surface('page-next', 0.30, height, 0.22, 0.075, '→', '', () => { page++; render(); }, page === pages - 1);
  }

  function renderList(items, kind) {
    pagination(items.length);
    items.slice(page * 4, page * 4 + 4).forEach((item, index) => {
      surface('list-' + index, 0, 0.225 - index * 0.135, 0.87, 0.12, item.title,
        [item.channel, item.duration].filter(Boolean).join(' · '), () => {
          selected = item;
          selectedQueueId = kind === 'queue' ? item.id : null;
          navigate('details');
        });
    });
    if (!items.length) surface('empty', 0, 0.12, 0.87, 0.16,
      kind === 'queue' ? 'A fila está vazia' : message || 'Nenhum resultado', '',
      kind === 'queue' ? () => navigate('search') : null);
    surface('new-search', 0, -0.415, 0.87, 0.075,
      kind === 'queue' ? 'Buscar vídeos' : 'Editar pesquisa', '', () => navigate('search'));
  }

  function renderSearch() {
    surface('query', 0, 0.255, 0.87, 0.11, query || 'O que vamos assistir?', '', null);
    const keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    Array.from(keys).forEach((key, index) => {
      surface('key-' + key, -0.365 + index % 6 * 0.146, 0.15 - Math.floor(index / 6) * 0.082,
        0.13, 0.072, key, '', () => {
          if (query.length < 100) query += key.toLowerCase();
          render();
        });
    });
    surface('space', -0.30, -0.365, 0.27, 0.08, 'Espaço', '', () => {
      if (query.length < 100) query += ' ';
      render();
    });
    surface('erase', 0, -0.365, 0.27, 0.08, 'Apagar', '', () => {
      query = Array.from(query).slice(0, -1).join('');
      render();
    });
    surface('search-submit', 0.30, -0.365, 0.27, 0.08, 'Buscar', '', () => void search());
    surface('clear', 0, -0.455, 0.87, 0.065, 'Limpar pesquisa', '', () => { query = ''; render(); });
  }

  function renderDetails() {
    if (!selected) { view = 'queue'; renderList(state.items, 'queue'); return; }
    surface('details-title', 0, 0.205, 0.87, 0.19, selected.title,
      [selected.channel, selected.duration].filter(Boolean).join(' · '), null);
    const busy = working || state.busy;
    const queued = selectedQueueId && state.items.some(item => item.id === selectedQueueId);
    const selectedIndex = state.items.findIndex(item => item.id === selectedQueueId);
    surface('details-main', 0, 0.045, 0.87, 0.09, queued ? 'Assistir agora' : 'Adicionar à fila', '',
      () => void run(queued ? { type: 'queue-play', id: selectedQueueId } : { type: 'queue-add', ...selected }),
      queued ? busy : working);
    if (queued) {
      surface('move-up', -0.225, -0.065, 0.42, 0.085, 'Subir na fila', '',
        () => void run({ type: 'queue-move', id: selectedQueueId, offset: -1 }), busy || selectedIndex === 0);
      surface('move-down', 0.225, -0.065, 0.42, 0.085, 'Descer na fila', '',
        () => void run({ type: 'queue-move', id: selectedQueueId, offset: 1 }), busy || selectedIndex === state.items.length - 1);
      surface('remove', 0, -0.175, 0.87, 0.085, 'Remover da fila', '',
        () => void run({ type: 'queue-remove', id: selectedQueueId }), busy);
    }
    surface('details-back', 0, -0.32, 0.87, 0.08, 'Voltar à lista', '',
      () => navigate(selectedQueueId ? 'queue' : 'results'));
  }
  function renderOptions() {
    const busy = working || state.busy;
    const source = state.playback?.videoId || state.current?.videoId;
    surface('restart', 0, 0.245, 0.87, 0.09, 'Voltar ao início do vídeo', '',
      () => void run({ type: 'restart' }), busy || !source);
    surface('audio', 0, 0.135, 0.87, 0.09, 'Usar áudio original', '',
      () => void run({ type: 'original-audio' }), busy || !source);
    surface('light-label', 0, 0.025, 0.87, 0.075, 'Cor da sua iluminação', '', null);
    const colors = [
      ['Roxa', '#c4a4ff'], ['Azul', '#8ebcff'], ['Âmbar', '#ffd094'],
      ['Branca', '#eee7ff'], ['Verde', '#98dfb6'], ['Vermelha', '#ff9caa'],
    ];
    colors.forEach(([name, color], index) => {
      surface('color-' + index, -0.30 + index % 3 * 0.30, -0.065 - Math.floor(index / 3) * 0.10,
        0.27, 0.085, name, '', () => {
          const input = document.querySelector('#light-color');
          input.value = color;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
    surface('options-back', 0, -0.32, 0.87, 0.085, 'Voltar ao player', '', () => navigate('player'));
  }

  function render() {
    if (!panel) return;
    for (const item of surfaces.values()) item.used = false;
    if (open) {
      surface('tab-player', -0.3375, 0.415, 0.205, 0.08, 'Player', '', () => navigate('player'));
      surface('tab-queue', -0.1125, 0.415, 0.205, 0.08, 'Fila · ' + state.items.length, '', () => navigate('queue'));
      surface('tab-search', 0.1125, 0.415, 0.205, 0.08, 'Pesquisar', '', () => navigate('search'));
      surface('tab-options', 0.3375, 0.415, 0.205, 0.08, 'Opções', '', () => navigate('options'));
      if (view === 'player') renderPlayer();
      if (view === 'queue') renderList(state.items, 'queue');
      if (view === 'results') renderList(results, 'results');
      if (view === 'search') renderSearch();
      if (view === 'details') renderDetails();
      if (view === 'options') renderOptions();
      surface('message', 0, -0.545, 0.87, 0.065, message || (gazeEnabled ? 'Olhe por um instante para selecionar' : 'Clique para selecionar'), '', null);
      surface('close', 0, -0.63, 0.87, 0.075, cardboard ? 'Voltar ao filme' : 'Fechar controles', '',
        () => setOpen(false));
      if (cardboard) surface('exit-cardboard', 0, -0.72, 0.87, 0.065, 'Sair do Cardboard', '', () => void toggleCardboard());
      else surface('enter-cardboard', 0, -0.72, 0.87, 0.065, 'Modo Cardboard', '',
        () => void toggleCardboard(), Boolean(scene.xrSession));
    }
    for (const item of surfaces.values()) {
      if (!item.used) {
        item.plane.setAttribute('visible', false);
        item.plane.classList.remove('cinema-interactive');
      }
    }
    paintDock();
    for (const element of [gaze, document.querySelector('#seat-mouse'), ...document.querySelectorAll('.seat-pointer')]) {
      element?.components.raycaster?.refreshObjects();
    }
  }

  function stopStereo() {
    cardboard = false;
    if (originalRender) scene.renderer.render = originalRender;
    originalRender = null;
    scene.renderer.setPixelRatio(previousPixelRatio);
    camera.setAttribute('camera', 'fov', previousFov);
    camera.setAttribute('look-controls', 'magicWindowTrackingEnabled', false);
    stage.removeAttribute('data-cardboard');
    cardboardButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="/icons.svg#headset"/></svg>Entrar em VR';
    setGaze(false);
    setOpen(false);
    scene.resize();
  }

  async function toggleCardboard() {
    if (cardboard) {
      stopStereo();
      if (!alreadyFullscreen && document.fullscreenElement === stage) await document.exitFullscreen();
      return;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Permita o movimento do celular para usar o Cardboard.');
      }
      alreadyFullscreen = document.fullscreenElement === stage;
      // Some mobile and embedded browsers refuse native fullscreen. The fixed
      // stage still provides a usable stereo view inside the browser viewport.
      if (!alreadyFullscreen && stage.requestFullscreen) await stage.requestFullscreen().catch(() => {});
      if (screen.orientation?.lock) await screen.orientation.lock('landscape').catch(() => {});
      setOpen(false);
      cardboard = true;
      previousFov = camera.getAttribute('camera').fov;
      previousPixelRatio = scene.renderer.getPixelRatio();
      camera.setAttribute('camera', 'fov', 75);
      camera.setAttribute('look-controls', 'magicWindowTrackingEnabled', true);
      const permissionUI = scene.components['device-orientation-permission-ui'];
      if (permissionUI) permissionUI.permissionGranted = true;
      scene.emit('deviceorientationpermissiongranted');
      scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      stereo = new AFRAME.THREE.StereoCamera();
      stereo.aspect = 0.5;
      const renderer = scene.renderer;
      const size = new AFRAME.THREE.Vector2();
      const viewport = new AFRAME.THREE.Vector4();
      const scissor = new AFRAME.THREE.Vector4();
      originalRender = renderer.render;
      renderer.render = function(renderScene, renderCamera) {
        if (!cardboard || renderScene !== scene.object3D || renderCamera !== scene.camera || renderer.xr.isPresenting) {
          return originalRender.call(renderer, renderScene, renderCamera);
        }
        renderScene.updateMatrixWorld();
        renderCamera.updateMatrixWorld();
        stereo.update(renderCamera);
        renderer.getSize(size);
        renderer.getViewport(viewport);
        renderer.getScissor(scissor);
        const previousScissor = renderer.getScissorTest();
        const previousClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setScissorTest(false);
        renderer.clear();
        renderer.setScissorTest(true);
        const halfWidth = Math.floor(size.x / 2);
        renderer.setViewport(0, 0, halfWidth, size.y);
        renderer.setScissor(0, 0, halfWidth, size.y);
        originalRender.call(renderer, renderScene, stereo.cameraL);
        renderer.setViewport(halfWidth, 0, size.x - halfWidth, size.y);
        renderer.setScissor(halfWidth, 0, size.x - halfWidth, size.y);
        originalRender.call(renderer, renderScene, stereo.cameraR);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(previousScissor);
        renderer.autoClear = previousClear;
      };
      stage.setAttribute('data-cardboard', '');
      cardboardButton.textContent = 'Sair do VR';
      setGaze(true);
      setOpen(false);
      scene.resize();
    } catch (error) {
      if (cardboard) stopStereo();
      status.textContent = error.message || 'Não foi possível abrir o modo Cardboard.';
    }
  }

  function initialize() {
    panel = document.createElement('a-entity');
    panel.id = 'cinema-control-panel';
    panel.setAttribute('position', '0.78 -0.08 -1.18');
    panel.setAttribute('rotation', '-5 -33 0');
    panel.setAttribute('visible', false);
    rig.append(panel);
    const launcherArt = document.createElement('canvas');
    launcherArt.id = 'cinema-launcher-art';
    launcherArt.width = 480;
    launcherArt.height = 160;
    launcherArt.hidden = true;
    document.body.append(launcherArt);
    const launcherContext = launcherArt.getContext('2d');
    launcherContext.fillStyle = '#292830';
    launcherContext.fillRect(0, 0, 480, 160);
    launcherContext.strokeStyle = '#c2acf5';
    launcherContext.lineWidth = 8;
    launcherContext.strokeRect(4, 4, 472, 152);
    launcherContext.fillStyle = '#f3e6ff';
    launcherContext.font = '650 60px system-ui';
    launcherContext.textAlign = 'center';
    launcherContext.textBaseline = 'middle';
    launcherContext.fillText('Controles', 240, 80);
    launcher = document.createElement('a-plane');
    launcher.id = 'cinema-controls-launcher';
    launcher.classList.add('cinema-interactive');
    launcher.setAttribute('position', '0.43 -0.55 -0.65');
    launcher.setAttribute('rotation', '-35 -33 0');
    launcher.setAttribute('width', 0.24);
    launcher.setAttribute('height', 0.08);
    launcher.setAttribute('material', 'shader: flat; src: #cinema-launcher-art; toneMapped: false');
    launcher.addEventListener('click', () => setOpen(true));
    rig.append(launcher);
    const background = document.createElement('a-box');
    background.setAttribute('position', '0 -0.13 -0.01');
    background.setAttribute('width', 0.96);
    background.setAttribute('height', 1.45);
    background.setAttribute('depth', 0.018);
    background.setAttribute('material', 'shader: flat; color: #141418');
    panel.append(background);

    const targets = '.cinema-interactive, #seat-panel';
    document.querySelector('#seat-mouse').setAttribute('raycaster', { objects: targets, far: 2.5, autoRefresh: false });
    for (const pointer of document.querySelectorAll('.seat-pointer')) {
      pointer.setAttribute('raycaster', { objects: targets, far: 2.5, autoRefresh: false });
    }
    gaze = document.createElement('a-entity');
    gaze.id = 'cinema-gaze';
    gaze.setAttribute('position', '0 0 -0.6');
    gaze.setAttribute('geometry', 'primitive: ring; radiusInner: 0.004; radiusOuter: 0.006');
    gaze.setAttribute('material', 'color: #f0dfff; shader: flat; depthTest: false; opacity: 0.95');
    gaze.setAttribute('visible', false);
    camera.append(gaze);
    const gazeRay = new AFRAME.THREE.Raycaster();
    gazeRay.far = 2.5;
    const eye = new AFRAME.THREE.Vector3();
    const direction = new AFRAME.THREE.Vector3();
    setInterval(() => {
      if (!gazeEnabled) return;
      scene.camera.getWorldPosition(eye);
      scene.camera.getWorldDirection(direction);
      gazeRay.set(eye, direction);
      // Keep disabled buttons in the geometry query so a pending command cannot
      // rearm itself when its button becomes available again.
      const elements = [launcher, dock, ...Array.from(surfaces.values(), item => item.plane)];
      const meshes = elements.flatMap(element => {
        const mesh = element.getObject3D('mesh');
        if (!mesh) return [];
        for (let object = mesh; object; object = object.parent) if (!object.visible) return [];
        return [mesh];
      });
      const intersection = gazeRay.intersectObjects(meshes, false)[0];
      const target = intersection?.object.el || null;
      const now = performance.now();
      if (target !== gazeTarget) {
        gazeTarget?.emit('mouseleave', { cursorEl: gaze }, false);
        gazeTarget = target;
        gazeLatch = null;
        gazeStarted = now;
        target?.emit('mouseenter', { cursorEl: gaze, intersection }, false);
      }
      const interactive = target?.matches('.cinema-interactive, #seat-panel');
      gaze.setAttribute('visible', Boolean(interactive));
      if (intersection) gaze.object3D.position.z = -Math.max(0.1, intersection.distance - 0.01);
      if (!interactive || gazeLatch === target) return;
      const progress = Math.min(1, (now - gazeStarted) / 1100);
      gaze.object3D.scale.setScalar(1 - 0.75 * progress);
      if (progress < 1) return;
      gazeLatch = target;
      target.emit('click', { cursorEl: gaze, intersection }, false);
    }, 50);
    dock.addEventListener('click', event => {
      const uv = event.detail?.intersection?.uv;
      if (uv && (1 - uv.y) * dockArt.height < 180) setOpen(!open);
    });
    new MutationObserver(() => { paintDock(); render(); })
      .observe(document.querySelector('#seat-number'), { childList: true, characterData: true, subtree: true });
    new ResizeObserver(() => { if (cardboard) camera.setAttribute('camera', 'fov', 75); })
      .observe(stage.querySelector('.scene'));
    scene.addEventListener('enter-vr', () => { if (!scene.xrSession?.inputSources.length) setGaze(true); });
    scene.addEventListener('exit-vr', () => setGaze(false));
    document.addEventListener('fullscreenchange', () => {
      if (cardboard && document.fullscreenElement !== stage) stopStereo();
    });
    document.addEventListener('keydown', event => {
      if (cardboard && event.key === 'Escape') {
        event.preventDefault();
        void toggleCardboard();
        return;
      }
      if (!open || view !== 'search' || /INPUT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter') { event.preventDefault(); void search(); }
      else if (event.key === 'Backspace') { event.preventDefault(); query = Array.from(query).slice(0, -1).join(''); render(); }
      else if (/^[\p{L}\p{N} ]$/u.test(event.key) && query.length < 100) {
        event.preventDefault(); query += event.key; render();
      }
    });
    media.addEventListener('volumechange', render);
    media.addEventListener('cinema-audio-state', render);
    setInterval(() => { if (open && view === 'player') render(); }, 1000);
    setInterval(() => void refresh(), 2000);
    void refresh();
    paintDock();
    document.querySelector('#seat-help').textContent =
      'No Cardboard, mantenha o olhar em um botão para selecionar. Você também pode usar o mouse na prévia.';
  }

  if (scene.hasLoaded) initialize();
  else scene.addEventListener('loaded', initialize, { once: true });
}
