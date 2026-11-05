// Состояние игры: экономика, выбор, приказы, производство, победа.

import { Vector3, Color3 } from './babylon.js';
import {
  START,
  UNITS,
  BUILDINGS,
  UPGRADES,
  FACTIONS,
  MAP,
  MESSAGES,
  AI,
  REPAIR,
} from './config.js';
import { clamp, dist, formatTime } from './utils.js';
import { Unit, Building } from './entities.js';
import { NavGrid, segmentDistance } from './nav.js';
import { AIController } from './ai.js';
import { FogOfWar } from './fog.js';

let nextBuildingId = 1;

export class Game {
  constructor({ scene, camera, factory, world, fx, graphics, audio, audioSettings }) {
    this.scene = scene;
    this.camera = camera;
    this.factory = factory;
    this.world = world;
    this.map = world.map;
    this.fx = fx;
    this.graphics = graphics;
    this.audio = audio ?? null;
    this.audioSettings = audioSettings ?? null;
    this.ui = null;
    this.input = null;

    this.entities = [];
    this.units = [];
    this.buildings = [];
    this.selected = new Set();
    this.primary = null;

    this.credits = START.credits;
    this.armyCap = START.armyCap;
    this.elapsed = 0;
    this.paused = true;
    this.started = false;
    this.over = null;

    this.stats = { kills: 0, losses: 0, gathered: 0, trained: 0, built: 0 };
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
    this.fog = new FogOfWar(this);
    this.refreshNav();
    this.recomputePower();
    this.refreshArmyCap();
    this.ai = new AIController(this);
    this.ui = null;
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

  // ------------------------------------------------------------- loop
  begin() {
    if (this.started) return;
    this.started = true;
    this.paused = false;
    const hq = this.playerBuildings().find((b) => b.type === 'hq');
    if (hq) this.selectOnly([hq]);
    this.notify('Связь установлена. Командование колонией за вами.', 'info', 'begin', 0);
    this.notify('Постройте казармы и держите инженеров под рукой: без них стройка стоит.', 'hint', 'hint-build', 0, 10);
  }

  setPaused(value) {
    if (this.over) return;
    this.paused = value;
  }

  update(dt) {
    if (!this.started || this.paused || this.over) return;
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

    // проверка атаки на базу
    this.baseAlertCd -= dt;
    if (this.baseAlertCd <= 0) {
      this.baseAlertCd = 0.8;
      this.checkBaseUnderAttack();
    }

    // подсказки
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

    this.checkVictory();
  }

  checkVictory() {
    if (this.over) return;
    const playerHQ = this.entities.find((e) => e.alive && e.isBuilding && e.type === 'hq' && e.faction === 'player');
    const enemyHQ = this.entities.find((e) => e.alive && e.isBuilding && e.type === 'hq' && e.faction === 'enemy');
    if (!enemyHQ) this.endGame('victory');
    else if (!playerHQ) this.endGame('defeat');
  }

  endGame(result) {
    if (this.over) return;
    this.over = result;
    this.paused = true;
    this.stats.time = this.elapsed;
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
    return sum;
  }

  enemyIncome() {
    let sum = AI.baseIncome;
    for (const b of this.buildings) {
      if (b.alive && b.faction === 'enemy' && b.type === 'derrick' && b.complete) sum += b.def.income;
    }
    // Противник не должен развиваться быстрее игрока: у него нет микроконтроля.
    return sum * 0.7;
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
    return cap;
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
    return def.cost > 0
      ? (def.cost * REPAIR.costFraction) / def.hp
      : REPAIR.hqCostPerHp;
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

  countUnits(faction) {
    let n = 0;
    for (const u of this.units) if (u.alive && u.faction === faction) n++;
    return n;
  }

  primaryBarracks() {
    const bs = this.selectedBuildings().filter((b) => b.type === 'barracks');
    return bs[0] ?? null;
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
    const barracks = this.selectedBuildings().filter((b) => b.type === 'barracks');
    for (const b of barracks) b.setRally(point.x, point.z);
    if (!barracks.length) {
      const hq = this.primaryHQ();
      if (hq) hq.setRally(point.x, point.z);
    }
  }

  // ------------------------------------------------------------- building placement
  findPlacement(type, x, z) {
    const def = BUILDINGS[type];
    const r = def.radius;
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
      if (dist(px, pz, b.position.x, b.position.z) < r + b.radius + 0.6) {
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
    if (credits < def.cost) {
      if (faction === 'player') this.notify(MESSAGES.noCredits, 'warn', 'no-credits', 0, 3);
      return null;
    }
    const place = this.findPlacement(type, x, z);
    if (!place.valid) {
      if (faction === 'player') {
        if (place.reason === 'oil') this.notify(MESSAGES.needOil, 'warn', 'bad-place', 0, 2);
        else this.notify(MESSAGES.badPlace, 'warn', 'bad-place', 0, 2);
      }
      return null;
    }
    if (wallet) wallet.credits -= def.cost;
    else this.credits -= def.cost;
    const b = this.createBuilding(faction, type, place.x, place.z, {
      complete: false,
      patch: place.patch,
      silent: faction !== 'player',
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

  pushUnitsOut(building) {
    for (const u of this.units) {
      if (!u.alive) continue;
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
    const mods = { hp: 1, damage: 1, range: 1, speed: 1, armor: 0 };
    const active = this.upgrades[faction];
    if (!active) return mods;
    for (const key of active) {
      const def = UPGRADES[key];
      if (!def || def.target !== type) continue;
      const effects = def.effects ?? {};
      if (effects.hp) mods.hp *= effects.hp;
      if (effects.damage) mods.damage *= effects.damage;
      if (effects.range) mods.range *= effects.range;
      if (effects.speed) mods.speed *= effects.speed;
      if (effects.armor) mods.armor += effects.armor;
    }
    return mods;
  }

  /** Запускает исследование в техцентре. */
  startUpgrade(building, key) {
    const def = UPGRADES[key];
    if (!def || !building || !building.alive || !building.complete) return false;
    if (building.type !== 'lab') return false;
    const faction = building.faction;
    if (this.upgrades[faction]?.has(key)) {
      if (faction === 'player') {
        this.notify('Это улучшение уже изучено.', 'hint', `research_done_${key}`, 0, 3);
      }
      return false;
    }
    if (building.queue.some((item) => item.upgrade === key)) {
      if (faction === 'player') {
        this.notify('Это улучшение уже в очереди.', 'hint', `research_queue_${key}`, 0, 3);
      }
      return false;
    }
    if (building.queue.length >= building.maxQueue) {
      if (faction === 'player') this.notify(MESSAGES.queueFull, 'warn', 'queue-full', 0, 3);
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

  /** Завершает исследование и сразу усиливает всех юнитов этого типа. */
  completeUpgrade(building, key) {
    const def = UPGRADES[key];
    if (!def || !building) return;
    const faction = building.faction;
    const active = this.upgrades[faction];
    if (!active) return;
    const first = !active.has(key);
    active.add(key);
    if (first) {
      for (const unit of this.units) {
        if (unit.alive && unit.faction === faction && unit.type === def.target) {
          unit.applyUpgrades(true);
        }
      }
    }
    if (faction === 'player') {
      this.notify(
        `Исследование завершено: ${def.name}. Отряд усилен.`,
        'success',
        `research_done_${key}`,
        0,
        5,
      );
      // Карточка выбранного юнита должна сразу показать новые характеристики.
      if (this.ui) this.ui.onSelectionChanged();
    }
  }

  trainUnit(type, building = this.primaryBarracks()) {
    const def = UNITS[type];
    if (!def) return false;
    if (!building || !building.alive) return false;
    if (!building.complete) {
      this.notify(MESSAGES.notReady, 'warn', 'not-ready', 0, 3);
      return false;
    }
    if (building.queue.length >= building.maxQueue) {
      this.notify(MESSAGES.queueFull, 'warn', 'queue-full', 0, 3);
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
    for (const e of this.entities.slice()) {
      if (!e.alive || e.faction === source.faction) continue;
      if (!(e instanceof Unit) && !(e instanceof Building)) continue;
      const d = dist(point.x, point.z, e.position.x, e.position.z);
      if (d > radius + e.radius * 0.4) continue;
      const falloff = 1 - 0.5 * clamp(d / radius, 0, 1);
      e.takeDamage(amount * falloff, source);
    }
  }

  onEntityDamaged(entity, source, dmg) {
    if (!entity || !source) return;
    if (entity.faction === 'player' && source.faction === 'enemy') {
      // ИИ копит статистику урона своей волны: по ней он решает,
      // повторять ли удар тем же составом.
      this.ai?.onDamageDealt?.(source, entity, dmg);
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
    this.audio?.explosion(pos, scale);

    if (entity.faction === 'enemy') this.stats.kills++;
    if (entity.faction === 'player') {
      this.stats.losses++;
      this.ai?.onPlayerLoss?.(entity, source);
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
      if (entity.faction === 'enemy') this.endGame('victory');
      else this.endGame('defeat');
    }
  }

  removeEntity(entity) {
    this.entities = this.entities.filter((e) => e !== entity);
    this.units = this.units.filter((e) => e !== entity);
    this.buildings = this.buildings.filter((e) => e !== entity);
    if (this.selected.delete(entity)) {
      if (this.primary === entity) this.primary = [...this.selected].at(-1) ?? null;
    }
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
    if (this.input) this.input.startPlacement(type);
    else this.notify('Нет связи с системой строительства.', 'warn');
  }

  focusOn(x, z) {
    if (this.input) this.input.focusOn(x, z);
  }
}

