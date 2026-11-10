// Состояние игры: экономика, выбор, приказы, производство, победа.

import { Vector3, Color3 } from './babylon.js';
import {
  START,
  UNITS,
  BUILDINGS,
  UPGRADES,
  UPGRADE_LINES,
  UPGRADE_BUILDING,
  UPGRADE_LINE_KEYS,
  UNIT_PRODUCTION,
  FACTIONS,
  MAP,
  MESSAGES,
  AI,
  AI_DIFFICULTY,
  REPAIR,
  VETERANCY,
  SELL,
} from './config.js';
import { clamp, dist, formatTime, plural } from './utils.js';
import { Unit, Building } from './entities.js';
import { NavGrid, segmentDistance } from './nav.js';
import { AIController } from './ai.js';
import { WaveDirector } from './endless.js';
import { FogOfWar } from './fog.js';
import { recordMissionResult } from './missions.js';

let nextBuildingId = 1;

export class Game {
  constructor({
    scene, camera, factory, world, fx, graphics, audio, audioSettings,
    difficulty = 'normal', difficultySettings = null,
    fog = 'on', fogSettings = null,
    mission = null,
  }) {
    this.scene = scene;
    this.camera = camera;
    this.factory = factory;
    this.world = world;
    this.map = world.map;
    this.fx = fx;
    this.graphics = graphics;
    this.audio = audio ?? null;
    this.audioSettings = audioSettings ?? null;
    this.mission = mission;
    this.difficulty = mission?.difficulty && AI_DIFFICULTY[mission.difficulty]
      ? mission.difficulty
      : AI_DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.difficultySettings = difficultySettings;
    this.fogEnabled = fog !== 'off';
    this.fogSettings = fogSettings;
    this.ui = null;
    this.input = null;

    this.entities = [];
    this.units = [];
    this.buildings = [];
    this.selected = new Set();
    this.primary = null;
    // Отряды игрока: цифра 1…9 → набор юнитов. Живут только в текущей партии.
    this.groups = new Map();

    this.credits = START.credits;
    this.armyCap = START.armyCap;
    this.elapsed = 0;
    this.paused = true;
    this.started = false;
    // Витрина главного экрана: демонстрационный бой без игрока.
    this.attract = false;
    this.over = null;
    // Итог записи рекорда для экрана поражения (только бесконечная операция).
    this.record = null;
    // Скорость симуляции: 0.5×, 1× или 2×. На интерфейс и звук не влияет.
    this.speed = 1;

    this.stats = {
      kills: 0,
      losses: 0,
      gathered: 0,
      trained: 0,
      built: 0,
      // Сколько волн отправил директор бесконечной операции.
      waves: 0,
      // Разбивка по типам: кто уничтожал, что теряли и сколько урона нанесли.
      killsByType: {},
      lossesByType: {},
      damageByType: {},
    };
    // Счётчики целей миссии: что игрок уже сделал и что уничтожил.
    this.missionStats = { trained: {}, destroyed: {} };
    this.objectives = [];
    this.objectiveTimer = 0;
    // Изученные улучшения каждой фракции: набор ключей из UPGRADES.
    this.upgrades = { player: new Set(), enemy: new Set() };
    this.power = {
      player: { produced: 0, used: 0, factor: 1 },
      enemy: { produced: 0, used: 0, factor: 1 },
    };
    this.notifyTimes = new Map();
    this.alertCd = 0;
    this.powerTimer = 0;
    this.baseAlertCd = 0;
    this.tutorialStep = 0;
    this.derrickIncomeAcc = 0;
    this.enemyDerrickAcc = 0;
    this.nav = new NavGrid({ half: MAP.half, cell: 2, margin: 1.0 });

    this.setupBases();
    this.setupMission();
    this.fog = new FogOfWar(this, { enabled: this.fogEnabled });
    this.refreshNav();
    this.recomputePower();
    this.refreshArmyCap();
    this.ai = new AIController(this, this.difficulty, this.mission?.ai ?? null);
    this.endless = this.mission?.endless ? new WaveDirector(this, this.mission.endless) : null;
    this.ui = null;
  }

  /**
   * Сложность выбирается до начала партии: ИИ пересоздаётся с новыми
   * правилами, а выбор запоминается в браузере.
   */
  setDifficulty(key) {
    if (this.mission || !AI_DIFFICULTY[key] || this.started) return false;
    this.difficulty = key;
    this.difficultySettings?.set(key);
    this.ai = new AIController(this, key);
    return true;
  }

  /**
   * Туман войны включается и выключается только в лобби: в бою смена правила
   * открыла бы противнику всю карту посреди схватки.
   */
  setFog(value) {
    if (this.started) return false;
    const enabled = value !== 'off';
    if (this.fogEnabled === enabled) return false;
    this.fogEnabled = enabled;
    this.fogSettings?.set(enabled ? 'on' : 'off');
    this.fog?.setEnabled(enabled);
    return true;
  }

  // ------------------------------------------------------------- setup
  setupBases() {
    const { player, enemy } = this.map.spawn;
    const playerHq = player.hq;
    const enemyHq = enemy.hq;

    const createBase = (faction, base, faceX, faceZ) => {
      this.createBuilding(faction, 'hq', base.hq.x, base.hq.z, { complete: true, silent: true });
      this.createBuilding(faction, 'power', base.power.x, base.power.z, { complete: true, silent: true });
      for (const spot of base.derricks) {
        const patch = this.findOilPatch(spot.x, spot.z, 6);
        const b = this.createBuilding(faction, 'derrick', spot.x, spot.z, {
          complete: true,
          silent: true,
          patch,
        });
        if (patch) patch.derrick = b;
      }
      for (const spot of base.marines) {
        const u = this.spawnUnit(faction, 'marine', spot.x, spot.z, { silent: true });
        if (u) u.root.rotation.y = Math.atan2(faceX - spot.x, faceZ - spot.z);
      }
      if (base.barracks) {
        this.createBuilding(faction, 'barracks', base.barracks.x, base.barracks.z, {
          complete: true,
          silent: true,
        });
      }
      const engineers = START[faction]?.engineers ?? 0;
      for (let i = 0; i < engineers; i++) {
        const spot = this.findSpawnSpot(
          base.hq.x,
          base.hq.z,
          UNITS.engineer.radius,
          i * 2.4 + Math.PI / 2,
        );
        const unit = this.spawnUnit(faction, 'engineer', spot.x, spot.z, { silent: true });
        if (unit) unit.root.rotation.y = Math.atan2(faceX - spot.x, faceZ - spot.z);
      }
    };

    createBase('player', player, enemyHq.x, enemyHq.z);
    createBase('enemy', enemy, playerHq.x, playerHq.z);
  }

  /**
   * Стартовая расстановка миссии: предразмещённые турели и другие объекты.
   * Цели создаются здесь же, чтобы HUD знал о них до первого кадра.
   */
  setupMission() {
    if (!this.mission) return;
    this.mission.setup?.(this);
    this.objectives = (this.mission.objectives ?? []).map((def, index) => ({
      ...def,
      index,
      done: false,
      progress: 0,
      progressText: '',
    }));
    this.updateObjectives(true);
  }

  /** Доступна ли постройка в текущей миссии. В свободной партии доступно всё. */
  missionAllowsBuilding(type) {
    return !this.mission?.buildings || this.mission.buildings.includes(type);
  }

  /** Доступен ли найм в текущей миссии. */
  missionAllowsUnit(type) {
    return !this.mission?.units || this.mission.units.includes(type);
  }

  trackTrained(type) {
    this.missionStats.trained[type] = (this.missionStats.trained[type] ?? 0) + 1;
  }

  trackDestroyed(type) {
    this.missionStats.destroyed[type] = (this.missionStats.destroyed[type] ?? 0) + 1;
  }

  /** Первая незавершённая цель — её показывает HUD. */
  activeObjective() {
    return this.objectives.find((objective) => !objective.done) ?? null;
  }

