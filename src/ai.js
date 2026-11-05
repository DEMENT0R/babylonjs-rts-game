// Простой противник: экономика, инженеры, застройка, ремонт и волны атак.

import { Vector3 } from './babylon.js';
import { AI, BUILDINGS, MAP, UNITS, UPGRADES } from './config.js';
import { clamp, dist, shuffle, TAU } from './utils.js';

export class AIController {
  constructor(game) {
    this.game = game;
    this.credits = AI.credits * (0.85 + Math.random() * 0.4);
    this.waveTimer = AI.firstWave * (0.8 + Math.random() * 0.4);
    this.waveIndex = 0;
    this.rally = this.baseRally();
    this.defenseTimer = 0;
    this.trainTimer = 2;
    this.lastWaveAt = -999;
    this.targetPoint = null;
    this.buildTimer = 5;
    this.repairTimer = 9;
    this.researchTimer = 25;
    this.assignTimer = 7;
    this.scoutTimer = 12 + Math.random() * 8;
    this.lastScoutNoticeAt = -999;
    this.buildIntent = null;
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
    this.debug = typeof location !== 'undefined' && /[?&]debug=ai\b/.test(location.search);

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

  update(dt) {
    if (this.game.over) return;
    this.credits += this.game.enemyIncome() * dt;
    this.trainTimer -= dt;
    this.defenseTimer -= dt;
    this.buildTimer -= dt;
    this.repairTimer -= dt;
    this.researchTimer -= dt;
    this.assignTimer -= dt;
    this.scoutTimer -= dt;

    if (this.defenseTimer <= 0) {
      this.defenseTimer = 1.5;
      this.defendBase();
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
      this.scoutTimer = 10 + Math.random() * 8;
      this.sendScouts();
    }

    if (this.trainTimer <= 0) {
      this.trainTimer = 1.0;
      this.tryTrain();
    }

    this.updateWaveMemory();
    this.updateWave(dt);
  }

  // ------------------------------------------------------------- строительство
  ensureEngineers(hq) {
    if (!hq || !hq.complete || hq.queue.length > 1) return;
    if (hq.queue.some((item) => item.type === 'engineer')) return;
    const count = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && u.type === 'engineer',
    ).length;
    const target = this.game.elapsed > 90 ? 2 : 1;
    if (count >= target) return;
    const used = this.game.getArmyUsed('enemy') + this.game.getQueuedSupply('enemy');
    if (used + (UNITS.engineer.supply ?? 1) > this.game.getArmyCap('enemy')) return;
    const def = UNITS.engineer;
    const reserve = count === 0 ? 90 : 60;
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
    const buildings = game.buildings.filter((b) => b.alive && b.faction === 'enemy').length;
    const power = game.power.enemy;
    const freePatch = this.findFreePatch();
    const armyUsed = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const armyCap = game.getArmyCap('enemy');

    let type = null;
    if (barracks === 0) type = 'barracks';
    else if (power.used >= power.produced) type = 'power';
    // Разведанное месторождение — приоритет: вышка дешёвая и сразу платит.
    else if (freePatch && this.credits > BUILDINGS.derrick.cost + 60) type = 'derrick';
    else if (armyCap - armyUsed < 6 && depots < 5 && this.credits > BUILDINGS.depot.cost + 30) {
      type = 'depot';
    } else if (turrets === 0 && game.elapsed > 130) {
      // Первую турель Рой копит целенаправленно: армия на время замирает.
      type = 'turret';
    } else if (game.elapsed > 110 && turrets < (game.elapsed > 220 ? 3 : 2)
      && this.credits > BUILDINGS.turret.cost + 80) {
      type = 'turret';
    } else if (lab === 0 && game.elapsed > 170 && this.credits > 320) type = 'lab';
    else if (barracks < 2 && game.elapsed > 135) type = 'barracks';
    else if (power.produced - power.used < 8) type = 'power';
    else if (game.elapsed > 240 && buildings < 20 && this.credits > 520) {
      const roll = Math.random();
      type = roll < 0.4 ? 'power' : roll < 0.7 ? 'barracks' : roll < 0.85 ? 'depot' : 'turret';
    }

    this.buildIntent = type;
    if (!type) return;
    const def = BUILDINGS[type];
    // На вышку Рой копит без запаса: она сразу возвращает вложенное, а с
    // резервом в 30 кредитов ИИ не мог накопить на неё полминуты.
    const reserve = type === 'derrick' ? 0 : 30;
    if (!def || this.credits < def.cost + reserve) return;
    this.buildStructure(type);
  }

