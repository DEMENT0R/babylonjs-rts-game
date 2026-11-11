// Управление с геймпада: камера, виртуальный курсор и навигация по меню.

const DEADZONE = 0.22;
const CURSOR_SPEED = 900;
const PAN_BOOST = 2.5;
const MARQUEE_SLOP = 8;
const MENU_STICK = 0.62;
const MENU_REPEAT_DELAY = 0.36;
const MENU_REPEAT_RATE = 0.12;

const BUTTON = Object.freeze({
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  LS: 10,
  RS: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Убирает дребезг стика и растягивает оставшийся ход на 0…1. */
function axis(value, deadzone = DEADZONE) {
  const v = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(v);
  if (magnitude <= deadzone) return 0;
  return Math.sign(v) * ((magnitude - deadzone) / (1 - deadzone));
}

function visible(element) {
  return Boolean(element && element.getClientRects().length);
}

export class GamepadInput {
  constructor(input) {
    this.input = input;
    this.game = input.game;
    this.ui = this.game.ui;
    this.index = null;
    this.pad = null;
    this.connected = false;
    this.prev = [];
    this.mode = 'pointer';
    this.cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.cursorEl = document.querySelector('#gamepadCursor');
    this.menu = {
      repeatAt: 0,
      stickLatch: false,
    };
    // Рамка выделения левым триггером и режим навигации по командной панели.
    this.marquee = null;
    this.panelMode = false;
    this.panel = { focusId: null, repeatAt: 0 };
    this.activityAt = 0;
    this.bind();
    this.scan();
  }

  bind() {
    window.addEventListener('gamepadconnected', (e) => this.attach(e.gamepad));
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.pad?.index !== e.gamepad.index) return;
      this.detach();
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.usePointer();
    }, { passive: true });
    window.addEventListener('keydown', () => this.usePointer());
    window.addEventListener('resize', () => this.clampCursor());
  }

  scan() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      this.attach(pad);
      return;
    }
  }

  attach(pad) {
    if (!pad) return;
    this.pad = pad;
    this.index = pad.index;
    if (!this.connected) {
      this.connected = true;
      document.body.classList.add('has-gamepad');
    }
  }

  detach() {
    this.pad = null;
    this.index = null;
    this.connected = false;
    this.prev = [];
    this.cancelMarquee();
    this.exitPanelMode();
    document.body.classList.remove('has-gamepad', 'using-gamepad');
    this.hideCursor();
  }

  readPad() {
    const pads = navigator.getGamepads?.();
    if (!pads) return null;
    if (this.index != null) {
      const pad = pads[this.index];
      if (pad?.connected) return pad;
      this.detach();
    }
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      this.attach(pad);
      return pad;
    }
    return null;
  }

  usePointer() {
    if (this.mode === 'pointer') return;
    this.mode = 'pointer';
    this.cancelMarquee();
    this.exitPanelMode();
    document.body.classList.remove('using-gamepad');
    this.hideCursor();
  }

  useGamepad() {
    // Витрина главного меню прячется после простоя: ввод с геймпада
    // должен считаться активностью так же, как мышь и клавиатура.
    const now = performance.now();
    if (now - this.activityAt > 500) {
      this.activityAt = now;
      window.dispatchEvent(new Event('gamepadactivity'));
    }
    if (this.mode === 'gamepad') return;
    this.mode = 'gamepad';
    document.body.classList.add('using-gamepad');
  }

  update(dt) {
    const pad = this.readPad();
    if (!pad) {
      this.prev = [];
      this.hideCursor();
      return;
    }

    const states = pad.buttons.map((b) => Boolean(b?.pressed) || (b?.value ?? 0) > 0.5);
    const axes = pad.axes ?? [];
    const active = states.some(Boolean) || axes.some((value) => Math.abs(value ?? 0) > 0.35);
    if (active) this.useGamepad();

    const just = states.map((pressed, i) => pressed && !this.prev[i]);
    this.prev = states;

    if (this.ui?.overlayOpen) {
      this.hideCursor();
      this.cancelMarquee();
      this.exitPanelMode();
      this.updateMenu(dt, pad, states, just);
      return;
    }

    if (!this.game.started || this.game.over || this.game.paused) {
      this.hideCursor();
      this.cancelMarquee();
      this.exitPanelMode();
      return;
    }

    this.updateCamera(dt, pad, states, just);
    this.updateCursor(dt, pad);
    this.updateActions(states, just);
    this.updateMarquee(states, just);
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, pad, states, just) {
    const input = this.input;
    let mx = axis(pad.axes?.[0]);
    let mz = -axis(pad.axes?.[1]);

    if (mx || mz) {
      const length = Math.hypot(mx, mz);
      if (length > 1) {
        mx /= length;
        mz /= length;
      }
      const { forward, right } = input.cameraBasis();
      // RT ускоряет перемещение; на цифровых курках значение равно 0 или 1.
      const rt = Math.max(0, Math.min(1, pad.buttons?.[BUTTON.RT]?.value ?? 0));
      const boost = 1 + rt * (PAN_BOOST - 1);
      const speed = (input.desired.radius / 52) * 30 * boost * dt;
      input.desired.target.x += (forward.x * mz + right.x * mx) * speed;
      input.desired.target.z += (forward.z * mz + right.z * mx) * speed;
      input.clampTarget();
    }

    // В режиме командной панели крестовина листает плитки, а не камеру.
    if (this.panelMode) return;

    // Крестовина: вверх/вниз — зум, влево/вправо — поворот камеры.
    const zoomIn = states[BUTTON.UP];
    const zoomOut = states[BUTTON.DOWN];
    if (zoomIn || zoomOut) {
      const dir = zoomIn ? -1 : 1;
      const step = just[BUTTON.UP] || just[BUTTON.DOWN] ? 0.12 : 0;
      input.zoomBy(dir * (step + dt * 1.6));
    }
    if (states[BUTTON.LEFT]) input.desired.alpha += dt * 1.25;
    if (states[BUTTON.RIGHT]) input.desired.alpha -= dt * 1.25;
  }

  // ------------------------------------------------------------------ cursor
  clampCursor() {
    this.cursor.x = clamp(this.cursor.x, 4, window.innerWidth - 4);
    this.cursor.y = clamp(this.cursor.y, 4, window.innerHeight - 4);
    this.positionCursor();
  }

  updateCursor(dt, pad) {
    const vx = axis(pad.axes?.[2]);
    const vy = axis(pad.axes?.[3]);
    if (vx || vy) {
      const length = Math.hypot(vx, vy);
      const scale = length > 1 ? 1 / length : 1;
      this.cursor.x += vx * scale * CURSOR_SPEED * dt;
      this.cursor.y += vy * scale * CURSOR_SPEED * dt;
      this.clampCursor();
    }
    this.showCursor();
  }

  positionCursor() {
    if (!this.cursorEl) return;
    this.cursorEl.style.left = `${this.cursor.x}px`;
    this.cursorEl.style.top = `${this.cursor.y}px`;
  }

  showCursor() {
    if (!this.cursorEl || this.mode !== 'gamepad') return;
    this.cursorEl.classList.add('is-visible');
    this.positionCursor();
    const target = document.elementFromPoint(this.cursor.x, this.cursor.y);
    this.cursorEl.classList.toggle('is-over', Boolean(target?.closest('button, input, select, textarea')));
  }

  hideCursor() {
    this.cursorEl?.classList.remove('is-visible');
  }

  /** A: нажать кнопку интерфейса или выбрать/отдать приказ в мире. */
  activateCursor() {
    const x = this.cursor.x;
    const y = this.cursor.y;
    const element = document.elementFromPoint(x, y);
    if (!element) return;

    const button = element.closest('button');
    if (button) {
      if (button.disabled) return;
      button.click();
      return;
    }

    if (element.closest('#scene')) {
      this.input.handleTouchTap(x, y, false);
    }
  }

  /** X: контекстный приказ, как правая кнопка мыши. */
  orderAtCursor() {
    const x = this.cursor.x;
    const y = this.cursor.y;
    const element = document.elementFromPoint(x, y);
    if (!element?.closest('#scene')) return;
    this.input.onRightClick({ clientX: x, clientY: y });
  }

  updateActions(states, just) {
    const input = this.input;
    const ui = this.ui;

    if (just[BUTTON.START]) {
      ui.openPause();
      return;
    }
    if (just[BUTTON.BACK]) {
      input.focusBase();
      return;
    }
    if (just[BUTTON.RS]) {
      this.togglePanelMode();
      return;
    }
    if (this.panelMode) {
      this.updatePanel(just, states);
      if (just[BUTTON.B]) {
        this.exitPanelMode();
        return;
      }
      if (just[BUTTON.A]) {
        this.activateCommand();
        return;
      }
      if (just[BUTTON.X]) this.orderAtCursor();
      return;
    }
    if (just[BUTTON.B]) {
      if (input.placement) input.cancelPlacement();
      else if (input.attackMode) input.setAttackMove(false);
      else if (input.patrolMode) input.setPatrol(false);
      else this.game.clearSelection();
      return;
    }
    if (just[BUTTON.Y]) {
      input.setAttackMove(!input.attackMode);
      return;
    }
    if (just[BUTTON.A]) {
      this.activateCursor();
      return;
    }
    if (just[BUTTON.X]) this.orderAtCursor();
  }

  // --------------------------------------------------------------- selection
  /** LT: рамка выделения растягивается от прицела, отпускание — выбор. */
  updateMarquee(states, just) {
    if (just[BUTTON.LT]) {
      if (this.panelMode) return;
      this.marquee = {
        x0: this.cursor.x,
        y0: this.cursor.y,
        x1: this.cursor.x,
        y1: this.cursor.y,
        open: false,
      };
      return;
    }

    const box = this.marquee;
    if (!box) return;

    if (states[BUTTON.LT]) {
      box.x1 = this.cursor.x;
      box.y1 = this.cursor.y;
      if (!box.open && Math.hypot(box.x1 - box.x0, box.y1 - box.y0) > MARQUEE_SLOP) {
        box.open = true;
      }
      if (box.open) this.input.showSelectBox(box.x0, box.y0, box.x1, box.y1);
      return;
    }

    this.marquee = null;
    this.input.hideSelectBox();
    if (box.open) this.input.selectInBox(box, false);
  }

  cancelMarquee() {
    if (!this.marquee) return;
    this.marquee = null;
    this.input.hideSelectBox();
  }

  // ----------------------------------------------------------- command panel
  togglePanelMode() {
    if (this.panelMode) this.exitPanelMode();
    else this.enterPanelMode();
  }

  enterPanelMode() {
    if (!this.commandFocusables().length) return;
    this.panelMode = true;
    this.panel.repeatAt = 0;
    this.cancelMarquee();
    this.ensureCommandFocus();
  }

  exitPanelMode() {
    if (!this.panelMode) return;
    this.panelMode = false;
    const container = this.ui?.el?.commands;
    container?.querySelectorAll('.is-gamepad-focus')
      .forEach((node) => node.classList.remove('is-gamepad-focus'));
    if (container?.contains(document.activeElement)) document.activeElement.blur();
  }

  commandFocusables() {
    const container = this.ui?.el?.commands;
    if (!container) return [];
    return [...container.querySelectorAll('button.cmd[data-cmd-id]')].filter(visible);
  }

  ensureCommandFocus() {
    if (!this.panelMode) return false;
    const list = this.commandFocusables();
    if (!list.length) {
      this.exitPanelMode();
      return false;
    }
    const active = document.activeElement;
    if (list.includes(active) && visible(active)) return true;
    // Панель пересобирается после каждого приказа — возвращаем подсветку
    // на ту же команду, а если её больше нет, то на первую.
    const remembered = list.find((btn) => btn.dataset.cmdId === this.panel.focusId);
    this.focusCommand(remembered || list[0]);
    return true;
  }

  focusCommand(button) {
    const container = this.ui?.el?.commands;
    container?.querySelectorAll('.is-gamepad-focus')
      .forEach((node) => node.classList.remove('is-gamepad-focus'));
    button.classList.add('is-gamepad-focus');
    this.panel.focusId = button.dataset.cmdId ?? null;
    button.focus({ preventScroll: true });
    button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  updatePanel(just, states) {
    if (!this.ensureCommandFocus()) return;
    // Включился режим размещения или атаки — крестовина снова камера.
    if (this.input.placement || this.input.attackMode || this.input.patrolMode) {
      this.exitPanelMode();
      return;
    }
    const direction = this.dpadDirection(states, just);
    if (direction.x || direction.y) {
      this.moveFocusIn(
        this.commandFocusables(),
        direction.x,
        direction.y,
        (button) => this.focusCommand(button),
      );
    }
  }

  activateCommand() {
    if (!this.ensureCommandFocus()) return;
    const active = document.activeElement;
    if (!active?.dataset?.cmdId) return;
    active.click();
    if (this.input.placement || this.input.attackMode || this.input.patrolMode) {
      this.exitPanelMode();
      return;
    }
    this.ensureCommandFocus();
  }

  dpadDirection(states, just) {
    const now = performance.now();
    let x = 0;
    let y = 0;
    if (states[BUTTON.LEFT]) x -= 1;
    if (states[BUTTON.RIGHT]) x += 1;
    if (states[BUTTON.UP]) y -= 1;
    if (states[BUTTON.DOWN]) y += 1;
    if (!x && !y) {
      this.panel.repeatAt = 0;
      return { x: 0, y: 0 };
    }
    const pressed = just[BUTTON.LEFT] || just[BUTTON.RIGHT]
      || just[BUTTON.UP] || just[BUTTON.DOWN];
    if (pressed) {
      this.panel.repeatAt = now + MENU_REPEAT_DELAY * 1000;
      return { x, y };
    }
    if (now >= this.panel.repeatAt) {
      this.panel.repeatAt = now + MENU_REPEAT_RATE * 1000;
      return { x, y };
    }
    return { x: 0, y: 0 };
  }

  // -------------------------------------------------------------------- menu
  updateMenu(dt, pad, states, just) {
    const ui = this.ui;
    if (just[BUTTON.START] || just[BUTTON.B]) {
      ui.closeOverlay?.();
      return;
    }

    this.ensureFocus();

    if (just[BUTTON.A]) {
      this.activateFocused();
      return;
    }

    const direction = this.menuDirection(pad, states, just);
    if (direction.x || direction.y) this.moveFocus(direction.x, direction.y);
  }

  focusables() {
    const card = this.ui?.el?.overlayCard;
    if (!card) return [];
    return [...card.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter(visible);
  }

  ensureFocus() {
    const card = this.ui?.el?.overlayCard;
    if (!card) return;
    const active = document.activeElement;
    if (active && card.contains(active) && visible(active)) return;
    const list = this.focusables();
    if (!list.length) return;
    const preferred = card.querySelector('.btn-primary:not([disabled])')
      || card.querySelector('.mode-card--active:not([disabled])')
      || card.querySelector('.settings-tab')
      || card.querySelector('button:not(.overlay-close)');
    this.focus(list.includes(preferred) ? preferred : list[0]);
  }

  focus(element) {
    if (!element) return;
    this.ui.el.overlayCard.querySelectorAll('.is-gamepad-focus')
      .forEach((node) => node.classList.remove('is-gamepad-focus'));
    element.classList.add('is-gamepad-focus');
    element.focus({ preventScroll: false });
  }

  activateFocused() {
    const card = this.ui?.el?.overlayCard;
    const active = document.activeElement;
    if (!card || !active || !card.contains(active) || !visible(active)) {
      this.ensureFocus();
      return;
    }
    if (active.disabled) return;
    active.click();
  }

  moveFocus(dx, dy) {
    this.moveFocusIn(this.focusables(), dx, dy, (element) => this.focus(element));
  }

  /** Геометрическая навигация по сетке элементов: ближайший в направлении. */
  moveFocusIn(list, dx, dy, applyFocus) {
    if (!list.length) return;
    const current = list.includes(document.activeElement) ? document.activeElement : null;
    if (!current) {
      applyFocus(list[0]);
      return;
    }

    const rect = current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let best = null;
    let bestScore = Infinity;

    for (const element of list) {
      if (element === current) continue;
      const r = element.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const along = (x - cx) * dx + (y - cy) * dy;
      if (along <= 4) continue;
      const across = Math.abs((x - cx) * dy - (y - cy) * dx);
      const score = along + across * 2.4;
      if (score < bestScore) {
        bestScore = score;
        best = element;
      }
    }

    if (best) applyFocus(best);
  }

  menuDirection(pad, states, just) {
    const now = performance.now();
    let x = 0;
    let y = 0;
    if (states[BUTTON.LEFT]) x -= 1;
    if (states[BUTTON.RIGHT]) x += 1;
    if (states[BUTTON.UP]) y -= 1;
    if (states[BUTTON.DOWN]) y += 1;

    const dpadJust = just[BUTTON.LEFT] || just[BUTTON.RIGHT] || just[BUTTON.UP] || just[BUTTON.DOWN];
    if (x || y) {
      if (dpadJust) {
        this.menu.repeatAt = now + MENU_REPEAT_DELAY * 1000;
        return { x, y };
      }
      if (now >= this.menu.repeatAt) {
        this.menu.repeatAt = now + MENU_REPEAT_RATE * 1000;
        return { x, y };
      }
      return { x: 0, y: 0 };
    }

    const sx = axis(pad.axes?.[0], MENU_STICK);
    const sy = axis(pad.axes?.[1], MENU_STICK);
    if (sx || sy) {
      if (!this.menu.stickLatch) {
        this.menu.stickLatch = true;
        this.menu.repeatAt = now + MENU_REPEAT_DELAY * 1000;
        return { x: Math.abs(sx) >= Math.abs(sy) ? Math.sign(sx) : 0, y: Math.abs(sy) > Math.abs(sx) ? Math.sign(sy) : 0 };
      }
      if (now >= this.menu.repeatAt) {
        this.menu.repeatAt = now + MENU_REPEAT_RATE * 1000;
        return { x: Math.abs(sx) >= Math.abs(sy) ? Math.sign(sx) : 0, y: Math.abs(sy) > Math.abs(sx) ? Math.sign(sy) : 0 };
      }
    } else {
      this.menu.stickLatch = false;
    }

    return { x: 0, y: 0 };
  }
}
