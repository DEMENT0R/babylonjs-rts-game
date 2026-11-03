// Процедурный звук: выстрелы, попадания, взрывы и интерфейс синтезируются
// в Web Audio. Ни одного звукового файла — буферы рендерятся при загрузке
// страницы, а в бою только воспроизводятся.

import { Ambient } from './ambient.js';
import { RADIO_SPECS } from './radio.js';

const SAMPLE_RATE = 44100;
const MAX_VOICES = 24;
const SHOT_TOKENS_MAX = 8;
const SHOT_TOKENS_REFILL = 24; // выстрелов в секунду, которые ещё слышны

// --------------------------------------------------------------- утилиты

/** Детерминированный белый шум: одинаковый звук при каждом запуске. */
function noiseBuffer(ctx, seconds, seed) {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = (seed | 0) || 0x9e3779b9;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = (s >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

/** Мягкое ограничение сигнала: делает выстрел плотнее и не даёт клиппинга. */
function driveCurve(amount) {
  const size = 1024;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount);
  }
  return curve;
}

function decayGain(ctx, value, attack, decay) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, value), attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, decay);
  return gain;
}

// ------------------------------------------------------------ синтез звуков

/**
 * Выстрел: низкий «бум» ствола + шумовой хлопок + щелчок фронта.
 * Параметры отличают винтовку от танковой пушки.
 */
function buildGunshot(ctx, seed, variant, p) {
  const out = ctx.createGain();
  out.gain.value = p.level ?? 0.8;
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(p.drive ?? 1.5);
  shaper.oversample = '2x';
  out.connect(shaper).connect(ctx.destination);

  const body = ctx.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(p.bodyFreq * (0.97 + variant * 0.02), 0);
  body.frequency.exponentialRampToValueAtTime(Math.max(20, p.bodyEnd), p.bodyTime);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001, 0);
  bodyGain.gain.exponentialRampToValueAtTime(p.bodyLevel ?? 0.95, 0.005);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, p.bodyTime * 1.7);
  body.connect(bodyGain).connect(out);
  body.start(0);
  body.stop(p.bodyTime * 1.8 + 0.05);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, p.noiseTime + 0.15, seed);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(p.noiseFreq, 0);
  band.frequency.exponentialRampToValueAtTime(Math.max(180, p.noiseFreq * 0.42), p.noiseTime);
  band.Q.value = p.noiseQ ?? 0.7;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = p.highpass ?? 220;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, 0);
  noiseGain.gain.exponentialRampToValueAtTime(p.noiseLevel ?? 0.85, 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, p.noiseTime);
  noise.connect(band).connect(high).connect(noiseGain).connect(out);
  noise.start(0);
  noise.stop(p.noiseTime + 0.12);

  const crack = ctx.createBufferSource();
  crack.buffer = noiseBuffer(ctx, 0.03, seed + 17);
  const crackHigh = ctx.createBiquadFilter();
  crackHigh.type = 'highpass';
  crackHigh.frequency.value = p.crackFreq ?? 2400;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(p.crackLevel ?? 0.45, 0);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, 0.022);
  crack.connect(crackHigh).connect(crackGain).connect(out);
  crack.start(0);
  crack.stop(0.03);
}

/** Ракета: шипящий разгон без резкого хлопка пушки. */
function buildWhoosh(ctx, seed, variant) {
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 1.2, seed);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(320, 0);
  band.frequency.exponentialRampToValueAtTime(1900, 0.45);
  band.Q.value = 1.1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.exponentialRampToValueAtTime(0.9, 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, 0.95);
  noise.connect(band).connect(gain).connect(out);
  noise.start(0);
  noise.stop(1.1);

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(130 + variant * 8, 0);
  thump.frequency.exponentialRampToValueAtTime(48, 0.18);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.0001, 0);
  thumpGain.gain.exponentialRampToValueAtTime(0.8, 0.008);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, 0.3);
  thump.connect(thumpGain).connect(out);
  thump.start(0);
  thump.stop(0.35);
}

