// Modelo do breakout: perna pela letra da porta, produto do fornecedor e agrupamento da importação.
import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breakoutLane, isBreakoutTypeName, normalizeBreakoutLengths, pickBreakoutLength,
  breakoutLegCable, groupBreakoutCables, resolveBreakoutType, remapBreakoutRacks,
} from '../breakout-model.js';

test('letra final da porta é a perna', () => {
  assert.deepEqual(breakoutLane('1A'), { base: '1', lane: 'A' });
  assert.deepEqual(breakoutLane('12d'), { base: '12', lane: 'D' });
  assert.deepEqual(breakoutLane('Gi1/0/1A'), { base: 'Gi1/0/1', lane: 'A' });
  assert.equal(breakoutLane('Gi1/0/1'), null);
  assert.equal(breakoutLane('1J'), null);
  assert.equal(breakoutLane('A'), null);
});

test('tipo breakout: contém breakout ou MTP, ou é tipo do catálogo', () => {
  assert.equal(isBreakoutTypeName('MTP OM4'), true);
  assert.equal(isBreakoutTypeName('Breakout 1x4'), true);
  assert.equal(isBreakoutTypeName('Fibra Multi Mode'), false);
  assert.equal(isBreakoutTypeName('Harness X', [{ name: 'Harness X' }]), true);
});

test('metragens: ordena, tira repetido, descarta perna >= total', () => {
  assert.deepEqual(
    normalizeBreakoutLengths([{ m: 10, leg: 2, price: '260' }, { m: 5, leg: 1 }, { m: 10, leg: 1 }, { m: 3, leg: 3 }, { m: 10, leg: 1, price: 9 }]),
    [{ m: 5, leg: 1 }, { m: 10, leg: 1, price: 9 }, { m: 10, leg: 2, price: 260 }],
  );
});

test('escolhe o menor total que atende tronco e perna; empate, menor perna', () => {
  const list = normalizeBreakoutLengths([{ m: 5, leg: 1, price: 180 }, { m: 10, leg: 1 }, { m: 10, leg: 2, price: 260 }]);
  assert.deepEqual(pickBreakoutLength(8.4, 0.7, list), { pick: { m: 10, leg: 1, price: null }, reason: null });
  assert.deepEqual(pickBreakoutLength(3, 1.5, list), { pick: { m: 10, leg: 2, price: 260 }, reason: null });
  assert.deepEqual(pickBreakoutLength(1, 3, list), { pick: null, reason: 'leg' });
  assert.deepEqual(pickBreakoutLength(20, 1, list), { pick: null, reason: 'total' });
  assert.deepEqual(pickBreakoutLength(1, 1, []), { pick: null, reason: 'empty' });
});

const cable = (name, type, oPort, dRack, dPort, extra = {}) => ({
  id: name, name, type, slack: 10, originRack: 'r0', originU: 40, originFace: 'front',
  originPortId: 'p' + oPort, originPortLabel: '', originAssetName: 'SW1',
  destRack: dRack, destU: 10, destFace: 'front', destPortId: 'p' + dPort, destPortLabel: '', destAssetName: 'SRV', ...extra,
});
const labelOf = (c, side) => (side === 'origin' ? c.originPortId : c.destPortId).slice(1);
const isBo = n => isBreakoutTypeName(n);

test('agrupa 1A-1D, 2A-2C e 3A-3B em três breakouts; o resto fica cabo comum', () => {
  const rows = [
    cable('c1', 'MTP OM4', '1A', 'r1', 'x'), cable('c2', 'MTP OM4', '1B', 'r2', 'x'),
    cable('c3', 'MTP OM4', '1C', 'r1', 'y'), cable('c4', 'MTP OM4', '1D', 'r3', 'x'),
    cable('c5', 'MTP OM4', '2A', 'r1', 'z'), cable('c6', 'MTP OM4', '2B', 'r1', 'w'), cable('c7', 'MTP OM4', '2C', 'r2', 'z'),
    cable('c8', 'MTP OM4', '3B', 'r1', 'k'), cable('c9', 'MTP OM4', '3A', 'r1', 'j'),
    cable('c10', 'Fibra Multi Mode', '4A', 'r1', 'q'),   // tipo comum: continua cabo
    cable('c11', 'MTP OM4', '5', 'r1', 'q'),             // porta sem letra: continua cabo
  ];
  const { cables, breakouts } = groupBreakoutCables(rows, labelOf, isBo);
  assert.deepEqual(cables.map(c => c.id), ['c10', 'c11']);
  assert.deepEqual(breakouts.map(b => [b.base, b.legs.map(l => l.lane).join('')]), [['1', 'ABCD'], ['2', 'ABC'], ['3', 'AB']]);
  assert.equal(breakouts[0].name, 'c1');
  assert.deepEqual(breakouts[0].origin, { rack: 'r0', u: 40, face: 'front', assetName: 'SW1' });
  assert.equal(breakouts[0].legs[1].destRack, 'r2');
});

