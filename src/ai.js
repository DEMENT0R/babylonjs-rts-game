// Простой противник: экономика, инженеры, застройка, ремонт и волны атак.

import { Vector3 } from './babylon.js';
import {
  AI, AI_DIFFICULTY, BUILDINGS, MAP, UNITS, UPGRADES, UNIT_PRODUCTION, UPGRADE_BUILDING,
} from './config.js';
import { clamp, dist, distToSegment, shuffle, TAU } from './utils.js';

export class AIController {
  constructor(game, difficulty = 'normal', options = null) {
    this.game = game;
    // Сложность — это набор правил поверх одного и того же ИИ: флаги
    // включают «умные» привычки, множители меняют темп и экономику.
    this.difficulty = AI_DIFFICULTY[difficulty] ? difficulty : 'normal';
    this.rules = AI_DIFFICULTY[this.difficulty];
    // Миссия может задать темп наступления и экономику поверх сложности.
    this.missionOptions = options;
    this.credits = AI.credits * (options?.credits ?? 1) * (0.85 + Math.random() * 0.4);
    this.waveTimer = options?.firstWave != null
      ? options.firstWave * (0.92 + Math.random() * 0.16)
      : AI.firstWave * this.rules.firstWave * (0.8 + Math.random() * 0.4);
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
    // Опытные бойцы проверяются реже общего цикла: отход — не мгновенная
    // реакция на каждое попадание, а решение раз в секунду.
    this.veteranTimer = 1;
    // Сколько секунд подряд казармы простаивают из-за нехватки кредитов.
    // Пока это значение велико, противник обороняется, а не нападает.
    this.starvedTime = 0;
    this.buildIntent = null;
    // Сколько секунд текущий план стройки ждёт кредитов. По этому счётчику
    // найм решает, пора ли перестать копить и купить бойца.
    this.saveTime = 0;
    // Телеметрия для отладочной панели: сколько всего прошло времени и
    // какую его долю у ИИ висел план стройки (то есть казармы ждали).
    this.uptime = 0;
    this.planTime = 0;
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
    // Итог последней разведки боем: если оборона штаба слабая, следующая
    // волна не ждёт обычного интервала.
    this.probeIntel = null;
    // Разведсводка о противнике. Живые войска видны только в обзоре, поэтому
    // здесь хранится последнее наблюдение, а не реальная армия игрока.
    this.scouting = {
      armyPower: 0,
      armyUnits: 0,
      at: -999,
      defense: 0,
      buildings: 0,
      turrets: 0,
    };
    this.intelTimer = 0;
    // Чтобы отказ от атаки не выглядел молчанием, игрок получает редкое
    // сообщение о том, что противник оценил его войска и копит силы.
    this.lastAttackHoldNoticeAt = -999;
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
    this.debugBody = null;
    this.debugTabs = [];
    this.debugTab = 'intel';
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

  /** Дистанция между базами: масштаб для подхода, обхода и таймингов. */
  baseDistance() {
    const a = this.game.map.spawn.enemy.hq;
    const b = this.game.map.spawn.player.hq;
    return dist(a.x, a.z, b.x, b.z);
  }

  /** Радиус подхода к цели, растущий вместе с размером поля. */
  approachRadius() {
    return clamp(
      this.baseDistance() * AI.approachDistanceShare,
      AI.assaultApproachRadius,
      AI.assaultApproachMax,
    );
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
    const anchor = this.defenseAnchor();
    if (supply >= AI.garrisonSupply) {
      this.holdGarrisonPost(anchor);
      return;
    }

    const active = this.activeWave?.ids;
    const candidates = fighters
      .filter((u) => (
        !u.aiGarrison
        && !u.aiPicket
        && !(active && active.has(u.id))
        && (u.aiShelterUntil ?? 0) <= this.game.elapsed
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

  /**
   * Гарнизон возвращается на пост после погони за нарушителем: иначе один
   * выстрел уводил бойцов с позиции под турелями навсегда.
   */
  holdGarrisonPost(anchor) {
    for (const u of this.game.units) {
      if (!u.alive || !u.aiGarrison) continue;
      if (u.order?.type === 'attack' && u.order.target?.alive) continue;
      const d = dist(u.position.x, u.position.z, anchor.x, anchor.z);
      if (d <= AI.garrisonHoldRadius + 8) continue;
      u.issueHold(
        anchor.x + (Math.random() - 0.5) * 6,
        anchor.z + (Math.random() - 0.5) * 6,
      );
    }
  }

  /**
   * Караул на вышках. Дальние месторождения турели не прикрывают, а гарнизон
   * держится у штаба — рейд по такой вышке проходил без сопротивления.
   * Теперь на самой уязвимой вышке дежурит боец: он встречает рейд первым и
   * даёт время подойти остальным.
   */
  ensureOilPickets() {
    const hq = this.enemyHq();
    if (!hq) return;
    const active = this.activeWave?.ids;
    let posted = 0;
    for (const u of this.game.units) {
      if (!u.aiPicket) continue;
      // Вышку потеряли или караул погиб — флаг снимается, дежурство ищет
      // новое место само.
      if (!u.alive || !u.picketDerrick?.alive) {
        u.aiPicket = false;
        u.picketDerrick = null;
        continue;
      }
      posted++;
    }
    if (posted >= AI.oilPicketCount) return;

    const derricks = this.game.buildings
      .filter((b) => b.alive && b.faction === 'enemy' && b.type === 'derrick' && b.complete)
      .sort((a, b) => (
        dist(b.position.x, b.position.z, hq.position.x, hq.position.z)
        - dist(a.position.x, a.position.z, hq.position.x, hq.position.z)
      ));

    for (const derrick of derricks) {
      if (posted >= AI.oilPicketCount) break;
      // Вышку в радиусе турели прикрывает сама турель.
      const covered = this.game.buildings.some((b) => (
        b.alive && b.faction === 'enemy' && b.type === 'turret'
        && dist(b.position.x, b.position.z, derrick.position.x, derrick.position.z)
          <= AI.derrickTurretRadius + 6
      ));
      if (covered) continue;
      const nearby = this.game.units.some((u) => (
        u.aiPicket
        && dist(u.position.x, u.position.z, derrick.position.x, derrick.position.z)
          <= AI.oilPicketRadius
      ));
      if (nearby) continue;

      const picket = this.game.units
        .filter((u) => (
          u.alive
          && u.faction === 'enemy'
          && !u.def.builder
          && !u.def.healer
          && !u.def.vehicle
          && !u.aiGarrison
          && !u.aiPicket
          && !(active && active.has(u.id))
          && (u.aiShelterUntil ?? 0) <= this.game.elapsed
          && (!u.order || u.order.type === 'move' || u.order.type === 'hold')
        ))
        .sort((a, b) => (
          dist(a.position.x, a.position.z, derrick.position.x, derrick.position.z)
          - dist(b.position.x, b.position.z, derrick.position.x, derrick.position.z)
        ))[0];
      if (!picket) break;
      // Караул стоит между вышкой и своей базой: он не лезет под огонь
      // игрока, но успевает ответить нападающему.
      const dx = hq.position.x - derrick.position.x;
      const dz = hq.position.z - derrick.position.z;
      const len = Math.hypot(dx, dz) || 1;
      picket.aiPicket = true;
      picket.picketDerrick = derrick;
      picket.issueHold(
        derrick.position.x + (dx / len) * 4,
        derrick.position.z + (dz / len) * 4,
      );
      posted++;
    }
  }

  update(dt) {
    if (this.game.over) {
      this.debugEl?.remove();
      this.debugEl = null;
      return;
    }
    this.credits += this.game.enemyIncome() * this.rules.income * (this.missionOptions?.income ?? 1) * dt;
    this.trainTimer -= dt;
    this.defenseTimer -= dt;
    this.buildTimer -= dt;
    this.repairTimer -= dt;
    this.researchTimer -= dt;
    this.assignTimer -= dt;
    this.scoutTimer -= dt;

    this.updateEconomy(dt);
    // Пока висит план стройки, копим на него, но не бесконечно: счётчик
    // ограничивает паузу в найме (см. tryTrain). Заодно копим телеметрию
    // для отладочной панели.
    this.uptime += dt;
    if (this.buildIntent) {
      this.saveTime += dt;
      this.planTime += dt;
    } else {
      this.saveTime = 0;
    }

    this.garrisonTimer -= dt;
    if (this.garrisonTimer <= 0) {
      this.garrisonTimer = 2;
      this.ensureGarrison();
      this.ensureOilPickets();
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

    this.veteranTimer -= dt;
    if (this.veteranTimer <= 0) {
      this.veteranTimer = 1;
      this.updateVeteranSafety();
    }

    this.intelTimer -= dt;
    if (this.intelTimer <= 0) {
      this.intelTimer = 1;
      this.updateIntel();
    }

    if (this.trainTimer <= 0) {
      this.trainTimer = 1.0;
      this.tryTrain();
    }

    this.updateWaveField();
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
    const factory = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'factory' && b.complete,
    ).length;
    const lab = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'lab' && b.complete,
    ).length;
    const engineering = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'engineering' && b.complete,
    ).length;
    const rear = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'rear' && b.complete,
    ).length;
    const depots = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'depot' && b.complete,
    ).length;
    const depotSites = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'depot' && !b.complete,
    ).length;
    const turrets = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'turret' && b.complete,
    ).length;
    const walls = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'wall',
    ).length;
    const powerPlants = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'power' && b.complete,
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
    // Модули строятся под план следующей волны, а не когда лимит уже занят:
    // после выхода отряда лимит «освобождается», и по старому правилу новые
    // модули не закладывались никогда. Площадки тоже считаются — иначе ИИ
    // ставил бы несколько модулей подряд на один и тот же провал лимита.
    const depotStep = BUILDINGS.depot.armyCap ?? 10;
    const capTarget = Math.min(
      this.rules.armyCap,
      AI.armyCapPlan + this.waveIndex * AI.armyCapPerWave,
    );
    const plannedCap = armyCap + depotSites * depotStep;
    const needDepot = plannedCap < capTarget || armyCap - armyUsed < 6;

    let type = null;
    // Каждая строка проверяет требования цепочки: недоступную постройку
    // ИИ не выбирает и не копит на неё кредиты.
    if (powerPlants === 0) type = 'power';
    else if (barracks === 0 && this.canBuild('barracks')) type = 'barracks';
    // Энергию держим с запасом, а не по факту дефицита: при перерасходе
    // производство падает втрое, и армия встаёт вместе с базой.
    else if (powerMargin < AI.powerReserve && this.canBuild('power')) type = 'power';
    // Разведанное месторождение — приоритет: вышка дешёвая и сразу платит.
    else if (freePatch && this.credits > BUILDINGS.derrick.cost + 60
      && this.canBuild('derrick')) type = 'derrick';
    else if (factory === 0 && this.canBuild('factory')
      && this.credits > BUILDINGS.factory.cost + 40) {
      // Техника требует отдельного завода: без него армия остаётся пехотной.
      type = 'factory';
    } else if (needDepot && plannedCap + depotStep <= this.rules.armyCap
      && depots + depotSites < this.rules.depotCap && this.canBuild('depot')
      && this.credits > BUILDINGS.depot.cost + 30) {
      type = 'depot';
    } else if (turrets === 0 && game.elapsed > 130 && this.canBuild('turret')) {
      // Первую турель противник копит целенаправленно: армия на время замирает.
      type = 'turret';
    } else if (game.elapsed > 110 && turrets < (game.elapsed > 220 ? AI.turretCap : 2)
      && this.canBuild('turret') && this.credits > BUILDINGS.turret.cost + 80) {
      type = 'turret';
    } else if (lab === 0 && game.elapsed > 140 && this.canBuild('lab')
      && this.credits > BUILDINGS.lab.cost + 40) {
      type = 'lab';
    } else if (engineering === 0 && lab > 0 && game.elapsed > 180
      && this.canBuild('engineering') && this.credits > BUILDINGS.engineering.cost + 40) {
      type = 'engineering';
    } else if (rear === 0 && lab > 0 && engineering > 0 && game.elapsed > 240
      && this.canBuild('rear') && this.credits > BUILDINGS.rear.cost + 60) {
      type = 'rear';
    } else if (barracks < 2 && game.elapsed > 135 && this.canBuild('barracks')) {
      type = 'barracks';
    }
    // Баррикады дешёвые и быстрые: линия перед турелями появляется после
    // первых двух турелей и второй казармы, чтобы не тормозить армию.
    else if (game.elapsed > 170 && turrets >= 2 && walls < AI.wallCap
      && this.canBuild('wall') && this.credits > BUILDINGS.wall.cost + 20) {
      type = 'wall';
    }
    else if (game.elapsed > 240 && buildings < 20 && this.credits > 520) {
      const roll = Math.random();
      type = roll < 0.35 ? 'power' : roll < 0.55 ? 'barracks' : roll < 0.7 ? 'factory' : roll < 0.85 ? 'depot' : 'turret';
      if (type && !this.canBuild(type)) type = null;
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
    if (!type || !this.canBuild(type) || this.credits < BUILDINGS[type].cost) return false;
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
      // Караул на вышке не уходит в разведку: иначе вышка снова останется
      // без защиты.
      && !u.aiPicket
      // Уже идущий разведчик не переназначается: иначе отряд дёргается на
      // месте, а каждые десять секунд получает новую цель.
      && !this.scoutTasks.has(u.id)
      // Вернувшийся из-под огня боец отдыхает у базы, а не идёт обратно.
      && (u.aiScoutRest ?? 0) <= game.elapsed
      // Отведённый в укрытие ветеран сначала доходит до турели/базы.
      && (u.aiShelterUntil ?? 0) <= game.elapsed
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

  /** ИИ исследует улучшения в подходящем здании, когда накопил кредиты. */
  tryResearch() {
    const game = this.game;
    const labs = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.def.research
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
    let bestBuilding = null;
    let bestScore = -Infinity;
    for (const key of available) {
      const def = UPGRADES[key];
      // Линию нельзя купить не в том здании: ищем свободный подходящий корпус.
      const buildingType = UPGRADE_BUILDING[def.line];
      const site = labs.find((b) => b.type === buildingType);
      if (!site) continue;
      let score = 1 + Math.random() * 2;
      if (def.scope === 'unit') score += (counts.get(def.target) ?? 0) * 3;
      else if (def.scope === 'building') {
        score += def.target === 'turret' ? turrets * 4 : buildings.length * 0.35;
      } else if (key === 'income') score += derricks * 3;
      else if (key === 'reserve') score += (capUsed / Math.max(1, cap)) * 6;
      else if (key === 'logistics') score += 2.5;
      else if (key === 'maintenance') score += 1.5;
      // Ракетная платформа нужна, как только у игрока появляются укрепления:
      // без неё ИИ не может заказать РСЗО и теряет осадный ответ.
      if (key === 'rockets') {
        score += this.siegeArtilleryNeeded() > 0 ? 14 : (game.elapsed > 140 ? 4 : 0);
      }
      if (key === 'energy') {
        const power = game.power.enemy;
        score += power.used > power.produced ? 8 : 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = key;
        bestBuilding = site;
      }
    }
    if (!best || !bestBuilding) return;
    game.startUpgrade(bestBuilding, best);
  }

  // ------------------------------------------------------------- армия
  /**
   * Голодает ли экономика. Пока производство простаивает из-за нехватки
   * кредитов на самого дешёвого бойца, копим силы у базы. Короткая пауза
   * между наймом юнитов голодом не считается: важно затянувшееся безденежье.
   */
  updateEconomy(dt) {
    const game = this.game;
    const used = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const cap = Math.min(this.rules.armyCap, game.getArmyCap('enemy'));
    const stalled = this.hasProduction()
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
    if (type === 'barracks' || type === 'factory') return true;
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

  /** Выполнены ли требования для постройки этого типа. */
  canBuild(type) {
    return this.game.missingBuildingRequirements('enemy', type).length === 0;
  }

  /** Производственные здания противника с пустой очередью. */
  productionBuildings() {
    return this.game.buildings.filter((b) => (
      b.alive
      && b.faction === 'enemy'
      && b.complete
      && b.queue.length === 0
      && UNIT_PRODUCTION[b.type]?.length
    ));
  }

  /** Есть ли куда нанимать: хотя бы одно производственное здание готово. */
  hasProduction() {
    return this.productionBuildings().length > 0;
  }

  /** Может ли ИИ прямо сейчас заказать юнит: здание есть, исследование изучено. */
  canTrain(type) {
    const def = UNITS[type];
    if (!def) return false;
    if (def.requires && !this.game.upgrades.enemy?.has(def.requires)) return false;
    return this.productionBuildings().some((b) => b.type === def.from);
  }

  tryTrain() {
    const game = this.game;
    const used = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const cap = Math.min(this.rules.armyCap, game.getArmyCap('enemy'));
    if (used >= cap) {
      // Полный лимит не блокирует первую РСЗО: иначе она не появится никогда.
      const wantsFirstArtillery = game.elapsed > 240
        && this.artilleryCount() === 0
        && this.canTrain('artillery');
      if (!wantsFirstArtillery) return;
    }
    const producers = this.productionBuildings();
    if (!producers.length) return;

    const t = game.elapsed;
    // Игрок ушёл в оборону: против турелей нужен осадный ответ, а не ещё
    // одна волна пехоты под огонь. РСЗО заказывается вне случайного выбора,
    // иначе осадного звена можно не дождаться всю партию.
    const siegeNeeded = t > AI.siegeArtilleryFrom ? this.siegeArtilleryNeeded() : 0;
    // Хотя бы одна РСЗО нужна и без осадной цели: иначе ИИ изучает ракетную
    // платформу, но за всю партию не выпускает ни одной установки.
    const artilleryNeeded = siegeNeeded > this.artilleryCount()
      || (t > 240 && this.artilleryCount() === 0);
    let type = null;
    if (artilleryNeeded && this.canTrain('artillery')) {
      type = 'artillery';
    } else {
      // Случайный, но осмысленный состав: чем агрессивнее партия, тем охотнее
      // Противник вкладывается в тяжёлую технику; на старте преобладает пехота.
      const weights = [
        { type: 'marine', weight: 1 },
        { type: 'medic', weight: t > 40 ? 0.4 : 0 },
        { type: 'scout', weight: t > 35 ? 0.8 : 0.25 },
        { type: 'tank', weight: t > 95 ? 0.6 * this.aggression : 0 },
        { type: 'artillery', weight: t > AI.siegeArtilleryFrom ? 0.5 * this.aggression : 0 },
      ];
      // Прошлую волну сожгли турели — противник делает ставку на тяжёлую технику.
      if (this.rules.counter && this.isTurretCause(this.lastFailureCause())) {
        for (const item of weights) {
          if (item.type === 'tank' && t > 60) item.weight = Math.max(item.weight, 0.9);
          if (item.type === 'artillery' && t > 120) item.weight = Math.max(item.weight, 0.7);
        }
      }
      // Закрытые исследованием юниты не участвуют в жребии, иначе ИИ
      // выбирал бы недоступную технику и простаивал.
      const allowed = weights.filter((item) => item.weight > 0 && this.canTrain(item.type));
      const total = allowed.reduce((sum, item) => sum + item.weight, 0);
      if (total <= 0) return;
      let roll = Math.random() * total;
      for (const item of allowed) {
        roll -= item.weight;
        if (roll <= 0) {
          type = item.type;
          break;
        }
      }
      type ??= allowed[allowed.length - 1]?.type ?? null;
      if (!type) return;
    }

    let def = UNITS[type];
    // Если под выбранную машину не хватает лимита, противник добирает пехоту.
    // Первая РСЗО — исключение: она заказывается даже при полном лимите,
    // иначе дешёвые юниты занимают все места и артиллерия не появляется.
    if (used + (def.supply ?? 1) > cap) {
      const firstArtillery = type === 'artillery' && this.artilleryCount() === 0;
      if (!firstArtillery) {
        const fallback = ['marine', 'medic', 'scout', 'tank'].find((key) => (
          this.canTrain(key) && used + (UNITS[key].supply ?? 1) <= cap
        ));
        if (!fallback) return;
        type = fallback;
        def = UNITS[type];
      }
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
    const candidates = producers.filter((b) => b.type === def.from);
    if (!candidates.length) return;
    this.credits -= def.cost;
    const builder = candidates[Math.floor(Math.random() * candidates.length)];
    builder.enqueue(type);
    this.saveTime = 0;
    this.trainTimer = 3.5 + Math.random() * 2.5;
  }

  /** Сколько РСЗО уже есть в армии или заказано в производстве. */
  artilleryCount() {
    let count = 0;
    for (const u of this.game.units) {
      if (u.alive && u.faction === 'enemy' && u.type === 'artillery') count++;
    }
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'enemy') continue;
      for (const item of b.queue ?? []) {
        if (item.type === 'artillery') count++;
      }
    }
    return count;
  }

  /**
   * Что игрок построил у цели: известные турели и баррикады. Считаются только
   * разведанные постройки — в тумане ИИ о них не знает.
   */
  knownFortifications(point) {
    let turrets = 0;
    let walls = 0;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'player') continue;
      if (b.type !== 'turret' && b.type !== 'wall') continue;
      if (b.type === 'turret' && !b.complete) continue;
      if (!this.game.isBuildingKnownTo('enemy', b)) continue;
      if (dist(point.x, point.z, b.position.x, b.position.z) > AI.fortificationRadius) continue;
      if (b.type === 'turret') turrets++;
      else walls++;
    }
    // Баррикады не стреляют, но линия из них тоже требует осадного подхода:
    // считаем их долей турели.
    return { turrets, walls, hard: turrets + walls / 3 };
  }

  /** Сколько РСЗО нужно, чтобы вскрыть известные укрепления у штаба игрока. */
  siegeArtilleryNeeded() {
    const hq = this.game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    if (!hq) return 0;
    const fort = this.knownFortifications(hq.position);
    if (fort.hard < AI.siegeFortificationThreshold) return 0;
    return Math.min(AI.siegeArtilleryCap, Math.max(1, Math.ceil(fort.hard / 2)));
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
      if (u.aiPicket) continue;
      if (active && active.has(u.id)) continue;
      if ((u.aiShelterUntil ?? 0) > this.game.elapsed) continue;
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
        && !u.aiGarrison
        && (u.aiShelterUntil ?? 0) <= game.elapsed,
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
   * Оборона построек: если игрок обстреливает вышку, турель или казарму,
   * свободные бойцы идут на помощь. Раньше помощь приходила только после
   * попадания, только в 30 единицах от здания и не больше двух — дальние
   * постройки успевали умереть до реакции. Теперь угроза видна заранее, а при
   * пустой округе защитники подходят с базы, не оголяя её.
   */
  defendStructures() {
    const game = this.game;
    const hq = this.enemyHq();
    if (!hq) return;
    const active = this.activeWave?.ids;
    let homeSupply = this.homeGuardSupply(active);

    for (const b of game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.type === 'hq') continue;
      // Баррикады дешёвые и сменные: на них тратить бойцов незачем.
      if (b.type === 'wall') continue;
      const threats = this.structureThreats(b);
      if (!threats.length) continue;
      const want = Math.min(AI.structureGuardCount, threats.length + 1);

      const candidates = game.units
        .filter((u) => (
          u.alive
          && u.faction === 'enemy'
          && !u.def.builder
          && !u.def.healer
          && !(active && active.has(u.id))
          && (u.aiShelterUntil ?? 0) <= game.elapsed
          // Караул отвечает только за свою вышку, а не бегает по всей карте.
          && (!u.aiPicket
            || dist(u.position.x, u.position.z, b.position.x, b.position.z)
              <= AI.structureGuardRadius)
          // Уже дерётся с конкретной целью — не сбиваем приказ каждые 1.5 с.
          && !(u.order?.type === 'attack' && u.order.target?.alive)
        ))
        .map((u) => ({ u, d: dist(u.position.x, u.position.z, b.position.x, b.position.z) }))
        .sort((a, c) => a.d - c.d);

      let sent = 0;
      for (const { u, d } of candidates) {
        if (sent >= want) break;
        const supply = u.def.supply ?? 1;
        const near = d <= AI.structureGuardRadius;
        // С базы снимаем только при угрозе в зоне реакции и не оголяя её:
        // иначе рейд по дальней вышке уводит всю армию, а штаб стоит открытым.
        if (!near) {
          if (d > AI.structureCallRadius) continue;
          if (homeSupply - supply < AI.structureHomeReserve) continue;
        }
        u.issueAttack(threats[sent % threats.length]);
        u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 6);
        if (!near) homeSupply -= supply;
        sent++;
      }
    }
  }

  /** Кто угрожает постройке: обстреливает её или подошёл вплотную. */
  structureThreats(building) {
    const threats = [];
    const attacker = building.lastAttacker;
    if (
      attacker?.alive
      && attacker.faction === 'player'
      && this.game.elapsed - (building.lastHitAt ?? -Infinity) <= AI.structureHitWindow
      && this.game.isEntityVisibleTo('enemy', attacker)
    ) {
      threats.push(attacker);
    }
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'player') continue;
      if (threats.includes(u)) continue;
      if (!this.game.isEntityVisibleTo('enemy', u)) continue;
      const d = dist(u.position.x, u.position.z, building.position.x, building.position.z);
      if (d > AI.structureThreatRadius) continue;
      threats.push(u);
      if (threats.length >= AI.structureGuardCount) break;
    }
    return threats;
  }

  /** Сколько снабжения стоит у штаба: база не должна оставаться пустой. */
  homeGuardSupply(active) {
    const hq = this.enemyHq();
    if (!hq) return 0;
    let supply = 0;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'enemy' || u.def.builder || u.def.healer) continue;
      // Караул на вышке не снимается на защиту штаба: он стережёт своё.
      if (u.aiPicket) continue;
      if (active && active.has(u.id)) continue;
      const d = dist(u.position.x, u.position.z, hq.position.x, hq.position.z);
      if (d > AI.garrisonRadius) continue;
      supply += u.def.supply ?? 1;
    }
    return supply;
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

  /**
   * Боевая мощь отряда. Против укреплений РСЗО считается дороже: она бьёт
   * турели вне их сектора обстрела, и без поправки ИИ требовал для штурма
   * непомерную армию.
   */
  squadPower(units, artilleryBonus = 1) {
    return units.reduce((sum, u) => sum + this.combatValue(u)
      * (artilleryBonus > 1 && u.type === 'artillery' ? artilleryBonus : 1), 0);
  }

  /** Боевая мощь всей армии противника: гарнизон и караулы тоже считаются. */
  armyPower() {
    let power = 0;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'enemy' || u.def.builder) continue;
      power += this.combatValue(u);
    }
    return power;
  }

  /**
   * Обновляет разведсводку об игроке. Живые войска видны только в текущем
   * обзоре, поэтому запоминается последнее наблюдение — по нему противник и
   * судит о силах, а не подглядывает сквозь туман. Постройки помнятся дольше:
   * их видно в уже разведанной зоне.
   */
  updateIntel() {
    const game = this.game;
    let armyPower = 0;
    let armyUnits = 0;
    for (const u of game.units) {
      if (!u.alive || u.faction !== 'player') continue;
      if (!game.isEntityVisibleTo('enemy', u)) continue;
      armyPower += this.combatValue(u);
      armyUnits++;
    }
    if (armyUnits) {
      this.scouting.armyPower = armyPower;
      this.scouting.armyUnits = armyUnits;
      this.scouting.at = game.elapsed;
    }

    const hq = game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    this.scouting.defense = hq ? this.defenseAt(hq.position) : 0;
    let buildings = 0;
    let turrets = 0;
    for (const b of game.buildings) {
      if (!b.alive || b.faction !== 'player') continue;
      if (!game.isBuildingKnownTo('enemy', b)) continue;
      buildings++;
      if (b.type === 'turret' && b.complete) turrets++;
    }
    this.scouting.buildings = buildings;
    this.scouting.turrets = turrets;
  }

  /**
   * Стоит ли наступать: пока разведанная армия игрока заметно сильнее,
   * противник держит оборону и копит силы. Старая сводка не считается
   * приговором — без свежих данных ИИ не запирает себя навсегда.
   */
  attackAssessment() {
    const intel = this.scouting;
    const own = this.armyPower();
    const age = this.game.elapsed - intel.at;
    const threshold = intel.armyPower * AI.attackPowerRatio;
    const known = intel.armyUnits > 0 && age <= AI.intelMemory;
    return {
      hold: known && own < threshold,
      known,
      own,
      player: intel.armyPower,
      threshold: known ? threshold : 0,
      units: intel.armyUnits,
      age,
    };
  }

  /** Снимок разведданных и текущего соотношения сил для интерфейса. */
  intelReport() {
    const intel = this.scouting;
    const assessment = this.attackAssessment();
    return {
      armyPower: intel.armyPower,
      armyUnits: intel.armyUnits,
      age: this.game.elapsed - intel.at,
      defense: intel.defense,
      buildings: intel.buildings,
      turrets: intel.turrets,
      ownPower: assessment.own,
      threshold: assessment.threshold,
      hold: assessment.hold,
      known: assessment.known,
    };
  }

  /**
   * Что ИИ знает об обороне вокруг точки: постройки — по разведке (они не
   * двигаются, их помнят), войска — только по текущему обзору. В тумане
   * гарнизон для противника не существует, и придумывать его он не должен.
   */
  defenseAt(point, radius = AI.defenseRadius) {
    let value = 0;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'player') continue;
      if (!this.game.isBuildingKnownTo('enemy', b)) continue;
      if (dist(point.x, point.z, b.position.x, b.position.z) > radius + b.radius) continue;
      if (b.type === 'wall') {
        if (b.complete) value += AI.wallDefenseValue;
        continue;
      }
      value += this.combatValue(b);
    }
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'player') continue;
      if (!this.game.isEntityVisibleTo('enemy', u)) continue;
      if (dist(point.x, point.z, u.position.x, u.position.z) > radius) continue;
      value += this.combatValue(u);
    }
    return value;
  }

  /** Центр живых бойцов отряда: точка оценки угрозы и выбора укрытия. */
  squadCenter(units) {
    const alive = units.filter((u) => u && u.alive);
    if (!alive.length) return null;
    let x = 0;
    let z = 0;
    for (const u of alive) {
      x += u.position.x;
      z += u.position.z;
    }
    return { x: x / alive.length, z: z / alive.length };
  }

  /**
   * Во сколько раз видимая мощь игрока вокруг отряда превышает его
   * собственную. defenseAt считает только разведанные войска и известные
   * постройки, поэтому в тумане отряд не убегает от несуществующего врага.
   */
  waveThreatRatio(units) {
    const center = this.squadCenter(units);
    if (!center) return 0;
    const own = this.squadPower(units.filter((u) => u.alive));
    if (own <= 0) return 0;
    return this.defenseAt(center, AI.cautionRadius) / own;
  }

  /** Ближайшая готовая своя турель: к ней отряд и отходит. */
  nearestTurret(point) {
    let best = null;
    let bestD = Infinity;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'enemy' || b.type !== 'turret' || !b.complete) continue;
      const d = dist(point.x, point.z, b.position.x, b.position.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /**
   * Точка укрытия: за ближайшей турелью со стороны своей базы, чтобы отряд
   * встал под её огнём. Без турелей — гарнизонная точка у штаба.
   */
  shelterPoint(point) {
    const turret = point ? this.nearestTurret(point) : null;
    const hq = this.enemyHq();
    if (turret && hq) {
      const dx = hq.position.x - turret.position.x;
      const dz = hq.position.z - turret.position.z;
      const len = Math.hypot(dx, dz) || 1;
      return {
        x: clamp(
          turret.position.x + (dx / len) * AI.shelterTurretOffset,
          -MAP.clamp,
          MAP.clamp,
        ),
        z: clamp(
          turret.position.z + (dz / len) * AI.shelterTurretOffset,
          -MAP.clamp,
          MAP.clamp,
        ),
      };
    }
    const anchor = this.defenseAnchor();
    return { x: anchor.x, z: anchor.z };
  }

  /** Кого ИИ бережёт: ветераны пехоты и опытная техника. */
  isVeteranUnit(unit) {
    const rank = unit.rank ?? 0;
    if (unit.type === 'tank' || unit.type === 'artillery') {
      return rank >= AI.veteranVehicleRank;
    }
    return rank >= AI.veteranRank;
  }

  /**
   * Индивидуальный отход опытных бойцов и техники. Волна может продолжать
   * бой, но раненый ветеран уходит к турели или базе: опыт не восстановить.
   */
  updateVeteranSafety() {
    if (!this.rules.retreat) return;
    const now = this.game.elapsed;
    if (!this.enemyHq()) return;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'enemy' || u.def.builder || u.def.healer) continue;
      if (u.aiGarrison) continue;
      if ((u.aiShelterUntil ?? 0) > now) continue;
      if (!this.isVeteranUnit(u)) continue;
      const vehicle = u.type === 'tank' || u.type === 'artillery';
      const hpShare = u.hp / u.maxHp;
      const threshold = vehicle ? AI.veteranVehicleRetreatHp : AI.veteranRetreatHp;
      if (hpShare > threshold) continue;
      // Отходим только при реальной угрозе: раненый ветеран в тылу лечится
      // медиком, а не мечется к турели без причины.
      const threatened = this.game.units.some((e) => (
        e.alive && e.faction === 'player'
        && this.game.isEntityVisibleTo('enemy', e)
        && dist(u.position.x, u.position.z, e.position.x, e.position.z)
          <= AI.veteranThreatRadius
      ));
      if (!threatened) continue;
      const shelter = this.shelterPoint(u.position);
      u.issueMove(
        clamp(shelter.x + (Math.random() - 0.5) * 5, -MAP.clamp, MAP.clamp),
        clamp(shelter.z + (Math.random() - 0.5) * 5, -MAP.clamp, MAP.clamp),
      );
      u.retaliateTimer = 0;
      u.aiShelterUntil = now + AI.veteranShelterTime;
      this.debugLog(
        `ветеран ${u.def.name} (ранг ${u.rank}) отходит к укрытию при ${Math.round(hpShare * 100)}% HP`,
      );
    }
  }

  /** Сколько бойцов нужно, чтобы набрать требуемую мощь. */
  neededSquad(combat, requiredPower, artilleryBonus = 1) {
    if (requiredPower <= 0) return 0;
    const value = (u) => this.combatValue(u)
      * (artilleryBonus > 1 && u.type === 'artillery' ? artilleryBonus : 1);
    const sorted = combat.slice().sort((a, b) => value(b) - value(a));
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += value(sorted[i]);
      if (sum >= requiredPower) return i + 1;
    }
    return Infinity;
  }

  // ------------------------------------------------------------- память волн
  /**
   * Запоминает отправленную волну. Запись закроется сама, когда отряд
   * погибнет или потеряет темп, — по ней ИИ судит, стоило ли оно того.
   */
  beginWave({
    tactic, squad, point, targetEntity = null, route = null, pending = [], travel = 0,
  }) {
    if (this.activeWave) this.finishWave(this.activeWave, 'superseded');
    if (route) route.since = this.game.elapsed;
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
      // Маршрут обхода и отложенная половина охвата живут до конца волны.
      route,
      pending,
      travel,
      // Таймаут учитывает дорогу: на просторной карте отряд иначе отзывают
      // до первого контакта.
      timeout: AI.waveTimeout + travel,
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
    // Вокруг отряда видно превосходящую армию игрока — уходим к турели или
    // базе, не дожидаясь, пока отряд перебьют по одному. defenseAt считает
    // только разведанные войска, поэтому это не реакция на туман.
    const now = this.game.elapsed;
    if (this.rules.retreat && age > AI.cautionGrace && now >= (record.cautionAt ?? 0)) {
      record.cautionAt = now + AI.cautionInterval;
      if (this.waveThreatRatio(alive.map(({ unit }) => unit)) >= AI.cautionRatio) {
        this.retreatWave(record, 'outgunned');
        return;
      }
    }
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
    if (age >= (record.timeout ?? AI.waveTimeout)) {
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

  /**
   * Отводит остатки волны к укрытию: под ближайшую турель или к базе.
   * Причина влияет только на сообщение игроку и отладку.
   */
  retreatWave(record, reason = 'weak') {
    const now = this.game.elapsed;
    const center = this.squadCenter(record.units.map(({ unit }) => unit));
    const shelter = this.shelterPoint(center);
    // Отложенная половина охвата и фланговый маршрут отменяются: иначе они
    // развернут отступающих обратно в бой.
    record.pending = [];
    record.route = null;
    record.retreatReason = reason;
    for (const { unit } of record.units) {
      if (!unit.alive) continue;
      unit.issueMove(
        clamp(shelter.x + (Math.random() - 0.5) * 6, -MAP.clamp, MAP.clamp),
        clamp(shelter.z + (Math.random() - 0.5) * 6, -MAP.clamp, MAP.clamp),
      );
      unit.retaliateTimer = 0;
      unit.aiShelterUntil = now + AI.shelterRest;
    }
    this.stats.retreats++;
    this.finishWave(record, 'retreated');
    this.game.notify(
      reason === 'outgunned'
        ? 'Отряд противника отходит: встретил превосходящие силы.'
        : 'Отряд противника отступает: пробить оборону не удалось.',
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
      this.targetCooldowns.set(
        record.targetId,
        this.game.elapsed + AI.targetCooldown + (record.travel ?? 0),
      );
    }
    // Разведка боем отработала — её вывод решает темп следующей волны.
    if (record.tactic === 'probe') this.recordProbeIntel();
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
    el.innerHTML = `
      <div class="ai-debug-head"><span>ИИ / ОТЛАДКА</span><span>?debug=ai</span></div>
      <div class="ai-debug-tabs">
        <button type="button" data-tab="intel">РАЗВЕДКА</button>
        <button type="button" data-tab="waves">ВОЛНЫ</button>
        <button type="button" data-tab="economy">ЭКОНОМИКА</button>
      </div>
      <pre class="ai-debug-body"></pre>`;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      this.debugTab = btn.dataset.tab;
      this.debugTimer = 0;
      this.updateDebugOverlay(0);
    });
    document.body.append(el);
    this.debugEl = el;
    this.debugBody = el.querySelector('.ai-debug-body');
    this.debugTabs = [...el.querySelectorAll('button[data-tab]')];
    this.updateDebugOverlay(0);
  }

  updateDebugOverlay(dt) {
    if (!this.debugEl) return;
    if (!this.game.started || this.game.over) {
      this.debugEl.style.display = 'none';
      return;
    }
    this.debugEl.style.display = '';
    this.debugTimer -= dt;
    if (this.debugTimer > 0) return;
    this.debugTimer = 0.5;
    for (const btn of this.debugTabs) {
      btn.classList.toggle('is-active', btn.dataset.tab === this.debugTab);
    }
    this.debugBody.textContent = this.debugReport().join('\n');
  }

  /** Строки активной вкладки отладочной панели. */
  debugReport() {
    const game = this.game;
    if (this.debugTab === 'economy') {
      const power = game.power.enemy;
      const income = game.enemyIncome() * this.rules.income;
      const armyUsed = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
      const armyCap = game.getArmyCap('enemy');
      const depots = game.buildings.filter(
        (b) => b.alive && b.faction === 'enemy' && b.type === 'depot',
      ).length;
      const plants = game.buildings.filter(
        (b) => b.alive && b.faction === 'enemy' && b.type === 'power',
      ).length;
      const planShare = this.uptime > 0 ? (100 * this.planTime) / this.uptime : 0;
      return [
        `кредиты ${Math.round(this.credits)}, доход ${income.toFixed(1)}/с`,
        `энергия ${power.used}/${power.produced}${power.factor < 1 ? ' — дефицит' : ''}`
          + `, станций ${plants}`,
        `армия ${armyUsed}/${armyCap} (потолок ${this.rules.armyCap}), модулей ${depots}`,
        `план: ${this.buildIntent ?? '—'}`
          + `${this.buildIntent ? `, копит ${this.saveTime.toFixed(0)} с` : ''}`
          + `, стройка ${Math.round(planShare)}% времени`,
        `до волны ${Math.max(0, this.waveTimer).toFixed(0)} с`,
      ];
    }

    if (this.debugTab === 'waves') {
      const s = this.stats;
      const settled = Math.max(1, s.settled);
      const active = this.activeWave;
      const alive = active ? active.units.filter(({ unit }) => unit.alive).length : 0;
      return [
        `волн ${s.waves}, провалов ${s.failures} (${Math.round((100 * s.failures) / settled)}%)`,
        `разгромов ${s.wiped}, зависших ${s.timeouts}, отходов ${s.retreats}`,
        `потери ${Math.round(s.supplyLost / settled)} снабж./волна`,
        `урон ${Math.round(s.damage)}, убито ${s.kills}`,
        `ср. время ${(s.duration / settled).toFixed(0)} с`,
        active ? `в поле ${alive}/${active.units.length} (${active.tactic})` : 'в поле: —',
        `до волны ${Math.max(0, this.waveTimer).toFixed(0)} с`,
      ];
    }

    const intel = this.intelReport();
    const age = intel.armyUnits
      ? (intel.age < 2 ? 'только что' : `${Math.round(intel.age)} с назад`)
      : 'нет данных';
    const ratio = intel.armyPower > 0
      ? `${Math.round((intel.ownPower / intel.armyPower) * 100)}% от разведанной армии`
      : 'нет данных';
    const verdict = intel.hold
      ? `держит оборону, нужно ${Math.ceil(intel.threshold)}`
      : intel.known ? 'перевес достаточен' : 'свежих данных нет';
    return [
      `разведка: ${age}`,
      `армия игрока: ${Math.round(intel.armyPower)} (${intel.armyUnits} юнитов)`,
      `оборона штаба: ${Math.round(intel.defense)}`,
      `известно построек: ${intel.buildings} (турелей ${intel.turrets})`,
      `сила ИИ: ${Math.round(intel.ownPower)}`,
      `соотношение: ${ratio}`,
      `решение: ${verdict}`,
    ];
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
  approachPoint(position, radius = this.approachRadius()) {
    const angle = Math.random() * TAU;
    const r = radius * (0.75 + Math.random() * 0.5);
    return {
      x: clamp(position.x + Math.cos(angle) * r, -MAP.clamp, MAP.clamp),
      z: clamp(position.z + Math.sin(angle) * r, -MAP.clamp, MAP.clamp),
    };
  }

  /**
   * Подход с той стороны, где меньше известно угроз: турелей и войск игрока.
   * Настоящего поиска пути тут нет: противник перебирает точки по кругу и
   * выбирает самую спокойную.
   */
  safeApproachPoint(position, radius = this.approachRadius()) {
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * TAU + Math.random() * 0.4;
      const r = radius * (0.75 + Math.random() * 0.5);
      const point = {
        x: clamp(position.x + Math.cos(angle) * r, -MAP.clamp, MAP.clamp),
        z: clamp(position.z + Math.sin(angle) * r, -MAP.clamp, MAP.clamp),
      };
      const score = this.threatScore(point);
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
    return best;
  }

  /**
   * Насколько точка опасна: известные турели и разведанные войска игрока.
   * Случайный шум не даёт волнам ходить одним и тем же маршрутом.
   */
  threatScore(point) {
    let score = Math.random() * 2;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'player' || b.type !== 'turret' || !b.complete) continue;
      if (!this.game.isBuildingKnownTo('enemy', b)) continue;
      const reach = (b.defense?.range ?? b.def.defense?.range ?? 17) + 6;
      const d = dist(point.x, point.z, b.position.x, b.position.z);
      if (d < reach) score += (reach - d) * 3;
    }
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'player' || !u.canFight) continue;
      if (!this.game.isEntityVisibleTo('enemy', u)) continue;
      const d = dist(point.x, point.z, u.position.x, u.position.z);
      if (d < AI.approachArmyRadius) score += (AI.approachArmyRadius - d) * 2;
    }
    return score;
  }

  /**
   * Точка флангового обхода: доля пути база→цель, вынесенная вбок на сторону
   * тихого сектора подхода. Если тихий сектор лежит на оси, сторону выбирает
   * разведка по турелям и войскам рядом с точкой.
   */
  flankPoint(target, quiet, start) {
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    const len = Math.hypot(dx, dz) || 1;
    const base = {
      x: start.x + dx * AI.flankRouteAt,
      z: start.z + dz * AI.flankRouteAt,
    };
    const perp = { x: -dz / len, z: dx / len };
    const bias = (quiet.x - start.x) * perp.x + (quiet.z - start.z) * perp.z;
    const side = Math.abs(bias) > 1 ? Math.sign(bias) : this.pickFlankSide(base, perp);
    const offset = len * AI.flankRouteOffset;
    return {
      x: clamp(base.x + perp.x * side * offset, -MAP.clamp, MAP.clamp),
      z: clamp(base.z + perp.z * side * offset, -MAP.clamp, MAP.clamp),
    };
  }

  /** Сторона обхода с меньшей известной угрозой; при равенстве — случайная. */
  pickFlankSide(point, perp) {
    const score = (sign) => this.threatScore({
      x: clamp(point.x + perp.x * sign * 18, -MAP.clamp, MAP.clamp),
      z: clamp(point.z + perp.z * sign * 18, -MAP.clamp, MAP.clamp),
    });
    const right = score(1);
    const left = score(-1);
    if (Math.abs(right - left) < 2) return Math.random() < 0.5 ? 1 : -1;
    return right <= left ? 1 : -1;
  }

  /** Оценка времени марша отряда к точке по скорости пехоты. */
  waveTravel(units, point) {
    const alive = units.filter((u) => u.alive);
    if (!alive.length) return 0;
    const cx = alive.reduce((sum, u) => sum + u.position.x, 0) / alive.length;
    const cz = alive.reduce((sum, u) => sum + u.position.z, 0) / alive.length;
    return dist(cx, cz, point.x, point.z) / AI.marchSpeed;
  }

  /** Центр разведанной армии игрока: рейд идёт туда, куда она не смотрит. */
  knownArmyCenter() {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'player' || !u.canFight) continue;
      if (!this.game.isEntityVisibleTo('enemy', u)) continue;
      x += u.position.x;
      z += u.position.z;
      n++;
    }
    if (n) return { x: x / n, z: z / n };
    const hq = this.game.map.spawn.player.hq;
    return { x: hq.x, z: hq.z };
  }

  /**
   * Ведёт волну в поле: выводит отложенную половину охвата и в нужный момент
   * поворачивает отряд с фланговой точки на саму цель.
   */
  updateWaveField() {
    const record = this.activeWave;
    if (!record) return;
    const now = this.game.elapsed;

    for (const pending of record.pending ?? []) {
      if (pending.sent || now < pending.at) continue;
      pending.sent = true;
      for (const u of pending.units) {
        if (!u.alive || (u.aiShelterUntil ?? 0) > now) continue;
        u.issueAttackMove(
          pending.x + (Math.random() - 0.5) * 4,
          pending.z + (Math.random() - 0.5) * 4,
        );
      }
      this.debugLog(`волна №${record.index}: вторая группа вышла на цель`);
    }
    record.pending = (record.pending ?? []).filter((p) => !p.sent);

    const route = record.route;
    if (!route || route.done) return;
    // Отложенные половины охвата идут на свои цели: их маршрут не трогаем.
    const waiting = new Set();
    for (const pending of record.pending ?? []) {
      for (const u of pending.units) waiting.add(u.id);
    }
    const alive = record.units
      .map(({ unit }) => unit)
      .filter((u) => u.alive && !waiting.has(u.id) && (u.aiShelterUntil ?? 0) <= now);
    if (!alive.length) return;
    const reached = alive.filter((u) => (
      dist(u.position.x, u.position.z, route.point.x, route.point.z) <= AI.flankRouteRadius
    )).length;
    const arrived = reached >= Math.ceil(alive.length * AI.flankRouteArrive);
    if (!arrived && now - route.since < route.timeout) return;
    route.done = true;
    for (const u of alive) {
      if (u.def.healer || u.def.builder) {
        u.issueEscort(
          route.final.x + (Math.random() - 0.5) * 5,
          route.final.z + (Math.random() - 0.5) * 5,
        );
      } else {
        u.issueAttackMove(
          route.final.x + (Math.random() - 0.5) * 4,
          route.final.z + (Math.random() - 0.5) * 4,
        );
      }
    }
    this.debugLog(`волна №${record.index}: обход с фланга завершён, поворот на цель`);
  }

  /**
   * Итог разведки боем: если оборона штаба оказалась слабой, следующая волна
   * не ждёт обычного интервала и идёт с меньшим требованием к перевесу.
   */
  recordProbeIntel() {
    const hq = this.game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    if (!hq) return;
    const defense = this.defenseAt(hq.position);
    const weak = defense < AI.probeWeakDefense;
    this.probeIntel = { at: this.game.elapsed, defense, weak };
    if (weak) {
      this.waveTimer = Math.min(this.waveTimer, AI.probePunishDelay);
      this.debugLog(
        `разведка нашла слабую оборону (${Math.round(defense)}): атака ускоряется`,
      );
    }
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

  /**
   * Выбирает цель рейда. Вышки и электростанции по-прежнему вкуснее, но
   * теперь рейд идёт туда, где слабее оборона и дальше разведанная армия
   * игрока: бить в тыл выгоднее, чем в готовый кулак.
   */
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
    const army = this.knownArmyCenter();
    let best = null;
    let bestScore = -Infinity;
    for (const b of candidates) {
      const score = dist(b.position.x, b.position.z, army.x, army.z)
        * AI.raidArmyDistanceWeight
        + (b.type === 'derrick' ? AI.raidDerrickBonus : 0)
        - this.defenseAt(b.position) * AI.raidDefenseWeight
        + Math.random() * AI.raidRandomness;
      if (score > bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
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
        if ((u.aiShelterUntil ?? 0) > this.game.elapsed) return false;
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
        && !u.aiGarrison && !u.aiPicket
        && (u.aiShelterUntil ?? 0) <= this.game.elapsed,
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

    // Без производственных зданий армию не пополнить: сначала стройка, потом наступление.
    if (!this.hasProduction()) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      this.debugLog('волна отложена: нет готового производства');
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

    // Если разведка показала, что армия игрока заметно сильнее, наступление
    // откладывается: противник копит силы у базы, а не отправляет войска на
    // верную гибель. Оценка — только по разведанным войскам.
    const strength = this.attackAssessment();
    if (strength.hold) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      if (this.game.elapsed - this.lastAttackHoldNoticeAt > 120) {
        this.lastAttackHoldNoticeAt = this.game.elapsed;
        this.game.notify(
          'Противник оценил наши войска как более сильные и не решается наступать.',
          'success',
          'ai-hold',
          120,
          5,
        );
      }
      this.debugLog(
        `волна отложена: армия ${Math.round(strength.own)}`
        + ` < ${Math.round(strength.threshold)} (войска игрока ${Math.round(strength.player)})`,
      );
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

    // Пробы и рейды — расходные операции. Опытных бойцов и технику туда не
    // берём, если набирается хотя бы пара новобранцев: ветеран нужен для
    // основного удара или обороны базы, а его опыт не восстановить.
    let available = fighters;
    if (this.rules.retreat && (tactic === 'probe' || tactic === 'raid')) {
      const rookies = fighters.filter((u) => !this.isVeteranUnit(u));
      if (rookies.length >= 2) available = rookies;
    }

    const primaryTarget = tactic === 'raid' && raidTarget ? raidTarget : playerHQ;
    // Кольцо подхода задаёт тихий сектор, но не является целью: отряд должен
    // дойти до самой постройки, иначе остановится в поле вне радиуса атаки.
    const targetPoint = {
      x: primaryTarget.position.x,
      z: primaryTarget.position.z,
    };
    const raidPoint = tactic === 'raid' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : null;
    const secondary = tactic === 'split' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : null;
    // Кольцо подхода задаёт тихий сектор для обхода: для рейда — сама цель,
    // для штурма — сторона штаба без известных турелей и войск.
    const approach = raidPoint ?? (this.rules.avoidTurrets
      ? this.safeApproachPoint(playerHQ.position)
      : this.approachPoint(playerHQ.position));
    const primary = raidPoint ?? targetPoint;

    // Оборона цели известна по разведке. Если игрок застроился турелями и
    // баррикадами, РСЗО идёт в отряд первой и считается дороже: только она
    // бьёт турели с дистанции вне их сектора обстрела.
    const fort = this.knownFortifications(primaryTarget.position);
    const siege = tactic !== 'probe' && fort.hard >= AI.siegeFortificationThreshold;
    const siegeBonus = siege ? AI.siegeArtilleryBonus : 1;

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
    let requiredAdvantage = this.rules.requiredAdvantage * (1 - patience);
    // Разведка нашла слабую оборону — перевес можно не копить. Интеллект
    // тратится на одну волну, а не живёт до конца партии.
    const intel = this.probeIntel;
    if (tactic !== 'probe' && intel
      && this.game.elapsed - intel.at <= AI.probeIntelFresh && intel.weak) {
      requiredAdvantage *= 1 - AI.probePunishDiscount;
      this.probeIntel = null;
    }
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
    const needed = this.neededSquad(available, requiredPower, siegeBonus);
    if (needed > available.length) {
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
        `волна отложена: мощь ${Math.round(this.squadPower(available))}`
        + `/${Math.round(requiredPower)}, оборона ${Math.round(defense)}, `
        + `бойцов ${available.length}`,
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
    squadSize = Math.max(1, Math.min(available.length, squadSize));
    const pool = shuffle(available.slice(), Math.random);
    // Осадное звено идёт в отряд первым: иначе случайный набор снова оставит
    // РСЗО на базе, а пехоту — под турелями.
    if (siege) {
      pool.sort((a, b) => (b.type === 'artillery' ? 1 : 0) - (a.type === 'artillery' ? 1 : 0));
    }
    const squad = pool.slice(0, squadSize);
    // `neededSquad` считает сильнейших бойцов, а в отряд попадают случайные:
    // добираем его, пока он реально не наберёт порог мощи.
    while (this.squadPower(squad, siegeBonus) < requiredPower && squad.length < pool.length) {
      squad.push(pool[squad.length]);
    }

    // Волна не забирает всех: у базы остаётся резерв снабжения. Лишних
    // бойцов сверх порога мощи оставляем дома — иначе после выхода отряда
    // база пуста, и один ответный рейд заканчивает партию. Если убрать
    // бойца нельзя без потери мощи, волна идёт как есть: резерв не должен
    // останавливать наступление навсегда.
    const fighterSupply = available.reduce((sum, u) => sum + (u.def.supply ?? 1), 0);
    let homeSupply = fighterSupply
      - squad.reduce((sum, u) => sum + (u.def.supply ?? 1), 0);
    while (homeSupply < AI.waveHomeReserve && squad.length > 1) {
      const last = squad[squad.length - 1];
      if (this.squadPower(squad, siegeBonus) - this.squadPower([last], siegeBonus)
        < requiredPower) break;
      squad.pop();
      homeSupply += last.def.supply ?? 1;
    }

    // Бойцы ушли в волну: разведка их больше не ждёт.
    for (const u of squad) this.scoutTasks.delete(u.id);

    // Охват пополам: одна половина бьёт по экономике, вторая — по штабу.
    const mainSquad = [];
    const secondSquad = [];
    squad.forEach((u, i) => {
      if (secondary && i % 2 === 0) secondSquad.push(u);
      else mainSquad.push(u);
    });

    // Фланговый маршрут: основная группа идёт не по прямой, а в обход.
    // Разведка боем — исключение: ей нужен быстрый контакт.
    const base = this.game.map.spawn.enemy.hq;
    const route = tactic === 'probe' ? null : {
      point: this.flankPoint(primary, approach, base),
      final: { x: primary.x, z: primary.z },
      done: false,
      timeout: 0,
    };
    const mainTravel = this.waveTravel(mainSquad, route ? route.point : primary);
    if (route) route.timeout = mainTravel * 1.5 + AI.flankRouteGrace;

    for (const u of mainSquad) {
      const point = route ? route.point : primary;
      u.issueAttackMove(
        point.x + (Math.random() - 0.5) * 4,
        point.z + (Math.random() - 0.5) * 4,
      );
    }

    // Вторая половина охвата ждёт ровно столько, насколько её путь короче
    // флангового: обе группы должны ударить одновременно, а не колонной.
    const pending = [];
    let splitDelay = 0;
    if (secondSquad.length) {
      const routeTravel = route
        ? mainTravel + dist(route.point.x, route.point.z, primary.x, primary.z) / AI.marchSpeed
        : 0;
      splitDelay = clamp(
        routeTravel - this.waveTravel(secondSquad, secondary),
        0,
        routeTravel * AI.splitDelayShare,
      );
      if (splitDelay > 0.5) {
        pending.push({
          units: secondSquad,
          at: this.game.elapsed + splitDelay,
        });
      } else {
        for (const u of secondSquad) {
          u.issueAttackMove(
            secondary.x + (Math.random() - 0.5) * 4,
            secondary.z + (Math.random() - 0.5) * 4,
          );
        }
      }
    }

    const support = this.waveSupport(squad, tactic);
    const escort = this.escortPoint(squad, route ? route.point : primary);
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
      route,
      pending,
      travel: mainTravel + splitDelay,
    });
    this.postponedRuns = 0;

    this.waveIndex++;
    const interval = this.missionOptions?.waveInterval ?? AI.waveInterval * this.rules.waveInterval;
    this.waveTimer = interval * (0.8 + Math.random() * 0.45);
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
