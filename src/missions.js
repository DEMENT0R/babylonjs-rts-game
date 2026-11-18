// Кампания и испытания: данные миссий, цели и прогресс в localStorage.
//
// Миссия — это обычная партия на фиксированном сиде с дополнительными
// правилами: ограниченным набором построек и войск, целями и настройками ИИ.
// Движок не знает о сюжете: он получает объект миссии и проверяет её цели.

import { BUILDINGS } from './config.js';
import { t } from './i18n/index.js';

const STORAGE_KEY = 'gelios7.missions.v1';

// Ограничения контента подобраны так, чтобы каждая операция открывала
// следующую ступень техники. Списки заданы целиком, а не «дельтой»: так
// миссию можно прочитать и проверить без знания предыдущих.
const BUILDINGS_EARLY = ['power', 'barracks'];
const BUILDINGS_SUPPLY = ['power', 'barracks', 'factory', 'derrick', 'turret', 'depot'];
const BUILDINGS_TECH = [
  'power', 'barracks', 'factory', 'derrick', 'turret', 'depot', 'lab', 'engineering', 'rear',
];
const BUILDINGS_ALL = [
  'power', 'barracks', 'factory', 'derrick', 'turret', 'depot', 'lab', 'engineering', 'rear', 'wall',
];
const UNITS_EARLY = ['engineer', 'marine'];
const UNITS_ARMOR = ['engineer', 'marine', 'scout', 'tank'];
const UNITS_TECH = ['engineer', 'marine', 'scout', 'tank', 'medic'];
const UNITS_ALL = ['engineer', 'marine', 'scout', 'tank', 'artillery', 'medic'];

/** Зеркальный сектор для миссии: фиксированные симметрия и палитра. */
const mapOf = (symmetry, style) => ({ symmetry, style });

// ------------------------------------------------------------------ кампания

export const CAMPAIGN = [
  {
    id: 'campaign-1',
    kind: 'campaign',
    index: 1,
    title: t('mission.1.title'),
    subtitle: t('mission.1.subtitle'),
    seed: 0x51A7C0DE,
    map: mapOf('rot180', 'rust'),
    difficulty: 'easy',
    ai: { firstWave: 240, waveInterval: 100, income: 0.85 },
    buildings: BUILDINGS_EARLY,
    units: UNITS_EARLY,
    briefing: [
      t('mission.1.brief.p1'),
      t('mission.1.brief.p2'),
    ],
    outro: t('mission.1.outro'),
    objectives: [
      {
        type: 'train',
        unit: 'marine',
        count: 4,
        title: t('mission.1.objective.build.title'),
        desc: t('mission.1.objective.build.desc'),
      },
      {
        type: 'destroyHQ',
        title: t('mission.1.objective.hq.title'),
        desc: t('mission.1.objective.hq.desc'),
      },
    ],
  },
  {
    id: 'campaign-2',
    kind: 'campaign',
    index: 2,
    title: t('mission.2.title'),
    subtitle: t('mission.2.subtitle'),
    seed: 0x2B4F91A3,
    map: mapOf('axis-x', 'basalt'),
    difficulty: 'normal',
    ai: { firstWave: 150, waveInterval: 75, income: 1.05 },
    buildings: ['power', 'barracks', 'derrick', 'turret'],
    units: UNITS_EARLY,
    briefing: [
      t('mission.2.brief.p1'),
      t('mission.2.brief.p2'),
    ],
    outro: t('mission.2.outro'),
    objectives: [
      {
        type: 'derricks',
        count: 5,
        title: t('mission.2.objective.derricks.title'),
        desc: t('mission.2.objective.derricks.desc'),
      },
    ],
  },
  {
    id: 'campaign-3',
    kind: 'campaign',
    index: 3,
    title: t('mission.3.title'),
    subtitle: t('mission.3.subtitle'),
    seed: 0x7C1E35D8,
    map: mapOf('diagonal', 'ochre'),
    difficulty: 'normal',
    ai: { firstWave: 170, waveInterval: 80, income: 1.05 },
    buildings: BUILDINGS_SUPPLY,
    units: UNITS_ARMOR,
    briefing: [
      t('mission.3.brief.p1'),
      t('mission.3.brief.p2'),
    ],
    outro: t('mission.3.outro'),
    setup: (game) => addEnemyTurrets(game, 2),
    objectives: [
      {
        type: 'destroyBuilding',
        building: 'turret',
        count: 2,
        title: t('mission.3.objective.turrets.title'),
        desc: t('mission.3.objective.turrets.desc'),
      },
      {
        type: 'destroyHQ',
        title: t('mission.3.objective.hq.title'),
        desc: t('mission.3.objective.hq.desc'),
      },
    ],
  },
  {
    id: 'campaign-4',
    kind: 'campaign',
    index: 4,
    title: t('mission.4.title'),
    subtitle: t('mission.4.subtitle'),
    seed: 0x0FD2A64B,
    map: mapOf('axis-z', 'ash'),
    difficulty: 'normal',
    ai: { firstWave: 110, waveInterval: 60, income: 1.1 },
    buildings: BUILDINGS_TECH,
    units: UNITS_TECH,
    briefing: [
      t('mission.4.brief.p1'),
      t('mission.4.brief.p2'),
    ],
    outro: t('mission.4.outro'),
    objectives: [
      {
        type: 'survive',
        seconds: 240,
        title: t('mission.4.objective.survive.title'),
        desc: t('mission.4.objective.survive.desc'),
      },
    ],
  },
  {
    id: 'campaign-5',
    kind: 'campaign',
    index: 5,
    title: t('mission.5.title'),
    subtitle: t('mission.5.subtitle'),
    seed: 0x63D9B0E7,
    map: mapOf('anti-diagonal', 'rust'),
    difficulty: 'hard',
    ai: { firstWave: 90, waveInterval: 55, income: 1.1 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      t('mission.5.brief.p1'),
      t('mission.5.brief.p2'),
    ],
    outro: t('mission.5.outro'),
    objectives: [
      {
        type: 'destroyHQ',
        title: t('mission.5.objective.hq.title'),
        desc: t('mission.5.objective.hq.desc'),
      },
    ],
  },
];

