// 音效與背景音樂:全部用 Web Audio 即時合成,不需要音檔(沒有授權問題,App 也不會變大)。
// 瀏覽器規定要等使用者第一次點擊後才能出聲,所以由 app.js 在第一次點擊時呼叫 unlock()。
const KEY = 'nextlife.audio.v1';
const MODES = ['all', 'sfx', 'off']; // 音樂和音效 / 只有音效 / 靜音

let mode = 'all';
try {
  const saved = localStorage.getItem(KEY);
  if (MODES.includes(saved)) mode = saved;
} catch { /* 無法讀取設定時用預設值 */ }

let ctx = null;
let sfxOut = null;
let musicOut = null;
let timer = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createDynamicsCompressor(); // 多個聲音疊在一起時不會爆音
  master.connect(ctx.destination);
  sfxOut = ctx.createGain();
  sfxOut.gain.value = 0.9;
  sfxOut.connect(master);
  const lp = ctx.createBiquadFilter(); // 音樂過一層低通,聽起來比較柔和
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  lp.connect(master);
  musicOut = ctx.createGain();
  musicOut.gain.value = 0;
  musicOut.connect(lp);
  return ctx;
}

export function getMode() { return mode; }
// 目前音訊的狀態(檢查用):none 還沒建立、suspended 等待點擊、running 可以出聲
export function status() { return ctx ? ctx.state : 'none'; }
export function cycleMode() {
  mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  try { localStorage.setItem(KEY, mode); } catch { /* 存不了就只在這次有效 */ }
  syncMusic();
  return mode;
}

// 第一次點擊時呼叫:建立並喚醒音訊,需要的話開始播音樂
export function unlock() {
  if (mode === 'off' && !ctx) return;
  if (!ensure()) return;
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
  syncMusic();
}

// ---------- 合成的基本零件 ----------
// 一個音:頻率 f,從 t 秒後開始,長度 d,音量 v;slide 是結束時滑到的頻率
function tone(out, f, t, d, { type = 'sine', v = 0.2, slide = 0, attack = 0.005 } = {}) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g);
  g.connect(out);
  o.start(t0);
  o.stop(t0 + d + 0.05);
}
// 一小段雜訊(骰子、翻牌的沙沙聲)
function noise(out, t, d, { v = 0.2, freq = 2000, q = 1, type = 'bandpass' } = {}) {
  const t0 = ctx.currentTime + t;
  const len = Math.max(1, Math.floor(ctx.sampleRate * d));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t0);
}

// 音名對應的頻率(只列用得到的)
const N = {
  A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
  D2: 73.42, E2: 82.41, Gs3: 207.65, A1: 55,
};

// ---------- 音效 ----------
const SFX = {
  tap(o) { tone(o, 620, 0, 0.06, { type: 'triangle', v: 0.12, slide: 820 }); },
  tick(o) { tone(o, 1050, 0, 0.05, { type: 'triangle', v: 0.1 }); },
  confirm(o) { tone(o, N.E5, 0, 0.09, { type: 'triangle', v: 0.14 }); tone(o, N.A5, 0.08, 0.16, { type: 'triangle', v: 0.14 }); },
  dice(o) { noise(o, 0, 0.045, { v: 0.22, freq: 2600, q: 2 }); tone(o, 240, 0, 0.03, { type: 'square', v: 0.05 }); },
  hop(o) { tone(o, 430, 0, 0.11, { type: 'sine', v: 0.18, slide: 700 }); },
  land(o) { tone(o, N.C5, 0, 0.12, { type: 'triangle', v: 0.16 }); tone(o, N.G5, 0.09, 0.22, { type: 'triangle', v: 0.16 }); },
  flip(o) { noise(o, 0, 0.16, { v: 0.16, freq: 5200, q: 0.7, type: 'highpass' }); tone(o, N.A5, 0.1, 0.12, { type: 'sine', v: 0.1 }); },
  coin(o) { tone(o, N.B5, 0, 0.09, { type: 'square', v: 0.07 }); tone(o, N.E6, 0.08, 0.32, { type: 'square', v: 0.07 }); },
  down(o) { tone(o, 300, 0, 0.3, { type: 'sine', v: 0.2, slide: 140 }); },
  reveal(o) { [N.C5, N.E5, N.A5].forEach((f, i) => tone(o, f, i * 0.09, 0.3, { type: 'triangle', v: 0.13 })); },
  year(o) { [N.G4, N.D5, N.G5].forEach((f, i) => tone(o, f, i * 0.13, 0.7, { type: 'sine', v: 0.14 })); },
  win(o) { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(o, f, i * 0.085, 0.3, { type: 'triangle', v: 0.16 })); tone(o, N.E6, 0.36, 0.5, { type: 'sine', v: 0.09 }); },
  lose(o) { [N.E4, N.C4, N.A3].forEach((f, i) => tone(o, f, i * 0.16, 0.34, { type: 'triangle', v: 0.17 })); tone(o, N.A2, 0.48, 0.5, { type: 'sine', v: 0.16 }); },
  achieve(o) {
    [N.G5, N.C6, N.E6, N.G6].forEach((f, i) => tone(o, f, i * 0.07, 0.4, { type: 'triangle', v: 0.12 }));
    [N.E6, N.G6, N.C6].forEach((f, i) => tone(o, f, 0.34 + i * 0.06, 0.25, { type: 'sine', v: 0.06 }));
  },
  fanfare(o) {
    [N.C4, N.E4, N.G4, N.C5].forEach((f, i) => tone(o, f, i * 0.12, 0.22, { type: 'triangle', v: 0.17 }));
    [N.C4, N.E4, N.G4, N.C5, N.E5].forEach((f) => tone(o, f, 0.5, 1.3, { type: 'triangle', v: 0.1, attack: 0.03 }));
    [N.G5, N.C6, N.E6].forEach((f, i) => tone(o, f, 0.62 + i * 0.1, 0.7, { type: 'sine', v: 0.07 }));
  },
};

