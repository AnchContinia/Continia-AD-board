// Continia AD Board — a 3D moodboard laid out like a solar system.
// Every folder in Assets/ (and every video group) is one tilted orbit around
// the Continia mark. Fly through it with the mouse, keyboard or touch.

import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { motion, ease, prefersReducedMotion } from './motion.js';
import { UPLOAD_URL, VIDEOS_EDIT_URL } from './config.js';

// ---------------------------------------------------------------- constants

const C = {
  techBlue: '#052975',
  deep: '#041e58',
  space: '#020a26', // fog: between the backdrop's top and bottom
  tb85: '#2a4989',
  tb50: '#8193b9',
  innovation: '#8ff8ff',
};

const CARD_H = 4.2; // world units
const MAX_CARD_W = 6.6;
const SPACING = 8.4; // arc length per card on a ring
const FIRST_RADIUS = 24;
const RING_GAP = 9.5;
const GROUP_GAP = 6;
const BASE_ORBIT = 0.02; // rad/s on the innermost ring; outer rings go slower
// px, longest side of a texture. Hundreds of cards share GPU memory, so keep them small;
// the viewer always shows the full-size file.
const THUMB_MAX = window.matchMedia('(hover: none)').matches ? 384 : 512;
const LOAD_CONCURRENCY = 6;

const reduced = prefersReducedMotion();

// ---------------------------------------------------------------- helpers

const $ = (sel) => document.querySelector(sel);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function hex3(hex) {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- renderer

const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(C.space, 160, 560);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 3000);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- stars

function makeStars(count = 2200, radius = 1100) {
  const rnd = mulberry32(42);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.3 + 0.7 * Math.cbrt(rnd()));
    pos[i * 3] = s * Math.cos(t) * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = s * Math.sin(t) * r;
    const b = 0.35 + rnd() * 0.65;
    col[i * 3] = b;
    col[i * 3 + 1] = b;
    col[i * 3 + 2] = b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Round dots, not GL's default squares.
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const g = dot.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  const mat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dot),
    size: 1.8 * renderer.getPixelRatio(),
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    fog: false,
  });
  return new THREE.Points(geo, mat);
}
scene.add(makeStars());

// ---------------------------------------------------------------- card material

const shared = {
  fadeNear: { value: 220 },
  fadeFar: { value: 520 },
};

const cardVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const cardFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uAspect;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uAccent;
  uniform float uHover;
  uniform float uOpacity;
  uniform float uVideo;
  uniform float uFadeNear;
  uniform float uFadeFar;
  varying vec2 vUv;
  varying float vDepth;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // Equilateral triangle, apex along +y (Inigo Quilez).
  float sdTriangle(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }

  void main() {
    vec2 size = vec2(uAspect, 1.0);
    vec2 p = (vUv - 0.5) * size;
    float d = sdRoundBox(p, size * 0.5, uRadius);
    float aa = fwidth(d) * 1.25;
    float shape = 1.0 - smoothstep(-aa, aa, d);
    if (shape <= 0.001) discard;

    vec3 col = uBase;
    if (uHasMap > 0.5) {
      vec4 t = texture2D(uMap, vUv);
      col = mix(uBase, t.rgb, t.a);
    }

    // Hairline edge; it turns Innovation Blue (the signal lamp) on hover.
    float edgeW = mix(0.008, 0.016, uHover);
    float edge = smoothstep(-edgeW - aa, -edgeW + aa, d);
    vec3 edgeCol = mix(vec3(1.0), uAccent, uHover);
    col = mix(col, edgeCol, edge * mix(0.16, 1.0, uHover));

    if (uVideo > 0.5) {
      float dc = length(p) - 0.13;
      float disc = 1.0 - smoothstep(-aa, aa, dc);
      col = mix(col, vec3(0.0196, 0.1608, 0.4588), disc * 0.9);
      float dt = sdTriangle(vec2(p.y, p.x - 0.01), 0.05);
      float tri = 1.0 - smoothstep(-aa, aa, dt);
      col = mix(col, mix(vec3(1.0), uAccent, uHover), tri);
    }

    // Fade into the distance, and fade out as the camera flies through a card.
    float fade = (1.0 - smoothstep(uFadeNear, uFadeFar, vDepth)) * smoothstep(0.6, 3.2, vDepth);
    gl_FragColor = vec4(col, shape * uOpacity * fade);
  }
