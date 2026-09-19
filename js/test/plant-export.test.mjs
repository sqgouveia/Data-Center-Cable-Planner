import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceScale, safeFileName, parseCssColor, composePlantSvg, bareSvg } from '../plant-export.js';

test('niceScale: menor escala redonda em que a planta cabe na área', () => {
  // 10 m x 6 m numa área de 250 x 150 mm: 1:50 daria 200 x 120 mm, cabe.
  assert.equal(niceScale(10, 6, 250, 150), 50);
  // 1:25 daria 400 mm de largura, não cabe; 1:50 sim.
  assert.equal(niceScale(10, 2, 250, 150), 50);
  // a altura também limita
  assert.equal(niceScale(4, 12, 250, 150), 100);
  // planta enorme cai na maior escala disponível em vez de falhar
  assert.equal(niceScale(5000, 5000, 250, 150), 2000);
});

test('safeFileName: tira acentos e caracteres inválidos', () => {
  assert.equal(safeFileName('Data Center 1 / Sala Açaí'), 'Data_Center_1_Sala_Acai');
  assert.equal(safeFileName('   '), 'planta');
  assert.equal(safeFileName(null), 'planta');
});

test('parseCssColor: rgb, rgba e color(srgb)', () => {
  assert.deepEqual(parseCssColor('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.deepEqual(parseCssColor('rgba(10, 20, 30, 0.5)'), [10, 20, 30]);
  assert.deepEqual(parseCssColor('color(srgb 0.2 0.4 0.6 / 0.9)'), [51, 102, 153]);
  assert.equal(parseCssColor('transparent'), null);
});

const cap = (over = {}) => ({
  inner: '<rect width="10" height="10"/>',
  box: { x: 100, y: 50, w: 400, h: 200 },
  widthM: 4, heightM: 2, pxPerMeter: 100,
  colors: { bg: '#fff', text: '#111', muted: '#666', border: '#ccc' },
  legend: [],
  ...over,
});

test('composePlantSvg: título escapado, barra de escala e legenda opcional', () => {
  const plain = composePlantSvg(cap(), { title: 'A & B <x>', subtitle: 'DC / Sala 1' });
  assert.match(plain.svg, /A &amp; B &lt;x&gt;/);
  assert.match(plain.svg, /DC \/ Sala 1/);
  assert.match(plain.svg, /0,5 m<\/text>/); // alvo 18% de 400 px = 72 px; 0,5 m = 50 px está mais perto que 1 m = 100 px
  assert.equal(plain.width, 456);
  const withLegend = composePlantSvg(cap({ legend: [{ label: '< 50%', fill: 'rgb(1,2,3)', stroke: 'rgb(4,5,6)' }] }), { title: 'X' });
  assert.match(withLegend.svg, /&lt; 50%/);
  assert.ok(withLegend.height > plain.height);
});

test('bareSvg: recorta na caixa do desenho e usa fundo branco', () => {
  const { svg, width, height } = bareSvg(cap());
  assert.equal(width, 400);
  assert.equal(height, 200);
  assert.match(svg, /translate\(-100,-50\)/);
  assert.match(svg, /fill="#ffffff"/);
});
