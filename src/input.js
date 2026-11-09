// Управление: камера, выбор, приказы и строительство.

import {
  Vector3,
  Matrix,
  MeshBuilder,
} from './babylon.js';
import { BUILDINGS, CAMERA, MAP } from './config.js';
import { clamp, damp, dist } from './utils.js';

const NEUTRAL_GHOST = '#4fd2ff';

// Двойной клик и двойной тап: окно между касаниями и допуск по расстоянию.
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DIST = 48;
// Палец дрожит сильнее мыши, поэтому тап на сенсорном экране «прощает»
// большее смещение — иначе он превращается в рамку и выбор не срабатывает.
const TOUCH_TAP_SLOP = 12;
const MOUSE_TAP_SLOP = 5;
// Двумя пальцами рамка растягивается от средней точки касания.
const TOUCH_BOX_SLOP = 10;

export class Input {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.camera = game.camera;
    this.canvas = this.scene.getEngine().getRenderingCanvas();
    this.selectBoxEl = document.querySelector('#selectBox');
    this.placeHintEl = document.querySelector('#placeHint');
    this.pointer = { x: 0, y: 0, has: false };
    this.keys = new Set();
    this.nearBeta = this.camera.beta;
    this.desired = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
    this.drag = null;
    this.middleDrag = null;
    this.attackMode = false;
    this.patrolMode = false;
    this.placement = null;
    this.lastTap = { time: 0, type: null, x: 0, y: 0 };
    this.lastGroupTap = { index: 0, time: 0 };
    this.groundY = 0;
    this.isTouch = Boolean(
      globalThis.matchMedia?.('(pointer: coarse)')?.matches
      || (navigator.maxTouchPoints ?? 0) > 0,
    );
    this.activePointers = new Map();
    this.touchGesture = null;
    this.suppressTouchTap = false;
    this.touchState = {
      up: false, down: false, left: false, right: false,
      zoomin: false, zoomout: false, rotl: false, rotr: false,
    };
    if (this.isTouch) document.body.classList.add('is-touch');

