// 畫面層:只負責顯示與操作,數值都交給 engine.js
import * as E from './engine.js';
import { pickPack } from './packs/index.js';
import * as SND from './audio.js';
import { drawCard, showCard } from './card.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const KEY = 'nextlife.save.v1';
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 存檔只放在這台裝置上,不會上傳
function load() {
  try {
    const t = localStorage.getItem(KEY);
    const d = t ? JSON.parse(t) : null;
    return d && d.v === 1 ? migrate(d) : null;
  } catch {
    return null;
  }
}
// 舊版存檔的事件卡類型是中文字,改成代碼;並補上國家包
function migrate(d) {
  const TYPES = { 機會: 'chance', 危機: 'crisis', 抉擇: 'choice' };
  if (d.last && TYPES[d.last.type]) d.last.type = TYPES[d.last.type];
  if (d.roll && TYPES[d.roll.type]) d.roll.type = TYPES[d.roll.type];
  if (!d.pack) d.pack = 'tw'; // 國家包上線前的存檔都是台灣版
  return d;
}
function save() {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* 無痕模式等情況下無法存檔,遊戲仍可進行 */
  }
}

// 人生圖鑑(跨局累積):和單局存檔分開放,開新的一局也不會清掉
const META_KEY = 'nextlife.meta.v1';
function loadMeta() {
  try {
    const d = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    return d && d.v === 1 ? { ...E.newMeta(), ...d } : E.newMeta();
  } catch {
    return E.newMeta();
  }
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* 無法存檔時略過 */ }
}

// 真實進度(回填對照):追蹤中的預測和回填紀錄,同樣只存在這台裝置上
const REAL_KEY = 'nextlife.real.v1';
function loadReal() {
  try {
    const d = JSON.parse(localStorage.getItem(REAL_KEY) || 'null');
    return d && d.v === 1 ? d : null;
  } catch {
    return null;
  }
}
function saveReal() {
  try {
    if (real) localStorage.setItem(REAL_KEY, JSON.stringify(real));
    else localStorage.removeItem(REAL_KEY);
  } catch { /* 無法存檔時略過 */ }
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / (365.25 * 86400000);

let s = load();
let meta = loadMeta();
let real = loadReal();
let realError = '';
// 國家包:有存檔就用存檔當時的那一包,否則依裝置語系挑
const P = E.usePack(pickPack(s && s.pack, navigator.languages || []));
const U = P.ui;
const T = P.t;
const QUIZZES = P.quizzes;
document.documentElement.lang = P.lang;
document.title = U.appName;
let view = 'home';
let draft = null;
let advice = null; // { key, data }:財務建議的計算結果(依起點快取)
let pen = null; // 退休金試算:{ from, years, self }
let lab = null;
// 還沒接上真正的廣告和 App 內購買,所以先關掉。
// 關掉時:「換一張事件卡」不用看廣告(每局次數不變),結局頁不顯示「進階功能」那一區。
// 不要在沒接好之前打開:假的廣告和按了沒反應的付費按鈕,送 App Store 審查會被當成未完成的功能退件。
const FEATURES = { ads: false, premium: false };
let checkFrom = null; // 財務健檢是從哪個畫面進來的
const GUIDE_KEY = 'nextlife.guide.v1'; // 看過使用說明了沒
let guideNext = false; // 使用說明是不是從「開始」進來的(是的話下面放「開始填資料」) // 組合試算:{ from, change: { expense, income, risk }, cache: {} }
let quiz = null; // { id, i, answers, picks, result };picks 是每題選了第幾個選項(返回上一題時標出來)
let formError = '';
let planPicks = []; // 年度計畫畫面目前勾選的習慣

const avatar = () => (s && s.profile.avatar) || 'm'; // 舊存檔沒有角色,預設第一個
// 角色立繪:mood 為 happy / sad 時換成對應姿勢,其餘用一般站姿
const charImg = (mood) => `img/char-${avatar()}${mood ? '-' + mood : ''}.png`;
const ENDING_MOOD = {
  bloom: 'happy', free: 'happy', ease: 'happy', saver: 'happy', top: 'happy', cozy: 'happy', family: 'happy', wellness: 'happy', founder: 'happy',
  debt: 'sad', burnout: 'sad', body: 'sad', regroup: 'sad',
};
const ACHS = E.achievements();
const ACH = Object.fromEntries(ACHS.map((a) => [a.id, a]));
const TALENTS = E.talents();
const round = (v) => Math.round(v);
// 震動回饋:iPhone 不支援 navigator.vibrate,包成 App 後改用 Capacitor 的 Haptics 外掛
const buzz = (ms) => {
  try {
    const haptics = window.Capacitor?.Plugins?.Haptics;
    if (haptics) haptics.impact({ style: ms > 20 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
    else navigator.vibrate?.(ms);
  } catch { /* 不支援震動的裝置略過 */ }
};

// 產生圖卡並顯示預覽。網頁版在頁尾放網址,包成 App 後沒有網址就不放
async function openCard(spec, filename) {
  const web = /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname);
  try {
    const canvas = await drawCard({ ...spec, note: U.card.note, appName: U.appName, url: web ? (location.host + location.pathname).replace(/\/$/, '') : '' });
    await showCard(canvas, filename, U.card, () => toast(U.card.fail));
  } catch {
    toast(U.card.fail);
  }
}

// 彩帶:成功、拿到成就、走到結局時從畫面上方灑下來
function burst(n = 26) {
  if (reduced) return;
  const colors = ['#ffb703', '#fb5607', '#3a86ff', '#06d6a0', '#ff5d8f', '#8338ec'];
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = Array.from({ length: n }, (_, i) => {
    const x = Math.round(Math.random() * 100);
    const dx = Math.round(Math.random() * 120 - 60);
    const d = (0.9 + Math.random() * 0.9).toFixed(2);
    const delay = (Math.random() * 0.35).toFixed(2);
    const r = Math.round(Math.random() * 720 - 360);
    return `<i style="left:${x}%;background:${colors[i % colors.length]};--dx:${dx}px;--r:${r}deg;animation-duration:${d}s;animation-delay:${delay}s"></i>`;
  }).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2400);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function render() {
  app.innerHTML = VIEWS[view]();
  window.scrollTo(0, 0);
  animate();
  if (view === 'fate') runFate();
  if (view === 'play' && s && s.last && app.querySelector('.ach')) {
    setTimeout(() => { SND.sfx('achieve'); burst(18); }, 450);
  }
}

// 數值條從舊值滑到新值,數字從舊值跳到新值
function animate() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    app.querySelectorAll('.fill[data-to]').forEach((el) => { el.style.width = el.dataset.to + '%'; });
  }));
  app.querySelectorAll('[data-count]').forEach((el) => {
    const a = +el.dataset.from, b = +el.dataset.to;
    const show = (v) => { el.textContent = el.dataset.count === 'money' ? E.fmt(v) : round(v); };
    if (reduced || a === b) return show(b);
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.max(0, Math.min(1, (t - t0) / 900)); // 影格時間可能早於 t0,不能讓進度變負
      show(a + (b - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => show(b), 1200); // 分頁在背景時動畫可能不跑,確保最後數字正確
  });
}

// ---------- 共用元件 ----------

function track(turn) {
  const dots = Array.from({ length: E.TOTAL_TURNS }, (_, i) => `<li class="${i < turn ? 'done' : i === turn ? 'now' : ''}"></li>`).join('');
  return `<ol class="track10" aria-label="${U.common.trackLabel(Math.min(turn + 1, E.TOTAL_TURNS), E.TOTAL_TURNS)}">${dots}</ol>`;
}

function bars(from) {
  const k = E.scores(s);
  const items = ['wealth', 'career', 'health', 'relation', 'mind'].map((key) => [T.attr[key], key]);
  return `<div class="bars">${items
    .map(([n, key]) => {
      const v = round(k[key]);
      const f = from ? round(from[key]) : v;
      const d = v - f;
      const delta = d ? `<i class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</i>` : '';
      return `<div class="bar"><span>${n}</span><span class="track"><span class="fill k-${key}" style="width:${f}%" data-to="${v}"></span></span><span class="v num ${v < 35 ? 'low' : ''}">${delta}<span data-count="int" data-from="${f}" data-to="${v}">${f}</span></span></div>`;
    })
    .join('')}</div>`;
}

// before:上一年結算前的數值,有傳的話會播放「舊值 → 新值」的動畫
function statusPanel(before) {
  const C = U.common;
  const chips = [P.industries[s.industry].name, U.status[s.status], s.house ? C.owner : C.renter, C.investType(P.risk[s.risk].name)];
  if (s.kids) chips.push(C.kids(s.kids));
  if (s.value) chips.push(T.values[s.value].name);
  if (s.money) chips.push(T.moneyTypes[s.money].name);
  if (s.coping) chips.push(T.coping[s.coping].name);
  if (T.talents[s.profile.talent]) chips.push(U.meta.talentChip(T.talents[s.profile.talent][0]));
  const net = E.netWorth(s);
  const from = before ? before.net : net;
  const age = before ? before.age : s.age;
  const turn = before ? before.turn : s.turn;
  return `${track(turn)}
  <section class="panel stack status">
    <div class="row"><h3>${C.yearHead(age, Math.min(turn + 1, E.TOTAL_TURNS), E.TOTAL_TURNS)}</h3><span class="small muted num">${C.incomeExpense(E.fmt(s.income), E.fmt(s.expense))}</span></div>
    <div class="who"><img class="face" src="img/token-${avatar()}.png" alt=""><div><div class="small muted">${C.netWorth}</div><div class="net num ${net < from ? 'down' : ''}" data-count="money" data-from="${from}" data-to="${net}">${E.fmt(from)}</div></div></div>
    ${bars(before && before.scores)}
    <div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>
    ${habitRow()}
  </section>`;
}

const levelPips = (lv) => `<span class="pips" aria-hidden="true">${Array.from({ length: E.HABIT_MAX },(_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</span>`;
// 五種習慣目前的等級,一排小圓點
function habitRow() {
  return `<div class="habitrow">${E.HABITS.map((id) => `<span><span>${T.habits[id].name}</span>${levelPips(E.habitLevel(s, id))}</span>`).join('')}</div>`;
}

const lineList = (lines) => `<ul class="lines">${lines.map((l, i) => `<li class="stagger ${l.tone || ''}" style="--i:${i}"><span>${l.text}</span></li>`).join('')}</ul>`;

function choiceHint(ch) {
  const e = ch.effect || {};
  const hints = [];
  if (e.chance) hints.push(U.common.hintChance(round(E.chanceOf(s, e.chance) * 100)));
  const cost = (e.cashMonths || 0) * s.income + (e.expMonths || 0) * s.expense;
  if (cost < 0) hints.push(U.common.hintCost(E.fmt(-cost)));
  if (cost > 0) hints.push(U.common.hintGain(E.fmt(cost)));
  return hints.length ? `<span class="hint">${hints.join(' · ')}</span>` : '';
}

// ---------- 各畫面 ----------

