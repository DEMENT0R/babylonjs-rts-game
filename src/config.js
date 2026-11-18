// Баланс и константы игры.
import { t } from './i18n/index.js';
// Все размеры — в мировых единицах, время — в секундах.

export const MAP = {
  half: 110, // граница игровой зоны (квадрат ±110)
  clamp: 107, // предел движения юнитов
  ground: 600, // размер земли; должен перекрывать горы на горизонте
  edge: 8, // край декора, месторождений и тумана
  baseMargin: 12, // предел, за которым не ставятся стартовые базы
  // Абсолютные отступы размещения (не масштабируются вместе с картой).
  placement: {
    anchor: 4,
    power: 4,
    marine: 5,
    home: 7,
    barracks: 7,
    neutral: 9,
    center: 12,
    selfPoint: 10,
  },
};

// Компоновка стартовой базы и нейтральных объектов. Значения заданы в
// единицах «эталонной» карты ±MAP_LAYOUT.referenceHalf и в mapgen.js
// умножаются на масштаб S. Поэтому размер карты и габариты базы можно
// настраивать независимо: числа здесь отвечают за игру, а не за геометрию поля.
export const MAP_LAYOUT = {
  referenceHalf: 60,
  // Потолок масштаба компоновки: после него база перестаёт расти вместе с
  // картой, и на больших полях остаётся больше свободного места.
  maxScale: 1.5,

  // Стартовые базы.
  anchor: {
    edgeClear: 14, // отступ якоря от края карты
    minDistance: 78, // минимальный зазор между базами
    centerClear: 33, // ближе этого к центру карты база не ставится
    fallback: {
      rot180: { x: 40, z: 0 },
      'axis-x': { x: 0, z: 40 },
      'axis-z': { x: 40, z: 0 },
      diagonal: { x: 40, z: -8 },
      'anti-diagonal': { x: 40, z: 8 },
    },
  },

  // Электростанция: позади и сбоку от штаба.
  power: {
    back: [9.5, 12.5],
    lateral: [1.0, 3.8],
    minDistance: 10.5,
    fallbackBack: 11,
  },

  // Жилые модули — домашние месторождения.
  homes: {
    angle: [0.7, 1.55],
    distance: [14.5, 18.5],
    hqClear: 12.5,
    powerClear: 10.5,
    spacing: 9.5,
    fallbackDistance: 16,
  },

  // Стартовая пехота у штаба.
  marines: {
    forward: [7.2, 10.2],
    lateralStep: 3.1,
    lateralJitter: 1.1,
    hqClear: 7.0,
    powerClear: 5.4,
    patchClear: 7.0,
    spacing: 2.2,
    fallbackForward: 8,
  },

  // Казарма противника.
  barracks: {
    distance: [9.5, 14.5],
    angle: [0.45, 2.55],
    hqClear: 10,
    powerClear: 8.5,
    patchClear: 8.5,
    fallbackDistance: 11,
  },

  patchRadius: 4.4,

  // Нейтральные месторождения: отступы от баз и друг от друга.
  neutral: {
    hqClear: 23,
    powerClear: 15,
    patchClear: 12,
    selfClear: 18,
    barracksClear: 10,
  },

  // Руины стен.
  walls: {
    avoidBase: 15,
    avoidPower: 10,
    avoidBarracks: 10,
    avoidPatch: 7.5,
    avoidMarine: 5,
    minDistance: 12, // между зеркальными парами
    pairDistance: 3, // между половинами одной пары
    spacing: 6, // между отдельными сегментами
    length: [8, 15],
  },

  // Минимальные отступы декора от объектов.
  decor: {
    rock: {
      spacing: 8,
      baseHq: 16,
      basePower: 13,
      patch: 9.5,
      wall: 3.5,
    },
    crate: {
      spacing: 7,
      baseHq: 11,
      basePower: 9.5,
      patch: 8,
      wall: 3,
      rock: 5.5,
    },
    crystal: {
      baseHq: 9.5,
      basePower: 8,
      patch: 7,
      wall: 2.8,
      rock: 4.5,
      crate: 4,
      spacing: 6,
    },
    pebble: {
      baseHq: 7,
      basePower: 6,
      patch: 5.5,
      wall: 2,
    },
  },
};

// Плотность нейтральных объектов. Числа заданы для эталонной карты, а
// referenceScale переводит их в текущий масштаб. Одно значение на вид объекта,
// чтобы плотность правилась в одном месте, а не в арифметике генератора.
export const MAP_DENSITY = {
  referenceScale: 1.6,
  rocks: [8, 10], // пар
  crates: [3, 4], // пар
  crystals: 3, // кластеров
  crystalBurst: [3, 6], // кристаллов в кластере
  pebbles: [60, 85], // пар
  walls: [2, 3], // пар, вторая пара с шансом wallExtraChance
  wallExtraChance: 0.35,
};

export const CAMERA = {
  minRadius: 28,
  maxRadius: 150,
  startRadius: 86,
  minBeta: 0.62,
  maxBeta: 1.3,
  // Дальний отъезд смотрит сверху: от wideFrom до maxRadius камера плавно
  // наклоняется к wideBeta, иначе обзор «всей карты» получается вдоль земли.
  wideFrom: 110,
  wideBeta: 0.8,
  panSpeed: 1.35,
};

