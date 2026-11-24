import { receiveCast } from './cast-viewer.js';

const scene = document.querySelector('a-scene');
const fileInput = document.querySelector('#video-file');
const video = document.querySelector('#test-media');
const screen = document.querySelector('#screen');
const surface = document.querySelector('#screen-surface');
const idleScreen = document.querySelector('#screen-idle');
const play = document.querySelector('#play');
const enterVR = document.querySelector('#enter-vr');
const stage = document.querySelector('#cinema-stage');
const viewport = stage.querySelector('.scene');
const fullscreen = document.querySelector('#fullscreen');
const spectator = document.querySelector('#spectator');
const seatRig = document.querySelector('#seat-rig');
const seatPanel = document.querySelector('#seat-panel');
const seatPanelArt = document.querySelector('#seat-panel-art');
const seatMouse = document.querySelector('#seat-mouse');
const seatPointers = document.querySelectorAll('.seat-pointer');
const seatPreview = document.querySelector('.seat-preview');
const seatPreviewHome = seatPreview.parentElement;
const previousSeat = document.querySelector('#previous-seat');
const nextSeat = document.querySelector('#next-seat');
const seatNumber = document.querySelector('#seat-number');
const mediaStatus = document.querySelector('#media-status');
const xrStatus = document.querySelector('#xr-status');
const roomAmbient = document.querySelector('#room-ambient');
const roomAccent = document.querySelector('#room-accent');
const lightColor = document.querySelector('#light-color');
const lightIntensity = document.querySelector('#light-intensity');
const lightLevel = document.querySelector('#light-level');
const cinemaLive = document.querySelector('#cinema-live');
const joinCast = document.querySelector('#join-cast');
const soundCast = document.querySelector('#sound-cast');
const leaveCast = document.querySelector('#leave-cast');
const liveStatus = document.querySelector('#live-status');
const accentStrips = [];
const metalFinishes = [];
const seatLocations = [
  [-1.5, 0.035, -0.25], [0, 0.035, -0.25], [1.5, 0.035, -0.25],
  [-1.5, 0.6, 1.9], [0, 0.6, 1.9], [1.5, 0.6, 1.9],
];
const seatLabels = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
const seatCenters = seatLocations.map(seat => seat[0]);
const seatButtons = [
  { offset: -1, x: 36, arrow: '←' },
  { offset: 1, x: 254, arrow: '→' },
];
const seatButtonTop = 195;
const seatButtonWidth = 190;
const seatButtonHeight = 160;
let currentSeat = 4;
let videoUrl;
let disconnectCast;
let seatControlsTimeout;

function makeBox(position, [width, height, depth], color, flat = false) {
  const box = document.createElement('a-box');
  box.setAttribute('position', position.join(' '));
  box.setAttribute('width', width);
  box.setAttribute('height', height);
  box.setAttribute('depth', depth);
  box.setAttribute('material', 'color: ' + color + (flat ? '; shader: flat' : ''));
  return box;
}

function makeAccentStrip(position, dimensions) {
  const strip = makeBox(position, dimensions, '#735c97', true);
  accentStrips.push(strip);
  return strip;
}

function makeMetalBox(position, dimensions, color) {
  const box = makeBox(position, dimensions, color);
  box.classList.add('brushed-metal');
  box.setAttribute('material', 'color: ' + color + '; metalness: 0.78; roughness: 0.66');
  return box;
}

