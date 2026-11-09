// Процедурная генерация симметричных карт.
//
// Каждая карта описывается 32-битным сидом. Одна и та же пара «сид + версия
// генератора» всегда даёт одинаковый рельеф, поэтому картой можно поделиться
// ссылкой `?seed=7A3F91C2`. Сид выбирается случайно, если его нет в адресе,
// так что количество карт практически бесконечно.
//
// Симметрия гарантирует честность: стартовые базы, месторождения, камни,
// ящики и кристаллы строятся парами. Мы генерируем только «свою» половину,
// а вторую получаем отражением или поворотом на 180°.

import { MAP, MAP_DENSITY, MAP_LAYOUT, START } from './config.js';
import { segmentDistance } from './nav.js';
import { mulberry32 } from './utils.js';

const TAU = Math.PI * 2;
const FIELD = MAP.half - 8; // предел для декора и месторождений
const BASE_FIELD = MAP.half - 12; // предел для стартовых баз
// Все расстояния компоновки заданы для эталонной карты и масштабируются
// вместе с её размером. Сами числа живут в MAP_LAYOUT (config.js).
const S = MAP.half / MAP_LAYOUT.referenceHalf;
const LAYOUT = MAP_LAYOUT;
const DENSITY = MAP_DENSITY;
const EPS = 0.75;

const range = (rng, min, max) => min + (max - min) * rng();
const intInRange = (rng, [min, max]) => min + Math.floor(rng() * (max - min + 1));
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const inside = (x, z, limit = FIELD) => Math.abs(x) <= limit && Math.abs(z) <= limit;
const unit = (x, z) => {
  const len = Math.hypot(x, z) || 1;
  return { x: x / len, z: z / len };
};
const rotate = (v, angle) => ({
  x: v.x * Math.cos(angle) - v.z * Math.sin(angle),
  z: v.x * Math.sin(angle) + v.z * Math.cos(angle),
});

// ---------------------------------------------------------------- симметрии

export const MAP_SYMMETRIES = [
  {
    key: 'rot180',
    name: 'Центральная',
    tag: '180°',
    hint: 'Вторая половина карты — поворот первой на 180°.',
    transform: (x, z) => [-x, -z],
    mirrorYaw: (yaw) => yaw,
    selfPoint: () => ({ x: 0, z: 0 }),
  },
  {
    key: 'axis-x',
    name: 'Зеркальная',
    tag: 'ОСЬ X',
    hint: 'Базы стоят зеркально относительно оси X.',
    transform: (x, z) => [x, -z],
    mirrorYaw: (yaw) => -yaw,
    selfPoint: (rng) => ({ x: range(rng, -40, 40), z: 0 }),
  },
  {
    key: 'axis-z',
    name: 'Зеркальная',
    tag: 'ОСЬ Z',
    hint: 'Базы стоят зеркально относительно оси Z.',
    transform: (x, z) => [-x, z],
    mirrorYaw: (yaw) => Math.PI - yaw,
    selfPoint: (rng) => ({ x: 0, z: range(rng, -40, 40) }),
  },
  {
    key: 'diagonal',
    name: 'Диагональная',
    tag: 'X = Z',
    hint: 'Базы стоят зеркально относительно диагонали X = Z.',
    transform: (x, z) => [z, x],
    mirrorYaw: (yaw) => Math.PI / 2 - yaw,
    selfPoint: (rng) => {
      const t = range(rng, -40, 40);
      return { x: t, z: t };
    },
  },
  {
    key: 'anti-diagonal',
    name: 'Диагональная',
    tag: 'X = −Z',
    hint: 'Базы стоят зеркально относительно диагонали X = −Z.',
    transform: (x, z) => [-z, -x],
    mirrorYaw: (yaw) => -Math.PI / 2 - yaw,
    selfPoint: (rng) => {
      const t = range(rng, -40, 40);
      return { x: t, z: -t };
    },
  },
];

const SYMMETRY_WEIGHTS = {
  rot180: 0.34,
  'axis-x': 0.17,
  'axis-z': 0.17,
  diagonal: 0.16,
  'anti-diagonal': 0.16,
};

// ---------------------------------------------------------------- палитры

