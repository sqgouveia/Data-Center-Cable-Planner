// Tronco e perna do breakout a partir das rotas reais, e escolha do produto do fornecedor.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState, buildTwoRackScenario } from './helpers.mjs';
import { state } from '../state.js';
import { breakoutSplit, calcBreakout, calcCable } from '../routing.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('divisão em árvore: menor (Ti + Tj − Dij)/2', () => {
  // Origem → calha 8 m → junção; destinos a 2 m e 3 m da junção, 5 m entre eles.
  assert.ok(near(breakoutSplit([10, 11], () => 5), 8));
  // Destinos no mesmo rack: Dij = 0, tronco vai até o rack.
  assert.ok(near(breakoutSplit([10, 10], () => 0), 10));
  // Uma perna só: tronco = trecho de calha inteiro.
  assert.ok(near(breakoutSplit([7], () => 0), 7));
  // Par sem caminho entre si não reduz o tronco.
  assert.ok(near(breakoutSplit([6, 9], () => Infinity), 6));
});

const bo = legs => ({ id: 'b', name: 'B', type: 'MTP', slack: 0, origin: { rack: 'rack0', u: 40, face: 'front', assetName: '' }, legs });
const leg = (lane, destRack, destU = 40) => ({ lane, originPortId: null, destRack, destU, destFace: 'front', destPortId: null });
const type = { lengths: [{ m: 5, leg: 1 }, { m: 10, leg: 1, price: 99 }, { m: 10, leg: 3 }] };

test('pernas no rack remoto: tronco = rota até lá, perna = subida no rack', () => {
  resetState(state); buildTwoRackScenario(state);
  const one = calcCable({ originRack: 'rack0', destRack: 'rack1', originU: 40, destU: 40, slack: 0, routeMode: 'automatic', via: [] });
  const r = calcBreakout(bo([leg('A', 'rack1'), leg('B', 'rack1', 30)]), type);
  assert.equal(r.reachable, true);
  assert.ok(near(r.trunkNeeded, one.v1 + one.tray + 0.30));
  assert.ok(r.legNeeded >= one.v2 + 0.30 - 1e-9);
  assert.deepEqual(r.legs.map(l => l.lane), ['A', 'B']);
});

test('perna no mesmo rack da origem: divisão na porta, perna remota leva a rota inteira', () => {
  resetState(state); buildTwoRackScenario(state);
  const one = calcCable({ originRack: 'rack0', destRack: 'rack1', originU: 40, destU: 40, slack: 0, routeMode: 'automatic', via: [] });
  const r = calcBreakout(bo([leg('A', 'rack0', 30), leg('B', 'rack1')]), type);
  assert.ok(near(r.trunkNeeded, 0.30));
  assert.ok(near(r.legNeeded, one.v1 + one.tray + one.v2 + 0.30));
});

test('folga entra no tronco e na perna; produto escolhido pela tabela', () => {
  resetState(state); buildTwoRackScenario(state);
  const b = bo([leg('A', 'rack1')]); b.slack = 10;
  const r0 = calcBreakout({ ...b, slack: 0 }, type), r = calcBreakout(b, type);
  assert.ok(near(r.trunkNeeded, r0.trunkNeeded * 1.1));
  assert.ok(near(r.legNeeded, r0.legNeeded * 1.1));
  assert.ok(r.pick === null || r.pick.m - r.pick.leg >= r.trunkNeeded);
});

test('perna sem rota deixa o breakout sem rota; perna sem destino é ignorada', () => {
  resetState(state); buildTwoRackScenario(state, { connectTray: false });
  assert.equal(calcBreakout(bo([leg('A', 'rack1')]), type).reachable, false);
  resetState(state); buildTwoRackScenario(state);
  const r = calcBreakout(bo([leg('A', 'rack1'), { lane: 'B', destRack: null }]), type);
  assert.equal(r.reachable, true);
  assert.equal(r.legs.length, 1);
});
