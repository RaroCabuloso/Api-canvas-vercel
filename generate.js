/**
 * api/generate.js — Vercel Serverless Function
 * Renderiza imagem PNG via Chromium headless (sem dependências nativas)
 */

const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const params = new URLSearchParams(
    typeof req.query === 'object'
      ? Object.entries(req.query).map(([k,v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : ''
  );

  // Monta o HTML que será renderizado pelo headless
  const html = buildHTML(params);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    const [W, H] = (params.get('ImgSize') || '800x800').split('x').map(Number);
    await page.setViewport({ width: W || 800, height: H || 800, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });

    const screenshot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W || 800, height: H || 800 } });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).send(screenshot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
};

// ─── Gera o HTML canvas que será "fotografado" pelo headless ─────────────────
function buildHTML(params) {
  const [W, H] = (params.get('ImgSize') || '800x800').split('x').map(Number);
  const bg = (params.get('Background') || '').replace('#', '');
  const bgImg = params.get('BgImg') ? decodeURIComponent(params.get('BgImg')) : '';

  // Coleta imagens
  const images = [];
  let i = 1;
  while (params.has(`Img${i}Url`)) {
    const url  = decodeURIComponent(params.get(`Img${i}Url`) || '');
    const [ix, iy] = (params.get(`Img${i}Pos`) || '0,0').split(',').map(Number);
    const [iw, ih] = (params.get(`Img${i}Size`) || '200x200').split('x').map(Number);
    if (url) images.push({ url, x: ix||0, y: iy||0, w: iw||200, h: ih||200 });
    i++;
  }

  // Coleta textos
  const texts = [];
  i = 1;
  while (params.has(`Txt${i}Content`)) {
    const content    = decodeURIComponent(params.get(`Txt${i}Content`) || '');
    const [tx, ty]   = (params.get(`Txt${i}Pos`) || '0,0').split(',').map(Number);
    const fontSize   = parseInt(params.get(`Txt${i}Size`) || '48');
    const fontFam    = decodeURIComponent(params.get(`Txt${i}Font`) || 'sans-serif');
    const colorStr   = params.get(`Txt${i}Color`) || 'ffffff';
    const shadowStr  = params.get(`Txt${i}Shadow`) || '';
    const gw         = parseInt(params.get(`Txt${i}W`) || '400');
    const fontUrl    = decodeURIComponent(params.get(`Txt${i}FontUrl`) || '');
    texts.push({ content, x: tx||0, y: ty||0, fontSize, fontFam, colorStr, shadowStr, gw, fontUrl });
    i++;
  }

  // Gera CSS de sombra
  function shadowCSS(s) {
    if (!s) return '';
    const [op, dist, blur] = s.split(',').map(Number);
    if (!op) return '';
    return `text-shadow: ${dist||4}px ${dist||4}px ${blur||0}px rgba(0,0,0,${op});`;
  }

  // Gera CSS de cor/gradiente
  function colorCSS(colorStr, x, y, gw) {
    if (colorStr.startsWith('gradient:')) {
      const [c1, c2] = colorStr.replace('gradient:', '').split(',');
      return `
        background: linear-gradient(90deg, #${c1.replace('#','')} 0%, #${c2.replace('#','')} 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      `;
    }
    return `color: #${colorStr.replace('#', '')};`;
  }

  // Coleta font URLs únicas
  const fontLinks = [...new Set(texts.filter(t => t.fontUrl).map(t => t.fontUrl))]
    .map(u => `<link rel="stylesheet" href="${u}">`)
    .join('\n');

  const imgEls = images.map(im => `
    <img src="${im.url}" style="
      position:absolute;
      left:${im.x}px; top:${im.y}px;
      width:${im.w}px; height:${im.h}px;
      object-fit:fill;
    " crossorigin="anonymous" />`).join('\n');

  const txtEls = texts.map(t => {
    const lines = t.content.split('\n');
    const lineH = t.fontSize * 1.3;
    return lines.map((line, li) => `
      <div style="
        position:absolute;
        left:${t.x}px; top:${t.y + li * lineH}px;
        font-size:${t.fontSize}px;
        font-family:'${t.fontFam}', sans-serif;
        line-height:1;
        white-space:pre;
        ${colorCSS(t.colorStr, t.x, t.y, t.gw)}
        ${shadowCSS(t.shadowStr)}
      ">${escapeHtml(line)}</div>`).join('\n');
  }).join('\n');

  const bgStyle = bgImg
    ? `background: url('${bgImg}') center/cover no-repeat;`
    : bg && bg !== 'transparent'
      ? `background: #${bg};`
      : `background: transparent;`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
${fontLinks}
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${W}px; height:${H}px; overflow:hidden; }
  #root {
    position:relative;
    width:${W}px; height:${H}px;
    ${bgStyle}
    overflow:hidden;
  }
</style>
</head>
<body>
<div id="root">
  ${imgEls}
  ${txtEls}
</div>
</body>
</html>`;
}

function escapeHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
