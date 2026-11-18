// HUD: ресурсы, выбор, командная панель, миникарта, оверлеи.

import { Matrix } from './babylon.js';
import {
  FACTIONS,
  UNITS,
  BUILDINGS,
  UPGRADES,
  UPGRADE_LINE_KEYS,
  BUILD_ORDER,
  BUILD_HOTKEYS,
  UNIT_PRODUCTION,
  TRAIN_HOTKEYS,
  HQ_TRAIN_HOTKEYS,
  MESSAGES,
  MAP,
  FIELD_SUPPORT,
  AI_DIFFICULTY,
  DIFFICULTY_ORDER,
  VETERANCY,
  veteranRank,
  SELL,
} from './config.js';
import { icon } from './icons.js';
import {
  createMap,
  formatSeed,
  formatSeedLabel,
  normalizeSeed,
  randomSeed,
  seedUrl,
} from './mapgen.js';
import { CHANGELOG, GAME_VERSION } from './changelog.js';
import {
  CAMPAIGN,
  ENDLESS,
  TRIALS,
  campaignDoneCount,
  campaignState,
  endlessBest,
  endlessUnlocked,
  findMission,
  nextCampaignMission,
  trialBest,
  trialDoneCount,
} from './missions.js';
import { LANGS, getLang, setLang, t } from './i18n/index.js';
import { GRAPHICS_OPTIONS, AUDIO_DEFAULTS } from './settings.js';
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
    // Состав панели приказов: по нему решаем, нужна ли пересборка DOM.
    this.commandStructure = '';
    this.tickAcc = 0;
    this.selectionAcc = 0;
    this.lastSignature = '';
    this.lastGroupClick = null;
    // Удержание слота отряда на сенсорном экране запоминает выделение.
    this.groupHold = null;
    // Клик после удержания не должен вызывать отряд: храним момент, до
    // которого клики по рейке игнорируются.
    this.groupHoldGuard = 0;
    this.tooltipVisible = false;
    this.overlayOpen = true;
    this.overlayBack = null;
    // Главное меню и лобби — разные экраны: параметры матча живут только
    // в лобби, а из него можно вернуться в меню.
    this.inLobby = false;
    // Активная миссия: страница открыта по адресу ?mission=...
    this.activeMission = this.game.mission ?? null;
    // Открытый список миссий: нужен, чтобы «Назад» из настроек вернул в него.
    this.missionsScreen = null;
    this.settingsTab = 'graphics';
    // Лобби: сложность выбирается сразу, а сид карты — случайно (по умолчанию)
    // или вручную. Режим из адреса нужен, чтобы F5 после ручного сида возвращал
    // в лобби с тем же выбором, а не сбрасывал его.
    this.seedMode = new URLSearchParams(window.location.search).get('seedmode') === 'manual'
      ? 'manual'
      : 'random';
    this.randomSeedValue = this.game.map.seed;
    this.manualSeedText = this.game.map.code;
    this.lobbySeedValue = this.game.map.seed;
    this.lobbyPreview = this.game.map;
    this.seedPreviewTimer = 0;
    this.minimapBg = null;
    this.buildMinimapBackground();
    this.el.mmSector.textContent = this.game.map.label;
    this.el.mmSector.title = t('hud.mapTitle', { label: this.game.map.label, style: this.game.map.style.name });
    if (this.el.brandSector) {
      this.el.brandSector.textContent = t('hud.brandSector', { label: this.game.map.label });
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
      powerLabel: this.$('#resPower .res-copy small'),
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
      fullscreenBtn: this.$('#btnFullscreen'),
      alert: this.$('#alertFlash'),
      minimap: this.$('#minimap'),
      mmPing: this.$('#mmPing'),
      mmSector: this.$('#mmSector'),
      brandSector: this.$('#brandSector'),
      minimapFrame: document.querySelector('.minimap-frame'),
      tooltip: this.$('#tooltip'),
      selectBox: this.$('#selectBox'),
      squadRail: this.$('#squad-rail'),
      missionCard: document.querySelector('.mission'),
      missionLabel: document.querySelector('.mission span'),
      missionText: document.querySelector('.mission b'),
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
    if (this.el.fullscreenBtn) {
      // На iPhone элементный полноэкранный режим недоступен — кнопка-пустышка
      // только путает, поэтому убираем её.
      if (this.supportsFullscreen()) {
        this.el.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        document.addEventListener('fullscreenchange', () => this.syncFullscreenBtn());
        document.addEventListener('webkitfullscreenchange', () => this.syncFullscreenBtn());
      } else {
        this.el.fullscreenBtn.hidden = true;
      }
    }
    this.el.overlay.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-settings-tab]');
      if (tab) {
        this.setSettingsTab(tab.dataset.settingsTab);
        return;
      }
      const gfx = e.target.closest('[data-graphics]');
      if (gfx) {
        this.game.graphics?.set(gfx.dataset.graphics, gfx.dataset.value);
        this.refreshGraphicsControls();
        return;
      }
      const diff = e.target.closest('[data-difficulty]');
      if (diff) {
        this.game.setDifficulty(diff.dataset.difficulty);
        this.refreshDifficultyControls();
        return;
      }
      const lang = e.target.closest('[data-lang]');
      if (lang) {
        // Строки уже вшиты в открытые экраны — применяем язык перезагрузкой.
        if (setLang(lang.dataset.lang)) window.location.reload();
        return;
      }
      const fog = e.target.closest('[data-fog]');
      if (fog) {
        this.game.setFog(fog.dataset.fog);
        this.refreshFogControls();
        return;
      }
      const seedMode = e.target.closest('[data-seedmode]');
      if (seedMode) {
        this.setSeedMode(seedMode.dataset.seedmode);
        return;
      }
      const speed = e.target.closest('[data-speed]');
      if (speed) {
        this.game.setSpeed(Number(speed.dataset.speed));
        this.refreshSpeedControls();
        return;
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'start') this.startGame();
      else if (action === 'lobby') this.showLobby();
      else if (action === 'campaign') this.showMissions('campaign');
      else if (action === 'trials') this.showMissions('trial');
      else if (action === 'beginmission') this.beginMission();
      else if (action === 'missionlist') this.leaveMission(
        this.activeMission?.kind === 'endless' ? 'campaign' : this.activeMission?.kind ?? 'campaign',
      );
      else if (action === 'mainmenu') this.leaveMission(null);
      else if (action.startsWith('mission:')) this.openMission(action.slice('mission:'.length));
      else if (action === 'reroll') this.rerollSeed();
      else if (action === 'resume') this.resume();
      else if (action === 'restart') window.location.reload();
      else if (action === 'newmap') this.newMap();
      else if (action === 'settings') this.openSettings();
      else if (action === 'help') this.openHelp();
      else if (action === 'changelog') this.openChangelog();
      else if (action === 'credits') this.openCredits();
      else if (action === 'back') this.backFromOverlay();
      else if (action === 'close') this.closeOverlay();
    });
    this.el.overlay.addEventListener('input', (e) => {
      if (e.target.closest('[data-seed-input]')) {
        this.onSeedInput(e.target.value);
        return;
      }
      const range = e.target.closest('[data-audio]');
      if (!range) return;
      this.game.audioSettings?.set(range.dataset.audio, range.value);
      this.refreshAudioControls();
    });
    this.el.overlay.addEventListener('keydown', (e) => {
      if (e.target.closest('[data-seed-input]')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.startGame();
        }
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const tab = e.target.closest('[data-settings-tab]');
      if (!tab) return;
      e.preventDefault();
      const order = ['graphics', 'audio', 'lang'];
      const next = order[(order.indexOf(this.settingsTab) + 1) % order.length];
      this.setSettingsTab(next);
      this.el.overlay.querySelector(`[data-settings-tab="${next}"]`)?.focus();
    });
    this.el.commands.addEventListener('click', (e) => {
      const btn = e.target.closest('.cmd');
      if (!btn) return;
      const cmd = this.commandMap.get(btn.dataset.cmdId);
      if (!cmd) return;
      if (cmd.disabled) {
        this.game.notify(cmd.reason || t('notify.unavailable'), 'warn', `cmd-${cmd.id}`, 0, 3);
        return;
      }
      cmd.action(e.shiftKey ? 5 : 1);
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
    const rail = this.el.squadRail;
    const GROUP_HOLD_MS = 450;
    const cancelGroupHold = () => {
      const hold = this.groupHold;
      if (!hold) return;
      clearTimeout(hold.timer);
      hold.btn.classList.remove('is-pressing');
      this.groupHold = null;
    };
    rail?.addEventListener('contextmenu', (e) => e.preventDefault());
    rail?.addEventListener('pointerdown', (e) => {
      // Удержание — сенсорный жест. На мыши слоты работают как раньше,
      // без случайного перезапоминания отряда.
      if (e.pointerType === 'mouse') return;
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
      cancelGroupHold();
      const hold = {
        index: Number(btn.dataset.group),
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        btn,
        timer: 0,
      };
      hold.timer = setTimeout(() => {
        if (this.groupHold !== hold) return;
        this.groupHold = null;
        btn.classList.remove('is-pressing');
        // Тот же палец оставит после себя click: гасим его, иначе отряд
        // тут же выделится вместо запоминания.
        this.groupHoldGuard = performance.now() + 700;
        this.game.assignGroup(hold.index);
      }, GROUP_HOLD_MS);
      this.groupHold = hold;
      btn.classList.add('is-pressing');
      try { btn.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    });
    rail?.addEventListener('pointermove', (e) => {
      const hold = this.groupHold;
      if (!hold || hold.pointerId !== e.pointerId) return;
      if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) cancelGroupHold();
    });
    rail?.addEventListener('pointerup', cancelGroupHold);
    rail?.addEventListener('pointercancel', cancelGroupHold);
    rail?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
      if (performance.now() < this.groupHoldGuard) {
        this.groupHoldGuard = 0;
        return;
      }
      const index = Number(btn.dataset.group);
      const now = performance.now();
      const previous = this.lastGroupClick;
      const isDouble = previous?.index === index && now - previous.time < 400;
      this.lastGroupClick = isDouble ? null : { index, time: now };
      if (this.game.recallGroup(index) && isDouble) this.game.focusGroup(index);
    });
    window.addEventListener('resize', () => this.renderGroups());
    this.bindMinimap();
  }

  // --------------------------------------------------------------- overlays
  showStart() {
    this.overlayBack = null;
    this.inLobby = false;
    this.missionsScreen = null;
    const url = new URL(window.location.href);
    if (url.searchParams.has('mode')) {
      url.searchParams.delete('mode');
      window.history.replaceState(null, '', url.toString());
    }
    const map = this.game.map;
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('menu.eyebrow')}</div>
        <h1>${t('menu.brand')}<span>-7</span></h1>
        <p class="tagline">${t('menu.tagline')}</p>
      </div>
      <div class="mode-grid mode-grid--modes">
        <button type="button" class="mode-card mode-card--active" data-action="campaign">
          <span class="mode-mark">${icon('flag')}</span>
          <span class="mode-copy"><b>${t('menu.mode.campaign')}</b><small>${t('menu.mode.campaignDesc')}</small></span>
          <span class="mode-badge">${campaignDoneCount()} / ${CAMPAIGN.length}</span>
        </button>
        <button type="button" class="mode-card mode-card--active" data-action="trials">
          <span class="mode-mark">${icon('target')}</span>
          <span class="mode-copy"><b>${t('menu.mode.trials')}</b><small>${t('menu.mode.trialsDesc')}</small></span>
          <span class="mode-badge">${trialDoneCount()} / ${TRIALS.length}</span>
        </button>
        <button type="button" class="mode-card mode-card--active" data-action="lobby">
          <span class="mode-mark">${icon('hq')}</span>
          <span class="mode-copy"><b>${t('menu.mode.lobby')}</b><small>${t('menu.mode.lobbyDesc')}</small></span>
          <span class="mode-arrow">→</span>
        </button>
      </div>
      <div class="overlay-actions">
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">${t('menu.help')}</button>
          <button class="btn-ghost" data-action="settings">${t('menu.settings')}</button>
          <button class="btn-ghost" data-action="changelog">${t('menu.changelog')}</button>
          <button class="btn-ghost" data-action="credits">${t('menu.credits')}</button>
        </div>
      </div>
      <p class="overlay-note start-note">${t('menu.startNote')}</p>
      <div class="overlay-footer">
        <span>${t('menu.footerStart', { version: GAME_VERSION })}</span>
        <span>${t('menu.footerMap', { label: map.label, symmetry: map.symmetry.name.toUpperCase(), style: map.style.name })}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--start');
  }

  /** Список операций кампании или испытаний. */
  showMissions(kind) {
    const isCampaign = kind !== 'trial';
    const list = isCampaign ? CAMPAIGN : TRIALS;
    this.inLobby = false;
    this.missionsScreen = kind;
    // На странице миссии игра уже собрана с её правилами: возврат в меню
    // должен перезагрузить страницу, иначе ограничения миссии останутся.
    this.overlayBack = () => (this.game.mission ? this.leaveMission(null) : this.showStart());
    const url = new URL(window.location.href);
    if (this.game.mission) url.searchParams.delete('mode');
    else url.searchParams.set('mode', kind);
    window.history.replaceState(null, '', url.toString());
    const cards = list.map((mission) => {
      const state = isCampaign ? campaignState(mission) : 'open';
      const locked = state === 'locked';
      const best = isCampaign ? null : trialBest(mission);
      const badge = isCampaign
        ? (state === 'done' ? t('menu.badgeDone') : state === 'open' ? t('menu.badgeOpen') : t('menu.badgeLocked'))
        : (best != null ? t('menu.badgeRecord', { time: formatTime(best) }) : t('menu.badgeNotDone'));
      const classes = `mode-card ${locked ? 'mode-card--locked' : 'mode-card--active'}${state === 'done' || best != null ? ' is-done' : ''}`;
      return `
        <button type="button" class="${classes}" data-action="mission:${mission.id}"
          ${locked ? 'disabled aria-disabled="true"' : ''}
          title="${locked ? t('menu.lockedTitle') : esc(mission.subtitle)}">
          <span class="mode-mark mission-num">${String(mission.index).padStart(2, '0')}</span>
          <span class="mode-copy"><b>${esc(mission.title.toUpperCase())}</b><small>${esc(mission.subtitle)}</small></span>
          <span class="mode-badge">${badge}</span>
        </button>`;
    }).join('');
    // Секретная операция: карточка всегда на месте, но до прохождения
    // кампании показывает только «???» и не открывается.
    let secret = '';
    if (isCampaign) {
      const unlocked = endlessUnlocked();
      const mission = ENDLESS[0];
      const best = mission ? endlessBest(mission) : null;
      const title = unlocked && mission ? mission.title.toUpperCase() : '??? ??? ???';
      const note = unlocked && mission
        ? mission.subtitle
        : t('menu.secretNote');
      const badge = unlocked
        ? (best ? t('menu.badgeRecord', { time: formatTime(best.time) }) : t('menu.badgeEndless'))
        : t('menu.badgeSecret');
      secret = `
        <button type="button" class="mode-card ${unlocked ? 'mode-card--active' : 'mode-card--locked'}"
          ${unlocked ? `data-action="mission:${mission.id}"` : 'disabled aria-disabled="true"'}
          title="${esc(note)}">
          <span class="mode-mark mission-num">${unlocked ? '06' : '??'}</span>
          <span class="mode-copy"><b>${esc(title)}</b><small>${esc(note)}</small></span>
          <span class="mode-badge">${badge}</span>
        </button>`;
    }
    const done = isCampaign ? campaignDoneCount() : trialDoneCount();
    const label = isCampaign ? t('menu.mode.campaign') : t('menu.mode.trials');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('menu.network')} // ${label}</div>
        <h1>${isCampaign ? t('menu.missionsCampaign') : t('menu.mode.trials')}</h1>
        <p class="tagline">${isCampaign ? t('menu.campaignTagline') : t('menu.trialsTagline')}</p>
      </div>
      <div class="mode-grid mode-grid--missions">${cards}${secret}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">${t('menu.backToMain')}</button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">${t('menu.help')}</button>
          <button class="btn-ghost" data-action="settings">${t('menu.settings')}</button>
          <button class="btn-ghost" data-action="changelog">${t('menu.changelog')}</button>
          <button class="btn-ghost" data-action="credits">${t('menu.credits')}</button>
        </div>
      </div>
      <p class="overlay-note start-note">${isCampaign
        ? t('menu.campaignProgress', { done, total: CAMPAIGN.length })
        : t('menu.trialsProgress', { done, total: TRIALS.length })}</p>
      <div class="overlay-footer">
        <span>${t('menu.footerMissions', { label, version: GAME_VERSION })}</span>
        <span>${isCampaign ? t('menu.footerStory') : t('menu.footerScenarios')}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--missions');
  }

  /** Брифинг перед стартом миссии. */
  showBriefing(mission) {
    this.activeMission = mission ?? this.activeMission;
    const current = this.activeMission;
    if (!current) {
      this.showStart();
      return;
    }
    this.inLobby = false;
    this.missionsScreen = null;
    this.overlayBack = () => this.showMissions(
      current.kind === 'endless' ? 'campaign' : current.kind,
    );
    const map = this.game.map;
    const isCampaign = current.kind === 'campaign';
    const isEndless = current.kind === 'endless';
    const kindLabel = isEndless ? t('overlay.kindProtocol') : isCampaign ? t('overlay.kindCampaign') : t('overlay.kindTrials');
    const kindWord = isEndless ? t('overlay.wordProtocol') : isCampaign ? t('overlay.wordOperation') : t('overlay.wordScenario');
    const buildings = (current.buildings ?? []).map((type) => BUILDINGS[type]?.name).filter(Boolean);
    const units = (current.units ?? []).map((type) => UNITS[type]?.name).filter(Boolean);
    const brief = (current.briefing ?? []).map((text) => `<p>${esc(text)}</p>`).join('');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${kindLabel} // ${kindWord} ${String(current.index).padStart(2, '0')}</div>
        <h1>${esc(current.title.toUpperCase())}</h1>
        <p class="tagline">${esc(current.subtitle)}</p>
      </div>
      <div class="map-strip">
        <div class="map-strip-item"><span>${t('menu.seedLabel')}</span><b>#${map.label}</b></div>
        <div class="map-strip-item"><span>${t('overlay.symmetry')}</span><b>${map.symmetry.name} · ${map.symmetry.tag}</b></div>
        <div class="map-strip-item"><span>${t('overlay.landscape')}</span><b>${map.style.name}</b></div>
      </div>
      <div class="brief-grid">
        <div class="brief-copy">
          ${brief}
          <p class="accent-copy">${t('overlay.briefRoster', { buildings: esc(buildings.join(', ')), units: esc(units.join(', ')) })}</p>
        </div>
        ${this.objectivesHtml(current, false)}
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="beginmission">${isEndless ? t('overlay.beginProtocol') : isCampaign ? t('overlay.beginOperation') : t('overlay.beginTrial')} <span>→</span></button>
        <button class="btn-ghost" data-action="back">${t('overlay.back')}</button>
      </div>
      <div class="overlay-footer">
        <span>${t('overlay.footerMission', { kind: kindLabel, title: esc(current.title.toUpperCase()) })}</span>
        <span>${t('overlay.enemy', { name: esc(AI_DIFFICULTY[current.difficulty]?.name ?? t('menu.difficultyDefault')) })}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--briefing');
  }

  /** HTML списка целей; с live=true показывает текущий прогресс партии. */
  objectivesHtml(mission, live = false) {
    const states = live ? this.game.objectives : [];
    const items = (mission.objectives ?? []).map((objective, index) => {
      const state = states[index];
      const done = Boolean(state?.done);
      const progress = state?.progressText ? ` · ${state.progressText}` : '';
      return `
        <div class="objective${done ? ' is-done' : ''}">
          <b>${done ? '✓' : String(index + 1).padStart(2, '0')}</b>
          <span><strong>${esc(objective.title)}${esc(progress)}</strong><small>${esc(objective.desc)}</small></span>
        </div>`;
    }).join('');
    const body = items || (mission.endless
      ? `<div class="objective"><b>∞</b><span><strong>${t('overlay.endlessObjectiveTitle')}</strong><small>${t('overlay.endlessObjectiveDesc')}</small></span></div>`
      : '');
    return `<div class="objectives">${body}</div>`;
  }

  beginMission() {
    if (!this.activeMission) return;
    this.beginGame();
  }

  /** Переносит браузер на страницу миссии: карта и правила собираются заново. */
  openMission(id) {
    const mission = findMission(id);
    if (!mission) return;
    if (mission.kind === 'campaign' && campaignState(mission) === 'locked') return;
    if (mission.kind === 'endless' && !endlessUnlocked()) return;
    const url = new URL(window.location.href);
    url.searchParams.set('mission', mission.id);
    url.searchParams.set('seed', formatSeed(mission.seed));
    url.searchParams.delete('start');
    url.searchParams.delete('seedmode');
    url.searchParams.delete('mode');
    document.activeElement?.blur?.();
    window.location.assign(url.toString());
  }

  /** Выход из миссии: в список операций или в чистое главное меню. */
  leaveMission(kind) {
    const url = new URL(window.location.href);
    url.searchParams.delete('mission');
    url.searchParams.delete('start');
    url.searchParams.delete('seedmode');
    if (kind) url.searchParams.set('mode', kind);
    else url.searchParams.delete('mode');
    document.activeElement?.blur?.();
    window.location.assign(url.toString());
  }

  /** Лобби: параметры матча и запуск операции. */
  showLobby() {
    this.inLobby = true;
    this.missionsScreen = null;
    this.overlayBack = () => this.showStart();
    const map = this.game.map;
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('menu.lobbyEyebrow')} <span id="lobbySector">${map.label}</span></div>
        <h1>${t('menu.brand')}<span>-7</span></h1>
        <p class="tagline">${t('menu.lobbyTagline')}</p>
      </div>
      <div class="map-strip lobby-map-strip" id="lobbyMapStrip">
        <div class="map-strip-item"><span>${t('menu.seedLabel')}</span><b id="lobbySeed">#${map.label}</b></div>
        <div class="map-strip-item"><span>${t('overlay.symmetry')}</span><b id="lobbySymmetry">${map.symmetry.name} · ${map.symmetry.tag}</b></div>
        <div class="map-strip-item"><span>${t('overlay.landscape')}</span><b id="lobbyStyle">${map.style.name}</b></div>
      </div>
      <div class="lobby-panel">
        ${this.difficultyBlock()}
        ${this.fogBlock()}
        ${this.seedBlock()}
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="start">${t('menu.start')} <span>→</span></button>
        <button class="btn-ghost" data-action="back">${t('menu.backToMain')}</button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">${t('menu.help')}</button>
          <button class="btn-ghost" data-action="settings">${t('menu.settings')}</button>
          <button class="btn-ghost" data-action="changelog">${t('menu.changelog')}</button>
          <button class="btn-ghost" data-action="credits">${t('menu.credits')}</button>
        </div>
      </div>
      <div class="brief-grid">
        <div class="brief-copy">
          <p id="lobbyBrief">${t('menu.lobbyBrief', { hint: map.symmetry.hint })}</p>
          <p class="accent-copy">${t('menu.lobbyAccent')}</p>
        </div>
        <div class="objectives">
          <div class="objective"><b>01</b><span><strong>${t('menu.lobbyObj1Title')}</strong><small>${t('menu.lobbyObj1Desc')}</small></span></div>
          <div class="objective"><b>02</b><span><strong>${t('menu.lobbyObj2Title')}</strong><small>${t('menu.lobbyObj2Desc')}</small></span></div>
          <div class="objective"><b>03</b><span><strong>${t('menu.lobbyObj3Title')}</strong><small>${t('menu.lobbyObj3Desc')}</small></span></div>
        </div>
      </div>
      <p class="overlay-note start-note" id="lobbyNote">${t('menu.lobbyNoteSeed', { seed: map.code })}</p>
      <div class="overlay-footer">
        <span id="lobbyFooterMap">${t('menu.footerMapSeed', { label: map.label, version: GAME_VERSION })}</span>
        <span id="lobbyFooterMeta">${map.symmetry.name.toUpperCase()} · ${map.style.name} · BABYLON.JS</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--lobby');
    this.refreshLobbyPreview();
  }

  /** Выбор сложности ИИ на стартовом экране: одна настройка на партию. */
  difficultyBlock() {
    const current = this.game.difficulty ?? 'normal';
    const preset = AI_DIFFICULTY[current] ?? AI_DIFFICULTY.normal;
    const buttons = DIFFICULTY_ORDER.map((key) => {
      const option = AI_DIFFICULTY[key];
      const active = key === current;
      return `<button type="button" class="graphics-opt${active ? ' is-active' : ''}"
        data-difficulty="${key}" aria-pressed="${active}"
        title="${esc(option.desc)}">${option.name}</button>`;
    }).join('');
    return `
      <div class="lobby-row">
        <div class="lobby-row-head">
          <span class="lobby-label">${t('menu.difficultyLabel')}</span>
          <span class="lobby-status" id="difficultyStatus">${esc(preset.desc)}</span>
        </div>
        <div class="difficulty-options">${buttons}</div>
      </div>`;
  }

  /** Туман войны: включён по умолчанию, выключение открывает всю карту. */
  fogBlock() {
    const enabled = this.game.fogEnabled !== false;
    const options = [
      { value: 'on', label: t('menu.fogOn'), title: t('menu.fogHintOn') },
      { value: 'off', label: t('menu.fogOff'), title: t('menu.fogTitleOff') },
    ];
    const buttons = options.map((option) => {
      const active = (option.value === 'on') === enabled;
      return `<button type="button" class="graphics-opt${active ? ' is-active' : ''}"
        data-fog="${option.value}" aria-pressed="${active}"
        title="${option.title}">${option.label}</button>`;
    }).join('');
    return `
      <div class="lobby-row">
        <div class="lobby-row-head">
          <span class="lobby-label">${t('menu.fogLabel')}</span>
          <span class="lobby-status" id="fogStatus">${enabled ? t('menu.fogHintOn') : t('menu.fogHintOff')}</span>
        </div>
        <div class="difficulty-options">${buttons}</div>
      </div>`;
  }

  refreshFogControls() {
    const enabled = this.game.fogEnabled !== false;
    this.el.overlay.querySelectorAll('[data-fog]').forEach((btn) => {
      const active = (btn.dataset.fog === 'on') === enabled;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const status = this.el.overlay.querySelector('#fogStatus');
    if (status) status.textContent = enabled ? t('menu.fogHintOn') : t('menu.fogHintOff');
  }

  /** Сид карты: случайный (по умолчанию) или ручной. */
  seedBlock() {
    const mode = this.seedMode === 'manual' ? 'manual' : 'random';
    return `
      <div class="lobby-row lobby-row--seed">
        <div class="lobby-row-head">
          <span class="lobby-label">${t('menu.seedLabel')}</span>
          <div class="seed-modes" role="group" aria-label="${t('menu.seedAria')}">
            <button type="button" class="graphics-opt${mode === 'random' ? ' is-active' : ''}"
              data-seedmode="random" aria-pressed="${mode === 'random'}">${t('menu.seedRandom')}</button>
            <button type="button" class="graphics-opt${mode === 'manual' ? ' is-active' : ''}"
              data-seedmode="manual" aria-pressed="${mode === 'manual'}">${t('menu.seedManual')}</button>
          </div>
        </div>
        <div class="seed-body">
          <div class="seed-controls">
            <div class="seed-panel" data-seed-panel="random"${mode === 'random' ? '' : ' hidden'}>
              <div class="seed-value"><span>${t('menu.seedChosen')}</span><b id="seedValue">#${formatSeedLabel(this.lobbySeedValue)}</b></div>
              <button type="button" class="btn-ghost btn-seed" data-action="reroll">${t('menu.seedReroll')}</button>
            </div>
            <div class="seed-panel" data-seed-panel="manual"${mode === 'manual' ? '' : ' hidden'}>
              <label class="seed-input-label" for="seedInput">${t('menu.seedInput')}</label>
              <input id="seedInput" class="seed-input" data-seed-input type="text"
                value="${esc(this.manualSeedText)}" placeholder="7A3F91C2"
                inputmode="text" autocomplete="off" autocapitalize="characters"
                spellcheck="false" maxlength="24" aria-describedby="seedHint" />
            </div>
            <p class="seed-hint" id="seedHint"></p>
          </div>
          <div class="seed-preview">
            <canvas id="lobbyPreview" width="180" height="180" role="img" aria-label="${t('menu.seedPreviewAria')}"></canvas>
            <span class="seed-preview-tag" id="seedPreviewTag">${t('menu.seedTagRandom')}</span>
          </div>
        </div>
      </div>`;
  }

  refreshDifficultyControls() {
    const current = this.game.difficulty ?? 'normal';
    this.el.overlay.querySelectorAll('[data-difficulty]').forEach((btn) => {
      const active = btn.dataset.difficulty === current;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const status = this.el.overlay.querySelector('#difficultyStatus');
    if (status) status.textContent = AI_DIFFICULTY[current]?.desc ?? '';
  }

  // ----------------------------------------------------------- выбор сида
  setSeedMode(mode) {
    if (mode !== 'random' && mode !== 'manual') return;
    if (this.seedMode === mode) return;
    this.seedMode = mode;
    this.el.overlay.querySelectorAll('[data-seedmode]').forEach((btn) => {
      const active = btn.dataset.seedmode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    this.el.overlay.querySelectorAll('[data-seed-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.seedPanel !== mode;
    });
    if (mode === 'manual') {
      const input = this.el.overlay.querySelector('#seedInput');
      if (input) {
        if (!input.value.trim()) input.value = formatSeed(this.randomSeedValue);
        this.manualSeedText = input.value;
      }
    }
    this.refreshLobbyPreview();
  }

  onSeedInput(value) {
    this.manualSeedText = String(value ?? '');
    this.updateSeedHint();
    clearTimeout(this.seedPreviewTimer);
    this.seedPreviewTimer = setTimeout(() => this.refreshLobbyPreview(), 120);
  }

  parseManualSeed() {
    const raw = String(this.manualSeedText ?? '').trim();
    const cleaned = raw.replace(/^#/, '').replace(/^0x/i, '').replace(/[-\s]/g, '');
    if (!cleaned) return null;
    return normalizeSeed(raw);
  }

  selectedLobbySeed() {
    return this.seedMode === 'manual' ? this.parseManualSeed() : this.randomSeedValue;
  }

  rerollSeed() {
    this.randomSeedValue = randomSeed();
    if (this.seedMode !== 'random') this.setSeedMode('random');
    else this.refreshLobbyPreview();
  }

  refreshLobbyPreview() {
    if (!this.el.overlay?.querySelector('#lobbyPreview')) return;
    const seed = this.selectedLobbySeed();
    const usable = seed != null;
    const map = usable
      ? (seed === this.game.map.seed ? this.game.map : createMap(seed))
      : this.game.map;
    const preview = usable && seed !== this.game.map.seed;
    this.lobbySeedValue = usable ? seed : this.game.map.seed;
    this.lobbyPreview = map;
    this.updateLobbyMapInfo(map, preview);
    let tag = t('menu.seedTagRandom');
    if (!usable) tag = t('menu.seedTagEnter');
    else if (preview) tag = t('menu.seedTagPreview');
    else if (this.seedMode === 'manual') tag = t('menu.seedTagManual');
    this.drawLobbyPreview(map, tag);
    this.updateSeedHint();
  }

  updateLobbyMapInfo(map, preview) {
    const set = (selector, text) => {
      const node = this.el.overlay.querySelector(selector);
      if (node) node.textContent = text;
    };
    set('#lobbySector', map.label);
    set('#lobbySeed', `#${map.label}`);
    set('#lobbySymmetry', `${map.symmetry.name} · ${map.symmetry.tag}`);
    set('#lobbyStyle', map.style.name);
    set('#seedValue', `#${map.label}`);
    set('#lobbyFooterMap', t('menu.footerMapSeed', { label: map.label, version: GAME_VERSION }));
    set('#lobbyFooterMeta', `${map.symmetry.name.toUpperCase()} · ${map.style.name} · BABYLON.JS`);
    const strip = this.el.overlay.querySelector('#lobbyMapStrip');
    strip?.classList.toggle('is-preview', preview);
    const brief = this.el.overlay.querySelector('#lobbyBrief');
    if (brief) {
      brief.textContent = t('menu.lobbyBrief', { hint: map.symmetry.hint });
    }
    const note = this.el.overlay.querySelector('#lobbyNote');
    if (note) {
      note.innerHTML = preview
        ? t('menu.lobbyNotePreview', { label: map.label })
        : t('menu.lobbyNoteSeed', { seed: map.code });
    }
  }

  updateSeedHint() {
    const hint = this.el.overlay?.querySelector('#seedHint');
    if (!hint) return;
    hint.classList.remove('is-warn');
    if (this.seedMode === 'random') {
      hint.textContent = t('menu.seedHintRandom');
      return;
    }
    const seed = this.parseManualSeed();
    if (seed == null) {
      hint.textContent = t('menu.seedHintEmpty');
      hint.classList.add('is-warn');
      return;
    }
    hint.textContent = t('menu.seedHintManual', { seed: formatSeedLabel(seed) });
  }

  /** Мини-карта в лобби: рельеф, базы, месторождения и руины выбранного сида. */
  drawLobbyPreview(map, tag) {
    const canvas = this.el.overlay?.querySelector('#lobbyPreview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const pad = 7;
    const w = size - pad * 2;
    const toMap = (x, z) => ({
      x: pad + ((x + MAP.half) / (MAP.half * 2)) * w,
      y: pad + ((z + MAP.half) / (MAP.half * 2)) * w,
    });

    ctx.clearRect(0, 0, size, size);
    const field = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, w * 0.75);
    field.addColorStop(0, map.style.minimap);
    field.addColorStop(1, map.style.minimapFar);
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, size, size);

    // Пятна рельефа: детерминированы сидом, как и сама карта.
    const rng = mulberry32((map.seed ^ 0x51c70) >>> 0);
    for (let i = 0; i < 36; i++) {
      const x = pad + rng() * w;
      const y = pad + rng() * w;
      const r = 5 + rng() * 24;
      const dark = rng() > 0.5;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
      blob.addColorStop(0, dark ? 'rgba(26,42,41,0.55)' : 'rgba(42,53,44,0.35)');
      blob.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = blob;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Сетка помогает читать расположение баз.
    ctx.strokeStyle = 'rgba(79,210,255,0.09)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = pad + (w / 4) * i;
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, size - pad);
      ctx.moveTo(pad, p);
      ctx.lineTo(size - pad, p);
      ctx.stroke();
    }

    // Камни.
    for (const rock of map.decor.rocks) {
      const p = toMap(rock.x, rock.z);
      ctx.fillStyle = 'rgba(88,100,93,0.75)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1 + (rock.scale ?? 1) * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // Руины стен.
    ctx.strokeStyle = 'rgba(172,160,136,0.85)';
    ctx.lineWidth = 1.5;
    for (const wall of map.walls ?? []) {
      const a = toMap(wall.x1, wall.z1);
      const b = toMap(wall.x2, wall.z2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Месторождения: цвет кольца показывает владельца.
    for (const patch of map.oilPatches) {
      const p = toMap(patch.x, patch.z);
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 4.5, 3.5, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = patch.owner === 'player'
        ? 'rgba(79,210,255,0.9)'
        : patch.owner === 'enemy'
          ? 'rgba(255,107,74,0.9)'
          : 'rgba(255,176,46,0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Стартовые базы: штаб и электростанция каждой стороны.
    const baseMark = (point, faction) => {
      const p = toMap(point.x, point.z);
      const color = FACTIONS[faction].ui;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 13);
      glow.addColorStop(0, faction === 'player' ? 'rgba(79,210,255,0.35)' : 'rgba(255,107,74,0.3)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p.x - 13, p.y - 13, 26, 26);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(240,253,255,0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    for (const faction of ['player', 'enemy']) {
      const spawn = map.spawn[faction];
      baseMark(spawn.hq, faction);
      baseMark(spawn.power, faction);
    }

    const tagNode = this.el.overlay.querySelector('#seedPreviewTag');
    if (tagNode) tagNode.textContent = tag;
  }

  /** Разбивка боя по типам: кем уничтожали, что теряли, сколько урона. */
  endDetailHtml() {
    const s = this.game.stats;
    const keys = new Set([
      ...Object.keys(s.killsByType ?? {}),
      ...Object.keys(s.lossesByType ?? {}),
    ]);
    const rows = [...keys].map((type) => ({
      type,
      kills: s.killsByType?.[type] ?? 0,
      losses: s.lossesByType?.[type] ?? 0,
      damage: s.damageByType?.[type] ?? 0,
    }))
      .filter((row) => row.kills || row.losses || row.damage >= 1)
      .sort((a, b) => (b.kills + b.losses) - (a.kills + a.losses) || b.damage - a.damage);
    if (!rows.length) return '';
    const name = (type) => UNITS[type]?.name ?? BUILDINGS[type]?.name ?? type;
    const body = rows.map((row) => `<tr>
      <td>${esc(name(row.type))}</td>
      <td>${row.kills}</td>
      <td>${row.losses}</td>
      <td>${Math.round(row.damage)}</td>
    </tr>`).join('');
    return `
      <div class="end-detail">
        <div class="end-detail-title">${t('overlay.detailTitle')}</div>
        <table class="end-detail-table">
          <thead><tr><th>${t('overlay.detailType')}</th><th>${t('overlay.detailKills')}</th><th>${t('overlay.detailLosses')}</th><th>${t('overlay.detailDamage')}</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  showEnd(result) {
    if (this.game.mission) {
      this.showMissionEnd(result, this.game.mission);
      return;
    }
    this.overlayBack = null;
    this.inLobby = false;
    const victory = result === 'victory';
    const s = this.game.stats;
    const map = this.game.map;
    const html = `
      <div class="end-head ${victory ? 'win' : 'lose'}">
        <div class="eyebrow"><i></i> ${victory ? t('overlay.endEyebrowWin') : t('overlay.endEyebrowLose')}</div>
        <h1>${victory ? t('overlay.endTitleWin') : t('overlay.endTitleLose')}</h1>
        <p class="tagline">${victory ? t('overlay.endTaglineWin') : t('overlay.endTaglineLose')}</p>
      </div>
      <div class="end-stats">
        <div><b>${formatTime(s.time ?? this.game.elapsed)}</b><span>${t('overlay.statTime')}</span></div>
        <div><b>${s.kills}</b><span>${t('overlay.statKills')}</span></div>
        <div><b>${s.losses}</b><span>${t('overlay.statLosses')}</span></div>
        <div><b>${Math.floor(s.gathered)}</b><span>${t('overlay.statGathered')}</span></div>
      </div>
      ${this.endDetailHtml()}
      <div class="end-map">${t('overlay.endMap', { label: map.label, symmetry: map.symmetry.name.toUpperCase(), tag: map.symmetry.tag, style: map.style.name })}</div>
      <div class="end-note">${victory ? t('overlay.endNoteWin') : t('overlay.endNoteLose')}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="newmap">${t('overlay.newMap')} <span>↻</span></button>
        <button class="btn-ghost" data-action="restart">${t('overlay.repeatMap')}</button>
        <button class="btn-ghost" data-action="changelog">${t('menu.changelog')}</button>
      </div>
      <div class="overlay-footer">
        <span>${t('overlay.footerResults')}</span>
        <span>${victory ? t('overlay.statusClosed') : t('overlay.statusEvac')}</span>
      </div>
    `;
    this.setOverlay(html, `overlay--end ${victory ? 'is-win' : 'is-lose'}`);
  }

  showMissionEnd(result, mission) {
    this.overlayBack = null;
    this.inLobby = false;
    const victory = result === 'victory';
    const s = this.game.stats;
    const map = this.game.map;
    const isCampaign = mission.kind === 'campaign';
    const isEndless = mission.kind === 'endless';
    const next = isCampaign && victory ? nextCampaignMission(mission) : null;
    const best = isEndless ? endlessBest(mission) : isCampaign ? null : trialBest(mission);
    const record = isEndless ? this.game.record : null;
    const kindLabel = isEndless ? t('overlay.kindProtocol') : isCampaign ? t('overlay.kindCampaign') : t('overlay.kindTrials');
    const title = isEndless
      ? t('overlay.protocolHalted')
      : victory
        ? isCampaign
          ? (next ? t('overlay.operationDone') : t('overlay.contractClosed'))
          : t('overlay.trialDone')
        : isCampaign ? t('overlay.endEyebrowLose') : t('overlay.trialFailed');
    const tagline = isEndless
      ? t('overlay.endlessTagline')
      : victory
        ? (mission.outro ?? mission.subtitle)
        : t('overlay.loseTagline');
    let primary;
    let showRepeat = true;
    let showList = true;
    if (isEndless) {
      primary = `<button class="btn-primary" data-action="restart">${t('overlay.again')} <span>↻</span></button>`;
      showRepeat = false;
    } else if (victory && next) {
      primary = `<button class="btn-primary" data-action="mission:${next.id}">${t('overlay.nextOperation')} <span>→</span></button>`;
    } else if (victory) {
      primary = `<button class="btn-primary" data-action="missionlist">${isCampaign ? t('overlay.toListCampaign') : t('overlay.toListTrials')} <span>→</span></button>`;
      showList = false;
    } else {
      primary = `<button class="btn-primary" data-action="restart">${t('overlay.repeat')} <span>↻</span></button>`;
      showRepeat = false;
    }
    const html = `
      <div class="end-head ${victory ? 'win' : 'lose'}">
        <div class="eyebrow"><i></i> ${kindLabel} // ${String(mission.index).padStart(2, '0')} · ${esc(mission.title.toUpperCase())}</div>
        <h1>${title}</h1>
        <p class="tagline">${esc(tagline)}</p>
      </div>
      <div class="end-stats">
        <div><b>${formatTime(s.time ?? this.game.elapsed)}</b><span>${t('overlay.statTimeShort')}</span></div>
        <div><b>${s.kills}</b><span>${t('overlay.statKills')}</span></div>
        <div><b>${s.losses}</b><span>${t('overlay.statLosses')}</span></div>
        <div><b>${Math.floor(s.gathered)}</b><span>${t('overlay.statGathered')}</span></div>
        ${isEndless ? `<div><b>${s.waves ?? 0}</b><span>${t('overlay.statWaves')}</span></div>` : ''}
      </div>
      ${this.objectivesHtml(mission, true)}
      ${this.endDetailHtml()}
      <div class="end-map">${t('overlay.endMap', { label: map.label, symmetry: map.symmetry.name.toUpperCase(), tag: map.symmetry.tag, style: map.style.name })}</div>
      <div class="overlay-actions">
        ${primary}
        ${showRepeat ? `<button class="btn-ghost" data-action="restart">${t('overlay.repeat')}</button>` : ''}
        ${showList ? `<button class="btn-ghost" data-action="missionlist">${t('overlay.toListShort')}</button>` : ''}
        <button class="btn-ghost" data-action="mainmenu">${t('overlay.mainMenu')}</button>
      </div>
      <div class="overlay-footer">
        <span>${t('overlay.footerMission', { kind: kindLabel, title: esc(mission.title.toUpperCase()) })}</span>
        <span>${isEndless
          ? (best
            ? t('overlay.recordWaves', { label: record?.isRecord ? t('overlay.newRecord') : t('overlay.record'), time: formatTime(best.time), waves: best.waves })
            : t('overlay.statusProtocol'))
          : best != null ? t('overlay.bestTime', { time: formatTime(best) }) : victory ? t('overlay.statusDone') : t('overlay.statusFailed')}</span>
      </div>
    `;
    this.setOverlay(html, `overlay--end ${victory ? 'is-win' : 'is-lose'}`);
  }

  supportsFullscreen() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  fullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  toggleFullscreen() {
    if (!this.supportsFullscreen()) return;
    if (this.fullscreenActive()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      exit?.call(document);
      return;
    }
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    // Браузер вправе отказать (например, внутри iframe) — это не ошибка игры.
    const result = request.call(el);
    result?.catch?.(() => {});
  }

  /** Иконка и подписи кнопки следуют реальному состоянию браузера: режим
   *  можно выйти клавишей Esc или системным жестом, без клика по кнопке. */
  syncFullscreenBtn() {
    const btn = this.el.fullscreenBtn;
    if (!btn) return;
    const active = this.fullscreenActive();
    const span = btn.querySelector('span');
    if (span) span.innerHTML = icon(active ? 'compress' : 'expand');
    btn.title = active ? t('overlay.fullscreenExit') : t('static.fullscreen');
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(active));
  }

  togglePause() {
    if (!this.game.started || this.game.over) return;
    if (this.overlayOpen) {
      if (this.overlayBack) this.backFromOverlay();
      else this.resume();
    } else {
      this.openPause();
    }
  }

  openPause() {
    if (!this.game.started || this.game.over) return;
    this.overlayBack = null;
    this.inLobby = false;
    this.game.setPaused(true);
    const map = this.game.map;
    const mission = this.game.mission;
    const isCampaign = mission?.kind === 'campaign';
    const isEndless = mission?.kind === 'endless';
    const kindLabel = isEndless ? t('overlay.kindProtocol') : isCampaign ? t('overlay.kindCampaign') : t('overlay.kindTrial');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('overlay.pauseEyebrow')}${mission ? ` // ${kindLabel}` : ''}</div>
        <h1 class="pause-title">${mission ? esc(mission.title.toUpperCase()) : t('overlay.pauseOperation')}<br><span>${t('overlay.paused')}</span></h1>
        <p class="tagline">${mission ? esc(mission.subtitle) : t('overlay.pauseTagline')}</p>
      </div>
      <div class="pause-stats">
        <div><b>${Math.floor(this.game.credits)}</b><span>${t('static.credits')}</span></div>
        <div><b>${this.game.getArmyUsed('player')} / ${this.game.getArmyCap('player')}</b><span>${t('overlay.armyLimit')}</span></div>
        <div><b>${formatTime(this.game.elapsed)}</b><span>${t('overlay.statTimeShort')}</span></div>
      </div>
      ${mission ? `<div class="pause-objectives">${this.objectivesHtml(mission, true)}</div>` : ''}
      <div class="graphics-row pause-speed">
        <span class="graphics-label">${t('overlay.combatSpeed')}</span>
        <div class="graphics-options">
          ${[0.5, 1, 2].map((v) => `<button type="button" class="graphics-opt${this.game.speed === v ? ' is-active' : ''}" data-speed="${v}" aria-pressed="${this.game.speed === v}">${v}×</button>`).join('')}
        </div>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="resume">${t('overlay.resume')} <span>→</span></button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="settings">${t('menu.settings')}</button>
          <button class="btn-ghost" data-action="help">${t('menu.help')}</button>
          <button class="btn-ghost" data-action="changelog">${t('menu.changelog')}</button>
          <button class="btn-ghost" data-action="credits">${t('menu.credits')}</button>
        </div>
      </div>
      <div class="overlay-actions overlay-actions--minor">
        <button class="btn-ghost" data-action="restart">${t('overlay.restart')}</button>
        ${mission
          ? `<button class="btn-ghost" data-action="missionlist">${t('overlay.toListShort')}</button>
             <button class="btn-ghost" data-action="mainmenu">${t('overlay.mainMenu')}</button>`
          : `<button class="btn-ghost" data-action="newmap">${t('overlay.newMap')}</button>`}
      </div>
      <div class="overlay-footer">
        <span>${t('overlay.pauseFooter', { label: map.label })}${mission ? ` · ${esc(mission.title.toUpperCase())}` : ''}</span>
        <span>${t('overlay.simPaused')}</span>
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
    this.renderGroups();
  }

  startGame() {
    if (!this.game.started && !this.game.over) {
      const seed = this.selectedLobbySeed();
      if (seed == null) {
        this.updateSeedHint();
        this.el.overlay.querySelector('#seedInput')?.focus();
        return;
      }
      if (seed !== this.game.map.seed) {
        this.launchSeed(seed, true);
        return;
      }
      this.syncLobbyUrl();
    }
    this.beginGame();
  }

  beginGame() {
    document.activeElement?.blur?.();
    this.overlayBack = null;
    this.inLobby = false;
    this.missionsScreen = null;
    this.overlayOpen = false;
    this.el.overlay.classList.remove('is-open');
    document.body.classList.remove('overlay-open');
    this.game.begin();
    this.renderHeader();
    this.renderCommands();
    this.renderGroups();
    this.drawMinimap();
  }

  /** Запоминает режим сида в адресе, чтобы F5 вернул в то же лобби. */
  syncLobbyUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('start');
    if (this.seedMode === 'manual') url.searchParams.set('seedmode', 'manual');
    else url.searchParams.delete('seedmode');
    if (url.toString() !== window.location.href) {
      window.history.replaceState(null, '', url.toString());
    }
  }

  /**
   * Загружает выбранный сид. Если карта ещё не создана этим запуском,
   * страница перезагружается: при autostart игра начнётся сразу после загрузки.
   */
  launchSeed(seed, autostart = false) {
    document.activeElement?.blur?.();
    const url = new URL(seedUrl(seed));
    url.searchParams.delete('start');
    if (this.seedMode === 'manual') url.searchParams.set('seedmode', 'manual');
    else url.searchParams.delete('seedmode');
    if (autostart) url.searchParams.set('start', '1');
    window.location.assign(url.toString());
  }

  /** Перезагружает игру с новым случайным сидом карты. */
  newMap() {
    document.activeElement?.blur?.();
    const url = new URL(seedUrl(randomSeed()));
    url.searchParams.delete('seedmode');
    url.searchParams.delete('start');
    window.location.assign(url.toString());
  }

  /** Куда вернуться из вложенного экрана меню: на итоги, в паузу, лобби или старт. */
  backTarget() {
    if (this.game.over) return () => this.showEnd(this.game.over);
    if (this.game.started) return () => this.openPause();
    if (this.missionsScreen) return () => this.showMissions(this.missionsScreen);
    if (this.activeMission) return () => this.showBriefing(this.activeMission);
    if (this.inLobby) return () => this.showLobby();
    return () => this.showStart();
  }

  // --------------------------------------------------------------- settings
  openSettings() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    this.overlayBack = this.backTarget();
    this.showSettings();
  }

  showSettings() {
    const order = ['graphics', 'audio', 'lang'];
    const active = order.includes(this.settingsTab) ? this.settingsTab : 'graphics';
    const paneId = (key) => `settingsPane${key[0].toUpperCase()}${key.slice(1)}`;
    const tabs = order.map((key) => `
        <button type="button" class="settings-tab${active === key ? ' is-active' : ''}" id="settingsTab${key[0].toUpperCase()}${key.slice(1)}" role="tab" aria-selected="${active === key}" aria-controls="${paneId(key)}" tabindex="${active === key ? 0 : -1}" data-settings-tab="${key}">${t(`settings.tab.${key}`)}</button>`).join('');
    const panes = order.map((key) => `
      <div class="settings-pane" id="${paneId(key)}" role="tabpanel" aria-labelledby="settingsTab${key[0].toUpperCase()}${key.slice(1)}" data-settings-pane="${key}"${active === key ? '' : ' hidden'}>
        ${key === 'graphics' ? this.graphicsBlock() : key === 'audio' ? this.audioBlock() : this.langBlock()}
        <p class="settings-hint">${t(`settings.${key}Hint`)}</p>
      </div>`).join('');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('settings.network')}</div>
        <h1 class="settings-title">${t('settings.title')}</h1>
        <p class="tagline">${t('settings.tagline')}</p>
      </div>
      <div class="settings-tabs" role="tablist" aria-label="${t('settings.tabsAria')}">${tabs}
      </div>
      ${panes}
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">${t('settings.back')} <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>${t('settings.footer.title')}</span>
        <span>${t('settings.footer.saved')}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--settings');
  }

  setSettingsTab(tab) {
    const order = ['graphics', 'audio', 'lang'];
    this.settingsTab = order.includes(tab) ? tab : 'graphics';
    const card = this.el.overlayCard;
    card.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      const active = btn.dataset.settingsTab === this.settingsTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });
    card.querySelectorAll('[data-settings-pane]').forEach((pane) => {
      pane.hidden = pane.dataset.settingsPane !== this.settingsTab;
    });
  }

  // Язык применяем перезагрузкой страницы, поэтому кнопки живут в этом блоке.
  langBlock() {
    const current = getLang();
    const buttons = LANGS.map(({ value, label }) =>
      `<button type="button" class="graphics-opt${current === value ? ' is-active' : ''}" data-lang="${value}" aria-pressed="${current === value}">${label}</button>`).join('');
    return `<div class="graphics-grid">${buttons}</div>`;
  }

  // ------------------------------------------------------------------ help
  openHelp() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    this.overlayBack = this.backTarget();
    this.showHelp();
  }

  showHelp() {
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('help.eyebrow')}</div>
        <h1 class="help-title">${t('menu.help')}</h1>
        <p class="tagline">${t('help.tagline')}</p>
      </div>
      <div class="controls-block help-controls">
        <div class="controls-title">${t('help.kbd.title')} <span>${t('help.kbd.pc')}</span></div>
        <div class="controls-grid">
          <div><kbd>${t('static.kbd.lmb')}</kbd><span>${t('help.kbd.lmb')}</span></div>
          <div><kbd>${t('static.kbd.rmb')}</kbd><span>${t('help.kbd.rmb')}</span></div>
          <div><kbd>WASD</kbd><span>${t('help.kbd.wasd')}</span></div>
          <div><kbd>Q / E</kbd><span>${t('help.kbd.rotate')}</span></div>
          <div><kbd>${t('help.kbd.wheelKey')}</kbd><span>${t('help.kbd.zoom')}</span></div>
          <div><kbd>${t('help.kbd.mmbKey')}</kbd><span>${t('help.kbd.drag')}</span></div>
          <div><kbd>Z X C V B N M</kbd><span>${t('help.kbd.commands')}</span></div>
          <div><kbd>F</kbd><span>${t('help.kbd.areaAttack')}</span></div>
          <div><kbd>H</kbd><span>${t('help.kbd.stop')}</span></div>
          <div><kbd>P</kbd><span>${t('help.kbd.hold')}</span></div>
          <div><kbd>T</kbd><span>${t('help.kbd.patrol')}</span></div>
          <div><kbd>I</kbd><span>${t('help.kbd.idleEngineers')}</span></div>
          <div><kbd>K</kbd><span>${t('help.kbd.sell')}</span></div>
          <div><kbd>R</kbd><span>${t('help.kbd.repair')}</span></div>
          <div><kbd>Shift</kbd><span>${t('help.kbd.add')}</span></div>
          <div><kbd>Shift + ${t('static.kbd.rmb')}</kbd><span>${t('help.kbd.waypoint')}</span></div>
          <div><kbd>Shift + ${t('static.kbd.lmb')}</kbd><span>${t('help.kbd.multiBuild')}</span></div>
          <div><kbd>Shift + 1…9</kbd><span>${t('help.kbd.assignGroup')}</span></div>
          <div><kbd>1…9</kbd><span>${t('help.kbd.recallGroup')}</span></div>
          <div><kbd>${t('help.kbd.spaceKey')}</kbd><span>${t('help.kbd.toBase')}</span></div>
          <div><kbd>Esc</kbd><span>${t('help.kbd.pauseMenu')}</span></div>
          <div><kbd>${t('static.kbd.lmb')}</kbd><span>${t('help.kbd.minimapCam')}</span></div>
        </div>
      </div>
      <div class="controls-block">
        <div class="controls-title">${t('help.touch.title')} <span>${t('help.touch.sub')}</span></div>
        <div class="controls-grid help-touch-grid">
          <div><kbd>${t('help.touch.tap')}</kbd><span>${t('help.touch.tapDesc')}</span></div>
          <div><kbd>${t('help.touch.doubleTap')}</kbd><span>${t('help.touch.doubleTapDesc')}</span></div>
          <div><kbd>${t('help.touch.oneFinger')}</kbd><span>${t('help.touch.oneFingerDesc')}</span></div>
          <div><kbd>${t('help.touch.twoFingers')}</kbd><span>${t('help.touch.twoFingersDesc')}</span></div>
          <div><kbd>${t('help.touch.pinch')}</kbd><span>${t('help.kbd.zoom')}</span></div>
          <div><kbd>${t('help.touch.slot')}</kbd><span>${t('help.touch.slotDesc')}</span></div>
          <div><kbd>${t('help.touch.buttons')}</kbd><span>${t('help.touch.buttonsDesc')}</span></div>
          <div><kbd>${t('help.touch.minimap')}</kbd><span>${t('help.touch.minimapDesc')}</span></div>
        </div>
      </div>
      <div class="controls-block">
        <div class="controls-title">${t('help.pad.title')} <span>${t('help.pad.sub')}</span></div>
        <div class="controls-grid">
          <div><kbd>${t('help.pad.lstick')}</kbd><span>${t('help.pad.camera')}</span></div>
          <div><kbd>RT</kbd><span>${t('help.pad.rt')}</span></div>
          <div><kbd>${t('help.pad.rstick')}</kbd><span>${t('help.pad.reticle')}</span></div>
          <div><kbd>${t('help.pad.lt')}</kbd><span>${t('help.pad.selectBox')}</span></div>
          <div><kbd>${t('help.pad.dpadUD')}</kbd><span>${t('help.kbd.zoom')}</span></div>
          <div><kbd>${t('help.pad.dpadLR')}</kbd><span>${t('help.kbd.rotate')}</span></div>
          <div><kbd>R3</kbd><span>${t('help.pad.panel')}</span></div>
          <div><kbd>A</kbd><span>${t('help.pad.a')}</span></div>
          <div><kbd>X</kbd><span>${t('help.pad.x')}</span></div>
          <div><kbd>Y</kbd><span>${t('help.kbd.areaAttack')}</span></div>
          <div><kbd>B</kbd><span>${t('help.pad.b')}</span></div>
          <div><kbd>Start</kbd><span>${t('help.kbd.pauseMenu')}</span></div>
          <div><kbd>Back</kbd><span>${t('help.pad.back')}</span></div>
        </div>
        <p class="help-note">${t('help.pad.note')}</p>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">${t('help.back')} <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>${t('help.eyebrow')}</span>
        <span>${t('help.escBack')}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--help');
  }

  // --------------------------------------------------------------- changelog
  /** Открывает журнал изменений, запоминая, куда вернуться по кнопке «Назад». */
  openChangelog() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    this.overlayBack = this.backTarget();
    this.showChangelog();
  }

  backFromOverlay() {
    const back = this.overlayBack;
    this.overlayBack = null;
    if (back) back();
    else this.resume();
  }

  /** Крестик закрывает вложенный экран назад, а паузу — обратно в бой. */
  closeOverlay() {
    document.activeElement?.blur?.();
    if (this.overlayBack) {
      this.backFromOverlay();
      return;
    }
    if (this.game.started && !this.game.over) this.resume();
  }

  showChangelog() {
    const releases = CHANGELOG.map((release) => {
      const sections = release.sections.map((section) => `
        <div class="log-section">
          <div class="log-section-title">${esc(section.title)}</div>
          <ul class="log-list">${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </div>`).join('');
      const dateLabel = release.date ?? release.tag ?? '';
      const kindLabel = release.version === 'ОБНОВЛЕНИЕ'
        ? t('ui.changelog.update')
        : t('ui.changelog.version', { version: release.version });
      return `
        <article class="log-release${release.current ? ' is-current' : ''}">
          <div class="log-head">
            <b>${esc(dateLabel)}</b>
            <span>${esc(kindLabel)}</span>
          </div>
          ${sections}
        </article>`;
    }).join('');
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('ui.changelog.eyebrow')}</div>
        <h1 class="log-title">${t('ui.changelog.title')}</h1>
        <p class="tagline">${t('ui.changelog.tagline', { version: esc(GAME_VERSION) })}</p>
      </div>
      <div class="log-body">${releases}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">${t('help.back')} <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>${t('ui.changelog.eyebrow')}</span>
        <span>${t('ui.changelog.history')}</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--changelog');
  }

  // ---------------------------------------------------------------- credits
  /** Открывает досье авторства, запоминая, куда вернуться по кнопке «Назад». */
  openCredits() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    this.overlayBack = this.backTarget();
    this.showCredits();
  }

  showCredits() {
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> ${t('credits.eyebrow')}</div>
        <h1 class="credits-title">${t('menu.credits')}</h1>
        <p class="tagline">${t('credits.tagline')}</p>
      </div>
      <div class="credits-block">
        <div class="credits-label">${t('credits.authorLabel')}</div>
        <div class="credits-author">
          <b>${t('credits.author')}</b>
          <span>${t('credits.authorRoles')}</span>
        </div>
        <div class="credits-links">
          <a class="credits-link" href="https://github.com/DEMENT0R" target="_blank" rel="noopener noreferrer">github.com/DEMENT0R</a>
        </div>
      </div>
      <div class="credits-block">
        <div class="credits-label">${t('credits.howLabel')}</div>
        <p class="credits-note">${t('credits.how')}</p>
      </div>
      <div class="credits-block">
        <div class="credits-label">${t('credits.baseLabel')}</div>
        <p class="credits-note">${t('credits.base')}</p>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">${t('help.back')} <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>${t('credits.eyebrow')}</span>
        <span>${t('credits.versionRepo', { version: esc(GAME_VERSION) })} <a class="credits-link" href="https://github.com/DEMENT0R/babylonjs-rts-game" target="_blank" rel="noopener noreferrer">${t('credits.repo')}</a></span>
      </div>
    `;
    this.setOverlay(html, 'overlay--credits');
  }

  hideOverlay() {
    this.overlayOpen = false;
    this.el.overlay.classList.remove('is-open');
    document.body.classList.remove('overlay-open');
  }

  setOverlay(html, variant) {
    const closable = Boolean(this.overlayBack) || (this.game.started && !this.game.over);
    const close = closable
      ? `<button type="button" class="overlay-close" data-action="close" aria-label="${t('settings.close')}" title="${t('settings.closeTitle')}">✕</button>`
      : '';
    this.el.overlayCard.className = `overlay-card ${variant ?? ''}`;
    this.el.overlayCard.innerHTML = `${close}${html}`;
    this.el.overlay.className = `overlay is-open ${variant ?? ''}`;
    this.overlayOpen = true;
    document.body.classList.add('overlay-open');
  }

  // --------------------------------------------------------------- graphics
  graphicsBlock() {
    const values = this.game.graphics?.get?.() ?? {};
    const rows = Object.entries(GRAPHICS_OPTIONS).map(([key, options]) => {
      const label = t(`settings.label.${key}`);
      const buttons = options.map((option) => {
        const active = values[key] === option.value;
        return `<button type="button" class="graphics-opt${active ? ' is-active' : ''}" data-graphics="${key}" data-value="${option.value}" aria-pressed="${active}">${option.label ?? t(`settings.opt.${key}.${option.value}`)}</button>`;
      }).join('');
      return `
        <div class="graphics-row">
          <span class="graphics-label">${label}</span>
          <div class="graphics-options">${buttons}</div>
        </div>`;
    }).join('');
    return `<div class="graphics-grid">${rows}</div>`;
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

  refreshSpeedControls() {
    this.el.overlay.querySelectorAll('[data-speed]').forEach((btn) => {
      const active = Number(btn.dataset.speed) === this.game.speed;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  // ------------------------------------------------------------------ звук
  audioBlock() {
    const values = this.game.audioSettings?.get?.() ?? {};
    const rows = Object.entries(AUDIO_DEFAULTS).map(([key]) => {
      const label = t(`settings.label.${key}`);
      const value = Number(values[key] ?? 0);
      return `
        <div class="audio-row">
          <span class="graphics-label">${label}</span>
          <input class="audio-range" type="range" min="0" max="100" step="5"
            value="${value}" data-audio="${key}" aria-label="${label}" />
          <output class="audio-value" data-audio-value="${key}">${value}%</output>
        </div>`;
    }).join('');
    return `<div class="audio-grid">${rows}</div>`;
  }

  refreshAudioControls() {
    const values = this.game.audioSettings?.get?.();
    if (!values) return;
    this.el.overlay.querySelectorAll('[data-audio]').forEach((input) => {
      const value = Number(values[input.dataset.audio] ?? 0);
      if (Number(input.value) !== value) input.value = String(value);
      const out = this.el.overlay.querySelector(`[data-audio-value="${input.dataset.audio}"]`);
      if (out) out.textContent = `${value}%`;
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
          label: t('cmd.attackmove'),
          short: t('cmd.attackmoveShort'),
          icon: 'attack',
          hotkey: 'F',
          desc: t('cmd.attackmoveDesc'),
          action: () => {
            if (game.input) game.input.setAttackMove(true);
          },
        },
        {
          id: 'patrol',
          label: t('cmd.patrol'),
          short: t('cmd.patrolShort'),
          icon: 'move',
          hotkey: 'T',
          desc: t('cmd.patrolDesc'),
          action: () => {
            if (game.input) game.input.setPatrol(true);
          },
        },
        {
          id: 'hold',
          label: t('cmd.hold'),
          short: t('cmd.holdShort'),
          icon: 'hold',
          hotkey: 'P',
          desc: t('cmd.holdDesc'),
          action: () => game.commandHold(),
        },
        {
          id: 'stop',
          label: t('cmd.stop'),
          short: t('cmd.stopShort'),
          icon: 'stop',
          hotkey: 'H',
          desc: t('cmd.stopDesc'),
          action: () => game.commandStop(),
        },
      ];
      if (hasEngineer) {
        BUILD_ORDER.forEach((type, i) => {
          if (game.missionAllowsBuilding(type)) commands.push(this.buildCommand(type, BUILD_HOTKEYS[i]));
        });
      }
      return commands;
    }

    if (!buildings.length) return [this.idleEngineersCommand()];
    const b = buildings[0];

    if (!b.complete && b.faction === 'player') {
      return [{
        id: 'cancelbuild',
        label: t('cmd.cancelBuild'),
        short: t('cmd.cancelBuildShort'),
        icon: 'close',
        hotkey: 'X',
        desc: t('cmd.cancelBuildDesc', { name: b.def.name }),
        action: () => b.cancelConstruction(true),
      }];
    }

    if (b.faction !== 'player') return [];

    const repair = this.repairCommand(buildings);
    // Продажа неоднозначна для группы зданий, поэтому доступна только одной
    // выбранной постройке.
    const sell = buildings.length === 1 ? this.sellCommand(b) : null;

    if (b.type === 'hq') {
      const commands = BUILD_ORDER
        .map((type, i) => (game.missionAllowsBuilding(type) ? this.buildCommand(type, BUILD_HOTKEYS[i]) : null))
        .filter(Boolean);
      (UNIT_PRODUCTION.hq ?? []).forEach((type, i) => {
        if (!game.missionAllowsUnit(type)) return;
        commands.push(this.trainCommand(type, b, HQ_TRAIN_HOTKEYS[i]));
      });
      if (repair) commands.push(repair);
      return commands;
    }

    const trainTypes = UNIT_PRODUCTION[b.type];
    if (trainTypes?.length) {
      // Найм идёт во все выбранные здания этого типа, а не только в первое.
      const producers = buildings.filter((item) => item.type === b.type);
      const commands = trainTypes
        .map((type, i) => (game.missionAllowsUnit(type) ? this.trainCommand(type, producers, TRAIN_HOTKEYS[i]) : null))
        .filter(Boolean);
      if (repair) commands.push(repair);
      if (sell) commands.push(sell);
      return commands;
    }

    if (b.def.research) {
      // Каждое исследовательское здание показывает только свои линии.
      const lines = game.researchLines(b.type);
      const commands = lines.map((lineKey, i) => this.upgradeCommand(lineKey, b, BUILD_HOTKEYS[i]));
      if (repair) commands.push(repair);
      if (sell) commands.push(sell);
      return commands;
    }

    return [repair, sell].filter(Boolean);
  }

  /** Глобальная команда: выделить свободных инженеров без текущего задания. */
  idleEngineersCommand() {
    return {
      id: 'idleengineers',
      label: t('cmd.idleEngineers'),
      short: t('cmd.idleEngineersShort'),
      icon: 'engineer',
      hotkey: 'I',
      desc: t('cmd.idleEngineersDesc'),
      action: () => this.game.selectIdleEngineers(),
    };
  }

  /**
   * Продажа достроенного здания. Командный центр не продаётся: его потеря
   * означает поражение, а не освобождение места.
   */
  sellCommand(building) {
    if (!building || !building.complete || building.type === 'hq') return null;
    const refund = Math.floor((building.def.cost ?? 0) * SELL.refund);
    return {
      id: 'sell',
      label: t('cmd.sell'),
      short: t('cmd.sellShort'),
      icon: 'close',
      hotkey: 'K',
      desc: t('cmd.sellDesc', { name: building.def.name, refund }),
      action: () => this.game.sellBuilding(building),
    };
  }

  buildCommand(type, hotkey) {
    const game = this.game;
    const def = BUILDINGS[type];
    const freePatch = type === 'derrick' && !game.world.oilPatches.some((p) => !p.derrick || !p.derrick.alive);
    const missing = game.missingBuildingRequirements('player', type);
    const disabled = freePatch || missing.length > 0 || game.credits < def.cost;
    const missingNames = missing.map((req) => BUILDINGS[req]?.name ?? req).join(', ');
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
      reason: missing.length
        ? t('cmd.requires', { names: missingNames })
        : freePatch
          ? t('cmd.noFreePatches')
          : t('cmd.needCredits', { cost: def.cost }),
      action: () => game.startPlacement(type),
      tip: this.buildTip(def),
    };
  }

  trainCommand(type, buildings, hotkey) {
    const game = this.game;
    const def = UNITS[type];
    const expected = UNITS[type]?.from;
    const list = (Array.isArray(buildings) ? buildings : [buildings])
      .filter((b) => b && b.alive && b.type === expected);
    const supply = def.supply ?? 1;
    const capReached = game.getArmyUsed('player') + game.getQueuedSupply('player') + supply
      > game.getArmyCap('player');
    const ready = list.filter((b) => b.complete);
    const locked = def.requires && !game.upgrades.player.has(def.requires);
    const disabled = locked || ready.length === 0 || capReached || game.credits < def.cost;
    const reason = locked
      ? t('cmd.requiresResearch', { name: UPGRADES[def.requires]?.name ?? def.requires })
      : list.length === 0 || ready.length === 0 ? MESSAGES.notReady
        : capReached ? MESSAGES.capReached
          : t('cmd.needCredits', { cost: def.cost });
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
      reason,
      // batch = 5 при Shift+клике: пятёрка раскладывается по выбранным
      // казармам по кругу, поэтому очередь одной постройки не разрастается.
      action: (batch = 1) => {
        let queued = 0;
        for (let round = 0; round < batch; round++) {
          let placed = false;
          for (const b of ready) {
            if (game.credits < def.cost) break;
            const used = game.getArmyUsed('player') + game.getQueuedSupply('player');
            if (used + supply > game.getArmyCap('player')) break;
            if (game.trainUnit(type, b)) {
              queued++;
              placed = true;
            }
          }
          if (!placed) break;
        }
        if (queued) {
          this.renderSelection();
          this.renderCommands();
        }
        if (!queued) {
          game.notify(reason, 'warn', `train-${type}`, 0, 3);
        } else if (queued < batch) {
          game.notify(
            t('cmd.trainPartial', { queued, batch }),
            'info',
            `train-partial-${type}`,
            0,
            3,
          );
        }
      },
      tip: this.unitTip(def),
    };
  }

  upgradeCommand(lineKey, building, hotkey) {
    const game = this.game;
    const nextKey = game.nextUpgradeKey('player', lineKey);
    const lineKeys = UPGRADE_LINE_KEYS[lineKey] ?? [lineKey];
    const def = UPGRADES[nextKey ?? lineKeys[lineKeys.length - 1]];
    const done = !nextKey;
    const queued = nextKey ? game.hasPendingUpgrade('player', nextKey) : false;
    const disabled = !building.complete || done || queued || game.credits < def.cost;
    const reason = !building.complete ? MESSAGES.notReady
      : done ? t('cmd.upgradeDone')
        : queued ? t('cmd.upgradeQueued')
          : t('cmd.needCredits', { cost: def.cost });
    return {
      id: `research:${nextKey ?? lineKey}`,
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
        if (nextKey && game.startUpgrade(building, nextKey)) {
          this.renderSelection();
          this.renderCommands();
        }
      },
      tip: this.upgradeTip(def, done, queued),
    };
  }

  upgradeTip(def, done, queued) {

    const flat = new Set(['armor', 'pierce', 'visionAdd', 'salvoAdd', 'armyCap']);
    const lower = new Set(['cooldown', 'trainTime', 'buildTime', 'repairCost']);
    const unlocks = (def.unlocks ?? [])
      .map((type) => UNITS[type]?.name ?? type)
      .join(', ');
    const effects = Object.entries(def.effects ?? {}).map(([stat, value]) => {
      let text;
      if (flat.has(stat)) text = `+${value}`;
      else if (lower.has(stat)) {
        // Множитель меньше единицы ускоряет процесс, больше — замедляет.
        text = value <= 1
          ? `−${Math.round((1 - value) * 100)}%`
          : `+${Math.round((value - 1) * 100)}%`;
      } else text = `+${Math.round((value - 1) * 100)}%`;
      return `<span><i>${t(`tooltip.stat.${stat}`)}</i>${text}</span>`;
    }).join('');
    const levels = UPGRADE_LINE_KEYS[def.line]?.length ?? 1;
    const state = done ? t('tooltip.researchDone') : queued ? t('tooltip.researchQueued') : t('tooltip.researchLevel', { tier: def.tier, levels });
    return `
      <div class="tip-head"><span class="tip-role">${t('tooltip.research')}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">${effects}${unlocks ? `<span><i>${t('tooltip.unlocks')}</i>${unlocks}</span>` : ''}</div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.time} ${t('tooltip.seconds')} · ${state}</span></div>
    `;
  }

  repairCommand(buildings) {
    const damaged = buildings.filter((b) => b.complete && b.hp < b.maxHp - 0.5);
    if (!damaged.length) return null;
    const repairing = damaged.some((b) => b.repairing);
    return {
      id: 'repair',
      label: repairing ? t('cmd.repairStop') : t('cmd.repair'),
      short: repairing ? t('cmd.repairStopShort') : t('cmd.repairShort'),
      icon: 'repair',
      hotkey: 'R',
      desc: t('cmd.repairDesc'),
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
      <div class="tip-head"><span class="tip-role">${t('tooltip.repair.role')}</span><b>${t('cmd.repair')}</b></div>
      <p>${t('tooltip.repair.body')}</p>
      <div class="tip-stats">
        <span><i>${t('tooltip.repair.rate')}</i>${rate.toFixed(1)}</span>
        <span><i>${t('tooltip.repair.perHp')}</i>${perHp.toFixed(2)}</span>
        <span><i>${t('tooltip.repair.full')}</i>${full}</span>
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${full}</span><span>${repairing ? t('tooltip.repair.active') : t('tooltip.repair.hotkey')}</span></div>
    `;
  }

  unitTip(def) {
    const mods = this.game.unitModifiers('player', def.key);
    const hp = Math.round(def.hp * mods.hp);
    const damage = Math.round(def.damage * mods.damage);
    const range = Math.round(def.range * mods.range);
    const speed = (def.speed * mods.speed).toFixed(1);
    const support = def.healer
      ? `<span><i>${t('tooltip.stat.healRate')}</i>${(FIELD_SUPPORT.medicRate * mods.healRate).toFixed(1)}/${t('tooltip.seconds')}</span><span><i>${t('tooltip.stat.healRadius')}</i>${Math.round(FIELD_SUPPORT.medicSeekRadius * mods.healRadius)}</span>`
      : def.repairer
        ? `<span><i>${t('tooltip.stat.repairTech')}</i>${(FIELD_SUPPORT.engineerRate * mods.repairRate).toFixed(1)}/${t('tooltip.seconds')}</span>`
        : '';
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${hp}</span><span><i>${t('tooltip.stat.damage')}</i>${damage}</span>
        <span><i>${t('tooltip.stat.range')}</i>${range}</span><span><i>${t('tooltip.stat.speed')}</i>${speed}</span>
        <span><i>${t('tooltip.stat.armySupply')}</i>${def.supply ?? 1}</span>
        ${def.builder ? `<span><i>${t('tooltip.stat.buildSpeed')}</i>${t('tooltip.unit.buildsUpTo')}</span>` : ''}
        ${support}
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.buildTime} ${t('tooltip.seconds')} · ${BUILDINGS[def.from]?.name?.toLowerCase() ?? t('tooltip.unit.fromHq')} · ${t('tooltip.unit.batch')}</span></div>
    `;
  }

  buildTip(def) {
    const game = this.game;
    const mods = game.buildingModifiers('player', def.key);
    const hp = Math.round(def.hp * mods.hp);
    const income = def.income
      ? (def.income * game.globalModifiers('player').income).toFixed(1)
      : null;
    const defense = def.defense
      ? {
        damage: Math.round(def.defense.damage * mods.damage),
        range: Math.round(def.defense.range * mods.range),
      }
      : null;
    const power = def.powerProduce
      ? `+${Math.round(def.powerProduce * mods.powerProduce)}`
      : def.powerUse ? `−${def.powerUse}` : '';
    const requires = (def.requires ?? [])
      .map((req) => BUILDINGS[req]?.name ?? req)
      .join(', ');
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${hp}</span>${power ? `<span><i>${t('static.power')}</i>${power}</span>` : ''}
        ${income ? `<span><i>${t('tooltip.stat.income')}</i>${income}/${t('tooltip.seconds')}</span>` : ''}
        ${def.armyCap ? `<span><i>${t('tooltip.stat.armySupply')}</i>+${def.armyCap}</span>` : ''}
        ${defense ? `<span><i>${t('tooltip.stat.damage')}</i>${defense.damage}</span><span><i>${t('tooltip.stat.range')}</i>${defense.range}</span>` : ''}
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.buildTime} ${t('tooltip.seconds')}${requires ? ` · ${t('tooltip.build.requires', { names: requires })}` : ` · ${t('tooltip.build.needsEngineers')}`}</span></div>
    `;
  }

  renderCommands() {
    this.commands = this.buildCommands();
    this.commandMap = new Map(this.commands.map((c) => [c.id, c]));
    const dense = this.commands.length > 8;
    this.el.commands.classList.toggle('is-dense', dense);
    // В плотном режиме на ПК помещаются пять колонок, на мобильных — четыре.
    const columns = dense ? 5 : 4;
    const slots = Math.max(8, Math.ceil(this.commands.length / columns) * columns);

    // Пересобираем DOM только при смене состава команд. Доступность меняется
    // постоянно (доход, очереди), но её выставляем точечно: иначе кнопка под
    // курсором пересоздаётся каждый тик и наведение сбрасывается.
    const labels = [];
    for (let i = 0; i < slots; i += 1) {
      const cmd = this.commands[i];
      if (!cmd) {
        labels.push('empty');
        continue;
      }
      labels.push([
        cmd.id, cmd.hotkey, cmd.icon, cmd.kind, cmd.cost ?? '',
        dense && cmd.short ? cmd.short : cmd.label,
      ].join('\u0001'));
    }
    const structure = `${dense}\u0002${labels.join('\u0002')}`;
    if (structure !== this.commandStructure) {
      this.commandStructure = structure;
      let html = '';
      for (let i = 0; i < slots; i++) {
        const cmd = this.commands[i];
        if (cmd) {
          const label = dense && cmd.short ? cmd.short : cmd.label;
          html += `
          <button class="cmd ${cmd.disabled ? 'is-disabled' : ''}" data-cmd-id="${cmd.id}" aria-disabled="${cmd.disabled ? 'true' : 'false'}">
            <span class="cmd-key">${cmd.hotkey}</span>
            <span class="cmd-icon">${icon(cmd.icon)}</span>
            <span class="cmd-label">${label}</span>
            ${cmd.cost ? `<span class="cmd-cost">${icon('credits')} ${cmd.cost}</span>` : `<span class="cmd-cost cmd-cost--free">${cmd.kind === 'train' ? t('cmd.costTrain') : t('cmd.costOrder')}</span>`}
          </button>`;
        } else {
          html += `<div class="cmd cmd--empty" aria-hidden="true"><span class="cmd-empty-mark">+</span></div>`;
        }
      }
      if (!this.commands.length) {
        html = `<div class="cmd-empty-state"><span class="ce-icon">${icon('target')}</span><b>${t('cmd.emptyTitle')}</b><small>${t('cmd.emptyHint')}</small></div>`;
      }
      this.el.commands.innerHTML = html;
      this.hideTooltip();
    }

    // Стоимость проверяем каждый тик: доход приходит постоянно, и команда
    // должна открываться без перезахода в панель.
    this.el.commands.querySelectorAll('.cmd[data-cmd-id]').forEach((btn) => {
      const cmd = this.commandMap.get(btn.dataset.cmdId);
      if (!cmd) return;
      btn.classList.toggle('is-disabled', !!cmd.disabled);
      btn.setAttribute('aria-disabled', cmd.disabled ? 'true' : 'false');
    });

    const status = this.commands.length
      ? (this.commands[0].kind === 'train' ? t('cmd.statusTrain')
        : this.commands[0].kind === 'build' ? t('cmd.statusBuild')
          : this.commands[0].kind === 'research' ? t('cmd.statusResearch')
            : t('cmd.statusOrder'))
      : t('cmd.statusIdle');
    if (this.el.cmdStatus.textContent !== status) this.el.cmdStatus.textContent = status;
  }

  triggerHotkey(key) {
    const cmd = this.commands.find((c) => c.hotkey === key);
    if (!cmd) return false;
    if (cmd.disabled) {
      this.game.notify(cmd.reason || t('notify.unavailable'), 'warn', `cmd-${cmd.id}`, 0, 3);
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
    this.renderGroups();
    this.lastSignature = this.selectionSignature();
  }

  onGroupsChanged() {
    this.renderGroups();
  }

  /** Иконки отрядов у правого края: цифра, тип и число живых бойцов. */
  renderGroups() {
    const rail = this.el.squadRail;
    if (!rail) return;
    const selected = new Set(this.game.selectedEntities());
    const entries = [];
    for (const [index, group] of this.game.groups) {
      const entities = [...group].filter((e) => e.alive && e.faction === 'player');
      if (!entities.length) continue;
      const counts = new Map();
      for (const e of entities) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const defOf = (type) => (
        entities.some((e) => e.type === type && e.isBuilding) ? BUILDINGS[type] : UNITS[type]
      );
      const types = [...counts.entries()]
        .map(([type, n]) => `${defOf(type)?.name ?? type} ×${n}`)
        .join(', ');
      entries.push({
        index,
        entities,
        def: defOf(dominant),
        types,
        active: entities.every((e) => selected.has(e)),
      });
    }
    entries.sort((a, b) => a.index - b.index);
    // На сенсорном экране физической клавиатуры нет: показываем все девять
    // слотов, чтобы удержанием любого из них можно было запомнить выделение.
    const showEmpty = document.body.classList.contains('is-touch') || this.game.input?.isTouch;
    if (showEmpty) {
      const used = new Set(entries.map((entry) => entry.index));
      for (let index = 1; index <= 9; index++) {
        if (used.has(index)) continue;
        entries.push({ index, entities: [], def: null, types: '', active: false });
      }
      entries.sort((a, b) => a.index - b.index);
    }
    rail.innerHTML = entries.map(({ index, entities, def, types, active }) => {
      if (!entities.length) {
        return `
      <button type="button" class="squad-slot is-empty"
        data-group="${index}"
        title="${t('sel.groupEmptyTitle', { index })}"
        aria-label="${t('sel.groupEmptyAria', { index })}">
        <span class="squad-key">${index}</span>
        <span class="squad-plus">+</span>
      </button>`;
      }
      return `
      <button type="button" class="squad-slot${active ? ' is-active' : ''}"
        data-group="${index}"
        title="${t('sel.groupTitle', { index, types: esc(types) })}"
        aria-label="${t('sel.groupAria', { index, types: esc(types) })}">
        <span class="squad-key">${index}</span>
        ${icon(def?.icon ?? 'army')}
        <span class="squad-count">×${entities.length}</span>
      </button>`;
    }).join('');
    document.body.classList.toggle('has-groups', entries.length > 0);
    document.body.style.setProperty(
      '--squad-rail-width',
      rail.offsetWidth > 0 ? `${rail.offsetWidth}px` : '0px',
    );
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
    return sel.map((e) => `${e.id}:${e.complete ? 1 : 0}:${e.queue?.length ?? 0}:${Math.round((e.hp / e.maxHp) * 20)}:${e.rank ?? 0}:${e.kills ?? 0}`).join('|');
  }

  renderSelection() {
    const game = this.game;
    const units = game.selectedUnits();
    const buildings = game.selectedBuildings();
    const body = this.el.selectionBody;

    if (!units.length && !buildings.length) {
      this.el.selTitle.textContent = t('static.noSelection');
      this.el.selTag.textContent = '—';
      body.innerHTML = `
        <div class="sel-empty">
          <div class="sel-empty-icon">${icon('target')}</div>
          <div><b>${t('sel.emptyTitle')}</b><p>${t('sel.emptyHint')}</p></div>
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
      const totalKills = units.reduce((s, u) => s + (u.kills ?? 0), 0);
      const same = types.length === 1;
      const name = same ? def.name : t('sel.mixed');
      const count = units.length;
      const pct = clamp((totalHp / totalMax) * 100, 0, 100);
      this.el.selTitle.textContent = same ? `${def.name}${count > 1 ? ` ×${count}` : ''}` : t('sel.group', { count });
      this.el.selTag.textContent = `${count} ${plural(count, t('sel.unitOne'), t('sel.unitFew'), t('sel.unitMany'))}`;
      const chips = types.length > 1
        ? `<div class="type-chips">${types.map((t) => `<span class="type-chip">${icon(UNITS[t].icon)} ${UNITS[t].name} <b>×${counts.get(t)}</b></span>`).join('')}</div>`
        : '';
      const upgradeNames = same
        ? Object.keys(UPGRADES)
          .filter((key) => UPGRADES[key].target === primary.type
            && this.game.upgrades.player.has(key))
          .map((key) => UPGRADES[key].name)
        : [];
      const upgradeChip = upgradeNames.length
        ? `<span class="chip chip--research">${icon('research')} ${upgradeNames.join(' · ')}</span>`
        : '';
      body.innerHTML = `
        <div class="sel-main">
          <div class="portrait" style="--accent:${FACTIONS.player.color}">
            ${icon(def.icon)}
            ${count > 1 ? `<span class="portrait-count">×${count}</span>` : ''}
            <span class="portrait-faction">${t('static.brand')}</span>
          </div>
          <div class="sel-info">
            <div class="sel-role">${same ? def.role : t('sel.mixedSquad')} · <span class="sel-owner">${t('sel.ownerPlayer')}</span></div>
            <div class="sel-name">${name}${same && count > 1 ? ` <em>×${count}</em>` : ''}</div>
            <div class="hpbar"><i style="width:${pct}%"></i><b>${Math.ceil(totalHp)} / ${totalMax}</b></div>
            ${same ? this.vetBlock(primary) : ''}
            ${same ? `<div class="sel-stats">
              ${def.healer
                ? `<span>${t('tooltip.stat.healRate')} <b>${(primary.healRate ?? FIELD_SUPPORT.medicRate).toFixed(1)}/${t('tooltip.seconds')}</b></span>
                   <span>${t('tooltip.stat.healRadius')} <b>${Math.round(primary.healSeek ?? FIELD_SUPPORT.medicSeekRadius)}</b></span>`
                : `<span>${t('tooltip.stat.damage')} <b>${Math.round(primary.damage ?? def.damage)}</b></span>
                   <span>${t('tooltip.stat.range')} <b>${Math.round(primary.range ?? def.range)}</b></span>`}
              <span>${t('tooltip.stat.speed')} <b>${(primary.speed ?? def.speed).toFixed(1)}</b></span>
              <span>${t('tooltip.stat.armyCap')} <b>${def.supply ?? 1}</b></span>
              <span>${t('sel.kills')} <b>${totalKills}</b></span>
              ${def.repairer ? `<span>${t('tooltip.stat.repairTech')} <b>${(primary.repairRate ?? FIELD_SUPPORT.engineerRate).toFixed(1)}/${t('tooltip.seconds')}</b></span>` : ''}
            </div>` : `<div class="sel-note">${t('sel.multiNote')}</div>`}

            ${chips}
            ${upgradeChip}
          </div>
          ${this.sideStatus()}
        </div>
        <div class="sel-foot"><span class="dot"></span> ${t('sel.footUnits')}</div>
      `;
      this.live = {
        kind: 'units',
        units,
        hpFill: body.querySelector('.hpbar i'),
        hpText: body.querySelector('.hpbar b'),
        xpFill: body.querySelector('.xpbar i'),
        xpText: body.querySelector('.xpbar b'),
        unit: same && count === 1 ? primary : null,
      };
      this.lastSignature = this.selectionSignature();
      return;
    }

    const b = buildings[0];
    const def = b.def;
    const pct = clamp((b.hp / b.maxHp) * 100, 0, 100);
    const constructionCount = b.builderCount ?? 0;
    const status = !b.complete
      ? (constructionCount
        ? { text: t('hud.building', { pct: Math.floor(b.construction * 100), count: constructionCount }), cls: 'warn' }
        : { text: t('hud.awaitingBuilders', { pct: Math.floor(b.construction * 100) }), cls: 'accent' })
      : b.repairing
        ? { text: t('hud.repair'), cls: 'accent' }
        : b.type === 'turret'
          ? (b.defenseTarget?.alive ? { text: t('hud.firing'), cls: 'warn' } : { text: t('hud.guard'), cls: 'ok' })
          : b.queue.length
            ? {
              text: b.def.research
                ? t('hud.researching', { pct: Math.floor((1 - b.queue[0].remaining / b.queue[0].total) * 100) })
                : t('hud.queueCount', { count: b.queue.length }),
              cls: 'accent',
            }
            : { text: t('hud.ready'), cls: 'ok' };
    this.el.selTitle.textContent = def.name + (buildings.length > 1 ? ` ×${buildings.length}` : '');
    this.el.selTag.textContent = b.faction === 'player' ? t('sel.building') : t('sel.enemyOwner');

    const powerOut = def.powerProduce
      ? Math.round(def.powerProduce * this.game.buildingModifiers(b.faction, b.type).powerProduce)
      : 0;
    const powerChip = powerOut
      ? `<span class="chip chip--power">${icon('bolt')} +${powerOut}</span>`
      : def.powerUse
        ? `<span class="chip chip--power-use">${icon('bolt')} −${def.powerUse}</span>`
        : '';
    const defense = b.defense ?? def.defense;
    const incomeChip = def.income
      ? `<span class="chip chip--income">${icon('credits')} ${(def.income * this.game.globalModifiers(b.faction).income).toFixed(1)}/${t('tooltip.seconds')}</span>`
      : '';
    const armyChip = def.armyCap ? `<span class="chip chip--army">${icon('army')} +${def.armyCap} ${t('tooltip.stat.armyCap')}</span>` : '';
    const defenseChip = defense
      ? `<span class="chip chip--defense">${icon('turret')} ${Math.round(defense.damage)} ${t('tooltip.stat.damage')} · ${Math.round(defense.range)} ${t('sel.rangeShort')}</span>`
      : '';
    const repairChip = b.repairing
      ? `<span class="chip chip--repair">${icon('repair')} +${this.game.repairRate(b).toFixed(1)} HP/${t('tooltip.seconds')}</span>`
      : '';
    const researchChip = b.def.research && b.faction === 'player'
      ? `<span class="chip chip--research">${icon('research')} ${t('sel.researched', { done: this.game.upgrades.player.size, total: Object.keys(UPGRADES).length })}</span>`
      : '';
    const queueHTML = this.renderQueue(b);
    const buildHTML = !b.complete
      ? `<button class="btn-small btn-cancel-build" data-cancel-build>${t('sel.cancelBuild')}</button>`
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
      ${UNIT_PRODUCTION[b.type] || b.def.research ? queueHTML : ''}
      ${buildHTML}
      <div class="sel-foot"><span class="dot"></span> ${UNIT_PRODUCTION[b.type] && b.type !== 'hq'
        ? t('sel.footGround')
        : b.type === 'hq'
          ? t('sel.footHq')
          : b.def.research
            ? t('sel.footResearch')
            : t('sel.footPassive')}</div>
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

  /** Ранг и шкала опыта под полосой HP. */
  vetBlock(unit) {
    const rank = clamp(unit.rank ?? 0, 0, VETERANCY.names.length - 1);
    const prev = VETERANCY.thresholds[rank] ?? 0;
    const next = VETERANCY.thresholds[rank + 1];
    const pct = next ? clamp(((unit.xp - prev) / (next - prev)) * 100, 0, 100) : 100;
    const text = next
      ? `${Math.round(unit.xp)} / ${next} XP`
      : t('sel.maxRank');
    return `
      <div class="vet-block">
        <span class="chip chip--rank">${icon('flag')} ${VETERANCY.names[rank]}</span>
        <div class="xpbar"><i style="width:${pct}%"></i><b>${text}</b></div>
      </div>`;
  }

  /** Опыт и порог следующего ранга для живого обновления шкалы. */
  xpView(unit) {
    const rank = clamp(unit.rank ?? 0, 0, VETERANCY.names.length - 1);
    const prev = VETERANCY.thresholds[rank] ?? 0;
    const next = VETERANCY.thresholds[rank + 1];
    return {
      rank,
      pct: next ? clamp(((unit.xp - prev) / (next - prev)) * 100, 0, 100) : 100,
      text: next ? `${Math.round(unit.xp)} / ${next} XP` : t('sel.maxRank'),
    };
  }

  sideStatus() {
    const s = this.game.getStatus();
    const income = this.game.playerIncome();
    const deficit = s.power.used > s.power.produced;
    return `
      <div class="sel-side">
        <div><span>${t('sel.sideIncome')}</span><b>+${income.toFixed(1)}/${t('tooltip.seconds')}</b></div>
        <div><span>${t('sel.sideGrid')}</span><b class="${deficit ? 'bad' : ''}">${s.power.produced}/${s.power.used}</b></div>
        <div><span>${t('tooltip.stat.armyCap')}</span><b>${s.army}/${s.cap}</b></div>
      </div>`;
  }

  renderQueue(b) {
    if (!b.queue.length) {
      const emptyLabel = b.def.research ? t('sel.queuePick') : t('sel.queueReady');
      return `<div class="queue queue--empty"><span>${t('sel.queueEmpty')}</span><span>${b.complete ? emptyLabel : t('sel.queueBuilding')}</span></div>`;
    }
    const slots = [];
    for (let i = 0; i < b.queue.length; i++) {
      const item = b.queue[i];
      const def = item.upgrade ? UPGRADES[item.upgrade] : UNITS[item.type];
      const progress = i === 0 ? (1 - item.remaining / item.total) * 100 : 0;
      const time = i === 0 ? item.remaining : item.total;
      slots.push(`
        <button class="queue-tile${i === 0 ? ' is-active' : ''}" data-cancel-queue="${i}"
          title="${t('sel.cancelItem', { name: esc(def.name) })}" aria-label="${t('sel.cancelItem', { name: esc(def.name) })}">
          <span class="q-x" aria-hidden="true">×</span>
          <span class="q-icon">${icon(def.icon)}</span>
          <span class="q-name">${esc(def.name)}</span>
          <span class="q-time">${formatTime(time)}</span>
          <span class="q-progress"><i style="width:${clamp(progress, 0, 100)}%"></i></span>
        </button>`);
    }
    return `
      <div class="queue">
        <div class="queue-head"><span>${t('sel.queueTitle')}</span><span>${t('sel.queueCount', { count: b.queue.length })}</span></div>
        <div class="queue-list">${slots.join('')}</div>
      </div>`;
  }

  // --------------------------------------------------------------- header
  renderHeader() {
    const s = this.game.getStatus();
    this.el.credits.textContent = s.credits;
    this.el.power.textContent = `${s.power.produced} / ${s.power.used}`;
    this.el.army.textContent = `${s.army} / ${s.cap}`;
    this.el.army.parentElement.title = t('hud.armyTitle', { used: s.army, cap: s.cap, units: s.units });
    this.el.clock.textContent = formatTime(s.time);
    const deficit = s.power.used > s.power.produced;
    this.el.resPower.classList.toggle('is-deficit', deficit);
    this.el.powerLabel.textContent = deficit ? `${t('static.power')} · ${t('hud.deficit')}` : t('static.power');
    this.el.gridStatus.textContent = deficit ? t('hud.powerDeficit') : t('static.gridStatus');
    this.el.gridStatus.classList.toggle('is-deficit', deficit);
    this.el.resPower.title = deficit
      ? t('hud.powerTitleDeficit', { produced: s.power.produced, used: s.power.used })
      : t('hud.powerTitle', { produced: s.power.produced, used: s.power.used });

    const mission = this.game.mission;
    if (mission?.kind === 'endless' && this.game.endless) {
      const endless = this.game.endless;
      const best = endlessBest(mission);
      this.el.missionLabel.textContent = t('hud.endlessWave', { wave: endless.waveIndex });
      this.el.missionText.textContent =
        t('hud.endlessNext', { in: formatTime(Math.ceil(endless.nextWaveIn)), elapsed: formatTime(this.game.elapsed) });
      this.el.missionCard.title = best
        ? t('hud.endlessBest', { time: formatTime(best.time), waves: best.waves })
        : t('hud.endlessHint');
    } else if (mission && this.el.missionText) {
      const total = this.game.objectives.length;
      const done = this.game.objectives.filter((objective) => objective.done).length;
      const active = this.game.activeObjective();
      this.el.missionLabel.textContent = mission.kind === 'campaign'
        ? t('hud.taskProgress', { done: Math.min(done + 1, total), total })
        : t('hud.trialProgress', { done, total });
      this.el.missionText.textContent = active
        ? `${active.title}${active.progressText ? ` · ${active.progressText}` : ''}`
        : t('hud.tasksDone');
      this.el.missionCard.title = this.game.objectives
        .map((objective) => `${objective.done ? '✓' : '—'} ${objective.title}${objective.progressText ? ` (${objective.progressText})` : ''}`)
        .join('\n');
    } else if (this.el.missionText) {
      this.el.missionLabel.textContent = t('static.missionLabel');
      this.el.missionText.textContent = t('static.missionDefault');
      this.el.missionCard.title = '';
    }
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
          if (this.live.unit?.alive) {
            const view = this.xpView(this.live.unit);
            if (this.live.xpFill) this.live.xpFill.style.width = `${view.pct}%`;
            if (this.live.xpText) this.live.xpText.textContent = view.text;
          }
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
                ? t('hud.building', { pct: Math.floor(b.construction * 100), count: builders })
                : t('hud.awaitingBuilders', { pct: Math.floor(b.construction * 100) }))
              : b.repairing
                ? t('hud.repair')
                : b.type === 'turret'
                  ? (b.defenseTarget?.alive ? t('hud.firing') : t('hud.guard'))
                  : b.queue.length
                    ? (b.def.research
                      ? t('hud.researching', { pct: Math.floor((1 - b.queue[0].remaining / b.queue[0].total) * 100) })
                      : t('hud.queueCount', { count: b.queue.length }))
                    : t('hud.ready');
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
      }
    }
    // Панель пересобираем каждый тик: кредиты, завершение построек,
    // исследования и лимит армии меняются независимо от выделения, а
    // renderCommands пишет DOM только когда разметка действительно изменилась.
    this.renderCommands();
  }

  // --------------------------------------------------------------- tooltip
  showTooltip(btn, cmd) {
    if (!cmd.tip || this.game.input?.isTouch) return;
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
    // Туман войны рисуется в той же повёрнутой системе координат, что и фон.
    const fog = this.game.fog;
    if (fog?.minimapCanvas) ctx.drawImage(fog.minimapCanvas, 0, 0);
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
      const visible = this.game.isEntityVisibleTo('player', b);
      if (!visible && !this.game.isBuildingKnownTo('player', b)) continue;
      const p = this.worldToMinimap(b.position.x, b.position.z);
      const color = b.faction === 'player' ? '#4fd2ff' : '#ff6b4a';
      const size = b.type === 'hq' ? 13 : b.type === 'barracks' ? 9 : 7;
      const x = p.x - size / 2;
      const y = p.y - size / 2;
      ctx.fillStyle = color;
      if (!visible) {
        // Разведанное, но не видимое здание: контур и слабая заливка.
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, size, size);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(x, y, size, size);
      } else {
        ctx.globalAlpha = b.complete ? 0.95 : 0.5;
        ctx.fillRect(x, y, size, size);
        ctx.globalAlpha = 1;
        if (b.type === 'hq') {
          ctx.strokeStyle = '#e8fbff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    for (const u of this.game.units) {
      if (!u.alive) continue;
      if (!this.game.isEntityVisibleTo('player', u)) continue;
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
