// 台灣的退休金試算:勞保老年年金 + 勞退新制個人專戶。
// 金額單位是「萬元」,而且都換算成「現在的購買力」(扣掉物價上漲),不然三十年後的數字看起來會虛胖。
//
// 規定與數字的出處(畫面上的「資料來源」頁也有列):
//   勞保老年年金:兩式擇優。平均月投保薪資 × 年資 × 0.775% + 3,000 元;或 平均月投保薪資 × 年資 × 1.55%。
//     平均月投保薪資取最高 60 個月平均;法定請領年齡 115 年起為 65 歲。(勞保局「老年年金給付標準」)
//   勞保投保薪資最高一級 45,800 元,115 年 1 月 1 日起適用的分級表。(勞動部公告)
//   勞退新制:雇主每月提繳工資的 6%,勞工可自願再提繳最多 6%。(勞工退休金條例)
//   勞退月退休金 = 專戶金額 ÷ 年金現值因子 ÷ 12;利率 1.1473%。(勞保局「月退休金計算基礎」)
//   基金報酬:整體勞動基金 105–114 年平均收益率 8.58%。(勞動基金運用局,勞動部新聞稿)
export const RULES = {
  claimAge: 65,
  startAge: 23, // 沒填年資時,假設 23 歲開始工作
  liCap: 4.58, // 勞保投保薪資上限(萬/月)
  liRate: 0.0155,
  liAltRate: 0.00775,
  liAltBase: 0.3, // 3,000 元
  lpCap: 15, // 勞退月提繳工資上限(萬/月)。法規數字,這次沒有對到原始分級表
  lpRate: 0.06,
  lpSelfMax: 0.06,
  lpSince: 2005, // 勞退新制 94 年 7 月上路,在這之前的年資不在個人專戶裡
  fundReturn: 0.0858, // 樂觀:整體勞動基金 105–114 年平均收益率
  fundReturnLow: 0.011473, // 保守:勞退新制的保證收益(110–112 年平均,也就是算月退休金用的利率)
  annuityRate: 0.011473,
  lifeAtClaim: 20, // 65 歲的平均餘命(年)。沒有對到勞保局的表,用內政部生命表的概數
};

// 期初年金現值因子:n 年、利率 i。用 60 歲、23 年驗算得 20.35,勞保局公布的是 20.24,差 0.5%。
const annuityFactor = (n, i) => (1 - Math.pow(1 + i, -n)) / (1 - 1 / (1 + i));

// profile:開局填的資料;opts.years:已工作年資(沒給就用 年齡 − 23);opts.self:自願提繳率(0 到 0.06)
// econ / industries:國家包自己的經濟參數(物價上漲、產業薪資成長)
// 勞退專戶的結果給兩個:lo 用保證收益(保守),hi 用勞動基金近十年平均(樂觀),畫面上顯示成範圍。
export function pension(profile, opts, econ, industries) {
  const R = RULES;
  if (profile.industry === 'public') return { na: 'public' };
  const age = profile.age;
  const worked = Math.max(0, opts.years ?? age - R.startAge);
  const left = Math.max(0, R.claimAge - age);
  const self = Math.min(R.lpSelfMax, Math.max(0, opts.self || 0));
  const employer = profile.industry === 'free' ? 0 : R.lpRate; // 自由工作者沒有雇主提繳
  const g = Math.max(0, industries[profile.industry].growth - econ.inflation); // 扣掉物價後的薪資成長
  const finalWage = profile.income * Math.pow(1 + g, left); // 退休前的月收入(現在的購買力)

  // ---- 勞保老年年金(每月) ----
  const liWage = Math.min(finalWage, R.liCap);
  const liYears = worked + left;
  const li = Math.max(liWage * liYears * R.liRate, liWage * liYears * R.liAltRate + R.liAltBase);

  // ---- 勞退個人專戶 ----
  const factor = annuityFactor(R.lifeAtClaim, R.annuityRate);
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
    const lp = (base + extra) / factor / 12;
    return { now, account: base + extra, extra, at10, lp, extraMonthly: extra / factor / 12, total: li + lp, replace: (li + lp) / finalWage };
  };
  return {
    worked, left, liYears, liWage, li, finalWage,
    lo: account(R.fundReturnLow),
    hi: account(R.fundReturn),
    selfCost: Math.min(profile.income, R.lpCap) * self, // 自提後每月少領多少
    free: profile.industry === 'free',
    payYears: R.lifeAtClaim,
  };
}
