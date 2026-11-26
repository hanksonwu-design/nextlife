// 台灣的退休金試算,以及「這樣夠不夠」的缺口估算。
//   一般受僱者與自由工作者:勞保老年年金 + 勞退新制個人專戶
//   軍公教(以公務人員、教師的制度估算):退撫制度 + 公保
// 金額單位是「萬元」,而且都換算成「現在的購買力」(扣掉物價上漲),不然三十年後的數字看起來會虛胖。
//
// 規定與數字的出處(畫面上的「資料來源」頁也有列):
//   勞保老年年金:兩式擇優。平均月投保薪資 × 年資 × 0.775% + 3,000 元;或 平均月投保薪資 × 年資 × 1.55%。
//     平均月投保薪資取最高 60 個月平均;法定請領年齡 115 年起為 65 歲。(勞保局「老年年金給付標準」)
//   勞保投保薪資最高一級 45,800 元,115 年 1 月 1 日起適用的分級表。(勞動部公告)
//   勞退新制:雇主每月提繳工資的 6%,勞工可自願再提繳最多 6%。(勞工退休金條例)
//   勞退月提繳工資最高一級 150,000 元。(勞工退休金月提繳分級表)
//   勞退月退休金 = 專戶金額 ÷ 年金現值因子 ÷ 12;利率 1.1473%。(勞保局「月退休金計算基礎」)
//   基金報酬:整體勞動基金 105–114 年平均收益率 8.58%。(勞動基金運用局,勞動部新聞稿)
//   公務人員退撫(112 年 6 月以前到職):月退休金 = 最後 15 年平均俸額(本俸加一倍)× 2% × 年資;
//     每月退休所得不得超過「本俸加一倍 × 替代率上限」,118 年起任職 15 年 30%、每多一年加 1.5%、35 年 60%。
//     (公務人員退休資遣撫卹法第 27、37 條及附表三;銓敘部試算說明)
//   個人專戶制(112 年 7 月以後到職):每月提撥本俸加一倍的 15%(政府 65%、個人 35%),可自願再提繳最多 5.25%。
//     (公務人員個人專戶制退休資遣撫卹法)
//   公保養老年金:保險年資每滿一年給平均保險俸額的 0.75%(基本年金率),112 年 7 月以後初次參加者最高採計 40 年。
//     (公教人員保險法)
import { deductions } from './tax.js';

export const RULES = {
  claimAge: 65,
  startAge: 23, // 沒填年資時,假設 23 歲開始工作
  liCap: 4.58, // 勞保投保薪資上限(萬/月)
  liRate: 0.0155,
  liAltRate: 0.00775,
  liAltBase: 0.3, // 3,000 元
  minWage: 2.95, // 基本工資 29,500 元(115 年)。職業工會加保的人很多用接近這個數字投保
  lpCap: 15, // 勞退月提繳工資上限(萬/月)
  lpRate: 0.06,
  lpSelfMax: 0.06,
  lpSince: 2005, // 勞退新制 94 年 7 月上路,在這之前的年資不在個人專戶裡
  fundReturn: 0.0858, // 樂觀:整體勞動基金 105–114 年平均收益率
  fundReturnLow: 0.011473, // 保守:勞退新制的保證收益(110–112 年平均,也就是算月退休金用的利率)
  annuityRate: 0.011473,
  lifeAtClaim: 20, // 65 歲的平均餘命(年)。沒有對到勞保局的表,用內政部生命表的概數
  planAge: 90, // 缺口試算:自己準備的錢要夠用到幾歲
  ownRealLow: 0, // 缺口試算:自己存的錢,保守假設只跟得上物價
  stockReal: 0.05, // 缺口試算:股票部位扣掉物價後的長期報酬(設計值,不是近 22 年的 14%)

  // ---- 軍公教 ----
  pubBaseShare: 0.6, // 本俸占月薪(本俸 + 各項加給)的比例。設計值,沒有對到俸額表,畫面上可以調
  pubBaseOpts: [0.55, 0.6, 0.65],
  pubDcSince: 2023.5, // 112 年 7 月 1 日以後到職的人適用個人專戶制
  pubMinYears: 15, // 任職滿 15 年才能領月退休金
  pubRate: 0.02, // 舊制:每年 2%
  pubYearsMax: 40,
  pubCap15: 0.3, // 替代率上限:任職 15 年 30%
  pubCapStep: 0.015, // 每多一年加 1.5%,到 35 年 60%
  pubCapOver35: 0.005, // 超過 35 年每年加 0.5%,最高到 40 年
  pubAvgYears: 15, // 用最後 15 年的平均俸額
  pubDcRate: 0.15, // 個人專戶制:政府加個人合計提撥
  pubDcOwnShare: 0.35, // 其中個人負擔的比例
  pubDcSelfMax: 0.0525,
  pubDcReturnLow: 0.017, // 保守:只有定存的水準(設計值)
  pubDcReturn: 0.06, // 樂觀:每年 6%(設計值,沒有查到退撫專戶的長期績效)
  pubInsRate: 0.0075, // 公保養老年金的基本年金率
  pubInsYearsMax: 40,
  pubInsAvgYears: 10,
};

