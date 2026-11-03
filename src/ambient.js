// Фоновое окружение: у каждой палитры карты свой звуковой ландшафт.
// Всё синтезируется на месте — ни одного сэмпла.

const BIOMES = {
  // Ржавая пустошь: скрип металла, ветер в обломках, редкие удары.
  rust: {
    wind: { gain: 0.22, cutoff: 640, q: 0.9, lfo: 0.055, depth: 300, rate: 0.8 },
    rumble: { gain: 0.16, cutoff: 88, rate: 0.55 },
    air: { gain: 0.045, highpass: 2200, rate: 1.6 },
    every: [4, 11],
    events: [{ id: 'creak', weight: 3 }, { id: 'clank', weight: 2 }, { id: 'boom', weight: 1 }],
  },
  // Базальтовые поля: низкий гул, холодный ветер, гулкие далёкие удары.
  basalt: {
    wind: { gain: 0.17, cutoff: 420, q: 0.7, lfo: 0.035, depth: 160, rate: 0.65 },
    rumble: { gain: 0.22, cutoff: 62, rate: 0.45 },
    air: { gain: 0.03, highpass: 3000, rate: 1.9 },
    every: [7, 16],
    events: [{ id: 'boom', weight: 3 }, { id: 'clank', weight: 1 }],
  },
  // Охристые дюны: сильный ветер, песок, порывы.
  ochre: {
    wind: { gain: 0.3, cutoff: 1100, q: 0.55, lfo: 0.09, depth: 620, rate: 0.95 },
    rumble: { gain: 0.1, cutoff: 70, rate: 0.5 },
    air: { gain: 0.085, highpass: 3400, rate: 1.35 },
    every: [5, 12],
    events: [{ id: 'gust', weight: 4 }, { id: 'creak', weight: 1 }],
  },
  // Пепельная зона: почти тишина, глухой ветер, тлеющие угли.
  ash: {
    wind: { gain: 0.13, cutoff: 300, q: 0.6, lfo: 0.03, depth: 120, rate: 0.7 },
    rumble: { gain: 0.12, cutoff: 55, rate: 0.4 },
    air: { gain: 0.015, highpass: 3600, rate: 2.1 },
    every: [4, 9],
    events: [{ id: 'ember', weight: 4 }, { id: 'boom', weight: 1 }],
  },
};

/** Розовый шум с кроссфейдом концов: длинный бесшовный фон без файлов. */
function loopNoise(ctx, seconds, seed) {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed | 0 || 0x2545f491;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const white = (s >>> 0) / 2147483648 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    data[i] = pink;
    if (Math.abs(pink) > peak) peak = Math.abs(pink);
  }
  if (peak > 0) for (let i = 0; i < length; i++) data[i] /= peak;

  // Сшивка: хвост плавно переходит в начало, чтобы петля не щёлкала.
  const fade = Math.min(length >> 2, Math.floor(ctx.sampleRate * 0.5));
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    data[i] = data[i] * t + data[length - fade + i] * (1 - t);
  }
  return buffer;
}

export class Ambient {
  constructor({ ctx, destination, reverbSend = null, biome = 'rust' }) {
    this.ctx = ctx;
    this.destination = destination;
    this.reverbSend = reverbSend;
    this.biome = null;
    this.mix = null;
    this.sources = [];
    this.timer = 3;
    this.paused = false;
    this.reverbLevel = 1;
    this.noise = loopNoise(ctx, 10, 0x1f123bb5);
    this._generation = 0;
    this.build(biome);
  }

  _cfg(key) {
    return BIOMES[key] ?? BIOMES.rust;
  }

  build(key) {
    const ctx = this.ctx;
    const biome = BIOMES[key] ? key : 'rust';
    this.biome = biome;
    this.cfg = this._cfg(biome);
    this._generation++;

    const mix = ctx.createGain();
    mix.gain.setValueAtTime(0.0001, ctx.currentTime);
    mix.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.5);
    mix.connect(this.destination);
    this.mix = mix;

    // Ветер: шум через фильтр, который медленно «дышит».
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    wind.playbackRate.value = this.cfg.wind.rate;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = this.cfg.wind.cutoff;
    windFilter.Q.value = this.cfg.wind.q;
    const windGain = ctx.createGain();
    windGain.gain.value = this.cfg.wind.gain;
    wind.connect(windFilter).connect(windGain).connect(mix);
    wind.start();
    this.windGain = windGain;
    this.windFilter = windFilter;
    this.sources.push(wind);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.cfg.wind.lfo;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = this.cfg.wind.depth;
    lfo.connect(lfoDepth).connect(windFilter.frequency);
    lfo.start();
    this.sources.push(lfo);

    // Низкий гул земли.
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    rumble.playbackRate.value = this.cfg.rumble.rate;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = this.cfg.rumble.cutoff;
    rumbleFilter.Q.value = 0.8;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = this.cfg.rumble.gain;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(mix);
    rumble.start();
    this.sources.push(rumble);

    // Воздух: песок или пыль на высоких частотах.
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    air.playbackRate.value = this.cfg.air.rate;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'highpass';
    airFilter.frequency.value = this.cfg.air.highpass;
    const airGain = ctx.createGain();
    airGain.gain.value = this.cfg.air.gain;
    air.connect(airFilter).connect(airGain).connect(mix);
    air.start();
    this.airGain = airGain;
    this.sources.push(air);