export const MAP_STYLES = [
  {
    key: 'rust',
    name: 'РЖАВАЯ ПУСТОШЬ',
    ground: '#6f5c45',
    patchDark: 'rgba(48,39,29,0.30)',
    patchLight: 'rgba(142,120,92,0.20)',
    crack: 'rgba(36,28,21,',
    speckLight: 'rgba(170,148,111,',
    speckDark: 'rgba(38,31,24,',
    edge: '#3d3329',
    fog: '#22303a',
    sun: '#ffd9b2',
    sunSpecular: '#4a3524',
    hemi: '#bdd8e8',
    hemiGround: '#4f3d2d',
    sky: ['#060d17', '#0d1b29', '#243947', '#5b5a5a', '#a1745a', '#3a3a3d', '#0a0f14'],
    glow: 'rgba(255,160,90,0.55)',
    glowMid: 'rgba(220,110,60,0.18)',
    minimap: '#172624',
    minimapFar: '#0a1315',
  },
  {
    key: 'basalt',
    name: 'БАЗАЛЬТОВЫЕ ПОЛЯ',
    ground: '#565a5b',
    patchDark: 'rgba(28,32,34,0.32)',
    patchLight: 'rgba(118,126,128,0.18)',
    crack: 'rgba(24,27,29,',
    speckLight: 'rgba(156,166,168,',
    speckDark: 'rgba(30,34,36,',
    edge: '#2c3236',
    fog: '#1c2730',
    sun: '#d8e4f0',
    sunSpecular: '#39434a',
    hemi: '#cfe4f2',
    hemiGround: '#353c40',
    sky: ['#04080f', '#0a1420', '#1a2b38', '#3a4d58', '#6e7f86', '#2c3539', '#070b0e'],
    glow: 'rgba(150,200,255,0.35)',
    glowMid: 'rgba(110,150,200,0.16)',
    minimap: '#17202a',
    minimapFar: '#090e14',
  },
  {
    key: 'ochre',
    name: 'ОХРИСТЫЕ ДЮНЫ',
    ground: '#8a6a3f',
    patchDark: 'rgba(72,50,24,0.30)',
    patchLight: 'rgba(196,160,104,0.20)',
    crack: 'rgba(60,38,16,',
    speckLight: 'rgba(218,184,126,',
    speckDark: 'rgba(56,38,18,',
    edge: '#4a3a22',
    fog: '#3a2d20',
    sun: '#ffe2b0',
    sunSpecular: '#6b4a26',
    hemi: '#ead8bc',
    hemiGround: '#5a4226',
    sky: ['#0a0704', '#1b120a', '#3a2514', '#6b4a25', '#c08a4a', '#3f2b18', '#0d0906'],
    glow: 'rgba(255,190,100,0.55)',
    glowMid: 'rgba(220,150,60,0.18)',
    minimap: '#2a2417',
    minimapFar: '#120f08',
  },
  {
    key: 'ash',
    name: 'ПЕПЕЛЬНАЯ ЗОНА',
    ground: '#6a6660',
    patchDark: 'rgba(40,38,36,0.30)',
    patchLight: 'rgba(150,144,136,0.18)',
    crack: 'rgba(30,28,26,',
    speckLight: 'rgba(180,174,164,',
    speckDark: 'rgba(36,34,32,',
    edge: '#35322e',
    fog: '#2a2a2a',
    sun: '#f0e6d8',
    sunSpecular: '#3f3a34',
    hemi: '#d8d4cc',
    hemiGround: '#45413c',
    sky: ['#07090b', '#111518', '#232a2e', '#454e52', '#7d7a73', '#33302c', '#08090a'],
    glow: 'rgba(255,170,120,0.30)',
    glowMid: 'rgba(200,130,90,0.14)',
    minimap: '#1f2224',
    minimapFar: '#0b0d0e',
  },
];

// ------------------------------------------------------------------- сиды

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Приводит сид из адреса/поля ввода к 32-битному числу. */
export function normalizeSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input >>> 0;
  const raw = String(input ?? '').trim();
  if (!raw) return randomSeed();
  const hex = raw.replace(/^#/, '').replace(/^0x/i, '').replace(/[-\s]/g, '');
  if (/^[0-9a-f]{1,8}$/i.test(hex)) return parseInt(hex, 16) >>> 0;
  return fnv1a(raw);
}

export function randomSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