`;

const planeGeo = new THREE.PlaneGeometry(1, 1);

function makeCardMaterial(isVideo, aspect) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uAspect: { value: aspect },
      uRadius: { value: 0.06 },
      uBase: { value: hex3(C.tb85) },
      uAccent: { value: hex3(C.innovation) },
      uHover: { value: 0 },
      uOpacity: { value: 0 },
      uVideo: { value: isVideo ? 1 : 0 },
      uFadeNear: shared.fadeNear,
      uFadeFar: shared.fadeFar,
    },
    vertexShader: cardVertex,
    fragmentShader: cardFragment,
    transparent: true,
    depthWrite: false,
  });
}

function cardSize(aspect) {
  if (aspect >= 1) {
    const w = Math.min(CARD_H * aspect, MAX_CARD_W);
    return { w, h: w / aspect };
  }
  const h = CARD_H * 1.15;
  return { w: h * aspect, h };
}

// ---------------------------------------------------------------- canvas textures (labels, logo)

function textTexture(text, { size = 44, weight = 600, tracking = 0.15, color = 'rgba(255,255,255,0.78)' } = {}) {
  const font = `${weight} ${size}px "Alliance No.2", "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const supportsTracking = 'letterSpacing' in ctx;
  const spacing = size * tracking;
  const chars = [...text];
  const width = supportsTracking
    ? (ctx.letterSpacing = `${spacing}px`, ctx.measureText(text).width)
    : chars.reduce((w, ch) => w + ctx.measureText(ch).width + spacing, 0);
  c.width = Math.ceil(width + size);
  c.height = Math.ceil(size * 1.6);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  if (supportsTracking) {
    ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(text, size / 2, c.height / 2);
  } else {
    let x = size / 2;
    for (const ch of chars) {
      ctx.fillText(ch, x, c.height / 2);
      x += ctx.measureText(ch).width + spacing;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height };
}

function makeLabelSprite(text, height, opts) {
  const { tex, aspect } = textTexture(text, opts);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

async function makeLogoSprite(height) {
  const img = new Image();
  img.src = 'brand/continia-logomark-white.svg';
  await img.decode();
  const aspect = 380.76 / 358.16;
  const c = document.createElement('canvas');
  c.height = 512;
  c.width = Math.round(512 * aspect);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(height * aspect, height, 1);
  return sprite;
}

// ---------------------------------------------------------------- content

async function fetchManifest() {
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- layout: rings

const ringMaterial = new THREE.LineBasicMaterial({
  color: C.tb50,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
});

function makeRingLine(r, q) {
  const pts = [];
  const seg = 256;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMaterial);
  line.quaternion.copy(q);
  scene.add(line);
  return line;
}

function buildLayout(items) {
  const groups = new Map();
  for (const it of items) {
    const g = it.group || (it.type === 'video' ? 'Video' : 'Moodboard');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }

  const rings = [];
  const placed = [];
  const groupInfo = [];
  let r = FIRST_RADIUS;

  for (const [name, list] of groups) {
    const rnd = mulberry32(hashStr(name));
    const groupQ = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rnd() - 0.5) * 0.44, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.36, 'YXZ'),
    );
    const ownRings = [];
    let i = 0;
    while (i < list.length) {
      const cap = Math.max(6, Math.floor((2 * Math.PI * r) / SPACING));
      const chunk = list.slice(i, i + cap);
      i += cap;
      // Each ring leans a little differently, so a big group fills space
      // like a system of orbits instead of one flat disc.
      const q = ownRings.length === 0
        ? groupQ.clone()
        : groupQ.clone().multiply(new THREE.Quaternion().setFromEuler(
          new THREE.Euler((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7, 'YXZ'),
        ));
      const ring = {
        r,
        q,
        angle: rnd() * Math.PI * 2,
        speed: BASE_ORBIT * Math.pow(FIRST_RADIUS / r, 1.5),
      };
      makeRingLine(r, ring.q);
      chunk.forEach((data, k) => {
        const ir = mulberry32(hashStr(data.id || data.src || data.url || String(k)));
        const slot = (Math.PI * 2) / chunk.length;
        placed.push({
          data,
          ring,
          angle0: k * slot + (ir() - 0.5) * slot * 0.4,
          y: (ir() - 0.5) * 2.8,
          dr: (ir() - 0.5) * 2.4,
        });
      });
      rings.push(ring);
      ownRings.push(ring);
      r += RING_GAP;
    }
    groupInfo.push({ name, count: list.length, ring: ownRings[ownRings.length - 1] });
    r += GROUP_GAP;
  }

  return { rings, placed, groups: groupInfo, outer: r - RING_GAP - GROUP_GAP };
}

