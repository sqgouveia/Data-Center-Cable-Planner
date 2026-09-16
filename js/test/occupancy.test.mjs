import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAssetArchived, assetOccupancy, assetsOnFace, assetAtRackU,
  assetsAtRackU, assetOwningPort, assetConflicts, occupiedUnits,
} from '../occupancy.js';

function asset(over = {}) {
  return {
    id: over.id || 'a1', rackId: 'rack1', face: 'front',
    uStart: 10, uHeight: 1, status: 'Instalado', ports: [], ...over,
  };
}

test('assetOccupancy spans uStart through uStart + uHeight - 1', () => {
  assert.deepEqual(assetOccupancy(asset({ uStart: 10, uHeight: 3 })), { start: 10, end: 12 });
  assert.deepEqual(assetOccupancy(asset({ uStart: 5, uHeight: 1 })), { start: 5, end: 5 });
});

test('assetOccupancy falls back to 1U at U1 for missing values', () => {
  assert.deepEqual(assetOccupancy({}), { start: 1, end: 1 });
});

test('two assets on the same U but opposite faces do not conflict', () => {
  const front = asset({ id: 'front', face: 'front', uStart: 40 });
  const rear = asset({ id: 'rear', face: 'rear', uStart: 40 });
  assert.equal(assetConflicts([front], rear), false);
});

test('two assets on the same U and the same face conflict', () => {
  const a = asset({ id: 'a', face: 'front', uStart: 40 });
  const b = asset({ id: 'b', face: 'front', uStart: 40 });
  assert.equal(assetConflicts([a], b), true);
});

test('partially overlapping ranges on the same face conflict', () => {
  const tall = asset({ id: 'tall', uStart: 10, uHeight: 3 });
  const short = asset({ id: 'short', uStart: 12, uHeight: 1 });
  assert.equal(assetConflicts([tall], short), true);
});

test('adjacent ranges on the same face do not conflict', () => {
  const lower = asset({ id: 'lower', uStart: 10, uHeight: 2 });
  const upper = asset({ id: 'upper', uStart: 12, uHeight: 1 });
  assert.equal(assetConflicts([lower], upper), false);
});

test('assetConflicts ignores the asset being edited', () => {
  const existing = asset({ id: 'same', uStart: 40 });
  assert.equal(assetConflicts([existing], existing, 'same'), false);
});

test('an archived asset neither occupies nor conflicts', () => {
  const archived = asset({ id: 'old', uStart: 40, status: 'Arquivado' });
  const fresh = asset({ id: 'new', uStart: 40 });
  assert.equal(isAssetArchived(archived), true);
  assert.equal(assetConflicts([archived], fresh), false);
  assert.equal(assetAtRackU([archived], 'rack1', 40, 'front'), null);
});

test('an asset with no rack never conflicts', () => {
  const stock = asset({ id: 'stock', rackId: null, face: null });
  const mounted = asset({ id: 'mounted', uStart: 40 });
  assert.equal(assetConflicts([mounted], stock), false);
});

test('assetsOnFace returns only the requested face of the requested rack', () => {
  const front = asset({ id: 'f', face: 'front' });
  const rear = asset({ id: 'r', face: 'rear' });
  const other = asset({ id: 'o', rackId: 'rack2', face: 'front' });
  const found = assetsOnFace([front, rear, other], 'rack1', 'front');
  assert.deepEqual(found.map(a => a.id), ['f']);
});

test('assetsOnFace returns an empty list when rackId is missing', () => {
  assert.deepEqual(assetsOnFace([asset()], null, 'front'), []);
});

test('assetAtRackU returns the asset on the requested face and ignores the opposite one', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 40 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 40 });
  assert.equal(assetAtRackU([front, rear], 'rack1', 40, 'front').id, 'f');
  assert.equal(assetAtRackU([front, rear], 'rack1', 40, 'rear').id, 'r');
  assert.equal(assetAtRackU([front], 'rack1', 40, 'rear'), null);
});

test('assetAtRackU matches any U inside a multi-U asset', () => {
  const tall = asset({ id: 'tall', uStart: 10, uHeight: 3 });
  assert.equal(assetAtRackU([tall], 'rack1', 11, 'front').id, 'tall');
  assert.equal(assetAtRackU([tall], 'rack1', 13, 'front'), null);
});

test('assetsAtRackU returns both faces, or just the one that is filled', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 40 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 40 });
  assert.deepEqual(assetsAtRackU([front, rear], 'rack1', 40).map(a => a.id), ['f', 'r']);
  assert.deepEqual(assetsAtRackU([front], 'rack1', 40).map(a => a.id), ['f']);
  assert.deepEqual(assetsAtRackU([front, rear], 'rack1', 41), []);
});

test('assetOwningPort finds the owner on either face', () => {
  const front = asset({ id: 'f', face: 'front', ports: [{ id: 'p1', label: 'eth0' }] });
  const rear = asset({ id: 'r', face: 'rear', ports: [{ id: 'p2', label: 'C13-1' }] });
  assert.equal(assetOwningPort([front, rear], 'p2').id, 'r');
  assert.equal(assetOwningPort([front, rear], 'p1').id, 'f');
  assert.equal(assetOwningPort([front, rear], 'nope'), null);
  assert.equal(assetOwningPort([front, rear], null), null);
});

test('occupiedUnits counts only the requested face', () => {
  const front = asset({ id: 'f', face: 'front', uStart: 10, uHeight: 2 });
  const rear = asset({ id: 'r', face: 'rear', uStart: 20, uHeight: 1 });
  assert.deepEqual([...occupiedUnits([front, rear], 'rack1', 'front')].sort((a, b) => a - b), [10, 11]);
  assert.deepEqual([...occupiedUnits([front, rear], 'rack1', 'rear')], [20]);
});