function furnishCinema() {
  const furnishings = document.querySelector('#cinema-furnishings');
  furnishings.dataset.seats = '6';
  for (const side of [-1, 1]) {
    furnishings.append(
      makeBox([side * 3.73, 0.10, -0.75], [0.055, 0.16, 8.15], '#34271f'),
      makeBox([side * 3.67, 0.07, -0.75], [0.018, 0.012, 8.08], '#ad8152', true),
      makeAccentStrip([side * 3.53, 3.44, -0.75], [0.025, 0.012, 7.72]),
      makeMetalBox([side * 3.6, 3.48, -0.75], [0.18, 0.12, 8.15], '#24211e'),
    );
    for (const depth of [-3.73, -1.65, 0.43, 2.51]) {
      const panel = makeBox([side * 3.74, 1.97, depth], [0.12, 1.83, 1.8], '#252325');
      panel.setAttribute('material', 'color: #252325; roughness: 1');
      furnishings.append(panel);
      const trim = makeMetalBox([side * 3.66, 1.04, depth], [0.025, 0.016, 1.8], '#8b7150');
      furnishings.append(trim);
    }
    furnishings.append(
      makeBox([side * 3.2, 0.1, 0.2], [0.85, 0.2, 0.3], '#242124'),
      makeBox([side * 3.2, 0.2, 0.5], [0.85, 0.4, 0.3], '#242124'),
      makeBox([side * 3.2, 0.202, 0.05], [0.78, 0.012, 0.02], '#a98055', true),
      makeBox([side * 3.2, 0.402, 0.35], [0.78, 0.012, 0.02], '#a98055', true),
      makeBox([side * 3.18, 1.58, -4.91], [0.35, 1.22, 0.19], '#111111'),
    );
  }
  furnishings.append(
    makeBox([0, 3.52, -0.75], [6.9, 0.12, 7.6], '#191718'),
    makeBox([0, 0.598, 0.754], [7.27, 0.014, 0.014], '#ac8151', true),
    makeMetalBox([0, 3.15, 2.84], [0.49, 0.20, 0.36], '#373434'),
    makeBox([0, 3.035, 2.62], [0.065, 0.04, 0.01], '#b4b5b6', true),
    makeBox([2.76, 1.47, 3.355], [0.92, 2.34, 0.04], '#201c1a'),
    makeMetalBox([2.40, 1.35, 3.315], [0.028, 0.19, 0.028], '#b09a75'),
  );
  for (const x of [-2.2, -1.1, 0, 1.1, 2.2]) {
    const panel = makeBox([x, 1.9, 3.35], [0.96, 1.76, 0.1], '#242121');
    furnishings.append(panel);
  }
}

function cushionGeometry(width, height, depth, radius) {
  const { BoxGeometry, Vector3 } = AFRAME.THREE;
  const segments = 5;
  const geometry = new BoxGeometry(2, 2, 2, segments, segments, segments);
  const { position, normal, uv } = geometry.attributes;
  const core = new Vector3(width, height, depth).multiplyScalar(0.5).subScalar(radius);
  const outward = new Vector3();
  const vertex = new Vector3();

  // Round each face outward from an inset box while keeping the padded faces broad.
  for (let index = 0; index < position.count; index++) {
    vertex.fromBufferAttribute(position, index);
    const xSide = Math.sign(vertex.x);
    const ySide = Math.sign(vertex.y);
    const zSide = Math.sign(vertex.z);
    outward.set(vertex.x - xSide / segments, vertex.y - ySide / segments, vertex.z - zSide / segments).normalize();
    vertex.set(xSide * core.x, ySide * core.y, zSide * core.z).addScaledVector(outward, radius);
    const u = normal.getX(index) ? vertex.z : vertex.x;
    const v = normal.getY(index) ? vertex.z : vertex.y;
    uv.setXY(index, u / 0.52, v / 0.52);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    normal.setXYZ(index, outward.x, outward.y, outward.z);
  }
  return geometry;
}

function stitchGeometry(width, depth, radius) {
  const { CatmullRomCurve3, Path, TubeGeometry, Vector3 } = AFRAME.THREE;
  const x = width / 2;
  const z = depth / 2;
  const path = new Path();
  path.moveTo(-x + radius, -z);
  path.lineTo(x - radius, -z);
  path.quadraticCurveTo(x, -z, x, -z + radius);
  path.lineTo(x, z - radius);
  path.quadraticCurveTo(x, z, x - radius, z);
  path.lineTo(-x + radius, z);
  path.quadraticCurveTo(-x, z, -x, z - radius);
  path.lineTo(-x, -z + radius);
  path.quadraticCurveTo(-x, -z, -x + radius, -z);
  const points = path.getSpacedPoints(36).slice(0, -1).map(point => new Vector3(point.x, 0, point.y));
  return new TubeGeometry(new CatmullRomCurve3(points, true), 40, 0.003, 4, true);
}