const VIEWS = {
  home() {
    const resume = s && !E.isOver(s);
    return `<div class="home">
      <div class="herowrap">
        <img class="hero" src="img/hero.jpg" width="900" height="1350" alt="${U.home.heroAlt}">
        <div class="herotitle"><span class="tag">${U.tagline}</span><h1>${U.appName}</h1></div>
      </div>
      <div class="sheet stack">
        <p class="muted">${U.home.intro}</p>
        ${resume ? `<button class="btn primary" data-act="resume">${U.home.resume(s.age)}</button>` : ''}
        <button class="btn ${resume ? '' : 'primary'}" data-act="new" style="text-align:center">${U.home.start}</button>
        ${real ? `<section class="panel stack">
          <h3>${U.real.title}</h3>
          <p class="small muted">${U.real.since(real.date, real.entries.length)}</p>
          <button class="btn" data-act="real" style="text-align:center">${U.real.open}</button>
        </section>` : ''}
        ${meta.runs ? `<section class="panel stack">
          <div class="row"><h3>${U.meta.title}</h3><span class="small muted num">${U.meta.summary(meta.runs, meta.best)}</span></div>
          ${metaChips()}
          <button class="btn" data-act="album" style="text-align:center">${U.meta.open}</button>
        </section>` : ''}
        <button class="btn ghost" data-act="guide" style="text-align:center">${U.guide.open}</button>
        <button class="btn ghost" data-act="sources" style="text-align:center">${U.sources.open}</button>
        <button class="btn ghost" data-act="policy" style="text-align:center">${U.policy.open}</button>
        <p class="small muted">${U.home.privacy}</p>
      </div>
    </div>`;
  },

  // 退休金試算:勞保年金 + 勞退專戶,可以調已工作年資和自願提繳
  pension() {
    const N = U.pension;
    const long = getLong();
    const p = P.pension(realProfile(), { years: pen.years, self: pen.self, need: pen.need, liBase: pen.liBase, pubSys: pen.pubSys, pubBase: pen.pubBase, own: long && { worst: long.main.last.p10, best: long.main.last.p90 } });
    const B = p.pub ? N.pub : null; // 軍公教用另一組說明文字
    const pubSeg = (k, vals, cur, label) => `<div class="seg">${vals.map((v) => `<button class="${cur === v ? 'on' : ''}" data-act="penPub" data-k="${k}" data-v="${v}" aria-pressed="${cur === v}">${label(v)}</button>`).join('')}</div>`;
    const seg = (p.pub ? [0, 0.03, p.selfMax] : [0, 0.03, 0.06]).map((v) => `<button class="${pen.self === v ? 'on' : ''}" data-act="penSelf" data-v="${v}" aria-pressed="${pen.self === v}">${N.selfOpt(v)}</button>`).join('');
    const needSeg = [0.7, 1, 1.2].map((v) => `<button class="${pen.need === v ? 'on' : ''}" data-act="penNeed" data-v="${v}" aria-pressed="${pen.need === v}">${N.needOpt(v)}</button>`).join('');
    const baseSeg = ['min', 'actual'].map((v) => `<button class="${p.liBase === v ? 'on' : ''}" data-act="penBase" data-v="${v}" aria-pressed="${p.liBase === v}">${N.liBaseOpt[v]}</button>`).join('');
    const G = p.gap;
    const hasLp = p.hi.account > 0.05;
    const owned = s.profile.house !== 'none';
    const lifeSeg = (k, vals) => `<div class="stack"><div class="small muted">${N.lifeLabel[k]}</div><div class="seg">${vals.map((v) => `<button class="${pen[k] === v ? 'on' : ''}" data-act="penLife" data-k="${k}" data-v="${v}" aria-pressed="${pen[k] === v}">${N.lifeOpt[k][v]}</button>`).join('')}</div></div>`;
    const rng = (a, b) => (E.fmt(a) === E.fmt(b) ? E.fmt(a) : N.range(E.fmt(Math.min(a, b)), E.fmt(Math.max(a, b))));
    const verdict = G.worst.short <= 0 ? ['up', N.gapOk]
      : p.left === 0 ? ['down', N.gapNoTime(E.fmt(G.best.short), E.fmt(G.worst.short))]
      : G.best.short <= 0 ? ['', N.gapMid(E.fmt(G.worst.short), E.fmt(G.worst.saveMore))]
      : ['down', N.gapBad(E.fmt(G.best.short), E.fmt(G.worst.short), E.fmt(G.best.saveMore), E.fmt(G.worst.saveMore))];
    return `<h2>${N.title}</h2>
    <p class="muted small">${B ? B.intro : N.intro}</p>
    <section class="panel stack ending">
      <p class="muted small">${N.totalTitle}</p>
      <div class="title range num">${rng(p.lo.total, p.hi.total)}</div>
      ${hasLp ? `<p class="small muted">${B ? B.rangeNote : N.rangeNote}</p>` : ''}
      <p><b>${N.replace(Math.round(p.lo.replace * 100), Math.round(p.hi.replace * 100), E.fmt(p.finalWage))}</b><br><span class="small muted">${N.replaceNote}</span></p>
    </section>
    <section class="panel stack">
      <ul class="lines">
        ${!B ? `<li><span>${N.liRow}<br><span class="small muted">${N.liNote(E.fmt(p.liWage), Math.round(p.liYears))}</span></span><span class="num">${E.fmt(p.li)}</span></li>`
          : p.pub.sys === 'db' ? `<li><span>${B.dbRow}<br><span class="small muted">${B.dbNote(E.fmt(p.pub.base2), Math.round(p.pub.rate * 1000) / 10)}</span></span><span class="num">${E.fmt(p.li)}</span></li>`
          : `<li><span>${B.insRow}<br><span class="small muted">${B.insNote(E.fmt(p.liWage), Math.round(p.pub.insYears))}</span></span><span class="num">${E.fmt(p.li)}</span></li>`}
        ${hasLp ? `<li><span>${B ? B.lpRow : N.lpRow}<br><span class="small muted">${N.lpNote(E.fmt(p.lo.account), E.fmt(p.hi.account), p.payYears)}</span></span><span class="num">${rng(p.lo.lp, p.hi.lp)}</span></li>` : ''}
        ${p.hi.now > 0 ? `<li class="small muted"><span>${B ? B.nowRow : N.nowRow}</span><span class="num">${N.range(E.fmt(p.lo.now), E.fmt(p.hi.now))}</span></li>` : ''}
        ${hasLp && p.lo.at10 != null ? `<li class="small muted"><span>${N.at10Row}</span><span class="num">${N.range(E.fmt(p.lo.at10), E.fmt(p.hi.at10))}</span></li>` : ''}
      </ul>
      ${hasLp ? `<p class="small muted">${(B ? B.lpFlat : N.lpFlat)(E.fmt(p.lo.lpFirst), E.fmt(p.hi.lpFirst))}</p>` : ''}
      ${B && p.pub.sys === 'db' ? `<p class="small muted">${p.pub.short ? B.dbShort : B.dbCap}</p>` : ''}
      ${B ? `<div class="stack"><div class="small muted">${B.sysLabel}</div>${pubSeg('pubSys', ['db', 'dc'], p.pub.sys, (v) => B.sysOpt[v])}</div>
      <div class="stack"><div class="small muted">${B.baseLabel}</div>${pubSeg('pubBase', P.pensionRules.pubBaseOpts, p.pub.share, B.baseOpt)}</div>
      <p class="small muted">${B.baseNote}</p>` : ''}
      ${p.free ? `<div class="stack"><div class="small muted">${N.liBaseLabel}</div><div class="seg">${baseSeg}</div></div><p class="small muted">${N.freeNote}</p>` : ''}
    </section>
    <section class="panel stack">
      <h3>${N.gapTitle}</h3>
      <div class="stack"><div class="small muted">${N.needLabel}</div><div class="seg">${needSeg}</div></div>
      <ul class="lines">
        <li><span>${N.needRow}</span><span class="num">${E.fmt(G.need)}</span></li>
        <li><span>${B ? B.gotRow : N.gotRow}</span><span class="num">${rng(p.lo.total, p.hi.total)}</span></li>
        ${p.spouse ? `<li><span>${N.spouseRow}</span><span class="num">${rng(p.spouse.lo, p.spouse.hi)}</span></li>` : ''}
        <li><span>${N.gapRow}</span><span class="num">${G.worst.monthly <= 0 ? N.gapNone : rng(G.best.monthly, G.worst.monthly)}</span></li>
        ${G.worst.monthly > 0 ? `<li><span>${N.lumpRow(p.planAge)}</span><span class="num">${rng(G.best.lump, G.worst.lump)}</span></li>
        <li><span>${N.ownRow}</span><span class="num">${rng(G.worst.own, G.best.own)}</span></li>` : ''}
      </ul>
      <p class="${verdict[0]}"><b>${verdict[1]}</b></p>
      ${G.surplus < 0 ? `<p class="small down">${N.surplusNeg}</p>` : ''}
      <p class="small muted">${!B ? N.gapNote : p.pub.sys === 'db' ? B.gapNoteDb : B.gapNote}</p>
      ${p.spouse ? `<p class="small muted">${N.spouseNote}</p>` : ''}
    </section>
    ${long && long.main.years > 0 ? `<section class="panel stack">
      <h3>${N.longTitle(P.pensionRules.claimAge)}</h3>
      ${longChart(long.main)}
      <div class="row small muted"><span>${N.longAxis(s.profile.age, P.pensionRules.claimAge)[0]}</span><span>${N.longAxis(s.profile.age, P.pensionRules.claimAge)[1]}</span></div>
      <div class="title range num">${rng(long.main.last.p10, long.main.last.p90)}</div>
      <p class="small muted">${N.longMid(E.fmt(long.main.last.p50))}</p>
      ${owned ? `<p class="small muted">${N.lifeOwned}</p>` : lifeSeg('house', ['no', 'buy'])}
      ${lifeSeg('kid', ['no', 'yes'])}
      ${!owned && pen.house === 'buy' ? `<p class="small">${long.main.bought > 0 ? N.lifeBought(Math.round(long.main.bought * 100), E.fmt(long.main.equity)) : N.lifeNever}</p>` : ''}
      ${pen.kid === 'yes' ? `<p class="small muted">${N.lifeKid(E.fmt(kidCostOf()), P.econ.kidYears)}</p>` : ''}
      <p class="small muted">${N.longNote}</p>
      <p class="small muted">${N.longHist(E.fmt(long.hist.last.p50))}</p>
    </section>` : ''}
    <section class="panel stack">
      <div class="row"><span>${N.yearsLabel}</span>
        <span class="stepper"><button data-act="penYears" data-d="-1" aria-label="−1">−</button><b class="num">${N.yearsValue(p.worked)}</b><button data-act="penYears" data-d="1" aria-label="+1">+</button></span></div>
      ${p.selfMax > 0 ? `<div class="stack"><div class="small muted">${B ? B.selfLabel : N.selfLabel}</div><div class="seg">${seg}</div></div>` : ''}
      ${p.self > 0 ? `<p><b>${N.selfLine(E.fmt(p.selfCost), E.fmt(p.lo.extraMonthly), E.fmt(p.hi.extraMonthly))}</b></p><p class="small muted">${p.taxSaved > 0.005 ? N.selfTax(E.fmt(p.taxSaved)) : N.selfTaxNone}</p>` : ''}
    </section>
    <section class="panel stack">
      <h3>${N.caveatTitle}</h3>
      <ul class="small muted plain">${(B ? B.caveats : N.caveats).map((c) => `<li>${c}</li>`).join('')}</ul>
    </section>
    <p class="small muted">${U.advice.disclaimer}</p>
    <button class="btn primary" data-act="cardPension">${U.card.save}</button>
    <button class="btn" data-act="penBack" style="text-align:center">${N.back}</button>`;
  },

  // 組合試算:支出、收入、投資配置各選一檔,看十年後的範圍和現在的做法差多少
  lab() {
    const A = U.advice;
    const p = s.profile;
    const c = lab.change;
    const base = labResult({ expense: 0, income: 0, risk: p.risk, house: 'auto', kid: 'auto' });
    const cur = labResult(c);
    const same = c.expense === 0 && c.income === 0 && c.risk === p.risk && c.house === 'auto' && c.kid === 'auto';
    const owned = p.house !== 'none';
    const start = E.newGame(E.applyChange(realProfile(), c), 1); // 只用來算這個組合的房價
    const kidCost = P.cards.find((card) => card.id === P.decisions.kid.card).choices[P.decisions.kid.yes].effect.expenseAbs;
    const np = E.applyChange(p, c);
    const group = (k) => `<div class="stack"><div class="small muted">${A.group[k]}</div>
      <div class="seg">${E.LEVERS[k].map((v) => {
        const label = typeof A.opt[k] === 'function' ? A.opt[k](v) : A.opt[k][v];
        const isNow = k === 'risk' && v === p.risk;
        return `<button class="${c[k] === v ? 'on' : ''}" data-act="labSet" data-k="${k}" data-v="${v}" aria-pressed="${c[k] === v}">${label}${isNow ? `<small>${A.now}</small>` : ''}</button>`;
      }).join('')}</div></div>`;
    const row = (label, r) => `<li><span>${label}</span><span class="num">${A.range(E.fmt(r.p10), E.fmt(r.p90))}<br><span class="small muted">${A.mid(E.fmt(r.p50))}</span></span></li>`;
    return `<h2>${A.labTitle}</h2>
    <p class="muted small">${A.labIntro}</p>
    <section class="panel stack">
      ${group('expense')}${group('income')}${group('risk')}
      <p class="small muted num">${A.monthly(E.fmt(np.income), E.fmt(np.expense))}</p>
    </section>
    <section class="panel stack">
      <h3>${A.lifeTitle}</h3>
      ${owned ? `<p class="small muted">${A.owned}</p>` : group('house')}${group('kid')}
      <p class="small muted">${A.autoNote}</p>
      ${!owned && c.house === 'buy' ? `<p class="small muted">${A.houseNote(E.fmt(E.housePrice(start)), E.fmt(E.downPayment(start)), P.econ.loanYears)}</p>` : ''}
      ${c.kid === 'yes' ? `<p class="small muted">${A.kidNote(E.fmt(kidCost))}</p>` : ''}
    </section>
    <section class="panel stack">
      <h3>${A.resultTitle}</h3>
      ${labChart(base, cur)}
      <ul class="lines">${row(A.baseRow, base)}${same ? '' : row(A.newRow, cur)}
        ${same ? '' : `<li class="small muted"><span>${A.liquidRow}</span><span class="num">${E.fmt(cur.liquid50)}</span></li>`}</ul>
      <p><b>${same ? A.same : A.diff(signed(cur.p50 - base.p50), signed(cur.p10 - base.p10))}</b></p>
      ${cur.neg >= 0.05 ? `<p class="small down">${A.negLine(Math.round(cur.neg * 100))}</p>` : ''}
      ${!owned && c.house === 'buy' ? `<p class="small">${cur.bought > 0 ? A.boughtLine(Math.round(cur.bought * 100)) : A.neverBought}</p><p class="small muted">${A.houseCaveat}</p>` : ''}
    </section>
    <p class="small muted">${A.disclaimer}</p>
    <button class="btn" data-act="labBack" style="text-align:center">${A.back}</button>`;
  },

  // 真實進度:當初的預測範圍,和回填的實際數字
  real() {
    const R = U.real;
    const last = real.entries[real.entries.length - 1];
    const d = last || { savings: real.start, income: real.profile.income, expense: real.profile.expense };
    const rows = real.entries.map((e) => {
      const v = realVerdict(e);
      return `<li class="stack"><div class="row"><b class="num">${e.date}</b><span class="small muted">${R.elapsed(v.t)}</span></div>
        <div><b>${R.actual(E.fmt(e.savings))}</b> <i class="verdict ${v.cls}">${R[v.key]}</i></div>
        <div class="small muted">${R.expected(E.fmt(v.x.p10), E.fmt(v.x.p90), E.fmt(v.x.p50))} · ${R.vsMid((e.savings >= v.x.p50 ? '+' : '−') + E.fmt(Math.abs(e.savings - v.x.p50)))}</div>
        ${v.t < 0.25 ? `<div class="small muted">${R.short}</div>` : ''}</li>`;
    }).reverse().join('');
    const hits = real.entries.filter((e) => realVerdict(e).key === 'inside').length;
    return `<h2>${R.title}</h2>
    <p class="muted small">${R.intro}</p>
    <section class="panel stack">
      ${realChart()}
      <p class="small muted">${R.startLine(real.date, E.fmt(real.start))}</p>
    </section>
    <form id="checkin" class="stack" novalidate>
      <section class="panel stack">
        <h3>${R.formTitle}</h3>
        <label>${R.date}<input type="date" name="date" value="${today()}" min="${real.date}"></label>
        <label>${R.savings}<input type="number" name="savings" inputmode="decimal" step="1" min="0" value="${Math.round(d.savings)}"></label>
        <div class="grid2">
          <label>${R.income}<input type="number" name="income" inputmode="decimal" step="0.1" min="0" value="${d.income}"></label>
          <label>${R.expense}<input type="number" name="expense" inputmode="decimal" step="0.1" min="0" value="${d.expense}"></label>
        </div>
        ${realError ? `<p class="error" role="alert">${realError}</p>` : ''}
        <button class="btn primary" type="submit">${R.submit}</button>
      </section>
    </form>
    <section class="panel stack">
      <h3>${R.entriesTitle}</h3>
      ${rows ? `<ul class="entries">${rows}</ul><p class="small muted">${R.hitRate(hits, real.entries.length)}</p>` : `<p class="small muted">${R.none}</p>`}
    </section>
    ${last && last.next ? `<section class="panel stack">
      <h3>${R.reTitle}</h3>
      <p>${R.reLine(E.fmt(last.next.p10), E.fmt(last.next.p90), E.fmt(last.next.p50))}</p>
    </section>` : ''}
    <p class="small muted">${R.privacy}</p>
    <button class="btn primary" data-act="home">${R.back}</button>
    <button class="btn ghost" data-act="untrack" style="text-align:center">${R.remove}</button>`;
  },

  // 財務健檢:現在的體質、行動順序、壓力測試、到 65 歲的現金流
  checkup() {
    const K = U.checkup;
    const B = P.econ.checkup;
    const prof = realProfile();
    const h = E.health(prof);
    const long = longOf();
    const rs = retireSummary();
    const pc = (v) => Math.round(v * 100);
    const m1 = (v) => Math.round(Math.min(v, 99) * 10) / 10;
    const badge = (t) => (t ? `<span class="tag2 ${t === 'mid' ? '' : t}">${t === 'up' ? K.ok : t === 'mid' ? K.mid : K.low}</span>` : '');
    const G = rs ? rs.p.gap : null;

    // ---- 六個指標:[名稱, 數值, 燈號, 說明] ----
    const ratios = [];
    const saveT = h.saveRate >= B.saveGood ? 'up' : h.saveRate >= B.saveOk ? 'mid' : 'down';
    ratios.push([K.ratio.save[0], K.ratio.save[1](pc(h.saveRate)), saveT, K.ratio.save[2](pc(B.saveGood), pc(B.saveOk))]);
    const cashT = h.cashMonths >= B.cashGood ? 'up' : h.cashMonths >= B.cashOk ? 'mid' : 'down';
    ratios.push([K.ratio.cash[0], K.ratio.cash[1](m1(h.cashMonths)), cashT, K.ratio.cash[2](B.cashGood, B.cashOk)]);
    ratios.push(h.loanYear > 0
      ? [K.ratio.loan[0], K.ratio.loan[1](pc(h.loanBurden)), h.loanBurden <= B.loanMax ? 'up' : 'down', K.ratio.loan[2](pc(B.loanMax)), false, h.loanBurden <= B.loanMax ? K.normal : K.high]
      : [K.ratio.loan[0], K.ratio.loanNone, '', K.ratio.loan[2](pc(B.loanMax))]);
    if (G) {
      const t = G.worst.short <= 0 ? 'up' : G.best.short <= 0 ? 'mid' : 'down';
      ratios.push([K.ratio.retire[0], t === 'up' ? K.ratio.retireOk : t === 'mid' ? K.ratio.retireMid : K.ratio.retireBad, t === 'mid' ? 'mid' : t, K.ratio.retire[2], true]);
    }
    ratios.push([K.ratio.stock[0], K.ratio.stock[1](pc(h.stockShare)), '', K.ratio.stock[2](Math.max(0, B.stockRule - prof.age))]);
    let fiAge = null;
    if (long) long.main.band.some((b, t) => (b.p50 >= long.main.flow[t].spend * B.fiMultiple ? ((fiAge = prof.age + t + 1), true) : false));
    ratios.push([K.ratio.fi[0], K.ratio.fi[1](pc(h.fiProgress)), '', `${K.ratio.fi[2](E.fmt(h.fiNumber), B.fiMultiple)}${long && long.main.years > 0 ? (fiAge ? K.ratio.fiAge(fiAge) : K.ratio.fiNever) : ''}`]);

    // ---- 行動順序:[燈號, 文字] ----
    const S = K.step;
    const steps = [];
    steps.push(h.surplus < 0 ? ['down', S.flowBad(E.fmt(-h.surplus), E.fmt(-h.surplus / 12))] : ['up', S.flowOk(E.fmt(h.surplus), pc(h.saveRate))]);
    const highDebt = h.debt && h.debt.rate >= B.debtHigh;
    const debtStep = () => {
      const d = h.debt;
      const rate = Math.round(d.rate * 1000) / 10;
      const now = E.debtPayoff(d.balance, d.rate, d.pay);
      if (!Number.isFinite(now.months)) return ['down', S.debtStuck(rate, E.fmt(d.balance), E.fmt(d.interestYear), E.fmt(d.pay * 12))];
      if (!highDebt) return ['', S.debtLow(rate, S.debtMonths(now.months))];
      const extra = Math.max(0.5, Math.round(d.pay * 0.5 * 10) / 10); // 多還的金額:現在還款的一半,至少 0.5 萬
      const fast = E.debtPayoff(d.balance, d.rate, d.pay + extra);
      const faster = now.months - fast.months >= 1 ? ' ' + S.debtFaster(E.fmt(extra), now.months - fast.months, E.fmt(now.interest - fast.interest)) : '';
      const spare = Math.min(d.balance, h.cash - (h.spend / 12) * B.cashOk); // 預備金以外多出來的現金
      const useCash = spare >= 1 ? ' ' + S.debtUseCash(E.fmt(spare)) : '';
      return ['down', S.debtHigh(rate, E.fmt(d.balance), E.fmt(d.interestYear), S.debtMonths(now.months), E.fmt(now.interest)) + faster + useCash];
    };
    if (highDebt) steps.push(debtStep());
    const monthSpend = h.spend / 12;
    if (h.cashMonths < B.cashOk) {
      const need = monthSpend * B.cashOk - h.cash;
      steps.push(['down', h.surplus > 0 ? S.cashLow(m1(h.cashMonths), E.fmt(need), Math.ceil(need / (h.surplus / 12))) : S.cashLowStuck(m1(h.cashMonths), E.fmt(need))]);
    } else if (h.cashMonths < B.cashGood) {
      steps.push(['', S.cashMid(m1(h.cashMonths), E.fmt(monthSpend * B.cashGood - h.cash))]);
    } else {
      steps.push(['up', (highDebt ? S.cashOkDebt : S.cashOk)(m1(h.cashMonths))]);
    }
    if (h.loanYear > 0) steps.push(h.loanBurden > B.loanMax ? ['down', S.loanHigh(pc(h.loanBurden), pc(B.loanMax))] : ['up', S.loanOk(pc(h.loanBurden))]);
    if (h.debt && !highDebt) steps.push(debtStep());
    if (rs && rs.self.selfMax > 0 && rs.p.left > 0) {
      const sp = rs.self;
      steps.push(highDebt ? ['', S.selfWaitDebt] : h.cashMonths >= B.cashOk && h.surplus > sp.selfCost * 12
        ? ['', S.selfDo(E.fmt(sp.selfCost), E.fmt(sp.lo.extraMonthly), E.fmt(sp.hi.extraMonthly), sp.taxSaved > 0.005 ? S.selfTax(E.fmt(sp.taxSaved)) : '')]
        : ['', h.cashMonths < B.cashOk ? S.selfWait : S.selfWaitFlow]);
    }
    if (G) {
      steps.push(G.worst.short <= 0 ? ['up', S.gapOk]
        : G.best.short <= 0 ? ['', S.gapMid(E.fmt(G.worst.saveMore))]
        : ['down', S.gapBad(E.fmt(G.best.saveMore), E.fmt(G.worst.saveMore))]);
    }
    steps.push(h.stockShare > 0 && h.invest > 0 ? ['', S.stock(pc(h.stockShare), E.fmt(h.invest * -B.worstYear))] : ['', S.stockNone]);
    steps.push(['', S.insure]);

    // ---- 壓力測試與現金流 ----
    const st = long && long.main.years > 0 ? stressOf() : null;
    const yrs = long ? long.main.years : 0;
    const at10 = (r) => r.band[Math.min(9, r.band.length - 1)].p50;
    const diff = (v, base) => (Math.abs(v - base) < 0.05 ? '' : `<br><span class="small ${v < base ? 'down' : 'up'}">${signed(v - base)}</span>`);
    const stressRow = (label, r) => `<tr><td>${label}</td>${yrs > 10 ? `<td>${E.fmt(at10(r))}${r === st.base ? '' : diff(at10(r), at10(st.base))}</td>` : ''}<td>${E.fmt(r.last.p50)}${r === st.base ? '' : diff(r.last.p50, st.base.last.p50)}</td></tr>`;
    const ts = [];
    for (let t = 0; t < yrs; t += 5) ts.push(t);
    if (yrs > 0 && ts[ts.length - 1] !== yrs - 1) ts.push(yrs - 1);
    const line = (label, v, cls = '') => `<li><span>${label}</span><span class="num ${cls}">${v}</span></li>`;
    // 大環境情境
    const tr = st ? trendsOf() : null;
    const pp = (v) => Math.round(Math.abs(v) * 1000) / 10;
    let worst = null;
    if (tr) tr.rows.forEach((x) => { if (!worst || x.r.last.p50 < worst.r.last.p50) worst = x; });
    const worstLoss = worst ? st.base.last.p50 - worst.r.last.p50 : 0;

    return `<h2>${K.title}</h2>
    <p class="muted small">${K.intro}</p>
    <section class="panel stack">
      <h3>${K.nowTitle}</h3>
      <ul class="lines">
        ${line(K.rows.gross, E.fmt(h.gross))}
        ${line(K.rows.withheld, '−' + E.fmt(h.withheld))}
        ${line(K.rows.net, E.fmt(h.net))}
        ${line(K.rows.spend, '−' + E.fmt(h.spend))}
        ${line(`<b>${K.rows.surplus}</b>`, `<b>${E.fmt(h.surplus)}</b>`, h.surplus < 0 ? 'down' : 'up')}
      </ul>
      <h3>${K.sheetTitle}</h3>
      <ul class="lines">
        ${line(K.sheet.liquid, E.fmt(h.liquid))}
        ${h.houseValue > 0 ? line(K.sheet.house, E.fmt(h.houseValue)) : ''}
        ${h.loanBalance > 0 ? line(K.sheet.loan, '−' + E.fmt(h.loanBalance)) : ''}
        ${h.debt ? line(K.sheet.debt(Math.round(h.debt.rate * 1000) / 10), '−' + E.fmt(h.debt.balance), 'down') : ''}
        ${line(`<b>${K.sheet.net}</b>`, `<b>${E.fmt(h.netWorth)}</b>`)}
      </ul>
    </section>
    <section class="panel stack">
      <h3>${K.ratioTitle}</h3>
      <ul class="ratios">${ratios.map(([name, value, t, note, wordOnly, word]) => `<li>
        <div class="row"><b>${name}</b><span class="num">${wordOnly ? '' : `<b>${value}</b> `}${wordOnly || word ? `<span class="tag2 ${t === 'mid' ? '' : t}">${word || value}</span>` : badge(t)}</span></div>
        <span class="small muted">${note}</span></li>`).join('')}</ul>
    </section>
    <section class="panel stack">
      <h3>${K.stepsTitle}</h3>
      <p class="small muted">${K.stepsIntro}</p>
      <ol class="todo">${steps.map(([t, text], i) => `<li><span class="stepno num ${t}">${i + 1}</span><span>${text}</span></li>`).join('')}</ol>
    </section>
    ${tr ? `<section class="panel stack">
      <h3>${K.trendTitle}</h3>
      <p class="small muted">${K.trendIntro}</p>
      <div class="scrollx"><table class="ftable">
        <thead><tr><th>${K.trendCols[0]}</th>${yrs > 10 ? `<th>${K.trendCols[1]}</th>` : ''}<th>${K.trendCols[2]}</th></tr></thead>
        <tbody>${stressRow(K.stress.base, st.base)}${tr.rows.map((x) => stressRow(K.trend[x.id][0], x.r)).join('')}</tbody>
      </table></div>
      <ul class="plain small muted">${tr.rows.map((x) => `<li><b>${K.trend[x.id][0]}</b>:${K.trend[x.id][1](pp(x.trend.growth))}</li>`).join('')}</ul>
      <p class="small muted">${tr.size === 'big' ? K.trendDirect : K.trendIndirect}</p>
      ${worst && worstLoss > 0.5 ? `<p><b>${K.trendWorst(K.trend[worst.id][0], E.fmt(worstLoss))}</b>${K.trendTips[worst.id] ? `<br><span class="small">${K.trendTips[worst.id]}</span>` : ''}</p>` : ''}
      <p class="small muted">${K.trendBasis}</p>
    </section>` : ''}
    ${st ? `<section class="panel stack">
      <h3>${K.stressTitle}</h3>
      <p class="small muted">${K.stressIntro}</p>
      <div class="scrollx"><table class="ftable">
        <thead><tr><th>${K.stressCols[0]}</th>${yrs > 10 ? `<th>${K.stressCols[1]}</th>` : ''}<th>${K.stressCols[2]}</th></tr></thead>
        <tbody>${stressRow(K.stress.base, st.base)}${stressRow(K.stress.crash, st.crash)}${stressRow(K.stress.job, st.job)}${stressRow(K.stress.cost, st.cost)}</tbody>
      </table></div>
      <p class="small muted">${K.stressNote}</p>
    </section>
    <section class="panel stack">
      <h3>${K.flowTitle}</h3>
      <p class="small muted">${K.flowIntro}</p>
      <div class="scrollx"><table class="ftable">
        <thead><tr>${K.flowCols.map((c) => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${ts.map((t) => {
          const f = long.main.flow[t];
          return `<tr><td>${prof.age + t}</td><td>${E.fmt(f.income)}</td><td>${E.fmt(f.withheld)}</td><td>${E.fmt(f.spend)}</td><td class="${f.surplus < 0 ? 'down' : ''}">${E.fmt(f.surplus)}</td><td>${E.fmt(long.main.band[t].p50)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="small muted">${K.flowNote}</p>
    </section>` : ''}
    <p class="small muted">${K.disclaimer}</p>
    <button class="btn" data-act="lab" style="text-align:center">${U.advice.open}</button>
    ${P.pension ? `<button class="btn" data-act="pension" style="text-align:center">${U.pension.open}</button>` : ''}
    <button class="btn primary" data-act="checkBack" style="text-align:center">${K.back}</button>`;
  },

  // 使用說明:第一次按「開始」時先看一次,之後從首頁也能再打開
  guide() {
    const G = U.guide;
    return `<h2>${G.title}</h2>
    <p class="muted">${G.lead}</p>
    <ol class="steps">${G.steps.map(([h, d], i) => `<li class="panel"><span class="stepno num">${i + 1}</span><div class="stack"><b>${h}</b><span class="small muted">${d}</span></div></li>`).join('')}</ol>
    <p class="small muted">${G.extra}</p>
    <p class="small muted">${G.note}</p>
    ${guideNext ? `<button class="btn primary" data-act="guideGo" style="text-align:center">${G.start}</button>` : ''}
    <button class="btn ${guideNext ? 'ghost' : 'primary'}" data-act="home" style="text-align:center">${G.back}</button>`;
  },

  // 隱私權政策:資料只存在裝置上,並提供一鍵清除
  policy() {
    const Y = U.policy;
    return `<h2>${Y.title}</h2>
    <p class="muted small">${Y.updated}</p>
    ${Y.sections.map(([h, items]) => `<section class="panel stack">
      <h3>${h}</h3>
      <ul class="plain">${items.map((x) => `<li>${x}</li>`).join('')}</ul>
    </section>`).join('')}
    <button class="btn ghost" data-act="wipe" style="text-align:center">${Y.wipe}</button>
    <button class="btn primary" data-act="home">${Y.back}</button>`;
  },

  // 資料來源:每個數字的出處與期間,以及還沒有統計依據的項目
  sources() {
    const S = U.sources;
    return `<h2>${S.title}</h2>
    <p class="muted small">${S.intro}</p>
    ${P.sources.map(([what, value, from, period, url]) => `<section class="panel stack">
      <h3>${what}</h3>
      <p>${S.used(value)}</p>
      <p class="small muted">${from}<br>${S.period(period)}<br><a href="${url}" target="_blank" rel="noopener">${url}</a></p>
    </section>`).join('')}
    <section class="panel stack">
      <h3>${S.assumeTitle}</h3>
      <p class="small muted">${S.assumeIntro}</p>
      <ul class="lines small">${P.assumptions.map((x) => `<li><span>${x}</span></li>`).join('')}</ul>
    </section>
    <p class="small muted">${S.license} <a href="https://data.gov.tw/license" target="_blank" rel="noopener">data.gov.tw/license</a></p>
    <button class="btn primary" data-act="home">${S.back}</button>`;
  },

  album() {
    const M = U.meta;
    const cell = (on, name, desc) => `<li class="${on ? 'on' : ''}"><b>${name}</b><span>${desc}</span></li>`;
    return `<h2>${M.title}</h2>
    <p class="muted small">${M.intro}</p>
    <section class="panel stack">
      <div class="row"><h3>${M.summary(meta.runs, meta.best)}</h3></div>
      ${metaChips()}
    </section>
    <section class="panel stack">
      <h3>${M.talents}</h3>
      <ul class="achgrid">${TALENTS.map((a) => cell(E.talentUnlocked(meta, a.id), a.name, E.talentUnlocked(meta, a.id) ? a.effect : `${a.effect} · ${M.need(a.need)}`)).join('')}</ul>
    </section>
    <section class="panel stack">
      <h3>${M.endings}</h3>
      <ul class="achgrid">${Object.entries(T.endings).map(([id, [title, text]]) => (meta.endings[id] ? cell(true, title, `${text} ${M.times(meta.endings[id])}`) : cell(false, M.unknown, ''))).join('')}</ul>
    </section>
    <section class="panel stack">
      <h3>${M.ach}</h3>
      <ul class="achgrid">${ACHS.map((a) => cell(meta.ach[a.id], a.name, a.desc)).join('')}</ul>
    </section>
    <button class="btn primary" data-act="home">${M.back}</button>`;
  },

  create() {
    const d = draft;
    const C = U.create;
    const F = P.form;
    const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.name || v}</option>`).join('');
    const rate = (name, [label, lo, hi] = C.rate[name]) => `<label>${label}
      <input type="range" name="${name}" min="1" max="5" step="1" value="${d[name]}">
      <span class="rate"><span>${lo}</span><span>${hi}</span></span></label>`;
    return `<h2>${C.title}</h2>
    <p class="muted small">${C.unitNote}</p>
    <form id="create" class="stack" novalidate>
      <fieldset class="pick">
        <legend>${C.pickAvatar}</legend>
        ${Object.entries(U.avatars).map(([k, name]) => `<label class="pickcard"><input type="radio" name="avatar" value="${k}" ${d.avatar === k ? 'checked' : ''}><img src="img/char-${k}.png" alt=""><span>${name}</span></label>`).join('')}
      </fieldset>
      <section class="panel stack">
        <div class="grid2">
          <label>${C.age}<input type="number" name="age" inputmode="numeric" min="18" max="60" value="${d.age}"></label>
          <label>${C.industry}<select name="industry">${opt(P.industries, d.industry)}</select></label>
        </div>
        <div class="grid2">
          <label>${C.income}<input type="number" name="income" inputmode="decimal" step="${F.income.step}" min="${F.income.min}" value="${d.income}"></label>
          <label>${C.expense}<input type="number" name="expense" inputmode="decimal" step="${F.expense.step}" min="${F.expense.min}" value="${d.expense}"></label>
        </div>
        <label>${C.savings}<input type="number" name="savings" inputmode="decimal" step="${F.savings.step}" min="${F.savings.min}" value="${d.savings}"></label>
        <div class="small muted" style="font-weight:700">${C.debtTitle}</div>
        <div class="grid3">
          <label>${C.debt}<input type="number" name="debt" inputmode="decimal" step="1" min="0" value="${d.debt || 0}"></label>
          <label>${C.debtRate}<input type="number" name="debtRate" inputmode="decimal" step="0.1" min="0" max="20" value="${d.debtRate ?? 6}"></label>
          <label>${C.debtPay}<input type="number" name="debtPay" inputmode="decimal" step="0.1" min="0" value="${d.debtPay || 0}"></label>
        </div>
        <p class="small muted">${C.debtNote}</p>
        <label>${C.spouseIncome}<input type="number" name="spouseIncome" inputmode="decimal" step="${F.income.step}" min="0" value="${d.spouseIncome || 0}"></label>
        <p class="small muted">${C.spouseNote}</p>
        <label>${C.county}<select name="county">${opt(C.counties, d.county)}</select></label>
        <div class="grid2">
          <label>${C.status}<select name="status">${opt(U.status, d.status)}</select></label>
          <label>${C.house}<select name="house">${opt(C.houseOpts, d.house)}</select></label>
        </div>
      </section>
      <section class="panel stack">
        <h3>${C.feel}</h3>
        ${rate('rCareer')}
        ${rate('rHealth')}
        ${rate('rRelation')}
        ${rate('rMind')}
      </section>
      ${TALENTS.some((a) => E.talentUnlocked(meta, a.id)) ? `<section class="panel stack">
        <h3>${U.meta.pickTitle}</h3>
        <label><select name="talent">
          <option value="">${U.meta.none}</option>
          ${TALENTS.filter((a) => E.talentUnlocked(meta, a.id)).map((a) => `<option value="${a.id}" ${d.talent === a.id ? 'selected' : ''}>${a.name}:${a.effect}</option>`).join('')}
        </select></label>
        <p class="small muted">${U.meta.pickNote}</p>
      </section>` : ''}
      ${formError ? `<p class="error" role="alert">${formError}</p>` : ''}
      <button class="btn primary" type="submit">${C.next}</button>
      <button class="btn ghost" type="button" data-act="home">${C.back}</button>
    </form>`;
  },

  quiz() {
    const Q = QUIZZES[quiz.id];
    const item = Q.questions[quiz.i];
    return `<h3>${Q.title}</h3>
    <div class="progress"><i style="width:${(quiz.i / Q.questions.length) * 100}%"></i></div>
    ${quiz.i === 0 ? `<p class="muted small">${Q.intro}</p>` : ''}
    <section class="panel stack deal">
      <p class="small muted">${U.quiz.progress(quiz.i + 1, Q.questions.length)}</p>
      <h2>${item.q}</h2>
    </section>
    <div class="stack">${item.a.map(([label], i) => `<button class="btn pop ${quiz.picks[quiz.i] === i ? 'picked' : ''}" style="--i:${i}" data-act="answer" data-i="${i}" ${quiz.picks[quiz.i] === i ? 'aria-current="true"' : ''}>${label}</button>`).join('')}</div>
    ${quiz.i > 0 ? `<button class="btn ghost" data-act="quizBack">${U.quiz.back}</button>`
      : quiz.id === 'risk' ? `<button class="btn ghost" data-act="quizBack">${U.quiz.backForm}</button>` : ''}
    <p class="small muted">${U.quiz.disclaimer}</p>`;
  },

  quizResult() {
    const Q = QUIZZES[quiz.id];
    const r = Q.results[quiz.result];
    return `<h3>${Q.title}</h3>
    <section class="panel stack ending">
      <p class="muted small">${U.quiz.yourType}</p>
      <div class="title stamp">${r.name}</div>
    </section>
    <section class="panel stack">
      <h3>${U.quiz.effect}</h3>
      <p>${r.desc}</p>
    </section>
    <button class="btn primary" data-act="quizDone">${quiz.id === 'risk' ? U.quiz.start : U.quiz.resume}</button>
    <button class="btn ghost" data-act="quizBack">${U.quiz.redo}</button>`;
  },

  // 開局預測:還沒開始玩之前,先告訴玩家十年後大概會落在哪裡
  forecast() {
    const F = U.forecast;
    const f = s.forecast;
    return `<h2>${F.title}</h2>
    <p class="muted small">${F.intro(f.n)}</p>
    <section class="panel stack ending">
      <div class="title range num">${F.range(E.fmt(f.p10), E.fmt(f.p90))}</div>
      <p class="muted small">${F.rangeNote}</p>
    </section>
    <section class="panel stack">
      ${fanChart(f, null)}
      <p class="small muted">${F.legend}</p>
      <ul class="lines small">
        <li><span>${F.now}</span><span class="num">${E.fmt(f.start)}</span></li>
        <li><span>${F.low}</span><span class="num">${E.fmt(f.p10)}</span></li>
        <li><span>${F.median}</span><span class="num">${E.fmt(f.p50)}</span></li>
        <li><span>${F.high}</span><span class="num">${E.fmt(f.p90)}</span></li>
      </ul>
    </section>
    <section class="panel stack">
      <h3>${F.probsTitle}</h3>
      ${probList(f, null)}
    </section>
    ${farPanel()}
    <p class="small muted">${F.note}</p>
    <button class="btn primary" data-act="begin">${F.start}</button>
    <button class="btn" data-act="checkup" style="text-align:center">${U.checkup.open}</button>
    <button class="btn" data-act="lab" style="text-align:center">${U.advice.open}</button>
    ${P.pension ? `<button class="btn" data-act="pension" style="text-align:center">${U.pension.open}</button>` : ''}
    <button class="btn" data-act="track" style="text-align:center">${U.real.track}</button>
    <p class="small muted">${U.real.trackNote}</p>`;
  },

  // 每年先決定要練哪幾項習慣(養成),再擲骰子
  plan() {
    const L = U.plan;
    const cards = E.HABITS.map((id, i) => {
      const h = T.habits[id];
      const lv = E.habitLevel(s, id);
      const g = E.planPreview(s, [id]).items[0];
      const next = E.habitToNext(s, id);
      const gain = g.attr ? L.gainAttr(T.attr[g.attr], `+${g.gain}`) : L.gainMoney(`+${Math.round(g.returnPct * 1000) / 10}%`);
      // 三種成本:金錢、時間、健康
      const costs = [
        g.lean ? L.lean : g.price > 0 ? L.cost(E.fmt(g.price)) : '',
        L.time(g.time),
        ...Object.entries(g.strain || {}).map(([k, d]) => L.strain(T.attr[k], (d > 0 ? '+' : '−') + Math.abs(d))),
        g.tired ? L.tired : '',
      ].filter(Boolean).join(' · ');
      const owned = [3, 5].filter((n) => lv >= n).map((n) => `<span class="hint perk on">${L.perkOwned(h.perks[n][0], h.perks[n][1])}</span>`).join('');
      const nextPerk = [3, 5].find((n) => lv < n);
      const locked = nextPerk ? `<span class="hint perk">${L.perkLocked(nextPerk, h.perks[nextPerk][0], h.perks[nextPerk][1])}</span>` : '';
      return `<button class="btn habit pop ${planPicks.includes(id) ? 'on' : ''}" style="--i:${i}" data-act="pick" data-id="${id}" aria-pressed="${planPicks.includes(id)}">
        <span class="hrow"><b>${h.name}</b><span class="small muted">${lv ? L.level(lv) : L.notStarted}</span>${levelPips(lv)}</span>
        <span class="hint">${h.desc} · ${gain} · ${next ? L.toNext(next) : L.maxed}</span>
        <span class="hint cost">${costs}</span>
        ${owned}${locked}
      </button>`;
    }).join('');
    return `${track(s.turn)}
    <div class="row"><h3>${U.common.yearHead(s.age, s.turn + 1, E.TOTAL_TURNS)}</h3><span class="num"><span class="small muted">${U.common.netWorth}</span> <b>${E.fmt(E.netWorth(s))}</b></span></div>
    <h2>${L.title}</h2>
    <p class="muted small">${L.intro(E.PLAN_MAX)}</p>
    <section class="panel">${bars()}</section>
    <div class="stack">${cards}</div>
    <section class="panel plansum" id="plansum" aria-live="polite">${planSummary()}</section>
    <button class="btn primary" id="planbtn" data-act="planDone">${planPicks.length ? L.confirmGo : L.confirmRest}</button>`;
  },

  // 每年先擲骰子在棋盤上前進,走到的格子決定抽哪一類事件卡
  board() {
    const pos = s.pos ?? 0;
    const [x, y] = tileXY(pos);
    const tiles = E.BOARD.map((kind, i) => {
      const [c, r] = tileXY(i);
      return `<span class="tile k-${kind}" data-i="${i}" style="grid-column:${c};grid-row:${r}" title="${T.tiles[kind].name}">${T.tiles[kind].glyph}</span>`;
    }).join('');
    const legend = ['chance', 'crisis', 'choice', 'coin', 'rest', 'fate']
      .map((k) => `<span><i class="tile k-${k}">${T.tiles[k].glyph}</i>${T.tiles[k].name}</span>`)
      .join('');
    return `${track(s.turn)}
    <div class="row"><h3>${U.common.yearHead(s.age, s.turn + 1, E.TOTAL_TURNS)}</h3><span class="num"><span class="small muted">${U.common.netWorth}</span> <b>${E.fmt(E.netWorth(s))}</b></span></div>
    <section class="panel boardwrap">
      <div class="board">
        ${tiles}
        <div class="center">
          <div class="dice" id="dice" aria-hidden="true">${pips(1)}</div>
          <p id="boardmsg" class="small muted" role="status">${U.board.prompt}</p>
        </div>
        <span class="token" id="token" style="--x:${x};--y:${y};background-image:url(img/token-${avatar()}.png)" role="img" aria-label="${U.board.tokenLabel}"></span>
      </div>
    </section>
    <div id="boardnotes">${s.plan && s.plan.turn === s.turn ? `<section class="panel stack"><h3>${U.plan.done}</h3>${lineList(s.plan.lines)}</section>` : ''}</div>
    <button class="btn primary" id="rollbtn" data-act="roll">${U.board.roll}</button>
    <div class="legend small muted">${legend}</div>`;
  },

  play() {
    if (s.last) return this.result();
    const c = E.getCard(s.pending);
    const text = c.dynamicText ? c.dynamicText(s) : c.text;
    return `${statusPanel()}
    <section class="panel stack card deal t-${c.type}">
      <span class="badge">${T.types[c.type]}${s.roll ? U.play.landedOn(T.tiles[s.roll.kind].name) : ''}</span>
      <h2>${c.title}</h2>
      <p>${text}</p>
    </section>
    <div class="stack">${c.choices.map((ch, i) => `<button class="btn pop" style="--i:${i + 1}" data-act="choose" data-i="${i}">${ch.label}${choiceHint(ch)}</button>`).join('')}</div>
    <button class="btn ghost small" data-act="reroll">${(FEATURES.ads ? U.play.reroll : U.play.rerollFree)(s.rerolls)}</button>
    <div class="ad">${U.play.adSlot}</div>`;
  },

  // 有機率的選項:先看命運指針停在哪裡,再看結果
  fate() {
    const r = s.last;
    const { p, v, ok } = r.outcome.find((l) => l.roll).roll;
    const pp = round(p * 100);
    return `${track(r.before.turn)}
    <section class="panel stack card t-${r.type} fate">
      <span class="badge">${T.types[r.type]} · ${r.title}</span>
      <h2>${r.choice}</h2>
      <p class="muted small">${U.fate.howto}</p>
      <div class="meter" style="--p:${p * 100}%;--v:${v * 100}%" role="img" aria-label="${U.fate.aria(pp, ok)}"><span class="zone"></span><span class="needle"></span></div>
      <div class="row small muted"><span>${U.fate.successPct(pp)}</span><span>${U.fate.failPct(100 - pp)}</span></div>
      <div class="verdict ${ok ? 'up' : 'down'}" hidden><img src="${charImg(ok ? 'happy' : 'sad')}" alt=""><span>${ok ? U.fate.success : U.fate.fail}</span></div>
    </section>
    <button class="btn primary" data-act="reveal" hidden>${U.fate.reveal}</button>`;
  },

  result() {
    const r = s.last;
    const st = r.settle;
    const sum = st.lines.reduce((x, l) => x + (l.value || 0), 0);
    const money = st.lines
      .map((l) => `<li><span>${l.text}</span>${l.value ? `<span class="num ${l.value > 0 ? 'up' : 'down'}">${l.value > 0 ? '+' : ''}${E.fmt(l.value)}</span>` : ''}</li>`)
      .join('');
    const ach = (r.unlocked || [])
      .map((id, i) => `<section class="panel ach pop" style="--i:${i + 2}"><span class="badge">${U.result.achUnlocked}</span><b>${ACH[id].name}</b><span class="small muted">${ACH[id].desc}</span></section>`)
      .join('');
    return `${statusPanel(r.before)}
    <section class="panel stack card t-${r.type}">
      <span class="badge">${T.types[r.type]} · ${r.title}</span>
      <h2>${U.result.youChose(r.choice)}</h2>
      ${r.outcome.length ? lineList(r.outcome) : `<p class="muted">${U.result.noEffect}</p>`}
    </section>
    ${ach}
    <section class="panel stack">
      <div class="row"><h3>${U.result.settle}</h3><span class="num ${sum >= 0 ? 'up' : 'down'}"><b>${sum >= 0 ? '+' : ''}${E.fmt(sum)}</b></span></div>
      <details>
        <summary>${U.result.details}</summary>
        <ul class="lines">${money}<li class="total"><span>${U.result.subtotal}</span><span class="num">${sum >= 0 ? '+' : ''}${E.fmt(sum)}</span></li></ul>
      </details>
      ${lineList(st.notes)}
    </section>
    <button class="btn primary" data-act="next">${E.isOver(s) ? U.result.toEnding : U.result.nextYear}</button>`;
  },

  end() {
    const k = E.scores(s);
    const e = E.ending(s);
    if (!s.mc || s.mc.netPct == null) {
      const r = E.simulate(s.profile, 1000, 2024, { value: s.value, money: s.money, coping: s.coping });
      s.mc = { pct: E.percentile(r.totals, k.total), netPct: E.percentile(r.nets, E.netWorth(s)), p10: r.netP10, p50: r.netP50, p90: r.netP90 };
      if (!s.forecast) s.forecast = E.forecastOf(r); // 舊存檔沒有開局預測,用這次的模擬補上
      save();
    }
    const F = U.forecast;
    const f = s.forecast;
    if (!s.recorded) {
      const r = E.recordRun(meta, s);
      meta = r.meta;
      saveMeta();
      s.recorded = true;
      s.fresh = r.fresh;
      save();
    }
    const net = E.netWorth(s);
    const got = s.ach || {};
    const gotN = Object.keys(got).length;
    const N = U.end;
    return `<section class="panel stack ending">
      <img class="endchar" src="${charImg(ENDING_MOOD[e.id])}" alt="">
      <p class="muted small">${N.sub(s.age)}</p>
      <div class="title stamp">${e.title}</div>
      <p>${e.text}</p>
      <p class="muted small">${F.endNet}</p>
      <div class="score num" data-count="money" data-from="${s.startNet}" data-to="${net}">${E.fmt(s.startNet)}</div>
      <p><b>${F.beat(s.mc.netPct)}</b><br><span class="small muted">${N.beatNote}</span></p>
    </section>
    <section class="panel stack">
      <h3>${F.actualTitle}</h3>
      ${fanChart(f, [s.startNet, ...s.history.map((h) => h.net)])}
      <p class="small muted">${F.legendActual}</p>
      <p>${F.predicted(E.fmt(f.p10), E.fmt(f.p90), E.fmt(f.p50))}</p>
      <p><b>${F.actual(E.fmt(net))}</b> ${net > f.p90 ? F.above : net < f.p10 ? F.below : F.inside}</p>
    </section>
    <section class="panel stack">
      <h3>${F.probsTitle}</h3>
      ${probList(f, net)}
    </section>
    ${advicePanel()}
    <section class="panel stack">
      <div class="row"><h3>${U.meta.freshTitle}</h3><span class="small muted num">${U.meta.summary(meta.runs, meta.best)}</span></div>
      ${freshList()}
    </section>
    <section class="panel stack">${bars()}
      <p><b>${F.scoreLine(round(k.total), s.mc.pct)}</b></p>
      <p class="small muted">${N.wealthNote}</p>
    </section>
    <section class="panel stack">
      <div class="row"><h3>${N.ach}</h3><span class="small muted num">${gotN} / ${ACHS.length}</span></div>
      <ul class="achgrid">${ACHS.map((a) => `<li class="${got[a.id] != null ? 'on' : ''}"><b>${a.name}</b><span>${a.desc}</span></li>`).join('')}</ul>
    </section>
    <section class="panel stack">
      <h3>${U.plan.habitsTitle}</h3>
      ${habitRow()}
      ${perkList()}
    </section>
    <section class="panel stack">
      <h3>${N.selfTitle}</h3>
      <p>${selfVsActual()}</p>
    </section>
    <section class="panel stack">
      <h3>${N.historyTitle}</h3>
      <ul class="timeline">${s.history.map((h) => `<li><span class="muted num">${N.historyAge(h.age)}</span><span>${N.historyRow(h.title, h.choice)}</span><span class="num muted">${E.fmt(h.net)}</span></li>`).join('')}</ul>
    </section>
    ${FEATURES.premium ? `<section class="panel stack">
      <h3>${N.premium}</h3>
      ${N.premiumItems.map((item) => `<button class="btn lock" data-act="locked"><span>${item}</span><span>${N.paid}</span></button>`).join('')}
    </section>` : ''}
    <button class="btn primary" data-act="cardEnd">${U.card.save}</button>
    <button class="btn" data-act="share" style="text-align:center">${N.share}</button>
    <button class="btn" data-act="new" style="text-align:center">${N.again}</button>`;
  },
};

// 目前勾選的計畫合計:時間用了幾格、花多少錢、會不會太滿
function planSummary() {
  const L = U.plan;
  const pv = E.planPreview(s, planPicks);
  const busy = pv.busy.length ? L.sumBusy(pv.busy.map((b) => L.busy[b]).join('、')) : '';
  const state = pv.over ? `<b class="warn">${L.sumOver(pv.over, pv.overCost)}</b>` : pv.free ? `<b class="good">${L.sumFree(pv.free)}</b>` : `<b>${L.sumOk}</b>`;
  return `<div>${L.sumTime(pv.used, pv.cap)}${busy} · ${L.sumCost(E.fmt(pv.cost))}</div><div>${state}</div>`;
}

// 圖鑑的收集進度
function metaChips() {
  const M = U.meta;
  const n = (o) => Object.keys(o).length;
  const items = [
    M.count(M.endings, n(meta.endings), n(T.endings)),
    M.count(M.ach, n(meta.ach), ACHS.length),
    M.count(M.talents, TALENTS.filter((a) => E.talentUnlocked(meta, a.id)).length, TALENTS.length),
  ];
  return `<div class="chips">${items.map((c) => `<span class="chip">${c}</span>`).join('')}</div>`;
}

// 這一局替圖鑑新增了什麼
function freshList() {
  const M = U.meta;
  const f = s.fresh || { ach: [], talents: [] };
  const lines = [];
  if (f.ending) lines.push(M.freshEnding(E.ending(s).title));
  if (f.best) lines.push(M.freshBest(round(E.scores(s).total)));
  f.ach.forEach((id) => ACH[id] && lines.push(M.freshAch(ACH[id].name)));
  f.talents.forEach((id) => T.talents[id] && lines.push(M.freshTalent(T.talents[id][0], T.talents[id][1])));
  return lines.length ? `<ul class="lines">${lines.map((x, i) => `<li class="stagger up" style="--i:${i}"><span>${x}</span></li>`).join('')}</ul>` : `<p class="muted small">${M.freshNone}</p>`;
}

// 已解鎖的特長
function perkList() {
  const owned = E.HABITS.flatMap((id) => [3, 5].filter((n) => E.habitLevel(s, id) >= n).map((n) => T.habits[id].perks[n]));
  return owned.length ? `<ul class="lines small">${owned.map(([name, effect]) => `<li><span><b>${name}</b> ${effect}</span></li>`).join('')}</ul>` : '';
}

function selfVsActual() {
  const S = U.self;
  const self = QUIZZES.risk.results[s.profile.riskSelf].name;
  if (!s.boldOffered) return S.none(self);
  const ratio = s.boldChosen / s.boldOffered;
  const actKey = ratio < 0.34 ? 'low' : ratio < 0.67 ? 'mid' : 'high';
  const base = S.base(self, s.boldOffered, s.boldChosen, QUIZZES.risk.results[actKey].name);
  if (actKey === s.profile.riskSelf) return base + S.same;
  const order = { low: 0, mid: 1, high: 2 };
  return base + (order[actKey] > order[s.profile.riskSelf] ? S.bolder : S.careful);
}

// 預測範圍圖:色帶是逐年的八成機率範圍,虛線是中間值;actual 有傳的話再疊上實際走勢
function fanChart(f, actual) {
  const W = 300, H = 130, M = 6;
  const lo = [f.start, ...f.band.map((b) => b.p10)];
  const mid = [f.start, ...f.band.map((b) => b.p50)];
  const hi = [f.start, ...f.band.map((b) => b.p90)];
  const all = [...lo, ...hi, ...(actual || [])];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const pt = (v, i) => `${(M + (i * (W - 2 * M)) / (lo.length - 1)).toFixed(1)},${(H - M - ((v - min) / span) * (H - 2 * M)).toFixed(1)}`;
  const line = (arr) => arr.map(pt).join(' ');
  const band = `${line(hi)} ${lo.map(pt).reverse().join(' ')}`;
  return `<svg class="chart fan" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${U.forecast.chartAria(E.fmt(f.p10), E.fmt(f.p90))}">
    <polygon class="band" points="${band}"></polygon><polyline class="mid" points="${line(mid)}"></polyline>
    ${actual ? `<polyline points="${line(actual)}"></polyline>` : ''}</svg>`;
}

// 日常誤差:一個月的收入(發薪日前後、年終入帳月份造成的落差大約就是這個量級)
function realSlack() {
  return Number(real.profile.income) || 0;
}

// ---------- 財務建議與組合試算 ----------
// 建議依「開局填的真實狀況」計算,不帶天賦(天賦是遊戲設定)
function realProfile() {
  return { ...s.profile, talent: '' };
}
function getAdvice() {
  const p = realProfile();
  const key = JSON.stringify(p);
  if (!advice || advice.key !== key) advice = { key, data: E.advise(p) };
  return advice.data;
}
const signed = (v) => (v >= 0 ? '+' : '−') + E.fmt(Math.abs(v));
function leverLabel(l) {
  const A = U.advice;
  const p = s.profile;
  if (l.k === 'risk') return A.lever.risk[l.v];
  return A.lever[l.k](l.v, E.fmt(Math.abs(p[l.k] * l.v)));
}
// 預測畫面:十年之外,再給一個到請領年齡的數字
function farPanel() {
  const R = P.pensionRules;
  const long = longOf();
  if (!R || !long || long.main.years <= 10) return '';
  const N = U.pension;
  const b = long.main.last;
  return `<section class="panel stack">
      <h3>${N.farTitle(R.claimAge)}</h3>
      ${longChart(long.main)}
      <div class="row small muted"><span>${N.longAxis(s.profile.age, R.claimAge)[0]}</span><span>${N.longAxis(s.profile.age, R.claimAge)[1]}</span></div>
      <div class="title range num">${N.range(E.fmt(b.p10), E.fmt(b.p90))}</div>
      <p class="small muted">${N.longMid(E.fmt(b.p50))}</p>
      <p class="small muted">${N.farNote}</p>
      <button class="btn" data-act="pension" style="text-align:center">${N.farOpen}</button>
    </section>`;
}
function advicePanel() {
  const A = U.advice;
  const a = getAdvice();
  const pc = (v) => Math.round(Math.abs(v) * 100);
  const months = Math.round(a.cashMonths * 10) / 10;
  const checks = [
    a.saveRate < 0 ? ['down', A.saveNeg(pc(a.saveRate))] : a.saveRate < 0.1 ? ['down', A.saveLow(pc(a.saveRate))] : ['up', A.saveOk(pc(a.saveRate))],
    a.cashMonths < 3 ? ['down', A.cashLow(months)] : ['up', A.cashOk(months)],
  ];
  if (a.base.neg >= 0.05) checks.push(['down', A.negRisk(Math.round(a.base.neg * 100))]);
  const rs = retireSummary();
  let retire = '';
  if (rs) {
    const G = rs.p.gap;
    const v = G.worst.short <= 0 ? ['up', A.retireOk]
      : rs.p.left === 0 ? ['down', A.retireNoTime]
      : G.best.short <= 0 ? ['', A.retireMid(E.fmt(G.worst.saveMore))]
      : ['down', A.retireBad(E.fmt(G.best.saveMore), E.fmt(G.worst.saveMore))];
    const sp = rs.self;
    const tip = rs.p.left > 0 && sp.selfMax > 0 ? `<li>${A.selfTip(E.fmt(sp.selfCost), E.fmt(sp.lo.extraMonthly), E.fmt(sp.hi.extraMonthly))}${sp.taxSaved > 0.005 ? A.selfTipTax(E.fmt(sp.taxSaved)) : ''}<br><span class="small muted">${A.selfTipNote}</span></li>` : '';
    retire = `<h3>${A.retireTitle}</h3><ul class="checks"><li class="${v[0]}">${v[1]}</li>${tip}</ul>`;
  }
  const top = a.levers[0];
  const riskUp = a.levers.find((l) => l.k === 'risk' && l.d50 > 0 && l.d10 < 0);
  return `<section class="panel stack">
      <h3>${A.title}</h3>
      <p class="small muted">${A.basis}</p>
      <ul class="checks">${checks.map(([cls, text]) => `<li class="${cls}">${text}</li>`).join('')}</ul>
      ${retire}
      <h3>${A.leversTitle}</h3>
      ${top && top.d50 > 0 ? `<p><b>${A.top(leverLabel(top), signed(top.d50))}</b></p>` : ''}
      <ul class="lines levers">${a.levers.map((l) => `<li><span>${leverLabel(l)}</span><span class="num small ${l.d50 < 0 ? 'down' : 'up'}">${A.delta(signed(l.d50), signed(l.d10))}</span></li>`).join('')}</ul>
      <p class="small muted">${A.leversNote}</p>
      ${riskUp ? `<p class="small">${A.riskWarn(signed(riskUp.d10))}</p>` : ''}
      <button class="btn primary" data-act="checkup">${U.checkup.open}</button>
      <button class="btn" data-act="lab" style="text-align:center">${A.open}</button>
      ${P.pension ? `<button class="btn" data-act="pension" style="text-align:center">${U.pension.open}</button>` : ''}
      <p class="small muted">${A.disclaimer}</p>
    </section>`;
}
function labResult(change) {
  const key = `${change.expense}|${change.income}|${change.risk}|${change.house}|${change.kid}`;
  if (!lab.cache[key]) lab.cache[key] = E.scenario(realProfile(), change);
  return lab.cache[key];
}
// 到退休的長期試算。依起點、自願提繳率、買房、生小孩快取(自提會讓每年的結餘變少)。
const longCache = {};
const kidCostOf = () => P.cards.find((c) => c.id === P.decisions.kid.card).choices[P.decisions.kid.yes].effect.expenseAbs;
function longOf(self = 0, house = 'no', kid = 'no') {
  const R = P.pensionRules;
  if (!R || !E.projectLong) return null;
  const prof = realProfile();
  const key = `${JSON.stringify(prof)}|${self}|${house}|${kid}`;
  if (!longCache[key]) {
    const o = { self, selfCap: R.lpCap, house, kid, kidCost: kidCostOf(), kidYears: P.econ.kidYears };
    longCache[key] = {
      main: E.projectLong(prof, R.claimAge, 300, 2024, { ...o, stockMean: (1 + R.stockReal) * (1 + P.econ.inflation) - 1 }),
      hist: E.projectLong(prof, R.claimAge, 300, 2024, o),
    };
  }
  return longCache[key];
}
function getLong() {
  // 軍公教的自願提繳是用「本俸加一倍」算的,換成占月收入的比例再交給長期試算
  const pub = s.profile.industry === 'public';
  const self = pub ? pen.self * (pen.pubBase || P.pensionRules.pubBaseShare) * 2 : pen.self;
  return longOf(self, pen.house, pen.kid);
}
// 壓力測試:和長期試算同一個起點、同樣的運氣,只改一件壞事
const stressCache = {};
function stressOf() {
  const R = P.pensionRules;
  const B = P.econ.checkup;
  const prof = realProfile();
  const key = JSON.stringify(prof);
  if (!stressCache[key]) {
    const o = { self: 0, selfCap: R.lpCap, house: 'no', kid: 'no', stockMean: (1 + R.stockReal) * (1 + P.econ.inflation) - 1 };
    const run = (p, extra) => E.projectLong(p, R.claimAge, 300, 2024, { ...o, ...extra });
    stressCache[key] = {
      base: longOf().main,
      crash: run(prof, { firstReturn: B.worstYear }),
      job: run(prof, { lostMonths: B.lostMonths }),
      cost: run({ ...prof, expense: Math.round(prof.expense * 1.1 * 100) / 100 }, {}),
    };
  }
  return stressCache[key];
}
// 大環境情境(AI、科技景氣、能源):同一個起點、同樣的運氣,只改大環境的假設
const trendCache = {};
function trendsOf() {
  const R = P.pensionRules;
  const TD = P.econ.trends;
  if (!TD) return null;
  const prof = realProfile();
  const key = JSON.stringify(prof);
  if (!trendCache[key]) {
    const size = TD.direct.includes(prof.industry) ? 'big' : 'small';
    const o = { self: 0, selfCap: R.lpCap, house: 'no', kid: 'no', stockMean: (1 + R.stockReal) * (1 + P.econ.inflation) - 1 };
    trendCache[key] = {
      size,
      rows: TD.list.map((t) => {
        const trend = { ...t, growth: t.growth ? t.growth[size] : 0 };
        return { id: t.id, trend, r: E.projectLong(prof, R.claimAge, 300, 2024, { ...o, trend }) };
      }),
    };
  }
  return trendCache[key];
}
// 退休準備的摘要(建議區塊用):照現在的做法夠不夠,以及自願提繳 6% 的效果
function retireSummary() {
  if (!P.pension) return null;
  const long = longOf();
  const own = long && { worst: long.main.last.p10, best: long.main.last.p90 };
  const p = P.pension(realProfile(), { own });
  if (p.na) return null;
  return { p, self: P.pension(realProfile(), { self: p.pub ? P.pensionRules.pubDcSelfMax : P.pensionRules.lpSelfMax }) };
}
function longChart(r) {
  const W = 300, H = 130, M = 8;
  const pts = [{ p10: r.start, p50: r.start, p90: r.start }, ...r.band];
  const all = pts.flatMap((b) => [b.p10, b.p90]);
  const min = Math.min(0, ...all), max = Math.max(...all);
  const span = max - min || 1;
  const X = (i) => (M + (i * (W - 2 * M)) / (pts.length - 1)).toFixed(1);
  const Y = (v) => (H - M - ((v - min) / span) * (H - 2 * M)).toFixed(1);
  const line = (k) => pts.map((b, i) => `${X(i)},${Y(b[k])}`).join(' ');
  const band = `${line('p90')} ${pts.map((b, i) => `${X(i)},${Y(b.p10)}`).reverse().join(' ')}`;
  return `<svg class="chart fan" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.pension.longAria(E.fmt(r.last.p10), E.fmt(r.last.p90))}">
    <polygon class="band" points="${band}"></polygon><polyline class="mid" points="${line('p50')}"></polyline></svg>`;
}

// 兩條橫條:上面是現在的做法,下面是這個組合;橫條是八成範圍,直線是中間值
function labChart(base, cur) {
  const W = 300, M = 8;
  const min = Math.min(base.p10, cur.p10, 0), max = Math.max(base.p90, cur.p90);
  const X = (v) => M + ((v - min) / (max - min || 1)) * (W - 2 * M);
  const bar = (r, y, cls) => `<rect class="${cls}" x="${X(r.p10).toFixed(1)}" y="${y}" width="${Math.max(2, X(r.p90) - X(r.p10)).toFixed(1)}" height="18" rx="6"></rect>
    <line class="mid" x1="${X(r.p50).toFixed(1)}" x2="${X(r.p50).toFixed(1)}" y1="${y - 3}" y2="${y + 21}"></line>`;
  return `<svg class="chart fan labchart" viewBox="0 0 ${W} 64" role="img" aria-label="${U.advice.chartAria}">${bar(base, 6, 'band base')}${bar(cur, 38, 'band')}</svg>`;
}

// 一筆回填和當初預測的比較
function realVerdict(e) {
  const t = yearsBetween(real.date, e.date);
  const x = E.bandAt(real.start, real.band, t, realSlack());
  const key = e.savings > x.p90 ? 'above' : e.savings < x.p10 ? 'below' : 'inside';
  return { t, x, key, cls: key === 'below' ? 'down' : 'up' };
}

// 真實進度圖:色帶是當初預測的範圍,圓點和實線是回填的實際數字(橫軸依實際經過的時間)
function realChart() {
  const W = 300, H = 150, M = 8;
  const n = real.band.length;
  // 每 0.1 年取一點,色帶才畫得出一年以內「先快後慢」變寬的形狀
  const ts = Array.from({ length: n * 10 + 1 }, (_, i) => i / 10);
  const at = ts.map((t) => E.bandAt(real.start, real.band, t, realSlack()));
  const lo = at.map((b) => b.p10);
  const mid = at.map((b) => b.p50);
  const hi = at.map((b) => b.p90);
  const pts = [[0, real.start], ...real.entries.map((e) => [Math.min(n, yearsBetween(real.date, e.date)), e.savings])];
  const all = [...lo, ...hi, ...pts.map((p) => p[1])];
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const X = (t) => (M + (t * (W - 2 * M)) / n).toFixed(1);
  const Y = (v) => (H - M - ((v - min) / span) * (H - 2 * M)).toFixed(1);
  const line = (arr) => arr.map((v, i) => `${X(ts[i])},${Y(v)}`).join(' ');
  const band = `${line(hi)} ${lo.map((v, i) => `${X(ts[i])},${Y(v)}`).reverse().join(' ')}`;
  return `<svg class="chart fan" viewBox="0 0 ${W} ${H}" role="img" aria-label="${U.real.chartAria}">
    <polygon class="band" points="${band}"></polygon><polyline class="mid" points="${line(mid)}"></polyline>
    <polyline points="${pts.map(([t, v]) => `${X(t)},${Y(v)}`).join(' ')}"></polyline>
    ${pts.map(([t, v]) => `<circle class="dot" cx="${X(t)}" cy="${Y(v)}" r="3.5"></circle>`).join('')}</svg>`;
}

// 各個目標的達成機率;net 有傳(結局頁)的話,標出實際有沒有達成
function probList(f, net) {
  const F = U.forecast;
  return `<ul class="probs">${f.probs.map((pr) => {
    const label = F.prob[pr.id](pr.amount != null ? E.fmt(pr.amount) : '');
    let mark = '';
    if (net != null) {
      const hit = E.probHit(pr, f.start, net);
      const good = pr.id === 'neg' ? !hit : hit;
      mark = `<i class="${good ? 'up' : 'down'}">${pr.id === 'neg' ? (hit ? F.happened : F.avoided) : hit ? F.hit : F.miss}</i>`;
    }
    return `<li><span>${label}${mark}</span><span class="pbar"><span style="width:${pr.p}%"></span></span><b class="num">${pr.p}%</b></li>`;
  }).join('')}</ul>`;
}

function chart(points) {
  const W = 300, H = 100, P = 6;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [P + (i * (W - 2 * P)) / (points.length - 1), H - P - ((v - min) / span) * (H - 2 * P)]);
  const line = xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${U.end.chartAria(E.fmt(points[0]), E.fmt(points[points.length - 1]))}">
    <polygon class="area" points="${P},${H} ${line} ${W - P},${H}"></polygon><polyline points="${line}"></polyline></svg>`;
}

// ---------- 棋盤 ----------

// 第 i 格在 7×7 外圈的位置(欄, 列),從左上角順時針繞一圈
function tileXY(i) {
  if (i < 6) return [1 + i, 1];
  if (i < 12) return [7, 1 + (i - 6)];
  if (i < 18) return [7 - (i - 12), 7];
  return [1, 7 - (i - 18)];
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const pips = (n) => Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 骰子滾動 → 棋子一格一格跳 → 顯示走到哪一格
async function playRoll(r) {
  const dice = document.getElementById('dice');
  const token = document.getElementById('token');
  const msg = document.getElementById('boardmsg');
  const btn = document.getElementById('rollbtn');
  btn.disabled = true;
  if (!reduced) {
    dice.classList.add('rolling');
    for (let k = 0; k < 9; k++) {
      dice.innerHTML = pips(1 + Math.floor(Math.random() * 6));
      SND.sfx('dice');
      await sleep(80);
    }
    dice.classList.remove('rolling');
  }
  dice.innerHTML = pips(r.d);
  msg.textContent = U.board.rolled(r.d);
  buzz(20);
  for (let k = 1; k <= r.d; k++) {
    const [x, y] = tileXY((r.from + k) % E.BOARD.length);
    token.style.setProperty('--x', x);
    token.style.setProperty('--y', y);
    SND.sfx('hop');
    if (!reduced) {
      token.classList.remove('hop');
      void token.offsetWidth; // 重新觸發跳躍動畫
      token.classList.add('hop');
      await sleep(240);
    }
  }
  const tile = app.querySelector(`.tile[data-i="${r.to}"]`);
  if (tile) tile.classList.add('land');
  msg.textContent = U.board.landed(r.d, T.tiles[r.kind].name);
  if (r.notes.length) document.getElementById('boardnotes').innerHTML = `<section class="panel pop">${lineList(r.notes)}</section>`;
  btn.disabled = false;
  btn.dataset.act = 'flip';
  btn.textContent = U.board.flip;
  SND.sfx('land');
  buzz(30);
}

// ---------- 過場 ----------

// 命運指針停下後,才顯示成功或失敗
function runFate() {
  const done = () => {
    const v = app.querySelector('.verdict');
    const b = app.querySelector('[data-act=reveal]');
    if (!v || !v.hidden) return;
    v.hidden = false;
    b.hidden = false;
    const ok = s.last.outcome.find((l) => l.roll).roll.ok;
    SND.sfx(ok ? 'win' : 'lose');
    if (ok) burst();
    else document.body.classList.add('shake'), setTimeout(() => document.body.classList.remove('shake'), 500);
    buzz(ok ? 30 : [40, 60, 40]);
  };
  if (reduced) return done();
  app.querySelector('.needle').addEventListener('animationend', done, { once: true });
  setTimeout(done, 2400); // 動畫沒跑(例如分頁在背景)時的保底
}

// 每年開始時的過場:「第 N 年 · X 歲」
function yearIntro() {
  SND.sfx('year');
  if (reduced) return;
  const o = document.createElement('div');
  o.className = 'yearintro';
  o.innerHTML = `<div><span>${U.intro.year(s.turn + 1)}</span><b>${U.intro.age(s.age)}</b></div>`;
  document.body.appendChild(o);
  setTimeout(() => o.remove(), 1150);
}

// ---------- 操作 ----------

function beginTurn() {
  const key = E.QUIZ_TURNS[s.turn];
  if (key && !s[key]) {
    quiz = { id: key, i: 0, answers: [], picks: [], result: null };
    view = 'quiz';
  } else {
    if (!s.pending && !s.last) {
      if (E.needsPlan(s)) {
        planPicks = [];
        view = 'plan';
      } else {
        view = 'board';
      }
      yearIntro();
    } else {
      view = 'play';
    }
  }
  save();
  render();
}

const ACTIONS = {
  home() { view = 'home'; render(); },
  album() { view = 'album'; render(); },
  begin() { beginTurn(); },
  // 把目前這個起點的預測存成追蹤基準(不帶天賦,比的是存款加投資)
  track() {
    if (real && !window.confirm(U.real.replaceConfirm)) return;
    const profile = { ...s.profile, talent: '' };
    const r = E.simulate(profile, 1000, 2024);
    real = { v: 1, date: today(), profile, start: r.liquidStart, band: r.liquidBand, entries: [] };
    saveReal();
    toast(U.real.tracked);
  },
  real() { realError = ''; view = 'real'; render(); },
  lab() {
    lab = { from: view, change: { expense: 0, income: 0, risk: s.profile.risk, house: 'auto', kid: 'auto' }, cache: {} };
    view = 'lab';
    render();
    window.scrollTo(0, 0);
  },
  labSet({ k, v }) {
    lab.change[k] = k === 'expense' || k === 'income' ? Number(v) : v;
    render();
  },
  labBack() { view = lab.from; lab = null; render(); },
  checkup() {
    if (view !== 'checkup') checkFrom = view;
    view = 'checkup';
    render();
    window.scrollTo(0, 0);
  },
  checkBack() { view = checkFrom || 'home'; render(); },
  pension() {
    pen = { from: view, years: Math.max(0, s.profile.age - P.pensionRules.startAge), self: 0, need: 1, liBase: 'min', house: 'no', kid: 'no' };
    view = 'pension';
    render();
    window.scrollTo(0, 0);
  },
  penYears({ d }) {
    pen.years = Math.max(0, Math.min(s.profile.age - 15, pen.years + Number(d)));
    render();
  },
  penSelf({ v }) { pen.self = Number(v); render(); },
  penNeed({ v }) { pen.need = Number(v); render(); },
  penBase({ v }) { pen.liBase = v; render(); },
  penLife({ k, v }) { pen[k] = v; render(); },
  penPub({ k, v }) {
    pen[k] = k === 'pubBase' ? Number(v) : v;
    if (k === 'pubSys' && v === 'db') pen.self = 0; // 舊制沒有自願提繳
    render();
  },
  penBack() { view = pen.from; pen = null; render(); },
  untrack() {
    if (!window.confirm(U.real.removeConfirm)) return;
    real = null;
    saveReal();
    toast(U.real.removed);
    view = 'home';
    render();
  },
  sources() { view = 'sources'; render(); },
  policy() { view = 'policy'; render(); },
  // 清掉這個 App 存在裝置上的所有東西,然後重新載入
  wipe() {
    if (!window.confirm(U.policy.wipeConfirm)) return;
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('nextlife.')).forEach((k) => localStorage.removeItem(k));
    } catch { /* 無法存取儲存空間時,本來就沒有資料 */ }
    location.reload();
  },
  guide() { guideNext = false; view = 'guide'; render(); },
  guideGo() {
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* 存不了就下次再顯示一次 */ }
    ACTIONS.new();
  },
  new() {
    // 第一次開始前,先看一次使用說明
    let seen = true;
    try { seen = !!localStorage.getItem(GUIDE_KEY) || meta.runs > 0 || !!s; } catch { /* 讀不到就不擋 */ }
    if (!seen && view !== 'guide') {
      guideNext = true;
      view = 'guide';
      return render();
    }
    draft = { ...P.form.defaults, talent: '' };
    formError = '';
    view = 'create';
    render();
  },
  resume() {
    if (s.last || s.pending) { view = 'play'; render(); } else beginTurn();
  },
  answer({ i }) {
    const Q = QUIZZES[quiz.id];
    quiz.answers[quiz.i] = Q.questions[quiz.i].a[+i][1];
    quiz.picks[quiz.i] = +i;
    quiz.i += 1;
    if (quiz.i >= Q.questions.length) {
      quiz.result = Q.score(quiz.answers);
      view = 'quizResult';
    }
    SND.sfx(view === 'quizResult' ? 'reveal' : 'tick');
    buzz(10);
    render();
  },
  // 返回上一題(之前選的答案會標出來,可以改選);開局測驗的第一題則回到填資料的畫面
  quizBack() {
    if (quiz.i > 0) {
      quiz.i -= 1;
      quiz.result = null;
      view = 'quiz';
    } else if (quiz.id === 'risk') {
      quiz = null;
      view = 'create';
    }
    render();
  },
  quizDone() {
    if (quiz.id === 'risk') {
      const profile = { ...draft, risk: quiz.result, riskSelf: quiz.result };
      const seed = (Date.now() ^ (Math.random() * 0x7fffffff)) | 0;
      s = E.newGame(profile, seed);
      s.forecast = E.forecastOf(E.simulate(profile, 1000, 2024));
      quiz = null;
      view = 'forecast';
      save();
      SND.sfx('reveal');
      return render();
    } else {
      s[quiz.id] = quiz.result;
    }
    quiz = null;
    beginTurn();
  },
  // 勾選或取消一項習慣;直接改畫面,不整頁重繪,才不會跳回頁首
  pick({ id }) {
    if (planPicks.includes(id)) planPicks = planPicks.filter((x) => x !== id);
    else if (planPicks.length < E.PLAN_MAX) planPicks.push(id);
    else return;
    app.querySelectorAll('.habit').forEach((b) => {
      const on = planPicks.includes(b.dataset.id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    document.getElementById('plansum').innerHTML = planSummary();
    document.getElementById('planbtn').textContent = planPicks.length ? U.plan.confirmGo : U.plan.confirmRest;
    SND.sfx('tick');
    buzz(10);
  },
  planDone() {
    E.planYear(s, planPicks);
    planPicks = [];
    save();
    SND.sfx('confirm');
    buzz(20);
    view = 'board';
    render();
  },
  roll() {
    const r = E.rollTurn(s);
    save(); // 先存檔:就算動畫播到一半關掉,回來也會直接看到這張事件卡
    playRoll(r);
  },
  flip() { SND.sfx('flip'); view = 'play'; render(); },
  choose({ i }) {
    const netBefore = E.netWorth(s);
    const r = E.choose(s, +i);
    save();
    buzz(10);
    view = r.outcome.some((l) => l.roll) ? 'fate' : 'play';
    // 不用擲命運的選項:依這一年淨資產變多或變少給不同的聲音(要擲命運的,等指針停下來再出聲)
    if (view === 'play') SND.sfx(E.netWorth(s) >= netBefore ? 'coin' : 'down');
    else SND.sfx('tap');
    render();
  },
  reveal() { view = 'play'; render(); },
  next() {
    s.last = null;
    if (E.isOver(s)) {
      view = 'end';
      save();
      render();
      SND.sfx('fanfare');
      burst(40);
    } else {
      SND.sfx('tap');
      beginTurn();
    }
  },
  reroll() {
    if (s.rerolls <= 0) return toast(U.play.noReroll);
    if (!FEATURES.ads) {
      s.rerolls -= 1;
      E.startTurn(s, s.pending);
      save();
      SND.sfx('flip');
      return render();
    }
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div><p><b>${U.play.adPlaying}</b></p><p class="small">${U.play.adNote}</p></div>`;
    document.body.appendChild(o);
    setTimeout(() => {
      o.remove();
      s.rerolls -= 1;
      E.startTurn(s, s.pending);
      save();
      render();
    }, 1500);
  },
  locked() { toast(U.end.locked); },
  // 把結局畫成一張圖
  async cardEnd() {
    const k = E.scores(s);
    const e = E.ending(s);
    await openCard({
      kicker: U.end.sub(s.age),
      title: e.title,
      image: charImg(ENDING_MOOD[e.id]),
      bigLabel: U.forecast.endNet,
      big: E.fmt(E.netWorth(s)),
      lines: s.mc ? [U.forecast.beat(s.mc.netPct)] : [],
      bars: ['wealth', 'career', 'health', 'relation', 'mind'].map((key) => ({ label: T.attr[key], value: k[key] })),
      rows: [[U.card.score, String(round(k.total))]],
    }, U.card.fileEnd);
  },
  // 把退休試算畫成一張圖(和退休金頁同樣的設定)
  async cardPension() {
    const N = U.pension;
    const long = getLong();
    const p = P.pension(realProfile(), { years: pen.years, self: pen.self, need: pen.need, liBase: pen.liBase, pubSys: pen.pubSys, pubBase: pen.pubBase, own: long && { worst: long.main.last.p10, best: long.main.last.p90 } });
    const G = p.gap;
    const rng = (a, b) => (E.fmt(a) === E.fmt(b) ? E.fmt(a) : N.range(E.fmt(Math.min(a, b)), E.fmt(Math.max(a, b))));
    const verdict = G.worst.short <= 0 ? { tone: 'up', text: N.gapOk }
      : p.left === 0 ? { tone: 'down', text: N.gapNoTime(E.fmt(G.best.short), E.fmt(G.worst.short)) }
      : G.best.short <= 0 ? { text: N.gapMid(E.fmt(G.worst.short), E.fmt(G.worst.saveMore)) }
      : { tone: 'down', text: N.gapBad(E.fmt(G.best.short), E.fmt(G.worst.short), E.fmt(G.best.saveMore), E.fmt(G.worst.saveMore)) };
    const rows = [
      [U.card.need, E.fmt(G.need)],
      [U.card.gap, G.worst.monthly <= 0 ? U.card.gapNone : rng(G.best.monthly, G.worst.monthly)],
    ];
    if (long && long.main.years > 0) rows.push([U.card.at65, rng(long.main.last.p10, long.main.last.p90)]);
    await openCard({
      kicker: N.title,
      title: N.totalTitle,
      image: charImg(),
      big: rng(p.lo.total, p.hi.total),
      lines: [verdict],
      rows,
    }, U.card.filePension);
  },
  async share() {
    const k = E.scores(s);
    const text = U.end.shareText(E.ending(s).title, E.fmt(E.netWorth(s)), s.mc.netPct);
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast(U.end.copied);
      }
    } catch {
      toast(U.end.shareFail);
    }
  },
};

