// Central app state. A single object, mutated in place everywhere (never
// reassigned) so every module that imports `state` shares live updates.
export const THEME_STORAGE = 'dc-planner-theme-v3';

// Tema inicial: o que o usuário já escolheu; sem escolha salva, o tema do
// sistema. `window` não existe nos testes em Node, então a checagem é guardada.
function preferredTheme(){
  try{
    if(typeof window==='undefined'||typeof window.matchMedia!=='function')return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
  }catch(_){
    return 'light';
  }
}

export const state = {
  projectName: 'Data Center',
  rackUnits: 48,
  rackWidth: 0.60,
  rackGap: 0,
  rackDepth: 1.20,
  defaultRowGap: 1.20,
  lastUToTray: 1.00,
  defaultSlack: 10,
  rows: [], racks: [], cables: [], breakouts: [], trays: [], trayLinks: [], assets: [], selected: null, multiSelected: [], trayMultiSelected: [],
  // Depois da primeira escolha do usuário, ela manda.
  theme: localStorage.getItem(THEME_STORAGE) || localStorage.getItem('dc-theme') || preferredTheme(),
  structureLocked: false, snapToEdges: true, rooms: [], activeRoomId: null, assetCatalogs: {types:['Servidor','Switch','Storage','PDU','Patch Panel','Firewall','Roteador','Outro'], manufacturers:[], models:[]}
};