// Радиусы обзора для тумана войны: сколько карты открывает объект.
export const VISION = {
  unit: 13,
  building: 18,
  hq: 30,
};

// Сюжет: в сектор вошли два одинаковых семенных корабля программы «Гелиос-7».
// Это буквально копии друг друга — те же машины, те же чертежи, тот же приказ,
// поэтому у обеих сторон общие модели, техника и баланс.
export const FACTIONS = {
  player: {
    key: 'player',
    name: t('faction.player.name'),
    short: t('faction.player.short'),
    color: '#4fd2ff',
    ui: '#4fd2ff',
    hp: '#54e0ff',
    primary: '#2c6f9c',
    secondary: '#1a3c52',
    dark: '#0f2230',
    light: '#8fd6ef',
    accent: '#4fe0ff',
    glow: '#66ecff',
  },
  enemy: {
    key: 'enemy',
    name: t('faction.enemy.name'),
    short: t('faction.enemy.short'),
    color: '#ff6b4a',
    ui: '#ff6b4a',
    hp: '#ff5b3c',
    primary: '#96372b',
    secondary: '#4a1c16',
    dark: '#24100d',
    light: '#e28a70',
    accent: '#ff6b3d',
    glow: '#ff4b2b',
  },
};

export const START = {
  credits: 500,
  // Лимит армии считается по зданиям: командный центр даёт 10, жилой модуль — ещё 10.
  armyCap: 10,
  // Стартовые позиции баз и месторождений строит генератор карт (mapgen.js).
  player: {
    marines: 2,
    engineers: 1,
  },
  enemy: {
    marines: 3,
    engineers: 1,
  },
};

// Строительство: недоделанное здание не должно иметь полный запас прочности.
export const CONSTRUCTION = {
  // Доля максимальной прочности сразу после закладки. Дальше она растёт
  // линейно до 100% вместе с прогрессом стройки.
  minHpFraction: 0.1,
};

// order — порядок кнопок в командной панели.
export const BUILD_ORDER = [
  'power', 'barracks', 'factory', 'derrick', 'lab', 'engineering', 'rear', 'turret', 'depot', 'wall',
];
export const BUILD_HOTKEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];
// Найм внутри одного производственного здания: клавиши выдаются по порядку.
export const TRAIN_HOTKEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
// Инженер нанимается в штабе, где те же клавиши заняты стройкой.
export const HQ_TRAIN_HOTKEYS = ['G'];

// Поддержка в поле: медики лечат пехоту, инженеры ремонтируют технику.
export const FIELD_SUPPORT = {
  // Радиус, в котором медик ищет раненого пехотинца.
  medicSeekRadius: 13,
  // С какой дистанции (от края цели) медик начинает лечить.
  medicRange: 7,
  medicRate: 10,
  // Инженер идёт к повреждённой машине в этом радиусе.
  engineerSeekRadius: 10,
  engineerRange: 5.5,
  engineerRate: 14,
};