    game.input = this;
    this.bind();
    this.bindTouchControls();
    this.setCameraImmediate();
  }

  setCameraImmediate() {
    this.camera.alpha = this.desired.alpha;
    this.camera.beta = this.desired.beta;
    this.camera.radius = this.desired.radius;
    this.camera.target.copyFrom(this.desired.target);
  }

  bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.middleDrag = null;
      this.drag = null;
      this.activePointers.clear();
      this.touchGesture = null;
      this.suppressTouchTap = false;
      this.hideSelectBox();
      this.resetTouchControls?.();
    });
  }

  /** Экранные кнопки камеры и отмены режима для сенсорных устройств. */
  bindTouchControls() {
    const root = document.querySelector('#touch-controls');
    if (!root) return;
    this.touchRoot = root;
    const clear = () => {
      let active = false;
      for (const key of Object.keys(this.touchState)) {
        if (this.touchState[key]) active = true;
        this.touchState[key] = false;
      }
      if (!active && !root.querySelector('.is-active')) return;
      root.querySelectorAll('.is-active').forEach((node) => node.classList.remove('is-active'));
    };
    this.resetTouchControls = clear;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerup', clear);
    root.addEventListener('pointercancel', clear);
    root.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-touch]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.touch;
      if (action === 'base') {
        this.focusBase();
        this.game.notify('Камера возвращена к базе.', 'hint', 'touch-base', 4, 2);
        return;
      }
      if (action === 'cancel') {
        if (this.placement) this.cancelPlacement();
        else if (this.attackMode) this.setAttackMove(false);
        else if (this.patrolMode) this.setPatrol(false);
        return;
      }
      if (action === 'deselect') {
        this.game.clearSelection();
        return;
      }
      if (action === 'rotpl' || action === 'rotpr') {
        this.rotatePlacement(action === 'rotpr' ? 1 : -1);
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(this.touchState, action)) return;
      this.touchState[action] = true;
      btn.classList.add('is-active');
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const release = () => {
        this.touchState[action] = false;
        btn.classList.remove('is-active');
        btn.removeEventListener('pointerup', release);
        btn.removeEventListener('pointercancel', release);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
    });
    window.addEventListener('blur', clear);
  }

  // ------------------------------------------------------------- math helpers
  screenRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    // Babylon ждёт координаты в CSS-пикселях холста: масштаб рендера он
    // учитывает сам. Если заранее пересчитать их в пиксели буфера, при
    // разрешении рендера ниже 100% луч уезжает к верхнему левому углу.
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
  }

  groundPoint(clientX, clientY) {
    const ray = this.screenRay(clientX, clientY);
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0 || t > 2000) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  pick(clientX, clientY) {
    const ray = this.screenRay(clientX, clientY);
    const info = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable && mesh.isEnabled());
    if (!info?.hit || !info.pickedMesh) return { entity: null, ghost: null, oil: null, point: null };
    const meta = info.pickedMesh.metadata;
    return {
      entity: meta?.entity ?? null,
      ghost: meta?.ghost ?? null,
      oil: meta?.oilPatch ?? null,
      point: info.pickedPoint,
      mesh: info.pickedMesh,
    };
  }

  project(x, y, z) {
    const engine = this.scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const p = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(w, h),
    );
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + (p.x / w) * rect.width,
      y: rect.top + (p.y / h) * rect.height,
    };
  }

  cameraBasis() {
    const forward = new Vector3(
      this.camera.target.x - this.camera.position.x,
      0,
      this.camera.target.z - this.camera.position.z,
    );
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    // Babylon использует левостороннюю систему координат, поэтому «право» —
    // это Up × forward, а не forward × Up.
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    return { forward, right };
  }

  showSelectBox(x0, y0, x1, y1) {
    if (!this.selectBoxEl) return;
    this.selectBoxEl.style.display = 'block';
    this.selectBoxEl.style.left = `${Math.min(x0, x1)}px`;
    this.selectBoxEl.style.top = `${Math.min(y0, y1)}px`;
    this.selectBoxEl.style.width = `${Math.abs(x1 - x0)}px`;
    this.selectBoxEl.style.height = `${Math.abs(y1 - y0)}px`;
  }

  hideSelectBox() {
    if (this.selectBoxEl) this.selectBoxEl.style.display = 'none';
  }

  releasePointer(e) {
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  }

  /** Сдвиг камеры вслед за пальцем или зажатой средней кнопкой мыши. */
  panCamera(dx, dy) {
    const { forward, right } = this.cameraBasis();
    const k = this.camera.radius * 0.0018;
    this.desired.target.x += (-right.x * dx + forward.x * dy) * k;
    this.desired.target.z += (-right.z * dx + forward.z * dy) * k;
    this.clampTarget();
  }

  focusOn(x, z) {
    this.desired.target.x = clamp(x, -MAP.clamp - 2, MAP.clamp + 2);
    this.desired.target.z = clamp(z, -MAP.clamp - 2, MAP.clamp + 2);
  }

  focusBase() {
    const hq = this.game.entities.find((e) => e.alive && e.faction === 'player' && e.isBuilding && e.type === 'hq');
    if (hq) {
      this.focusOn(hq.position.x, hq.position.z);
      this.desired.radius = Math.min(this.desired.radius, 56);
    }
  }

  // ------------------------------------------------------------- pointer
  onPointerDown(e) {
    if (!this.game.started || this.game.paused || this.game.over) return;
    if (this.game.ui?.overlayOpen) return;
    document.activeElement?.blur?.();
    this.pointer = { x: e.clientX, y: e.clientY, has: true };

    if (e.pointerType === 'touch') {
      this.onTouchDown(e);
      return;
    }

    if (e.button === 1) {
      e.preventDefault();
      this.middleDrag = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      return;
    }

    if (e.button === 2) {
      this.onRightClick(e);
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();

    if (this.placement) {
      this.tryPlaceAt(e.clientX, e.clientY, e.shiftKey);
      return;
    }

    if (this.attackMode) {
      const point = this.groundPoint(e.clientX, e.clientY);
      if (point) {
        this.game.commandAttackMove(new Vector3(point.x, 0, point.z));
        this.setAttackMove(false);
      }
      return;
    }

    if (this.patrolMode) {
      const point = this.groundPoint(e.clientX, e.clientY);
      if (point) {
        this.game.commandPatrol(new Vector3(point.x, 0, point.z));
        this.setPatrol(false);
      }
      return;
    }

    this.drag = {
      x0: e.clientX,
      y0: e.clientY,
      x1: e.clientX,
      y1: e.clientY,
      shift: e.shiftKey,
      moved: false,
    };
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  }

  onPointerMove(e) {
    this.pointer = { x: e.clientX, y: e.clientY, has: true };

    if (e.pointerType === 'touch') {
      const tracked = this.activePointers.get(e.pointerId);
      if (tracked) {
        tracked.x = e.clientX;
        tracked.y = e.clientY;
        if (!this.suppressTouchTap) this.updateTouchGesture();
      }
      return;
    }

    if (this.middleDrag) {
      const dx = e.clientX - this.middleDrag.x;
      const dy = e.clientY - this.middleDrag.y;
      this.middleDrag = { x: e.clientX, y: e.clientY };
      this.panCamera(dx, dy);
      return;
    }

    if (this.placement) {
      this.updateGhost(e.clientX, e.clientY);
      return;
    }

    if (!this.drag) return;
    this.drag.x1 = e.clientX;
    this.drag.y1 = e.clientY;
    const dx = this.drag.x1 - this.drag.x0;
    const dy = this.drag.y1 - this.drag.y0;
    if (Math.hypot(dx, dy) > MOUSE_TAP_SLOP) {
      this.drag.moved = true;
      this.showSelectBox(this.drag.x0, this.drag.y0, this.drag.x1, this.drag.y1);
    }
  }

  onPointerUp(e) {
    if (e.pointerType === 'touch') {
      this.onTouchUp(e);
      return;
    }

    if (this.middleDrag) {
      this.middleDrag = null;
      this.releasePointer(e);
      return;
    }
    if (!this.drag) {
      this.releasePointer(e);
      return;
    }

    const drag = this.drag;
    this.drag = null;
    this.hideSelectBox();
    this.releasePointer(e);

    if (drag.moved) {
      this.selectInBox(drag, drag.shift);
      return;
    }
    this.handleClick(e.clientX, e.clientY, drag.shift);
  }

  onPointerCancel(e) {
    this.releasePointer(e);
    if (e.pointerType === 'touch') {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size === 0) this.suppressTouchTap = false;
      this.touchGesture = null;
    } else {
      this.drag = null;
      this.middleDrag = null;
    }
    this.hideSelectBox();
  }

  // ------------------------------------------------------------- touch
  /**
   * Касания: один палец — тап или панорама, два пальца — рамка выделения.
   * Щипок двумя пальцами по-прежнему меняет зум и не мешает рамке: рамка
   * растягивается от средней точки касания, а расстояние между пальцами
   * управляет приближением.
   */
  onTouchDown(e) {
    e.preventDefault();

    // Размещение здания и attack-move срабатывают сразу по касанию.
    if (this.placement) {
      this.tryPlaceAt(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (this.attackMode) {
      const point = this.groundPoint(e.clientX, e.clientY);
      if (point) {
        this.game.commandAttackMove(new Vector3(point.x, 0, point.z));
        this.setAttackMove(false);
      }
      return;
    }
    if (this.patrolMode) {
      const point = this.groundPoint(e.clientX, e.clientY);
      if (point) {
        this.game.commandPatrol(new Vector3(point.x, 0, point.z));
        this.setPatrol(false);
      }
      return;
    }

    this.activePointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }

    if (this.suppressTouchTap) {
      this.touchGesture = null;
      return;
    }

    if (this.activePointers.size === 1) {
      this.touchGesture = {
        mode: 'single',
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        additive: e.shiftKey,
      };
      return;
    }

    if (this.activePointers.size === 2) this.beginTouchBox();
  }

  updateTouchGesture() {
    const gesture = this.touchGesture;
    if (!gesture) return;
    const points = [...this.activePointers.values()];

    if (points.length < 2) {
      this.updateTouchPan(points[0]);
      return;
    }

    if (gesture.mode === 'box') this.updateTouchBox(points[0], points[1]);
  }

  /** Один палец: небольшое смещение — тап, дальше — панорама камеры. */
  updateTouchPan(point) {
    const gesture = this.touchGesture;
    if (!gesture || !point) return;
    if (gesture.mode === 'single') {
      if (Math.hypot(point.x - gesture.startX, point.y - gesture.startY) <= TOUCH_TAP_SLOP) {
        return;
      }
      gesture.mode = 'pan';
      this.lastTap = { time: 0, type: null, x: 0, y: 0 };
    }
    if (gesture.mode !== 'pan') return;
    const dx = point.x - gesture.lastX;
    const dy = point.y - gesture.lastY;
    gesture.lastX = point.x;
    gesture.lastY = point.y;
    this.panCamera(dx, dy);
  }

  beginTouchBox() {
    if (this.suppressTouchTap) return;
    const points = [...this.activePointers.values()];
    if (points.length < 2) return;
    const a = points[0];
    const b = points[1];
    this.touchGesture = {
      mode: 'box',
      anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      radius: this.desired.radius,
      box: null,
    };
    this.hideSelectBox();
  }

  /** Два пальца: растягивают рамку от точки касания; щипок меняет зум. */
  updateTouchBox(a, b) {
    const gesture = this.touchGesture;
    if (!gesture || gesture.mode !== 'box') return;

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    // Пока пальцы не сдвинулись, щипок просто меняет зум. Как только началась
    // рамка, зум замирает, чтобы выделение не уезжало вместе с камерой.
    if (!gesture.box) {
      if (Math.hypot(midX - gesture.anchor.x, midY - gesture.anchor.y) < TOUCH_BOX_SLOP) {
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.desired.radius = clamp(
          (gesture.radius * gesture.distance) / distance,
          CAMERA.minRadius,
          CAMERA.maxRadius,
        );
        return;
      }
      this.lastTap = { time: 0, type: null, x: 0, y: 0 };
    }

    gesture.box = {
      x0: gesture.anchor.x,
      y0: gesture.anchor.y,
      x1: midX,
      y1: midY,
    };
    this.showSelectBox(gesture.box.x0, gesture.box.y0, gesture.box.x1, gesture.box.y1);
  }

  onTouchUp(e) {
    this.activePointers.delete(e.pointerId);
    this.releasePointer(e);

    if (this.suppressTouchTap) {
      if (this.activePointers.size === 0) this.suppressTouchTap = false;
      return;
    }

    const gesture = this.touchGesture;
    if (!gesture) return;

    if (gesture.mode === 'box') {
      this.finishTouchBox();
      return;
    }

    if (this.activePointers.size > 0) {
      this.touchGesture = null;
      return;
    }

    this.touchGesture = null;
    if (gesture.mode === 'pan') return;
    if (Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) > TOUCH_TAP_SLOP) return;
    this.handleTouchTap(e.clientX, e.clientY, gesture.additive);
  }

  finishTouchBox() {
    const gesture = this.touchGesture;
    this.touchGesture = null;
    this.suppressTouchTap = true;
    this.hideSelectBox();
    const box = gesture?.box;
    if (!box) return;
    if (Math.hypot(box.x1 - box.x0, box.y1 - box.y0) < TOUCH_BOX_SLOP) return;
    this.selectInBox(box, false);
  }

  handleClick(clientX, clientY, additive) {
    const picked = this.pick(clientX, clientY);
    if (picked.ghost) {
      // Силуэт — разведданные, а не живая цель: выбирать его нельзя.
      this.game.notify(
        'Последнее известное положение постройки. Данные могли устареть.',
        'hint',
        'fog-ghost',
        4,
        3,
      );
      return;
    }
    if (picked.entity) {
      const entity = picked.entity;
      if (entity.faction !== 'player') {
        return;
      }
      this.handleEntityTap(entity, additive, clientX, clientY);
      return;
    }
    if (picked.oil) {
      this.game.notify('Нефтяное месторождение. Постройте вышку, чтобы качать кредиты.', 'hint', 'oil-info', 0, 5);
      return;
    }
    if (!additive) this.game.clearSelection();
  }

  /** Выбор объекта с распознаванием двойного клика и двойного тапа. */
  handleEntityTap(entity, additive, clientX, clientY) {
    const now = performance.now();
    const previous = this.lastTap;
    const isDouble = entity.isUnit
      && previous.time > 0
      && now - previous.time < DOUBLE_TAP_MS
      && previous.type === entity.type
      && Math.hypot(clientX - previous.x, clientY - previous.y) < DOUBLE_TAP_DIST;

    if (isDouble) {
      this.lastTap = { time: 0, type: null, x: 0, y: 0 };
      this.selectSameTypeOnScreen(entity);
      return;
    }

    this.lastTap = { time: now, type: entity.type, x: clientX, y: clientY };
    if (additive) this.game.toggleSelect(entity, true);
    else this.game.selectOnly([entity]);
  }

  // ------------------------------------------------------------- commands
  /** Короткий тап по сцене: выбор, приказ или размещение здания. */
  handleTouchTap(clientX, clientY, additive) {
    if (this.placement) {
      this.tryPlaceAt(clientX, clientY);
      return;
    }
    if (this.attackMode) {
      const point = this.groundPoint(clientX, clientY);
      if (point) {
        this.game.commandAttackMove(new Vector3(point.x, 0, point.z));
        this.setAttackMove(false);
      }
      return;
    }
    if (this.patrolMode) {
      const point = this.groundPoint(clientX, clientY);
      if (point) {
        this.game.commandPatrol(new Vector3(point.x, 0, point.z));
        this.setPatrol(false);
      }
      return;
    }

    const picked = this.pick(clientX, clientY);
    const units = this.game.selectedUnits();
    if (picked.ghost) {
      // По силуэту нельзя отдать приказ «атаковать»: цель могла исчезнуть.
      // Ведём отряд в attack-move к последней известной точке.
      if (units.length) {
        const { x, z } = picked.ghost.position;
        this.game.commandAttackMove(new Vector3(x, 0, z));
      }
      return;
    }
    if (picked.entity && picked.entity.faction !== 'player') {
      if (units.length) this.game.commandAttack(picked.entity);
      return;
    }
    if (picked.entity && picked.entity.faction === 'player'
      && picked.entity.isBuilding && !picked.entity.complete) {
      const builders = units.filter((u) => u.def.builder);
      if (builders.length) {
        this.game.assignBuildersTo(picked.entity, builders);
        this.game.fx.orderMarker(picked.entity.position, 'move');
        this.game.notify('Инженеры направлены к стройплощадке.', 'hint', 'builders-manual', 0, 3);
        return;
      }
    }
    if (picked.entity && picked.entity.faction === 'player') {
      this.handleClick(clientX, clientY, additive);
      return;
    }

    const point = this.groundPoint(clientX, clientY);
    if (units.length && point) {
      this.game.commandMove(new Vector3(point.x, 0, point.z));
      return;
    }
    const buildings = this.game.selectedBuildings();
    if (buildings.length && point) {
      this.game.setRally(new Vector3(point.x, 0, point.z));
      return;
    }
    if (picked.oil) {
      this.game.notify('Нефтяное месторождение. Постройте вышку, чтобы качать кредиты.', 'hint', 'oil-info', 0, 5);
      return;
    }
    if (!additive) this.game.clearSelection();
  }

  selectSameTypeOnScreen(entity) {
    const units = this.game.playerUnits().filter((u) => u.type === entity.type);
    const rect = this.canvas.getBoundingClientRect();
    const selected = units.filter((u) => {
      const p = this.project(u.position.x, 1, u.position.z);
      return p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
    });
    if (selected.length) this.game.selectOnly(selected);
  }

  selectInBox(drag, additive) {
    const x1 = Math.min(drag.x0, drag.x1);
    const x2 = Math.max(drag.x0, drag.x1);
    const y1 = Math.min(drag.y0, drag.y1);
    const y2 = Math.max(drag.y0, drag.y1);
    const units = this.game.playerUnits().filter((u) => {
      const p = this.project(u.position.x, 0.9, u.position.z);
      return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
    });
    if (additive) {
      const list = [...this.game.selected].filter((e) => e.isBuilding);
      for (const u of units) {
        if (!this.game.selected.has(u)) {
          this.game.selected.add(u);
          u.setSelected(true);
          this.game.primary = u;
        }
      }
      this.game.ui?.onSelectionChanged();
    } else {
      this.game.selectOnly(units);
    }
  }

  onRightClick(e) {
    if (this.placement) {
      this.cancelPlacement();
      return;
    }
    if (this.attackMode) {
      this.setAttackMove(false);
      return;
    }
    if (this.patrolMode) {
      this.setPatrol(false);
      return;
    }
    const units = this.game.selectedUnits();
    const picked = this.pick(e.clientX, e.clientY);
    const point = this.groundPoint(e.clientX, e.clientY);

    if (picked.ghost) {
      if (units.length) {
        const { x, z } = picked.ghost.position;
        this.game.commandAttackMove(new Vector3(x, 0, z));
      }
      return;
    }

    // Инженеры по ПКМ на недостроенном здании идут помогать стройке.
    if (picked.entity && picked.entity.faction === 'player' && picked.entity.isBuilding && !picked.entity.complete) {
      const builders = units.filter((u) => u.def.builder);
      if (builders.length) {
        this.game.assignBuildersTo(picked.entity, builders);
        this.game.fx.orderMarker(picked.entity.position, 'move');
        this.game.notify('Инженеры направлены к стройплощадке.', 'hint', 'builders-manual', 0, 3);
        return;
      }
    }

    if (units.length) {
      if (picked.entity && picked.entity.faction !== 'player') {
        this.game.commandAttack(picked.entity);
        return;
      }
      if (point) {
        this.game.commandMove(new Vector3(point.x, 0, point.z));
      }
      return;
    }

    const buildings = this.game.selectedBuildings();
    if (!buildings.length) return;

    if (picked.oil && !picked.oil.derrick) {
      const hq = buildings.find((b) => b.type === 'hq');
      if (hq) {
        if (this.game.credits < BUILDINGS.derrick.cost) {
          this.game.notify('Недостаточно кредитов для вышки.', 'warn', 'no-credits', 0, 3);
          return;
        }
        const b = this.game.tryBuild('derrick', picked.oil.x, picked.oil.z);
        if (b) {
          this.game.selectOnly([hq]);
          this.game.notify('Нефтяная вышка заложена.', 'success', 'derrick-shortcut', 0, 3);
        }
        return;
      }
    }

    if (point) {
      this.game.setRally(new Vector3(point.x, 0, point.z));
    }
  }

  // ------------------------------------------------------------- camera
  onWheel(e) {
    if (!this.game.started || this.game.paused || this.game.over) return;
    if (this.game.ui?.overlayOpen) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    this.desired.radius = clamp(this.desired.radius * (1 + dir * 0.12), CAMERA.minRadius, CAMERA.maxRadius);
  }

  clampTarget() {
    this.desired.target.x = clamp(this.desired.target.x, -MAP.clamp - 4, MAP.clamp + 4);
    this.desired.target.z = clamp(this.desired.target.z, -MAP.clamp - 4, MAP.clamp + 4);
    this.desired.beta = clamp(this.desired.beta, 0.66, 1.26);
    this.desired.radius = clamp(this.desired.radius, CAMERA.minRadius, CAMERA.maxRadius);
  }

  /**
   * Наклон камеры привязан к отдалению: на ближнем зуме — привычный ракурс,
   * на дальнем — плавно к верхнему обзору, чтобы не упираться в горизонт.
   */
  zoomBeta(radius) {
    const span = Math.max(1, CAMERA.maxRadius - CAMERA.wideFrom);
    const t = clamp((radius - CAMERA.wideFrom) / span, 0, 1);
    return this.nearBeta + (CAMERA.wideBeta - this.nearBeta) * t;
  }

  onKeyDown(e) {
    if (e.code === 'Escape') {
      if (this.placement) {
        this.cancelPlacement();
        return;
      }
      if (this.attackMode) {
        this.setAttackMove(false);
        return;
      }
      if (this.patrolMode) {
        this.setPatrol(false);
        return;
      }
      if (this.game.ui?.overlayOpen) {
        if (this.game.ui.overlayBack) this.game.ui.backFromOverlay();
        else if (this.game.started && !this.game.over) this.game.ui.resume();
        return;
      }
      if (this.game.started && !this.game.over) this.game.ui?.openPause();
      return;
    }

    if (!this.game.started || this.game.paused || this.game.over) return;
    if (this.game.ui?.overlayOpen) return;

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      e.preventDefault();
      this.game.selectOnly(this.game.playerUnits());
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    // Отряды: Shift+1…9 запоминает выделение, 1…9 вызывает его.
    // Ctrl+цифры заняты браузером (переключение вкладок), поэтому Shift.
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit && !e.repeat && !e.altKey) {
      const index = Number(digit[1]);
      e.preventDefault();
      if (e.shiftKey) {
        this.game.assignGroup(index);
        return;
      }
      const now = performance.now();
      const previous = this.lastGroupTap;
      const isDouble = previous.index === index
        && now - previous.time < DOUBLE_TAP_MS;
      this.lastGroupTap = isDouble ? { index: 0, time: 0 } : { index, time: now };
      if (this.game.recallGroup(index) && isDouble) this.game.focusGroup(index);
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      this.focusBase();
      return;
    }

    // В режиме размещения R крутит здание, а не запускает ремонт.
    if (this.placement && e.code === 'KeyR') {
      e.preventDefault();
      if (!e.repeat) this.rotatePlacement(e.shiftKey ? -1 : 1);
      return;
    }

    const hotkeyMap = {
      KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B',
      KeyN: 'N', KeyM: 'M', KeyG: 'G', KeyT: 'T', KeyH: 'H', KeyF: 'F', KeyR: 'R', KeyP: 'P',
    };
    if (hotkeyMap[e.code] && !e.repeat) {
      const handled = this.game.ui?.triggerHotkey(hotkeyMap[e.code]);
      if (handled) e.preventDefault();
      return;
    }

    this.keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      e.preventDefault();
    }
  }

  update(dt) {
    if (!this.game.started || this.game.over) return;
    if (this.game.paused) {
      if (this.placement) this.cancelPlacement();
      if (this.attackMode) this.setAttackModeVisual(false);
      if (this.patrolMode) this.setPatrolModeVisual(false);
      this.resetTouchControls?.();
      this.activePointers.clear();
      this.touchGesture = null;
      this.suppressTouchTap = false;
      this.drag = null;
      this.hideSelectBox();
      return;
    }

    const k = this.keys;
    const panSpeed = (this.desired.radius / 52) * 30;
    let mx = 0;
    let mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (mx || mz) {
      const { forward, right } = this.cameraBasis();
      const speed = panSpeed * dt;
      this.desired.target.x += (forward.x * mz + right.x * mx) * speed;
      this.desired.target.z += (forward.z * mz + right.z * mx) * speed;
      this.clampTarget();
    }
    if (k.has('KeyQ')) this.desired.alpha += dt * 1.25;
    if (k.has('KeyE')) this.desired.alpha -= dt * 1.25;

    // Экранные кнопки на сенсорных устройствах.
    const t = this.touchState;
    let tmx = 0;
    let tmz = 0;
    if (t.up) tmz += 1;
    if (t.down) tmz -= 1;
    if (t.right) tmx += 1;
    if (t.left) tmx -= 1;
    if (tmx || tmz) {
      const { forward, right } = this.cameraBasis();
      const speed = panSpeed * 1.25 * dt;
      this.desired.target.x += (forward.x * tmz + right.x * tmx) * speed;
      this.desired.target.z += (forward.z * tmz + right.z * tmx) * speed;
      this.clampTarget();
    }
    if (t.rotl) this.desired.alpha += dt * 1.25;
    if (t.rotr) this.desired.alpha -= dt * 1.25;
    if (t.zoomin) {
      this.desired.radius = clamp(this.desired.radius * (1 - dt * 1.6), CAMERA.minRadius, CAMERA.maxRadius);
    }
    if (t.zoomout) {
      this.desired.radius = clamp(this.desired.radius * (1 + dt * 1.6), CAMERA.minRadius, CAMERA.maxRadius);
    }

    this.desired.beta = this.zoomBeta(this.desired.radius);
    this.camera.alpha = damp(this.camera.alpha, this.desired.alpha, 7, dt);
    this.camera.beta = damp(this.camera.beta, this.desired.beta, 7, dt);
    this.camera.radius = damp(this.camera.radius, this.desired.radius, 6, dt);
    this.camera.target.x = damp(this.camera.target.x, this.desired.target.x, 8, dt);
    this.camera.target.y = 0;
    this.camera.target.z = damp(this.camera.target.z, this.desired.target.z, 8, dt);

    if (this.placement) {
      const hasHQ = this.game.playerBuildings().some((b) => b.type === 'hq');
      if (!hasHQ) {
        this.cancelPlacement();
        this.game.notify('Командный центр уничтожен. Строительство невозможно.', 'danger', 'no-hq', 0, 4);
      }
    }
  }

  // ------------------------------------------------------------- commands
  setAttackMove(enabled) {
    if (enabled && !this.game.selectedUnits().length) return;
    if (enabled && this.patrolMode) this.setPatrolModeVisual(false);
    this.setAttackModeVisual(enabled);
    if (enabled) {
      this.game.notify('Укажите точку атаки. ЛКМ — приказ, ПКМ — отмена.', 'hint', 'attack-mode', 0, 3);
    }
  }

  setAttackModeVisual(enabled) {
    this.attackMode = enabled;
    document.body.classList.toggle('mode-attack', enabled);
  }

  /** Режим выбора точки патруля: клик задаёт второй конец маршрута. */
  setPatrol(enabled) {
    if (enabled && !this.game.selectedUnits().length) return;
    if (enabled && this.attackMode) this.setAttackModeVisual(false);
    this.setPatrolModeVisual(enabled);
    if (enabled) {
      this.game.notify('Укажите точку патруля. ЛКМ — приказ, ПКМ — отмена.', 'hint', 'patrol-mode', 0, 3);
    }
  }

  setPatrolModeVisual(enabled) {
    this.patrolMode = enabled;
    document.body.classList.toggle('mode-patrol', enabled);
  }

  cancelPlacement() {
    if (!this.placement) return;
    this.hidePlaceHint();
    this.placement.ghost.getChildMeshes(false).forEach((m) => m.dispose());
    this.placement.ghost.dispose();
    this.placement.ring.dispose();
    this.placement = null;
    document.body.classList.remove('mode-place');
  }

  startPlacement(type) {
    if (!this.game.started || this.game.paused || this.game.over) return;
    if (!BUILDINGS[type]) return;
    this.cancelPlacement();
    this.setAttackModeVisual(false);

    const materialValid = this.game.factory.mat('placeValid', {
      color: '#5cffc4',
      emissive: '#0d4a36',
      specular: 0.05,
      alpha: 0.5,
      fog: false,
      backFaceCulling: false,
    });
    const materialInvalid = this.game.factory.mat('placeInvalid', {
      color: '#ff7a62',
      emissive: '#4a120c',
      specular: 0.05,
      alpha: 0.48,
      fog: false,
      backFaceCulling: false,
    });
    const ringValid = this.game.factory.mat('placeRingValid', {
      color: '#54ffc2',
      emissive: '#29f7a8',
      unlit: true,
      alpha: 0.9,
      fog: false,
      backFaceCulling: false,
    });
    const ringInvalid = this.game.factory.mat('placeRingInvalid', {
      color: '#ff6248',
      emissive: '#ff3a22',
      unlit: true,
      alpha: 0.9,
      fog: false,
      backFaceCulling: false,
    });

    const model = this.game.factory.building(type, 'player');
    const ghost = model.root;
    const glow = this.scene.getGlowLayerByName?.('glow');
    ghost.getChildMeshes(false).forEach((mesh) => {
      mesh.material = materialValid;
      mesh.isPickable = false;
      mesh.castShadow = false;
      mesh.receiveShadows = false;
      mesh.visibility = 1;
      glow?.addExcludedMesh?.(mesh);
    });

    const ring = MeshBuilder.CreateTorus('placeRing', {
      diameter: BUILDINGS[type].radius * 2.4,
      thickness: 0.09,
      tessellation: 40,
    }, this.scene);
    ring.material = ringValid;
    ring.position.y = 0.12;
    ring.isPickable = false;
    ring.receiveShadows = false;
    glow?.addExcludedMesh?.(ring);

    this.placement = {
      type,
      ghost,
      ring,
      materialValid,
      materialInvalid,
      ringValid,
      ringInvalid,
      valid: false,
      credits: false,
      x: 0,
      z: 0,
      patch: null,
      // null — здание автоматически смотрит к центру карты. После поворота
      // здесь лежит выбранный игроком абсолютный угол.
      rotation: null,
      clientX: null,
      clientY: null,
    };
    document.body.classList.add('mode-place');
    this.game.notify(
      `Разместите: ${BUILDINGS[type].name}. ЛКМ — построить, ПКМ — отмена, R — повернуть.`,
      'hint',
      'placing',
      0,
      3,
    );
    if (this.pointer.has) {
      this.updateGhost(this.pointer.x, this.pointer.y);
    } else if (this.isTouch) {
      const rect = this.canvas.getBoundingClientRect();
      this.updateGhost(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  updateGhost(clientX, clientY) {
    if (!this.placement) return;
    const p = this.groundPoint(clientX, clientY);
    const point = p ?? { x: this.camera.target.x, z: this.camera.target.z + 10 };
    const place = this.game.findPlacement(this.placement.type, point.x, point.z);
    const canAfford = this.game.credits >= BUILDINGS[this.placement.type].cost;
    const valid = place.valid && canAfford;
    const x = place.x;
    const z = place.z;
    this.placement.valid = valid;
    this.placement.credits = canAfford;
    this.placement.x = x;
    this.placement.z = z;
    this.placement.patch = place.patch ?? null;
    this.placement.clientX = clientX;
    this.placement.clientY = clientY;

    const rot = this.placement.rotation ?? Math.atan2(-x, -z);
    this.placement.currentRotation = rot;
    this.placement.ghost.position.set(x, 0, z);
    this.placement.ghost.rotation.y = rot;
    this.placement.ring.position.set(x, 0.12, z);
    const mat = valid ? this.placement.materialValid : this.placement.materialInvalid;
    const ringMat = valid ? this.placement.ringValid : this.placement.ringInvalid;
    this.placement.ghost.getChildMeshes(false).forEach((m) => {
      m.material = mat;
      m.visibility = 1;
    });
    this.placement.ring.material = ringMat;

    const issue = this.game.placementIssue(place, canAfford);
    if (issue) this.showPlaceHint(clientX, clientY, issue);
    else this.hidePlaceHint();
  }

  /** Небольшая подсказка у курсора: почему здесь нельзя строить. */
  showPlaceHint(clientX, clientY, text) {
    const el = this.placeHintEl;
    // На телефоне нет наведения: там причина придёт сообщением при тапе.
    if (!el || this.isTouch) return;
    if (el.textContent !== text) el.textContent = text;
    el.classList.add('is-visible');
    const width = el.offsetWidth || 220;
    const height = el.offsetHeight || 26;
    const left = Math.min(clientX + 16, window.innerWidth - width - 10);
    const top = Math.min(clientY + 18, window.innerHeight - height - 10);
    el.style.left = `${Math.max(10, left)}px`;
    el.style.top = `${Math.max(10, top)}px`;
  }

  hidePlaceHint() {
    this.placeHintEl?.classList.remove('is-visible');
  }

  /** Поворот призрака на 45°; направление — 1 по часовой, -1 против. */
  rotatePlacement(direction = 1) {
    if (!this.placement) return;
    const base = this.placement.rotation
      ?? this.placement.currentRotation
      ?? Math.atan2(-this.placement.x, -this.placement.z);
    this.placement.rotation = base + direction * Math.PI / 4;
    const x = this.placement.clientX;
    const y = this.placement.clientY;
    if (x != null && y != null) {
      this.updateGhost(x, y);
    } else {
      const rect = this.canvas.getBoundingClientRect();
      this.updateGhost(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
  }

  tryPlaceAt(clientX, clientY, keep = false) {
    if (!this.placement) return;
    const p = this.groundPoint(clientX, clientY);
    if (!p) return;
    const place = this.game.findPlacement(this.placement.type, p.x, p.z);
    const canAfford = this.game.credits >= BUILDINGS[this.placement.type].cost;
    const issue = this.game.placementIssue(place, canAfford);
    if (issue) {
      this.game.notify(issue, 'warn', 'bad-place', 0, 3);
      return;
    }
    const rotation = this.placement.rotation ?? Math.atan2(-place.x, -place.z);
    const b = this.game.tryBuild(this.placement.type, place.x, place.z, { rotation });
    if (!b) return;
    if (keep) {
      this.updateGhost(clientX, clientY);
    } else {
      this.cancelPlacement();
    }
  }
}
