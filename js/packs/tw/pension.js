// 台灣的退休金試算:勞保老年年金 + 勞退新制個人專戶,以及「這樣夠不夠」的缺口估算。
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
};

// 期初年金現值因子:n 年、利率 i。用 60 歲、23 年驗算得 20.35,勞保局公布的是 20.24,差 0.5%。
const annuityFactor = (n, i) => (Math.abs(i) < 1e-9 ? n : (1 - Math.pow(1 + i, -n)) / (1 - 1 / (1 + i)));

// profile:開局填的資料
// opts.years:已工作年資(沒給就用 年齡 − 23);opts.self:自願提繳率(0 到 0.06);
// opts.need:退休後每月想花的錢是現在支出的幾倍(預設 1);opts.liBase:自由工作者的勞保投保薪資,'min' 基本工資或 'actual' 實際收入
// econ / industries / risk:國家包自己的參數
// 勞退專戶的結果給兩個:lo 用保證收益(保守),hi 用勞動基金近十年平均(樂觀),畫面上顯示成範圍。
export function pension(profile, opts, econ, industries, risk) {
  const R = RULES;
  if (profile.industry === 'public') return { na: 'public' };
  const age = profile.age;
  const free = profile.industry === 'free';
  const worked = Math.max(0, opts.years ?? age - R.startAge);
  const left = Math.max(0, R.claimAge - age);
  const self = Math.min(R.lpSelfMax, Math.max(0, opts.self || 0));
  const employer = free ? 0 : R.lpRate; // 自由工作者沒有雇主提繳
  const g = Math.max(0, industries[profile.industry].growth - econ.inflation); // 扣掉物價後的薪資成長
  const finalWage = profile.income * Math.pow(1 + g, left); // 退休前的月收入(現在的購買力)

  // ---- 勞保老年年金(每月;會隨物價調整,所以購買力不變) ----
  const liBase = free ? (opts.liBase || 'min') : 'actual';
  const liWage = liBase === 'min' ? Math.min(R.minWage, R.liCap) : Math.min(finalWage, R.liCap);
  const liYears = worked + left;
  const li = Math.max(liWage * liYears * R.liRate, liWage * liYears * R.liAltRate + R.liAltBase);

  // ---- 勞退個人專戶 ----
  // 月退休金是固定金額、不隨物價調整。factor 算出第一年領的金額;
  // factorReal 換成「整段領取期間購買力一樣」的金額(比較低),總額和缺口用這個。
  const factor = annuityFactor(R.lifeAtClaim, R.annuityRate);
  const factorReal = annuityFactor(R.lifeAtClaim, (1 + R.annuityRate) / (1 + econ.inflation) - 1);
  const pastYears = Math.min(worked, Math.max(0, new Date().getFullYear() - R.lpSince));
  const account = (nominal) => {
    const r = (1 + nominal) / (1 + econ.inflation) - 1; // 扣掉物價後的報酬
    // 過去:用現在的薪資往回推(以前薪水比較低),每年的提繳再滾到今天
    let now = 0;
    for (let k = 0; k < pastYears; k++) {
      const wage = Math.min(profile.income / Math.pow(1 + g, k + 1), R.lpCap);
      now += wage * 12 * employer * Math.pow(1 + r, k + 0.5);
    }
    // 未來:一路提繳到請領年齡。base 是只有雇主提繳,extra 是自願提繳多出來的
    let base = now;
    let extra = 0;
    let at10 = null;
    for (let y = 0; y < left; y++) {
      const wage = Math.min(profile.income * Math.pow(1 + g, y), R.lpCap);
      base = base * (1 + r) + wage * 12 * employer;
      extra = extra * (1 + r) + wage * 12 * self;
      if (y === 9) at10 = base + extra;
    }
    const lp = (base + extra) / factorReal / 12;
    return {
      now, account: base + extra, extra, at10, lp,
      lpFirst: (base + extra) / factor / 12,
      extraMonthly: extra / factorReal / 12,
      total: li + lp, replace: (li + lp) / finalWage,
    };
  };
  const lo = account(R.fundReturnLow);
  const hi = account(R.fundReturn);

  // ---- 自願提繳:每月少領多少、每年少繳多少稅 ----
  const bonus = profile.income * industries[profile.industry].bonus;
  const kids = 0;
  const dedBase = deductions({ income: profile.income, bonus, industry: profile.industry, kids });
  const dedSelf = deductions({ income: profile.income, bonus, industry: profile.industry, kids, self });
  const selfCost = Math.min(profile.income, R.lpCap) * self;
  const taxSaved = dedBase.tax - dedSelf.tax; // 一年

  // ---- 缺口:勞保勞退之外,自己還要準備多少 ----
  // 退休後每月想花的錢 = 現在的月支出 × need。自己的錢要從 65 歲用到 planAge 歲。
  // 自己存的錢:現在的存款 + 每年結餘(收入 + 年終 − 支出 − 稅與保費 − 自提),結餘假設維持現在的購買力。
  //   保守:只跟得上物價;樂觀:股票部位每年實質 5%、其餘放定存。
  const need = profile.expense * (opts.need || 1);
  const spanYears = R.planAge - R.claimAge;
  const surplus = profile.income * 12 + bonus - profile.expense * 12 - dedSelf.total - selfCost * 12; // 一年
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
  const side = (pen, r) => {
    const monthly = Math.max(0, need - pen.total); // 每月缺口
    const lump = monthly * 12 * spanYears; // 65 歲時要準備好的錢(退休後假設只跟得上物價)
    const own = grow(r);
    const short = Math.max(0, lump - own);
    return { monthly, lump, own, short, saveMore: left > 0 && short > 0 ? short / perUnit(r) / 12 : 0 };
  };
  const gap = {
    need, spanYears, surplus,
    worst: side(lo, R.ownRealLow), // 勞退只有保證收益、自己的錢只跟得上物價
    best: side(hi, ownRealHigh), // 勞退維持近十年平均、自己的錢照配置成長
  };

  return {
    worked, left, liYears, liWage, liBase, li, finalWage, lo, hi,
    selfCost, taxSaved, gap, free,
    payYears: R.lifeAtClaim,
    planAge: R.planAge,
  };
}