  buildStructure(type) {
    if (!type || this.credits < BUILDINGS[type].cost) return false;
    const spot = type === 'derrick'
      ? this.findFreePatch()
      : this.findBuildSpot(type);
    if (!spot) {
      this.buildIntent = null;
      return false;
    }
    const b = this.game.tryBuild(type, spot.x, spot.z, {
      faction: 'enemy',
      wallet: this,
    });
    if (!b) return false;
    this.buildIntent = null;
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
    // Чем дольше идёт бой, тем дальше Рой готов тянуться за нефтью. Важно
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
   */
  scoutTarget(point) {
    const game = this.game;
    let best = null;
    let bestD = Infinity;
    for (const patch of game.world.oilPatches ?? []) {
      if (patch.derrick && patch.derrick.alive) continue;
      if (game.isExploredBy('enemy', patch.x, patch.z)) continue;
      const d = dist(point.x, point.z, patch.x, patch.z);
      if (d < bestD) {
        bestD = d;
        best = { x: patch.x, z: patch.z };
      }
    }
    if (best) return best;
    return game.fog.nearestUnexplored(point.x, point.z, 'enemy');
  }

  /**
   * Разведка: если у Роя есть свободные бойцы, они идут к ближайшей
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
      && (!u.order || u.order.type === 'move' || u.order.type === 'attackMove' || u.order.type === 'hold')
    ));
    if (!free.length) return;
    // Быстрые юниты справляются с разведкой лучше: они успевают вернуться.
    free.sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0));
    const count = Math.min(free.length, 1 + Math.floor(Math.random() * 2));
    for (let i = 0; i < count; i++) {
      const u = free[i];
      u.issueAttackMove(
        target.x + (Math.random() - 0.5) * 8,
        target.z + (Math.random() - 0.5) * 8,
      );
      u.retaliateTimer = Math.max(u.retaliateTimer ?? 0, 8);
    }
    if (game.elapsed - this.lastScoutNoticeAt > 150) {
      this.lastScoutNoticeAt = game.elapsed;
      game.notify('Разведка противника прощупывает сектор.', 'warn', 'ai-scout', 0, 4);
    }
  }

  /** Свободное место под здание в окрестностях улья. */
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
        const place = this.game.findPlacement(type, x, z);
        if (place.valid) return place;
      }
    }
    return null;
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
    const available = Object.keys(UPGRADES).filter(
      (key) => !game.upgrades.enemy.has(key),
    );
    if (!available.length) return;
    // Иногда Рой откладывает науку в пользу армии — ещё одна вариация.
    if (Math.random() < 0.25) return;
    const key = available[Math.floor(Math.random() * available.length)];
    const def = UPGRADES[key];
    if (!def || this.credits < def.cost + 80) return;
    const lab = labs[Math.floor(Math.random() * labs.length)];
    game.startUpgrade(lab, key);
  }

  // ------------------------------------------------------------- армия
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
    // Рой вкладывается в тяжёлую технику; на старте преобладает пехота.
    const weights = [
      { type: 'marine', weight: 1 },
      { type: 'medic', weight: t > 40 ? 0.4 : 0 },
      { type: 'scout', weight: t > 35 ? 0.8 : 0.25 },
      { type: 'tank', weight: t > 95 ? 0.55 * this.aggression : 0 },
      { type: 'artillery', weight: t > 170 ? 0.4 * this.aggression : 0 },
    ];
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
    // Если под выбранную машину не хватает лимита, Рой добирает пехоту.
    if (used + (def.supply ?? 1) > cap) {
      type = 'marine';
      def = UNITS.marine;
      if (used + def.supply > cap) return;
    }
    if (this.credits < def.cost + 40) return;
    // Пока есть план строительства, армия ждёт: иначе наём съедает
    // кредиты, и база противника никогда не развивается.
    if (this.buildIntent) return;
    if (game.powerFactor('enemy') < 0.9 && Math.random() < 0.35) return;
    this.credits -= def.cost;
    const builder = barracks[Math.floor(Math.random() * barracks.length)];
    builder.enqueue(type);
    this.trainTimer = 3.5 + Math.random() * 2.5;
  }

  defendBase() {
    const hq = this.enemyHq();
    if (!hq) return;
    let intruder = null;
    let bestD = 999;
    for (const e of this.game.entities) {
      if (!e.alive || e.faction !== 'player' || e.isBuilding) continue;
      if (!this.game.isEntityVisibleTo('enemy', e)) continue;
      const d = dist(e.position.x, e.position.z, hq.position.x, hq.position.z);
      if (d < 32 && d < bestD) {
        bestD = d;
        intruder = e;
      }
    }
    if (!intruder) return;
    for (const u of this.game.units) {
      if (!u.alive || u.faction !== 'enemy' || u.def.builder) continue;
      const d = dist(u.position.x, u.position.z, hq.position.x, hq.position.z);
      if (d < 40) {
        if (!u.order || u.order.type === 'move' || u.order.type === 'attackMove') u.issueAttack(intruder);
      }
    }
  }

  /** Защита инженеров: гарнизон отвечает на обстрел строителей и на угрозы рядом. */
  defendEngineers() {
    const game = this.game;
    const threats = [];
    for (const builder of game.units) {
      if (!builder.alive || builder.faction !== 'enemy' || !builder.def.builder) continue;
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
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder && !u.def.healer,
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
      // пары секунд марша, но гарнизон улья всё равно не оголяем полностью.
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

  // ------------------------------------------------------------- оценка сил
  /**
   * Грубая боевая ценность: сколько урона живучий боец успевает нанести.
   * Пехотинец принят примерно за 22, танк — за 70, турель — за 170. Этого
   * достаточно, чтобы сравнивать отряд с обороной, не строя симуляцию боя.
   */
  combatValue(entity) {
    if (!entity?.alive) return 0;
    const def = entity.def ?? {};
    const weapon = def.defense ?? def;
    const dps = (weapon.damage ?? 0) / (weapon.cooldown || 1);
    const hp = entity.hp ?? def.hp ?? 0;
    const armor = entity.armor ?? def.armor ?? 0;
    return (dps * (hp + armor * 20 + 40)) / 100;
  }

  squadPower(units) {
    return units.reduce((sum, u) => sum + this.combatValue(u), 0);
  }

  /**
   * Что ИИ знает об обороне вокруг точки: турели — по разведке (они не
   * двигаются, их помнят), войска — только по текущему обзору. В тумане
   * гарнизон для Роя не существует, и придумывать его он не должен.
   */
  defenseAt(point) {
    let value = 0;
    for (const b of this.game.buildings) {
      if (!b.alive || b.faction !== 'player') continue;
      const known = b.type === 'turret'
        ? this.game.isExploredBy('enemy', b.position.x, b.position.z)
        : this.game.isEntityVisibleTo('enemy', b);
      if (!known) continue;
      if (dist(point.x, point.z, b.position.x, b.position.z) > AI.defenseRadius + b.radius) continue;
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
    this.debugLog(
      `волна №${record.index} (${tactic}): ${squad.length} юнитов, `
      + `${record.supplySent} снабж. → ${record.targetType}`,
    );
    return record;
  }

  /** Закрывает активную волну, как только её судьба определилась. */
  updateWaveMemory() {
    const record = this.activeWave;
    if (!record) return;
    if (!record.units.some(({ unit }) => unit.alive)) {
      this.finishWave(record, 'wiped');
      return;
    }
    if (this.game.elapsed - record.sentAt >= AI.waveTimeout) {
      this.finishWave(record, 'timeout');
    }
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
    this.debugLog(
      `волна №${record.index} ${record.state}: живых ${record.alive}/${record.units.length}, `
      + `потери ${record.supplyLost} снабж., урон ${Math.round(record.damage)}, `
      + `убито ${record.kills}, причина ${record.cause}`,
    );
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

  // ------------------------------------------------------------- волны
  /** Точка рядом с целью: один и тот же приказ не выглядит как копия. */
  pointNear(position, spread) {
    return {
      x: clamp(position.x + (Math.random() - 0.5) * spread * 2, -MAP.clamp, MAP.clamp),
      z: clamp(position.z + (Math.random() - 0.5) * spread * 2, -MAP.clamp, MAP.clamp),
    };
  }

  /** Выбирает цель рейда: вышки и электростанции вкуснее казарм. */
  pickRaidTarget(buildings) {
    const candidates = buildings.filter((b) => (
      b.alive
      && b.type !== 'hq'
      // Рейд идёт по разведанным постройкам: того, чего Рой не видел,
      // он просто не знает.
      && this.game.isExploredBy('enemy', b.position.x, b.position.z)
    ));
    if (!candidates.length) return null;
    const derricks = candidates.filter((b) => b.type === 'derrick');
    const pool = derricks.length && Math.random() < 0.7 ? derricks : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  updateWave(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;

    const combat = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder,
    );
    if (combat.length < 2) {
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
    const raidTarget = tactic === 'raid' || tactic === 'split'
      ? this.pickRaidTarget(playerBuildings)
      : null;
    if (!raidTarget && tactic !== 'assault' && tactic !== 'probe') tactic = 'assault';

    const primaryTarget = tactic === 'raid' && raidTarget ? raidTarget : playerHQ;
    const primary = tactic === 'raid' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : this.pointNear(playerHQ.position, 9);
    const secondary = tactic === 'split' && raidTarget
      ? this.pointNear(raidTarget.position, 5)
      : null;

    // В атаку идёт ограниченный отряд: остальные остаются охранять улей.
    // Резерв и размер отряда тоже меняются от волны к волне.
    const reserve = Math.min(3, Math.max(1, Math.floor(combat.length * 0.25)));
    const available = Math.max(1, combat.length - reserve);
    let wanted = Math.round((3 + this.waveIndex * 1.7) * this.aggression)
      + Math.floor(Math.random() * 3) - 1;
    if (tactic === 'probe') wanted = Math.min(wanted, 2 + Math.floor(Math.random() * 2));

    // Разведка боем идёт налегке, остальные волны — только если отряд
    // способен пробить то, что Рой знает об обороне цели.
    const defense = this.defenseAt(primaryTarget.position);
    const needed = tactic === 'probe'
      ? 0
      : this.neededSquad(combat, defense * AI.requiredAdvantage);
    if (needed > combat.length) {
      this.waveTimer = AI.regroupDelay * (0.8 + Math.random() * 0.6);
      this.debugLog(
        `волна отложена: оборона ${Math.round(defense)}, армия `
        + `${Math.round(this.squadPower(combat))}`,
      );
      return;
    }

    // Провал больше не повторяется тем же числом: отряд растёт.
    const recentWipes = this.waveLog.filter((w) => (
      w.state === 'wiped' && this.game.elapsed - w.endedAt < AI.waveTimeout * 2
    )).length;
    const minSquad = tactic === 'probe'
      ? 1
      : AI.minWaveSquad + recentWipes * AI.wipeSquadBonus;

    let squadSize = Math.max(wanted, minSquad, needed);
    // Если иначе не пробить — снимаем резерв с базы, но не оголяем её без нужды.
    squadSize = needed > available
      ? Math.min(combat.length, squadSize)
      : Math.min(available, squadSize);
    squadSize = Math.max(1, Math.min(combat.length, squadSize));
    const squad = shuffle(combat.slice(), Math.random).slice(0, squadSize);

    squad.forEach((u, i) => {
      const point = secondary && i % 2 === 0 ? secondary : primary;
      u.issueAttackMove(
        point.x + (Math.random() - 0.5) * 4,
        point.z + (Math.random() - 0.5) * 4,
      );
    });
    this.beginWave({ tactic, squad, point: primary, targetEntity: primaryTarget });

    this.waveIndex++;
    this.waveTimer = AI.waveInterval * (0.8 + Math.random() * 0.45);
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
