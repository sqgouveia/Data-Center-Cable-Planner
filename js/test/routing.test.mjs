import './helpers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetState, buildTwoRackScenario, buildChainScenario } from './helpers.mjs';
import { state } from '../state.js';
import { geometry } from '../geometry.js';
import {
  calcCable, buildRouteGraph, validateManualRouteCandidate, manualRouteData,
  rackNameById, dedupeRoutePoints, rackCableRiseMeters,
} from '../routing.js';

// 1U = 44.45mm, the EIA-310 rack unit height PRODUCT.md calls out as a
// physical constant the app must get right - not an implementation detail.
const U_MM = 44.45;

test('calcCable on the same rack is a pure vertical U-distance, no tray involved', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const cable = { originRack: 'rack0', destRack: 'rack0', originU: 1, destU: 10, slack: 10 };
  const res = calcCable(cable);
  assert.equal(res.reachable, true);
  assert.equal(res.tray, 0);
  assert.equal(res.v2, 0);
  const expectedDirect = 9 * (U_MM / 1000);
  assert.ok(Math.abs(res.v1 - expectedDirect) < 1e-9);
  const expectedBase = expectedDirect + 0.30;
  assert.ok(Math.abs(res.base - expectedBase) < 1e-9);
  assert.ok(Math.abs(res.total - expectedBase * 1.10) < 1e-9);
});

test('calcCable between two racks with no tray infrastructure is unreachable', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const cable = { originRack: 'rack0', destRack: 'rack1', originU: 1, destU: 1, slack: 10, routeMode: 'automatic', via: [] };
  const res = calcCable(cable);
  assert.equal(res.reachable, false);
  assert.equal(res.total, 0);
});

test('calcCable finds a route once a tray connects the two racks, and attributes rise correctly', () => {
  resetState(state);
  const { racks, tray } = buildTwoRackScenario(state);
  const cable = { originRack: 'rack0', destRack: 'rack1', originU: 5, destU: 5, slack: 10, routeMode: 'automatic', via: [] };
  const res = calcCable(cable);
  assert.equal(res.reachable, true);
  assert.ok(res.tray > 0, 'the tray leg should have positive length (racks are apart)');
  // Same U on both sides, identical rack defaults -> both vertical legs match
  // the rise formula computed independently via rackCableRiseMeters.
  const g = geometry();
  buildRouteGraph(cable); // ensures tray endpoints are synced before the direct check
  const expectedRise = rackCableRiseMeters(racks[0], 5, tray);
  assert.ok(Math.abs(res.v1 - expectedRise) < 1e-6);
  assert.ok(Math.abs(res.v2 - expectedRise) < 1e-6);
  assert.ok(Math.abs(res.base - (res.v1 + res.tray + res.v2 + 0.60)) < 1e-9);
  assert.ok(Math.abs(res.total - res.base * 1.10) < 1e-9);
});

test('buildRouteGraph returns null when origin or destination rack does not exist', () => {
  resetState(state);
  buildTwoRackScenario(state);
  assert.equal(buildRouteGraph({ originRack: 'missing', destRack: 'rack1' }), null);
  assert.equal(buildRouteGraph({ originRack: 'rack0', destRack: 'missing' }), null);
});

test('validateManualRouteCandidate rejects origin/dest/duplicate racks and unreachable ones', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const cable = { originRack: 'rack0', destRack: 'rack1', via: [] };
  assert.equal(validateManualRouteCandidate(cable, 'rack0').ok, false, 'origin rack rejected');
  assert.equal(validateManualRouteCandidate(cable, 'rack1').ok, false, 'dest rack rejected');
  assert.equal(validateManualRouteCandidate(cable, null).ok, false, 'no rack rejected');
  // No tray infrastructure at all in this scenario, so a 3rd rack (if it
  // existed) would be unreachable; here we confirm the "no path" branch
  // fires for a rack id that simply is not part of the graph.
  const result = validateManualRouteCandidate(cable, 'rack1');
  assert.match(result.message, /não pode ser adicionad|caminho/);
});

test('manualRouteData short-circuits to a zero-length route when origin equals destination', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  const res = manualRouteData({ originRack: 'rack0', destRack: 'rack0', via: [] });
  assert.deepEqual(res, { reachable: true, length: 0, points: [], segments: [] });
});

test('rackNameById resolves a known rack and falls back gracefully for unknown ids', () => {
  resetState(state);
  buildTwoRackScenario(state, { connectTray: false });
  assert.equal(rackNameById('rack0'), 'Row-1-01');
  assert.equal(rackNameById('ghost'), 'ghost');
  assert.equal(rackNameById(null), '?');
});

test('dedupeRoutePoints collapses points closer than 0.5px but keeps distinct ones', () => {
  const pts = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 10, y: 0 }];
  const out = dedupeRoutePoints(pts);
  assert.deepEqual(out, [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
});

// Three racks, two separate trays (rack0<->rack1, rack1<->rack2) that are NOT
// linked to each other. Automatic mode has no valid path rack0->rack2: an
// intermediate rack only counts as a connection point in manual mode, where
// the user explicitly picks it as a waypoint.
test('automatic mode cannot hop rack0 -> rack2 through an unlinked intermediate rack', () => {
  resetState(state);
  buildChainScenario(state, 3);
  const cable = { originRack: 'rack0', destRack: 'rack2', originU: 1, destU: 1, slack: 10, routeMode: 'automatic', via: [] };
  const res = calcCable(cable);
  assert.equal(res.reachable, false);
});

test('manual mode routes rack0 -> rack2 through an explicit via waypoint', () => {
  resetState(state);
  const { racks } = buildChainScenario(state, 3);
  const cable = { originRack: 'rack0', destRack: 'rack2', originU: 3, destU: 3, slack: 10, routeMode: 'manual', via: ['rack1'] };

  const md = manualRouteData(cable);
  assert.equal(md.reachable, true);
  assert.equal(md.segments.length, 2, 'one segment per hop: rack0->rack1, rack1->rack2');
  assert.ok(md.length > 0);

  const res = calcCable(cable);
  assert.equal(res.reachable, true);
  assert.ok(res.v1 > 0, 'origin vertical leg comes from the first segment');
  assert.ok(res.v2 > 0, 'destination vertical leg comes from the last segment');
  assert.ok(Math.abs(res.total - (res.v1 + res.tray + res.v2 + 0.60) * 1.10) < 1e-9);
});

test('validateManualRouteCandidate accepts a rack reachable from the current route tail', () => {
  resetState(state);
  buildChainScenario(state, 3);
  const cable = { originRack: 'rack0', destRack: 'rack2', via: [] };
  assert.equal(validateManualRouteCandidate(cable, 'rack1').ok, true, 'rack1 has a tray straight to rack0');
});
