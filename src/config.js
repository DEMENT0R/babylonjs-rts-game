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

export const FACTIONS = {
  player: {
    key: 'player',
    name: 'ГЕЛИОС-7',
    short: 'ГЕЛИОС',
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
    name: 'РОЙ КСЕНОВ',
    short: 'КСЕНЫ',
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
  armyCap: 50,
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
export const BUILD_ORDER = ['power', 'barracks', 'derrick'];
export const TRAIN_ORDER = ['marine', 'scout', 'tank', 'artillery'];
export const HQ_TRAIN_ORDER = ['engineer'];

export const UNITS = {
  engineer: {
    key: 'engineer',
    name: 'Инженер',
    role: 'СТРОИТЕЛЬ',
    icon: 'engineer',
    desc: 'Возводит здания. Чем больше инженеров рядом со стройплощадкой, тем быстрее идёт стройка. Слаб в бою, берегите его.',
    cost: 70,
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
  },
  marine: {
    key: 'marine',
    name: 'Пехотинец',
    role: 'ПЕХОТА',
    icon: 'marine',
    desc: 'Универсальный стрелок. Дешёвый, быстро нанимается и отлично работает в массе.',
    cost: 60,
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
  },
  scout: {
    key: 'scout',
    name: 'Скаут',
    role: 'РАЗВЕДКА',
    icon: 'scout',
    desc: 'Быстрый рейдер. Молниеносно добирается до вышек и добивает отступающих.',
    cost: 85,
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
  },
  tank: {
    key: 'tank',
    name: 'Танк «Молот»',
    role: 'ТЕХНИКА',
    icon: 'tank',
    desc: 'Тяжёлая машина с площадным уроном. Медленная, но разносит скопления пехоты.',
    cost: 170,
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
  },
  artillery: {
    key: 'artillery',
    name: 'РСЗО «Гроза»',
    role: 'АРТИЛЛЕРИЯ',
    icon: 'artillery',
    desc: 'Установка залпового огня: пять ракет накрывают площадь с безопасного расстояния. Слаба в ближнем бою.',
    cost: 280,
    buildTime: 26,
    hp: 260,
    armor: 1,
    radius: 2.1,
    speed: 3.7,
    range: 26,
    damage: 18,
    cooldown: 5.2,
    aggro: 32,
    splash: 3.6,
    salvo: 5,
    salvoDelay: 0.16,
    salvoSpread: 3.4,
    height: 3.4,
    projectile: 'rocket',
    muzzleHeight: 2.1,
    from: 'barracks',
  },
};

export const BUILDINGS = {
  hq: {
    key: 'hq',
    name: 'Командный центр',
    role: 'ШТАБ',
    icon: 'hq',
    desc: 'Сердце колонии. Строит здания и обеспечивает базовую энергию. Потеря означает поражение.',
    cost: 0,
    buildTime: 0,
    hp: 1800,
    armor: 3,
    radius: 5.4,
    height: 10,
    powerProduce: 5,
    powerUse: 0,
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
  baseIncome: 0.5,
  credits: 160,
  armyCap: 16,
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
  costFraction: 0.55,
  // Для командного центра нет цены постройки — задаём цену за HP отдельно.
  hqCostPerHp: 0.2,
};

export const MESSAGES = {
  lowPower: 'Недостаток энергии! Постройте электростанцию.',
  noCredits: 'Недостаточно кредитов.',
  queueFull: 'Очередь производства заполнена.',
  notReady: 'Здание ещё строится.',
  capReached: 'Достигнут предел армии.',
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