test('porta com letra no destino inverte a linha', () => {
  const row = cable('c1', 'MTP OM4', 'x', 'r5', '7B');
  const { breakouts } = groupBreakoutCables([row], labelOf, isBo);
  assert.equal(breakouts[0].origin.rack, 'r5');
  assert.equal(breakouts[0].legs[0].lane, 'B');
  assert.equal(breakouts[0].legs[0].destRack, 'r0');
  assert.equal(breakouts[0].legs[0].originPortId, 'p7B');
});

test('mesma perna duas vezes: a segunda linha fica cabo comum', () => {
  const { cables, breakouts } = groupBreakoutCables(
    [cable('c1', 'MTP OM4', '1A', 'r1', 'x'), cable('c2', 'MTP OM4', '1A', 'r2', 'y')], labelOf, isBo);
  assert.equal(breakouts[0].legs.length, 1);
  assert.deepEqual(cables.map(c => c.id), ['c2']);
});

test('perna vira cabo virtual com id do breakout', () => {
  const b = { id: 'bo1', name: 'BO', type: 'MTP OM4', slack: 5, origin: { rack: 'r0', u: 40, face: 'front', assetName: 'SW1' },
    legs: [{ lane: 'A', originPortId: 'p1A', originPortLabel: '', destRack: 'r1', destU: 10, destFace: 'rear', destPortId: 'd1', destPortLabel: '', destAssetName: 'SRV' }] };
  const c = breakoutLegCable(b, b.legs[0]);
  assert.equal(c.id, 'bo1:A');
  assert.equal(c.breakoutId, 'bo1');
  assert.equal(c.originPortId, 'p1A');
  assert.equal(c.destFace, 'rear');
  assert.equal(c.routeMode, 'automatic');
});

test('tipo do breakout: usa o existente ou cria um 1xN', () => {
  const types = [{ name: 'MTP OM4 — breakout 1×4', legs: 4 }];
  assert.deepEqual(resolveBreakoutType('MTP OM4 — breakout 1×4', 'D', types), { name: 'MTP OM4 — breakout 1×4', created: null });
  assert.deepEqual(resolveBreakoutType('MTP OM4', 'C', types), { name: 'MTP OM4 — breakout 1×4', created: null });
  const r = resolveBreakoutType('MTP OM3', 'F', types);
  assert.equal(r.name, 'MTP OM3 — breakout 1×6');
  assert.deepEqual(r.created, { name: 'MTP OM3 — breakout 1×6', color: '#2dd4bf', legs: 6, lengths: [] });
});

test('reimportar o export não repete a letra da perna no nome', () => {
  const rows = [cable('BO1 A', 'MTP OM4', '1A', 'r1', 'x'), cable('BO1 B', 'MTP OM4', '1B', 'r1', 'y')];
  assert.equal(groupBreakoutCables(rows, labelOf, isBo).breakouts[0].name, 'BO1');
  // Nome sem a letra no fim fica como está.
  assert.equal(groupBreakoutCables([cable('BO1-A', 'MTP OM4', '1A', 'r1', 'x')], labelOf, isBo).breakouts[0].name, 'BO1-A');
});

test('reconstruir estrutura leva o breakout para os racks novos', () => {
  const b = { id: 'b', name: 'B', origin: { rack: 'old0' }, legs: [{ lane: 'A', destRack: 'old1', destPortId: 'p' }, { lane: 'B', destRack: 'gone', destPortId: 'q' }, { lane: 'C', destRack: null }] };
  const lost = { id: 'x', name: 'X', origin: { rack: 'gone' }, legs: [] };
  const map = { old0: 'new0', old1: 'new1' };
  const r = remapBreakoutRacks([b, lost], id => map[id] || null);
  assert.equal(r.lost, 1);
  assert.equal(r.breakouts.length, 1);
  assert.equal(r.breakouts[0].origin.rack, 'new0');
  assert.deepEqual(r.breakouts[0].legs.map(l => [l.destRack, l.destPortId ?? null]), [['new1', 'p'], [null, null], [null, null]]);
});