// Улучшения техцентра: линии исследований. Каждая линия покупается по
// уровням; эффект действует на всех юнитов или здания указанного типа — и на
// уже построенные, и на будущие. scope задаёт, к чему применяется эффект:
// unit — юниты, building — постройки, global — вся колония.
export const UPGRADES = {
  marine: {
    key: 'marine',
    line: 'marine',
    tier: 1,
    name: t('upgrade.marine.name'),
    role: t('role.infantry'),
    icon: 'marine',
    desc: t('upgrade.marine.desc'),
    cost: 220,
    time: 65,
    scope: 'unit',
    target: 'marine',
    effects: { damage: 1.35, hp: 1.25 },
  },
  marine2: {
    key: 'marine2',
    line: 'marine',
    tier: 2,
    requires: 'marine',
    name: t('upgrade.marine2.name'),
    role: t('role.infantry'),
    icon: 'marine',
    desc: t('upgrade.marine2.desc'),
    cost: 360,
    time: 95,
    scope: 'unit',
    target: 'marine',
    effects: { pierce: 2 },
  },
  scout: {
    key: 'scout',
    line: 'scout',
    tier: 1,
    name: t('upgrade.scout.name'),
    role: t('role.recon'),
    icon: 'scout',
    desc: t('upgrade.scout.desc'),
    cost: 240,
    time: 65,
    scope: 'unit',
    target: 'scout',
    effects: { speed: 1.3, damage: 1.2 },
  },
  scout2: {
    key: 'scout2',
    line: 'scout',
    tier: 2,
    requires: 'scout',
    name: t('upgrade.scout2.name'),
    role: t('role.recon'),
    icon: 'scout',
    desc: t('upgrade.scout2.desc'),
    cost: 400,
    time: 95,
    scope: 'unit',
    target: 'scout',
    effects: { visionAdd: 5, speed: 1.1 },
  },
  tank: {
    key: 'tank',
    line: 'tank',
    tier: 1,
    name: t('upgrade.tank.name'),
    role: t('role.vehicle'),
    icon: 'tank',
    desc: t('upgrade.tank.desc'),
    cost: 360,
    time: 95,
    scope: 'unit',
    target: 'tank',
    effects: { hp: 1.35, armor: 2 },
  },
  tank2: {
    key: 'tank2',
    line: 'tank',
    tier: 2,
    requires: 'tank',
    name: t('upgrade.tank2.name'),
    role: t('role.vehicle'),
    icon: 'tank',
    desc: t('upgrade.tank2.desc'),
    cost: 600,
    time: 130,
    scope: 'unit',
    target: 'tank',
    effects: { splash: 1.3 },
  },
  artillery: {
    key: 'artillery',
    line: 'artillery',
    tier: 1,
    name: t('upgrade.artillery.name'),
    role: t('role.artillery'),
    icon: 'artillery',
    desc: t('upgrade.artillery.desc'),
    cost: 380,
    time: 100,
    scope: 'unit',
    target: 'artillery',
    effects: { damage: 1.25, range: 1.2 },
  },
  artillery2: {
    key: 'artillery2',
    line: 'artillery',
    tier: 2,
    requires: 'artillery',
    name: t('upgrade.artillery2.name'),
    role: t('role.artillery'),
    icon: 'artillery',
    desc: t('upgrade.artillery2.desc'),
    cost: 640,
    time: 145,
    scope: 'unit',
    target: 'artillery',
    effects: { salvoAdd: 1, cooldown: 1.15 },
  },
  rockets: {
    key: 'rockets',
    line: 'rockets',
    tier: 1,
    name: t('upgrade.rockets.name'),
    role: t('role.artillery'),
    icon: 'artillery',
    desc: t('upgrade.rockets.desc'),
    cost: 420,
    time: 90,
    scope: 'global',
    target: null,
    unlocks: ['artillery'],
    effects: {},
  },
  medic: {
    key: 'medic',
    line: 'medic',
    tier: 1,
    name: t('upgrade.medic.name'),
    role: t('role.medicine'),
    icon: 'medic',
    desc: t('upgrade.medic.desc'),
    cost: 260,
    time: 70,
    scope: 'unit',
    target: 'medic',
    effects: { healRate: 1.4, healRadius: 1.2 },
  },
  engineer: {
    key: 'engineer',
    line: 'engineer',
    tier: 1,
    name: t('upgrade.engineer.name'),
    role: t('role.engineering'),
    icon: 'engineer',
    desc: t('upgrade.engineer.desc'),
    cost: 280,
    time: 80,
    scope: 'unit',
    target: 'engineer',
    effects: { repairRate: 1.4, buildSpeed: 1.25 },
  },
  turret: {
    key: 'turret',
    line: 'turret',
    tier: 1,
    name: t('upgrade.turret.name'),
    role: t('role.defense'),
    icon: 'turret',
    desc: t('upgrade.turret.desc'),
    cost: 360,
    time: 85,
    scope: 'building',
    target: 'turret',
    effects: { damage: 1.15, range: 1.18 },
  },
  structures: {
    key: 'structures',
    line: 'structures',
    tier: 1,
    name: t('upgrade.structures.name'),
    role: t('role.construction'),
    icon: 'wall',
    desc: t('upgrade.structures.desc'),
    cost: 340,
    time: 85,
    scope: 'building',
    target: 'building',
    effects: { hp: 1.25 },
  },
  income: {
    key: 'income',
    line: 'income',
    tier: 1,
    name: t('upgrade.income.name'),
    role: t('role.economy'),
    icon: 'derrick',
    desc: t('upgrade.income.desc'),
    cost: 360,
    time: 85,
    scope: 'global',
    target: null,
    effects: { income: 1.2 },
  },
  maintenance: {
    key: 'maintenance',
    line: 'maintenance',
    tier: 1,
    name: t('upgrade.maintenance.name'),
    role: t('role.supply'),
    icon: 'repair',
    desc: t('upgrade.maintenance.desc'),
    cost: 320,
    time: 80,
    scope: 'global',
    target: null,
    effects: { repairCost: 0.75 },
  },
  logistics: {
    key: 'logistics',
    line: 'logistics',
    tier: 1,
    name: t('upgrade.logistics.name'),
    role: t('role.logistics'),
    icon: 'move',
    desc: t('upgrade.logistics.desc'),
    cost: 340,
    time: 85,
    scope: 'global',
    target: null,
    effects: { trainTime: 0.8, buildTime: 0.8 },
  },
  reserve: {
    key: 'reserve',
    line: 'reserve',
    tier: 1,
    name: t('upgrade.reserve.name'),
    role: t('role.armyCap'),
    icon: 'army',
    desc: t('upgrade.reserve.desc'),
    cost: 400,
    time: 95,
    scope: 'global',
    target: null,
    effects: { armyCap: 5 },
  },
  energy: {
    key: 'energy',
    line: 'energy',
    tier: 1,
    name: t('upgrade.energy.name'),
    role: t('role.power'),
    icon: 'power',
    desc: t('upgrade.energy.desc'),
    cost: 380,
    time: 90,
    scope: 'building',
    target: 'power',
    effects: { powerProduce: 1.5 },
  },
};

// Линии исследований в порядке кнопок. Поле building говорит, в каком здании
// покупается линия: техцентр — пехота, инженерный корпус — техника, центр
// тыла — база и экономика.
export const UPGRADE_LINES = [
  { key: 'marine', category: 'army', building: 'lab' },
  { key: 'scout', category: 'army', building: 'engineering' },
  { key: 'tank', category: 'army', building: 'engineering' },
  { key: 'artillery', category: 'army', building: 'engineering' },
  { key: 'rockets', category: 'army', building: 'engineering' },
  { key: 'medic', category: 'army', building: 'lab' },
  { key: 'engineer', category: 'army', building: 'lab' },
  { key: 'turret', category: 'base', building: 'rear' },
  { key: 'structures', category: 'base', building: 'rear' },
  { key: 'income', category: 'base', building: 'rear' },
  { key: 'maintenance', category: 'base', building: 'rear' },
  { key: 'logistics', category: 'base', building: 'rear' },
  { key: 'reserve', category: 'base', building: 'rear' },
  { key: 'energy', category: 'base', building: 'rear' },
];

