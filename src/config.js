// Баланс и константы игры.
// Все размеры — в мировых единицах, время — в секундах.

export const MAP = {
  half: 90, // граница игровой зоны (квадрат ±90)
  clamp: 87, // предел движения юнитов
  ground: 480, // размер земли
};

export const CAMERA = {
  minRadius: 28,
  maxRadius: 150,
  startRadius: 86,
  minBeta: 0.62,
  maxBeta: 1.3,
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
    name: 'ГЕЛИОС-7',
    short: 'АЛЬФА',
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
    name: 'ГЕЛИОС-7-Б',
    short: 'БЕТА',
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
export const BUILD_ORDER = ['power', 'barracks', 'derrick', 'lab', 'turret', 'depot', 'wall'];
export const BUILD_HOTKEYS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M'];
export const TRAIN_ORDER = ['marine', 'scout', 'tank', 'artillery', 'medic'];
export const TRAIN_HOTKEYS = ['Z', 'X', 'C', 'V', 'B'];
export const HQ_TRAIN_ORDER = ['engineer'];
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
    name: 'Боевые стимуляторы',
    role: 'ПЕХОТА',
    icon: 'marine',
    desc: 'Усиливает пехотинцев: больше урона и запаса прочности. Дорогое, но универсальное усиление основной ударной силы.',
    cost: 220,
    time: 26,
    scope: 'unit',
    target: 'marine',
    effects: { damage: 1.35, hp: 1.25 },
  },
  marine2: {
    key: 'marine2',
    line: 'marine',
    tier: 2,
    requires: 'marine',
    name: 'Бронебойные патроны',
    role: 'ПЕХОТА',
    icon: 'marine',
    desc: 'Патроны игнорируют до 2 единиц брони цели. Пехота снова пробивает танки и турели, а не царапает их.',
    cost: 360,
    time: 35,
    scope: 'unit',
    target: 'marine',
    effects: { pierce: 2 },
  },
  scout: {
    key: 'scout',
    line: 'scout',
    tier: 1,
    name: 'Форсажные ускорители',
    role: 'РАЗВЕДКА',
    icon: 'scout',
    desc: 'Разгоняет скаутов и повышает урон их спаренных бластеров. Рейды по вышкам становятся ещё быстрее.',
    cost: 240,
    time: 26,
    scope: 'unit',
    target: 'scout',
    effects: { speed: 1.3, damage: 1.2 },
  },
  scout2: {
    key: 'scout2',
    line: 'scout',
    tier: 2,
    requires: 'scout',
    name: 'Разведкомплект',
    role: 'РАЗВЕДКА',
    icon: 'scout',
    desc: 'Расширяет обзор скаутов на 5 единиц и слегка повышает скорость. Рейды и разведка становятся точнее.',
    cost: 400,
    time: 35,
    scope: 'unit',
    target: 'scout',
    effects: { visionAdd: 5, speed: 1.1 },
  },
  tank: {
    key: 'tank',
    line: 'tank',
    tier: 1,
    name: 'Композитная броня',
    role: 'ТЕХНИКА',
    icon: 'tank',
    desc: 'Наращивает броню и прочность танков «Молот». Тяжёлая техника переживает ещё больше попаданий.',
    cost: 360,
    time: 38,
    scope: 'unit',
    target: 'tank',
    effects: { hp: 1.35, armor: 2 },
  },
  tank2: {
    key: 'tank2',
    line: 'tank',
    tier: 2,
    requires: 'tank',
    name: 'Осколочный боеприпас',
    role: 'ТЕХНИКА',
    icon: 'tank',
    desc: 'Увеличивает радиус поражения танков на 30%. Скопления пехоты накрываются ещё надёжнее.',
    cost: 600,
    time: 51,
    scope: 'unit',
    target: 'tank',
    effects: { splash: 1.3 },
  },
  artillery: {
    key: 'artillery',
    line: 'artillery',
    tier: 1,
    name: 'Улучшенные ракеты',
    role: 'АРТИЛЛЕРИЯ',
    icon: 'artillery',
    desc: 'Увеличивает дальность и урон залпа РСЗО. Хрупкая установка сможет бить, оставаясь вне ответного огня.',
    cost: 380,
    time: 42,
    scope: 'unit',
    target: 'artillery',
    effects: { damage: 1.25, range: 1.2 },
  },
  artillery2: {
    key: 'artillery2',
    line: 'artillery',
    tier: 2,
    requires: 'artillery',
    name: 'Тяжёлый залп',
    role: 'АРТИЛЛЕРИЯ',
    icon: 'artillery',
    desc: 'В залп РСЗО добавляется шестая ракета. Плотность огня растёт без роста времени перезарядки.',
    cost: 640,
    time: 56,
    scope: 'unit',
    target: 'artillery',
    effects: { salvoAdd: 1 },
  },
  medic: {
    key: 'medic',
    line: 'medic',
    tier: 1,
    name: 'Полевая медицина',
    role: 'МЕДИЦИНА',
    icon: 'medic',
    desc: 'Ускоряет лечение на 40% и расширяет радиус поиска раненых. Медики успевают спасать больше бойцов.',
    cost: 260,
    time: 29,
    scope: 'unit',
    target: 'medic',
    effects: { healRate: 1.4, healRadius: 1.2 },
  },
  engineer: {
    key: 'engineer',
    line: 'engineer',
    tier: 1,
    name: 'Инженерный корпус',
    role: 'ИНЖЕНЕРИЯ',
    icon: 'engineer',
    desc: 'Ускоряет ремонт техники на 40% и стройку на 25%. Инженеры становятся заметно полезнее.',
    cost: 280,
    time: 32,
    scope: 'unit',
    target: 'engineer',
    effects: { repairRate: 1.4, buildSpeed: 1.25 },
  },
  turret: {
    key: 'turret',
    line: 'turret',
    tier: 1,
    name: 'Оптический прицел',
    role: 'ОБОРОНА',
    icon: 'turret',
    desc: 'Увеличивает дальность турелей на 3 единицы и урон на 15%. Оборона базы бьёт дальше и больнее.',
    cost: 360,
    time: 35,
    scope: 'building',
    target: 'turret',
    effects: { damage: 1.15, range: 1.18 },
  },
  structures: {
    key: 'structures',
    line: 'structures',
    tier: 1,
    name: 'Укреплённые конструкции',
    role: 'СТРОИТЕЛЬСТВО',
    icon: 'wall',
    desc: 'Повышает прочность всех зданий на 25%. База дольше держится под осадой.',
    cost: 340,
    time: 35,
    scope: 'building',
    target: 'building',
    effects: { hp: 1.25 },
  },
  income: {
    key: 'income',
    line: 'income',
    tier: 1,
    name: 'Глубокое бурение',
    role: 'ЭКОНОМИКА',
    icon: 'derrick',
    desc: 'Повышает отдачу всех вышек на 20%. Чем больше месторождений вы контролируете, тем выгоднее вложение.',
    cost: 360,
    time: 35,
    scope: 'global',
    target: null,
    effects: { income: 1.2 },
  },
  maintenance: {
    key: 'maintenance',
    line: 'maintenance',
    tier: 1,
    name: 'Аварийный ремонт',
    role: 'СНАБЖЕНИЕ',
    icon: 'repair',
    desc: 'Снижает стоимость восстановления зданий на 25%. Держать базу в порядке становится дешевле.',
    cost: 320,
    time: 32,
    scope: 'global',
    target: null,
    effects: { repairCost: 0.75 },
  },
  logistics: {
    key: 'logistics',
    line: 'logistics',
    tier: 1,
    name: 'Логистика',
    role: 'ЛОГИСТИКА',
    icon: 'move',
    desc: 'Ускоряет наём юнитов и возведение зданий на 20%. Армия и застройка появляются быстрее.',
    cost: 340,
    time: 35,
    scope: 'global',
    target: null,
    effects: { trainTime: 0.8, buildTime: 0.8 },
  },
  reserve: {
    key: 'reserve',
    line: 'reserve',
    tier: 1,
    name: 'Резерв',
    role: 'ЛИМИТ АРМИИ',
    icon: 'army',
    desc: 'Расширяет лимит армии на 5 единиц. Позволяет держать больше техники без нового жилого модуля.',
    cost: 400,
    time: 38,
    scope: 'global',
    target: null,
    effects: { armyCap: 5 },
  },
};

