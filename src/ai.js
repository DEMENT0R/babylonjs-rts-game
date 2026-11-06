// Простой противник: экономика, инженеры, застройка, ремонт и волны атак.

import { Vector3 } from './babylon.js';
import { AI, AI_DIFFICULTY, BUILDINGS, MAP, UNITS, UPGRADES } from './config.js';
import { clamp, dist, distToSegment, shuffle, TAU } from './utils.js';

export class AIController {
  constructor(game, difficulty = 'normal') {
    this.game = game;
    // Сложность — это набор правил поверх одного и того же ИИ: флаги
    // включают «умные» привычки, множители меняют темп и экономику.
    this.difficulty = AI_DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.rules = AI_DIFFICULTY[this.difficulty];
    this.credits = AI.credits * (0.85 + Math.random() * 0.4);
    this.waveTimer = AI.firstWave * this.rules.firstWave * (0.8 + Math.random() * 0.4);
    this.waveIndex = 0;
    this.rally = this.baseRally();
    this.defenseTimer = 0;
    this.garrisonTimer = 1;
    this.trainTimer = 2;
    this.lastWaveAt = -999;
    this.targetPoint = null;
    this.buildTimer = 5;
    this.repairTimer = 9;
    this.researchTimer = 25;
    this.assignTimer = 7;
    this.scoutTimer = 12 + Math.random() * 8;
    this.lastScoutNoticeAt = -999;
    // Места, где разведка уже попадала под удар. Пока метка жива, ИИ не ведёт
    // новых бойцов тем же маршрутом: иначе разведчики гибнут по одному и по
    // одной и той же тропе.
    this.scoutLosses = [];
    // Ушедшие в разведку: id → { unit, x, z, since }. По ним видно, кто
    // погиб, и по ним же разведка не переназначается каждый цикл.
    this.scoutTasks = new Map();
    this.scoutCheckTimer = 1;
    // Сколько секунд подряд казармы простаивают из-за нехватки кредитов.
    // Пока это значение велико, противник обороняется, а не нападает.
    this.starvedTime = 0;
    this.buildIntent = null;
    // Сколько секунд текущий план стройки ждёт кредитов. По этому счётчику
    // найм решает, пора ли перестать копить и купить бойца.
    this.saveTime = 0;
    this.buildCount = 0;
    this.lastBuildNoticeAt = -999;
    // Характер конкретной партии: влияет на размер волн, состав армии и
    // готовность рисковать. Благодаря этому ИИ не играет одинаково каждый раз.
    this.aggression = 0.75 + Math.random() * 0.55;
    this.buildAngle = Math.random() * TAU;
    // Память о волнах: что отправили и чем это кончилось. Без неё ИИ снова
    // и снова повторял один и тот же провальный удар.
    this.waveLog = [];
    this.activeWave = null;
    // Цели, на которых волна уже провалилась: их не трогаем, пока не истечёт
    // кулдаун, иначе ИИ раз за разом бьётся в одно и то же место.
    this.targetCooldowns = new Map();
    // Телеметрия: без неё непонятно, стало ли лучше от «умных» правок.
    this.stats = {
      waves: 0,
      settled: 0,
      failures: 0,
      wiped: 0,
      timeouts: 0,
      retreats: 0,
      supplyLost: 0,
      damage: 0,
      kills: 0,
      duration: 0,
    };
    this.debug = typeof location !== 'undefined' && /[?&]debug=ai\b/.test(location.search);
    this.debugEl = null;
    this.debugTimer = 0;
    // Отложенные волны и сообщения о них: игрок должен понимать, что
    // противник не сломался, а копит силы.
    this.postponedRuns = 0;
    if (this.debug) this.ensureDebugOverlay();

    const barracks = game.buildings.find((b) => b.faction === 'enemy' && b.type === 'barracks');
    if (barracks) {
      barracks.rally = this.rally.clone();
      this.barracks = barracks;
    }
  }

  enemyHq() {
    return this.game.buildings.find(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'hq',
    );
  }

  /** Точка сбора у базы врага, смещённая в сторону игрока. */
  baseRally() {
    const enemyHq = this.game.map.spawn.enemy.hq;
    const playerHq = this.game.map.spawn.player.hq;
    const dx = playerHq.x - enemyHq.x;
    const dz = playerHq.z - enemyHq.z;
    const len = Math.hypot(dx, dz) || 1;
    return new Vector3(enemyHq.x + (dx / len) * 13, 0, enemyHq.z + (dz / len) * 13);
  }