// Линия → тип здания, где её исследуют. Одна точка правды для UI и ИИ.
export const UPGRADE_BUILDING = Object.fromEntries(
  UPGRADE_LINES.map((line) => [line.key, line.building]),
);

// Все уровни каждой линии по порядку: по ним UI и ИИ находят следующий.
export const UPGRADE_LINE_KEYS = {
  marine: ['marine', 'marine2'],
  scout: ['scout', 'scout2'],
  tank: ['tank', 'tank2'],
  artillery: ['artillery', 'artillery2'],
  rockets: ['rockets'],
  medic: ['medic'],
  engineer: ['engineer'],
  turret: ['turret'],
  structures: ['structures'],
  income: ['income'],
  maintenance: ['maintenance'],
  logistics: ['logistics'],
  reserve: ['reserve'],
  energy: ['energy'],
};

export const UNITS = {
  engineer: {
    key: 'engineer',
    name: t('unit.engineer.name'),
    role: t('role.builder'),
    icon: 'engineer',
    desc: t('unit.engineer.desc'),
    cost: 70,
    supply: 1,
    buildTime: 10,
    hp: 90,
    armor: 0,
    radius: 0.95,
    speed: 8.2,
    range: 7,
    damage: 4,
    cooldown: 1.0,
    aggro: 11,
    height: 2.4,
    projectile: 'bullet',
    muzzleHeight: 1.45,
    from: 'hq',
    builder: true,
    repairer: true,
    infantry: true,
    // Диаметр гильзы в мировых единицах: пропорционален калибру оружия.
    casing: 0.06,
  },
  marine: {
    key: 'marine',
    name: t('unit.marine.name'),
    role: t('role.infantry'),
    icon: 'marine',
    desc: t('unit.marine.desc'),
    cost: 60,
    supply: 1,
    buildTime: 8,
    hp: 110,
    armor: 0,
    radius: 0.95,
    speed: 7.2,
    range: 11,
    damage: 8,
    cooldown: 0.55,
    aggro: 18,
    height: 2.5,
    projectile: null,
    muzzleHeight: 1.55,
    from: 'barracks',
    infantry: true,
    casing: 0.08,
  },
  scout: {
    key: 'scout',
    name: t('unit.scout.name'),
    role: t('role.recon'),
    icon: 'scout',
    desc: t('unit.scout.desc'),
    cost: 85,
    supply: 2,
    buildTime: 7,
    hp: 80,
    armor: 0,
    radius: 0.9,
    speed: 11.5,
    range: 9,
    damage: 5,
    cooldown: 0.3,
    aggro: 16,
    height: 2,
    projectile: null,
    muzzleHeight: 1.1,
    from: 'factory',
    vehicle: true,
    casing: 0.1,
  },
  tank: {
    key: 'tank',
    name: t('unit.tank.name'),
    role: t('role.vehicle'),
    icon: 'tank',
    desc: t('unit.tank.desc'),
    cost: 170,
    supply: 4,
    buildTime: 18,
    hp: 330,
    armor: 2,
    radius: 1.7,
    speed: 5.0,
    range: 15,
    damage: 26,
    cooldown: 1.5,
    aggro: 22,
    splash: 2.7,
    height: 3,
    projectile: 'shell',
    muzzleHeight: 2.1,
    from: 'factory',
    vehicle: true,
    casing: 0.24,
  },
  artillery: {
    key: 'artillery',
    name: t('unit.artillery.name'),
    role: t('role.artillery'),
    icon: 'artillery',
    desc: t('unit.artillery.desc'),
    cost: 360,
    supply: 6,
    buildTime: 26,
    hp: 170,
    armor: 0,
    radius: 2.1,
    speed: 3.7,
    range: 34,
    damage: 18,
    cooldown: 8.5,
    aggro: 40,
    splash: 4.1,
    // Ракеты накрывают площадь без разбора: свои юниты, здания и сама
    // установка получают полный урон, если попали в зону залпа.
    friendlyFire: 1,
    salvo: 5,
    salvoDelay: 0.22,
    salvoSpread: 3.4,
    height: 3.4,
    projectile: 'rocket',
    muzzleHeight: 2.1,
    from: 'factory',
    vehicle: true,
    requires: 'rockets',
  },
  medic: {
    key: 'medic',
    name: t('unit.medic.name'),
    role: t('role.medicine'),
    icon: 'medic',
    desc: t('unit.medic.desc'),
    cost: 80,
    supply: 1,
    buildTime: 9,
    hp: 95,
    armor: 0,
    radius: 0.95,
    speed: 7.6,
    range: 0,
    damage: 0,
    cooldown: 1,
    aggro: 0,
    height: 2.35,
    projectile: null,
    muzzleHeight: 1.55,
    from: 'barracks',
    healer: true,
    infantry: true,
  },
};

