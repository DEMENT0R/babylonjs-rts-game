// HUD: ресурсы, выбор, командная панель, миникарта, оверлеи.

import { Matrix } from './babylon.js';
import {
  FACTIONS,
  UNITS,
  BUILDINGS,
  UPGRADES,
  BUILD_ORDER,
  BUILD_HOTKEYS,
  UPGRADE_ORDER,
  TRAIN_ORDER,
  TRAIN_HOTKEYS,
  HQ_TRAIN_ORDER,
  HQ_TRAIN_HOTKEYS,
  MESSAGES,
  MAP,
} from './config.js';
import { icon } from './icons.js';
import { randomSeed, seedUrl } from './mapgen.js';
import { CHANGELOG, GAME_VERSION } from './changelog.js';
import { GRAPHICS_LABELS, GRAPHICS_OPTIONS } from './settings.js';
import { clamp, formatTime, plural, mulberry32, esc } from './utils.js';

export class UI {
  constructor(game) {
    this.game = game;
    game.ui = this;
    this.$ = (sel) => document.querySelector(sel);
    this.cache();
    this.injectIcons();
    this.bindStatic();
    this.commands = [];
    this.commandMap = new Map();
    this.tickAcc = 0;
    this.selectionAcc = 0;
    this.lastSignature = '';
    this.tooltipVisible = false;
    this.overlayOpen = true;
    this.overlayBack = null;
    this.minimapBg = null;
    this.buildMinimapBackground();
    this.el.mmSector.textContent = this.game.map.label;
    this.el.mmSector.title = `Карта ${this.game.map.label} · ${this.game.map.style.name}`;
    if (this.el.brandSector) {
      this.el.brandSector.textContent = `КОЛОНИАЛЬНАЯ СЕТЬ / СЕКТОР ${this.game.map.label}`;
    }
    this.showStart();
    this.renderHeader();
    this.drawMinimap();
  }

  cache() {
    this.el = {
      credits: this.$('#credits'),
      power: this.$('#power'),
      army: this.$('#army'),
      clock: this.$('#clock'),
      resPower: this.$('#resPower'),
      gridStatus: this.$('#gridStatus'),
      commands: this.$('#commands'),
      cmdStatus: this.$('#cmdStatus'),
      selectionBody: this.$('#selectionBody'),
      selTitle: this.$('#selTitle'),
      selTag: this.$('#selTag'),
      feed: this.$('#feed'),
      overlay: this.$('#overlay'),
      overlayCard: this.$('#overlayCard'),
      pauseBtn: this.$('#btnPause'),
      alert: this.$('#alertFlash'),
      minimap: this.$('#minimap'),
      mmPing: this.$('#mmPing'),
      mmSector: this.$('#mmSector'),
      brandSector: this.$('#brandSector'),
      minimapFrame: document.querySelector('.minimap-frame'),
      tooltip: this.$('#tooltip'),
      selectBox: this.$('#selectBox'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
  }

  injectIcons() {
    document.querySelectorAll('[data-icon]').forEach((node) => {
      node.innerHTML = icon(node.dataset.icon);
    });
  }

  bindStatic() {
    this.el.pauseBtn.addEventListener('click', () => this.togglePause());
    this.el.overlay.addEventListener('click', (e) => {
      const gfx = e.target.closest('[data-graphics]');
      if (gfx) {
        this.game.graphics?.set(gfx.dataset.graphics, gfx.dataset.value);
        this.refreshGraphicsControls();
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'start') this.startGame();
      else if (action === 'resume') this.resume();
      else if (action === 'restart') window.location.reload();
      else if (action === 'newmap') this.newMap();
      else if (action === 'changelog') this.openChangelog();
      else if (action === 'back') this.backFromOverlay();
    });
    this.el.commands.addEventListener('click', (e) => {
      const btn = e.target.closest('.cmd');
      if (!btn) return;
      const cmd = this.commandMap.get(btn.dataset.cmdId);
      if (!cmd) return;
      if (cmd.disabled) {
        this.game.notify(cmd.reason || 'Недоступно.', 'warn', `cmd-${cmd.id}`, 0, 3);
        return;
      }
      cmd.action();
      this.renderCommands();
    });
    this.el.commands.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.cmd');
      if (!btn) return;
      const cmd = this.commandMap.get(btn.dataset.cmdId);
      if (cmd) this.showTooltip(btn, cmd);
    });
    this.el.commands.addEventListener('mouseout', (e) => {
      if (e.target.closest('.cmd')) this.hideTooltip();
    });
    this.el.selectionBody.addEventListener('click', (e) => {
      const q = e.target.closest('[data-cancel-queue]');
      if (q) {
        const building = this.game.selectedBuildings()[0];
        if (building) this.game.cancelQueue(building, Number(q.dataset.cancelQueue));
        return;
      }
      const c = e.target.closest('[data-cancel-build]');
      if (c) {
        const b = this.game.selectedBuildings()[0];
        if (b) b.cancelConstruction(true);
      }
    });
    this.bindMinimap();
  }

  // --------------------------------------------------------------- overlays
  showStart() {
    const map = this.game.map;
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> СЕКТОР ${map.label} · ПУСТОШЬ МАРСА · ${map.style.name}</div>
        <h1>ГЕЛИОС<span>-7</span></h1>
        <p class="tagline">Последняя колония на краю сектора. Удержите её любой ценой.</p>
      </div>
      <div class="map-strip">
        <div class="map-strip-item"><span>СИД КАРТЫ</span><b>#${map.label}</b></div>
        <div class="map-strip-item"><span>СИММЕТРИЯ</span><b>${map.symmetry.name} · ${map.symmetry.tag}</b></div>
        <div class="map-strip-item"><span>ЛАНДШАФТ</span><b>${map.style.name}</b></div>
        <button class="btn-ghost btn-map" data-action="newmap">СГЕНЕРИРОВАТЬ ДРУГУЮ</button>
      </div>
      <div class="brief-grid">
        <div class="brief-copy">
          <p>Сенсоры зафиксировали выход Роя ксенов на противоположном краю сектора. ${map.symmetry.hint} Рельеф и месторождения у обеих сторон одинаковые.</p>
          <p class="accent-copy">Развивайте экономику, собирайте армию и уничтожьте улей, пока он не добрался до колонии.</p>
        </div>
        <div class="objectives">
          <div class="objective"><b>01</b><span><strong>Нефть — это жизнь</strong><small>Занимайте месторождения вышками: они приносят кредиты.</small></span></div>
          <div class="objective"><b>02</b><span><strong>Соберите армию</strong><small>Постройте казармы. Пехота, скауты, танки и РСЗО — ваша сила. Инженеры возводят здания.</small></span></div>
          <div class="objective"><b>03</b><span><strong>Уничтожьте улей</strong><small>Сравняйте с землёй командный центр противника.</small></span></div>
        </div>
      </div>
      <div class="controls-block">
        <div class="controls-title">УПРАВЛЕНИЕ <span>// полевая памятка</span></div>
        <div class="controls-grid">
          <div><kbd>ЛКМ</kbd><span>выбор, рамка</span></div>
          <div><kbd>ПКМ</kbd><span>приказ, атака</span></div>
          <div><kbd>WASD</kbd><span>камера</span></div>
          <div><kbd>Q / E</kbd><span>поворот камеры</span></div>
          <div><kbd>Колесо</kbd><span>зум</span></div>
          <div><kbd>СКМ</kbd><span>тащить камеру</span></div>
          <div><kbd>Z X C V</kbd><span>команды</span></div>
          <div><kbd>F</kbd><span>атака по площади</span></div>
          <div><kbd>B</kbd><span>стоп (инженеры)</span></div>
          <div><kbd>R</kbd><span>ремонт здания</span></div>
          <div><kbd>Shift</kbd><span>добавить к выбору</span></div>
          <div><kbd>Пробел</kbd><span>на базу</span></div>
          <div><kbd>Esc</kbd><span>пауза / меню</span></div>
          <div><kbd>ЛКМ</kbd><span>по миникарте — камера</span></div>
        </div>
        <p class="touch-hint">На сенсорном экране: тап — выбрать или отдать приказ, два пальца — панорама и зум, кнопки справа — камера и отмена режима.</p>
      </div>
      ${this.graphicsBlock()}
      <div class="overlay-actions">
        <button class="btn-primary" data-action="start">НАЧАТЬ ОПЕРАЦИЮ <span>→</span></button>
        <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        <div class="overlay-note">Каждая карта строится из сида: ссылку вида <b>?seed=${map.label}</b> можно сохранить и сыграть на той же карте снова.</div>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // КАРТА #${map.label} // ВЕРСИЯ ${GAME_VERSION}</span>
        <span>${map.symmetry.name.toUpperCase()} · ${map.style.name} · BABYLON.JS</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--start');
  }