// ---------------------------------------------------------------- thumbnails

function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Kunne ikke hente ${src}`));
    img.src = src;
  });
}

function drawScaled(source, sw, sh, sx = 0, sy = 0) {
  const scale = Math.min(1, THUMB_MAX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  return { canvas: c, aspect: sw / sh };
}

function videoFrame(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    if (new URL(src, location.href).origin !== location.origin) v.crossOrigin = 'anonymous';
    const cleanup = () => {
      v.removeAttribute('src');
      v.load();
    };
    v.addEventListener('loadedmetadata', () => {
      v.currentTime = Math.min(1, (v.duration || 2) * 0.1);
    }, { once: true });
    v.addEventListener('seeked', () => {
      try {
        resolve(drawScaled(v, v.videoWidth, v.videoHeight));
      } catch (err) {
        reject(err);
      } finally {
        cleanup();
      }
    }, { once: true });
    v.addEventListener('error', () => {
      cleanup();
      reject(new Error(`Kunne ikke hente ${src}`));
    }, { once: true });
    v.src = src;
  });
}

async function thumbnailFor(d) {
  if (d.type === 'image') {
    const img = await loadImage(d.src, false);
    const w = img.naturalWidth || THUMB_MAX;
    const h = img.naturalHeight || THUMB_MAX;
    return drawScaled(img, w, h);
  }
  if (d.provider === 'youtube') {
    try {
      const img = await loadImage(`https://i.ytimg.com/vi/${d.videoId}/maxresdefault.jpg`, true);
      if (img.naturalWidth > 200) return drawScaled(img, img.naturalWidth, img.naturalHeight);
    } catch { /* fall through to hqdefault */ }
    const img = await loadImage(`https://i.ytimg.com/vi/${d.videoId}/hqdefault.jpg`, true);
    // hqdefault is 4:3 with letterbox bars; keep the 16:9 middle.
    const h = Math.round((img.naturalWidth * 9) / 16);
    return drawScaled(img, img.naturalWidth, h, 0, Math.round((img.naturalHeight - h) / 2));
  }
  if (d.provider === 'vimeo') {
    let url = d.thumb;
    if (!url) {
      const res = await fetch(`https://vimeo.com/api/oembed.json?width=1280&url=${encodeURIComponent(d.url)}`);
      url = (await res.json()).thumbnail_url;
    }
    const img = await loadImage(url, true);
    return drawScaled(img, img.naturalWidth, img.naturalHeight);
  }
  return videoFrame(d.src);
}

async function runQueue(tasks, concurrency) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        await task();
      } catch (err) {
        console.warn(err);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// ---------------------------------------------------------------- camera controller

const cam = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  yawTarget: 0,
  pitchTarget: 0,
  look: new THREE.Vector2(), // hover parallax, smoothed
  lookTarget: new THREE.Vector2(),
  maxDist: 400,
  home: null,
};

let flight = null;

function poseLookingAt(from, target) {
  const f = target.clone().sub(from).normalize();
  return {
    pos: from.clone(),
    yaw: Math.atan2(-f.x, -f.z),
    pitch: Math.asin(clamp(f.y, -1, 1)),
  };
}