// ---------------------------------------------------------------- испытания

export const TRIALS = [
  {
    id: 'trial-1',
    kind: 'trial',
    index: 1,
    title: t('mission.t1.title'),
    subtitle: t('mission.t1.subtitle'),
    seed: 0x1A7E44C2,
    map: mapOf('rot180', 'basalt'),
    difficulty: 'hard',
    ai: { firstWave: 75, waveInterval: 50, income: 1.1 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      t('mission.t1.brief.p1'),
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: t('mission.t1.objective.hq.title'),
        desc: t('mission.t1.objective.hq.desc'),
      },
    ],
  },
  {
    id: 'trial-2',
    kind: 'trial',
    index: 2,
    title: t('mission.t2.title'),
    subtitle: t('mission.t2.subtitle'),
    seed: 0x5C0B93AF,
    map: mapOf('axis-x', 'ash'),
    difficulty: 'hard',
    ai: { firstWave: 45, waveInterval: 45, income: 1.15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      t('mission.t2.brief.p1'),
    ],
    objectives: [
      {
        type: 'survive',
        seconds: 360,
        title: t('mission.t2.objective.survive.title'),
        desc: t('mission.t2.objective.survive.desc'),
      },
    ],
  },
  {
    id: 'trial-3',
    kind: 'trial',
    index: 3,
    title: t('mission.t3.title'),
    subtitle: t('mission.t3.subtitle'),
    seed: 0x3E81D207,
    map: mapOf('diagonal', 'ochre'),
    difficulty: 'normal',
    ai: { firstWave: 120, waveInterval: 60, income: 1.1 },
    buildings: ['power', 'barracks', 'factory', 'derrick', 'turret', 'depot'],
    units: UNITS_ARMOR,
    briefing: [
      t('mission.t3.brief.p1'),
      t('mission.t3.brief.p2'),
    ],
    setup: (game) => addEnemyDerricks(game, 2),
    objectives: [
      {
        type: 'derricks',
        count: 6,
        title: t('mission.t3.objective.derricks.title'),
        desc: t('mission.t3.objective.derricks.desc'),
      },
    ],
  },
  {
    id: 'trial-4',
    kind: 'trial',
    index: 4,
    title: t('mission.t4.title'),
    subtitle: t('mission.t4.subtitle'),
    seed: 0x74A25C19,
    map: mapOf('axis-z', 'rust'),
    difficulty: 'hard',
    ai: { firstWave: 240, waveInterval: 90, income: 1 },
    buildings: ['power', 'barracks', 'derrick'],
    units: UNITS_EARLY,
    briefing: [
      t('mission.t4.brief.p1'),
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: t('mission.t4.objective.hq.title'),
        desc: t('mission.t4.objective.hq.desc'),
      },
    ],
  },
  {
    id: 'trial-5',
    kind: 'trial',
    index: 5,
    title: t('mission.t5.title'),
    subtitle: t('mission.t5.subtitle'),
    seed: 0x09C6F3B1,
    map: mapOf('anti-diagonal', 'basalt'),
    difficulty: 'hard',
    ai: { firstWave: 120, waveInterval: 60, income: 1.15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      t('mission.t5.brief.p1'),
    ],
    setup: (game) => addEnemyTurrets(game, 4),
    objectives: [
      {
        type: 'destroyBuilding',
        building: 'turret',
        count: 4,
        title: t('mission.t5.objective.turrets.title'),
        desc: t('mission.t5.objective.turrets.desc'),
      },
      {
        type: 'destroyHQ',
        title: t('mission.t5.objective.hq.title'),
        desc: t('mission.t5.objective.hq.desc'),
      },
    ],
  },
  {
    id: 'trial-6',
    kind: 'trial',
    index: 6,
    title: t('mission.t6.title'),
    subtitle: t('mission.t6.subtitle'),
    seed: 0x2F58A9D4,
    map: mapOf('rot180', 'ash'),
    difficulty: 'normal',
    ai: { firstWave: 210, waveInterval: 80, income: 1.05 },
    buildings: ['power', 'barracks', 'factory', 'turret', 'depot'],
    units: UNITS_ARMOR,
    briefing: [
      t('mission.t6.brief.p1'),
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: t('mission.t6.objective.hq.title'),
        desc: t('mission.t6.objective.hq.desc'),
      },
    ],
  },
];