// Линии исследований в порядке кнопок. Армейские и базовые разнесены по
// двум страницам техцентра, чтобы все команды помещались на панель.
export const UPGRADE_LINES = [
  { key: 'marine', category: 'army' },
  { key: 'scout', category: 'army' },
  { key: 'tank', category: 'army' },
  { key: 'artillery', category: 'army' },
  { key: 'medic', category: 'army' },
  { key: 'engineer', category: 'army' },
  { key: 'turret', category: 'base' },
  { key: 'structures', category: 'base' },
  { key: 'income', category: 'base' },
  { key: 'maintenance', category: 'base' },
  { key: 'logistics', category: 'base' },
  { key: 'reserve', category: 'base' },
];

export const UPGRADE_PAGES = [
  ['marine', 'scout', 'tank', 'artillery', 'medic', 'engineer'],
  ['turret', 'structures', 'income', 'maintenance', 'logistics', 'reserve'],
];

// Все уровни каждой линии по порядку: по ним UI и ИИ находят следующий.
export const UPGRADE_LINE_KEYS = {
  marine: ['marine', 'marine2'],
  scout: ['scout', 'scout2'],
  tank: ['tank', 'tank2'],
  artillery: ['artillery', 'artillery2'],
  medic: ['medic'],
  engineer: ['engineer'],
  turret: ['turret'],
  structures: ['structures'],
  income: ['income'],
  maintenance: ['maintenance'],
  logistics: ['logistics'],
  reserve: ['reserve'],
};