export function sfx(name) {
  if (mode === 'off' || !SFX[name]) return;
  if (!ensure() || ctx.state !== 'running') return;
  try { SFX[name](sfxOut); } catch { /* 單一音效失敗不影響遊戲 */ }
}

// ---------- 背景音樂 ----------
// 八小節的和弦循環,慢板。每小節:柔和的長音鋪底、低音、加上隨機但固定種子的五聲音階旋律。
const BPM = 76;
const BEAT = 60 / BPM;
const BARS = [
  { pad: ['C4', 'E4', 'G4', 'B4'], bass: 'C3' },
  { pad: ['A3', 'C4', 'E4', 'G4'], bass: 'A2' },
  { pad: ['F3', 'A3', 'C4', 'E4'], bass: 'F3' },
  { pad: ['G3', 'B3', 'D4', 'G4'], bass: 'G3' },
  { pad: ['C4', 'E4', 'G4', 'B4'], bass: 'C3' },
  { pad: ['E3', 'G3', 'B3', 'D4'], bass: 'E3' },
  { pad: ['F3', 'A3', 'C4', 'E4'], bass: 'F3' },
  { pad: ['G3', 'B3', 'D4', 'G4'], bass: 'G3' },
];
const SCALE = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6'];
// 情境:calm 平常;tense 危機與命運(小調、低音每拍都有、旋律少);bright 結局(明亮、旋律多)
const TENSE_BARS = [
  { pad: ['A3', 'C4', 'E4'], bass: 'A2' },
  { pad: ['F3', 'A3', 'C4'], bass: 'F3' },
  { pad: ['D3', 'F3', 'A3'], bass: 'D3' },
  { pad: ['E3', 'Gs3', 'B3'], bass: 'E3' },
];
const BRIGHT_BARS = [
  { pad: ['C4', 'E4', 'G4'], bass: 'C3' },
  { pad: ['G3', 'B3', 'D4'], bass: 'G3' },
  { pad: ['A3', 'C4', 'E4'], bass: 'A2' },
  { pad: ['F3', 'A3', 'C4'], bass: 'F3' },
];
let mood = 'calm';
export function setMood(m) { if (m === 'calm' || m === 'tense' || m === 'bright') mood = m; }
let bar = 0;
let nextBar = 0;
let walk = 3;
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function scheduleBar(at) {
  const set = mood === 'tense' ? TENSE_BARS : mood === 'bright' ? BRIGHT_BARS : BARS;
  const b = set[bar % set.length];
  const t = at - ctx.currentTime;
  const len = BEAT * 4;
  b.pad.forEach((n) => tone(musicOut, N[n], t, len * 1.05, { type: 'sine', v: 0.05, attack: 0.5 }));
  if (mood === 'tense') {
    for (let k = 0; k < 4; k++) tone(musicOut, N[b.bass], t + BEAT * k, BEAT * 0.6, { type: 'triangle', v: k === 0 ? 0.1 : 0.07, attack: 0.01 });
  } else {
    tone(musicOut, N[b.bass], t, BEAT * 1.8, { type: 'triangle', v: 0.09, attack: 0.02 });
    tone(musicOut, N[b.bass], t + BEAT * 2, BEAT * 1.6, { type: 'triangle', v: 0.07, attack: 0.02 });
  }
  const dense = mood === 'bright' ? 0.2 : mood === 'tense' ? -0.25 : 0; // 旋律出現的機率加減
  for (let i = 0; i < 8; i++) {
    if (rnd() > (i % 2 === 0 ? 0.62 : 0.32) + dense) continue; // 正拍比較常出現
    walk = Math.max(0, Math.min(SCALE.length - 1, walk + Math.round(rnd() * 4 - 2)));
    tone(musicOut, N[SCALE[walk]], t + i * (BEAT / 2), BEAT * 1.4, { type: 'triangle', v: 0.06, attack: 0.01 });
  }
  bar += 1;
}

function pump() {
  if (!ctx || ctx.state !== 'running') return;
  if (nextBar < ctx.currentTime) nextBar = ctx.currentTime + 0.1;
  while (nextBar < ctx.currentTime + 1.2) {
    scheduleBar(nextBar);
    nextBar += BEAT * 4;
  }
}

function syncMusic() {
  if (!ctx) return;
  const on = mode === 'all';
  musicOut.gain.cancelScheduledValues(ctx.currentTime);
  musicOut.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, on ? 0.6 : 0.15);
  if (on && !timer) {
    timer = setInterval(pump, 250);
    pump();
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
  }
}

// App 切到背景或分頁被蓋住時停止出聲,回來再繼續
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (mode !== 'off') ctx.resume().then(pump).catch(() => {});
});
