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
    this.buildIntent = null;
    this.buildCount = 0;
    this.lastBuildNoticeAt = -999;
    // Характер конкретной партии: влияет на размер волн, состав армии и
    // готовность рисковать. Благодаря этому ИИ не играет одинаково каждый раз.
    this.aggression = 0.75 + Math.random() * 0.55;
    this.buildAngle = Math.random() * TAU;

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

    if (this.trainTimer <= 0) {
      this.trainTimer = 1.0;
      this.tryTrain();
    }

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
    const freePatch = this.findFreePatch(game.elapsed > 180 ? 115 : 72);
    const armyUsed = game.getArmyUsed('enemy') + game.getQueuedSupply('enemy');
    const armyCap = game.getArmyCap('enemy');

    let type = null;
    if (barracks === 0) type = 'barracks';
    else if (power.used >= power.produced) type = 'power';
    else if (armyCap - armyUsed < 6 && depots < 5 && this.credits > BUILDINGS.depot.cost + 30) {
      type = 'depot';
    } else if (turrets === 0 && game.elapsed > 130) {
      // Первую турель Рой копит целенаправленно: армия на время замирает.
      type = 'turret';
    } else if (game.elapsed > 110 && turrets < (game.elapsed > 220 ? 3 : 2)
      && this.credits > BUILDINGS.turret.cost + 80) {
      type = 'turret';
    } else if (lab === 0 && game.elapsed > 170 && this.credits > 320) type = 'lab';
    else if (freePatch) type = 'derrick';
    else if (barracks < 2 && game.elapsed > 135) type = 'barracks';
    else if (power.produced - power.used < 8) type = 'power';
    else if (game.elapsed > 240 && buildings < 20 && this.credits > 520) {
      const roll = Math.random();
      type = roll < 0.4 ? 'power' : roll < 0.7 ? 'barracks' : roll < 0.85 ? 'depot' : 'turret';
    }

    this.buildIntent = type;
    if (!type) return;
    const def = BUILDINGS[type];
    if (!def || this.credits < def.cost + 30) return;
    this.buildStructure(type);
  }

  buildStructure(type) {
    if (!type || this.credits < BUILDINGS[type].cost) return false;
    const spot = type === 'derrick'
      ? this.findFreePatch(this.game.elapsed > 180 ? 115 : 72)
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

  findFreePatch(range) {
    const hq = this.enemyHq();
    if (!hq) return null;
    return this.game.findOilPatch(hq.position.x, hq.position.z, range);
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
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder,
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
    const candidates = buildings.filter((b) => b.alive && b.type !== 'hq');
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
    const squadSize = Math.max(1, Math.min(available, wanted));
    const squad = shuffle(combat.slice(), Math.random).slice(0, squadSize);

    squad.forEach((u, i) => {
      const point = secondary && i % 2 === 0 ? secondary : primary;
      u.issueAttackMove(
        point.x + (Math.random() - 0.5) * 4,
        point.z + (Math.random() - 0.5) * 4,
      );
    });

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