  showEnd(result) {
    const victory = result === 'victory';
    const s = this.game.stats;
    const map = this.game.map;
    const html = `
      <div class="end-head ${victory ? 'win' : 'lose'}">
        <div class="eyebrow"><i></i> ${victory ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : 'СИГНАЛ ПОТЕРЯН'}</div>
        <h1>${victory ? 'СЕКТОР УДЕРЖАН' : 'КОЛОНИЯ ПОТЕРЯНА'}</h1>
        <p class="tagline">${victory
          ? 'Командный центр Роя уничтожен. Колония «Гелиос-7» получает шанс на жизнь.'
          : 'Улей прорвал оборону. Командный центр пал. Сектор потерян.'}</p>
      </div>
      <div class="end-stats">
        <div><b>${formatTime(s.time ?? this.game.elapsed)}</b><span>ВРЕМЯ ОПЕРАЦИИ</span></div>
        <div><b>${s.kills}</b><span>УНИЧТОЖЕНО</span></div>
        <div><b>${s.losses}</b><span>ПОТЕРЯНО</span></div>
        <div><b>${Math.floor(s.gathered)}</b><span>ДОБЫТО КРЕДИТОВ</span></div>
      </div>
      <div class="end-map">КАРТА <b>#${map.label}</b> · ${map.symmetry.name.toUpperCase()} ${map.symmetry.tag} · ${map.style.name}</div>
      <div class="end-note">${victory
        ? 'Рой отступил в пустошь. Но сенсоры уже фиксируют новые сигнатуры...'
        : 'В следующий раз начните с вышек и не оставляйте казармы без прикрытия.'}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="newmap">НОВАЯ КАРТА <span>↻</span></button>
        <button class="btn-ghost" data-action="restart">ПОВТОРИТЬ ЭТУ КАРТУ</button>
        <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ИТОГИ</span>
        <span>${victory ? 'СТАТУС: СЕКТОР ЗАЩИЩЁН' : 'СТАТУС: ЭВАКУАЦИЯ НЕВОЗМОЖНА'}</span>
      </div>
    `;
    this.setOverlay(html, `overlay--end ${victory ? 'is-win' : 'is-lose'}`);
  }

  togglePause() {
    if (!this.game.started || this.game.over) return;
    if (this.overlayOpen) this.resume();
    else this.openPause();
  }

  openPause() {
    if (!this.game.started || this.game.over) return;
    this.game.setPaused(true);
    const map = this.game.map;
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ПАУЗА</div>
        <h1 class="pause-title">ОПЕРАЦИЯ<br><span>ПРИОСТАНОВЛЕНА</span></h1>
        <p class="tagline">Камера и интерфейс остаются доступны. Продолжите, когда будете готовы.</p>
      </div>
      <div class="pause-stats">
        <div><b>${Math.floor(this.game.credits)}</b><span>КРЕДИТЫ</span></div>
        <div><b>${this.game.getArmyUsed('player')} / ${this.game.getArmyCap('player')}</b><span>ЛИМИТ АРМИИ</span></div>
        <div><b>${formatTime(this.game.elapsed)}</b><span>ВРЕМЯ</span></div>
      </div>
      <div class="controls-block compact">
        <div class="controls-title">УПРАВЛЕНИЕ</div>
        <div class="controls-grid">
          <div><kbd>WASD</kbd><span>камера</span></div>
          <div><kbd>Q / E</kbd><span>поворот</span></div>
          <div><kbd>Z X C V</kbd><span>команды</span></div>
          <div><kbd>F</kbd><span>атака по площади</span></div>
          <div><kbd>R</kbd><span>ремонт</span></div>
          <div><kbd>Пробел</kbd><span>на базу</span></div>
          <div><kbd>Esc</kbd><span>продолжить</span></div>
        </div>
      </div>
      ${this.graphicsBlock()}
      <div class="overlay-actions">
        <button class="btn-primary" data-action="resume">ПРОДОЛЖИТЬ <span>→</span></button>
        <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        <button class="btn-ghost" data-action="restart">ЗАНОВО</button>
        <button class="btn-ghost" data-action="newmap">НОВАЯ КАРТА</button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ПАУЗА · КАРТА #${map.label}</span>
        <span>СИМУЛЯЦИЯ ОСТАНОВЛЕНА</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--pause');
  }

  resume() {
    if (this.game.over) return;
    document.activeElement?.blur?.();
    if (this.game.started) this.game.setPaused(false);
    this.overlayOpen = false;
    this.el.overlay.classList.remove('is-open');
    document.body.classList.remove('overlay-open');
  }

  startGame() {
    document.activeElement?.blur?.();
    this.overlayOpen = false;
    this.el.overlay.classList.remove('is-open');
    document.body.classList.remove('overlay-open');
    this.game.begin();
    this.renderHeader();
    this.renderCommands();
    this.drawMinimap();
  }

  /** Перезагружает игру с новым случайным сидом карты. */
  newMap() {
    document.activeElement?.blur?.();
    window.location.assign(seedUrl(randomSeed()));
  }

