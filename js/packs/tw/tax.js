// 台灣的薪資扣繳:綜合所得稅、勞保與就業保險、健保(含年終的補充保費)。金額單位是「萬元」。
// 表單填的月收入當成「稅前」,這裡算出每年要扣掉多少。
//
// 規定與數字的出處(畫面上的「資料來源」頁也有列):
//   綜合所得稅 115 年度:免稅額每人 10.1 萬、標準扣除額單身 13.6 萬、薪資所得特別扣除額 22.7 萬;
//     級距 61 萬以下 5%、138 萬以下 12%、277 萬以下 20%、519 萬以下 30%、超過 40%。(財政部 114 年 11 月公告,新聞轉述)
//   勞保普通事故費率 11.5% + 就業保險 1%,受僱者自付 20%;投保薪資上限 45,800 元。
//   職業工會加保:勞保 11.5%(沒有就業保險),自付 60%。
//   健保費率 5.17%,受僱者自付 30%、職業工會自付 60%;投保金額上限 313,000 元;眷屬最多算 3 口。
//   補充保費 2.11%:單次獎金超過投保金額 4 倍的部分。
export const TAX = {
  exemption: 10.1,
  standard: 13.6,
  salaryDed: 22.7,
  brackets: [[61, 0.05], [138, 0.12], [277, 0.2], [519, 0.3], [Infinity, 0.4]],
  liCap: 4.58,
  liRate: 0.125,
  liShare: 0.2,
  liUnionRate: 0.115,
  liUnionShare: 0.6,
  nhiRate: 0.0517,
  nhiShare: 0.3,
  nhiUnionShare: 0.6,
  nhiMin: 2.95, // 基本工資
  nhiCap: 31.3,
  nhiDependentsMax: 3,
  nhi2Rate: 0.0211,
  lpCap: 15, // 勞退自願提繳不計入薪資所得,以月提繳工資上限 15 萬為限
  // 軍公教:公保和退撫都用本俸計算,自付 35%
  pubBaseShare: 0.6, // 本俸占月薪的比例(設計值)
  pubOwnShare: 0.35,
  pubInsRate: 0.0783, // 公保費率:一般公務人員(不適用年金)。114 年 1 月起
  pubInsRateDc: 0.1633, // 公保費率:112 年 7 月以後到職(適用年金)
  pubFundRate: 0.15, // 退撫提撥費率,基礎是本俸加一倍
};

// 累進稅額。net:所得淨額(萬)
export function incomeTax(net) {
  let tax = 0;
  let floor = 0;
  for (const [top, rate] of TAX.brackets) {
    if (net <= floor) break;
    tax += (Math.min(net, top) - floor) * rate;
    floor = top;
  }
  return tax;
}

// 一年要扣掉多少。income:稅前月收入;bonus:全年年終;kids:小孩人數;self:勞退自願提繳率。
// 簡化:只算本人的薪資(配偶各自申報)、小孩都算在自己名下、不算列舉扣除和其他特別扣除額。
// 軍公教扣的是公保和退撫(pubSys:'db' 舊制或 'dc' 個人專戶制,沒給當成舊制;pubBase:本俸占月薪的比例)。
export function deductions({ income, bonus = 0, industry, kids = 0, self = 0, pubSys = 'db', pubBase }) {
  const X = TAX;
  const union = industry === 'free';
  let li;
  if (industry === 'public') {
    const basePay = income * (pubBase || X.pubBaseShare); // 本俸
    li = (basePay * (pubSys === 'dc' ? X.pubInsRateDc : X.pubInsRate) + basePay * 2 * X.pubFundRate) * X.pubOwnShare * 12;
  } else {
    li = Math.min(income, X.liCap) * (union ? X.liUnionRate * X.liUnionShare : X.liRate * X.liShare) * 12;
  }
  const insured = Math.min(Math.max(income, X.nhiMin), X.nhiCap);
  const heads = 1 + Math.min(kids, X.nhiDependentsMax);
  const nhi = insured * X.nhiRate * (union ? X.nhiUnionShare : X.nhiShare) * heads * 12;
  const nhi2 = union ? 0 : Math.max(0, bonus - insured * 4) * X.nhi2Rate;
  const gross = income * 12 + bonus - Math.min(income, X.lpCap) * self * 12;
  const net = gross - X.exemption * (1 + kids) - X.standard - Math.min(X.salaryDed, gross);
  const tax = incomeTax(Math.max(0, net));
  const insurance = li + nhi + nhi2;
  return { insurance, tax, total: insurance + tax };
}