function makeUpholstery(reflectionMap) {
  const { MeshStandardMaterial, Vector2 } = AFRAME.THREE;
  return new MeshStandardMaterial({
    color: '#756353', map: loadSurface('brown_leather-color.jpg', true),
    normalMap: loadSurface('brown_leather-normal.jpg'), normalScale: new Vector2(0.35, 0.35),
    roughnessMap: loadSurface('brown_leather-roughness.jpg'), roughness: 0.78,
    envMap: reflectionMap, envMapIntensity: 0.45,
  });
}

function loadSurface(file, color = false) {
  const { TextureLoader, RepeatWrapping, SRGBColorSpace } = AFRAME.THREE;
  const texture = new TextureLoader().load('/assets/' + file);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = Math.min(4, scene.renderer.capabilities.getMaxAnisotropy());
  if (color) texture.colorSpace = SRGBColorSpace;
  return texture;
}

function setupSeats(reflectionMap) {
  const { CylinderGeometry, Group, InstancedMesh, MeshStandardMaterial, Object3D, TorusGeometry } = AFRAME.THREE;
  const fabric = makeUpholstery(reflectionMap);
  const shell = new MeshStandardMaterial({ color: '#241c17', roughness: 0.64, envMap: reflectionMap, envMapIntensity: 0.3 });
  const hardware = new MeshStandardMaterial({ color: '#201b26', roughness: 0.45, envMap: reflectionMap, envMapIntensity: 0.4 });
  const thread = new MeshStandardMaterial({ color: '#624b37', roughness: 0.96 });
  const tilt = 0.14;
  const parts = [
    ['pedestal', cushionGeometry(0.49, 0.31, 0.52, 0.06), hardware, [0, 0.155, 0.08]],
    ['back-shell', cushionGeometry(0.85, 1.02, 0.23, 0.085), shell, [0, 0.68, 0.41], tilt],
    ['back-cushion', cushionGeometry(0.72, 0.62, 0.2, 0.095), fabric, [0, 0.67, 0.28], tilt],
    ['headrest', cushionGeometry(0.77, 0.31, 0.26, 0.105), fabric, [0, 1.07, 0.41], tilt],
    ['seat-cushion', cushionGeometry(0.78, 0.23, 0.81, 0.105), fabric, [0, 0.44, 0.015]],
    ['leg-rest', cushionGeometry(0.71, 0.14, 0.55, 0.065), fabric, [0, 0.27, -0.57], -0.27],
    ['seat-stitch', stitchGeometry(0.55, 0.58, 0.095), thread, [0, 0.556, 0.015]],
    ['back-stitch', stitchGeometry(0.64, 0.79, 0.09), thread, [0, 0.664, 0.525], tilt - Math.PI / 2],
    ['cup-rim', new TorusGeometry(0.049, 0.007, 6, 20), hardware, [0.48, 0.633, -0.10], -Math.PI / 2],
    ['cup-well', new CylinderGeometry(0.044, 0.044, 0.003, 20), hardware, [0.48, 0.632, -0.10]],
  ];
  const arm = cushionGeometry(0.14, 0.37, 0.62, 0.055);
  const armPad = cushionGeometry(0.16, 0.09, 0.71, 0.04);
  for (const x of [-0.48, 0.48]) {
    parts.push(['arm-support', arm, shell, [x, 0.37, 0.035]], ['arm-pad', armPad, fabric, [x, 0.585, 0.015]]);
  }

  const seats = new Group();
  const transform = new Object3D();
  // Draw matching parts together across all rows.
  for (const [name, geometry, material, [dx, dy, dz], rotation = 0] of parts) {
    const copies = new InstancedMesh(geometry, material, seatLocations.length);
    copies.name = name;
    seatLocations.forEach(([x, floor, row], index) => {
      const yaw = Math.atan2(x, row + 4.95);
      transform.rotation.set(rotation, yaw, 0, 'YXZ');
      transform.position.set(x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
        floor + dy, row - dx * Math.sin(yaw) + dz * Math.cos(yaw));
      transform.updateMatrix();
      copies.setMatrixAt(index, transform.matrix);
    });
    seats.add(copies);
  }
  document.querySelector('#cinema-furnishings').setObject3D('seats', seats);
  setupRoomDetails(reflectionMap);
}