export const UNITS = {
  engineer: {
    key: 'engineer',
    name: 'Инженер',
    role: 'СТРОИТЕЛЬ',
    icon: 'engineer',
    desc: 'Возводит здания. Чем больше инженеров рядом со стройплощадкой, тем быстрее идёт стройка. Слаб в бою, берегите его.',
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
    name: 'Пехотинец',
    role: 'ПЕХОТА',
    icon: 'marine',
    desc: 'Универсальный стрелок. Дешёвый, быстро нанимается и отлично работает в массе.',
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
    name: 'Скаут',
    role: 'РАЗВЕДКА',
    icon: 'scout',
    desc: 'Быстрый рейдер. Молниеносно добирается до вышек и добивает отступающих.',
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
    from: 'barracks',
    vehicle: true,
    casing: 0.1,
  },
  tank: {
    key: 'tank',
    name: 'Танк «Молот»',
    role: 'ТЕХНИКА',
    icon: 'tank',
    desc: 'Тяжёлая машина с площадным уроном. Медленная, но разносит скопления пехоты.',
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
    from: 'barracks',
    vehicle: true,
    casing: 0.24,
  },
  artillery: {
    key: 'artillery',
    name: 'РСЗО «Гроза»',
    role: 'АРТИЛЛЕРИЯ',
    icon: 'artillery',
    desc: 'Установка залпового огня: пять ракет накрывают площадь с безопасного расстояния. Очень хрупкая и дорогая — держите её в тылу под прикрытием. Залп бьёт и по своим: не стреляйте по войскам, которые уже сцепились с врагом.',
    cost: 360,
    supply: 5,
    buildTime: 26,
    hp: 170,
    armor: 0,
    radius: 2.1,
    speed: 3.7,
    range: 34,
    damage: 18,
    cooldown: 5.2,
    aggro: 40,
    splash: 4.1,
    // Ракеты накрывают площадь без разбора: свои юниты в зоне залпа
    // получают полный урон. Здания и сама установка не страдают.
    friendlyFire: 1,
    salvo: 5,
    salvoDelay: 0.16,
    salvoSpread: 3.4,
    height: 3.4,
    projectile: 'rocket',
    muzzleHeight: 2.1,
    from: 'barracks',
    vehicle: true,
  },
  medic: {
    key: 'medic',
    name: 'Медик',
    role: 'МЕДИЦИНА',
    icon: 'medic',
    desc: 'Автоматически лечит раненую пехоту рядом: пехотинцев, инженеров и других медиков. Безоружен, поэтому держите его за спинами бойцов.',
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

export const BUILDINGS = {
  hq: {
    key: 'hq',
    name: 'Командный центр',
    role: 'ШТАБ',
    icon: 'hq',
    desc: 'Сердце колонии. Строит здания, обеспечивает базовую энергию и даёт 10 единиц лимита армии. Потеря означает поражение.',
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
    name: 'Электростанция',
    role: 'ЭНЕРГЕТИКА',
    icon: 'power',
    desc: 'Даёт +10 энергии. При нехватке энергии производство замедляется втрое.',
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
    name: 'Казармы',
    role: 'ВОЕННЫЙ ОБЪЕКТ',
    icon: 'barracks',
    desc: 'Нанимает пехоту, скаутов и танки. Потребляет 5 энергии.',
    cost: 160,
    buildTime: 20,
    hp: 900,
    armor: 3,
    radius: 3.6,
    height: 5.6,
    powerProduce: 0,
    powerUse: 5,
    from: 'hq',
  },
  derrick: {
    key: 'derrick',
    name: 'Нефтяная вышка',
    role: 'ЭКОНОМИКА',
    icon: 'derrick',
    desc: 'Добывает 2.2 кредита в секунду. Ставится только на нефтяное месторождение. Потребляет 2 энергии.',
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
  },
  turret: {
    key: 'turret',
    name: 'Турель «Страж»',
    role: 'СТАЦИОНАРНОЕ ОРУДИЕ',
    icon: 'turret',
    desc: 'Автоматическая пушка для обороны базы. Сама выбирает цели и стреляет по наземным юнитам на подходе. Не двигается, поэтому её нужно прикрывать от танков. Потребляет 3 энергии.',
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
    name: 'Баррикада',
    role: 'ОБОРОНА',
    icon: 'wall',
    desc: 'Дешёвый сегмент стены. Перекрывает путь наземным юнитам: из баррикад можно собрать линию обороны или узкий проход. Не потребляет энергию.',
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
    name: 'Жилой модуль',
    role: 'ЛИМИТ АРМИИ',
    icon: 'depot',
    desc: 'Расширяет лимит армии на 10 единиц. Стройте модули заранее: тяжелая техника занимает много места в отряде. Потребляет 3 энергии.',
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
    name: 'Техцентр',
    role: 'ИССЛЕДОВАНИЯ',
    icon: 'lab',
    desc: 'Исследует улучшения для разных юнитов: пехоты, скаутов, танков и РСЗО. Каждое улучшение покупается один раз и действует на весь отряд. Исследования дороги и идут десятки секунд. Потребляет 6 энергии.',
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
  // Во сколько раз отряд должен превосходить известную оборону цели, чтобы
  // атака имела смысл. Иначе ИИ копит силы, а не кормит турели.
  requiredAdvantage: 1.35,
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
  // Шанс ответить на разгром от армии рейдом по экономике, а не новым штурмом.
  raidAfterArmyLoss: 0.5,
  // С какого радиуса волна подходит к штабу игрока.
  assaultApproachRadius: 13,
  baseIncome: 0.5,
  credits: 160,
  // Жёсткий потолок для ИИ: даже с жилыми модулями он не растит бесконечную армию.
  armyCap: 52,
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
  // Реакция на обстрел построек: ближайшие свободные бойцы идут на помощь.
  structureGuardRadius: 30,
  structureGuardCount: 2,
  // Экономика: если противник не может нанять даже пехотинца, он не начинает
  // волны и почти не рискует разведкой, а копит силы у базы. Порог — цена
  // самого дешёвого бойца; затянувшееся безденежье измеряется в секундах,
  // чтобы короткие паузы между наймом юнитов не считались голодом.
  economyCredits: 60,
  starvedDelay: 15,
  // Разведка бедного противника: один боец и заметно реже. Позиционный гарнизон
  // остаётся на базе, чтобы разведчик не оголял оборону.
  scoutWeakInterval: 26,
  // Память о потерях разведки: столько секунд место гибели разведчика делает
  // маршруты рядом с собой дороже, а радиус и вес задают силу этого штрафа.
  // Без памяти ИИ водил новых бойцов по одной и той же тропе на турели.
  scoutLossMemory: 150,
  scoutLossRadius: 22,
  scoutDangerWeight: 2,
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
export const AI_DIFFICULTY = {
  easy: {
    key: 'easy',
    name: 'ЛЁГКИЙ',
    desc: 'Противник не запоминает провалы, не отступает и атакует реже. Для первой партии.',
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
    name: 'ОБЫЧНЫЙ',
    desc: 'Противник учится на провалах, отступает, меняет цель и обходит турели.',
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
    name: 'СЛОЖНЫЙ',
    desc: 'Тот же умный противник, но богаче, злее и требует больше войск для обороны.',
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

export const MESSAGES = {
  lowPower: 'Недостаток энергии! Постройте электростанцию.',
  noCredits: 'Недостаточно кредитов.',
  queueFull: 'Очередь производства заполнена.',
  notReady: 'Здание ещё строится.',
  capReached: 'Достигнут лимит армии. Постройте жилой модуль.',
  badPlace: 'Здесь нельзя строить.',
  needExplore: 'Строить можно только в разведанной зоне.',
  unitOnSite: 'На месте строительства стоят юниты.',
  placementBounds: 'За границей карты.',
  placementRock: 'Слишком близко к скале.',
  placementWall: 'Слишком близко к стене.',
  placementBuilding: 'Слишком близко к другому зданию.',
  needOil: 'Вышку можно поставить только на месторождение.',
  noPowerPlace: 'Недостаточно энергии для запуска.',
  repairDone: 'Здание полностью отремонтировано.',
  repairFull: 'Здание не нуждается в ремонте.',
  repairStarted: 'Ремонт начат. Кредиты списываются по мере восстановления.',
  repairStopped: 'Ремонт остановлен.',
  repairCredits: 'Недостаточно кредитов для продолжения ремонта.',
  needEngineer: 'Стройплощадке нужны инженеры. Наймите их в командном центре.',
  noEngineerAssigned: 'К стройплощадке не направлен ни один инженер — постройка замерла.',
  builderNear: 'Инженеры на месте — стройка идёт быстрее.',
};