function flyTo(pose, duration, easing, onDone) {
  flight = {
    fromPos: cam.pos.clone(),
    fromYaw: cam.yaw,
    fromPitch: cam.pitch,
    toPos: pose.pos.clone(),
    toYaw: cam.yaw + wrapAngle(pose.yaw - cam.yaw),
    toPitch: pose.pitch,
    t0: performance.now(),
    duration: reduced ? 1 : duration,
    easing,
    onDone,
  };
  cam.vel.set(0, 0, 0);
}

function cancelFlight() {
  if (!flight) return;
  cam.yawTarget = cam.yaw;
  cam.pitchTarget = cam.pitch;
  flight = null;
}

function updateFlight(now) {
  if (!flight) return;
  const t = clamp((now - flight.t0) / flight.duration, 0, 1);
  const e = flight.easing(t);
  cam.pos.lerpVectors(flight.fromPos, flight.toPos, e);
  cam.yaw = flight.fromYaw + (flight.toYaw - flight.fromYaw) * e;
  cam.pitch = flight.fromPitch + (flight.toPitch - flight.fromPitch) * e;
  cam.yawTarget = cam.yaw;
  cam.pitchTarget = cam.pitch;
  if (t >= 1) {
    const done = flight.onDone;
    flight = null;
    done?.();
  }
}

const tmpV = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

function cameraAxes() {
  camera.getWorldDirection(forward);
  right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
}

// ---------------------------------------------------------------- state

const state = {
  cards: [],
  rings: [],
  filter: 'all',
  hovered: null,
  viewerOpen: false,
  orbitScale: reduced ? 0 : 1,
  orbitHold: false,
  pointer: new THREE.Vector2(),
  pointerPx: { x: 0, y: 0 },
  pointerInside: false,
  pointerType: 'mouse',
  keys: new Set(),
  interacted: false,
};

const raycaster = new THREE.Raycaster();

// ---------------------------------------------------------------- DOM: HUD

const tip = $('.tip');
const tipKind = tip.querySelector('[data-kind]');
const tipTitle = tip.querySelector('[data-title]');
const statusEl = $('[data-status]');
const hintsEl = $('.hints');

$('[data-upload]').href = UPLOAD_URL;
$('[data-videos]').href = VIDEOS_EDIT_URL;
document.querySelectorAll('[data-upload-link]').forEach((a) => { a.href = UPLOAD_URL; });
document.querySelectorAll('[data-videos-link]').forEach((a) => { a.href = VIDEOS_EDIT_URL; });

// Add menu
const addBtn = $('[data-add]');
const addMenu = $('#add-menu');
function setMenu(open) {
  addMenu.hidden = !open;
  addBtn.setAttribute('aria-expanded', String(open));
}
addBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setMenu(addMenu.hidden);
});
document.addEventListener('click', (e) => {
  if (!addMenu.hidden && !addMenu.contains(e.target)) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !addMenu.hidden) {
    setMenu(false);
    addBtn.focus();
  }
});

// Filters
const chips = document.querySelectorAll('[data-filter]');
chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
  });
});

function matchesFilter(card) {
  if (card.failed) return false;
  return state.filter === 'all' || card.data.type === state.filter;
}

function visibleCards() {
  return state.cards.filter(matchesFilter);
}

// Touch vs mouse hints
const isTouch = window.matchMedia('(hover: none)').matches;
hintsEl.dataset.mode = isTouch ? 'touch' : 'mouse';

function markInteracted() {
  if (state.interacted) return;
  state.interacted = true;
  hintsEl.classList.add('is-quiet');
}

// ---------------------------------------------------------------- viewer

function framingPose(card) {
  const target = card.mesh.position.clone();
  let dir = cam.pos.clone().sub(target);
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
  dir.normalize();
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const fill = Math.max(card.size.h, card.size.w / camera.aspect);
  const dist = fill / 0.62 / (2 * Math.tan(vFov / 2));
  const from = target.clone().add(dir.multiplyScalar(dist));
  return poseLookingAt(from, target);
}

const viewer = new Viewer($('.viewer'), {
  onClose: () => {
    state.viewerOpen = false;
    state.orbitHold = false;
    document.body.classList.remove('is-viewing');
  },
  onStep: (step) => {
    const list = visibleCards();
    if (!list.length) return;
    const i = list.indexOf(state.current);
    const next = list[(i + step + list.length) % list.length];
    state.current = next;
    flyTo(framingPose(next), motion.duration.slower, ease.inOut);
    viewer.show(next.data, list.indexOf(next), list.length);
  },
});

