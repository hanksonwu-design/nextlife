// 推演引擎:純邏輯,不碰畫面,也不寫死任何國家的數值或文字。
// 幣別、經濟參數、產業、事件卡、文字都來自國家包(packs/<id>/),開始前先呼叫 usePack()。

let P = null; // 目前使用的國家包
export function usePack(pack) {
  P = pack;
  return pack;
}
export const pack = () => P;

export const TOTAL_TURNS = 10;

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const sign = (v) => (v > 0 ? '+' : '−') + Math.abs(v);

export const fmt = (v) => P.fmt(v);
const fmtSigned = (v) => (v >= 0 ? '+' : '') + fmt(v);
const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v * 1000) / 10) + '%';

// 可重現的亂數:狀態存在 s.rng,存檔後續玩結果一致
export function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss(s) {
  const u = Math.max(rand(s), 1e-9);
  const v = rand(s);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function housePrice(s) {
  // 有選縣市就用該縣市的房價所得比
  const byCounty = P.econ.priceToIncome && P.econ.priceToIncome[s.profile.county];
  const ratio = byCounty || P.econ.housePriceYears;
  // 房價所得比的分母是「家戶」所得。只拿個人年薪去乘,單身或收入較低的人會算出買不到的便宜房子,
  // 所以至少是當地的中位數房價(房價所得比 × 家戶可支配所得中位數);收入更高的人則依自己的年薪往上。
  const typical = ratio * (P.econ.householdIncome || 0);
  return Math.round(Math.max((s.income + (s.spouse || 0)) * 12 * ratio, typical));
}
function loanPayment(balance, years) {
  const r = P.econ.loanRate;
  return (balance * r) / (1 - Math.pow(1 + r, -years));
}

export const downPayment = (s) => housePrice(s) * P.econ.downRate;

export function buyHouse(s, L) {
  const price = housePrice(s);
  const down = price * P.econ.downRate;
  const balance = price - down;
  const fromCash = Math.min(Math.max(s.cash, 0), down);
  s.cash -= fromCash;
  s.invest -= down - fromCash;
  s.house = true;
  s.flags.bought = true;
  s.houseValue = price;
  s.loan = { balance, yearly: loanPayment(balance, P.econ.loanYears), years: P.econ.loanYears };
  const oldExp = s.expense;
  s.expense *= P.econ.ownExpenseRate;
  L.push({ text: P.t.houseBought(fmt(price), fmt(down)), tone: 'down' });
  L.push({ text: P.t.houseLoan(fmt(balance), P.econ.loanYears, fmt(s.loan.yearly)), tone: 'down' });
  L.push({ text: P.t.houseNoRent(fmt(oldExp), fmt(s.expense)), tone: 'up' });
}

export function netWorth(s) {
  return s.cash + s.invest + (s.house ? s.houseValue : 0) - (s.loan ? s.loan.balance : 0);
}

export function newGame(profile, seed) {
  const risk = P.risk[profile.risk];
  const s = {
    v: 1,
    pack: P.id,
    profile,
    rng: seed | 0,
    turn: 0,
    age: profile.age,
    industry: profile.industry,
    risk: profile.risk,
    income: profile.income,
    incomeRef: profile.income,
    spouse: Math.max(0, Number(profile.spouseIncome) || 0), // 配偶的稅前月收入(沒有就是 0);有填的話支出和存款是全家的
    expense: profile.expense,
    cash: profile.savings * (1 - risk.share),
    invest: profile.savings * risk.share,
    status: profile.status,
    kids: 0,
    pos: 0,
    laps: 0,
    roll: null,
    house: profile.house !== 'none',
    houseValue: 0,
    loan: null,
    attrs: {
      career: 30 + profile.rCareer * 10,
      health: 30 + profile.rHealth * 10,
      relation: 30 + profile.rRelation * 10,
      mind: 30 + profile.rMind * 10,
    },
    value: null, // 工作價值觀:achieve / balance / bond / stable(第 3 年測驗)
    money: null, // 金錢性格:saver / enjoy / grow / give(第 5 年測驗)
    coping: null, // 壓力因應:solve / seek / avoid(第 7 年測驗)
    crisis: false,
    boldOffered: 0,
    boldChosen: 0,
    flags: {},
    cooldown: {},
    used: {},
    rerolls: 3,
    habits: {}, // 養成:每種習慣練過幾次
    planned: -1, // 最後一次做年度計畫的回合
    plan: null,
    pending: null,
    last: null,
    history: [],
  };
  if (s.house) {
    s.houseValue = housePrice(s);
    if (profile.house === 'loan') {
      const balance = s.houseValue * P.econ.startLoanShare;
      s.loan = { balance, yearly: loanPayment(balance, P.econ.startLoanYears), years: P.econ.startLoanYears };
    }
  }
  if (TALENTS[profile.talent]) TALENTS[profile.talent].start(s);
  s.startNet = netWorth(s);
  return s;
}

// ---- 養成:年度計畫 ----
// 每年最多選 PLAN_MAX 項習慣來練。練的次數累積成等級,等級越高單次效果越好,
// 3 級和 5 級各解鎖一個特長。
// 每項習慣都有三種成本,而且互相牽動:
//   金錢:每項要花錢(econ.habitCost,單位是幾個月的生活費);現金不夠只能做克難版,效果減半。
//   時間:一年只有 TIME_SLOTS 格空閒時間,育兒、副業、長期加班、體力差各占掉一格;
//         排超過會扣健康和心理,留空檔則會回復。
//   健康:身心狀態差時,進修和陪伴的效果打折;進修久坐本身也會扣一點健康。

export const HABITS = ['study', 'fit', 'bond', 'rest', 'money'];
export const PLAN_MAX = 3;
export const HABIT_MAX = 5;
const TIME_SLOTS = 2;
const HABIT_ATTR = { study: 'career', fit: 'health', bond: 'relation', rest: 'mind' };
const HABIT_GAIN = [0, 1, 2, 2, 3, 3]; // 各等級練一次加幾分
const HABIT_TIME = { study: 1, fit: 1, bond: 1, rest: 0, money: 1 }; // 占幾格時間(充電就是休息,不占)
const HABIT_STRAIN = { study: { health: -1 } }; // 練這項本身對身體的代價
const TIRED_HITS = { study: true, bond: true }; // 身心狀態差時效果會打折的習慣
const OVER_COST = 2; // 時間每超出一格,健康和心理各扣幾分
const MONEY_RETURN = 0.004; // 理財功課每一級,投資年報酬的平均值加多少

const levelOf = (count) => (count <= 0 ? 0 : Math.min(HABIT_MAX, 1 + Math.floor(count / 2)));
const countOf = (s, id) => (s.habits && s.habits[id]) || 0;
export const habitLevel = (s, id) => levelOf(countOf(s, id));
// 再練幾次會升級(滿級回傳 0)
export function habitToNext(s, id) {
  const n = countOf(s, id);
  const lv = levelOf(n);
  if (lv >= HABIT_MAX) return 0;
  let k = 1;
  while (levelOf(n + k) === lv) k++;
  return k;
}
const perk = (s, id, lv) => habitLevel(s, id) >= lv;
export const needsPlan = (s) => !isOver(s) && s.planned !== s.turn;

// 今年有幾格空閒時間,以及被什麼占掉
export function timeBudget(s) {
  const busy = [];
  if (s.kids > 0) busy.push('kids');
  if (s.flags.side) busy.push('side');
  if (s.flags.overwork) busy.push('overwork');
  if (s.attrs.health < 40) busy.push('weak');
  return { cap: Math.max(1, TIME_SLOTS - busy.length), busy };
}
// 有小孩之後,陪伴本來就在日常裡,不另外占時間
const habitTime = (s, id) => (id === 'bond' && s.kids > 0 ? 0 : HABIT_TIME[id]);

// 試算:這樣選會花多少錢、占多少時間、得到什麼(畫面預覽和 planYear 共用,不改動狀態)
export function planPreview(s, picks) {
  const { cap, busy } = timeBudget(s);
  const tiredNow = s.attrs.health < 40 || s.attrs.mind < 35;
  let cash = s.cash;
  let used = 0;
  let cost = 0;
  const items = picks.slice(0, PLAN_MAX).map((id) => {
    const level = levelOf(countOf(s, id) + 1);
    const full = P.econ.habitCost[id] * s.expense;
    const attr = HABIT_ATTR[id] || null;
    const lean = !!attr && cash < full; // 現金不夠:克難版
    const price = cash < full ? 0 : full;
    cash -= price;
    cost += price;
    const tired = tiredNow && !!TIRED_HITS[id];
    let gain = attr ? HABIT_GAIN[level] : 0;
    if (lean) gain = Math.ceil(gain / 2);
    if (tired) gain = Math.max(1, gain - 1);
    const time = habitTime(s, id);
    used += time;
    return { id, level, attr, gain, returnPct: attr ? 0 : MONEY_RETURN * level, price, lean, tired, time, strain: HABIT_STRAIN[id] || null };
  });
  const over = Math.max(0, used - cap);
  const free = Math.min(2, Math.max(0, cap - used));
  return { cap, busy, used, over, free, cost, items, overCost: over * OVER_COST };
}

export function planYear(s, picks) {
  s.habits = s.habits || {};
  const T = P.t;
  const L = [];
  const pv = planPreview(s, picks);
  const bump = (k, d, why) => {
    s.attrs[k] = clamp(s.attrs[k] + d);
    L.push({ text: T.attrLine(T.attr[k], sign(d), why), tone: d > 0 ? 'up' : 'down' });
  };
  for (const it of pv.items) {
    const before = habitLevel(s, it.id);
    s.habits[it.id] = countOf(s, it.id) + 1;
    const name = T.habits[it.id].name;
    if (it.attr) {
      s.attrs[it.attr] = clamp(s.attrs[it.attr] + it.gain);
      const note = (it.lean ? T.planLean : '') + (it.tired ? T.planTired : '');
      L.push({ text: T.planAttr(name, it.level, T.attr[it.attr], sign(it.gain)) + note, tone: 'up' });
    } else {
      L.push({ text: T.planMoney(name, it.level, pct(it.returnPct)), tone: 'up' });
    }
    if (it.price > 0) {
      s.cash -= it.price;
      L.push({ text: T.planCost(name, fmtSigned(-it.price)), tone: 'down' });
    }
    if (it.strain) for (const k of Object.keys(it.strain)) bump(k, it.strain[k], T.planStrain[it.id]);
    if (it.level > before) {
      const pk = T.habits[it.id].perks[it.level];
      L.push({ text: pk ? T.planPerk(name, it.level, pk[0], pk[1]) : T.planLevel(name, it.level), tone: 'info', levelUp: true });
    }
  }
  if (pv.over) {
    bump('health', -pv.overCost, T.planOver);
    bump('mind', -pv.overCost, T.planOver);
  } else if (pv.free) {
    bump('health', pv.free, T.planFree);
    bump('mind', pv.free, T.planFree);
  }
  s.planned = s.turn;
  s.plan = { turn: s.turn, picks: pv.items.map((it) => it.id), lines: L };
  return s.plan;
}

// ---- 跨局累積:人生圖鑑與天賦 ----
// 每玩完一局,成就和結局會記進圖鑑(meta,存在裝置上,和單局存檔分開)。
// 圖鑑達到條件會解鎖「天賦」,新的一局可以帶一個當起始優勢。

// need:解鎖條件(看圖鑑);start:開局時怎麼改起始狀態。名稱與說明在國家包的 t.talents
const TALENTS = {
  nest: { need: (m) => m.runs >= 1, start: (s) => { s.cash += s.expense * 3; } },
  scholar: { need: (m) => m.ach.master || m.ach.pro, start: (s) => { s.habits.study = 2; } },
  athlete: { need: (m) => m.ach.iron || m.ach.runner, start: (s) => { s.habits.fit = 2; } },
  people: { need: (m) => m.ach.social || m.ach.family, start: (s) => { s.attrs.relation = clamp(s.attrs.relation + 8); } },
  calm: { need: (m) => m.ach.zen || m.ach.comeback, start: (s) => { s.attrs.mind = clamp(s.attrs.mind + 8); } },
  investor: { need: (m) => m.ach.pot || m.ach.rich, start: (s) => { s.habits.money = 2; } },
  lucky: { need: (m) => m.runs >= 3, start: (s) => { s.rerolls += 1; } },
  veteran: { need: (m) => Object.keys(m.endings).length >= 5, start: () => {} }, // 效果在 chanceOf
};
export const talents = () => Object.keys(TALENTS).map((id) => ({ id, name: P.t.talents[id][0], effect: P.t.talents[id][1], need: P.t.talents[id][2] }));
export const newMeta = () => ({ v: 1, runs: 0, best: 0, ach: {}, endings: {} });
export const talentUnlocked = (meta, id) => !!(TALENTS[id] && TALENTS[id].need(meta));

// 把玩完的一局記進圖鑑。回傳新的圖鑑,以及這一局新增了什麼。
export function recordRun(meta, s) {
  const m = { ...newMeta(), ...meta, ach: { ...(meta && meta.ach) }, endings: { ...(meta && meta.endings) } };
  const had = Object.keys(TALENTS).filter((id) => talentUnlocked(m, id));
  const total = Math.round(scores(s).total);
  const e = endingId(s);
  const fresh = { ach: [], ending: !m.endings[e], best: total > m.best && m.runs > 0, talents: [] };
  for (const id of Object.keys(s.ach || {})) {
    if (!m.ach[id]) fresh.ach.push(id);
    m.ach[id] = (m.ach[id] || 0) + 1;
  }
  m.endings[e] = (m.endings[e] || 0) + 1;
  m.runs += 1;
  m.best = Math.max(m.best, total);
  fresh.talents = Object.keys(TALENTS).filter((id) => talentUnlocked(m, id) && !had.includes(id));
  return { meta: m, fresh };
}

// ---- 事件效果 ----

// 工作價值觀對應的屬性:該屬性升降時,心理分數跟著加減
const VALUE_ATTR = { achieve: 'career', balance: 'health', bond: 'relation', stable: null };

export function chanceOf(s, c) {
  let bonus = c.attr ? (s.attrs[c.attr] - 50) * 0.006 : 0;
  if (s.coping === 'solve' && s.crisis) bonus += 0.08;
  if (c.attr === 'career' && perk(s, 'study', 3)) bonus += 0.05; // 進修 3 級:專業底子
  if (perk(s, 'rest', 5)) bonus += 0.03; // 充電 5 級:從容
  if (s.profile.talent === 'veteran') bonus += 0.02; // 天賦:過來人
  return clamp(c.p + bonus, 0.05, 0.95);
}

function addCash(s, amount, L) {
  s.cash += amount;
  L.push({ text: P.t.cash(fmtSigned(amount)), tone: amount >= 0 ? 'up' : 'down' });
}

export function applyEffect(s, e, L) {
  if (!e) return;
  if (e.note) L.push({ text: e.note, tone: 'info' });
  if (e.cashMonths) addCash(s, e.cashMonths * s.income, L);
  if (e.expMonths) addCash(s, e.expMonths * s.expense, L);
  if (e.incomePct) {
    s.income *= 1 + e.incomePct;
    L.push({ text: P.t.incomeTo(pct(e.incomePct), fmt(s.income)), tone: e.incomePct > 0 ? 'up' : 'down' });
  }
  if (e.expensePct) {
    s.expense *= 1 + e.expensePct;
    L.push({ text: P.t.expenseTo(pct(e.expensePct), fmt(s.expense)), tone: e.expensePct > 0 ? 'down' : 'up' });
  }
  if (e.expenseAbs) {
    s.expense += e.expenseAbs;
    L.push({ text: P.t.expenseTo(fmtSigned(e.expenseAbs), fmt(s.expense)), tone: e.expenseAbs > 0 ? 'down' : 'up' });
  }
  if (e.attrs) {
    for (const k of Object.keys(e.attrs)) {
      let d = e.attrs[k];
      let why = '';
      if (k === 'mind' && d < 0 && s.coping === 'avoid') {
        d = d / 2;
        why = P.t.avoidHalf;
      }
      s.attrs[k] = clamp(s.attrs[k] + d);
      L.push({ text: P.t.attrLine(P.t.attr[k], sign(d), why), tone: d > 0 ? 'up' : 'down' });
    }
    const v = s.value && VALUE_ATTR[s.value];
    if (v && e.attrs[v]) {
      const d = e.attrs[v] > 0 ? 2 : -2;
      s.attrs.mind = clamp(s.attrs.mind + d);
      L.push({ text: P.t.valueMind(sign(d), d > 0, P.t.values[s.value].name), tone: d > 0 ? 'up' : 'down' });
    }
  }
  if (e.set) Object.assign(s, e.set);
  if (e.flag) Object.assign(s.flags, e.flag);
  if (e.run) e.run(s, L);
  if (e.chance) {
    const p = chanceOf(s, e.chance);
    const v = rand(s);
    const ok = v < p;
    // roll 給畫面的「命運指針」用:p 是成功區間,v 是這次擲出的位置
    L.push({ text: P.t.chance(Math.round(p * 100), ok), tone: ok ? 'up' : 'down', roll: { p, v, ok } });
    applyEffect(s, ok ? e.chance.success : e.chance.fail, L);
  }
}

// ---- 抽卡 ----

function available(s, c) {
  if (c.once && s.used[c.id]) return false;
  if ((s.cooldown[c.id] ?? -1) > s.turn) return false;
  return !c.when || !!c.when(s);
}

// type:只抽這個類型(chance / crisis / choice);該類型沒有可抽的卡時,改抽任何類型
export function drawCard(s, excludeId, type) {
  const pool = [];
  let total = 0;
  for (const c of P.cards) {
    if (c.id === excludeId) continue;
    if (type && c.type !== type) continue;
    if (!available(s, c)) continue;
    const w = c.weight ? c.weight(s) : 1;
    if (w <= 0) continue;
    pool.push([c, w]);
    total += w;
  }
  if (!pool.length) return drawCard(s, excludeId, null);
  let r = rand(s) * total;
  for (const [c, w] of pool) {
    r -= w;
    if (r <= 0) return c;
  }
  return pool[pool.length - 1][0];
}

// ---- 棋盤 ----
// 一圈 24 格。每年擲一次骰子,走到的格子決定抽哪一類事件卡。

export const BOARD = [
  'start', 'chance', 'choice', 'crisis', 'choice', 'chance',
  'rest', 'crisis', 'choice', 'chance', 'choice', 'crisis',
  'coin', 'chance', 'crisis', 'choice', 'chance', 'choice',
  'fate', 'crisis', 'chance', 'choice', 'crisis', 'chance',
];
// 每種格子抽哪一類事件卡(null = 不限)
export const TILE_TYPE = { start: 'chance', chance: 'chance', crisis: 'crisis', choice: 'choice', coin: 'chance', rest: 'choice', fate: null };

export function rollTurn(s) {
  const d = 1 + Math.floor(rand(s) * 6);
  const from = s.pos ?? 0;
  const to = (from + d) % BOARD.length;
  const notes = [];
  if (from + d >= BOARD.length) {
    s.laps = (s.laps || 0) + 1;
    const b = s.income * P.econ.lapBonusMonths;
    s.cash += b;
    notes.push({ text: P.t.lapBonus(fmtSigned(b)), tone: 'up' });
  }
  s.pos = to;
  const kind = BOARD[to];
  if (kind === 'coin') {
    const b = s.income * P.econ.coinMonths;
    s.cash += b;
    notes.push({ text: P.t.coinTile(fmtSigned(b)), tone: 'up' });
  } else if (kind === 'rest') {
    s.attrs.health = clamp(s.attrs.health + 3);
    s.attrs.mind = clamp(s.attrs.mind + 3);
    notes.push({ text: P.t.restTile, tone: 'up' });
  } else if (kind === 'fate') {
    notes.push({ text: P.t.fateTile, tone: 'info' });
  }
  const type = TILE_TYPE[kind];
  // 前面選擇的後續(chain 卡)不受格子類型限制,條件成立後每年有 45% 機率找上門
  const chain = P.cards.filter((x) => x.chain && available(s, x));
  let c;
  if (chain.length && rand(s) < 0.45) {
    c = chain[Math.floor(rand(s) * chain.length)];
    notes.push({ text: P.t.chainNote, tone: 'info' });
  } else {
    c = drawCard(s, null, type);
  }
  s.pending = c.id;
  s.crisis = c.type === 'crisis';
  s.last = null;
  s.roll = { d, from, to, kind, type, notes };
  return s.roll;
}

export function getCard(id) {
  return P.cards.find((c) => c.id === id);
}

// ---- 年度結算 ----

// 年資帶來的調薪:用同產業「大一歲的人」和「現在這個年齡的人」薪資中位數的比值。
// 國家包沒有這份資料時,退回舊的做法(45 歲後每年少 1%,55 歲後少 2%)。
function ageGrowth(s) {
  const W = P.econ.wageByAge;
  if (!W) return -(s.age >= 55 ? 0.02 : s.age >= 45 ? 0.01 : 0);
  const pts = W[s.industry] || W.default;
  const at = (age) => {
    if (age <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [a1, w1] = pts[i];
      const [a0, w0] = pts[i - 1];
      if (age <= a1) return w0 + ((w1 - w0) * (age - a0)) / (a1 - a0);
    }
    return pts[pts.length - 1][1];
  };
  const slope = clamp(at(s.age + 1) / at(s.age) - 1, -0.02, 0.08);
  // 年薪已經高於同齡中位數的人,代表已經提前走完一段調薪,往上的幅度按比例打折
  const ahead = at(s.age) / (s.income * 12);
  return slope > 0 && ahead < 1 ? slope * ahead : slope;
}

export function settleYear(s) {
  const ind = P.industries[s.industry];
  const risk = P.risk[s.risk];
  const X = P.econ;
  const T = P.t;
  const L = [];
  const a = s.attrs;

  const salary = s.income * 12;
  const bonusMonths = ind.bonus * (0.6 + (0.8 * a.career) / 100);
  const bonus = s.income * bonusMonths;
  const spend = s.expense * 12;
  let loanPay = 0;
  L.push({ text: T.salary(fmt(s.income)), value: salary });
  if (bonus > 0) L.push({ text: T.bonus(bonusMonths.toFixed(1)), value: bonus });
  const spouseSalary = (s.spouse || 0) * 12;
  if (spouseSalary > 0) L.push({ text: T.spouseSalary(fmt(s.spouse)), value: spouseSalary });
  L.push({ text: T.spend(fmt(s.expense)), value: -spend });
  if (s.loan) {
    loanPay = Math.min(s.loan.yearly, s.loan.balance * (1 + X.loanRate));
    const interest = s.loan.balance * X.loanRate;
    s.loan.balance -= loanPay - interest;
    s.loan.years -= 1;
    L.push({ text: T.loanPay(fmt(interest)), value: -loanPay });
    L.push({ text: T.principal, value: loanPay - interest });
    if (s.loan.years <= 0 || s.loan.balance < 0.5) s.loan = null;
  }
  let gifts = 0;
  if (s.money === 'give') {
    gifts = s.expense * 0.5;
    L.push({ text: T.gifts, value: -gifts });
  }
  // 稅與社會保險:國家包有提供算法才扣(表單填的月收入是稅前)
  let withheld = 0;
  if (P.deductions) {
    const d = P.deductions({ income: s.income, bonus, industry: s.industry, kids: s.kids });
    // 配偶各自計稅、各自繳保費(小孩都算在本人名下)
    const sp = s.spouse > 0 ? P.deductions({ income: s.spouse, bonus: 0, industry: null, kids: 0 }) : { tax: 0, insurance: 0, total: 0 };
    withheld = d.total + sp.total;
    L.push({ text: T.deduct(fmt(d.tax + sp.tax), fmt(d.insurance + sp.insurance)), value: -withheld });
  }
  const surplus = salary + bonus + spouseSalary - spend - loanPay - gifts - withheld;

  // 投資報酬
  // 理財功課:每一級讓平均報酬高一點;3 級起懂得分散,單年最多虧 20%
  // 有歷史報酬資料(econ.stockReturns)就從真實年份裡隨機抽一年,否則用平均與波動模擬
  const hist = P.econ.stockReturns;
  const base = hist ? hist[Math.floor(rand(s) * hist.length)] : risk.mean + risk.sd * gauss(s);
  let r = clamp(base + MONEY_RETURN * habitLevel(s, 'money'), perk(s, 'money', 3) ? -0.2 : -0.45, 0.9);
  let rebounded = false;
  if (s.flags.rebound) {
    s.flags.rebound = false;
    if (rand(s) < 0.7) {
      r += 0.12;
      rebounded = true;
    }
  }
  const gain = s.invest * r;
  if (s.invest > 0) L.push({ text: T.invest(pct(r), risk.name, rebounded), value: gain });
  s.invest += gain;

  if (s.cash > 0) {
    const interest = s.cash * X.cashRate;
    s.cash += interest;
    L.push({ text: T.cashInterest(pct(X.cashRate)), value: interest });
  } else if (s.cash < 0) {
    const interest = s.cash * X.debtRate;
    s.cash += interest;
    L.push({ text: T.debtInterest(pct(X.debtRate)), value: interest });
  }

  if (surplus >= 0) {
    const share = s.money === 'grow' ? Math.min(0.95, risk.share + 0.15) : risk.share;
    s.invest += surplus * share;
    s.cash += surplus * (1 - share);
  } else {
    s.cash += surplus;
  }
  if (s.cash < 0 && s.invest > 0) {
    const take = Math.min(s.invest, -s.cash);
    s.invest -= take;
    s.cash += take;
    L.push({ text: T.sellInvest(fmt(take)), value: 0 });
  }

  if (s.house) {
    const hg = X.houseGrowth + X.houseSd * gauss(s);
    const dv = s.houseValue * hg;
    s.houseValue += dv;
    L.push({ text: T.houseValue(pct(hg)), value: dv });
  }

  // 屬性自然變化
  const N = [];
  const drift = (k, d, why) => {
    if (!d) return;
    a[k] = clamp(a[k] + d);
    N.push({ text: T.drift(T.attr[k], sign(Math.round(d * 10) / 10), T.why[why]), tone: d > 0 ? 'up' : 'down' });
  };
  drift('career', -1, 'stale');
  drift('health', (s.age >= 50 ? -1.5 : s.age >= 35 ? -0.8 : -0.3) * (perk(s, 'fit', 3) ? 0.5 : 1), perk(s, 'fit', 3) ? 'ageFit' : 'age');
  if (s.money !== 'give' && !perk(s, 'bond', 3)) drift('relation', -1, 'fade');
  if (s.money === 'enjoy') drift('mind', 1, 'enjoy');
  if (s.flags.overwork) {
    drift('health', perk(s, 'fit', 5) ? -1.5 : -3, perk(s, 'fit', 5) ? 'overworkFit' : 'overwork');
    drift('mind', -2, 'overwork');
  }
  const runway = s.cash / s.expense;
  const backed = perk(s, 'bond', 5); // 陪伴 5 級:有人可以依靠,錢的壓力減半
  if (s.cash < 0) drift('mind', backed ? -2.5 : -5, backed ? 'debtBacked' : 'debt');
  else if (surplus < 0) drift('mind', backed ? -1.5 : -3, backed ? 'deficitBacked' : 'deficit');
  else if (runway < 3) drift('mind', -2, 'lowRunway');
  else if (runway >= 12) drift('mind', 1, 'highRunway');
  if (s.value === 'stable') drift('mind', surplus >= 0 ? 1 : -2, surplus >= 0 ? 'stableUp' : 'stableDown');
  if (s.coping === 'avoid') drift('health', -1, 'avoid');
  if (perk(s, 'rest', 3) && a.mind < 50) drift('mind', 2, 'restful');
  const rate = s.coping === 'seek' ? 0.2 : 0.1;
  const back = Math.round((50 - a.mind) * rate * 10) / 10;
  drift('mind', back, s.coping === 'seek' ? 'seek' : 'back');

  // 明年的薪資與物價
  const g = ind.growth + ((a.career - 50) / 50) * 0.02 + ageGrowth(s) + (perk(s, 'study', 5) ? 0.01 : 0) + ind.vol * gauss(s);
  s.income *= 1 + g;
  if (s.spouse > 0) s.spouse *= 1 + (X.spouseGrowth ?? X.inflation);
  s.expense *= 1 + X.inflation;
  N.push({ text: T.nextIncome(pct(g), fmt(s.income)), tone: g >= 0 ? 'up' : 'down' });
  N.push({ text: T.inflation(pct(X.inflation), fmt(s.expense)), tone: 'info' });

  // 生活水準跟著收入升級:收入的實質漲幅,有一部分會變成新的固定開銷
  const rise = s.income / (s.incomeRef ?? s.income) - 1 - X.inflation;
  if (rise > 0.005) {
    const creep = rise * (s.flags.frugal ? X.creepFrugal : X.creep) * (s.money === 'saver' ? 0.6 : s.money === 'enjoy' ? 1.25 : 1) * (perk(s, 'money', 5) ? 0.7 : 1);
    s.expense *= 1 + creep;
    N.push({ text: T.creep(pct(creep), fmt(s.expense), !!s.flags.frugal), tone: 'down' });
  }
  s.incomeRef = s.income;

  s.age += 1;
  s.turn += 1;
  if (netWorth(s) < 0) s.flags.wasBroke = true;
  return { lines: L, notes: N, surplus, net: netWorth(s) };
}

// ---- 進行一回合 ----

// 換一張事件卡(看廣告換卡用):格子類型不變,只是重抽
export function startTurn(s, excludeId) {
  const c = drawCard(s, excludeId, s.roll ? s.roll.type : null);
  s.pending = c.id;
  s.crisis = c.type === 'crisis';
  s.last = null;
  return c;
}

export const isBold = (cardId, idx) => (P.bold[cardId] || []).includes(idx);

export function choose(s, idx) {
  const card = getCard(s.pending);
  const ch = card.choices[idx];
  const outcome = [];
  const age = s.age;
  const before = { scores: scores(s), net: netWorth(s), income: s.income, expense: s.expense, age: s.age, turn: s.turn };
  if (P.bold[card.id]) {
    s.boldOffered += 1;
    if (isBold(card.id, idx)) s.boldChosen += 1;
  }
  applyEffect(s, ch.effect, outcome);
  s.used[card.id] = true;
  s.cooldown[card.id] = s.turn + (card.cooldown ?? 7);
  const settle = settleYear(s);
  s.pending = null;
  s.history.push({ age, title: card.title, choice: ch.label, net: settle.net, liquid: s.cash + s.invest, attrs: { ...s.attrs } });
  const unlocked = checkAchievements(s);
  s.last = { title: card.title, type: card.type, choice: ch.label, outcome, settle, before, unlocked };
  return s.last;
}

// ---- 成就 ----

// 成就的達成條件;名稱與說明在國家包的 t.ach
const ACH_TESTS = {
  lap: (s) => s.laps >= 1,
  pot: (s) => s.startNet < P.econ.milestones.pot && netWorth(s) >= P.econ.milestones.pot,
  rich: (s) => s.startNet < P.econ.milestones.rich && netWorth(s) >= P.econ.milestones.rich,
  double: (s) => s.income >= s.profile.income * 2,
  home: (s) => s.flags.bought,
  family: (s) => s.profile.status !== 'married' && s.status === 'married',
  parent: (s) => s.kids > 0,
  boss: (s) => s.flags.founder,
  pro: (s) => s.attrs.career >= 85,
  iron: (s) => s.attrs.health >= 80,
  social: (s) => s.attrs.relation >= 80,
  zen: (s) => s.attrs.mind >= 80,
  gambler: (s) => s.boldChosen >= 5,
  careful: (s) => isOver(s) && s.boldOffered >= 4 && s.boldChosen === 0,
  scamproof: (s) => s.flags.scamproof,
  petlover: (s) => s.flags.pet,
  runner: (s) => s.flags.runner,
  comeback: (s) => s.flags.wasBroke && netWorth(s) > 0,
  master: (s) => HABITS.some((id) => habitLevel(s, id) >= HABIT_MAX),
  allround: (s) => HABITS.every((id) => habitLevel(s, id) >= 2),
};
export const achievements = () => Object.keys(ACH_TESTS).map((id) => ({ id, name: P.t.ach[id][0], desc: P.t.ach[id][1] }));

function checkAchievements(s) {
  s.ach = s.ach || {};
  const fresh = [];
  for (const id of Object.keys(ACH_TESTS)) {
    if (!s.ach[id] && ACH_TESTS[id](s)) {
      s.ach[id] = s.turn;
      fresh.push(id);
    }
  }
  return fresh;
}

export const isOver = (s) => s.turn >= TOTAL_TURNS;

// ---- 計分與結局 ----

// 同齡儲蓄基準(國家包的 econ.bench):幾歲該存到幾年的生活費
export function benchYears(age) {
  const BENCH = P.econ.bench;
  if (age <= BENCH[0][0]) return BENCH[0][1];
  for (let i = 1; i < BENCH.length; i++) {
    const [a1, y1] = BENCH[i];
    const [a0, y0] = BENCH[i - 1];
    if (age <= a1) return y0 + ((y1 - y0) * (age - a0)) / (a1 - a0);
  }
  return BENCH[BENCH.length - 1][1];
}

// 資產可以支撐幾年開銷。房屋淨值只算一半,因為變現有折扣也需要時間。
export function runwayYears(s) {
  const equity = s.house ? Math.max(0, s.houseValue - (s.loan ? s.loan.balance : 0)) : 0;
  const assets = s.cash + s.invest + equity * 0.5;
  const spend = s.expense * 12 + (s.loan ? s.loan.yearly : 0);
  return assets / spend;
}

// 財富分數:資產能支撐的年數,和同齡基準相比。
// 剛好達標約 36 分,兩倍約 60 分,三倍約 74 分,越高越難再加分;
// 用「相對同齡」而不是絕對金額,不同收入的起點才能公平比較。
export function wealthScore(s) {
  const years = runwayYears(s);
  if (years <= 0) return 0;
  return clamp(100 * (1 - Math.exp(-0.45 * (years / benchYears(s.age)))));
}

export function scores(s) {
  const w = wealthScore(s);
  const a = s.attrs;
  const total = 0.3 * w + 0.2 * a.career + 0.2 * a.health + 0.15 * a.relation + 0.15 * a.mind;
  return { wealth: w, ...a, total };
}

// 結局:引擎只決定是哪一個(id),標題與說明在國家包的 t.endings
function endingId(s) {
  const k = scores(s);
  if (netWorth(s) < 0) return 'debt';
  if (k.mind < 30) return 'burnout';
  if (k.health < 35) return 'body';
  if (k.total >= 75) return 'bloom';
  if (k.wealth >= 75 && k.relation < 45) return 'island';
  if (runwayYears(s) >= 20) return 'free';
  if (k.wealth >= 75 && k.health >= 55 && k.mind >= 55) return 'ease';
  if (k.wealth >= 75) return 'saver';
  if (k.career >= 80) return 'top';
  if (s.status === 'married' && s.kids > 0 && k.relation >= 70) return 'family';
  if (k.health >= 68 && k.mind >= 66) return 'wellness';
  if (k.relation >= 75 && k.wealth < 45) return 'cozy';
  if (s.flags.founder) return 'founder';
  if (s.flags.bought && k.wealth < 50) return 'snail';
  if (s.flags.side && k.total >= 48) return 'slash';
  if (k.total >= 48) return 'steady';
  return 'regroup';
}
export function ending(s) {
  const id = endingId(s);
  const [title, text] = P.t.endings[id];
  return { id, title, text };
}

// ---- 平行宇宙:同一個起點隨機重玩 n 次 ----

export const QUIZ_TURNS = { 3: 'value', 5: 'money', 7: 'coping' };

// 隨機挑 1 到 PLAN_MAX 項不重複的習慣(模擬與平衡量測用)
export function randomPlan(s) {
  const pool = [...HABITS];
  const picks = [];
  const n = 1 + Math.floor(rand(s) * PLAN_MAX);
  while (picks.length < n) picks.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
  return picks;
}

// policy:指定人生決定(組合試算用),沒指定的就照原本隨機選。
//   house: 'buy' = 存款夠頭期款的那一年就買;'no' = 十年都不買
//   kid:   'yes' = 第二年生一個,之後不再生;'no' = 十年都不生
// 對應的事件卡和選項位置在國家包的 decisions。
export function simulate(profile, n, seed, traits = {}, policy = {}) {
  const D = P.decisions || {};
  const totals = [];
  const nets = [];
  let bought = 0;
  const yearly = Array.from({ length: TOTAL_TURNS }, () => []); // 每一年所有輪的淨資產
  const yearlyLiquid = Array.from({ length: TOTAL_TURNS }, () => []); // 每一年所有輪的存款加投資
  let start = 0;
  let liquidStart = 0;
  for (let i = 0; i < n; i++) {
    const s = newGame(profile, (seed + i * 7919) | 0);
    start = s.startNet;
    liquidStart = s.cash + s.invest;
    while (!isOver(s)) {
      if (s.turn === 3) s.value = traits.value ?? null;
      if (s.turn === 5) s.money = traits.money ?? null;
      if (s.turn === 7) s.coping = traits.coping ?? null;
      if (policy.house === 'buy' && !s.house && s.cash + s.invest >= downPayment(s) * 1.05) buyHouse(s, []);
      if (policy.kid === 'yes' && D.kid && s.kids === 0 && s.history.length === 1) {
        applyEffect(s, getCard(D.kid.card).choices[D.kid.yes].effect, []);
      }
      planYear(s, randomPlan(s));
      rollTurn(s);
      const card = getCard(s.pending);
      let idx = Math.floor(rand(s) * card.choices.length); // 不管有沒有指定都先抽,各情境用掉的亂數才會一樣多
      if (D.house && card.id === D.house.card && policy.house) idx = policy.house === 'buy' ? D.house.yes : D.house.no;
      if (D.kid && card.id === D.kid.card && policy.kid) idx = D.kid.no; // 指定「生」的那一個已經在第二年生了
      choose(s, idx);
    }
    if (s.flags.bought) bought++;
    totals.push(scores(s).total);
    nets.push(netWorth(s));
    s.history.forEach((h, t) => { yearly[t].push(h.net); yearlyLiquid[t].push(h.liquid); });
  }
  totals.sort((x, y) => x - y);
  nets.sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const toBand = (v) => {
    v.sort((x, y) => x - y);
    return { p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9) };
  };
  const band = yearly.map(toBand);
  return { totals, nets, start, band, liquidStart, boughtShare: bought / n, liquidBand: yearlyLiquid.map(toBand), netP10: q(nets, 0.1), netP50: q(nets, 0.5), netP90: q(nets, 0.9) };
}

