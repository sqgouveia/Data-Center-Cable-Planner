// Exportação da planta (o SVG do canvas) como SVG, PNG e imagem para o PDF.
//
// Reaproveita o desenho que já está na tela: clona o SVG do canvas, embute o
// estilo calculado de cada elemento (o SVG exportado não tem acesso ao app.css)
// e recorta na caixa do desenho. A captura roda com o tema claro, para o
// arquivo ficar legível impresso, e devolve o tema atual em seguida.
import { esc } from './utils.js';

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight',
  'letter-spacing', 'text-anchor', 'dominant-baseline', 'paint-order',
];
// Só serve para interagir na tela: grade, caixa de seleção, áreas de clique e alças das calhas.
const SKIP_SELECTOR = '.gridline, .rack-selection-box, .rack-hit, .tray-node, .tray-node-hit';
const SELECTION_CLASSES = ['selected', 'selected-tray', 'hover-tint'];

function withLightTheme(fn) {
  const root = document.documentElement;
  const prev = { light: root.classList.contains('light'), theme: root.dataset.theme, scheme: root.style.colorScheme };
  root.classList.add('light'); root.dataset.theme = 'light'; root.style.colorScheme = 'light';
  try { return fn(); } finally {
    root.classList.toggle('light', prev.light);
    if (prev.theme === undefined) delete root.dataset.theme; else root.dataset.theme = prev.theme;
    root.style.colorScheme = prev.scheme;
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Nível de destaque escolhido no canvas: lê a legenda que já está na tela.
function readLegend() {
  const items = [...document.querySelectorAll('#heatLegend .heat-legend-item')];
  return items.map(el => {
    const sw = el.querySelector('.heat-swatch');
    const cs = sw ? getComputedStyle(sw) : null;
    return { label: el.textContent.trim(), fill: cs?.backgroundColor || '#ccc', stroke: cs?.borderTopColor || '#888', dashed: sw?.classList.contains('heat-none') };
  });
}

// Captura o desenho atual. `pxPerMeter` é a escala do canvas (geometry().scale).
export function capturePlant(svgEl, { pxPerMeter }) {
  return withLightTheme(() => {
    // Sem realce de seleção/hover no arquivo: tira as classes só durante a leitura dos estilos.
    const restore = [];
    svgEl.querySelectorAll(SELECTION_CLASSES.map(c => '.' + c).join(',')).forEach(el => {
      const removed = SELECTION_CLASSES.filter(c => el.classList.contains(c));
      if (el.classList.contains('hover-tint')) ['heat-l1', 'heat-l2', 'heat-l3', 'heat-l4', 'heat-none'].forEach(c => { if (el.classList.contains(c)) removed.push(c); });
      el.classList.remove(...removed); restore.push([el, removed]);
    });
    try {
      const orig = [...svgEl.querySelectorAll('*')];
      const clone = svgEl.cloneNode(true);
      const copies = [...clone.querySelectorAll('*')];
      const drop = [];
      orig.forEach((el, i) => {
        const copy = copies[i];
        if (el.matches(SKIP_SELECTOR)) { drop.push(copy); return; }
        const cs = getComputedStyle(el);
        const style = STYLE_PROPS.map(p => `${p}:${cs.getPropertyValue(p)}`).join(';');
        copy.setAttribute('style', style);
        copy.removeAttribute('class');
      });
      drop.forEach(el => el.remove());
      // Caixa do desenho: soma das caixas dos filhos que sobraram.
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      [...svgEl.children].filter(el => !el.matches(SKIP_SELECTOR)).forEach(el => {
        let b; try { b = el.getBBox(); } catch { return; }
        if (!b.width && !b.height) return;
        x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height);
      });
      if (!Number.isFinite(x1)) return null;
      const pad = 24;
      const box = { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
      const scale = Math.max(1, pxPerMeter || 100);
      return {
        inner: clone.innerHTML, box, widthM: box.w / scale, heightM: box.h / scale, pxPerMeter: scale,
        colors: { bg: cssVar('--bg', '#ffffff'), text: cssVar('--text', '#15181d'), muted: cssVar('--muted', '#6b6656'), border: cssVar('--border', '#c9c2b0') },
        legend: readLegend(),
      };
    } finally {
      restore.forEach(([el, removed]) => el.classList.add(...removed));
    }
  });
}

const BAR_STEPS_M = [0.5, 1, 2, 5, 10, 20, 50];
function scaleBar(cap) {
  const target = cap.box.w * 0.18;
  const meters = BAR_STEPS_M.reduce((best, m) => (Math.abs(m * cap.pxPerMeter - target) < Math.abs(best * cap.pxPerMeter - target) ? m : best), BAR_STEPS_M[0]);
  return { meters, px: meters * cap.pxPerMeter };
}

// SVG completo: título, desenho, barra de escala e legenda das cores.
export function composePlantSvg(cap, { title, subtitle }) {
  const { box, colors } = cap;
  const margin = 28, headerH = 62;
  const bar = scaleBar(cap);
  const legendH = cap.legend.length ? 34 : 0;
  const footerH = 46 + legendH;
  const W = Math.round(box.w + margin * 2), H = Math.round(headerH + box.h + footerH);
  const font = 'font-family="Helvetica, Arial, sans-serif"';
  const date = new Date().toLocaleDateString('pt-BR');
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  out += `<rect width="${W}" height="${H}" fill="${colors.bg}"/>`;
  out += `<text x="${margin}" y="30" ${font} font-size="20" font-weight="700" fill="${colors.text}">${esc(title || 'Planta')}</text>`;
  if (subtitle) out += `<text x="${margin}" y="50" ${font} font-size="13" fill="${colors.muted}">${esc(subtitle)}</text>`;
  out += `<text x="${W - margin}" y="30" ${font} font-size="12" text-anchor="end" fill="${colors.muted}">${date}</text>`;
  out += `<g transform="translate(${margin - box.x},${headerH - box.y})">${cap.inner}</g>`;
  const fy = headerH + box.h + 22;
  out += `<g stroke="${colors.text}" stroke-width="2"><line x1="${margin}" y1="${fy}" x2="${margin + bar.px}" y2="${fy}"/><line x1="${margin}" y1="${fy - 5}" x2="${margin}" y2="${fy + 5}"/><line x1="${margin + bar.px}" y1="${fy - 5}" x2="${margin + bar.px}" y2="${fy + 5}"/></g>`;
  out += `<text x="${margin + bar.px + 10}" y="${fy + 4}" ${font} font-size="12" fill="${colors.text}">${String(bar.meters).replace('.', ',')} m</text>`;
  if (cap.legend.length) {
    let lx = margin; const ly = fy + 26;
    cap.legend.forEach(item => {
      out += `<rect x="${lx}" y="${ly - 11}" width="14" height="14" rx="3" fill="${item.fill}" stroke="${item.stroke}" stroke-width="1"${item.dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
      out += `<text x="${lx + 20}" y="${ly}" ${font} font-size="12" fill="${colors.text}">${esc(item.label)}</text>`;
      lx += 20 + item.label.length * 6.6 + 18;
    });
  }
  out += '</svg>';
  return { svg: out, width: W, height: H };
}

// Só o desenho, fundo branco, para a página do PDF (o PDF tem o próprio cabeçalho).
export function bareSvg(cap) {
  const { box } = cap;
  const W = Math.round(box.w), H = Math.round(box.h);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/><g transform="translate(${-box.x},${-box.y})">${cap.inner}</g></svg>`, width: W, height: H };
}

export function svgToPngBlob(svg, width, height, ratio = 2) {
  const maxSide = 8192;
  const r = Math.max(1, Math.min(ratio, maxSide / Math.max(width, height)));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * r); canvas.height = Math.round(height * r);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Não foi possível desenhar a planta.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Menor escala "redonda" (1:N) em que a planta cabe na área disponível, em mm.
const NICE_SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000];
export function niceScale(widthM, heightM, availWmm, availHmm) {
  return NICE_SCALES.find(n => (widthM * 1000) / n <= availWmm && (heightM * 1000) / n <= availHmm) || NICE_SCALES[NICE_SCALES.length - 1];
}

export function safeFileName(text) {
  return String(text || 'planta').normalize('NFD').split('').filter(ch => ch < '̀' || ch > 'ͯ').join('')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'planta';
}

// "rgb(1, 2, 3)", "rgba(...)" ou "color(srgb 0.1 0.2 0.3 / 0.5)" -> [r, g, b] (0-255) ou null.
export function parseCssColor(text) {
  const nums = String(text || '').match(/[0-9]*\.?[0-9]+/g);
  if (!nums || nums.length < 3) return null;
  const n = nums.slice(0, 3).map(Number);
  return /^\s*color\(/.test(text) ? n.map(v => Math.round(v * 255)) : n.map(v => Math.round(v));
}
