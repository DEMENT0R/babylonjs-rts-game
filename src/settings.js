// Настройки графики: значения по умолчанию, хранение и применение.

const STORAGE_KEY = 'gelios.graphics.v1';

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
