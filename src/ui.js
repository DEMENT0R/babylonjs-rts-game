// HUD: ресурсы, выбор, командная панель, миникарта, оверлеи.

import { Matrix } from './babylon.js';
import {
  FACTIONS,
  UNITS,
  BUILDINGS,
  UPGRADES,
  UPGRADE_PAGES,
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
import { GRAPHICS_LABELS, GRAPHICS_OPTIONS, AUDIO_LABELS } from './settings.js';
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
    this.lastGroupClick = null;
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
    // Страница исследований техцентра: 0 — войска, 1 — база.
    this.researchPage = 0;
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
    this.el.mmSector.title = `Карта ${this.game.map.label} · ${this.game.map.style.name}`;
    if (this.el.brandSector) {
      this.el.brandSector.textContent = `СЕТЬ «БЛИЗНЕЦЫ» / СЕКТОР ${this.game.map.label}`;
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
      else if (action === 'back') this.backFromOverlay();
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
      const next = this.settingsTab === 'graphics' ? 'audio' : 'graphics';
      this.setSettingsTab(next);
      this.el.overlay.querySelector(`[data-settings-tab="${next}"]`)?.focus();
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
    this.el.squadRail?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-group]');
      if (!btn) return;
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
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ГЛАВНОЕ МЕНЮ</div>
        <h1>ГЕЛИОС<span>-7</span></h1>
        <p class="tagline">Две колонии-близнеца. Один сектор. Контракт достанется одному.</p>
      </div>
      <div class="mode-grid mode-grid--modes">
        <button type="button" class="mode-card mode-card--active" data-action="campaign">
          <span class="mode-mark">${icon('flag')}</span>
          <span class="mode-copy"><b>КАМПАНИЯ</b><small>Пять сюжетных операций за колонию «Гелиос-7»: брифинги, задания и постепенное открытие техники.</small></span>
          <span class="mode-badge">${campaignDoneCount()} / ${CAMPAIGN.length}</span>
        </button>
        <button type="button" class="mode-card mode-card--active" data-action="trials">
          <span class="mode-mark">${icon('target')}</span>
          <span class="mode-copy"><b>ИСПЫТАНИЯ</b><small>Шесть фиксированных сценариев без сюжета: сложные партии на время и тактику.</small></span>
          <span class="mode-badge">${trialDoneCount()} / ${TRIALS.length}</span>
        </button>
        <button type="button" class="mode-card mode-card--active" data-action="lobby">
          <span class="mode-mark">${icon('hq')}</span>
          <span class="mode-copy"><b>ЛОББИ</b><small>Свободная партия: сложность противника, сид карты и другие параметры матча.</small></span>
          <span class="mode-arrow">→</span>
        </button>
      </div>
      <div class="overlay-actions">
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">КАК ИГРАТЬ</button>
          <button class="btn-ghost" data-action="settings">НАСТРОЙКИ</button>
          <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        </div>
      </div>
      <p class="overlay-note start-note">Кампания открывает технику за победы, испытания не связаны с сюжетом. Свободная партия настраивается в лобби.</p>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ГЛАВНОЕ МЕНЮ // ВЕРСИЯ ${GAME_VERSION}</span>
        <span>СЕКТОР ${map.label} · ${map.symmetry.name.toUpperCase()} · ${map.style.name}</span>
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
        ? (state === 'done' ? 'ПРОЙДЕНО' : state === 'open' ? 'ДОСТУПНО' : 'ЗАКРЫТО')
        : (best != null ? `РЕКОРД ${formatTime(best)}` : 'НЕ ПРОЙДЕНО');
      const classes = `mode-card ${locked ? 'mode-card--locked' : 'mode-card--active'}${state === 'done' || best != null ? ' is-done' : ''}`;
      return `
        <button type="button" class="${classes}" data-action="mission:${mission.id}"
          ${locked ? 'disabled aria-disabled="true"' : ''}
          title="${locked ? 'Сначала пройдите предыдущую операцию' : esc(mission.subtitle)}">
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
        : 'Секретная операция. Пройдите все пять операций кампании, чтобы открыть её.';
      const badge = unlocked
        ? (best ? `РЕКОРД ${formatTime(best.time)}` : 'БЕЗ КОНЦА')
        : 'СЕКРЕТ';
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
    const label = isCampaign ? 'КАМПАНИЯ' : 'ИСПЫТАНИЯ';
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ${label}</div>
        <h1>${isCampaign ? 'ОПЕРАЦИИ' : 'ИСПЫТАНИЯ'}</h1>
        <p class="tagline">${isCampaign
          ? 'Пять операций за колонию «Гелиос-7». Победа открывает следующую миссию и новую технику. После пятой операции открывается секретный протокол без конца.'
          : 'Шесть фиксированных сценариев. Сюжет не нужен: только карта, противник и условие победы.'}</p>
      </div>
      <div class="mode-grid mode-grid--missions">${cards}${secret}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">← В ГЛАВНОЕ МЕНЮ</button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">КАК ИГРАТЬ</button>
          <button class="btn-ghost" data-action="settings">НАСТРОЙКИ</button>
          <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        </div>
      </div>
      <p class="overlay-note start-note">${isCampaign
        ? `Пройдено операций: ${done} из ${CAMPAIGN.length}. Прогресс сохраняется в браузере.`
        : `Пройдено испытаний: ${done} из ${TRIALS.length}. Лучшее время сохраняется отдельно для каждого сценария.`}</p>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ${label} // ВЕРСИЯ ${GAME_VERSION}</span>
        <span>${isCampaign ? 'СЮЖЕТНЫЙ РЕЖИМ' : 'СВОБОДНЫЕ СЦЕНАРИИ'}</span>
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
    const kindLabel = isEndless ? 'ПРОТОКОЛ' : isCampaign ? 'КАМПАНИЯ' : 'ИСПЫТАНИЯ';
    const kindWord = isEndless ? 'ПРОТОКОЛ' : isCampaign ? 'ОПЕРАЦИЯ' : 'СЦЕНАРИЙ';
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
        <div class="map-strip-item"><span>СИД КАРТЫ</span><b>#${map.label}</b></div>
        <div class="map-strip-item"><span>СИММЕТРИЯ</span><b>${map.symmetry.name} · ${map.symmetry.tag}</b></div>
        <div class="map-strip-item"><span>ЛАНДШАФТ</span><b>${map.style.name}</b></div>
      </div>
      <div class="brief-grid">
        <div class="brief-copy">
          ${brief}
          <p class="accent-copy">Доступно: ${buildings.join(', ')}. Войска: ${units.join(', ')}.</p>
        </div>
        ${this.objectivesHtml(current, false)}
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="beginmission">НАЧАТЬ ${isEndless ? 'ПРОТОКОЛ' : isCampaign ? 'ОПЕРАЦИЮ' : 'ИСПЫТАНИЕ'} <span>→</span></button>
        <button class="btn-ghost" data-action="back">← НАЗАД</button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ${kindLabel} · ${esc(current.title.toUpperCase())}</span>
        <span>ПРОТИВНИК: ${AI_DIFFICULTY[current.difficulty]?.name ?? 'ОБЫЧНЫЙ'}</span>
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
      ? `<div class="objective"><b>∞</b><span><strong>Продержаться как можно дольше</strong><small>Волны идут без конца, победы нет. Поражение — потеря командного центра.</small></span></div>`
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
        <div class="eyebrow"><i></i> ЛОББИ // СЕКТОР <span id="lobbySector">${map.label}</span></div>
        <h1>ГЕЛИОС<span>-7</span></h1>
        <p class="tagline">Параметры операции: сложность противника, туман войны и карта. Выбор действует до начала боя.</p>
      </div>
      <div class="map-strip lobby-map-strip" id="lobbyMapStrip">
        <div class="map-strip-item"><span>СИД КАРТЫ</span><b id="lobbySeed">#${map.label}</b></div>
        <div class="map-strip-item"><span>СИММЕТРИЯ</span><b id="lobbySymmetry">${map.symmetry.name} · ${map.symmetry.tag}</b></div>
        <div class="map-strip-item"><span>ЛАНДШАФТ</span><b id="lobbyStyle">${map.style.name}</b></div>
      </div>
      <div class="lobby-panel">
        ${this.difficultyBlock()}
        ${this.fogBlock()}
        ${this.seedBlock()}
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="start">НАЧАТЬ ОПЕРАЦИЮ <span>→</span></button>
        <button class="btn-ghost" data-action="back">← В ГЛАВНОЕ МЕНЮ</button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="help">КАК ИГРАТЬ</button>
          <button class="btn-ghost" data-action="settings">НАСТРОЙКИ</button>
          <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        </div>
      </div>
      <div class="brief-grid">
        <div class="brief-copy">
          <p id="lobbyBrief">Программа «Гелиос-7» отправила в этот сектор два одинаковых семенных корабля — так задумывалась страховка: если одна колония погибнет, работу продолжит вторая. Связь между ними потеряна, а последний принятый пакет приказа одинаков для обеих сторон: сектор останется за выжившей. ${map.symmetry.hint} Рельеф, месторождения и техника у обеих сторон совпадают до последнего винта — по ту сторону фронта стоит ваша копия.</p>
          <p class="accent-copy">Развивайте экономику, разведайте сектор и уничтожьте дублёра, пока он не сделал то же самое с вами.</p>
        </div>
        <div class="objectives">
          <div class="objective"><b>01</b><span><strong>Нефть — это жизнь</strong><small>Разведайте месторождения и займите их вышками: они приносят кредиты.</small></span></div>
          <div class="objective"><b>02</b><span><strong>Соберите армию</strong><small>Постройте казармы. Пехота, скауты, танки и РСЗО — ваша сила. Инженеры возводят здания.</small></span></div>
          <div class="objective"><b>03</b><span><strong>Уничтожьте дублёра</strong><small>Сравняйте с землёй второй командный центр. Копия не должна пережить оригинал.</small></span></div>
        </div>
      </div>
      <p class="overlay-note start-note" id="lobbyNote">Каждая карта строится из сида: ссылку вида <b>?seed=${map.code}</b> можно сохранить и сыграть на той же карте снова.</p>
      <div class="overlay-footer">
        <span id="lobbyFooterMap">ГЕЛИОС-7 // КАРТА #${map.label} // ВЕРСИЯ ${GAME_VERSION}</span>
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
          <span class="lobby-label">СЛОЖНОСТЬ ПРОТИВНИКА</span>
          <span class="lobby-status" id="difficultyStatus">${esc(preset.desc)}</span>
        </div>
        <div class="difficulty-options">${buttons}</div>
      </div>`;
  }

  /** Туман войны: включён по умолчанию, выключение открывает всю карту. */
  fogBlock() {
    const enabled = this.game.fogEnabled !== false;
    const options = [
      { value: 'on', label: 'ВКЛ.', title: 'Карта открывается разведкой.' },
      { value: 'off', label: 'ВЫКЛ.', title: 'Вся карта и противник видны сразу.' },
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
          <span class="lobby-label">ТУМАН ВОЙНЫ</span>
          <span class="lobby-status" id="fogStatus">${enabled ? 'Карта открывается разведкой.' : 'Вся карта видна сразу.'}</span>
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
    if (status) status.textContent = enabled ? 'Карта открывается разведкой.' : 'Вся карта видна сразу.';
  }

  /** Сид карты: случайный (по умолчанию) или ручной. */
  seedBlock() {
    const mode = this.seedMode === 'manual' ? 'manual' : 'random';
    return `
      <div class="lobby-row lobby-row--seed">
        <div class="lobby-row-head">
          <span class="lobby-label">СИД КАРТЫ</span>
          <div class="seed-modes" role="group" aria-label="Способ выбора сида">
            <button type="button" class="graphics-opt${mode === 'random' ? ' is-active' : ''}"
              data-seedmode="random" aria-pressed="${mode === 'random'}">СЛУЧАЙНЫЙ</button>
            <button type="button" class="graphics-opt${mode === 'manual' ? ' is-active' : ''}"
              data-seedmode="manual" aria-pressed="${mode === 'manual'}">ВРУЧНУЮ</button>
          </div>
        </div>
        <div class="seed-body">
          <div class="seed-controls">
            <div class="seed-panel" data-seed-panel="random"${mode === 'random' ? '' : ' hidden'}>
              <div class="seed-value"><span>ВЫБРАННЫЙ СИД</span><b id="seedValue">#${formatSeedLabel(this.lobbySeedValue)}</b></div>
              <button type="button" class="btn-ghost btn-seed" data-action="reroll">СГЕНЕРИРОВАТЬ ДРУГУЮ</button>
            </div>
            <div class="seed-panel" data-seed-panel="manual"${mode === 'manual' ? '' : ' hidden'}>
              <label class="seed-input-label" for="seedInput">ВВЕДИТЕ СИД</label>
              <input id="seedInput" class="seed-input" data-seed-input type="text"
                value="${esc(this.manualSeedText)}" placeholder="7A3F91C2"
                inputmode="text" autocomplete="off" autocapitalize="characters"
                spellcheck="false" maxlength="24" aria-describedby="seedHint" />
            </div>
            <p class="seed-hint" id="seedHint"></p>
          </div>
          <div class="seed-preview">
            <canvas id="lobbyPreview" width="180" height="180" role="img" aria-label="Предпросмотр выбранной карты"></canvas>
            <span class="seed-preview-tag" id="seedPreviewTag">СЛУЧАЙНЫЙ СИД</span>
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
    let tag = 'СЛУЧАЙНЫЙ СИД';
    if (!usable) tag = 'ВВЕДИТЕ СИД';
    else if (preview) tag = 'ПРЕДПРОСМОТР';
    else if (this.seedMode === 'manual') tag = 'РУЧНОЙ СИД';
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
    set('#lobbyFooterMap', `ГЕЛИОС-7 // КАРТА #${map.label} // ВЕРСИЯ ${GAME_VERSION}`);
    set('#lobbyFooterMeta', `${map.symmetry.name.toUpperCase()} · ${map.style.name} · BABYLON.JS`);
    const strip = this.el.overlay.querySelector('#lobbyMapStrip');
    strip?.classList.toggle('is-preview', preview);
    const brief = this.el.overlay.querySelector('#lobbyBrief');
    if (brief) {
      brief.textContent = `Программа «Гелиос-7» отправила в этот сектор два одинаковых семенных корабля — так задумывалась страховка: если одна колония погибнет, работу продолжит вторая. Связь между ними потеряна, а последний принятый пакет приказа одинаков для обеих сторон: сектор останется за выжившей. ${map.symmetry.hint} Рельеф, месторождения и техника у обеих сторон совпадают до последнего винта — по ту сторону фронта стоит ваша копия.`;
    }
    const note = this.el.overlay.querySelector('#lobbyNote');
    if (note) {
      note.innerHTML = preview
        ? `Карта <b>#${map.label}</b> будет создана из выбранного сида при начале операции.`
        : `Каждая карта строится из сида: ссылку вида <b>?seed=${map.code}</b> можно сохранить и сыграть на той же карте снова.`;
    }
  }

  updateSeedHint() {
    const hint = this.el.overlay?.querySelector('#seedHint');
    if (!hint) return;
    hint.classList.remove('is-warn');
    if (this.seedMode === 'random') {
      hint.textContent = 'Игра подберёт сид сама. «Сгенерировать другую» покажет другую карту до начала операции.';
      return;
    }
    const seed = this.parseManualSeed();
    if (seed == null) {
      hint.textContent = 'Введите сид: до 8 hex-символов (например, 7A3F91C2) или любое слово. Enter — начать.';
      hint.classList.add('is-warn');
      return;
    }
    hint.textContent = `Сид #${formatSeedLabel(seed)}. Одинаковый сид всегда создаёт одну и ту же карту. Enter — начать.`;
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
        <div class="end-detail-title">ПО ТИПАМ</div>
        <table class="end-detail-table">
          <thead><tr><th>ТИП</th><th>УНИЧТ.</th><th>ПОТЕРИ</th><th>УРОН</th></tr></thead>
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
        <div class="eyebrow"><i></i> ${victory ? 'ОПЕРАЦИЯ ЗАВЕРШЕНА' : 'СИГНАЛ ПОТЕРЯН'}</div>
        <h1>${victory ? 'СЕКТОР ВЫСТОЯЛ' : 'КОЛОНИЯ СПИСАНА'}</h1>
        <p class="tagline">${victory
          ? 'Второй «Гелиос-7» уничтожен. Контракт на сектор достался вам — вместе с вопросом, кто из двух был копией.'
          : 'Ваш командный центр пал. Дублёр остался единственным «Гелиосом-7» в секторе.'}</p>
      </div>
      <div class="end-stats">
        <div><b>${formatTime(s.time ?? this.game.elapsed)}</b><span>ВРЕМЯ ОПЕРАЦИИ</span></div>
        <div><b>${s.kills}</b><span>УНИЧТОЖЕНО</span></div>
        <div><b>${s.losses}</b><span>ПОТЕРЯНО</span></div>
        <div><b>${Math.floor(s.gathered)}</b><span>ДОБЫТО КРЕДИТОВ</span></div>
      </div>
      ${this.endDetailHtml()}
      <div class="end-map">КАРТА <b>#${map.label}</b> · ${map.symmetry.name.toUpperCase()} ${map.symmetry.tag} · ${map.style.name}</div>
      <div class="end-note">${victory
        ? 'Связь с Землёй так и не восстановилась. Одна из двух колоний вычеркнута из реестра — и уже неважно, какая.'
        : 'В следующий раз начните с вышек, не оставляйте казармы без прикрытия и постарайтесь первыми найти дублёра.'}</div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="newmap">НОВАЯ КАРТА <span>↻</span></button>
        <button class="btn-ghost" data-action="restart">ПОВТОРИТЬ ЭТУ КАРТУ</button>
        <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ИТОГИ</span>
        <span>${victory ? 'СТАТУС: КОНТРАКТ ЗАКРЫТ' : 'СТАТУС: ЭВАКУАЦИЯ НЕВОЗМОЖНА'}</span>
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
    const kindLabel = isEndless ? 'ПРОТОКОЛ' : isCampaign ? 'КАМПАНИЯ' : 'ИСПЫТАНИЯ';
    const title = isEndless
      ? 'ПРОТОКОЛ ОСТАНОВЛЕН'
      : victory
        ? isCampaign
          ? (next ? 'ОПЕРАЦИЯ ВЫПОЛНЕНА' : 'КОНТРАКТ ЗАКРЫТ')
          : 'ИСПЫТАНИЕ ПРОЙДЕНО'
        : isCampaign ? 'СИГНАЛ ПОТЕРЯН' : 'ИСПЫТАНИЕ ПРОВАЛЕНО';
    const tagline = isEndless
      ? 'Командный центр потерян. Автозаводы «Беты» продолжают работу — попробуйте продержаться дольше.'
      : victory
        ? (mission.outro ?? mission.subtitle)
        : 'Командный центр потерян. Попробуйте другую тактику или вернитесь к списку.';
    let primary;
    let showRepeat = true;
    let showList = true;
    if (isEndless) {
      primary = '<button class="btn-primary" data-action="restart">ЕЩЁ ОДНА ПОПЫТКА <span>↻</span></button>';
      showRepeat = false;
    } else if (victory && next) {
      primary = `<button class="btn-primary" data-action="mission:${next.id}">СЛЕДУЮЩАЯ ОПЕРАЦИЯ <span>→</span></button>`;
    } else if (victory) {
      primary = `<button class="btn-primary" data-action="missionlist">К СПИСКУ ${isCampaign ? 'ОПЕРАЦИЙ' : 'ИСПЫТАНИЙ'} <span>→</span></button>`;
      showList = false;
    } else {
      primary = '<button class="btn-primary" data-action="restart">ПОВТОРИТЬ <span>↻</span></button>';
      showRepeat = false;
    }
    const html = `
      <div class="end-head ${victory ? 'win' : 'lose'}">
        <div class="eyebrow"><i></i> ${kindLabel} // ${String(mission.index).padStart(2, '0')} · ${esc(mission.title.toUpperCase())}</div>
        <h1>${title}</h1>
        <p class="tagline">${esc(tagline)}</p>
      </div>
      <div class="end-stats">
        <div><b>${formatTime(s.time ?? this.game.elapsed)}</b><span>ВРЕМЯ</span></div>
        <div><b>${s.kills}</b><span>УНИЧТОЖЕНО</span></div>
        <div><b>${s.losses}</b><span>ПОТЕРЯНО</span></div>
        <div><b>${Math.floor(s.gathered)}</b><span>ДОБЫТО КРЕДИТОВ</span></div>
        ${isEndless ? `<div><b>${s.waves ?? 0}</b><span>ВОЛН ОТБИТО</span></div>` : ''}
      </div>
      ${this.objectivesHtml(mission, true)}
      ${this.endDetailHtml()}
      <div class="end-map">КАРТА <b>#${map.label}</b> · ${map.symmetry.name.toUpperCase()} ${map.symmetry.tag} · ${map.style.name}</div>
      <div class="overlay-actions">
        ${primary}
        ${showRepeat ? '<button class="btn-ghost" data-action="restart">ПОВТОРИТЬ</button>' : ''}
        ${showList ? '<button class="btn-ghost" data-action="missionlist">К СПИСКУ</button>' : ''}
        <button class="btn-ghost" data-action="mainmenu">В ГЛАВНОЕ МЕНЮ</button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ${kindLabel} · ${esc(mission.title.toUpperCase())}</span>
        <span>${isEndless
          ? (best
            ? `${record?.isRecord ? 'НОВЫЙ РЕКОРД' : 'РЕКОРД'}: ${formatTime(best.time)} · ${best.waves} ВОЛН`
            : 'СТАТУС: ПРОТОКОЛ АКТИВЕН')
          : best != null ? `ЛУЧШЕЕ ВРЕМЯ: ${formatTime(best)}` : victory ? 'СТАТУС: ЗАДАЧИ ВЫПОЛНЕНЫ' : 'СТАТУС: ЗАДАЧИ ПРОВАЛЕНЫ'}</span>
      </div>
    `;
    this.setOverlay(html, `overlay--end ${victory ? 'is-win' : 'is-lose'}`);
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
    const kindLabel = isEndless ? 'ПРОТОКОЛ' : isCampaign ? 'КАМПАНИЯ' : 'ИСПЫТАНИЕ';
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ПАУЗА${mission ? ` // ${kindLabel}` : ''}</div>
        <h1 class="pause-title">${mission ? esc(mission.title.toUpperCase()) : 'ОПЕРАЦИЯ'}<br><span>ПРИОСТАНОВЛЕНА</span></h1>
        <p class="tagline">${mission ? esc(mission.subtitle) : 'Камера и интерфейс остаются доступны. Продолжите, когда будете готовы.'}</p>
      </div>
      <div class="pause-stats">
        <div><b>${Math.floor(this.game.credits)}</b><span>КРЕДИТЫ</span></div>
        <div><b>${this.game.getArmyUsed('player')} / ${this.game.getArmyCap('player')}</b><span>ЛИМИТ АРМИИ</span></div>
        <div><b>${formatTime(this.game.elapsed)}</b><span>ВРЕМЯ</span></div>
      </div>
      ${mission ? `<div class="pause-objectives">${this.objectivesHtml(mission, true)}</div>` : ''}
      <div class="graphics-row pause-speed">
        <span class="graphics-label">СКОРОСТЬ БОЯ</span>
        <div class="graphics-options">
          ${[0.5, 1, 2].map((v) => `<button type="button" class="graphics-opt${this.game.speed === v ? ' is-active' : ''}" data-speed="${v}" aria-pressed="${this.game.speed === v}">${v}×</button>`).join('')}
        </div>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="resume">ПРОДОЛЖИТЬ <span>→</span></button>
        <div class="menu-links">
          <button class="btn-ghost" data-action="settings">НАСТРОЙКИ</button>
          <button class="btn-ghost" data-action="help">КАК ИГРАТЬ</button>
          <button class="btn-ghost" data-action="changelog">ЖУРНАЛ ИЗМЕНЕНИЙ</button>
        </div>
      </div>
      <div class="overlay-actions overlay-actions--minor">
        <button class="btn-ghost" data-action="restart">ЗАНОВО</button>
        ${mission
          ? `<button class="btn-ghost" data-action="missionlist">К СПИСКУ</button>
             <button class="btn-ghost" data-action="mainmenu">В ГЛАВНОЕ МЕНЮ</button>`
          : '<button class="btn-ghost" data-action="newmap">НОВАЯ КАРТА</button>'}
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ПАУЗА · КАРТА #${map.label}${mission ? ` · ${esc(mission.title.toUpperCase())}` : ''}</span>
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
    const active = this.settingsTab === 'audio' ? 'audio' : 'graphics';
    const isGraphics = active === 'graphics';
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // НАСТРОЙКИ</div>
        <h1 class="settings-title">НАСТРОЙКИ</h1>
        <p class="tagline">Графика и звук. Изменения применяются сразу и сохраняются в браузере.</p>
      </div>
      <div class="settings-tabs" role="tablist" aria-label="Разделы настроек">
        <button type="button" class="settings-tab${isGraphics ? ' is-active' : ''}" id="settingsTabGraphics" role="tab" aria-selected="${isGraphics}" aria-controls="settingsPaneGraphics" tabindex="${isGraphics ? 0 : -1}" data-settings-tab="graphics">ГРАФИКА</button>
        <button type="button" class="settings-tab${isGraphics ? '' : ' is-active'}" id="settingsTabAudio" role="tab" aria-selected="${!isGraphics}" aria-controls="settingsPaneAudio" tabindex="${isGraphics ? -1 : 0}" data-settings-tab="audio">ЗВУК</button>
      </div>
      <div class="settings-pane" id="settingsPaneGraphics" role="tabpanel" aria-labelledby="settingsTabGraphics" data-settings-pane="graphics"${isGraphics ? '' : ' hidden'}>
        ${this.graphicsBlock()}
        <p class="settings-hint">Разрешение ниже помогает на слабых устройствах. Тени и свечение влияют на нагрузку сильнее всего.</p>
      </div>
      <div class="settings-pane" id="settingsPaneAudio" role="tabpanel" aria-labelledby="settingsTabAudio" data-settings-pane="audio"${isGraphics ? ' hidden' : ''}>
        ${this.audioBlock()}
        <p class="settings-hint">Весь звук синтезируется в браузере. На нуле движок не тратит ресурсы на воспроизведение.</p>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">НАЗАД <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // НАСТРОЙКИ</span>
        <span>СОХРАНЯЕТСЯ В БРАУЗЕРЕ</span>
      </div>
    `;
    this.setOverlay(html, 'overlay--settings');
  }

  setSettingsTab(tab) {
    this.settingsTab = tab === 'audio' ? 'audio' : 'graphics';
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

  // ------------------------------------------------------------------ help
  openHelp() {
    if (this.game.started && !this.game.over) this.game.setPaused(true);
    this.overlayBack = this.backTarget();
    this.showHelp();
  }

  showHelp() {
    const html = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ПОЛЕВАЯ ПАМЯТКА</div>
        <h1 class="help-title">КАК ИГРАТЬ</h1>
        <p class="tagline">Камера, приказы и быстрые команды. Пауза не блокирует управление — меню можно открыть в любой момент.</p>
      </div>
      <div class="controls-block help-controls">
        <div class="controls-title">КЛАВИАТУРА И МЫШЬ</div>
        <div class="controls-grid">
          <div><kbd>ЛКМ</kbd><span>выбор, рамка</span></div>
          <div><kbd>ПКМ</kbd><span>приказ, атака</span></div>
          <div><kbd>WASD</kbd><span>камера</span></div>
          <div><kbd>Q / E</kbd><span>поворот камеры</span></div>
          <div><kbd>Колесо</kbd><span>зум</span></div>
          <div><kbd>СКМ</kbd><span>тащить камеру</span></div>
          <div><kbd>Z X C V B N M</kbd><span>команды</span></div>
          <div><kbd>F</kbd><span>атака по площади</span></div>
          <div><kbd>H</kbd><span>стоп</span></div>
          <div><kbd>P</kbd><span>держать позицию</span></div>
          <div><kbd>T</kbd><span>патруль</span></div>
          <div><kbd>I</kbd><span>свободные инженеры</span></div>
          <div><kbd>K</kbd><span>продать здание</span></div>
          <div><kbd>R</kbd><span>ремонт здания</span></div>
          <div><kbd>Shift</kbd><span>добавить к выбору</span></div>
          <div><kbd>Пробел</kbd><span>на базу</span></div>
          <div><kbd>Esc</kbd><span>пауза / меню</span></div>
          <div><kbd>ЛКМ</kbd><span>по миникарте — камера</span></div>
        </div>
        <p class="touch-hint">На сенсорном экране: тап — выбрать или отдать приказ, двойной тап по юниту — выделить всех таких на экране, один палец — панорама, два пальца — рамка выбора, щипок — зум. Кнопки справа — камера и отмена режима.</p>
      </div>
      <div class="overlay-actions">
        <button class="btn-primary" data-action="back">НАЗАД <span>→</span></button>
      </div>
      <div class="overlay-footer">
        <span>ГЕЛИОС-7 // ПОЛЕВАЯ ПАМЯТКА</span>
        <span>ESC — НАЗАД</span>
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

  showChangelog() {
    const releases = CHANGELOG.map((release) => {
      const sections = release.sections.map((section) => `
        <div class="log-section">
          <div class="log-section-title">${esc(section.title)}</div>
          <ul class="log-list">${section.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
        </div>`).join('');
      const dateLabel = release.date ?? release.tag ?? '';
      const kindLabel = release.version === 'ОБНОВЛЕНИЕ'
        ? 'ОБНОВЛЕНИЕ'
        : `ВЕРСИЯ ${release.version}`;
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
        <div class="eyebrow"><i></i> КОМАНДНАЯ СЕТЬ // ЖУРНАЛ ИЗМЕНЕНИЙ</div>
        <h1 class="log-title">ЧТО НОВОГО</h1>
        <p class="tagline">История обновлений «Гелиос-7»: даты — это даты сборок. Текущая версия — ${esc(GAME_VERSION)}.</p>
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
    const rows = Object.entries(AUDIO_LABELS).map(([key, label]) => {
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
          id: 'patrol',
          label: 'Патруль',
          short: 'ПАТРУЛЬ',
          icon: 'move',
          hotkey: 'T',
          desc: 'Ходить между текущей позицией и указанной точкой, атакуя врагов на маршруте.',
          action: () => {
            if (game.input) game.input.setPatrol(true);
          },
        },
        {
          id: 'hold',
          label: 'Держать позицию',
          short: 'ДЕРЖАТЬ',
          icon: 'hold',
          hotkey: 'P',
          desc: 'Остановиться на месте и стрелять только по врагам в радиусе поражения. Отряд не будет преследовать отступающих.',
          action: () => game.commandHold(),
        },
        {
          id: 'stop',
          label: 'Стоп',
          short: 'СТОП',
          icon: 'stop',
          hotkey: 'H',
          desc: 'Остановить выбранных юнитов и сбросить приказ.',
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

    if (b.type === 'lab') {
      // Линии разнесены на две страницы, чтобы панель не уходила в прокрутку,
      // а на каждую команду хватало горячей клавиши.
      const lines = UPGRADE_PAGES[this.researchPage] ?? UPGRADE_PAGES[0];
      const commands = lines.map((lineKey, i) => this.upgradeCommand(lineKey, b, BUILD_HOTKEYS[i]));
      commands.push(this.researchPageCommand());
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
      label: 'Свободные инженеры',
      short: 'ИНЖЕНЕРЫ',
      icon: 'engineer',
      hotkey: 'I',
      desc: 'Выделить всех инженеров, у которых нет текущего задания.',
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
      label: 'Продать здание',
      short: 'ПРОДАТЬ',
      icon: 'close',
      hotkey: 'K',
      desc: `${building.def.name}: вернуть ${refund} кредитов и освободить место.`,
      action: () => this.game.sellBuilding(building),
    };
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
    const disabled = ready.length === 0 || capReached || game.credits < def.cost;
    const reason = list.length === 0 || ready.length === 0 ? MESSAGES.notReady
      : capReached ? MESSAGES.capReached
        : `Недостаточно кредитов. Нужно ${def.cost}.`;
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
            `Заказано ${queued} из ${batch}: не хватает кредитов или лимита армии.`,
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

  researchPageCommand() {
    const toBase = this.researchPage === 0;
    return {
      id: 'research-page',
      label: toBase ? 'База' : 'Войска',
      short: toBase ? 'БАЗА' : 'ВОЙСКА',
      icon: 'lab',
      hotkey: 'T',
      desc: toBase
        ? 'Перейти к исследованиям базы: экономика, оборона, снабжение и лимит армии.'
        : 'Вернуться к исследованиям войск: пехота, скауты, танки, РСЗО, медики и инженеры.',
      kind: 'research',
      disabled: false,
      action: () => {
        this.researchPage = toBase ? 1 : 0;
        this.renderCommands();
      },
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
      : done ? 'Улучшение уже изучено.'
        : queued ? 'Улучшение уже исследуется.'
          : `Недостаточно кредитов. Нужно ${def.cost}.`;
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
    const labels = {
      damage: 'УРОН',
      hp: 'ПРОЧНОСТЬ',
      range: 'ДАЛЬНОСТЬ',
      speed: 'СКОРОСТЬ',
      armor: 'БРОНЯ',
      pierce: 'ПРОБИТИЕ',
      visionAdd: 'ОБЗОР',
      cooldown: 'ПЕРЕЗАРЯДКА',
      splash: 'СПЛЕШ',
      salvoAdd: 'РАКЕТЫ',
      healRate: 'ЛЕЧЕНИЕ',
      healRadius: 'РАДИУС ЛЕЧЕНИЯ',
      repairRate: 'РЕМОНТ',
      buildSpeed: 'СТРОЙКА',
      income: 'ДОХОД',
      repairCost: 'ЦЕНА РЕМОНТА',
      trainTime: 'НАЁМ',
      buildTime: 'СТРОЙКА',
      armyCap: 'ЛИМИТ',
    };
    const flat = new Set(['armor', 'pierce', 'visionAdd', 'salvoAdd', 'armyCap']);
    const lower = new Set(['cooldown', 'trainTime', 'buildTime', 'repairCost']);
    const effects = Object.entries(def.effects ?? {}).map(([stat, value]) => {
      let text;
      if (flat.has(stat)) text = `+${value}`;
      else if (lower.has(stat)) {
        // Множитель меньше единицы ускоряет процесс, больше — замедляет.
        text = value <= 1
          ? `−${Math.round((1 - value) * 100)}%`
          : `+${Math.round((value - 1) * 100)}%`;
      } else text = `+${Math.round((value - 1) * 100)}%`;
      return `<span><i>${labels[stat] ?? stat.toUpperCase()}</i>${text}</span>`;
    }).join('');
    const levels = UPGRADE_LINE_KEYS[def.line]?.length ?? 1;
    const state = done ? 'уже изучено' : queued ? 'уже в очереди' : `уровень ${def.tier}/${levels}`;
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
    const mods = this.game.unitModifiers('player', def.key);
    const hp = Math.round(def.hp * mods.hp);
    const damage = Math.round(def.damage * mods.damage);
    const range = Math.round(def.range * mods.range);
    const speed = (def.speed * mods.speed).toFixed(1);
    const support = def.healer
      ? `<span><i>ЛЕЧЕНИЕ</i>${(FIELD_SUPPORT.medicRate * mods.healRate).toFixed(1)}/с</span><span><i>РАДИУС</i>${Math.round(FIELD_SUPPORT.medicSeekRadius * mods.healRadius)}</span>`
      : def.repairer
        ? `<span><i>РЕМОНТ ТЕХНИКИ</i>${(FIELD_SUPPORT.engineerRate * mods.repairRate).toFixed(1)}/с</span>`
        : '';
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${hp}</span><span><i>УРОН</i>${damage}</span>
        <span><i>ДАЛЬНОСТЬ</i>${range}</span><span><i>СКОРОСТЬ</i>${speed}</span>
        <span><i>ЛИМИТ АРМИИ</i>${def.supply ?? 1}</span>
        ${def.builder ? '<span><i>СТРОЙКА</i>до ×4</span>' : ''}
        ${support}
      </div>
      <div class="tip-foot"><span class="tip-cost">${icon('credits')} ${def.cost}</span><span>${def.buildTime} с · ${BUILDINGS[def.from]?.name?.toLowerCase() ?? 'штаб'} · Shift+клик — ×5</span></div>
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
    const power = def.powerProduce ? `+${def.powerProduce}` : def.powerUse ? `−${def.powerUse}` : '';
    return `
      <div class="tip-head"><span class="tip-role">${def.role}</span><b>${def.name}</b></div>
      <p>${def.desc}</p>
      <div class="tip-stats">
        <span><i>HP</i>${hp}</span>${power ? `<span><i>ЭНЕРГИЯ</i>${power}</span>` : ''}
        ${income ? `<span><i>ДОХОД</i>${income}/с</span>` : ''}
        ${def.armyCap ? `<span><i>ЛИМИТ АРМИИ</i>+${def.armyCap}</span>` : ''}
        ${defense ? `<span><i>УРОН</i>${defense.damage}</span><span><i>ДАЛЬНОСТЬ</i>${defense.range}</span>` : ''}
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
        const label = dense && cmd.short ? cmd.short : cmd.label;
        html += `
          <button class="cmd ${cmd.disabled ? 'is-disabled' : ''}" data-cmd-id="${cmd.id}" aria-disabled="${cmd.disabled ? 'true' : 'false'}">
            <span class="cmd-key">${cmd.hotkey}</span>
            <span class="cmd-icon">${icon(cmd.icon)}</span>
            <span class="cmd-label">${label}</span>
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
    const selected = new Set(this.game.selectedUnits());
    const entries = [];
    for (const [index, group] of this.game.groups) {
      const units = [...group].filter((u) => u.alive);
      if (!units.length) continue;
      const counts = new Map();
      for (const u of units) counts.set(u.type, (counts.get(u.type) ?? 0) + 1);
      const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const types = [...counts.entries()]
        .map(([type, n]) => `${UNITS[type].name} ×${n}`)
        .join(', ');
      entries.push({
        index,
        units,
        dominant,
        types,
        active: units.every((u) => selected.has(u)),
      });
    }
    entries.sort((a, b) => a.index - b.index);
    rail.innerHTML = entries.map(({ index, units, dominant, types, active }) => `
      <button type="button" class="squad-slot${active ? ' is-active' : ''}"
        data-group="${index}"
        title="Отряд ${index}: ${esc(types)}. Нажмите, чтобы выделить; двойное нажатие — камера."
        aria-label="Отряд ${index}: ${esc(types)}">
        <span class="squad-key">${index}</span>
        ${icon(UNITS[dominant].icon)}
        <span class="squad-count">×${units.length}</span>
      </button>
    `).join('');
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
      const totalKills = units.reduce((s, u) => s + (u.kills ?? 0), 0);
      const same = types.length === 1;
      const name = same ? def.name : 'Смешанная группа';
      const count = units.length;
      const pct = clamp((totalHp / totalMax) * 100, 0, 100);
      this.el.selTitle.textContent = same ? `${def.name}${count > 1 ? ` ×${count}` : ''}` : `Группа ×${count}`;
      this.el.selTag.textContent = `${count} ${plural(count, 'ЮНИТ', 'ЮНИТА', 'ЮНИТОВ')}`;
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
            <span class="portrait-faction">ГЕЛИОС-7</span>
          </div>
          <div class="sel-info">
            <div class="sel-role">${same ? def.role : 'СМЕШАННЫЙ ОТРЯД'} · <span class="sel-owner">ИГРОК</span></div>
            <div class="sel-name">${name}${same && count > 1 ? ` <em>×${count}</em>` : ''}</div>
            <div class="hpbar"><i style="width:${pct}%"></i><b>${Math.ceil(totalHp)} / ${totalMax}</b></div>
            ${same ? this.vetBlock(primary) : ''}
            ${same ? `<div class="sel-stats">
              ${def.healer
                ? `<span>ЛЕЧЕНИЕ <b>${(primary.healRate ?? FIELD_SUPPORT.medicRate).toFixed(1)}/с</b></span>
                   <span>РАДИУС <b>${Math.round(primary.healSeek ?? FIELD_SUPPORT.medicSeekRadius)}</b></span>`
                : `<span>УРОН <b>${Math.round(primary.damage ?? def.damage)}</b></span>
                   <span>ДАЛЬНОСТЬ <b>${Math.round(primary.range ?? def.range)}</b></span>`}
              <span>СКОРОСТЬ <b>${(primary.speed ?? def.speed).toFixed(1)}</b></span>
              <span>ЛИМИТ <b>${def.supply ?? 1}</b></span>
              <span>УБИЙСТВ <b>${totalKills}</b></span>
              ${def.repairer ? `<span>РЕМОНТ ТЕХНИКИ <b>${(primary.repairRate ?? FIELD_SUPPORT.engineerRate).toFixed(1)}/с</b></span>` : ''}
            </div>` : `<div class="sel-note">В отряде несколько типов юнитов. Наведите на карточку найма для характеристик.</div>`}
            ${chips}
            ${upgradeChip}
          </div>
          ${this.sideStatus()}
        </div>
        <div class="sel-foot"><span class="dot"></span> ЛКМ — уточнить · ПКМ — приказ · F — атака · T — патруль</div>
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
    const defense = b.defense ?? def.defense;
    const incomeChip = def.income
      ? `<span class="chip chip--income">${icon('credits')} ${(def.income * this.game.globalModifiers(b.faction).income).toFixed(1)}/с</span>`
      : '';
    const armyChip = def.armyCap ? `<span class="chip chip--army">${icon('army')} +${def.armyCap} ЛИМИТ</span>` : '';
    const defenseChip = defense
      ? `<span class="chip chip--defense">${icon('turret')} ${Math.round(defense.damage)} УРОН · ${Math.round(defense.range)} ДАЛЬН.</span>`
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
      ${UNIT_PRODUCTION[b.type] || b.type === 'lab' ? queueHTML : ''}
      ${buildHTML}
      <div class="sel-foot"><span class="dot"></span> ${UNIT_PRODUCTION[b.type] && b.type !== 'hq'
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

  /** Ранг и шкала опыта под полосой HP. */
  vetBlock(unit) {
    const rank = clamp(unit.rank ?? 0, 0, VETERANCY.names.length - 1);
    const prev = VETERANCY.thresholds[rank] ?? 0;
    const next = VETERANCY.thresholds[rank + 1];
    const pct = next ? clamp(((unit.xp - prev) / (next - prev)) * 100, 0, 100) : 100;
    const text = next
      ? `${Math.round(unit.xp)} / ${next} XP`
      : 'МАКСИМАЛЬНЫЙ РАНГ';
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
      text: next ? `${Math.round(unit.xp)} / ${next} XP` : 'МАКСИМАЛЬНЫЙ РАНГ',
    };
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
      const emptyLabel = b.def.research ? 'ВЫБЕРИТЕ УЛУЧШЕНИЕ' : 'ГОТОВ К НАЙМУ';
      return `<div class="queue queue--empty"><span>Очередь производства пуста</span><span>${b.complete ? emptyLabel : 'ИДЁТ СТРОЙКА'}</span></div>`;
    }
    const slots = [];
    for (let i = 0; i < b.queue.length; i++) {
      const item = b.queue[i];
      const def = item.upgrade ? UPGRADES[item.upgrade] : UNITS[item.type];
      const progress = i === 0 ? (1 - item.remaining / item.total) * 100 : 0;
      const time = i === 0 ? item.remaining : item.total;
      slots.push(`
        <button class="queue-tile${i === 0 ? ' is-active' : ''}" data-cancel-queue="${i}"
          title="Отменить: ${esc(def.name)}" aria-label="Отменить: ${esc(def.name)}">
          <span class="q-x" aria-hidden="true">×</span>
          <span class="q-icon">${icon(def.icon)}</span>
          <span class="q-name">${esc(def.name)}</span>
          <span class="q-time">${formatTime(time)}</span>
          <span class="q-progress"><i style="width:${clamp(progress, 0, 100)}%"></i></span>
        </button>`);
    }
    return `
      <div class="queue">
        <div class="queue-head"><span>ОЧЕРЕДЬ ПРОИЗВОДСТВА</span><span>В ОЧЕРЕДИ: ${b.queue.length}</span></div>
        <div class="queue-list">${slots.join('')}</div>
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

    const mission = this.game.mission;
    if (mission?.kind === 'endless' && this.game.endless) {
      const endless = this.game.endless;
      const best = endlessBest(mission);
      this.el.missionLabel.textContent = `ПРОТОКОЛ · ВОЛНА ${endless.waveIndex}`;
      this.el.missionText.textContent =
        `Следующая через ${formatTime(Math.ceil(endless.nextWaveIn))} · в секторе ${formatTime(this.game.elapsed)}`;
      this.el.missionCard.title = best
        ? `Рекорд: ${formatTime(best.time)}, ${best.waves} волн`
        : 'Продержитесь как можно дольше';
    } else if (mission && this.el.missionText) {
      const total = this.game.objectives.length;
      const done = this.game.objectives.filter((objective) => objective.done).length;
      const active = this.game.activeObjective();
      this.el.missionLabel.textContent = mission.kind === 'campaign'
        ? `ЗАДАЧА ${Math.min(done + 1, total)}/${total}`
        : `ИСПЫТАНИЕ ${done}/${total}`;
      this.el.missionText.textContent = active
        ? `${active.title}${active.progressText ? ` · ${active.progressText}` : ''}`
        : 'Все задачи выполнены';
      this.el.missionCard.title = this.game.objectives
        .map((objective) => `${objective.done ? '✓' : '—'} ${objective.title}${objective.progressText ? ` (${objective.progressText})` : ''}`)
        .join('\n');
    } else if (this.el.missionText) {
      this.el.missionLabel.textContent = 'ЗАДАЧА';
      this.el.missionText.textContent = 'Уничтожить командный центр противника';
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