export function formatSeed(seed) {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function formatSeedLabel(seed) {
  const code = formatSeed(seed);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Короткая подпись карты для интерфейса и тестов. */
export function mapSignature(map) {
  const patches = map.oilPatches
    .map((p) => `${Math.round(p.x)},${Math.round(p.z)},${p.role}`)
    .join('|');
  const walls = (map.walls ?? [])
    .map((w) => `${Math.round(w.x1)},${Math.round(w.z1)},${Math.round(w.x2)},${Math.round(w.z2)}`)
    .join('|');
  return `${map.symmetry.key}/${map.style.key}/${patches}/${walls}`;
}

// ------------------------------------------------------------- вспомогательное

function resolveSymmetry(value, rng) {
  if (value) {
    const found = MAP_SYMMETRIES.find((s) => s.key === value || s.tag === value);
    if (found) return found;
  }
  let roll = rng();
  for (const symmetry of MAP_SYMMETRIES) {
    roll -= SYMMETRY_WEIGHTS[symmetry.key] ?? 0;
    if (roll <= 0) return symmetry;
  }
  return MAP_SYMMETRIES[0];
}

function resolveStyle(value, rng) {
  if (value) {
    const found = MAP_STYLES.find((s) => s.key === value || s.name === value);
    if (found) return found;
  }
  return MAP_STYLES[Math.floor(rng() * MAP_STYLES.length) % MAP_STYLES.length];
}

function anchorValid(x, z, symmetry) {
  if (!inside(x, z, BASE_FIELD + 8)) return false;
  const [ex, ez] = symmetry.transform(x, z);
  if (!inside(ex, ez, BASE_FIELD + 8)) return false;
  // Стартовые точки не должны стоять слишком близко друг к другу.
  return dist(x, z, ex, ez) >= LAYOUT.anchor.minDistance * S;
}

function pickAnchor(rng, symmetry) {
  for (let attempt = 0; attempt < 700; attempt++) {
    const x = range(rng, -LAYOUT.anchor.span * S, LAYOUT.anchor.span * S);
    const z = range(rng, -LAYOUT.anchor.span * S, LAYOUT.anchor.span * S);
    if (Math.hypot(x, z) < LAYOUT.anchor.centerClear * S) continue;
    if (anchorValid(x, z, symmetry)) return { x, z };
  }
  // Страховка: детерминированная точка, валидная для любой симметрии.
  const fallback = LAYOUT.anchor.fallback[symmetry.key];
  return { x: fallback.x * S, z: fallback.z * S };
}

function pickPower(rng, hq, toEnemy, perp) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const side = rng() < 0.5 ? -1 : 1;
    const back = range(rng, LAYOUT.power.back[0], LAYOUT.power.back[1]) * S;
    const lateral = side * range(rng, LAYOUT.power.lateral[0], LAYOUT.power.lateral[1]) * S;
    const x = hq.x - toEnemy.x * back + perp.x * lateral;
    const z = hq.z - toEnemy.z * back + perp.z * lateral;
    if (!inside(x, z, MAP.half - 4)) continue;
    if (dist(x, z, hq.x, hq.z) < LAYOUT.power.minDistance * S) continue;
    return { x, z };
  }
  const back = LAYOUT.power.fallbackBack;
  return {
    x: Math.max(-MAP.half + 4, Math.min(MAP.half - 4, hq.x - toEnemy.x * back * S)),
    z: Math.max(-MAP.half + 4, Math.min(MAP.half - 4, hq.z - toEnemy.z * back * S)),
  };
}

function pickHomeSpots(rng, hq, toEnemy, power) {
  const spots = [];
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? 1 : -1;
    let found = null;
    for (let attempt = 0; attempt < 320; attempt++) {
      const angle = sign * range(rng, LAYOUT.homes.angle[0], LAYOUT.homes.angle[1]);
      const dir = rotate(toEnemy, angle);
      const d = range(rng, LAYOUT.homes.distance[0], LAYOUT.homes.distance[1]) * S;
      const x = hq.x + dir.x * d;
      const z = hq.z + dir.z * d;
      if (!inside(x, z, MAP.half - 7)) continue;
      if (dist(x, z, hq.x, hq.z) < LAYOUT.homes.hqClear * S) continue;
      if (dist(x, z, power.x, power.z) < LAYOUT.homes.powerClear * S) continue;
      if (spots.some((spot) => dist(x, z, spot.x, spot.z) < LAYOUT.homes.spacing * S)) continue;
      found = { x, z };
      break;
    }
    if (!found) {
      // Редкий случай у самой границы: ищем любое свободное направление.
      for (let step = 0; step < 48; step++) {
        const angle = (step / 48) * TAU;
        const x = hq.x + Math.cos(angle) * LAYOUT.homes.fallbackDistance * S;
        const z = hq.z + Math.sin(angle) * LAYOUT.homes.fallbackDistance * S;
        if (!inside(x, z, MAP.half - 7)) continue;
        if (dist(x, z, power.x, power.z) < LAYOUT.homes.powerClear * S) continue;
        if (spots.some((spot) => dist(x, z, spot.x, spot.z) < LAYOUT.homes.spacing * S)) continue;
        found = { x, z };
        break;
      }
    }
    if (!found) {
      const dir = rotate(toEnemy, sign * Math.PI / 2);
      found = {
        x: Math.max(-MAP.half + 7, Math.min(MAP.half - 7, hq.x + dir.x * LAYOUT.homes.fallbackDistance * S)),
        z: Math.max(-MAP.half + 7, Math.min(MAP.half - 7, hq.z + dir.z * LAYOUT.homes.fallbackDistance * S)),
      };
    }
    spots.push(found);
  }
  return spots;
}

