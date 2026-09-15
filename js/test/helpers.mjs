// Minimal DOM/localStorage stubs so state.js/geometry.js/routing.js can be
// imported and exercised under plain Node, with no browser and no test
// framework beyond node:test. Import this FIRST in any test file, before
// importing state.js/geometry.js/routing.js - those read localStorage and
// call $('canvasWrap') at module-load or call time.
const localStorageData = new Map();
globalThis.localStorage = {
  getItem: k => (localStorageData.has(k) ? localStorageData.get(k) : null),
  setItem: (k, v) => { localStorageData.set(k, String(v)); },
  removeItem: k => { localStorageData.delete(k); },
};

// geometry() reads canvasWrap's size to compute the layout scale. A fixed
// size keeps geometry() deterministic across test runs.
globalThis.document = {
  getElementById: (id) => (id === 'canvasWrap' ? { clientWidth: 1000, clientHeight: 700 } : null),
};

export function resetState(state) {
  state.projectName = 'Data Center';
  state.rackUnits = 48;
  state.rackWidth = 0.60;
  state.rackGap = 0;
  state.rackDepth = 1.20;
  state.defaultRowGap = 1.20;
  state.lastUToTray = 1.00;
  state.defaultSlack = 10;
  state.rows = [];
  state.racks = [];
  state.cables = [];
  state.trays = [];
  state.trayLinks = [];
  state.trayRackLinks = [];
  state.assets = [];
  state.selected = null;
  state.multiSelected = [];
  state.trayMultiSelected = [];
}

// Builds two racks in one row, plus a tray whose ends are EXPLICITLY linked
// (via state.trayRackLinks) to each rack's center. Explicit links make
// trayEndpointConnected() deterministic - no reliance on the fuzzy
// geometric-proximity fallback - so the scenario is stable across runs.
export function buildTwoRackScenario(state, { rackCount = 2, connectTray = true } = {}) {
  const row = { id: 'row1', name: 'Row-1', rackCount, gap: 0 };
  state.rows = [row];
  state.racks = [];
  for (let i = 0; i < rackCount; i++) {
    state.racks.push({
      id: `rack${i}`, rowId: row.id, index: i, name: `Row-1-0${i + 1}`,
      units: state.rackUnits, width: state.rackWidth, depth: state.rackDepth,
      gapAfter: state.rackGap, riseToTray: state.lastUToTray,
      powerCapacityW: 0, weightCapacityKg: 0, offset: 0, yOffset: 0, hasTray: false,
    });
  }
  state.trays = [];
  state.trayRackLinks = [];
  if (connectTray && rackCount >= 2) {
    const tray = { id: 'tray1', name: 'Calha teste', x1: 0, y1: 0, x2: 0, y2: 0, width: 0.10 };
    state.trays.push(tray);
    // Chain-connect consecutive racks with one tray each end 0/1 alternating
    // would require multiple trays for 3+ racks; callers that need more than
    // 2 racks should build their own tray topology.
    state.trayRackLinks.push(
      { trayId: tray.id, rackId: state.racks[0].id, end: 0, point: 'center', connectionKind: 'center', rx: 0.5, ry: 0.5 },
      { trayId: tray.id, rackId: state.racks[1].id, end: 1, point: 'center', connectionKind: 'center', rx: 0.5, ry: 0.5 },
    );
  }
  return { row, racks: state.racks, tray: state.trays[0] || null };
}
