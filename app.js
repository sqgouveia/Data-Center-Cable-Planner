import {
  uid, cloneData, esc, num, $, dateUrgencyLevel, formatAssetDate, catalogNormalize,
  catalogSimilarity, catalogSimilar, catalogKeyLabel, parsePortTemplate, buildPortRange,
  expandPortDefs, totalPortDefsCount, excelColumnLetter, parseImportDate, parseImportNumber,
  beginTask, endTask, uiIcon, normalizeCableLengths, formatBRL
} from './js/utils.js';
import { normalizeBreakoutLengths, breakoutLegCable, remapBreakoutRacks } from './js/breakout-model.js';
import { breakouts, configureBreakouts, cableToBreakout, setCablesTab, renderBreakoutsList, renderBreakoutProperties, addBreakout, breakoutSummaryRows, breakoutCalc } from './js/breakouts.js';
import { state, THEME_STORAGE } from './js/state.js';
import { uiConfirm, uiPrompt } from './js/dialogs.js';
import { closeStyledSelectPanels, syncSelectButton, openStyledSelectPanel, bindStyledSelect } from './js/styled-select.js';
import {
  VIEW_PAD, rowForRack, rowIndex, racksInRow, rackAt, makeRack, rowDepth, geometry,
  slotPhysicalWidth, slotGapAfter, rowSlotPhysicalX, rackRect, rackCenter, rowCenterY,
  rowTrayBounds, trayPointForRowIndex, syncStructuralTrayEndpoints, syncAttachedTrayEndpoints,
  trayLengthPx, trayLengthMeters, trayPointAt, nearestPointOnSegment, nearestTrayConnection,
  rackConnectionPoint, nearestTrayOrRackSnap, linkTrayPoints, segmentIntersection,
  trayLinkExistsAt, cleanupAutoCrossingLinks, updateLinksForTray, trayEndpointConnected,
  connectCrossingsForTray, rackDisplayName
} from './js/geometry.js';
import {
  buildRouteGraph, calcAutomaticTrayLength, routePointsForAutomatic, routeBetweenRacks,
  manualRouteData, computeRoute, validateManualRouteCandidate, rackNameById, calcCable
} from './js/routing.js';
import {
  isAssetArchived, assetOccupancy, assetsOnFace, assetAtRackU,
  assetOwningPort, assetConflicts, occupiedUnits, assetPositionProblems, highestOccupiedU
} from './js/occupancy.js';
import { configurePdfReport, openPdfReportOptions, closePdfReportOptions, generatePDFReport } from './js/pdf-report.js';
import { runtime } from './js/runtime.js';
import { importSession, configureInventoryImport, assetStatusValues, makeAssetsTemplate, validateAssetImportRows, renderEditableAssetImportPreview, updateImportPreviewSummary, closeImportPreview, catalogSingleTemplate, openCatalogSingleImport, validateCatalogImportRows, renderCatalogSinglePreviewRows, importCatalogSingleWorkbook, importAssetsWorkbook } from './js/inventory-import.js';
import { cloud, configureCloudSync, setCloudStatus, updatePlannerProjectName, assetLogDiff, recordAssetAudit, openAssetHistory, closeAssetHistory, exportCurrentAssetHistory, scheduleCloudSave, updateAutosaveUI, setAutosaveEnabled, saveProjectToCloud, importProject, showDashboard, createNewCloudProject, startAuth } from './js/cloud-sync.js';
import { configureBulkAssets, addBulkRow, openBulkAssetsModal, closeBulkAssetsModal, saveBulkAssets, openAssetsImportModal, bindImportUI } from './js/bulk-assets.js';
import { cables, configureCables, addCable, cableCommercial, downloadCableTemplate, importCablesXLSX, closeCableTypeReviewModal, processCableImportRows, cableSummaryRows, cableEndpointLabel, compactPortLabels, cablesByRoom, exportCablesXLSX, cableSearchHaystack, renderCables, deleteCablesBulk } from './js/cables.js';
import { capturePlant, composePlantSvg, svgToPngBlob, downloadBlob, safeFileName } from './js/plant-export.js';
import { HEAT_MODES, levelForRatio, computeRackMetrics, heatLevel, summarizeRackMetrics } from './js/rack-metrics.js';
import { catalogs, configureCatalogs, DEFAULT_ASSET_TYPES, DEFAULT_ASSET_STATUSES, DEFAULT_ASSET_SUBSTATUSES, normalizeAssetCatalogs, bayfaceTypeColor, renderCableTypesCatalog, renderBreakoutTypesCatalog, renderAssetCatalogs, roomThermalLoad, openRoomEditor, closeRoomEditor, saveRoomEditor, addAssetLocation, openAssetCatalogModal, openLocationsModal, closeAssetCatalogModal, renderAssetCatalogManufacturerSelect, renderAssetCatalogTypeSelect, renderCatalogPortDefsEditor, openCatalogEditor, closeCatalogEditor, saveCatalogEditor, renderAssetCatalogSelects } from './js/catalogs.js';
configurePdfReport({ syncActiveRoom, toast, assetWarrantyLevel, assetEndOfLifeLevel, assetsNeedingAttention, allProjectRacks, capacityIssues, bayfaceTypeColor, cableSummaryRows, breakoutSummaryRows });

const ROOM_KEYS=['rackUnits','rackWidth','rackGap','rackDepth','defaultRowGap','lastUToTray','defaultSlack','rows','racks','cables','breakouts','trays','trayLinks','trayRackLinks','structureLocked','snapToEdges'];
function roomDataFromState(){const data={};ROOM_KEYS.forEach(k=>{data[k]=cloneData(state[k]);});return data;}
function applyRoomData(data){if(!data)return;ROOM_KEYS.forEach(k=>{if(data[k]!==undefined)state[k]=cloneData(data[k]);});
  // Sala salva antes do breakout não tem a chave: sem isto, herdaria os da sala anterior.
  if(data.breakouts===undefined)state.breakouts=[];state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];normalizeState();}
function syncActiveRoom(){if(!Array.isArray(state.rooms)||!state.rooms.length)return;const room=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0];if(!room)return;state.activeRoomId=room.id;room.data=roomDataFromState();room.updatedAt=new Date().toISOString();}
function migrateGlobalAssets(){
  state.assets=Array.isArray(state.assets)?state.assets:[];
  const byId=new Map(state.assets.filter(a=>a&&a.id).map(a=>[a.id,a]));
  (state.rooms||[]).forEach(room=>{
    const legacy=Array.isArray(room?.data?.assets)?room.data.assets:[];
    legacy.forEach(a=>{if(!a||!a.id)return;const existing=byId.get(a.id);if(existing){if(!existing.roomId)existing.roomId=room.id;}else{const copy=cloneData(a);copy.roomId=room.id;byId.set(copy.id,copy);state.assets.push(copy);}});
    if(room?.data) delete room.data.assets;
  });
  state.assets.forEach(a=>{if(a&&a.roomId&&!state.rooms.some(r=>r.id===a.roomId)) {a.roomId=null;a.rackId=null;}});
}
function ensureRooms(){
  if(Array.isArray(state.rooms)&&state.rooms.length){state.rooms.forEach(r=>{r.data=r.data||{};r.coolingCapacityW=Number.isFinite(Number(r.coolingCapacityW))?Math.max(0,Number(r.coolingCapacityW)):0;});if(!state.activeRoomId||!state.rooms.some(r=>r.id===state.activeRoomId))state.activeRoomId=state.rooms[0].id;migrateGlobalAssets();return;}
  state.rooms=[{id:uid('room'),name:'Sala 1',coolingCapacityW:0,data:roomDataFromState()}];state.activeRoomId=state.rooms[0].id;migrateGlobalAssets();
}
function switchRoom(roomId){ensureRooms();const target=state.rooms.find(r=>r.id===roomId);if(!target)return;if(target.id===state.activeRoomId){updateRoomUI();return;}syncActiveRoom();persistHistoryContext();applyRoomData(target.data);state.activeRoomId=target.id;runtime.pan=null;initHistory(cloud.cloudProjectId,state.activeRoomId);updateRoomUI();renderAll(false);scheduleCloudSave();toast(`Sala aberta: ${target.name}`);}
function fitTopbarSelect(el){
  if(!el)return;
  const option=el.options?.[el.selectedIndex];
  const text=option?.textContent||'';
  const cs=getComputedStyle(el);
  const canvas=fitTopbarSelect._canvas||(fitTopbarSelect._canvas=document.createElement('canvas'));
  const ctx=canvas.getContext('2d');
  ctx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const width=Math.ceil(ctx.measureText(text).width)+48;
  el.style.width=Math.max(78,width)+'px';
}
function updateRoomUI(){
  ensureRooms(); normalizeLocations();
  const room=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0]; if(!room)return;
  state.activeRoomId=room.id;
  const loc=state.locations.find(l=>l.id===room.locationId)||state.locations[0];
  const locSelect=$('locationSelect');
  if(locSelect){locSelect.innerHTML=state.locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');locSelect.value=loc?.id||'';fitTopbarSelect(locSelect);syncSelectButton('locationSelect','locationSelectBtn');}
  const select=$('roomSelect');
  if(select){const rooms=loc?(loc.rooms||[]).map(id=>state.rooms.find(r=>r.id===id)).filter(Boolean):state.rooms;select.innerHTML=rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');select.value=room.id;fitTopbarSelect(select);syncSelectButton('roomSelect','roomSelectBtn');}
  const name=$('plannerRoomName');if(name)name.textContent=room.name;
  const locationName=$('plannerLocationName');if(locationName)locationName.textContent=loc?.name||'Sem localização';
  const project=$('plannerProjectName');if(project)project.textContent=state.projectName||'Data Center';
}
function switchLocation(locationId){
  normalizeLocations(); const loc=state.locations.find(l=>l.id===locationId); if(!loc)return;
  const rooms=(loc.rooms||[]).map(id=>state.rooms.find(r=>r.id===id)).filter(Boolean);
  if(!rooms.length){toast(`O DC "${loc.name}" não possui nenhuma sala cadastrada.`); updateRoomUI(); return;}
  switchRoom(rooms[0].id);
}




const LEGACY_STORAGE = 'dc-planner-v6';

const DEFAULT_CABLE_TYPES = [{name:'Fibra Multi Mode',color:'#2dd4bf'},{name:'Fibra Single Mode',color:'#facc15'},{name:'UTP',color:'#4f8cff'}];
function normalizeCableCatalogs(){
  state.cableCatalogs=state.cableCatalogs&&typeof state.cableCatalogs==='object'?state.cableCatalogs:{};
  let types=Array.isArray(state.cableCatalogs.types)?state.cableCatalogs.types:null;
  if(!types||!types.length) types=DEFAULT_CABLE_TYPES.map(t=>({...t}));
  const seen=new Set(); const clean=[];
  types.forEach(t=>{
    const name=String(t?.name||'').trim(); if(!name)return;
    const key=catalogNormalize(name); if(seen.has(key))return; seen.add(key);
    // Corrige o próprio objeto (não cria outro): o catálogo aberto guarda referência aos tipos.
    Object.assign(t,{name,color:/^#[0-9a-fA-F]{6}$/.test(t.color||'')?t.color:'#4f8cff',lengths:normalizeCableLengths(t.lengths)});
    clean.push(t);
  });
  state.cableCatalogs.types=clean.length?clean:DEFAULT_CABLE_TYPES.map(t=>({...t}));
  // Tipos de breakout: nome único, cor, nº de pernas (1–8) e os produtos { m, leg, price? }.
  const bSeen=new Set();
  // Filtra no próprio array: quem guardou a referência (catálogo aberto, importação) segue válido.
  const bList=Array.isArray(state.cableCatalogs.breakoutTypes)?state.cableCatalogs.breakoutTypes:[];
  const bKept=bList.filter(t=>{
    const name=String(t?.name||'').trim(), key=catalogNormalize(name);
    if(!name||bSeen.has(key))return false; bSeen.add(key);
    Object.assign(t,{name,color:/^#[0-9a-fA-F]{6}$/.test(t.color||'')?t.color:'#2dd4bf',legs:Math.min(8,Math.max(1,Math.floor(num(t.legs,4)))),lengths:normalizeBreakoutLengths(t.lengths)});
    return true;
  });
  bList.splice(0,bList.length,...bKept);
  state.cableCatalogs.breakoutTypes=bList;
}
function cableTypeNames(){normalizeCableCatalogs();return state.cableCatalogs.types.map(t=>t.name);}
function defaultCableType(){normalizeCableCatalogs();return state.cableCatalogs.types[0]?.name||'UTP';}
function cableTypeColor(type){normalizeCableCatalogs();return state.cableCatalogs.types.find(t=>t.name===type)?.color||'var(--route)';}
function breakoutTypeOf(name){normalizeCableCatalogs();return state.cableCatalogs.breakoutTypes.find(t=>t.name===name)||null;}


const history = { undo: [], redo: [], last: null, restoring: false, max: 80, projectId: null, roomId: null, contexts: new Map() };
function isStructureLocked(){ return state.structureLocked===true; }
function setStructureLock(locked, persist=true){
  state.structureLocked=!!locked;
  const btn=$('structureLock'), icon=$('structureLockIcon');
  if(btn){
    btn.classList.toggle('locked', state.structureLocked);
    btn.title=state.structureLocked?'Desbloquear estrutura':'Bloquear estrutura';
    btn.setAttribute('aria-label',btn.title);
  }
  if(icon) icon.innerHTML=uiIcon(state.structureLocked?'lock':'unlock','ic structure-lock-icon');
  document.body.classList.toggle('structure-is-locked',state.structureLocked);
  updateStructureControls();
  renderProperties();
  updateStructureControls();
  if(persist) save();
}
function updateStructureControls(){
  const disabled=isStructureLocked();
  ['btnAddTray','btnBuildRows','btnAddRow','btnRenameRows'].forEach(id=>{const el=$(id);if(el)el.disabled=disabled;});
  document.querySelectorAll('[data-row-name],[data-row-count],[data-row-gap],[data-rename-row],[data-del-row]').forEach(el=>{el.disabled=disabled;el.setAttribute('aria-disabled',String(disabled));});
  document.querySelectorAll('#properties input:not(#cbName):not(#cbType):not(#cbOR):not(#cbOU):not(#cbDR):not(#cbDU):not(#cbSlack), #properties select:not(#cbType):not(#cbOR):not(#cbDR), #properties button#delRack, #properties button#delTray, #properties button#applyBulkRack, #properties button#delSelectedRacks, #properties button#delSelectedTrays').forEach(el=>{el.disabled=disabled;});
  const btn=$('structureLock'), icon=$('structureLockIcon');
  if(btn){btn.classList.toggle('locked',disabled);btn.title=disabled?'Desbloquear estrutura':'Bloquear estrutura';btn.setAttribute('aria-label',btn.title);}
  if(icon)icon.innerHTML=uiIcon(disabled?'lock':'unlock','ic structure-lock-icon');
}
function structureBlocked(){
  if(isStructureLocked()){ toast('🔒 Estrutura bloqueada. Desbloqueie para alterar racks ou calhas.'); return true; }
  return false;
}
function projectSnapshot(){
  // History is scoped to the active project/room. Do not snapshot the entire
  // project state here: doing so would let an Undo in one room overwrite
  // edits made in another room. Volatile timestamps are intentionally omitted.
  ensureRooms();
  const activeRoom=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0]||null;
  // History must snapshot the live in-memory room state, not room.data.
  // room.data is synchronized for cloud persistence, but it can lag behind
  // the just-applied UI edit until the save cycle runs. Using it here caused
  // several consecutive edits (e.g. 1.0 → 1.1 → 1.2 → 1.3...) to collapse
  // into larger Undo steps.
  const roomData=roomDataFromState();
  const copy={
    projectName:state.projectName,
    locations:cloneData(state.locations||[]),
    assets:cloneData(state.assets||[]),
    assetCatalogs:cloneData(state.assetCatalogs||{}),
    roomMeta:(state.rooms||[]).map(r=>({id:r.id,name:r.name,locationId:r.locationId})),
    room:{
      id:activeRoom?.id||state.activeRoomId||null,
      name:activeRoom?.name||'',
      locationId:activeRoom?.locationId||null,
      data:roomData
    }
  };
  return JSON.stringify(copy);
}
const THEME_ICON_SUN='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
const THEME_ICON_MOON='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
function applyTheme(){
  const light=state.theme==='light';
  document.documentElement.classList.toggle('light',light);
  document.documentElement.dataset.theme=light?'light':'dark';
  document.documentElement.style.colorScheme=light?'light':'dark';
  localStorage.setItem(THEME_STORAGE,state.theme);
  // A barra do navegador no celular acompanha o tema em vez de ficar presa no
  // cinza padrão.
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta)themeMeta.setAttribute('content',light?'#dfe6f1':'#1f2937');
  const icon=light?THEME_ICON_SUN:THEME_ICON_MOON;
  const b=$('btnTheme');
  // Só o ícone: o rótulo ocupava ~50px na barra e o print de referência mostra o botão
  // sozinho (o nome fica no title/aria-label).
  if(b){ b.innerHTML=icon; b.title=light?'Alternar para tema escuro':'Alternar para tema claro'; b.setAttribute('aria-label',b.title); }
  const db=$('dashboardTheme'); if(db){ db.innerHTML=icon+' Tema'; db.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const ab=$('authTheme'); if(ab){ ab.innerHTML=icon; ab.title=light?'Alternar para tema escuro':'Alternar para tema claro'; ab.setAttribute('aria-label',ab.title); }
}
function historyContextKey(projectId=cloud.cloudProjectId, roomId=state.activeRoomId){
  return `${projectId||'local'}::${roomId||'default'}`;
}
function initHistory(projectId=cloud.cloudProjectId, roomId=state.activeRoomId, reset=false){
  const key=historyContextKey(projectId,roomId);
  if(!reset && history.contexts.has(key)){
    const ctx=history.contexts.get(key);
    history.undo=ctx.undo;
    history.redo=ctx.redo;
    history.last=ctx.last||projectSnapshot();
  }else{
    const ctx={undo:[],redo:[],last:projectSnapshot()};
    history.contexts.set(key,ctx);
    history.undo=ctx.undo;
    history.redo=ctx.redo;
    history.last=ctx.last;
  }
  history.projectId=projectId||null;
  history.roomId=roomId||null;
  history.restoring=false;
  updateHistoryButtons();
}
function persistHistoryContext(){
  const key=historyContextKey(history.projectId,history.roomId);
  history.contexts.set(key,{undo:history.undo,redo:history.redo,last:history.last});
}
function recordHistory(){
  if(history.restoring)return;
  const currentKey=historyContextKey(cloud.cloudProjectId,state.activeRoomId);
  const activeKey=historyContextKey(history.projectId,history.roomId);
  if(currentKey!==activeKey){
    // A room switch is navigation, not an editable action. Persist the room
    // we are leaving, then attach to the destination room's timeline.
    persistHistoryContext();
    initHistory(cloud.cloudProjectId,state.activeRoomId);
    return;
  }
  const current=projectSnapshot();
  if(!history.last){
    history.last=current;
    history.projectId=cloud.cloudProjectId||null;
    history.roomId=state.activeRoomId||null;
    persistHistoryContext();
    updateHistoryButtons();
    return;
  }
  if(current!==history.last){
    history.undo.push(history.last);
    if(history.undo.length>history.max)history.undo.shift();
    history.redo=[];
    history.last=current;
  }
  persistHistoryContext();
  updateHistoryButtons();
}
function updateHistoryButtons(){
  const u=$('btnUndo'),r=$('btnRedo');
  if(u){u.disabled=history.undo.length===0;u.setAttribute('aria-disabled',String(u.disabled));}
  if(r){r.disabled=history.redo.length===0;r.setAttribute('aria-disabled',String(r.disabled));}
}
function restoreSnapshot(snapshot, preserveSelection=null){
  // Undo/Redo changes data, not the user's current UI selection. Keep the
  // selection that was active before restoring and re-apply it afterwards.
  const selectionState = preserveSelection || {
    selected: cloneData(state.selected),
    multiSelected: cloneData(state.multiSelected || []),
    trayMultiSelected: cloneData(state.trayMultiSelected || [])
  };
  history.restoring=true;
  const restored=JSON.parse(snapshot);
  const currentTheme=state.theme;

  if(restored.projectName!==undefined) state.projectName=restored.projectName;
  if(Array.isArray(restored.locations)) state.locations=cloneData(restored.locations);
  if(Array.isArray(restored.assets)) state.assets=cloneData(restored.assets);
  if(restored.assetCatalogs && typeof restored.assetCatalogs==='object') state.assetCatalogs=cloneData(restored.assetCatalogs);

  // Keep the room context that the user is currently undoing. Never replace
  // every room's editable data with a snapshot from another room.
  const roomId=history.roomId||restored.room?.id||state.activeRoomId;
  let room=state.rooms.find(r=>r.id===roomId);
  if(!room && restored.room){
    room={id:restored.room.id||uid('room'),name:restored.room.name||'Sala',locationId:restored.room.locationId||null,data:{}};
    state.rooms.push(room);
  }
  if(room && restored.room){
    room.name=restored.room.name||room.name;
    room.locationId=restored.room.locationId??room.locationId;
    room.data=cloneData(restored.room.data||{});
    state.activeRoomId=room.id;
    applyRoomData(room.data);
  }
  state.theme=currentTheme;
  normalizeState();

  // Re-apply selection after normalize/applyRoomData. Only keep references
  // that still exist in the restored state; this prevents stale selections
  // while preserving a rack/cable/tray that still exists after the undo/redo.
  const rackIds=new Set((state.racks||[]).map(x=>x.id));
  const trayIds=new Set((state.trays||[]).map(x=>x.id));
  const cableIds=new Set((state.cables||[]).map(x=>x.id));
  const validSelected = selectionState.selected && (
    (selectionState.selected.type==='rack' && rackIds.has(selectionState.selected.id)) ||
    (selectionState.selected.type==='tray' && trayIds.has(selectionState.selected.id)) ||
    (selectionState.selected.type==='cable' && cableIds.has(selectionState.selected.id)) ||
    (selectionState.selected.type==='breakout' && (state.breakouts||[]).some(b=>b.id===selectionState.selected.id))
  ) ? cloneData(selectionState.selected) : null;
  state.selected=validSelected;
  state.multiSelected=(selectionState.multiSelected||[]).filter(id=>rackIds.has(id));
  state.trayMultiSelected=(selectionState.trayMultiSelected||[]).filter(id=>trayIds.has(id));
  if(state.selected?.type==='rack' && !state.multiSelected.includes(state.selected.id)){
    state.multiSelected.push(state.selected.id);
  }
  if(state.selected?.type==='tray' && !state.trayMultiSelected.includes(state.selected.id)){
    state.trayMultiSelected.push(state.selected.id);
  }

  history.last=projectSnapshot();
  history.restoring=false;
  applyTheme();
  renderAll(false);
  scheduleCloudSave();
  persistHistoryContext();
  updateHistoryButtons();
}
function undo(){
  if(!history.undo.length)return;
  const current=projectSnapshot();
  const selectionState={
    selected:cloneData(state.selected),
    multiSelected:cloneData(state.multiSelected||[]),
    trayMultiSelected:cloneData(state.trayMultiSelected||[])
  };
  const target=history.undo.pop();
  history.redo.push(current);
  restoreSnapshot(target, selectionState);
  toast('Desfeito');
  flashSelection();
}
function redo(){
  if(!history.redo.length)return;
  const current=projectSnapshot();
  const selectionState={
    selected:cloneData(state.selected),
    multiSelected:cloneData(state.multiSelected||[]),
    trayMultiSelected:cloneData(state.trayMultiSelected||[])
  };
  const target=history.redo.pop();
  history.undo.push(current);
  restoreSnapshot(target, selectionState);
  toast('Refeito');
  flashSelection();
}

function toast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>t.classList.remove('show'),1800); }

// Pulso de confirmação no objeto que acabou de ser criado ou restaurado.
// Sem isso, criar uma calha/cabo ou desfazer uma alteração deixa o usuário
// sem saber onde olhar no canvas.
function flashElement(el){
  if(!el||!el.classList)return;
  el.classList.remove('is-flash');
  void el.getBoundingClientRect();
  el.classList.add('is-flash');
  clearTimeout(el.__flashTimer);
  el.__flashTimer=setTimeout(()=>el.classList.remove('is-flash'),900);
}
// Traz o item da lista para a parte visível do painel e pisca: com muitas fileiras (ou cabos) o
// resultado escolhido na busca pode estar fora do que aparece na tela.
function focusPanelItem(seletor){
  const el=document.querySelector(seletor); if(!el)return;
  el.scrollIntoView({block:'nearest'});
  flashElement(el);
}
function flashSelection(){
  const sel=state.selected; if(!sel)return;
  const svg=$('layout');
  const id=typeof CSS!=='undefined'&&CSS.escape?CSS.escape(String(sel.id)):String(sel.id);
  if(sel.type==='rack')flashElement(svg?.querySelector(`[data-rack="${id}"] .rack-body`));
  else if(sel.type==='tray')flashElement(svg?.querySelector(`line[data-tray="${id}"].tray-line`));
  else if(sel.type==='cable')flashElement(document.querySelector(`.cable-item[data-cable="${id}"]`));
  else if(sel.type==='asset')flashElement(document.querySelector(`.asset-row[data-asset-id="${id}"]`));
}
function save(){ recordHistory(); localStorage.setItem(THEME_STORAGE,state.theme); applyTheme(); updatePlannerProjectName(); updateAlertsCenterBadge(); scheduleCloudSave(); }
function load(){
  // Project data is cloud-first. This startup routine only normalizes a clean
  // in-memory state before authentication/project loading. It never restores
  // an old project snapshot from localStorage.
  state.rows=Array.isArray(state.rows)?state.rows:[];
  state.racks=Array.isArray(state.racks)?state.racks:[];
  state.assets=Array.isArray(state.assets)?state.assets:[];
  normalizeAssets();
  state.rows.forEach(r=>{ if(!Number.isFinite(Number(r.depth))) r.depth=Math.max(0.1,num(state.rackDepth,1.20)); else r.depth=Math.max(0.1,Number(r.depth)); });
  state.cables=Array.isArray(state.cables)?state.cables:[];
  state.trays=Array.isArray(state.trays)?state.trays:[];
  if(!Number.isFinite(Number(state.rackGap))) state.rackGap=0;
  state.rackGap=Math.max(0,Number(state.rackGap));
  if(!Number.isFinite(Number(state.rackPowerCapacityW))) state.rackPowerCapacityW=0;
  state.rackPowerCapacityW=Math.max(0,Number(state.rackPowerCapacityW));
  if(!Number.isFinite(Number(state.rackWeightCapacityKg))) state.rackWeightCapacityKg=0;
  state.rackWeightCapacityKg=Math.max(0,Number(state.rackWeightCapacityKg));
  if(!Number.isFinite(Number(state.rackDepth))) state.rackDepth=1.20;
  state.rackDepth=Math.max(0.1,Number(state.rackDepth));
  if(state.theme!=='light'&&state.theme!=='dark')state.theme='dark';
  state.snapToEdges=true;
  ensureRooms();
  migrateGlobalAssets();
  const active=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0];
  if(active?.data) applyRoomData(active.data);
  applyTheme();
  normalizeState();
}
function normalizeIndices(){
  // Physical slot indexes are preserved so deleting a rack does not move the
  // remaining racks.  rackCount, however, represents the actual number of
  // racks currently present in the row, not the highest occupied slot.
  state.rows.forEach(row=>{
    const rs=racksInRow(row.id);
    row.rackCount=rs.length;
  });
}
function normalizeState(){
  state.snapToEdges=true;
  state.structureLocked=state.structureLocked===true;
  if(typeof normalizeLocations==='function') normalizeLocations();
  const rowIds=new Set(state.rows.map(r=>r.id));
  state.racks=state.racks.filter(r=>rowIds.has(r.rowId));
  state.racks.forEach(r=>{
    if(!Number.isFinite(Number(r.width))) r.width=state.rackWidth;
    r.width=Math.max(0.1,Number(r.width));
    if(!Number.isFinite(Number(r.depth))) r.depth=state.rackDepth;
    r.depth=Math.max(0.1,Number(r.depth));
    if(!Number.isFinite(Number(r.gapAfter))) r.gapAfter=state.rackGap;
    r.gapAfter=Math.max(0,Number(r.gapAfter));
    if(!Number.isFinite(Number(r.riseToTray))) r.riseToTray=state.lastUToTray;
    r.riseToTray=Math.max(0,Number(r.riseToTray));
    // Capacidade elétrica é opcional: 0/ausente significa "sem limite definido",
    // então não força um valor default como as outras propriedades acima.
    r.powerCapacityW=Number.isFinite(Number(r.powerCapacityW))?Math.max(0,Number(r.powerCapacityW)):0;
    r.weightCapacityKg=Number.isFinite(Number(r.weightCapacityKg))?Math.max(0,Number(r.weightCapacityKg)):0;
    if(!Number.isFinite(Number(r.offset))) r.offset=0;
    r.offset=Number(r.offset);
    if(!Number.isFinite(Number(r.yOffset))) r.yOffset=0;
    r.yOffset=Number(r.yOffset);
  });
  normalizeIndices();
  // V8.1: calhas são infraestrutura independente. Dados antigos permanecem marcados
  // como _legacy até o primeiro render, quando são convertidos para coordenadas livres.
  state.trays=(Array.isArray(state.trays)?state.trays:[]).map(t=>{
    if(Number.isFinite(Number(t.x1))&&Number.isFinite(Number(t.y1))&&Number.isFinite(Number(t.x2))&&Number.isFinite(Number(t.y2))){
      return {
        id:t.id||uid('tray'),name:t.name||'Calha',
        x1:+t.x1,y1:+t.y1,x2:+t.x2,y2:+t.y2,width:num(t.width,.10),
        // Structural inter-row calhas keep their rack/fileira anchors so their
        // endpoints can be recomputed whenever rack geometry or row spacing changes.
        ...(t.fromRowId?{fromRowId:t.fromRowId}:{}),
        ...(t.toRowId?{toRowId:t.toRowId}:{}),
        ...(Number.isFinite(Number(t.fromIndex))?{fromIndex:Number(t.fromIndex)}:{}),
        ...(Number.isFinite(Number(t.toIndex))?{toIndex:Number(t.toIndex)}:{}),
        ...(t.edge!==undefined?{edge:!!t.edge}:{}),
        ...(t.sideFrom?{sideFrom:t.sideFrom}:{}),
        ...(t.sideTo?{sideTo:t.sideTo}:{}),
      };
    }
    return {...t,_legacy:true,name:t.name||'Calha'};
  });
  state.trayLinks=Array.isArray(state.trayLinks)?state.trayLinks:[];
  state.trayRackLinks=Array.isArray(state.trayRackLinks)?state.trayRackLinks:[];
  // Keep only links whose endpoint objects still exist.
  state.trayLinks=state.trayLinks.filter(l=>state.trays.some(t=>t.id===l.aTray)&&state.trays.some(t=>t.id===l.bTray));
  state.trayRackLinks=state.trayRackLinks.filter(l=>state.trays.some(t=>t.id===l.trayId)&&state.racks.some(r=>r.id===l.rackId));
  state.racks.forEach(r=>{r.hasTray=false;});
  const rackIds=new Set(state.racks.map(r=>r.id));
  const allRackIds=new Set();
  state.racks.forEach(r=>allRackIds.add(r.id));
  (state.rooms||[]).forEach(room=>(room.data?.racks||[]).forEach(r=>allRackIds.add(r.id)));
  state.cables=state.cables.filter(c=>rackIds.has(c.originRack)&&rackIds.has(c.destRack));
  // Assets are project-level. A missing rack means the asset is unassigned; never delete it.
  state.assets.forEach(a=>{if(a.rackId&&!allRackIds.has(a.rackId)){a.rackId=null;}});
  state.cables.forEach(c=>{c.type=cableTypeNames().includes(c.type)?c.type:defaultCableType();c.via=(c.via||[]).filter(id=>rackIds.has(id));c.originPortId=c.originPortId||null;c.destPortId=c.destPortId||null;c.originPortLabel=String(c.originPortLabel||'');c.destPortLabel=String(c.destPortLabel||'');c.originAssetName=String(c.originAssetName||'');c.destAssetName=String(c.destAssetName||'');c.originFace=c.originFace==='rear'?'rear':'front';c.destFace=c.destFace==='rear'?'rear':'front';});
  state.breakouts=(Array.isArray(state.breakouts)?state.breakouts:[]).filter(b=>b?.origin&&rackIds.has(b.origin.rack));
  state.breakouts.forEach(b=>{b.legs=(b.legs||[]).map(l=>!l.destRack||rackIds.has(l.destRack)?l:{...l,destRack:null,destPortId:null});});
  if(state.selected?.type==='rack'&&!rackIds.has(state.selected.id))state.selected=null;
  state.multiSelected=Array.isArray(state.multiSelected)?state.multiSelected.filter(id=>rackIds.has(id)):[];
  if(state.selected?.type==='rack' && !state.multiSelected.includes(state.selected.id)) state.multiSelected=[state.selected.id];
  const trayIds=new Set(state.trays.map(t=>t.id));
  state.trayMultiSelected=Array.isArray(state.trayMultiSelected)?state.trayMultiSelected.filter(id=>trayIds.has(id)):[];
  if(state.selected?.type==='tray' && !state.trayMultiSelected.includes(state.selected.id)) state.trayMultiSelected=[state.selected.id];
}
// O que "Aplicar estrutura" vai perder ou mudar, contado antes de confirmar.
// Cada rack novo herda cabos e assets do rack que ocupava a mesma posição
// (fileira + índice) na estrutura atual.
function structureRebuildImpact(count,racksPerRow,newUnits){
  const rowIdx=new Map(state.rows.map((r,i)=>[r.id,i]));
  const survives=r=>{const ri=rowIdx.get(r.rowId);return ri!==undefined&&ri<count&&r.index<racksPerRow;};
  const lostIds=new Set(state.racks.filter(r=>!survives(r)).map(r=>r.id));
  const rackIds=new Set(state.racks.map(r=>r.id));
  const mounted=state.assets.filter(a=>a.rackId&&rackIds.has(a.rackId));
  const cablesLost=state.cables.filter(c=>!rackIds.has(c.originRack)||!rackIds.has(c.destRack)||lostIds.has(c.originRack)||lostIds.has(c.destRack)).length;
  const customRacks=state.racks.filter(r=>{
    const row=state.rows.find(x=>x.id===r.rowId);
    return survives(r)&&((row&&r.name!==makeRack(row,r.index).name)||num(r.offset,0)!==0||num(r.yOffset,0)!==0||num(r.powerCapacityW,0)>0||num(r.weightCapacityKg,0)>0);
  }).length;
  // Fileira sem nome é o padrão: só conta como renomeada a que tem nome digitado.
  const renamedRows=state.rows.filter(r=>String(r.name||'').trim()!=='').length;
  return {
    trays:state.trays.length, lostRacks:lostIds.size, customRacks, renamedRows,
    assetsLost:mounted.filter(a=>lostIds.has(a.rackId)).length,
    assetsKept:mounted.filter(a=>!lostIds.has(a.rackId)).length,
    assetsTooTall:mounted.filter(a=>!lostIds.has(a.rackId)&&!isAssetArchived(a)&&assetOccupancy(a).end>newUnits).length, newUnits,
    cablesLost, cablesKept:state.cables.length-cablesLost,
    breakoutsLost:(state.breakouts||[]).filter(b=>lostIds.has(b.origin.rack)||!rackIds.has(b.origin.rack)).length
  };
}
function structureRebuildMessage(count,racksPerRow,i){
  const n=(k,one,many)=>`${k} ${k===1?one:many}`;
  const out=[`A estrutura será refeita com ${n(count,'fileira','fileiras')} de ${n(racksPerRow,'rack','racks')}.`];
  if(i.trays)out.push(`• ${n(i.trays,'calha será removida','calhas serão removidas')} (as calhas são redesenhadas do zero).`);
  if(i.lostRacks)out.push(`• ${n(i.lostRacks,'rack sai','racks saem')} da grade.`);
  if(i.assetsLost)out.push(`• ${n(i.assetsLost,'asset ficará','assets ficarão')} sem rack (a posição instalada é perdida).`);
  if(i.assetsTooTall)out.push(`• ${n(i.assetsTooTall,'asset passa','assets passam')} da altura de ${i.newUnits}U dos racks novos; ficam fora do rack até serem ajustados.`);
  if(i.cablesLost)out.push(`• ${n(i.cablesLost,'cabo será removido','cabos serão removidos')} por perder origem ou destino.`);
  if(i.breakoutsLost)out.push(`• ${n(i.breakoutsLost,'breakout será removido','breakouts serão removidos')} por perder o rack de origem.`);
  if(i.customRacks||i.renamedRows)out.push('• Nomes e ajustes individuais de racks e fileiras (capacidades, posição) voltam ao padrão.');
  const kept=[i.assetsKept?n(i.assetsKept,'asset','assets'):'',i.cablesKept?n(i.cablesKept,'cabo','cabos'):''].filter(Boolean);
  if(kept.length)out.push(`Ficam no mesmo rack (mesma fileira e posição): ${kept.join(' e ')}.`);
  out.push('Dá para desfazer com o botão Desfazer.');
  return out.join('\n');
}
async function rebuildStructureFromSettings(){
  if(structureBlocked())return;
  if(state.rows.length || state.racks.length || state.trays.length){
    const count0=Math.max(0,Math.min(30,Math.floor(num($('rowCount').value,0))));
    const racks0=Math.max(0,Math.min(100,Math.floor(num($('defaultRacks').value,0))));
    const impact=structureRebuildImpact(count0,racks0,Math.max(1,Math.min(60,Math.floor(num($('rackUnits').value,48)))));
    const ok=await uiConfirm(structureRebuildMessage(count0,racks0,impact),{title:'Reconstruir estrutura?',confirmText:'Reconstruir',danger:!!(impact.trays||impact.lostRacks||impact.assetsLost||impact.assetsTooTall||impact.cablesLost)});
    if(!ok)return;
  }

  // Keep cable endpoint references by their physical row/rack slot before rebuilding.
  // This lets cables survive a full structural rebuild even though rack IDs are recreated.
  const oldRows=[...state.rows];
  const oldRacks=[...state.racks];
  const oldRackKey=new Map(oldRacks.map(r=>[r.id,`${oldRows.findIndex(row=>row.id===r.rowId)}:${r.index}`]));
  const oldCables=Array.isArray(state.cables)?JSON.parse(JSON.stringify(state.cables)):[];
  const oldBreakouts=Array.isArray(state.breakouts)?JSON.parse(JSON.stringify(state.breakouts)):[];
  const oldTrayCount=state.trays.length;

  state.projectName=$('projectName').value.trim()||'Data Center';
  state.rackUnits=Math.max(1,Math.min(60,Math.floor(num($('rackUnits').value,48))));
  state.rackWidth=Math.max(.1,num($('rackWidth').value,.6));
  state.rackDepth=Math.max(.1,num($('rackDepth').value,1.2));
  state.rackGap=Math.max(0,num($('rackGap').value,0));
  state.rackPowerCapacityW=Math.max(0,num($('rackPowerCapacity').value,0));
  state.rackWeightCapacityKg=Math.max(0,num($('rackWeightCapacity').value,0));
  state.defaultRowGap=Math.max(0,num($('defaultRowGap').value,1.2));
  state.lastUToTray=Math.max(0,num($('lastUToTray').value,1));
  state.defaultSlack=Math.max(0,num($('defaultSlack').value,0));

  state.rows=[]; state.racks=[]; state.trays=[]; state.trayLinks=[]; state.trayRackLinks=[];
  state.selected=null; state.multiSelected=[]; state.trayMultiSelected=[];

  const count=Math.max(0,Math.min(30,Math.floor(num($('rowCount').value,0))));
  const racks=Math.max(0,Math.min(100,Math.floor(num($('defaultRacks').value,0))));
  for(let i=0;i<count;i++) addRow(racks,i===0?0:state.defaultRowGap);

  // Map old cable endpoints to the newly-created rack IDs using row position + rack slot.
  const newRackByKey=new Map(state.racks.map(r=>[`${state.rows.findIndex(row=>row.id===r.rowId)}:${r.index}`,r.id]));
  let droppedCables=0;
  state.cables=oldCables.map(c=>{
    const originKey=oldRackKey.get(c.originRack), destKey=oldRackKey.get(c.destRack);
    const originRack=newRackByKey.get(originKey), destRack=newRackByKey.get(destKey);
    if(!originRack||!destRack){droppedCables++;return null;}
    const via=(c.via||[]).map(id=>newRackByKey.get(oldRackKey.get(id))).filter(Boolean);
    return {...c,originRack,destRack,via};
  }).filter(Boolean);

  // Breakouts acompanham os racks da mesma posição; sem rack de origem saem, perna sem destino fica livre.
  const movedBreakouts=remapBreakoutRacks(oldBreakouts,id=>newRackByKey.get(oldRackKey.get(id))||null);
  state.breakouts=movedBreakouts.breakouts;
  // Assets instalados acompanham o rack da mesma posição; se ela deixou de existir, ficam sem rack.
  state.assets.forEach(a=>{if(a.rackId&&oldRackKey.has(a.rackId))a.rackId=newRackByKey.get(oldRackKey.get(a.rackId))||null;});
  normalizeState();
  renderAll();
  // Dupla espera por frame de animação: garante que o navegador já
  // terminou de desenhar os racks novos antes de medir a caixa
  // delimitadora pra centralizar (uma só espera às vezes não é
  // suficiente e a centralização acaba não acontecendo).
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.__fitCanvas?.()));
  const msg=oldTrayCount?`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s); ${oldTrayCount} calha(s) antiga(s) removida(s) e a estrutura foi recriada do zero.`:`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s).`;
  const boMsg=state.breakouts.length||movedBreakouts.lost?` ${state.breakouts.length} breakout(s) preservado(s)${movedBreakouts.lost?`, ${movedBreakouts.lost} removido(s) por perder o rack de origem`:''}.`:'';
  toast((droppedCables?`${msg} ${droppedCables} cabo(s) removido(s) por falta de origem/destino.`:msg)+boMsg);
}

function addRow(rackCount=0,gap=state.defaultRowGap){
  const i=state.rows.length;
  // Fileira nasce sem nome: o painel mostra a posição (#1, #2) como dica, e quem batiza é o
  // usuário — pelo campo do cartão ou pelo Renomear do cabeçalho.
  const row={id:uid('row'),name:'',rackCount:0,gap:i===0?0:Math.max(0,gap),depth:Math.max(0.1,num(state.rackDepth,1.20))};
  state.rows.push(row);
  for(let j=0;j<rackCount;j++)state.racks.push(makeRack(row,j));
  row.rackCount=rackCount; normalizeIndices(); return row;
}
function removeRackReferences(ids){
  const set=new Set(ids);
  // NEVER remove or rewrite tray infrastructure when a rack is deleted. Fixed-slot
  // links remain at their physical slot; edge links adapt by side during normalizeState().
  state.cables=state.cables.filter(c=>!set.has(c.originRack)&&!set.has(c.destRack));
  state.cables.forEach(c=>c.via=(c.via||[]).filter(id=>!set.has(id)));
  state.breakouts=state.breakouts.filter(b=>!set.has(b.origin.rack));
  state.breakouts.forEach(b=>b.legs.forEach(l=>{if(set.has(l.destRack)){l.destRack=null;l.destPortId=null;}}));
}
function resizeRow(rowId,count){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  count=Math.max(0,Math.min(100,Math.floor(count)));
  let rs=racksInRow(rowId);
  // Fill the first empty physical slots instead of compacting existing racks.
  const occupied=new Set(rs.map(r=>r.index));
  for(let idx=0;idx<count;idx++){
    if(!occupied.has(idx)){
      const r=makeRack(row,idx);
      state.racks.push(r);
      occupied.add(idx);
    }
  }
  // Reducing the row removes only racks beyond the requested slot count; gaps inside remain.
  const ids=state.racks.filter(r=>r.rowId===rowId && r.index>=count).map(r=>r.id);
  if(ids.length){ state.assets.forEach(a=>{if(ids.includes(a.rackId)){a.rackId=null;}}); state.racks=state.racks.filter(r=>!ids.includes(r.id)); removeRackReferences(ids); }
  row.rackCount=count;
  normalizeIndices(); renderAll(); toast(`Racks de ${row.name} atualizados`);
}
function deleteRow(id){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===id); if(!row)return;
  const ids=racksInRow(id).map(r=>r.id);
  state.rows=state.rows.filter(r=>r.id!==id);
  state.assets.forEach(a=>{if(ids.includes(a.rackId)){a.rackId=null;}});
  state.racks=state.racks.filter(r=>r.rowId!==id);
  removeRackReferences(ids); normalizeState(); state.selected=null; renderAll(); toast('Fileira excluída');
}
// O botão de adicionar fileira vive dentro do cartão da primeira fileira. Sem
// nenhuma fileira não existe cartão: o botão aparece solto, sem moldura.
function rowAddButtonHtml(){
  return `<div class="rows-add-row">
    <button id="btnAddRow" class="btn primary rows-add" type="button" title="Adicionar fileira" aria-label="Adicionar fileira"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Adicionar</button>
    <button id="btnRenameRows" class="btn rows-add" type="button" title="Renomear todas as fileiras em sequência" aria-label="Renomear todas as fileiras"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Renomear</button>
  </div>`;
}
// Os dois botões do cartão de Fileiras são religados a cada redesenho do painel.
function bindRowPanelActions(p){
  const add=p.querySelector('#btnAddRow'); if(add)add.onclick=addRowFromPanel;
  const ren=p.querySelector('#btnRenameRows'); if(ren)ren.onclick=openRenameRowsModal;
}
// Busca do cartão de Fileiras. O campo vive fora do painel (#rowsPanel é redesenhado a cada
// alteração; um input dentro dele perderia o foco a cada tecla).
let rowsSearchQuery='';
// O que a busca de fileiras enxerga: o nome quando existe, a identidade posicional — #2,
// fileira 2, row 2, 2 — e o que a fileira tem dentro, racks e equipamentos. Sem a parte
// posicional, uma fileira sem nome não teria por onde ser encontrada.
function rowMatchesSearch(row,numero,termo,soPosicao){
  const racks=racksInRow(row.id);
  const ids=new Set(racks.map(r=>r.id));
  const assets=state.assets.filter(a=>ids.has(a.rackId)).map(a=>a.name);
  const posicionais=[`${numero}`,`#${numero}`,`fileira ${numero}`,`row ${numero}`,`f ${numero}`]
    .map(catalogNormalize);
  if(posicionais.includes(termo))return true;
  // Com "#" na frente a busca é só posição ("#2" = a fileira 2), sem olhar o que ela tem
  // dentro — é o que evita "#2" trazer a fileira 1 por causa de um rack "-02".
  if(soPosicao)return false;
  // Sem "#", o número procura o número do rack: com racks 201..210, "202" acha a fileira do
  // 202 — e "2" não traz a fileira 1 só porque um rack dela se chama "-02" (o fim do nome tem
  // que ser o número, não um pedaço qualquer).
  if(/^\d+$/.test(termo)){
    const n=Number(termo);
    return racks.some(r=>{
      if(catalogNormalize(r.name)===termo)return true;
      const fim=String(r.name||'').match(/(\d+)\D*$/);
      return !!fim&&Number(fim[1])===n;
    });
  }
  const texto=[row.name,...racks.map(r=>rackDisplayName(r)),...racks.map(r=>r.name),...assets]
    .filter(v=>v!==undefined&&v!==null&&v!=='')
    .map(catalogNormalize).join(' ');
  return texto.includes(termo);
}
function addRowFromPanel(){
  if(structureBlocked())return;
  const rackCount=Math.max(0,Math.min(100,Math.floor(num($('defaultRacks')?.value,0))));
  addRow(rackCount,state.defaultRowGap);
  normalizeIndices();
  renderAll();
  toast(`Fileira ${state.rows.length} adicionada`);
}
function buildRowsPanel(){
  const p=$('rowsPanel'); p.innerHTML='';
  if(!state.rows.length){
    p.innerHTML=`<div class="empty">Nenhuma fileira ainda. Crie a primeira aqui — as fileiras nascem com os racks que você definir.</div>${rowAddButtonHtml()}`;
    bindRowPanelActions(p);
    return;
  }
  // O número da fileira é a posição na ordem de verdade, nunca a posição na lista filtrada:
  // com a busca ativa, o #2 tem que continuar sendo a mesma fileira.
  const numeradas=state.rows.map((row,i)=>({row,numero:i+1}));
  const termo=catalogNormalize(rowsSearchQuery);
  const soPosicao=rowsSearchQuery.trim().startsWith('#');
  const visiveis=(termo?numeradas.filter(({row,numero})=>rowMatchesSearch(row,numero,termo,soPosicao)):numeradas);
  p.classList.toggle('is-filtered',!!termo);
  if(!visiveis.length){
    // O botão de adicionar fica em cima, como na lista normal — não embaixo do aviso.
    p.innerHTML=`${rowAddButtonHtml()}<div class="empty">Nenhuma fileira encontrada para “${esc(rowsSearchQuery.trim())}”.</div>`;
    bindRowPanelActions(p);
    return;
  }
  visiveis.forEach(({row,numero})=>{
    const d=document.createElement('div'); d.className='prop-card prop-row-card';
    d.dataset.rowCard=row.id;
    const racksField=`<label class="prop-field" title="Quantidade de racks"><span class="prop-field-label">${propIcon('rack')}<span class="prop-field-text">Racks</span></span><span class="prop-field-box"><input data-row-count="${row.id}" type="number" min="0" max="100" value="${row.rackCount}"></span></label>`;
    // A primeira fileira não tem fileira anterior: sem campo de distância, o
    // campo de racks ocupa a linha inteira em vez de deixar meia coluna vazia.
    const gapField=numero>1?`<label class="prop-field" title="Distância para a fileira anterior (m)"><span class="prop-field-label">${propIcon('gap')}<span class="prop-field-text">Dist. (m)</span></span><span class="prop-field-box"><input data-row-gap="${row.id}" type="number" min="0" step="0.01" value="${row.gap||0}"></span></label>`:'';
    d.innerHTML=`<header class="row-card-head">
        <button type="button" class="row-handle" data-drag-row="${row.id}" title="Arrastar para reordenar" aria-label="Arrastar para reordenar">${propIcon('grip')}</button>
        <input class="row-title" data-row-name="${row.id}" value="${esc(row.name)}" placeholder="#${numero}" aria-label="Nome da fileira">
        <button type="button" class="iconbtn" data-rename-row="${row.id}" title="Renomear os racks desta fileira automaticamente" aria-label="Renomear racks automaticamente">${propIcon('pencil')}</button>
        <button type="button" class="iconbtn row-del" data-del-row="${row.id}" title="Excluir fileira" aria-label="Excluir fileira">${propIcon('trash')}</button>
      </header>
      ${gapField?`<div class="grid2">${racksField}${gapField}</div>`:racksField}`;
    p.appendChild(d);
  });
  // Adicionar fileira fica acima das fileiras, não dentro da primeira: o botão vale
  // para a lista inteira.
  p.insertAdjacentHTML('afterbegin',rowAddButtonHtml());
  bindRowPanelActions(p);
  bindPropPanel(p);
  p.querySelectorAll('[data-row-name]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;
    const r=state.rows.find(x=>x.id===e.dataset.rowName);
    if(!r)return;
    const oldName=r.name;
    const newName=e.value.trim();
    r.name=newName;
    racksInRow(r.id).forEach(rack=>{
      // Keep custom/blank rack names. Only auto-generated names follow the row name.
      const suffix=String(rack.index+1).padStart(2,'0');
      const wasAuto = oldName
        ? (rack.name===`${oldName}-${suffix}` || rack.name===`${oldName}-${String(rack.index+1)}`)
        // "R-03" é o nome que os racks ganhavam quando a fileira estava sem nome: continua
        // contando como automático, senão eles ficavam presos nesse nome para sempre.
        : (rack.name===suffix || rack.name===String(rack.index+1) || rack.name===`R-${suffix}` || rack.name===`R-${rack.index+1}`);
      if(wasAuto) rack.name = newName ? `${newName}-${suffix}` : suffix;
    });
    normalizeIndices();
    renderAll();
  });
  p.querySelectorAll('[data-row-count]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;resizeRow(e.dataset.rowCount,num(e.value,0));});
  p.querySelectorAll('[data-row-gap]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;const r=state.rows.find(x=>x.id===e.dataset.rowGap);if(!r)return;r.gap=Math.max(0,num(e.value,0));renderAll();});
  p.querySelectorAll('[data-rename-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();openRenameRowModal(e.dataset.renameRow);});
  p.querySelectorAll('[data-del-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();deleteRow(e.dataset.delRow);});
  bindRowReorder(p);
}

// Reordenar fileiras: a alça arrasta, a troca acontece ao soltar (assim o painel é
// redesenhado uma vez só, e não a cada quadro do arraste).
let rowDrag=null;
function bindRowReorder(panel){
  // Lista filtrada: arrastar não corresponde à ordem de verdade, então a alça fica inerte.
  if(rowsSearchQuery.trim())return;
  panel.querySelectorAll('[data-drag-row]').forEach(handle=>{
    handle.addEventListener('pointerdown',ev=>{
      if(structureBlocked())return;
      ev.preventDefault(); ev.stopPropagation();
      const cards=[...panel.querySelectorAll('.prop-row-card')];
      rowDrag={id:handle.dataset.dragRow,cards,
        from:cards.findIndex(c=>c.dataset.rowCard===handle.dataset.dragRow),to:null};
      try{handle.setPointerCapture(ev.pointerId);}catch{}
      panel.classList.add('is-reordering');
      handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove',ev=>{
      if(!rowDrag)return;
      const y=ev.clientY;
      let to=rowDrag.cards.findIndex(c=>{const r=c.getBoundingClientRect();return y<r.top+r.height/2;});
      if(to<0)to=rowDrag.cards.length-1;
      rowDrag.to=to;
      rowDrag.cards.forEach((c,i)=>c.classList.toggle('is-drop-target',i===to&&i!==rowDrag.from));
    });
    const end=()=>{
      if(!rowDrag)return;
      const {from,to}=rowDrag;
      rowDrag.cards.forEach(c=>c.classList.remove('is-drop-target'));
      panel.classList.remove('is-reordering');
      panel.querySelectorAll('.is-dragging').forEach(h=>h.classList.remove('is-dragging'));
      rowDrag=null;
      if(to==null||to===from||from<0)return;
      const row=state.rows.splice(from,1)[0];
      state.rows.splice(to,0,row);
      // A primeira fileira não tem fileira anterior: distância zero.
      state.rows.forEach((r,i)=>{if(i===0)r.gap=0;});
      normalizeIndices();
      renderAll();
      toast(`${row.name||`#${state.rows.findIndex(r=>r.id===row.id)+1}`} movida`);
    };
    handle.addEventListener('pointerup',end);
    handle.addEventListener('pointercancel',end);
  });
}

// Recolher por painel: cada cabeçalho com [data-section-collapse] esconde o corpo da sua
// seção. O cabeçalho fica, com a seta virada.
// Altura do cabeçalho da seção: é o que sobra quando o cartão está recolhido.
function sectionHeadHeight(sec){
  const head=sec.querySelector(':scope > .section-head-sticky, :scope > .prop-head, :scope > .rows-head, :scope > .cables-head');
  const altura=head?Math.round(head.getBoundingClientRect().height):0;
  // Cabeçalho medido com a tela escondida (o app ainda não apareceu, por exemplo) dá 0, e o
  // cartão recolhido ficava com 2px de altura — era assim que o de Propriedades sumia ao
  // restaurar o estado recolhido. Sem medida boa, vale a última altura gravada (ou o padrão do
  // CSS, 56px).
  if(altura>=16)return altura+2;
  const anterior=parseFloat(getComputedStyle(sec).getPropertyValue('--collapsed-h'));
  return Number.isFinite(anterior)&&anterior>=16?Math.round(anterior):56;
}
// Recolher/expandir animando a altura. Antes o corpo ia para display:none, que não tem
// transição: o cartão fechava de uma vez. Aqui a seção recebe um teto de altura explícito
// (--collapsed-h) e o corpo fica recortado, então a altura interpola até o cabeçalho.
// Animação da folga do puxador que anda junto com o recolher/expandir de Propriedades.
let animacaoFolga=null;
function animateSectionCollapse(sec,collapsed,animate=true){
  if(!sec)return;
  // O puxador é quem carrega a folga entre Propriedades e Cabos: o JS escreve margem nele para
  // Cabos ficar no lugar (ver __dccpRightSplit). A folga que ele tem agora é o ponto de partida
  // da animação.
  const puxador=sec.nextElementSibling&&sec.nextElementSibling.classList.contains('prop-section-resize')?sec.nextElementSibling:null;
  const margemInicial=puxador?(parseFloat(getComputedStyle(puxador).marginTop)||0):0;
  sec.style.setProperty('--collapsed-h',sectionHeadHeight(sec)+'px');
  if(!animate){sec.classList.toggle('collapsed',collapsed);return;}
  // Enquanto a altura está animando, o layout da coluna direita não pode medir a seção: ele
  // leria a altura recortada (a do recolhido) e gravaria essa altura inline, travando a
  // expansão. A flag desliga o layout até o fim da transição.
  sec.dataset.animating='1';
  const inicio=sec.offsetHeight;
  // Alvo: aplica o estado final, deixa o layout da coluna recalcular as alturas e mede o que
  // o cartão ocupa de verdade (o conteúdo de Propriedades é mais alto que o espaço que ele
  // recebe, então medir o conteúdo daria um salto no fim).
  sec.classList.toggle('collapsed',collapsed);
  sec.style.height='';
  // Recolhendo, o layout precisa ver o corte final (o max-height que o recolhido aplica) para
  // achar a folga do puxador; expandindo, o teto sai do caminho.
  sec.style.maxHeight=collapsed?'':'none';
  // A folga do puxador sai daqui: é o layout quem sabe onde Cabos fica (divisão arrastada ou
  // automática), e é essa folga que mantém o cartão parado enquanto Propriedades anima.
  delete sec.dataset.animating;
  window.__dccpRightSplit?.();
  sec.dataset.animating='1';
  const fim=collapsed?sectionHeadHeight(sec):sec.offsetHeight;
  const margemAlvo=puxador?(parseFloat(getComputedStyle(puxador).marginTop)||0):0;
  // Recolhendo, a altura que o layout escreveu é a final: a animação parte da inicial, então ela
  // sai daqui e quem manda na altura durante a animação é o max-height.
  if(collapsed)sec.style.height='';
  if(puxador){
    // A margem anda junto com a altura do cartão, com a mesma curva: as duas se cancelam e Cabos
    // fica parado no lugar em que o layout o deixaria.
    if(margemAlvo!==margemInicial&&puxador.animate){
      const semMovimento=matchMedia('(prefers-reduced-motion: reduce)').matches;
      animacaoFolga?.cancel();
      animacaoFolga=puxador.animate([{marginTop:margemInicial+'px'},{marginTop:margemAlvo+'px'}],
        {duration:semMovimento?0:240,easing:'cubic-bezier(0.22, 0.61, 0.36, 1)'});
    }
  }
  // Volta ao ponto de partida sem transição e anima até o alvo.
  sec.style.transition='none';
  sec.style.maxHeight=inicio+'px';
  void sec.offsetHeight;
  sec.style.transition='';
  sec.style.maxHeight=fim+'px';
  const terminar=()=>{
    // A animação da folga vence o estilo inline: enquanto ela vive, o layout mede o vão errado
    // (a margem que ele acabou de limpar continua valendo). Cancelar antes de medir.
    animacaoFolga?.cancel();
    animacaoFolga=null;
    sec.style.transition='';
    sec.style.maxHeight='';
    delete sec.dataset.animating;
    sec.removeEventListener('transitionend',terminar);
    // A altura do arrasto volta só agora: se voltasse no clique, a seção daria um salto e a
    // transição não apareceria. Depois disso o layout da coluna direita assume o valor.
    if(sec.dataset.keepHeight!==undefined)sec.style.height=sec.dataset.keepHeight||'';
    requestAnimationFrame(()=>window.__dccpRightSplit?.());
  };
  // Só a transição da própria seção interessa: a seta do cabeçalho também tem transição e o
  // transitionend dela sobe (bubbles) até aqui, o que encerrava a animação no meio — o layout
  // media a altura ainda em movimento e Cabos parava alguns px fora do lugar.
  const aoTerminar=ev=>{if(ev.target!==sec)return;sec.removeEventListener('transitionend',aoTerminar);terminar();};
  sec.addEventListener('transitionend',aoTerminar);
  setTimeout(terminar,420); // rede de segurança quando não há transição (ex.: prefers-reduced-motion)
}
function bindSectionCollapse(){
  document.querySelectorAll('[data-section-collapse]').forEach(btn=>{
    if(btn.dataset.collapseBound)return;
    btn.dataset.collapseBound='1';
    btn.addEventListener('click',ev=>{
      ev.stopPropagation();
      const sec=btn.closest('section'); if(!sec)return;
      const nome=btn.dataset.sectionCollapse||'painel';
      const collapsed=!sec.classList.contains('collapsed');
      animateSectionCollapse(sec,collapsed);
      // O puxador de redimensionar grava altura inline na seção, e inline vence o CSS: sem
      // guardar e limpar isso, o cartão recolhido continuaria com a altura do arrasto.
      if(collapsed){
        sec.dataset.keepHeight=sec.style.height||'';
        sec.dataset.keepMaxHeight=sec.style.maxHeight||'';
        sec.style.height='';
      }
      // O estado fica no dataset: se o painel for redesenhado, a seção volta recolhida.
      sec.dataset.collapsed=collapsed?'1':'0';
      try{localStorage.setItem(`dccp-collapse-${nome}`,collapsed?'1':'0');}catch{}
      btn.setAttribute('aria-expanded',collapsed?'false':'true');
      const txt=`${collapsed?'Expandir':'Recolher'} ${nome}`;
      btn.title=txt; btn.setAttribute('aria-label',txt);
    });
    // Estado salvo: recolhimento sobrevive a recarregar a página.
    const secInicial=btn.closest('section');
    if(secInicial&&!secInicial.dataset.collapseRestored){
      secInicial.dataset.collapseRestored='1';
      const nomeInicial=btn.dataset.sectionCollapse||'painel';
      let salvo=null; try{salvo=localStorage.getItem(`dccp-collapse-${nomeInicial}`);}catch{}
      if(salvo==='1'){
        animateSectionCollapse(secInicial,true,false);
        secInicial.dataset.collapsed='1';
        btn.setAttribute('aria-expanded','false');
        const txt=`Recolher ${nomeInicial}`;
        btn.title=txt; btn.setAttribute('aria-label',txt);
      }
    }
    // Redesenho do painel (trocar a seleção, mudar a U de um cabo) não pode devolver o
    // conteúdo: observa a seção e reaplica o estado guardado.
    const sec=btn.closest('section');
    if(sec&&!sec.dataset.collapseWatch){
      sec.dataset.collapseWatch='1';
      const guard=()=>{
        if(sec.dataset.collapsed==='1'&&!sec.classList.contains('collapsed'))sec.classList.add('collapsed');
      };
      // Qualquer redesenho do painel — troca de seleção, mudança de U, re-render da lista —
      // passa por aqui e devolve o recolhimento. Sem isso o conteúdo voltava sozinho.
      new MutationObserver(guard).observe(sec,{
        childList:true, subtree:true, attributes:true, attributeFilter:['class'],
      });
      window.addEventListener('resize',guard);
      // O cabeçalho é a altura do cartão recolhido, e ele muda de tamanho: ganha a segunda
      // linha quando há seleção e mede 0 enquanto o app está escondido (é aí que o estado
      // recolhido é restaurado). Acompanhar o tamanho mantém --collapsed-h certo nos dois
      // casos — sem isto o recolhido corta a pílula e chega a virar uma tira de 2px.
      const cabecalho=sec.querySelector(':scope > .section-head-sticky, :scope > .prop-head, :scope > .rows-head, :scope > .cables-head');
      if(cabecalho&&window.ResizeObserver){
        new ResizeObserver(()=>{
          const h=cabecalho.getBoundingClientRect().height;
          if(h<16)return;
          sec.style.setProperty('--collapsed-h',Math.round(h+2)+'px');
          if(sec.dataset.animating==='1'||!sec.classList.contains('collapsed'))return;
          // O layout reposiciona Cabos (a folga do puxador absorve o que o cartão devolve).
          requestAnimationFrame(()=>window.__dccpRightSplit?.());
        }).observe(cabecalho);
      }
    }
  });
}
// Modo foco: Ctrl/Cmd+B esconde os dois painéis e devolve a planta inteira.
function setupFocusMode(){
  if(window.__dccpFocusBound)return;
  window.__dccpFocusBound=true;
  const shell=document.querySelector('.app'); if(!shell)return;
  window.addEventListener('keydown',ev=>{
    if(!(ev.ctrlKey||ev.metaKey)||ev.altKey)return;
    if(String(ev.key).toLowerCase()!=='b')return;
    ev.preventDefault();
    const hidden=shell.classList.toggle('panels-hidden');
    requestAnimationFrame(()=>{window.__updateMinimap?.();fitBottomRow();});
    toast(hidden?'Painéis ocultos — Ctrl+B para voltar':'Painéis de volta');
  });
}
function openRenameRowModal(rowId){
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const racks=racksInRow(rowId); if(!racks.length){toast('Esta fileira não possui racks');return;}
  const rowIndexValue=state.rows.findIndex(r=>r.id===rowId);
  const prefixDefault=`${rowIndexValue+1}0`;
  $('renameRowModal').dataset.alvo='racks';
  setRenameModalHint('Renomeie todos os racks da fileira de uma só vez.');
  $('renameRowId').value=rowId;
  $('renamePrefix').value=prefixDefault;
  $('renameStart').value=1;
  $('renamePad').value=0;
  $('renameRowTitle').textContent=`Renomear racks — ${row.name||`#${state.rows.findIndex(r=>r.id===row.id)+1}`}`;
  $('renameRowError').textContent='';
  $('renameRowModal').classList.add('open');
  updateRenamePreview();
  setTimeout(()=>{$('renamePrefix').focus();$('renamePrefix').select();},0);
}
function closeRenameRowModal(){$('renameRowModal').classList.remove('open');}
// Renomear todas as fileiras de uma vez, com a mesma régua dos racks: prefixo + sequência.
function openRenameRowsModal(){
  if(!state.rows.length){toast('Nenhuma fileira para renomear');return;}
  $('renameRowModal').dataset.alvo='fileiras';
  setRenameModalHint('As fileiras são renomeadas na ordem em que aparecem na planta.');
  $('renameRowId').value='';
  $('renamePrefix').value='#';
  $('renameStart').value=1;
  $('renamePad').value=0;
  $('renameRowTitle').textContent='Renomear fileiras';
  $('renameRowError').textContent='';
  $('renameRowModal').classList.add('open');
  updateRenamePreview();
  setTimeout(()=>{$('renamePrefix').focus();$('renamePrefix').select();},0);
}
function setRenameModalHint(texto){const h=$('renameRowModal')?.querySelector('.modal-head span'); if(h)h.textContent=texto;}
function buildRenameNames(){
  const prefix=$('renamePrefix').value.trim();
  const start=Math.max(0,Math.floor(num($('renameStart').value,1)));
  // 'Zeros à esquerda' is the number of zeros to add before the number,
  // not the total width of the numeric portion. Example: 1 -> 01, 2 -> 001.
  const zeros=Math.max(0,Math.min(6,Math.floor(num($('renamePad').value,0))));
  return renameTargets().map((_,i)=>{
    const n=String(start+i);
    return `${prefix}${n.padStart(n.length+zeros,'0')}`;
  });
}
// O mesmo modal renomeia os racks de uma fileira ou todas as fileiras.
function renameTargets(){
  return $('renameRowModal').dataset.alvo==='fileiras'?state.rows:racksInRow($('renameRowId').value);
}
// Nomes que já pertencem a outro item da mesma família bloqueiam a aplicação.
function renameConflict(names,currentIds){
  const outros=$('renameRowModal').dataset.alvo==='fileiras'?state.rows:state.racks;
  return outros.some(x=>!currentIds.has(x.id)&&names.includes(x.name));
}
function updateRenamePreview(){
  const racks=renameTargets();
  const names=buildRenameNames();
  const currentIds=new Set(racks.map(r=>r.id));
  const duplicate=new Set(names).size!==names.length;
  const existingConflict=renameConflict(names,currentIds);
  const err=duplicate?'Os novos nomes possuem duplicidade.':existingConflict?'Um ou mais nomes já estão sendo usados por outro rack.':'';
  const preview=$('renamePreview');
  preview.innerHTML=racks.map((r,i)=>`<div class="rename-preview-row"><span>${esc(r.name)}</span><b>→</b><span>${esc(names[i])}</span></div>`).join('');
  $('renameRowError').textContent=err;
  $('renameApply').disabled=!!err;
}
function applyRenameRow(){
  if(structureBlocked())return;
  const racks=renameTargets(), names=buildRenameNames();
  if(!racks.length)return;
  const currentIds=new Set(racks.map(r=>r.id));
  if(new Set(names).size!==names.length || renameConflict(names,currentIds)){toast('Não foi possível aplicar: nomes duplicados');return;}
  racks.forEach((r,i)=>r.name=names[i]);
  closeRenameRowModal();
  renderAll();
  toast(`${racks.length} ${renameTargets()===state.rows?'fileiras':'racks'} renomeados`);
}


function migrateLegacyTrays(g){
  const legacy=state.trays.filter(t=>t._legacy); if(!legacy.length)return;
  const converted=[];
  legacy.forEach(t=>{
    const ra=state.rows.find(r=>r.id===t.fromRowId), rb=state.rows.find(r=>r.id===t.toRowId);
    if(!ra||!rb)return;
    const sa=trayPointForRowIndex(ra,t.fromIndex,g,t.sideFrom||null);
    const sb=trayPointForRowIndex(rb,t.toIndex,g,t.sideTo||null);
    converted.push({
      id:t.id||uid('tray'),name:t.name||'Calha',x1:sa.x,y1:sa.y,x2:sb.x,y2:sb.y,width:num(t.width,.10),
      fromRowId:t.fromRowId,toRowId:t.toRowId,fromIndex:Number(t.fromIndex),toIndex:Number(t.toIndex),
      edge:!!t.edge,sideFrom:t.sideFrom||null,sideTo:t.sideTo||null
    });
  });
  state.trays=state.trays.filter(t=>!t._legacy).concat(converted);
  if(converted.length)localStorage.setItem(runtime.STORAGE,JSON.stringify(state));
}
function createIndependentTray(g,x1,y1,x2,y2){
  if(structureBlocked())return;
  const t={id:uid('tray'),name:`Calha ${state.trays.length+1}`,x1,y1,x2,y2,width:.10};
  state.trays.push(t);state.multiSelected=[];state.trayMultiSelected=[t.id];state.selected={type:'tray',id:t.id};renderAll();toast('Calha independente criada');
  flashSelection();
}

// --- Camadas de calor, dica do rack e resumo da sala --------------------------
const HEAT_STORAGE='dc-planner-heat-mode';
let heatMode=(()=>{try{const v=localStorage.getItem(HEAT_STORAGE);return HEAT_MODES.includes(v)?v:'off';}catch{return 'off';}})();
let rackStats=new Map();
function assetLifecycleLevel(a){const w=assetWarrantyLevel(a),e=assetEndOfLifeLevel(a);return (w==='expired'||e==='expired')?'expired':(w==='soon'||e==='soon')?'soon':'ok';}
function computeStats(){return computeRackMetrics(state.racks,state.assets,{defaultUnits:state.rackUnits,lifecycleLevel:assetLifecycleLevel});}
const HEAT_LEGEND_CAP=[['l1','< 50%'],['l2','50–80%'],['l3','80–100%'],['l4','> 100%'],['none','Sem capacidade']];
const HEAT_LEGENDS={
  u:[['l1','< 50%'],['l2','50–80%'],['l3','80–100%']],
  power:HEAT_LEGEND_CAP,
  weight:HEAT_LEGEND_CAP,
  alerts:[['l1','Sem alerta'],['l3','Atenção'],['l4','Crítico']]
};
function updateHeatControl(){
  const box=$('heatControl'); if(!box)return;
  box.querySelectorAll('[data-heat]').forEach(b=>{const on=b.dataset.heat===heatMode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');});
  positionHeatPill();
  const legend=$('heatLegend'); if(!legend)return;
  const items=HEAT_LEGENDS[heatMode];
  legend.classList.toggle('hidden',!items);
  legend.innerHTML=items?items.map(([lv,label])=>`<span class="heat-legend-item"><i class="heat-swatch heat-${lv}"></i>${esc(label)}</span>`).join(''):'';
}
// O pill desliza até o modo ativo. Mede em coordenadas de tela porque a barra
// quebra linha em telas estreitas — aí o pill precisa acompanhar a linha nova.
function positionHeatPill(){
  const bar=document.querySelector('.heat-modes'); if(!bar)return;
  const pill=bar.querySelector('.heat-pill'); if(!pill)return;
  const active=bar.querySelector('[data-heat].active');
  if(!active){pill.style.opacity='0';return;}
  const barRect=bar.getBoundingClientRect(), rect=active.getBoundingClientRect();
  if(!barRect.width||!rect.width){pill.style.opacity='0';return;}
  // O filho absoluto se posiciona pelo padding box, então a borda da barra
  // entra na conta — sem isso o pill fica deslocado meio pixel.
  const cs=getComputedStyle(bar);
  const borderLeft=parseFloat(cs.borderLeftWidth)||0, borderTop=parseFloat(cs.borderTopWidth)||0;
  pill.style.opacity='1';
  pill.style.width=`${rect.width}px`;
  pill.style.height=`${rect.height}px`;
  pill.style.transform=`translate(${rect.left-barRect.left-borderLeft}px, ${rect.top-barRect.top-borderTop}px)`;
}
function setupSummaryRefit(){
  let timer=null;
  window.addEventListener('resize',()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{if(!state.selected&&!state.multiSelected.length&&!state.trayMultiSelected.length)renderProperties();},150);
  });
}
const ENV_ADVANCED_STORAGE='dc-planner-env-advanced';
function setupEnvAdvanced(){
  const box=$('envAdvanced'), btn=$('envAdvancedToggle'); if(!box||!btn)return;
  const apply=open=>{box.classList.toggle('hidden',!open);btn.setAttribute('aria-expanded',open?'true':'false');btn.querySelector('span').textContent=open?'Menos opções':'Mais opções';};
  let open=false;
  try{open=localStorage.getItem(ENV_ADVANCED_STORAGE)==='1';}catch{}
  apply(open);
  btn.addEventListener('click',()=>{open=!open;apply(open);try{localStorage.setItem(ENV_ADVANCED_STORAGE,open?'1':'0');}catch{}});
}
async function exportPlant(kind){
  const svg=$('layout');
  if(!svg||!state.racks.length){toast('Não há planta para exportar.');return;}
  try{
    const cap=capturePlant(svg,{pxPerMeter:geometry().scale});
    if(!cap){toast('Não há planta para exportar.');return;}
    const room=state.rooms.find(r=>r.id===state.activeRoomId);
    const loc=(state.locations||[]).find(l=>l.id===room?.locationId);
    const {svg:markup,width,height}=composePlantSvg(cap,{title:state.projectName||'Data Center',subtitle:[loc?.name,room?.name].filter(Boolean).join(' / ')});
    const base=safeFileName(`${state.projectName||'planta'}_${room?.name||''}_planta`);
    if(kind==='svg')downloadBlob(new Blob([markup],{type:'image/svg+xml'}),`${base}.svg`);
    else downloadBlob(await svgToPngBlob(markup,width,height,2),`${base}.png`);
    toast(kind==='svg'?'Planta exportada em SVG.':'Planta exportada em PNG.');
  }catch(err){console.error('Exportar planta:',err);toast('Não foi possível exportar a planta.');}
}
function setupPlantExport(){
  const btn=$('btnExportPlant'), menu=$('plantExportMenu'); if(!btn||!menu)return;
  const close=()=>{menu.classList.add('hidden');btn.setAttribute('aria-expanded','false');};
  btn.addEventListener('click',e=>{e.stopPropagation();const open=menu.classList.contains('hidden');menu.classList.toggle('hidden',!open);btn.setAttribute('aria-expanded',open?'true':'false');});
  menu.addEventListener('click',e=>{const item=e.target.closest('[data-plant-export]');if(!item)return;e.stopPropagation();close();exportPlant(item.dataset.plantExport);});
  document.addEventListener('click',close);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
}
function setupHeatControl(){
  $('heatControl')?.addEventListener('pointerdown',e=>e.stopPropagation());
  $('heatControl')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-heat]'); if(!b||b.dataset.heat===heatMode)return;
    heatMode=b.dataset.heat;
    try{localStorage.setItem(HEAT_STORAGE,heatMode);}catch{}
    updateHeatControl(); render();
  });
  updateHeatControl();
  // O pill é medido no DOM: reage a resize, quebra de linha da barra e à
  // fonte carregada depois (que muda a largura dos rótulos).
  const bar=document.querySelector('.heat-modes');
  if(bar&&typeof ResizeObserver==='function'){
    new ResizeObserver(()=>positionHeatPill()).observe(bar);
    bar.querySelectorAll('[data-heat]').forEach(b=>new ResizeObserver(()=>positionHeatPill()).observe(b));
  }
  window.addEventListener('resize',positionHeatPill);
  document.fonts?.ready?.then(()=>positionHeatPill()).catch(()=>{});
}
const pctText=v=>`${Math.round(v*100)}%`;
const kgText=v=>String(Math.round(v*10)/10);
function rackTooltipHtml(r,m){
  const row=(label,valueText,ratio)=>{
    const w=ratio===null?0:Math.min(100,Math.round(ratio*100));
    return `<div class="rack-tip-row"><span>${label}</span><b>${valueText}</b></div>`
      +`<div class="rs-bar"><i class="heat-${levelForRatio(ratio)}" style="width:${w}%"></i></div>`;
  };
  const cap=(label,used,unit,capacity,ratio)=>capacity>0
    ?row(label,`${used} de ${capacity} ${unit} · ${pctText(ratio)}`,ratio)
    :row(label,`${used} ${unit} · sem capacidade`,null);
  const alerts=[m.expired?`${m.expired} com prazo vencido`:'',m.soon?`${m.soon} vencendo em breve`:''].filter(Boolean).join(' · ');
  return `<div class="rack-tip-title"><b>${esc(rackDisplayName(r))}</b><span>${m.totalU}U · ${m.assetCount} ${m.assetCount===1?'asset':'assets'}</span></div>`
    +row('Ocupação de U',`${m.usedU}/${m.totalU} · ${pctText(m.uRatio)}`,m.uRatio)
    +`<div class="rack-tip-sub">Frente ${m.frontU} · Traseira ${m.rearU} · ${m.freeU} livres</div>`
    +cap('Energia',m.powerW,'W',m.powerCap,m.powerRatio)
    +cap('Peso',kgText(m.weightKg),'kg',m.weightCap,m.weightRatio)
    +(alerts?`<div class="rack-tip-alert alert-${m.alertLevel}">${esc(alerts)}</div>`:'');
}
const HEAT_CLASSES=['heat-l1','heat-l2','heat-l3','heat-l4','heat-none','hover-tint'];
function setupRackTooltip(){
  const svg=$('layout'), tip=$('rackTooltip'), wrap=$('canvasWrap'); if(!svg||!tip||!wrap)return;
  let tinted=null;
  // Cartão de dados do rack: passa na frente das calhas enquanto o mouse está
  // sobre ele. A posição original é restaurada ao sair.
  let fronted=null, frontedIndex=-1;
  const restoreFront=()=>{
    if(fronted&&fronted.parentNode===svg){
      const kids=[...svg.children];
      const at=Math.max(0,Math.min(frontedIndex,kids.length));
      const ref=kids[at]&&kids[at]!==fronted?kids[at]:null;
      svg.insertBefore(fronted,ref);
    }
    fronted=null; frontedIndex=-1;
  };
  const bringToFront=g=>{
    if(g===fronted)return;
    restoreFront();
    if(!g||g.parentNode!==svg)return;
    frontedIndex=[...svg.children].indexOf(g); svg.appendChild(g); fronted=g;
  };
  // No modo Normal o rack sob o mouse ganha a cor da ocupação de U; nos outros
  // modos ele já está colorido pela camada escolhida.
  const untint=()=>{tinted?.classList.remove(...HEAT_CLASSES);tinted=null;};
  const hide=()=>{tip.classList.add('hidden');untint();restoreFront();};
  svg.addEventListener('mousemove',e=>{
    if(e.buttons){hide();return;}
    const under=document.elementsFromPoint(e.clientX,e.clientY);
    const id=under.map(el=>el.closest('[data-rack]')).find(Boolean)?.dataset.rack;
    bringToFront(under.map(el=>el.closest('.rack-info')).find(Boolean)||null);
    const m=id&&rackStats.get(id), r=id&&state.racks.find(x=>x.id===id);
    if(!m||!r){hide();return;}
    const body=heatMode==='off'?svg.querySelector(`[data-rack="${id}"] .rack-body`):null;
    if(body!==tinted){untint();if(body){body.classList.add(`heat-${levelForRatio(m.uRatio)}`,'hover-tint');tinted=body;}}
    tip.innerHTML=rackTooltipHtml(r,m); tip.classList.remove('hidden');
    const box=wrap.getBoundingClientRect();
    let x=e.clientX-box.left+16, y=e.clientY-box.top+16;
    if(x+tip.offsetWidth>box.width-8)x=e.clientX-box.left-tip.offsetWidth-16;
    if(y+tip.offsetHeight>box.height-8)y=e.clientY-box.top-tip.offsetHeight-16;
    tip.style.left=`${Math.max(8,x)}px`; tip.style.top=`${Math.max(8,y)}px`;
  });
  svg.addEventListener('mouseleave',hide);
  svg.addEventListener('mousedown',hide);
}
function summaryMeter(label,valueText,ratio,hint=''){
  const lv=levelForRatio(ratio);
  const width=ratio===null?0:Math.min(100,Math.round(ratio*100));
  return `<div class="rs-meter"${hint?` title="${esc(hint)}"`:''}><div class="rs-meter-head"><span>${label}</span><b>${valueText}</b></div>`
    +`<div class="rs-bar"><i class="heat-${lv}" style="width:${width}%"></i></div></div>`;
}
function roomSummaryData(){
  const room=state.rooms.find(r=>r.id===state.activeRoomId);
  const s=summarizeRackMetrics([...computeStats().values()]);
  const thermal=roomThermalLoad(room);
  const roomId=state.activeRoomId;
  const byType=new Map();
  state.cables.forEach(c=>{const t=c.type||'Sem tipo';byType.set(t,(byType.get(t)||0)+1);});
  const chips=[...byType.entries()].sort((a,b)=>b[1]-a[1]);
  const items=[
    ...positionIssues().filter(i=>i.roomId===roomId).map(i=>({level:'high',title:i.name,detail:i.detail,kind:'rack',value:i.rackId})),
    ...capacityIssues().filter(i=>i.roomId===roomId).map(i=>({level:i.level,title:i.name,detail:`${i.label} · ${Math.round(i.current)}/${Math.round(i.capacity)} ${i.unit}`,kind:i.kind==='cooling'?'room':'rack',value:i.kind==='cooling'?roomId:i.rackId})),
    ...assetsNeedingAttention().filter(a=>a.roomId===roomId).map(a=>{
      const w=assetWarrantyLevel(a),e=assetEndOfLifeLevel(a);
      const reason=[w==='expired'?'Garantia vencida':w==='soon'?'Garantia vence em breve':null,e==='expired'?'EOL vencido':e==='soon'?'EOL vence em breve':null].filter(Boolean).join(' · ');
      return {level:(w==='expired'||e==='expired')?'high':'mid',title:a.name||a.assetTag||'Asset',detail:reason,kind:'asset',value:a.id};
    })
  ];
  return {room,s,thermal,chips,items};
}
// `alerts`/`chips` limitam quantos alertas e chips de tipo de cabo entram.
function roomSummaryHtml({s,thermal,chips,items},{alerts,chips:chipCount}){
  const meters=[
    s.powerCap>0
      ?summaryMeter('Energia',`${s.powerW}/${s.powerCap} W · ${pctText(s.powerRatio)}`,s.powerRatio)
      :summaryMeter('Energia',`${s.powerW} W`,null,'Sem capacidade elétrica definida nos racks.'),
    s.weightCap>0
      ?summaryMeter('Peso no piso',`${kgText(s.weightKg)}/${s.weightCap} kg · ${pctText(s.weightRatio)}`,s.weightRatio)
      :summaryMeter('Peso no piso',`${kgText(s.weightKg)} kg`,null,'Sem capacidade de carga definida nos racks.'),
    thermal.capacity>0
      ?summaryMeter('Refrigeração',`${thermal.watts}/${thermal.capacity} W · ${thermal.pct}%`,thermal.watts/thermal.capacity)
      :summaryMeter('Refrigeração',`${thermal.watts} W`,null,'Sem capacidade de refrigeração definida na sala.')
  ].join('');
  const facts=`<div class="rs-facts"><span><b>${state.rows.length}</b> fileiras</span><span><b>${s.racks}</b> racks</span><span><b>${s.assetCount}</b> assets</span><span><b>${state.cables.length}</b> cabos</span><span><b>${state.trays.length}</b> calhas</span></div>`;
  const chipHtml=chipCount>0&&chips.length?`<div class="rs-chips">${chips.slice(0,chipCount).map(([t,n])=>`<span class="rs-chip">${esc(t)} <b>${n}</b></span>`).join('')}</div>`:'';
  const shown=items.slice(0,alerts);
  let alertHtml;
  if(!items.length)alertHtml='<div class="rs-ok">Nenhum alerta nesta sala.</div>';
  else{
    alertHtml=shown.map((it,i)=>`<button type="button" class="capacity-alert-item level-${it.level}" data-rs-i="${i}"><span>${esc(it.title)}</span><small>${esc(it.detail)}</small></button>`).join('');
    if(items.length>shown.length)alertHtml+=`<button type="button" class="alerts-center-viewall" id="rsAllAlerts">${shown.length?`Mais ${items.length-shown.length}`:`${items.length} ${items.length===1?'alerta':'alertas'}`} na Central de alertas →</button>`;
  }
  return `<div class="room-summary">${meters}${facts}${chipHtml}<div class="rs-group-label">Alertas da sala</div><div class="rs-alerts">${alertHtml}</div></div>`;
}
function renderRoomSummary(p){
  const data=roomSummaryData();
  setPropTitleSticky(data.room?`Resumo · ${data.room.name}`:'Resumo da sala');
  // Sem seleção o cabeçalho é o da sala. Sem esta linha ele ficava com o texto da seleção
  // anterior ("3 racks selecionados") depois de limpar a seleção no canvas.
  setPropHead('default','Propriedades','Selecione um rack, calha ou cabo.');
  // O resumo tem que caber sem barra de rolagem. Começa com todos os alertas e
  // os chips de tipo de cabo; se transbordar, tira primeiro os chips e depois
  // os alertas que não cabem (o botão "Mais N" leva à Central de alertas).
  const section=p.closest('section');
  const overflow=()=>section?section.scrollHeight-section.clientHeight:0;
  let alerts=Math.min(data.items.length,60), chips=3;
  p.innerHTML=roomSummaryHtml(data,{alerts,chips});
  for(let guard=0;overflow()>0&&guard<80;guard++){
    if(chips>0)chips=0;
    else if(alerts>0){
      const row=(p.querySelector('[data-rs-i]')?.offsetHeight||26)+2;
      alerts=Math.max(0,alerts-Math.max(1,Math.ceil(overflow()/row)));
    }else break;
    p.innerHTML=roomSummaryHtml(data,{alerts,chips});
  }
  const shown=data.items.slice(0,p.querySelectorAll('[data-rs-i]').length);
  p.querySelectorAll('[data-rs-i]').forEach(btn=>btn.onclick=()=>{
    const it=shown[Number(btn.dataset.rsI)];
    if(it.kind==='asset'){openAssetModal(it.value);return;}
    if(it.kind==='room'){openRoomEditor(it.value);return;}
    state.multiSelected=[]; state.selected={type:'rack',id:it.value}; renderAll(false); renderProperties();
  });
  $('rsAllAlerts')?.addEventListener('click',e=>{e.stopPropagation();openAlertsCenterPanel($('btnAlertsCenter')||$('properties'));});
}

// Ícones do cartão de dados que fica embaixo de cada rack na planta.
const RACK_META_ICONS={
  units:'<rect x="0.6" y="1.8" width="10.8" height="2.4" rx="0.6"/><rect x="0.6" y="4.8" width="10.8" height="2.4" rx="0.6"/><rect x="0.6" y="7.8" width="10.8" height="2.4" rx="0.6"/>',
  width:'<path d="M0.9 2.2v7.6M11.1 2.2v7.6M2.9 6h6.2M2.9 6l1.7-1.7M2.9 6l1.7 1.7M9.1 6 7.4 4.3M9.1 6 7.4 7.7"/>',
  depth:'<path d="M2.2 0.9h7.6M2.2 11.1h7.6M6 2.9v6.2M6 2.9 4.3 4.6M6 2.9l1.7 1.7M6 9.1 4.3 7.4M6 9.1l1.7-1.7"/>'
};
function render(){
  const svg=$('layout'),stage=$('canvasStage'),g=geometry();
  rackStats=computeStats();
  migrateLegacyTrays(g);
  syncAttachedTrayEndpoints(g);
  cleanupAutoCrossingLinks();
  // The stage is deliberately sized to the complete drawing so the scroll container
  // always has real horizontal AND vertical overflow when the plant is larger than the viewport.
  // Keep a real, larger-than-viewport scroll surface. This is intentionally independent
  // of the SVG viewBox so both native scrollbars always have a measurable range.
  const surfaceW=Math.max(g.w, g.vw+VIEW_PAD*2);
  const surfaceH=Math.max(g.h, g.vh+VIEW_PAD*2);
  stage.style.width=`${surfaceW}px`; stage.style.height=`${surfaceH}px`; stage.style.minWidth=`${surfaceW}px`; stage.style.minHeight=`${surfaceH}px`;
  svg.setAttribute('viewBox',`0 0 ${g.w} ${g.h}`); svg.setAttribute('width',g.w); svg.setAttribute('height',g.h); svg.style.width=`${g.w}px`; svg.style.height=`${g.h}px`; svg.style.minWidth=`${g.w}px`; svg.style.minHeight=`${g.h}px`; svg.style.maxWidth='none'; svg.style.maxHeight='none'; svg.style.display='block';
  svg.innerHTML='';
  if(window.__applyCanvasPan)requestAnimationFrame(window.__applyCanvasPan);
  // Perfuração da placa do rack: padrão de pontos usado como textura do
  // faceplate. Definido uma vez por render.
  svg.insertAdjacentHTML('beforeend',`<defs><pattern id="rackPunch" width="5.5" height="5.5" patternUnits="userSpaceOnUse"><circle class="rack-punch-dot" cx="1.3" cy="1.3" r="0.78"/></pattern></defs>`);
  for(let x=0;x<g.w;x+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="${x}" y1="0" x2="${x}" y2="${g.h}"/>`);
  for(let y=0;y<g.h;y+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="0" y1="${y}" x2="${g.w}" y2="${y}"/>`);

  state.rows.forEach((row,ri)=>{
    const cy=rowCenterY(ri,g);
    // Sem nome, o rótulo da planta cai para a identidade posicional (#2) em vez de sumir.
    svg.insertAdjacentHTML('beforeend',`<text class="svg-row" x="${Math.max(8,g.x0-46)}" y="${cy+4}" text-anchor="end">${esc(row.name||`#${ri+1}`)}</text>`);
    if(ri>0){
      const prev=g.rows[ri-1],cur=g.rows[ri];
      const gap=Math.max(0,num(row.gap,0));
      const upperBottom=prev.y+(rowDepth(prev)*g.scale);
      const lowerTop=cur.y;
      // Dimension line sits just left of the racks, closer than the fileira
      // label, so it still reads as attached to the racks it measures.
      const xDim=Math.max(40, g.x0-40);
      const xExt=g.x0-16;
      const midY=(upperBottom+lowerTop)/2;
      svg.insertAdjacentHTML('beforeend',`<line class="row-gap-dim" x1="${xDim}" y1="${upperBottom}" x2="${xDim}" y2="${lowerTop}"/>`
        +`<line class="row-gap-ext" x1="${xDim}" y1="${upperBottom}" x2="${xExt}" y2="${upperBottom}"/>`
        +`<line class="row-gap-ext" x1="${xDim}" y1="${lowerTop}" x2="${xExt}" y2="${lowerTop}"/>`
        +`<line class="row-gap-tick" x1="${xDim-5}" y1="${upperBottom}" x2="${xDim+5}" y2="${upperBottom}"/>`
        +`<line class="row-gap-tick" x1="${xDim-5}" y1="${lowerTop}" x2="${xDim+5}" y2="${lowerTop}"/>`
        +`<text class="row-gap-label" x="${xDim-9}" y="${midY+3}" text-anchor="end">${gap.toFixed(2)} m</text>`);
    }
  });

  // Camada 1: corpos dos racks. O desenho visual fica levemente afastado,
  // mas a área real de seleção continua usando a geometria completa do rack.
  state.racks.forEach(r=>{
    const q=rackRect(r,g),selected=state.multiSelected.includes(r.id) || (state.selected?.type==='rack'&&state.selected.id===r.id);
    const inset=3;
    const vx=q.x+inset, vy=q.y+inset, vw=Math.max(1,q.w-inset*2), vh=Math.max(1,q.h-inset*2);
    const m=rackStats.get(r.id);
    const usedU=m.usedU, pct=m.uRatio;
    const heatLvl=heatLevel(m,heatMode), heatClass=heatLvl?`heat-${heatLvl}`:'';
    const alertBadge=m.alertLevel==='l1'?'':`<g class="rack-alert alert-${m.alertLevel}"><circle cx="${vx+vw-6}" cy="${vy+6}" r="5"/><text x="${vx+vw-6}" y="${vy+9}" text-anchor="middle">!</text></g>`;
    // Bezel grosso, placa perfurada recuada, faixa de LED no topo da placa e
    // puxador na lateral. A perfuração só entra quando o rack tem largura
    // para a textura respirar.
    const wide=vw>=38;
    const bezel=6;
    const plateX=vx+bezel, plateY=vy+bezel;
    const plateW=Math.max(1,vw-bezel*2), plateH=Math.max(1,vh-bezel*2);
    const stripW=Math.max(10,plateW*0.44), stripH=3.4;
    const stripX=plateX+(plateW-stripW)/2, stripY=plateY+5;
    const handleH=Math.max(12,plateH*0.34), handleX=vx+vw-4.6, handleY=vy+(vh-handleH)/2;
    // A faixa de LED no topo segue o consumo elétrico quando o rack tem
    // capacidade cadastrada; sem capacidade definida, cai de volta no sinal
    // simples de "tem equipamento instalado".
    const powerCapacity=m.powerCap;
    const rackPowerW=m.powerW;
    let ledClass='';
    if(powerCapacity>0){
      ledClass=rackPowerW>powerCapacity?'is-power-high':(rackPowerW/powerCapacity>=0.8?'is-power-mid':'is-on');
    }else if(usedU>0){
      ledClass='is-on';
    }
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><rect class="rack-hit" x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="8"/><rect class="rack-body ${selected?'selected':''} ${heatClass}" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="6"/><rect class="rack-plate" x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="3"/>${wide?`<rect class="rack-punch" x="${plateX}" y="${plateY}" width="${plateW}" height="${plateH}" rx="3"/>`:''}<rect class="rack-strip ${ledClass}" x="${stripX}" y="${stripY}" width="${stripW}" height="${stripH}" rx="1.7"/><rect class="rack-handle" x="${handleX}" y="${handleY}" width="2.6" height="${handleH}" rx="1.3"/>${alertBadge}</g>`);
  });

  // Camada 2: cartão de dados do rack, logo abaixo do desenho. Fica antes das
  // calhas para que a infraestrutura possa passar por cima.
  state.racks.forEach(r=>{
    const q=rackRect(r,g),c=rackCenter(r,g);
    // Cartão discreto: mais estreito que o rack e com três linhas curtas, para
    // não virar um bloco no meio do corredor.
    const cardW=Math.max(58,Math.min(q.w-12,84)), cardX=c.x-cardW/2, cardY=q.y+q.h+5, cardH=38;
    const metaRow=(i,icon,label)=>`<g class="rack-meta-ico" transform="translate(${(cardX+6).toFixed(1)},${(cardY+5.5+i*10).toFixed(1)}) scale(0.67)">${RACK_META_ICONS[icon]}</g><text class="rack-meta-label" x="${(cardX+16).toFixed(1)}" y="${(cardY+11.5+i*10).toFixed(1)}">${label}</text>`;
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg rack-info"><rect class="rack-meta-card" x="${cardX.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH}" rx="6"/>${metaRow(0,'units',`${r.units}U`)}${metaRow(1,'width',`L ${num(r.width,state.rackWidth).toFixed(2)} m`)}${metaRow(2,'depth',`P ${num(r.depth,state.rackDepth).toFixed(2)} m`)}</g>`);
  });

  // Camada 3: calhas e seus nós. Elas ficam acima das informações dimensionais.
  state.trays.forEach(t=>{
    const selected=state.trayMultiSelected.includes(t.id) || (state.selected?.type==='tray'&&state.selected.id===t.id);
    const len=trayLengthMeters(t,g);
    const mx=(t.x1+t.x2)/2,my=(t.y1+t.y2)/2;
    svg.insertAdjacentHTML('beforeend',`<line data-tray="${t.id}" class="tray-line ${selected?'selected-tray':''}" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"/>`);
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-node-hit" data-tray="${t.id}" data-tray-node="a" cx="${t.x1}" cy="${t.y1}" r="11"/><circle class="tray-node-hit" data-tray="${t.id}" data-tray-node="b" cx="${t.x2}" cy="${t.y2}" r="11"/><circle class="tray-node" cx="${t.x1}" cy="${t.y1}" r="5"/><circle class="tray-node" cx="${t.x2}" cy="${t.y2}" r="5"/>`);
  });

  // Interligações: se os pontos já estão fisicamente coincidentes (snap),
  // mostramos somente a junção. Não desenhamos uma segunda linha por cima da calha.
  state.trayLinks.forEach(l=>{
    const a=state.trays.find(t=>t.id===l.aTray),b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const ap=trayPointAt(a,Number.isFinite(l.aT)?l.aT:(l.aEnd==='a'?0:1));
    const bp=trayPointAt(b,Number.isFinite(l.bT)?l.bT:(l.bEnd==='a'?0:1));
    const same=Math.hypot(ap.x-bp.x,ap.y-bp.y)<1.5;
    if(!same) svg.insertAdjacentHTML('beforeend',`<line class="tray-link" x1="${ap.x}" y1="${ap.y}" x2="${bp.x}" y2="${bp.y}"/>`);
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-junction" cx="${ap.x}" cy="${ap.y}" r="4"/><circle class="tray-junction" cx="${bp.x}" cy="${bp.y}" r="4"/>`);
  });

  // Camada 4: nomes dos racks ficam acima das calhas para manter a identificação legível.
  state.racks.forEach(r=>{
    const c=rackCenter(r,g);
    svg.insertAdjacentHTML('beforeend',`<text class="rack-text" x="${c.x}" y="${c.y+4}">${esc(r.name)}</text>`);
  });

  // Caixas de seleção múltipla. Shift = racks; Ctrl/Cmd+Shift = calhas.
  if(window.__rackSelectionBox){
    const b=window.__rackSelectionBox;
    svg.insertAdjacentHTML('beforeend',`<rect class="rack-selection-box" x="${Math.min(b.x1,b.x2)}" y="${Math.min(b.y1,b.y2)}" width="${Math.abs(b.x2-b.x1)}" height="${Math.abs(b.y2-b.y1)}"/>`);
  }
  if(window.__traySelectionBox){
    const b=window.__traySelectionBox;
    svg.insertAdjacentHTML('beforeend',`<rect class="tray-selection-box" x="${Math.min(b.x1,b.x2)}" y="${Math.min(b.y1,b.y2)}" width="${Math.abs(b.x2-b.x1)}" height="${Math.abs(b.y2-b.y1)}"/>`);
  }

  // Indicador visual do snap magnético durante o arraste de uma ponta.
  if(window.__traySnapGuide){
    const sg=window.__traySnapGuide;
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-snap-guide" cx="${sg.x}" cy="${sg.y}" r="9"/>`);
  }
  if(state.selected?.type==='breakout'){
    const b=state.breakouts.find(x=>x.id===state.selected.id);
    const color=breakoutTypeOf(b?.type)?.color||'var(--route)';
    breakoutLegCables(b?[b]:[]).forEach(c=>{
      const pts=computeRoute(c,g);
      if(pts.length>1)svg.insertAdjacentHTML('beforeend',`<polyline class="route-line" style="--cable-color:${color}" points="${pts.map(p=>p.x+','+p.y).join(' ')}"/>`);
    });
  }
  if(state.selected?.type==='cable'){
    const c=state.cables.find(x=>x.id===state.selected.id);
    if(c){
      const pts=computeRoute(c,g);
      if(pts.length>1){
        const cableColor=cableTypeColor(c.type);
        svg.insertAdjacentHTML('beforeend',`<polyline class="route-line" style="--cable-color:${cableColor}" points="${pts.map(p=>p.x+','+p.y).join(' ')}"/>`);
        // First visual pass: identify only the cable origin and destination.
        // The markers are intentionally rendered above the route and do not capture clicks.
        const origin=state.racks.find(r=>r.id===c.originRack), dest=state.racks.find(r=>r.id===c.destRack);
        if(origin && dest){
          const a=pts[0], b=pts[pts.length-1];
          let curveMarkup='';
          // Mark only real direction changes. Collinear intermediate points
          // are ignored so the route stays visually clean.
          const turns=[];
          for(let i=1;i<pts.length-1;i++){
            const p0=pts[i-1],p1=pts[i],p2=pts[i+1];
            const dx1=p1.x-p0.x,dy1=p1.y-p0.y,dx2=p2.x-p1.x,dy2=p2.y-p1.y;
            const cross=dx1*dy2-dy1*dx2;
            const dot=dx1*dx2+dy1*dy2;
            if(Math.abs(cross)>0.5 && dot>=0) turns.push(p1);
          }
          curveMarkup=turns.map(p=>`<circle class="cable-route-turn" style="--cable-color:${cableColor}" cx="${p.x}" cy="${p.y}" r="4"/>`).join('');
          svg.insertAdjacentHTML('beforeend',
            `<g class="cable-endpoints cable-route-markers" style="--cable-color:${cableColor}" pointer-events="none">`+
            `<circle class="cable-endpoint origin" cx="${a.x}" cy="${a.y}" r="6"/>`+
            `<circle class="cable-endpoint destination" cx="${b.x}" cy="${b.y}" r="6"/>`+
            curveMarkup+
            `<text class="cable-endpoint-label origin-label" x="${a.x+9}" y="${a.y-9}">${esc(origin.name)} · Origem</text>`+
            `<text class="cable-endpoint-label destination-label" x="${b.x-9}" y="${b.y-9}" text-anchor="end">${esc(dest.name)} · Destino</text>`+
            `</g>`
          );
        }
      }
    }
  }
  // Textos dos racks ficam visualmente acima das calhas, mas não capturam o clique.
  // Assim uma calha que passa sobre um rack continua selecionável.
  // Medidas das calhas por último: são leitura, e não podem ser cobertas pelo
  // traçado de um cabo selecionado.
  state.trays.forEach(t=>{
    const len=trayLengthMeters(t,g);
    const mx=(t.x1+t.x2)/2, my=(t.y1+t.y2)/2;
    svg.insertAdjacentHTML('beforeend',`<text class="tray-length" x="${mx}" y="${my-8}" text-anchor="middle">${len.toFixed(2)} m</text>`);
  });
  svg.querySelectorAll('[data-rack]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const id=el.dataset.rack;
    if(state.selected?.type==='cable' && state.cables.some(c=>c.id===state.selected.id && c.routeMode==='manual') && window.__manualRoutePicking){
      const c=state.cables.find(x=>x.id===state.selected.id);
      const check=validateManualRouteCandidate(c,id);
      if(check.ok){c.via.push(id);window.__manualRoutePicking=false;refreshVisuals();renderProperties();toast(`Rack ${rackNameById(id)} adicionado à rota`);}
      else toast(check.message);
      return;
    }
    const multi=e.ctrlKey||e.metaKey;
    state.trayMultiSelected=[];
    if(multi){
      const set=new Set(state.multiSelected);
      if(set.has(id)){ set.delete(id); } else { set.add(id); }
      state.multiSelected=[...set].filter(rid=>state.racks.some(r=>r.id===rid));
      if(state.multiSelected.length){ state.selected={type:'rack',id:state.multiSelected[state.multiSelected.length-1]}; }
      else state.selected=null;
    }else{
      state.multiSelected=[id];
      state.selected={type:'rack',id};
    }
    renderAll();
  }));
  svg.querySelectorAll('[data-rack]').forEach(el=>el.addEventListener('dblclick',e=>{
    e.stopPropagation();
    if(window.__manualRoutePicking)return;
    openRackBayface(el.dataset.rack);
  }));
  svg.querySelectorAll('.rack-text,.svg-label').forEach(el=>el.style.pointerEvents='none');
  svg.querySelectorAll('[data-tray]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const id=el.dataset.tray, multi=e.ctrlKey||e.metaKey;
    // mousedown already handles Ctrl/Cmd multi-selection so a normal click
    // after it must not toggle the same calha a second time.
    if(window.__trayMouseMultiHandled===id){
      window.__trayMouseMultiHandled=null;
      renderAll();
      return;
    }
    if(multi){
      const set=new Set(state.trayMultiSelected);
      if(set.has(id)) set.delete(id); else set.add(id);
      state.trayMultiSelected=[...set].filter(tid=>state.trays.some(t=>t.id===tid));
      state.multiSelected=[];
      state.selected=state.trayMultiSelected.length?{type:'tray',id:state.trayMultiSelected[state.trayMultiSelected.length-1]}:null;
    }else{
      state.multiSelected=[];
      state.trayMultiSelected=[id];
      state.selected={type:'tray',id};
    }
    renderAll();
  }));
  // Clique em uma área vazia do canvas limpa a seleção atual. O grid não
  // captura ponteiro, portanto clicar sobre o fundo do SVG também conta como vazio.
  svg.addEventListener('click',e=>{
    // O clique chega depois do pointerup do arrasto com Shift: sem esta marca, ele limpava a
    // seleção que o quadrado acabou de fazer.
    if(window.__canvasMarquee){window.__canvasMarquee=false;return;}
    if(e.target===svg){
      if(state.selected||state.multiSelected.length||state.trayMultiSelected.length){state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];renderAll();}
    }
  });
  // Calhas: a linha move a calha; as pontas são redimensionáveis.
  // Ao aproximar uma ponta de outra calha, o ponto entra em SNAP magnético
  // imediatamente e passa a usar a mesma coordenada física.
  svg.querySelectorAll('[data-tray]').forEach(el=>el.addEventListener('mousedown',e=>{
    e.stopPropagation();
    const id=el.dataset.tray,t=state.trays.find(x=>x.id===id); if(!t)return;
    const node=el.dataset.trayNode;
    // Selecionar imediatamente ao pressionar a calha, inclusive quando ela
    // estiver sobre um rack. A linha fica destacada enquanto selecionada.
    const multiSelect=e.ctrlKey||e.metaKey;
    if(multiSelect){
      const set=new Set(state.trayMultiSelected);
      if(!set.has(id)) set.add(id);
      state.trayMultiSelected=[...set].filter(tid=>state.trays.some(x=>x.id===tid));
      state.multiSelected=[];
      window.__trayMouseMultiHandled=id;
    }else{
      state.trayMultiSelected=[id];
      state.multiSelected=[];
    }
    state.selected={type:'tray',id};
    render();
    if(structureBlocked()){ return; }
    const zoom=(window.__canvasPan&&Number.isFinite(window.__canvasPan.zoom))?window.__canvasPan.zoom:1;
    if(node){
      const end=node;
      // Arrastar uma ponta conectada significa editar essa ponta: a conexão antiga
      // é liberada antes do movimento. A nova conexão só é criada quando houver
      // um novo snap magnético. Isso evita linhas de ligação soltas/dobradas.
      const endT=end==='a'?0:1;
      state.trayLinks=state.trayLinks.filter(l=>{
        const at=l.aTray===t.id && Math.abs((l.aT??(l.aEnd==='a'?0:1))-endT)<0.002;
        const bt=l.bTray===t.id && Math.abs((l.bT??(l.bEnd==='a'?0:1))-endT)<0.002;
        return !(at||bt);
      });
      state.trayRackLinks=state.trayRackLinks.filter(l=>!(l.trayId===t.id && l.end===endT));
      const ox=e.clientX,oy=e.clientY,baseX=end==='a'?t.x1:t.x2,baseY=end==='a'?t.y1:t.y2;
      const move=ev=>{
        let rawX=baseX+(ev.clientX-ox)/zoom, rawY=baseY+(ev.clientY-oy)/zoom;
        // Shift trava a extensão em um único eixo, mantendo a calha reta.
        if(ev.shiftKey){
          const otherX=end==='a'?t.x2:t.x1, otherY=end==='a'?t.y2:t.y1;
          const dx=Math.abs(rawX-otherX),dy=Math.abs(rawY-otherY);
          if(dx>=dy) rawY=otherY; else rawX=otherX;
        }
        // Durante o movimento a ponta permanece livre. A conexão/snap só é
        // efetivada no mouseup, evitando que a calha "grude" enquanto ainda
        // está sendo arrastada. O guia apenas mostra onde o snap ocorrerá.
        const snap=nearestTrayOrRackSnap(t.id,rawX,rawY,34/zoom);
        if(end==='a'){t.x1=rawX;t.y1=rawY;}else{t.x2=rawX;t.y2=rawY;}
        window.__traySnapGuide=snap?{x:snap.x,y:snap.y,type:snap.type}:null;
        render();
      };
      const up=()=>{
        document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
        const ex=end==='a'?t.x1:t.x2,ey=end==='a'?t.y1:t.y2;
        const snap=nearestTrayOrRackSnap(t.id,ex,ey,38/zoom);
        if(snap){
          if(end==='a'){t.x1=snap.x;t.y1=snap.y;}else{t.x2=snap.x;t.y2=snap.y;}
          if(snap.type==='tray'){
            linkTrayPoints(t.id,end==='a'?0:1,snap.tray.id,snap.t);
            toast(`Snap: ${t.name} ↔ ${snap.tray.name}`);
          }else if(snap.type==='rack-tray'){
            const endIndex=end==='a'?0:1;
            state.trayRackLinks.push({trayId:t.id,end:endIndex,rackId:snap.rack.id,point:snap.point,connectionKind:snap.connectionKind||'edge',side:snap.side||null,rx:Number.isFinite(snap.rx)?snap.rx:null,ry:Number.isFinite(snap.ry)?snap.ry:null});
            // Keep the existing tray junction at the point physically closest
            // to the exact rack anchor. This makes both infrastructure pieces
            // share one real location without relaxing the rack snap points.
            linkTrayPoints(t.id,endIndex,snap.tray.id,snap.trayT);
    toast(`Snap: ${t.name} ↔ ${rackDisplayName(snap.rack)} ↔ ${snap.tray.name}`);
          }else{
            state.trayRackLinks.push({trayId:t.id,end:end==='a'?0:1,rackId:snap.rack.id,point:snap.point,connectionKind:snap.connectionKind||'edge',side:snap.side||null,rx:Number.isFinite(snap.rx)?snap.rx:null,ry:Number.isFinite(snap.ry)?snap.ry:null});
    toast(`Snap: ${t.name} ↔ ${rackDisplayName(snap.rack)}`);
          }
        }
        // Só depois de soltar e somente quando AS DUAS pontas desta calha
        // estiverem conectadas a qualquer destino válido (calha ou rack),
        // os cruzamentos passam a ser junções reais da infraestrutura.
        if(trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1)){
          connectCrossingsForTray(t.id);
        }
        window.__traySnapGuide=null;
        save();renderAll();
      };
      document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
      return;
    }

    // Se uma das pontas já estiver conectada, arrastar a linha usa a ponta oposta
    // como extremidade livre. Isso permite aumentar/reduzir a calha em vez de
    // criar um deslocamento estranho da conexão.
    const linkedA=trayEndpointConnected(t.id,0);
    const linkedB=trayEndpointConnected(t.id,1);

    // Ao mover a calha inteira, qualquer junção/interseção criada anteriormente
    // em um ponto da geometria deixa de ser válida. Removemos essas conexões
    // antes do movimento. Se apenas uma ponta estiver realmente presa,
    // preservamos somente a conexão dessa ponta; as demais (inclusive
    // cruzamentos automáticos) são descartadas. Se as duas pontas estiverem
    // presas, o movimento da calha inteira também libera ambas.
    const preserveEnd = linkedA && !linkedB ? 0 : (linkedB && !linkedA ? 1 : null);
    state.trayLinks = state.trayLinks.filter(l => {
      const aEnd = l.aTray===t.id ? (Number.isFinite(l.aT) ? l.aT : (l.aEnd==='a'?0:1)) : null;
      const bEnd = l.bTray===t.id ? (Number.isFinite(l.bT) ? l.bT : (l.bEnd==='a'?0:1)) : null;
      if(l.aTray!==t.id && l.bTray!==t.id) return true;
      if(preserveEnd===null) return false;
      if(l.aTray===t.id) return Math.abs(aEnd-preserveEnd)<0.002;
      return Math.abs(bEnd-preserveEnd)<0.002;
    });
    state.trayRackLinks = state.trayRackLinks.filter(l => {
      if(l.trayId!==t.id) return true;
      return preserveEnd!==null && Number(l.end)===preserveEnd;
    });

    const ox=e.clientX,oy=e.clientY,x1=t.x1,y1=t.y1,x2=t.x2,y2=t.y2;
    const move=ev=>{
      let dx=(ev.clientX-ox)/zoom,dy=(ev.clientY-oy)/zoom;
      if(ev.shiftKey){ if(Math.abs(dx)>=Math.abs(dy)) dy=0; else dx=0; }
      if(linkedA&&!linkedB){
        t.x2=x2+dx;t.y2=y2+dy;
      }else if(linkedB&&!linkedA){
        t.x1=x1+dx;t.y1=y1+dy;
      }else{
        t.x1=x1+dx;t.y1=y1+dy;t.x2=x2+dx;t.y2=y2+dy;
      }
      updateLinksForTray(t.id);render();
    };
    const up=()=>{
      document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
      if(trayEndpointConnected(t.id,0)&&trayEndpointConnected(t.id,1)) connectCrossingsForTray(t.id);
      save();renderAll();
    };
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  }));

}


function assetRoom(asset){
  if(!asset)return null;
  return state.rooms?.find(r=>r.id===asset.roomId)||null;
}
function findRackGlobal(rackId){
  if(!rackId)return null;
  const current=state.racks.find(r=>r.id===rackId); if(current)return current;
  for(const room of (state.rooms||[])){const r=room.data?.racks?.find(x=>x.id===rackId);if(r)return r;}
  return null;
}
function assetRack(rackId){ return findRackGlobal(rackId); }
// Rótulo do rack para leitura: na tabela, no filtro e na busca o rack aparece com a fileira na
// frente (A-101), do mesmo jeito que nos campos de seleção.
function assetRackLabel(a){
  const r=assetRack(a?.rackId);
  return r?rackDisplayName(r):'Sem rack';
}
function assetRackRoom(asset){
  const room=assetRoom(asset); if(room)return room;
  if(asset?.rackId){const r=findRackGlobal(asset.rackId);if(r)return state.rooms.find(x=>x.data?.racks?.some(y=>y.id===r.id))||null;}
  return null;
}
const ASSET_WARRANTY_WARN_DAYS=60, ASSET_EOL_WARN_DAYS=60;
function assetWarrantyLevel(a){ return dateUrgencyLevel(a?.warrantyExpiration,ASSET_WARRANTY_WARN_DAYS); }
function assetEndOfLifeLevel(a){ return dateUrgencyLevel(a?.endOfLife,ASSET_EOL_WARN_DAYS); }
const ASSET_LIFECYCLE_LABELS={
  warranty:{expired:'Garantia vencida',soon:'Garantia vence em breve',ok:'Em garantia',none:''},
  eol:{expired:'Fim de vida atingido',soon:'Próximo do fim de vida',ok:'',none:''}
};
function assetsNeedingAttention(){
  normalizeAssets();
  return (state.assets||[]).filter(a=>{
    const w=assetWarrantyLevel(a), e=assetEndOfLifeLevel(a);
    return w==='expired'||w==='soon'||e==='expired'||e==='soon';
  });
}
function updateAlertsCenterBadge(){
  const btn=$('btnAlertsCenter'); if(!btn)return;
  const total=assetsNeedingAttention().length+capacityIssues().length+positionIssues().length;
  btn.classList.toggle('hidden',total===0);
  const badge=$('alertsCenterCount');
  if(badge){
    const before=Number(badge.dataset.value||'0');
    badge.textContent=String(total);
    badge.dataset.value=String(total);
    // O contador subir é a única evidência de que apareceu alerta novo em
    // outra parte da planta; um pulso curto avisa sem tirar o foco de quem
    // está trabalhando.
    if(total>before&&before>0){
      badge.classList.remove('is-pulse');
      void badge.offsetWidth;
      badge.classList.add('is-pulse');
      clearTimeout(badge.__pulseTimer);
      badge.__pulseTimer=setTimeout(()=>badge.classList.remove('is-pulse'),900);
    }
  }
}
function allProjectRacks(){
  syncActiveRoom();
  const list=[];
  (state.rooms||[]).forEach(room=>{(room.data?.racks||[]).forEach(r=>list.push({rack:r,room}));});
  return list;
}
function capacityIssues(){
  const issues=[];
  allProjectRacks().forEach(({rack:r,room})=>{
    const powerCap=num(r.powerCapacityW,0);
    if(powerCap>0){
      const watts=state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.powerW,0)),0);
      if(watts/powerCap>=0.8) issues.push({kind:'power',label:'Energia',level:watts>powerCap?'high':'mid',rackId:r.id,roomId:room.id,name:rackDisplayName(r),current:watts,capacity:powerCap,unit:'W'});
    }
    const weightCap=num(r.weightCapacityKg,0);
    if(weightCap>0){
      const kg=state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.weightKg,0)),0);
      if(kg/weightCap>=0.8) issues.push({kind:'weight',label:'Carga do piso',level:kg>weightCap?'high':'mid',rackId:r.id,roomId:room.id,name:rackDisplayName(r),current:kg,capacity:weightCap,unit:'kg'});
    }
  });
  (state.rooms||[]).forEach(room=>{
    const t=roomThermalLoad(room);
    if(t.capacity>0 && t.pct>=80) issues.push({kind:'cooling',label:'Refrigeração',level:t.level,roomId:room.id,name:room.name,current:t.watts,capacity:t.capacity,unit:'W'});
  });
  issues.sort((a,b)=>(a.level==='high'?0:1)-(b.level==='high'?0:1));
  return issues;
}
// Assets sobrepostos ou fora das U do rack. A interface bloqueia isso ao salvar,
// mas dados antigos, importados ou alterados fora do app podem trazer o problema.
function positionIssues(){
  const unitsByRack=new Map(), meta=new Map();
  allProjectRacks().forEach(({rack:r,room})=>{unitsByRack.set(r.id,Math.max(1,Math.floor(num(r.units,state.rackUnits))));meta.set(r.id,{name:rackDisplayName(r),roomId:room.id});});
  const label=a=>a.name||a.assetTag||'asset';
  return assetPositionProblems(state.assets,unitsByRack).map(p=>({
    kind:'position',level:'high',rackId:p.rackId,roomId:meta.get(p.rackId)?.roomId,name:meta.get(p.rackId)?.name||'Rack',
    detail:p.kind==='overlap'?`Sobrepostos: ${label(p.a)} × ${label(p.b)}`:`${label(p.asset)} fora das ${p.units}U`
  }));
}
function closeAlertsCenterPanel(){document.querySelectorAll('.alerts-center-panel').forEach(x=>x.remove());}
function openAlertsCenterPanel(anchorBtn){
  closeAlertsCenterPanel();
  const lifecycleIssues=assetsNeedingAttention();
  const capIssues=capacityIssues();
  const posIssues=positionIssues();
  const KIND_UNIT_LABEL={power:'de energia',weight:'de carga',cooling:'de refrigeração'};
  const panel=document.createElement('div'); panel.className='col-filter-panel alerts-center-panel';
  let body='';
  if(!lifecycleIssues.length && !capIssues.length && !posIssues.length){
    body='<div class="empty">Nenhum alerta no momento.</div>';
  }else{
    if(posIssues.length){
      body+='<div class="alerts-center-group-label">Posição dos assets</div>';
      body+=posIssues.map((iss,i)=>`<button type="button" class="capacity-alert-item level-high" data-position-index="${i}"><span>${esc(iss.name)}</span><small>${esc(iss.detail)}</small></button>`).join('');
    }
    if(lifecycleIssues.length){
      body+='<div class="alerts-center-group-label">Ciclo de vida</div>';
      body+=lifecycleIssues.map((a,i)=>{
        const w=assetWarrantyLevel(a), e=assetEndOfLifeLevel(a);
        const level=(w==='expired'||e==='expired')?'high':'mid';
        const reason=[w==='expired'?'Garantia vencida':w==='soon'?'Garantia vence em breve':null,e==='expired'?'EOL vencido':e==='soon'?'EOL vence em breve':null].filter(Boolean).join(' · ');
        return `<button type="button" class="capacity-alert-item level-${level}" data-lifecycle-index="${i}"><span>${esc(a.name||a.assetTag||'Asset')}</span><small>${esc(reason)}</small></button>`;
      }).join('');
      if(lifecycleIssues.length>1)body+='<button type="button" class="alerts-center-viewall" id="alertsCenterViewAll">Ver todos no inventário →</button>';
    }
    if(capIssues.length){
      body+='<div class="alerts-center-group-label">Capacidade</div>';
      body+=capIssues.map((iss,i)=>`<button type="button" class="capacity-alert-item level-${iss.level}" data-capacity-index="${i}"><span>${esc(iss.name)}</span><small>${esc(iss.label)} · ${Math.round(iss.current)}${iss.unit} ${esc(KIND_UNIT_LABEL[iss.kind])} de ${iss.capacity}${iss.unit}</small></button>`).join('');
    }
  }
  panel.innerHTML=`<div class="col-filter-panel-head"><b>Central de alertas</b></div><div class="col-filter-panel-list">${body}</div>`;
  document.body.appendChild(panel);
  const rect=anchorBtn.getBoundingClientRect();
  panel.style.top=`${rect.bottom+4}px`; panel.style.left=`${Math.min(rect.left,window.innerWidth-panel.offsetWidth-12)}px`;
  panel.querySelectorAll('[data-lifecycle-index]').forEach(btn=>btn.onclick=()=>{
    const a=lifecycleIssues[Number(btn.dataset.lifecycleIndex)];
    closeAlertsCenterPanel();
    openAssetModal(a.id);
  });
  panel.querySelectorAll('[data-position-index]').forEach(btn=>btn.onclick=()=>{
    const iss=posIssues[Number(btn.dataset.positionIndex)];
    closeAlertsCenterPanel();
    if(iss.roomId && iss.roomId!==state.activeRoomId) switchRoom(iss.roomId);
    state.multiSelected=[]; state.selected={type:'rack',id:iss.rackId}; renderAll(false); renderProperties();
  });
  $('alertsCenterViewAll')?.addEventListener('click',()=>{closeAlertsCenterPanel();openAssetsModalWithAttentionFilter();});
  panel.querySelectorAll('[data-capacity-index]').forEach(btn=>btn.onclick=()=>{
    const iss=capIssues[Number(btn.dataset.capacityIndex)];
    closeAlertsCenterPanel();
    if(iss.kind==='cooling'){ openRoomEditor(iss.roomId); return; }
    if(iss.roomId && iss.roomId!==state.activeRoomId) switchRoom(iss.roomId);
    state.multiSelected=[]; state.selected={type:'rack',id:iss.rackId}; renderAll(false); renderProperties();
  });
}
let assetAttentionOnly=false;
function openAssetsModalWithAttentionFilter(){
  const m=$('assetsModal'); if(!m)return;
  closeAssetModal(); closeAssetCatalogModal();
  m.classList.add('open'); m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
  $('assetsSearch').value=''; assetColumnFilters={}; assetSortColumn='warranty'; assetSortDir='asc'; assetSelectedIds=new Set(); assetColumnWidths={...ASSET_COLUMN_WIDTHS_DEFAULT};
  assetAttentionOnly=true;
  assetColumnsAutoFitted=false;
  assetsPage=1;
  renderAssetsList();
}
function cablePortConflict(cable,side,portId){
  if(!portId)return null;
  const field=side==='origin'?'originPortId':'destPortId';
  return [...state.cables,...breakoutLegCables()].find(c=>c.id!==cable.id && !(cable.breakoutId && c.breakoutId===cable.breakoutId) && c[field]===portId && ((side==='origin'?c.originRack:c.destRack)===(side==='origin'?cable.originRack:cable.destRack)))||null;
}
configureCatalogs({ applyRoomData, updateRoomUI, normalizeCableCatalogs, cableTypeNames, defaultCableType, toast, save, render, normalizeLocations, assetSubstatusValues, renderAssetsList, bayfaceAssetTypeClass, openBayface, renderAll });
configureCloudSync({ applyRoomData, syncActiveRoom, migrateGlobalAssets, ensureRooms, updateRoomUI, setStructureLock, updateStructureControls, applyTheme, initHistory, toast, normalizeState, assetRack, DEFAULT_ASSET_TYPES, DEFAULT_ASSET_STATUSES, DEFAULT_ASSET_SUBSTATUSES, renderAll, openHelpModal, closeHelpModal, switchHelpSection, bind, canvasVisible });
function normalizeLocations(){
  state.locations=Array.isArray(state.locations)?state.locations:[];
  if(!state.locations.length){
    const loc={id:uid('loc'),name:'DC AZ1',rooms:[],stocks:[{id:uid('stock'),name:'Estoque Principal'}]};
    (state.rooms||[]).forEach(r=>{r.locationId=loc.id;loc.rooms.push(r.id);});
    state.locations.push(loc);
  }
  state.locations.forEach(l=>{l.rooms=Array.isArray(l.rooms)?l.rooms:[];l.stocks=Array.isArray(l.stocks)?l.stocks:[];});
  (state.rooms||[]).forEach(r=>{if(!r.locationId){r.locationId=state.locations[0]?.id||null;if(r.locationId&&!state.locations[0].rooms.includes(r.id))state.locations[0].rooms.push(r.id);}});
  state.assets?.forEach(a=>{
    if(!a.locationId){const room=state.rooms?.find(r=>r.id===a.roomId);a.locationId=room?.locationId||state.locations[0]?.id||null;}
    if(a.locationType==='stock'&&!a.stockId){const loc=state.locations.find(l=>l.id===a.locationId);a.stockId=loc?.stocks?.[0]?.id||null;}
  });
}
function assetLocationDcName(name){return String(name||'').replace(/^DC\s+/i,'').trim()||String(name||'');}
function assetLocationLabel(a){normalizeLocations();const loc=state.locations.find(l=>l.id===a.locationId);if(!loc)return a.locationName||'Sem localização';const dc=assetLocationDcName(loc.name);if(a.locationType==='stock'){const st=loc.stocks.find(x=>x.id===a.stockId);return `${dc} / ${st?.name||'Estoque'}`;}const room=state.rooms.find(r=>r.id===a.roomId);return `${dc} / ${room?.name||a.locationName||'Sala'}`;}
function assetLocationChoices(selected=''){normalizeLocations();let out='<option value="">Selecione a localização</option>';state.locations.forEach(l=>{const dc=assetLocationDcName(l.name);out+=`<optgroup label="${esc(dc)}">`;l.rooms.forEach(rid=>{const r=state.rooms.find(x=>x.id===rid);if(r)out+=`<option value="room:${esc(r.id)}" ${selected===`room:${r.id}`?'selected':''}>${esc(dc)} / ${esc(r.name)}</option>`});l.stocks.forEach(st=>{out+=`<option value="stock:${esc(l.id)}:${esc(st.id)}" ${selected===`stock:${l.id}:${st.id}`?'selected':''}>${esc(dc)} / ${esc(st.name)}</option>`});out+='</optgroup>'});return out;}
function assetSubstatusValues(){normalizeAssetCatalogs();return state.assetCatalogs.substatuses||DEFAULT_ASSET_SUBSTATUSES.slice();}
function normalizeAssets(){
  state.assets=Array.isArray(state.assets)?state.assets:[];
  state.assets=state.assets.filter(a=>a&&a.id).map(a=>({
    id:a.id,name:String(a.name||'Equipamento'),type:String(a.type||'Equipamento'),manufacturer:String(a.manufacturer||''),model:String(a.model||''),assetTag:String(a.assetTag||''),serial:String(a.serial||''),locationType:a.locationType||(a.roomId?'room':'stock'),locationName:String(a.locationName||((a.roomId&&state.rooms?.find(r=>r.id===a.roomId)?.name)||(!a.roomId?'Estoque':''))),roomId:a.roomId||null,rackId:a.rackId||null,face:a.rackId?(a.face==='rear'?'rear':'front'):null,uStart:Math.max(1,Math.floor(num(a.uStart,1))),uHeight:Math.max(1,Math.floor(num(a.uHeight,1))),status:String(a.status||'Instalado'),substatus:String(a.substatus||''),locationId:a.locationId||null,stockId:a.stockId||null,ports:Array.isArray(a.ports)?a.ports.filter(p=>p&&p.id).map(p=>({id:String(p.id),label:String(p.label||'Porta'),poe:!!p.poe})):[],powerW:Math.max(0,Math.floor(num(a.powerW,0))),weightKg:Math.max(0,num(a.weightKg,0)),purchaseDate:/^\d{4}-\d{2}-\d{2}$/.test(a.purchaseDate)?a.purchaseDate:'',warrantyExpiration:/^\d{4}-\d{2}-\d{2}$/.test(a.warrantyExpiration)?a.warrantyExpiration:'',endOfLife:/^\d{4}-\d{2}-\d{2}$/.test(a.endOfLife)?a.endOfLife:'',notes:String(a.notes||'').slice(0,500)
  }));
}
function updateAssetUFieldsState(){
  // "U inicial" é uma posição — só faz sentido com um rack pra se posicionar
  // dentro. "Quantidade de U" é uma propriedade física do equipamento (quantas
  // U ele ocupa), que existe independente de estar instalado num rack ou em
  // estoque — por isso ela nunca deve ficar travada.
  const hasRack=!!$('assetRack')?.value;
  const startEl=$('assetUStart');
  if(startEl){
    startEl.disabled=!hasRack;
    startEl.closest('label')?.classList.toggle('muted-field',!hasRack);
    if(!hasRack){
      if(startEl.value)startEl.dataset.prevValue=startEl.value;
      startEl.value='';
      startEl.placeholder='Disponível ao escolher um rack';
    }else{
      startEl.placeholder='';
      if(!startEl.value)startEl.value=startEl.dataset.prevValue||'1';
    }
  }
  const heightEl=$('assetUHeight');
  if(heightEl && !heightEl.value) heightEl.value='1';
  const faceEl=$('assetFace');
  if(faceEl){
    faceEl.disabled=!hasRack;
    faceEl.closest('label')?.classList.toggle('muted-field',!hasRack);
    if(!hasRack)faceEl.value='';
  }
}
function refreshAssetRackOptions(selected=''){
  const loc=$('assetLocation')?.value||''; const sel=$('assetRack'); if(!sel)return;
  const roomId=loc.startsWith('room:')?loc.slice(5):null;
  const room=roomId?(state.rooms||[]).find(r=>r.id===roomId):null;
  const racks=room?(room.data?.racks||[]):[];
  const rowNameOf=rack=>String((room?.data?.rows||[]).find(row=>row.id===rack.rowId)?.name||'');
  sel.innerHTML='<option value="">Sem rack</option>'+racks.map(r=>`<option value="${esc(r.id)}" title="${esc(rackDisplayName(r,rowNameOf(r)))}">${esc(rackDisplayName(r,rowNameOf(r)))}</option>`).join('');
  sel.value=racks.some(r=>r.id===selected)?selected:'';
  updateAssetUFieldsState();
}
let assetEditPorts=[];
function findCatalogModel(type,manufacturer,model){
  return state.assetCatalogs.models.find(m=>catalogNormalize(m.name)===catalogNormalize(model)&&catalogNormalize(m.type)===catalogNormalize(type)&&catalogNormalize(m.manufacturer)===catalogNormalize(manufacturer))||null;
}
// Usado nos dois caminhos de cadastro em massa (manual e Excel): se o
// modelo do catálogo já tem portas/potência/peso definidos, o asset criado
// em massa nasce com isso preenchido, em vez de ficar em branco até alguém
// abrir e editar manualmente.
function autoFillAssetFromModel(asset){
  const m=findCatalogModel(asset.type,asset.manufacturer,asset.model);
  if(!m)return asset;
  if(!asset.ports?.length){const expanded=expandPortDefs(m.portDefs); if(expanded.length)asset.ports=expanded;}
  if(!asset.powerW && m.powerW)asset.powerW=m.powerW;
  if(!asset.weightKg && m.weightKg)asset.weightKg=m.weightKg;
  return asset;
}
// Pernas de breakout como cabos virtuais: é assim que porta ocupada, conflito e desenho de
// rota enxergam o breakout, sem código próprio.
function breakoutLegCables(list=state.breakouts){return (list||[]).flatMap(b=>(b.legs||[]).filter(l=>l.destRack).map(l=>breakoutLegCable(b,l)));}
function allProjectCables(){
  const activeId=state.activeRoomId;
  const rooms=(state.rooms||[]).filter(r=>r.id!==activeId);
  const others=rooms.flatMap(r=>[...(r.data?.cables||[]),...breakoutLegCables(r.data?.breakouts)]);
  return [...(state.cables||[]), ...breakoutLegCables(), ...others];
}
function findPortConnection(portId){
  return allProjectCables().find(c=>c.originPortId===portId||c.destPortId===portId)||null;
}
// Busca e filtro da lista de portas do editor de asset (só de tela, não vão para o asset).
let assetPortsQuery='', assetPortsFilter='all';
// Recolher a lista de portas: mesma ideia das seções do painel, guardada na própria seção.
function setAssetPortsCollapsed(collapsed){
  const section=$('assetStepPortas'); if(!section)return;
  section.classList.toggle('ports-collapsed',collapsed);
  $('assetPortsToggle')?.setAttribute('aria-expanded',collapsed?'false':'true');
}
const PORT_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v4M17 17v4M9 10v4M15 10v4"/></svg>';
function renderAssetPortsEditor(){
  const list=$('assetPortsList'); if(!list)return;
  const total=assetEditPorts.length;
  const usados=assetEditPorts.filter(p=>findPortConnection(p.id)).length;
  const livres=total-usados;
  const texto=(id,v)=>{const el=$(id); if(el)el.textContent=v;};
  texto('assetPortsCount',String(total));
  texto('assetPortsUsedCount',`${usados} em uso`);
  texto('assetPortsFreeCount',`${livres} disponível(is)`);
  texto('assetPortsTotalFoot',String(total));
  texto('assetPortsUsedFoot',String(usados));
  texto('assetPortsFreeFoot',`Disponíveis: ${livres}`);
  const busca=$('assetPortsSearch'), filtro=$('assetPortsFilter');
  if(busca&&busca.value!==assetPortsQuery)busca.value=assetPortsQuery;
  if(filtro&&filtro.value!==assetPortsFilter)filtro.value=assetPortsFilter;
  const visiveis=assetEditPorts.filter(p=>{
    const conn=findPortConnection(p.id);
    if(assetPortsFilter==='used'&&!conn)return false;
    if(assetPortsFilter==='free'&&conn)return false;
    const q=assetPortsQuery.trim().toLowerCase();
    if(!q)return true;
    return String(p.label||'').toLowerCase().includes(q)||(conn?String(conn.name||'').toLowerCase().includes(q):false);
  });
  list.innerHTML=visiveis.length?visiveis.map(p=>{
    const i=assetEditPorts.indexOf(p);
    const conn=findPortConnection(p.id);
    let connLabel='';
    if(conn){
      const isOrigin=conn.originPortId===p.id;
      const otherRackId=isOrigin?conn.destRack:conn.originRack;
      const otherU=isOrigin?conn.destU:conn.originU;
      const otherPortId=isOrigin?conn.destPortId:conn.originPortId;
      const otherFace=isOrigin?conn.destFace:conn.originFace;
      connLabel=cableEndpointLabel(otherRackId,otherU,otherPortId,'',isOrigin?conn.destAssetName:conn.originAssetName,otherFace);
    }
    return `<div class="asset-port-row ${conn?'is-used':'is-free'}">
      <span class="asset-port-index">${i+1}</span>
      <span class="asset-port-icon">${PORT_ICON}</span>
      <input type="text" class="asset-port-name" data-port-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="Nome da porta" title="Nome da porta">
      <span class="asset-port-conn ${conn?'':'is-free-label'}" title="${conn?`${esc(conn.name)} → ${esc(connLabel)}`:'Sem conexão'}">${conn?`${uiIcon('link')}<b>${esc(conn.name)}</b> → ${esc(connLabel)}`:'— <small>Sem conexão</small>'}</span>
      <span class="asset-port-status ${conn?'is-used':'is-free'}"><i></i>${conn?'Em uso':'Disponível'}</span>
      <label class="asset-port-poe" title="Porta PoE"><input type="checkbox" data-port-poe="${esc(p.id)}" ${p.poe?'checked':''}><span>PoE</span></label>
      <span class="asset-port-actions">
        <button type="button" class="iconbtn danger-icon" data-port-remove="${esc(p.id)}" title="Remover porta">${uiIcon('trash')}</button>
      </span>
    </div>`;
  }).join(''):'<div class="asset-ports-empty"><span class="asset-ports-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v4M15 4v4M9 16v4M15 16v4"/></svg></span><b>Nenhuma porta cadastrada</b><span>Adicione as portas do equipamento para facilitar o planejamento de conectividade.</span></div>';
  list.querySelectorAll('[data-port-id]').forEach(inp=>inp.oninput=()=>{const p=assetEditPorts.find(x=>x.id===inp.dataset.portId);if(p)p.label=inp.value;});
  list.querySelectorAll('[data-port-poe]').forEach(cb=>cb.onchange=()=>{const p=assetEditPorts.find(x=>x.id===cb.dataset.portPoe);if(p)p.poe=cb.checked;});
  list.querySelectorAll('[data-port-remove]').forEach(b=>b.onclick=()=>{assetEditPorts=assetEditPorts.filter(p=>p.id!==b.dataset.portRemove);renderAssetPortsEditor();});
}
async function exportAssetPortsXLSX(){
  try{
    if(!assetEditPorts.length){toast('Este asset não tem portas cadastradas.');return;}
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const assetName=$('assetName')?.value.trim()||'Asset';
    const headers=['Porta','PoE','Status','Cabo','Conectado a'];
    const rows=assetEditPorts.map(p=>{
      const conn=findPortConnection(p.id);
      let connLabel='';
      if(conn){
        const isOrigin=conn.originPortId===p.id;
        const otherRackId=isOrigin?conn.destRack:conn.originRack;
        const otherU=isOrigin?conn.destU:conn.originU;
        const otherPortId=isOrigin?conn.destPortId:conn.originPortId;
        const otherFace=isOrigin?conn.destFace:conn.originFace;
        connLabel=cableEndpointLabel(otherRackId,otherU,otherPortId,'',isOrigin?conn.destAssetName:conn.originAssetName,otherFace);
      }
      return [p.label,p.poe?'Sim':'Não',conn?'Em uso':'Disponível',conn?.name||'',connLabel];
    });
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Portas');
    ws.addRow(headers); rows.forEach(r=>ws.addRow(r));
    ws.freezePanes={xSplit:0,ySplit:1}; ws.autoFilter={from:'A1',to:`${excelColumnLetter(headers.length)}${Math.max(1,rows.length+1)}`}; ws.getRow(1).font={bold:true};
    ws.columns=headers.map((h,i)=>({width:Math.min(60,Math.max(12,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))+2))}));
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${assetName}-portas.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Portas exportadas');
  }catch(err){toast(err.message||'Erro ao exportar Excel');}
}
function autoFillPortsFromModelIfEmpty(){
  if(assetEditPorts.length)return; // já tem porta cadastrada/editada; nunca sobrescreve sem pedir
  const type=$('assetType')?.value||'', manufacturer=$('assetManufacturer')?.value||'', model=$('assetModel')?.value||'';
  const catalogModel=findCatalogModel(type,manufacturer,model);
  const expanded=expandPortDefs(catalogModel?.portDefs);
  if(!expanded.length)return;
  assetEditPorts=expanded;
  renderAssetPortsEditor();
}
function autoFillPowerFromModelIfEmpty(){
  const field=$('assetPowerW'); if(!field||field.value)return; // já tem valor; nunca sobrescreve sem pedir
  const type=$('assetType')?.value||'', manufacturer=$('assetManufacturer')?.value||'', model=$('assetModel')?.value||'';
  const catalogModel=findCatalogModel(type,manufacturer,model);
  if(!catalogModel?.powerW)return;
  field.value=catalogModel.powerW;
}
function autoFillWeightFromModelIfEmpty(){
  const field=$('assetWeightKg'); if(!field||field.value)return; // já tem valor; nunca sobrescreve sem pedir
  const type=$('assetType')?.value||'', manufacturer=$('assetManufacturer')?.value||'', model=$('assetModel')?.value||'';
  const catalogModel=findCatalogModel(type,manufacturer,model);
  if(!catalogModel?.weightKg)return;
  field.value=catalogModel.weightKg;
}
function openAssetModal(assetId=null, rackId=null, uStart=null){
  normalizeAssets(); normalizeAssetCatalogs();
  const asset=assetId?state.assets.find(a=>a.id===assetId):null;
  if(asset?.roomId && asset.roomId!==state.activeRoomId){switchRoom(asset.roomId);}
  const rack=assetRack(asset?.rackId||rackId);
  const m=$('assetEditModal'); if(!m)return;
  $('assetEditTitle').textContent=asset?'Editar asset':'Novo asset';
  $('assetEditId').value=asset?.id||'';
  $('assetName').value=asset?.name||'';
  renderAssetCatalogSelects({assetType:asset?.type||'Servidor',assetManufacturer:asset?.manufacturer||'',assetModel:asset?.model||'',assetStatus:asset?.status||'Ativo'});
  $('assetTag').value=asset?.assetTag||'';
  $('assetSerial').value=asset?.serial||'';
  normalizeLocations(); const locValue=asset?.locationType==='stock'?(asset.locationId&&asset.stockId?`stock:${asset.locationId}:${asset.stockId}`:''):(asset?.roomId?'room:'+asset.roomId:(rack?.id?'room:'+(assetRackRoom({rackId:rack.id})?.id||state.activeRoomId):'room:'+state.activeRoomId));
  $('assetLocation').innerHTML=assetLocationChoices(locValue);
  $('assetLocation').value=locValue;
  refreshAssetRackOptions(asset?.rackId||rack?.id||'');
  $('assetUHeight').value=asset?.uHeight||1;
  if($('assetRack').value){ $('assetUStart').value=asset?.uStart||uStart||1; }
  $('assetStatus').value=asset?.status||'Instalado'; $('assetSubstatus').value=asset?.substatus||'';
  if($('assetFace'))$('assetFace').value=asset?.face||'';
  assetEditPorts=asset?.ports?cloneData(asset.ports):[];
  if(!assetEditPorts.length)autoFillPortsFromModelIfEmpty();
  renderAssetPortsEditor();
  autoFillPortsFromModelIfEmpty();
  if($('assetPowerW')){$('assetPowerW').value=asset?.powerW||'';if(!$('assetPowerW').value)autoFillPowerFromModelIfEmpty();}
  if($('assetWeightKg')){$('assetWeightKg').value=asset?.weightKg||'';if(!$('assetWeightKg').value)autoFillWeightFromModelIfEmpty();}
  if($('assetPurchaseDate'))$('assetPurchaseDate').value=asset?.purchaseDate||'';
  if($('assetWarrantyExpiration'))$('assetWarrantyExpiration').value=asset?.warrantyExpiration||'';
  if($('assetEndOfLife'))$('assetEndOfLife').value=asset?.endOfLife||'';
  if($('assetNotes')){$('assetNotes').value=asset?.notes||'';updateAssetNotesCount();}
  updateAssetLifecycleBadge();
  resetAssetEditStepNav();
  $('assetEditModal').classList.add('open');$('assetEditModal').classList.remove('hidden');$('assetEditModal').setAttribute('aria-hidden','false');$('assetEditModal').style.zIndex='320';requestAnimationFrame(()=>$('assetName')?.focus());
  const historyBtn=$('assetEditHistory');
  if(historyBtn){
    if(asset){historyBtn.classList.remove('hidden');historyBtn.onclick=()=>openAssetHistory(asset.id);}
    else{historyBtn.classList.add('hidden');historyBtn.onclick=null;}
  }
}
function closeAssetModal(){const m=$('assetEditModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function updateAssetLifecycleBadge(){
  const el=$('assetLifecycleBadge'); if(!el)return;
  const warranty=dateUrgencyLevel($('assetWarrantyExpiration')?.value,ASSET_WARRANTY_WARN_DAYS);
  const eol=dateUrgencyLevel($('assetEndOfLife')?.value,ASSET_EOL_WARN_DAYS);
  // Mostra o alerta mais urgente entre garantia e fim de vida; se nenhum
  // exigir atenção, o badge fica vazio (sem poluir o formulário à toa).
  let level='none', text='';
  if(eol==='expired'){level='expired';text=ASSET_LIFECYCLE_LABELS.eol.expired;}
  else if(warranty==='expired'){level='expired';text=ASSET_LIFECYCLE_LABELS.warranty.expired;}
  else if(eol==='soon'){level='soon';text=ASSET_LIFECYCLE_LABELS.eol.soon;}
  else if(warranty==='soon'){level='soon';text=ASSET_LIFECYCLE_LABELS.warranty.soon;}
  el.textContent=text; el.className='asset-lifecycle-badge'+(text?` level-${level}`:'');
}
function updateAssetNotesCount(){
  const el=$('assetNotesCount'); const field=$('assetNotes'); if(!el||!field)return;
  el.textContent=`${field.value.length}/500`;
}
function initAssetEditStepNav(){
  const content=$('assetEditContent');
  const steps=Array.from(document.querySelectorAll('#assetEditNav .asset-edit-step'));
  if(!content||!steps.length)return;
  steps.forEach(step=>{
    step.addEventListener('click',()=>{
      const target=$(step.dataset.stepTarget);
      target?.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
  const setActive=id=>steps.forEach(s=>s.classList.toggle('active',s.dataset.stepTarget===id));
  setActive(steps[0]?.dataset.stepTarget);
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(entry.isIntersecting)setActive(entry.target.id);});
  },{root:content,threshold:0,rootMargin:'-8% 0px -75% 0px'});
  document.querySelectorAll('#assetEditForm .asset-edit-section').forEach(sec=>observer.observe(sec));
}
function resetAssetEditStepNav(){
  const content=$('assetEditContent'); if(content)content.scrollTop=0;
  const steps=document.querySelectorAll('#assetEditNav .asset-edit-step');
  steps.forEach((s,i)=>s.classList.toggle('active',i===0));
}
async function saveAssetForm(){
  const id=$('assetEditId').value.trim();
  const locationValue=$('assetLocation')?.value||'';
  const locationType=locationValue.startsWith('stock:')?'stock':'room';
  const locationRoomId=locationType==='room'?locationValue.slice(5):null;
  const rackId=locationType==='room'?($('assetRack').value||null):null;
  const name=$('assetName').value.trim();
  const serial=$('assetSerial').value.trim();
  if(!name && !serial){toast('Nome e Serial Number são obrigatórios.');$('assetName')?.focus();return;}
  if(!name){toast('Nome é obrigatório.');$('assetName')?.focus();return;}
  if(!serial){toast('Serial Number é obrigatório.');$('assetSerial')?.focus();return;}
  const face=rackId?($('assetFace')?.value||''):'';
  if(rackId && !face){toast('Face é obrigatória quando o asset está em um rack.');$('assetFace')?.focus();return;}
  const rack=rackId?assetRack(rackId):null;
  const units=Math.max(1,Math.floor(num(rack?.units,state.rackUnits)));
  const uStart=Math.max(1,Math.min(units,Math.floor(num($('assetUStart').value,1))));
  const uHeight=Math.max(1,Math.floor(num($('assetUHeight').value,1)));
  if(rack && uStart+uHeight-1>units){toast(`O equipamento ultrapassa as ${units}U do rack.`);return;}
  const existingAsset=id?state.assets.find(a=>a.id===id):null;
  const roomObj=locationRoomId?(state.rooms||[]).find(r=>r.id===locationRoomId):null;
  const powerW=Math.max(0,Math.floor(num($('assetPowerW')?.value,0)));
  const weightKg=Math.max(0,num($('assetWeightKg')?.value,0));
  const purchaseDate=$('assetPurchaseDate')?.value||'';
  const warrantyExpiration=$('assetWarrantyExpiration')?.value||'';
  const endOfLife=$('assetEndOfLife')?.value||'';
  const notes=($('assetNotes')?.value||'').trim().slice(0,500);
  const locVal=$('assetLocation').value||''; const stockParts=locVal.startsWith('stock:')?locVal.split(':'):null; const finalLocationId=stockParts?.[1]||roomObj?.locationId||state.locations?.[0]?.id||null; const finalStockId=stockParts?.[2]||null; const asset={id:id||uid('asset'),name,type:$('assetType').value||'Equipamento',manufacturer:$('assetManufacturer').value.trim(),model:$('assetModel').value.trim(),assetTag:$('assetTag').value.trim(),serial,locationType,locationName:locationType==='stock'?'Estoque':(roomObj?.name||''),locationId:finalLocationId,stockId:finalStockId,roomId:locationRoomId,rackId,face:rackId?face:null,uStart,uHeight,status:$('assetStatus').value||'Instalado',substatus:$('assetSubstatus').value||'',ports:cloneData(assetEditPorts),powerW,weightKg,purchaseDate,warrantyExpiration,endOfLife,notes};
  if(assetConflicts(state.assets,asset,id||null)){toast('Não é possível: existe outro equipamento ocupando uma ou mais U.');return;}
  if(rack && powerW>0 && num(rack.powerCapacityW,0)>0){
    const othersPowerW=state.assets.filter(a=>a.rackId===rack.id && a.id!==asset.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
    const totalPowerW=othersPowerW+powerW;
    if(totalPowerW>rack.powerCapacityW){
      const ok=await uiConfirm(`Isso leva o consumo estimado do rack "${rackDisplayName(rack)}" a ${totalPowerW}W, acima da capacidade cadastrada de ${rack.powerCapacityW}W.`,{title:'Capacidade elétrica do rack excedida',confirmText:'Salvar mesmo assim',danger:true});
      if(!ok)return;
    }
  }
  if(rack && weightKg>0 && num(rack.weightCapacityKg,0)>0){
    const othersWeightKg=state.assets.filter(a=>a.rackId===rack.id && a.id!==asset.id).reduce((sum,a)=>sum+Math.max(0,num(a.weightKg,0)),0);
    const totalWeightKg=othersWeightKg+weightKg;
    if(totalWeightKg>rack.weightCapacityKg){
      const ok=await uiConfirm(`Isso leva o peso estimado do rack "${rackDisplayName(rack)}" a ${totalWeightKg}kg, acima da capacidade de carga cadastrada de ${rack.weightCapacityKg}kg.`,{title:'Capacidade de carga do piso excedida',confirmText:'Salvar mesmo assim',danger:true});
      if(!ok)return;
    }
  }
  if(rack){
    const room=state.rooms.find(x=>x.id===locationRoomId);
    if(room && powerW>0 && num(room.coolingCapacityW,0)>0){
      const othersRoomPowerW=state.assets.filter(a=>a.roomId===room.id && a.id!==asset.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
      const totalRoomPowerW=othersRoomPowerW+powerW;
      if(totalRoomPowerW>room.coolingCapacityW){
        const ok=await uiConfirm(`Isso leva a carga térmica estimada da sala "${room.name}" a ${totalRoomPowerW}W, acima da capacidade de refrigeração cadastrada de ${room.coolingCapacityW}W.`,{title:'Capacidade de refrigeração da sala excedida',confirmText:'Salvar mesmo assim',danger:true});
        if(!ok)return;
      }
    }
  }
  const before=existingAsset?cloneData(existingAsset):null;
  const old=state.assets.findIndex(a=>a.id===asset.id);
  const changes=old>=0?assetLogDiff(before,asset):[];
  if(old>=0)state.assets[old]=asset;else state.assets.push(asset);
  const bayRack=$('bayfaceModal')?.classList.contains('open')?$('bayfaceModal').dataset.rackId:null; closeAssetModal(); save(); renderAll(false); renderAssetsList(); if(state.selected?.type==='rack')renderProperties(); if(bayRack)renderBayface(bayRack);
  recordAssetAudit({action:old>=0?'UPDATE':'CREATE',asset,before,after:asset,changes});
  toast(old>=0?'Asset atualizado':'Asset criado');
  if(old<0)flashElement(document.querySelector(`.asset-row[data-asset-id="${CSS.escape(String(asset.id))}"]`));
}

async function deleteAsset(assetId){
  const a=state.assets.find(x=>x.id===assetId);if(!a)return;
  const password=await uiPrompt('Digite a senha para confirmar a exclusão permanente.','',{title:'Exclusão permanente',label:'Senha',type:'password',confirmText:'Continuar'});
  if(password===null)return;
  if(password!=='TESTE'){toast('Senha incorreta. O asset não foi excluído.');return;}
  const ok=await uiConfirm('',{title:`Excluir PERMANENTEMENTE o asset "${a.name}"?`,confirmText:'Excluir definitivamente',danger:true});
  if(!ok)return;
  const snapshot=cloneData(a);
  state.assets=state.assets.filter(x=>x.id!==assetId);save();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');
  recordAssetAudit({action:'DELETE',asset:snapshot,before:snapshot,after:null,changes:[]});
  if($('bayfaceModal')?.classList.contains('open'))renderBayface(a.rackId);toast('Asset excluído permanentemente');
}
function locateAsset(assetId){
  const a=state.assets.find(x=>x.id===assetId); if(!a)return;
  if(a.roomId&&a.roomId!==state.activeRoomId)switchRoom(a.roomId);
  if(!a.rackId)return;
  // O equipamento pode estar instalado na traseira: sem isto o Bayface abria
  // sempre na face que estava ativa, mostrando o lado errado do rack.
  if(a.face==='rear'||a.face==='front')bayfaceFace=a.face;
  state.selected={type:'rack',id:a.rackId};
  state.multiSelected=[a.rackId];
  state.trayMultiSelected=[];
  closeAssetsModal();
  closeBayface();
  renderAll(false);
  openBayface(a.rackId);
  // Marca o equipamento localizado: abrir o rack sem apontar qual é o asset
  // deixa o usuário procurando a U na mão.
  flashElement(document.querySelector(`#bayfaceContent [data-bay-edit="${CSS.escape(String(a.id))}"]`));
}
let assetColumnFilters={};
const ASSET_COLUMN_ORDER=['check','assetTag','name','type','manufacturer','model','serial','location','rack','face','u','uHeight','status','substatus','purchaseDate','warranty','eol','actions'];
const ASSET_COLUMN_WIDTHS_DEFAULT={check:36,assetTag:126,name:170,type:100,manufacturer:120,model:130,serial:130,location:170,rack:80,face:70,u:64,uHeight:64,status:100,substatus:100,purchaseDate:110,warranty:120,eol:120,actions:150};
const ASSET_COLUMN_MIN_WIDTHS={check:36,assetTag:70,name:90,type:70,manufacturer:70,model:70,serial:80,location:90,rack:60,face:56,u:48,uHeight:48,status:70,substatus:70,purchaseDate:80,warranty:80,eol:80,actions:120};
let assetColumnWidths={...ASSET_COLUMN_WIDTHS_DEFAULT};
let assetColumnsAutoFitted=false;
function measureTextWidth(text,font){
  if(!measureTextWidth._ctx) measureTextWidth._ctx=document.createElement('canvas').getContext('2d');
  measureTextWidth._ctx.font=font;
  return measureTextWidth._ctx.measureText(String(text||'')).width;
}
const ASSET_COLUMN_HEADER_LABELS={assetTag:'Asset Tag',name:'Nome',type:'Tipo',manufacturer:'Fabricante',model:'Modelo',serial:'SN',location:'Localização',rack:'Rack',face:'Face',u:'U',uHeight:'Qtd. U',status:'Status',substatus:'Substatus',purchaseDate:'Compra',warranty:'Garantia',eol:'EOL',notes:'Observações'};
function autoFitAssetColumnText(a,col){
  switch(col){
    case 'assetTag': return a.assetTag||'—';
    case 'name': return a.name||'';
    case 'type': return a.type||'';
    case 'manufacturer': return a.manufacturer||'—';
    case 'model': return a.model||'—';
    case 'serial': return a.serial||'—';
    case 'location': return assetLocationLabel(a);
    case 'rack': return assetRackLabel(a);
    case 'u': { const r=assetRack(a.rackId),u=assetOccupancy(a); return r?`U${u.start}${u.end!==u.start?'–U'+u.end:''}`:'—'; }
    case 'uHeight': return assetRack(a.rackId)?String(a.uHeight||1)+'U':'—';
    case 'status': return a.status||'—';
    case 'substatus': return a.substatus||'—';
    case 'purchaseDate': return formatAssetDate(a.purchaseDate)||'—';
    case 'warranty': return formatAssetDate(a.warrantyExpiration)||'—';
    case 'eol': return formatAssetDate(a.endOfLife)||'—';
    default: return '';
  }
}
function autoFitAssetColumns(items){
  const bodyFont='10px Inter, "Segoe UI", Arial, sans-serif';
  const headFont='750 9px Inter, "Segoe UI", Arial, sans-serif';
  const ICON_EXTRA={type:20,warranty:20,eol:20,status:20};
  const MAX_WIDTH=320, BASE_PADDING=30;
  ASSET_COLUMN_ORDER.forEach(col=>{
    if(col==='check'||col==='actions')return; // larguras fixas: não têm texto variável pra medir
    let maxW=measureTextWidth(ASSET_COLUMN_HEADER_LABELS[col]||'',headFont)+18; // folga pro ícone de ordenar/filtrar
    items.forEach(a=>{
      const w=measureTextWidth(autoFitAssetColumnText(a,col),bodyFont);
      if(w>maxW)maxW=w;
    });
    const padding=BASE_PADDING+(ICON_EXTRA[col]||0);
    assetColumnWidths[col]=Math.max(ASSET_COLUMN_MIN_WIDTHS[col]||40,Math.min(MAX_WIDTH,Math.ceil(maxW+padding)));
  });
}
function applyAssetColumnWidths(){
  const wrap=$('assetsList')?.closest('.assets-table-wrap'); if(!wrap)return;
  wrap.style.setProperty('--assets-cols',ASSET_COLUMN_ORDER.map(k=>`${assetColumnWidths[k]||ASSET_COLUMN_WIDTHS_DEFAULT[k]}px`).join(' '));
}
function bindAssetColumnResize(){
  document.querySelectorAll('#assetsTableHead .col-resize-handle').forEach(handle=>{
    handle.onmousedown=e=>{
      e.preventDefault(); e.stopPropagation();
      const col=handle.dataset.resizeCol;
      const startX=e.clientX, startWidth=assetColumnWidths[col]||ASSET_COLUMN_WIDTHS_DEFAULT[col];
      const minWidth=ASSET_COLUMN_MIN_WIDTHS[col]||40;
      handle.classList.add('is-resizing');
      const onMove=ev=>{
        const next=Math.max(minWidth,startWidth+(ev.clientX-startX));
        assetColumnWidths[col]=next;
        applyAssetColumnWidths();
      };
      const onUp=()=>{
        handle.classList.remove('is-resizing');
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
      };
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    };
  });
}
const ASSET_FILTER_COLUMNS={assetTag:'Asset Tag',name:'Nome',type:'Tipo',manufacturer:'Fabricante',model:'Modelo',serial:'Serial Number',location:'Localização',rack:'Rack',face:'Face',u:'U',uHeight:'Qtd. U',status:'Status',substatus:'Substatus',purchaseDate:'Data de compra',warranty:'Garantia',eol:'EOL'};
function assetColumnValue(a,col){
  const r=assetRack(a.rackId), u=assetOccupancy(a);
  switch(col){
    case 'assetTag': return a.assetTag||'—';
    case 'name': return a.name||'—';
    case 'type': return a.type||'—';
    case 'manufacturer': return a.manufacturer||'—';
    case 'model': return a.model||'—';
    case 'serial': return a.serial||'—';
    case 'location': return assetLocationLabel(a);
    case 'rack': return assetRackLabel(a);
    case 'face': return r?(a.face==='rear'?'Traseira':'Frente'):'—';
    case 'u': return r?`U${u.start}${u.end!==u.start?'–U'+u.end:''}`:'—';
    case 'uHeight': return r?String(a.uHeight||1)+'U':'—';
    case 'status': return a.status||'—';
    case 'substatus': return a.substatus||'—';
    case 'purchaseDate': return formatAssetDate(a.purchaseDate)||'—';
    case 'warranty': return {expired:'Vencida',soon:'Vence em breve',ok:'Em garantia',none:'Não informado'}[assetWarrantyLevel(a)];
    case 'eol': return {expired:'Vencido',soon:'Vence em breve',ok:'Dentro do ciclo',none:'Não informado'}[assetEndOfLifeLevel(a)];
    default: return '';
  }
}
function assetMatchesColumnFilters(a,ignoreCol=null){
  return Object.entries(assetColumnFilters).every(([col,values])=>{
    if(col===ignoreCol||!values||!values.size)return true;
    return values.has(assetColumnValue(a,col));
  });
}
function closeAssetColumnFilterMenus(){document.querySelectorAll('.col-filter-panel').forEach(x=>x.remove());}
function renderAssetsTableHead(){
  document.querySelectorAll('#assetsTableHead [data-filter-col]').forEach(btn=>{
    const col=btn.dataset.filterCol;
    const active=assetColumnFilters[col]&&assetColumnFilters[col].size>0;
    btn.classList.toggle('is-filtered',!!active);
  });
}
function openAssetColumnFilterMenu(col,anchorBtn){
  closeAssetColumnFilterMenus();
  const q=String($('assetsSearch')?.value||'').toLowerCase().trim();
  const searchMatches=state.assets.filter(a=>{const room=assetRoom(a);return !q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRackLabel(a)].join(' ').toLowerCase().includes(q);});
  const relevant=searchMatches.filter(a=>assetMatchesColumnFilters(a,col));
  const counts=new Map();
  relevant.forEach(a=>{const v=assetColumnValue(a,col);counts.set(v,(counts.get(v)||0)+1);});
  const values=[...counts.keys()].sort((x,y)=>x.localeCompare(y,'pt-BR'));
  const selected=assetColumnFilters[col]||new Set();
  const panel=document.createElement('div'); panel.className='col-filter-panel';
  panel.innerHTML=`<div class="col-filter-panel-head"><b>${esc(ASSET_FILTER_COLUMNS[col]||col)}</b>${selected.size?'<button type="button" class="col-filter-clear">Limpar</button>':''}</div><div class="col-filter-panel-search"><input type="text" class="col-filter-search-input" placeholder="Buscar valor..." autocomplete="off"></div><div class="col-filter-panel-list">${values.length?values.map(v=>`<label class="col-filter-option"><input type="checkbox" value="${esc(v)}" ${selected.has(v)?'checked':''}><span>${esc(v)}</span><small>${counts.get(v)}</small></label>`).join(''):'<div class="empty">Nenhum valor.</div>'}</div>`;
  document.body.appendChild(panel);
  const rect=anchorBtn.getBoundingClientRect();
  panel.style.top=`${rect.bottom+4}px`; panel.style.left=`${Math.min(rect.left,window.innerWidth-panel.offsetWidth-12)}px`;
  const searchInput=panel.querySelector('.col-filter-search-input');
  searchInput?.addEventListener('input',()=>{
    const sq=searchInput.value.toLowerCase().trim();
    panel.querySelectorAll('.col-filter-option').forEach(opt=>{
      const label=opt.querySelector('span')?.textContent.toLowerCase()||'';
      opt.style.display=(!sq||label.includes(sq))?'':'none';
    });
  });
  if(values.length>4)searchInput?.focus();
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.onchange=()=>{
    const set=assetColumnFilters[col]instanceof Set?assetColumnFilters[col]:new Set();
    if(cb.checked)set.add(cb.value); else set.delete(cb.value);
    assetColumnFilters[col]=set;
    assetsPage=1;
    renderAssetsList($('assetsSearch')?.value||'');
    openAssetColumnFilterMenu(col,anchorBtn);
  });
  panel.querySelector('.col-filter-clear')?.addEventListener('click',()=>{
    delete assetColumnFilters[col];
    assetsPage=1;
    renderAssetsList($('assetsSearch')?.value||'');
    closeAssetColumnFilterMenus();
  });
}
let assetSortColumn=null, assetSortDir='asc';
let assetsPage=1, assetsPageSize=10;
const ASSET_STATUS_DOT_COLORS={ativo:'var(--green)',instalado:'var(--green)',ligado:'var(--green)',emestoque:'var(--yellow)',estoque:'var(--yellow)',emmanutencao:'var(--orange)',manutencao:'var(--orange)',aguardandopeca:'var(--orange)',desativado:'var(--muted)',desligado:'var(--muted)',arquivado:'var(--purple)',disposed:'var(--purple)',reserva:'var(--blue)',reservado:'var(--blue)',perdido:'var(--red)',retired:'var(--muted)',planejado:'var(--blue)'};
const ASSET_STATUS_DOT_PALETTE=['var(--blue)','var(--green)','var(--orange)','var(--yellow)','var(--purple)','var(--red)','var(--muted)'];
function assetStatusDotColor(status,index){
  const key=catalogNormalize(status);
  if(ASSET_STATUS_DOT_COLORS[key])return ASSET_STATUS_DOT_COLORS[key];
  return ASSET_STATUS_DOT_PALETTE[index%ASSET_STATUS_DOT_PALETTE.length];
}
function renderAssetsKpis(items){
  const wrap=$('assetsKpiRow'); if(!wrap)return;
  const total=items.length;
  const counts=new Map();
  items.forEach(a=>{const s=a.status||'Sem status';counts.set(s,(counts.get(s)||0)+1);});
  const order=[...counts.keys()].sort((x,y)=>counts.get(y)-counts.get(x));
  const activeStatus=assetColumnFilters.status&&assetColumnFilters.status.size===1?[...assetColumnFilters.status][0]:null;
  const tiles=order.map((status,i)=>{
    const n=counts.get(status);
    const pct=total?(n/total*100).toFixed(1).replace('.',','):'0,0';
    return `<button type="button" class="asset-kpi-tile${status===activeStatus?' is-active':''}" data-kpi-status="${esc(status)}"><span class="asset-kpi-dot" style="background:${assetStatusDotColor(status,i)}"></span><div class="asset-kpi-text"><small>${esc(status)}</small><b>${n}</b></div><span class="asset-kpi-pct">${pct}%</span></button>`;
  }).join('');
  const warrantyExpiredCount=items.filter(a=>assetWarrantyLevel(a)==='expired').length;
  const warrantyActive=assetColumnFilters.warranty&&assetColumnFilters.warranty.has('Vencida');
  const warrantyTile=warrantyExpiredCount?`<button type="button" class="asset-kpi-tile asset-kpi-danger${warrantyActive?' is-active':''}" data-kpi-warranty="1"><span class="asset-kpi-dot" style="background:var(--red)"></span><div class="asset-kpi-text"><small>Garantia vencida</small><b>${warrantyExpiredCount}</b></div></button>`:'';
  wrap.innerHTML=`<button type="button" class="asset-kpi-tile asset-kpi-total${!activeStatus&&!warrantyActive?' is-active':''}" data-kpi-total="1"><span class="asset-kpi-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg></span><div class="asset-kpi-text"><small>Total</small><b>${total}</b></div></button>${tiles}${warrantyTile}`;
}
function renderAssetsFilterBar(){
  document.querySelectorAll('.assets-filter-bar [data-filter-col]').forEach(btn=>{
    const col=btn.dataset.filterCol;
    const active=assetColumnFilters[col]&&assetColumnFilters[col].size>0;
    btn.classList.toggle('is-filtered',!!active);
  });
  const anyActive=Object.values(assetColumnFilters).some(v=>v&&v.size>0);
  $('assetsClearFilters')?.classList.toggle('is-active',anyActive);
}
function renderAssetsPagination(totalItems){
  const pageSize=assetsPageSize;
  const totalPages=Math.max(1,Math.ceil(totalItems/pageSize));
  if(assetsPage>totalPages)assetsPage=totalPages;
  if(assetsPage<1)assetsPage=1;
  const start=totalItems?(assetsPage-1)*pageSize+1:0;
  const end=Math.min(totalItems,assetsPage*pageSize);
  if($('assetsPageRange'))$('assetsPageRange').textContent=`${start}–${end} de ${totalItems}`;
  if($('assetsPageSize'))$('assetsPageSize').value=String(pageSize);
  const btns=$('assetsPageButtons'); if(!btns)return;
  const pages=[];
  const windowSize=5;
  let from=Math.max(1,assetsPage-Math.floor(windowSize/2));
  let to=Math.min(totalPages,from+windowSize-1);
  from=Math.max(1,to-windowSize+1);
  for(let p=from;p<=to;p++)pages.push(p);
  const pageBtn=(p,label,disabled,active)=>`<button type="button" class="assets-page-btn${active?' is-active':''}" data-page="${p}" ${disabled?'disabled':''}>${label}</button>`;
  btns.innerHTML=pageBtn(1,'«',assetsPage<=1)+pageBtn(assetsPage-1,'‹',assetsPage<=1)+pages.map(p=>pageBtn(p,String(p),false,p===assetsPage)).join('')+pageBtn(assetsPage+1,'›',assetsPage>=totalPages)+pageBtn(totalPages,'»',assetsPage>=totalPages);
}
let assetSelectedIds=new Set();
function assetSortValue(a,col){
  const r=assetRack(a.rackId), u=assetOccupancy(a);
  switch(col){
    case 'assetTag': return (a.assetTag||'').toLowerCase();
    case 'name': return (a.name||'').toLowerCase();
    case 'type': return (a.type||'').toLowerCase();
    case 'manufacturer': return (a.manufacturer||'').toLowerCase();
    case 'model': return (a.model||'').toLowerCase();
    case 'serial': return (a.serial||'').toLowerCase();
    case 'location': return assetLocationLabel(a).toLowerCase();
    case 'rack': return assetRackLabel(a).toLowerCase();
    case 'face': return r?(a.face==='rear'?'traseira':'frente'):'';
    case 'u': return r?u.start:-1;
    case 'uHeight': return r?(a.uHeight||1):-1;
    case 'status': return (a.status||'').toLowerCase();
    case 'substatus': return (a.substatus||'').toLowerCase();
    case 'purchaseDate': return a.purchaseDate||'9999-99-99';
    case 'warranty': return `${{expired:0,soon:1,ok:2,none:3}[assetWarrantyLevel(a)]}_${a.warrantyExpiration||'9999-99-99'}`;
    case 'eol': return `${{expired:0,soon:1,ok:2,none:3}[assetEndOfLifeLevel(a)]}_${a.endOfLife||'9999-99-99'}`;
    default: return '';
  }
}
function renderAssetsTableSort(){
  document.querySelectorAll('#assetsTableHead [data-sort-col]').forEach(btn=>{
    const active=btn.dataset.sortCol===assetSortColumn;
    btn.classList.toggle('is-sorted',active);
    btn.classList.toggle('is-desc',active&&assetSortDir==='desc');
  });
}
function updateAssetsBulkBar(){
  const count=assetSelectedIds.size;
  if($('assetsSelectedCountFooter'))$('assetsSelectedCountFooter').textContent=String(count);
  const bar=$('assetsBulkBar'); if(!bar)return;
  bar.classList.toggle('hidden',count===0);
  if($('assetsSelectedCount'))$('assetsSelectedCount').textContent=String(count);
  const statusSel=$('assetsBulkStatus');
  if(statusSel && statusSel.options.length<=1) statusSel.innerHTML='<option value="">Alterar status...</option>'+assetStatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const substatusSel=$('assetsBulkSubstatus');
  if(substatusSel && substatusSel.options.length<=1) substatusSel.innerHTML='<option value="">Alterar substatus...</option>'+assetSubstatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const locSel=$('assetsBulkLocation');
  if(locSel && locSel.options.length<=1) locSel.innerHTML='<option value="">Alterar localização...</option>'+assetLocationChoices('').replace('<option value="">Selecione a localização</option>','');
  // As três listas viraram dropdown estilizado: o <select> continua sendo o valor, o botão
  // espelha o rótulo.
  ['assetsBulkStatus','assetsBulkSubstatus','assetsBulkLocation'].forEach(id=>syncSelectButton(id,`${id}Btn`));
}
async function bulkDeleteAssets(){
  if(!assetSelectedIds.size)return;
  const ids=[...assetSelectedIds];
  const password=await uiPrompt('Digite a senha para confirmar a exclusão permanente.','',{title:`Excluir ${ids.length} asset(s) permanentemente`,label:'Senha',type:'password',confirmText:'Continuar'});
  if(password===null)return;
  if(password!=='TESTE'){toast('Senha incorreta. Nada foi excluído.');return;}
  const ok=await uiConfirm('',{title:`Excluir PERMANENTEMENTE ${ids.length} asset(s)?`,confirmText:'Excluir definitivamente',danger:true});
  if(!ok)return;
  ids.forEach(id=>{
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    const snapshot=cloneData(a);
    state.assets=state.assets.filter(x=>x.id!==id);
    recordAssetAudit({action:'DELETE',asset:snapshot,before:snapshot,after:null,changes:[]});
  });
  assetSelectedIds.clear(); save(); renderAll(false); renderAssetsList($('assetsSearch')?.value||'');
  toast(`${ids.length} asset(s) excluído(s)`);
}
async function bulkChangeAssetStatus(status){
  if(!assetSelectedIds.size||!status)return;
  const ids=[...assetSelectedIds];
  const ok=await uiConfirm(`Isso altera o status de ${ids.length} asset(s) para "${status}".`,{title:'Alterar status em massa',confirmText:'Alterar'});
  if(!ok)return;
  ids.forEach(id=>{
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    const before=cloneData(a); a.status=status; const after=cloneData(a);
    const changes=assetLogDiff(before,after);
    if(changes.length)recordAssetAudit({action:'UPDATE',asset:a,before,after,changes});
  });
  save(); renderAll(false); renderAssetsList($('assetsSearch')?.value||'');
  toast('Status atualizado em massa');
}
async function bulkChangeAssetSubstatus(substatus){
  if(!assetSelectedIds.size||!substatus)return;
  const ids=[...assetSelectedIds];
  const ok=await uiConfirm(`Isso altera o substatus de ${ids.length} asset(s) para "${substatus}".`,{title:'Alterar substatus em massa',confirmText:'Alterar'});
  if(!ok)return;
  ids.forEach(id=>{
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    const before=cloneData(a); a.substatus=substatus; const after=cloneData(a);
    const changes=assetLogDiff(before,after);
    if(changes.length)recordAssetAudit({action:'UPDATE',asset:a,before,after,changes});
  });
  save(); renderAll(false); renderAssetsList($('assetsSearch')?.value||'');
  toast('Substatus atualizado em massa');
}
async function bulkChangeAssetLocation(locVal){
  if(!assetSelectedIds.size||!locVal)return;
  const ids=[...assetSelectedIds];
  const locationType=locVal.startsWith('stock:')?'stock':'room';
  const locationRoomId=locationType==='room'?locVal.slice(5):null;
  const roomObj=locationRoomId?(state.rooms||[]).find(r=>r.id===locationRoomId):null;
  const stockParts=locVal.startsWith('stock:')?locVal.split(':'):null;
  const finalLocationId=stockParts?.[1]||roomObj?.locationId||state.locations?.[0]?.id||null;
  const finalStockId=stockParts?.[2]||null;
  const label=locationType==='stock'?'Estoque':(roomObj?.name||'');
  const ok=await uiConfirm(`Isso move ${ids.length} asset(s) para "${label}" e remove a posição de rack/U atual (você poderá posicionar cada um individualmente depois).`,{title:'Alterar localização em massa',confirmText:'Mover',danger:true});
  if(!ok)return;
  ids.forEach(id=>{
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    const before=cloneData(a);
    a.locationType=locationType; a.roomId=locationRoomId; a.rackId=null; a.locationId=finalLocationId; a.stockId=finalStockId; a.locationName=label;
    const after=cloneData(a);
    const changes=assetLogDiff(before,after);
    if(changes.length)recordAssetAudit({action:'UPDATE',asset:a,before,after,changes});
  });
  save(); renderAll(false); renderAssetsList($('assetsSearch')?.value||'');
  toast('Localização atualizada em massa');
}
function renderAssetsList(filter=''){
  normalizeLocations(); normalizeAssets(); const wrap=$('assetsList');if(!wrap)return; const q=String(filter||'').toLowerCase().trim();
  // Enquanto o snapshot do projeto não chegou, a lista mostra esqueleto: sem
  // isso ela aparece vazia e o usuário acha que perdeu os assets.
  if(cloud.loading){
    wrap.innerHTML=Array.from({length:6},()=>`<div class="asset-row is-skeleton" aria-hidden="true"><div class="asset-cell"><span class="sk sk-line sk-check"></span></div>${Array.from({length:7},()=>`<div class="asset-cell"><span class="sk sk-line"></span></div>`).join('')}</div>`).join('');
    return;
  }
  let items=state.assets.filter(a=>{const room=assetRoom(a);const matchesSearch=!q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRackLabel(a)].join(' ').toLowerCase().includes(q);return matchesSearch&&assetMatchesColumnFilters(a);});
  if(assetAttentionOnly){const attn=new Set(assetsNeedingAttention().map(a=>a.id));items=items.filter(a=>attn.has(a.id));}
  const attnBanner=$('assetsAttentionBanner');
  if(attnBanner)attnBanner.classList.toggle('hidden',!assetAttentionOnly);
  if(assetSortColumn){
    const dir=assetSortDir==='desc'?-1:1;
    items=[...items].sort((x,y)=>{const vx=assetSortValue(x,assetSortColumn),vy=assetSortValue(y,assetSortColumn);if(vx<vy)return -1*dir;if(vx>vy)return 1*dir;return 0;});
  }
  if(!assetColumnsAutoFitted && items.length){ autoFitAssetColumns(items); assetColumnsAutoFitted=true; }
  const visibleIds=new Set(items.map(a=>a.id));
  assetSelectedIds=new Set([...assetSelectedIds].filter(id=>visibleIds.has(id)));
  if($('assetsCount'))$('assetsCount').textContent=String(items.length); if($('assetsActiveCount'))$('assetsActiveCount').textContent=String(items.filter(a=>!isAssetArchived(a)).length); if($('assetsArchivedCount'))$('assetsArchivedCount').textContent=String(items.filter(isAssetArchived).length);
  const warrantyExpiredCount=items.filter(a=>assetWarrantyLevel(a)==='expired').length;
  if($('assetsWarrantyExpiredCount'))$('assetsWarrantyExpiredCount').textContent=String(warrantyExpiredCount);
  if($('assetsWarrantyExpiredStat'))$('assetsWarrantyExpiredStat').classList.toggle('hidden',warrantyExpiredCount===0);
  const kpiMatchesFilters=a=>Object.entries(assetColumnFilters).every(([col,values])=>{if(col==='status'||col==='warranty')return true;if(!values||!values.size)return true;return values.has(assetColumnValue(a,col));});
  let kpiItems=state.assets.filter(a=>{const room=assetRoom(a);const matchesSearch=!q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRackLabel(a)].join(' ').toLowerCase().includes(q);return matchesSearch&&kpiMatchesFilters(a);});
  if(assetAttentionOnly){const attn=new Set(assetsNeedingAttention().map(a=>a.id));kpiItems=kpiItems.filter(a=>attn.has(a.id));}
  renderAssetsKpis(kpiItems);
  renderAssetsFilterBar();
  const totalPages=Math.max(1,Math.ceil(items.length/assetsPageSize));
  if(assetsPage>totalPages)assetsPage=totalPages;
  if(assetsPage<1)assetsPage=1;
  const pageStart=(assetsPage-1)*assetsPageSize;
  const pageItems=items.slice(pageStart,pageStart+assetsPageSize);
  wrap.innerHTML=pageItems.length?pageItems.map(a=>{const r=assetRack(a.rackId),u=assetOccupancy(a),color=bayfaceTypeColor(a.type),checked=assetSelectedIds.has(a.id),warrantyLevel=assetWarrantyLevel(a),eolLevel=assetEndOfLifeLevel(a);return `<div class="asset-row ${isAssetArchived(a)?'asset-archived':''} ${checked?'is-selected':''}" data-asset-id="${esc(a.id)}" style="--type-color:${esc(color)}"><div class="asset-cell asset-cell-check"><input type="checkbox" data-asset-select="${esc(a.id)}" ${checked?'checked':''}></div><div class="asset-cell"><strong>${esc(a.assetTag||'—')}</strong></div><div class="asset-cell">${esc(a.name)}</div><div class="asset-cell"><span class="asset-type-chip"><i></i>${esc(a.type)}</span></div><div class="asset-cell">${esc(a.manufacturer||'—')}</div><div class="asset-cell">${esc(a.model||'—')}</div><div class="asset-cell">${esc(a.serial||'—')}</div><div class="asset-cell">${esc(assetLocationLabel(a))}</div><div class="asset-cell">${esc(assetRackLabel(a))}</div><div class="asset-cell">${r?(a.face==='rear'?'Traseira':'Frente'):'—'}</div><div class="asset-cell">${r?`U${u.start}${u.end!==u.start?'–U'+u.end:''}`:'—'}</div><div class="asset-cell">${r?esc(String(a.uHeight||1)+'U'):'—'}</div><div class="asset-cell"><span class="asset-status ${isAssetArchived(a)?'archived':''}">${esc(a.status||'—')}</span></div><div class="asset-cell">${esc(a.substatus||'—')}</div><div class="asset-cell">${esc(formatAssetDate(a.purchaseDate)||'—')}</div><div class="asset-cell">${warrantyLevel==='none'?'<span class="asset-warranty-chip level-none">—</span>':`<span class="asset-warranty-chip level-${warrantyLevel}" title="Vencimento: ${esc(formatAssetDate(a.warrantyExpiration))}"><i></i>${esc(formatAssetDate(a.warrantyExpiration))}</span>`}</div><div class="asset-cell">${eolLevel==='none'?'<span class="asset-warranty-chip level-none">—</span>':`<span class="asset-warranty-chip level-${eolLevel}" title="Fim de vida: ${esc(formatAssetDate(a.endOfLife))}"><i></i>${esc(formatAssetDate(a.endOfLife))}</span>`}</div><div class="asset-actions"><button class="iconbtn" type="button" data-asset-locate="${esc(a.id)}" title="Localizar no rack"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></button><button class="iconbtn" type="button" data-asset-edit="${esc(a.id)}" title="Editar asset"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 2 1.5 1.5L14 6l-8 8-4 1 1-4 8-8Z"/><path d="M13 5.5 16 2l4.5 4.5L17 10"/></svg></button><button class="iconbtn" type="button" data-asset-history="${esc(a.id)}" title="Histórico"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button><button class="iconbtn danger-icon" type="button" data-asset-delete="${esc(a.id)}" title="Excluir permanentemente"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button></div></div>`}).join(''):'<div class="empty">Nenhum asset encontrado.</div>';
  wrap.querySelectorAll('[data-asset-locate]').forEach(b=>b.onclick=()=>locateAsset(b.dataset.assetLocate));
  wrap.querySelectorAll('[data-asset-edit]').forEach(b=>b.onclick=()=>openAssetModal(b.dataset.assetEdit));
  wrap.querySelectorAll('[data-asset-history]').forEach(b=>b.onclick=()=>openAssetHistory(b.dataset.assetHistory));
  wrap.querySelectorAll('[data-asset-delete]').forEach(b=>b.onclick=()=>deleteAsset(b.dataset.assetDelete));
  wrap.querySelectorAll('.asset-row').forEach(row=>row.ondblclick=e=>{
    if(e.target.closest('.asset-cell-check')||e.target.closest('.asset-actions'))return;
    openAssetModal(row.dataset.assetId);
  });
  wrap.querySelectorAll('[data-asset-select]').forEach(cb=>cb.onchange=()=>{
    if(cb.checked)assetSelectedIds.add(cb.dataset.assetSelect); else assetSelectedIds.delete(cb.dataset.assetSelect);
    cb.closest('.asset-row')?.classList.toggle('is-selected',cb.checked);
    if($('assetsSelectAll'))$('assetsSelectAll').checked=pageItems.length>0&&pageItems.every(x=>assetSelectedIds.has(x.id));
    updateAssetsBulkBar();
  });
  if($('assetsSelectAll'))$('assetsSelectAll').checked=pageItems.length>0&&pageItems.every(x=>assetSelectedIds.has(x.id));
  renderAssetsTableHead();
  renderAssetsTableSort();
  renderAssetsPagination(items.length);
  updateAssetsBulkBar();
  applyAssetColumnWidths();
  bindAssetColumnResize();
}
function openAssetsModal(){const m=$('assetsModal');if(!m)return;closeAssetModal();closeAssetCatalogModal();m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');$('assetsSearch').value='';assetColumnFilters={};assetSortColumn=null;assetSortDir='asc';assetSelectedIds=new Set();assetColumnWidths={...ASSET_COLUMN_WIDTHS_DEFAULT};assetAttentionOnly=false;assetColumnsAutoFitted=false;assetsPage=1;renderAssetsList();}
function closeAssetsModal(){const m=$('assetsModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
let bayfaceFace='front';
function bayfacePickerAssets(rackId,uStart){
  normalizeAssets(); normalizeAssetCatalogs();
  const assets=state.assets.filter(a=>{
    if(!a || isAssetArchived(a)) return false;
    if(a.rackId) return false;
    return true;
  }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const q=String($('bayfaceAssetPickerSearch')?.value||'').trim().toLowerCase();
  return assets.filter(a=>[a.name,a.assetTag,a.type,a.manufacturer,a.model,a.serial,a.locationName].join(' ').toLowerCase().includes(q));
}
let bayfacePickerSort={key:'name',dir:1}, bayfacePickerPage=1;
const BAYFACE_PICKER_PAGE_SIZE=8;
const BAYFACE_PICKER_EMPTY_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="5" rx="1.2"/><rect x="3" y="9.5" width="18" height="5" rx="1.2"/><rect x="3" y="16" width="18" height="5" rx="1.2"/><path d="M7 5.5h.01M7 12h.01M7 18.5h.01M12 5.5h5M12 12h5M12 18.5h5"/></svg>';
function bayfacePickerSortValue(a,key){
  switch(key){
    case 'tag': return a.assetTag||'';
    case 'name': return a.name||'';
    case 'type': return a.type||'';
    case 'manufacturer': return a.manufacturer||'';
    case 'model': return a.model||'';
    case 'serial': return a.serial||'';
    case 'location': return assetLocationLabel(a)||'';
    case 'status': return a.status||'';
    case 'substatus': return a.substatus||'';
    case 'units': return Math.max(1,Math.floor(num(a.uHeight,1)));
  }
  return '';
}
function renderBayfaceAssetPicker(){
  const modal=$('bayfaceAssetPickerModal'); if(!modal)return;
  const rackId=modal.dataset.rackId; const uStart=Math.max(1,Math.floor(Number(modal.dataset.uStart||1)));
  const rack=assetRack(rackId); const list=$('bayfaceAssetPickerList'); if(!list||!rack)return;
  const items=bayfacePickerAssets(rackId,uStart);
  const {key,dir}=bayfacePickerSort;
  items.sort((a,b)=>{const va=bayfacePickerSortValue(a,key), vb=bayfacePickerSortValue(b,key);const c=(typeof va==='number'&&typeof vb==='number')?va-vb:String(va).localeCompare(String(vb),'pt-BR',{numeric:true,sensitivity:'base'});return c*dir;});
  const totalPages=Math.max(1,Math.ceil(items.length/BAYFACE_PICKER_PAGE_SIZE));
  bayfacePickerPage=Math.min(Math.max(1,bayfacePickerPage),totalPages);
  const pageItems=items.slice((bayfacePickerPage-1)*BAYFACE_PICKER_PAGE_SIZE,bayfacePickerPage*BAYFACE_PICKER_PAGE_SIZE);
  const count=$('bayfaceAssetPickerCount'); if(count)count.textContent=`${items.length} asset${items.length===1?'':'s'}`;
  const range=$('bayfaceAssetPickerRange'); if(range)range.textContent=`${pageItems.length} de ${items.length} asset${items.length===1?'':'s'}`;
  const pageLabel=$('bayfaceAssetPickerPage'); if(pageLabel)pageLabel.textContent=`Página ${bayfacePickerPage} de ${totalPages}`;
  const prev=$('bayfaceAssetPickerPrev'), next=$('bayfaceAssetPickerNext'); if(prev)prev.disabled=bayfacePickerPage<=1; if(next)next.disabled=bayfacePickerPage>=totalPages;
  modal.querySelectorAll('[data-bay-sort]').forEach(th=>{const on=th.dataset.baySort===key;th.classList.toggle('is-sorted',on);th.dataset.dir=on?(dir>0?'asc':'desc'):'';});
  if(!items.length){
    list.innerHTML=`<div class="bayface-picker-empty"><span class="bayface-picker-empty-icon">${BAYFACE_PICKER_EMPTY_ICON}</span><strong>Nenhum asset disponível</strong><p>Não há assets cadastrados para esta U ou nenhum asset atende à busca realizada.</p><button type="button" class="btn primary bayface-picker-new" data-bay-new><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Cadastrar novo asset</button></div>`;
    list.querySelector('[data-bay-new]')?.addEventListener('click',()=>{closeBayfaceAssetPicker();openAssetModal(null,rackId,uStart);});
    return;
  }
  list.innerHTML=pageItems.map(a=>{
    const loc=assetLocationLabel(a)||'—';
    const room=assetRoom(a)?.name || '—';
    const qty=Math.max(1,Math.floor(num(a.uHeight,1)));
    const status=a.status||'—';
    const substatus=a.substatus||'—';
    const type=a.type||'—';
    const manufacturer=a.manufacturer||'—';
    const model=a.model||'—';
    const serial=a.serial||'—';
    const tag=a.assetTag||'—';
    return `<button type="button" class="bayface-picker-row" data-bay-pick-asset="${esc(a.id)}" title="Selecionar ${esc(a.name||'Equipamento')}">
      <span class="bayface-picker-cell muted">${esc(tag)}</span>
      <span class="bayface-picker-cell name"><strong>${esc(a.name||'Equipamento')}</strong></span>
      <span class="bayface-picker-cell">${esc(type)}</span>
      <span class="bayface-picker-cell">${esc(manufacturer)}</span>
      <span class="bayface-picker-cell">${esc(model)}</span>
      <span class="bayface-picker-cell">${esc(serial)}</span>
      <span class="bayface-picker-cell" title="${esc(loc)}${room!=='—'?` · ${esc(room)}`:''}">${esc(loc)}${room!=='—'?` · ${esc(room)}`:''}</span>
      <span class="bayface-picker-cell"><span class="asset-status ${status==='Arquivado'?'archived':''}">${esc(status)}</span></span>
      <span class="bayface-picker-cell">${esc(substatus)}</span>
      <span class="bayface-picker-cell units">${qty}U</span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-bay-pick-asset]').forEach(b=>b.addEventListener('click',()=>assignBayfaceAsset(b.dataset.bayPickAsset,rackId,uStart)));
}
function openBayfaceAssetPicker(rackId,uStart){
  const m=$('bayfaceAssetPickerModal'); if(!m)return;m.style.zIndex='1200';
  m.dataset.rackId=rackId; m.dataset.uStart=String(uStart||1);
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  const input=$('bayfaceAssetPickerSearch'); if(input){input.value=''; input.focus();}
  bayfacePickerPage=1;
  renderBayfaceAssetPicker();
}
function closeBayfaceAssetPicker(){const m=$('bayfaceAssetPickerModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function assignBayfaceAsset(assetId,rackId,uStart){
  const asset=state.assets.find(a=>a.id===assetId); const rack=assetRack(rackId); if(!asset||!rack)return;
  const height=Math.max(1,Math.floor(num(asset.uHeight,1))); const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  if(uStart<1||uStart+height-1>units){toast(`O asset ocupa ${height}U e não cabe a partir da U${uStart}.`);return;}
  // Ocupação por face: a traseira não disputa U com a frente. A checagem manual que
  // existia aqui somava as duas faces e barrava a traseira de uma U ocupada na frente.
  const used=occupiedUnits(state.assets,rackId,bayfaceFace);
  const own=assetOccupancy(asset);
  for(let u=own.start;u<=own.end;u++)used.delete(u);
  for(let u=uStart;u<uStart+height;u++)if(used.has(u)){toast(`Não é possível colocar o asset: U${u} já está ocupada.`);return;}
  const before={...asset};
  const room=assetRackRoom({rackId});
  asset.locationType='room'; asset.locationName=room?.name||state.rooms?.find(x=>x.id===state.activeRoomId)?.name||''; asset.locationId=room?.locationId||asset.locationId||null; asset.stockId=null; asset.roomId=room?.id||state.activeRoomId||null; asset.rackId=rackId; asset.uStart=uStart; asset.face=bayfaceFace;
  recordAssetAudit({action:'UPDATE',asset,after:asset,before,changes:assetLogDiff(before,asset)});
  save(); closeBayfaceAssetPicker(); renderAll(false); renderAssetsList($('assetsSearch')?.value||''); renderBayface(rackId); toast(`Asset adicionado à U${uStart} do rack ${rack.name}.`);
}
function bayfaceAssetTypeClass(type){
  const t=String(type||'').toLowerCase();
  if(t.includes('switch')) return 'is-switch';
  if(t.includes('storage')||t.includes('san')) return 'is-storage';
  if(t.includes('pdu')||t.includes('energia')||t.includes('power')) return 'is-power';
  if(t.includes('patch')) return 'is-patch';
  if(t.includes('firewall')||t.includes('security')) return 'is-security';
  if(t.includes('roteador')||t.includes('router')) return 'is-router';
  return 'is-server';
}
function bayfaceMarkup(rackId){
  normalizeAssets(); normalizeAssetCatalogs();
  const r=assetRack(rackId);if(!r)return '<div class="empty">Rack não encontrado.</div>';
  const units=Math.max(1,Math.floor(num(r.units,state.rackUnits)));
  const sortAssets=list=>list.slice().sort((a,b)=>a.uStart-b.uStart||a.name.localeCompare(b.name));
  const assets=sortAssets(assetsOnFace(state.assets,rackId,bayfaceFace));
  const occupied=occupiedUnits(state.assets,rackId,bayfaceFace);
  const usedUnits=[...occupied].filter(u=>u>=1&&u<=units).length;
  const freeUnits=Math.max(0,units-usedUnits);
  const rowH=26;
  const gridH=units*rowH;
  let rows='';
  for(let u=units;u>=1;u--){
    const isOccupied=occupied.has(u);
    const major=u%5===0?' major':'';
    rows+=`<button type="button" class="bayface-u${major} ${isOccupied?'occupied':''}" data-bay-add-u="${u}" ${isOccupied?'disabled':''}><span class="bayface-u-num left">${u}</span><span class="bayface-u-slot"></span><span class="bayface-u-num right">${u}</span></button>`;
  }
  const chipFor=(a)=>{
    const o=assetOccupancy(a);
    const clampedStart=Math.max(1,Math.min(units,o.start));
    const end=Math.min(units,o.end);
    const span=Math.max(1,end-clampedStart+1);
    const top=(units-end)*rowH+1;
    const h=Math.max(1,span*rowH-2);
    const color=bayfaceTypeColor(a.type);
    const name=String(a.name||a.assetTag||a.type||'Equipamento');
    const model=String(a.model||'');
    const manufacturer=String(a.manufacturer||'');
    const subtitle=[a.assetTag?`Tag: ${a.assetTag}`:'',a.serial?`SN: ${a.serial}`:''].filter(Boolean).join(' • ');
    const identity=[name,model,manufacturer].filter(Boolean).join(' — ');
    const tooltip=[identity,a.assetTag,a.serial].filter(Boolean).join(' · ');
    const heightLabel=span===1?'1U':`${span}U`;
    const compact=span===1;
    return `<button type="button" class="bayface-asset ${compact?'is-compact':''}" style="top:${top}px;height:${h}px;--type-color:${esc(color)}" data-bay-edit="${esc(a.id)}" title="${esc(tooltip)} · U${clampedStart}${span>1?`–U${end}`:''}">
      <span class="bayface-asset-body"><span class="bayface-asset-name-row"><span class="bayface-asset-dot"></span><b>${esc(name)}</b></span>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span>
      <span class="bayface-asset-u">${heightLabel}</span>
      <span class="bayface-asset-more" aria-hidden="true">⋮</span>
    </button>`;
  };
  const assetLayer=assets.map(a=>chipFor(a)).join('');
  const usagePct=units?Math.round(usedUnits/units*100):0;
  const rail=Array.from({length:Math.min(8,Math.max(4,Math.floor(units/6)))},(_,i)=>`<span style="left:${6+i*12}%"></span>`).join('');
  return `<div class="bayface-wrap">
    <div class="bayface-head">
      <div class="bayface-title-block">
        <div class="bayface-stats">
          <div class="bayface-stat"><b>${units}U</b><small>Total</small></div>
          <div class="bayface-stat"><b>${assets.length} asset${assets.length===1?'':'s'}</b><small>Utilizados</small></div>
          <div class="bayface-stat ok"><b>${usedUnits}U ocupadas</b><small>Em uso</small></div>
          <div class="bayface-stat off"><b>${freeUnits}U livres</b><small>Disponíveis</small></div>
        </div>
        <div class="bayface-usage">
          <div class="bayface-usage-bar" title="${usagePct}% ocupado"><span style="width:${usagePct}%"></span></div>
          <em class="bayface-usage-pct">${usagePct}%</em>
        </div>
      </div>
    </div>
    <div class="bayface-stage">
      <button type="button" class="bayface-nav prev" id="bayfaceNavPrev" aria-label="Rack anterior" title="Rack anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg></button>
      <div class="bayface-rack" data-units="${units}" data-face="${bayfaceFace}" style="--bayface-row-h:${rowH}px;--bayface-grid-h:${gridH}px">
        <div class="bayface-topbar"><input type="text" class="bayface-rack-name-input" id="bayfaceRackNameInput" value="${esc(r.name)}" list="bayfaceRackNamesList" autocomplete="off" spellcheck="false" aria-label="Nome do rack"><datalist id="bayfaceRackNamesList">${orderedRackList().map(x=>`<option value="${esc(x.name)}"></option>`).join('')}</datalist><button type="button" class="bayface-rack-state" id="bayfaceFaceToggle" title="Alternar entre frente e traseira do rack">${bayfaceFace==='front'?'FRONT':'REAR'}</button></div>
        <div class="bayface-frame">
          <div class="bayface-rail rail-left"></div><div class="bayface-rail rail-right"></div>
          <div class="bayface-mount-rails">${rail}</div>
          <div class="bayface-grid">
            <div class="bayface-rows">${rows}</div>
            <div class="bayface-assets">${assetLayer}</div>
          </div>
        </div>
      </div>
      <button type="button" class="bayface-nav next" id="bayfaceNavNext" aria-label="Próximo rack" title="Próximo rack"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg></button>
    </div>
  </div>`;
}
function orderedRackList(){const out=[];state.rows.forEach(row=>{racksInRow(row.id).forEach(r=>out.push(r));});return out;}
function fitBayfaceHeight(m){
  const card=m.querySelector('.bayface-card')||m;
  const rack=m.querySelector('.bayface-rack');
  if(!card||!rack)return;
  const units=Number(rack.dataset.units)||0;
  if(!units)return;
  const cs=getComputedStyle(rack);
  const oldRowH=parseFloat(cs.getPropertyValue('--bayface-row-h'))||20;
  const overflow=card.scrollHeight-card.clientHeight;
  if(overflow>1){
    const newRowH=Math.max(12,oldRowH-Math.ceil(overflow/units));
    const scale=newRowH/oldRowH;
    rack.style.setProperty('--bayface-row-h',newRowH+'px');
    rack.style.setProperty('--bayface-grid-h',(newRowH*units)+'px');
    // Os chips de asset (.bayface-asset) são posicionados em px absolutos calculados
    // com o rowH original em chipFor() — precisam ser reescalados na mesma proporção
    // que a grade encolheu, senão ficam na posição/altura antiga (bug: asset aparece
    // deslocado e com o dobro da altura em racks altos o bastante pra estourar o modal).
    rack.querySelectorAll('.bayface-asset').forEach(chip=>{
      const top=parseFloat(chip.style.top)||0;
      const height=parseFloat(chip.style.height)||0;
      chip.style.top=(top*scale)+'px';
      chip.style.height=(height*scale)+'px';
      // Chip baixo demais pra duas linhas de texto: cai pro layout compacto (só o nome).
      if(height*scale<32)chip.classList.add('is-compact');
    });
  }
}
function openBayface(rackId){
  const r=assetRack(rackId);if(!r)return;
  const m=$('bayfaceModal');if(!m)return;
  m.style.zIndex='1100';
  // O título diz a face: trocar frente/traseira num rack sem equipamento não mudava nada na
  // tela, então o botão parecia não funcionar.
  $('bayfaceTitle').textContent=`Rack ${rackDisplayName(r)} · ${bayfaceFace==='rear'?'Traseira':'Frente'}`;
  $('bayfaceContent').innerHTML=bayfaceMarkup(rackId);
  m.dataset.rackId=rackId;
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  fitBayfaceHeight(m);
  m.querySelectorAll('[data-bay-edit]').forEach(b=>b.addEventListener('click',()=>openAssetModal(b.dataset.bayEdit)));
  m.querySelectorAll('[data-bay-add-u]').forEach(b=>b.addEventListener('click',()=>{if(b.disabled||b.classList.contains('occupied'))return;openBayfaceAssetPicker(rackId,Number(b.dataset.bayAddU));}));
  const nameInput=m.querySelector('#bayfaceRackNameInput');
  if(nameInput){
    const commitName=()=>{
      const v=nameInput.value.trim();
      if(v && v!==r.name){
        const target=state.racks.find(x=>x.name===v);
        if(target){openBayface(target.id);return;}
        toast('Rack não encontrado');
      }
      nameInput.value=r.name;
    };
    nameInput.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();nameInput.blur();}
      else if(e.key==='Escape'){nameInput.value=r.name;nameInput.blur();}
    });
    nameInput.addEventListener('blur',commitName);
  }
  const list=orderedRackList();
  const idx=list.findIndex(x=>x.id===rackId);
  const navPrev=m.querySelector('#bayfaceNavPrev');
  const navNext=m.querySelector('#bayfaceNavNext');
  if(navPrev){
    navPrev.disabled=list.length<=1;
    navPrev.addEventListener('click',()=>{if(!list.length)return;const i=idx<0?0:(idx-1+list.length)%list.length;openBayface(list[i].id);});
  }
  if(navNext){
    navNext.disabled=list.length<=1;
    navNext.addEventListener('click',()=>{if(!list.length)return;const i=idx<0?0:(idx+1)%list.length;openBayface(list[i].id);});
  }
}
function renderBayface(rackId){openBayface(rackId);}
function closeBayface(){closeBayfaceAssetPicker();const m=$('bayfaceModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

function openRackBayface(rackId){if(!assetRack(rackId))return;openBayface(rackId);}

function setPropTitleSticky(text){ const el=$('propTitleSticky'); if(el)el.textContent=text||''; }
// Cabeçalho da aba Propriedades: muda com o que está selecionado, para a
// pessoa saber de cara o que está editando (e não só o nome do item).
const PROP_HEAD_ICONS={
  default:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  cable:'<path d="M5 17c6 0 5-10 11-10"/><circle cx="18.5" cy="7" r="1.8"/><circle cx="5.5" cy="17" r="1.8"/>',
  rack:'<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M15 7.5h2M7 16.5h.01M15 16.5h2"/>',
  tray:'<path d="M3 9h18M3 15h18M6 9v6M18 9v6"/>',
  multi:'<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/>'
};
function setPropHead(kind,title,subtitle){
  const icon=$('propHeadIcon'),t=$('propHeadTitle'),s=$('propHeadSubtitle');
  if(icon)icon.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${PROP_HEAD_ICONS[kind]||PROP_HEAD_ICONS.default}</svg>`;
  if(t)t.textContent=title||'Propriedades';
  if(s)s.textContent=subtitle||'Selecione um rack, calha ou cabo.';
}
// Painel do rack: cada campo tem um rótulo com ícone e uma caixa própria.
const PROP_FIELD_ICONS={
  name:'<path d="M11.2 3H4v7.2l9.4 9.4a1.8 1.8 0 0 0 2.5 0l4.7-4.7a1.8 1.8 0 0 0 0-2.5L11.2 3Z"/><path d="M7.6 7.6h.01"/>',
  units:'<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><path d="M3 9.5h18M3 14.5h18"/>',
  width:'<path d="M15.8 2.6 21.4 8.2 8.2 21.4 2.6 15.8 15.8 2.6Z"/><path d="M7.3 11.5l1.8 1.8M10.4 8.4l1.8 1.8M13.5 5.3l1.8 1.8"/>',
  depth:'<path d="M12 3 20.2 7.4v9.2L12 21 3.8 16.6V7.4L12 3Z"/><path d="M3.8 7.4 12 11.8l8.2-4.4M12 11.8V21"/>',
  gap:'<path d="M5 6.5v11M19 6.5v11M7.5 12h9M10 9.4 7.5 12l2.5 2.6M14 9.4l2.5 2.6-2.5 2.6"/>',
  rise:'<path d="M12 3.6v16.8M8.8 6.8 12 3.6l3.2 3.2M8.8 17.2 12 20.4l3.2-3.2"/>',
  power:'<path d="M13.2 2.5 4.6 13.6h5.9l-.7 7.9 8.6-11.1h-5.9l.7-7.9Z"/>',
  weight:'<rect x="4.6" y="10.2" width="14.8" height="10.6" rx="2"/><path d="M8.4 10.2V7.6a3.6 3.6 0 0 1 7.2 0v2.6"/><path d="M12 14.4v2.4"/>',
  infinite:'<path d="M6.5 8.5C4.2 8.5 2.6 9.9 2.6 12c0 2.1 1.6 3.5 3.9 3.5 2.6 0 3.9-2 5.5-3.5 1.6-1.5 2.9-3.5 5.5-3.5 2.3 0 3.9 1.4 3.9 3.5 0 2.1-1.6 3.5-3.9 3.5-2.6 0-3.9-2-5.5-3.5C10.4 10.5 9.1 8.5 6.5 8.5Z"/>',
  info:'<circle cx="12" cy="12" r="9.2"/><path class="i" d="M12 11.2v5.3M12 7.6h.01"/>',
  type:'<rect x="3" y="4" width="18" height="6" rx="1.6"/><rect x="3" y="14" width="18" height="6" rx="1.6"/><path d="M7 7h.01M7 17h.01"/>',
  rack:'<rect x="3" y="4" width="18" height="7" rx="1.6"/><rect x="3" y="13" width="18" height="7" rx="1.6"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  u:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  face:'<rect x="5" y="3" width="14" height="18" rx="1.6"/><path d="M12 3v18M9 8h.01"/>',
  asset:'<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10.5h.01M7 13.5h.01M11 12h7"/>',
  port:'<rect x="3" y="8" width="18" height="8" rx="1.6"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
  percent:'<path d="M18.5 5.5 5.5 18.5"/><circle cx="8.5" cy="8.5" r="2.2"/><circle cx="15.5" cy="15.5" r="2.2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
  link:'<path d="M9.5 14.5 14.5 9.5M8 17H6.8a4.2 4.2 0 0 1 0-8.4H8M16 7h1.2a4.2 4.2 0 0 1 0 8.4H16"/>',
  arrowUp:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  sliders:'<path d="M4 8h9M19 8h1M4 16h3M13 16h7"/><circle cx="16" cy="8" r="2.2"/><circle cx="10" cy="16" r="2.2"/>',
  pencil:'<path d="M4 20h4.2L20 8.2 15.8 4 4 15.8V20Z"/><path d="M14.2 5.6 18.4 9.8"/>',
  project:'<path d="M4 21V5.5L12 3l8 2.5V21"/><path d="M9 21v-5h6v5"/>',
  rows:'<rect x="3" y="3.5" width="18" height="5" rx="1.2"/><rect x="3" y="9.5" width="18" height="5" rx="1.2"/><rect x="3" y="15.5" width="18" height="5" rx="1.2"/>',
  bayface:'<rect x="3" y="5" width="18" height="14" rx="1.8"/><path d="M3 9.6h18M3 14.4h18"/>',
  bayfaceFrame:'<rect x="4" y="4" width="16" height="16" rx="3.6"/>',
  chevronUp:'<path d="M6 14.5 12 8.5l6 6"/>',
  chevronDown:'<path d="M6 9.5 12 15.5l6-6"/>',
  grip:'<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  trash:'<path d="M4.5 7h15M9.5 7V4.8h5V7M6.6 7l.8 11.9a1.7 1.7 0 0 0 1.7 1.6h5.8a1.7 1.7 0 0 0 1.7-1.6L17.4 7"/><path d="M10.3 10.8v6M13.7 10.8v6"/>'
};
function propIcon(name,extra){
  return `<svg class="prop-ico ic-${name}${extra?' '+extra:''}" viewBox="0 0 24 24" aria-hidden="true">${PROP_FIELD_ICONS[name]||''}</svg>`;
}
// Coluna de setas própria: as setas nativas do input numérico não são
// estilizáveis e aparecem como um bloco claro sobre a caixa escura.
function propSpinButtons(){
  return `<span class="prop-spin"><button type="button" class="prop-spin-btn" data-step="up" tabindex="-1" aria-label="Aumentar">${propIcon('chevronUp')}</button><button type="button" class="prop-spin-btn" data-step="down" tabindex="-1" aria-label="Diminuir">${propIcon('chevronDown')}</button></span>`;
}
function bindPropPanel(root){
  // Campos numéricos ganham a coluna de setas própria. Os painéis gerados em
  // JS trazem a marcação de onde ela entra; o HTML estático (painel Ambiente)
  // recebe o mesmo tratamento aqui.
  root.querySelectorAll('.prop-field-box').forEach(box=>{
    const input=box.querySelector('input[type="number"]');
    if(!input||box.querySelector('.prop-spin'))return;
    box.classList.add('has-spin');
    box.insertAdjacentHTML('beforeend',propSpinButtons());
  });
  // O "∞" só faz sentido enquanto o campo está sem limite definido. Zero
  // também é "sem limite" no resto do app (powerCapacity > 0).
  root.querySelectorAll('.prop-field-box.has-trailing input').forEach(input=>{
    const box=input.closest('.prop-field-box');
    const sync=()=>{box.classList.toggle('is-filled',Math.max(0,num(input.value,0))>0);};
    input.addEventListener('input',sync);
    sync();
  });
  root.querySelectorAll('.prop-spin-btn').forEach(btn=>{
    btn.onclick=()=>{
      const box=btn.closest('.prop-field-box');
      const input=box&&box.querySelector('input');
      if(!input||input.disabled)return;
      const before=input.value;
      let fired=false;
      const mark=()=>{fired=true;};
      input.addEventListener('change',mark,{once:true});
      try{ if(btn.dataset.step==='up')input.stepUp(); else input.stepDown(); }
      catch(err){ input.removeEventListener('change',mark); return; }
      input.removeEventListener('change',mark);
      // stepUp/stepDown já disparam "change" no Chromium; garante o commit
      // caso o navegador não dispare.
      if(!fired&&input.value!==before)input.dispatchEvent(new Event('change'));
    };
  });
}
// Preenche os ícones declarados no HTML estático (painel Ambiente): o markup
// carrega só data-prop-icon / data-prop-trailing, o desenho vem do mesmo
// conjunto usado pelos painéis de rack e cabo.
function hydratePropFields(root){
  root.querySelectorAll('[data-prop-icon]').forEach(el=>{
    if(el.querySelector('.prop-ico'))return;
    el.insertAdjacentHTML('afterbegin',propIcon(el.dataset.propIcon));
  });
  root.querySelectorAll('[data-prop-trailing]').forEach(el=>{
    if(el.querySelector('.prop-ico'))return;
    el.innerHTML=propIcon(el.dataset.propTrailing,'prop-field-trailing');
  });
}
function setupPropCards(root){
  hydratePropFields(root);
  bindPropPanel(root);
}
function renderProperties(){
  const p=$('properties');
  // A seção rola, e o painel é reconstruído inteiro a cada troca de seleção. O painel do cabo
  // monta em pedaços e força layout no meio (ao medir campos), e aí o navegador já corta a
  // rolagem para o que couber no pedaço — com o painel no fim, ela voltava ~300px. Guardar e
  // devolver no fim do render mantém a posição.
  const sec=p?p.closest('section'):null;
  const rolagem=sec?sec.scrollTop:0;
  try{ renderPropertiesBody(); }
  finally{ if(sec)sec.scrollTop=rolagem; }
}
function renderPropertiesBody(){
  const p=$('properties');
  // Troca de alvo (rack → cabo, nada → rack) merece um fade curto pra marcar
  // que o painel mudou de assunto. Só na troca: o painel é reconstruído a cada
  // alteração, e animar sempre faria a tela piscar enquanto se digita.
  const propKey=state.selected?`${state.selected.type}:${state.selected.id}`:(state.trayMultiSelected.length>1?`trays:${state.trayMultiSelected.length}`:(state.multiSelected.length>1?`racks:${state.multiSelected.length}`:(state.racks.length?'room':'empty')));
  if(p.dataset.propKey!==undefined&&p.dataset.propKey!==propKey){
    p.classList.remove('is-swapping');
    void p.offsetWidth;
    p.classList.add('is-swapping');
  }
  p.dataset.propKey=propKey;
  if(state.trayMultiSelected.length>1){
    const count=state.trayMultiSelected.length;
    setPropTitleSticky(`${count} calhas`);
    setPropHead('tray',`${count} calhas selecionadas`,'Somente exclusão em lote.');
    p.innerHTML=`<div class="prop-card">
      <div class="help">Várias calhas selecionadas. Para evitar alterações acidentais na geometria e nas conexões, somente a exclusão em lote está disponível.</div>
      <button class="btn danger full" id="delSelectedTrays">${propIcon('trash')}Excluir ${count} calhas selecionadas</button>
      <button class="btn ghost full" id="clearSelectedTrays">${uiIcon('close','prop-ico ic-close')}Limpar seleção</button>
    </div>`;
    $('delSelectedTrays').onclick=deleteSelectedTrays;
    $('clearSelectedTrays').onclick=()=>{state.trayMultiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(state.multiSelected.length>1){
    const count=state.multiSelected.length;
    // A pílula é a etiqueta curta da seleção, como o nome do rack no painel de um só: o
    // texto longo já está no título.
    setPropTitleSticky(`${count} racks`);
    setPropHead('multi',`${count} racks selecionados`,'Alterações aplicadas a todos os selecionados.');
    p.innerHTML=`<div class="prop-card">
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. As propriedades dos racks estão somente para consulta.</div>':''}
      <div class="grid2">
        <label class="prop-field"><span class="prop-field-label">${propIcon('units')}<span class="prop-field-text">Qtd. U</span></span><span class="prop-field-box"><input id="bulkUnits" type="number" min="1" max="60" placeholder="Não alterar"></span></label>
        <label class="prop-field"><span class="prop-field-label">${propIcon('width')}<span class="prop-field-text">Largura (m)</span></span><span class="prop-field-box"><input id="bulkWidth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></span></label>
      </div>
      <div class="grid2">
        <label class="prop-field"><span class="prop-field-label">${propIcon('depth')}<span class="prop-field-text">Profund. (m)</span></span><span class="prop-field-box"><input id="bulkDepth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></span></label>
        <label class="prop-field"><span class="prop-field-label">${propIcon('gap')}<span class="prop-field-text">Dist. próx. (m)</span></span><span class="prop-field-box"><input id="bulkGap" type="number" min="0" step="0.01" placeholder="Não alterar"></span></label>
      </div>
      <label class="prop-field"><span class="prop-field-label">${propIcon('rise')}<span class="prop-field-text">Última U → calha (m)</span></span><span class="prop-field-box"><input id="bulkRise" type="number" min="0" step="0.01" placeholder="Não alterar"></span></label>
      <div class="prop-card-sub">
        <span class="prop-field-label">${propIcon('power')}<span class="prop-field-text">Cap. elétrica (W) <span class="prop-field-opt">(opcional)</span></span></span>
        <span class="prop-field-box"><input id="bulkPowerCapacity" type="number" min="0" step="1" placeholder="Não alterar" aria-label="Capacidade elétrica (W)"></span>
      </div>
      <div class="prop-card-sub">
        <span class="prop-field-label">${propIcon('weight')}<span class="prop-field-text">Carga do piso (kg) <span class="prop-field-opt">(opcional)</span></span></span>
        <span class="prop-field-box"><input id="bulkWeightCapacity" type="number" min="0" step="1" placeholder="Não alterar" aria-label="Capacidade de carga do piso (kg)"></span>
      </div>
      <button class="btn primary full" id="applyBulkRack">${uiIcon('check','prop-ico ic-check')}Aplicar propriedades</button>
      <button class="btn danger full" id="delSelectedRacks">${propIcon('trash')}Excluir ${count} racks selecionados</button>
      <button class="btn ghost full" id="clearSelectedRacks">${uiIcon('close','prop-ico ic-close')}Limpar seleção</button>
      <div class="prop-footnote">${propIcon('info')}Campo vazio não altera nada. Largura e profundidade mantêm cada rack centrado.</div>
    </div>`;
    bindPropPanel(p);
    $('applyBulkRack').onclick=()=>{if(structureBlocked())return;
      const ids=new Set(state.multiSelected);
      const unitsVal=$('bulkUnits').value.trim(), widthVal=$('bulkWidth').value.trim(), depthVal=$('bulkDepth').value.trim(), gapVal=$('bulkGap').value.trim(), riseVal=$('bulkRise').value.trim(), powerCapVal=$('bulkPowerCapacity').value.trim(), weightCapVal=$('bulkWeightCapacity').value.trim();
      if(!unitsVal&&!widthVal&&!depthVal&&!gapVal&&!riseVal&&!powerCapVal&&!weightCapVal){toast('Informe pelo menos uma propriedade');return;}
      if(unitsVal){const next=Math.max(1,Math.min(60,Math.floor(num(unitsVal,0))));const blocked=state.racks.filter(r=>ids.has(r.id)&&highestOccupiedU(state.assets,r.id)>next);if(blocked.length){toast(`${blocked.length===1?'O rack '+blocked[0].name+' tem':blocked.length+' racks têm'} equipamento acima da U${next}. Ajuste os assets antes de reduzir a altura.`);return;}}
      state.racks.filter(r=>ids.has(r.id)).forEach(r=>{
        if(unitsVal){r.units=Math.max(1,Math.min(60,Math.floor(num(unitsVal,r.units))));}
        if(widthVal){const old=Math.max(.1,num(r.width,state.rackWidth)),next=Math.max(.1,num(widthVal,state.rackWidth));r.offset=num(r.offset,0)+(old-next)/2;r.width=next;}
        if(depthVal){const old=Math.max(.1,num(r.depth,state.rackDepth)),next=Math.max(.1,num(depthVal,state.rackDepth));r.yOffset=num(r.yOffset,0)+(old-next)/2;r.depth=next;}
        if(gapVal){r.gapAfter=Math.max(0,num(gapVal,r.gapAfter??state.rackGap));}
        if(riseVal){r.riseToTray=Math.max(0,num(riseVal,r.riseToTray??state.lastUToTray));}
        if(powerCapVal){r.powerCapacityW=Math.max(0,num(powerCapVal,0));}
        if(weightCapVal){r.weightCapacityKg=Math.max(0,num(weightCapVal,0));}
      });
      refreshVisuals();renderProperties();toast(`${count} racks atualizados`);
    };
    $('delSelectedRacks').onclick=()=>{if(!structureBlocked())deleteSelectedRacks();};
    $('clearSelectedRacks').onclick=()=>{state.multiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(!state.selected){
    if(state.racks.length){renderRoomSummary(p);return;}
    setPropHead('default','Propriedades','Selecione um rack, calha ou cabo.');
    setPropTitleSticky('');p.innerHTML='<div class="empty">Selecione um rack, calha ou cabo.</div>';return;
  }
  if(state.selected.type==='rack'){
    const r=state.racks.find(x=>x.id===state.selected.id); if(!r){state.selected=null;return renderProperties();}
    const row=rowForRack(r);
    const rackPowerW=state.assets.filter(a=>a.rackId===r.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
    const powerCapacity=num(r.powerCapacityW,0);
    const powerPct=powerCapacity>0?Math.round(rackPowerW/powerCapacity*100):null;
    const powerLevel=powerCapacity<=0?'none':(rackPowerW>powerCapacity?'high':powerPct>=80?'mid':'low');
    const rackWeightKg=state.assets.filter(a=>a.rackId===r.id).reduce((sum,a)=>sum+Math.max(0,num(a.weightKg,0)),0);
    const weightCapacity=num(r.weightCapacityKg,0);
    const weightPct=weightCapacity>0?Math.round(rackWeightKg/weightCapacity*100):null;
    const weightLevel=weightCapacity<=0?'none':(rackWeightKg>weightCapacity?'high':weightPct>=80?'mid':'low');
    setPropTitleSticky(r.name);
    setPropHead('rack','Propriedades do rack','Configure nome, medidas e capacidade.');
    p.innerHTML=`<div class="prop-card">
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar este rack.</div>':''}
      <label class="prop-field"><span class="prop-field-label">${propIcon('name')}<span class="prop-field-text">Nome</span></span><span class="prop-field-box"><input id="prName" value="${esc(r.name)}"></span></label>
      <div class="grid2">
        <label class="prop-field"><span class="prop-field-label">${propIcon('units')}<span class="prop-field-text">Qtd. U</span></span><span class="prop-field-box has-spin"><input id="prUnits" type="number" min="1" max="60" value="${r.units}"></span></label>
        <label class="prop-field"><span class="prop-field-label">${propIcon('width')}<span class="prop-field-text">Largura (m)</span></span><span class="prop-field-box has-spin"><input id="prWidth" type="number" min="0.1" step="0.01" value="${r.width}"></span></label>
      </div>
      <div class="grid2">
        <label class="prop-field"><span class="prop-field-label">${propIcon('depth')}<span class="prop-field-text">Profund. (m)</span></span><span class="prop-field-box has-spin"><input id="prDepth" type="number" min="0.1" step="0.01" value="${r.depth??state.rackDepth}"></span></label>
        <label class="prop-field"><span class="prop-field-label">${propIcon('gap')}<span class="prop-field-text">Dist. próx. (m)</span></span><span class="prop-field-box has-spin"><input id="prGapAfter" type="number" min="0" step="0.01" value="${r.gapAfter??state.rackGap}"></span></label>
      </div>
      <label class="prop-field"><span class="prop-field-label">${propIcon('rise')}<span class="prop-field-text">Última U → calha (m)</span></span><span class="prop-field-box has-spin"><input id="prRiseToTray" type="number" min="0" step="0.01" value="${num(r.riseToTray,state.lastUToTray).toFixed(2)}"></span></label>
      <div class="prop-card-sub">
        <span class="prop-field-label">${propIcon('power')}<span class="prop-field-text">Cap. elétrica (W) <span class="prop-field-opt">(opcional)</span></span></span>
        <span class="prop-field-box has-trailing has-spin">${propIcon('infinite','prop-field-trailing')}<input id="prPowerCapacity" type="number" min="0" step="1" placeholder="Sem limite definido" aria-label="Capacidade elétrica (W) (opcional)" value="${powerCapacity>0?powerCapacity:''}"></span>
        <div class="prop-readout rack-power-readout power-${powerLevel}">${propIcon('info','prop-readout-icon')}<span>Consumo estimado: <b>${rackPowerW} W</b>${powerCapacity>0?` de ${powerCapacity} W (${powerPct}%)`:''}</span></div>
      </div>
      <div class="prop-card-sub">
        <span class="prop-field-label">${propIcon('weight')}<span class="prop-field-text">Carga do piso (kg) <span class="prop-field-opt">(opcional)</span></span></span>
        <span class="prop-field-box has-trailing has-spin">${propIcon('infinite','prop-field-trailing')}<input id="prWeightCapacity" type="number" min="0" step="1" placeholder="Sem limite definido" aria-label="Capacidade de carga do piso (kg) (opcional)" value="${weightCapacity>0?weightCapacity:''}"></span>
        <div class="prop-readout rack-power-readout power-${weightLevel}">${propIcon('info','prop-readout-icon')}<span>Peso estimado: <b>${rackWeightKg} kg</b>${weightCapacity>0?` de ${weightCapacity} kg (${weightPct}%)`:''}</span></div>
      </div>
      <button class="btn ghost full" id="openBayface">${propIcon('bayface')}${propIcon('bayfaceFrame')}Ver Bayface</button>
      <button class="btn danger full" id="delRack">${propIcon('trash')}Excluir rack</button>
      <div class="prop-footnote">${propIcon('info')}Alterações salvas automaticamente.</div>
    </div>`;
    bindPropPanel(p);
    if($('prName'))$('prName').onchange=()=>{if(structureBlocked())return;r.name=$('prName').value.trim();refreshVisuals();renderProperties();};
    if($('prUnits'))$('prUnits').onchange=()=>{if(structureBlocked())return;const next=Math.max(1,Math.min(60,Math.floor(num($('prUnits').value,state.rackUnits))));const top=highestOccupiedU(state.assets,r.id);if(next<top){toast(`Há equipamento até a U${top}. Mova-o ou remova-o antes de reduzir o rack para ${next}U.`);renderProperties();return;}r.units=next;refreshVisuals();renderProperties();};
    if($('prWidth'))$('prWidth').onchange=()=>{if(structureBlocked())return;
      const oldWidth=Math.max(.1,num(r.width,state.rackWidth));
      const nextWidth=Math.max(.1,num($('prWidth').value,state.rackWidth));
      // Keep the rack centered while changing its width. The offset is the
      // horizontal correction applied after the slot position is calculated.
      r.offset=num(r.offset,0)+(oldWidth-nextWidth)/2;
      r.width=nextWidth;
      refreshVisuals();renderProperties();
    };
    if($('prDepth'))$('prDepth').onchange=()=>{if(structureBlocked())return;
      const oldDepth=Math.max(.1,num(r.depth,state.rackDepth));
      const nextDepth=Math.max(.1,num($('prDepth').value,state.rackDepth));
      // Keep the rack centered vertically while changing its depth.
      r.yOffset=num(r.yOffset,0)+(oldDepth-nextDepth)/2;
      r.depth=nextDepth;
      refreshVisuals();renderProperties();
    };
    if($('prGapAfter'))$('prGapAfter').onchange=()=>{if(structureBlocked())return;r.gapAfter=Math.max(0,num($('prGapAfter').value,state.rackGap));refreshVisuals();renderProperties();};
    if($('prRiseToTray'))$('prRiseToTray').onchange=()=>{if(structureBlocked())return;r.riseToTray=Math.max(0,num($('prRiseToTray').value,state.lastUToTray));refreshVisuals();renderProperties();};
    if($('prPowerCapacity'))$('prPowerCapacity').onchange=()=>{r.powerCapacityW=Math.max(0,num($('prPowerCapacity').value,0));refreshVisuals();renderProperties();};
    if($('prWeightCapacity'))$('prWeightCapacity').onchange=()=>{r.weightCapacityKg=Math.max(0,num($('prWeightCapacity').value,0));refreshVisuals();renderProperties();};
    if($('openBayface'))$('openBayface').onclick=()=>openRackBayface(r.id);
    if($('delRack'))$('delRack').onclick=async()=>{if(structureBlocked())return;
      const ok=await uiConfirm('',{title:`Excluir o rack ${r.name||''}?`,confirmText:'Excluir rack',danger:true});
      if(!ok)return;
      const parentRow=rowForRack(r);
      removeRackReferences([r.id]);
      state.assets.forEach(a=>{if(a.rackId===r.id){a.rackId=null;}});
      state.racks=state.racks.filter(x=>x.id!==r.id);
      // The row property must reflect the number of racks that actually
      // remain.  Do not use r.index+1 here because physical slot indexes may
      // contain gaps after a rack is deleted.
      if(parentRow) parentRow.rackCount=racksInRow(parentRow.id).length;
      state.selected=null;
      state.multiSelected=[];
      normalizeState();renderAll();toast('Rack excluído');
    };
    return;
  }
  if(state.selected.type==='tray'){
    const t=state.trays.find(x=>x.id===state.selected.id); if(!t){state.selected=null;return renderProperties();}
    const g=geometry();
    const currentLength=trayLengthMeters(t,g);
    setPropTitleSticky(t.name||'Calha');
    setPropHead('tray','Propriedades da calha','Configure nome, altura e conexões.');
    p.innerHTML=`${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar esta calha.</div>':''}
      <label>Nome<input id="trName" value="${esc(t.name||'Calha')}"></label>
      <label>Comprimento da calha (m)<input id="trLength" type="number" min="0.01" step="0.01" value="${currentLength.toFixed(2)}"></label>
      <div class="help">Calha independente: não está vinculada a nenhuma fileira ou rack. Pode existir sozinha em qualquer área do ambiente.</div>
      <div class="result"><div class="metric"><span>Comprimento atual</span><b>${currentLength.toFixed(2)} m</b></div></div>
      <button class="btn danger full" id="delTray">Excluir calha</button>`;
    $('trName').onchange=e=>{if(structureBlocked())return;t.name=e.target.value.trim()||'Calha';save();renderAll();};
    $('trLength').onchange=e=>{if(structureBlocked())return;
      const target=Math.max(0.01,num(e.target.value,currentLength));
      const dx=num(t.x2)-num(t.x1),dy=num(t.y2)-num(t.y1),px=Math.hypot(dx,dy);
      if(px<1e-6){t.x2=num(t.x1)+target*Math.max(1,g.scale);t.y2=num(t.y1);}
      else {
        const targetPx=target*Math.max(1,g.scale);
        t.x2=num(t.x1)+(dx/px)*targetPx;
        t.y2=num(t.y1)+(dy/px)*targetPx;
      }
      connectCrossingsForTray(t.id);save();renderAll();
    };
    $('delTray').onclick=()=>{if(structureBlocked())return;state.trays=state.trays.filter(x=>x.id!==t.id);state.selected=null;save();renderAll();toast('Calha removida');};
    return;
  }
  if(state.selected.type==='breakout')renderBreakoutProperties(p,state.breakouts.find(x=>x.id===state.selected.id));
  if(state.selected.type==='cable')renderCableProperties(p,state.cables.find(x=>x.id===state.selected.id));
}

function cableUnitValidation(c){
  const o=state.racks.find(r=>r.id===c.originRack);
  const d=state.racks.find(r=>r.id===c.destRack);
  const ou=Math.floor(num(c.originU,0));
  const du=Math.floor(num(c.destU,0));
  const errors=[];
  if(!o) errors.push('Rack de origem não encontrado.');
  else if(ou<1 || ou>Math.max(1,Math.floor(num(o.units,state.rackUnits)))) errors.push(`U origem inválida: ${o.name} possui ${Math.floor(num(o.units,state.rackUnits))}U.`);
  if(!d) errors.push('Rack de destino não encontrado.');
  else if(du<1 || du>Math.max(1,Math.floor(num(d.units,state.rackUnits)))) errors.push(`U destino inválida: ${d.name} possui ${Math.floor(num(d.units,state.rackUnits))}U.`);
  return {valid:errors.length===0,errors,origin:o,dest:d};
}
function refreshCableValidation(c){
  const v=cableUnitValidation(c);
  const ou=$('cbOU'), du=$('cbDU'), oe=$('cbOUError'), de=$('cbDUError'), save=$('saveCable');
  if(ou && v.origin){ou.max=Math.floor(num(v.origin.units,state.rackUnits));ou.classList.toggle('input-error',Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ou.max);}
  if(du && v.dest){du.max=Math.floor(num(v.dest.units,state.rackUnits));du.classList.toggle('input-error',Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>du.max);}
  if(oe)oe.textContent=v.origin && (Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>Math.floor(num(v.origin.units,state.rackUnits)))?`Máximo: ${Math.floor(num(v.origin.units,state.rackUnits))}U.`:'';
  if(de)de.textContent=v.dest && (Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>Math.floor(num(v.dest.units,state.rackUnits)))?`Máximo: ${Math.floor(num(v.dest.units,state.rackUnits))}U.`:'';
  return v;
}
// Atualiza só o campo de nome de asset (origem ou destino) ao vivo, enquanto
// a U ainda está sendo digitada — sem reconstruir o painel inteiro, que
// derrubaria o foco do campo de U no meio da digitação.
function updateCableAssetNameField(c,side){
  const rackId=side==='origin'?c.originRack:c.destRack;
  const u=Math.floor(num(side==='origin'?c.originU:c.destU,0));
  const face=(side==='origin'?c.originFace:c.destFace)==='rear'?'rear':'front';
  const rack=state.racks.find(r=>r.id===rackId);
  const uInvalid=!rack||u<1||u>Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  const portId=side==='origin'?c.originPortId:c.destPortId;
  const asset=uInvalid?null:(assetOwningPort(state.assets,portId)||assetAtRackU(state.assets,rackId,u,face));
  const field=$(side==='origin'?'cbOAssetName':'cbDAssetName'); if(!field)return;
  const hint=field.closest('label')?.querySelector('.field-help-inline');
  if(asset){
    if(side==='origin')c.originAssetName=asset.name; else c.destAssetName=asset.name;
    field.value=asset.name; field.disabled=true;
    if(hint)hint.textContent='(automático)';
    field.title='Preenchido automaticamente pelo asset instalado nessa U.';
  }else{
    // Sem asset nessa U: NÃO apaga o que já está guardado no cabo — pode ser
    // uma referência que o usuário digitou pra uma posição sem asset formal.
    // Só garante que o campo fique editável e mostre o valor atual salvo.
    field.value=side==='origin'?(c.originAssetName||''):(c.destAssetName||'');
    field.disabled=false;
    if(hint)hint.textContent='(opcional)';
    field.title='Nem todo asset precisa estar cadastrado ainda — este campo aceita texto livre.';
  }
}

function renderCableProperties(p,c){
  if(!c){p.innerHTML='<div class="empty">Cabo não encontrado.</div>';return;}
  const rackLabel=r=>rackDisplayName(r);
  // O rótulo do rack vive numa coluna estreita: a fileira entra na frente (A-101), porque é
  // ela que diz onde o rack está; a contagem de U fica no title.
  const optLabel=r=>rackDisplayName(r);
  const opts=state.racks.slice().sort((a,b)=>rackLabel(a).localeCompare(rackLabel(b),'pt-BR')).map(r=>`<option value="${r.id}" title="${esc(rackLabel(r))} — ${Math.floor(num(r.units,state.rackUnits))}U">${esc(optLabel(r))}</option>`).join('');
  const v=cableUnitValidation(c);
  const o=v.origin,d=v.dest;
  const ouMax=o?Math.floor(num(o.units,state.rackUnits)):1, duMax=d?Math.floor(num(d.units,state.rackUnits)):1;
  const ouInvalid=!o||Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ouMax;
  const duInvalid=!d||Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>duMax;
  const originFace=c.originFace==='rear'?'rear':'front', destFace=c.destFace==='rear'?'rear':'front';
  // Seletor de face sempre visível — mesmo numa U totalmente livre, a
  // traseira é uma posição válida pra um futuro asset, então precisa dar
  // pra escolher o lado antes de existir qualquer coisa cadastrada ali.
  const originUForFace=Math.floor(num(c.originU,0)), destUForFace=Math.floor(num(c.destU,0));
  const originAsset=ouInvalid?null:(assetOwningPort(state.assets,c.originPortId)||assetAtRackU(state.assets,c.originRack,originUForFace,originFace));
  const destAsset=duInvalid?null:(assetOwningPort(state.assets,c.destPortId)||assetAtRackU(state.assets,c.destRack,destUForFace,destFace));
  // Enquanto a U tiver um asset instalado, o nome vem sempre desse asset — o
  // campo fica travado (evita alguém digitar um nome diferente do que está
  // de fato ali). Sem asset na U, o campo é texto livre, pra cobrir listas de
  // cabos cadastradas antes de todos os assets existirem.
  if(originAsset) c.originAssetName=originAsset.name;
  if(destAsset) c.destAssetName=destAsset.name;
  const portOptions=(asset,selected)=>'<option value="">— Nenhuma —</option>'+(asset?.ports||[]).map(port=>`<option value="${esc(port.id)}" ${port.id===selected?'selected':''}>${esc(port.label)}</option>`).join('');
  const originConflict=c.originPortId?cablePortConflict(c,'origin',c.originPortId):null;
  const destConflict=c.destPortId?cablePortConflict(c,'dest',c.destPortId):null;
  setPropTitleSticky(c.name);
  setPropHead('cable','Propriedades do cabo','Configure origem, destino e tipo.');
  const caret='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  // Mesma linguagem visual do painel do rack: um cartão, cada campo com
  // rótulo de ícone e caixa própria, e origem/destino/extras/roteamento como
  // sub-cartões recolhíveis.
  const fieldLabel=(icon,label,req)=>`<span class="prop-field-label">${propIcon(icon)}<span class="prop-field-text">${label}${req?' <i class="req">*</i>':''}</span></span>`;
  const subHead=(icon,label)=>`<header class="prop-sub-head">${fieldLabel(icon,label)}<button type="button" class="panel-step-toggle" aria-expanded="true" aria-label="Recolher ${label}">${caret}</button></header>`;
  p.innerHTML=`<div class="prop-card cable-panel">
  <div class="grid2">
    <label class="prop-field">${fieldLabel('name','Nome',true)}<span class="prop-field-box"><input id="cbName" value="${esc(c.name)}"></span></label>
    <label class="prop-field">${fieldLabel('type','Tipo',true)}<span class="prop-field-box"><select id="cbType">${cableTypeNames().map(t=>`<option value="${esc(t)}" ${c.type===t?'selected':''}>${esc(t)}</option>`).join('')}<optgroup label="Breakout (MTP)">${(state.cableCatalogs.breakoutTypes||[]).map(t=>`<option value="bo:${esc(t.name)}">${esc(t.name)} · ${t.legs} pernas</option>`).join('')||'<option disabled>Cadastre um tipo de breakout em Cadastros</option>'}</optgroup></select></span></label>
  </div>
  <div class="prop-card-sub" data-panel-step="origem">
    ${subHead('arrowUp','Origem')}
    <div class="prop-sub-body">
      <div class="${ouInvalid?'grid2':'prop-grid-3'}">
        <label class="prop-field">${fieldLabel('rack','Rack',true)}<span class="prop-field-box"><select id="cbOR">${opts}</select></span></label>
        <label class="prop-field prop-field-u">${fieldLabel('u','U',true)}<span class="prop-field-box has-spin ${ouInvalid?'input-error':''}"><input id="cbOU" type="number" min="1" max="${ouMax}" value="${c.originU}"></span><small id="cbOUError" class="field-error">${ouInvalid?`Máximo: ${ouMax}U.`:''}</small></label>
        ${!ouInvalid?`<label class="prop-field">${fieldLabel('face','Face',true)}<span class="prop-field-box"><select id="cbOFace"><option value="front" ${originFace==='front'?'selected':''}>Frente</option><option value="rear" ${originFace==='rear'?'selected':''}>Traseira</option></select></span></label>`:''}
      </div>
      ${!ouInvalid?`<div class="grid2">
        <label class="prop-field">${fieldLabel('asset','Asset')}<span class="prop-field-box"><input id="cbOAssetName" value="${esc(originAsset?originAsset.name:(c.originAssetName||''))}" placeholder="Nome do equipamento" ${originAsset?'disabled':''}></span><small class="field-help-inline">${originAsset?'(automático)':'(opcional)'}</small></label>
        ${originAsset?.ports?.length?`<label class="prop-field">${fieldLabel('port','Porta')}<span class="prop-field-box"><select id="cbOPort">${portOptions(originAsset,c.originPortId)}</select></span><small class="field-help-inline">(${esc(originAsset.name)})</small></label>`:`<label class="prop-field">${fieldLabel('port','Porta')}<span class="prop-field-box"><input id="cbOPortFree" value="${esc(c.originPortLabel||'')}" placeholder="Porta"></span><small class="field-help-inline">${originAsset?'(sem portas cadastradas)':'(opcional)'}</small></label>`}
      </div>`:''}
      ${originConflict?`<div class="field-error">Porta já usada pelo cabo "${esc(originConflict.name)}".</div>`:''}
    </div>
  </div>
  <div class="prop-card-sub" data-panel-step="destino">
    ${subHead('arrowDown','Destino')}
    <div class="prop-sub-body">
      <div class="${duInvalid?'grid2':'prop-grid-3'}">
        <label class="prop-field">${fieldLabel('rack','Rack',true)}<span class="prop-field-box"><select id="cbDR">${opts}</select></span></label>
        <label class="prop-field prop-field-u">${fieldLabel('u','U',true)}<span class="prop-field-box has-spin ${duInvalid?'input-error':''}"><input id="cbDU" type="number" min="1" max="${duMax}" value="${c.destU}"></span><small id="cbDUError" class="field-error">${duInvalid?`Máximo: ${duMax}U.`:''}</small></label>
        ${!duInvalid?`<label class="prop-field">${fieldLabel('face','Face',true)}<span class="prop-field-box"><select id="cbDFace"><option value="front" ${destFace==='front'?'selected':''}>Frente</option><option value="rear" ${destFace==='rear'?'selected':''}>Traseira</option></select></span></label>`:''}
      </div>
      ${!duInvalid?`<div class="grid2">
        <label class="prop-field">${fieldLabel('asset','Asset')}<span class="prop-field-box"><input id="cbDAssetName" value="${esc(destAsset?destAsset.name:(c.destAssetName||''))}" placeholder="Equipamento" ${destAsset?'disabled':''}></span><small class="field-help-inline">${destAsset?'(automático)':'(opcional)'}</small></label>
        ${destAsset?.ports?.length?`<label class="prop-field">${fieldLabel('port','Porta')}<span class="prop-field-box"><select id="cbDPort">${portOptions(destAsset,c.destPortId)}</select></span><small class="field-help-inline">(${esc(destAsset.name)})</small></label>`:`<label class="prop-field">${fieldLabel('port','Porta')}<span class="prop-field-box"><input id="cbDPortFree" value="${esc(c.destPortLabel||'')}" placeholder="Porta"></span><small class="field-help-inline">${destAsset?'(sem portas cadastradas)':'(opcional)'}</small></label>`}
      </div>`:''}
      ${destConflict?`<div class="field-error">Porta já usada pelo cabo "${esc(destConflict.name)}".</div>`:''}
    </div>
  </div>
  <div class="prop-card-sub" data-panel-step="extras">
    ${subHead('sliders','Extras')}
    <div class="prop-sub-body">
      <label class="prop-field">${fieldLabel('percent','Folga (%)')}<span class="prop-field-box has-spin"><input id="cbSlack" type="number" min="0" step="1" value="${c.slack??state.defaultSlack}"></span></label>
      <div class="prop-readout">${propIcon('info','prop-readout-icon')}<span>A folga compensa curvas e conexões.</span></div>
    </div>
  </div>
  ${!v.valid?`<div class="validation-error">${uiIcon('warn')} ${v.errors.map(esc).join('<br>')}</div>`:''}
  <div class="cable-metrics" id="cableResult"></div>
  <div class="prop-card-sub" data-panel-step="rota">
    ${subHead('link','Roteamento')}
    <div class="prop-sub-body">
      <p class="prop-hint">Automática: o sistema encontra o caminho pelas calhas. Manual: escolha os racks intermediários e o sistema valida cada trecho.</p>
      <label class="prop-field">${fieldLabel('gear','Modo')}<span class="prop-field-box"><select id="routeMode"><option value="automatic" ${(c.routeMode||'automatic')==='automatic'?'selected':''}>Automática</option><option value="manual" ${c.routeMode==='manual'?'selected':''}>Manual</option></select></span></label>
      <div id="manualRoutePanel" class="manual-route-panel ${c.routeMode==='manual'?'':'hidden'}">
        <div class="manual-route-status" id="manualRouteStatus"></div>
        <button class="btn primary full" id="pickRouteRack" type="button">Adicionar rack à rota</button>
        <div id="manualRouteList"></div>
        <button class="btn ghost full" id="clearManualRoute" type="button" ${c.via?.length?'':'disabled'}>Limpar rota manual</button>
      </div>
    </div>
  </div>
  <button class="btn danger full" id="delCable" type="button">${propIcon('trash')}Excluir cabo</button>
  <div class="prop-footnote">${propIcon('info')}Alterações salvas automaticamente.</div>
  </div>`;
  $('cbOR').value=c.originRack;$('cbDR').value=c.destRack;
  const sync=()=>{refreshVisuals();renderProperties();};
  $('cbType').onchange=()=>{const v=$('cbType').value;if(v.startsWith('bo:')){cableToBreakout(c,v.slice(3));return;}c.type=v;sync();};
  $('cbOR').onchange=()=>{c.originRack=$('cbOR').value;c.originFace='front';c.originPortId=null;c.originPortLabel='';c.originAssetName='';sync();};
  $('cbDR').onchange=()=>{c.destRack=$('cbDR').value;c.destFace='front';c.destPortId=null;c.destPortLabel='';c.destAssetName='';sync();};
  $('cbOU').oninput=()=>{c.originU=Math.floor(num($('cbOU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();updateCableAssetNameField(c,'origin');};
  $('cbDU').oninput=()=>{c.destU=Math.floor(num($('cbDU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();updateCableAssetNameField(c,'dest');};
  $('cbOU').onchange=()=>{c.originPortId=null;c.originPortLabel='';c.originAssetName='';save();renderProperties();};
  $('cbDU').onchange=()=>{c.destPortId=null;c.destPortLabel='';c.destAssetName='';save();renderProperties();};
  $('cbOFace')&&($('cbOFace').onchange=()=>{c.originFace=$('cbOFace').value==='rear'?'rear':'front';c.originPortId=null;c.originPortLabel='';c.originAssetName='';save();renderProperties();});
  $('cbDFace')&&($('cbDFace').onchange=()=>{c.destFace=$('cbDFace').value==='rear'?'rear':'front';c.destPortId=null;c.destPortLabel='';c.destAssetName='';save();renderProperties();});
  $('cbOPort')&&($('cbOPort').onchange=()=>{c.originPortId=$('cbOPort').value||null;save();renderProperties();});
  $('cbDPort')&&($('cbDPort').onchange=()=>{c.destPortId=$('cbDPort').value||null;save();renderProperties();});
  $('cbOPortFree')&&($('cbOPortFree').onchange=()=>{c.originPortLabel=$('cbOPortFree').value.trim();save();renderProperties();});
  $('cbDPortFree')&&($('cbDPortFree').onchange=()=>{c.destPortLabel=$('cbDPortFree').value.trim();save();renderProperties();});
  $('cbOAssetName')&&($('cbOAssetName').onchange=()=>{c.originAssetName=$('cbOAssetName').value.trim();save();renderProperties();});
  $('cbDAssetName')&&($('cbDAssetName').onchange=()=>{c.destAssetName=$('cbDAssetName').value.trim();save();renderProperties();});
  $('routeMode').onchange=()=>{c.routeMode=$('routeMode').value; if(c.routeMode==='automatic'){c.via=[];window.__manualRoutePicking=false;} refreshVisuals();renderProperties();};
  bindManualRouteControls(c);
  $('cbSlack').onchange=()=>{c.slack=Math.max(0,num($('cbSlack').value,0));refreshVisuals();renderProperties();};
  $('cbName').onchange=()=>{c.name=$('cbName').value.trim()||c.name;refreshVisuals();renderProperties();};
  $('delCable').onclick=()=>{state.cables=state.cables.filter(x=>x.id!==c.id);state.selected=null;window.__manualRoutePicking=false;renderAll();toast('Cabo removido');};
   updateCableResult(c);
  bindCablePanelSections(p);
  // Reconfere o campo de nome logo após o próximo quadro de tela — proteção
  // extra contra qualquer sequência de seleção que deixe o disabled/valor
  // fora de sincronia com o asset de verdade instalado na U.
  requestAnimationFrame(()=>{if(state.selected?.type==='cable'&&state.selected.id===c.id){updateCableAssetNameField(c,'origin');updateCableAssetNameField(c,'dest');}});
}
// Passos do painel do cabo: o estado de aberto/fechado vive fora do DOM
// porque o painel inteiro é reconstruído a cada alteração.
const cablePanelOpen={origem:true,destino:true,extras:true,rota:true};
function bindCablePanelSections(root){
  if(!root)return;
  root.querySelectorAll('[data-panel-step]').forEach(sec=>{
    const key=sec.dataset.panelStep;
    const btn=sec.querySelector('.panel-step-toggle');
    const open=cablePanelOpen[key]!==false;
    sec.classList.toggle('collapsed',!open);
    if(!btn)return;
    btn.setAttribute('aria-expanded',String(open));
    btn.onclick=()=>{
      const now=cablePanelOpen[key]===false;
      cablePanelOpen[key]=now;
      sec.classList.toggle('collapsed',!now);
      btn.setAttribute('aria-expanded',String(now));
    };
  });
}
const CABLE_METRIC_ICONS={
  upArrow:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  downArrow:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  tray:'<path d="M3 9h18M3 15h18M6 9v6M18 9v6"/>',
  link:'<path d="M9.5 14.5 14.5 9.5M8 17H6.8a4.2 4.2 0 0 1 0-8.4H8M16 7h1.2a4.2 4.2 0 0 1 0 8.4H16"/>',
  ruler:'<path d="M3.5 8.5h17v7h-17zM8 8.5v3M12 8.5v4M16 8.5v3"/>',
  percent:'<path d="M18.5 5.5 5.5 18.5M8.5 7.5h.01M15.5 16.5h.01"/>'
};
function updateCableResult(c){
  const el=$('cableResult');if(!el)return;
  const validation=cableUnitValidation(c);
  if(!validation.valid){el.innerHTML='<div class="validation-error">'+uiIcon('warn')+' '+validation.errors.map(esc).join('<br>')+'</div>';return;}
  const res=calcCable(c);
  const com=cableCommercial(c,res);
  const row=(parcela,icon,label,value)=>`<div class="cable-metric" data-parcela="${parcela}"><span class="cable-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${CABLE_METRIC_ICONS[icon]}</svg></span><span class="cable-metric-label">${label}</span><b>${value.toFixed(2)} m</b></div>`;
  el.innerHTML=row('origem','upArrow','Vertical origem',res.v1)
    +row('calhas','tray','Trecho pelas calhas',res.tray)
    +row('destino','downArrow','Vertical destino',res.v2)
    +row('conexoes','link','Conexões',res.connection)
    +row('base','ruler','Base',res.base)
    +row('folga','percent',`Folga ${c.slack??state.defaultSlack}%`,res.slack)
    +`<div class="cable-metric is-total"><span class="cable-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6h11l-5.5 6 5.5 6h-11"/></svg></span><span class="cable-metric-label">Total</span><b>${res.total.toFixed(2)} m</b></div>`
    +`<div class="cable-metric is-rounded"><span class="cable-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${CABLE_METRIC_ICONS.upArrow}</svg></span><span class="cable-metric-label">${com.fromTable?'Metragem comercial':'Total arredondado para cima'}</span><b>${res.reachable?com.m:'—'} m</b></div>`
    +(res.reachable&&com.price!=null?`<div class="cable-metric is-price"><span class="cable-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${CABLE_METRIC_ICONS.ruler}</svg></span><span class="cable-metric-label">Preço</span><b>${formatBRL(com.price)}</b></div>`:'')
    +(res.reachable&&com.over?`<div class="validation-error">${uiIcon('warn')} Passa da maior metragem cadastrada para ${esc(c.type||defaultCableType())} (${com.maxM} m). Use emenda ou cabo sob medida.</div>`:'')
    +(res.reachable?'':'<div class="unreachable">Não existe rota pelas calhas cadastradas.</div>');
}

function bindManualRouteControls(c){
  const pick=$('pickRouteRack'),clear=$('clearManualRoute');
  if(pick)pick.onclick=()=>{if(c.routeMode!=='manual')return;window.__manualRoutePicking=!window.__manualRoutePicking;pick.classList.toggle('active',!!window.__manualRoutePicking);pick.textContent=window.__manualRoutePicking?'Clique em um rack…':'Adicionar rack à rota';renderManualRouteUI(c);};
  if(clear)clear.onclick=()=>{c.via=[];window.__manualRoutePicking=false;refreshVisuals();renderProperties();toast('Rota manual limpa');};
  renderManualRouteUI(c);
}
function renderManualRouteUI(c){
  const panel=$('manualRoutePanel'),list=$('manualRouteList'),status=$('manualRouteStatus');
  if(!panel||!list)return;
  panel.classList.toggle('hidden',c.routeMode!=='manual');
  list.innerHTML=(c.via||[]).map((id,i)=>`<div class="route-node"><span class="route-index">${i+1}</span><span>${esc(rackNameById(id))}</span><button class="btn small danger" data-manual-via-del="${i}">${uiIcon('close')}</button></div>`).join('');
  list.querySelectorAll('[data-manual-via-del]').forEach(b=>b.onclick=()=>{c.via.splice(+b.dataset.manualViaDel,1);window.__manualRoutePicking=false;refreshVisuals();renderProperties();});
  const md=manualRouteData(c);
  if(status){status.textContent=md.reachable?(c.via?.length?`Rota válida: ${[c.originRack,...c.via,c.destRack].map(rackNameById).join(' → ')}`:'Nenhum rack intermediário selecionado.'):`Rota impossível: ${rackNameById(md.failedFrom)} → ${rackNameById(md.failedTo)}`;status.className='manual-route-status '+(md.reachable?'valid':'invalid');}
  const clear=$('clearManualRoute');if(clear)clear.disabled=!(c.via||[]).length;
}
function refreshVisuals(){normalizeState();render();renderCables();updateAlertsCenterBadge();save();}

configureCables({ syncActiveRoom, normalizeCableCatalogs, cableTypeNames, defaultCableType, cableTypeColor, toast, cableUnitValidation, renderAll, flashSelection, breakoutLegCables, breakoutSummaryRows, breakoutCalc });
configureBreakouts({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection, setPropHead, setPropTitleSticky, propIcon, bindCablePanelSections, CABLE_METRIC_ICONS });
async function exportAssetsXLSX(){
  beginTask('Exportando assets…');
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    // Rótulos das colunas compartilhadas com o inventário vêm de ASSET_COLUMN_HEADER_LABELS
    // (fonte única) — mudar o nome de uma coluna lá já reflete aqui, sem duplicar string.
    // L.warranty/L.eol no inventário nomeiam o NÍVEL calculado (Vencida/Dentro do ciclo),
    // que aqui é a coluna separada de status — não a data de vencimento, que fica com seu
    // próprio nome pra não colidir com a coluna de status ao lado.
    const L=ASSET_COLUMN_HEADER_LABELS;
    const headers=[L.assetTag,L.name,L.type,L.manufacturer,L.model,L.serial,L.location,L.rack,L.face,L.u,L.uHeight,L.status,L.substatus,'Portas','Portas Disponíveis','Portas Usadas',L.purchaseDate,'Vencimento da Garantia',L.warranty,L.eol,L.notes];
    const roomCables=cablesByRoom();
    const WARRANTY_LABELS={expired:'Vencida',soon:'Vence em breve',ok:'Em garantia',none:'—'};
    const rows=(state.assets||[]).map(a=>{
      const rack=assetRack(a.rackId);
      const ports=a.ports||[];
      const cables=[...(roomCables.get(a.roomId)||[]),...breakoutLegCables((state.rooms||[]).find(r=>r.id===a.roomId)?.data?.breakouts)];
      const usedIds=new Set();
      cables.forEach(c=>{if(c.originPortId)usedIds.add(c.originPortId);if(c.destPortId)usedIds.add(c.destPortId);});
      const available=ports.filter(p=>!usedIds.has(p.id)).map(p=>p.label);
      const used=ports.filter(p=>usedIds.has(p.id)).map(p=>p.label);
      return [a.assetTag||'',a.name||'',a.type||'',a.manufacturer||'',a.model||'',a.serial||'',assetLocationLabel(a),rack?rackDisplayName(rack):'',rack?(a.face==='rear'?'Traseira':'Frente'):'',rack?a.uStart||'':'',rack?(a.uHeight||1):'',a.status||'',a.substatus||'',compactPortLabels(ports.map(p=>p.label)),compactPortLabels(available),compactPortLabels(used),formatAssetDate(a.purchaseDate),formatAssetDate(a.warrantyExpiration),WARRANTY_LABELS[assetWarrantyLevel(a)],formatAssetDate(a.endOfLife),a.notes||''];
    });
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Assets');
    ws.addRow(headers); rows.forEach(r=>ws.addRow(r));
    ws.freezePanes={xSplit:0,ySplit:1}; ws.autoFilter={from:'A1',to:`${excelColumnLetter(headers.length)}${Math.max(1,rows.length+1)}`}; ws.getRow(1).font={bold:true};
    ws.columns=headers.map((h,i)=>({width:Math.min(60,Math.max(12,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))+2))}));
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(state.projectName||'data-center')}-assets.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Assets exportados');
  }catch(err){toast(err.message||'Erro ao exportar Excel');}
  finally{endTask();}
}
function ensureFields(){$('projectName').value=state.projectName;$('rowCount').value=state.rows.length;$('defaultRacks').value=state.rows[0]?.rackCount??0;$('rackUnits').value=state.rackUnits;$('rackWidth').value=state.rackWidth;$('rackDepth').value=state.rackDepth;$('rackGap').value=state.rackGap;$('rackPowerCapacity').value=state.rackPowerCapacityW>0?state.rackPowerCapacityW:'';$('rackWeightCapacity').value=state.rackWeightCapacityKg>0?state.rackWeightCapacityKg:'';$('defaultRowGap').value=state.defaultRowGap;$('lastUToTray').value=state.lastUToTray;$('defaultSlack').value=state.defaultSlack;}
function updateCanvasEmptyHint(){
  const hint=$('canvasEmptyHint'); if(!hint)return;
  const dismissed=localStorage.getItem('dccp_hint_dismissed')==='1';
  hint.classList.toggle('hidden',dismissed||state.rows.length>0);
}
function renderAll(persist=true){ensureFields();updateRoomUI();buildRowsPanel();render();renderProperties();renderCables();renderBreakoutsList();updateStructureControls();updateProjectSummary();updateMinimap();updateAlertsCenterBadge();updateCanvasEmptyHint();state.snapToEdges=true;if(persist)save();updateHistoryButtons();}

function svgLocalPoint(clientX,clientY){
  const stage=$('canvasStage');
  const rect=stage.getBoundingClientRect();
  const zoom=(window.__canvasPan&&Number.isFinite(window.__canvasPan.zoom))?window.__canvasPan.zoom:1;
  // getBoundingClientRect() already includes the current canvas translation and scroll.
  // Dividing by zoom converts the pointer back to the SVG/stage coordinate system.
  return {x:(clientX-rect.left)/zoom,y:(clientY-rect.top)/zoom};
}
function selectRacksInBox(b){
  // Use the rendered rack bodies in screen coordinates. This is deliberately
  // independent of the canvas zoom/pan transform, so Shift+drag keeps working
  // at any zoom level and after scrolling/panning.
  const x1=Math.min(b.clientX1,b.clientX2),x2=Math.max(b.clientX1,b.clientX2);
  const y1=Math.min(b.clientY1,b.clientY2),y2=Math.max(b.clientY1,b.clientY2);
  const ids=[];
  document.querySelectorAll('#layout .rack-body').forEach(el=>{
    const r=el.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    if(cx>=x1&&cx<=x2&&cy>=y1&&cy<=y2){
      const g=el.closest('[data-rack]');
      if(g?.dataset.rack) ids.push(g.dataset.rack);
    }
  });
  state.multiSelected=[...new Set(ids)];
  state.selected=ids.length?{type:'rack',id:ids[ids.length-1]}:null;
}
function selectTraysInBox(b){
  const x1=Math.min(b.clientX1,b.clientX2),x2=Math.max(b.clientX1,b.clientX2);
  const y1=Math.min(b.clientY1,b.clientY2),y2=Math.max(b.clientY1,b.clientY2);
  const ids=[];
  document.querySelectorAll('#layout .tray-line[data-tray]').forEach(el=>{
    const r=el.getBoundingClientRect();
    const intersects=!(r.right<x1 || r.left>x2 || r.bottom<y1 || r.top>y2);
    if(intersects && el.dataset.tray) ids.push(el.dataset.tray);
  });
  state.multiSelected=[];
  state.trayMultiSelected=[...new Set(ids)];
  state.selected=ids.length?{type:'tray',id:ids[ids.length-1]}:null;
}

async function deleteSelectedTrays(){
  if(structureBlocked())return;
  const ids=[...new Set(state.trayMultiSelected)].filter(id=>state.trays.some(t=>t.id===id));
  if(ids.length<2)return;
  const ok=await uiConfirm('',{title:`Excluir ${ids.length} calhas selecionadas?`,confirmText:'Excluir calhas',danger:true});
  if(!ok)return;
  const set=new Set(ids);
  state.trayLinks=state.trayLinks.filter(l=>!set.has(l.aTray)&&!set.has(l.bTray));
  state.trayRackLinks=state.trayRackLinks.filter(l=>!set.has(l.trayId));
  state.trays=state.trays.filter(t=>!set.has(t.id));
  state.trayMultiSelected=[];state.selected=null;
  normalizeState();renderAll();toast(`${ids.length} calhas excluídas`);
}

async function deleteSelectedRacks(){
  if(structureBlocked())return;
  const ids=[...new Set(state.multiSelected)].filter(id=>state.racks.some(r=>r.id===id));
  if(ids.length<2)return;
  const ok=await uiConfirm('',{title:`Excluir ${ids.length} racks selecionados?`,confirmText:'Excluir racks',danger:true});
  if(!ok)return;
  removeRackReferences(ids);
  state.assets.forEach(a=>{if(ids.includes(a.rackId)){a.rackId=null;}});
  state.racks=state.racks.filter(r=>!ids.includes(r.id));
  state.rows.forEach(row=>row.rackCount=racksInRow(row.id).length);
  state.multiSelected=[];state.selected=null;normalizeState();renderAll();toast(`${ids.length} racks excluídos`);
}

function setupPropSectionResize(){
  const handle=$('propSectionResize');
  if(!handle||handle.dataset.splitBound)return;
  const propSection=handle.previousElementSibling;
  const right=handle.closest('.sidebar.right');
  const cables=handle.nextElementSibling;
  if(!propSection||!right||!cables)return;
  handle.dataset.splitBound='1';

  const KEY='dccp-split-cabos';
  let pinnedTop=null;   // topo do cartão de Cabos durante o arrasto, em px
  let pinnedRatio=null; // o mesmo topo como fração da coluna: sobrevive ao recarregar
  try{
    const salvo=localStorage.getItem(KEY);
    if(salvo!=null){const v=parseFloat(salvo); if(Number.isFinite(v)&&v>=0&&v<=1)pinnedRatio=v;}
  }catch{}
  let bounds={min:0,max:0,usable:0};

  // A divisão tem uma variável só: o topo do cartão de Cabos. Propriedades fica com o espaço
  // que sobra até ele, sem passar do próprio conteúdo — assim o cartão nunca estica com vão
  // por dentro, e o arrasto de Cabos para cima encolhe Propriedades (que passa a rolar).
  const layout=()=>{
    const cs=getComputedStyle(right);
    const avail=right.clientHeight-(parseFloat(cs.paddingTop)||0)-(parseFloat(cs.paddingBottom)||0);
    if(avail<120)return; // painel escondido: não há o que dividir
    // Seção recolhendo/expandindo: a altura está no meio de uma transição, então qualquer
    // medida agora seria a altura recortada. O layout volta no fim da animação.
    if(propSection.dataset.animating==='1'||cables.dataset.animating==='1')return;
    // Medir sempre sem as travas do próprio layout.
    // Zerar essas alturas encolhe o card na hora e o navegador joga a rolagem para o topo. Quem
    // guarda a posição é quem reescreve o painel (renderProperties/renderCables); este é o
    // último ajuste antes de devolver, e por isso devolve também.
    const rolagemProps=propSection.scrollTop;
    const listaCabos=cables.querySelector('#cablesList');
    const rolagemCabos=listaCabos?listaCabos.scrollTop:0;
    propSection.style.height='';
    cables.style.height='';
    handle.style.marginTop='';
    const nProp=propSection.offsetHeight;
    const nCab=cables.offsetHeight;
    const cabHead=cables.querySelector('.cables-head')?.offsetHeight||0;
    // Vão que já existe entre os cartões: margem da seção mais a barra do puxador (~21px).
    const baseGap=cables.offsetTop-propSection.offsetTop-nProp;
    // O fundo útil é a borda de dentro do respiro da coluna: Cabos desce até encostar nela.
    const usable=avail;
    // Mínimo de Propriedades: o próprio cabeçalho (com a pílula da seleção, quando há uma).
    // Era um 54px fixo, que cortava a segunda linha do cabeçalho ao arrastar Cabos para cima.
    // Recolhido, vale o --collapsed-h (mantido igual ao cabeçalho medido), que não sofre com uma
    // medida feita no meio do recálculo do texto.
    const recolhidoVar=propSection.classList.contains('collapsed')
      ?(parseFloat(getComputedStyle(propSection).getPropertyValue('--collapsed-h'))||0):0;
    const propFloor=Math.min(Math.max(sectionHeadHeight(propSection),recolhidoVar),nProp);
    const minTop=propFloor+baseGap;
    // Até onde Cabos desce: encostado no fim da coluna sobrando só o cabeçalho dele. O cartão
    // encolhe e rola por dentro para poder descer mais do que a própria altura pede.
    const cabFloor=Math.min(nCab,Math.max(44,cabHead));
    const maxTop=Math.max(minTop,usable-cabFloor);
    // Sem arrasto definido, Cabos fica logo abaixo de Propriedades e cresce para baixo: o que
    // não couber rola dentro da lista. Antes ele subia para caber inteiro, o que encolhia
    // Propriedades a cada cabo adicionado.
    const autoTop=nProp+baseGap;
    const want=pinnedTop!=null?pinnedTop:(pinnedRatio!=null?pinnedRatio*usable:autoTop);
    const top=Math.max(minTop,Math.min(maxTop,want));
    const propH=Math.max(propFloor,Math.min(nProp,top-baseGap));
    // A folga vai para a margem do puxador, não para a de Cabos: a barra viaja colada no topo
    // do cartão de Cabos, como a alça dele, em vez de ficar presa embaixo de Propriedades.
    handle.style.marginTop=Math.max(0,top-baseGap-propH)+'px';
    cables.style.height=Math.max(0,Math.min(nCab,usable-top))+'px';
    // Recolhido, quem manda na altura é o --collapsed-h do CSS: uma altura inline aqui venceria
    // esse teto e cortava o cabeçalho (duas linhas quando há seleção).
    propSection.style.height=propSection.classList.contains('collapsed')?'':propH+'px';
    propSection.scrollTop=rolagemProps;
    if(listaCabos)listaCabos.scrollTop=rolagemCabos;
    bounds={min:minTop,max:maxTop,usable};
    window.__dccpSplit={nProp,nCab,baseGap,usable,minTop,maxTop,top,propH};
    window.__dccpRaw={
      clientH:right.clientHeight,
      padT:parseFloat(cs.paddingTop)||0,
      padB:parseFloat(cs.paddingBottom)||0,
      avail,
      colTop:Math.round(right.getBoundingClientRect().top),
      colBottom:Math.round(right.getBoundingClientRect().bottom),
      propTop:Math.round(propSection.getBoundingClientRect().top),
      handleMT:handle.style.marginTop,
    };
  };
  window.__dccpRightSplit=layout;

  let dragY=0,dragTop=0,dragging=false;
  const onMove=e=>{
    if(!dragging)return;
    pinnedTop=Math.max(bounds.min,Math.min(bounds.max,dragTop+(e.clientY-dragY)));
    layout();
  };
  const onUp=()=>{
    if(!dragging)return;
    dragging=false;
    handle.classList.remove('is-dragging');
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    if(pinnedTop!=null&&bounds.usable>0){
      pinnedRatio=Math.max(0,Math.min(1,pinnedTop/bounds.usable));
      try{localStorage.setItem(KEY,pinnedRatio.toFixed(4));}catch{}
    }
    pinnedTop=null;
    layout();
  };
  // Duplo clique devolve Cabos para logo abaixo de Propriedades.
  handle.addEventListener('dblclick',()=>{
    pinnedTop=null;pinnedRatio=null;
    try{localStorage.removeItem(KEY);}catch{}
    layout();
  });
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    dragging=true;
    dragY=e.clientY;
    dragTop=Math.round(cables.getBoundingClientRect().top-propSection.getBoundingClientRect().top);
    handle.classList.add('is-dragging');
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',onUp);
    e.preventDefault();
  });

  if(!right.dataset.splitWatch){
    right.dataset.splitWatch='1';
    let raf=0;
    const schedule=()=>{
      if(raf)return;
      raf=requestAnimationFrame(()=>{raf=0;layout();});
    };
    // Trocar a seleção, mudar a U de um cabo ou redesenhar a lista muda as alturas naturais dos
    // dois cartões. O observador olha só o conteúdo; o layout escreve estilo, então não há laço.
    new MutationObserver(schedule).observe(right,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    window.addEventListener('resize',schedule);
    if(window.ResizeObserver)new ResizeObserver(schedule).observe(right);
  }
  layout();
}
function setupPan(){
  const wrap=$('canvasWrap'), stage=$('canvasStage');
  if(!wrap||!stage)return;
  let drag=null, raf=0;
  if(!window.__canvasPan) window.__canvasPan={x:-VIEW_PAD+40,y:-VIEW_PAD+40,zoom:1};
  const p=window.__canvasPan;
  if(!Number.isFinite(p.zoom))p.zoom=1;
  // Faixa do zoom. Fecha em 0,4× e 2,5× porque o slider usa escala logarítmica: os dois lados
  // têm o mesmo fator e 100% fica exatamente no meio da barra.
  const ZOOM_MIN=0.4, ZOOM_MAX=2.5, ZOOM_LOG=Math.log(ZOOM_MAX/ZOOM_MIN);
  const clampZoom=z=>Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,z));
  // Movimento livre: sem limite de posição — o canvas se comporta como uma
  // superfície "infinita" pra planejar quantos racks/fileiras quiser, sem
  // travar numa borda artificial.
  const apply=()=>{
    stage.style.transform=`translate3d(${p.x}px,${p.y}px,0) scale(${p.zoom})`;
    stage.style.transformOrigin='0 0';
    if(window.__updateMinimap) window.__updateMinimap();
  };
  const begin=(e)=>{
    if(e.button!==0 || e.target.closest('[data-rack]') || e.target.closest('[data-tray]'))return;
    const layout=document.getElementById('layout');
    const stageEl=document.getElementById('canvasStage');
    const onCanvasBackground=(e.target===wrap || e.target===stageEl || e.target===layout || !!e.target.closest?.('#layout'));
    if(e.shiftKey && onCanvasBackground){
      const isTraySelection=e.ctrlKey||e.metaKey;
      window.__canvasMarquee=true;
      const start=svgLocalPoint(e.clientX,e.clientY);
      const box={x1:start.x,y1:start.y,x2:start.x,y2:start.y,clientX1:e.clientX,clientY1:e.clientY,clientX2:e.clientX,clientY2:e.clientY};
      if(isTraySelection){
        window.__traySelectionBox=box;
        window.__traySelectionDrag=true;
      }else{
        window.__rackSelectionBox=box;
        window.__rackSelectionDrag=true;
      }
      // Capture the pointer on the canvas so replacing the SVG during render()
      // cannot interrupt the selection gesture.
      try{wrap.setPointerCapture?.(e.pointerId);}catch(_){}
      const moveSelect=ev=>{
        const pt=svgLocalPoint(ev.clientX,ev.clientY);
        box.x2=pt.x;box.y2=pt.y;
        box.clientX2=ev.clientX;box.clientY2=ev.clientY;
        render();ev.preventDefault();
      };
      const stopSelect=ev=>{
        document.removeEventListener('pointermove',moveSelect);
        document.removeEventListener('pointerup',stopSelect);
        document.removeEventListener('pointercancel',stopSelect);
        try{wrap.releasePointerCapture?.(e.pointerId);}catch(_){}
        const area=Math.abs(box.clientX2-box.clientX1)*Math.abs(box.clientY2-box.clientY1);
        window.__rackSelectionBox=null;window.__rackSelectionDrag=false;
        window.__traySelectionBox=null;window.__traySelectionDrag=false;
        if(area>9){
          if(isTraySelection) selectTraysInBox(box);
          else selectRacksInBox(box);
        }else{
          state.multiSelected=[];state.trayMultiSelected=[];state.selected=null;
        }
        renderAll();
        ev?.preventDefault?.();
      };
      document.addEventListener('pointermove',moveSelect,{passive:false});
      document.addEventListener('pointerup',stopSelect,{once:true});
      document.addEventListener('pointercancel',stopSelect,{once:true});
      e.preventDefault();
      return;
    }
    drag={x:e.clientX,y:e.clientY,startX:p.x,startY:p.y};
    wrap.classList.add('panning');
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',stop,{once:true});
    window.addEventListener('pointercancel',stop,{once:true});
    e.preventDefault();
  };
  const move=(e)=>{
    if(!drag)return;
    p.x=drag.startX+(e.clientX-drag.x);
    p.y=drag.startY+(e.clientY-drag.y);
    if(raf)cancelAnimationFrame(raf);
    raf=requestAnimationFrame(()=>apply());
    e.preventDefault();
  };
  const stop=()=>{
    if(!drag)return;
    if(raf)cancelAnimationFrame(raf);
    drag=null;
    wrap.classList.remove('panning');
    apply();
  };
  const zoomAt=(e)=>{
    if(e.ctrlKey)return;
    const rect=wrap.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const oldZoom=p.zoom;
    const factor=e.deltaY<0?1.12:0.89;
    const newZoom=clampZoom(oldZoom*factor);
    if(newZoom===oldZoom){e.preventDefault();return;}
    const localX=(mx-p.x)/oldZoom, localY=(my-p.y)/oldZoom;
    p.zoom=newZoom;
    p.x=mx-localX*newZoom;
    p.y=my-localY*newZoom;
    apply();
    syncZoomUI();
    e.preventDefault();
  };
  wrap.addEventListener('pointerdown',begin,{passive:false});
  wrap.addEventListener('wheel',zoomAt,{passive:false});
  // Clique no fundo do canvas limpa a seleção. O SVG só cobre a área do desenho: clicar na
  // parte vazia ao lado dele deixava o painel preso no "N racks selecionados".
  wrap.addEventListener('click',e=>{
    const alvo=e.target;
    // Fim do arrasto com Shift: o clique que fecha o gesto não pode limpar o que ele selecionou.
    if(window.__canvasMarquee){window.__canvasMarquee=false;return;}
    if(alvo!==wrap&&alvo!==stage)return;
    if(state.selected||state.multiSelected.length||state.trayMultiSelected.length){
      state.selected=null; state.multiSelected=[]; state.trayMultiSelected=[];
      renderAll();
    }
  });
  window.__applyCanvasPan=apply; window.__updateMinimap=()=>updateMinimap();
  window.__zoomAt=zoomAt;
  window.__zoomIn=()=>{const evt={clientX:wrap.clientWidth/2,clientY:wrap.clientHeight/2,deltaY:-1,ctrlKey:false,preventDefault(){}};zoomAt(evt);};

  // O slider é uma posição 0..100, não o zoom: com escala logarítmica o polegar anda igual
  // para os dois lados e 100% cai no meio.
  const zoomFromSlider=v=>clampZoom(ZOOM_MIN*Math.exp(ZOOM_LOG*(Number(v)||0)/100));
  const sliderFromZoom=z=>Math.max(0,Math.min(100,100*Math.log(z/ZOOM_MIN)/ZOOM_LOG));
  const zoomRange=$('zoomRange'), zoomValue=$('zoomReset');
  const syncZoomUI=()=>{
    const pct=Math.round((p.zoom||1)*100);
    const pos=sliderFromZoom(p.zoom||1);
    if(zoomRange) zoomRange.value=pos.toFixed(2);
    if(zoomRange) zoomRange.style.setProperty('--fill',`${pos.toFixed(1)}%`);
    // Sem isto o leitor de tela anuncia a posição (0..100), não o zoom.
    if(zoomRange) zoomRange.setAttribute('aria-valuetext',`${pct}%`);
    if(zoomValue) zoomValue.textContent=`${pct}%`;
  };
  const setZoomAtCenter=(z)=>{
    const newZoom=clampZoom(Number(z)||1), oldZoom=p.zoom||1;
    if(newZoom===oldZoom){syncZoomUI();return;}
    const vis=canvasVisible(wrap);
    const mx=vis.left+vis.width/2, my=wrap.clientHeight/2;
    const localX=(mx-p.x)/oldZoom, localY=(my-p.y)/oldZoom;
    p.zoom=newZoom; p.x=mx-localX*newZoom; p.y=my-localY*newZoom; apply(); syncZoomUI();
  };
  const fitToView=()=>{
    const svg=$('layout');
    if(!svg)return;
    // Fit the actual drawn plant, not the oversized internal canvas padding.
    const els=[...svg.querySelectorAll('.rack-body,.rack-text,.rack-meta-card,.rack-meta-label,.svg-label,.tray-line,.tray-link,.tray-node,.tray-length,.cross-front,.cross-back,.route-line')];
    let box=null;
    for(const el of els){
      try{ const b=el.getBBox(); if(!b.width && !b.height) continue;
        if(!box) box={x:b.x,y:b.y,x2:b.x+b.width,y2:b.y+b.height};
        else {box.x=Math.min(box.x,b.x);box.y=Math.min(box.y,b.y);box.x2=Math.max(box.x2,b.x+b.width);box.y2=Math.max(box.y2,b.y+b.height);}
      }catch(_){}
    }
    if(!box)return;
    const margin=56;
    const bw=Math.max(1,box.x2-box.x), bh=Math.max(1,box.y2-box.y);
    // O enquadramento usa a área visível (sem a faixa coberta pela barra
    // lateral), senão a planta abre deslocada para a esquerda.
    const vis=canvasVisible(wrap);
    const z=clampZoom(Math.min((vis.width-margin*2)/bw,(wrap.clientHeight-margin*2)/bh));
    p.zoom=z;
    p.x=vis.left+(vis.width-(box.x+box.x2)*z)/2;
    p.y=(wrap.clientHeight-(box.y+box.y2)*z)/2;
    apply(); syncZoomUI();
  };
  // Prevent the canvas pan handler from stealing pointer interaction with the zoom UI.
  const zoomBar=$('canvasZoomBar');
  zoomBar?.addEventListener('pointerdown',e=>e.stopPropagation());
  // Remove focus when the pointer leaves the control so :focus-within does not
  // keep the zoom bar expanded after dragging/clicking the slider.
  zoomBar?.addEventListener('pointerleave',()=>{
    const ae=document.activeElement;
    if(ae && zoomBar.contains(ae) && typeof ae.blur==='function') ae.blur();
  });
  zoomBar?.addEventListener('mouseleave',()=>{
    const ae=document.activeElement;
    if(ae && zoomBar.contains(ae) && typeof ae.blur==='function') ae.blur();
  });
  zoomRange?.addEventListener('input',e=>setZoomAtCenter(zoomFromSlider(e.target.value)));
  $('zoomOut')?.addEventListener('click',()=>setZoomAtCenter((p.zoom||1)/1.12));
  $('zoomIn')?.addEventListener('click',()=>setZoomAtCenter((p.zoom||1)*1.12));
  zoomValue?.addEventListener('click',()=>setZoomAtCenter(1));
  $('zoomFit')?.addEventListener('click',fitToView);
  window.__syncZoomUI=syncZoomUI; window.__fitCanvas=fitToView;
  requestAnimationFrame(()=>{apply();syncZoomUI();});
}


function projectSummaryStats(){
  return {rows:state.rows.length,racks:state.racks.length,trays:state.trays.length,cables:state.cables.length};
}
const PLANNER_SUMMARY_ICONS={
  rows:'<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
  racks:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M12 3v18"/>',
  trays:'<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  cables:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
};
function plannerSummaryItem(kind,text){return `<span><svg class="planner-sum-icon" viewBox="0 0 24 24" aria-hidden="true">${PLANNER_SUMMARY_ICONS[kind]}</svg>${text}</span>`;}
function updateProjectSummary(){
  const s=projectSummaryStats(), inline=$('plannerProjectSummary');
  if(inline) inline.innerHTML=plannerSummaryItem('rows',`${s.rows} ${s.rows===1?'fileira':'fileiras'}`)+plannerSummaryItem('racks',`${s.racks} ${s.racks===1?'rack':'racks'}`)+plannerSummaryItem('trays',`${s.trays} ${s.trays===1?'calha':'calhas'}`)+plannerSummaryItem('cables',`${s.cables} ${s.cables===1?'cabo':'cabos'}`);
  const grid=$('projectSummaryGrid'), name=$('summaryProjectName');
  if(name) name.textContent=state.projectName||'Data Center';
  if(grid){ const items=[['▤','Fileiras',s.rows],['▥','Racks',s.racks],['━','Calhas',s.trays],['⌁','Cabos',s.cables]]; grid.innerHTML=items.map(([icon,label,value])=>`<div class="summary-metric"><span class="summary-metric-icon">${icon}</span><div><strong>${value}</strong><span>${label}</span></div></div>`).join(''); }
}
function closeProjectSummary(){}

function searchableItems(query){
  const q=String(query||'').trim().toLowerCase(); if(!q)return [];
  const items=[];
  // Peso: primeiro o que casa direto no rótulo, depois o que casa no conteúdo. No mesmo nível
  // os objetos (rack, calha, cabo, asset) vêm antes da fileira, que só casou pelo que tem dentro.
  const peso={row:1,rack:0,tray:0,cable:0,asset:0};
  const score=(label,extras)=>{
    const l=String(label||'').trim().toLowerCase();
    const hay=[l,...extras.filter(Boolean).map(v=>String(v).toLowerCase())];
    if(l===q)return 0;
    if(l.startsWith(q))return 1;
    if(hay.some(v=>v===q))return 2;
    if(hay.some(v=>v.startsWith(q)))return 3;
    return 4;
  };
  const add=(type,id,label,meta,extras=[])=>items.push({type,id,label,meta,_s:score(label,extras)*10+(peso[type]||0)});
  // Digitar o tipo ("rack", "calha", "asset"...) mostra todos os itens daquele tipo. Só a partir
  // de 3 letras: com "a" ou "ck" isso traria a lista inteira, porque as palavras do tipo entram
  // no texto de busca.
  const tipoHit=palavra=>q.length>=3&&palavra.startsWith(q);
  // Fileira: casa pelo nome, pelo número (#2, fileira 2, 2) e pelos racks que ela contém.
  state.rows.forEach((row,i)=>{
    const rs=racksInRow(row.id);
    // Sem a palavra "fileira" aqui dentro: quem faz a busca por tipo é o tipoHit, senão
    // qualquer letra de "fileira" (o "a", por exemplo) traria todas as fileiras.
    const hay=[row.name,`#${i+1}`,`${i+1}`,...rs.map(r=>r.name),...rs.map(r=>rackDisplayName(r))].filter(Boolean).join(' ').toLowerCase();
    if(!hay.includes(q)&&!tipoHit('fileira'))return;
    add('row',row.id,row.name||`#${i+1}`,`${rs.length} ${rs.length===1?'rack':'racks'} · fileira #${i+1}`,[`#${i+1}`,`fileira ${i+1}`,`${i+1}`,...rs.map(r=>r.name)]);
  });
  state.racks.forEach(r=>{const row=rowForRack(r); const hay=[r.name,row?.name,rackDisplayName(r)].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q)||tipoHit('rack'))add('rack',r.id,rackDisplayName(r),row?.name||'Fileira',[r.name]);});
  state.trays.forEach(t=>{const hay=[t.name].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q)||tipoHit('calha'))add('tray',t.id,t.name||'Calha','Calha');});
  state.cables.forEach(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack); const hay=[c.name,o?.name,d?.name].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q)||tipoHit('cabo'))add('cable',c.id,c.name||'Cabo',`${o?.name||'?'} → ${d?.name||'?'}`);});
  (state.breakouts||[]).forEach(b=>{const o=state.racks.find(r=>r.id===b.origin.rack); const hay=[b.name,b.type,o?.name,b.origin.assetName].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q)||tipoHit('breakout'))add('breakout',b.id,b.name||'Breakout',`${o?.name||'?'} · ${b.legs.filter(l=>l.destRack).length} perna(s)`);});
  // Asset: casa pelo nome, tag, serial, modelo, fabricante, tipo e pelo rack onde está.
  state.assets.forEach(a=>{
    const rack=assetRack(a.rackId);
    const hay=[a.name,a.assetTag,a.serial,a.model,a.manufacturer,a.type,rack?rackDisplayName(rack):''].filter(Boolean).join(' ').toLowerCase();
    if(!hay.includes(q)&&!tipoHit('asset'))return;
    const meta=[rack?rackDisplayName(rack):'Sem rack',a.uStart?`U${a.uStart}`:'',a.type||''].filter(Boolean).join(' · ');
    add('asset',a.id,a.name||a.assetTag||'Asset',meta,[a.assetTag,a.serial]);
  });
  return items.sort((x,y)=>x._s-y._s).slice(0,30);
}
const SEARCH_TYPE_LABEL={row:'Fileira',rack:'Rack',tray:'Calha',cable:'Cabo',asset:'Asset'};
const SEARCH_TYPE_ICON={row:'▤',rack:'▥',tray:'━',cable:'⌁',asset:'▣'};
// Uma lista só para as duas superfícies de busca: o painel do Ctrl+K e a caixa da barra.
function searchListHtml(items,index){
  if(!items.length)return '<div class="empty">Nenhum resultado encontrado.</div>';
  return items.map((x,i)=>`<button type="button" class="quick-result ${i===index?'active':''}" data-search-type="${x.type}" data-search-id="${esc(x.id)}"><span class="quick-result-icon">${SEARCH_TYPE_ICON[x.type]||'•'}</span><span><strong>${esc(x.label)}</strong><small>${esc(x.meta)}</small></span><b>${SEARCH_TYPE_LABEL[x.type]||''}</b></button>`).join('');
}
let quickSearchIndex=0, quickSearchItems=[];
function renderQuickSearchResults(query){
  const el=$('quickSearchResults'); if(!el)return; quickSearchItems=searchableItems(query);quickSearchIndex=Math.max(0,Math.min(quickSearchIndex,quickSearchItems.length-1));
  if(!String(query||'').trim()){el.innerHTML='<div class="empty">Digite para pesquisar.</div>';return;}
  el.innerHTML=searchListHtml(quickSearchItems,quickSearchIndex);
  el.querySelectorAll('[data-search-id]').forEach(b=>b.addEventListener('click',()=>activateSearchResult(b.dataset.searchType,b.dataset.searchId)));
}
// Busca geral da barra de topo: a mesma lista do Ctrl+K, logo abaixo do campo. Sem comandos —
// é busca de projeto: fileira, rack, calha, cabo e asset.
let topSearchItems=[], topSearchIndex=0;
function closeTopSearch(){
  const box=$('topSearchResults'); if(!box)return;
  box.classList.add('hidden'); box.innerHTML='';
  $('topSearch')?.setAttribute('aria-expanded','false');
}
function renderTopSearchResults(query){
  const box=$('topSearchResults'); if(!box)return;
  if(!String(query||'').trim()){closeTopSearch();return;}
  topSearchItems=searchableItems(query);
  topSearchIndex=Math.max(0,Math.min(topSearchIndex,topSearchItems.length-1));
  box.innerHTML=searchListHtml(topSearchItems,topSearchIndex);
  box.classList.remove('hidden');
  $('topSearch')?.setAttribute('aria-expanded','true');
  box.querySelectorAll('[data-search-id]').forEach(b=>b.onclick=()=>{
    const t=b.dataset.searchType, id=b.dataset.searchId;
    clearTopSearch();
    activateSearchResult(t,id);
  });
}
function clearTopSearch(){const i=$('topSearch');if(i)i.value='';closeTopSearch();}
function bindTopSearch(){
  const input=$('topSearch'); if(!input||input.dataset.topSearchBound)return; input.dataset.topSearchBound='1';
  input.addEventListener('input',()=>{topSearchIndex=0;renderTopSearchResults(input.value);});
  input.addEventListener('focus',()=>{if(input.value.trim())renderTopSearchResults(input.value);});
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();clearTopSearch();input.blur();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      if(!topSearchItems.length)return; e.preventDefault();
      topSearchIndex=(topSearchIndex+(e.key==='ArrowDown'?1:-1)+topSearchItems.length)%topSearchItems.length;
      renderTopSearchResults(input.value); return;
    }
    if(e.key==='Enter'&&topSearchItems[topSearchIndex]){
      e.preventDefault();
      const it=topSearchItems[topSearchIndex];
      clearTopSearch();
      activateSearchResult(it.type,it.id);
    }
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest?.('#topSearchWrap'))closeTopSearch();});
}
function centerOnPoint(pt){
  const wrap=$('canvasWrap'),p=window.__canvasPan;if(!wrap||!p||!pt)return;
  // Centraliza na área que aparece de fato: a barra lateral esquerda cobre o
  // começo do canvas, então o meio do wrap não é o meio visível.
  const vis=canvasVisible(wrap);
  const zoom=p.zoom||1;
  p.x=vis.left+vis.width/2-pt.x*zoom;p.y=wrap.clientHeight/2-pt.y*zoom; window.__applyCanvasPan?.();
}
function activateSearchResult(type,id){
  const g=geometry(); state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];
  if(type==='rack'){const r=state.racks.find(x=>x.id===id);if(!r)return;state.selected={type:'rack',id};state.multiSelected=[id];centerOnPoint(rackCenter(r,g));}
  // Calha e cabo não mexem no desenho: só acendem (o item está onde o usuário deixou).
  else if(type==='tray'){const t=state.trays.find(x=>x.id===id);if(!t)return;state.selected={type:'tray',id};state.trayMultiSelected=[id];}
  else if(type==='row'){
    // Fileira: leva o canvas até ela e pisca o cartão no painel, que é onde ela se edita.
    const idx=state.rows.findIndex(r=>r.id===id); if(idx<0)return;
    const racks=racksInRow(id);
    if(racks.length)centerOnPoint(rackCenter(racks[0],g));
    else{
      const pan=window.__canvasPan||{x:0,y:0,zoom:1}, wrap=$('canvasWrap');
      centerOnPoint({x:(-pan.x+wrap.clientWidth/2)/pan.zoom,y:rowCenterY(idx,g)});
    }
  }
  else if(type==='asset'){
    // Asset: centraliza no rack dele e abre o inventário já filtrado pelo nome.
    const a=state.assets.find(x=>x.id===id); if(!a)return;
    const rack=a.rackId?state.racks.find(r=>r.id===a.rackId):null;
    if(rack){state.selected={type:'rack',id:rack.id};state.multiSelected=[rack.id];centerOnPoint(rackCenter(rack,g));}
    openAssetsModal();
    const s=$('assetsSearch'); if(s){s.value=a.name||'';s.dispatchEvent(new Event('input',{bubbles:true}));}
  }
  else if(type==='breakout'){if(!state.breakouts.some(b=>b.id===id))return;state.selected={type:'breakout',id};setCablesTab('breakouts');}
  else {const c=state.cables.find(x=>x.id===id);if(!c)return;state.selected={type:'cable',id};}
  closeQuickSearch();closeTopSearch();renderAll(false);
  // Depois do render: a lista é reescrita inteira, então o cartão marca aí e não antes.
  requestAnimationFrame(()=>{
    if(type==='row'){
      focusPanelItem(`[data-row-card="${id}"]`);
      // A fileira escolhida acende inteira no desenho, rack por rack.
      racksInRow(id).forEach(r=>flashElement(document.querySelector(`[data-rack="${r.id}"] .rack-body`)));
    }
    else if(type==='cable')focusPanelItem(`.cable-item[data-cable="${id}"]`);
    else if(type==='breakout')focusPanelItem(`.breakout-item[data-breakout="${id}"]`);
    else if(type==='tray')flashElement(document.querySelector(`line[data-tray="${id}"].tray-line`));
    window.__applyCanvasPan?.();
  });
}
function openHelpModal(){const m=$('helpModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');}
function closeHelpModal(){const m=$('helpModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function switchHelpSection(section){
  document.querySelectorAll('[data-help-section]').forEach(b=>b.classList.toggle('active',b.dataset.helpSection===section));
  document.querySelectorAll('[data-help-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.helpPanel!==section));
}
function openQuickSearch(){const m=$('quickSearchModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');const i=$('quickSearchInput');if(i){i.value='';renderQuickSearchResults('');requestAnimationFrame(()=>i.focus());}}
function closeQuickSearch(){const m=$('quickSearchModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

// Mini mapa: janela fixa, sempre aberta, no canto inferior direito da planta. Mostra o desenho
// (racks e calhas) com as cores da camada escolhida e a área visível do canvas como uma moldura,
// que acompanha o zoom e o arraste do canvas. Arrastar a moldura move o canvas; a roda do mouse
// dá zoom, como no próprio canvas.
const MINIMAP_W=260, MINIMAP_H=150;
// Folga em volta do desenho, em fração do tamanho da planta: é o espaço que a moldura da área
// visível percorre quando o canvas é arrastado.
const MINIMAP_SLACK=0.25;
function minimapBox(g){
  // Caixa do desenho em coordenadas da planta.
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  const add=(x,y)=>{x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x);y2=Math.max(y2,y);};
  state.racks.forEach(r=>{const q=rackRect(r,g);add(q.x,q.y);add(q.x+q.w,q.y+q.h);});
  state.trays.forEach(t=>{add(t.x1,t.y1);add(t.x2,t.y2);});
  return {x1,y1,x2,y2};
}
// Parte do canvas que aparece de fato: a barra lateral esquerda cobre o começo do #canvasWrap.
function canvasVisible(wrap){
  // Os dois painéis flutuam sobre a planta: a área visível é o que sobra entre eles.
  const wr=wrap.getBoundingClientRect();
  const lado=sel=>{const el=document.querySelector(sel); if(!el||!el.offsetParent)return null;
    const r=el.getBoundingClientRect(); return r.width>0?r:null;};
  const lr=lado('.sidebar.left'), rr=lado('.sidebar.right');
  const left=lr&&lr.right>wr.left?Math.min(wr.width-1,Math.max(0,lr.right-wr.left)):0;
  const right=rr&&rr.left<wr.right?Math.min(wr.width-1-left,Math.max(0,wr.right-rr.left)):0;
  return {left,width:Math.max(1,wrap.clientWidth-left-right),height:wrap.clientHeight};
}
function updateMinimap(){
  const box=$('minimap'),svg=$('minimapSvg'),wrap=$('canvasWrap'); if(!box||!svg||!wrap||!box.offsetParent)return;
  const g=geometry(), w=MINIMAP_W, h=MINIMAP_H;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  if(!state.racks.length){
    // Estado vazio do minimapa: o mesmo desenho de rack usado nas listas vazias,
    // menor, em vez de uma frase solta num retângulo branco.
    svg.innerHTML='<g class="minimap-empty-art" aria-hidden="true"><rect x="42%" y="34%" width="16%" height="7%" rx="1.4"/><rect x="42%" y="44%" width="16%" height="6%" rx="1.4"/></g>'
      +'<text x="50%" y="62%" text-anchor="middle" class="minimap-empty">Sem racks</text>';
    svg.dataset.scale='';
    return;
  }
  const c=minimapBox(g);
  const p=window.__canvasPan||{x:0,y:0,zoom:1},z=p.zoom||1;
  const vis=canvasVisible(wrap), view={x:(vis.left-p.x)/z,y:-p.y/z,w:vis.width/z,h:vis.height/z};
  // O mapa cobre o desenho com uma folga fixa (não depende de onde o canvas está), então a moldura
  // da área visível cresce e encolhe com o zoom e anda com o arraste; fora do mapa ela é recortada.
  // A caixa é esticada até a proporção da janela (260×150): sem isso, uma planta mais quadrada
  // que a janela era reduzida para caber e a sobra virava faixa morta nas laterais.
  const cw=Math.max(c.x2-c.x1,1e-6),ch=Math.max(c.y2-c.y1,1e-6),pad=6;
  const ccx=(c.x1+c.x2)/2,ccy=(c.y1+c.y2)/2,aspect=(w-pad*2)/(h-pad*2);
  let bw=cw*(1+MINIMAP_SLACK*2),bh=ch*(1+MINIMAP_SLACK*2);
  if(bw/bh>aspect)bh=bw/aspect;else bw=bh*aspect;
  const bx1=ccx-bw/2,by1=ccy-bh/2;
  const sc=Math.min((w-pad*2)/bw,(h-pad*2)/bh), ox=(w-bw*sc)/2-bx1*sc, oy=(h-bh*sc)/2-by1*sc;
  const X=x=>ox+x*sc,Y=y=>oy+y*sc;
  let out=`<rect class="minimap-bg" x="0" y="0" width="${w}" height="${h}"/>`;
  state.trays.forEach(t=>{out+=`<line class="minimap-tray" x1="${X(t.x1)}" y1="${Y(t.y1)}" x2="${X(t.x2)}" y2="${Y(t.y2)}"/>`;});
  state.racks.forEach(r=>{
    const q=rackRect(r,g),m=rackStats.get(r.id),lv=heatLevel(m,heatMode);
    const sel=state.multiSelected.includes(r.id)||(state.selected?.type==='rack'&&state.selected.id===r.id);
    const rx=X(q.x),ry=Y(q.y),rw=Math.max(2,q.w*sc),rh=Math.max(3,q.h*sc);
    out+=`<rect class="minimap-rack ${lv?`heat-${lv}`:''} ${sel?'selected':''}" x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="1.5"/>`;
    if(m&&m.alertLevel!=='l1')out+=`<circle class="minimap-alert alert-${m.alertLevel}" cx="${rx+rw-1.5}" cy="${ry+1.5}" r="2.4"/>`;
  });
  // Moldura da área visível, recortada nas bordas do mapa (sempre com pelo menos 6 px).
  const minV=6/sc, ex1=bx1, ey1=by1, ex2=bx1+bw, ey2=by1+bh;
  const vx1=Math.min(Math.max(view.x,ex1),ex2-minV), vy1=Math.min(Math.max(view.y,ey1),ey2-minV);
  const vx2=Math.max(vx1+minV,Math.min(view.x+view.w,ex2)), vy2=Math.max(vy1+minV,Math.min(view.y+view.h,ey2));
  out+=`<rect class="minimap-viewport" rx="4" x="${X(vx1)}" y="${Y(vy1)}" width="${(vx2-vx1)*sc}" height="${(vy2-vy1)*sc}"/>`;
  svg.innerHTML=out;svg.dataset.ox=ox;svg.dataset.oy=oy;svg.dataset.scale=sc;
}
// Rodapé: a barra de zoom (canto esquerdo), a barra central e o minimapa (canto direito)
// dividem a mesma linha. Em janela estreita eles se cruzam, e quem pode subir sobe uma linha
// (classe is-raised) em vez de encostar no vizinho. O limite não é fixo — muda com a largura das
// laterais, com os rótulos que aparecem/somem e com a escala da tela —, então a decisão sai da
// medição, não de uma media query por largura de janela.
function fitBottomRow(){
  const zoom=$('canvasZoomBar'), heat=$('heatControl'), mm=$('minimap');
  if(!zoom||!heat||!mm)return;
  zoom.classList.remove('is-raised');
  mm.classList.remove('is-raised');
  const caixa=el=>el.getBoundingClientRect();
  const cruza=(a,b)=>a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1;
  const barraCentral=caixa(heat);
  // A barra de zoom cabe entre a lateral e a barra central? Se não, sobe.
  if(cruza(caixa(zoom),barraCentral))zoom.classList.add('is-raised');
  // O minimapa refaz a conta com as posições já corrigidas, então também enxerga a barra de
  // zoom que acabou de subir.
  if(cruza(caixa(mm),barraCentral)||cruza(caixa(mm),caixa(zoom)))mm.classList.add('is-raised');
}
function setupMinimap(){
  const box=$('minimap'),svg=$('minimapSvg'); if(!box||!svg)return;
  // Ponto da planta sob o ponteiro (o mapa é um SVG com viewBox fixo).
  const plantPoint=e=>{
    const rect=svg.getBoundingClientRect(),k=MINIMAP_W/rect.width;
    const sc=Number(svg.dataset.scale)||1,ox=Number(svg.dataset.ox)||0,oy=Number(svg.dataset.oy)||0;
    return {x:((e.clientX-rect.left)*k-ox)/sc,y:((e.clientY-rect.top)*k-oy)/sc};
  };
  const viewNow=()=>{const wrap=$('canvasWrap'),p=window.__canvasPan;if(!wrap||!p)return null;const z=p.zoom||1,vis=canvasVisible(wrap);return {wrap,p,z,vis,x:(vis.left-p.x)/z,y:-p.y/z,w:vis.width/z,h:vis.height/z};};
  // Arrastar a moldura: se o clique cai dentro dela, ela acompanha o ponteiro sem pular;
  // se cai fora, ela se centraliza no ponto e segue o ponteiro.
  let drag=null;
  const moveTo=e=>{
    const v=viewNow(); if(!v||!drag)return;
    const pt=plantPoint(e);
    v.p.x=v.vis.left+v.vis.width/2-(pt.x-drag.dx)*v.z; v.p.y=v.vis.height/2-(pt.y-drag.dy)*v.z;
    window.__applyCanvasPan?.(); updateMinimap();
  };
  // O canvas também escuta ponteiro e roda: aqui elas não podem passar adiante.
  box.addEventListener('pointerdown',e=>e.stopPropagation());
  svg.addEventListener('pointerdown',e=>{
    if(e.button!==0||!Number(svg.dataset.scale))return;
    const v=viewNow(); if(!v)return;
    const pt=plantPoint(e), inside=pt.x>=v.x&&pt.x<=v.x+v.w&&pt.y>=v.y&&pt.y<=v.y+v.h;
    drag={dx:inside?pt.x-(v.x+v.w/2):0,dy:inside?pt.y-(v.y+v.h/2):0};
    try{svg.setPointerCapture(e.pointerId);}catch{} svg.classList.add('is-dragging'); moveTo(e); e.preventDefault();
  });
  svg.addEventListener('pointermove',e=>{if(drag)moveTo(e);});
  const stop=e=>{drag=null;svg.classList.remove('is-dragging');try{if(svg.hasPointerCapture?.(e.pointerId))svg.releasePointerCapture(e.pointerId);}catch{}};
  svg.addEventListener('pointerup',stop); svg.addEventListener('pointercancel',stop);
  // Roda do mouse: mesmo zoom do canvas. Se o ponteiro está sobre a moldura, o zoom mantém fixo o
  // ponto sob ele; fora dela, o zoom é no centro da moldura.
  box.addEventListener('wheel',e=>{
    e.stopPropagation();
    const v=viewNow(); if(!v||!window.__zoomAt||!Number(svg.dataset.scale))return;
    e.preventDefault();
    const pt=plantPoint(e), sx=pt.x*v.z+v.p.x, sy=pt.y*v.z+v.p.y;
    const inView=sx>=v.vis.left&&sx<=v.vis.left+v.vis.width&&sy>=0&&sy<=v.vis.height, r=v.wrap.getBoundingClientRect();
    window.__zoomAt({clientX:r.left+(inView?sx:v.vis.left+v.vis.width/2),clientY:r.top+(inView?sy:v.vis.height/2),deltaY:e.deltaY,ctrlKey:false,preventDefault(){}});
    updateMinimap();
  },{passive:false});
  window.addEventListener('resize',()=>{updateMinimap();fitBottomRow();});
  requestAnimationFrame(()=>{updateMinimap();fitBottomRow();});
}
async function newProject(){
  const ok=await uiConfirm('O projeto atual continuará salvo na nuvem.',{title:'Criar um novo projeto?',confirmText:'Criar novo projeto'});
  if(!ok)return;
  await createNewCloudProject();
}


configureInventoryImport({ ensureRooms, recordAssetAudit, normalizeCableCatalogs, toast, save, render, assetRoom, assetRack, assetRackRoom, allProjectRacks, DEFAULT_ASSET_STATUSES, normalizeAssetCatalogs, renderCableTypesCatalog, renderAssetCatalogs, renderAssetCatalogManufacturerSelect, renderAssetCatalogTypeSelect, openCatalogEditor, renderAssetCatalogSelects, normalizeLocations, assetLocationLabel, assetSubstatusValues, normalizeAssets, autoFillAssetFromModel, ASSET_COLUMN_HEADER_LABELS, renderAssetsList, renderCables, renderAll });
configureBulkAssets({ toast, save, assetRack, normalizeAssetCatalogs, normalizeLocations, assetLocationDcName, assetSubstatusValues, normalizeAssets, autoFillAssetFromModel, renderAssetsList, renderBayface, renderAll });
function setupSidebarToggle(){
  if(window.__dccpSidebarBound)return;
  const appShell=document.querySelector('.app'), sidebarToggle=$('sidebarToggle');
  if(!appShell||!sidebarToggle)return;
  window.__dccpSidebarBound=true;
  const sidebarKey='dccp_sidebar_collapsed';
  const setSidebarCollapsed=(collapsed,persist=true)=>{
    appShell.classList.toggle('sidebar-collapsed',!!collapsed);
    // O botão virou um controle do topo com ícone de duas colunas: o estado aparece na cor
    // (aceso quando a lateral está recolhida) e no aria-pressed, não mais num glifo de seta.
    sidebarToggle.classList.toggle('is-collapsed',!!collapsed);
    sidebarToggle.setAttribute('aria-pressed',collapsed?'true':'false');
    sidebarToggle.title=collapsed?'Expandir barra lateral':'Recolher barra lateral';
    sidebarToggle.setAttribute('aria-label',sidebarToggle.title);
    if(persist)localStorage.setItem(sidebarKey,collapsed?'1':'0');
    // A barra de zoom acompanha a lateral com transição de 220ms: medir só depois que ela para.
    requestAnimationFrame(()=>{ window.__updateMinimap?.(); fitBottomRow(); });
    setTimeout(fitBottomRow,240);
  };
  setSidebarCollapsed(localStorage.getItem(sidebarKey)==='1',false);
  sidebarToggle.addEventListener('click',()=>setSidebarCollapsed(!appShell.classList.contains('sidebar-collapsed')));
}
function setupStructureLockControl(){
  if(window.__dccpLockBound)return;
  const btn=$('structureLock');
  if(!btn)return;
  window.__dccpLockBound=true;
  btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    setStructureLock(!isStructureLocked(),true);
    toast(isStructureLocked()?'Estrutura bloqueada':'Estrutura desbloqueada');
  });
}

function bind(){
  normalizeLocations();
  bindImportUI();
  $('locationSelect')?.addEventListener('change',e=>switchLocation(e.target.value));
  $('locationSelect')?.addEventListener('change',e=>fitTopbarSelect(e.target));
  $('roomSelect')?.addEventListener('change',e=>fitTopbarSelect(e.target));
  $('roomSelect')?.addEventListener('change',e=>switchRoom(e.target.value));
  bindStyledSelect('locationSelect','locationSelectBtn');
  bindStyledSelect('roomSelect','roomSelectBtn');
  document.addEventListener('click',e=>{if(!e.target.closest('.dc-select-btn')&&!e.target.closest('.dc-select-panel'))closeStyledSelectPanels();});
  window.addEventListener('resize',closeStyledSelectPanels);
  window.addEventListener('scroll',closeStyledSelectPanels,true);
  $('btnLocations')?.addEventListener('click',openLocationsModal);
  $('btnAssets')?.addEventListener('click',openAssetsModal);
  $('btnAlertsCenter')?.addEventListener('click',e=>{e.stopPropagation();openAlertsCenterPanel(e.currentTarget);});
  document.addEventListener('click',e=>{if(!e.target.closest('.alerts-center-panel')&&!e.target.closest('#btnAlertsCenter'))closeAlertsCenterPanel();});
  window.addEventListener('resize',closeAlertsCenterPanel);
  $('assetsAttentionClear')?.addEventListener('click',()=>{assetAttentionOnly=false;renderAssetsList($('assetsSearch')?.value||'');});
  $('assetHistoryClose')?.addEventListener('click',closeAssetHistory);
  $('assetHistoryExport')?.addEventListener('click',exportCurrentAssetHistory);
  $('assetsClose')?.addEventListener('click',closeAssetsModal);
  $('assetsNew')?.addEventListener('click',()=>openAssetModal());
  $('assetsBulk')?.addEventListener('click',openBulkAssetsModal);
  $('assetsExport')?.addEventListener('click',exportAssetsXLSX);
  $('assetsKpiRow')?.addEventListener('click',e=>{
    const btn=e.target.closest('button'); if(!btn)return;
    assetsPage=1;
    if(btn.dataset.kpiTotal){delete assetColumnFilters.status;delete assetColumnFilters.warranty;}
    else if(btn.dataset.kpiWarranty){
      const active=assetColumnFilters.warranty&&assetColumnFilters.warranty.has('Vencida');
      if(active)delete assetColumnFilters.warranty; else assetColumnFilters.warranty=new Set(['Vencida']);
    }else if(btn.dataset.kpiStatus){
      const status=btn.dataset.kpiStatus;
      const active=assetColumnFilters.status&&assetColumnFilters.status.size===1&&assetColumnFilters.status.has(status);
      if(active)delete assetColumnFilters.status; else assetColumnFilters.status=new Set([status]);
    }
    renderAssetsList($('assetsSearch')?.value||'');
  });
  $('assetsFilterBar')?.addEventListener('click',e=>{
    const filterBtn=e.target.closest('[data-filter-col]');
    if(!filterBtn)return;
    e.stopPropagation();
    const already=filterBtn.classList.contains('menu-open');
    closeAssetColumnFilterMenus();
    document.querySelectorAll('.assets-filter-bar [data-filter-col]').forEach(b=>b.classList.remove('menu-open'));
    if(already)return;
    filterBtn.classList.add('menu-open');
    assetsPage=1;
    openAssetColumnFilterMenu(filterBtn.dataset.filterCol,filterBtn);
  });
  $('assetsClearFilters')?.addEventListener('click',()=>{
    assetColumnFilters={}; assetsPage=1; closeAssetColumnFilterMenus();
    renderAssetsList($('assetsSearch')?.value||'');
  });
  $('assetsPageSize')?.addEventListener('change',e=>{assetsPageSize=Number(e.target.value)||10;assetsPage=1;renderAssetsList($('assetsSearch')?.value||'');});
  $('assetsPageButtons')?.addEventListener('click',e=>{
    const btn=e.target.closest('[data-page]'); if(!btn||btn.disabled)return;
    assetsPage=Number(btn.dataset.page)||1;
    renderAssetsList($('assetsSearch')?.value||'');
  });
  $('assetsBulkClose')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkCancel')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkManual')?.addEventListener('click',()=>{$('assetsBulkChooser')?.classList.add('hidden');$('assetsBulkEditor')?.classList.remove('hidden');$('assetsBulkModal')?.querySelector('.bulk-assets-card')?.classList.add('wide');});
  $('assetsBulkImport')?.addEventListener('click',()=>{closeBulkAssetsModal();openAssetsImportModal();});
  $('assetsBulkBack')?.addEventListener('click',()=>{$('assetsBulkEditor')?.classList.add('hidden');$('assetsBulkChooser')?.classList.remove('hidden');$('assetsBulkModal')?.querySelector('.bulk-assets-card')?.classList.remove('wide');});
  $('assetsBulkAddRow')?.addEventListener('click',addBulkRow);
  $('assetsBulkSave')?.addEventListener('click',saveBulkAssets);
  
  $('btnCatalogs')?.addEventListener('click',openAssetCatalogModal);
  $('assetCatalogClose')?.addEventListener('click',closeAssetCatalogModal);
  $('catalogLocations')?.addEventListener('click',e=>{
    const menuBtn=e.target.closest('[data-menu-toggle]');
    if(menuBtn){
      e.stopPropagation();
      const panel=menuBtn.nextElementSibling;
      const wasHidden=panel.classList.contains('hidden');
      document.querySelectorAll('#catalogLocations .mini-menu').forEach(p=>p.classList.add('hidden'));
      if(wasHidden)panel.classList.remove('hidden');
      return;
    }
    const collapseBtn=e.target.closest('[data-collapse-toggle]');
    if(collapseBtn){
      const list=collapseBtn.closest('.location-subsection')?.querySelector('.location-subsection-list');
      list?.classList.toggle('collapsed');
      collapseBtn.classList.toggle('is-collapsed');
    }
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('.location-dc-kebab')&&!e.target.closest('.location-child-kebab'))document.querySelectorAll('#catalogLocations .mini-menu').forEach(p=>p.classList.add('hidden'));
  });
  
  $('assetsSearch')?.addEventListener('input',e=>{assetsPage=1;renderAssetsList(e.target.value);});
  $('assetsTableHead')?.addEventListener('click',e=>{
    const filterBtn=e.target.closest('[data-filter-col]');
    if(filterBtn){
      e.stopPropagation();
      const already=filterBtn.classList.contains('menu-open');
      closeAssetColumnFilterMenus();
      document.querySelectorAll('#assetsTableHead [data-filter-col]').forEach(b=>b.classList.remove('menu-open'));
      if(already)return;
      filterBtn.classList.add('menu-open');
      openAssetColumnFilterMenu(filterBtn.dataset.filterCol,filterBtn);
      return;
    }
    const sortBtn=e.target.closest('[data-sort-col]');
    if(sortBtn){
      const col=sortBtn.dataset.sortCol;
      if(assetSortColumn===col){assetSortDir=assetSortDir==='asc'?'desc':'asc';}
      else{assetSortColumn=col;assetSortDir='asc';}
      renderAssetsList($('assetsSearch')?.value||'');
    }
  });
  $('assetsSelectAll')?.addEventListener('change',e=>{
    document.querySelectorAll('#assetsList [data-asset-select]').forEach(cb=>{cb.checked=e.target.checked;cb.closest('.asset-row')?.classList.toggle('is-selected',e.target.checked);if(e.target.checked)assetSelectedIds.add(cb.dataset.assetSelect);else assetSelectedIds.delete(cb.dataset.assetSelect);});
    updateAssetsBulkBar();
  });
  $('assetsBulkClear')?.addEventListener('click',()=>{assetSelectedIds=new Set();renderAssetsList($('assetsSearch')?.value||'');});
  $('assetsBulkDelete')?.addEventListener('click',bulkDeleteAssets);
  // Dropdown estilizado: o painel escreve no <select> e dispara change; o botão volta a mostrar
  // o rótulo de origem depois de aplicar (o valor é limpo a cada uso).
  [['assetsBulkStatus',v=>bulkChangeAssetStatus(v)],
   ['assetsBulkSubstatus',v=>bulkChangeAssetSubstatus(v)],
   ['assetsBulkLocation',v=>bulkChangeAssetLocation(v)]].forEach(([id,acao])=>{
    bindStyledSelect(id,`${id}Btn`);
    $(id)?.addEventListener('change',e=>{const v=e.target.value;e.target.value='';syncSelectButton(id,`${id}Btn`);if(v)acao(v);});
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.col-filter-panel')&&!e.target.closest('[data-filter-col]')){closeAssetColumnFilterMenus();document.querySelectorAll('#assetsTableHead [data-filter-col], .assets-filter-bar [data-filter-col]').forEach(b=>b.classList.remove('menu-open'));}});
  window.addEventListener('resize',closeAssetColumnFilterMenus);
  $('assetEditCancel')?.addEventListener('click',closeAssetModal);
  $('assetEditCancelTop')?.addEventListener('click',closeAssetModal);
  $('assetEditForm')?.addEventListener('submit',e=>{e.preventDefault();saveAssetForm();});
  $('roomEditorForm')?.addEventListener('submit',e=>{e.preventDefault();saveRoomEditor();});
  $('roomEditorClose')?.addEventListener('click',closeRoomEditor);
  $('roomEditorCancel')?.addEventListener('click',closeRoomEditor);
  $('assetPortsAdd')?.addEventListener('click',()=>{assetEditPorts.push({id:uid('port'),label:`Porta ${assetEditPorts.length+1}`,poe:false});renderAssetPortsEditor();const inputs=document.querySelectorAll('#assetPortsList .asset-port-name');const last=inputs[inputs.length-1];if(last){last.focus();last.select();}});
  $('assetPortsSearch')?.addEventListener('input',e=>{assetPortsQuery=e.target.value||'';renderAssetPortsEditor();});
  $('assetPortsFilter')?.addEventListener('change',e=>{assetPortsFilter=e.target.value||'all';renderAssetPortsEditor();});
  $('assetPortsToggle')?.addEventListener('click',()=>{const section=$('assetStepPortas');setAssetPortsCollapsed(!section?.classList.contains('ports-collapsed'));});
  $('assetWarrantyExpiration')?.addEventListener('input',updateAssetLifecycleBadge);
  $('assetEndOfLife')?.addEventListener('input',updateAssetLifecycleBadge);
  $('assetNotes')?.addEventListener('input',updateAssetNotesCount);
  $('assetPortsExport')?.addEventListener('click',exportAssetPortsXLSX);
  initAssetEditStepNav();
  $('portRangeAdd')?.addEventListener('click',()=>{
    const start=$('portRangeStart').value.trim(), end=$('portRangeEnd').value.trim();
    if(!start||!end){toast('Informe a primeira e a última porta.');return;}
    const range=buildPortRange(start,end);
    if(!range){toast('Não foi possível calcular a sequência. Confira se o padrão das duas portas coincide (ex.: G0/0/1 até G0/0/24).');return;}
    const existing=new Set(expandPortDefs(catalogs.catalogEditorPortDefs).map(p=>p.label));
    const conflicts=range.filter(label=>existing.has(label));
    if(conflicts.length){toast(`Essas portas já existem neste modelo: ${conflicts.slice(0,5).join(', ')}${conflicts.length>5?`... (${conflicts.length} no total)`:''}`);return;}
    catalogs.catalogEditorPortDefs.push({id:uid('portdef'),kind:'range',startLabel:start,endLabel:end,poe:!!$('portRangePoe')?.checked});
    $('portRangeStart').value='';$('portRangeEnd').value='';if($('portRangePoe'))$('portRangePoe').checked=false;
    renderCatalogPortDefsEditor();
  });
  $('portSingleAdd')?.addEventListener('click',()=>{
    const label=$('portSingleName').value.trim();
    if(!label){toast('Informe o nome da porta.');return;}
    const existing=new Set(expandPortDefs(catalogs.catalogEditorPortDefs).map(p=>p.label));
    if(existing.has(label)){toast(`A porta "${label}" já existe neste modelo.`);return;}
    catalogs.catalogEditorPortDefs.push({id:uid('portdef'),kind:'single',label,poe:!!$('portSinglePoe')?.checked});
    $('portSingleName').value='';if($('portSinglePoe'))$('portSinglePoe').checked=false;
    renderCatalogPortDefsEditor();
  });
  $('assetManufacturer')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetType')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetLocation')?.addEventListener('change',()=>refreshAssetRackOptions(''));
  $('assetRack')?.addEventListener('change',updateAssetUFieldsState);
  $('assetModel')?.addEventListener('change',()=>{const modelName=$('assetModel')?.value||'';if(!modelName)return;normalizeAssetCatalogs();const m=state.assetCatalogs.models.find(x=>String(x.name)===String(modelName));if(!m)return;renderAssetCatalogSelects({assetType:m.type||'',assetManufacturer:m.manufacturer||'',assetModel:m.name||''});autoFillPortsFromModelIfEmpty();autoFillPowerFromModelIfEmpty();autoFillWeightFromModelIfEmpty();});
  $('catalogCableTypeSearch')?.addEventListener('input',renderCableTypesCatalog);
  $('catalogCableTypeSearch')?.addEventListener('input',renderBreakoutTypesCatalog);
  $('catalogBreakoutTypeAdd')?.addEventListener('click',async()=>{
    normalizeCableCatalogs();
    const name=await uiPrompt('Ex.: MTP-8 → 4× LC OM4','',{title:'Novo tipo de breakout',label:'Nome',confirmText:'Adicionar'});
    if(name===null)return; const trimmed=name.trim();
    if(!trimmed){toast('Nome não pode ficar vazio.');return;}
    if(state.cableCatalogs.breakoutTypes.some(t=>catalogNormalize(t.name)===catalogNormalize(trimmed))){toast('Já existe um tipo de breakout com esse nome.');return;}
    state.cableCatalogs.breakoutTypes.push({name:trimmed,color:'#2dd4bf',legs:4,lengths:[]});
    save();renderBreakoutTypesCatalog();
  });
  $('catalogTypeSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogManufacturerSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogStatusSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogSubstatusSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogLocationSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogLocationAdd')?.addEventListener('click',addAssetLocation);
  $('catalogModelSearch')?.addEventListener('input',renderAssetCatalogs);
  $('catalogModelManufacturer')?.addEventListener('change',renderAssetCatalogs);
  $('catalogModelType')?.addEventListener('change',renderAssetCatalogs);
  $('catalogModelAdd')?.addEventListener('click',()=>openCatalogEditor('models'));
  $('catalogCableTypeAdd')?.addEventListener('click',async()=>{
    normalizeCableCatalogs();
    const name=await uiPrompt('Digite o nome do novo tipo de cabo.','',{title:'Novo tipo de cabo',label:'Nome',confirmText:'Adicionar'});
    if(name===null)return;
    const trimmed=name.trim();
    if(!trimmed){toast('Nome não pode ficar vazio.');return;}
    if(state.cableCatalogs.types.some(t=>catalogNormalize(t.name)===catalogNormalize(trimmed))){toast('Já existe um tipo de cabo com esse nome.');return;}
    state.cableCatalogs.types.push({name:trimmed,color:'#4f8cff'});
    save(); renderCableTypesCatalog();
  });
  $('catalogEditorSave')?.addEventListener('click',saveCatalogEditor);
  $('catalogEditorCancel')?.addEventListener('click',closeCatalogEditor);
  $('catalogEditorClose')?.addEventListener('click',closeCatalogEditor);
  
  
  $('bayfaceClose')?.addEventListener('click',closeBayface);
  $('bayfaceAssetPickerClose')?.addEventListener('click',closeBayfaceAssetPicker);
  $('bayfaceAssetPickerSearch')?.addEventListener('input',()=>{bayfacePickerPage=1;renderBayfaceAssetPicker();});
  $('bayfaceAssetPickerModal')?.addEventListener('click',e=>{
    const th=e.target.closest('[data-bay-sort]');
    if(th){const k=th.dataset.baySort;bayfacePickerSort=bayfacePickerSort.key===k?{key:k,dir:-bayfacePickerSort.dir}:{key:k,dir:1};bayfacePickerPage=1;renderBayfaceAssetPicker();return;}
    if(e.target.closest('#bayfaceAssetPickerPrev')){bayfacePickerPage--;renderBayfaceAssetPicker();}
    else if(e.target.closest('#bayfaceAssetPickerNext')){bayfacePickerPage++;renderBayfaceAssetPicker();}
  });
  document.addEventListener('click',e=>{
    if(!e.target.closest('#bayfaceFaceToggle'))return;
    bayfaceFace=bayfaceFace==='front'?'rear':'front';
    renderBayface($('bayfaceModal')?.dataset.rackId);
  });
  

  // Bindar os controles do canvas ANTES da renderização do projeto.
  // Isso garante que um erro em renderAll() não deixe os controles mudos.
  setupMinimap();
  setupHeatControl();setupRackTooltip();setupSummaryRefit();setupEnvAdvanced();setupPlantExport();
  setupSidebarToggle();
  setupStructureLockControl();
  setupPropCards(document);

  load();renderAll(false);initHistory(cloud.cloudProjectId);setupPan();setupPropSectionResize();
  // A barra lateral já foi inicializada por setupSidebarToggle().
  $('btnQuickSearch')?.addEventListener('click',openQuickSearch);
  $('quickSearchClose')?.addEventListener('click',closeQuickSearch); $('summaryClose')?.addEventListener('click',closeProjectSummary);
  bindTopSearch();
  
  $('quickSearchInput')?.addEventListener('input',e=>{quickSearchIndex=0;renderQuickSearchResults(e.target.value);});
  $('quickSearchInput')?.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex+1)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='ArrowUp'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex-1+quickSearchItems.length)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='Enter'&&quickSearchItems[quickSearchIndex]){e.preventDefault();activateSearchResult(quickSearchItems[quickSearchIndex].type,quickSearchItems[quickSearchIndex].id);}});
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openQuickSearch();}else if(e.key==='Escape'){if(document.querySelector('.dc-select-panel'))closeStyledSelectPanels();else if($('cableTypeReviewModal')?.classList.contains('open')){cables.pendingCableImportRows=null;closeCableTypeReviewModal();}else if($('pdfReportOptionsModal')?.classList.contains('open'))closePdfReportOptions();else if($('helpModal')?.classList.contains('open'))closeHelpModal();else if($('quickSearchModal')?.classList.contains('open'))closeQuickSearch();else if($('projectSummaryModal')?.classList.contains('open'))closeProjectSummary();else if($('catalogEditorModal')?.classList.contains('open'))closeCatalogEditor();else if($('assetCatalogModal')?.classList.contains('open'))closeAssetCatalogModal();else if($('assetsModal')?.classList.contains('open'))closeAssetsModal();else if($('assetEditModal')?.classList.contains('open'))closeAssetModal();else if($('bayfaceAssetPickerModal')?.classList.contains('open'))closeBayfaceAssetPicker();else if($('bayfaceModal')?.classList.contains('open'))closeBayface();}});
  // Cadeado já foi inicializado por setupStructureLockControl().
  updateStructureControls();
  if($('btnProjects'))$('btnProjects').onclick=async()=>{
    if(cloud.cloudDirty){
      const wantsSave=await uiConfirm('Existem alterações não salvas na nuvem.',{title:'Salvar antes de voltar para Projetos?',confirmText:'Salvar e voltar',cancelText:'Continuar sem salvar'});
      if(wantsSave){ const ok=await saveProjectToCloud(true); if(!ok)return; }
    }
    showDashboard();
  };

  requestAnimationFrame(()=>window.__applyCanvasPan&&window.__applyCanvasPan());
  $('btnBuildRows').onclick=rebuildStructureFromSettings;
  $('btnAddTray').onclick=()=>{ if(structureBlocked())return; const g=geometry(); const y=g.rows.length?g.rows[0].y-80:VIEW_PAD; createIndependentTray(g,g.x0,y,g.x0+Math.max(240,g.scale*3),y); };
  $('btnAddCablePanel')?.addEventListener('click',addCable);
  document.querySelectorAll('[data-cables-tab]').forEach(t=>t.onclick=()=>setCablesTab(t.dataset.cablesTab));
  $('btnAddBreakout')?.addEventListener('click',addBreakout);
  $('breakoutSearch')?.addEventListener('input',e=>{breakouts.query=e.target.value;renderBreakoutsList();});
  $('btnImport').onclick=()=>$('excelInput').click();
  bindStyledSelect('cablesFilter','cablesFilterBtn');$('cablesFilter')?.addEventListener('change',()=>{cables.cablesFilterMode=$('cablesFilter').value;syncSelectButton('cablesFilter','cablesFilterBtn');renderCables();});
  $('cablesSearch')?.addEventListener('input',()=>{cables.cablesSearchQuery=$('cablesSearch').value;renderCables();});
  $('rowsSearch')?.addEventListener('input',()=>{rowsSearchQuery=$('rowsSearch').value;buildRowsPanel();});
  $('cablesBulkDelete')?.addEventListener('click',deleteCablesBulk);
  $('cablesBulkClear')?.addEventListener('click',()=>{cables.cableMultiSelected=[];renderCables();});
  $('cableTypeReviewClose')?.addEventListener('click',()=>{cables.pendingCableImportRows=null;closeCableTypeReviewModal();});
  $('cableTypeReviewCancel')?.addEventListener('click',()=>{cables.pendingCableImportRows=null;closeCableTypeReviewModal();toast('Importação cancelada');});
  $('cableTypeReviewConfirm')?.addEventListener('click',()=>{
    const selected=[...document.querySelectorAll('#cableTypeReviewList [data-cable-type-review]:checked')].map(cb=>cb.dataset.cableTypeReview);
    closeCableTypeReviewModal();
    processCableImportRows(selected);
  });
  $('cablesSelectAll')?.addEventListener('change',e=>{
    const q=cables.cablesSearchQuery.trim().toLowerCase();
    const visible=q?state.cables.filter(c=>cableSearchHaystack(c).includes(q)):state.cables;
    if(e.target.checked){visible.forEach(c=>{if(!cables.cableMultiSelected.includes(c.id))cables.cableMultiSelected.push(c.id);});}
    else{const visibleIds=new Set(visible.map(c=>c.id));cables.cableMultiSelected=cables.cableMultiSelected.filter(id=>!visibleIds.has(id));}
    renderCables();
  });
  $('btnTemplate').onclick=downloadCableTemplate;
  $('btnExportCables').onclick=exportCablesXLSX;
  $('excelInput').onchange=e=>{const f=e.target.files[0];if(f)importCablesXLSX(f);e.target.value='';};
  $('btnTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('btnUndo').onclick=undo; $('btnRedo').onclick=redo;
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}});
  $('btnSave').onclick=async()=>{ save(); await saveProjectToCloud(true); };
  $('autosaveToggle')?.addEventListener('change',e=>setAutosaveEnabled(e.target.checked));
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloud.cloudDirty?'pending':'saved');
  $('btnExport').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.projectName||'data-center')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('btnPdfReport')?.addEventListener('click',openPdfReportOptions);
  $('pdfReportOptionsClose')?.addEventListener('click',closePdfReportOptions);
  $('pdfReportOptionsCancel')?.addEventListener('click',closePdfReportOptions);
  $('pdfReportOptionsForm')?.addEventListener('submit',e=>{
    e.preventDefault();
    const options={
      summary:$('pdfOptSummary')?.checked!==false,
      status:$('pdfOptStatus')?.checked!==false,
      lifecycle:$('pdfOptLifecycle')?.checked!==false,
      cables:$('pdfOptCables')?.checked!==false,
      plant:$('pdfOptPlant')?.checked!==false,
      rackIds:[...document.querySelectorAll('#pdfRacksList [data-pdf-rack]:checked')].map(el=>el.dataset.pdfRack),
    };
    closePdfReportOptions();
    generatePDFReport(options);
  });
  $('pdfRacksSelectAll')?.addEventListener('click',()=>{document.querySelectorAll('#pdfRacksList [data-pdf-rack]').forEach(cb=>cb.checked=true);document.querySelectorAll('#pdfRacksList [data-pdf-room]').forEach(cb=>{cb.checked=true;cb.indeterminate=false;});});
  $('pdfRacksSelectNone')?.addEventListener('click',()=>{document.querySelectorAll('#pdfRacksList [data-pdf-rack]').forEach(cb=>cb.checked=false);document.querySelectorAll('#pdfRacksList [data-pdf-room]').forEach(cb=>{cb.checked=false;cb.indeterminate=false;});});
  $('btnImportProject').onclick=()=>{if(structureBlocked())return;$('projectInput').click();};
  $('projectInput').onchange=e=>{const f=e.target.files[0];if(f&&!isStructureLocked())importProject(f);e.target.value='';};
  $('btnReset').onclick=newProject;
  bindSectionCollapse();
  setupFocusMode();
  $('renameApply').onclick=applyRenameRow;
  $('renameCancel').onclick=closeRenameRowModal;
  $('renameCancelTop').onclick=closeRenameRowModal;
  $('renamePrefix').oninput=updateRenamePreview;
  $('renameStart').oninput=updateRenamePreview;
  $('renamePad').oninput=updateRenamePreview;
  
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('renameRowModal').classList.contains('open'))closeRenameRowModal();});
  window.addEventListener('resize',()=>{render();});
}
startAuth();
