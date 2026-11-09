// Витрина главного экрана: живой бой за меню.
//
// Две группы войск сходятся в центре карты, дерутся и получают подкрепления,
// а камера плавно летает над схваткой. Игрок ничем не управляет: партия ещё
// не началась, поэтому туман выключен, ИИ и экономика не работают, а гибель
// демонстрационных юнитов не попадает в статистику.

import { MAP } from './config.js';
import { findFreeSpot } from './world.js';
import { angleDiff, clamp, damp, dist } from './utils.js';

// Сколько бойцов держим на каждой стороне и как часто доставляем новых.
const MAX_PER_SIDE = 6;
const SPAWN_INTERVAL = 2.4;
// Через сколько секунд без ввода карточка меню уходит, оставляя один бой.
const IDLE_HIDE = 9;
// Состав волн: пехота, техника и один медик, чтобы в кадре было движение.
const ROSTER = ['marine', 'marine', 'tank', 'medic', 'marine', 'artillery', 'scout'];

// Планы камеры. К каждому параметру камера дотягивается плавно, поэтому
// смена плана выглядит как полёт, а не как склейка кадров.
const SHOTS = [
  { duration: 13, radius: 36, beta: 0.86, angle: 1.4, spin: 0.12, focus: 0.6 },
  { duration: 9, radius: 22, beta: 1.1, angle: 0.3, spin: -0.18, focus: 1.0 },
  { duration: 15, radius: 60, beta: 0.74, angle: 2.3, spin: 0.05, focus: 0.4 },
  { duration: 11, radius: 30, beta: 1.0, angle: -0.6, spin: 0.2, focus: 0.8 },
];

export class AttractMode {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.units = new Set();
    this.active = false;
    this.time = 0;
    this.spawnTimer = 0;
    this.regroupTimer = 0;
    this.shotIndex = 0;
    this.shotTime = 0;
    this.spawnCount = 0;
    this.idle = 0;
    this.idleShown = false;
    this.focusX = 0;
    this.focusZ = 0;
    this.onActivity = () => {
      this.idle = 0;
    };

