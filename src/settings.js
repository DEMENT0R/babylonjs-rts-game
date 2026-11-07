// Настройки графики и звука: значения по умолчанию, хранение и применение.

import { DIFFICULTY_ORDER } from './config.js';

const STORAGE_KEY = 'gelios.graphics.v1';
const AUDIO_KEY = 'gelios.audio.v1';
const DIFFICULTY_KEY = 'gelios.difficulty.v1';
const FOG_KEY = 'gelios.fog.v1';

export const GRAPHICS_DEFAULTS = Object.freeze({
  shadows: 'medium',
  glow: 'on',
  renderScale: '1',
});

export const GRAPHICS_LABELS = {
  shadows: 'ТЕНИ',
  glow: 'СВЕЧЕНИЕ',
  renderScale: 'РАЗРЕШЕНИЕ',
};

export const GRAPHICS_OPTIONS = {
  shadows: [
    { value: 'high', label: 'ВЫСОКОЕ' },
    { value: 'medium', label: 'СРЕДНЕЕ' },
    { value: 'low', label: 'НИЗКОЕ' },
    { value: 'off', label: 'ВЫКЛ.' },
  ],
  glow: [
    { value: 'on', label: 'ВКЛ.' },
    { value: 'off', label: 'ВЫКЛ.' },
  ],
  renderScale: [
    { value: '1', label: '100%' },
    { value: '0.85', label: '85%' },
    { value: '0.7', label: '70%' },
  ],
};

export class GraphicsSettings {
  constructor({ engine, glow, world }) {
    this.engine = engine;
    this.glow = glow;
    this.world = world;
    this.values = { ...GRAPHICS_DEFAULTS };
    this.onChange = null;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return this.values;
      const saved = JSON.parse(raw);
      for (const key of Object.keys(GRAPHICS_DEFAULTS)) {
        if (this.isValid(key, saved?.[key])) this.values[key] = String(saved[key]);
      }
    } catch {
      // localStorage может быть недоступен — играем на значениях по умолчанию.
    }
    return this.values;
  }

  isValid(key, value) {
    return GRAPHICS_OPTIONS[key]?.some((option) => option.value === String(value)) ?? false;
  }

  get(key) {
    return key ? this.values[key] : { ...this.values };
  }

  set(key, value) {
    const next = String(value);
    if (!this.isValid(key, next) || this.values[key] === next) return false;
    this.values[key] = next;
    this.save();
    this.apply();
    this.onChange?.(this.get());
    return true;
  }

  reset() {
    this.values = { ...GRAPHICS_DEFAULTS };
    this.save();
    this.apply();
    this.onChange?.(this.get());
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Приватный режим или запрет хранилища не должны ломать игру.
    }
  }

  apply() {
    const scale = 1 / Number(this.values.renderScale);
    if (Math.abs(this.engine.getHardwareScalingLevel() - scale) > 1e-6) {
      this.engine.setHardwareScalingLevel(scale);
      this.engine.resize();
    }
    if (this.glow) this.glow.isEnabled = this.values.glow === 'on';
    this.world.setShadowMode(this.values.shadows);
  }
}

// ------------------------------------------------------------------ звук

export const AUDIO_DEFAULTS = Object.freeze({
  master: '70',
  sfx: '80',
  ambient: '55',
});

export const AUDIO_LABELS = {
  master: 'ОБЩАЯ ГРОМКОСТЬ',
  sfx: 'ЭФФЕКТЫ',
  ambient: 'ОКРУЖЕНИЕ',
};

/** Звук живёт в процентах: 0 — тишина, 100 — полная громкость. */
export class AudioSettings {
  constructor({ audio }) {
    this.audio = audio;
    this.values = { ...AUDIO_DEFAULTS };
    this.onChange = null;
  }

  load() {
    try {
      const raw = localStorage.getItem(AUDIO_KEY);
      if (!raw) return this.values;
      const saved = JSON.parse(raw);
      for (const key of Object.keys(AUDIO_DEFAULTS)) {
        if (this.isValid(key, saved?.[key])) this.values[key] = String(saved[key]);
      }
    } catch {
      // localStorage может быть недоступен — играем на значениях по умолчанию.
    }
    return this.values;
  }

  isValid(key, value) {
    if (!(key in AUDIO_DEFAULTS)) return false;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }

  get(key) {
    return key ? this.values[key] : { ...this.values };
  }

  set(key, value) {
    const n = Math.round(Number(value));
    if (!this.isValid(key, n)) return false;
    const next = String(n);
    if (this.values[key] === next) return false;
    this.values[key] = next;
    this.save();
    this.apply();
    this.onChange?.(this.get());
    return true;
  }

  reset() {
    this.values = { ...AUDIO_DEFAULTS };
    this.save();
    this.apply();
    this.onChange?.(this.get());
  }

  save() {
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify(this.values));
    } catch {
      // Приватный режим или запрет хранилища не должны ломать игру.
    }
  }

  apply() {
    this.audio?.setVolumes(this.values);
  }
}

// ------------------------------------------------------------- сложность ИИ

/**
 * Выбранная сложность противника. Живёт отдельно от графики и звука:
 * это не внешний вид, а правила партии, и меняется только до её начала.
 */
export class DifficultySettings {
  constructor() {
    this.value = 'normal';
    this.onChange = null;
  }

  load() {
    try {
      const saved = localStorage.getItem(DIFFICULTY_KEY);
      if (DIFFICULTY_ORDER.includes(saved)) this.value = saved;
    } catch {
      // localStorage может быть недоступен — остаёмся на «обычном».
    }
    return this.value;
  }

  get() {
    return this.value;
  }

  set(value) {
    if (!DIFFICULTY_ORDER.includes(value) || this.value === value) return false;
    this.value = value;
    this.save();
    this.onChange?.(value);
    return true;
  }

  save() {
    try {
      localStorage.setItem(DIFFICULTY_KEY, this.value);
    } catch {
      // Приватный режим не должен мешать начать партию.
    }
  }
}

// ------------------------------------------------------------- туман войны

/**
 * Туман войны — правило партии, а не внешний вид: выключенный туман открывает
 * обеим сторонам всю карту и противника. Как и сложность, выбор действует
 * только до начала боя и запоминается в браузере.
 */
export class FogSettings {
  constructor() {
    this.value = 'on';
    this.onChange = null;
  }

  load() {
    try {
      const saved = localStorage.getItem(FOG_KEY);
      if (saved === 'on' || saved === 'off') this.value = saved;
    } catch {
      // localStorage может быть недоступен — играем с туманом.
    }
    return this.value;
  }

  get() {
    return this.value;
  }

  set(value) {
    if (value !== 'on' && value !== 'off') return false;
    if (this.value === value) return false;
    this.value = value;
    this.save();
    this.onChange?.(value);
    return true;
  }

  save() {
    try {
      localStorage.setItem(FOG_KEY, this.value);
    } catch {
      // Приватный режим не должен мешать начать партию.
    }
  }
}