// --------------------------------------------------------------- бесконечная

// Секретная операция после кампании. Победы нет: цель — продержаться.
// Волны приходят от «автозаводов» за периметром (см. endless.js), поэтому
// обычные настройки ИИ фактически отключены и не дублируют директора.
export const ENDLESS = [
  {
    id: 'endless-1',
    kind: 'endless',
    index: 6,
    title: t('endless.title'),
    subtitle: t('endless.subtitle'),
    seed: 0x5EC7E7D0,
    map: mapOf('rot180', 'ash'),
    difficulty: 'hard',
    ai: { firstWave: 1e9, waveInterval: 1e9, income: 1 },
    endless: { firstWave: 45, interval: 45, decay: 0.93, minInterval: 15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      t('endless.brief.p1'),
      t('endless.brief.p2'),
    ],
  },
];

const ALL_MISSIONS = [...CAMPAIGN, ...TRIALS, ...ENDLESS];

export function findMission(id) {
  if (!id) return null;
  return ALL_MISSIONS.find((mission) => mission.id === id) ?? null;
}

export function nextCampaignMission(mission) {
  const index = CAMPAIGN.findIndex((item) => item.id === mission?.id);
  return index >= 0 ? CAMPAIGN[index + 1] ?? null : null;
}

// ------------------------------------------------------------------ прогресс

function emptyProgress() {
  return { campaign: {}, trials: {}, endless: {} };
}

export function loadProgress() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const saved = JSON.parse(raw);
    const campaign = saved && typeof saved.campaign === 'object' ? saved.campaign : {};
    const trials = saved && typeof saved.trials === 'object' ? saved.trials : {};
    const endless = saved && typeof saved.endless === 'object' ? saved.endless : {};
    return { campaign: { ...campaign }, trials: { ...trials }, endless: { ...endless } };
  } catch {
    // Приватный режим или повреждённые данные не должны ломать меню.
    return emptyProgress();
  }
}

function saveProgress(progress) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Без хранилища прогресс живёт только до перезагрузки страницы.
  }
}

export function campaignState(mission) {
  const progress = loadProgress();
  if (progress.campaign[mission.id]) return 'done';
  const index = CAMPAIGN.findIndex((item) => item.id === mission.id);
  if (index <= 0) return 'open';
  return progress.campaign[CAMPAIGN[index - 1].id] ? 'open' : 'locked';
}

export function campaignDoneCount() {
  const progress = loadProgress();
  return CAMPAIGN.filter((mission) => progress.campaign[mission.id]).length;
}

export function trialBest(mission) {
  const best = loadProgress().trials[mission.id];
  return Number.isFinite(best) ? best : null;
}

export function trialDoneCount() {
  return TRIALS.filter((mission) => trialBest(mission) != null).length;
}

/** Секретная операция открывается только после всех пяти операций кампании. */
export function endlessUnlocked() {
  return campaignDoneCount() >= CAMPAIGN.length;
}

