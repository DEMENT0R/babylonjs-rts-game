// Управление: камера, выбор, приказы и строительство.

import {
  Vector3,
  Matrix,
  MeshBuilder,
} from './babylon.js';
import { BUILDINGS, CAMERA, MAP } from './config.js';
import { clamp, damp, dist } from './utils.js';

const NEUTRAL_GHOST = '#4fd2ff';

export class Input {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.camera = game.camera;
    this.canvas = this.scene.getEngine().getRenderingCanvas();
    this.pointer = { x: 0, y: 0, has: false };
    this.keys = new Set();
    this.desired = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: this.camera.target.clone(),
    };
    this.drag = null;
    this.middleDrag = null;
    this.attackMode = false;
    this.placement = null;
    this.lastClick = { time: 0, type: null };
    this.groundY = 0;

    game.input = this;
    this.bind();
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
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.middleDrag = null;
    });
  }

  // ------------------------------------------------------------- math helpers
  screenRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const engine = this.scene.getEngine();
    const px = ((clientX - rect.left) / Math.max(1, rect.width)) * engine.getRenderWidth();
    const py = ((clientY - rect.top) / Math.max(1, rect.height)) * engine.getRenderHeight();
    return this.scene.createPickingRay(px, py, Matrix.Identity(), this.camera);
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
    if (!info?.hit || !info.pickedMesh) return { entity: null, oil: null, point: null };
    const meta = info.pickedMesh.metadata;
    return {
      entity: meta?.entity ?? null,
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
    const right = Vector3.Cross(forward, Vector3.Up()).normalize();
    return { forward, right };
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

    if (this.middleDrag) {
      const dx = e.clientX - this.middleDrag.x;
      const dy = e.clientY - this.middleDrag.y;
      this.middleDrag = { x: e.clientX, y: e.clientY };
      const { forward, right } = this.cameraBasis();
      const k = this.camera.radius * 0.0018;
      this.desired.target.x += (-right.x * dx + forward.x * dy) * k;
      this.desired.target.z += (-right.z * dx + forward.z * dy) * k;
      this.clampTarget();
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
    if (Math.hypot(dx, dy) > 5) {
      this.drag.moved = true;
      const box = document.querySelector('#selectBox');
      if (box) {
        box.style.display = 'block';
        box.style.left = `${Math.min(this.drag.x0, this.drag.x1)}px`;
        box.style.top = `${Math.min(this.drag.y0, this.drag.y1)}px`;
        box.style.width = `${Math.abs(dx)}px`;
        box.style.height = `${Math.abs(dy)}px`;
      }
    }
  }

  onPointerUp(e) {
    if (this.middleDrag) {
      this.middleDrag = null;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      return;
    }
    if (!this.drag) {
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      return;
    }

    const drag = this.drag;
    this.drag = null;
    const box = document.querySelector('#selectBox');
    if (box) box.style.display = 'none';
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }

    if (drag.moved) {
      this.selectInBox(drag, drag.shift);
      return;
    }

    this.handleClick(e.clientX, e.clientY, drag.shift);
  }

  handleClick(clientX, clientY, additive) {
    const picked = this.pick(clientX, clientY);
    if (picked.entity) {
      const entity = picked.entity;
      if (entity.faction !== 'player') {
        return;
      }
      const now = performance.now();
      this.lastClick = { time: now, type: `${entity.faction}:${entity.type}` };
      if (this._lastClickTime && now - this._lastClickTime < 330 && this._lastType === this.lastClick.type && entity.isUnit) {
        this.selectSameTypeOnScreen(entity);
      } else if (additive) {
        this.game.toggleSelect(entity, true);
      } else {
        this.game.selectOnly([entity]);
      }
      this._lastClickTime = now;
      this._lastType = this.lastClick.type;
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
    const units = this.game.selectedUnits();
    const picked = this.pick(e.clientX, e.clientY);
    const point = this.groundPoint(e.clientX, e.clientY);

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
      if (this.game.ui?.overlayOpen) {
        if (this.game.started && !this.game.over) this.game.ui.resume();
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

    if (e.code === 'Space') {
      e.preventDefault();
      this.focusBase();
      return;
    }

    const hotkeyMap = { KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyF: 'F' };
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
    this.setAttackModeVisual(enabled);
    if (enabled) {
      this.game.notify('Укажите точку атаки. ЛКМ — приказ, ПКМ — отмена.', 'hint', 'attack-mode', 0, 3);
    }
  }

  setAttackModeVisual(enabled) {
    this.attackMode = enabled;
    document.body.classList.toggle('mode-attack', enabled);
  }

  cancelPlacement() {
    if (!this.placement) return;
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
    };
    document.body.classList.add('mode-place');
    this.game.notify(
      `Разместите: ${BUILDINGS[type].name}. ЛКМ — построить, ПКМ — отмена.`,
      'hint',
      'placing',
      0,
      3,
    );
    if (this.pointer.has) this.updateGhost(this.pointer.x, this.pointer.y);
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

    const rot = Math.atan2(-x, -z);
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
  }

  tryPlaceAt(clientX, clientY, keep = false) {
    if (!this.placement) return;
    const p = this.groundPoint(clientX, clientY);
    if (!p) return;
    const place = this.game.findPlacement(this.placement.type, p.x, p.z);
    if (!place.valid) {
      this.game.notify(
        place.reason === 'oil' ? 'Вышку можно поставить только на свободное месторождение.' : 'Здесь нельзя строить.',
        'warn',
        'bad-place',
        0,
        3,
      );
      return;
    }
    const b = this.game.tryBuild(this.placement.type, place.x, place.z);
    if (!b) return;
    if (keep) {
      this.updateGhost(clientX, clientY);
    } else {
      this.cancelPlacement();
    }
  }
}
