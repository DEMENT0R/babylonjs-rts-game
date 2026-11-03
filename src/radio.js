// Приказы: «радио-бормотание» из формантного синтеза. Настоящих слов нет —
// синтез даёт темп и интонацию команды, а полоса рации и шум делают голос
// неразборчивым, но узнаваемым. Ни одного сэмпла.

const VOWELS = {
  a: { f1: 730, f2: 1090, f3: 2440 },
  o: { f1: 570, f2: 840, f3: 2410 },
  u: { f1: 300, f2: 870, f3: 2240 },
  i: { f1: 270, f2: 2290, f3: 3010 },
  e: { f1: 530, f2: 1840, f3: 2480 },
  y: { f1: 300, f2: 1400, f3: 2400 },
};

// Слоги: гласная, длительность, громкость, высота, согласный на входе.
const PHRASES = {
  move: [
    { v: 'i', dur: 0.1, gain: 0.7, pitch: 1.08, onset: 'p' },
    { v: 'a', dur: 0.11, gain: 0.95, pitch: 1.0, onset: 'n' },
    { v: 'o', dur: 0.17, gain: 0.85, pitch: 0.9, onset: 't' },
  ],
  attack: [
    { v: 'a', dur: 0.1, gain: 1, pitch: 1.12, onset: null },
    { v: 'a', dur: 0.1, gain: 0.95, pitch: 1.06, onset: 't' },
    { v: 'u', dur: 0.12, gain: 1, pitch: 1.0, onset: 'k' },
    { v: 'e', dur: 0.16, gain: 0.8, pitch: 0.92, onset: 'm' },
  ],
  stop: [
    { v: 'o', dur: 0.2, gain: 1, pitch: 1.0, onset: 's' },
  ],
  build: [
    { v: 'i', dur: 0.09, gain: 0.7, pitch: 1.06, onset: 'p' },
    { v: 'u', dur: 0.1, gain: 0.9, pitch: 1.0, onset: 's' },
    { v: 'a', dur: 0.12, gain: 1, pitch: 0.98, onset: 't' },
    { v: 'e', dur: 0.18, gain: 0.8, pitch: 0.9, onset: 'm' },
  ],
  train: [
    { v: 'o', dur: 0.11, gain: 0.9, pitch: 1.0, onset: 'g' },
    { v: 'o', dur: 0.11, gain: 0.9, pitch: 0.96, onset: 't' },
    { v: 'i', dur: 0.17, gain: 0.8, pitch: 0.9, onset: 'v' },
  ],
};

const BURSTS = {
  p: { freq: 720, q: 1.2, level: 0.22, dur: 0.022 },
  t: { freq: 2000, q: 1.4, level: 0.26, dur: 0.018 },
  k: { freq: 1400, q: 1.6, level: 0.24, dur: 0.02 },
  s: { freq: 2600, q: 0.8, level: 0.2, dur: 0.05 },
  v: { freq: 1200, q: 1.1, level: 0.12, dur: 0.045 },
  g: { freq: 1000, q: 1.3, level: 0.18, dur: 0.03 },
  n: { freq: 480, q: 1.0, level: 0.08, dur: 0.03 },
  m: { freq: 380, q: 1.0, level: 0.08, dur: 0.03 },
};

function noiseBuffer(ctx, seconds, seed) {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = (seed | 0) || 0x6d2b79f5;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = (s >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

function driveCurve(amount) {
  const size = 1024;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount);
  }
  return curve;
}

function bandpass(ctx, freq, q) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  return filter;
}

/** Короткий шумовой всплеск согласного перед слогом. */
function consonant(ctx, dest, seed, at, kind) {
  const cfg = BURSTS[kind];
  if (!cfg) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, cfg.dur + 0.02, seed);
  const filter = bandpass(ctx, cfg.freq, cfg.q);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(cfg.level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + cfg.dur);
  src.connect(filter).connect(gain).connect(dest);
  src.start(at);
  src.stop(at + cfg.dur + 0.02);
}

/**
 * Фраза целиком: пила проходит через три формантных фильтра, амплитуда
 * раскладывается по слогам, сверху — щелчок и шорох рации.
 */