// Какие юниты нанимает каждое здание: единственный источник правды для
// панелей найма, подсказок и ИИ. Порядок юнитов в UNITS задаёт горячие клавиши.
export const UNIT_PRODUCTION = {};
for (const [key, def] of Object.entries(UNITS)) {
  (UNIT_PRODUCTION[def.from] ??= []).push(key);
}

export const BUILDINGS = {
  hq: {
    key: 'hq',
    name: t('building.hq.name'),
    role: t('role.hq'),
    icon: 'hq',
    desc: t('building.hq.desc'),
    cost: 0,
    buildTime: 0,
    hp: 1800,
    armor: 3,
    radius: 5.4,
    height: 10,
    powerProduce: 5,
    powerUse: 0,
    armyCap: 10,
    from: 'hq',
  },
  power: {
    key: 'power',
    name: t('building.power.name'),
    role: t('role.power'),
    icon: 'power',
    desc: t('building.power.desc'),
    cost: 100,
    buildTime: 12,
    hp: 480,
    armor: 2,
    radius: 3.6,
    height: 7,
    powerProduce: 10,
    powerUse: 0,
    from: 'hq',
  },
  barracks: {
    key: 'barracks',
    name: t('building.barracks.name'),
    role: t('role.military'),
    icon: 'barracks',
    desc: t('building.barracks.desc'),
    cost: 160,
    buildTime: 20,
    hp: 900,
    armor: 3,
    radius: 3.6,
    height: 5.6,
    powerProduce: 0,
    powerUse: 5,
    from: 'hq',
    requires: ['power'],
  },
  factory: {
    key: 'factory',
    name: t('building.factory.name'),
    role: t('role.military'),
    icon: 'factory',
    desc: t('building.factory.desc'),
    cost: 190,
    buildTime: 22,
    hp: 950,
    armor: 3,
    radius: 4.0,
    height: 6.0,
    powerProduce: 0,
    powerUse: 5,
    from: 'hq',
    requires: ['barracks'],
  },
  derrick: {
    key: 'derrick',
    name: t('building.derrick.name'),
    role: t('role.economy'),
    icon: 'derrick',
    desc: t('building.derrick.desc'),
    cost: 110,
    buildTime: 10,
    hp: 380,
    armor: 1,
    radius: 2.8,
    height: 8,
    powerProduce: 0,
    powerUse: 2,
    income: 2.2,
    from: 'hq',
    requires: ['power'],
  },
  turret: {
    key: 'turret',
    name: t('building.turret.name'),
    role: t('role.turret'),
    requires: ['barracks'],
    icon: 'turret',
    desc: t('building.turret.desc'),
    cost: 160,
    buildTime: 18,
    hp: 720,
    armor: 4,
    radius: 2.8,
    height: 4.6,
    powerProduce: 0,
    powerUse: 3,
    from: 'hq',
    defense: {
      range: 17,
      damage: 18,
      cooldown: 0.9,
      aggro: 20,
      projectile: 'bullet',
      muzzleHeight: 2.7,
      casing: 0.18,
    },
  },
  wall: {
    key: 'wall',
    name: t('building.wall.name'),
    role: t('role.defense'),
    requires: ['barracks'],
    icon: 'wall',
    desc: t('building.wall.desc'),
    cost: 30,
    buildTime: 5,
    hp: 420,
    armor: 3,
    radius: 2.4,
    height: 3.0,
    powerProduce: 0,
    powerUse: 0,
    from: 'hq',
  },
  depot: {
    key: 'depot',
    name: t('building.depot.name'),
    role: t('role.armyCap'),
    requires: ['barracks'],
    icon: 'depot',
    desc: t('building.depot.desc'),
    cost: 130,
    buildTime: 16,
    hp: 620,
    armor: 2,
    radius: 3.2,
    height: 5.4,
    powerProduce: 0,
    powerUse: 3,
    armyCap: 10,
    from: 'hq',
  },
  lab: {
    key: 'lab',
    name: t('building.lab.name'),
    role: t('role.research'),
    icon: 'lab',
    research: true,
    desc: t('building.lab.desc'),
    requires: ['barracks'],
    cost: 240,
    buildTime: 24,
    hp: 700,
    armor: 2,
    radius: 3.4,
    height: 5.8,
    powerProduce: 0,
    powerUse: 6,
    from: 'hq',
  },
  engineering: {
    key: 'engineering',
    name: t('building.engineering.name'),
    role: t('role.research'),
    icon: 'engineering',
    research: true,
    desc: t('building.engineering.desc'),
    requires: ['factory'],
    cost: 260,
    buildTime: 26,
    hp: 760,
    armor: 2,
    radius: 3.6,
    height: 6.0,
    powerProduce: 0,
    powerUse: 6,
    from: 'hq',
  },
  rear: {
    key: 'rear',
    name: t('building.rear.name'),
    role: t('role.rear'),
    icon: 'rear',
    research: true,
    desc: t('building.rear.desc'),
    cost: 300,
    buildTime: 28,
    hp: 800,
    armor: 2,
    radius: 3.8,
    height: 6.0,
    powerProduce: 0,
    powerUse: 6,
    from: 'hq',
    requires: ['lab', 'engineering'],
  },
};

export const COLORS = {
  ground: '#6f5c45',
  ui: {
    cyan: '#4fd2ff',
    amber: '#ffb02e',
    red: '#ff4b3e',
    green: '#63e6a8',
  },
};