/** Взрыв: низкий удар, глухой шум и треск горящих обломков. */
function buildExplosion(ctx, seed, variant, p) {
  const out = ctx.createGain();
  out.gain.value = p.level ?? 0.9;
  out.connect(ctx.destination);

  const boom = ctx.createOscillator();
  boom.type = 'sine';
  boom.frequency.setValueAtTime(p.startFreq * (0.96 + variant * 0.04), 0);
  boom.frequency.exponentialRampToValueAtTime(p.endFreq, p.length * 0.55);
  const boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0.0001, 0);
  boomGain.gain.exponentialRampToValueAtTime(1, 0.008);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, p.length);
  boom.connect(boomGain).connect(out);
  boom.start(0);
  boom.stop(p.length + 0.1);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, p.length + 0.2, seed);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(p.bright, 0);
  lowpass.frequency.exponentialRampToValueAtTime(240, p.length * 0.7);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, 0);
  noiseGain.gain.exponentialRampToValueAtTime(0.85, 0.01);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, p.length);
  noise.connect(lowpass).connect(noiseGain).connect(out);
  noise.start(0);
  noise.stop(p.length + 0.1);

  // Треск: короткие зерна поверх гула, чтобы взрыв не был «гладким».
  for (let i = 0; i < 4; i++) {
    const at = 0.05 + Math.random() * 0.32;
    const grain = ctx.createBufferSource();
    grain.buffer = noiseBuffer(ctx, 0.06, seed + 101 + i * 13);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 + Math.random() * 2400;
    band.Q.value = 2.4;
    const grainGain = ctx.createGain();
    grainGain.gain.setValueAtTime(0.3, at);
    grainGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    grain.connect(band).connect(grainGain).connect(out);
    grain.start(at);
    grain.stop(at + 0.06);
  }
}

/** Попадание: металлический щелчок и короткий звон. */
function buildImpact(ctx, seed, variant) {
  const out = ctx.createGain();
  out.gain.value = 0.85;
  out.connect(ctx.destination);

  const tick = ctx.createBufferSource();
  tick.buffer = noiseBuffer(ctx, 0.08, seed);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2600 + variant * 320;
  band.Q.value = 5;
  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(0.9, 0);
  tickGain.gain.exponentialRampToValueAtTime(0.0001, 0.05);
  tick.connect(band).connect(tickGain).connect(out);
  tick.start(0);
  tick.stop(0.08);

  const ping = ctx.createOscillator();
  ping.type = 'triangle';
  ping.frequency.setValueAtTime(1500 + variant * 130, 0);
  ping.frequency.exponentialRampToValueAtTime(860, 0.05);
  const pingGain = decayGain(ctx, 0.18, 0.004, 0.07);
  ping.connect(pingGain).connect(out);
  ping.start(0);
  ping.stop(0.09);
}

/** Короткий тон интерфейса. */
function buildBeep(ctx, seed, variant, p) {
  const out = ctx.createGain();
  out.gain.value = p.level ?? 0.3;
  out.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = p.type ?? 'sine';
  osc.frequency.setValueAtTime(p.from, 0);
  if (p.to) osc.frequency.exponentialRampToValueAtTime(p.to, p.dur);
  const gain = decayGain(ctx, 1, 0.006, p.dur);
  osc.connect(gain).connect(out);
  osc.start(0);
  osc.stop(p.dur + 0.05);
}

/** Тревога: два настойчивых сигнала. */
function buildAlert(ctx, seed, variant) {
  const out = ctx.createGain();
  out.gain.value = 0.34;
  out.connect(ctx.destination);
  for (let i = 0; i < 2; i++) {
    const at = i * 0.19;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = i === 0 ? 880 : 660;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + 0.01);
    gain.gain.setValueAtTime(1, at + 0.11);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2600;
    osc.connect(gain).connect(lowpass).connect(out);
    osc.start(at);
    osc.stop(at + 0.18);
  }
}

// ----------------------------------------------------------- описание набора