app.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]');
  SND.unlock(); // 瀏覽器要等第一次點擊才允許出聲
  if (!b || b.disabled) return;
  if (!OWN_SOUND.has(b.dataset.act)) SND.sfx('tap');
  ACTIONS[b.dataset.act](b.dataset);
});
// 這些操作自己會出聲,不再加一般的點擊聲
const OWN_SOUND = new Set(['roll', 'flip', 'choose', 'pick', 'answer', 'planDone', 'next', 'quizDone', 'reveal', 'reroll']);

// 聲音開關:固定在畫面右下角,按一下依序切換「音樂和音效 → 只有音效 → 靜音」
const audioBtn = document.createElement('button');
audioBtn.id = 'audiobtn';
audioBtn.type = 'button';
const AUDIO_ICON = { all: '🔊', sfx: '🔉', off: '🔇' };
const showAudio = () => {
  const m = SND.getMode();
  audioBtn.textContent = AUDIO_ICON[m];
  audioBtn.setAttribute('aria-label', `${U.audio.label}:${U.audio[m]}`);
};
audioBtn.addEventListener('click', () => {
  const m = SND.cycleMode();
  SND.unlock();
  showAudio();
  toast(U.audio[m]);
  if (m !== 'off') SND.sfx('confirm');
});
showAudio();
document.body.appendChild(audioBtn);