    if (this.paused) mix.gain.setTargetAtTime(0.3, ctx.currentTime, 0.3);
  }

  /** Смена палитры на лету: старый слой гаснет, новый вступает. */
  setBiome(key) {
    if (!BIOMES[key] || key === this.biome) return;
    this._disposeNodes(0.8);
    this.build(key);
  }

  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (!this.mix) return;
    const now = this.ctx.currentTime;
    this.mix.gain.cancelScheduledValues(now);
    this.mix.gain.setTargetAtTime(paused ? 0.3 : 1, now, 0.35);
  }

  /** Реверб окружения живёт в общей шине: гасим его вместе с громкостью. */
  setReverbLevel(level) {
    this.reverbLevel = Math.max(0, Math.min(1, Number(level) || 0));
  }

  _disposeNodes(fade = 0.5) {
    const old = this.mix;
    if (old) {
      const now = this.ctx.currentTime;
      old.gain.cancelScheduledValues(now);
      old.gain.setTargetAtTime(0.0001, now, fade / 3);
      const sources = this.sources;
      setTimeout(() => {
        for (const node of sources) {
          try {
            node.stop();
          } catch {}
          try {
            node.disconnect();
          } catch {}
        }
        try {
          old.disconnect();
        } catch {}
      }, fade * 1000 + 200);
    }
    this.sources = [];
  }

  update(dt) {
    if (!this.mix) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const [min, max] = this.cfg.every;
    this.timer = min + Math.random() * Math.max(0, max - min);
    if (this.paused) return;
    this._emit();
  }

  _pickEvent() {
    const events = this.cfg.events;
    let total = 0;
    for (const e of events) total += e.weight;
    let roll = Math.random() * total;
    for (const e of events) {
      roll -= e.weight;
      if (roll <= 0) return e.id;
    }
    return events[0].id;
  }

  _emit() {
    const id = this._pickEvent();
    if (id === 'creak') this._creak();
    else if (id === 'clank') this._clank();
    else if (id === 'boom') this._boom();
    else if (id === 'gust') this._gust();
    else if (id === 'ember') this._ember();
  }

  /** Точка выхода события: панорама и общий реверб. */
  _eventOut(pan, volume = 1) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    let tail = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(this.mix);
    if (this.reverbSend) {
      const send = ctx.createGain();
      send.gain.value = 0.8 * this.reverbLevel;
      gain.connect(send).connect(this.reverbSend);
    }
    return gain;
  }

  /** Скрип металла: пила в узкой полосе с медленным сдвигом высоты. */
  _creak() {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    const dur = 0.7 + Math.random() * 0.9;
    const out = this._eventOut((Math.random() - 0.5) * 1.4, 0.7);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 52 + Math.random() * 34;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.linearRampToValueAtTime(base * (0.68 + Math.random() * 0.3), now + dur * 0.8);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(380 + Math.random() * 420, now);
    band.frequency.linearRampToValueAtTime(260 + Math.random() * 240, now + dur);
    band.Q.value = 3.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.55, now + dur * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(band).connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }

  /** Гулкий удар: далёкая металлическая конструкция. */
  _clank() {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    const out = this._eventOut((Math.random() - 0.5) * 1.6, 0.65);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900 + Math.random() * 1100;
    band.Q.value = 9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    noise.connect(band).connect(gain).connect(out);
    noise.start(now);
    noise.stop(now + 0.3);

    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(240 + Math.random() * 120, now);
    tone.frequency.exponentialRampToValueAtTime(150, now + 0.25);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.45, now);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    tone.connect(toneGain).connect(out);
    tone.start(now);
    tone.stop(now + 0.35);
  }

  /** Далёкий гул: что-то большое ворочается под землёй. */
  _boom() {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    const out = this._eventOut((Math.random() - 0.5) * 1.8, 0.32);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(54 + Math.random() * 14, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.9);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.8, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc.connect(gain).connect(out);
    osc.start(now);
    osc.stop(now + 1.2);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noise;
    noise.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 140;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.5, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
    noise.connect(lowpass).connect(noiseGain).connect(out);
    noise.start(now);
    noise.stop(now + 1.1);
  }

  /** Порыв ветра: временно поднимаем ветер и песок. */
  _gust() {
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.05;
    if (!this.windGain || !this.airGain) return;
    const wind = this.windGain.gain;
    const air = this.airGain.gain;
    const windBase = this.cfg.wind.gain;
    const airBase = this.cfg.air.gain;
    wind.cancelScheduledValues(now);
    air.cancelScheduledValues(now);
    wind.setValueAtTime(wind.value, now);
    air.setValueAtTime(air.value, now);
    wind.linearRampToValueAtTime(windBase * 2.1, now + 1.1);
    air.linearRampToValueAtTime(airBase * 2.6, now + 0.9);
    wind.setTargetAtTime(windBase, now + 1.4, 0.8);
    air.setTargetAtTime(airBase, now + 1.2, 0.7);

    const whistle = ctx.createOscillator();
    whistle.type = 'sine';
    whistle.frequency.setValueAtTime(520 + Math.random() * 260, now);
    whistle.frequency.linearRampToValueAtTime(700 + Math.random() * 300, now + 1.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
    whistle.connect(gain).connect(this._eventOut((Math.random() - 0.5) * 1.2, 1));
    whistle.start(now);
    whistle.stop(now + 1.7);
  }

  /** Тлеющие угли: редкие сухие щелчки. */
  _ember() {
    const ctx = this.ctx;
    const base = ctx.currentTime + 0.05;
    const pan = (Math.random() - 0.5) * 1.2;
    const out = this._eventOut(pan, 0.5);
    const grains = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < grains; i++) {
      const at = base + Math.random() * 0.7;
      const grain = ctx.createBufferSource();
      grain.buffer = this.noise;
      const band = ctx.createBiquadFilter();
      band.type = 'highpass';
      band.frequency.value = 2400 + Math.random() * 1800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      grain.connect(band).connect(gain).connect(out);
      grain.start(at);
      grain.stop(at + 0.04);
    }
  }
}