function marineSpots(rng, hq, enemyHq, count, power, patches) {
  const toEnemy = unit(enemyHq.x - hq.x, enemyHq.z - hq.z);
  const perp = { x: -toEnemy.z, z: toEnemy.x };
  const spots = [];
  for (let i = 0; i < count; i++) {
    let found = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const forward = range(rng, LAYOUT.marines.forward[0], LAYOUT.marines.forward[1]) * S;
      const lateral = ((i - (count - 1) / 2) * LAYOUT.marines.lateralStep * S)
        + range(rng, -LAYOUT.marines.lateralJitter, LAYOUT.marines.lateralJitter) * S;
      const x = hq.x + toEnemy.x * forward + perp.x * lateral;
      const z = hq.z + toEnemy.z * forward + perp.z * lateral;
      if (!inside(x, z, MAP.half - 5)) continue;
      if (dist(x, z, hq.x, hq.z) < LAYOUT.marines.hqClear * S) continue;
      if (dist(x, z, power.x, power.z) < LAYOUT.marines.powerClear * S) continue;
      if (patches.some((p) => dist(x, z, p.x, p.z) < LAYOUT.marines.patchClear * S)) continue;
      if (spots.some((s) => dist(x, z, s.x, s.z) < LAYOUT.marines.spacing * S)) continue;
      found = { x, z };
      break;
    }
    if (!found) {
      const lateral = (i - (count - 1) / 2) * LAYOUT.marines.lateralStep * S;
      found = {
        x: Math.max(-MAP.half + 5, Math.min(MAP.half - 5, hq.x + toEnemy.x * LAYOUT.marines.fallbackForward * S + perp.x * lateral)),
        z: Math.max(-MAP.half + 5, Math.min(MAP.half - 5, hq.z + toEnemy.z * LAYOUT.marines.fallbackForward * S + perp.z * lateral)),
      };
    }
    spots.push(found);
  }
  return spots;
}