// 期初年金現值因子:n 年、利率 i。用 60 歲、23 年驗算得 20.35,勞保局公布的是 20.24,差 0.5%。
const annuityFactor = (n, i) => (Math.abs(i) < 1e-9 ? n : (1 - Math.pow(1 + i, -n)) / (1 - 1 / (1 + i)));
// 最後 n 年的平均,相對於最後一年的比例(薪水每年名目成長 g)。退休金是用過去的名目金額平均,所以會比最後一年低
const avgRatio = (n, g) => {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += 1 / Math.pow(1 + g, k);
  return sum / n;
};

// 個人專戶累積:wageNow 是現在的月提繳基礎,g 是實質成長,rate 是雇主(或政府加個人的強制)提繳率,self 是自願提繳率
// 回傳一個函式,給名目報酬率就算出專戶與月退休金
function accountOf({ wageNow, cap, g, rate, self, pastYears, left, inflation, factor, factorReal }) {
  return (nominal) => {
    const r = (1 + nominal) / (1 + inflation) - 1; // 扣掉物價後的報酬
    // 過去:用現在的薪資往回推(以前薪水比較低),每年的提繳再滾到今天
    let now = 0;
    for (let k = 0; k < pastYears; k++) {
      const wage = Math.min(wageNow / Math.pow(1 + g, k + 1), cap);
      now += wage * 12 * rate * Math.pow(1 + r, k + 0.5);
    }
    // 未來:一路提繳到請領年齡。base 是強制提繳,extra 是自願提繳多出來的
    let base = now;
    let extra = 0;
    let at10 = null;
    for (let y = 0; y < left; y++) {
      const wage = Math.min(wageNow * Math.pow(1 + g, y), cap);
      base = base * (1 + r) + wage * 12 * rate;
      extra = extra * (1 + r) + wage * 12 * self;
      if (y === 9) at10 = base + extra;
    }
    return {
      now, account: base + extra, extra, at10,
      lp: (base + extra) / factorReal / 12,
      lpFirst: (base + extra) / factor / 12,
      extraMonthly: extra / factorReal / 12,
    };
  };
}