  /** Ход выполнения цели: доля 0…1 и короткая подпись для интерфейса. */
  objectiveProgress(objective) {
    const count = (value) => Math.min(1, value);
    switch (objective.type) {
      case 'destroyHQ': {
        const alive = this.buildings.some(
          (b) => b.alive && b.faction === 'enemy' && b.type === 'hq',
        );
        return { progress: alive ? 0 : 1, text: alive ? 'КП цел' : 'КП уничтожен' };
      }
      case 'survive': {
        const seconds = Math.max(1, objective.seconds ?? 0);
        return {
          progress: count(this.elapsed / seconds),
          text: `${formatTime(Math.max(0, seconds - this.elapsed))} осталось`,
        };
      }
      case 'derricks': {
        const have = this.buildings.filter(
          (b) => b.alive && b.faction === 'player' && b.type === 'derrick',
        ).length;
        return { progress: count(have / (objective.count || 1)), text: `${have} / ${objective.count}` };
      }
      case 'destroyBuilding': {
        const have = this.missionStats.destroyed[objective.building] ?? 0;
        return { progress: count(have / (objective.count || 1)), text: `${have} / ${objective.count}` };
      }
      case 'train': {
        const have = this.missionStats.trained[objective.unit] ?? 0;
        return { progress: count(have / (objective.count || 1)), text: `${have} / ${objective.count}` };
      }
      default:
        return { progress: 0, text: '' };
    }
  }

  updateObjectives(silent = false) {
    if (!this.mission || !this.objectives.length || this.over) return;
    let allDone = true;
    for (const objective of this.objectives) {
      const state = this.objectiveProgress(objective);
      objective.progress = state.progress;
      objective.progressText = state.text;
      if (!objective.done && state.progress >= 1) {
        objective.done = true;
        if (!silent) {
          this.notify(`Задача выполнена: ${objective.title}.`, 'success', `objective-${objective.index}`, 0, 5);
        }
      }
      if (!objective.done) allDone = false;
    }
    if (allDone) this.endGame('victory');
  }

  // ------------------------------------------------------------- loop
  begin() {
    if (this.started) return;
    this.groups.clear();
    this.ui?.onGroupsChanged?.();
    this.started = true;
    this.paused = false;
    const hq = this.playerBuildings().find((b) => b.type === 'hq');
    if (hq) this.selectOnly([hq]);
    if (this.mission) {
      const kind = this.mission.kind === 'campaign'
        ? 'Операция'
        : this.mission.kind === 'endless' ? 'Протокол' : 'Испытание';
      this.notify(
        `${kind} «${this.mission.title}». ${this.mission.subtitle}`,
        'info',
        'mission-begin',
        0,
        8,
      );
      const first = this.activeObjective();
      if (first) {
        this.notify(`Задача: ${first.title}. ${first.desc}`, 'hint', 'mission-first', 0, 10);
      }
      return;
    }
    this.notify('Связь установлена. Командование колонией за вами.', 'info', 'begin', 0);
    this.notify('Постройте казармы и держите инженеров под рукой: без них стройка стоит.', 'hint', 'hint-build', 0, 10);
  }

  setPaused(value) {
    if (this.over) return;
    this.paused = value;
  }

  /** Скорость партии выбирается в паузе и действует до конца боя. */
  setSpeed(value) {
    const speed = Number(value);
    if (![0.5, 1, 2].includes(speed) || this.speed === speed) return false;
    this.speed = speed;
    return true;
  }

  /** Полоски HP поверх всех юнитов — настройка интерфейса, а не правило боя. */
  get alwaysShowBars() {
    return this.graphics?.get?.('hpBars') === 'always';
  }

  // ---------------------------------------------------------- attract
  /**
   * Витрина главного экрана. Туман выключается принудительно, иначе камера
   * летала бы по чёрной карте, но настройка игрока не меняется: после начала
   * партии он возвращается к прежнему значению.
   */
  startAttract() {
    if (this.started || this.attract) return false;
    this.attract = true;
    this.fogBeforeAttract = this.fogEnabled;
    this.fogEnabled = false;
    this.fog?.setEnabled(false);
    return true;
  }

  stopAttract() {
    if (!this.attract) return;
    this.attract = false;
    this.fogEnabled = this.fogBeforeAttract ?? true;
    this.fog?.setEnabled(this.fogEnabled);
  }

  /** Симуляция витрины: только войска и эффекты, без экономики и правил боя. */
  updateAttract(dt) {
    if (!this.attract) return;
    dt = Math.min(dt, 0.1);
    const units = this.units.slice();
    for (const unit of units) {
      if (unit.alive) unit.update(dt);
    }
    for (const unit of this.units) {
      if (unit.alive && unit.hp < unit.maxHp * 0.52) this.fx.damageSmoke(unit, dt);
    }
    this.fx.update(dt);
  }

  update(dt) {
    if (!this.started || this.paused || this.over) return;
    dt = Math.min(dt, 0.1) * this.speed;
    // Ускорение не должно протаскивать юнитов сквозь препятствия: шаг
    // навигации остаётся в тех же пределах, что и на обычной скорости.
    dt = Math.min(dt, 0.1);
    this.elapsed += dt;

    const income = this.playerIncome();
    this.credits += income * dt;
    this.stats.gathered += income * dt;

    this.powerTimer -= dt;
    if (this.powerTimer <= 0) {
      this.powerTimer = 0.5;
      this.recomputePower();
    }

    const snapshot = this.entities.slice();
    for (const entity of snapshot) {
      if (entity.alive) entity.update(dt);
    }
    for (const entity of this.entities) {
      if (entity.alive && entity.hp < entity.maxHp * 0.52) {
        this.fx.damageSmoke(entity, dt);
      }
    }
    this.fx.update(dt);
    this.fog.update(dt);
    this.ai.update(dt);
    this.endless?.update(dt);

    // проверка атаки на базу
    this.baseAlertCd -= dt;
    if (this.baseAlertCd <= 0) {
      this.baseAlertCd = 0.8;
      this.checkBaseUnderAttack();
    }

    // подсказки
    if (!this.mission) {
      if (this.tutorialStep === 0 && this.elapsed > 18) {
        this.tutorialStep = 1;
        this.notify('Нефтяные вышки приносят кредиты. Захватывайте нейтральные месторождения.', 'hint', 'hint-oil', 0, 12);
      } else if (this.tutorialStep === 1 && this.elapsed > 42) {
        this.tutorialStep = 2;
        this.notify('Здания строятся только рядом с инженерами. Чем их больше, тем быстрее.', 'hint', 'hint-engineer', 0, 12);
      } else if (this.tutorialStep === 2 && this.elapsed > 70) {
        this.tutorialStep = 3;
        this.notify('Сенсоры фиксируют активность противника. Укрепляйте оборону.', 'warn', 'hint-enemy', 0, 14);
      }
    }

    this.objectiveTimer -= dt;
    if (this.objectiveTimer <= 0) {
      this.objectiveTimer = 0.25;
      this.updateObjectives();
    }

    this.checkVictory();
  }

  checkVictory() {
    if (this.over) return;
    const playerHQ = this.entities.find((e) => e.alive && e.isBuilding && e.type === 'hq' && e.faction === 'player');
    const enemyHQ = this.entities.find((e) => e.alive && e.isBuilding && e.type === 'hq' && e.faction === 'enemy');
    if (!playerHQ) {
      this.endGame('defeat');
    } else if (!this.mission && !enemyHQ) {
      this.endGame('victory');
    }
  }

  endGame(result) {
    if (this.over) return;
    this.over = result;
    this.paused = true;
    this.stats.time = this.elapsed;
    if (this.mission) {
      this.record = recordMissionResult(this.mission, result, this.stats);
    }
    if (this.ui) this.ui.showEnd(result);
  }

