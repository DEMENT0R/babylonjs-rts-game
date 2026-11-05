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

// Улучшения техцентра: каждое покупается один раз и усиливает все юниты
// указанного типа — и уже построенные, и будущие.
export const UPGRADES = {
  marine: {
    key: 'marine',
    name: 'Боевые стимуляторы',
    role: 'ПЕХОТА',
    icon: 'marine',
    desc: 'Усиливает пехотинцев: больше урона и запаса прочности. Дешёвое усиление для основной ударной силы.',
    cost: 110,
    time: 16,
    target: 'marine',
    effects: { damage: 1.35, hp: 1.25 },
  },
  scout: {
    key: 'scout',
    name: 'Форсажные ускорители',
    role: 'РАЗВЕДКА',
    icon: 'scout',
    desc: 'Разгоняет скаутов и повышает урон их спаренных бластеров. Рейды по вышкам становятся ещё быстрее.',
    cost: 120,
    time: 16,
    target: 'scout',
    effects: { speed: 1.3, damage: 1.2 },
  },
  tank: {
    key: 'tank',
    name: 'Композитная броня',
    role: 'ТЕХНИКА',
    icon: 'tank',
    desc: 'Наращивает броню и прочность танков «Молот». Тяжёлая техника переживает ещё больше попаданий.',
    cost: 180,
    time: 24,
    target: 'tank',
    effects: { hp: 1.35, armor: 2 },
  },
  artillery: {
    key: 'artillery',
    name: 'Улучшенные ракеты',
    role: 'АРТИЛЛЕРИЯ',
    icon: 'artillery',
    desc: 'Увеличивает дальность и урон залпа РСЗО. Хрупкая установка сможет бить, оставаясь вне ответного огня.',
    cost: 190,
    time: 26,
    target: 'artillery',
    effects: { damage: 1.25, range: 1.2 },
  },
};

export const UPGRADE_ORDER = ['marine', 'scout', 'tank', 'artillery'];

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
    desc: 'Установка залпового огня: пять ракет накрывают площадь с безопасного расстояния. Очень хрупкая и дорогая — держите её в тылу под прикрытием.',
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
    desc: 'Исследует улучшения для разных юнитов: пехоты, скаутов, танков и РСЗО. Каждое улучшение покупается один раз и действует на весь отряд. Потребляет 6 энергии.',
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
  // Радиус, в котором ИИ оценивает оборону вокруг цели.
  defenseRadius: 30,
  // Пауза, когда сил не хватает: армия продолжает расти.
  regroupDelay: 15,
  // Минимальный размер волны и прибавка за каждый недавний разгром.
  minWaveSquad: 3,
  wipeSquadBonus: 2,
  // Сколько секунд цель считается «горячей» после провальной волны.
  targetCooldown: 75,
  // Волна, нанёсшая меньше урона и не убившая никого, тоже считается провалом.
  weakWaveDamage: 80,
  // С какого радиуса волна подходит к штабу игрока.
  assaultApproachRadius: 13,
  baseIncome: 0.5,
  credits: 160,
  // Жёсткий потолок для ИИ: даже с жилыми модулями он не растит бесконечную армию.
  armyCap: 52,
  defendRadius: 30,
  // Инженер — самый ценный юнит ИИ: получив сигнал об атаке, гарнизон
  // выдвигается на защиту в этом радиусе.
  engineerGuardRadius: 46,
  engineerGuardCount: 3,
};

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
