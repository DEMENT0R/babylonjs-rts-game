// Простой противник: экономика, инженеры, застройка, ремонт и волны атак.

import { Vector3 } from './babylon.js';
import { AI, BUILDINGS, MAP, UNITS } from './config.js';
import { dist, TAU } from './utils.js';

export class AIController {
  constructor(game) {
    this.game = game;
    this.credits = AI.credits;
    this.waveTimer = AI.firstWave;
    this.waveIndex = 0;
    this.rally = this.baseRally();
    this.defenseTimer = 0;
    this.trainTimer = 2;
    this.lastWaveAt = -999;
    this.targetPoint = null;
    this.buildTimer = 5;
    this.repairTimer = 9;
    this.assignTimer = 7;
    this.buildIntent = null;
    this.buildCount = 0;
    this.lastBuildNoticeAt = -999;

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
    this.assignTimer -= dt;

    if (this.defenseTimer <= 0) {
      this.defenseTimer = 1.5;
      this.defendBase();
    }

    if (this.buildTimer <= 0) {
      this.buildTimer = 2.5;
      this.planBase();
    }

    if (this.assignTimer <= 0) {
      this.assignTimer = 5;
      this.ensureBuildersOnSites();
    }

    if (this.repairTimer <= 0) {
      this.repairTimer = 6;
      this.updateRepairs();
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
    const buildings = game.buildings.filter((b) => b.alive && b.faction === 'enemy').length;
    const power = game.power.enemy;
    const freePatch = this.findFreePatch(game.elapsed > 180 ? 115 : 72);

    let type = null;
    if (barracks === 0) type = 'barracks';
    else if (power.used >= power.produced) type = 'power';
    else if (freePatch) type = 'derrick';
    else if (barracks < 2 && game.elapsed > 135) type = 'barracks';
    else if (power.produced - power.used < 8) type = 'power';
    else if (game.elapsed > 240 && buildings < 16 && this.credits > 520) {
      type = Math.random() < 0.5 ? 'power' : 'barracks';
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
        const angle = (i / steps) * TAU + ring * 0.37;
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

  // ------------------------------------------------------------- армия
  tryTrain() {
    const game = this.game;
    if (game.countUnits('enemy') >= AI.armyCap) return;
    const barracks = game.buildings.filter(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'barracks'
        && b.complete && b.queue.length === 0,
    );
    if (!barracks.length) return;

    const t = game.elapsed;
    let type = 'marine';
    const roll = Math.random();
    if (t > 200 && roll < 0.2) type = 'artillery';
    else if (t > 140 && roll < 0.42) type = 'tank';
    else if (roll < 0.6) type = 'scout';

    const def = UNITS[type];
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

  // ------------------------------------------------------------- волны
  updateWave(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;

    const combat = this.game.units.filter(
      (u) => u.alive && u.faction === 'enemy' && !u.def.builder,
    );
    if (combat.length < 2) {
      this.waveTimer = 12;
      return;
    }

    const playerHQ = this.game.entities.find(
      (e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq',
    );
    if (!playerHQ) {
      this.waveTimer = 20;
      return;
    }

    // В атаку идёт ограниченный отряд: остальные остаются охранять улей.
    const squadSize = Math.min(combat.length, 4 + this.waveIndex * 2);
    const squad = combat
      .slice()
      .sort((a, b) => (a.position.x - b.position.x) || (a.position.z - b.position.z))
      .slice(0, squadSize);
    for (const u of squad) {
      u.issueAttackMove(
        playerHQ.position.x + (Math.random() - 0.5) * 10,
        playerHQ.position.z + (Math.random() - 0.5) * 10,
      );
    }
    this.waveIndex++;
    this.waveTimer = AI.waveInterval + Math.random() * 12;
    this.lastWaveAt = this.game.elapsed;

    const msg = this.waveIndex === 1
      ? 'Противник начал наступление на нашу базу!'
      : `Волна противника №${this.waveIndex} приближается!`;
    this.game.notify(msg, 'danger', `wave_${this.waveIndex}`, 0, 6);
    if (this.game.ui) {
      this.game.ui.alert();
      this.game.ui.ping(playerHQ.position.x, playerHQ.position.z, '#ff4b3e');
    }
    this.rally = this.baseRally();
  }
}