function setupRoomDetails(reflectionMap) {
  const { BoxGeometry, CanvasTexture, Group, InstancedMesh, Mesh, MeshBasicMaterial,
    MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, TorusGeometry } = AFRAME.THREE;
  const group = new Group();
  const wood = new MeshStandardMaterial({ color: '#74604e', map: loadSurface('wood_table_001-color.jpg', true),
    normalMap: loadSurface('wood_table_001-normal.jpg'), roughnessMap: loadSurface('wood_table_001-roughness.jpg'),
    roughness: 0.8, envMap: reflectionMap, envMapIntensity: 0.3 });
  const slats = new InstancedMesh(new BoxGeometry(0.05, 0.95, 0.065), wood, 120);
  const transform = new Object3D();
  let index = 0;
  for (const side of [-1, 1]) for (let step = 0; step < 60; step++) {
    const z = -4.7 + step * 0.13;
    transform.position.set(side * 3.75, 0.56, z); transform.updateMatrix();
    slats.setMatrixAt(index++, transform.matrix);
  }
  slats.count = index;
  group.add(slats);
  const downlight = new MeshBasicMaterial({ color: '#e2ba88' });
  for (const x of [-3.2, 3.2]) for (const z of [-3.7, -1.5, 0.7, 2.9]) {
    const lamp = new Mesh(new TorusGeometry(0.043, 0.008, 5, 12), downlight);
    lamp.rotation.x = Math.PI / 2; lamp.position.set(x, 3.58, z); group.add(lamp);
  }
  const contact = document.createElement('canvas'); contact.width = contact.height = 64;
  const ctx = contact.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 6, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(0,0,0,0.8)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const shadow = new MeshBasicMaterial({ map: new CanvasTexture(contact), transparent: true, depthWrite: false });
  for (const [x, floor, z] of seatLocations) {
    const plane = new Mesh(new PlaneGeometry(1.75, 1.6), shadow);
    plane.rotation.x = -Math.PI / 2; plane.position.set(x, floor + 0.008, z + 0.1); group.add(plane);
  }
  const carpet = document.createElement('canvas'); carpet.width = carpet.height = 128;
  const context = carpet.getContext('2d'); const pixels = context.createImageData(128, 128);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = 110 + (i * 19 % 43);
    pixels.data.set([value, value, value, 255], i);
  }
  context.putImageData(pixels, 0, 0);
  const grain = new CanvasTexture(carpet); grain.wrapS = grain.wrapT = RepeatWrapping; grain.repeat.set(36, 36);
  for (const id of ['cinema-floor', 'seat-platform']) {
    const material = document.querySelector('#' + id).getObject3D('mesh').material;
    material.bumpMap = grain; material.bumpScale = 0.004; material.roughness = 1; material.needsUpdate = true;
  }
  document.querySelector('#cinema-furnishings').setObject3D('room-details', group);
}