function openCard(card) {
  const list = visibleCards();
  if (!list.includes(card)) return;
  state.current = card;
  state.orbitHold = true;
  state.orbitScale = 0;
  state.hovered = null;
  hideTip();
  state.viewerOpen = true;
  document.body.classList.add('is-viewing');
  flyTo(framingPose(card), motion.duration.slower, ease.inOut, () => {
    if (state.current === card) viewer.open(card.data, list.indexOf(card), list.length);
  });
}

function goHome() {
  if (!cam.home) return;
  flyTo(cam.home, motion.duration.slower, ease.inOut);
}

$('[data-home]').addEventListener('click', goHome);

// ---------------------------------------------------------------- tooltip

function showTip(card) {
  const parts = [card.data.type === 'image' ? 'Billede' : 'Video'];
  if (card.data.group && card.data.group !== 'Video') parts.push(card.data.group);
  tipKind.textContent = parts.join(' · ');
  tipTitle.textContent = card.data.title;
  tip.hidden = false;
  tip.classList.add('is-visible');
}

function hideTip() {
  tip.classList.remove('is-visible');
}

function positionTip() {
  const pad = 16;
  const rect = tip.getBoundingClientRect();
  let x = state.pointerPx.x + 18;
  let y = state.pointerPx.y + 18;
  if (x + rect.width > window.innerWidth - pad) x = state.pointerPx.x - rect.width - 18;
  if (y + rect.height > window.innerHeight - pad) y = state.pointerPx.y - rect.height - 18;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

// ---------------------------------------------------------------- input

const drag = {
  active: false,
  mode: 'look',
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  moved: false,
  t0: 0,
};
const pointers = new Map();
let pinchDist = 0;
let pinchMid = { x: 0, y: 0 };

function setPointer(e) {
  state.pointerPx.x = e.clientX;
  state.pointerPx.y = e.clientY;
  state.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  state.pointerType = e.pointerType;
}

function panBy(dx, dy) {
  cameraAxes();
  const k = 0.045 * (1 + cam.pos.length() / 160);
  cam.pos.addScaledVector(right, -dx * k);
  cam.pos.addScaledVector(up, dy * k);
}

function flyImpulse(amount, dir) {
  const k = 1 + cam.pos.length() / 140;
  cam.vel.addScaledVector(dir, amount * k);
}

function twoPointerInfo() {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (state.viewerOpen) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  setPointer(e);
  markInteracted();
  cancelFlight();
  if (pointers.size === 1) {
    drag.active = true;
    // Right button: fly mode. The pointer locks, the mouse turns the camera
    // and W A S D / Q E fly, until the button is released.
    drag.mode = e.button === 2 ? 'fly' : e.button === 1 || e.shiftKey ? 'pan' : 'look';
    if (drag.mode === 'fly') lockPointer();
    drag.startX = drag.lastX = e.clientX;
    drag.startY = drag.lastY = e.clientY;
    drag.moved = false;
    drag.t0 = performance.now();
  } else if (pointers.size === 2) {
    drag.mode = 'pinch';
    drag.moved = true;
    const info = twoPointerInfo();
    pinchDist = info.dist;
    pinchMid = info.mid;
  }
});

canvas.addEventListener('pointermove', (e) => {
  setPointer(e);
  state.pointerInside = true;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!drag.active || state.viewerOpen) return;

  if (drag.mode === 'pinch' && pointers.size >= 2) {
    const info = twoPointerInfo();
    cameraAxes();
    flyImpulse((info.dist - pinchDist) * 0.35, forward);
    panBy(info.mid.x - pinchMid.x, info.mid.y - pinchMid.y);
    pinchDist = info.dist;
    pinchMid = info.mid;
    return;
  }

  const locked = document.pointerLockElement === canvas;
  const dx = locked ? e.movementX : e.clientX - drag.lastX;
  const dy = locked ? e.movementY : e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) drag.moved = true;

  if (drag.mode === 'fly') {
    drag.moved = true;
    const k = 0.0026;
    cam.yawTarget -= dx * k;
    cam.pitchTarget = clamp(cam.pitchTarget - dy * k, -1.4, 1.4);
  } else if (drag.mode === 'pan') {
    panBy(dx, dy);
  } else {
    const k = isTouch ? 0.005 : 0.0034;
    cam.yawTarget += dx * k;
    cam.pitchTarget = clamp(cam.pitchTarget + dy * k, -1.4, 1.4);
  }
});

