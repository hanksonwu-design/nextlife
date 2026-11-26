// 把結果畫成一張圖(1080 × 1350),可以分享或存下來。全部用 Canvas 自己畫,不需要外部套件。
// 圖卡固定用淺色配色,不跟著系統的深色模式,這樣傳給別人看起來都一樣。
const W = 1080;
const H = 1350;
const FONT = '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
const C = { bg: '#fff6e6', ink: '#2d2a45', muted: '#6f6a85', line: '#f0e2c8', sky: '#42a9fa', skyDeep: '#1c6fc0', up: '#0b7a70', down: '#cf4034', gold: '#fdcf40' };
const BAR_COLORS = ['#f2b01e', '#8a63d2', '#2fa66a', '#e8604c', '#3a8de0'];

const font = (ctx, size, weight = 500) => { ctx.font = `${weight} ${size}px ${FONT}`; };

// 中文沒有空白可以斷行,所以一個字一個字量寬度
function wrap(ctx, text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of String(text)) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(ctx, text, x, y, maxW, lineH) {
  for (const l of wrap(ctx, text, maxW)) { ctx.fillText(l, x, y); y += lineH; }
  return y;
}
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// 字太長就縮小到放得下
function fit(ctx, text, maxW, size, weight, min = 40) {
  let sz = size;
  font(ctx, sz, weight);
  while (ctx.measureText(text).width > maxW && sz > min) { sz -= 4; font(ctx, sz, weight); }
  return sz;
}
const loadImage = (src) => new Promise((resolve) => {
  if (!src) return resolve(null);
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null); // 圖載不到就不畫,卡片照樣出
  img.src = src;
});

// spec:{ kicker, title, sub, image, bigLabel, big, lines:[文字], bars:[{label,value}], rows:[[標題,值]], note, appName, url }
export async function drawCard(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // 背景與上方的天空色塊
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, 470);
  sky.addColorStop(0, C.sky);
  sky.addColorStop(1, '#8fd0ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 470);

  const img = await loadImage(spec.image);
  if (img) {
    const h = 400;
    const w = (img.width / img.height) * h;
    ctx.drawImage(img, W - w - 40, 50, w, h);
  }
  const textW = img ? 600 : 960;

  // 小標(白底膠囊)、標題、副標
  if (spec.kicker) {
    font(ctx, 32, 800);
    const kw = ctx.measureText(spec.kicker).width + 56;
    ctx.fillStyle = '#fff';
    rounded(ctx, 60, 70, kw, 60, 30);
    ctx.fill();
    ctx.fillStyle = C.skyDeep;
    ctx.fillText(spec.kicker, 88, 112);
  }
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0, 50, 120, 0.35)';
  ctx.shadowOffsetY = 5;
  ctx.shadowBlur = 0;
  const tsz = fit(ctx, spec.title, textW, 104, 900, 60);
  let ty = 250;
  for (const l of wrap(ctx, spec.title, textW)) { ctx.fillText(l, 60, ty); ty += tsz * 1.15; }
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetY = 0;
  if (spec.sub) {
    font(ctx, 34, 600);
    para(ctx, spec.sub, 60, ty - tsz * 0.15 + 20, textW, 46);
  }

  // 白色面板
  const px = 50, py = 430, pw = W - 100, ph = 790;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  rounded(ctx, px, py + 10, pw, ph, 44);
  ctx.fill();
  ctx.fillStyle = '#fff';
  rounded(ctx, px, py, pw, ph, 44);
  ctx.fill();
  const x = px + 56;
  const innerW = pw - 112;
  let y = py + 80;

  if (spec.bigLabel) {
    font(ctx, 34, 600);
    ctx.fillStyle = C.muted;
    ctx.fillText(spec.bigLabel, x, y);
    y += 30;
  }
  if (spec.big) {
    const bsz = fit(ctx, spec.big, innerW, 120, 900, 56);
    ctx.fillStyle = C.ink;
    y += bsz * 0.9;
    ctx.fillText(spec.big, x, y);
    y += 60;
  }
  for (const l of spec.lines || []) {
    font(ctx, 36, 700);
    ctx.fillStyle = l.tone === 'up' ? C.up : l.tone === 'down' ? C.down : C.ink;
    y = para(ctx, l.text || l, x, y, innerW, 52) + 14;
  }
  if (spec.bars && spec.bars.length) {
    y += 10;
    spec.bars.forEach((b, i) => {
      font(ctx, 32, 700);
      ctx.fillStyle = C.muted;
      ctx.fillText(b.label, x, y + 12);
      const bx = x + 110, bw = innerW - 110 - 90;
      ctx.fillStyle = '#f3ead8';
      rounded(ctx, bx, y - 14, bw, 28, 14);
      ctx.fill();
      ctx.fillStyle = BAR_COLORS[i % BAR_COLORS.length];
      rounded(ctx, bx, y - 14, Math.max(28, (bw * Math.max(0, Math.min(100, b.value))) / 100), 28, 14);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(b.value)), x + innerW, y + 12);
      ctx.textAlign = 'left';
      y += 58;
    });
    y += 6;
  }
  for (const [label, value] of spec.rows || []) {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x + innerW, y - 18);
    ctx.stroke();
    font(ctx, 34, 600);
    ctx.fillStyle = C.muted;
    ctx.fillText(label, x, y + 30);
    const vw = innerW - ctx.measureText(label).width - 30;
    fit(ctx, value, vw, 38, 800, 26);
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + innerW, y + 30);
    ctx.textAlign = 'left';
    y += 76;
  }
  if (spec.note) {
    font(ctx, 26, 500);
    ctx.fillStyle = C.muted;
    para(ctx, spec.note, x, Math.max(y + 10, py + ph - 70), innerW, 36);
  }

  // 頁尾:App 名稱與網址
  font(ctx, 44, 900);
  ctx.fillStyle = C.ink;
  ctx.fillText(spec.appName || '', 60, H - 54);
  if (spec.url) {
    font(ctx, 28, 600);
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.fillText(spec.url, W - 60, H - 58);
    ctx.textAlign = 'left';
  }
  return canvas;
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

// 顯示圖卡的預覽,提供分享(手機)或下載(電腦)。T:按鈕文字
export async function showCard(canvas, filename, T, onFail) {
  const blob = await toBlob(canvas);
  if (!blob) return onFail && onFail();
  const url = URL.createObjectURL(blob);
  const file = typeof File === 'function' ? new File([blob], `${filename}.png`, { type: 'image/png' }) : null;
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const o = document.createElement('div');
  o.className = 'cardview';
  o.setAttribute('role', 'dialog');
  o.setAttribute('aria-modal', 'true');
  o.innerHTML = `<div class="cardbox">
    <img alt="${T.alt}" src="${url}">
    <p class="small">${T.hint}</p>
    <div class="cardbtns">
      ${canShare ? `<button class="btn primary" data-card="share">${T.share}</button>` : ''}
      <a class="btn ${canShare ? '' : 'primary'}" data-card="download" href="${url}" download="${filename}.png">${T.download}</a>
      <button class="btn ghost" data-card="close">${T.close}</button>
    </div></div>`;
  const close = () => { o.remove(); URL.revokeObjectURL(url); };
  o.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-card]');
    if (ev.target === o || (b && b.dataset.card === 'close')) return close();
    if (b && b.dataset.card === 'share') {
      try { await navigator.share({ files: [file] }); } catch { /* 使用者取消分享,不用處理 */ }
    }
  });
  document.body.appendChild(o);
}