function setupCinemaMaterials() {
  const { CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene } = AFRAME.THREE;
  const reflections = new Scene();
  reflections.background = new Color('#292623');
  const plane = new PlaneGeometry(1, 1);
  // The softboxes live only in the reflection map, outside the rendered cinema.
  const panels = [
    [[0, 3.4, 4.5], [6, 1.7], '#f1ddc1', 1.1],
    [[-4, 1, 2.3], [1.8, 7.2], '#bca28a', 0.8],
    [[4, 0.5, 3.2], [1.9, 6.5], '#dfcab5', 1],
    [[0, -3, 3.3], [8, 1.1], '#887b88', 0.45],
  ];
  for (const [position, [width, height], color, strength] of panels) {
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(strength), side: DoubleSide });
    const softbox = new Mesh(plane, material);
    softbox.position.set(...position);
    softbox.scale.set(width, height, 1);
    softbox.lookAt(0, 0, 0);
    reflections.add(softbox);
  }
  const generator = new PMREMGenerator(scene.renderer);
  const reflectionMap = generator.fromScene(reflections, 0.04).texture;
  generator.dispose();
  plane.dispose();
  for (const softbox of reflections.children) softbox.material.dispose();

  const brush = document.createElement('canvas');
  brush.width = brush.height = 256;
  const context = brush.getContext('2d');
  for (let column = 0; column < brush.width; column++) {
    const tone = Math.round(186 + 38 * Math.sin(column * 2.41) + 20 * Math.sin(column * 0.37));
    context.fillStyle = 'rgb(' + [tone, tone, tone].join(',') + ')';
    context.fillRect(column, 0, 1, brush.height);
  }
  const grain = new CanvasTexture(brush);
  for (const element of scene.querySelectorAll('.brushed-metal')) {
    const material = element.getObject3D('mesh').material;
    material.envMap = reflectionMap;
    material.roughnessMap = grain;
    material.bumpMap = grain;
    material.bumpScale = 0.012;
    material.needsUpdate = true;
    metalFinishes.push(material);
  }
  setupSeats(reflectionMap);
}

function updateLighting() {
  const level = Number(lightIntensity.value) / 100;
  lightLevel.value = lightIntensity.value + '%';
  if (!scene.hasLoaded) return;

  const color = lightColor.value;
  // Keep the aisle lights and a little ambient light at minimum intensity.
  roomAmbient.setAttribute('light', 'intensity', 0.3 + level * 0.52);
  roomAccent.setAttribute('light', { color, intensity: level * 8 });
  const stripColor = new AFRAME.THREE.Color(color).multiplyScalar(0.15 + level * 0.6);
  for (const strip of accentStrips) {
    strip.setAttribute('material', 'color', '#' + stripColor.getHexString());
  }
  for (const material of metalFinishes) material.envMapIntensity = 0.2 + level * 0.7;
}

function paintPoster() {
  const canvas = document.querySelector('#screen-poster');
  const ctx = canvas.getContext('2d');
  const x = canvas.width / 2;
  const y = canvas.height / 2;
  const glow = ctx.createRadialGradient(x, y, 20, x, y, x);
  glow.addColorStop(0, '#282230');
  glow.addColorStop(1, '#121114');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c2acf5';
  ctx.font = '500 46px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('side by side', x, y - 12);
  ctx.fillStyle = '#8c8694';
  ctx.font = '400 17px system-ui, sans-serif';
  ctx.fillText('O cinema é melhor junto.', x, y + 42);
}

