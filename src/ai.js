// Простой противник: экономика, наём и волны атак.

import { Vector3 } from './babylon.js';
import { AI, UNITS } from './config.js';
import { dist } from './utils.js';

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

    const barracks = game.buildings.find((b) => b.faction === 'enemy' && b.type === 'barracks');
    if (barracks) {
      barracks.rally = this.rally.clone();
      this.barracks = barracks;
    }
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

    if (this.defenseTimer <= 0) {
      this.defenseTimer = 1.5;
      this.defendBase();
    }

    if (this.trainTimer <= 0) {
      this.trainTimer = 1.0;
      this.tryTrain();
    }

    this.updateWave(dt);
  }

  tryTrain() {
    const barracks = this.game.buildings.find((b) => b.alive && b.faction === 'enemy' && b.type === 'barracks' && b.complete);
    if (!barracks) return;
    if (barracks.queue.length > 0) return;
    if (this.game.countUnits('enemy') >= AI.armyCap) return;

    const t = this.game.elapsed;
    let type = 'marine';
    const roll = Math.random();
    if (t > 140 && roll < 0.26) type = 'tank';
    else if (roll < 0.44) type = 'scout';

    const def = UNITS[type];
    if (this.credits < def.cost) return;
    if (this.game.powerFactor('enemy') < 0.9 && Math.random() < 0.35) return;
    this.credits -= def.cost;
    barracks.enqueue(type);
    this.trainTimer = 3.5 + Math.random() * 2.5;
  }

  defendBase() {
    const hq = this.game.entities.find((e) => e.alive && e.faction === 'enemy' && e.isBuilding && e.type === 'hq');
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
      if (!u.alive || u.faction !== 'enemy') continue;
      const d = dist(u.position.x, u.position.z, hq.position.x, hq.position.z);
      if (d < 40) {
        if (!u.order || u.order.type === 'move' || u.order.type === 'attackMove') u.issueAttack(intruder);
      }
    }
  }

  updateWave(dt) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;

    const combat = this.game.units.filter((u) => u.alive && u.faction === 'enemy');
    if (combat.length < 2) {
      this.waveTimer = 12;
      return;
    }

    const playerHQ = this.game.entities.find((e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq');
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
      u.issueAttackMove(playerHQ.position.x + (Math.random() - 0.5) * 10, playerHQ.position.z + (Math.random() - 0.5) * 10);
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