const SOUND_SPECS = {
  rifle: {
    seconds: 0.45,
    count: 4,
    build: (ctx, seed, v) => buildGunshot(ctx, seed, v, {
      level: 0.7,
      bodyFreq: 168,
      bodyEnd: 58,
      bodyTime: 0.1,
      noiseFreq: 2100,
      noiseTime: 0.13,
      noiseLevel: 0.8,
      drive: 1.6,
    }),
  },
  smg: {
    seconds: 0.3,
    count: 3,
    build: (ctx, seed, v) => buildGunshot(ctx, seed, v, {
      level: 0.55,
      bodyFreq: 215,
      bodyEnd: 76,
      bodyTime: 0.07,
      noiseFreq: 2900,
      noiseTime: 0.08,
      noiseLevel: 0.7,
      drive: 1.3,
    }),
  },
  cannon: {
    seconds: 1.15,
    count: 3,
    build: (ctx, seed, v) => buildGunshot(ctx, seed, v, {
      level: 0.85,
      bodyFreq: 96,
      bodyEnd: 33,
      bodyTime: 0.3,
      bodyLevel: 1,
      noiseFreq: 820,
      noiseTime: 0.3,
      noiseLevel: 0.9,
      highpass: 120,
      drive: 2.2,
    }),
  },
  turret: {
    seconds: 0.5,
    count: 3,
    build: (ctx, seed, v) => buildGunshot(ctx, seed, v, {
      level: 0.65,
      bodyFreq: 148,
      bodyEnd: 52,
      bodyTime: 0.14,
      noiseFreq: 1750,
      noiseTime: 0.16,
      noiseLevel: 0.8,
      drive: 1.8,
    }),
  },
  rocket: {
    seconds: 1.25,
    count: 2,
    build: (ctx, seed, v) => buildWhoosh(ctx, seed, v),
  },
  impact: {
    seconds: 0.16,
    count: 3,
    build: (ctx, seed, v) => buildImpact(ctx, seed, v),
  },
  explosion: {
    seconds: 1.5,
    count: 3,
    build: (ctx, seed, v) => buildExplosion(ctx, seed, v, {
      level: 0.62,
      startFreq: 92,
      endFreq: 30,
      length: 1.1,
      bright: 2600,
    }),
  },
  explosionBig: {
    seconds: 2.4,
    count: 2,
    build: (ctx, seed, v) => buildExplosion(ctx, seed, v, {
      level: 0.58,
      startFreq: 74,
      endFreq: 24,
      length: 1.9,
      bright: 3200,
    }),
  },
  uiSelect: {
    seconds: 0.12,
    count: 2,
    build: (ctx, seed, v) => buildBeep(ctx, seed, v, { level: 0.22, from: 1180 + v * 40, to: 980, dur: 0.06 }),
  },
  uiError: {
    seconds: 0.2,
    count: 2,
    build: (ctx, seed, v) => buildBeep(ctx, seed, v, {
      level: 0.22,
      type: 'square',
      from: 150,
      to: 110,
      dur: 0.12,
    }),
  },
  alert: {
    seconds: 0.7,
    count: 2,
    build: (ctx, seed, v) => buildAlert(ctx, seed, v),
  },
};

const SHOT_KINDS = {
  marine: { name: 'rifle', volume: 0.95 },
  engineer: { name: 'rifle', volume: 0.85 },
  scout: { name: 'smg', volume: 0.85 },
  tank: { name: 'cannon', volume: 1.15 },
  artillery: { name: 'rocket', volume: 0.9 },
  turret: { name: 'turret', volume: 0.9 },
};

// Какой ответственный «голос» отвечает на приказ.
const RADIO_KINDS = {
  move: 'radioMove',
  attackMove: 'radioAttack',
  attack: 'radioAttack',
  stop: 'radioStop',
  hold: 'radioStop',
  build: 'radioBuild',
  train: 'radioTrain',
};

// ------------------------------------------------------------------ движок

export class AudioEngine {
  constructor({ camera, map } = {}) {
    this.camera = camera ?? null;
    this.map = map ?? null;
    this.ctx = null;
    this.ready = false;
    this.buffers = {};
    this.voices = 0;
    this.volume = { master: 0.7, sfx: 0.8, ambient: 0.55 };
    this.muted = false;
    this.shotTokens = SHOT_TOKENS_MAX;
    this.lastPlayed = new Map();
    this.casingAcc = 0;
    this.ambient = null;
    this.ambientKey = map?.style?.key ?? 'rust';
    this.paused = false;
    this._gestureBound = false;
    this._render();
    this._bindGesture();
  }

  // ------------------------------------------------------------ запуск