function renderSeat() {
  const first = currentSeat === 0;
  const last = currentSeat === seatCenters.length - 1;
  const name = 'Poltrona ' + seatLabels[currentSeat];
  seatNumber.value = name + ' · ' + (currentSeat + 1) + ' de ' + seatLocations.length;
  previousSeat.disabled = !scene.hasLoaded || first;
  nextSeat.disabled = !scene.hasLoaded || last;

  const ctx = seatPanelArt.getContext('2d');
  ctx.fillStyle = '#17121d';
  ctx.fillRect(0, 0, seatPanelArt.width, seatPanelArt.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#dfd6e9';
  ctx.font = '650 43px system-ui, sans-serif';
  ctx.fillText(name, seatPanelArt.width / 2, 107);
  ctx.font = '700 92px system-ui, sans-serif';
  for (const { offset, x, arrow } of seatButtons) {
    const disabled = offset < 0 ? first : last;
    ctx.fillStyle = '#483652';
    ctx.fillRect(x, seatButtonTop, seatButtonWidth, seatButtonHeight);
    ctx.fillStyle = disabled ? '#887594' : '#efe2ff';
    ctx.fillText(arrow, x + seatButtonWidth / 2, seatButtonTop + seatButtonHeight / 2);
  }
  const poster = seatPanel.getObject3D?.('mesh')?.material.map;
  if (poster) poster.needsUpdate = true;
  window.dispatchEvent(new CustomEvent('cinema-seat-change', { detail: { index: currentSeat, label: seatLabels[currentSeat] } }));
}

function changeSeat(offset) {
  selectSeat(currentSeat + offset);
}

function selectSeat(destination) {
  if (!Number.isInteger(destination) || destination < 0 || destination >= seatLocations.length) return;
  currentSeat = destination;
  const [x, floor, z] = seatLocations[currentSeat];
  const yaw = Math.atan2(x, z + 4.95);
  seatRig.setAttribute('position', { x: x + Math.sin(yaw) * 0.12, y: floor + 1.16, z: z + Math.cos(yaw) * 0.12 });
  seatRig.setAttribute('rotation', { x: 0, y: yaw * 180 / Math.PI, z: 0 });
  if (!scene.is('vr-mode') && !stage.hasAttribute('data-cardboard') && !stage.hasAttribute('data-cinema-controls')) {
    const look = spectator.components['look-controls'];
    if (look) {
      look.yawObject.rotation.y = 0;
      look.pitchObject.rotation.x = Math.atan2(1.9 - floor - 1.16, z + 5.07);
    }
  }
  framePreview();
  renderSeat();
}

window.cinemaSeats = {
  list: seatLocations.map(([x, floor, z], index) => ({ label: seatLabels[index], x, floor, z })),
  get current() { return currentSeat; },
  select: selectSeat,
};

function setSeatInteraction(immersive) {
  seatMouse.setAttribute('raycaster', 'enabled', !immersive);
  for (const pointer of seatPointers) {
    pointer.setAttribute('raycaster', { enabled: immersive, lineOpacity: 0 });
  }
}

function revealFullscreenSeats() {
  if (document.fullscreenElement !== stage) return;
  stage.setAttribute('data-seat-controls', '');
  clearTimeout(seatControlsTimeout);
  seatControlsTimeout = setTimeout(() => stage.removeAttribute('data-seat-controls'), 2500);
}

function framePreview() {
  if (scene.is('vr-mode') || stage.hasAttribute('data-cardboard') || stage.hasAttribute('data-cinema-controls') || !viewport.clientWidth || !viewport.clientHeight) return;
  const aspect = viewport.clientWidth / viewport.clientHeight;
  const [x, , z] = seatLocations[currentSeat];
  const halfView = (2.75 + Math.abs(x) * 0.45) / (z + 5.07);
  const fitWidthFov = 2 * Math.atan(halfView / aspect) * 180 / Math.PI;
  spectator.setAttribute('camera', 'fov', Math.max(35, Math.min(72, fitWidthFov * 1.18)));
  // A-Frame's camera update uses the window aspect until the embedded scene resizes.
  scene.resize();
}

function fitVideo() {
  if (!video.videoWidth || !video.videoHeight) return;
  const width = Number(surface.getAttribute('width'));
  const height = Number(surface.getAttribute('height'));
  const aspect = video.videoWidth / video.videoHeight;
  screen.setAttribute('width', Math.min(width, height * aspect));
  screen.setAttribute('height', Math.min(height, width / aspect));
}

function updatePlay() {
  play.disabled = Boolean(disconnectCast) || !scene.hasLoaded || !videoUrl || Boolean(video.error);
  play.textContent = video.paused ? 'Reproduzir no telão' : 'Pausar vídeo';
}

function showVideo() {
  fitVideo();
  screen.setAttribute('visible', 'true');
  idleScreen.setAttribute('visible', 'false');
}

function showPoster() {
  screen.setAttribute('visible', 'false');
  idleScreen.setAttribute('visible', 'true');
}

function setCastMedia(stream) {
  video.pause();
  video.removeAttribute('src');
  video.loop = false;
  video.muted = true;
  video.srcObject = stream;
  void video.play().catch(() => {
    if (video.srcObject !== stream) return;
    soundCast.hidden = false;
    soundCast.textContent = 'Reproduzir transmissão';
    liveStatus.textContent = 'Toque em Reproduzir transmissão para ver o telão.';
  });
}

const castCode = new URLSearchParams(location.search).get('transmissao');
if (castCode) {
  cinemaLive.hidden = false;
  document.querySelector('#cinema-intro').textContent = 'Assista à transmissão do seu lugar na sala.';
  if (!/^[A-Za-z0-9_-]{16}$/.test(castCode) || !window.RTCPeerConnection) {
    joinCast.disabled = true;
    liveStatus.textContent = 'Link inválido ou navegador sem suporte a transmissões.';
  }
  joinCast.addEventListener('click', () => {
    joinCast.hidden = true;
    leaveCast.hidden = false;
    fileInput.disabled = true;
    liveStatus.textContent = 'Conectando à transmissão.';
    disconnectCast = receiveCast(castCode, {
      onMedia: setCastMedia,
      onStatus: message => { liveStatus.textContent = message; },
      onEnd: message => {
        disconnectCast = undefined;
        video.pause();
        video.srcObject = null;
        video.muted = false;
        video.loop = true;
        if (videoUrl) video.src = videoUrl;
        showPoster();
        joinCast.hidden = false;
        leaveCast.hidden = true;
        soundCast.hidden = true;
        soundCast.textContent = 'Ativar som';
        fileInput.disabled = false;
        liveStatus.textContent = message;
        updatePlay();
      },
    });
    updatePlay();
  });
  leaveCast.addEventListener('click', () => disconnectCast?.());
  soundCast.addEventListener('click', async () => {
    video.muted = false;
    try {
      await video.play();
      soundCast.hidden = true;
      liveStatus.textContent = 'Transmissão ao vivo no telão.';
    } catch {
      liveStatus.textContent = 'O navegador bloqueou o áudio. Toque para tentar de novo.';
    }
  });
  video.addEventListener('playing', () => {
    if (!video.srcObject) return;
    showVideo();
    soundCast.textContent = 'Ativar som';
    soundCast.hidden = !video.muted || !video.srcObject.getAudioTracks().length;
    liveStatus.textContent = 'Transmissão ao vivo no telão.' +
      (soundCast.hidden || !video.muted ? '' : ' Toque em Ativar som.');
  });
  window.addEventListener('pagehide', () => disconnectCast?.());
}

async function checkVR() {
  scene.setAttribute('xr-mode-ui', 'enabled', false);
  setupCinemaMaterials();
  scene.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  updateLighting();
  selectSeat(currentSeat);
  framePreview();
  new ResizeObserver(framePreview).observe(viewport);
  scene.addEventListener('exit-vr', framePreview);
  updatePlay();
  if (!window.isSecureContext || !navigator.xr) {
    xrStatus.textContent = window.isSecureContext
      ? 'Prévia 3D disponível. Arraste a cena para olhar ao redor.'
      : 'Abra o cinema por HTTPS para entrar em VR no headset.';
    return;
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr');
    enterVR.disabled = !supported;
    xrStatus.textContent = supported
      ? 'VR disponível. Sente-se de frente e clique em Entrar em VR.'
      : 'Prévia 3D disponível. Arraste a cena para olhar ao redor.';
  } catch {
    xrStatus.textContent = 'Não foi possível verificar o suporte a VR.';
  }
}

paintPoster();
furnishCinema();
renderSeat();
lightColor.addEventListener('input', updateLighting);
lightIntensity.addEventListener('input', updateLighting);
previousSeat.addEventListener('click', () => changeSeat(-1));
nextSeat.addEventListener('click', () => changeSeat(1));
seatPanel.addEventListener('click', event => {
  const hit = event.detail?.intersection?.uv;
  if (!hit) return;
  const x = hit.x * seatPanelArt.width;
  const y = (1 - hit.y) * seatPanelArt.height;
  if (y < seatButtonTop || y > seatButtonTop + seatButtonHeight) return;
  const button = seatButtons.find(button => x >= button.x && x <= button.x + seatButtonWidth);
  if (button) changeSeat(button.offset);
});
scene.addEventListener('enter-vr', () => setSeatInteraction(Boolean(scene.xrSession)));
scene.addEventListener('exit-vr', () => setSeatInteraction(false));
for (const pointer of seatPointers) {
  pointer.addEventListener('raycaster-intersection', event => {
    if (event.detail.els.includes(seatPanel)) {
      pointer.setAttribute('raycaster', { showLine: true, lineOpacity: 0.7 });
    }
  });
  pointer.addEventListener('raycaster-intersection-cleared', () => pointer.setAttribute('raycaster', 'lineOpacity', 0));
}

if (scene.hasLoaded) checkVR();
else scene.addEventListener('loaded', checkVR, { once: true });
window.addEventListener('cinema-controls-closed', framePreview);

window.addEventListener('load', () => {
  if (!window.AFRAME) xrStatus.textContent = 'A sala não carregou. Confira a conexão.';
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;

  video.pause();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  showPoster();
  mediaStatus.textContent = 'Arquivo selecionado. Clique em Reproduzir no telão.';
  updatePlay();
});

video.addEventListener('play', updatePlay);
video.addEventListener('pause', updatePlay);
video.addEventListener('loadedmetadata', fitVideo);
video.addEventListener('resize', fitVideo);
video.addEventListener('error', () => {
  if (video.srcObject) {
    disconnectCast?.('O navegador não conseguiu reproduzir a transmissão.');
    return;
  }
  mediaStatus.textContent = 'Não foi possível abrir o arquivo. Tente outro MP4.';
  updatePlay();
});

play.addEventListener('click', async () => {
  if (!video.paused) {
    video.pause();
    return;
  }
  try {
    await video.play();
    showVideo();
    mediaStatus.textContent = 'Vídeo no telão.';
  } catch {
    mediaStatus.textContent = 'A reprodução falhou. Tente outro MP4.';
  }
});

if (document.fullscreenEnabled && stage.requestFullscreen) {
  fullscreen.hidden = false;
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      xrStatus.textContent = 'Não foi possível abrir em tela cheia.';
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const isFullscreen = document.fullscreenElement === stage;
    fullscreen.setAttribute('aria-label', isFullscreen ? 'Sair da tela cheia' : 'Tela cheia');
    fullscreen.title = isFullscreen ? 'Sair da tela cheia' : 'Tela cheia';
    if (isFullscreen) {
      stage.append(seatPreview);
      revealFullscreenSeats();
    } else {
      seatPreviewHome.append(seatPreview);
      clearTimeout(seatControlsTimeout);
      stage.removeAttribute('data-seat-controls');
    }
  });
  stage.addEventListener('pointermove', revealFullscreenSeats);
  stage.addEventListener('pointerdown', revealFullscreenSeats);
  document.addEventListener('keydown', event => {
    if (document.fullscreenElement !== stage || !scene.hasLoaded || event.altKey || event.ctrlKey ||
        event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) changeSeat(event.key === 'ArrowLeft' ? -1 : 1);
    revealFullscreenSeats();
  });
}

enterVR.addEventListener('click', async () => {
  try {
    await scene.enterVR();
  } catch {
    xrStatus.textContent = 'Não foi possível entrar em VR. Confira os óculos e o navegador.';
  }
});