// 把模擬結果整理成可以存檔的「預測」:八成機率範圍、逐年範圍、幾個目標的達成機率
export function forecastOf(r) {
  const share = (test) => Math.round((r.nets.filter(test).length / r.nets.length) * 100);
  const probs = [{ id: 'grow', p: share((v) => v > r.start) }];
  // 挑中間值附近的整數目標:一個在中間值以下(多半做得到),兩個在以上(要靠選擇和運氣),
  // 這樣機率才有鑑別度,不會全部是 100% 或 0%
  const above = P.econ.goals.filter((g) => g > r.netP50);
  const below = P.econ.goals.filter((g) => g <= r.netP50 && g > r.start);
  for (const amount of [...below.slice(-1), ...above.slice(0, 2)]) {
    probs.push({ id: 'goal', amount, p: share((v) => v >= amount) });
  }
  probs.push({ id: 'neg', p: share((v) => v < 0) });
  return { n: r.nets.length, start: r.start, p10: r.netP10, p50: r.netP50, p90: r.netP90, band: r.band, probs };
}
// 預測範圍在第 t 年(可以是小數,例如 0.5 年)的位置,超過最後一年就停在最後一年。
// 中間值:相鄰兩年之間用直線內插(存錢是每個月穩定累積的)。
// 上下的寬度:用「寬度的平方」內插。市場波動是隨機累積的,寬度跟時間的平方根成正比,
//   所以半年的寬度約是一年的 71%,不是 50%;直線內插會讓一年以內的範圍太窄。
// slack:不管過多久都存在的日常誤差(發薪日前後、年終入帳的月份、信用卡結帳日),和上面的寬度平方相加。
export function bandAt(start, band, t, slack = 0) {
  const pts = [{ p10: start, p50: start, p90: start }, ...band];
  const x = Math.max(0, Math.min(band.length, t));
  const i = Math.min(band.length - 1, Math.floor(x));
  const f = x - i;
  const p50 = pts[i].p50 + (pts[i + 1].p50 - pts[i].p50) * f;
  const width = (k) => {
    const a = (pts[i][k] - pts[i].p50) ** 2;
    const b = (pts[i + 1][k] - pts[i + 1].p50) ** 2;
    return Math.sqrt(a + (b - a) * f + slack * slack);
  };
  return { p10: p50 - width('p10'), p50, p90: p50 + width('p90') };
}

