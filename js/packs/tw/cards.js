// 台灣版事件卡庫。type: chance(機會)/ crisis(危機)/ choice(抉擇)
// effect 欄位:attrs、cashMonths(以月收入為單位的一次性現金)、expMonths(以月支出為單位)、
// incomePct、expensePct、expenseAbs、set、flag、run(自訂)、chance{p, attr, success, fail}
import { fmt, buyHouse, downPayment, housePrice, pack } from '../../engine.js';

const RISK = new Proxy({}, { get: (_, k) => pack().risk[k] });

const setRisk = (key) => ({
  run(s, L) {
    if (s.risk === key) {
      L.push({ text: `維持${RISK[key].name}型配置`, tone: 'info' });
      return;
    }
    s.risk = key;
    const total = s.cash + s.invest;
    if (total > 0) {
      s.invest = total * RISK[key].share;
      s.cash = total - s.invest;
    }
    L.push({ text: `改為${RISK[key].name}型:投資 ${fmt(s.invest)}、現金 ${fmt(s.cash)}`, tone: 'info' });
  },
});

export const CARDS = [
  // ---------- 職涯 ----------
  {
    id: 'headhunter', type: 'chance', title: '獵頭來電',
    text: '一家同業透過獵頭找上你,開出的條件比現在好,但你對那邊的文化一無所知。',
    when: (s) => s.attrs.career >= 40,
    choices: [
      { label: '跳槽', effect: { chance: { p: 0.6, attr: 'career',
        success: { note: '新環境適應得不錯。', incomePct: 0.18, attrs: { career: 6, mind: -2, relation: -2 } },
        fail: { note: '薪水是漲了一點,但文化不合,做得很悶。', incomePct: 0.05, attrs: { career: -3, mind: -6 } } } } },
      { label: '拿 offer 回頭談加薪', effect: { chance: { p: 0.45, attr: 'career',
        success: { note: '主管願意留你。', incomePct: 0.08, attrs: { career: 2 } },
        fail: { note: '主管覺得你有二心。', attrs: { relation: -4, career: -2 } } } } },
      { label: '婉拒', effect: { note: '你決定先把手上的事做好。', attrs: { mind: 2 } } },
    ],
  },
  {
    id: 'promo', type: 'chance', title: '主管缺出現',
    text: '部門主管調走,上面問你要不要接。薪水會加,但會議和責任也會加倍。',
    when: (s) => s.attrs.career >= 50 && s.industry !== 'free',
    choices: [
      { label: '接下管理職', effect: { incomePct: 0.1, attrs: { career: 8, health: -4, mind: -4 }, flag: { overwork: true, manager: true } } },
      { label: '留在專業職', effect: { note: '你選擇繼續把技術做深。', attrs: { career: 2, mind: 2 } } },
    ],
  },
  {
    id: 'layoff', type: 'crisis', title: '裁員風聲',
    text: '公司業績不好,茶水間開始流傳裁員名單。',
    when: (s) => s.industry !== 'public' && s.industry !== 'free',
    weight: (s) => (s.industry === 'tech' || s.industry === 'manu' ? 1.3 : 0.9),
    choices: [
      { label: '先投履歷找退路', effect: { chance: { p: 0.55, attr: 'career',
        success: { note: '你在被裁之前先找到新工作。', incomePct: 0.05, attrs: { career: 3 } },
        fail: { note: '面試了幾家都沒下文,幸好這波沒裁到你。', attrs: { mind: -4 } } } } },
      { label: '加倍表現爭取留下', effect: { chance: { p: 0.6, attr: 'career',
        success: { note: '你留下來了,但累得不輕。', attrs: { career: 4, health: -3 } },
        fail: { note: '還是被裁了,花了四個月才找到新工作。', cashMonths: -4, attrs: { career: -6, mind: -8 } } } } },
      { label: '觀望', effect: { chance: { p: 0.65,
        success: { note: '這波沒有輪到你。' },
        fail: { note: '你在名單上。扣掉資遣費,空窗期等於少了三個月收入。', cashMonths: -3, attrs: { career: -6, mind: -8 } } } } },
    ],
  },
  {
    id: 'study', type: 'choice', title: '進修的念頭', once: true,
    text: '你覺得現在的能力快到天花板了,開始考慮進修。',
    choices: [
      { label: '念在職碩士', effect: { cashMonths: -8, incomePct: 0.05, attrs: { career: 10, health: -3, relation: -3, mind: -2 }, flag: { degree: true } } },
      { label: '上線上課程', effect: { cashMonths: -0.5, attrs: { career: 4 } } },
      { label: '先不進修', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'sidejob', type: 'chance', title: '副業機會',
    text: '有人想找你下班後接案,錢不少,但會吃掉晚上和假日。',
    choices: [
      { label: '接下來', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '案子做出口碑,變成穩定的額外收入。', incomePct: 0.08, attrs: { career: 3, health: -3 }, flag: { side: true } },
        fail: { note: '客戶難搞又拖款,白忙一場。', cashMonths: -0.5, attrs: { health: -4, mind: -4 } } } } },
      { label: '不接', effect: { note: '你把時間留給休息。', attrs: { health: 1 } } },
    ],
  },
  {
    id: 'startup', type: 'choice', title: '朋友找你創業', once: true,
    text: '老朋友有個點子,想拉你當共同創辦人。多數新創撐不過五年,但成功的那些回報很大。',
    when: (s) => s.cash + s.invest >= s.income * 12,
    choices: [
      { label: '辭職全力創業', effect: { chance: { p: 0.2, attr: 'career',
        success: { note: '公司活下來並開始獲利。', incomePct: 0.8, attrs: { career: 15, mind: 8 }, flag: { founder: true } },
        fail: { note: '燒了一年積蓄後收掉,回去上班薪水還比以前低。', cashMonths: -12, incomePct: -0.1, attrs: { career: 3, mind: -8, health: -4 } } } } },
      { label: '下班兼著做', effect: { chance: { p: 0.25, attr: 'career',
        success: { note: '小生意穩定下來,多了一份收入。', incomePct: 0.15, attrs: { career: 6, health: -4 } },
        fail: { note: '兩頭燒,最後不了了之。', cashMonths: -2, attrs: { health: -5, relation: -3 } } } } },
      { label: '婉拒', effect: { note: '你祝他順利。', attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'abroad', type: 'chance', title: '外派機會', once: true,
    text: '公司問你願不願意外派兩年,有加給,但要離開現在的生活圈。',
    when: (s) => s.industry !== 'free' && s.industry !== 'public',
    choices: [
      { label: '去', effect: { incomePct: 0.2, attrs: { career: 8, relation: -8, mind: -2 }, flag: { abroad: true } } },
      { label: '不去', effect: { note: '你選擇留在熟悉的人身邊。', attrs: { relation: 3 } } },
    ],
  },
  {
    id: 'ai', type: 'crisis', title: 'AI 衝擊你的工作',
    text: '公司導入 AI 工具,你工作中有一部分明顯可以被取代。',
    choices: [
      { label: '主動學會用 AI', effect: { cashMonths: -0.3, attrs: { career: 6, mind: -1 } } },
      { label: '轉向 AI 難取代的職務', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '轉型成功,你變成帶 AI 做事的人。', incomePct: 0.05, attrs: { career: 8 } },
        fail: { note: '新職務做不順,考績受影響。', incomePct: -0.05, attrs: { career: -4 } } } } },
      { label: '不理會', effect: { chance: { p: 0.5,
        success: { note: '暫時沒有影響到你。' },
        fail: { note: '你的職務被縮編,調薪凍結還被減了津貼。', incomePct: -0.08, attrs: { career: -6 } } } } },
    ],
  },
  {
    id: 'overtime', type: 'crisis', title: '專案爆量',
    text: '三個專案同時壓到你身上,交期都在下個月。',
    choices: [
      { label: '全部扛下來', effect: { cashMonths: 1, attrs: { career: 6, health: -6, mind: -5 } } },
      { label: '爭取資源、推掉一部分', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '主管同意調人,專案順利交付。', attrs: { career: 3, mind: 2 } },
        fail: { note: '主管覺得你在推工作。', attrs: { career: -3, relation: -2 } } } } },
      { label: '做多少算多少', effect: { attrs: { career: -5, mind: 2 } } },
    ],
  },

  // ---------- 財務 ----------
  {
    id: 'rent', type: 'crisis', title: '房東要漲租',
    text: '房東傳訊息說下個月起房租要調漲。',
    when: (s) => !s.house,
    choices: [
      { label: '接受', effect: { expensePct: 0.04 } },
      { label: '跟房東談', effect: { chance: { p: 0.45, attr: 'relation',
        success: { note: '房東同意維持原價。' },
        fail: { note: '房東不讓步。', expensePct: 0.04, attrs: { mind: -2 } } } } },
      { label: '搬到便宜的地方', effect: { expMonths: -1, expensePct: -0.05, attrs: { mind: -3, relation: -2 } } },
    ],
  },
  {
    id: 'buyhouse', type: 'choice', title: '看到喜歡的房子', cooldown: 3,
    text: '',
    dynamicText: (s) => `你看中一間 ${fmt(housePrice(s))} 的房子。頭期款兩成 ${fmt(downPayment(s))},其餘貸款 30 年。`,
    when: (s) => !s.house && s.cash + s.invest >= downPayment(s) * 1.05,
    weight: () => 1.5,
    choices: [
      { label: '買', effect: { run: buyHouse, attrs: { mind: 3 } } },
      { label: '再等等', effect: { note: '你決定繼續租屋,把錢留在手上。', attrs: { mind: -1 } } },
    ],
  },
  {
    id: 'crash', type: 'crisis', title: '股市重挫',
    text: '市場一口氣跌了 20%,新聞一片悲觀。',
    when: (s) => s.invest >= s.income * 3,
    choices: [
      { label: '全部賣出', effect: { run(s, L) {
        const loss = s.invest * 0.2;
        s.cash += s.invest - loss;
        s.invest = 0;
        L.push({ text: `認賠 ${fmt(loss)},其餘轉回現金`, tone: 'down' });
      }, attrs: { mind: -4 } } },
      { label: '放著不動', effect: { run(s, L) {
        const loss = s.invest * 0.2;
        s.invest -= loss;
        s.flags.rebound = true;
        L.push({ text: `帳面損失 ${fmt(loss)},年底有機會反彈`, tone: 'down' });
      }, attrs: { mind: -3 } } },
      { label: '拿現金加碼', effect: { run(s, L) {
        const loss = s.invest * 0.2;
        const add = Math.max(s.cash, 0) * 0.4;
        s.invest += add - loss;
        s.cash -= add;
        s.flags.rebound = true;
        L.push({ text: `帳面損失 ${fmt(loss)},加碼 ${fmt(add)},年底有機會反彈`, tone: 'info' });
      }, attrs: { mind: -1 } } },
    ],
  },
  {
    id: 'lend', type: 'choice', title: '朋友開口借錢',
    text: '認識多年的朋友周轉不靈,想跟你借一筆錢,金額大約是你三個月的收入。',
    when: (s) => s.cash >= s.income * 3,
    choices: [
      { label: '借', effect: { chance: { p: 0.5, attr: 'relation',
        success: { note: '他半年後連本帶謝禮還清了。', attrs: { relation: 6 } },
        fail: { note: '錢沒有回來,人也不太聯絡了。', cashMonths: -3, attrs: { relation: -6, mind: -4 }, flag: { owed: true } } } } },
      { label: '給一小筆,不用還', effect: { cashMonths: -1, attrs: { relation: 3 } } },
      { label: '婉拒', effect: { attrs: { relation: -4 } } },
    ],
  },
  {
    id: 'tip', type: 'choice', title: '同事報明牌',
    text: '同事神秘地說有一檔「一定會漲」的股票,勸你趕快進場。',
    when: (s) => s.cash >= s.income * 5,
    choices: [
      { label: '重押', effect: { chance: { p: 0.35,
        success: { note: '真的漲了,你在高點出場。', cashMonths: 6 },
        fail: { note: '進場後一路下跌,停損出場。', cashMonths: -5, attrs: { mind: -5 } } } } },
      { label: '小小試一下', effect: { chance: { p: 0.35,
        success: { note: '小賺一筆。', cashMonths: 1 },
        fail: { note: '小賠出場。', cashMonths: -1 } } } },
      { label: '不跟', effect: { note: '你沒有理會。', attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'repair', type: 'crisis', title: '突發大筆支出',
    text: '冷氣壞了、牙齒要做根管、機車也該大修,全擠在同一個月。',
    choices: [
      { label: '一次處理好', effect: { expMonths: -1.5 } },
      { label: '能拖就拖', effect: { chance: { p: 0.5,
        success: { note: '暫時撐過去了。' },
        fail: { note: '小問題拖成大問題,花了兩倍的錢。', expMonths: -3, attrs: { health: -3 } } } } },
    ],
  },
  {
    id: 'insurance', type: 'choice', title: '保險規劃', once: true,
    text: '你開始想,萬一生病或出意外,現在的保障夠不夠。',
    choices: [
      { label: '買基本醫療和意外險', effect: { expensePct: 0.03, flag: { insured: true }, attrs: { mind: 2 } } },
      { label: '買大額儲蓄險', effect: { note: '保費很高,保障卻有限。', expensePct: 0.1, attrs: { mind: 1 } } },
      { label: '不買', effect: { note: '你決定把錢留著自己運用。' } },
    ],
  },
  {
    id: 'windfall', type: 'chance', title: '意外之財',
    text: '公司發了額外獎金,金額大約是一個半月的收入。',
    choices: [
      { label: '全部存起來', effect: { cashMonths: 1.5 } },
      { label: '存一部分,犒賞自己', effect: { cashMonths: 0.5, attrs: { mind: 5 } } },
      { label: '存一部分,請家人朋友', effect: { cashMonths: 0.5, attrs: { relation: 5 } } },
    ],
  },
  {
    id: 'review', type: 'choice', title: '理財檢視', cooldown: 5,
    text: '年初你重新檢視資產配置。保守型波動小、報酬低;積極型長期報酬高,但單年可能大跌。',
    when: (s) => s.cash + s.invest > 0,
    choices: [
      { label: '保守型(現金八成)', effect: setRisk('low') },
      { label: '平衡型(各半)', effect: setRisk('mid') },
      { label: '積極型(投資八成)', effect: setRisk('high') },
    ],
  },

  // ---------- 健康 ----------
  {
    id: 'checkup', type: 'crisis', title: '健檢紅字',
    text: '健檢報告出現好幾個紅字,醫師建議你調整作息並回診追蹤。',
    when: (s) => s.age >= 30,
    weight: (s) => (s.attrs.health < 50 ? 1.6 : 0.8),
    choices: [
      { label: '認真調整並回診', effect: { expMonths: -0.3, attrs: { health: 10, mind: 2 }, flag: { overwork: false } } },
      { label: '買保健食品應付', effect: { expMonths: -0.3, attrs: { health: 1 } } },
      { label: '先不管', effect: { chance: { p: 0.6,
        success: { note: '這一年沒出什麼事。' },
        fail: { note: '半年後住院了一週。', attrs: { health: -12, mind: -5 }, run(s, L) {
          const cost = s.expense * (s.flags.insured ? 1 : 4);
          s.cash -= cost;
          L.push({ text: `醫療與休養花費 −${fmt(cost)}${s.flags.insured ? '(保險理賠了大部分)' : '(沒有保險)'}`, tone: 'down' });
        } } } } },
    ],
  },
  {
    id: 'exercise', type: 'choice', title: '朋友揪你運動',
    text: '朋友報名了健身房,問你要不要一起。',
    choices: [
      { label: '每週固定去', effect: { attrs: { health: 8, mind: 4, relation: 2, career: -1 }, flag: { fit: true } } },
      { label: '有空再去', effect: { attrs: { health: 3 } } },
      { label: '沒空', effect: { attrs: { health: -2 } } },
    ],
  },
  {
    id: 'burnout', type: 'crisis', title: '倦怠感',
    text: '你發現自己每天起床都不想上班,假日也提不起勁。',
    when: (s) => s.attrs.mind < 45 || s.flags.overwork,
    weight: () => 3,
    choices: [
      { label: '請長假去旅行', effect: { expMonths: -1.5, attrs: { mind: 12, health: 3, career: -2 }, flag: { overwork: false } } },
      { label: '找心理諮商', effect: { expMonths: -0.5, attrs: { mind: 8 } } },
      { label: '硬撐', effect: { attrs: { mind: -6, health: -4, career: 2 } } },
    ],
  },

  // ---------- 關係 ----------
  {
    id: 'meet', type: 'chance', title: '認識新對象',
    text: '朋友聚會上認識了一個聊得來的人,對方也對你有好感。',
    when: (s) => s.status === 'single',
    weight: () => 2,
    choices: [
      { label: '認真交往', effect: { set: { status: 'partner' }, expensePct: 0.04, attrs: { relation: 10, mind: 6 } } },
      { label: '先專注自己', effect: { attrs: { career: 2 } } },
    ],
  },
  {
    id: 'marry', chain: true, type: 'choice', title: '談到結婚', cooldown: 2,
    text: '交往穩定後,對方提起結婚的事。婚禮和新家要花一筆錢,但兩個人分擔生活費會比較省。',
    when: (s) => s.status === 'partner',
    weight: () => 4,
    choices: [
      { label: '結婚', effect: { cashMonths: -6, set: { status: 'married' }, expensePct: -0.08, attrs: { relation: 10, mind: 5 } } },
      { label: '再等等', effect: { chance: { p: 0.7, attr: 'relation',
        success: { note: '對方願意再等一陣子。' },
        fail: { note: '兩人對未來的想法不同,最後分手了。', set: { status: 'single' }, expensePct: -0.04, attrs: { relation: -12, mind: -10 } } } } },
    ],
  },
  {
    id: 'kid', type: 'choice', title: '要不要生小孩', cooldown: 3,
    text: '你們開始討論要不要生小孩。養育費用每月大約增加 2.7 萬(未滿 5 歲每月有 5,000 元育兒津貼),時間也會被大量佔用。',
    when: (s) => s.status === 'married' && s.kids < 2 && s.age < 43,
    weight: (s) => (s.kids ? 1.5 : 3),
    choices: [
      { label: '生', effect: { run(s) { s.kids += 1; }, expenseAbs: 2.7, attrs: { relation: 8, mind: 2, health: -3, career: -4 } } },
      { label: '先不要', effect: { note: '你們決定維持現在的生活。', attrs: { relation: -1 } } },
    ],
  },
  {
    id: 'parent', type: 'crisis', title: '父母健康亮紅燈', cooldown: 6,
    text: '家裡長輩住院後需要有人長期照顧。',
    when: (s) => s.age >= 32,
    choices: [
      { label: '自己照顧', effect: { attrs: { career: -6, health: -3, relation: 8, mind: -4 } } },
      { label: '請看護分擔', effect: { expenseAbs: 1.2, attrs: { relation: 3 } } },
      { label: '交給其他家人', effect: { attrs: { relation: -8, mind: -3 } } },
    ],
  },
  {
    id: 'reunion', type: 'chance', title: '老朋友聚會',
    text: '多年沒見的朋友約吃飯,但你這週已經很累了。',
    choices: [
      { label: '去,而且之後保持聯絡', effect: { expMonths: -0.1, attrs: { relation: 6, mind: 3 } } },
      { label: '太累,不去', effect: { attrs: { relation: -3, health: 1 } } },
    ],
  },
  {
    id: 'quarrel', type: 'crisis', title: '和伴侶起爭執',
    text: '為了錢和家事分工,你們最近吵了好幾次。',
    when: (s) => s.status !== 'single',
    choices: [
      { label: '找時間好好談', effect: { attrs: { relation: 6, mind: -1 } } },
      { label: '一起做伴侶諮商', effect: { expMonths: -0.5, attrs: { relation: 8, mind: 2 } } },
      { label: '冷處理', effect: { attrs: { relation: -6, mind: -2 } } },
    ],
  },
  {
    id: 'school', chain: true, type: 'choice', title: '孩子的教育',
    text: '孩子到了上學的年紀,身邊的家長都在討論私校和才藝班。',
    when: (s) => s.kids > 0,
    weight: () => 2.5,
    choices: [
      { label: '私校加才藝班', effect: { expenseAbs: 1, attrs: { relation: 3, mind: -1 } } },
      { label: '公立學校,自己多陪', effect: { attrs: { relation: 5, career: -2, health: -1 } } },
      { label: '順其自然', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'pet', type: 'choice', title: '想養寵物', once: true,
    text: '你在認養會上看到一隻一直盯著你的狗。',
    choices: [
      { label: '帶牠回家', effect: { expenseAbs: 0.3, attrs: { mind: 8, relation: 2, health: 2 }, flag: { pet: true } } },
      { label: '現在還不適合', effect: { attrs: { mind: -1 } } },
    ],
  },
  {
    id: 'volunteer', type: 'chance', title: '社區找志工',
    text: '里長問你週末能不能來幫忙社區活動。',
    choices: [
      { label: '固定參加', effect: { attrs: { relation: 6, mind: 3, health: -1 } } },
      { label: '偶爾幫忙', effect: { attrs: { relation: 2 } } },
      { label: '婉拒', effect: { attrs: { health: 1 } } },
    ],
  },

  // ---------- 前面選擇的後續 ----------
  {
    id: 'resign', chain: true, type: 'crisis', title: '下屬提離職', once: true,
    text: '你當主管後最倚重的下屬說他想離開,理由是工作量太大。',
    when: (s) => s.flags.manager,
    weight: () => 2,
    choices: [
      { label: '幫他爭取加薪留人', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '公司同意加薪,他留下來了。', attrs: { career: 4, relation: 2 } },
        fail: { note: '公司不同意,他還是走了。', attrs: { career: -3, mind: -2 } } } } },
      { label: '讓他走,工作自己扛', effect: { attrs: { career: 2, health: -4, mind: -3 } } },
      { label: '重新分配團隊工作', effect: { attrs: { relation: 4, career: 1, mind: -2 } } },
    ],
  },
  {
    id: 'investor', chain: true, type: 'chance', title: '投資人上門', once: true,
    text: '你的公司做出成績,有投資人想注資讓你擴張。',
    when: (s) => s.flags.founder,
    weight: () => 2.5,
    choices: [
      { label: '拿錢擴張', effect: { chance: { p: 0.4, attr: 'career',
        success: { note: '擴張成功,營收翻倍。', incomePct: 0.5, attrs: { career: 8, health: -5 } },
        fail: { note: '擴張太快,資金鏈吃緊,只好縮編。', incomePct: -0.2, attrs: { mind: -8, health: -4 } } } } },
      { label: '維持小而美', effect: { attrs: { mind: 4, health: 2 } } },
      { label: '把公司賣掉', effect: { note: '你拿到一筆錢,回去當上班族。', cashMonths: 30, incomePct: -0.3, attrs: { career: -3, mind: 5 }, flag: { founder: false } } },
    ],
  },
  {
    id: 'return', chain: true, type: 'choice', title: '外派期滿', once: true,
    text: '兩年外派結束,公司問你要回來還是留在當地。',
    when: (s) => s.flags.abroad,
    weight: () => 2.5,
    choices: [
      { label: '回來', effect: { incomePct: 0.05, attrs: { career: 4, relation: 6 } } },
      { label: '留在當地發展', effect: { incomePct: 0.1, expensePct: 0.1, attrs: { career: 5, relation: -6 } } },
    ],
  },
  {
    id: 'alumni', chain: true, type: 'chance', title: '學長姐內推', once: true,
    text: '碩士班的學長在一家不錯的公司當主管,問你有沒有興趣過去。',
    when: (s) => s.flags.degree,
    weight: () => 2,
    choices: [
      { label: '去面試', effect: { chance: { p: 0.6, attr: 'career',
        success: { note: '順利錄取,薪水明顯提高。', incomePct: 0.12, attrs: { career: 5 } },
        fail: { note: '最後一關沒過。', attrs: { mind: -2 } } } } },
      { label: '留在原公司', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'repay', chain: true, type: 'chance', title: '欠錢的朋友回來了', once: true,
    text: '之前沒還錢的朋友突然聯絡你,說他現在只拿得出一半。',
    when: (s) => s.flags.owed,
    weight: () => 2,
    choices: [
      { label: '收下,不再計較', effect: { cashMonths: 1.5, attrs: { relation: 4, mind: 3 } } },
      { label: '堅持全額', effect: { chance: { p: 0.4,
        success: { note: '他又湊了幾個月,全部還清。', cashMonths: 3 },
        fail: { note: '他又失聯了。', attrs: { relation: -3, mind: -2 } } } } },
    ],
  },
  {
    id: 'leak', type: 'crisis', title: '房子漏水',
    text: '梅雨季後天花板出現水痕,師傅說要整面重做防水。',
    when: (s) => s.house,
    choices: [
      { label: '整面重做', effect: { expMonths: -2 } },
      { label: '先補一補', effect: { expMonths: -0.3, chance: { p: 0.4,
        success: { note: '撐住了,沒有再漏。' },
        fail: { note: '隔年漏得更嚴重,連樓下都要賠。', expMonths: -3.5, attrs: { mind: -3 } } } } },
    ],
  },

  // ---------- 年齡階段 ----------
  {
    id: 'civil', type: 'choice', title: '考公職的念頭', once: true,
    text: '看到朋友考上公職後生活穩定,你開始動搖。錄取率很低,準備期間也有代價。',
    when: (s) => s.age < 33 && s.industry !== 'public',
    choices: [
      { label: '辭職全力準備一年', effect: { cashMonths: -10, chance: { p: 0.25,
        success: { note: '上榜了。薪水成長慢,但非常穩定。', set: { industry: 'public' }, attrs: { mind: 8, career: 2 } },
        fail: { note: '落榜,回到職場重新找工作。', attrs: { mind: -6, career: -4 } } } } },
      { label: '下班後準備', effect: { chance: { p: 0.1,
        success: { note: '居然考上了。', set: { industry: 'public' }, attrs: { mind: 8, career: 2 } },
        fail: { note: '兩頭顧不來,沒有考上。', attrs: { health: -3, mind: -3 } } } } },
      { label: '不考', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'gapyear', type: 'choice', title: '出國一年', once: true,
    text: '打工度假的簽證有年齡限制,再不去就沒機會了。',
    when: (s) => s.age < 31 && s.status !== 'married',
    choices: [
      { label: '去', effect: { cashMonths: -6, attrs: { mind: 10, relation: 3, career: -3 } } },
      { label: '不去', effect: { attrs: { mind: -2, career: 1 } } },
    ],
  },
  {
    id: 'midcareer', type: 'choice', title: '中年轉職',
    text: '你在這一行待了很久,越來越覺得沒有發展。轉換跑道要從比較低的位置重新開始。',
    when: (s) => s.age >= 40 && s.attrs.career < 65,
    weight: () => 1.4,
    choices: [
      { label: '轉換跑道', effect: { chance: { p: 0.4, attr: 'career',
        success: { note: '過去的經驗在新領域很吃香。', incomePct: 0.1, attrs: { career: 8, mind: 6 } },
        fail: { note: '新領域只願意給資淺的薪水。', incomePct: -0.15, attrs: { career: -5, mind: -5 } } } } },
      { label: '留在原本的行業', effect: { attrs: { mind: -3 } } },
    ],
  },
  {
    id: 'earlyretire', type: 'choice', title: '優退方案', once: true,
    text: '公司推出優退方案,一次給一年半的薪水。離開後只能找薪水較低的工作。',
    when: (s) => s.age >= 48 && s.industry !== 'free',
    weight: () => 1.5,
    choices: [
      { label: '接受優退', effect: { cashMonths: 18, incomePct: -0.4, attrs: { career: -10, health: 6, mind: 4 }, flag: { overwork: false } } },
      { label: '留任', effect: { attrs: { career: -1 } } },
    ],
  },
  {
    id: 'classmates', type: 'choice', title: '同學會',
    text: '同學會上有人當了主管,有人買了第二間房,回家路上你有點悶。',
    when: (s) => s.age >= 33,
    choices: [
      { label: '每個人的步調不同', effect: { attrs: { mind: 3, relation: 2 } } },
      { label: '回去更拚', effect: { attrs: { career: 3, mind: -3, health: -2 } } },
    ],
  },

  // ---------- 大環境與日常 ----------
  {
    id: 'inflation', type: 'crisis', title: '物價大漲',
    text: '這一年什麼都在漲,便當、房租、電費無一倖免。',
    choices: [
      { label: '照常過日子', effect: { expensePct: 0.05 } },
      { label: '開始記帳,砍掉不必要的', effect: { expensePct: 0.02, attrs: { mind: -1 } } },
      { label: '大幅省吃儉用', effect: { expensePct: -0.01, attrs: { mind: -4, relation: -2 } } },
    ],
  },
  {
    id: 'lifestyle', type: 'choice', title: '生活升級的誘惑', once: true,
    text: '收入比以前好了,你開始看更好的租屋、更新的手機、更貴的餐廳。',
    when: (s) => s.income > s.profile.income * 1.1,
    weight: () => 1.5,
    choices: [
      { label: '該享受就享受', effect: { expensePct: 0.08, attrs: { mind: 5 } } },
      { label: '維持原本的生活', effect: { note: '之後收入增加時,花費跟著升級的幅度會比較小。', flag: { frugal: true }, attrs: { mind: -1 } } },
    ],
  },
  {
    id: 'scam', type: 'crisis', title: '高報酬投資群組',
    text: '有人把你拉進一個群組,老師每天貼對帳單,說保證月報酬 10%。',
    when: (s) => s.cash >= s.income * 4,
    choices: [
      { label: '先投一筆試試', effect: { chance: { p: 0.08,
        success: { note: '你在平台關閉前把錢領了出來。', cashMonths: 2 },
        fail: { note: '平台某天打不開了,錢全部消失。', cashMonths: -8, attrs: { mind: -8 } } } } },
      { label: '查證後退出並檢舉', effect: { note: '查了一下,這是典型的詐騙手法。', attrs: { mind: 1 }, flag: { scamproof: true } } },
    ],
  },
  {
    id: 'esop', type: 'chance', title: '員工認股',
    text: '公司開放員工用折扣價認購股票,但要閉鎖兩年。',
    when: (s) => (s.industry === 'tech' || s.industry === 'finance' || s.industry === 'manu') && s.cash >= s.income * 3,
    choices: [
      { label: '認購', effect: { chance: { p: 0.6,
        success: { note: '解鎖時股價比認購價高出不少。', cashMonths: 4 },
        fail: { note: '解鎖時股價已經跌破認購價。', cashMonths: -2.5 } } } },
      { label: '不認購', effect: { note: '你不想把收入和投資都押在同一家公司。' } },
    ],
  },
  {
    id: 'hobby', type: 'chance', title: '想學點新東西',
    text: '你一直想學的東西(樂器、烘焙、潛水)附近剛好開了課。',
    choices: [
      { label: '報名', effect: { expMonths: -0.4, attrs: { mind: 6, relation: 2 } } },
      { label: '下次吧', effect: { attrs: { mind: -1 } } },
    ],
  },

  // ---------- 第二批:職涯 ----------
  {
    id: 'mentor', type: 'chance', title: '前輩願意帶你',
    text: '一位你很佩服的前輩說,有問題可以固定找他聊。',
    choices: [
      { label: '每個月固定請教', effect: { attrs: { career: 5, relation: 2 } } },
      { label: '遇到問題再問', effect: { attrs: { career: 2 } } },
      { label: '不好意思麻煩人家', effect: { attrs: { mind: -1 } } },
    ],
  },
  {
    id: 'raise', type: 'chance', title: '年度調薪面談',
    text: '主管約你談明年的薪水。公司預設的調幅不高,要不要開口爭取?',
    when: (s) => s.industry !== 'free' && s.industry !== 'public',
    choices: [
      { label: '拿成果開口爭取', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '主管幫你爭取到比別人高的調幅。', incomePct: 0.06, attrs: { career: 2, mind: 3 } },
        fail: { note: '主管說預算有限,氣氛有點尷尬。', incomePct: 0.01, attrs: { relation: -2, mind: -2 } } } } },
      { label: '接受公司給的調幅', effect: { incomePct: 0.02 } },
    ],
  },
  {
    id: 'speak', type: 'chance', title: '受邀上台分享',
    text: '業界的研討會邀你當講者,台下會有兩百個同行。',
    when: (s) => s.attrs.career >= 55,
    choices: [
      { label: '答應', effect: { chance: { p: 0.6, attr: 'career',
        success: { note: '講得很好,會後好幾個人來換名片。', attrs: { career: 6, relation: 3, mind: 3 } },
        fail: { note: '緊張到忘詞,下台後懊惱了好幾天。', attrs: { career: 1, mind: -4 } } } } },
      { label: '推薦同事去', effect: { attrs: { relation: 2 } } },
    ],
  },
  {
    id: 'cert', type: 'chance', title: '公司補助考證照',
    text: '公司願意出報名費,考過還有津貼,但要自己找時間念書。',
    when: (s) => s.industry !== 'free',
    choices: [
      { label: '報名', effect: { chance: { p: 0.55, attr: 'career',
        success: { note: '考過了,每個月多一筆證照津貼。', incomePct: 0.04, attrs: { career: 5 } },
        fail: { note: '差幾分沒過,假日都賠進去了。', attrs: { health: -2, mind: -3 } } } } },
      { label: '這次先不要', effect: { attrs: { health: 1 } } },
    ],
  },
  {
    id: 'bigclient', type: 'chance', title: '大客戶想簽長約',
    text: '一個大客戶想包下你大部分的時間,收入會穩定很多,但你會變得很依賴他。',
    when: (s) => s.industry === 'free',
    weight: () => 1.6,
    choices: [
      { label: '簽下去', effect: { chance: { p: 0.65, attr: 'career',
        success: { note: '合作順利,收入穩定又成長。', incomePct: 0.18, attrs: { career: 4, health: -3 } },
        fail: { note: '客戶中途換窗口,合約提前結束,其他客戶也流失了。', incomePct: -0.1, attrs: { mind: -5 } } } } },
      { label: '只接一部分,保留其他客戶', effect: { incomePct: 0.06, attrs: { career: 2 } } },
    ],
  },
  {
    id: 'sidebiz', chain: true, type: 'choice', title: '副業越做越大', once: true,
    text: '副業的收入快追上正職了,客戶還在增加。兩邊都顧,身體開始吃不消。',
    when: (s) => s.flags.side && s.industry !== 'free',
    weight: () => 3,
    choices: [
      { label: '辭掉正職專心做', effect: { chance: { p: 0.5, attr: 'career',
        success: { note: '全職投入後,收入超過以前的薪水。', incomePct: 0.25, set: { industry: 'free' }, attrs: { career: 6, mind: 5 } },
        fail: { note: '少了正職的穩定收入,淡季很難熬。', incomePct: -0.15, set: { industry: 'free' }, attrs: { mind: -6 } } } } },
      { label: '兩邊繼續兼顧', effect: { cashMonths: 2, attrs: { health: -6, mind: -3 }, flag: { overwork: true } } },
      { label: '把副業縮小', effect: { incomePct: -0.04, attrs: { health: 3, mind: 2 }, flag: { side: false } } },
    ],
  },
  {
    id: 'conflict', type: 'crisis', title: '和同事起衝突',
    text: '合作的同事把出包的責任推到你身上,而且是在會議上當著大家的面。',
    when: (s) => s.industry !== 'free',
    choices: [
      { label: '私下找他講清楚', effect: { chance: { p: 0.55, attr: 'relation',
        success: { note: '他道歉了,之後合作反而比較順。', attrs: { relation: 4, mind: 2 } },
        fail: { note: '他不認帳,兩人從此只談公事。', attrs: { relation: -3, mind: -3 } } } } },
      { label: '把紀錄整理好交給主管', effect: { attrs: { career: 2, relation: -3 } } },
      { label: '吞下來', effect: { attrs: { career: -2, mind: -5 } } },
    ],
  },

  // ---------- 第二批:財務 ----------
  {
    id: 'car', type: 'choice', title: '要不要買車', once: true,
    text: '通勤和出遊都不方便,你開始看車。車子除了車價,每個月還有油錢、停車、保險和保養。',
    when: (s) => s.cash + s.invest >= s.income * 8,
    choices: [
      { label: '買新車', effect: { cashMonths: -10, expenseAbs: 0.9, attrs: { mind: 5, relation: 3 } } },
      { label: '買二手車', effect: { cashMonths: -4, expenseAbs: 0.7, attrs: { mind: 3, relation: 2 } } },
      { label: '繼續搭大眾運輸', effect: { attrs: { health: 1, mind: -1 } } },
    ],
  },
  {
    id: 'move', type: 'choice', title: '搬離市中心', once: true,
    text: '同樣的租金,郊區可以租到大一倍的房子,但通勤時間會變成兩倍。',
    when: (s) => !s.house,
    choices: [
      { label: '搬到郊區', effect: { chance: { p: 0.55,
        success: { note: '你習慣了通勤,空間變大後生活品質好很多。', expensePct: -0.1, attrs: { mind: 3 } },
        fail: { note: '每天通勤三小時,省下的錢換來滿身疲憊。', expensePct: -0.1, attrs: { health: -4, mind: -4, relation: -2 } } } } },
      { label: '留在市中心', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'rentout', type: 'chance', title: '空房可以出租', once: true,
    text: '家裡有一個房間一直空著,仲介說租給學生每個月可以多一筆收入。',
    when: (s) => s.house && s.kids === 0,
    choices: [
      { label: '出租', effect: { chance: { p: 0.7, attr: 'relation',
        success: { note: '房客很好相處,租金穩定入帳。', expenseAbs: -0.8 },
        fail: { note: '房客生活習慣很差,你花了很多力氣才請他搬走。', cashMonths: 0.5, attrs: { mind: -5 } } } } },
      { label: '留著自己用', effect: { attrs: { mind: 1 } } },
    ],
  },
  {
    id: 'angel', type: 'chance', title: '入股朋友的店',
    text: '朋友要開咖啡店,問你要不要出一筆錢當股東,不用顧店。',
    when: (s) => s.cash >= s.income * 6,
    choices: [
      { label: '入股', effect: { cashMonths: -4, chance: { p: 0.35,
        success: { note: '店做起來了,每年都有分紅。', incomePct: 0.06, attrs: { relation: 4 } },
        fail: { note: '店撐了一年多收掉,出資拿不回來。', attrs: { relation: -3, mind: -3 } } } } },
      { label: '不入股,開幕去捧場', effect: { expMonths: -0.1, attrs: { relation: 2 } } },
    ],
  },
  {
    id: 'subscription', type: 'choice', title: '檢查固定扣款',
    text: '信用卡帳單上有一排訂閱:影音、音樂、健身房、雲端空間,有幾個你已經很久沒用。',
    choices: [
      { label: '一個一個檢查,沒用的退掉', effect: { expensePct: -0.03, attrs: { mind: 1 } } },
      { label: '太麻煩,先放著', effect: { expensePct: 0.01 } },
    ],
  },
  {
    id: 'redenvelope', type: 'crisis', title: '紅白帖連發',
    text: '這一年朋友結婚、長輩過世、同事生小孩,禮金一包接一包。',
    when: (s) => s.age >= 26,
    choices: [
      { label: '該包的都包,人也到', effect: { expMonths: -1, attrs: { relation: 5 } } },
      { label: '禮到人不到', effect: { expMonths: -0.7, attrs: { relation: 1 } } },
      { label: '只包給最熟的', effect: { expMonths: -0.3, attrs: { relation: -3 } } },
    ],
  },

  // ---------- 第二批:健康 ----------
  {
    id: 'marathon', type: 'chance', title: '報名半程馬拉松',
    text: '朋友揪團報名三個月後的半馬,你從來沒跑過那麼遠。',
    weight: (s) => (s.flags.fit ? 1.6 : 1),
    choices: [
      { label: '報名並照表訓練', effect: { chance: { p: 0.6, attr: 'health',
        success: { note: '你跑完全程,衝線那一刻覺得自己什麼都做得到。', attrs: { health: 8, mind: 6, relation: 2 }, flag: { runner: true } },
        fail: { note: '練太急膝蓋受傷,比賽沒跑成。', expMonths: -0.3, attrs: { health: -3, mind: -2 } } } } },
      { label: '陪練就好,不報名', effect: { attrs: { health: 3, relation: 2 } } },
      { label: '不跑', effect: { attrs: { health: -1 } } },
    ],
  },
  {
    id: 'sleep', type: 'crisis', title: '長期睡不好',
    text: '你已經好幾個月半夜醒來就睡不回去,白天靠咖啡撐著。',
    when: (s) => s.attrs.mind < 60 || s.flags.overwork,
    choices: [
      { label: '去看睡眠門診', effect: { expMonths: -0.3, attrs: { health: 5, mind: 4 } } },
      { label: '睡前不滑手機、固定時間上床', effect: { chance: { p: 0.5, attr: 'mind',
        success: { note: '堅持了兩個月,睡眠慢慢回來了。', attrs: { health: 6, mind: 4 } },
        fail: { note: '撐不到兩週就破功。', attrs: { mind: -2 } } } } },
      { label: '繼續靠咖啡', effect: { attrs: { health: -5, mind: -3, career: 1 } } },
    ],
  },
  {
    id: 'injury', type: 'crisis', title: '騎車摔傷',
    text: '下雨天騎車打滑,手骨折,要開刀再休養一個多月。',
    choices: [
      { label: '好好休養到復原', effect: { attrs: { health: -3, career: -2 }, run(s, L) {
        const cost = s.expense * (s.flags.insured ? 0.3 : 1.5);
        s.cash -= cost;
        L.push({ text: `手術與休養花費 −${fmt(cost)}${s.flags.insured ? '(保險理賠了大部分)' : '(沒有保險)'}`, tone: 'down' });
      } } },
      { label: '拆了石膏就回去上班', effect: { run(s, L) {
        const cost = s.expense * (s.flags.insured ? 0.3 : 1.2);
        s.cash -= cost;
        L.push({ text: `手術花費 −${fmt(cost)}${s.flags.insured ? '(保險理賠了大部分)' : '(沒有保險)'}`, tone: 'down' });
      }, chance: { p: 0.5, attr: 'health',
        success: { note: '恢復得比預期快。', attrs: { health: -2 } },
        fail: { note: '沒養好留下後遺症,變天就痠痛。', attrs: { health: -8, mind: -2 } } } } },
    ],
  },
  {
    id: 'chronic', type: 'crisis', title: '血壓血糖偏高', cooldown: 5,
    text: '醫師說你的血壓和血糖都在邊緣,再不控制就要長期吃藥。',
    when: (s) => s.age >= 42,
    weight: (s) => (s.attrs.health < 50 ? 1.8 : 1),
    choices: [
      { label: '改飲食、固定運動', effect: { attrs: { health: 8, mind: -1 } } },
      { label: '開始吃藥控制', effect: { expenseAbs: 0.15, attrs: { health: 4 } } },
      { label: '覺得沒那麼嚴重', effect: { chance: { p: 0.45,
        success: { note: '這一年數字沒有再惡化。' },
        fail: { note: '數字繼續變差,醫師要求立刻用藥並減少工作量。', expenseAbs: 0.2, attrs: { health: -10, career: -3 } } } } },
    ],
  },
  {
    id: 'cook', type: 'chance', title: '開始自己煮',
    text: '外食越來越貴又油,你買了一組鍋子,想試試自己帶便當。',
    choices: [
      { label: '每週備餐', effect: { expensePct: -0.03, attrs: { health: 4, mind: 1 } } },
      { label: '週末才煮', effect: { expensePct: -0.01, attrs: { health: 2 } } },
      { label: '鍋子拿去蓋泡麵', effect: { expMonths: -0.1 } },
    ],
  },

  // ---------- 第二批:關係與家庭 ----------
  {
    id: 'familytrip', type: 'chance', title: '家族旅行',
    text: '爸媽說想趁還走得動,全家一起出去玩一趟。',
    choices: [
      { label: '出錢出力,規劃全程', effect: { expMonths: -1, attrs: { relation: 8, mind: 3, health: -1 } } },
      { label: '出席,費用各付各的', effect: { expMonths: -0.4, attrs: { relation: 4, mind: 1 } } },
      { label: '工作太忙,這次不去', effect: { attrs: { relation: -4, career: 1 } } },
    ],
  },
  {
    id: 'kidsick', chain: true, type: 'crisis', title: '孩子半夜發燒',
    text: '孩子連續燒了三天,學校不能去,你和伴侶明天都有重要的會。',
    when: (s) => s.kids > 0,
    weight: () => 2,
    choices: [
      { label: '你請假照顧', effect: { attrs: { relation: 5, career: -3, health: -1 } } },
      { label: '拜託長輩幫忙', effect: { attrs: { relation: 2, mind: -1 } } },
      { label: '請臨時保母', effect: { expMonths: -0.3, attrs: { mind: -2 } } },
    ],
  },
  {
    id: 'spousejob', type: 'crisis', title: '伴侶的工作沒了', cooldown: 8,
    text: '伴侶的公司無預警結束營業,家裡少了一份收入。',
    when: (s) => s.status === 'married',
    choices: [
      { label: '讓對方慢慢找適合的', effect: { expMonths: -4, attrs: { relation: 6, mind: -2 } } },
      { label: '請對方先找一份過渡的', effect: { expMonths: -1.5, attrs: { relation: -3 } } },
      { label: '你多接工作補上', effect: { expMonths: -2, attrs: { relation: 3, health: -5, mind: -3 } } },
    ],
  },
  {
    id: 'holiday', type: 'choice', title: '過年回誰家',
    text: '兩邊的長輩都希望你們除夕回去,你們已經為這件事僵了好幾天。',
    when: (s) => s.status === 'married',
    choices: [
      { label: '輪流,今年一邊明年一邊', effect: { attrs: { relation: 4 } } },
      { label: '兩邊都跑,初一趕場', effect: { attrs: { relation: 6, health: -2, mind: -3 } } },
      { label: '出國避開', effect: { expMonths: -1.2, attrs: { mind: 5, relation: -4 } } },
    ],
  },
  {
    id: 'petvet', chain: true, type: 'crisis', title: '狗狗生病了', once: true,
    text: '獸醫說牠需要動手術,費用不低,術後還要照顧一陣子。',
    when: (s) => s.flags.pet,
    weight: () => 2,
    choices: [
      { label: '動手術,請假照顧', effect: { expMonths: -1.5, attrs: { mind: 4, career: -1 } } },
      { label: '先吃藥觀察', effect: { expMonths: -0.3, chance: { p: 0.5,
        success: { note: '牠慢慢好起來了。', attrs: { mind: 3 } },
        fail: { note: '病情惡化,最後還是得緊急開刀。', expMonths: -2, attrs: { mind: -5 } } } } },
    ],
  },
  {
    id: 'oldfriend', type: 'choice', title: '朋友情緒低落',
    text: '一位好朋友最近狀況很差,常常半夜傳訊息給你,而你自己也很累。',
    choices: [
      { label: '陪他,並鼓勵他找專業協助', effect: { attrs: { relation: 6, mind: -1 } } },
      { label: '隨時回訊息,有求必應', effect: { attrs: { relation: 7, mind: -5, health: -2 } } },
      { label: '已讀,等自己有力氣再說', effect: { attrs: { relation: -5, mind: -1 } } },
    ],
  },
  {
    id: 'community', type: 'chance', title: '興趣社團',
    text: '公司附近有個同好社團在招新:桌遊、登山、讀書會,每兩週聚一次。',
    choices: [
      { label: '加入並固定參加', effect: { expMonths: -0.15, attrs: { relation: 5, mind: 4 } } },
      { label: '去一次看看', effect: { attrs: { relation: 2 } } },
      { label: '下班只想回家', effect: { attrs: { health: 1, relation: -1 } } },
    ],
  },
  {
    id: 'blinddate', type: 'chance', title: '長輩安排相親',
    text: '阿姨說有個條件不錯的對象,餐廳都幫你訂好了。',
    when: (s) => s.status === 'single' && s.age >= 28,
    weight: () => 1.5,
    choices: [
      { label: '去見個面', effect: { chance: { p: 0.4, attr: 'relation',
        success: { note: '意外地聊得來,你們開始交往。', set: { status: 'partner' }, expensePct: 0.04, attrs: { relation: 9, mind: 5 } },
        fail: { note: '兩個人尷尬地吃完一頓飯。', attrs: { mind: -1 } } } } },
      { label: '婉拒', effect: { attrs: { relation: -2, mind: 1 } } },
    ],
  },
];

// 哪些選項算「高風險選擇」(卡片 id → 選項索引),用來對照開局的風險性格自評
export const BOLD = {
  headhunter: [0], promo: [0], layoff: [0], sidejob: [0], startup: [0, 1], abroad: [0],
  ai: [1], buyhouse: [0], crash: [2], lend: [0], tip: [0, 1], repair: [1], checkup: [2],
  civil: [0], gapyear: [0], midcareer: [0], scam: [0], investor: [0], esop: [0], leak: [1],
  raise: [0], speak: [0], sidebiz: [0], bigclient: [0], move: [0], chronic: [2], angel: [0],
};