export const AI = {
  firstWave: 135,
  waveInterval: 80,
  // Сколько волн ИИ помнит и через сколько секунд считает волну
  // «застрявшей», даже если часть отряда ещё жива.
  waveLogSize: 5,
  waveTimeout: 75,
  // Волна идёт к цели пешком: время марша (по скорости пехоты) добавляется
  // к таймауту, иначе на просторной карте отряд отзывается, не дойдя до боя.
  marchSpeed: UNITS.marine.speed,
  // Во сколько раз отряд должен превосходить известную оборону цели, чтобы
  // атака имела смысл. Иначе ИИ копит силы, а не кормит турели.
  requiredAdvantage: 1.35,
  // Порог «явно слабее»: пока собственная армия меньше разведанной армии
  // игрока, умноженной на это число, волны откладываются до набора сил.
  // Оценка строится только по видимым войскам и последней разведсводке.
  attackPowerRatio: 0.8,
  // Сколько секунд разведсводка о войсках игрока остаётся актуальной после
  // последнего наблюдения. Пока она свежа, ИИ опирается на неё в решении
  // об атаке; устаревшие данные не запирают его в обороне навсегда.
  intelMemory: 90,
  // Терпение: каждая отложенная волна немного снижает требуемое
  // превосходство. Иначе три турели у штаба могут навсегда остановить
  // наступление, и ИИ выглядит сломанным.
  patienceStep: 0.04,
  maxPatienceDiscount: 0.2,
  // Радиус, в котором ИИ оценивает оборону вокруг цели.
  defenseRadius: 30,
  // Стены не стреляют, но линия баррикад всё равно осложняет штурм.
  wallDefenseValue: 8,
  // Пауза, когда сил не хватает: армия продолжает расти.
  regroupDelay: 15,
  // Минимальный размер волны и прибавка за каждый недавний разгром.
  minWaveSquad: 3,
  wipeSquadBonus: 2,
  // Резерв снабжения, который волна старается оставить у базы: сверх
  // позиционного гарнизона, если мощи отряда хватает и без этих бойцов.
  waveHomeReserve: 2,
  // Порог боевой мощи волны (боевая ценность: пехотинец ≈ 22, танк ≈ 82).
  // Пока отряд не набрал столько, противник не наступает, а копит силы: иначе
  // в бой уходили два-три случайных бойца и гибли без результата. Порог
  // растёт с каждой отправленной волной, поэтому поздние удары крупнее.
  waveBasePower: 100,
  wavePowerStep: 12,
  // Разведка боем — исключение: её задача проверить оборону, а не пробить
  // её, поэтому ей достаточно небольшого отряда.
  probePower: 44,
  // Сколько секунд цель считается «горячей» после провальной волны.
  targetCooldown: 75,
  // Волна, нанёсшая меньше урона и не убившая никого, тоже считается провалом.
  weakWaveDamage: 80,
  // Когда отряд теряет эту долю состава, ничего не сделав, он отходит к сбору.
  retreatSupplyRatio: 0.5,
  // Не отступать в первые секунды боя: иначе отряд дрогнет от пары попаданий.
  retreatGrace: 8,
  // Осторожность волны: если вокруг отряда видно превосходящие силы игрока,
  // он уходит к укрытию, не дожидаясь потерь. Оценка — через defenseAt, то
  // есть только по разведанным войскам и известным постройкам, без подглядывания.
  cautionRatio: 1.5,
  cautionRadius: 28,
  cautionGrace: 4,
  cautionInterval: 0.5,
  // Точка укрытия: за ближайшей своей турелью, иначе гарнизонная точка у базы.
  shelterTurretOffset: 4.5,
  // Сколько секунд отведённый отряд не забирают в новые волны и разведку:
  // он успевает дойти до укрытия, а не разворачивается на полпути.
  shelterRest: 20,
  // Опытные бойцы и техника выходят из боя при низкой прочности: потеря
  // ветерана дороже потери позиции. Пехота — с этого ранга, танки и РСЗО —
  // уже с первого.
  veteranRank: 2,
  veteranVehicleRank: 1,
  veteranRetreatHp: 0.35,
  veteranVehicleRetreatHp: 0.45,
  veteranThreatRadius: 26,
  veteranShelterTime: 20,
  // Осадный ответ на укрепления. Против турелей пехота и танки гибнут в их
  // секторе обстрела, а РСЗО бьёт с 34 единиц вне ответного огня. Поэтому ИИ
  // целенаправленно добирает осадное звено, а не ждёт случайного состава.
  siegeFortificationThreshold: 2,
  siegeArtilleryCap: 3,
  siegeArtilleryFrom: 100,
  // Одна РСЗО против турельной линии стоит в оценке больше, чем в поле:
  // без этой поправки ИИ требовал для штурма непомерную армию.
  siegeArtilleryBonus: 2.2,
  // Радиус, в котором у цели ищутся известные турели и баррикады.
  fortificationRadius: 45,
  // Шанс ответить на разгром от армии рейдом по экономике, а не новым штурмом.
  raidAfterArmyLoss: 0.5,
  // Выбор цели рейда: далеко от разведанной армии игрока и там, где оборона
  // слабее. Бонус за вышку остаётся: экономика по-прежнему вкусна.
  raidArmyDistanceWeight: 1,
  raidDefenseWeight: 0.5,
  raidDerrickBonus: 14,
  raidRandomness: 10,
  // Фланговый маршрут волны. Точка обхода ставится на этой доле пути
  // база→цель и выносится вбок на долю дистанции между базами. Поворот на
  // цель выдаётся, когда до точки дошла нужная доля отряда, либо по таймауту.
  flankRouteAt: 0.6,
  flankRouteOffset: 0.4,
  flankRouteArrive: 0.6,
  flankRouteRadius: 12,
  flankRouteGrace: 10,
  // Вторая половина «split» выходит с задержкой, чтобы обе группы подошли
  // к своим целям одновременно, а не шли одной колонной.
  splitDelayShare: 0.7,
  // Разведка боем: слабой считается оборона дешевле этого порога. Найдя её,
  // противник идёт в атаку почти сразу и не требует лишнего перевеса.
  probeWeakDefense: 120,
  probeIntelFresh: 60,
  probePunishDelay: 10,
  probePunishDiscount: 0.25,
  // С какого радиуса волна подходит к штабу игрока.
  assaultApproachRadius: 13,
  // На просторной карте радиус подхода растёт вместе с дистанцией между
  // базами: доля дистанции и потолок. Иначе обход всегда был бы короче
  // коридора, который игрок успевает простреливать.
  approachDistanceShare: 0.3,
  assaultApproachMax: 40,
  // Радиус, в котором разведанные войска игрока делают точку подхода
  // опасной: волна не должна сама влезать в готовую засаду.
  approachArmyRadius: 20,
  baseIncome: 1.0,
  credits: 300,
  // Запас энергии: при остатке меньше этого противник строит электростанцию
  // заранее, не дожидаясь дефицита и трёхкратного замедления производства.
  powerReserve: 6,
  // Целевой лимит армии под следующую волну: 12 на старте и +5 за каждую
  // отправленную. Жилые модули закладываются заранее, под план, а не по
  // факту заполнения лимита.
  armyCapPlan: 12,
  armyCapPerWave: 5,
  defendRadius: 30,
  // Позиционный гарнизон: столько лимита противник всегда держит у базы. Гарнизон
  // ищется в этом радиусе от штаба и занимает позицию под передней турелью,
  // а не бежит за каждым разведчиком.
  garrisonSupply: 4,
  garrisonRadius: 26,
  garrisonHoldRadius: 13,
  // Оборона базы: турели ставятся на ось удара, а не в случайное кольцо.
  // Третья и следующие турели прикрывают дальние вышки.
  turretCap: 4,
  derrickTurretRadius: 22,
  // Баррикады перед базой: сколько сегментов и на каком удалении от штаба.
  // В центре линии остаётся проход для своих волн.
  wallCap: 6,
  // Линия стоит перед передними турелями, чтобы не перекрывать проход.
  wallDistance: 24,
  // Оборона построек: угрозу видно заранее — и обстрел, и враг рядом, —
  // поэтому помощь идут ближайшие свободные бойцы, а если рядом никого нет,
  // подходят с базы, пока сама база не осталась без гарнизона.
  structureGuardRadius: 30,
  structureGuardCount: 3,
  structureThreatRadius: 15,
  structureHitWindow: 10,
  structureCallRadius: 90,
  // Сколько снабжения至少要 остаться у штаба, когда защитников снимают с
  // базы: базу без единого бойца оставлять нельзя.
  structureHomeReserve: 2,
  // Караул на вышках: месторождения вдали от базы турели не прикрывают,
  // поэтому на самой уязвимой вышке дежурит боец.
  oilPicketCount: 1,
  oilPicketRadius: 20,
  // Экономика: если противник не может нанять даже пехотинца, он не начинает
  // волны и почти не рискует разведкой, а копит силы у базы. Порог — цена
  // самого дешёвого бойца; затянувшееся безденежье измеряется в секундах,
  // чтобы короткие паузы между наймом юнитов не считались голодом.
  economyCredits: 60,
  starvedDelay: 15,
  // Найм и стройка делят доход. Пока копится на план, казармы ждут не дольше
  // этого (срочные стройки — вдвое дольше), затем покупают одного бойца и
  // окно ожидания начинается заново.
  savePatience: 20,
  savePatienceUrgent: 40,
  // Разведка бедного противника: один боец и заметно реже. Позиционный гарнизон
  // остаётся на базе, чтобы разведчик не оголял оборону.
  scoutWeakInterval: 26,
  // Память о потерях разведки: столько секунд место гибели разведчика делает
  // маршруты рядом с собой дороже, а радиус и вес задают силу этого штрафа.
  // Без памяти ИИ водил новых бойцов по одной и той же тропе на турели.
  scoutLossMemory: 150,
  scoutLossRadius: 22,
  scoutDangerWeight: 2,
  // Разведчик отходит, если потерял столько прочности или попал под огонь:
  // бойца дешевле вернуть, чем потерять. Затянувшийся выход тоже прерывается,
  // а после возвращения разведчик отдыхает у базы и снова доступен армии.
  scoutRetreatHp: 0.6,
  scoutRetreatHitWindow: 2.5,
  scoutMaxTime: 45,
  scoutRest: 20,
  // Сколько свободных бойцов обязано остаться у базы: разведка не забирает
  // тех, из кого противник собирает волну.
  scoutArmyReserve: 3,
  // Дополнительный зазор между зданиями противника: findPlacement проверяет только
  // касание, поэтому просторную застройку задаёт сам ИИ.
  buildSpacing: 3.2,
  // Инженер — самый ценный юнит ИИ: получив сигнал об атаке, гарнизон
  // выдвигается на защиту в этом радиусе.
  engineerGuardRadius: 46,
  engineerGuardCount: 3,
  // Третий инженер появляется, когда в армии уже есть техника: двое могут
  // уйти с машинами, один остаётся на стройке и ремонте базы.
  engineerThirdAt: 150,
  // Поддержка в волнах идёт сверх слотов бойцов, иначе она разбавляет отряд,
  // не добавляя ему мощи. Один медик на столько пехотинцев в отряде, один
  // инженер на столько машин, плюс потолки на волну.
  waveMedicPer: 4,
  waveMedicCap: 2,
  waveEngineerPer: 3,
  waveEngineerCap: 2,
  // Насколько поддержка отстаёт от точки атаки, чтобы не идти в первый ряд.
  supportTrail: 6,
};