function lockPointer() {
  try {
    const req = canvas.requestPointerLock({ unadjustedMovement: true });
    // Chrome returns a promise; it rejects where raw input is unsupported or
    // when the lock was left with Esc a moment ago. Mouse look still works unlocked.
    if (req && req.catch) req.catch(() => canvas.requestPointerLock()?.catch?.(() => {}));
  } catch {
    /* no pointer lock: look with the visible cursor */
  }
}

function unlockPointer() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function endPointer(e) {
  const wasClick = drag.active && drag.mode === 'look' && !drag.moved && pointers.size === 1 && performance.now() - drag.t0 < 500;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    if (drag.mode === 'fly') unlockPointer();
    drag.active = false;
  } else if (pointers.size === 1 && drag.mode === 'pinch') {
    const [p] = [...pointers.values()];
    drag.mode = 'look';
    drag.lastX = p.x;
    drag.lastY = p.y;
  }
  if (wasClick && e.type === 'pointerup') {
    setPointer(e);
    const card = pickAt(state.pointer);
    if (card) openCard(card);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  state.pointerInside = false;
  if (state.hovered) {
    state.hovered = null;
    hideTip();
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.viewerOpen) return;
  markInteracted();
  cancelFlight();
  setPointer(e);
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
  const delta = clamp(e.deltaY * unit, -240, 240);
  // Fly along the ray under the cursor: whatever you point at, you approach.
  raycaster.setFromCamera(state.pointer, camera);
  flyImpulse(-delta * (e.ctrlKey ? 0.3 : 0.13), raycaster.ray.direction);
}, { passive: false });

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'c', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']);

window.addEventListener('keydown', (e) => {
  if (state.viewerOpen || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase();

  if (k === 'h') {
    goHome();
    return;
  }
  if (k === 'enter' && document.activeElement === canvas) {
    const card = pickAt(new THREE.Vector2(0, 0));
    if (card) openCard(card);
    return;
  }
  if (MOVE_KEYS.has(k)) {
    const onButton = tag === 'BUTTON' || tag === 'A';
    if (onButton && (k === ' ' || k === 'enter')) return;
    if (k !== 'shift') e.preventDefault();
    state.keys.add(k);
    markInteracted();
    cancelFlight();
  }
});
window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => {
  state.keys.clear();
  if (drag.mode === 'fly') {
    unlockPointer();
    drag.active = false;
    pointers.clear();
  }
});

function applyKeys(dt) {
  if (!state.keys.size || state.viewerOpen) return;
  const k = state.keys;
  cameraAxes();
  const accel = 70 * (k.has('shift') ? 2.5 : 1) * dt;
  const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
  const s = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  const u = (k.has('e') || k.has(' ') ? 1 : 0) - (k.has('q') || k.has('c') ? 1 : 0);
  cam.vel.addScaledVector(forward, f * accel);
  cam.vel.addScaledVector(right, s * accel);
  cam.vel.addScaledVector(up, u * accel);
}

// ---------------------------------------------------------------- picking

function pickAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const meshes = [];
  for (const card of state.cards) {
    if (!matchesFilter(card)) continue;
    const depth = tmpV.copy(card.mesh.position).applyMatrix4(camera.matrixWorldInverse).z;
    if (-depth < 3.2 || -depth > shared.fadeFar.value) continue;
    meshes.push(card.mesh);
  }
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.card : null;
}

// ---------------------------------------------------------------- build the scene

const items = await fetchManifest();
const layout = buildLayout(items);
state.rings = layout.rings;

