import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState, buildTwoRackScenario } from './helpers.mjs';
import { state } from '../state.js';
import {
  rowForRack, rowIndex, racksInRow, rackAt, makeRack, rowDepth, geometry,
  rackRect, trayPointForRowIndex, trayEndpointConnected, segmentIntersection,
  nearestPointOnSegment, VIEW_PAD, rackDisplayName, findRackByLabel,
} from '../geometry.js';

test('rackDisplayName põe a fileira na frente e não prefixa duas vezes', () => {
  assert.equal(rackDisplayName({ name: '101' }, 'A'), 'A-101');
  assert.equal(rackDisplayName({ name: 'A-101' }, 'A'), 'A-101');
  assert.equal(rackDisplayName({ name: '101' }, ''), '101');
  assert.equal(rackDisplayName({ name: '101' }, '   '), '101');
  assert.equal(rackDisplayName({ name: '  ' }, 'A'), 'A-Rack');
});

test('findRackByLabel aceita nome do rack, rótulo com fileira e o formato antigo', () => {
  const rows = [{ id: 'r1', name: 'A' }, { id: 'r2', name: '' }];
  const racks = [
    { id: 'k1', rowId: 'r1', name: '101' },
    { id: 'k2', rowId: 'r2', name: 'Switch' },
  ];
  assert.equal(findRackByLabel('101', racks, rows)?.id, 'k1');
  assert.equal(findRackByLabel('A-101', racks, rows)?.id, 'k1');
  assert.equal(findRackByLabel('a / 101', racks, rows)?.id, 'k1');
  assert.equal(findRackByLabel('Sala 1 / A-101', racks, rows)?.id, 'k1');
  assert.equal(findRackByLabel('Switch', racks, rows)?.id, 'k2');
  assert.equal(findRackByLabel('Sala 1 / Switch', racks, rows)?.id, 'k2');
  assert.equal(findRackByLabel('não existe', racks, rows), null);
  assert.equal(findRackByLabel('', racks, rows), null);
});

test('rowForRack / rowIndex / racksInRow / rackAt find the right row and racks', () => {
  resetState(state);
  const { row, racks } = buildTwoRackScenario(state, { connectTray: false });
  assert.equal(rowForRack(racks[0]), row);
  assert.equal(rowIndex(racks[0]), 0);
  assert.deepEqual(racksInRow(row.id).map(r => r.id), ['rack0', 'rack1']);
  assert.equal(rackAt(row.id, 1), racks[1]);
  assert.equal(rackAt(row.id, 5), null);
});

test('makeRack fills physical defaults from state', () => {
  resetState(state);
  state.rackWidth = 0.6; state.rackDepth = 1.2; state.rackUnits = 48;
  const row = { id: 'r1', name: 'Row-1' };
  const rack = makeRack(row, 2);
  assert.equal(rack.rowId, 'r1');
  assert.equal(rack.index, 2);
  assert.equal(rack.name, 'Row-1-03');
  assert.equal(rack.units, 48);
  assert.equal(rack.width, 0.6);
  assert.equal(rack.depth, 1.2);
});

test('rowDepth falls back to state.rackDepth when the row has no explicit depth', () => {
  resetState(state);
  state.rackDepth = 1.2;
  assert.equal(rowDepth({}), 1.2);
  assert.equal(rowDepth({ depth: 2 }), 2);
});

test('geometry() lays out racks left-to-right with a positive scale', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const g = geometry();
  assert.ok(g.scale > 0);
  assert.equal(g.x0, VIEW_PAD + 90);
  assert.equal(g.rows.length, 1);
  const rectA = rackRect(state.racks[0], g);
  const rectB = rackRect(state.racks[1], g);
  assert.equal(rectA.y, rectB.y, 'racks in the same row share the same y');
  assert.ok(rectB.x > rectA.x, 'second rack sits to the right of the first');
});

test('trayPointForRowIndex anchors the first/last rack to the row tray bounds edges', () => {
  resetState(state);
  const { row } = buildTwoRackScenario(state, { rackCount: 3, connectTray: false });
  const g = geometry();
  const left = trayPointForRowIndex(row, 0, g, null);
  const right = trayPointForRowIndex(row, 2, g, null);
  assert.ok(right.x > left.x);
  assert.equal(left.y, right.y);
});

test('trayEndpointConnected is true only once an explicit tray-rack link exists', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const tray = { id: 'trayX', x1: 0, y1: 0, x2: 100, y2: 0, width: 0.1 };
  state.trays = [tray];
  assert.equal(trayEndpointConnected(tray.id, 0), false);
  state.trayRackLinks = [{ trayId: tray.id, rackId: state.racks[0].id, end: 0, point: 'center', connectionKind: 'center', rx: .5, ry: .5 }];
  assert.equal(trayEndpointConnected(tray.id, 0), true);
  assert.equal(trayEndpointConnected(tray.id, 1), false);
});

test('segmentIntersection finds a crossing point and rejects parallel/non-crossing segments', () => {
  const hit = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.x - 5) < 1e-9 && Math.abs(hit.y - 5) < 1e-9);

  const miss = segmentIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 5 });
  assert.equal(miss, null);
});

test('nearestPointOnSegment clamps to the segment endpoints', () => {
  const onSegment = nearestPointOnSegment(5, 1, 0, 0, 10, 0);
  assert.ok(Math.abs(onSegment.x - 5) < 1e-9 && Math.abs(onSegment.d - 1) < 1e-9);

  const beforeStart = nearestPointOnSegment(-5, 0, 0, 0, 10, 0);
  assert.equal(beforeStart.t, 0);
  const afterEnd = nearestPointOnSegment(15, 0, 0, 0, 10, 0);
  assert.equal(afterEnd.t, 1);
});