// ---------- 情境試算與財務建議 ----------
// 可以調整的三件事,每件三個檔位。支出和收入是相對現在的比例,投資配置是風險等級。
// 買房和生小孩是人生決定:'auto' 是照模型原本的做法(遇到事件卡時隨機決定)。
export const LEVERS = { expense: [0, -0.1, -0.2], income: [0, 0.1, 0.2], risk: ['low', 'mid', 'high'], house: ['auto', 'no', 'buy'], kid: ['auto', 'no', 'yes'] };

// 把一組改變套到起點上(沒寫到的項目維持原樣)
export function applyChange(profile, change = {}) {
  return {
    ...profile,
    expense: Math.round(profile.expense * (1 + (change.expense || 0)) * 100) / 100,
    income: Math.round(profile.income * (1 + (change.income || 0)) * 100) / 100,
    risk: change.risk || profile.risk,
  };
}

// 套用一組改變後重新模擬,回傳十年後淨資產的八成範圍。
// 各情境都用同一個亂數種子,遇到的運氣(哪幾年股市好壞、抽到哪些事件)一樣,差距才是來自這組改變本身。
export function scenario(profile, change, n = 500, seed = 2024) {
  const pick = (v) => (v && v !== 'auto' ? v : undefined);
  const r = simulate(applyChange(profile, change), n, seed, {}, { house: pick(change.house), kid: pick(change.kid) });
  const last = r.liquidBand[r.liquidBand.length - 1];
  return {
    start: r.start, p10: r.netP10, p50: r.netP50, p90: r.netP90,
    liquid50: last.p50, // 十年後存款加投資的中間值(不含房子)
    neg: r.nets.filter((v) => v < 0).length / r.nets.length,
    bought: r.boughtShare, // 十年內買了房的比例
  };
}