/** Лучшее время и число волн бесконечной операции. */
export function endlessBest(mission) {
  const best = loadProgress().endless[mission.id];
  if (!best || !Number.isFinite(best.time)) return null;
  return {
    time: best.time,
    waves: Number.isFinite(best.waves) ? best.waves : 0,
  };
}

/**
 * Победа в кампании открывает следующую операцию; в испытании сохраняется
 * лучшее время. Поражение ничего не меняет, кроме бесконечной операции:
 * там любой итог — это новый результат по времени и волнам.
 * Возвращает запись рекорда (для экрана итога) или null.
 */
export function recordMissionResult(mission, result, stats) {
  if (!mission) return null;
  if (mission.kind === 'endless') {
    const time = Math.max(0, Math.round(stats?.time ?? 0));
    const waves = Math.max(0, Math.round(stats?.waves ?? 0));
    const progress = loadProgress();
    const prev = progress.endless[mission.id] ?? null;
    const best = {
      time: Math.max(prev?.time ?? 0, time),
      waves: Math.max(prev?.waves ?? 0, waves),
    };
    progress.endless[mission.id] = best;
    saveProgress(progress);
    return {
      ...best,
      isRecord: best.time > (prev?.time ?? 0) || best.waves > (prev?.waves ?? 0),
    };
  }
  if (result !== 'victory') return null;
  const progress = loadProgress();
  if (mission.kind === 'campaign') {
    progress.campaign[mission.id] = true;
  } else {
    const time = Math.max(0, Math.round(stats?.time ?? 0));
    const best = progress.trials[mission.id];
    if (!Number.isFinite(best) || time < best) progress.trials[mission.id] = time;
  }
  saveProgress(progress);
  return null;
}

// ------------------------------------------------------------- расстановка

/**
 * Предразмещённые вышки противника на нейтральных месторождениях. Берём точки
 * ближе к базе «Беты», чтобы спор за нефть начинался на её половине карты.
 */
function addEnemyDerricks(game, count) {
  const hq = game.map.spawn.enemy.hq;
  const patches = game.world.oilPatches
    .filter((patch) => patch.owner == null && !patch.derrick)
    .sort((a, b) => Math.hypot(a.x - hq.x, a.z - hq.z) - Math.hypot(b.x - hq.x, b.z - hq.z))
    .slice(0, count);
  for (const patch of patches) {
    game.createBuilding('enemy', 'derrick', patch.x, patch.z, {
      complete: true,
      silent: true,
      patch,
    });
  }
}

/**
 * Предразмещённые турели у базы противника. Точки подбираются кольцом вокруг
 * выбранного места: карта процедурная, поэтому жёсткие координаты могли бы
 * попасть в скалу или стену.
 */
function addEnemyTurrets(game, count) {
  const hq = game.map.spawn.enemy.hq;
  const target = game.map.spawn.player.hq;
  const angle = Math.atan2(target.z - hq.z, target.x - hq.x);
  const radius = BUILDINGS.turret.radius;
  for (let i = 0; i < count; i++) {
    const facing = angle + (i - (count - 1) / 2) * 0.62;
    const cx = hq.x + Math.cos(facing) * 21;
    const cz = hq.z + Math.sin(facing) * 21;
    const spot = findBuildingSpot(game, cx, cz, radius, facing);
    if (!spot) continue;
    game.createBuilding('enemy', 'turret', spot.x, spot.z, {
      complete: true,
      silent: true,
      rotation: Math.atan2(target.x - spot.x, target.z - spot.z),
    });
  }
}

function findBuildingSpot(game, x, z, radius, startAngle = 0) {
  const clearOfUnits = (px, pz) => game.units.every(
    (unit) => !unit.alive
      || Math.hypot(px - unit.position.x, pz - unit.position.z) >= radius + unit.radius + 0.6,
  );
  const clearOfPatches = (px, pz) => game.map.oilPatches.every(
    (patch) => Math.hypot(px - patch.x, pz - patch.z) >= radius + patch.radius + 0.6,
  );
  for (let ring = 0; ring < 10; ring++) {
    const distance = radius + 1.2 + ring * 2.2;
    for (let step = 0; step < 16; step++) {
      const angle = startAngle + (step / 16) * Math.PI * 2 + ring * 0.31;
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;
      if (!game.isPositionFree(px, pz, radius + 0.4)) continue;
      if (!clearOfUnits(px, pz) || !clearOfPatches(px, pz)) continue;
      return { x: px, z: pz };
    }
  }
  return null;
}