for (const p of layout.placed) {
  const aspect = p.data.type === 'video' ? 16 / 9 : 4 / 3;
  const mat = makeCardMaterial(p.data.type === 'video', aspect);
  const mesh = new THREE.Mesh(planeGeo, mat);
  const size = cardSize(aspect);
  mesh.scale.set(size.w, size.h, 1);
  const card = { ...p, mesh, mat, size, loaded: false, hover: 0, dim: 1, appear: 0 };
  mesh.userData.card = card;
  scene.add(mesh);
  state.cards.push(card);
}

// Centre: the Continia mark and the board's name.
const centre = new THREE.Group();
scene.add(centre);
makeLogoSprite(8).then((logo) => {
  logo.position.set(0, 1.2, 0);
  centre.add(logo);
}).catch(() => {});

document.fonts.ready.then(() => {
  const title = makeLabelSprite('AD BOARD', 1.9, { size: 64, weight: 600, tracking: 0.3, color: 'rgba(255,255,255,0.86)' });
  title.position.set(0, -4.6, 0);
  centre.add(title);

  for (const g of layout.groups) {
    const label = makeLabelSprite(`${g.name.toUpperCase()}  ·  ${g.count}`, 1.8, { color: 'rgba(143,248,255,0.9)' });
    const a = Math.PI / 2;
    label.position.set(Math.cos(a) * (g.ring.r + 5), 4.4, Math.sin(a) * (g.ring.r + 5)).applyQuaternion(g.ring.q);
    scene.add(label);
  }
});

// Status + empty state
const imageCount = items.filter((i) => i.type === 'image').length;
const videoCount = items.length - imageCount;
const countText = `${imageCount} ${imageCount === 1 ? 'billede' : 'billeder'} · ${videoCount} ${videoCount === 1 ? 'video' : 'videoer'}`;
statusEl.textContent = countText;
if (!items.length) $('.empty').hidden = false;
// Filters only mean something when there is more than one kind of content.
if (!imageCount || !videoCount) $('.chips').hidden = true;

// Accessible list of everything on the board
const a11yList = $('#a11y-list ul');
state.cards.forEach((card) => {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `${card.data.type === 'image' ? 'Billede' : 'Video'}: ${card.data.title}`;
  btn.addEventListener('click', () => openCard(card));
  li.append(btn);
  a11yList.append(li);
});

// Home pose + intro flight: the outermost ring just about spans the screen.
function homeDistance() {
  const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const aspect = Math.max(camera.aspect, 0.9);
  return Math.max(60, (layout.outer + MAX_CARD_W) / (halfV * aspect) / 1.08);
}
const homeDist = homeDistance();
const homeFrom = new THREE.Vector3(0, homeDist * 0.32, homeDist);
cam.home = poseLookingAt(homeFrom, new THREE.Vector3(0, 0, 0));
cam.maxDist = homeDist * 1.8 + 80;
shared.fadeNear.value = Math.max(220, homeDist * 1.6);
shared.fadeFar.value = shared.fadeNear.value + 320;
scene.fog.near = shared.fadeNear.value * 0.6;
scene.fog.far = shared.fadeFar.value + 200;

const introFrom = poseLookingAt(homeFrom.clone().multiplyScalar(1.6), new THREE.Vector3(0, 0, 0));
cam.pos.copy(reduced ? cam.home.pos : introFrom.pos);
cam.yaw = cam.yawTarget = introFrom.yaw;
cam.pitch = cam.pitchTarget = reduced ? cam.home.pitch : introFrom.pitch;
if (!reduced) flyTo(cam.home, motion.duration.slower * 2.5, ease.out);

// Load thumbnails, inner rings first.
let loadedCount = 0;
const tasks = state.cards.map((card) => async () => {
  try {
    const { canvas: c, aspect } = await thumbnailFor(card.data);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace; // the shader writes sRGB straight through
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    card.mat.uniforms.uMap.value = tex;
    card.mat.uniforms.uHasMap.value = 1;
    card.mat.uniforms.uAspect.value = aspect;
    card.size = cardSize(aspect);
    card.loaded = true;
  } catch (err) {
    card.failed = true; // fades out and is skipped by picking, filters and the viewer
    throw err;
  } finally {
    loadedCount++;
    statusEl.textContent = loadedCount < state.cards.length
      ? `Indlæser ${loadedCount} / ${state.cards.length}`
      : countText;
  }
});
if (tasks.length) {
  statusEl.textContent = `Indlæser 0 / ${tasks.length}`;
  runQueue(tasks, LOAD_CONCURRENCY);
}