// profile:開局填的資料
// opts.years:已工作年資(沒給就用 年齡 − 23);opts.self:自願提繳率;
// opts.need:退休後每月想花的錢是現在支出的幾倍(預設 1);opts.liBase:自由工作者的勞保投保薪資,'min' 基本工資或 'actual' 實際收入
// opts.pubSys:軍公教適用的制度,'db' 舊制或 'dc' 個人專戶制(沒給就依到職年推斷);opts.pubBase:本俸占月薪的比例
// opts.own:{ worst, best } 外面用完整模型算好的「65 歲時自己有多少」
// econ / industries / risk:國家包自己的參數
// 專戶的結果給兩個:lo 保守、hi 樂觀,畫面上顯示成範圍。
export function pension(profile, opts, econ, industries, risk) {
  const R = RULES;
  const age = profile.age;
  const pub = profile.industry === 'public';
  const free = profile.industry === 'free';
  const worked = Math.max(0, opts.years ?? age - R.startAge);
  const left = Math.max(0, R.claimAge - age);
  const g = Math.max(0, industries[profile.industry].growth - econ.inflation); // 扣掉物價後的薪資成長
  const finalWage = profile.income * Math.pow(1 + g, left); // 退休前的月收入(現在的購買力)
  const factor = annuityFactor(R.lifeAtClaim, R.annuityRate);
  // 專戶的月退休金是固定金額、不隨物價調整。factor 算出第一年領的金額;
  // factorReal 換成「整段領取期間購買力一樣」的金額(比較低),總額和缺口用這個。
  const factorReal = annuityFactor(R.lifeAtClaim, (1 + R.annuityRate) / (1 + econ.inflation) - 1);
  const thisYear = new Date().getFullYear();

  let li, liWage, liYears, liBase, lo, hi, selfBase, selfMax, core;
  const info = {};

  if (pub) {
    // ---- 軍公教 ----
    const share = opts.pubBase || R.pubBaseShare;
    const base2 = profile.income * share * 2; // 本俸加一倍(現在)
    const finalBase2 = base2 * Math.pow(1 + g, left); // 退休前的本俸加一倍(現在的購買力)
    const sys = opts.pubSys || (thisYear + 0.5 - worked >= R.pubDcSince ? 'dc' : 'db');
    const gn = industries.public.growth; // 名目成長,用來算「最後幾年平均」比最後一年低多少
    liYears = worked + left;
    selfBase = base2;
    info.pub = { sys, share, base2: finalBase2 };
    if (sys === 'db') {
      // 舊制:公式算出的月退休金,和「替代率上限」比,取低的。上限已經包含公保的部分。
      selfMax = 0;
      const n = Math.min(liYears, R.pubYearsMax);
      const cap = n >= 35 ? R.pubCap15 + 20 * R.pubCapStep + (n - 35) * R.pubCapOver35 : R.pubCap15 + (n - R.pubMinYears) * R.pubCapStep;
      const formula = R.pubRate * n * avgRatio(R.pubAvgYears, gn);
      const rate = liYears >= R.pubMinYears ? Math.min(formula, cap) : 0;
      li = finalBase2 * rate;
      liWage = finalBase2;
      info.pub.rate = rate;
      info.pub.short = liYears < R.pubMinYears;
      core = () => ({ now: 0, account: 0, extra: 0, at10: null, lp: 0, lpFirst: 0, extraMonthly: 0 });
    } else {
      // 個人專戶制:公保養老年金 + 專戶
      selfMax = R.pubDcSelfMax;
      const insYears = Math.min(liYears, R.pubInsYearsMax);
      liWage = (finalBase2 / 2) * avgRatio(R.pubInsAvgYears, gn); // 平均保險俸額(本俸)
      li = liWage * insYears * R.pubInsRate;
      info.pub.insYears = insYears;
      core = accountOf({
        wageNow: base2, cap: Infinity, g, rate: R.pubDcRate, self: Math.min(selfMax, Math.max(0, opts.self || 0)),
        pastYears: Math.min(worked, Math.max(0, thisYear + 0.5 - R.pubDcSince)), left, inflation: econ.inflation, factor, factorReal,
      });
    }
    lo = core(R.pubDcReturnLow);
    hi = core(R.pubDcReturn);
  } else {
    // ---- 勞保老年年金(每月;會隨物價調整,所以購買力不變) ----
    selfMax = R.lpSelfMax;
    selfBase = Math.min(profile.income, R.lpCap);
    liBase = free ? (opts.liBase || 'min') : 'actual';
    liWage = liBase === 'min' ? Math.min(R.minWage, R.liCap) : Math.min(finalWage, R.liCap);
    liYears = worked + left;
    li = Math.max(liWage * liYears * R.liRate, liWage * liYears * R.liAltRate + R.liAltBase);
    // ---- 勞退個人專戶(自由工作者沒有雇主提繳) ----
    core = accountOf({
      wageNow: profile.income, cap: R.lpCap, g, rate: free ? 0 : R.lpRate, self: Math.min(selfMax, Math.max(0, opts.self || 0)),
      pastYears: Math.min(worked, Math.max(0, thisYear - R.lpSince)), left, inflation: econ.inflation, factor, factorReal,
    });
    lo = core(R.fundReturnLow);
    hi = core(R.fundReturn);
  }
  const self = Math.min(selfMax, Math.max(0, opts.self || 0));
  for (const x of [lo, hi]) {
    x.total = li + x.lp;
    x.replace = (li + x.lp) / finalWage;
  }

  // ---- 配偶的勞保加勞退 ----
  // 只知道配偶的收入,所以當成和你同年齡、23 歲開始工作的一般受僱者來估(不自提)。
  let spouse = null;
  const spIncome = Number(profile.spouseIncome) || 0;
  if (spIncome > 0 && !opts.isSpouse) {
    const sp = pension({ ...profile, industry: 'service', income: spIncome, spouseIncome: 0, expense: 0, savings: 0 }, { isSpouse: true }, econ, industries, risk);
    spouse = { lo: sp.lo.total, hi: sp.hi.total };
  }
  const spDed = spIncome > 0 ? deductions({ income: spIncome, bonus: 0, industry: null, kids: 0 }).total : 0;

  // ---- 自願提繳:每月少領多少、每年少繳多少稅 ----
  const bonus = profile.income * industries[profile.industry].bonus;
  const kids = 0;
  const selfCost = selfBase * self;
  // 稅的算法吃的是「占月收入的比例」,所以換算一下
  const selfOfIncome = profile.income > 0 ? selfCost / Math.min(profile.income, R.lpCap) : 0;
  const dedBase = deductions({ income: profile.income, bonus, industry: profile.industry, kids });
  const dedSelf = deductions({ income: profile.income, bonus, industry: profile.industry, kids, self: selfOfIncome });
  const taxSaved = dedBase.tax - dedSelf.tax; // 一年

  // ---- 缺口:退休金之外,自己還要準備多少 ----
  // 退休後每月想花的錢 = 現在的月支出 × need。自己的錢要從 65 歲用到 planAge 歲。
  // 自己存的錢:有 opts.own 就用完整模型的結果;沒有才用下面的簡單算法
  //   (現在的存款 + 每年結餘,結餘假設維持現在的購買力;保守只跟得上物價,樂觀股票部位每年實質 5%)。
  const need = profile.expense * (opts.need || 1);
  const spanYears = R.planAge - R.claimAge;
  const surplus = profile.income * 12 + bonus + spIncome * 12 - spDed - profile.expense * 12 - dedSelf.total - selfCost * 12; // 一年
  const share = risk[profile.risk] ? risk[profile.risk].share : 0;
  const ownRealHigh = share * R.stockReal + (1 - share) * ((1 + econ.cashRate) / (1 + econ.inflation) - 1);
  const grow = (r) => {
    let v = profile.savings || 0;
    for (let y = 0; y < left; y++) v = v * (1 + r) + surplus;
    return Math.max(0, v);
  };
  // 每年多存 1 萬,到 65 歲會變成多少(用來反推每月要多存多少)
  const perUnit = (r) => {
    let v = 0;
    for (let y = 0; y < left; y++) v = v * (1 + r) + 1;
    return v;
  };
  const side = (pen, r, given, fromSpouse) => {
    const monthly = Math.max(0, need - pen.total - fromSpouse); // 每月缺口
    const lump = monthly * 12 * spanYears; // 65 歲時要準備好的錢(退休後假設只跟得上物價)
    const own = given != null ? Math.max(0, given) : grow(r);
    const short = Math.max(0, lump - own);
    return { monthly, lump, own, short, saveMore: left > 0 && short > 0 ? short / perUnit(r) / 12 : 0 };
  };
  const gap = {
    need, spanYears, surplus,
    worst: side(lo, R.ownRealLow, opts.own && opts.own.worst, spouse ? spouse.lo : 0), // 專戶報酬保守、自己的錢在範圍的低點
    best: side(hi, ownRealHigh, opts.own && opts.own.best, spouse ? spouse.hi : 0), // 專戶報酬樂觀、自己的錢在範圍的高點
  };

  return {
    worked, left, liYears, liWage, liBase, li, finalWage, lo, hi,
    self, selfMax, selfCost, selfOfIncome, taxSaved, gap, free, spouse,
    pub: info.pub || null,
    payYears: R.lifeAtClaim,
    planAge: R.planAge,
  };
}