  _bindGesture() {
    if (typeof window === 'undefined') return;
    this._gesture = () => {
      this.unlock();
    };
    // Политика автозапуска: контекст можно создать только из жеста.
    window.addEventListener('pointerdown', this._gesture, { passive: true });
    window.addEventListener('keydown', this._gesture);
    this._gestureBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.ctx.suspend().catch(() => {});
      } else {
        this.ctx.resume().catch(() => {});
      }
    });
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this._buildGraph();
      this._applyVolumes();
      this._startAmbient();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      if (this._gestureBound) {
        window.removeEventListener('pointerdown', this._gesture);
        window.removeEventListener('keydown', this._gesture);
        this._gestureBound = false;
      }
    } catch {
      this.ctx = null;
    }
  }

  _buildGraph() {
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = this.volume.master;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 10;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.22;
    master.connect(limiter).connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.gain.value = this.volume.sfx;
    sfx.connect(master);

    const ambient = ctx.createGain();
    ambient.gain.value = this.volume.ambient;
    ambient.connect(master);

    // Реверб: импульсный отклик тоже сгенерирован — шум с затуханием.
    const reverb = ctx.createConvolver();
    reverb.buffer = this._impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const send = ctx.createGain();
    send.gain.value = 1;
    send.connect(reverb).connect(wet).connect(master);

    this.masterGain = master;
    this.sfxGain = sfx;
    this.ambientGain = ambient;
    this.reverbSend = send;
    this.pannerSupported = typeof ctx.createStereoPanner === 'function';
  }

  _startAmbient() {
    if (!this.ctx || this.ambient) return;
    try {
      this.ambient = new Ambient({
        ctx: this.ctx,
        destination: this.ambientGain,
        reverbSend: this.reverbSend,
        biome: this.ambientKey,
      });
      if (this.paused) this.ambient.setPaused(true);
      this.ambient.setReverbLevel(this.volume.ambient);
    } catch {
      this.ambient = null;
    }
  }

  _impulse(ctx) {
    const seconds = 1.3;
    const length = Math.ceil(seconds * ctx.sampleRate);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let s = 0x1234567 + ch * 7919;
      for (let i = 0; i < length; i++) {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        const t = i / length;
        const fadeIn = Math.min(1, i / (ctx.sampleRate * 0.015));
        data[i] = ((s >>> 0) / 2147483648 - 1) * Math.pow(1 - t, 2.6) * fadeIn * 0.7;
      }
    }
    return buffer;
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.muted = this.volume.master <= 0.001 || this.volume.sfx <= 0.001;
    const ramp = (node, value) => {
      if (!node) return;
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(value, now, 0.08);
    };
    ramp(this.masterGain, this.volume.master);
    ramp(this.sfxGain, this.volume.sfx);
    ramp(this.ambientGain, this.volume.ambient);
    this.ambient?.setReverbLevel(this.volume.ambient);
  }

  setVolumes(values = {}) {
    const read = (key, fallback) => {
      const n = Number(values[key]);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : fallback;
    };
    this.volume = {
      master: read('master', this.volume.master),
      sfx: read('sfx', this.volume.sfx),
      ambient: read('ambient', this.volume.ambient),
    };
    this._applyVolumes();
  }

  // -------------------------------------------------------- рендер буферов

  async _render() {
    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctor) return;
    const queue = [];
    for (const [name, spec] of Object.entries({ ...SOUND_SPECS, ...RADIO_SPECS })) {
      this.buffers[name] = new Array(spec.count).fill(null);
      for (let v = 0; v < spec.count; v++) queue.push({ name, spec, v });
    }
    const worker = async () => {
      while (queue.length) {
        const job = queue.shift();
        try {
          const length = Math.max(1, Math.ceil(job.spec.seconds * SAMPLE_RATE));
          const ctx = new Ctor(1, length, SAMPLE_RATE);
          job.spec.build(ctx, (job.v + 1) * 7919, job.v);
          this.buffers[job.name][job.v] = await ctx.startRendering();
        } catch {
          // Один несинтезированный звук не должен ломать остальные.
        }
      }
    };
    // Три параллельных рендера: быстро, но не воруем кадры у загрузки сцены.
    await Promise.all([worker(), worker(), worker()]);
    this.ready = Object.values(this.buffers).some((list) => list.some(Boolean));
  }

  // ---------------------------------------------------------- воспроизведение

  /** Общий путь: источник → фильтр дистанции → панорама → шина. */
  _play(name, position = null, { volume = 1, send = 0.16, rate = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.ready || this.muted) return false;
    if (this.voices >= MAX_VOICES) return false;
    const list = this.buffers[name];
    if (!list) return false;
    const buffer = list[(Math.random() * list.length) | 0];
    if (!buffer) return false;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    let level = volume;
    let panValue = pan;
    if (position) {
      const focus = this.camera?.target ?? this.camera?.position ?? null;
      if (focus) {
        const dx = position.x - focus.x;
        const dy = (position.y ?? 0) - focus.y;
        const dz = position.z - focus.z;
        const distance = Math.hypot(dx, dz, dy);
        const falloff = 1 / (1 + Math.pow(distance / 20, 1.6));
        if (falloff < 0.035) return false;
        level *= falloff;
        filter.frequency.value = Math.max(600, 16000 / (1 + distance / 26));
        panValue = this._pan(dx, dz) * Math.min(1, distance / 5) * Math.max(0.25, 1 - distance / 110);
      }
    }
    gain.gain.value = level;
    src.connect(filter).connect(gain);

    let tail = gain;
    if (this.pannerSupported) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-0.85, Math.min(0.85, panValue * 0.85));
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(this.sfxGain);

    if (send > 0) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = send;
      gain.connect(sendGain).connect(this.reverbSend);
    }

    src.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
    };
    this.voices++;
    src.start(now);
    return true;
  }

  _pan(dx, dz) {
    const camera = this.camera;
    if (!camera) return 0;
    const target = camera.target ?? null;
    if (!target) return 0;
    const pos = camera.position;
    let fx = target.x - pos.x;
    let fz = target.z - pos.z;
    const length = Math.hypot(fx, fz);
    if (length < 1e-4) return 0;
    fx /= length;
    fz /= length;
    const rightX = fz;
    const rightZ = -fx;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-4) return 0;
    return (dx / distance) * rightX + (dz / distance) * rightZ;
  }

  /** Тормоз частоты: в большой перестрелке часть выстрелов просто не слышна. */
  _allowShot() {
    if (this.shotTokens < 1) return false;
    this.shotTokens -= 1;
    return true;
  }

  _throttle(name, ms) {
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < ms) return false;
    this.lastPlayed.set(name, now);
    return true;
  }

  // -------------------------------------------------------------- события

  shot(kind, position) {
    const spec = SHOT_KINDS[kind] ?? SHOT_KINDS.marine;
    if (!this._allowShot()) return;
    if (!this._throttle(`shot:${spec.name}`, 30)) return;
    this._play(spec.name, position, { volume: spec.volume, send: 0.14 });
  }

  impact(position) {
    if (!this._throttle('impact', 45)) return;
    this._play('impact', position, { volume: 0.55, send: 0.1 });
  }

  explosion(position, scale = 1) {
    if (!this._throttle('explosion', 55)) return;
    const big = scale >= 1.2;
    this._play(big ? 'explosionBig' : 'explosion', position, {
      volume: big ? 1 : 0.85,
      send: 0.32,
      rate: 0.94 + Math.random() * 0.12,
    });
  }

  ui(kind) {
    const name = kind === 'error' ? 'uiError' : kind === 'alert' ? 'alert' : 'uiSelect';
    if (!this._throttle(`ui:${name}`, kind === 'alert' ? 400 : 70)) return;
    this._play(name, null, { volume: kind === 'alert' ? 0.9 : 0.8, send: kind === 'alert' ? 0.2 : 0 });
  }

  order(kind = 'move') {
    const name = RADIO_KINDS[kind] ?? 'radioMove';
    if (!this._throttle('order', 420)) return;
    this._play(name, null, {
      volume: 0.8,
      send: 0.05,
      rate: 0.96 + Math.random() * 0.08,
      pan: (Math.random() - 0.5) * 0.3,
    });
  }

  /** Гильза коснулась земли — тихий металлический звук рядом с камерой. */
  casing(position) {
    const camera = this.camera;
    if (!camera?.target || !position) return;
    const d = Math.hypot(position.x - camera.target.x, position.z - camera.target.z);
    if (d > 26 || !this._throttle('casing', 90)) return;
    this._play('impact', position, { volume: 0.16, send: 0.05, rate: 1.5 + Math.random() * 0.3 });
  }

  /** Палитра карты задаёт фоновый звуковой ландшафт. */
  setBiome(key) {
    if (!key) return;
    this.ambientKey = key;
    this.ambient?.setBiome(key);
  }

  setPaused(paused) {
    const next = Boolean(paused);
    if (next === this.paused) return;
    this.paused = next;
    this.ambient?.setPaused(next);
  }

  update(dt) {
    this.shotTokens = Math.min(SHOT_TOKENS_MAX, this.shotTokens + SHOT_TOKENS_REFILL * dt);
    this.ambient?.update(dt);
  }
}
