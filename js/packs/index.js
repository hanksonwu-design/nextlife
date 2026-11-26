// 國家包登記處。每個國家包自帶語言、幣別、經濟參數、事件卡與測驗。
import tw from './tw/index.js';

export const PACKS = { tw };
export const DEFAULT_PACK = 'tw';

// 依存檔 → 裝置語系 → 預設值的順序決定用哪一包
export function pickPack(savedId, languages = []) {
  if (savedId && PACKS[savedId]) return PACKS[savedId];
  for (const lang of languages) {
    const hit = Object.values(PACKS).find((p) => lang.toLowerCase().startsWith(p.lang.toLowerCase()) || (p.locales || []).includes(lang));
    if (hit) return hit;
  }
  return PACKS[DEFAULT_PACK];
}