// ---------------------------------------------------------------- frame loop

const clock = new THREE.Clock();

function updateCamera(dt, now) {
  updateFlight(now);

  if (!flight) {
    applyKeys(dt);
    cam.pos.addScaledVector(cam.vel, dt);
    cam.vel.multiplyScalar(Math.exp(-3.2 * dt));
    cam.yaw = damp(cam.yaw, cam.yawTarget, 12, dt);
    cam.pitch = damp(cam.pitch, cam.pitchTarget, 12, dt);

    // Soft boundary: drift back if you fly too far out.
    const dist = cam.pos.length();
    if (dist > cam.maxDist) cam.pos.multiplyScalar(damp(1, cam.maxDist / dist, 4, dt));
  }

  // Hover parallax: the view leans a little toward the mouse. It holds still
  // while a card is hovered so the card stays under the cursor.
  const parallaxOn = !reduced && !state.viewerOpen && state.pointerType === 'mouse' && state.pointerInside && !drag.active;
  if (!state.hovered) {
    cam.lookTarget.set(parallaxOn ? -state.pointer.x * 0.035 : 0, parallaxOn ? state.pointer.y * 0.025 : 0);
  }
  cam.look.x = damp(cam.look.x, cam.lookTarget.x, 4, dt);
  cam.look.y = damp(cam.look.y, cam.lookTarget.y, 4, dt);

  camera.position.copy(cam.pos);
  camera.rotation.set(cam.pitch + cam.look.y, cam.yaw + cam.look.x, 0, 'YXZ');
  camera.updateMatrixWorld();
}

function updateCards(dt) {
  const orbitTarget = reduced || state.orbitHold || state.hovered ? 0 : 1;
  state.orbitScale = damp(state.orbitScale, orbitTarget, 3, dt);
  for (const ring of state.rings) ring.angle += ring.speed * dt * state.orbitScale;

  const appearRate = 1000 / motion.duration.moderate;
  for (const card of state.cards) {
    const a = card.angle0 + card.ring.angle;
    const r = card.ring.r + card.dr;
    tmpV.set(Math.cos(a) * r, card.y, Math.sin(a) * r).applyQuaternion(card.ring.q);
    card.mesh.position.copy(tmpV);
    card.mesh.quaternion.copy(camera.quaternion);

    const isHover = state.hovered === card;
    card.hover = damp(card.hover, isHover ? 1 : 0, 1000 / motion.duration.fast, dt);
    // The open card steps aside so the viewer's image has nothing behind it.
    const dimTo = !matchesFilter(card) ? 0.08 : state.viewerOpen && state.current === card ? 0 : 1;
    card.dim = damp(card.dim, dimTo, 1000 / motion.duration.moderate, dt);
    card.appear = damp(card.appear, card.failed ? 0 : card.loaded ? 1 : 0.4, appearRate, dt);

    const s = 1 + card.hover * 0.06;
    card.mesh.scale.set(card.size.w * s, card.size.h * s, 1);
    card.mat.uniforms.uHover.value = card.hover;
    card.mat.uniforms.uOpacity.value = card.appear * card.dim;
  }
}

function updateHover() {
  const canHover = state.pointerInside && !drag.active && !state.viewerOpen && !flight && state.pointerType === 'mouse';
  const card = canHover ? pickAt(state.pointer) : null;
  if (card !== state.hovered) {
    state.hovered = card;
    if (card) showTip(card);
    else hideTip();
  }
  canvas.style.cursor = card ? 'pointer' : drag.active ? 'grabbing' : 'grab';
  if (card) positionTip();
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  updateCamera(dt, now);
  updateCards(dt);
  updateHover();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ?debug exposes the scene for testing in the console.
if (new URLSearchParams(location.search).has('debug')) {
  window.__board = { state, camera, cam, openCard, viewer };
}