function buildPhrase(ctx, seed, variant, syllables) {
  const out = ctx.createGain();
  out.gain.value = 0.62;

  // Полоса рации: узкий канал и лёгкая перегрузка.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 320;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3000;
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(1.8);
  shaper.oversample = '2x';
  out.connect(highpass).connect(lowpass).connect(shaper).connect(ctx.destination);

  const voice = ctx.createGain();
  voice.gain.value = 0.0001;
  voice.connect(out);

  const source = ctx.createOscillator();
  source.type = 'sawtooth';
  const base = 104 * (1 + (variant - 1.5) * 0.035);

  const f1 = bandpass(ctx, VOWELS.a.f1, 7);
  const f2 = bandpass(ctx, VOWELS.a.f2, 9);
  const f3 = bandpass(ctx, VOWELS.a.f3, 11);
  const g1 = ctx.createGain();
  g1.gain.value = 1;
  const g2 = ctx.createGain();
  g2.gain.value = 0.5;
  const g3 = ctx.createGain();
  g3.gain.value = 0.22;
  source.connect(f1).connect(g1).connect(voice);
  source.connect(f2).connect(g2).connect(voice);
  source.connect(f3).connect(g3).connect(voice);

  // Дыхание: тихий шум в полосе голоса, чтобы синтез не был «пластиковым».
  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx, 2.2, seed + 31);
  const breathFilter = bandpass(ctx, 1900, 0.7);
  const breathGain = ctx.createGain();
  breathGain.gain.value = 0.055;
  breath.connect(breathFilter).connect(breathGain).connect(voice);

  const vibrato = ctx.createOscillator();
  vibrato.frequency.value = 5.1;
  const vibratoDepth = ctx.createGain();
  vibratoDepth.gain.value = 2.4;
  vibrato.connect(vibratoDepth).connect(source.frequency);

  let t = 0.06;
  const gap = 0.03;
  for (const s of syllables) {
    const vowel = VOWELS[s.v] ?? VOWELS.a;
    const scale = 1 + (variant - 1.5) * 0.02;
    source.frequency.setTargetAtTime(base * s.pitch, t, 0.03);
    f1.frequency.setTargetAtTime(vowel.f1 * scale, t, 0.02);
    f2.frequency.setTargetAtTime(vowel.f2 * scale, t, 0.02);
    f3.frequency.setTargetAtTime(vowel.f3 * scale, t, 0.02);
    voice.gain.setTargetAtTime(0.9 * s.gain, t, 0.012);
    voice.gain.setTargetAtTime(0.0001, t + s.dur * 0.85, 0.035);
    if (s.onset) consonant(ctx, out, seed + t * 1000, Math.max(0.01, t - 0.018), s.onset);
    t += s.dur + gap;
  }
  // Терминальная интонация: к концу фразы голос «садится».
  source.frequency.setTargetAtTime(base * 0.72, Math.max(0.15, t - 0.16), 0.07);

  const end = t + 0.12;

  // Щелчок включённой рации и шорох эфира.
  const click = ctx.createBufferSource();
  click.buffer = noiseBuffer(ctx, 0.05, seed + 7);
  const clickHigh = ctx.createBiquadFilter();
  clickHigh.type = 'highpass';
  clickHigh.frequency.value = 1500;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.25, 0.02);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, 0.06);
  click.connect(clickHigh).connect(clickGain).connect(out);
  click.start(0.02);
  click.stop(0.08);

  const hiss = ctx.createBufferSource();
  hiss.buffer = noiseBuffer(ctx, end + 0.1, seed + 53);
  const hissBand = bandpass(ctx, 1200, 0.8);
  const hissGain = ctx.createGain();
  hissGain.gain.setValueAtTime(0.0001, 0.02);
  hissGain.gain.exponentialRampToValueAtTime(0.03, 0.1);
  hissGain.gain.setValueAtTime(0.03, end - 0.1);
  hissGain.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
  hiss.connect(hissBand).connect(hissGain).connect(out);
  hiss.start(0.02);
  hiss.stop(end + 0.1);

  source.start(0.04);
  source.stop(end + 0.1);
  breath.start(0.04);
  breath.stop(end + 0.1);
  vibrato.start(0.04);
  vibrato.stop(end + 0.1);
}

export const RADIO_SPECS = {
  radioMove: {
    seconds: 0.95,
    count: 4,
    build: (ctx, seed, variant) => buildPhrase(ctx, seed, variant, PHRASES.move),
  },
  radioAttack: {
    seconds: 1.05,
    count: 4,
    build: (ctx, seed, variant) => buildPhrase(ctx, seed, variant, PHRASES.attack),
  },
  radioStop: {
    seconds: 0.7,
    count: 3,
    build: (ctx, seed, variant) => buildPhrase(ctx, seed, variant, PHRASES.stop),
  },
  radioBuild: {
    seconds: 1.1,
    count: 4,
    build: (ctx, seed, variant) => buildPhrase(ctx, seed, variant, PHRASES.build),
  },
  radioTrain: {
    seconds: 0.95,
    count: 4,
    build: (ctx, seed, variant) => buildPhrase(ctx, seed, variant, PHRASES.train),
  },
};
