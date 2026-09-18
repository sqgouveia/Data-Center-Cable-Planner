import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelForRatio, rackMetrics, computeRackMetrics, heatLevel, summarizeRackMetrics,
} from '../rack-metrics.js';

const rack = (over = {}) => ({ id: 'r1', units: 10, ...over });
const asset = (over = {}) => ({
  id: 'a1', rackId: 'r1', face: 'front', uStart: 1, uHeight: 1, status: 'Instalado', ...over,
});

test('levelForRatio: limiares 50%, 80% e excesso acima de 100%', () => {
  assert.equal(levelForRatio(null), 'none');
  assert.equal(levelForRatio(0), 'l1');
  assert.equal(levelForRatio(0.49), 'l1');
  assert.equal(levelForRatio(0.5), 'l2');
  assert.equal(levelForRatio(0.79), 'l2');
  assert.equal(levelForRatio(0.8), 'l3');
  assert.equal(levelForRatio(1), 'l3');
  assert.equal(levelForRatio(1.01), 'l4');
});

test('ocupação de U: união das duas faces, sem contar a mesma U duas vezes', () => {
  const m = rackMetrics(rack(), [
    asset({ id: 'f', uStart: 1, uHeight: 3 }),
    asset({ id: 'r', uStart: 2, uHeight: 3, face: 'rear' }),
  ]);
  assert.equal(m.frontU, 3);
  assert.equal(m.rearU, 3);
  assert.equal(m.usedU, 4); // U1..U4
  assert.equal(m.freeU, 6);
  assert.equal(m.uRatio, 0.4);
});

test('ocupação de U: asset arquivado não ocupa, mas ainda soma energia e peso', () => {
  const m = rackMetrics(rack(), [asset({ status: 'Arquivado', uHeight: 4, powerW: 100, weightKg: 5 })]);
  assert.equal(m.usedU, 0);
  assert.equal(m.powerW, 100);
  assert.equal(m.weightKg, 5);
});

test('ocupação de U: asset que passa da altura do rack é cortado em vez de estourar o total', () => {
  const m = rackMetrics(rack({ units: 4 }), [asset({ uStart: 3, uHeight: 6 })]);
  assert.equal(m.usedU, 2);
  assert.equal(m.uRatio, 0.5);
});

test('energia e peso: razão só existe com capacidade definida', () => {
  const none = rackMetrics(rack(), [asset({ powerW: 300 })]);
  assert.equal(none.powerRatio, null);
  assert.equal(heatLevel(none, 'power'), 'none');
  const capped = rackMetrics(rack({ powerCapacityW: 400, weightCapacityKg: 100 }), [asset({ powerW: 300, weightKg: 120 })]);
  assert.equal(capped.powerRatio, 0.75);
  assert.equal(heatLevel(capped, 'power'), 'l2');
  assert.equal(heatLevel(capped, 'weight'), 'l4');
});

test('alertas: vencido ou excesso é l4, aviso ou 80% é l3, senão l1', () => {
  const life = a => a.life;
  assert.equal(rackMetrics(rack(), [asset()], { lifecycleLevel: life }).alertLevel, 'l1');
  assert.equal(rackMetrics(rack(), [asset({ life: 'soon' })], { lifecycleLevel: life }).alertLevel, 'l3');
  assert.equal(rackMetrics(rack(), [asset({ life: 'expired' }), asset({ id: 'b', life: 'soon' })], { lifecycleLevel: life }).alertLevel, 'l4');
  assert.equal(rackMetrics(rack({ powerCapacityW: 100 }), [asset({ powerW: 85 })]).alertLevel, 'l3');
  assert.equal(rackMetrics(rack({ powerCapacityW: 100 }), [asset({ powerW: 101 })]).alertLevel, 'l4');
  const m = rackMetrics(rack(), [asset({ life: 'expired' }), asset({ id: 'b', life: 'soon' })], { lifecycleLevel: life });
  assert.deepEqual([m.expired, m.soon], [1, 1]);
});

test('heatLevel: modo normal não pinta nada', () => {
  assert.equal(heatLevel(rackMetrics(rack(), []), 'off'), null);
  assert.equal(heatLevel(null, 'u'), null);
});

test('computeRackMetrics: agrupa assets por rack e ignora assets sem rack', () => {
  const racks = [rack({ id: 'r1' }), rack({ id: 'r2' })];
  const map = computeRackMetrics(racks, [
    asset({ id: 'a', rackId: 'r1', uHeight: 2 }),
    asset({ id: 'b', rackId: 'r2', uHeight: 1 }),
    asset({ id: 'c', rackId: null }),
  ]);
  assert.equal(map.get('r1').usedU, 2);
  assert.equal(map.get('r2').usedU, 1);
  assert.equal(map.size, 2);
});

test('summarizeRackMetrics: soma U e calcula razões só sobre racks com capacidade', () => {
  const list = [
    rackMetrics(rack({ id: 'r1', powerCapacityW: 100 }), [asset({ powerW: 90, uHeight: 5 })]),
    rackMetrics(rack({ id: 'r2' }), [asset({ id: 'b', rackId: 'r2', powerW: 500, uHeight: 5 })]),
    rackMetrics(rack({ id: 'r3', powerCapacityW: 100 }), [asset({ id: 'c', rackId: 'r3', powerW: 150 })]),
  ];
  const s = summarizeRackMetrics(list);
  assert.equal(s.racks, 3);
  assert.equal(s.totalU, 30);
  assert.equal(s.usedU, 11);
  assert.equal(s.freeU, 19);
  assert.equal(s.powerW, 740);
  assert.equal(s.powerCap, 200);
  assert.equal(s.powerRatio, 240 / 200); // só r1 e r3 têm capacidade
  assert.equal(s.racksNear, 1);
  assert.equal(s.racksOver, 1);
  assert.equal(summarizeRackMetrics([]).uRatio, null);
});