function pickBarracksSpot(rng, hq, enemyHq, power, patches) {
  const toEnemy = unit(enemyHq.x - hq.x, enemyHq.z - hq.z);
  let best = null;
  let bestScore = -Infinity;

  const scoreAt = (x, z) => {
    let score = Math.min(
      dist(x, z, hq.x, hq.z) - LAYOUT.barracks.hqClear * S,
      dist(x, z, power.x, power.z) - LAYOUT.barracks.powerClear * S,
      MAP.half - 7 - Math.abs(x),
      MAP.half - 7 - Math.abs(z),
    );
    for (const p of patches) score = Math.min(score, dist(x, z, p.x, p.z) - LAYOUT.barracks.patchClear * S);
    return score;
  };

  for (let attempt = 0; attempt < 260; attempt++) {
    const sign = attempt % 2 === 0 ? 1 : -1;
    const dir = rotate(toEnemy, sign * range(rng, LAYOUT.barracks.angle[0], LAYOUT.barracks.angle[1]));
    const d = range(rng, LAYOUT.barracks.distance[0], LAYOUT.barracks.distance[1]) * S;
    const x = hq.x + dir.x * d;
    const z = hq.z + dir.z * d;
    if (!inside(x, z, MAP.half - 7)) continue;
    const score = scoreAt(x, z);
    if (score > 0.4) return { x, z };
    if (score > bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }

  // Систематический обход: если у границы не осталось места для случайных
  // проб, ищем ближайшее свободное кольцо вокруг базы.
  for (const radius of [10, 11.5, 13, 14.5]) {
    for (let step = 0; step < 48; step++) {
      const angle = (step / 48) * TAU;
      const x = hq.x + Math.cos(angle) * radius * S;
      const z = hq.z + Math.sin(angle) * radius * S;
      if (!inside(x, z, MAP.half - 7)) continue;
      if (scoreAt(x, z) > 0.4) return { x, z };
    }
  }

  if (best) return best;
  const dir = rotate(toEnemy, Math.PI / 2);
  return {
    x: Math.max(-MAP.half + 7, Math.min(MAP.half - 7, hq.x + dir.x * LAYOUT.barracks.fallbackDistance * S)),
    z: Math.max(-MAP.half + 7, Math.min(MAP.half - 7, hq.z + dir.z * LAYOUT.barracks.fallbackDistance * S)),
  };
}

// ------------------------------------------------------------------ карта

function makePatch(x, z, owner, role, rotation) {
  return { x, z, owner, role, radius: LAYOUT.patchRadius, rotation, derrick: null, root: null };
}

function addPatchPair(patches, x, z, symmetry, rng, role = 'natural') {
  const rotation = rng() * TAU;
  const first = makePatch(x, z, null, role, rotation);
  patches.push(first);
  const [mx, mz] = symmetry.transform(x, z);
  if (dist(x, z, mx, mz) > EPS) {
    const second = makePatch(mx, mz, null, role, rotation + Math.PI * 0.37);
    patches.push(second);
    return [first, second];
  }
  return [first, null];
}

function patchClear(x, z, symmetry, hq, enemyHq, power, enemyPower, barracks, patches, opts) {
  if (!inside(x, z, opts.bound ?? MAP.half - 9)) return false;
  if (dist(x, z, hq.x, hq.z) < opts.hqClear * S) return false;
  if (dist(x, z, enemyHq.x, enemyHq.z) < opts.hqClear * S) return false;
  if (dist(x, z, power.x, power.z) < opts.powerClear * S) return false;
  if (dist(x, z, enemyPower.x, enemyPower.z) < opts.powerClear * S) return false;
  if (barracks && dist(x, z, barracks.x, barracks.z) < (opts.barracksClear ?? LAYOUT.neutral.barracksClear) * S) return false;
  if (patches.some((p) => dist(x, z, p.x, p.z) < opts.patchClear * S)) return false;
  const [mx, mz] = symmetry.transform(x, z);
  if (dist(x, z, mx, mz) < (opts.selfClear ?? 0) * S) return false;
  return true;
}

function pickPairSpot(rng, symmetry, test) {
  for (let attempt = 0; attempt < 900; attempt++) {
    const x = range(rng, -FIELD, FIELD);
    const z = range(rng, -FIELD, FIELD);
    const [mx, mz] = symmetry.transform(x, z);
    if (dist(x, z, mx, mz) < 2) continue;
    if (!inside(x, z)) continue;
    if (!inside(mx, mz)) continue;
    if (!test(x, z) || !test(mx, mz)) continue;
    return { x, z, mx, mz };
  }
  return null;
}

function pickSelfSpot(rng, symmetry, test) {
  const point = symmetry.selfPoint(rng);
  if (inside(point.x, point.z, MAP.half - 10) && test(point.x, point.z)) return point;
  // Для центральной симметрии самосимметрична только точка (0, 0).
  for (let attempt = 0; attempt < 120; attempt++) {
    const p = symmetry.selfPoint(rng);
    if (inside(p.x, p.z, MAP.half - 10) && test(p.x, p.z)) return p;
  }
  return null;
}

export function createMap(seedInput, options = {}) {
  const seed = normalizeSeed(seedInput);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const symmetry = resolveSymmetry(options.symmetry, rng);
  const style = resolveStyle(options.style, rng);

  // ---------------------------------------------------------- стартовые базы
  const playerHq = pickAnchor(rng, symmetry);
  const [enemyX, enemyZ] = symmetry.transform(playerHq.x, playerHq.z);
  const enemyHq = { x: enemyX, z: enemyZ };
  const toEnemy = unit(enemyHq.x - playerHq.x, enemyHq.z - playerHq.z);
  const perp = { x: -toEnemy.z, z: toEnemy.x };

  const playerPower = pickPower(rng, playerHq, toEnemy, perp);
  const [enemyPowerX, enemyPowerZ] = symmetry.transform(playerPower.x, playerPower.z);
  const enemyPower = { x: enemyPowerX, z: enemyPowerZ };

  const playerHomes = pickHomeSpots(rng, playerHq, toEnemy, playerPower);

  const oilPatches = [];
  const playerHomePatches = [];
  const enemyHomePatches = [];
  for (const spot of playerHomes) {
    const patch = makePatch(spot.x, spot.z, 'player', 'home', rng() * TAU);
    const [mx, mz] = symmetry.transform(spot.x, spot.z);
    const mirror = makePatch(mx, mz, 'enemy', 'home', rng() * TAU);
    oilPatches.push(patch, mirror);
    playerHomePatches.push(patch);
    enemyHomePatches.push(mirror);
  }

  const enemyBarracks = pickBarracksSpot(rng, enemyHq, playerHq, enemyPower, oilPatches);

  const patchTest = (x, z, opts) => patchClear(
    x, z, symmetry, playerHq, enemyHq, playerPower, enemyPower, enemyBarracks, oilPatches, opts,
  );

  // Нейтральные месторождения: две зеркальные пары плюс иногда спорная точка
  // на оси симметрии (у центральной симметрии — ровно в центре карты).
  for (let i = 0; i < 2; i++) {
    const spot = pickPairSpot(rng, symmetry, (x, z) => patchTest(x, z, {
      hqClear: LAYOUT.neutral.hqClear,
      powerClear: LAYOUT.neutral.powerClear,
      patchClear: LAYOUT.neutral.patchClear,
      bound: MAP.half - LAYOUT.neutral.bound,
      selfClear: LAYOUT.neutral.selfClear,
    }));
    if (spot) addPatchPair(oilPatches, spot.x, spot.z, symmetry, rng, 'natural');
  }

  if (rng() < 0.62) {
    const spot = pickSelfSpot(rng, symmetry, (x, z) => patchTest(x, z, {
      hqClear: LAYOUT.neutral.hqClear,
      powerClear: LAYOUT.neutral.powerClear,
      patchClear: LAYOUT.neutral.patchClear,
      bound: MAP.half - LAYOUT.neutral.centerBound,
    }));
    if (spot) {
      oilPatches.push(makePatch(spot.x, spot.z, null, 'center', rng() * TAU));
    }
  }

  // ------------------------------------------------------------- старт матча
  const spawn = {
    player: {
      hq: { ...playerHq },
      power: { ...playerPower },
      derricks: playerHomePatches.slice(0, 1).map((p) => ({ x: p.x, z: p.z })),
      marines: [],
    },
    enemy: {
      hq: { ...enemyHq },
      power: { ...enemyPower },
      barracks: { ...enemyBarracks },
      derricks: enemyHomePatches.slice(0, 2).map((p) => ({ x: p.x, z: p.z })),
      marines: [],
    },
  };

  spawn.player.marines = marineSpots(
    rng, playerHq, enemyHq, START.player.marines, playerPower, oilPatches,
  );
  spawn.enemy.marines = marineSpots(
    rng, enemyHq, playerHq, START.enemy.marines, enemyPower, oilPatches,
  );

  // ----------------------------------------------------------------- руины стен
  // Короткие разрушенные стены дают укрытия и узкие проходы. Они строятся
  // зеркальными парами, поэтому не дают преимущества ни одной стороне.
  const walls = [];
  const wallRadius = 0.65;
  const wallPairs = DENSITY.walls[0] + (rng() < DENSITY.wallExtraChance ? 1 : 0);

  const makeWall = (x, z, angle, length) => {
    const hx = Math.cos(angle) * length * 0.5;
    const hz = Math.sin(angle) * length * 0.5;
    return {
      x1: x - hx,
      z1: z - hz,
      x2: x + hx,
      z2: z + hz,
      radius: wallRadius,
    };
  };

  const wallAvoidPoints = [
    { point: playerHq, margin: LAYOUT.walls.avoidBase },
    { point: enemyHq, margin: LAYOUT.walls.avoidBase },
    { point: playerPower, margin: LAYOUT.walls.avoidPower },
    { point: enemyPower, margin: LAYOUT.walls.avoidPower },
    { point: enemyBarracks, margin: LAYOUT.walls.avoidBarracks },
    ...oilPatches.map((patch) => ({ point: patch, margin: LAYOUT.walls.avoidPatch })),
    ...spawn.player.marines.map((marine) => ({ point: marine, margin: LAYOUT.walls.avoidMarine })),
    ...spawn.enemy.marines.map((marine) => ({ point: marine, margin: LAYOUT.walls.avoidMarine })),
  ];

  const wallSegmentValid = (segment) => {
    const samples = [
      { x: segment.x1, z: segment.z1 },
      { x: segment.x2, z: segment.z2 },
      { x: (segment.x1 + segment.x2) * 0.5, z: (segment.z1 + segment.z2) * 0.5 },
    ];
    if (samples.some((sample) => !inside(sample.x, sample.z, FIELD))) return false;
    for (const { point, margin } of wallAvoidPoints) {
      if (segmentDistance(point.x, point.z, segment).distance < margin * S) return false;
    }
    for (const other of walls) {
      if (segmentDistance(other.x1, other.z1, segment).distance < LAYOUT.walls.spacing * S) return false;
      if (segmentDistance(other.x2, other.z2, segment).distance < LAYOUT.walls.spacing * S) return false;
    }
    return true;
  };

  for (let i = 0; i < wallPairs; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 260 && !placed; attempt++) {
      const x = range(rng, -FIELD, FIELD);
      const z = range(rng, -FIELD, FIELD);
      const [mx, mz] = symmetry.transform(x, z);
      if (dist(x, z, mx, mz) < LAYOUT.walls.minDistance * S) continue;
      const angle = rng() * TAU;
      const length = range(rng, LAYOUT.walls.length[0], LAYOUT.walls.length[1]) * S;
      const first = makeWall(x, z, angle, length);
      const [ax, az] = symmetry.transform(first.x1, first.z1);
      const [bx, bz] = symmetry.transform(first.x2, first.z2);
      const second = { x1: ax, z1: az, x2: bx, z2: bz, radius: wallRadius };
      if (!wallSegmentValid(first) || !wallSegmentValid(second)) continue;
      if (segmentDistance(second.x1, second.z1, first).distance < LAYOUT.walls.pairDistance * S) continue;
      walls.push(first, second);
      placed = true;
    }
  }

  // ------------------------------------------------------------------ декор
  const rocks = [];
  const crates = [];
  const crystals = [];
  const pebbles = [];

  const baseClear = (x, z, hqClear, powerClear) => {
    if (dist(x, z, playerHq.x, playerHq.z) < hqClear * S) return false;
    if (dist(x, z, enemyHq.x, enemyHq.z) < hqClear * S) return false;
    if (dist(x, z, playerPower.x, playerPower.z) < powerClear * S) return false;
    if (dist(x, z, enemyPower.x, enemyPower.z) < powerClear * S) return false;
    if (dist(x, z, enemyBarracks.x, enemyBarracks.z) < (powerClear + 2) * S) return false;
    return true;
  };
  const oilClear = (x, z, margin) => oilPatches.every((p) => dist(x, z, p.x, p.z) >= margin * S);
  const wallClear = (x, z, margin) => walls.every(
    (wall) => segmentDistance(x, z, wall).distance >= margin * S + wall.radius,
  );

  const mirrorYaw = (yaw) => symmetry.mirrorYaw(yaw);
  const pushPair = (list, x, z, props) => {
    const [mx, mz] = symmetry.transform(x, z);
    list.push({ ...props, x, z });
    if (dist(x, z, mx, mz) > EPS) {
      list.push({
        ...props,
        x: mx,
        z: mz,
        yaw: props.yaw == null ? undefined : mirrorYaw(props.yaw),
      });
    }
  };

  // Камни: зеркальные пары, плотность — MAP_DENSITY.rocks.
  const rockPairs = Math.round(intInRange(rng, DENSITY.rocks) * DENSITY.referenceScale);
  for (let i = 0; i < rockPairs; i++) {
    const spot = pickPairSpot(rng, symmetry, (x, z) => (
      baseClear(x, z, LAYOUT.decor.rock.baseHq, LAYOUT.decor.rock.basePower)
      && oilClear(x, z, LAYOUT.decor.rock.patch)
      && wallClear(x, z, LAYOUT.decor.rock.wall)
      && rocks.every((r) => dist(x, z, r.x, r.z) > LAYOUT.decor.rock.spacing * S)
    ));
    if (!spot) continue;
    const props = {
      source: Math.floor(rng() * 4) % 4,
      scale: range(rng, 0.8, 1.35),
      squash: range(rng, 0.8, 1.15),
      yaw: rng() * TAU,
    };
    pushPair(rocks, spot.x, spot.z, props);
  }

  // Ящики: зеркальные пары, плотность — MAP_DENSITY.crates.
  const cratePairs = Math.round(intInRange(rng, DENSITY.crates) * DENSITY.referenceScale);
  for (let i = 0; i < cratePairs; i++) {
    const spot = pickPairSpot(rng, symmetry, (x, z) => (
      baseClear(x, z, LAYOUT.decor.crate.baseHq, LAYOUT.decor.crate.basePower)
      && oilClear(x, z, LAYOUT.decor.crate.patch)
      && wallClear(x, z, LAYOUT.decor.crate.wall)
      && rocks.every((r) => dist(x, z, r.x, r.z) > LAYOUT.decor.crate.rock * S)
      && crates.every((c) => dist(x, z, c.x, c.z) > LAYOUT.decor.crate.spacing * S)
    ));
    if (!spot) continue;
    pushPair(crates, spot.x, spot.z, {
      yaw: rng() * TAU,
      scale: range(rng, 0.82, 1.2),
    });
  }

  // Кристаллы: кластеры, каждый кристалл тоже отражается. Кластеры
  // разносим, чтобы зеркальные половинки не наезжали друг на друга.
  const crystalCenters = [];
  const crystalTest = (x, z) => (
    baseClear(x, z, LAYOUT.decor.crystal.baseHq, LAYOUT.decor.crystal.basePower)
    && oilClear(x, z, LAYOUT.decor.crystal.patch)
    && wallClear(x, z, LAYOUT.decor.crystal.wall)
    && rocks.every((r) => dist(x, z, r.x, r.z) > LAYOUT.decor.crystal.rock * S)
    && crates.every((c) => dist(x, z, c.x, c.z) > LAYOUT.decor.crystal.crate * S)
    && crystalCenters.every((c) => dist(x, z, c.x, c.z) > LAYOUT.decor.crystal.spacing * S)
  );
  const crystalClusters = Math.round(DENSITY.crystals * DENSITY.referenceScale);
  for (let cluster = 0; cluster < crystalClusters; cluster++) {
    const center = pickPairSpot(rng, symmetry, crystalTest);
    if (!center) continue;
    crystalCenters.push({ x: center.x, z: center.z });
    if (dist(center.x, center.z, center.mx, center.mz) > EPS) {
      crystalCenters.push({ x: center.mx, z: center.mz });
    }
    const count = intInRange(rng, DENSITY.crystalBurst);
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU;
      const radius = rng() * 1.15;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      const [mx, mz] = symmetry.transform(x, z);
      if (!inside(x, z) || !inside(mx, mz)) continue;
      // Точка на оси симметрии не образует пару — пропускаем её, чтобы
      // кластеры слева и справа были строго одинаковыми.
      if (dist(x, z, mx, mz) < 0.5) continue;
      if (crystals.some((c) => dist(x, z, c.x, c.z) < 0.45)) continue;
      if (crystals.some((c) => dist(mx, mz, c.x, c.z) < 0.45)) continue;
      const props = {
        scaleX: range(rng, 0.7, 1.4),
        scaleY: range(rng, 1.0, 3.4),
        scaleZ: range(rng, 0.7, 1.4),
        rx: range(rng, -0.32, 0.32),
        ry: rng() * Math.PI,
        rz: range(rng, -0.32, 0.32),
      };
      crystals.push({ ...props, x, z });
      crystals.push({ ...props, x: mx, z: mz, ry: Math.PI - props.ry });
    }
  }

  // Галька: чисто визуальный слой, плотность — MAP_DENSITY.pebbles.
  const pebblePairs = Math.round(intInRange(rng, DENSITY.pebbles) * DENSITY.referenceScale);
  for (let i = 0; i < pebblePairs; i++) {
    const spot = pickPairSpot(rng, symmetry, (x, z) => (
      baseClear(x, z, LAYOUT.decor.pebble.baseHq, LAYOUT.decor.pebble.basePower)
      && oilClear(x, z, LAYOUT.decor.pebble.patch)
      && wallClear(x, z, LAYOUT.decor.pebble.wall)
      && rocks.every((r) => dist(x, z, r.x, r.z) > 4.2)
      && pebbles.every((p) => dist(x, z, p.x, p.z) > 0.8)
    ));
    if (!spot) continue;
    pushPair(pebbles, spot.x, spot.z, {
      scale: range(rng, 0.35, 1.2),
      stretchX: range(rng, 0.8, 1.5),
      stretchZ: range(rng, 0.8, 1.4),
      yaw: rng() * TAU,
    });
  }

  const matches = (patches) => patches
    .map((p) => `${Math.round(p.x)},${Math.round(p.z)}`)
    .join('|');
  const wallMatches = walls
    .map((w) => `${Math.round(w.x1)},${Math.round(w.z1)},${Math.round(w.x2)},${Math.round(w.z2)}`)
    .join('|');

  const map = {
    seed,
    code: formatSeed(seed),
    label: formatSeedLabel(seed),
    symmetry,
    style,
    bounds: { half: MAP.half, clamp: MAP.clamp },
    spawn,
    oilPatches,
    walls,
    decor: { rocks, crates, crystals, pebbles },
    stats: {
      oil: oilPatches.length,
      rocks: rocks.length,
      crates: crates.length,
      crystals: crystals.length,
      pebbles: pebbles.length,
      walls: walls.length,
    },
    signature: '',
  };
  map.signature = `${symmetry.key}/${style.key}/${matches(oilPatches)}/${matches(rocks)}/${wallMatches}`;
  return map;
}

/** Адрес текущей карты с новым сидом (сохраняет ?debug и другие параметры). */
export function seedUrl(seed) {
  const url = new URL(globalThis.location.href);
  url.searchParams.set('seed', formatSeed(seed));
  return url.toString();
}

/** Сид из адресной строки; null, если его там нет. */
export function seedFromLocation(search = globalThis.location?.search ?? '') {
  const params = new URLSearchParams(search);
  const value = params.get('seed');
  return value ? normalizeSeed(value) : null;
}