  checkBaseUnderAttack() {
    const hq = this.entities.find((e) => e.alive && e.isBuilding && e.type === 'hq' && e.faction === 'player');
    if (!hq) return;
    let attacker = null;
    for (const e of this.entities) {
      if (!e.alive || e.faction !== 'enemy' || !(e instanceof Unit)) continue;
      if (dist(e.position.x, e.position.z, hq.position.x, hq.position.z) < 28) {
        attacker = e;
        break;
      }
    }
    if (!attacker) {
      this.alertCd = 0;
      return;
    }
    if (this.alertCd > 0) {
      this.alertCd -= 0.8;
      return;
    }
    this.alertCd = 10;
    this.notify('Наша база под атакой!', 'danger', 'base-attack', 0, 9);
    this.audio?.ui('alert');
    if (this.ui) {
      this.ui.alert();
      this.ui.ping(attacker.position.x, attacker.position.z, '#ff4b3e');
    }
  }

  // ------------------------------------------------------------- economy / power
  playerIncome() {
    let sum = 0;
    for (const b of this.buildings) {
      if (b.alive && b.faction === 'player' && b.type === 'derrick' && b.complete) sum += b.def.income;
    }
    return sum * this.globalModifiers('player').income;
  }

  enemyIncome() {
    let sum = AI.baseIncome;
    for (const b of this.buildings) {
      if (b.alive && b.faction === 'enemy' && b.type === 'derrick' && b.complete) sum += b.def.income;
    }
    // У противника нет микроконтроля, поэтому его доход чуть ниже дохода
    // игрока с тех же вышек. Но и голодать одной лишь экономикой он не
    // должен: иначе армия не успевает восстановиться между волнами.
    return sum * 0.85 * this.globalModifiers('enemy').income;
  }

  /**
   * Глобальные эффекты изученных исследований: доход, цена ремонта, время
   * найма и стройки, бонус к лимиту армии. Считается на лету, поэтому
   * действует и на будущие постройки, и на уже существующие.
   */
  globalModifiers(faction) {
    const mods = { income: 1, repairCost: 1, trainTime: 1, buildTime: 1, armyCap: 0 };
    for (const key of this.upgrades[faction] ?? []) {
      const def = UPGRADES[key];
      if (!def || def.scope !== 'global') continue;
      const effects = def.effects ?? {};
      if (effects.income) mods.income *= effects.income;
      if (effects.repairCost) mods.repairCost *= effects.repairCost;
      if (effects.trainTime) mods.trainTime *= effects.trainTime;
      if (effects.buildTime) mods.buildTime *= effects.buildTime;
      if (effects.armyCap) mods.armyCap += effects.armyCap;
    }
    return mods;
  }

  /** Множители характеристик здания с учётом изученных улучшений. */
  buildingModifiers(faction, type) {
    const mods = { hp: 1, armor: 0, damage: 1, range: 1, cooldown: 1 };
    for (const key of this.upgrades[faction] ?? []) {
      const def = UPGRADES[key];
      if (!def || def.scope !== 'building') continue;
      if (def.target !== 'building' && def.target !== type) continue;
      const effects = def.effects ?? {};
      if (effects.hp) mods.hp *= effects.hp;
      if (effects.armor) mods.armor += effects.armor;
      if (effects.damage) mods.damage *= effects.damage;
      if (effects.range) mods.range *= effects.range;
      if (effects.cooldown) mods.cooldown *= effects.cooldown;
    }
    return mods;
  }

  recomputePower() {
    const result = { player: { produced: 0, used: 0, factor: 1 }, enemy: { produced: 0, used: 0, factor: 1 } };
    for (const b of this.buildings) {
      if (!b.alive || !b.complete) continue;
      const p = result[b.faction];
      if (!p) continue;
      p.produced += b.def.powerProduce || 0;
      p.used += b.def.powerUse || 0;
    }
    for (const f of ['player', 'enemy']) {
      const p = result[f];
      p.factor = p.used > p.produced ? 0.4 : 1;
    }
    const wasDeficit = this.power.player.used > this.power.player.produced;
    this.power = result;
    if (result.player.used > result.player.produced && !wasDeficit) {
      this.notify(MESSAGES.lowPower, 'warn', 'low-power', 0, 12);
    }
    this.refreshArmyCap();
  }

  // ------------------------------------------------------------- army limit
  /** Лимит армии фракции: его дают достроенные штаб и жилые модули. */
  getArmyCap(faction = 'player') {
    let cap = 0;
    for (const b of this.buildings) {
      if (b.alive && b.complete && b.faction === faction) cap += b.def.armyCap || 0;
    }
    return cap + this.globalModifiers(faction).armyCap;
  }

  /** Сколько лимита уже занимают живые юниты фракции. */
  getArmyUsed(faction = 'player') {
    let used = 0;
    for (const u of this.units) {
      if (u.alive && u.faction === faction) used += UNITS[u.type]?.supply ?? 1;
    }
    return used;
  }

  /** Лимит, зарезервированный юнитами в очередях производства. */
  getQueuedSupply(faction = 'player') {
    let queued = 0;
    for (const b of this.buildings) {
      if (!b.alive || b.faction !== faction || !b.queue?.length) continue;
      for (const item of b.queue) {
        if (item.type) queued += UNITS[item.type]?.supply ?? 1;
      }
    }
    return queued;
  }

  /** Синхронизирует публичное поле armyCap, которое читает интерфейс. */
  refreshArmyCap() {
    this.armyCap = this.getArmyCap('player');
    return this.armyCap;
  }

  powerFactor(faction) {
    return this.power[faction]?.factor ?? 1;
  }

  // ------------------------------------------------------------- repair
  walletFor(faction) {
    return faction === 'enemy' ? (this.ai?.credits ?? 0) : this.credits;
  }

  spend(faction, amount) {
    if (faction === 'enemy') {
      if (this.ai) this.ai.credits -= amount;
    } else {
      this.credits -= amount;
    }
  }

  repairCostPerHp(building) {
    const def = building.def;
    const costMult = this.globalModifiers(building.faction).repairCost;
    return def.cost > 0
      ? (def.cost * REPAIR.costFraction * costMult) / def.hp
      : REPAIR.hqCostPerHp * costMult;
  }

  trainTimeMultiplier(faction = 'player') {
    return this.globalModifiers(faction).trainTime;
  }

  buildTimeMultiplier(faction = 'player') {
    return this.globalModifiers(faction).buildTime;
  }

  repairRate(building) {
    return building.maxHp / REPAIR.duration;
  }

  repairFullCost(building) {
    return Math.ceil((building.maxHp - building.hp) * this.repairCostPerHp(building));
  }

  repairTick(building, dt) {
    if (!building.alive || !building.complete) {
      building.repairing = false;
      return;
    }
    if (building.hp >= building.maxHp - 0.01) {
      const wasRepairing = building.repairing;
      building.hp = building.maxHp;
      building.repairing = false;
      if (building.faction === 'player' && wasRepairing) {
        this.notify(MESSAGES.repairDone, 'success', `repair_done_${building.id}`, 0, 3);
      }
      return;
    }
    if (!building.repairing) return;

    const hpStep = Math.min(this.repairRate(building) * dt, building.maxHp - building.hp);
    const cost = hpStep * this.repairCostPerHp(building);
    if (this.walletFor(building.faction) < cost) {
      building.repairing = false;
      if (building.faction === 'player') {
        this.notify(MESSAGES.repairCredits, 'warn', `repair_credits_${building.id}`, 4, 4);
      }
      return;
    }
    this.spend(building.faction, cost);
    building.hp = Math.min(building.maxHp, building.hp + hpStep);
    if (building.hp >= building.maxHp) {
      building.hp = building.maxHp;
      building.repairing = false;
      if (building.faction === 'player') {
        this.notify(MESSAGES.repairDone, 'success', `repair_done_${building.id}`, 0, 3);
      }
    }
  }

