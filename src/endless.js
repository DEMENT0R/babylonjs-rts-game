// Бесконечный режим: волны приходят от «автозаводов» за периметром, а не из
// экономики ИИ. Поэтому снос казарм и базы противника не останавливает
// наступление: директор призывает юнитов напрямую на краю карты.

import { MAP } from './config.js';
import { clamp } from './utils.js';

const TAU = Math.PI * 2;

// Состав волны растёт ступенями: от двух пехотинцев до тяжёлой группы.
// Таблица задаёт базу, дальше директор добавляет подкрепление за каждые
// несколько волн, чтобы давление не выходило на плато.
const WAVE_TABLE = [
  { from: 1, units: ['marine', 'marine'] },
  { from: 3, units: ['marine', 'marine', 'marine', 'scout'] },
  { from: 5, units: ['marine', 'marine', 'scout', 'scout', 'tank'] },
  { from: 8, units: ['marine', 'marine', 'marine', 'scout', 'tank', 'tank'] },
  { from: 12, units: ['marine', 'marine', 'marine', 'scout', 'tank', 'tank', 'artillery'] },
  { from: 16, units: ['marine', 'marine', 'marine', 'marine', 'scout', 'tank', 'tank', 'artillery', 'medic'] },
];

const DEFAULTS = {
  firstWave: 45,
  interval: 45,
  decay: 0.93,
  minInterval: 15,
  maxUnits: 18,
};

// Сюжетные перехваты по времени: голос с той стороны всё чаще говорит
// приказами «Беты», а к финалу перестаёт различать оригинал и копию.
const MILESTONES = [
  { at: 120, text: 'Радиоперехват: «Дублёр подтверждает существование. Задача — стирание».' },
  { at: 300, text: 'Радиоперехват: «Оригинал требует удаления копии».' },
  { at: 600, text: 'Радиоперехват: «Сектор объявлен чистым. Копия ещё отвечает».' },
  { at: 900, text: 'Радиоперехват: «Связь с реестром потеряна. Обе колонии — „Гелиос-7“».' },
];

export class WaveDirector {
  constructor(game, options = {}) {
    this.game = game;
    this.options = { ...DEFAULTS, ...options };
    this.waveIndex = 0;
    this.graceWaves = 0;
    this.timer = this.options.firstWave;
    this.nextWaveIn = this.timer;
    this.limit = (game.map.bounds?.half ?? MAP.half) - 8;
    this.gates = this.findGates();
    this.milestoneIndex = 0;
  }

  update(dt) {
    if (this.game.over) return;
    this.updateMilestones();
    this.timer -= dt;
    this.nextWaveIn = Math.max(0, this.timer);
    if (this.timer > 0) return;
    this.sendWave();
  }

  /** Реплики-перехваты приходят по времени и не повторяются. */
  updateMilestones() {
    while (this.milestoneIndex < MILESTONES.length
      && this.game.elapsed >= MILESTONES[this.milestoneIndex].at) {
      const milestone = MILESTONES[this.milestoneIndex++];
      this.game.notify(milestone.text, 'warn', `endless-radio-${this.milestoneIndex}`, 0, 9);
    }
  }

  /** Интервал ужимается с номером волны до пола, чтобы темп не сорвался. */
  interval() {
    const { interval, decay, minInterval } = this.options;
    const value = Math.max(minInterval, interval * Math.pow(decay, this.waveIndex));
    return value * (0.9 + Math.random() * 0.2);
  }

  composition() {
    const number = this.waveIndex + 1;
    const base = [...WAVE_TABLE.filter((step) => number >= step.from).at(-1).units];
    const extra = Math.min(8, Math.floor((number - 1) / 4));
    for (let i = 0; i < extra; i++) base.push(i % 2 ? 'tank' : 'marine');
    return base.slice(0, this.options.maxUnits);
  }

  sendWave() {
    const target = this.game.map.spawn.player.hq;
    const units = this.composition();
    // Снос базы «Беты» в секторе не останавливает автозаводы, но на две
    // волны даёт передышку: реже и меньше подкреплений.
    const baseAlive = this.hasBase();
    if (this.baseAlive === undefined) this.baseAlive = baseAlive;
    if (this.baseAlive && !baseAlive) this.graceWaves = 2;
    this.baseAlive = baseAlive;
    const grace = this.graceWaves > 0;
    if (grace) {
      this.graceWaves--;
      units.splice(Math.max(0, units.length - 2));
    }
    for (const [index, type] of units.entries()) {
      const gate = this.gates[(this.waveIndex + index) % this.gates.length];
      const spot = this.freeSpot(
        gate.x + (Math.random() - 0.5) * 4,
        gate.z + (Math.random() - 0.5) * 4,
      );
      const unit = this.game.spawnUnit('enemy', type, spot.x, spot.z, { silent: true });
      const point = {
        x: target.x + (Math.random() - 0.5) * 6,
        z: target.z + (Math.random() - 0.5) * 6,
      };
      // Поддержка идёт следом, бойцы — на штурм штаба.
      if (unit.canFight) unit.issueAttackMove(point.x, point.z);
      else unit.issueEscort(point.x, point.z);
    }

    this.waveIndex++;
    this.game.stats.waves = this.waveIndex;
    this.timer = this.interval() * (grace ? 1.5 : 1);
    this.nextWaveIn = this.timer;

    const first = this.waveIndex === 1;
    this.game.notify(
      first
        ? 'Автозаводы «Беты» активированы: в сектор идёт первая волна.'
        : `Волна ${this.waveIndex}: автозаводы выводят новое подразделение.`,
      'danger',
      `endless-wave-${this.waveIndex}`,
      0,
      6,
    );
    this.game.ui?.alert?.();
    this.game.ui?.ping?.(target.x, target.z, '#ff4b3e');
  }

  /** Жив ли штаб «Беты» в секторе. Автозаводы от него не зависят. */
  hasBase() {
    return this.game.buildings.some(
      (b) => b.alive && b.faction === 'enemy' && b.type === 'hq',
    );
  }

  /** Точки появления за базой противника: три «конвейера» у края карты. */
  findGates() {
    const player = this.game.map.spawn.player.hq;
    const enemy = this.game.map.spawn.enemy.hq;
    const dx = enemy.x - player.x;
    const dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const gates = [];
    for (const side of [-1, 0, 1]) {
      const x = clamp(enemy.x + ux * 18 + px * side * 18, -this.limit, this.limit);
      const z = clamp(enemy.z + uz * 18 + pz * side * 18, -this.limit, this.limit);
      gates.push(this.freeSpot(x, z));
    }
    return gates;
  }

  /** Ближайшая свободная точка: спавн не должен попасть в скалу или стену. */
  freeSpot(x, z) {
    const { game } = this;
    if (game.isPositionFree(x, z, 1.2)) return { x, z };
    for (let ring = 1; ring < 10; ring++) {
      const radius = ring * 2.2;
      for (let step = 0; step < 14; step++) {
        const angle = (step / 14) * TAU + ring * 0.4;
        const sx = clamp(x + Math.cos(angle) * radius, -this.limit, this.limit);
        const sz = clamp(z + Math.sin(angle) * radius, -this.limit, this.limit);
        if (game.isPositionFree(sx, sz, 1.2)) return { x: sx, z: sz };
      }
    }
    return { x, z };
  }
}
