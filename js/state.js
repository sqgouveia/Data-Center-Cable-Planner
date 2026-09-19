// Central app state. A single object, mutated in place everywhere (never
// reassigned) so every module that imports `state` shares live updates.
export const THEME_STORAGE = 'dc-planner-theme-v3';

export const state = {
  projectName: 'Data Center',
  rackUnits: 48,
  rackWidth: 0.60,
  rackGap: 0,
  rackDepth: 1.20,
  defaultRowGap: 1.20,
  lastUToTray: 1.00,
  defaultSlack: 10,
  rows: [], racks: [], cables: [], trays: [], trayLinks: [], assets: [], selected: null, multiSelected: [], trayMultiSelected: [],
  theme: localStorage.getItem(THEME_STORAGE) || localStorage.getItem('dc-theme') || 'light',
  structureLocked: false, snapToEdges: true, rooms: [], activeRoomId: null, assetCatalogs: {types:['Servidor','Switch','Storage','PDU','Patch Panel','Firewall','Roteador','Outro'], manufacturers:[], models:[]}
};