// Пресеты сложности: не отдельные ветки ИИ, а набор флагов и множителей
// поверх одного поведения. Ключи совпадают с тем, что хранится в настройках.
// armyCap — потолок лимита армии противника (в единицах снабжения): даже
// с жилыми модулями он не растит бесконечную армию. depotCap — сколько
// модулей противник ставит максимум; он должен покрывать потолок, иначе
// тот недостижим (штаб даёт 10, каждый модуль — ещё 10).
export const AI_DIFFICULTY = {
  easy: {
    key: 'easy',
    name: t('ai.easy.name'),
    desc: t('ai.easy.desc'),
    armyCap: 64,
    depotCap: 6,
    income: 0.85,
    waveInterval: 1.3,
    firstWave: 1.15,
    requiredAdvantage: 0.9,
    memory: false,
    targetCooldown: false,
    retreat: false,
    counter: false,
    avoidTurrets: false,
  },
  normal: {
    key: 'normal',
    name: t('ai.normal.name'),
    desc: t('ai.normal.desc'),
    armyCap: 64,
    depotCap: 6,
    income: 1,
    waveInterval: 1,
    firstWave: 1,
    requiredAdvantage: 1.35,
    memory: true,
    targetCooldown: true,
    retreat: true,
    counter: true,
    avoidTurrets: true,
  },
  hard: {
    key: 'hard',
    name: t('ai.hard.name'),
    desc: t('ai.hard.desc'),
    armyCap: 96,
    depotCap: 9,
    income: 1.1,
    waveInterval: 0.9,
    firstWave: 0.9,
    requiredAdvantage: 1.5,
    memory: true,
    targetCooldown: true,
    retreat: true,
    counter: true,
    avoidTurrets: true,
  },
};

