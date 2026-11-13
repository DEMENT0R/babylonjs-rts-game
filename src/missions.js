// Кампания и испытания: данные миссий, цели и прогресс в localStorage.
//
// Миссия — это обычная партия на фиксированном сиде с дополнительными
// правилами: ограниченным набором построек и войск, целями и настройками ИИ.
// Движок не знает о сюжете: он получает объект миссии и проверяет её цели.

import { BUILDINGS } from './config.js';

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
    title: 'Высадка',
    subtitle: 'Закрепиться на плацдарме и уничтожить передовой командный центр «Беты».',
    seed: 0x51A7C0DE,
    map: mapOf('rot180', 'rust'),
    difficulty: 'easy',
    ai: { firstWave: 240, waveInterval: 100, income: 0.85 },
    buildings: BUILDINGS_EARLY,
    units: UNITS_EARLY,
    briefing: [
      'Связь с колонией-близнецом «Гелиос-7-Б» оборвалась на седьмые сутки. Последний принятый пакет приказа одинаков для обеих сторон: сектор останется за выжившей колонией.',
      'Ваш десант закрепился на пустынном плацдарме. Прежде чем идти дальше, нужно собрать казармы, поставить под ружьё первых пехотинцев и снести передовой КП противника.',
    ],
    outro: 'Плацдарм закреплён. Первый перехваченный приказ «Беты» подтверждает худшее: она знает о вас и уже строит казармы.',
    objectives: [
      {
        type: 'train',
        unit: 'marine',
        count: 4,
        title: 'Собрать отряд',
        desc: 'Постройте казармы и наймите четырёх пехотинцев.',
      },
      {
        type: 'destroyHQ',
        title: 'Уничтожить командный центр',
        desc: 'Сравняйте с землёй передовой КП «Беты».',
      },
    ],
  },
  {
    id: 'campaign-2',
    kind: 'campaign',
    index: 2,
    title: 'Нефтяная игла',
    subtitle: 'Захватить месторождения и лишить «Бету» топлива для бронетехники.',
    seed: 0x2B4F91A3,
    map: mapOf('axis-x', 'basalt'),
    difficulty: 'normal',
    ai: { firstWave: 150, waveInterval: 75, income: 1.05 },
    buildings: ['power', 'barracks', 'derrick', 'turret'],
    units: UNITS_EARLY,
    briefing: [
      'Плацдарм держится на одном месторождении, а «Бета» уже заняла два. Без нефти не будет ни казарм, ни турелей, ни топлива для танков.',
      'Разверните нефтяные вышки на нейтральных месторождениях и удержите их. Противник ответит быстро: на этом секторе топливо дороже людей.',
    ],
    outro: 'Топливо снова течёт в баки. Разведка доносит: следующая волна «Беты» уже грузится на платформы.',
    objectives: [
      {
        type: 'derricks',
        count: 5,
        title: 'Занять месторождения',
        desc: 'Постройте вышки так, чтобы под вашим контролем было пять нефтяных месторождений.',
      },
    ],
  },
  {
    id: 'campaign-3',
    kind: 'campaign',
    index: 3,
    title: 'Тихий сектор',
    subtitle: 'Подавить турельную линию и вскрыть оборону «Беты» на подступах к базе.',
    seed: 0x7C1E35D8,
    map: mapOf('diagonal', 'ochre'),
    difficulty: 'normal',
    ai: { firstWave: 170, waveInterval: 80, income: 1.05 },
    buildings: BUILDINGS_SUPPLY,
    units: UNITS_ARMOR,
    briefing: [
      'На подступах к базе «Беты» стоят две турели «Страж». Пехота там гибнет в первом же секторе обстрела, поэтому маршрут через открытое поле — не вариант.',
      'Тяжёлые цеха уже наладили выпуск скаутов и танков. Подавите огневые точки, затем сомкните кольцо вокруг командного центра противника.',
    ],
    outro: 'Турели смолкли. Дорога на базу «Беты» открыта, но в эфире всё чаще слышны её приказы — она готовит удар по вашему штабу.',
    setup: (game) => addEnemyTurrets(game, 2),
    objectives: [
      {
        type: 'destroyBuilding',
        building: 'turret',
        count: 2,
        title: 'Подавить турели',
        desc: 'Уничтожьте две турели на подступах к базе противника.',
      },
      {
        type: 'destroyHQ',
        title: 'Уничтожить командный центр',
        desc: 'Пока оборона вскрыта, снесите КП «Беты».',
      },
    ],
  },
  {
    id: 'campaign-4',
    kind: 'campaign',
    index: 4,
    title: 'Долгая смена',
    subtitle: 'Продержаться четыре минуты под непрерывными волнами «Беты».',
    seed: 0x0FD2A64B,
    map: mapOf('axis-z', 'ash'),
    difficulty: 'normal',
    ai: { firstWave: 110, waveInterval: 60, income: 1.1 },
    buildings: BUILDINGS_TECH,
    units: UNITS_TECH,
    briefing: [
      'Радиоэфир заполнен чужими приказами: «Бета» стянула к вашему сектору ударную группу. Эвакуация будет только через четыре минуты.',
      'Техцентр развёрнут, медики в строю. Укрепите периметр, выведите турели и держите линию. Победа здесь — не уничтожить врага, а не дать ему уничтожить вас.',
    ],
    outro: 'Волна отбита, эвакуационный коридор открыт. И тут же радио оживает: в эфире звучит ваш собственный голос — с той стороны.',
    objectives: [
      {
        type: 'survive',
        seconds: 240,
        title: 'Продержаться 4:00',
        desc: 'Не дайте уничтожить командный центр до окончания эвакуации.',
      },
    ],
  },
  {
    id: 'campaign-5',
    kind: 'campaign',
    index: 5,
    title: 'Дублёр',
    subtitle: 'Уничтожить последний командный центр «Беты» и закрыть контракт.',
    seed: 0x63D9B0E7,
    map: mapOf('anti-diagonal', 'rust'),
    difficulty: 'hard',
    ai: { firstWave: 90, waveInterval: 55, income: 1.1 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      'Последний пакет приказа всё ещё действителен: сектор останется за выжившей колонией. Теперь обе стороны знают, что «дублёр» — не метафора.',
      'У вас есть вся техника и весь арсенал. У «Беты» — то же самое, но она наступает первой. Соберите армию, найдите проход и уничтожьте её командный центр.',
    ],
    outro: 'Сектор наш. Контракт закрыт, но в реестре колоний по-прежнему два одинаковых имени — и одно из них вычеркнуто вашей рукой.',
    objectives: [
      {
        type: 'destroyHQ',
        title: 'Уничтожить КП «Беты»',
        desc: 'Сравняйте с землёй последний командный центр противника.',
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
    title: 'Первый удар',
    subtitle: 'Полный арсенал, сложный ИИ и всего полторы минуты до первой волны.',
    seed: 0x1A7E44C2,
    map: mapOf('rot180', 'basalt'),
    difficulty: 'hard',
    ai: { firstWave: 75, waveInterval: 50, income: 1.1 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      'Свободная партия на сложном противнике, но наступление начинается раньше обычного. Уничтожьте КП, пока не поздно.',
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: 'Уничтожить КП',
        desc: 'Снесите командный центр противника.',
      },
    ],
  },
  {
    id: 'trial-2',
    kind: 'trial',
    index: 2,
    title: 'Долгая ночь',
    subtitle: 'Шесть минут под волнами нарастающей силы. Победа — дожить.',
    seed: 0x5C0B93AF,
    map: mapOf('axis-x', 'ash'),
    difficulty: 'hard',
    ai: { firstWave: 45, waveInterval: 45, income: 1.15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      'Эвакуации не будет. Противник на сложном режиме начинает давить почти сразу и не останавливается. Задача — продержаться шесть минут.',
    ],
    objectives: [
      {
        type: 'survive',
        seconds: 360,
        title: 'Продержаться 6:00',
        desc: 'Сохраните командный центр до конца отчёта.',
      },
    ],
  },
  {
    id: 'trial-3',
    kind: 'trial',
    index: 3,
    title: 'Нефтяная блокада',
    subtitle: 'Шесть месторождений под контролем, но две нейтральные точки уже заняты «Бетой».',
    seed: 0x3E81D207,
    map: mapOf('diagonal', 'ochre'),
    difficulty: 'normal',
    ai: { firstWave: 120, waveInterval: 60, income: 1.1 },
    buildings: ['power', 'barracks', 'factory', 'derrick', 'turret', 'depot'],
    units: UNITS_ARMOR,
    briefing: [
      'Техцентра нет, танки и скауты есть. Захватите шесть месторождений: каждая вышка — это и доход, и цель для противника.',
      'Две нейтральные точки «Бета» уже застроила своими вышками. Их придётся снести, а место — занять.',
    ],
    setup: (game) => addEnemyDerricks(game, 2),
    objectives: [
      {
        type: 'derricks',
        count: 6,
        title: 'Занять шесть месторождений',
        desc: 'Постройте вышки на шести нефтяных месторождениях.',
      },
    ],
  },
  {
    id: 'trial-4',
    kind: 'trial',
    index: 4,
    title: 'Голыми руками',
    subtitle: 'Только инженеры и пехота против сложного ИИ.',
    seed: 0x74A25C19,
    map: mapOf('axis-z', 'rust'),
    difficulty: 'hard',
    ai: { firstWave: 240, waveInterval: 90, income: 1 },
    buildings: ['power', 'barracks', 'derrick'],
    units: UNITS_EARLY,
    briefing: [
      'Ни танков, ни турелей, ни техцентра. Всё, что есть, — инженеры, пехота и время до первой волны. Возьмите КП количеством.',
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: 'Уничтожить КП',
        desc: 'Пехотой и инженерами снесите командный центр противника.',
      },
    ],
  },
  {
    id: 'trial-5',
    kind: 'trial',
    index: 5,
    title: 'Турельная линия',
    subtitle: 'Четыре турели прикрывают базу. Сначала огневые точки, потом КП.',
    seed: 0x09C6F3B1,
    map: mapOf('anti-diagonal', 'basalt'),
    difficulty: 'hard',
    ai: { firstWave: 120, waveInterval: 60, income: 1.15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      'Противник выставил перед базой четыре турели «Страж» и держит сложный темп. Сначала подавите огневые точки, затем берите КП.',
    ],
    setup: (game) => addEnemyTurrets(game, 4),
    objectives: [
      {
        type: 'destroyBuilding',
        building: 'turret',
        count: 4,
        title: 'Подавить четыре турели',
        desc: 'Уничтожьте турельную линию перед базой.',
      },
      {
        type: 'destroyHQ',
        title: 'Уничтожить КП',
        desc: 'Снесите командный центр противника.',
      },
    ],
  },
  {
    id: 'trial-6',
    kind: 'trial',
    index: 6,
    title: 'На голодном пайке',
    subtitle: 'Без новых нефтяных вышек: только стартовый доход и один шанс.',
    seed: 0x2F58A9D4,
    map: mapOf('rot180', 'ash'),
    difficulty: 'normal',
    ai: { firstWave: 210, waveInterval: 80, income: 1.05 },
    buildings: ['power', 'barracks', 'factory', 'turret', 'depot'],
    units: UNITS_ARMOR,
    briefing: [
      'Новые вышки строить нельзя. Всё, что приносит кредиты, — стартовое месторождение. Успеете собрать армию до того, как противник задавит экономикой.',
    ],
    objectives: [
      {
        type: 'destroyHQ',
        title: 'Уничтожить КП',
        desc: 'Снесите командный центр противника на стартовом доходе.',
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
    title: 'Протокол «Дублёр»',
    subtitle: 'Держать оборону под бесконечными волнами автозаводов «Беты». Победить нельзя.',
    seed: 0x5EC7E7D0,
    map: mapOf('rot180', 'ash'),
    difficulty: 'hard',
    ai: { firstWave: 1e9, waveInterval: 1e9, income: 1 },
    endless: { firstWave: 45, interval: 45, decay: 0.93, minInterval: 15 },
    buildings: BUILDINGS_ALL,
    units: UNITS_ALL,
    briefing: [
      '«Бета» уничтожена, но её последний приказ всё ещё исполняется: автозаводы за периметром сектора продолжают выпускать подразделения. Уничтожить их отсюда невозможно.',
      'Победить в этой операции нельзя. Держите периметр, отбивайте волны и продержитесь как можно дольше — с каждой волной противник приходит чаще и тяжелее. Уничтожение базы «Беты» в секторе даёт лишь короткую передышку.',
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
