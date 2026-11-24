import { mountCinemaControls } from './vr-controls.js';
import { connectCinema } from './cinema-connection.js';

const $ = selector => document.querySelector(selector);
const media = $('#test-media');
const status = $('#live-status');
const connection = connectCinema({ media, screen: $('#screen'), poster: $('#screen-idle'),
  join: $('#join-cast'), sound: $('#sound-cast'), status });
let state = { items: [], history: [], current: null, playback: null, busy: false };
let pending = 0;
let queueKey = '';
let historyKey = '';
let searchRequest;
const icon = name => '<svg class="icon" aria-hidden="true"><use href="/icons.svg#' + name + '"/></svg>';
const clock = value => {
  if (!Number.isFinite(value)) return 'Ao vivo';
  const seconds = Math.max(0, Math.floor(value));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
};
function openDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
for (const button of document.querySelectorAll('[data-close-dialog]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
}
$('#open-settings').addEventListener('click', () => openDialog('#settings-dialog'));
$('#show-help').addEventListener('click', () => openDialog('#help-dialog'));
$('#choose-seat').addEventListener('click', () => { paintSeats(); openDialog('#seat-dialog'); });
for (const button of document.querySelectorAll('#add-video,[data-open-add]')) {
  button.addEventListener('click', () => openDialog('#add-dialog'));
}
$('#invite-room').addEventListener('click', () => {
  $('#invite-url').value = location.origin + '/cinema';
  $('#invite-status').textContent = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
    ? 'Este endereço funciona só neste computador. Para convidar amigos, abra o cinema pelo endereço compartilhado do servidor.'
    : '';
  openDialog('#invite-dialog');
});
$('#copy-invite').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#invite-url').value);
    $('#invite-status').textContent = 'Link copiado. Pode chamar a turma.';
  } catch {
    $('#invite-url').select();
    $('#invite-status').textContent = 'Selecione e copie o endereço acima.';
  }
});
function selectTab(link) {
  $('#search-tab').setAttribute('aria-selected', String(!link));
  $('#link-tab').setAttribute('aria-selected', String(link));
  $('#search-panel').hidden = link;
  $('#link-panel').hidden = !link;
  (link ? $('#video-url') : $('#video-query')).focus();
  $('#dialog-status').textContent = '';
}
$('#search-tab').addEventListener('click', () => selectTab(false));
$('#link-tab').addEventListener('click', () => selectTab(true));
$('.segmented').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  selectTab(event.key === 'ArrowRight');
});
function applyState(next) { state = next; paint(); paintQueue(); }
async function refresh() {
  try {
    const response = await fetch('/session-state', { cache: 'no-store' });
    if (response.ok) applyState(await response.json());
  } catch {}
}
async function sendControl(action) {
  connection.ensureConnected();
  connection.activateSound();
  const blocks = !['queue-add', 'queue-remove', 'queue-move', 'skip-ad'].includes(action.type);
  if (blocks) pending++;
  paint();
  const message = ['open', 'queue-play', 'queue-next'].includes(action.type) ? 'Preparando o próximo vídeo…' : 'Aguarde…';
  status.textContent = message;
  if ($('#add-dialog').open) $('#dialog-status').textContent = message;
  try {
    const response = await fetch('/remote-control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action), signal: AbortSignal.timeout(180000),
    });
    const message = await response.text();
    status.textContent = message;
    if ($('#add-dialog').open) $('#dialog-status').textContent = message;
    await refresh();
    return { ok: response.ok, message };
  } catch {
    const message = 'Não foi possível enviar o comando. Confira a conexão com a sala.';
    status.textContent = message;
    if ($('#add-dialog').open) $('#dialog-status').textContent = message;
    return { ok: false, message };
  } finally {
    if (blocks) pending--;
    paint();
  }
}
for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => {
    button.closest('details')?.removeAttribute('open');
    void sendControl({ type: button.dataset.command });
  });
}
$('#video-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await sendControl({ type: 'queue-add', url: $('#video-url').value });
  if (result.ok) { $('#video-url').value = ''; $('#add-dialog').close(); }
});
$('#open-video-now').addEventListener('click', async () => {
  if (!$('#video-url').reportValidity()) return;
  const result = await sendControl({ type: 'open', url: $('#video-url').value });
  if (result.ok) $('#add-dialog').close();
});
function thumbnail(video, className) {
  const image = document.createElement('img');
  image.className = className || '';
  image.alt = '';
  image.loading = 'lazy';
  if (/^[a-zA-Z0-9_-]{11}$/.test(video.videoId)) image.src = 'https://i.ytimg.com/vi/' + video.videoId + '/mqdefault.jpg';
  return image;
}
function actionButton(label, symbol, action) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'icon-button';
  button.setAttribute('aria-label', label); button.title = label;
  button.innerHTML = icon(symbol);
  button.addEventListener('click', action);
  return button;
}
$('#search-form').addEventListener('submit', async event => {
  event.preventDefault();
  searchRequest?.abort();
  const controller = new AbortController();
  searchRequest = controller;
  const timer = setTimeout(() => controller.abort(), 15000);
  $('#search-results').replaceChildren();
  $('#dialog-status').textContent = 'Buscando vídeos…';
  try {
    const response = await fetch('/video-search?' + new URLSearchParams({ q: $('#video-query').value }), { signal: controller.signal });
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    if (searchRequest !== controller) return;
    $('#dialog-status').textContent = data.videos.length ? '' : 'Nenhum vídeo encontrado. Tente outra busca.';
    for (const video of data.videos) {
      const row = document.createElement('article'); row.className = 'search-result';
      const info = document.createElement('div');
      const title = document.createElement('h3'); title.textContent = video.title;
      const caption = document.createElement('p'); caption.textContent = [video.channel, video.duration].filter(Boolean).join(' · ');
      info.append(title, caption);
      const add = actionButton('Adicionar ' + video.title + ' à fila', 'plus', async () => {
        add.disabled = true;
        const result = await sendControl({ type: 'queue-add', ...video });
        if (result.ok) { add.dataset.added = ''; add.innerHTML = icon('check'); add.setAttribute('aria-label', 'Adicionado à fila'); }
        else add.disabled = false;
      });
      row.append(thumbnail(video), info, add);
      $('#search-results').append(row);
    }
  } catch (error) {
    if (searchRequest !== controller) return;
    $('#dialog-status').textContent = error.name === 'AbortError' ? 'A busca demorou. Tente novamente.' : error.message;
  } finally { clearTimeout(timer); }
});
function paintQueue() {
  $('#queue-count').textContent = state.items.length;
  $('#queue-empty').hidden = state.items.length > 0;
  const key = JSON.stringify(state.items);
  if (key !== queueKey) {
    queueKey = key;
    $('#queue-list').replaceChildren();
    for (const [index, video] of state.items.entries()) {
      const row = document.createElement('li');
      const info = document.createElement('div'); info.className = 'queue-info';
      const title = document.createElement('strong'); title.textContent = video.title;
      const caption = document.createElement('span'); caption.textContent = [video.channel, video.duration].filter(Boolean).join(' · ') || 'YouTube';
      info.append(title, caption);
      const more = document.createElement('details'); more.className = 'room-more';
      more.innerHTML = '<summary class="icon-button" aria-label="Opções do vídeo">' + icon('more') + '</summary><div class="more-menu"></div>';
      const menu = more.querySelector('div');
      const actions = [['Reproduzir agora', { type: 'queue-play', id: video.id }],
        ...(index > 0 ? [['Subir na fila', { type: 'queue-move', id: video.id, offset: -1 }]] : []),
        ...(index < state.items.length - 1 ? [['Descer na fila', { type: 'queue-move', id: video.id, offset: 1 }]] : []),
        ['Remover da fila', { type: 'queue-remove', id: video.id }]];
      for (const [label, action] of actions) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', () => { more.open = false; void sendControl(action); });
        menu.append(button);
      }
      row.append(thumbnail(video, 'queue-thumb'), info, more);
      $('#queue-list').append(row);
    }
  }
  const history = state.history?.slice(0, 3) || [];
  const recentKey = JSON.stringify(history);
  if (recentKey !== historyKey) {
    historyKey = recentKey;
    $('#recent-section').hidden = !history.length;
    $('#recent-list').replaceChildren();
    for (const video of history) {
      const row = document.createElement('div'); row.className = 'recent-item';
      const title = document.createElement('span'); title.textContent = video.title;
      row.append(thumbnail(video), title, actionButton('Adicionar ' + video.title + ' novamente', 'plus', () => void sendControl({ type: 'queue-add', ...video })));
      $('#recent-list').append(row);
    }
  }
}
function paintSeats() {
  const seats = window.cinemaSeats;
  if (!seats) return;
  $('#seat-label').textContent = 'Poltrona ' + seats.list[seats.current].label;
  if (!$('#seat-map').children.length) for (const [index, seat] of seats.list.entries()) {
    const button = document.createElement('button'); button.type = 'button';
    button.innerHTML = icon('seat') + '<span></span>';
    button.querySelector('span').textContent = seat.label;
    button.setAttribute('aria-label', 'Sentar na poltrona ' + seat.label);
    button.addEventListener('click', () => { seats.select(index); $('#seat-dialog').close(); paintSeats(); });
    $('#seat-map').append(button);
  }
  Array.from($('#seat-map').children).forEach((button, index) => button.setAttribute('aria-pressed', String(index === seats.current)));
}
function paint() {
  const source = state.playback?.videoId || state.current?.videoId;
  const busy = Boolean(pending || state.busy);
  for (const button of document.querySelectorAll('[data-command]')) {
    button.disabled = button.dataset.command === 'skip-ad' ? false : busy ||
      (button.dataset.command === 'queue-next' ? !state.items.length : !source);
  }
  $('#open-video-now').disabled = busy;
  $('#now-title').textContent = state.playback?.title || state.current?.title || 'O telão está pronto.';
  $('.source-label').textContent = state.playback?.isAd ? 'Anúncio do YouTube' : source ? 'Em exibição · YouTube' : 'Seu cinema privado';
  const paused = state.playback?.paused !== false;
  const play = document.querySelector('[data-command=play]');
  play.setAttribute('aria-label', paused ? 'Reproduzir vídeo' : 'Pausar vídeo');
  $('#play-icon').setAttribute('href', '/icons.svg#' + (paused ? 'play' : 'pause'));
  const playback = state.playback;
  const elapsed = playback && !playback.paused && !playback.error && !playback.ended ? Math.max(0, (Date.now() - playback.observedAt) / 1000) : 0;
  const position = (playback?.position || 0) + elapsed;
  const percent = playback?.duration ? Math.min(100, position / playback.duration * 100) : 0;
  $('#elapsed-time').textContent = clock(position);
  $('#duration-time').textContent = playback?.isLive ? 'Ao vivo' : clock(playback?.duration || 0);
  $('#playback-progress').setAttribute('aria-valuenow', Math.round(percent));
  $('#playback-progress span').style.width = percent + '%';
  const diagnostics = window.nekoCheck?.();
  const connected = Boolean(diagnostics?.connected && diagnostics.tracks?.some(track => track.kind === 'video' && track.state === 'live'));
  $('#connection-indicator').dataset.connected = String(connected);
  $('#connection-label').textContent = connected ? 'Na sala' : 'Conectando à sala';
  paintSeats();
}
$('#viewer-volume').addEventListener('input', event => { media.volume = Number(event.target.value) / 100; });
media.addEventListener('volumechange', () => {
  $('#viewer-volume').value = String(Math.round(media.volume * 100));
  $('#viewer-volume-level').value = Math.round(media.volume * 100) + '%';
});
window.addEventListener('cinema-session-state', event => applyState(event.detail));
window.addEventListener('cinema-seat-change', paintSeats);
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select') || document.querySelector('dialog[open]')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); openDialog('#add-dialog');
  }
});
mountCinemaControls({ command: sendControl });
setInterval(paint, 1000);
void refresh();