// 回填表單:記下實際數字,並用最新數字重新推演往後十年
function submitCheckin(f) {
  const R = U.real;
  const date = f.get('date') || today();
  const num = (k) => (f.get(k) === '' ? NaN : Number(f.get(k)));
  const e = { date, savings: num('savings'), income: num('income'), expense: num('expense') };
  realError =
    !(yearsBetween(real.date, date) >= 0) ? R.errDate(real.date)
    : !(e.savings >= 0 && e.income >= 0 && e.expense > 0) ? R.errNumber
    : '';
  if (realError) return render();
  const age = real.profile.age + Math.floor(yearsBetween(real.date, date));
  const r = E.simulate({ ...real.profile, age, income: Math.max(e.income, P.form.income.min), expense: e.expense, savings: e.savings }, 1000, 2024);
  e.next = { p10: r.netP10, p50: r.netP50, p90: r.netP90 };
  real.entries = [...real.entries.filter((x) => x.date !== date), e].sort((a, b) => (a.date < b.date ? -1 : 1));
  saveReal();
  buzz(20);
  render();
}

app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  if (ev.target.id === 'checkin') return submitCheckin(f);
  const n = (k) => Number(f.get(k));
  Object.assign(draft, {
    avatar: f.get('avatar') || 'm',
    age: Math.round(n('age')), industry: f.get('industry'), income: n('income'), expense: n('expense'), savings: n('savings'),
    spouseIncome: f.get('spouseIncome') === '' || f.get('spouseIncome') == null ? 0 : n('spouseIncome'),
    debt: f.get('debt') ? n('debt') : 0, debtRate: f.get('debtRate') === '' || f.get('debtRate') == null ? 0 : n('debtRate'), debtPay: f.get('debtPay') ? n('debtPay') : 0,
    talent: E.talentUnlocked(meta, f.get('talent')) ? f.get('talent') : '',
    county: f.get('county') || 'all', status: f.get('status'), house: f.get('house'), rCareer: n('rCareer'), rHealth: n('rHealth'), rRelation: n('rRelation'), rMind: n('rMind'),
  });
  formError =
    !(draft.age >= 18 && draft.age <= 60) ? U.create.errAge
    : !(draft.income >= P.form.income.min) ? U.create.errIncome(P.form.income.min)
    : !(draft.expense >= P.form.expense.min) ? U.create.errExpense(P.form.expense.min)
    : !(draft.savings >= P.form.savings.min) ? U.create.errSavings
    : !(draft.spouseIncome >= 0) ? U.create.errSpouse
    : !(draft.debt >= 0 && draft.debtPay >= 0 && draft.debtRate >= 0 && draft.debtRate <= 20) ? U.create.errDebt
    : '';
  if (formError) return render();
  quiz = { id: 'risk', i: 0, answers: [], picks: [], result: null };
  view = 'quiz';
  render();
});

// 舊版存檔沒有「結算前數值」,補上以免結果畫面出錯
if (s && s.last && !s.last.before) {
  s.last.before = { scores: E.scores(s), net: E.netWorth(s), age: s.age - 1, turn: s.turn - 1 };
}
// 已經玩完的存檔,直接回到結局畫面
if (s && E.isOver(s) && !s.last) view = 'end';
render();