    // Арена — середина между штабами, ось боя — линия между ними.
    const player = game.map.spawn.player.hq;
    const enemy = game.map.spawn.enemy.hq;
    const dx = enemy.x - player.x;
    const dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    this.center = { x: (player.x + enemy.x) / 2, z: (player.z + enemy.z) / 2 };
    this.axis = { x: dx / len, z: dz / len };
    this.perp = { x: -this.axis.z, z: this.axis.x };
    this.baseAlpha = Math.atan2(this.axis.z, this.axis.x);
    this.focusX = this.center.x;
    this.focusZ = this.center.z;
  }

  start() {
    if (this.active || !this.game.startAttract()) return false;
    this.active = true;
    this.time = 0;
    this.spawnTimer = 0;
    this.regroupTimer = 1;
    this.shotIndex = 0;
    this.shotTime = 0;
    this.idle = 0;
    // В бою игрок не приближается ближе CAMERA.minRadius, а витрине нужен
    // низкий кадр вплотную к схватке.
    this.radiusLimit = this.camera.lowerRadiusLimit;
    this.camera.lowerRadiusLimit = 14;
    document.body.classList.add('attract');
    window.addEventListener('pointermove', this.onActivity, { passive: true });
    window.addEventListener('pointerdown', this.onActivity, { passive: true });
    window.addEventListener('keydown', this.onActivity);
    window.addEventListener('wheel', this.onActivity, { passive: true });
    return true;
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    for (const unit of this.units) {
      unit.alive = false;
      unit.disposeVisual();
      this.game.removeEntity(unit);
    }
    this.units.clear();
    this.game.stopAttract();
    this.camera.lowerRadiusLimit = this.radiusLimit;
    document.body.classList.remove('attract', 'attract-idle');
    this.game.ui?.el?.overlay?.classList.remove('overlay--attract');
    window.removeEventListener('pointermove', this.onActivity);
    window.removeEventListener('pointerdown', this.onActivity);
    window.removeEventListener('keydown', this.onActivity);
    window.removeEventListener('wheel', this.onActivity);
  }

  update(dt) {
    if (!this.active) return;
    if (this.game.started) {
      this.stop();
      return;
    }
    // Скрытая вкладка не должна жечь кадры на главном экране.
    if (document.hidden) return;
    this.time += dt;
    this.game.updateAttract(dt);
    this.reinforce(dt);
    this.directCamera(dt);
    this.syncMenu(dt);
  }

  // ------------------------------------------------------------- бой
  living() {
    const sides = { player: [], enemy: [] };
    for (const unit of this.units) {
      if (unit.alive) sides[unit.faction].push(unit);
    }
    return sides;
  }

  reinforce(dt) {
    const sides = this.living();
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      const empty = sides.player.length === 0 || sides.enemy.length === 0;
      this.spawnTimer = empty ? 1.2 : SPAWN_INTERVAL;
      for (const faction of ['player', 'enemy']) {
        const count = sides[faction].length;
        if (count < MAX_PER_SIDE || (empty && count === 0)) this.spawn(faction);
      }
    }

    // Застрявших и оставшихся без цели разворачиваем к центру схватки,
    // иначе бой расползается по карте и камера смотрит на пустое поле.
    this.regroupTimer -= dt;
    if (this.regroupTimer > 0) return;
    this.regroupTimer = 4;
    for (const unit of this.units) {
      if (!unit.alive || unit.target?.alive) continue;
      const far = dist(unit.position.x, unit.position.z, this.center.x, this.center.z) > 70;
      if (far || !unit.order) this.sendForward(unit);
    }
  }

  spawn(faction) {
    const type = ROSTER[this.spawnCount++ % ROSTER.length];
    const dir = faction === 'player' ? -1 : 1;
    const along = dir * (26 + Math.random() * 8);
    const side = (Math.random() * 2 - 1) * 9;
    const x = clamp(
      this.center.x + this.axis.x * along + this.perp.x * side,
      -MAP.clamp + 6,
      MAP.clamp - 6,
    );
    const z = clamp(
      this.center.z + this.axis.z * along + this.perp.z * side,
      -MAP.clamp + 6,
      MAP.clamp - 6,
    );
    const spot = findFreeSpot(this.game, x, z, 1.2, Math.random() * Math.PI * 2);
    const unit = this.game.spawnUnit(faction, type, spot.x, spot.z);
    this.units.add(unit);
    this.sendForward(unit);
    return unit;
  }

  sendForward(unit) {
    const dir = unit.faction === 'player' ? 1 : -1;
    unit.issueAttackMove(
      this.center.x + this.axis.x * dir * 6,
      this.center.z + this.axis.z * dir * 6,
    );
  }

  // ------------------------------------------------------------- камера
  /** Самая плотная схватка: середина боя, где рядом больше всего бойцов. */
  hotspot() {
    const units = [];
    for (const unit of this.units) {
      if (unit.alive) units.push(unit);
    }
    let best = null;
    let bestScore = 0;
    for (const unit of units) {
      if (!unit.target?.alive) continue;
      const x = (unit.position.x + unit.target.position.x) / 2;
      const z = (unit.position.z + unit.target.position.z) / 2;
      let score = 0;
      for (const other of units) {
        if (dist(other.position.x, other.position.z, x, z) < 18) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, z };
      }
    }
    if (best) return best;

    // Схватки пока нет — смотрим на середину между армиями или на центр арены.
    const sides = this.living();
    const middle = (list) => (list.length
      ? {
        x: list.reduce((sum, unit) => sum + unit.position.x, 0) / list.length,
        z: list.reduce((sum, unit) => sum + unit.position.z, 0) / list.length,
      }
      : null);
    const player = middle(sides.player);
    const enemy = middle(sides.enemy);
    if (player && enemy) {
      return { x: (player.x + enemy.x) / 2, z: (player.z + enemy.z) / 2 };
    }
    return { x: this.center.x, z: this.center.z };
  }

  directCamera(dt) {
    this.shotTime += dt;
    let shot = SHOTS[this.shotIndex];
    if (this.shotTime >= shot.duration) {
      this.shotTime = 0;
      this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
      shot = SHOTS[this.shotIndex];
    }

    const focus = this.hotspot();
    this.focusX = clamp(damp(this.focusX, focus.x, 0.8, dt), -MAP.clamp, MAP.clamp);
    this.focusZ = clamp(damp(this.focusZ, focus.z, 0.8, dt), -MAP.clamp, MAP.clamp);

    const alphaGoal = this.baseAlpha + shot.angle + shot.spin * this.shotTime;
    this.camera.alpha += angleDiff(this.camera.alpha, alphaGoal) * (1 - Math.exp(-1.1 * dt));
    this.camera.beta = damp(this.camera.beta, shot.beta, 0.9, dt);
    const breathe = 1 + Math.sin(this.time * 0.23) * 0.05;
    this.camera.radius = damp(this.camera.radius, shot.radius * breathe, 0.9, dt);
    this.camera.target.x = damp(this.camera.target.x, this.focusX, shot.focus, dt);
    this.camera.target.z = damp(this.camera.target.z, this.focusZ, shot.focus, dt);
    this.camera.target.y = damp(this.camera.target.y, 0, 2, dt);
  }

  // ------------------------------------------------------------- меню
  /**
   * Главное меню — полупрозрачная панель поверх боя. Если игрок ничего не
   * делает, панель уходит и остаётся только поле боя; любой ввод возвращает её.
   * Панель трогаем только на стартовом экране: в лобби и настройках она нужна.
   */
  syncMenu(dt) {
    const ui = this.game.ui;
    const overlay = ui?.el?.overlay;
    const card = ui?.el?.overlayCard;
    if (!overlay || !card) return;

    const startScreen = ui.overlayOpen && card.classList.contains('overlay--start');
    overlay.classList.toggle('overlay--attract', startScreen);
    if (!startScreen) {
      this.idle = 0;
      if (this.idleShown) {
        this.idleShown = false;
        document.body.classList.remove('attract-idle');
      }
      return;
    }

    this.idle += dt;
    const shown = this.idle > IDLE_HIDE;
    if (shown === this.idleShown) return;
    this.idleShown = shown;
    document.body.classList.toggle('attract-idle', shown);
  }
}