  /** Направление от базы противника к базе игрока: ось, с которой ждать удара. */
  threatDir() {
    const enemyHq = this.game.map.spawn.enemy.hq;
    const playerHq = this.game.map.spawn.player.hq;
    const dx = playerHq.x - enemyHq.x;
    const dz = playerHq.z - enemyHq.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /**
   * Позиция гарнизона: вплотную к передней турели, в её радиусе. Если турелей
   * ещё нет, гарнизон стоит на подходе к базе противника, а не в чистом поле.
   */
  defenseAnchor() {
    const hq = this.enemyHq();
    if (!hq) return this.baseRally();
    const dir = this.threatDir();
    let turret = null;
    let bestScore = -Infinity;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.type !== 'turret') continue;
      // Турели у дальних вышек не должны уводить гарнизон с базы.
      if (dist(b.position.x, b.position.z, hq.position.x, hq.position.z)
        > AI.garrisonRadius + 6) continue;
      const dx = b.position.x - hq.position.x;
      const dz = b.position.z - hq.position.z;
      const score = dx * dir.x + dz * dir.z;
      if (score > bestScore) {
        bestScore = score;
        turret = b;
      }
    }
    if (turret) {
      const dx = turret.position.x - hq.position.x;
      const dz = turret.position.z - hq.position.z;
      const len = Math.hypot(dx, dz) || 1;
      // Чуть впереди турели: гарнизон прикрывает её собой, оставаясь в её
      // радиусе, а не прячется за штабом вне сектора обстрела.
      return new Vector3(
        turret.position.x + (dx / len) * 3.5,
        0,
        turret.position.z + (dz / len) * 3.5,
      );
    }
    return new Vector3(
      hq.position.x + dir.x * AI.garrisonHoldRadius,
      0,
      hq.position.z + dir.z * AI.garrisonHoldRadius,
    );
  }

  /**
   * Позиционный гарнизон. Он не уходит в волны и не гоняется за врагом:
   * стоит под прикрытием турелей и принимает бой, когда противник подходит.
   */
  ensureGarrison() {
    const hq = this.enemyHq();
    if (!hq) return;
    const fighters = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder && !u.def.healer,
    );
    // Не оголяем армию ради гарнизона: хотя бы пара бойцов должна остаться
    // свободной для разведки и первой волны.
    if (fighters.length <= AI.garrisonSupply + 1) return;

    let supply = 0;
    for (const u of this.game.units) {
      if (!u.aiGarrison) continue;
      if (u.alive) supply += u.def.supply ?? 1;
      else u.aiGarrison = false;
    }
    if (supply >= AI.garrisonSupply) return;

    const anchor = this.defenseAnchor();
    const active = this.activeWave?.ids;
    const candidates = fighters
      .filter((u) => (
        !u.aiGarrison
        && !(active && active.has(u.id))
        && (!u.order || u.order.type === 'move' || u.order.type === 'hold')
        && dist(u.position.x, u.position.z, hq.position.x, hq.position.z) <= AI.garrisonRadius
      ))
      .sort((a, b) => dist(a.position.x, a.position.z, hq.position.x, hq.position.z)
        - dist(b.position.x, b.position.z, hq.position.x, hq.position.z));

    for (const u of candidates) {
      if (supply >= AI.garrisonSupply) break;
      u.aiGarrison = true;
      u.issueHold(
        anchor.x + (Math.random() - 0.5) * 6,
        anchor.z + (Math.random() - 0.5) * 6,
      );
      supply += u.def.supply ?? 1;
    }
  }

  update(dt) {
    if (this.game.over) {
      this.debugEl?.remove();
      this.debugEl = null;
      return;
    }
    this.credits += this.game.enemyIncome() * this.rules.income * dt;
    this.trainTimer -= dt;
    this.defenseTimer -= dt;
    this.buildTimer -= dt;
    this.repairTimer -= dt;
    this.researchTimer -= dt;
    this.assignTimer -= dt;
    this.scoutTimer -= dt;

    this.updateEconomy(dt);
    // Пока висит план стройки, копим на него, но не бесконечно: счётчик
    // ограничивает паузу в найме (см. tryTrain).
    this.saveTime = this.buildIntent ? this.saveTime + dt : 0;

    this.garrisonTimer -= dt;
    if (this.garrisonTimer <= 0) {
      this.garrisonTimer = 2;
      this.ensureGarrison();
    }

    if (this.defenseTimer <= 0) {
      this.defenseTimer = 1.5;
      this.defendBase();
      this.defendStructures();
      this.defendEngineers();
    }

    if (this.buildTimer <= 0) {
      this.buildTimer = 2 + Math.random() * 3;
      this.planBase();
    }

    if (this.assignTimer <= 0) {
      this.assignTimer = 4 + Math.random() * 3;
      this.ensureBuildersOnSites();
    }

    if (this.repairTimer <= 0) {
      this.repairTimer = 5 + Math.random() * 4;
      this.updateRepairs();
    }

    if (this.researchTimer <= 0) {
      this.researchTimer = 6 + Math.random() * 8;
      this.tryResearch();
    }

    if (this.scoutTimer <= 0) {
      // Бедный противник бережёт силы: разведка реже, чтобы не терять бойцов в тумане.
      this.scoutTimer = this.isStarved()
        ? AI.scoutWeakInterval + Math.random() * 16
        : 10 + Math.random() * 8;
      this.sendScouts();
    }

    this.scoutCheckTimer -= dt;
    if (this.scoutCheckTimer <= 0) {
      this.scoutCheckTimer = 1;
      this.updateScouts();
    }

    if (this.trainTimer <= 0) {
      this.trainTimer = 1.0;
      this.tryTrain();
    }

    this.updateWaveMemory();
    this.updateWave(dt);
    this.updateDebugOverlay(dt);
  }

  // ------------------------------------------------------------- строительство
  /** Живые инженеры противника. */
  engineerCount() {
    return this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && u.def.builder,
    ).length;
  }

  ensureEngineers(hq) {
    if (!hq || !hq.complete || hq.queue.length > 1) return;
    if (hq.queue.some((item) => item.type === 'engineer')) return;
    const count = this.engineerCount();
    const vehicles = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && u.def.vehicle,
    ).length;
    // Двое инженеров чинят технику в волне, один остаётся на стройке.
    // Третий нужен только когда машин уже достаточно много.
    const target = this.game.elapsed > AI.engineerThirdAt && vehicles >= 3 ? 3
      : this.game.elapsed > 90 ? 2 : 1;
    if (count >= target) return;
    const used = this.game.getArmyUsed('enemy') + this.game.getQueuedSupply('enemy');
    if (used + (UNITS.engineer.supply ?? 1) > this.game.getArmyCap('enemy')) return;
    const def = UNITS.engineer;
    const reserve = count === 0 ? 90 : 50;
    if (this.credits < def.cost + reserve) return;
    this.credits -= def.cost;
    hq.enqueue('engineer');
  }

  planBase() {
    const game = this.game;
    const hq = this.enemyHq();
    if (!hq || !hq.complete) return;

    this.ensureEngineers(hq);

    const unfinished = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && !b.complete,
    );
    const maxSites = game.elapsed > 150 ? 2 : 1;
    if (unfinished.length >= maxSites) {
      this.buildIntent = null;
      this.saveTime = 0;
      return;
    }

    const barracks = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'barracks' && b.complete,
    ).length;
    const lab = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'lab' && b.complete,
    ).length;
    const depots = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'depot',
    ).length;
    const turrets = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'turret' && b.complete,
    ).length;
    const walls = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'wall',
    ).length;
    const buildings = game.buildings.filter((b) => b.alive && b.faction === 'enemy').length;
    const power = game.power.enemy;
    // Стройка ещё не даёт энергии, но уже начнёт её потреблять: учитываем
    // площадки в запасе, иначе ИИ заказывал бы вторую станцию, пока первая
    // строится, или спохватывался бы только по факту дефицита.
    let incomingUse = 0;
    let incomingProduce = 0;
    for (const b of unfinished) {
      incomingUse += b.def.powerUse || 0;
      incomingProduce += b.def.powerProduce || 0;
    }
    const powerMargin = power.produced + incomingProduce - power.used - incomingUse;
    const freePatch = this.findFreePatch();
    const armyUsed = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const armyCap = game.getArmyCap('enemy');

    let type = null;
    if (barracks === 0) type = 'barracks';
    // Энергию держим с запасом, а не по факту дефицита: при перерасходе
    // производство падает втрое, и армия встаёт вместе с базой.
    else if (powerMargin < AI.powerReserve) type = 'power';
    // Разведанное месторождение — приоритет: вышка дешёвая и сразу платит.
    else if (freePatch && this.credits > BUILDINGS.derrick.cost + 60) type = 'derrick';
    else if (armyCap - armyUsed < 6 && depots < 5 && this.credits > BUILDINGS.depot.cost + 30) {
      type = 'depot';
    } else if (turrets === 0 && game.elapsed > 130) {
      // Первую турель противник копит целенаправленно: армия на время замирает.
      type = 'turret';
    } else if (game.elapsed > 110 && turrets < (game.elapsed > 220 ? AI.turretCap : 2)
      && this.credits > BUILDINGS.turret.cost + 80) {
      type = 'turret';
    } else if (lab === 0 && game.elapsed > 170 && this.credits > 320) type = 'lab';
    else if (barracks < 2 && game.elapsed > 135) type = 'barracks';
    // Баррикады дешёвые и быстрые: линия перед турелями появляется после
    // первых двух турелей и второй казармы, чтобы не тормозить армию.
    else if (game.elapsed > 170 && turrets >= 2 && walls < AI.wallCap
      && this.credits > BUILDINGS.wall.cost + 20) {
      type = 'wall';
    }
    else if (game.elapsed > 240 && buildings < 20 && this.credits > 520) {
      const roll = Math.random();
      type = roll < 0.4 ? 'power' : roll < 0.7 ? 'barracks' : roll < 0.85 ? 'depot' : 'turret';
    }

    // Смена цели начинает отсчёт ожидания заново: иначе пауза в найме
    // доставалась бы новому плану от старого.
    if (this.buildIntent !== type) {
      this.buildIntent = type;
      this.saveTime = 0;
    }
    if (!type) return;
    const def = BUILDINGS[type];
    // На вышку противник копит без запаса: она сразу возвращает вложенное, а с
    // резервом в 30 кредитов ИИ не мог накопить на неё полминуты.
    const reserve = type === 'derrick' ? 0 : 30;
    if (!def || this.credits < def.cost + reserve) return;
    this.buildStructure(type);
  }

  buildStructure(type) {
    if (!type || this.credits < BUILDINGS[type].cost) return false;
    let spot = null;
    if (type === 'derrick') spot = this.findFreePatch();
    else if (type === 'turret') spot = this.findTurretSpot();
    else if (type === 'wall') spot = this.findWallSpot();
    else spot = this.findBuildSpot(type);
    if (!spot) {
      this.buildIntent = null;
      this.saveTime = 0;
      return false;
    }
    const b = this.game.tryBuild(type, spot.x, spot.z, {
      faction: 'enemy',
      wallet: this,
      // Баррикады ставим встык: зазор нужен зданиям, а не линии обороны.
      padding: type === 'wall' ? 0 : AI.buildSpacing,
    });
    if (!b) return false;
    this.buildIntent = null;
    this.saveTime = 0;
    this.buildCount++;
    if (this.game.elapsed - this.lastBuildNoticeAt > 90) {
      this.lastBuildNoticeAt = this.game.elapsed;
      this.game.notify(
        'Сенсоры фиксируют новые постройки противника: он застраивает сектор.',
        'warn',
        'ai-build',
        0,
        5,
      );
    }
    return true;
  }

  findFreePatch() {
    const hq = this.enemyHq();
    if (!hq) return null;
    const game = this.game;
    // Чем дольше идёт бой, тем дальше противник готов тянуться за нефтью. Важно
    // только то, что месторождение уже разведано: в тумане его не видно.
    const limit = Math.min(200, 62 + game.elapsed * 0.55);
    let best = null;
    let bestD = Infinity;
    for (const patch of game.world.oilPatches ?? []) {
      if (patch.derrick && patch.derrick.alive) continue;
      if (!game.isExploredBy('enemy', patch.x, patch.z)) continue;
      const d = dist(hq.position.x, hq.position.z, patch.x, patch.z);
      if (d > limit || d >= bestD) continue;
      bestD = d;
      best = patch;
    }
    return best;
  }

  /**
   * Куда отправить разведку: сначала к неразведанным месторождениям — они
   * окупают разведку, — и только потом к любой неисследованной точке.
   * Опасные маршруты (там, где разведка уже гибла) стоят дороже: ИИ обходит
   * такое место или берёт цель с другой стороны, а не повторяет ту же тропу.
   */
  scoutTarget(point) {
    const game = this.game;
    const penalty = (x, z) => this.scoutDanger(point, { x, z });
    let best = null;
    let bestScore = Infinity;
    for (const patch of game.world.oilPatches ?? []) {
      if (patch.derrick && patch.derrick.alive) continue;
      if (game.isExploredBy('enemy', patch.x, patch.z)) continue;
      const score = dist(point.x, point.z, patch.x, patch.z) + penalty(patch.x, patch.z);
      if (score < bestScore) {
        bestScore = score;
        best = { x: patch.x, z: patch.z };
      }
    }
    if (best) return best;
    return game.fog.nearestUnexplored(point.x, point.z, 'enemy', penalty);
  }

  /**
   * Насколько опасен маршрут к точке. Считается не расстояние до цели, а
   * расстояние до отрезка «база → цель» для каждого места, где разведка уже
   * попадала под удар: убивают разведчика обычно по дороге, а не у цели.
   */
  scoutDanger(from, to) {
    if (!this.rules.memory || !this.scoutLosses.length) return 0;
    let danger = 0;
    for (const loss of this.scoutLosses) {
      const d = distToSegment(loss.x, loss.z, from.x, from.z, to.x, to.z);
      if (d < AI.scoutLossRadius) {
        danger += (AI.scoutLossRadius - d) * AI.scoutDangerWeight;
      }
    }
    return danger;
  }

  /** Запоминает место, где разведка попала под удар: туда больше не идут. */
  rememberScoutLoss(x, z) {
    if (!this.rules.memory) return;
    this.scoutLosses.push({ x, z, until: this.game.elapsed + AI.scoutLossMemory });
    // Долгая память не нужна: старые метки только сужают разведку.
    if (this.scoutLosses.length > 8) this.scoutLosses.shift();
  }

  /**
   * Следит за ушедшими в разведку: гибель бойца помечает маршрут опасным,
   * чтобы следующая пара не пошла по той же тропе на те же турели.
   */
  updateScouts() {
    const now = this.game.elapsed;
    if (this.scoutLosses.length) {
      this.scoutLosses = this.scoutLosses.filter((loss) => loss.until > now);
    }
    for (const [id, task] of this.scoutTasks) {
      const unit = task.unit;
      if (!unit.alive) {
        this.rememberScoutLoss(unit.position.x, unit.position.z);
        this.scoutTasks.delete(id);
        this.debugLog('разведчик погиб: маршрут помечен опасным');
        continue;
      }
      // Приказ мог перебить гарнизон или волна: задача больше не наша,
      // иначе боец навсегда останется в списке «уже в разведке».
      if (unit.order?.type !== 'attackMove') {
        this.scoutTasks.delete(id);
        continue;
      }
      // Цель уже открыта — задача выполнена, дальше боец идёт по своему
      // приказу и возвращается в строй, когда дойдёт до точки.
      if (this.game.isExploredBy('enemy', task.x, task.z)) {
        this.scoutTasks.delete(id);
        continue;
      }
      if (!this.rules.retreat) continue;
      // Разведка — не самоубийство: под огнём разведчик отходит к базе, а не
      // идёт дальше в турели. Уцелевший боец пригодится в следующей волне.
      const hurt = unit.hp < unit.maxHp * AI.scoutRetreatHp;
      const underFire = now - unit.lastHitAt < AI.scoutRetreatHitWindow;
      const tooLong = now - task.since > AI.scoutMaxTime;
      if (hurt || underFire || tooLong) {
        this.retreatScout(unit, hurt || underFire ? 'под огнём' : 'слишком долго');
      }
    }
  }

  /**
   * Возвращает разведчика к базе. Юнит остаётся в армии: через короткую паузу
   * он снова может уйти в разведку или в волну, а не гибнет в чистом поле.
   */
  retreatScout(unit, reason) {
    this.scoutTasks.delete(unit.id);
    const rally = this.rally ?? this.baseRally();
    unit.issueMove(
      clamp(rally.x + (Math.random() - 0.5) * 8, -MAP.clamp, MAP.clamp),
      clamp(rally.z + (Math.random() - 0.5) * 8, -MAP.clamp, MAP.clamp),
    );
    // Разведчика обстреляли — место опасно и для следующего, даже если этот
    // ушёл живым.
    if (reason === 'под огнём') this.rememberScoutLoss(unit.position.x, unit.position.z);
    unit.aiScoutRest = this.game.elapsed + AI.scoutRest;
    this.debugLog(`разведчик возвращается к базе: ${reason}`);
  }

  /**
   * Разведка: если у противника есть свободные бойцы, они идут к ближайшей
   * неисследованной области. Без этого ИИ не находил ни новых месторождений,
   * ни подходящих путей к базе игрока.
   */
  sendScouts() {
    const game = this.game;
    const hq = this.enemyHq();
    if (!hq || !game.fog) return;
    const target = this.scoutTarget(hq.position);
    if (!target) return;
    const free = game.units.filter((u) => (
      u.alive
      && u.faction === 'enemy'
      && !u.def.builder
      && !u.def.healer
      && !u.aiGarrison
      // Уже идущий разведчик не переназначается: иначе отряд дёргается на
      // месте, а каждые десять секунд получает новую цель.
      && !this.scoutTasks.has(u.id)
      // Вернувшийся из-под огня боец отдыхает у базы, а не идёт обратно.
      && (u.aiScoutRest ?? 0) <= game.elapsed
      // Боец в активной волне занят атакой: разведка его не снимает,
      // иначе удар слабеет прямо на полпути к цели.
      && !this.activeWave?.ids.has(u.id)
      && (!u.order || u.order.type === 'move' || u.order.type === 'attackMove' || u.order.type === 'hold')
    ));
    // Позиционный гарнизон уже исключён: разведка берёт только свободных.
    // Разведка не оголяет армию: у базы остаётся резерв, из которого
    // собирается волна. Иначе бойцы уходят по одному и гибнут в тумане.
    const spare = free.length - AI.scoutArmyReserve;
    if (spare < 1) return;
    // Быстрые юниты справляются с разведкой лучше: они успевают вернуться.
    free.sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));
    // Бедный противник посылает одного разведчика и реже: силы нужнее в обороне.
    const wanted = this.isStarved() ? 1 : 1 + Math.floor(Math.random() * 2);
    const count = Math.min(spare, wanted);
    for (let i = 0; i < count; i++) {
      const u = free[i];
      const x = target.x + (Math.random() - 0.5) * 8;
      const z = target.z + (Math.random() - 0.5) * 8;
      u.issueAttackMove(x, z);
      u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 8);
      this.scoutTasks.set(u.id, { unit: u, x, z, since: game.elapsed });
    }
    if (game.elapsed - this.lastScoutNoticeAt > 150) {
      this.lastScoutNoticeAt = game.elapsed;
      game.notify('Разведка противника прощупывает сектор.', 'warn', 'ai-scout', 0, 4);
    }
  }

  /** Свободное место под здание в окрестностях базы противника. */
  findBuildSpot(type) {
    const hq = this.enemyHq();
    if (!hq) return null;
    for (let ring = 0; ring < 12; ring++) {
      const radius = 9 + ring * 4.5;
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * TAU + ring * 0.37 + this.buildAngle;
        const x = hq.position.x + Math.cos(angle) * radius;
        const z = hq.position.z + Math.sin(angle) * radius;
        if (Math.abs(x) > MAP.clamp - 4 || Math.abs(z) > MAP.clamp - 4) continue;
        const place = this.game.findPlacement(type, x, z, { padding: AI.buildSpacing, faction: 'enemy' });
        if (place.valid) return place;
      }
    }
    return null;
  }

  /** Позиция на оси удара: так турели прикрывают подход, а не тыл. */
  findFrontSpot(type) {
    const hq = this.enemyHq();
    if (!hq) return null;
    const dir = this.threatDir();
    const baseAngle = Math.atan2(dir.z, dir.x);
    const offsets = [0, -0.55, 0.55, -1.0, 1.0];
    const radii = [11, 13.5, 16, 18];
    for (const offset of offsets) {
      for (const radius of radii) {
        const angle = baseAngle + offset;
        const x = hq.position.x + Math.cos(angle) * radius;
        const z = hq.position.z + Math.sin(angle) * radius;
        if (Math.abs(x) > MAP.clamp - 4 || Math.abs(z) > MAP.clamp - 4) continue;
        const place = this.game.findPlacement(type, x, z, {
          padding: AI.buildSpacing,
          faction: 'enemy',
        });
        if (place.valid) return place;
      }
    }
    return null;
  }

  /** Вышка, которую ещё не прикрывает ни одна турель. */
  findUncoveredDerrick() {
    const hq = this.enemyHq();
    if (!hq) return null;
    const turrets = this.game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'turret',
    );
    let best = null;
    let bestD = -1;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.type !== 'derrick') continue;
      const covered = turrets.some((t) => (
        dist(t.position.x, t.position.z, b.position.x, b.position.z) <= AI.derrickTurretRadius
      ));
      if (covered) continue;
      const d = dist(hq.position.x, hq.position.z, b.position.x, b.position.z);
      if (d > bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Свободное место рядом с точкой: для турели у вышки. */
  findSpotAround(point, type, radius = 10) {
    for (let ring = 0; ring < 3; ring++) {
      const r = radius + ring * 2.5;
      for (let i = 0; i < 16; i++) {
        const angle = (i / 16) * TAU;
        const x = point.x + Math.cos(angle) * r;
        const z = point.z + Math.sin(angle) * r;
        if (Math.abs(x) > MAP.clamp - 4 || Math.abs(z) > MAP.clamp - 4) continue;
        const place = this.game.findPlacement(type, x, z, {
          padding: AI.buildSpacing,
          faction: 'enemy',
        });
        if (place.valid) return place;
      }
    }
    return null;
  }

  /** Куда ставить турель: сначала на ось удара, потом к дальней вышке. */
  findTurretSpot() {
    const turrets = this.game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'turret' && b.complete,
    ).length;
    // Первые три турели прикрывают базу, четвёртая и следующие — вышки.
    if (turrets >= 3) {
      const derrick = this.findUncoveredDerrick();
      if (derrick) {
        const spot = this.findSpotAround(derrick.position, 'turret', 10);
        if (spot) return spot;
      }
    }
    return this.findFrontSpot('turret') ?? this.findBuildSpot('turret');
  }

  /** Линия баррикад перед базой с проходом в центре. */
  findWallSpot() {
    const hq = this.enemyHq();
    if (!hq) return null;
    const dir = this.threatDir();
    const side = { x: -dir.z, z: dir.x };
    const offsets = [6, 11.5, 17, -6, -11.5, -17];
    for (const offset of offsets) {
      const x = hq.position.x + dir.x * AI.wallDistance + side.x * offset;
      const z = hq.position.z + dir.z * AI.wallDistance + side.z * offset;
      if (Math.abs(x) > MAP.clamp - 4 || Math.abs(z) > MAP.clamp - 4) continue;
      const place = this.game.findPlacement('wall', x, z, {
        padding: 0,
        faction: 'enemy',
      });
      if (place.valid) return place;
    }
    return this.findBuildSpot('wall');
  }

  ensureBuildersOnSites() {
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.complete) continue;
      if ((b.builderCount ?? 0) === 0) {
        this.game.assignBuilders(b);
      }
    }
  }

  updateRepairs() {
    const buildings = this.game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.complete,
    );
    if (this.credits < 90) {
      for (const b of buildings) b.repairing = false;
      return;
    }
    if (this.credits < 240) return;
    for (const b of buildings) {
      if (b.hp < b.maxHp * 0.7) b.repairing = true;
    }
  }

  /** ИИ тоже исследует улучшения в техцентре, когда накопил на них кредиты. */
  tryResearch() {
    const game = this.game;
    const labs = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'lab'
        && b.complete && b.queue.length === 0,
    );
    if (!labs.length) return;
    // Иногда противник откладывает науку в пользу армии — ещё одна вариация.
    if (Math.random() < 0.25) return;
    const available = game.availableUpgrades('enemy')
      .filter((key) => this.credits >= (UPGRADES[key]?.cost ?? 0) + 80);
    if (!available.length) return;

    // Приоритет зависит от состава армии и базы: качать линию юнита, которого
    // нет, или экономику без вышек — бессмысленно.
    const counts = new Map();
    for (const unit of game.units) {
      if (!unit.alive || unit.faction !== 'enemy') continue;
      counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
    }
    const buildings = game.buildings.filter((b) => b.alive && b.faction === 'enemy');
    const turrets = buildings.filter((b) => b.type === 'turret').length;
    const derricks = buildings.filter((b) => b.type === 'derrick').length;
    const capUsed = game.getArmyUsed('enemy');
    const cap = game.getArmyCap('enemy');

    let best = null;
    let bestScore = -Infinity;
    for (const key of available) {
      const def = UPGRADES[key];
      let score = 1 + Math.random() * 2;
      if (def.scope === 'unit') score += (counts.get(def.target) ?? 0) * 3;
      else if (def.scope === 'building') {
        score += def.target === 'turret' ? turrets * 4 : buildings.length * 0.35;
      } else if (key === 'income') score += derricks * 3;
      else if (key === 'reserve') score += (capUsed / Math.max(1, cap)) * 6;
      else if (key === 'logistics') score += 2.5;
      else if (key === 'maintenance') score += 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
    if (!best) return;
    const lab = labs[Math.floor(Math.random() * labs.length)];
    game.startUpgrade(lab, best);
  }

  // ------------------------------------------------------------- армия
  /** Есть ли готовые казармы: без них армию нечем пополнять. */
  hasBarracks() {
    return this.game.buildings.some(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'barracks' && b.complete,
    );
  }

  /**
   * Голодает ли экономика. Пока казармы простаивают из-за нехватки кредитов
   * на самого дешёвого бойца, копим силы у базы. Короткая пауза между
   * наймом юнитов голодом не считается: важно именно затянувшееся безденежье.
   */
  updateEconomy(dt) {
    const game = this.game;
    const used = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const cap = Math.min(AI.armyCap, game.getArmyCap('enemy'));
    const stalled = this.hasBarracks()
      && used < cap
      && this.credits < AI.economyCredits;
    if (stalled) this.starvedTime += dt;
    else this.starvedTime = Math.max(0, this.starvedTime - dt * 2);
  }

  isStarved() {
    return this.starvedTime >= AI.starvedDelay;
  }

  /**
   * Стройка, ради которой можно придержать найм: без казармы армию не
   * пополнить, при дефиците энергии производство падает втрое, а турель,
   * когда базу уже щупают, нужна немедленно. Остальные здания копятся
   * короткими паузами, не останавливая казармы.
   */
  isUrgentBuild(type) {
    if (!type) return false;
    if (type === 'barracks') return true;
    if (type === 'power') {
      const power = this.game.power.enemy;
      return power.used >= power.produced;
    }
    if (type === 'turret') return this.baseUnderThreat();
    return false;
  }

  /** Игрок уже подошёл к базе: турель и резерв важнее наступления. */
  baseUnderThreat() {
    const hq = this.enemyHq();
    if (!hq) return false;
    return this.game.entities.some((e) => (
      e.alive
      && e.faction === 'player'
      && !e.isBuilding
      && this.game.isEntityVisibleTo('enemy', e)
      && dist(e.position.x, e.position.z, hq.position.x, hq.position.z) < AI.defendRadius
    ));
  }

  tryTrain() {
    const game = this.game;
    const used = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const cap = Math.min(AI.armyCap, game.getArmyCap('enemy'));
    if (used >= cap) return;
    const barracks = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'barracks'
        && b.complete && b.queue.length === 0,
    );
    if (!barracks.length) return;

    const t = game.elapsed;
    // Случайный, но осмысленный состав: чем агрессивнее партия, тем охотнее
    // Противник вкладывается в тяжёлую технику; на старте преобладает пехота.
    const weights = [
      { type: 'marine', weight: 1 },
      { type: 'medic', weight: t > 40 ? 0.4 : 0 },
      { type: 'scout', weight: t > 35 ? 0.8 : 0.25 },
      { type: 'tank', weight: t > 95 ? 0.55 * this.aggression : 0 },
      { type: 'artillery', weight: t > 170 ? 0.4 * this.aggression : 0 },
    ];
    // Прошлую волну сожгли турели — противник делает ставку на тяжёлую технику.
    if (this.rules.counter && this.isTurretCause(this.lastFailureCause())) {
      for (const item of weights) {
        if (item.type === 'tank' && t > 60) item.weight = Math.max(item.weight, 0.9);
        if (item.type === 'artillery' && t > 120) item.weight = Math.max(item.weight, 0.7);
      }
    }
    const total = weights.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    let type = 'marine';
    for (const item of weights) {
      roll -= item.weight;
      if (roll <= 0 && item.weight > 0) {
        type = item.type;
        break;
      }
    }

    let def = UNITS[type];
    // Если под выбранную машину не хватает лимита, противник добирает пехоту.
    if (used + (def.supply ?? 1) > cap) {
      type = 'marine';
      def = UNITS.marine;
      if (used + def.supply > cap) return;
    }
    if (this.credits < def.cost + 40) return;
    // Пока копим на стройку, армия ждёт, но не дольше лимита: иначе найм
    // замирал на всю закупку здания. После паузы покупаем одного бойца, и
    // окно ожидания начинается заново — стройка и армия делят доход.
    if (this.buildIntent) {
      const patience = this.isUrgentBuild(this.buildIntent)
        ? AI.savePatienceUrgent
        : AI.savePatience;
      if (this.saveTime < patience) return;
    }
    if (game.powerFactor('enemy') < 0.9 && Math.random() < 0.35) return;
    this.credits -= def.cost;
    const builder = barracks[Math.floor(Math.random() * barracks.length)];
    builder.enqueue(type);
    this.saveTime = 0;
    this.trainTimer = 3.5 + Math.random() * 2.5;
  }

  defendBase() {
    const hq = this.enemyHq();
    if (!hq) return;
    let intruder = null;
    let bestD = Infinity;
    for (const e of this.game.entities) {
      if (!e.alive || e.faction !== 'player' || e.isBuilding) continue;
      if (!this.game.isEntityVisibleTo('enemy', e)) continue;
      const d = dist(e.position.x, e.position.z, hq.position.x, hq.position.z);
      if (d < AI.defendRadius && d < bestD) {
        bestD = d;
        intruder = e;
      }
    }
    if (!intruder) return;

    // Гарнизон не гонится за нарушителем: он занимает позицию под турелями.
    // Иначе бойцы выманиваются из укрытия и гибнут по одному в чистом поле.
    const anchor = this.defenseAnchor();
    const active = this.activeWave?.ids;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'enemy' || u.def.builder || u.def.healer) continue;
      if (active && active.has(u.id)) continue;
      if (u.order?.type === 'hold' || u.order?.type === 'escort') continue;
      // Уже дерётся с конкретной целью — не сбиваем приказ каждые 1.5 с.
      if (u.order?.type === 'attack' && u.order.target?.alive) continue;
      const d = dist(u.position.x, u.position.z, hq.position.x, hq.position.z);
      if (d >= AI.defendRadius + 10) continue;
      u.issueHold(
        anchor.x + (Math.random() - 0.5) * 7,
        anchor.z + (Math.random() - 0.5) * 7,
      );
      u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 4);
    }
  }

  /** Защита инженеров: гарнизон отвечает на обстрел строителей и на угрозы рядом. */
  defendEngineers() {
    const game = this.game;
    const threats = [];
    for (const builder of game.units) {
      if (!builder.alive || builder.faction !== 'enemy' || !builder.def.builder) continue;
      // Инженер в составе волны идёт под охраной самого отряда: не снимаем
      // бойцов с маршрута, чтобы спасать одного строителя.
      if (builder.order?.type === 'escort') continue;
      let attacker = null;
      // Инженера уже бьют — мстим тому, кто попал последним.
      if (builder.lastAttacker?.alive && builder.lastAttacker.faction === 'player'
        && game.elapsed - builder.lastHitAt < 8) {
        attacker = builder.lastAttacker;
      }
      // Или к инженеру подошёл враг: лучше встретить его на подходе.
      if (!attacker) {
        let bestD = 24;
        for (const e of game.units) {
          if (!e.alive || e.faction !== 'player') continue;
          if (!game.isEntityVisibleTo('enemy', e)) continue;
          const d = dist(e.position.x, e.position.z, builder.position.x, builder.position.z);
          if (d < bestD) {
            bestD = d;
            attacker = e;
          }
        }
      }
      if (attacker) threats.push({ builder, attacker });
    }
    if (!threats.length) return;

    const defenders = game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder && !u.def.healer
        && !u.aiGarrison,
    );
    if (!defenders.length) return;

    for (const { builder, attacker } of threats) {
      const ranked = defenders
        .filter((u) => !(u.order?.type === 'attack' && u.order.target?.alive))
        .map((u) => ({
          u,
          d: dist(u.position.x, u.position.z, builder.position.x, builder.position.z),
        }))
        .sort((a, b) => a.d - b.d);
      let guard = ranked.filter((x) => x.d <= AI.engineerGuardRadius);
      // Если рядом никого нет, снимаем ближайших с базы: инженер важнее
      // пары секунд марша, но гарнизон базы всё равно не оголяем полностью.
      if (!guard.length) {
        guard = ranked.filter((x) => x.d <= AI.engineerGuardRadius * 1.7).slice(0, 2);
      }
      const wanted = 1 + Math.floor(Math.random() * AI.engineerGuardCount);
      for (const { u } of guard.slice(0, wanted)) {
        u.issueAttack(attacker);
        u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 6);
      }
    }
  }

  /**
   * Оборона построек: если игрок обстреливает вышку или турель, ближайшие
   * свободные бойцы идут на помощь. Гарнизон и волна с маршрута не снимаются.
   */
  defendStructures() {
    const game = this.game;
    const active = this.activeWave?.ids;
    for (const b of game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.type === 'hq') continue;
      const attacker = b.lastAttacker;
      if (!attacker?.alive || attacker.faction !== 'player') continue;
      if (game.elapsed - b.lastHitAt > 8) continue;
      if (!game.isEntityVisibleTo('enemy', attacker)) continue;
      const guards = game.units
        .filter((u) => (
          u.alive
          && u.faction === 'enemy'
          && !u.def.builder
          && !u.def.healer
          && !u.aiGarrison
          && !(active && active.has(u.id))
          && (!u.order || u.order.type === 'move' || u.order.type === 'hold')
          && dist(u.position.x, u.position.z, b.position.x, b.position.z) <= AI.structureGuardRadius
        ))
        .sort((a, b2) => dist(a.position.x, a.position.z, b.position.x, b.position.z)
          - dist(b2.position.x, b2.position.z, b.position.x, b.position.z))
        .slice(0, AI.structureGuardCount);
      for (const u of guards) {
        u.issueAttack(attacker);
        u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 6);
      }
    }
  }

  // ------------------------------------------------------------- оценка сил
  /**
   * Грубая боевая ценность: сколько урона живучий боец успевает нанести.
   * Пехотинец принят примерно за 22, танк — за 70, турель — за 170. Этого
   * достаточно, чтобы сравнивать отряд с обороной, не строя симуляцию боя.
   */
  combatValue(entity) {
    if (!entity?.alive) return 0;
    const def = entity.def ?? {};
    const weapon = entity.defense ?? def.defense ?? def;
    const damage = entity.damage ?? weapon.damage ?? 0;
    const cooldown = entity.cooldown ?? weapon.cooldown ?? 1;
    // Залп РСЗО — это пять ракет за одну перезарядку, а площадной урон
    // делает машину сильнее в толпе. Без этих множителей артиллерия
    // выглядела в оценке почти безоружной.
    const salvo = entity.salvo ?? weapon.salvo ?? 1;
    const splash = (entity.splash ?? weapon.splash) ? 1.15 : 1;
    const dps = (damage * salvo) / (cooldown || 1);
    const hp = entity.hp ?? def.hp ?? 0;
    const armor = entity.armor ?? def.armor ?? 0;
    return (dps * splash * (hp + armor * 20 + 40)) / 100;
  }

  squadPower(units) {
    return units.reduce((sum, u) => sum + this.combatValue(u), 0);
  }

  /**
   * Что ИИ знает об обороне вокруг точки: постройки — по разведке (они не
   * двигаются, их помнят), войска — только по текущему обзору. В тумане
   * гарнизон для противника не существует, и придумывать его он не должен.
   */
  defenseAt(point) {
    let value = 0;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'player') continue;
      if (!this.game.isBuildingKnownTo('enemy', b)) continue;
      if (dist(point.x, point.z, b.position.x, b.position.z) > AI.defenseRadius + b.radius) continue;
      if (b.type === 'wall') {
        if (b.complete) value += AI.wallDefenseValue;
        continue;
      }
      value += this.combatValue(b);
    }
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'player') continue;
      if (!this.game.isEntityVisibleTo('enemy', u)) continue;
      if (dist(point.x, point.z, u.position.x, u.position.z) > AI.defenseRadius) continue;
      value += this.combatValue(u);
    }
    return value;
  }

  /** Сколько бойцов нужно, чтобы набрать требуемую мощь. */
  neededSquad(combat, requiredPower) {
    if (requiredPower <= 0) return 0;
    const sorted = combat.slice().sort((a, b) => this.combatValue(b) - this.combatValue(a));
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += this.combatValue(sorted[i]);
      if (sum >= requiredPower) return i + 1;
    }
    return Infinity;
  }

  // ------------------------------------------------------------- память волн
  /**
   * Запоминает отправленную волну. Запись закроется сама, когда отряд
   * погибнет или потеряет темп, — по ней ИИ судит, стоило ли оно того.
   */
  beginWave({ tactic, squad, point, targetEntity = null }) {
    if (this.activeWave) this.finishWave(this.activeWave, 'superseded');
    const record = {
      index: this.waveIndex + 1,
      tactic,
      sentAt: this.game.elapsed,
      point: { x: point.x, z: point.z },
      targetId: targetEntity?.id ?? null,
      targetType: targetEntity?.type ?? 'hq',
      units: squad.map((u) => ({ unit: u, supply: u.def.supply ?? 1 })),
      ids: new Set(squad.map((u) => u.id)),
      supplySent: squad.reduce((sum, u) => sum + (u.def.supply ?? 1), 0),
      kills: 0,
      damage: 0,
      killTypes: {},
      state: 'active',
    };
    this.waveLog.push(record);
    if (this.waveLog.length > AI.waveLogSize) this.waveLog.shift();
    this.activeWave = record;
    this.stats.waves++;
    const supportCount = squad.filter((u) => u.def.healer || u.def.builder).length;
    this.debugLog(
      `волна №${record.index} (${tactic}): ${squad.length} юнитов`
      + `${supportCount ? `, из них ${supportCount} поддержки` : ''}, `
      + `${record.supplySent} снабж. → ${record.targetType}`,
    );
    return record;
  }

  /** Закрывает активную волну, как только её судьба определилась. */
  updateWaveMemory() {
    const record = this.activeWave;
    if (!record) return;
    const alive = record.units.filter(({ unit }) => unit.alive);
    if (!alive.length) {
      this.finishWave(record, 'wiped');
      return;
    }
    const age = this.game.elapsed - record.sentAt;
    const aliveSupply = alive.reduce((sum, { supply }) => sum + supply, 0);
    // Половина отряда полегла, а урон так и не нанесён — бой проигран,
    // и остатки уходят к сбору, а не гибнут по одному.
    if (
      this.rules.retreat
      && age > AI.retreatGrace
      && aliveSupply <= record.supplySent * AI.retreatSupplyRatio
      && record.kills === 0
      && record.damage < AI.weakWaveDamage
    ) {
      this.retreatWave(record);
      return;
    }
    if (age >= AI.waveTimeout) {
      this.recallWave(record);
      this.finishWave(record, 'timeout');
    }
  }

  /** Возвращает уцелевших к гарнизону под турелями, а не оставляет в поле. */
  recallWave(record) {
    const anchor = this.defenseAnchor();
    for (const { unit } of record.units) {
      if (!unit.alive) continue;
      unit.issueMove(
        anchor.x + (Math.random() - 0.5) * 7,
        anchor.z + (Math.random() - 0.5) * 7,
      );
      unit.retaliateTimer = 0;
    }
  }

  /** Отводит остатки волны к точке сбора: они догонят следующий отряд. */
  retreatWave(record) {
    this.recallWave(record);
    this.stats.retreats++;
    this.finishWave(record, 'retreated');
    this.game.notify(
      'Отряд противника отступает: пробить оборону не удалось.',
      'success',
      'ai-retreat',
      90,
      4,
    );
  }

  finishWave(record, state) {
    if (!record || record.state !== 'active') return;
    record.state = state;
    record.endedAt = this.game.elapsed;
    record.duration = record.endedAt - record.sentAt;
    record.alive = record.units.filter(({ unit }) => unit.alive).length;
    record.supplyLeft = record.units.reduce(
      (sum, { unit, supply }) => sum + (unit.alive ? supply : 0),
      0,
    );
    record.supplyLost = record.supplySent - record.supplyLeft;
    record.cause = this.waveCause(record);
    if (this.activeWave === record) this.activeWave = null;
    record.failed = this.isFailedWave(record);
    if (record.failed && record.targetId != null && this.rules.targetCooldown) {
      this.targetCooldowns.set(record.targetId, this.game.elapsed + AI.targetCooldown);
    }
    const s = this.stats;
    s.settled++;
    s.supplyLost += record.supplyLost;
    s.damage += record.damage;
    s.kills += record.kills;
    s.duration += record.duration;
    if (record.failed) s.failures++;
    if (record.state === 'wiped') s.wiped++;
    if (record.state === 'timeout') s.timeouts++;
    this.debugLog(
      `волна №${record.index} ${record.state}: живых ${record.alive}/${record.units.length}, `
      + `потери ${record.supplyLost} снабж., урон ${Math.round(record.damage)}, `
      + `убито ${record.kills}, причина ${record.cause}`,
    );
  }

  /** Волна провалилась: отряд уничтожен или ушёл, ничего не сделав. */
  isFailedWave(record) {
    if (record.state === 'wiped') return true;
    return record.kills === 0 && record.damage < AI.weakWaveDamage;
  }

  isTargetCooling(id) {
    if (!this.rules.targetCooldown) return false;
    if (id == null) return false;
    const until = this.targetCooldowns.get(id);
    if (until == null) return false;
    if (until <= this.game.elapsed) {
      this.targetCooldowns.delete(id);
      return false;
    }
    return true;
  }

  /** Кто чаще всего добивал бойцов волны: турели, гарнизон, база. */
  waveCause(record) {
    const counts = {};
    for (const { unit } of record.units) {
      if (unit.alive) continue;
      const type = unit.lastAttacker?.type ?? 'unknown';
      counts[type] = (counts[type] ?? 0) + 1;
    }
    let best = 'unknown';
    let bestCount = 0;
    for (const [type, count] of Object.entries(counts)) {
      if (count > bestCount) {
        best = type;
        bestCount = count;
      }
    }
    return best;
  }

  /** Урон по игроку от бойцов активной волны. */
  onDamageDealt(source, target, dmg) {
    const record = this.activeWave;
    if (!record || !record.ids.has(source.id)) return;
    record.damage += dmg;
  }

  /** Игрок потерял юнита или здание — записываем, если добил боец волны. */
  onPlayerLoss(entity, source) {
    const record = this.activeWave;
    if (!record || !source || !record.ids.has(source.id)) return;
    record.kills++;
    const type = entity.isBuilding ? `building:${entity.type}` : entity.type;
    record.killTypes[type] = (record.killTypes[type] ?? 0) + 1;
  }

  debugLog(text) {
    if (this.debug) console.debug(`[ai] ${text}`);
  }

  /** Панель с цифрами ИИ — только по адресу со `?debug=ai`. */
  ensureDebugOverlay() {
    if (typeof document === 'undefined') return;
    document.getElementById('ai-debug')?.remove();
    const el = document.createElement('div');
    el.id = 'ai-debug';
    Object.assign(el.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      zIndex: '9999',
      padding: '8px 10px',
      borderRadius: '6px',
      background: 'rgba(4, 10, 16, 0.78)',
      color: '#9fe8ff',
      font: '11px/1.45 ui-monospace, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
    });
    document.body.append(el);
    this.debugEl = el;
  }

  updateDebugOverlay(dt) {
    if (!this.debugEl) return;
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.5;

    const s = this.stats;
    const settled = Math.max(1, s.settled);
    const playerHQ = this.game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    const combat = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder,
    );
    const active = this.activeWave;
    const alive = active ? active.units.filter(({ unit }) => unit.alive).length : 0;
    const lines = [
      'ИИ: волны и итоги',
      `волн ${s.waves}, провалов ${s.failures} (${Math.round((100 * s.failures) / settled)}%)`,
      `разгромов ${s.wiped}, зависших ${s.timeouts}, отходов ${s.retreats}`,
      `потери ${Math.round(s.supplyLost / settled)} снабж./волна`,
      `урон ${Math.round(s.damage)}, убито ${s.kills}`,
      `ср. время ${(s.duration / settled).toFixed(0)} с`,
      active ? `в поле ${alive}/${active.units.length} (${active.tactic})` : 'в поле: —',
      playerHQ
        ? `армия ${Math.round(this.squadPower(combat))} / оборона штаба ${Math.round(this.defenseAt(playerHQ.position))}`
        : '',
      `до волны ${Math.max(0, this.waveTimer).toFixed(0)} с`,
    ];
    this.debugEl.textContent = lines.filter(Boolean).join('\n');
  }

  // ------------------------------------------------------------- волны
  /** Точка рядом с целью: один и тот же приказ не выглядит как копия. */
  pointNear(position, spread) {
    return {
      x: clamp(position.x + (Math.random() - 0.5) * spread * 2, -MAP.clamp, MAP.clamp),
      z: clamp(position.z + (Math.random() - 0.5) * spread * 2, -MAP.clamp, MAP.clamp),
    };
  }

  /** Подход со случайной стороны: маршрут не повторяется от волны к волне. */
  approachPoint(position, radius = AI.assaultApproachRadius) {
    const angle = Math.random() * TAU;
    const r = radius * (0.75 + Math.random() * 0.5);
    return {
      x: clamp(position.x + Math.cos(angle) * r, -MAP.clamp, MAP.clamp),
      z: clamp(position.z + Math.sin(angle) * r, -MAP.clamp, MAP.clamp),
    };
  }

  /**
   * Подход с той стороны, где меньше известно турелей. Настоящего поиска
   * пути тут нет: противник перебирает точки по кругу и выбирает ту, что дальше
   * от секторов обстрела.
   */
  safeApproachPoint(position, radius = AI.assaultApproachRadius) {
    const turrets = this.game.buildings.filter((b) => (
      b.alive
      && b.faction === 'player'
      && b.type === 'turret'
      && this.game.isBuildingKnownTo('enemy', b)
    ));
    if (!turrets.length) return this.approachPoint(position, radius);

    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU + Math.random() * 0.4;
      const r = radius * (0.75 + Math.random() * 0.5);
      const point = {
        x: clamp(position.x + Math.cos(angle) * r, -MAP.clamp, MAP.clamp),
        z: clamp(position.z + Math.sin(angle) * r, -MAP.clamp, MAP.clamp),
      };
      let score = Math.random() * 2;
      for (const turret of turrets) {
        const reach = (turret.defense?.range ?? turret.def.defense?.range ?? 17) + 6;
        const d = dist(point.x, point.z, turret.position.x, turret.position.z);
        if (d < reach) score += (reach - d) * 3;
      }
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best;
  }

  /** Турели — частая причина провала: против них нужна тяжёлая техника. */
  isTurretCause(cause) {
    return cause === 'turret';
  }

  /** Причина последнего провала, если она известна. */
  lastFailureCause() {
    for (let i = this.waveLog.length - 1; i >= 0; i--) {
      const wave = this.waveLog[i];
      if (wave.state === 'active' || !wave.failed) continue;
      return wave.cause ?? null;
    }
    return null;
  }

  /** Выбирает цель рейда: вышки и электростанции вкуснее казарм. */
  pickRaidTarget(buildings) {
    const candidates = buildings.filter((b) => (
      b.alive
      && b.type !== 'hq'
      // Цель, на которой уже провалились, временно не трогаем.
      && !this.isTargetCooling(b.id)
      // Рейд идёт по разведанным постройкам: того, чего противник не видел,
      // он просто не знает.
      && this.game.isBuildingKnownTo('enemy', b)
    ));
    if (!candidates.length) return null;
    const derricks = candidates.filter((b) => b.type === 'derrick');
    const pool = derricks.length && Math.random() < 0.7 ? derricks : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Поддержка волны: идёт сверх слотов бойцов и не учитывается в оценке
   * мощи отряда. Медика берём под пехоту, которую он сможет лечить, а
   * инженера — только под технику: без машин в поле нечего чинить.
   */
  waveSupport(squad, tactic) {
    // Разведка боем идёт налегке, без обоза.
    if (tactic === 'probe') return [];
    const out = [];

    const infantry = squad.filter((u) => u.def.infantry).length;
    const medics = this.freeSupport('medic', squad);
    // Хотя бы один медик уже при трёх пехотинцах: иначе поддержка почти
    // никогда не попадает в волну, ведь морпехов в отряде немного.
    const wantedMedics = Math.min(
      AI.waveMedicCap,
      Math.max(infantry >= 3 ? 1 : 0, Math.floor(infantry / AI.waveMedicPer)),
    );
    out.push(...medics.slice(0, wantedMedics));

    // Один свободный инженер всегда остаётся на базе: без него встанут
    // стройка и ремонт техники, а волна — не единственная забота противника.
    const vehicles = squad.filter((u) => u.def.vehicle).length;
    const engineers = this.freeSupport('engineer', squad);
    const wantedEngineers = Math.min(
      AI.waveEngineerCap,
      Math.max(0, engineers.length - 1),
      Math.ceil(vehicles / AI.waveEngineerPer),
    );
    out.push(...engineers.slice(0, wantedEngineers));

    return out;
  }

  /**
   * Точка сбора поддержки: чуть позади цели по линии от отряда к цели,
   * чтобы медики и инженеры не шли в первый ряд.
   */
  escortPoint(squad, primary) {
    if (!squad.length) return primary;
    const cx = squad.reduce((sum, u) => sum + u.position.x, 0) / squad.length;
    const cz = squad.reduce((sum, u) => sum + u.position.z, 0) / squad.length;
    let dx = primary.x - cx;
    let dz = primary.z - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return { x: primary.x, z: primary.z };
    dx /= len;
    dz /= len;
    return {
      x: clamp(primary.x - dx * AI.supportTrail, -MAP.clamp, MAP.clamp),
      z: clamp(primary.z - dz * AI.supportTrail, -MAP.clamp, MAP.clamp),
    };
  }

  /**
   * Свободные юниты поддержки: не заняты стройкой и не выполняют приказ,
   * который нельзя бросать. Ближние к отряду идут первыми — они успеют
   * догнать его на марше.
   */
  freeSupport(kind, squad) {
    const isKind = kind === 'medic' ? (u) => u.def.healer : (u) => u.def.repairer;
    const center = squad.reduce(
      (acc, u) => ({
        x: acc.x + u.position.x / squad.length,
        z: acc.z + u.position.z / squad.length,
      }),
      { x: 0, z: 0 },
    );
    return this.game.units
      .filter((u) => {
        if (!u.alive || u.faction !== 'enemy' || !isKind(u)) return false;
        if (u.assistBuilding && u.assistBuilding.alive && !u.assistBuilding.complete) return false;
        return !u.order
          || u.order.type === 'move'
          || u.order.type === 'attackMove'
          || u.order.type === 'hold';
      })
      .sort((a, b) => dist(a.position.x, a.position.z, center.x, center.z)
        - dist(b.position.x, b.position.z, center.x, center.z));
  }

  updateWave(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;

    // Слоты волны считаются только по бойцам: медики и инженеры — поддержка,
    // она идёт сверх отряда и не должна разбавлять его силу. Позиционный
    // гарнизон в волны не входит.
    const fighters = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder && !u.def.healer
        && !u.aiGarrison,
    );
    if (fighters.length < 2) {
      this.waveTimer = 8 + Math.random() * 8;
      return;
    }

    const playerHQ = this.game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    if (!playerHQ) {
      this.waveTimer = 20;
      return;
    }

    // Без казарм армию не пополнить: сначала производство, потом наступление.
    if (!this.hasBarracks()) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      this.debugLog('волна отложена: нет готовых казарм');
      return;
    }

    // Экономика не тянет пополнение — противник копит силы у базы и не рискует
    // последними бойцами. Сообщение объясняет игроку затянувшееся затишье.
    if (this.isStarved()) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      this.game.notify(
        'Противник экономит силы: его войска держатся у базы.',
        'warn',
        'ai-economy',
        150,
        5,
      );
      this.debugLog(`волна отложена: экономика голодает (${Math.round(this.credits)} кр.)`);
      return;
    }

    // Тактика очередной волны выбирается случайно: полномасштабный штурм,
    // рейд по экономике, удар с двух направлений или короткая разведка боем.
    const playerBuildings = this.game.buildings.filter(
      (b) => b.alive && b.faction === 'player',
    );
    const roll = Math.random();
    let tactic = 'assault';
    if (this.waveIndex > 0) {
      if (roll >= 0.5 && roll < 0.75) tactic = 'raid';
      else if (roll >= 0.75 && roll < 0.9) tactic = 'split';
      else if (roll >= 0.9) tactic = 'probe';
    }
    let raidTarget = tactic === 'raid' || tactic === 'split'
      ? this.pickRaidTarget(playerBuildings)
      : null;
    // Штаб после провала «горячий»: вместо повторного штурма идём по экономике.
    if (this.isTargetCooling(playerHQ.id) && tactic !== 'probe') {
      raidTarget = raidTarget ?? this.pickRaidTarget(playerBuildings);
      if (raidTarget) tactic = 'raid';
    }
    // Прошлую волну смяла армия игрока — уходим на экономику, а не в лоб.
    const cause = this.rules.counter ? this.lastFailureCause() : null;
    if (!raidTarget && tactic !== 'probe' && cause && !this.isTurretCause(cause)
      && Math.random() < AI.raidAfterArmyLoss) {
      raidTarget = this.pickRaidTarget(playerBuildings);
      if (raidTarget) tactic = 'raid';
    }
    if (!raidTarget && tactic !== 'assault' && tactic !== 'probe') tactic = 'assault';

    const primaryTarget = tactic === 'raid' && raidTarget ? raidTarget : playerHQ;
    const primary = tactic === 'raid' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : this.rules.avoidTurrets
        ? this.safeApproachPoint(playerHQ.position)
        : this.approachPoint(playerHQ.position);
    const secondary = tactic === 'split' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : null;

    // Размер отряда растёт от волны к волне, но это лишь пожелание: ниже
    // он проверяется по боевой мощи, чтобы в бой не уходили случайные крохи.
    let wanted = Math.round((3 + this.waveIndex * 1.7) * this.aggression)
      + Math.floor(Math.random() * 3) - 1;
    if (tactic === 'probe') wanted = Math.min(wanted, 2 + Math.floor(Math.random() * 2));

    // Остальные волны идут, только если отряд способен пробить то, что противник
    // знает об обороне цели. Чем дольше наступление откладывается, тем
    // скромнее требуемое превосходство: иначе три турели у штаба способны
    // заморозить ИИ навсегда.
    const patience = Math.min(AI.maxPatienceDiscount, this.postponedRuns * AI.patienceStep);
    const requiredAdvantage = this.rules.requiredAdvantage * (1 - patience);
    const defense = this.defenseAt(primaryTarget.position);
    // Порог мощи: без него ИИ наступал, как только истекал таймер, даже если
    // разведка не нашла обороны и в бой шли два-три случайных бойца. Порог
    // растёт с номером волны, поэтому поздние удары крупнее ранних.
    const basePower = tactic === 'probe'
      ? AI.probePower
      : (AI.waveBasePower + this.waveIndex * AI.wavePowerStep) * this.aggression;
    const requiredPower = Math.max(
      tactic === 'probe' ? 0 : defense * requiredAdvantage,
      basePower,
    );
    const needed = this.neededSquad(fighters, requiredPower);
    if (needed > fighters.length) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      this.postponedRuns++;
      if (this.postponedRuns >= 2) {
        this.game.notify(
          'Противник стягивает силы: похоже, готовится крупный удар.',
          'warn',
          'ai-gather',
          120,
          5,
        );
      }
      this.debugLog(
        `волна отложена: мощь ${Math.round(this.squadPower(fighters))}`
        + `/${Math.round(requiredPower)}, оборона ${Math.round(defense)}, `
        + `бойцов ${fighters.length}`,
      );
      return;
    }

    // Провал больше не повторяется тем же числом: отряд растёт.
    const recentWipes = this.rules.memory ? this.waveLog.filter((w) => (
      w.state === 'wiped' && this.game.elapsed - w.endedAt < AI.waveTimeout * 2
    )).length : 0;
    const minSquad = tactic === 'probe'
      ? 1
      : AI.minWaveSquad + recentWipes * AI.wipeSquadBonus;

    let squadSize = Math.max(wanted, minSquad, needed);
    squadSize = Math.max(1, Math.min(fighters.length, squadSize));
    const pool = shuffle(fighters.slice(), Math.random);
    const squad = pool.slice(0, squadSize);
    // `neededSquad` считает сильнейших бойцов, а в отряд попадают случайные:
    // добираем его, пока он реально не наберёт порог мощи.
    while (this.squadPower(squad) < requiredPower && squad.length < pool.length) {
      squad.push(pool[squad.length]);
    }

    // Бойцы ушли в волну: разведка их больше не ждёт.
    for (const u of squad) this.scoutTasks.delete(u.id);
    squad.forEach((u, i) => {
      const point = secondary && i % 2 === 0 ? secondary : primary;
      u.issueAttackMove(
        point.x + (Math.random() - 0.5) * 4,
        point.z + (Math.random() - 0.5) * 4,
      );
    });
    const support = this.waveSupport(squad, tactic);
    const escort = this.escortPoint(squad, primary);
    for (const u of support) {
      u.issueEscort(
        escort.x + (Math.random() - 0.5) * 5,
        escort.z + (Math.random() - 0.5) * 5,
      );
    }
    this.beginWave({
      tactic,
      squad: squad.concat(support),
      point: primary,
      targetEntity: primaryTarget,
    });
    this.postponedRuns = 0;

    this.waveIndex++;
    this.waveTimer = AI.waveInterval * this.rules.waveInterval * (0.8 + Math.random() * 0.45);
    this.lastWaveAt = this.game.elapsed;

    const messages = {
      assault: this.waveIndex === 1
        ? 'Противник начал наступление на нашу базу!'
        : `Волна противника №${this.waveIndex} приближается!`,
      raid: 'Отряд противника идёт на наши постройки!',
      split: 'Противник атакует с двух направлений!',
      probe: 'Разведка противника прощупывает оборону.',
    };
    this.game.notify(messages[tactic], 'danger', `wave_${this.waveIndex}`, 0, 6);
    if (this.game.ui) {
      this.game.ui.alert();
      this.game.ui.ping(primary.x, primary.z, '#ff4b3e');
      if (secondary) this.game.ui.ping(secondary.x, secondary.z, '#ff4b3e');
    }
    this.rally = this.baseRally();
  }
}