export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard'];

export const REPAIR = {
  // Полный ремонт занимает столько секунд при непрерывной оплате.
  duration: 18,
  // Доля стоимости здания за восстановление всех его HP.
  costFraction: 0.85,
  // Для командного центра нет цены постройки — задаём цену за HP отдельно.
  hqCostPerHp: 0.35,
};

// Ветеранство: опыт юнит копит за урон по противнику, поддержку и добивание.
// Ранг повышает урон и запас прочности, поэтому ветеран стоит двух новобранцев.
export const VETERANCY = {
  names: [t('veteran.rank0'), t('veteran.rank1'), t('veteran.rank2'), t('veteran.rank3')],
  // Порог опыта для каждого ранга; первый ранг — с нуля.
  thresholds: [0, 140, 400, 900],
  // Множители характеристик по рангу.
  damage: [1, 1.1, 1.2, 1.35],
  hp: [1, 1.1, 1.2, 1.35],
  // Опыт за единицу нанесённого урона, за убийство и за единицу поддержки.
  xpPerDamage: 1,
  killXp: 40,
  supportXp: 0.5,
};

/** Ранг по накопленному опыту: 0 — рядовой, 3 — легенда. */
export function veteranRank(xp = 0) {
  let rank = 0;
  for (let i = 1; i < VETERANCY.thresholds.length; i++) {
    if (xp >= VETERANCY.thresholds[i]) rank = i;
  }
  return rank;
}

export const SELL = {
  // Доля стоимости здания, возвращаемая при продаже.
  refund: 0.5,
};

export const MESSAGES = {
  lowPower: t('message.lowPower'),
  noCredits: t('message.noCredits'),
  notReady: t('message.notReady'),
  capReached: t('message.capReached'),
  badPlace: t('message.badPlace'),
  needExplore: t('message.needExplore'),
  unitOnSite: t('message.unitOnSite'),
  placementBounds: t('message.placementBounds'),
  placementRock: t('message.placementRock'),
  placementWall: t('message.placementWall'),
  placementBuilding: t('message.placementBuilding'),
  needOil: t('message.needOil'),
  noPowerPlace: t('message.noPowerPlace'),
  repairDone: t('message.repairDone'),
  repairFull: t('message.repairFull'),
  repairStarted: t('message.repairStarted'),
  repairStopped: t('message.repairStopped'),
  repairCredits: t('message.repairCredits'),
  needEngineer: t('message.needEngineer'),
  noEngineerAssigned: t('message.noEngineerAssigned'),
  builderNear: t('message.builderNear'),
};