  // --------------------------------------------------------------- changelog
  /** Открывает журнал изменений, запоминая, куда вернуться по кнопке «Назад». */
  openChangelog() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    const back = this.game.over
      ? () => this.showEnd(this.game.over)
      : this.game.started
        ? () => this.openPause()
        : () => this.showStart();
    this.overlayBack = back;
    this.showChangelog();
  }

  backFromOverlay() {
    const back = this.overlayBack;
    this.overlayBack = null;
    if (back) back();
    else this.resume();
  }

  showChangelog() {
    const releases = CHANGELOG.map((release) => {
      const sections = release.sections.map((section) => `
        <div class="log-section">
          <div class="log-section-title">${esc(section.title)}</div>
          <ul class="log-list">${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </div>`).join('');
      const meta = release.date ?? release.tag ?? '';
      return `
        <article class="log-release${release.current ? ' is-current' : ''}">
          <div class="log-head">
            <b>${esc(release.version)}</b>
            <span>${esc(meta)}</span>
          </div>
          ${sections}
        </article>`;
    }).join('');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ЖУРНАЛ ИЗМЕНЕНИЙ</div>
        <h1 class="log-title">ЧТО НОВОГО</h1>
        <p class="tagline">История обновлений «Гелиос-7». Текущая сборка — ${esc(GAME_VERSION)}.</p>
      </div>
      <div class="log-body">${releases}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">НАЗАД <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ЖУРНАЛ ИЗМЕНЕНИЙ</span>
        <span>ПОЛНАЯ ИСТОРИЯ — CHANGELOG.MD В РЕПОЗИТОРИИ</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--changelog');
  }

  hideOverlay() {
    this.overlayOpen = false;
    this.el.overlay.classList.remove('is-open');
    document.body.classList.remove('overlay-open');
  }

  setOverlay(html, variant) {
    this.el.overlayCard.className = `overlay-card ${variant ?? ''}`;
    this.el.overlayCard.innerHTML = html;
    this.el.overlay.className = `overlay is-open ${variant ?? ''}`;
    this.overlayOpen = true;
    document.body.classList.add('overlay-open');
  }

  // --------------------------------------------------------------- graphics
  graphicsBlock() {
    const values = this.game.graphics?.get?.() ?? {};
    const rows = Object.entries(GRAPHICS_OPTIONS).map(([key, options]) => {
      const label = GRAPHICS_LABELS[key] ?? key;
      const buttons = options.map((option) => {
        const active = values[key] === option.value;
        return `<button type="button" class="graphics-opt${active ? ' is-active' : ''}" data-graphics="${key}" data-value="${option.value}" aria-pressed="${active}">${option.label}</button>`;
      }).join('');
      return `
        <div class="graphics-row">
          <span class="graphics-label">${label}</span>
          <div class="graphics-options">${buttons}</div>
        </div>`;
    }).join('');
    return `
      <div class="graphics-block">
        <div class="controls-title">ГРАФИКА <span>// сохраняется в браузере</span></div>
        <div class="graphics-grid">${rows}</div>
      </div>`;
  }

  refreshGraphicsControls() {
    const values = this.game.graphics?.get?.();
    if (!values) return;
    this.el.overlay.querySelectorAll('[data-graphics]').forEach((btn) => {
      const active = values[btn.dataset.graphics] === btn.dataset.value;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  // --------------------------------------------------------------- messages
  message(text, kind = 'info', duration = 4.5) {
    if (!this.el.feed) return;
    while (this.el.feed.children.length >= 5) this.el.feed.lastElementChild?.remove();
    const node = document.createElement('div');
    node.className = `msg msg--${kind}`;
    const ico = kind === 'danger' ? 'attack' : kind === 'success' ? 'target' : kind === 'warn' ? 'bolt' : 'flag';
    node.innerHTML = `<span class="msg-ico">${icon(ico)}</span><span class="msg-text">${esc(text)}</span>`;
    this.el.feed.prepend(node);
    requestAnimationFrame(() => node.classList.add('in'));
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 350);
    }, Math.max(1.6, duration) * 1000);
  }

  alert() {
    const node = this.el.alert;
    if (!node) return;
    node.classList.remove('active');
    void node.offsetWidth;
    node.classList.add('active');
    setTimeout(() => node.classList.remove('active'), 1100);
  }

  hitIndicator(entity) {
    if (!this.game.selected.has(entity)) return;
    const panel = this.el.selectionBody.closest('.panel');
    if (!panel) return;
    panel.classList.remove('hit');
    void panel.offsetWidth;
    panel.classList.add('hit');
    setTimeout(() => panel.classList.remove('hit'), 220);
  }

  // --------------------------------------------------------------- commands
  buildCommands() {
    const game = this.game;
    const units = game.selectedUnits();
    const buildings = game.selectedBuildings();

    if (units.length) {
      const hasEngineer = units.some((u) => u.def.builder);
      const commands = [
        {
          id: 'attackmove',
          label: 'Атака по площади',
          short: 'АТАКА',
          icon: 'attack',
          hotkey: 'F',
          desc: 'Двигаться к точке, атакуя всех врагов на пути.',
          action: () => {
            if (game.input) game.input.setAttackMove(true);
          },
        },
        {
          id: 'stop',
          label: 'Стоп',
          short: 'СТОП',
          icon: 'stop',
          hotkey: hasEngineer ? 'B' : 'X',
          desc: 'Остановить выбранных юнитов и сбросить приказ.',
          action: () => game.commandStop(),
        },
      ];
      if (hasEngineer) {
        BUILD_ORDER.forEach((type, i) => commands.push(this.buildCommand(type, BUILD_HOTKEYS[i])));
      }
      return commands;
    }

    if (!buildings.length) return [];
    const b = buildings[0];

    if (!b.complete && b.faction === 'player') {
      return [{
        id: 'cancelbuild',
        label: 'Отменить постройку',
        short: 'ОТМЕНА',
        icon: 'close',
        hotkey: 'X',
        desc: `Отменить строительство «${b.def.name}» и вернуть 60% стоимости.`,
        action: () => b.cancelConstruction(true),
      }];
    }

    if (b.faction !== 'player') return [];

    const repair = this.repairCommand(buildings);

    if (b.type === 'hq') {
      const commands = BUILD_ORDER.map((type, i) => this.buildCommand(type, BUILD_HOTKEYS[i]));
      HQ_TRAIN_ORDER.forEach((type, i) => {
        commands.push(this.trainCommand(type, b, HQ_TRAIN_HOTKEYS[i]));
      });
      if (repair) commands.push(repair);
      return commands;
    }

    if (b.type === 'barracks') {
      const commands = TRAIN_ORDER.map((type, i) => this.trainCommand(type, b, TRAIN_HOTKEYS[i]));
      if (repair) commands.push(repair);
      return commands;
    }

    if (b.type === 'lab') {
      const commands = UPGRADE_ORDER.map((key, i) => this.upgradeCommand(key, b, BUILD_HOTKEYS[i]));
      if (repair) commands.push(repair);
      return commands;
    }

    return repair ? [repair] : [];
  }

  buildCommand(type, hotkey) {
    const game = this.game;
    const def = BUILDINGS[type];
    const freePatch = type === 'derrick' && !game.world.oilPatches.some((p) => !p.derrick || !p.derrick.alive);
    const disabled = game.credits < def.cost || freePatch;
    return {
      id: `build:${type}`,
      label: def.name,
      short: def.name.toUpperCase(),
      icon: def.icon,
      hotkey,
      cost: def.cost,
      desc: def.desc,
      kind: 'build',
      disabled,
      reason: freePatch ? 'Нет свободных нефтяных месторождений.' : `Недостаточно кредитов. Нужно ${def.cost}.`,
      action: () => game.startPlacement(type),
      tip: this.buildTip(def),
    };
  }

  trainCommand(type, building, hotkey) {
    const game = this.game;
    const def = UNITS[type];
    const queueFull = building.queue.length >= building.maxQueue;
    const supply = def.supply ?? 1;
    const cap = game.getArmyUsed('player') + game.getQueuedSupply('player') + supply > game.getArmyCap('player');
    const disabled = !building.complete || queueFull || game.credits < def.cost || cap;
    return {
      id: `train:${type}`,
      label: def.name,
      short: def.name.toUpperCase(),
      icon: def.icon,
      hotkey,
      cost: def.cost,
      supply,
      desc: def.desc,
      kind: 'train',
      disabled,
      reason: !building.complete ? MESSAGES.notReady
        : queueFull ? MESSAGES.queueFull
          : cap ? MESSAGES.capReached
            : `Недостаточно кредитов. Нужно ${def.cost}.`,
      action: () => {
        if (game.trainUnit(type, building)) {
          this.renderSelection();
          this.renderCommands();
        }
      },
      tip: this.unitTip(def),
    };
  }

  upgradeCommand(key, building, hotkey) {
    const game = this.game;
    const def = UPGRADES[key];
    const done = game.upgrades.player.has(key);
    const queued = building.queue.some((item) => item.upgrade === key);
    const queueFull = building.queue.length >= building.maxQueue;
    const disabled = !building.complete || done || queued || queueFull || game.credits < def.cost;
    const reason = !building.complete ? MESSAGES.notReady
      : done ? 'Улучшение уже изучено.'
        : queued ? 'Улучшение уже исследуется.'
          : queueFull ? MESSAGES.queueFull
            : `Недостаточно кредитов. Нужно ${def.cost}.`;
    return {
      id: `research:${key}`,
      label: def.name,
      short: def.name.toUpperCase(),
      icon: def.icon,
      hotkey,
      cost: def.cost,
      desc: def.desc,
      kind: 'research',
      disabled,
      reason,
      action: () => {
        if (game.startUpgrade(building, key)) {
          this.renderSelection();
          this.renderCommands();
        }
      },
      tip: this.upgradeTip(def, done, queued),
    };
  }

  upgradeTip(def, done, queued) {
    const labels = {
      damage: 'УРОН',
      hp: 'ПРОЧНОСТЬ',
      range: 'ДАЛЬНОСТЬ',
      speed: 'СКОРОСТЬ',
      armor: 'БРОНЯ',
    };
    const effects = Object.entries(def.effects).map(([stat, value]) => {
      const text = stat === 'armor' ? `+${value}` : `+${Math.round((value - 1) * 100)}%`;
      return `<span><i>${labels[stat] ?? stat.toUpperCase()}</i>${text}</span>`;
    }).join('');
    const state = done ? 'уже изучено' : queued ? 'уже в очереди' : 'техцентр';
    return `
      <div class="tip-head"><span class="tip-role">ИССЛЕДОВАНИЕ</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">${effects}</div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.time} с · ${state}</span></div>
    `;
  }

  repairCommand(buildings) {
    const damaged = buildings.filter((b) => b.complete && b.hp < b.maxHp - 0.5);
    if (!damaged.length) return null;
    const repairing = damaged.some((b) => b.repairing);
    return {
      id: 'repair',
      label: repairing ? 'Остановить ремонт' : 'Ремонт',
      short: repairing ? 'СТОП РЕМОНТ' : 'РЕМОНТ',
      icon: 'repair',
      hotkey: 'R',
      desc: 'Восстанавливать прочность здания за кредиты. Пока ремонт идёт, кредиты расходуются постепенно.',
      kind: 'repair',
      disabled: false,
      action: () => this.game.toggleRepair(damaged),
      tip: this.repairTip(damaged),
    };
  }

  repairTip(buildings) {
    const game = this.game;
    const b = buildings[0];
    const rate = game.repairRate(b);
    const perHp = game.repairCostPerHp(b);
    const full = buildings.reduce((sum, item) => sum + game.repairFullCost(item), 0);
    const repairing = buildings.some((item) => item.repairing);
    return `
      <div class="tip-head"><span class="tip-role">ИНЖЕНЕРНАЯ СЛУЖБА</span><b>Ремонт</b></div>
      <p>Восстанавливает прочность выбранных зданий. Кредиты списываются только за реально полученные HP, ремонт можно остановить в любой момент.</p>
      <div class="tip-stats">
        <span><i>+HP/С</i>${rate.toFixed(1)}</span>
        <span><i>ЦЕНА/HP</i>${perHp.toFixed(2)}</span>
        <span><i>ПОЛНОСТЬЮ</i>${full}</span>
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${full}</span><span>${repairing ? 'ремонт идёт' : 'горячая клавиша R'}</span></div>
    `;
  }

  unitTip(def) {
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${def.hp}</span><span><i>УРОН</i>${def.damage}</span>
        <span><i>ДАЛЬНОСТЬ</i>${def.range}</span><span><i>СКОРОСТЬ</i>${def.speed}</span>
        <span><i>ЛИМИТ АРМИИ</i>${def.supply ?? 1}</span>
        ${def.builder ? '<span><i>СТРОЙКА</i>до ×4</span>' : ''}
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.buildTime} с · ${def.from === 'barracks' ? 'казармы' : 'штаб'}</span></div>
    `;
  }

  buildTip(def) {
    const power = def.powerProduce ? `+${def.powerProduce}` : def.powerUse ? `−${def.powerUse}` : '';
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${def.hp}</span>${power ? `<span><i>ЭНЕРГИЯ</i>${power}</span>` : ''}
        ${def.income ? `<span><i>ДОХОД</i>${def.income}/с</span>` : ''}
        ${def.armyCap ? `<span><i>ЛИМИТ АРМИИ</i>+${def.armyCap}</span>` : ''}
        ${def.defense ? `<span><i>УРОН</i>${def.defense.damage}</span><span><i>ДАЛЬНОСТЬ</i>${def.defense.range}</span>` : ''}
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.buildTime} с · нужны инженеры рядом</span></div>
    `;
  }

  renderCommands() {
    const old = this.el.commands.innerHTML;
    this.commands = this.buildCommands();
    this.commandMap = new Map(this.commands.map((c) => [c.id, c]));
    const dense = this.commands.length > 8;
    this.el.commands.classList.toggle('is-dense', dense);
    // В плотном режиме на ПК помещаются пять колонок, на мобильных — четыре.
    const columns = dense ? 5 : 4;
    const slots = Math.max(8, Math.ceil(this.commands.length / columns) * columns);
    let html = '';
    for (let i = 0; i < slots; i++) {
      const cmd = this.commands[i];
      if (cmd) {
        html += `
          <button class="cmd ${cmd.disabled ? 'is-disabled' : ''}" data-cmd-id="${cmd.id}" aria-disabled="${cmd.disabled ? 'true' : 'false'}">
            <span class="cmd-key">${cmd.hotkey}</span>
            <span class="cmd-icon">${icon(cmd.icon)}</span>
            <span class="cmd-label">${cmd.label}</span>
            ${cmd.cost ? `<span class="cmd-cost">${icon('credits')} ${cmd.cost}</span>` : `<span class="cmd-cost cmd-cost--free">${cmd.kind === 'train' ? 'НАЁМ' : 'ПРИКАЗ'}</span>`}
          </button>`;
      } else {
        html += `<div class="cmd cmd--empty" aria-hidden="true"><span class="cmd-empty-mark">+</span></div>`;
      }
    }
    if (!this.commands.length) {
      html = `<div class="cmd-empty-state"><span class="ce-icon">${icon('target')}</span><b>НЕТ ДОСТУПНЫХ КОМАНД</b><small>Выберите командный центр или казармы,<br>либо группу юнитов.</small></div>`;
    }
    if (html !== old) this.el.commands.innerHTML = html;
    if (html !== old) this.hideTooltip();

    const selTag = this.game.selectionSummary?.() ?? '';
    this.el.cmdStatus.textContent = this.commands.length
      ? (this.commands[0].kind === 'train' ? 'ПРОИЗВОДСТВО'
        : this.commands[0].kind === 'build' ? 'СТРОИТЕЛЬСТВО'
          : this.commands[0].kind === 'research' ? 'ИССЛЕДОВАНИЯ'
            : 'ПРИКАЗЫ')
      : 'ОЖИДАНИЕ';
  }

  triggerHotkey(key) {
    const cmd = this.commands.find((c) => c.hotkey === key);
    if (!cmd) return false;
    if (cmd.disabled) {
      this.game.notify(cmd.reason || 'Недоступно.', 'warn', `cmd-${cmd.id}`, 0, 3);
      return true;
    }
    cmd.action();
    this.renderCommands();
    return true;
  }

  // --------------------------------------------------------------- selection
  onSelectionChanged() {
    this.hideTooltip();
    this.renderSelection();
    this.renderCommands();
    this.renderHeader();
    this.lastSignature = this.selectionSignature();
  }

  onQueueChanged(building) {
    if (this.game.selected.has(building)) {
      this.renderSelection();
      this.renderCommands();
    }
  }

  selectionSignature() {
    const game = this.game;
    const sel = [...game.selected];
    if (!sel.length) return 'empty';
    return sel.map((e) => `${e.id}:${e.complete ? 1 : 0}:${e.queue?.length ?? 0}:${Math.round((e.hp / e.maxHp) * 20)}`).join('|');
  }

  renderSelection() {
    const game = this.game;
    const units = game.selectedUnits();
    const buildings = game.selectedBuildings();
    const body = this.el.selectionBody;

    if (!units.length && !buildings.length) {
      this.el.selTitle.textContent = 'НЕТ ВЫБОРА';
      this.el.selTag.textContent = '—';
      body.innerHTML = `
        <div class="sel-empty">
          <div class="sel-empty-icon">${icon('target')}</div>
          <div><b>Сектор не выбран</b><p>Выберите юнита или здание левой кнопкой мыши. Рамкой можно выделить группу.</p></div>
        </div>`;
      this.lastSignature = 'empty';
      return;
    }

    if (units.length) {
      const counts = new Map();
      for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
      const types = [...counts.keys()];
      const primary = units[0];
      const def = primary.def;
      const totalHp = units.reduce((s, u) => s + u.hp, 0);
      const totalMax = units.reduce((s, u) => s + u.maxHp, 0);
      const same = types.length === 1;
      const name = same ? def.name : 'Смешанная группа';
      const count = units.length;
      const pct = clamp((totalHp / totalMax) * 100, 0, 100);
      this.el.selTitle.textContent = same ? `${def.name}${count > 1 ? ` ×${count}` : ''}` : `Группа ×${count}`;
      this.el.selTag.textContent = `${count} ${plural(count, 'ЮНИТ', 'ЮНИТА', 'ЮНИТОВ')}`;
      const chips = types.length > 1
        ? `<div class="type-chips">${types.map((t) => `<span class="type-chip">${icon(UNITS[t].icon)} ${UNITS[t].name} <b>×${counts.get(t)}</b></span>`).join('')}</div>`
        : '';
      const upgradeKey = same
        ? Object.keys(UPGRADES).find((key) => UPGRADES[key].target === primary.type
          && this.game.upgrades.player.has(key))
        : null;
      const upgradeChip = upgradeKey
        ? `<span class="chip chip--research">${icon('research')} ${UPGRADES[upgradeKey].name}</span>`
        : '';
      body.innerHTML = `
        <div class="sel-main">
          <div class="portrait" style="--accent:${FACTIONS.player.color}">
            ${icon(def.icon)}
            ${count > 1 ? `<span class="portrait-count">×${count}</span>` : ''}
            <span class="portrait-faction">ГЕЛИОС-7</span>
          </div>
          <div class="sel-info">
            <div class="sel-role">${same ? def.role : 'СМЕШАННЫЙ ОТРЯД'} · <span class="sel-owner">ИГРОК</span></div>
            <div class="sel-name">${name}${same && count > 1 ? ` <em>×${count}</em>` : ''}</div>
            <div class="hpbar"><i style="width:${pct}%"></i><b>${Math.ceil(totalHp)} / ${totalMax}</b></div>
            ${same ? `<div class="sel-stats">
              <span>УРОН <b>${Math.round(primary.damage ?? def.damage)}</b></span>
              <span>ДАЛЬНОСТЬ <b>${Math.round(primary.range ?? def.range)}</b></span>
              <span>СКОРОСТЬ <b>${(primary.speed ?? def.speed).toFixed(1)}</b></span>
              <span>ЛИМИТ <b>${def.supply ?? 1}</b></span>
            </div>` : `<div class="sel-note">В отряде несколько типов юнитов. Наведите на карточку найма для характеристик.</div>`}
            ${chips}
            ${upgradeChip}
          </div>
          ${this.sideStatus()}
        </div>
        <div class="sel-foot"><span class="dot"></span> ЛКМ — уточнить · ПКМ — приказ · F — атака по площади</div>
      `;
      this.live = { kind: 'units', units, hpFill: body.querySelector('.hpbar i'), hpText: body.querySelector('.hpbar b') };
      this.lastSignature = this.selectionSignature();
      return;
    }

    const b = buildings[0];
    const def = b.def;
    const pct = clamp((b.hp / b.maxHp) * 100, 0, 100);
    const constructionCount = b.builderCount ?? 0;
    const status = !b.complete
      ? (constructionCount
        ? { text: `СТРОИТСЯ ${Math.floor(b.construction * 100)}% · ИНЖ. ${constructionCount}`, cls: 'warn' }
        : { text: `ЖДЁТ ИНЖЕНЕРОВ ${Math.floor(b.construction * 100)}%`, cls: 'accent' })
      : b.repairing
        ? { text: 'РЕМОНТ', cls: 'accent' }
        : b.type === 'turret'
          ? (b.defenseTarget?.alive ? { text: 'ВЕДЁТ ОГОНЬ', cls: 'warn' } : { text: 'ОХРАНА', cls: 'ok' })
          : b.queue.length
            ? {
              text: b.type === 'lab'
                ? `ИССЛЕДОВАНИЕ ${Math.floor((1 - b.queue[0].remaining / b.queue[0].total) * 100)}%`
                : `ОЧЕРЕДЬ ${b.queue.length}`,
              cls: 'accent',
            }
            : { text: 'ГОТОВО', cls: 'ok' };
    this.el.selTitle.textContent = def.name + (buildings.length > 1 ? ` ×${buildings.length}` : '');
    this.el.selTag.textContent = b.faction === 'player' ? 'ЗДАНИЕ' : 'ПРОТИВНИК';

    const powerChip = def.powerProduce
      ? `<span class="chip chip--power">${icon('bolt')} +${def.powerProduce}</span>`
      : def.powerUse
        ? `<span class="chip chip--power-use">${icon('bolt')} −${def.powerUse}</span>`
        : '';
    const incomeChip = def.income ? `<span class="chip chip--income">${icon('credits')} ${def.income}/с</span>` : '';
    const armyChip = def.armyCap ? `<span class="chip chip--army">${icon('army')} +${def.armyCap} ЛИМИТ</span>` : '';
    const defenseChip = def.defense
      ? `<span class="chip chip--defense">${icon('turret')} ${def.defense.damage} УРОН · ${def.defense.range} ДАЛЬН.</span>`
      : '';
    const repairChip = b.repairing
      ? `<span class="chip chip--repair">${icon('repair')} +${this.game.repairRate(b).toFixed(1)} HP/с</span>`
      : '';
    const researchChip = b.type === 'lab' && b.faction === 'player'
      ? `<span class="chip chip--research">${icon('research')} ИЗУЧЕНО ${this.game.upgrades.player.size}/${Object.keys(UPGRADES).length}</span>`
      : '';
    const queueHTML = this.renderQueue(b);
    const buildHTML = !b.complete
      ? `<button class="btn-small btn-cancel-build" data-cancel-build>ОТМЕНИТЬ ПОСТРОЙКУ · ВОЗВРАТ 60%</button>`
      : '';

    body.innerHTML = `
      <div class="sel-main">
        <div class="portrait" style="--accent:${FACTIONS[b.faction].color}">
          ${icon(def.icon)}
          <span class="portrait-faction">${FACTIONS[b.faction].short}</span>
        </div>
        <div class="sel-info">
          <div class="sel-role">${def.role} · <span class="sel-owner">${FACTIONS[b.faction].name}</span></div>
          <div class="sel-name">${def.name}${buildings.length > 1 ? ` <em>×${buildings.length}</em>` : ''}</div>
          <div class="hpbar"><i style="width:${pct}%"></i><b>${Math.ceil(b.hp)} / ${b.maxHp}</b></div>
          <div class="chips">
            <span class="chip chip--status ${status.cls}"><i></i>${status.text}</span>
            ${powerChip}
            ${incomeChip}
            ${armyChip}
            ${defenseChip}
            ${repairChip}
            ${researchChip}
          </div>
        </div>
        ${this.sideStatus()}
      </div>
      ${b.type === 'barracks' || b.type === 'hq' || b.type === 'lab' ? queueHTML : ''}
      ${buildHTML}
      <div class="sel-foot"><span class="dot"></span> ${b.type === 'barracks'
        ? 'ПКМ по земле — точка сбора · клик по очереди — отмена · R — ремонт'
        : b.type === 'hq'
          ? 'ПКМ по месторождению — быстрая нефтяная вышка · R — ремонт'
          : b.type === 'lab'
            ? 'Исследования — на панели команд · клик по очереди — отмена · R — ремонт'
            : 'Пассивное строение · R — ремонт'}</div>
    `;
    this.live = {
      kind: 'building',
      building: b,
      hpFill: body.querySelector('.hpbar i'),
      hpText: body.querySelector('.hpbar b'),
      statusChip: body.querySelector('.chip--status'),
      progressRow: body.querySelector('.q-progress i'),
      queue: b.queue,
    };
    this.lastSignature = this.selectionSignature();
  }

  sideStatus() {
    const s = this.game.getStatus();
    const income = this.game.playerIncome();
    const deficit = s.power.used > s.power.produced;
    return `
      <div class="sel-side">
        <div><span>ДОХОД</span><b>+${income.toFixed(1)}/с</b></div>
        <div><span>СЕТЬ</span><b class="${deficit ? 'bad' : ''}">${s.power.produced}/${s.power.used}</b></div>
        <div><span>ЛИМИТ</span><b>${s.army}/${s.cap}</b></div>
      </div>`;
  }

  renderQueue(b) {
    if (!b.queue.length) {
      const emptyLabel = b.type === 'lab' ? 'ВЫБЕРИТЕ УЛУЧШЕНИЕ' : 'ГОТОВ К НАЙМУ';
      return `<div class="queue queue--empty"><span>Очередь производства пуста</span><span>${b.complete ? emptyLabel : 'ИДЁТ СТРОЙКА'}</span></div>`;
    }
    const items = b.queue.map((item, i) => {
      const def = item.upgrade ? UPGRADES[item.upgrade] : UNITS[item.type];
      const progress = i === 0 ? (1 - item.remaining / item.total) * 100 : 0;
      const time = i === 0 ? item.remaining : item.total;
      return `
        <button class="queue-item" data-cancel-queue="${i}" title="Отменить и вернуть кредиты">
          <span class="q-icon">${icon(def.icon)}</span>
          <span class="q-name">${def.name}</span>
          <span class="q-progress"><i style="width:${clamp(progress, 0, 100)}%"></i></span>
          <span class="q-time">${formatTime(time)}</span>
          <span class="q-x">×</span>
        </button>`;
    }).join('');
    return `
      <div class="queue">
        <div class="queue-head"><span>ОЧЕРЕДЬ ПРОИЗВОДСТВА</span><span>${b.queue.length} / ${b.maxQueue}</span></div>
        <div class="queue-list">${items}</div>
      </div>`;
  }

  // --------------------------------------------------------------- header
  renderHeader() {
    const s = this.game.getStatus();
    this.el.credits.textContent = s.credits;
    this.el.power.textContent = `${s.power.produced} / ${s.power.used}`;
    this.el.army.textContent = `${s.army} / ${s.cap}`;
    this.el.army.parentElement.title = `Лимит армии: занято ${s.army} из ${s.cap}. Юнитов: ${s.units}.`;
    this.el.clock.textContent = formatTime(s.time);
    const deficit = s.power.used > s.power.produced;
    this.el.resPower.classList.toggle('is-deficit', deficit);
    this.el.gridStatus.textContent = deficit ? 'ДЕФИЦИТ ЭНЕРГИИ' : 'СЕТЬ В НОРМЕ';
    this.el.gridStatus.classList.toggle('is-deficit', deficit);
    this.el.resPower.title = `Энергия: произведено ${s.power.produced}, потреблено ${s.power.used}${deficit ? '. Производство замедлено.' : '.'}`;
  }

  // --------------------------------------------------------------- tick
  tick(dt) {
    this.tickAcc += dt;
    if (this.tickAcc < 0.16) return;
    this.tickAcc = 0;
    this.renderHeader();
    this.drawMinimap();

    // Обновление живых значений выбранного объекта.
    if (this.live) {
      if (this.live.kind === 'units') {
        const units = this.live.units.filter((u) => u.alive);
        if (units.length) {
          const hp = units.reduce((a, u) => a + u.hp, 0);
          const max = units.reduce((a, u) => a + u.maxHp, 0);
          if (this.live.hpFill) this.live.hpFill.style.width = `${clamp((hp / max) * 100, 0, 100)}%`;
          if (this.live.hpText) this.live.hpText.textContent = `${Math.ceil(hp)} / ${max}`;
        }
      } else if (this.live.kind === 'building') {
        const b = this.live.building;
        if (b.alive) {
          if (this.live.hpFill) this.live.hpFill.style.width = `${clamp((b.hp / b.maxHp) * 100, 0, 100)}%`;
          if (this.live.hpText) this.live.hpText.textContent = `${Math.ceil(b.hp)} / ${b.maxHp}`;
          if (this.live.statusChip) {
            const builders = b.builderCount ?? 0;
            const text = !b.complete
              ? (builders
                ? `СТРОИТСЯ ${Math.floor(b.construction * 100)}% · ИНЖ. ${builders}`
                : `ЖДЁТ ИНЖЕНЕРОВ ${Math.floor(b.construction * 100)}%`)
              : b.repairing
                ? 'РЕМОНТ'
                : b.type === 'turret'
                  ? (b.defenseTarget?.alive ? 'ВЕДЁТ ОГОНЬ' : 'ОХРАНА')
                  : b.queue.length
                    ? (b.type === 'lab'
                      ? `ИССЛЕДОВАНИЕ ${Math.floor((1 - b.queue[0].remaining / b.queue[0].total) * 100)}%`
                      : `ОЧЕРЕДЬ ${b.queue.length}`)
                    : 'ГОТОВО';
            const dot = this.live.statusChip.querySelector('i');
            this.live.statusChip.innerHTML = `<i></i>${text}`;
          }
          if (this.live.progressRow && b.queue[0]) {
            const item = b.queue[0];
            this.live.progressRow.style.width = `${clamp((1 - item.remaining / item.total) * 100, 0, 100)}%`;
          }
        }
      }
    }

    // при изменении структуры выбранного здания перерисовываем карточку
    if (this.game.selected.size && this.selectionSignature() !== this.lastSignature) {
      this.selectionAcc += 0.16;
      if (this.selectionAcc > 0.5) {
        this.selectionAcc = 0;
        this.renderSelection();
        this.renderCommands();
      }
    }
    this.updateCommandAvailability();
  }

  updateCommandAvailability() {
    const credits = this.game.credits;
    const buttons = this.el.commands.querySelectorAll('.cmd[data-cmd-id]');
    buttons.forEach((btn) => {
      const cmd = this.commandMap.get(btn.dataset.cmdId);
      if (!cmd) return;
      let disabled = !!cmd.disabled;
      if (!disabled && cmd.cost) disabled = credits < cmd.cost;
      btn.classList.toggle('is-disabled', disabled);
      btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
  }

  // --------------------------------------------------------------- tooltip
  showTooltip(btn, cmd) {
    if (!cmd.tip) return;
    this.el.tooltip.innerHTML = cmd.tip;
    this.el.tooltip.classList.add('is-visible');
    const rect = btn.getBoundingClientRect();
    const width = 270;
    let left = rect.left + rect.width / 2 - width / 2;
    left = clamp(left, 12, window.innerWidth - width - 12);
    this.el.tooltip.style.left = `${left}px`;
    this.el.tooltip.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    this.tooltipVisible = true;
  }

  hideTooltip() {
    this.el.tooltip.classList.remove('is-visible');
    this.tooltipVisible = false;
  }

  // --------------------------------------------------------------- minimap
  buildMinimapBackground() {
    const size = 512;
    const map = this.game.map;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const rng = mulberry32((map.seed ^ 0x51c70) >>> 0);
    ctx.fillStyle = '#060d12';
    ctx.fillRect(0, 0, size, size);

    // игровое поле
    const margin = 10;
    const w = size - margin * 2;
    const field = ctx.createRadialGradient(size / 2, size / 2, 30, size / 2, size / 2, w * 0.72);
    field.addColorStop(0, map.style.minimap);
    field.addColorStop(0.65, map.style.minimap);
    field.addColorStop(1, map.style.minimapFar);
    ctx.fillStyle = field;
    ctx.fillRect(margin, margin, w, w);

    // пятна рельефа
    for (let i = 0; i < 90; i++) {
      const x = margin + rng() * w;
      const y = margin + rng() * w;
      const r = 10 + rng() * 44;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() > 0.5;
      g.addColorStop(0, dark ? 'rgba(26,42,41,0.55)' : 'rgba(42,53,44,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // сетка
    ctx.strokeStyle = 'rgba(79,210,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const p = margin + (w / 8) * i;
      ctx.beginPath();
      ctx.moveTo(p, margin);
      ctx.lineTo(p, size - margin);
      ctx.moveTo(margin, p);
      ctx.lineTo(size - margin, p);
      ctx.stroke();
    }

    const toMap = (x, z) => ({
      x: margin + ((x + MAP.half) / (MAP.half * 2)) * w,
      y: margin + ((z + MAP.half) / (MAP.half * 2)) * w,
    });

    // камни
    for (const rock of this.game.world.rocks) {
      const p = toMap(rock.x, rock.z);
      ctx.fillStyle = 'rgba(88,100,93,0.75)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 + rock.radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // руины стен
    ctx.strokeStyle = 'rgba(172,160,136,0.85)';
    ctx.lineWidth = 3;
    for (const wall of this.game.world.walls ?? []) {
      const a = toMap(wall.x1, wall.z1);
      const b = toMap(wall.x2, wall.z2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // месторождения
    for (const patch of this.game.world.oilPatches) {
      const p = toMap(patch.x, patch.z);
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9, 7, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,176,46,0.8)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // приглушённые зоны баз
    for (const faction of ['player', 'enemy']) {
      const hq = this.game.buildings.find((b) => b.faction === faction && b.type === 'hq');
      if (!hq) continue;
      const p = toMap(hq.position.x, hq.position.z);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 58);
      g.addColorStop(0, faction === 'player' ? 'rgba(79,210,255,0.16)' : 'rgba(255,107,74,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 58, p.y - 58, 116, 116);
    }

    this.minimapBg = canvas;
  }

  /** Направление взгляда камеры в мировых координатах. */
  minimapBasis() {
    const camera = this.game.camera;
    if (!camera) return { fx: 1, fz: 0 };
    const fx = camera.target.x - camera.position.x;
    const fz = camera.target.z - camera.position.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) return { fx: 1, fz: 0 };
    return { fx: fx / len, fz: fz / len };
  }

  worldToMinimap(x, z) {
    const s = (512 - 20) / (MAP.half * 2);
    const { fx, fz } = this.minimapBasis();
    // Карта поворачивается вместе с камерой: её верх — направление взгляда,
    // а право — экранное право. Так лево/право на карте совпадают с видом.
    return {
      x: 256 + s * (fz * x - fx * z),
      y: 256 - s * (fx * x + fz * z),
    };
  }

  drawMinimapChrome(ctx) {
    const margin = 10;
    const w = 512 - margin * 2;
    const c = 18;
    ctx.strokeStyle = 'rgba(79,210,255,0.28)';
    ctx.lineWidth = 2;
    ctx.strokeRect(margin, margin, w, w);
    ctx.strokeStyle = 'rgba(79,210,255,0.6)';
    ctx.lineWidth = 3;
    for (const [x, y, dx, dy] of [
      [margin, margin, 1, 1],
      [512 - margin, margin, -1, 1],
      [margin, 512 - margin, 1, -1],
      [512 - margin, 512 - margin, -1, -1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * c);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(79,210,255,0.25)';
    ctx.font = '600 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`#${this.game.map.label}`, 512 - 26, 512 - 24);
  }

  viewportPolygon() {
    const scene = this.game.scene;
    const camera = this.game.camera;
    if (!scene || !camera) return null;
    const engine = scene.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    let points = [];
    for (const [sx, sy] of corners) {
      const ray = scene.createPickingRay(sx, sy, Matrix.Identity(), camera);
      if (Math.abs(ray.direction.y) < 1e-4) continue;
      const t = -ray.origin.y / ray.direction.y;
      if (t <= 0) continue;
      points.push({
        x: ray.origin.x + ray.direction.x * t,
        z: ray.origin.z + ray.direction.z * t,
      });
    }
    if (points.length < 3) return null;

    // Отсекаем полигон обзора по границам карты, а не приклеиваем углы к краю.
    const clip = (poly, inside, intersect) => {
      if (!poly.length) return poly;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ain = inside(a);
        const bin = inside(b);
        if (ain) out.push(a);
        if (ain !== bin) out.push(intersect(a, b));
      }
      return out;
    };
    const lerpX = (a, b, x) => {
      const t = (x - a.x) / (b.x - a.x || 1e-9);
      return { x, z: a.z + (b.z - a.z) * t };
    };
    const lerpZ = (a, b, z) => {
      const t = (z - a.z) / (b.z - a.z || 1e-9);
      return { x: a.x + (b.x - a.x) * t, z };
    };
    const min = -MAP.half;
    const max = MAP.half;
    points = clip(points, (p) => p.x >= min, (a, b) => lerpX(a, b, min));
    points = clip(points, (p) => p.x <= max, (a, b) => lerpX(a, b, max));
    points = clip(points, (p) => p.z >= min, (a, b) => lerpZ(a, b, min));
    points = clip(points, (p) => p.z <= max, (a, b) => lerpZ(a, b, max));
    if (points.length < 3) return null;
    return points.map((p) => this.worldToMinimap(p.x, p.z));
  }

  drawMinimap() {
    const ctx = this.mmCtx;
    if (!ctx || !this.minimapBg) return;
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = this.game.map.style.minimapFar;
    ctx.fillRect(0, 0, 512, 512);

    // Фон карты рисуется с тем же поворотом, что и маркеры. Текст и рамка
    // остаются ровными и рисуются поверх.
    const { fx, fz } = this.minimapBasis();
    ctx.save();
    ctx.setTransform(
      fz, -fx,
      -fx, -fz,
      256 * (1 - fz + fx),
      256 * (1 + fx + fz),
    );
    ctx.drawImage(this.minimapBg, 0, 0);
    ctx.restore();

    const poly = this.viewportPolygon();
    if (poly) {
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(79,210,255,0.09)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(79,210,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const b of this.game.buildings) {
      if (!b.alive) continue;
      const p = this.worldToMinimap(b.position.x, b.position.z);
      const color = b.faction === 'player' ? '#4fd2ff' : '#ff6b4a';
      const size = b.type === 'hq' ? 13 : b.type === 'barracks' ? 9 : 7;
      ctx.fillStyle = color;
      ctx.globalAlpha = b.complete ? 0.95 : 0.5;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalAlpha = 1;
      if (b.type === 'hq') {
        ctx.strokeStyle = '#e8fbff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - size / 2, p.y - size / 2, size, size);
      }
    }

    for (const u of this.game.units) {
      if (!u.alive) continue;
      const p = this.worldToMinimap(u.position.x, u.position.z);
      ctx.fillStyle = u.faction === 'player' ? '#c3f8ff' : '#ffb09e';
      ctx.beginPath();
      ctx.arc(p.x, p.y, u.type === 'tank' || u.type === 'artillery' ? 5.5 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      if (this.game.selected.has(u)) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // рамка камеры — точка фокуса
    const cam = this.game.camera;
    if (cam) {
      const p = this.worldToMinimap(cam.target.x, cam.target.z);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawMinimapChrome(ctx);
  }

  bindMinimap() {
    const canvas = this.el.minimap;
    let dragging = false;
    const pick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 512;
      const py = ((e.clientY - rect.top) / rect.height) * 512;
      const s = (512 - 20) / (MAP.half * 2);
      const { fx, fz } = this.minimapBasis();
      // Обратное преобразование повёрнутой карты.
      const u = (px - 256) / s;
      const v = -(py - 256) / s;
      const x = fz * u + fx * v;
      const z = -fx * u + fz * v;
      this.game.focusOn(clamp(x, -MAP.clamp, MAP.clamp), clamp(z, -MAP.clamp, MAP.clamp));
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (this.overlayOpen || !this.game.started) return;
      dragging = true;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      pick(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) pick(e);
    });
    const end = (e) => {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  ping(x, z, color = '#4fd2ff') {
    if (!this.el.mmPing) return;
    const p = this.worldToMinimap(x, z);
    const node = document.createElement('span');
    node.className = 'mm-ping-dot';
    node.style.left = `${(p.x / 512) * 100}%`;
    node.style.top = `${(p.y / 512) * 100}%`;
    node.style.color = color;
    this.el.mmPing.appendChild(node);
    setTimeout(() => node.remove(), 1500);
  }
}