  /** Включает ремонт всех выбранных повреждённых зданий либо выключает его. */
  toggleRepair(buildings = this.selectedBuildings()) {
    const list = buildings.filter((b) => b && b.alive && b.complete && b.hp < b.maxHp - 0.5);
    if (!list.length) {
      this.notify(MESSAGES.repairFull, 'hint', 'repair_full', 0, 3);
      return false;
    }
    const start = list.some((b) => !b.repairing);
    for (const b of list) b.repairing = start;
    if (start) {
      const cost = list.reduce((sum, b) => sum + this.repairFullCost(b), 0);
      this.notify(
        `${MESSAGES.repairStarted} Полный ремонт: ${cost} кредитов.`,
        'info',
        'repair-start',
        0,
        5,
      );
      if (this.fx) {
        for (const b of list) this.fx.repairSparks(b.position, Math.min(2.2, 0.9 + b.radius * 0.2));
      }
    } else {
      this.notify(MESSAGES.repairStopped, 'info', 'repair-stop', 0, 3);
    }
    if (this.ui) this.ui.onSelectionChanged();
    return true;
  }

  // ------------------------------------------------------------- entities
  createBuilding(faction, type, x, z, opts = {}) {
    const def = BUILDINGS[type];
    let px = x;
    let pz = z;
    let patch = opts.patch ?? null;
    if (type === 'derrick') {
      if (!patch) patch = this.findOilPatch(x, z, 4.5);
      if (patch) {
        px = patch.x;
        pz = patch.z;
      }
    }
    const b = new Building(this, faction, type, px, pz, opts);
    b.uid = nextBuildingId++;
    if (type === 'derrick' && patch) {
      patch.derrick = b;
      b.oilPatch = patch;
    }
    this.entities.push(b);
    this.buildings.push(b);
    this.refreshNav();
    if (!opts.silent) {
      this.notify(
        `Начато строительство: ${def.name}`,
        'info',
        `build_${b.id}`,
        0,
        5,
      );
      this.stats.built++;
    }
    if (opts.complete) this.recomputePower();
    return b;
  }

  spawnUnit(faction, type, x, z, opts = {}) {
    const u = new Unit(this, faction, type, x, z, opts);
    this.entities.push(u);
    this.units.push(u);
    if (!opts.silent) {
      this.fx.buildDust(new Vector3(x, 0, z), 0.7);
    }
    return u;
  }