// 財務建議用的數據:目前的幾個體質指標,以及「只改一件事」各自讓十年後差多少(依中間值的差距由大到小)
export function advise(profile, n = 300, seed = 2024) {
  const base = scenario(profile, {}, n, seed);
  const levers = [];
  for (const k of ['expense', 'income']) {
    for (const v of LEVERS[k].slice(1)) levers.push({ k, v });
  }
  for (const v of LEVERS.risk) if (v !== profile.risk) levers.push({ k: 'risk', v });
  for (const l of levers) {
    const r = scenario(profile, { [l.k]: l.v }, n, seed);
    l.d50 = r.p50 - base.p50;
    l.d10 = r.p10 - base.p10;
  }
  levers.sort((a, b) => b.d50 - a.d50);
  const share = P.risk[profile.risk].share;
  return {
    base,
    levers,
    saveRate: (profile.income + (Number(profile.spouseIncome) || 0) - profile.expense) / (profile.income + (Number(profile.spouseIncome) || 0)), // 儲蓄率(不含年終;有配偶收入就算全家的)
    cashMonths: profile.expense > 0 ? (profile.savings * (1 - share)) / profile.expense : 99, // 存款夠付幾個月支出
    stockShare: share,
  };
}

// ---------- 到退休的長期試算 ----------
// 十年推演是遊戲(有事件卡、養成、分數);這裡只算錢,一路算到 toAge 歲,用來回答「退休時手上有多少」。
// 每年:薪資 + 年終 − 生活支出 − 房貸 − 稅與保費,結餘依投資配置分到股票和定存;
//       薪資依產業行情和年齡調整,支出跟著物價和收入升級。沒有人生事件(買房、小孩、失業)。
// 回傳的金額是「存款加投資」,而且換算成現在的購買力。
// opts.stockMean:股票部位的長期平均報酬(名目)。有給的話,保留歷史各年的漲跌形狀,但把平均平移到這個數字;
//                 沒給就直接用歷史年份。opts.self / opts.selfCap:退休金自願提繳率與月提繳工資上限。
// opts.house === 'buy':存款加投資夠付頭期款的那一年買房(房價每年照 houseGrowth 上漲),之後付房貸、不用付房租。
// opts.kid === 'yes':第二年生一個,每月支出多 opts.kidCost(現在的價格),養 opts.kidYears 年。
// 回傳的 equity 是 toAge 歲時房子淨值(房價 − 房貸餘額)的中間值,bought 是買到房的比例。
export function projectLong(profile, toAge, n = 300, seed = 2024, opts = {}) {
  const X = P.econ;
  const hist = X.stockReturns;
  const years = Math.max(0, Math.round(toAge - profile.age));
  const shift = hist && opts.stockMean != null ? opts.stockMean - hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  const yearly = Array.from({ length: years }, () => []);
  const equities = [];
  const kidYears = opts.kidYears || 22;
  let start = 0;
  let bought = 0;
  for (let i = 0; i < n; i++) {
    const s = newGame({ ...profile, talent: '' }, (seed + i * 7919) | 0);
    const ind = P.industries[s.industry];
    const risk = P.risk[s.risk];
    start = s.cash + s.invest;
    let kidPay = 0; // 這一年每月的養育支出(當年的價格)
    for (let t = 0; t < years; t++) {
      if (opts.kid === 'yes' && opts.kidCost) {
        if (t === 1) kidPay = opts.kidCost * Math.pow(1 + X.inflation, t);
        else if (t > 1 && t < 1 + kidYears) kidPay *= 1 + X.inflation;
        else if (t >= 1 + kidYears) kidPay = 0;
      }
      if (opts.house === 'buy' && !s.house) {
        const price = housePrice(s) * Math.pow(1 + X.houseGrowth, t);
        const down = price * X.downRate;
        if (s.cash + s.invest >= down * 1.05) {
          const fromCash = Math.min(Math.max(s.cash, 0), down);
          s.cash -= fromCash;
          s.invest -= down - fromCash;
          s.house = true;
          s.flags.bought = true;
          s.houseValue = price;
          s.loan = { balance: price - down, yearly: loanPayment(price - down, X.loanYears), years: X.loanYears };
          s.expense *= X.ownExpenseRate;
        }
      }
      const bonus = s.income * ind.bonus * (0.6 + (0.8 * s.attrs.career) / 100);
      const selfPay = opts.self ? Math.min(s.income, opts.selfCap ?? Infinity) * opts.self * 12 : 0;
      const spouseNet = s.spouse > 0 ? s.spouse * 12 - (P.deductions ? P.deductions({ income: s.spouse, bonus: 0, industry: null, kids: 0 }).total : 0) : 0;
      const withheld = P.deductions ? P.deductions({ income: s.income, bonus, industry: s.industry, kids: kidPay > 0 ? 1 : 0, self: opts.self || 0 }).total : 0;
      let loanPay = 0;
      if (s.loan) {
        loanPay = Math.min(s.loan.yearly, s.loan.balance * (1 + X.loanRate));
        s.loan.balance -= loanPay - s.loan.balance * X.loanRate;
        s.loan.years -= 1;
        if (s.loan.years <= 0 || s.loan.balance < 0.5) s.loan = null;
      }
      const surplus = s.income * 12 + bonus + spouseNet - s.expense * 12 - kidPay * 12 - loanPay - withheld - selfPay;
      if (s.house) s.houseValue *= 1 + X.houseGrowth;
      const base = hist ? hist[Math.floor(rand(s) * hist.length)] + shift : risk.mean + risk.sd * gauss(s);
      s.invest *= 1 + clamp(base, -0.45, 0.9);
      s.cash *= 1 + (s.cash > 0 ? X.cashRate : X.debtRate);
      if (surplus >= 0) {
        s.invest += surplus * risk.share;
        s.cash += surplus * (1 - risk.share);
      } else {
        s.cash += surplus;
      }
      if (s.cash < 0 && s.invest > 0) {
        const take = Math.min(s.invest, -s.cash);
        s.invest -= take;
        s.cash += take;
      }
      const g = ind.growth + ageGrowth(s) + ind.vol * gauss(s);
      s.income *= 1 + g;
      if (s.spouse > 0) s.spouse *= 1 + (X.spouseGrowth ?? X.inflation);
      s.expense *= 1 + X.inflation;
      const rise = s.income / s.incomeRef - 1 - X.inflation;
      if (rise > 0.005) s.expense *= 1 + rise * X.creep;
      s.incomeRef = s.income;
      s.age += 1;
      yearly[t].push((s.cash + s.invest) / Math.pow(1 + X.inflation, t + 1));
    }
    if (s.flags.bought) bought++;
    equities.push(s.house ? (s.houseValue - (s.loan ? s.loan.balance : 0)) / Math.pow(1 + X.inflation, years) : 0);
  }
  equities.sort((x, y) => x - y);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const band = yearly.map((v) => {
    v.sort((x, y) => x - y);
    return { p10: q(v, 0.1), p50: q(v, 0.5), p90: q(v, 0.9) };
  });
  return {
    start, years, band,
    last: band.length ? band[band.length - 1] : { p10: start, p50: start, p90: start },
    bought: bought / n,
    equity: equities[Math.floor(equities.length / 2)] || 0,
  };
}

// 某個目標實際上有沒有達成
export function probHit(pr, start, net) {
  if (pr.id === 'grow') return net > start;
  if (pr.id === 'neg') return net < 0;
  return net >= pr.amount;
}

export function percentile(sortedTotals, value) {
  let below = 0;
  for (const t of sortedTotals) if (t < value) below++;
  return Math.round((below / sortedTotals.length) * 100);
}