  findOilPatch(x, z, maxDist = 4.2) {
    let best = null;
    let bestD = maxDist;
    for (const patch of this.world.oilPatches) {
      if (patch.derrick && patch.derrick.alive) continue;
      const d = dist(x, z, patch.x, patch.z);
      if (d <= bestD) {
        best = patch;
        bestD = d;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- builders
  buildersNear(building, faction = building.faction) {
    const radius = building.radius + 8;
    const out = [];
    for (const u of this.units) {
      if (!u.alive || u.faction !== faction || !u.def.builder) continue;
      if (dist(u.position.x, u.position.z, building.position.x, building.position.z) <= radius) {
        out.push(u);
      }
    }
    return out;
  }

  /**
   * Направляет свободных инженеров к новой стройплощадке. Стройка идёт только
   * рядом с инженерами; скорость растёт с их числом (но не выше четырёх).
   */
  assignBuilders(building) {
    if (!building || !building.alive || building.complete) return 0;
    const faction = building.faction;
    const candidates = [];
    for (const u of this.units) {
      if (!u.alive || u.faction !== faction || !u.def.builder) continue;
      const d = dist(u.position.x, u.position.z, building.position.x, building.position.z);
      // Инженер может дойти и до дальнего месторождения: стройплощадку на
      // другом конце карты иначе было бы просто не с кем начать.
      if (d > 240) continue;
      const assignedElsewhere = u.assistBuilding
        && u.assistBuilding !== building
        && u.assistBuilding.alive
        && !u.assistBuilding.complete;
      if (assignedElsewhere) continue;
      const busy = u.order && u.order.type !== 'move';
      const remoteMove = u.order?.type === 'move' && faction === 'enemy';
      if (busy && !remoteMove) continue;
      candidates.push({ u, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    const chosen = candidates.slice(0, 4);
    chosen.forEach(({ u }, i) => this.sendBuilderTo(u, building, i));
    return chosen.length;
  }

  /** Ручное назначение выбранных инженеров на стройплощадку. */
  assignBuildersTo(building, builders) {
    if (!building || !building.alive || building.complete) return 0;
    let assigned = 0;
    for (const u of builders) {
      if (!u || !u.alive || !u.def.builder || assigned >= 4) continue;
      this.sendBuilderTo(u, building, assigned);
      assigned++;
    }
    return assigned;
  }

  sendBuilderTo(unit, building, index = 0) {
    unit.assistBuilding = building;
    const angle = Math.atan2(
      unit.position.z - building.position.z,
      unit.position.x - building.position.x,
    ) + index * 0.6;
    const r = building.radius + 2.4;
    unit.issueMove(
      clamp(building.position.x + Math.cos(angle) * r, -MAP.clamp, MAP.clamp),
      clamp(building.position.z + Math.sin(angle) * r, -MAP.clamp, MAP.clamp),
    );
  }

  /** Пересобирает навигационную сетку после постройки или сноса здания. */
  refreshNav() {
    if (!this.nav) return;
    const circles = this.world.obstacles.map((o) => ({
      x: o.x,
      z: o.z,
      radius: o.radius,
    }));
    for (const b of this.buildings) {
      if (!b.alive) continue;
      circles.push({
        x: b.position.x,
        z: b.position.z,
        radius: b.radius * 0.96,
      });
    }
    this.nav.setBlockers(circles, this.world.walls ?? []);
  }

  /** Стены рядом с точкой: для столкновений и проверки места застройки. */
  getWallsNear(x, z, range) {
    const out = [];
    for (const wall of this.world.walls ?? []) {
      const hit = segmentDistance(x, z, wall);
      if (hit.distance < range + wall.radius) {
        out.push({ ...wall, distance: hit.distance, nearX: hit.x, nearZ: hit.z });
      }
    }
    return out;
  }

  getObstaclesNear(x, z, range) {
    const out = [];
    for (const o of this.world.obstacles) {
      const d = dist(x, z, o.x, o.z);
      if (d < range + o.radius) out.push(o);
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      const d = dist(x, z, b.position.x, b.position.z);
      if (d < range + b.radius) {
        out.push({ x: b.position.x, z: b.position.z, radius: b.radius * 0.94, kind: 'building', building: b });
      }
    }
    return out;
  }

  isPositionFree(x, z, radius) {
    if (Math.abs(x) > MAP.clamp || Math.abs(z) > MAP.clamp) return false;
    for (const o of this.world.obstacles) {
      if (dist(x, z, o.x, o.z) < radius + o.radius + 0.2) return false;
    }
    for (const wall of this.world.walls ?? []) {
      if (segmentDistance(x, z, wall).distance < radius + wall.radius + 0.2) return false;
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (dist(x, z, b.position.x, b.position.z) < radius + b.radius + 0.2) return false;
    }
    return true;
  }

  // ------------------------------------------------------------- selection
  selectOnly(list) {
    for (const e of this.selected) e.setSelected(false);
    this.selected.clear();
    for (const e of list) {
      if (!e || !e.alive) continue;
      e.setSelected(true);
      this.selected.add(e);
      this.primary = e;
    }
    if (this.selected.size === 0) this.primary = null;
    if (this.selected.size > 0) this.audio?.ui('select');
    if (this.ui) this.ui.onSelectionChanged();
  }

  toggleSelect(entity, additive = true) {
    if (!entity || !entity.alive) return;
    if (!additive) {
      this.selectOnly([entity]);
      return;
    }
    if (this.selected.has(entity)) {
      this.selected.delete(entity);
      entity.setSelected(false);
      if (this.primary === entity) this.primary = [...this.selected][this.selected.size - 1] ?? null;
    } else {
      this.selected.add(entity);
      entity.setSelected(true);
      this.primary = entity;
    }
    if (this.ui) this.ui.onSelectionChanged();
  }

  clearSelection() {
    for (const e of this.selected) e.setSelected(false);
    this.selected.clear();
    this.primary = null;
    if (this.ui) this.ui.onSelectionChanged();
  }

  // ------------------------------------------------------------- control groups
  /** Запомнить выделенных юнитов за цифрой 1…9. */
  assignGroup(index) {
    const units = this.selectedUnits();
    if (!units.length) {
      this.notify('Сначала выберите юнитов для отряда.', 'warn', 'group-empty', 0, 3);
      return false;
    }
    this.groups.set(index, new Set(units));
    this.notify(
      `Отряд ${index}: ${units.length} ${plural(units.length, 'юнит', 'юнита', 'юнитов')}.`,
      'info',
      `group-set-${index}`,
      0,
      3,
    );
    this.ui?.onGroupsChanged?.();
    return true;
  }

  /** Живые юниты отряда; погибшие вычищаются по пути. */
  groupUnits(index) {
    const group = this.groups.get(index);
    if (!group) return [];
    for (const unit of group) {
      if (!unit.alive || unit.faction !== 'player') group.delete(unit);
    }
    if (!group.size) {
      this.groups.delete(index);
      this.ui?.onGroupsChanged?.();
      return [];
    }
    return [...group];
  }

  /** Вызвать отряд: выделить всех его живых юнитов. */
  recallGroup(index) {
    const units = this.groupUnits(index);
    if (!units.length) return false;
    this.selectOnly(units);
    return true;
  }

  /** Навести камеру на центр отряда. */
  focusGroup(index) {
    const units = this.groupUnits(index);
    if (!units.length) return false;
    const cx = units.reduce((sum, u) => sum + u.position.x, 0) / units.length;
    const cz = units.reduce((sum, u) => sum + u.position.z, 0) / units.length;
    this.input?.focusOn(cx, cz);
    return true;
  }

  /** Убрать удалённого юнита из всех отрядов. */
  pruneGroups(entity) {
    let changed = false;
    for (const [index, group] of this.groups) {
      if (!group.delete(entity)) continue;
      changed = true;
      if (!group.size) this.groups.delete(index);
    }
    if (changed) this.ui?.onGroupsChanged?.();
  }

  selectedUnits() {
    return [...this.selected].filter((e) => e instanceof Unit && e.alive && e.faction === 'player');
  }

  selectedBuildings() {
    return [...this.selected].filter((e) => e instanceof Building && e.alive && e.faction === 'player');
  }

  playerBuildings() {
    return this.buildings.filter((b) => b.faction === 'player' && b.alive);
  }

  playerUnits() {
    return this.units.filter((u) => u.faction === 'player' && u.alive);
  }

  /**
   * Выделяет инженеров без текущего задания: их обычно и ищут после стройки,
   * чтобы отправить на следующую площадку или в ремонт.
   */
  selectIdleEngineers() {
    const list = this.playerUnits().filter((u) => {
      if (!u.def.builder || u.order || u.target) return false;
      // Ссылка на достроенную площадку не делает инженера занятым.
      const site = u.assistBuilding;
      return !(site && site.alive && !site.complete);
    });
    if (!list.length) {
      this.notify('Свободных инженеров нет.', 'warn', 'idle-engineers', 0, 3);
      return false;
    }
    this.selectOnly(list);
    this.notify(
      `Свободные инженеры: ${list.length} ${plural(list.length, 'юнит', 'юнита', 'юнитов')}.`,
      'info',
      'idle-engineers',
      0,
      3,
    );
    return true;
  }

  /** Видно ли точку этой стороне: так туман войны влияет на наведение. */
  isVisibleTo(faction, x, z) {
    return this.fog ? this.fog.isVisible(faction, x, z) : true;
  }

  isExploredBy(faction, x, z) {
    return this.fog ? this.fog.isExplored(faction, x, z) : true;
  }

  isEntityVisibleTo(faction, entity) {
    return this.fog ? this.fog.isEntityVisible(faction, entity) : true;
  }

  /** Известна ли стороне постройка: видна сейчас или разведана раньше. */
  isBuildingKnownTo(faction, building) {
    return this.fog ? this.fog.isBuildingKnown(faction, building) : true;
  }

  countUnits(faction) {
    let n = 0;
    for (const u of this.units) if (u.alive && u.faction === faction) n++;
    return n;
  }

  /** Первое выбранное здание, которое нанимает этот тип юнита. */
  primaryProducer(type) {
    const source = UNITS[type]?.from;
    if (!source) return null;
    return this.selectedBuildings().find((b) => b.type === source) ?? null;
  }

  primaryHQ() {
    const bs = this.selectedBuildings().filter((b) => b.type === 'hq');
    return bs[0] ?? null;
  }

  // ------------------------------------------------------------- orders
  issueFormationMove(units, point, mode = 'move') {
    if (!units.length) return;
    const alive = units.filter((u) => u.alive);
    if (!alive.length) return;
    const cx = alive.reduce((s, u) => s + u.position.x, 0) / alive.length;
    const cz = alive.reduce((s, u) => s + u.position.z, 0) / alive.length;
    const dir = Math.atan2(point.x - cx, point.z - cz);
    const spacing = 2.25;
    const cols = Math.ceil(Math.sqrt(alive.length));
    const rows = Math.ceil(alive.length / cols);
    const sorted = alive.slice().sort((a, b) =>
      dist(a.position.x, a.position.z, point.x, point.z) - dist(b.position.x, b.position.z, point.x, point.z));
    const cos = Math.cos(dir);
    const sin = Math.sin(dir);
    sorted.forEach((unit, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = (col - (cols - 1) / 2) * spacing;
      const lz = (row - (rows - 1) / 2) * spacing;
      let tx = point.x + lx * cos + lz * sin;
      let tz = point.z - lx * sin + lz * cos;
      tx = clamp(tx, -MAP.clamp + 1, MAP.clamp - 1);
      tz = clamp(tz, -MAP.clamp + 1, MAP.clamp - 1);
      if (mode === 'attackMove') unit.issueAttackMove(tx, tz);
      else if (mode === 'patrol') unit.issuePatrol(tx, tz);
      else unit.issueMove(tx, tz);
    });
    this.fx.orderMarker(point, mode === 'attackMove' ? 'attack' : 'move');
  }

  commandMove(point) {
    const units = this.selectedUnits();
    if (!units.length) return;
    this.issueFormationMove(units, point, 'move');
    this.audio?.order('move');
  }

  commandAttackMove(point) {
    const units = this.selectedUnits();
    if (!units.length) return;
    this.issueFormationMove(units, point, 'attackMove');
    this.audio?.order('attack');
  }

  /** Патруль: отряд ходит между текущим местом и точкой. */
  commandPatrol(point) {
    const units = this.selectedUnits();
    if (!units.length) return;
    this.issueFormationMove(units, point, 'patrol');
    this.notify(
      'Патруль: отряд будет ходить между текущей позицией и указанной точкой.',
      'info',
      'patrol-order',
      0,
      3,
    );
    this.audio?.order('move');
  }

  commandAttack(target) {
    const units = this.selectedUnits();
    if (!units.length || !target || !target.alive) return;
    for (const u of units) u.issueAttack(target);
    this.fx.orderMarker(target.position, 'attack');
    this.audio?.order('attack');
  }

  commandStop() {
    const units = this.selectedUnits();
    if (!units.length) return;
    for (const u of units) u.stop();
    this.audio?.order('stop');
  }

  /** Занять позицию: юниты стреляют на месте, но не преследуют врага. */
  commandHold() {
    const units = this.selectedUnits();
    if (!units.length) return;
    for (const u of units) u.issueHold();
    const cx = units.reduce((sum, u) => sum + u.position.x, 0) / units.length;
    const cz = units.reduce((sum, u) => sum + u.position.z, 0) / units.length;
    this.fx.orderMarker(new Vector3(cx, 0, cz), 'hold');
    this.notify('Отряд держит позицию и не будет преследовать врага.', 'info', 'hold-order', 1.5, 3);
    this.audio?.order('hold');
  }

  setRally(point) {
    const producers = this.selectedBuildings().filter((b) => UNIT_PRODUCTION[b.type]);
    for (const b of producers) b.setRally(point.x, point.z);
    if (!producers.length) {
      const hq = this.primaryHQ();
      if (hq) hq.setRally(point.x, point.z);
    }
  }

  // ------------------------------------------------------------- building placement
  findPlacement(type, x, z, opts = {}) {
    const def = BUILDINGS[type];
    const faction = opts.faction ?? 'player';
    const r = def.radius;
    // Дополнительный зазор между зданиями. ИИ просит его больше, чтобы
    // постройки не лепились вплотную. Вышку не двигаем: её место задаёт
    // месторождение, и лишний зазор просто заблокировал бы добычу.
    const padding = type === 'derrick' ? 0 : (opts.padding ?? 0);
    let px = x;
    let pz = z;
    let patch = null;

    if (type === 'derrick') {
      patch = this.findOilPatch(x, z, 6.2);
      if (!patch) return { valid: false, reason: 'oil', x, z };
      px = patch.x;
      pz = patch.z;
    }

    if (Math.abs(px) > MAP.half - r - 1 || Math.abs(pz) > MAP.half - r - 1) {
      return { valid: false, reason: 'bounds', x: px, z: pz, patch };
    }

    // Строить можно только там, что уже разведано этой стороной. Проверка
    // идёт по итоговой точке: у вышки это центр месторождения, а не клик.
    if (this.fog && !this.fog.isExplored(faction, px, pz)) {
      return { valid: false, reason: 'fog', x: px, z: pz, patch };
    }

    // Своих юнитов можно потеснить: после закладки стройка аккуратно
    // расталкивает их. Чужой отряд сдвигать нельзя, поэтому он блокирует точку.
    for (const u of this.units) {
      if (!u.alive || u.faction === faction) continue;
      if (dist(px, pz, u.position.x, u.position.z) < r + u.radius + 0.25) {
        return { valid: false, reason: 'unit', x: px, z: pz, patch };
      }
    }

    for (const o of this.world.obstacles) {
      if (dist(px, pz, o.x, o.z) < r + o.radius + 0.5) {
        return { valid: false, reason: 'rock', x: px, z: pz, patch };
      }
    }
    for (const wall of this.world.walls ?? []) {
      if (segmentDistance(px, pz, wall).distance < r + wall.radius + 0.5) {
        return { valid: false, reason: 'wall', x: px, z: pz, patch };
      }
    }
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (dist(px, pz, b.position.x, b.position.z) < r + b.radius + 0.6 + padding) {
        return { valid: false, reason: 'building', x: px, z: pz, patch };
      }
    }
    for (const p of this.world.oilPatches) {
      if (type === 'derrick') {
        if (p !== patch && dist(px, pz, p.x, p.z) < r + p.radius * 0.55) {
          return { valid: false, reason: 'oil', x: px, z: pz, patch };
        }
      } else if (dist(px, pz, p.x, p.z) < r + p.radius * 0.75) {
        return { valid: false, reason: 'oil', x: px, z: pz, patch };
      }
    }
    return { valid: true, x: px, z: pz, patch };
  }

  /** Понятная причина, почему точку нельзя застроить. null — можно. */
  placementIssue(place, canAfford = true) {
    if (!place) return MESSAGES.badPlace;
    if (place.valid) return canAfford ? null : MESSAGES.noCredits;
    switch (place.reason) {
      case 'oil': return MESSAGES.needOil;
      case 'fog': return MESSAGES.needExplore;
      case 'unit': return MESSAGES.unitOnSite;
      case 'bounds': return MESSAGES.placementBounds;
      case 'rock': return MESSAGES.placementRock;
      case 'wall': return MESSAGES.placementWall;
      case 'building': return MESSAGES.placementBuilding;
      default: return MESSAGES.badPlace;
    }
  }

  /**
   * Закладывает здание. opts.faction позволяет ИИ строить за свой счёт,
   * opts.wallet — объект с полем credits (контроллер ИИ).
   */
  tryBuild(type, x, z, opts = {}) {
    const def = BUILDINGS[type];
    const faction = opts.faction ?? 'player';
    const wallet = opts.wallet ?? null;
    const credits = wallet ? wallet.credits : this.credits;
    if (!def || def.cost <= 0) return null;
    if (faction === 'player' && !this.missionAllowsBuilding(type)) {
      this.notify('В этой операции такая постройка недоступна.', 'warn', 'mission-build', 0, 3);
      return null;
    }
    if (credits < def.cost) {
      if (faction === 'player') this.notify(MESSAGES.noCredits, 'warn', 'no-credits', 0, 3);
      return null;
    }
    const place = this.findPlacement(type, x, z, opts);
    if (!place.valid) {
      if (faction === 'player') {
        this.notify(this.placementIssue(place, true), 'warn', 'bad-place', 0, 2);
      }
      return null;
    }
    if (wallet) wallet.credits -= def.cost;
    else this.credits -= def.cost;
    const b = this.createBuilding(faction, type, place.x, place.z, {
      complete: false,
      patch: place.patch,
      silent: faction !== 'player',
      rotation: opts.rotation,
    });
    this.pushUnitsOut(b);
    this.fx.buildDust(new Vector3(place.x, 0, place.z), 1.0);
    if (faction === 'player') {
      const assigned = this.assignBuilders(b);
      if (!assigned) {
        this.notify(MESSAGES.noEngineerAssigned, 'warn', 'no-engineer-assigned', 0, 5);
      }
      this.audio?.order('build');
    }
    return b;
  }

  /** Стройка расталкивает только своих юнитов: чужие отряды не сдвигаются. */
  pushUnitsOut(building) {
    for (const u of this.units) {
      if (!u.alive || u.faction !== building.faction) continue;
      const dx = u.position.x - building.position.x;
      const dz = u.position.z - building.position.z;
      const d = Math.hypot(dx, dz);
      const min = building.radius + u.radius + 0.25;
      if (d < min) {
        const nx = d > 0.001 ? dx / d : 1;
        const nz = d > 0.001 ? dz / d : 0;
        u.position.x = building.position.x + nx * min;
        u.position.z = building.position.z + nz * min;
        u.root.position.x = u.position.x;
        u.root.position.z = u.position.z;
      }
    }
  }

  cancelBuilding(building, refund = true) {
    if (!building || !building.alive || building.complete) return;
    if (refund) this.credits += Math.floor(building.def.cost * 0.6);
    if (building.oilPatch) {
      building.oilPatch.derrick = null;
      building.oilPatch = null;
    }
    this.removeEntity(building);
    building.alive = false;
    building.disposeVisual();
    this.recomputePower();
    this.notify('Строительство отменено. Возвращено 60% стоимости.', 'info', `cancel_${building.id}`, 0, 2);
    if (this.ui) this.ui.onSelectionChanged();
  }

  /**
   * Продажа достроенного здания. Командный центр не продаётся: это мгновенное
   * поражение, а не хозяйственное решение. Очередь производства не возвращает
   * кредиты — её элементы просто исчезают вместе со зданием.
   */
  sellBuilding(building) {
    if (!building || !building.alive || !building.complete) return false;
    if (building.faction !== 'player' || building.type === 'hq') return false;
    const refund = Math.floor((building.def.cost ?? 0) * SELL.refund);
    this.credits += refund;
    if (building.oilPatch) {
      building.oilPatch.derrick = null;
      building.oilPatch = null;
    }
    this.removeEntity(building);
    building.alive = false;
    building.disposeVisual();
    this.recomputePower();
    this.refreshArmyCap();
    this.notify(
      `${building.def.name}: продано. Возвращено ${refund} кредитов.`,
      'info',
      `sell_${building.id}`,
      0,
      3,
    );
    if (this.ui) this.ui.onSelectionChanged();
    return true;
  }

  // ------------------------------------------------------------- production
  spawnFromBuilding(building, type) {
    if (!building.alive) return;
    const rally = building.rally ?? building.defaultRally();
    let dx = rally.x - building.position.x;
    let dz = rally.z - building.position.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const startX = building.position.x + dx * (building.radius + 1.8);
    const startZ = building.position.z + dz * (building.radius + 1.8);
    const spot = this.findSpawnSpot(startX, startZ, UNITS[type].radius, Math.atan2(dz, dx));
    const unit = this.spawnUnit(building.faction, type, spot.x, spot.z, {
      rotation: Math.atan2(dx, dz),
      silent: false,
    });
    if (rally) {
      unit.issueMove(rally.x + (Math.random() - 0.5) * 1.6, rally.z + (Math.random() - 0.5) * 1.6);
    }
    this.fx.buildDust(new Vector3(spot.x, 0, spot.z), 0.55);
    if (building.faction === 'player') this.stats.trained++;
    if (building.faction === 'player') this.trackTrained(type);
    return unit;
  }

  findSpawnSpot(x, z, radius, angle = 0) {
    for (let ring = 0; ring < 7; ring++) {
      const r = ring * (radius * 2.1 + 0.7);
      for (let i = 0; i < 10; i++) {
        const a = angle + (i / 10) * Math.PI * 2 + ring * 0.35;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.isPositionFree(px, pz, radius) && Math.abs(px) < MAP.clamp && Math.abs(pz) < MAP.clamp) {
          return { x: px, z: pz };
        }
      }
    }
    return { x: clamp(x, -MAP.clamp, MAP.clamp), z: clamp(z, -MAP.clamp, MAP.clamp) };
  }

  /**
   * Множители характеристик юнита с учётом изученных фракцией улучшений.
   * Считается на лету, поэтому улучшение автоматически действует на всех
   * юнитов этого типа — и на уже построенных, и на новых.
   */
  unitModifiers(faction, type) {
    const mods = {
      hp: 1,
      damage: 1,
      range: 1,
      speed: 1,
      armor: 0,
      pierce: 0,
      visionAdd: 0,
      cooldown: 1,
      splash: 1,
      salvoAdd: 0,
      healRate: 1,
      healRadius: 1,
      repairRate: 1,
      buildSpeed: 1,
    };
    const active = this.upgrades[faction];
    if (!active) return mods;
    for (const key of active) {
      const def = UPGRADES[key];
      if (!def || def.scope !== 'unit' || def.target !== type) continue;
      const effects = def.effects ?? {};
      if (effects.hp) mods.hp *= effects.hp;
      if (effects.damage) mods.damage *= effects.damage;
      if (effects.range) mods.range *= effects.range;
      if (effects.speed) mods.speed *= effects.speed;
      if (effects.armor) mods.armor += effects.armor;
      if (effects.pierce) mods.pierce += effects.pierce;
      if (effects.visionAdd) mods.visionAdd += effects.visionAdd;
      if (effects.cooldown) mods.cooldown *= effects.cooldown;
      if (effects.splash) mods.splash *= effects.splash;
      if (effects.salvoAdd) mods.salvoAdd += effects.salvoAdd;
      if (effects.healRate) mods.healRate *= effects.healRate;
      if (effects.healRadius) mods.healRadius *= effects.healRadius;
      if (effects.repairRate) mods.repairRate *= effects.repairRate;
      if (effects.buildSpeed) mods.buildSpeed *= effects.buildSpeed;
    }
    return mods;
  }

  /** Следующий неизученный уровень линии или null, если линия закрыта. */
  nextUpgradeKey(faction, lineKey) {
    for (const key of UPGRADE_LINE_KEYS[lineKey] ?? []) {
      if (!this.upgrades[faction]?.has(key)) return key;
    }
    return null;
  }

  /** Линии, которые исследуются в здании этого типа. */
  researchLines(buildingType) {
    return UPGRADE_LINES
      .filter((line) => line.building === buildingType)
      .map((line) => line.key);
  }

  /** Доступные ИИ исследования: следующие уровни линий без дублей. */
  availableUpgrades(faction) {
    const list = [];
    for (const line of UPGRADE_LINES) {
      const key = this.nextUpgradeKey(faction, line.key);
      if (!key) continue;
      if (this.hasPendingUpgrade(faction, key)) continue;
      const def = UPGRADES[key];
      if (def.requires && !this.upgrades[faction]?.has(def.requires)) continue;
      list.push(key);
    }
    return list;
  }

  /** Есть ли у фракции это исследование в очереди хотя бы одной лаборатории. */
  hasPendingUpgrade(faction, key) {
    return this.buildings.some((b) => (
      b.alive
      && b.faction === faction
      && b.queue?.some((item) => item.upgrade === key)
    ));
  }

  /** Запускает исследование в техцентре. */
  startUpgrade(building, key) {
    const def = UPGRADES[key];
    if (!def || !building || !building.alive || !building.complete) return false;
    // Каждая линия исследуется только в своём здании.
    if (UPGRADE_BUILDING[def.line] !== building.type) return false;
    const faction = building.faction;
    if (this.upgrades[faction]?.has(key)) {
      if (faction === 'player') {
        this.notify('Это улучшение уже изучено.', 'hint', `research_done_${key}`, 0, 3);
      }
      return false;
    }
    if (this.hasPendingUpgrade(faction, key)) {
      if (faction === 'player') {
        this.notify('Это улучшение уже исследуется.', 'hint', `research_queue_${key}`, 0, 3);
      }
      return false;
    }
    if (def.requires && !this.upgrades[faction]?.has(def.requires)) {
      if (faction === 'player') {
        this.notify('Сначала изучите предыдущий уровень.', 'hint', `research_requires_${key}`, 0, 3);
      }
      return false;
    }
    if (this.walletFor(faction) < def.cost) {
      if (faction === 'player') this.notify(MESSAGES.noCredits, 'warn', 'no-credits', 0, 3);
      return false;
    }
    this.spend(faction, def.cost);
    building.enqueueUpgrade(key);
    if (faction === 'player') {
      this.notify(`Исследование начато: ${def.name}.`, 'info', `research_start_${key}`, 0, 4);
    }
    if (this.ui) this.ui.onQueueChanged(building);
    return true;
  }

  /** Завершает исследование и сразу применяет эффект ко всем целям. */
  completeUpgrade(building, key) {
    const def = UPGRADES[key];
    if (!def || !building) return;
    const faction = building.faction;
    const active = this.upgrades[faction];
    if (!active) return;
    const first = !active.has(key);
    active.add(key);
    if (first) {
      if (def.scope === 'unit') {
        for (const unit of this.units) {
          if (unit.alive && unit.faction === faction && unit.type === def.target) {
            unit.applyUpgrades(true);
          }
        }
      } else if (def.scope === 'building') {
        for (const b of this.buildings) {
          if (!b.alive || b.faction !== faction) continue;
          if (def.target !== 'building' && b.type !== def.target) continue;
          b.applyUpgrades?.(true);
        }
      } else if (def.scope === 'global') {
        // Лимит армии кэшируется в публичном поле — обновляем его сразу,
        // не дожидаясь следующего пересчёта энергосети.
        this.refreshArmyCap();
      }
    }
    if (first && faction === 'player') {
      const tail = def.scope === 'unit'
        ? 'Отряд усилен.'
        : def.scope === 'building'
          ? 'Постройки усилены.'
          : 'Эффект действует на всю колонию.';
      this.notify(
        `Исследование завершено: ${def.name}. ${tail}`,
        'success',
        `research_done_${key}`,
        0,
        5,
      );
      // Карточка выбранного юнита или здания должна сразу показать новые характеристики.
      if (this.ui) this.ui.onSelectionChanged();
    }
  }

  trainUnit(type, building = this.primaryProducer(type)) {
    const def = UNITS[type];
    if (!def) return false;
    if (!this.missionAllowsUnit(type)) {
      this.notify('В этой операции такой юнит недоступен.', 'warn', 'mission-train', 0, 3);
      return false;
    }
    if (!building || !building.alive) return false;
    if (!building.complete) {
      this.notify(MESSAGES.notReady, 'warn', 'not-ready', 0, 3);
      return false;
    }
    if (this.credits < def.cost) {
      this.notify(MESSAGES.noCredits, 'warn', 'no-credits', 0, 3);
      return false;
    }
    const supply = def.supply ?? 1;
    const used = this.getArmyUsed('player') + this.getQueuedSupply('player');
    if (used + supply > this.getArmyCap('player')) {
      this.notify(MESSAGES.capReached, 'warn', 'cap', 0, 3);
      return false;
    }
    this.credits -= def.cost;
    building.enqueue(type);
    if (this.ui) this.ui.onQueueChanged(building);
    this.audio?.order('train');
    return true;
  }

  cancelQueue(building, index) {
    if (!building || !building.alive) return;
    const item = building.cancelQueue(index);
    if (!item) return;
    const def = item.upgrade ? UPGRADES[item.upgrade] : UNITS[item.type];
    if (def) this.credits += def.cost;
    if (this.ui) this.ui.onSelectionChanged();
  }

  // ------------------------------------------------------------- combat
  dealDamage(target, amount, source) {
    if (!target || !target.alive) return;
    target.takeDamage(amount, source);
  }

  splashDamage(point, radius, amount, source) {
    if (!source) return;
    // РСЗО бьёт по площади без разбора: свои юниты, здания и сама
    // установка получают урон, если оказались в зоне залпа.
    const friendlyFire = source.def?.friendlyFire ?? 0;
    for (const e of this.entities.slice()) {
      if (!e.alive) continue;
      if (!(e instanceof Unit) && !(e instanceof Building)) continue;
      const friendly = e.faction === source.faction;
      if (friendly && friendlyFire <= 0) continue;
      const d = dist(point.x, point.z, e.position.x, e.position.z);
      if (d > radius + e.radius * 0.4) continue;
      const falloff = 1 - 0.5 * clamp(d / radius, 0, 1);
      e.takeDamage(amount * falloff * (friendly ? friendlyFire : 1), source);
    }
  }

  onEntityDamaged(entity, source, dmg) {
    if (!entity || !source) return;
    // Урон в демонстрационном бою не идёт ни в опыт, ни в статистику партии.
    if (this.attract) return;
    // Опыт идёт только за урон по противнику: обстрел своих его не даёт.
    if (source.faction !== entity.faction && source instanceof Unit) {
      source.addXp?.(dmg * VETERANCY.xpPerDamage);
    }
    if (source.faction === 'player' && entity.faction !== 'player') {
      this.stats.damageByType[source.type] = (this.stats.damageByType[source.type] ?? 0) + dmg;
    }
    if (entity.faction !== 'player') return;
    if (source.faction === 'enemy') {
      // ИИ копит статистику урона своей волны: по ней он решает,
      // повторять ли удар тем же составом.
      this.ai?.onDamageDealt?.(source, entity, dmg);
      if (this.ui) this.ui.hitIndicator(entity);
    } else if (source.def?.friendlyFire) {
      // Своя РСЗО накрыла своих: подсвечиваем удар, чтобы это не прошло
      // незамеченным на фоне боя.
      if (this.ui) this.ui.hitIndicator(entity);
    }
  }

  onEntityDeath(entity, source) {
    const scale = entity.isBuilding
      ? 1.6 + entity.radius * 0.25
      : entity.type === 'tank'
        ? 1.25
        : 0.62;
    const pos = entity.position.clone();
    pos.y = entity.isBuilding ? 1.6 : 0.9;
    this.fx.explode(pos, scale, { scorch: entity.isBuilding || entity.type === 'tank' });
    this.fx.buildDust(entity.position, entity.isBuilding ? 1.5 : 0.5);
    if (!this.attract) this.audio?.explosion(pos, scale);

    // Демонстрационный бой на главном экране: взрыв нужен, а статистика,
    // уведомления и победа — нет, партия ещё не началась.
    if (this.attract) {
      this.removeEntity(entity);
      if (this.ui) this.ui.onSelectionChanged();
      this.recomputePower();
      return;
    }

    // Убийство засчитывается только за урон игрока: если противник сгорел
    // от собственного залпа, это не наша заслуга.
    if (source && source.faction !== entity.faction) {
      if (source instanceof Unit) {
        source.kills++;
        source.addXp?.(VETERANCY.killXp);
      }
      if (source.faction === 'player') {
        this.stats.killsByType[source.type] = (this.stats.killsByType[source.type] ?? 0) + 1;
      }
    }
    if (entity.faction === 'enemy' && source?.faction === 'player') this.stats.kills++;
    if (entity.isBuilding && entity.faction === 'enemy' && source?.faction === 'player') {
      this.trackDestroyed(entity.type);
    }
    if (entity.faction === 'player') {
      this.stats.losses++;
      this.stats.lossesByType[entity.type] = (this.stats.lossesByType[entity.type] ?? 0) + 1;
      this.ai?.onPlayerLoss?.(entity, source);
      if (source?.faction === 'player' && source.def?.friendlyFire) {
        this.notify(
          'Залп РСЗО накрыл своих. Не стреляйте по своим войскам и зданиям.',
          'danger',
          'friendly-fire',
          8,
          5,
        );
      }
    }

    if (entity.isBuilding && entity.type === 'derrick' && entity.oilPatch) {
      entity.oilPatch.derrick = null;
      entity.oilPatch = null;
      if (entity.faction === 'enemy') {
        this.notify('Нефтяная вышка противника уничтожена. Доход врага снижен.', 'success', `ed_${entity.id}`, 0, 4);
      } else {
        this.notify('Наша нефтяная вышка уничтожена.', 'danger', `pd_${entity.id}`, 0, 4);
      }
    } else if (entity.isBuilding && entity.faction === 'player') {
      this.notify(`Потеряно: ${entity.def.name}`, 'danger', `lost_${entity.id}`, 0, 4);
    } else if (entity.isBuilding && entity.faction === 'enemy' && entity.type !== 'hq') {
      this.notify(`Уничтожено: ${entity.def.name} противника`, 'success', `killed_${entity.id}`, 0, 3);
    }

    const wasHQ = entity.isBuilding && entity.type === 'hq';
    this.removeEntity(entity);
    if (this.ui) this.ui.onSelectionChanged();
    this.recomputePower();

    if (wasHQ) {
      if (entity.faction === 'player') this.endGame('defeat');
      else if (!this.mission) this.endGame('victory');
      else this.updateObjectives();
    }
  }

  removeEntity(entity) {
    if (entity?.isBuilding) this.fog?.forgetBuilding(entity);
    this.entities = this.entities.filter((e) => e !== entity);
    this.units = this.units.filter((e) => e !== entity);
    this.buildings = this.buildings.filter((e) => e !== entity);
    if (this.selected.delete(entity)) {
      if (this.primary === entity) this.primary = [...this.selected].at(-1) ?? null;
    }
    this.pruneGroups(entity);
    if (entity.isBuilding) this.refreshNav();
  }

  // ------------------------------------------------------------- ui helpers
  notify(text, kind = 'info', key = null, cooldown = 0, duration = 4) {
    if (!this.ui) return;
    if (key) {
      const last = this.notifyTimes.get(key) ?? -999;
      if (cooldown > 0 && this.elapsed - last < cooldown) return;
      this.notifyTimes.set(key, this.elapsed);
    }
    this.ui.message(text, kind, duration);
  }

  getStatus() {
    return {
      credits: Math.floor(this.credits),
      power: this.power.player,
      army: this.getArmyUsed('player'),
      cap: this.getArmyCap('player'),
      units: this.countUnits('player'),
      time: this.elapsed,
    };
  }

  startPlacement(type) {
    if (!this.missionAllowsBuilding(type)) {
      this.notify('В этой операции такая постройка недоступна.', 'warn', 'mission-build', 0, 3);
      return;
    }
    if (this.input) this.input.startPlacement(type);
    else this.notify('Нет связи с системой строительства.', 'warn');
  }

  focusOn(x, z) {
    if (this.input) this.input.focusOn(x, z);
  }
}

