import {
  uid, cloneData, esc, num, $, dateUrgencyLevel, formatAssetDate, catalogNormalize,
  catalogSimilarity, catalogSimilar, catalogKeyLabel, parsePortTemplate, buildPortRange,
  expandPortDefs, totalPortDefsCount, excelColumnLetter, parseImportDate, parseImportNumber
} from './js/utils.js';
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
  connectCrossingsForTray
} from './js/geometry.js';
import {
  buildRouteGraph, calcAutomaticTrayLength, routePointsForAutomatic, routeBetweenRacks,
  manualRouteData, computeRoute, validateManualRouteCandidate, rackNameById, calcCable
} from './js/routing.js';

// --- Supabase authentication -------------------------------------------------
const SUPABASE_URL = 'https://qfkygzzzavtvfupsohxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_t0XfFbIv0NkmC2GorCR7rw_jkif-gBA';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
let appStarted = false;
let authInitialized = false;
let appView = null; // 'dashboard' or 'planner'


let cloudReady = false;
let cloudProjectId = null;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;
let cloudDirty = false;
let cloudStatus = 'saved';
let lastCloudSnapshot = null;
const AUTOSAVE_STORAGE = 'dc-planner-autosave';
let autosaveEnabled = localStorage.getItem(AUTOSAVE_STORAGE) !== 'off';
const ROOM_KEYS=['rackUnits','rackWidth','rackGap','rackDepth','defaultRowGap','lastUToTray','defaultSlack','rows','racks','cables','trays','trayLinks','trayRackLinks','structureLocked','snapToEdges'];
function roomDataFromState(){const data={};ROOM_KEYS.forEach(k=>{data[k]=cloneData(state[k]);});return data;}
function applyRoomData(data){if(!data)return;ROOM_KEYS.forEach(k=>{if(data[k]!==undefined)state[k]=cloneData(data[k]);});state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];normalizeState();}
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
function switchRoom(roomId){ensureRooms();const target=state.rooms.find(r=>r.id===roomId);if(!target)return;if(target.id===state.activeRoomId){updateRoomUI();return;}syncActiveRoom();persistHistoryContext();applyRoomData(target.data);state.activeRoomId=target.id;pan=null;initHistory(cloudProjectId,state.activeRoomId);updateRoomUI();renderAll(false);scheduleCloudSave();toast(`Sala aberta: ${target.name}`);}
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

function projectCloudPayload(){
  syncActiveRoom();
  const copy=cloneData(state);
  copy.schemaVersion=15;
  copy.persistedUi={
    theme:state.theme,
    autosaveEnabled:autosaveEnabled===true
  };
  delete copy.selected; delete copy.multiSelected; delete copy.trayMultiSelected;
  return copy;
}
function projectSnapshotForCloud(){ return JSON.stringify(projectCloudPayload()); }
function setCloudStatus(status){
  cloudStatus=status;
  const el=$('cloudStatus');
  if(!el)return;
  const map={saved:['✓','Salvo na nuvem','saved'],saving:['⟳','Salvando...','saving'],pending:['●','Alterações não salvas','pending'],error:['⚠','Não sincronizado','error']};
  const v=map[status]||map.saved;
  el.textContent=`${v[0]} ${v[1]}`; el.dataset.status=v[2]; el.title=v[1];
}
function updatePlannerProjectName(){
  const el=$('plannerProjectName');
  if(el)el.textContent=String(state.projectName||'Data Center');
}

const ASSET_LOG_FIELDS = {
  name:'Nome', type:'Tipo', manufacturer:'Fabricante', model:'Modelo', assetTag:'Asset Tag', serial:'Serial Number',
  locationType:'Tipo de localização', locationName:'Localização', locationId:'Localização (ID)', stockId:'Estoque', roomId:'Sala', rackId:'Rack',
  uStart:'U inicial', uHeight:'Quantidade de U', status:'Status', substatus:'Substatus', ports:'Portas', powerW:'Potência (W)', weightKg:'Peso (kg)',
  purchaseDate:'Data de compra', warrantyExpiration:'Vencimento da garantia', endOfLife:'Fim de vida (EOL)'
};
const ASSET_LOG_HIDDEN_FIELDS = new Set(['locationId','stockId','roomId']);
function assetLogComparable(v){
  if(v===undefined||v===null||v==='') return null;
  if(typeof v==='object') return JSON.stringify(v);
  return String(v);
}
function assetLogFindStock(id){
  if(!id)return null;
  for(const loc of (state.locations||[])){
    const stock=(loc.stocks||[]).find(s=>String(s.id)===String(id));
    if(stock)return stock;
  }
  return null;
}
function assetLogDisplayValue(field,value,assetContext=null){
  if(value===undefined||value===null||value==='')return '—';
  if(field==='locationType') return String(value)==='stock'?'Estoque':String(value)==='room'?'Sala':String(value);
  if(field==='rackId'){
    const rack=assetRack(value);
    return rack?.name||String(value);
  }
  if(field==='stockId'){
    const stock=assetLogFindStock(value);
    return stock?.name||String(value);
  }
  if(field==='roomId'){
    const room=(state.rooms||[]).find(r=>String(r.id)===String(value));
    return room?.name||String(value);
  }
  if(field==='locationName') return String(value);
  return String(value);
}
function assetLogDiff(oldAsset,newAsset){
  const changes=[];
  for(const key of Object.keys(ASSET_LOG_FIELDS)){
    if(ASSET_LOG_HIDDEN_FIELDS.has(key)) continue;
    if(key==='ports'){
      const oldLabels=(oldAsset?.ports||[]).map(p=>p.label);
      const newLabels=(newAsset?.ports||[]).map(p=>p.label);
      const removed=oldLabels.filter(l=>!newLabels.includes(l));
      const added=newLabels.filter(l=>!oldLabels.includes(l));
      if(!removed.length && !added.length) continue;
      const oldValue=removed.length?`Removida(s): ${removed.join(', ')}`:'—';
      const newValue=added.length?`Adicionada(s): ${added.join(', ')}`:'—';
      changes.push({field:key,field_label:ASSET_LOG_FIELDS[key],old_value:oldValue,new_value:newValue,old_value_raw:oldValue,new_value_raw:newValue});
      continue;
    }
    const before=assetLogComparable(oldAsset?.[key]);
    const after=assetLogComparable(newAsset?.[key]);
    if(before!==after){
      changes.push({
        field:key,
        field_label:ASSET_LOG_FIELDS[key],
        old_value:assetLogDisplayValue(key,before,oldAsset),
        new_value:assetLogDisplayValue(key,after,newAsset),
        old_value_raw:before,
        new_value_raw:after
      });
    }
  }
  return changes;
}
function formatAssetHistoryChange(change,row){
  const field=change?.field||'';
  const oldValue=change?.old_value_raw!==undefined ? change.old_value_raw : change?.old_value;
  const newValue=change?.new_value_raw!==undefined ? change.new_value_raw : change?.new_value;
  return {
    field_label:change?.field_label||ASSET_LOG_FIELDS[field]||field||'Campo',
    old_value:assetLogDisplayValue(field,oldValue,row?.asset_snapshot),
    new_value:assetLogDisplayValue(field,newValue,row?.asset_snapshot)
  };
}
const assetAuditRecent = new Map();
let pendingAssetAuditEntries = [];
function recordAssetAudit({action,asset,before=null,after=null,changes=[]}){
  if(!asset?.id)return false;
  const normalizedChanges=Array.isArray(changes)?changes:[];
  const actionName=String(action);
  // UPDATE sem nenhuma alteração real não deve gerar evento de auditoria.
  if(actionName==='UPDATE' && normalizedChanges.length===0)return false;
  // Evita registros duplicados por duplo clique/duplo submit no mesmo instante.
  const dedupePayload=JSON.stringify({asset_id:String(asset.id),action:actionName,changes:normalizedChanges});
  const dedupeKey=btoa(unescape(encodeURIComponent(dedupePayload)));
  const now=Date.now();
  const last=assetAuditRecent.get(dedupeKey)||0;
  if(now-last<1500)return false;
  assetAuditRecent.set(dedupeKey,now);
  // Fica pendente localmente; só é gravado na nuvem no momento em que o
  // projeto for salvo de fato (autosave ou botão Salvar) — histórico não
  // deve existir sobre um estado que nunca chegou a ser persistido.
  pendingAssetAuditEntries.push({
    action:actionName,
    asset_id:String(asset.id),
    asset_snapshot:cloneData(after||asset||null),
    changes:normalizedChanges,
    changed_at:new Date().toISOString()
  });
  return true;
}
async function flushAssetAuditQueue(){
  if(!pendingAssetAuditEntries.length)return;
  if(!cloudProjectId)return; // projeto ainda não tem id na nuvem; mantém a fila para a próxima tentativa
  const entries=pendingAssetAuditEntries;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user)return;
    const rows=entries.map(e=>({
      project_id:cloudProjectId,
      asset_id:e.asset_id,
      user_id:user.id,
      user_email:user.email||null,
      action:e.action,
      asset_snapshot:e.asset_snapshot,
      changes:e.changes,
      changed_at:e.changed_at
    }));
    const {error}=await supabaseClient.from('asset_change_log').insert(rows);
    if(error)throw error;
    // Remove só as entradas que de fato foram enviadas; se algo novo entrou
    // na fila enquanto o insert estava em andamento, isso permanece pendente.
    pendingAssetAuditEntries=pendingAssetAuditEntries.slice(entries.length);
  }catch(err){
    console.error('Asset audit log flush:',err);
    // mantém a fila intacta para tentar novamente no próximo salvamento
  }
}
function assetHistoryFormatValue(v){
  if(v===null||v===undefined||v==='')return '—';
  return String(v);
}
async function fetchAssetHistory(assetId){
  if(!cloudProjectId)throw new Error('Projeto não está salvo na nuvem.');
  const {data:{user}}=await supabaseClient.auth.getUser();
  if(!user)throw new Error('Sem sessão.');
  const {data,error}=await supabaseClient.from('asset_change_log').select('id,action,asset_id,user_id,user_email,asset_snapshot,changes,changed_at').eq('project_id',cloudProjectId).eq('asset_id',String(assetId)).eq('user_id',user.id).order('changed_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
async function openAssetHistory(assetId){
  const m=$('assetHistoryModal'),list=$('assetHistoryList'),a=state.assets.find(x=>x.id===assetId);
  if(!m||!list||!a)return;
  $('assetHistorySubtitle').textContent=`${a.name||'Asset'} · histórico de alterações`;
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  list.innerHTML='<div class="empty">Carregando histórico...</div>';
  try{
    const rows=await fetchAssetHistory(assetId);
    currentAssetHistoryAssetId=assetId;
    currentAssetHistoryRows=rows;
    if(!rows.length){list.innerHTML='<div class="empty">Nenhuma alteração registrada para este asset.</div>';return;}
    list.innerHTML=rows.map(row=>{
      const changes=Array.isArray(row.changes)?row.changes:[];
      const changeHtml=changes.length?changes.map(c=>{const f=formatAssetHistoryChange(c,row);return `<div class="asset-history-change"><b>${esc(f.field_label)}</b>: <code>${esc(assetHistoryFormatValue(f.old_value))}</code> → <code>${esc(assetHistoryFormatValue(f.new_value))}</code></div>`}).join(''):'<div class="asset-history-change">Registro de criação/remoção sem comparação de campos.</div>';
      const email=row.user_email||row.user_id||'—';
      const actionLabel=row.action==='CREATE'?'Criação':row.action==='UPDATE'?'Alteração':row.action==='DELETE'?'Exclusão':row.action==='RESTORE'?'Restauração':row.action;
      return `<div class="asset-history-item"><div class="asset-history-head"><strong>${esc(actionLabel)}</strong><span>${esc(formatProjectDate(row.changed_at))}</span></div><div class="asset-history-meta"><span>Usuário: ${esc(email)}</span><span class="asset-history-action">${esc(row.action)}</span></div>${changeHtml}</div>`;
    }).join('');
  }catch(err){
    console.error(err);
    if(!cloudProjectId){list.innerHTML=`<div class="empty">Histórico indisponível: você está no modo convidado, sem conexão com a nuvem. Faça login com uma conta pra acompanhar o histórico de alterações.</div>`;}
    else list.innerHTML=`<div class="empty">Não foi possível carregar o histórico. Execute o SQL de migração da v16 no Supabase.</div>`;
  }
}
function closeAssetHistory(){const m=$('assetHistoryModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');currentAssetHistoryAssetId=null;currentAssetHistoryRows=[];}

let currentAssetHistoryAssetId=null;
let currentAssetHistoryRows=[];
async function exportCurrentAssetHistory(){
  if(!currentAssetHistoryAssetId || !currentAssetHistoryRows.length){showToast?.('Nenhum histórico disponível para exportar.');return;}
  const a=state.assets.find(x=>String(x.id)===String(currentAssetHistoryAssetId));
  if(!a)return;
  const rows=[];
  for(const r of currentAssetHistoryRows){
    const changes=Array.isArray(r.changes)&&r.changes.length?r.changes:[null];
    for(const c of changes){
      rows.push({
        'Data/Hora': r.changed_at || '',
        'Usuário': r.user_email || r.user_id || '',
        'Ação': r.action || '',
        'Campo': formatAssetHistoryChange(c,r).field_label,
        'Valor anterior': assetHistoryFormatValue(formatAssetHistoryChange(c,r).old_value),
        'Novo valor': assetHistoryFormatValue(formatAssetHistoryChange(c,r).new_value),
        'Asset ID': String(r.asset_id || a.id),
        'Asset': a.name || '',
        'Asset Tag': a.assetTag || '',
        'Serial Number': a.serial || ''
      });
    }
  }
  const safeName=String(a.assetTag||a.name||a.id||'asset').replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'')||'asset';
  try{
    if(window.XLSX){
      const ws=XLSX.utils.json_to_sheet(rows);
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,'Histórico');
      XLSX.writeFile(wb,`Historico_${safeName}.xlsx`);
    }else{
      const headers=Object.keys(rows[0]||{});
      const csv=[headers,...rows.map(r=>headers.map(h=>r[h]))].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');
      const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`Historico_${safeName}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }
  }catch(err){console.error('Exportar histórico:',err);showToast?.('Não foi possível exportar o histórico.');}
}
function markCloudDirty(){
  const snap=projectSnapshotForCloud();
  cloudDirty=lastCloudSnapshot!==snap;
  if(cloudDirty)setCloudStatus('pending');
  return cloudDirty;
}
function scheduleCloudSave(){
  if(!cloudReady) return;
  markCloudDirty();
  if(!autosaveEnabled) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>saveProjectToCloud(false),900);
}
function updateAutosaveUI(){
  const toggle=$('autosaveToggle');
  const label=$('autosaveLabel');
  if(toggle) toggle.checked=autosaveEnabled;
  if(label) label.textContent=autosaveEnabled?'Autosave':'Autosave';
  if(toggle){
    toggle.title=autosaveEnabled?'Desativar salvamento automático':'Ativar salvamento automático';
    toggle.setAttribute('aria-label',toggle.title);
  }
}
function setAutosaveEnabled(enabled){
  autosaveEnabled=!!enabled;
  localStorage.setItem(AUTOSAVE_STORAGE,autosaveEnabled?'on':'off');
  clearTimeout(cloudSaveTimer);
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloudDirty?'pending':'saved');
  if(autosaveEnabled && cloudReady) scheduleCloudSave();
  toast(autosaveEnabled?'Autosave ativado':'Autosave desativado');
}

async function saveProjectToCloud(showToast=true){
  if(!cloudReady) return false;
  if(!cloudProjectId && !state.projectName) return false;
  if(lastCloudSnapshot===projectSnapshotForCloud() && cloudProjectId){ cloudDirty=false; setCloudStatus('saved'); flushAssetAuditQueue(); return true; }
  setCloudStatus('saving');
  if(cloudSaveInFlight){ cloudSaveQueued=true; return; }
  cloudSaveInFlight=true;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user) return;
    const payload=projectCloudPayload();
    const name=String(state.projectName||'Data Center').trim()||'Data Center';
    let result;
    if(cloudProjectId){
      result=await supabaseClient.from('projects').update({name,data:payload,updated_at:new Date().toISOString()}).eq('id',cloudProjectId).eq('user_id',user.id).select('id').single();
      if(result.error && (result.error.code==='PGRST116' || result.error.code==='22P02')) cloudProjectId=null;
    }
    if(!cloudProjectId){
      result=await supabaseClient.from('projects').insert({user_id:user.id,name,data:payload}).select('id').single();
      if(!result.error) cloudProjectId=result.data.id;
    }
    if(result?.error) throw result.error;
    localStorage.setItem(`${STORAGE}-cloud-id`,cloudProjectId);
    lastCloudSnapshot=projectSnapshotForCloud();
    cloudDirty=false;
    setCloudStatus('saved');
    flushAssetAuditQueue();
    if(showToast) toast('Projeto salvo na nuvem');
    return true;
  }catch(err){
    console.error('Supabase project save:',err);
    cloudDirty=true;
    setCloudStatus('error');
    if(showToast) toast('Não foi possível salvar na nuvem');
    return false;
  }finally{
    cloudSaveInFlight=false;
    if(cloudSaveQueued){cloudSaveQueued=false;scheduleCloudSave();}
  }
}
async function loadProjectFromCloud(projectId=null){
  cloudReady=false;
  try{
    const {data:{user},error:userError}=await supabaseClient.auth.getUser();
    if(userError) throw userError;
    if(!user) throw new Error('Sessão expirada. Faça login novamente.');
    let query=supabaseClient.from('projects').select('id,name,data,updated_at').eq('user_id',user.id);
    if(projectId){
      query=query.eq('id',projectId);
    }else{
      const savedId=localStorage.getItem(`${STORAGE}-cloud-id`);
      if(savedId) query=query.eq('id',savedId);
      query=query.order('updated_at',{ascending:false}).limit(1);
    }
    const {data,error}=await query.maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('Projeto não encontrado ou sem permissão para acessá-lo.');
    const raw=(data.data&&typeof data.data==='object')?data.data:{};

    // Load into a clean project state so stale in-memory values from a previous
    // project cannot contaminate the newly opened project.
    const keepTheme=state.theme;
    const keepCatalogs=(state.assetCatalogs&&typeof state.assetCatalogs==='object')?state.assetCatalogs:null;
    state.rows=[]; state.racks=[]; state.cables=[]; state.trays=[]; state.trayLinks=[]; state.trayRackLinks=[];
    state.assets=[]; state.rooms=[]; state.locations=[]; state.selected=null; state.multiSelected=[]; state.trayMultiSelected=[];
    state.structureLocked=false; state.snapToEdges=true;
    Object.assign(state,cloneData(raw));
    if(!state.assetCatalogs && keepCatalogs) state.assetCatalogs=keepCatalogs;
    if(data.name) state.projectName=data.name;
    if(raw.persistedUi?.theme==='light'||raw.persistedUi?.theme==='dark') state.theme=raw.persistedUi.theme;
    else state.theme=keepTheme;

    // Normalize legacy/current schemas defensively. A malformed optional field
    // must not make the entire project unopenable.
    state.rooms=Array.isArray(state.rooms)?state.rooms:[];
    state.locations=Array.isArray(state.locations)?state.locations:[];
    state.assets=Array.isArray(state.assets)?state.assets:[];
    if(!state.assetCatalogs || typeof state.assetCatalogs!=='object') state.assetCatalogs={types:[...DEFAULT_ASSET_TYPES],manufacturers:[],models:[],statuses:[...DEFAULT_ASSET_STATUSES],substatuses:[...DEFAULT_ASSET_SUBSTATUSES]};
    ensureRooms();
    migrateGlobalAssets();
    let active=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0];
    if(active?.data) applyRoomData(active.data);
    normalizeState();

    cloudProjectId=data.id;
    localStorage.setItem(`${STORAGE}-cloud-id`,cloudProjectId);
    updateRoomUI();
    applyTheme();
    lastCloudSnapshot=projectSnapshotForCloud();
    cloudDirty=false;
    setCloudStatus('saved');
    updatePlannerProjectName();
    return data;
  }catch(err){
    console.error('Supabase project load:',err);
    setCloudStatus('error');
    toast(`Não foi possível abrir o projeto: ${err?.message||'erro desconhecido'}`);
    return null;
  }finally{
    cloudReady=true;
  }
}

async function importProject(file){
  try{
    const text=await file.text();
    let raw;
    try{raw=JSON.parse(text);}catch(_){throw new Error('O arquivo não é um JSON válido.');}
    if(!raw||typeof raw!=='object')throw new Error('Arquivo inválido.');
    const ok=await uiConfirm('O conteúdo atual em edição será substituído pelos dados do arquivo importado.',{title:'Importar projeto?',confirmText:'Importar',danger:true});
    if(!ok)return;

    const keepTheme=state.theme;
    const keepCatalogs=(state.assetCatalogs&&typeof state.assetCatalogs==='object')?state.assetCatalogs:null;
    state.rows=[]; state.racks=[]; state.cables=[]; state.trays=[]; state.trayLinks=[]; state.trayRackLinks=[];
    state.assets=[]; state.rooms=[]; state.locations=[]; state.selected=null; state.multiSelected=[]; state.trayMultiSelected=[];
    state.structureLocked=false; state.snapToEdges=true;
    Object.assign(state,cloneData(raw));
    if(!state.assetCatalogs && keepCatalogs) state.assetCatalogs=keepCatalogs;
    if(raw.persistedUi?.theme==='light'||raw.persistedUi?.theme==='dark') state.theme=raw.persistedUi.theme;
    else state.theme=keepTheme;

    // Normaliza esquemas legados/atuais defensivamente, igual ao carregamento
    // de projetos da nuvem — um campo opcional malformado não pode inviabilizar
    // a importação inteira.
    state.rooms=Array.isArray(state.rooms)?state.rooms:[];
    state.locations=Array.isArray(state.locations)?state.locations:[];
    state.assets=Array.isArray(state.assets)?state.assets:[];
    if(!state.assetCatalogs || typeof state.assetCatalogs!=='object') state.assetCatalogs={types:[...DEFAULT_ASSET_TYPES],manufacturers:[],models:[],statuses:[...DEFAULT_ASSET_STATUSES],substatuses:[...DEFAULT_ASSET_SUBSTATUSES]};
    ensureRooms();
    migrateGlobalAssets();
    let active=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0];
    if(active?.data) applyRoomData(active.data);
    normalizeState();

    pan=null;
    initHistory(cloudProjectId,state.activeRoomId,true);
    updateRoomUI();
    applyTheme();
    renderAll(false);
    cloudDirty=true;
    setCloudStatus('pending');
    scheduleCloudSave();
    updatePlannerProjectName();
    toast('Projeto importado. Revise e salve para manter as alterações.');
  }catch(err){
    console.error('Import project:',err);
    toast(`Não foi possível importar o arquivo: ${err?.message||'erro desconhecido'}`);
  }
}
async function fetchCloudProjects(){
  const {data:{user}}=await supabaseClient.auth.getUser();
  if(!user) return [];
  const {data,error}=await supabaseClient.from('projects').select('id,name,data,created_at,updated_at').eq('user_id',user.id).order('updated_at',{ascending:false});
  if(error) throw error;
  return data||[];
}
function projectStats(project){
  const d=project?.data||{};
  const rooms=Array.isArray(d.rooms)?d.rooms:[];let rows=0,racks=0,cables=0,trays=0;rooms.forEach(r=>{const x=r.data||{};rows+=Array.isArray(x.rows)?x.rows.length:0;racks+=Array.isArray(x.racks)?x.racks.length:0;cables+=Array.isArray(x.cables)?x.cables.length:0;trays+=Array.isArray(x.trays)?x.trays.length:0;});if(!rooms.length){rows=Array.isArray(d.rows)?d.rows.length:0;racks=Array.isArray(d.racks)?d.racks.length:0;cables=Array.isArray(d.cables)?d.cables.length:0;trays=Array.isArray(d.trays)?d.trays.length:0;}return {rooms:rooms.length||1,rows,racks,cables,trays};
}
function formatProjectDate(v){
  if(!v)return 'Sem data';
  try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch(_){return v;}
}
function closeProjectMenus(){document.querySelectorAll('.project-menu-panel').forEach(x=>x.remove());}
function showDashboard(){
  appView='dashboard';
  $('dashboardScreen')?.classList.remove('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','false');
  $('mainTopbar')?.classList.add('hidden'); document.querySelector('.app')?.classList.add('hidden'); $('minimap')?.classList.add('hidden'); $('minimapToggle')?.classList.add('hidden');
  $('dashboardUserEmail').textContent=$('authUserEmail')?.textContent||'';
  renderDashboardProjects();
}
function hideDashboard(){
  appView='planner';
  $('dashboardScreen')?.classList.add('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','true');
  $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden'); $('minimapToggle')?.classList.remove('hidden');
}
async function renderDashboardProjects(){
  const grid=$('projectsGrid'),empty=$('projectsEmpty');
  if(!grid)return;
  grid.innerHTML='<div class="dashboard-loading">Carregando projetos...</div>'; empty?.classList.add('hidden');
  try{
    const projects=await fetchCloudProjects();
    if(!projects.length){grid.innerHTML='';empty?.classList.remove('hidden');return;}
    grid.innerHTML=projects.map(project=>{
      const st=projectStats(project);
      return `<article class="project-card" data-project-card="${esc(project.id)}">
        <div class="project-card-head"><div class="project-icon"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/></svg></div><div><h3 class="project-name">${esc(project.name||'Projeto sem nome')}</h3><div class="project-date">Atualizado ${esc(formatProjectDate(project.updated_at))}</div></div></div>
        <div class="project-stats"><span><b>${st.rooms}</b> sala${st.rooms===1?'':'s'}</span><span><b>${st.rows}</b> fileira${st.rows===1?'':'s'}</span><span><b>${st.racks}</b> rack${st.racks===1?'':'s'}</span><span><b>${st.cables}</b> cabo${st.cables===1?'':'s'}</span><span><b>${st.trays}</b> calha${st.trays===1?'':'s'}</span></div>
        <div class="project-menu"><button class="btn ghost" data-project-menu="${esc(project.id)}" title="Mais opções">⋮</button></div>
        <div class="project-actions"><button class="btn primary" data-project-open="${esc(project.id)}">Abrir</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-project-open]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openCloudProject(b.dataset.projectOpen);}));
    grid.querySelectorAll('[data-project-menu]').forEach(b=>b.addEventListener('click',e=>{
      e.preventDefault(); e.stopPropagation(); closeProjectMenus();
      const project=projects.find(x=>String(x.id)===String(b.dataset.projectMenu));
      if(!project)return;
      const panel=document.createElement('div'); panel.className='project-menu-panel';
      panel.innerHTML='<button type="button" data-action="rename"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Renomear</button>'
        +'<button type="button" data-action="duplicate"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Duplicar</button>'
        +'<button type="button" data-action="export"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 20h14"/></svg>Exportar projeto</button>'
        +'<div class="menu-divider"></div>'
        +'<button type="button" class="danger" data-action="delete"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Excluir</button>';
      document.body.appendChild(panel);
      const r=b.getBoundingClientRect();
      const pw=panel.offsetWidth||190;
      panel.style.left=Math.max(8,Math.min(window.innerWidth-pw-8,r.right-pw))+'px';
      panel.style.top=(r.bottom+6)+'px';
      requestAnimationFrame(()=>panel.classList.add('open'));
      const bindAction=(selector,fn)=>panel.querySelector(selector).addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();fn(project);});
      bindAction('[data-action="rename"]',renameCloudProject);
      bindAction('[data-action="duplicate"]',duplicateCloudProject);
      bindAction('[data-action="export"]',exportCloudProject);
      bindAction('[data-action="delete"]',deleteCloudProject);
    }));
  }catch(err){console.error('Dashboard projects:',err);grid.innerHTML='<div class="dashboard-error">Não foi possível carregar seus projetos. Verifique sua conexão e tente novamente.</div>';}
}
function centerCanvasOnContent(){
  const wrap=$('canvasWrap'),stage=$('canvasStage'),svg=$('layout');
  if(!wrap||!stage||!svg||!state.racks.length)return;
  requestAnimationFrame(()=>{
    const els=[...svg.querySelectorAll('.rack-body, .tray-line')];
    if(!els.length)return;
    let box=null;
    for(const el of els){
      try{const b=el.getBBox(); if(!box)box={x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height}; else {box.x=Math.min(box.x,b.x);box.y=Math.min(box.y,b.y);box.right=Math.max(box.right,b.x+b.width);box.bottom=Math.max(box.bottom,b.y+b.height);}}catch(_){}
    }
    if(!box)return;
    const zoom=window.__canvasPan?.zoom||1;
    const contentCx=(box.x+box.right)/2, contentCy=(box.y+box.bottom)/2;
    const p=window.__canvasPan||(window.__canvasPan={x:0,y:0,zoom:1});
    p.x=wrap.clientWidth/2-contentCx*zoom;
    p.y=wrap.clientHeight/2-contentCy*zoom;
    window.__applyCanvasPan?.();
  });
}

async function openCloudProject(id){
  closeProjectMenus();
  try{
    if(!appStarted){appStarted=true;bind();}
    const project=await loadProjectFromCloud(id);
    if(!project) return;
    hideDashboard();
    renderAll(false);
    initHistory(cloudProjectId);
    centerCanvasOnContent();
    setStructureLock(state.structureLocked,false);
    updateStructureControls();
    toast('Projeto aberto');
  }catch(err){
    console.error('Open project UI:',err);
    toast(`Projeto carregado, mas houve um erro ao montar a interface: ${err?.message||'erro desconhecido'}`);
  }
}
function resetStateForNewProject(name='Data Center'){
  const keepTheme=state.theme;
  state.projectName=name;state.rackUnits=48;state.rackWidth=.60;state.rackDepth=1.20;state.rackGap=0;state.rackPowerCapacityW=0;state.rackWeightCapacityKg=0;state.defaultRowGap=1.20;state.lastUToTray=1.00;state.defaultSlack=10;state.rows=[];state.racks=[];state.cables=[];state.trays=[];state.trayLinks=[];state.trayRackLinks=[];state.assets=[];state.snapToEdges=true;state.assetCatalogs={types:[...DEFAULT_ASSET_TYPES],manufacturers:[],models:[],statuses:[...DEFAULT_ASSET_STATUSES],substatuses:[...DEFAULT_ASSET_SUBSTATUSES]}; state.locations=[];state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];state.theme=keepTheme;state.rooms=[];state.activeRoomId=null;ensureRooms();
  cloudProjectId=null;
  lastCloudSnapshot=null;
  cloudDirty=true;
  setCloudStatus('pending');
  updatePlannerProjectName();
  localStorage.removeItem(`${STORAGE}-cloud-id`);
  normalizeState();
}
async function createNewCloudProject(){
  const name=await uiPrompt('Dê um nome para o novo projeto.','Data Center',{title:'Novo projeto',label:'Nome do projeto',confirmText:'Criar projeto'});
  if(name===null)return;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject(String(name).trim()||'Data Center');
  cloudReady=true;
  await saveProjectToCloud(true);
  renderAll(false);initHistory(cloudProjectId);hideDashboard();toast('Novo projeto criado');
}
async function renameCloudProject(project){
  closeProjectMenus();
  const name=await uiPrompt('Digite o novo nome do projeto.',project.name||'Projeto',{title:'Renomear projeto',label:'Nome do projeto',confirmText:'Salvar'});
  if(name===null)return;
  const next=String(name).trim();if(!next)return;
  try{const {error}=await supabaseClient.from('projects').update({name:next,updated_at:new Date().toISOString()}).eq('id',project.id);if(error)throw error; if(cloudProjectId===project.id){state.projectName=next;updatePlannerProjectName();lastCloudSnapshot=projectSnapshotForCloud();cloudDirty=false;setCloudStatus('saved');} await renderDashboardProjects();toast('Projeto renomeado');}catch(err){console.error(err);toast('Não foi possível renomear o projeto');}
}
async function duplicateCloudProject(project){
  closeProjectMenus();
  try{const {data:{user}}=await supabaseClient.auth.getUser();if(!user)throw new Error('Sem sessão');const copy=cloneData(project.data||{});copy.selected=null;copy.multiSelected=[];copy.trayMultiSelected=[];const name=(project.name||'Projeto')+' — cópia';const {data,error}=await supabaseClient.from('projects').insert({user_id:user.id,name,data:copy}).select('id').single();if(error)throw error;await renderDashboardProjects();toast('Projeto duplicado');}catch(err){console.error(err);toast('Não foi possível duplicar o projeto');}
}
function exportCloudProject(project){
  closeProjectMenus();
  const blob=new Blob([JSON.stringify({...project.data,projectName:project.name},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(project.name||'data-center')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function deleteCloudProject(project){
  closeProjectMenus();
  const ok=await uiConfirm('Esta ação não pode ser desfeita.',{title:`Excluir o projeto "${project.name||'Projeto'}"?`,confirmText:'Excluir projeto',danger:true});
  if(!ok)return;
  try{const {error}=await supabaseClient.from('projects').delete().eq('id',project.id);if(error)throw error;if(cloudProjectId===project.id){cloudProjectId=null;localStorage.removeItem(`${STORAGE}-cloud-id`);}await renderDashboardProjects();toast('Projeto excluído');}catch(err){console.error(err);toast('Não foi possível excluir o projeto');}
}

function authRedirectUrl(){ return window.location.origin + window.location.pathname; }
function authViews(){ return ['authLoginView','authSignupView','authForgotView','authResetView'].map(id=>$(id)).filter(Boolean); }
function showAuthView(id){
  authViews().forEach(v=>v.classList.toggle('hidden',v.id!==id));
  ['loginError','signupMessage','forgotMessage','resetMessage'].forEach(id=>{const e=$(id);if(e)e.textContent='';e?.classList.remove('error','success');});
}
function authMessage(id,text,type=''){ const e=$(id); if(!e)return; e.textContent=text||''; e.classList.remove('error','success'); if(type)e.classList.add(type); }
function setAuthBusy(id,busy,label){ const b=$(id); if(!b)return; b.disabled=busy; if(busy){b.dataset.original=b.textContent;b.textContent='Aguarde...';}else if(b.dataset.original){b.textContent=label||b.dataset.original;} }
function lockApp(){ document.body.classList.add('auth-locked'); $('authScreen')?.classList.remove('hidden'); $('authScreen')?.setAttribute('aria-hidden','false'); }
function enterGuestMode(){
  document.body.classList.add('guest-mode');
  document.body.classList.remove('auth-locked');
  $('authScreen')?.classList.add('hidden'); $('authScreen')?.setAttribute('aria-hidden','true');
  cloudReady=false; cloudProjectId=null;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject('Meu Projeto');
  renderAll(false); initHistory(null); hideDashboard();
  const saveBtn=$('btnSave'); if(saveBtn){saveBtn.disabled=true;saveBtn.title='Indisponível no modo convidado — use Exportar/Importar projeto.';}
  toast('Modo convidado: use Exportar/Importar projeto para salvar seu trabalho.');
}
function unlockApp(user, forceDashboard=false){
  if(user?.id){ STORAGE = `dc-planner-v7-user-${user.id}`; }
  document.body.classList.remove("auth-locked"); $("authScreen")?.classList.add("hidden"); $("authScreen")?.setAttribute("aria-hidden","true");
  // Se o usuário tinha entrado no modo convidado antes e agora fez login de
  // verdade (sem recarregar a página), remove a marca de convidado — senão
  // o botão "Salvar na nuvem" ficaria preso desativado mesmo estando logado.
  document.body.classList.remove('guest-mode');
  const saveBtn=$('btnSave'); if(saveBtn){saveBtn.disabled=false;saveBtn.removeAttribute('title');}
  const e=$("authUserEmail"); if(e)e.textContent=user?.email||"";
  $("dashboardUserEmail").textContent=user?.email||"";
  updatePlannerProjectName();
  if(forceDashboard || !appView) showDashboard();
}

const EYE_PATH='<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF_PATH='<path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.3 6.3C3.9 7.9 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
function bindPasswordToggles(){
  document.querySelectorAll('[data-toggle-password]').forEach(btn=>{
    if(btn.dataset.bound)return;
    btn.dataset.bound='1';
    btn.onclick=()=>{
      const input=$(btn.dataset.togglePassword);
      if(!input)return;
      const showing=input.type==='password';
      input.type=showing?'text':'password';
      btn.setAttribute('aria-pressed',String(showing));
      btn.setAttribute('aria-label',showing?'Ocultar senha':'Mostrar senha');
      btn.querySelector('svg').innerHTML=showing?EYE_OFF_PATH:EYE_PATH;
    };
  });
}

async function startAuth(){
  applyTheme();
  lockApp();
  showAuthView('authLoginView');
  $('btnGuestMode')?.addEventListener('click',enterGuestMode);
  bindPasswordToggles();
  $('dashboardNewProject').onclick=createNewCloudProject; $('dashboardNewProjectEmpty').onclick=createNewCloudProject; $('dashboardLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  $('dashboardTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('authTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem(THEME_STORAGE,state.theme);applyTheme();};
  document.addEventListener('click',e=>{if(!e.target.closest('.project-menu')&&!e.target.closest('.project-menu-panel'))closeProjectMenus();});
  window.addEventListener('resize',closeProjectMenus);
  $('dashboardScreen')?.addEventListener('scroll',closeProjectMenus,true);
  $('showSignup').onclick=()=>showAuthView('authSignupView');
  $('showForgot').onclick=()=>{ $('forgotEmail').value=$('loginEmail')?.value||''; showAuthView('authForgotView'); };
  $('showLoginFromSignup').onclick=()=>showAuthView('authLoginView');
  $('showLoginFromForgot').onclick=()=>showAuthView('authLoginView');
  $('loginForm').onsubmit=async e=>{
    e.preventDefault(); authMessage('loginError',''); setAuthBusy('btnLogin',true);
    const {error}=await supabaseClient.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
    setAuthBusy('btnLogin',false,'Entrar');
    if(error)authMessage('loginError',friendlyAuthError(error),'error');
  };
  $('signupForm').onsubmit=async e=>{
    e.preventDefault(); const email=$('signupEmail').value.trim(),p1=$('signupPassword').value,p2=$('signupPassword2').value;
    if(p1!==p2){authMessage('signupMessage','As senhas não coincidem.','error');return;}
    setAuthBusy('btnSignup',true);
    const {data,error}=await supabaseClient.auth.signUp({email,password:p1,options:{emailRedirectTo:authRedirectUrl()}});
    setAuthBusy('btnSignup',false,'Criar conta');
    if(error){authMessage('signupMessage',friendlyAuthError(error),'error');return;}
    if(data.session)unlockApp(data.user); else authMessage('signupMessage','Conta criada. Verifique seu e-mail para confirmar a conta antes de entrar.','success');
  };
  $('forgotForm').onsubmit=async e=>{
    e.preventDefault(); setAuthBusy('btnForgot',true);
    const {error}=await supabaseClient.auth.resetPasswordForEmail($('forgotEmail').value.trim(),{redirectTo:authRedirectUrl()});
    setAuthBusy('btnForgot',false,'Enviar link');
    if(error)authMessage('forgotMessage',friendlyAuthError(error),'error'); else authMessage('forgotMessage','Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.','success');
  };
  $('resetForm').onsubmit=async e=>{
    e.preventDefault(); const p1=$('resetPassword').value,p2=$('resetPassword2').value;
    if(p1!==p2){authMessage('resetMessage','As senhas não coincidem.','error');return;}
    setAuthBusy('btnResetPassword',true); const {error}=await supabaseClient.auth.updateUser({password:p1});
    setAuthBusy('btnResetPassword',false,'Salvar nova senha');
    if(error)authMessage('resetMessage',friendlyAuthError(error),'error'); else {authMessage('resetMessage','Senha alterada com sucesso. Entrando...','success');setTimeout(()=>supabaseClient.auth.getSession(),700);}
  };
  $('btnLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  $('btnHelp')?.addEventListener('click',openHelpModal);
  $('helpClose')?.addEventListener('click',closeHelpModal);
  document.querySelectorAll('[data-help-section]').forEach(b=>b.onclick=()=>switchHelpSection(b.dataset.helpSection));
  $('canvasEmptyHintClose')?.addEventListener('click',()=>{localStorage.setItem('dccp_hint_dismissed','1');$('canvasEmptyHint')?.classList.add('hidden');});
  $('canvasEmptyHintHelp')?.addEventListener('click',openHelpModal);
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){lockApp();showAuthView('authResetView');return;}
    if(session?.user){ unlockApp(session.user, event==='SIGNED_IN' && !appStarted); } else if(event==='SIGNED_OUT'){ cloudReady=false; cloudProjectId=null; appStarted=false; $('dashboardScreen')?.classList.add('hidden'); $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden'); appView=null; lockApp(); showAuthView('authLoginView'); $('loginPassword').value=''; }
  });
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user)unlockApp(session.user); else { lockApp(); showAuthView('authLoginView'); }
  authInitialized=true;
}
function friendlyAuthError(error){
  const m=String(error?.message||'Erro de autenticação.');
  const low=m.toLowerCase();
  if(low.includes('invalid login credentials'))return 'E-mail ou senha incorretos.';
  if(low.includes('email not confirmed'))return 'Confirme seu e-mail antes de entrar.';
  if(low.includes('password should be at least'))return 'A senha precisa ter pelo menos 6 caracteres.';
  if(low.includes('rate limit'))return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return m;
}

const GLOBAL_STORAGE = 'dc-planner-v7';
let STORAGE = GLOBAL_STORAGE;
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
    clean.push({name,color:/^#[0-9a-fA-F]{6}$/.test(t?.color||'')?t.color:'#4f8cff'});
  });
  state.cableCatalogs.types=clean.length?clean:DEFAULT_CABLE_TYPES.map(t=>({...t}));
}
function cableTypeNames(){normalizeCableCatalogs();return state.cableCatalogs.types.map(t=>t.name);}
function defaultCableType(){normalizeCableCatalogs();return state.cableCatalogs.types[0]?.name||'UTP';}
function cableTypeColor(type){normalizeCableCatalogs();return state.cableCatalogs.types.find(t=>t.name===type)?.color||'var(--route)';}

let pan = null;
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
  if(icon) icon.textContent=state.structureLocked?'🔒':'🔓';
  document.body.classList.toggle('structure-is-locked',state.structureLocked);
  updateStructureControls();
  renderProperties();
  updateStructureControls();
  if(persist) save();
}
function updateStructureControls(){
  const disabled=isStructureLocked();
  ['btnAddTray','btnBuildRows','btnAddRow'].forEach(id=>{const el=$(id);if(el)el.disabled=disabled;});
  document.querySelectorAll('[data-row-name],[data-row-count],[data-row-gap],[data-rename-row],[data-del-row]').forEach(el=>{el.disabled=disabled;el.setAttribute('aria-disabled',String(disabled));});
  document.querySelectorAll('#properties input:not(#cbName):not(#cbType):not(#cbOR):not(#cbOU):not(#cbDR):not(#cbDU):not(#cbSlack), #properties select:not(#cbType):not(#cbOR):not(#cbDR), #properties button#delRack, #properties button#delTray, #properties button#applyBulkRack, #properties button#delSelectedRacks, #properties button#delSelectedTrays').forEach(el=>{el.disabled=disabled;});
  const btn=$('structureLock'), icon=$('structureLockIcon');
  if(btn){btn.classList.toggle('locked',disabled);btn.title=disabled?'Desbloquear estrutura':'Bloquear estrutura';btn.setAttribute('aria-label',btn.title);}
  if(icon)icon.textContent=disabled?'🔒':'🔓';
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
  const icon=light?THEME_ICON_SUN:THEME_ICON_MOON;
  const b=$('btnTheme');
  if(b){ b.innerHTML=icon+' Tema'; b.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const db=$('dashboardTheme'); if(db){ db.innerHTML=icon+' Tema'; db.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const ab=$('authTheme'); if(ab){ ab.innerHTML=icon; ab.title=light?'Alternar para tema escuro':'Alternar para tema claro'; ab.setAttribute('aria-label',ab.title); }
}
function historyContextKey(projectId=cloudProjectId, roomId=state.activeRoomId){
  return `${projectId||'local'}::${roomId||'default'}`;
}
function initHistory(projectId=cloudProjectId, roomId=state.activeRoomId, reset=false){
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
  const currentKey=historyContextKey(cloudProjectId,state.activeRoomId);
  const activeKey=historyContextKey(history.projectId,history.roomId);
  if(currentKey!==activeKey){
    // A room switch is navigation, not an editable action. Persist the room
    // we are leaving, then attach to the destination room's timeline.
    persistHistoryContext();
    initHistory(cloudProjectId,state.activeRoomId);
    return;
  }
  const current=projectSnapshot();
  if(!history.last){
    history.last=current;
    history.projectId=cloudProjectId||null;
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
    (selectionState.selected.type==='cable' && cableIds.has(selectionState.selected.id))
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
}

function toast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>t.classList.remove('show'),1800); }
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
  state.cables.forEach(c=>{c.type=cableTypeNames().includes(c.type)?c.type:defaultCableType();c.via=(c.via||[]).filter(id=>rackIds.has(id));c.originPortId=c.originPortId||null;c.destPortId=c.destPortId||null;c.originPortLabel=String(c.originPortLabel||'');c.destPortLabel=String(c.destPortLabel||'');c.originAssetName=String(c.originAssetName||'');c.destAssetName=String(c.destAssetName||'');});
  if(state.selected?.type==='rack'&&!rackIds.has(state.selected.id))state.selected=null;
  state.multiSelected=Array.isArray(state.multiSelected)?state.multiSelected.filter(id=>rackIds.has(id)):[];
  if(state.selected?.type==='rack' && !state.multiSelected.includes(state.selected.id)) state.multiSelected=[state.selected.id];
  const trayIds=new Set(state.trays.map(t=>t.id));
  state.trayMultiSelected=Array.isArray(state.trayMultiSelected)?state.trayMultiSelected.filter(id=>trayIds.has(id)):[];
  if(state.selected?.type==='tray' && !state.trayMultiSelected.includes(state.selected.id)) state.trayMultiSelected=[state.selected.id];
}
async function rebuildStructureFromSettings(){
  if(structureBlocked())return;
  if(state.rows.length || state.racks.length || state.trays.length){
    const ok=await uiConfirm('Racks e calhas atuais serão recriados do zero usando as configurações atuais. Os cabos serão preservados quando origem e destino continuarem existindo. Você poderá desfazer a reconstrução usando o botão Desfazer.',{title:'Reconstruir estrutura?',confirmText:'Reconstruir'});
    if(!ok)return;
  }

  // Keep cable endpoint references by their physical row/rack slot before rebuilding.
  // This lets cables survive a full structural rebuild even though rack IDs are recreated.
  const oldRows=[...state.rows];
  const oldRacks=[...state.racks];
  const oldRackKey=new Map(oldRacks.map(r=>[r.id,`${oldRows.findIndex(row=>row.id===r.rowId)}:${r.index}`]));
  const oldCables=Array.isArray(state.cables)?JSON.parse(JSON.stringify(state.cables)):[];
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

  normalizeState();
  renderAll();
  // Dupla espera por frame de animação: garante que o navegador já
  // terminou de desenhar os racks novos antes de medir a caixa
  // delimitadora pra centralizar (uma só espera às vezes não é
  // suficiente e a centralização acaba não acontecendo).
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.__fitCanvas?.()));
  const msg=oldTrayCount?`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s); ${oldTrayCount} calha(s) antiga(s) removida(s) e a estrutura foi recriada do zero.`:`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s).`;
  toast(droppedCables?`${msg} ${droppedCables} cabo(s) removido(s) por falta de origem/destino.`:msg);
}

function addRow(rackCount=0,gap=state.defaultRowGap){
  const i=state.rows.length;
  const row={id:uid('row'),name:`Row-${i+1}`,rackCount:0,gap:i===0?0:Math.max(0,gap),depth:Math.max(0.1,num(state.rackDepth,1.20))};
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
function buildRowsPanel(){
  const p=$('rowsPanel'); p.innerHTML='';
  if(!state.rows.length){ p.innerHTML='<div class="empty">Nenhuma fileira. Você pode criar 0 fileiras e adicionar depois.</div>'; return; }
  state.rows.forEach(row=>{
    const d=document.createElement('div'); d.className='row-card';
    const displayName = row.name ? esc(row.name) : '<span class="mini">(sem nome)</span>';
    d.innerHTML=`<div class="row-title"><span>${displayName}</span><div class="row-actions"><button class="iconbtn" data-del-row="${row.id}" title="Excluir fileira">×</button></div></div>
      <div class="grid2"><label>Nome<input data-row-name="${row.id}" value="${esc(row.name)}"></label><label>Racks<input data-row-count="${row.id}" type="number" min="0" max="100" value="${row.rackCount}"></label></div>
      <button class="btn small full" data-rename-row="${row.id}">✎ Renomear racks</button>
      ${state.rows.indexOf(row)>0?`<label>Distância para a fileira anterior (m)<input data-row-gap="${row.id}" type="number" min="0" step="0.01" value="${row.gap||0}"></label>`:''}`;
    p.appendChild(d);
  });
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
        : (rack.name===suffix || rack.name===String(rack.index+1));
      if(wasAuto) rack.name = newName ? `${newName}-${suffix}` : suffix;
    });
    normalizeIndices();
    renderAll();
  });
  p.querySelectorAll('[data-row-count]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;resizeRow(e.dataset.rowCount,num(e.value,0));});
  p.querySelectorAll('[data-row-gap]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;const r=state.rows.find(x=>x.id===e.dataset.rowGap);if(!r)return;r.gap=Math.max(0,num(e.value,0));renderAll();});
  p.querySelectorAll('[data-rename-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();openRenameRowModal(e.dataset.renameRow);});
  p.querySelectorAll('[data-del-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();deleteRow(e.dataset.delRow);});
}

function openRenameRowModal(rowId){
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const racks=racksInRow(rowId); if(!racks.length){toast('Esta fileira não possui racks');return;}
  const rowIndexValue=state.rows.findIndex(r=>r.id===rowId);
  const prefixDefault=`${rowIndexValue+1}0`;
  $('renameRowId').value=rowId;
  $('renamePrefix').value=prefixDefault;
  $('renameStart').value=1;
  $('renamePad').value=0;
  $('renameRowTitle').textContent=`Renomear racks — ${row.name||'Fileira'}`;
  $('renameRowError').textContent='';
  $('renameRowModal').classList.add('open');
  updateRenamePreview();
  setTimeout(()=>{$('renamePrefix').focus();$('renamePrefix').select();},0);
}
function closeRenameRowModal(){$('renameRowModal').classList.remove('open');}
function buildRenameNames(){
  const rowId=$('renameRowId').value;
  const racks=racksInRow(rowId);
  const prefix=$('renamePrefix').value.trim();
  const start=Math.max(0,Math.floor(num($('renameStart').value,1)));
  // 'Zeros à esquerda' is the number of zeros to add before the number,
  // not the total width of the numeric portion. Example: 1 -> 01, 2 -> 001.
  const zeros=Math.max(0,Math.min(6,Math.floor(num($('renamePad').value,0))));
  return racks.map((rack,i)=>{
    const n=String(start+i);
    return `${prefix}${n.padStart(n.length+zeros,'0')}`;
  });
}
function updateRenamePreview(){
  const rowId=$('renameRowId').value;
  const racks=racksInRow(rowId);
  const names=buildRenameNames();
  const currentIds=new Set(racks.map(r=>r.id));
  const duplicate=new Set(names).size!==names.length;
  const existingConflict=state.racks.some(r=>!currentIds.has(r.id)&&names.includes(r.name));
  const err=duplicate?'Os novos nomes possuem duplicidade.':existingConflict?'Um ou mais nomes já estão sendo usados por outro rack.':'';
  const preview=$('renamePreview');
  preview.innerHTML=racks.map((r,i)=>`<div class="rename-preview-row"><span>${esc(r.name)}</span><b>→</b><span>${esc(names[i])}</span></div>`).join('');
  $('renameRowError').textContent=err;
  $('renameApply').disabled=!!err;
}
function applyRenameRow(){
  if(structureBlocked())return;
  const rowId=$('renameRowId').value;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const racks=racksInRow(rowId), names=buildRenameNames();
  const currentIds=new Set(racks.map(r=>r.id));
  if(new Set(names).size!==names.length || state.racks.some(r=>!currentIds.has(r.id)&&names.includes(r.name))){toast('Não foi possível aplicar: nomes duplicados');return;}
  racks.forEach((r,i)=>r.name=names[i]);
  closeRenameRowModal();
  renderAll();
  toast(`${racks.length} racks renomeados`);
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
  if(converted.length)localStorage.setItem(STORAGE,JSON.stringify(state));
}
function createIndependentTray(g,x1,y1,x2,y2){
  if(structureBlocked())return;
  const t={id:uid('tray'),name:`Calha ${state.trays.length+1}`,x1,y1,x2,y2,width:.10};
  state.trays.push(t);state.multiSelected=[];state.trayMultiSelected=[t.id];state.selected={type:'tray',id:t.id};renderAll();toast('Calha independente criada');
}

function render(){
  const svg=$('layout'),stage=$('canvasStage'),g=geometry();
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
  for(let x=0;x<g.w;x+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="${x}" y1="0" x2="${x}" y2="${g.h}"/>`);
  for(let y=0;y<g.h;y+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="0" y1="${y}" x2="${g.w}" y2="${y}"/>`);

  state.rows.forEach((row,ri)=>{
    const cy=rowCenterY(ri,g);
    svg.insertAdjacentHTML('beforeend',`<text class="svg-row" x="${Math.max(8,g.x0-46)}" y="${cy+4}" text-anchor="end">${esc(row.name)}</text>`);
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
    const faceX=vx+5, faceY=vy+5, faceW=Math.max(1,vw-10), faceH=Math.max(1,vh-10);
    const lineY=vy+22;
    const totalU=Math.max(1,Math.floor(num(r.units,state.rackUnits)));
    const usedU=state.assets.filter(a=>a.rackId===r.id).reduce((sum,a)=>sum+Math.max(1,Math.floor(num(a.uHeight,1))),0);
    const pct=Math.min(1,usedU/totalU);
    const utilLevel=pct>=0.85?'high':pct>=0.5?'mid':'low';
    const barX=vx+6, barY=vy+vh-7, barTrackW=Math.max(0,vw-12), barFillW=Math.max(0,barTrackW*pct);
    // As bolinhas de status seguem o consumo elétrico quando o rack tem
    // capacidade cadastrada; sem capacidade definida, caem de volta pro
    // sinal simples de "tem equipamento instalado".
    const powerCapacity=num(r.powerCapacityW,0);
    const rackPowerW=state.assets.filter(a=>a.rackId===r.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
    let ledClass='';
    if(powerCapacity>0){
      ledClass=rackPowerW>powerCapacity?'is-power-high':(rackPowerW/powerCapacity>=0.8?'is-power-mid':'is-on');
    }else if(usedU>0){
      ledClass='is-on';
    }
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><rect class="rack-hit" x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="8"/><rect class="rack-body ${selected?'selected':''}" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="7"/><rect class="rack-face" x="${faceX}" y="${faceY}" width="${faceW}" height="${faceH}" rx="5"/><line class="rack-topline" x1="${vx+8}" y1="${lineY}" x2="${vx+vw-8}" y2="${lineY}"/><circle class="rack-led ${ledClass}" cx="${vx+14}" cy="${vy+13}" r="2"/><circle class="rack-led ${ledClass}" cx="${vx+21}" cy="${vy+13}" r="2"/><rect class="rack-util-track" x="${barX}" y="${barY}" width="${barTrackW}" height="3" rx="1.5"/><rect class="rack-util-fill util-${utilLevel}" x="${barX}" y="${barY}" width="${barFillW}" height="3" rx="1.5"/></g>`);
  });

  // Camada 2: informações dimensionais dos racks.
  // Elas ficam antes das calhas para que a infraestrutura possa passar por cima.
  state.racks.forEach(r=>{
    const q=rackRect(r,g),c=rackCenter(r,g);
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><text class="svg-label" x="${c.x}" y="${q.y+q.h+14}" style="font-size:9px;text-anchor:middle">${r.units}U</text><text class="rack-width-label" x="${c.x}" y="${q.y+q.h+27}" text-anchor="middle">L ${num(r.width,state.rackWidth).toFixed(2)} m</text><text class="rack-depth-label" x="${c.x}" y="${q.y+q.h+40}" text-anchor="middle">P ${num(r.depth,state.rackDepth).toFixed(2)} m</text></g>`);
  });

  // Camada 3: calhas e seus nós. Elas ficam acima das informações dimensionais.
  state.trays.forEach(t=>{
    const selected=state.trayMultiSelected.includes(t.id) || (state.selected?.type==='tray'&&state.selected.id===t.id);
    const len=trayLengthMeters(t,g);
    const mx=(t.x1+t.x2)/2,my=(t.y1+t.y2)/2;
    svg.insertAdjacentHTML('beforeend',`<line data-tray="${t.id}" class="tray-line ${selected?'selected-tray':''}" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"/>`);
    svg.insertAdjacentHTML('beforeend',`<text class="tray-length" x="${mx}" y="${my-8}" text-anchor="middle">${len.toFixed(2)} m</text>`);
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
            toast(`Snap: ${t.name} ↔ ${snap.rack.name} ↔ ${snap.tray.name}`);
          }else{
            state.trayRackLinks.push({trayId:t.id,end:end==='a'?0:1,rackId:snap.rack.id,point:snap.point,connectionKind:snap.connectionKind||'edge',side:snap.side||null,rx:Number.isFinite(snap.rx)?snap.rx:null,ry:Number.isFinite(snap.ry)?snap.ry:null});
            toast(`Snap: ${t.name} ↔ ${snap.rack.name}`);
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
function assetRackRoom(asset){
  const room=assetRoom(asset); if(room)return room;
  if(asset?.rackId){const r=findRackGlobal(asset.rackId);if(r)return state.rooms.find(x=>x.data?.racks?.some(y=>y.id===r.id))||null;}
  return null;
}
function assetOccupancy(asset){
  const start=Math.floor(num(asset.uStart,1)), height=Math.max(1,Math.floor(num(asset.uHeight,1)));
  return {start,end:start+height-1};
}
function isAssetArchived(asset){ return String(asset?.status||'')==='Arquivado'; }
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
  const total=assetsNeedingAttention().length+capacityIssues().length;
  btn.classList.toggle('hidden',total===0);
  if($('alertsCenterCount'))$('alertsCenterCount').textContent=String(total);
}
function updateRoomThermalBadge(){
  const badge=$('roomThermalBadge'); if(!badge)return;
  const room=state.rooms.find(r=>r.id===state.activeRoomId);
  const t=roomThermalLoad(room);
  if(!room||t.capacity<=0){badge.classList.add('hidden');return;}
  badge.classList.remove('hidden');
  badge.className='room-thermal-badge level-'+t.level;
  if($('roomThermalBadgeText'))$('roomThermalBadgeText').textContent=`🌡️ ${t.watts}W de ${t.capacity}W (${t.pct}%)`;
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
      if(watts/powerCap>=0.8) issues.push({kind:'power',label:'Energia',level:watts>powerCap?'high':'mid',rackId:r.id,roomId:room.id,name:r.name,current:watts,capacity:powerCap,unit:'W'});
    }
    const weightCap=num(r.weightCapacityKg,0);
    if(weightCap>0){
      const kg=state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.weightKg,0)),0);
      if(kg/weightCap>=0.8) issues.push({kind:'weight',label:'Carga do piso',level:kg>weightCap?'high':'mid',rackId:r.id,roomId:room.id,name:r.name,current:kg,capacity:weightCap,unit:'kg'});
    }
  });
  (state.rooms||[]).forEach(room=>{
    const t=roomThermalLoad(room);
    if(t.capacity>0 && t.pct>=80) issues.push({kind:'cooling',label:'Refrigeração',level:t.level,roomId:room.id,name:room.name,current:t.watts,capacity:t.capacity,unit:'W'});
  });
  issues.sort((a,b)=>(a.level==='high'?0:1)-(b.level==='high'?0:1));
  return issues;
}
function closeAlertsCenterPanel(){document.querySelectorAll('.alerts-center-panel').forEach(x=>x.remove());}
function openAlertsCenterPanel(anchorBtn){
  closeAlertsCenterPanel();
  const lifecycleIssues=assetsNeedingAttention();
  const capIssues=capacityIssues();
  const KIND_UNIT_LABEL={power:'de energia',weight:'de carga',cooling:'de refrigeração'};
  const panel=document.createElement('div'); panel.className='col-filter-panel alerts-center-panel';
  let body='';
  if(!lifecycleIssues.length && !capIssues.length){
    body='<div class="empty">Nenhum alerta no momento.</div>';
  }else{
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
  renderAssetsList();
}
function assetConflicts(asset, ignoreId=null){
  if(!asset.rackId)return false;
  const a=assetOccupancy(asset);
  return state.assets.some(x=>x.id!==ignoreId && x.rackId===asset.rackId && (()=>{const b=assetOccupancy(x);return a.start<=b.end&&b.start<=a.end;})());
}
function assetAtRackU(rackId,u){
  if(!rackId)return null;
  return state.assets.find(a=>a.rackId===rackId && !isAssetArchived(a) && (()=>{const o=assetOccupancy(a);return u>=o.start&&u<=o.end;})())||null;
}
function cablePortConflict(cable,side,portId){
  if(!portId)return null;
  const field=side==='origin'?'originPortId':'destPortId';
  return state.cables.find(c=>c.id!==cable.id && c[field]===portId && ((side==='origin'?c.originRack:c.destRack)===(side==='origin'?cable.originRack:cable.destRack)))||null;
}
const DEFAULT_ASSET_TYPES=['Servidor','Switch','Storage','PDU','Patch Panel','Firewall','Roteador','Outro'];
const DEFAULT_ASSET_STATUSES=['Arquivado','Instalado','Reservado','Desligado','Estoque'];
const DEFAULT_ASSET_SUBSTATUSES=['Em estoque','Ligado','Desligado','Disposed','Perdido','Retired','Retornado ao Vendor'];
function normalizeAssetCatalogs(){
  const c=state.assetCatalogs&&typeof state.assetCatalogs==='object'?state.assetCatalogs:{};
  const cleanStrings=v=>Array.isArray(v)?[...new Set(v.map(x=>String(x||'').trim()).filter(Boolean))]:[];
  c.types=cleanStrings(c.types);
  c.manufacturers=cleanStrings(c.manufacturers);
  c.statuses=cleanStrings(c.statuses);
  c.substatuses=cleanStrings(c.substatuses);
  state.assets?.forEach(a=>{const ss=String(a?.substatus||'').trim();if(ss&&!c.substatuses.includes(ss))c.substatuses.push(ss);});
  DEFAULT_ASSET_SUBSTATUSES.forEach(x=>{if(!c.substatuses.includes(x))c.substatuses.push(x);});
  state.assets?.forEach(a=>{const st=String(a?.status||'').trim();if(st&&!c.statuses.includes(st))c.statuses.push(st);});
  DEFAULT_ASSET_STATUSES.forEach(x=>{if(!c.statuses.includes(x))c.statuses.push(x);});
  const rawModels=Array.isArray(c.models)?c.models:[];
  const models=[];
  const seen=new Set();
  rawModels.forEach((m,i)=>{
    let name='', manufacturer='';
    if(m&&typeof m==='object'){name=String(m.name||m.model||'').trim();manufacturer=String(m.manufacturer||'').trim();}
    else{name=String(m||'').trim();}
    if(!name)return;
    let type=m&&typeof m==='object'?String(m.type||'').trim():'';
    if(!type){const linked=state.assets?.find(a=>String(a.model||'').toLowerCase()===name.toLowerCase()&&String(a.manufacturer||'').toLowerCase()===manufacturer.toLowerCase());type=linked?.type||'Outro';}
    const key=(name+'|'+manufacturer+'|'+type).toLowerCase();
    if(seen.has(key))return;
    const rawPortDefs=m&&typeof m==='object'&&Array.isArray(m.portDefs)?m.portDefs:null;
    const legacyPortCount=m&&typeof m==='object'?Math.max(0,Math.floor(num(m.portCount,0))):0;
    const portDefs=rawPortDefs?rawPortDefs.filter(d=>d&&d.id&&(d.kind==='range'||d.kind==='single')).map(d=>d.kind==='range'?{id:String(d.id),kind:'range',startLabel:String(d.startLabel||''),endLabel:String(d.endLabel||''),poe:!!d.poe}:{id:String(d.id),kind:'single',label:String(d.label||'Porta'),poe:!!d.poe}):(legacyPortCount?[{id:uid('portdef'),kind:'range',startLabel:'Porta 1',endLabel:`Porta ${legacyPortCount}`,poe:false}]:[]);
    const portCount=totalPortDefsCount(portDefs);
    const powerW=m&&typeof m==='object'?Math.max(0,Math.floor(num(m.powerW,0))):0;
    const weightKg=m&&typeof m==='object'?Math.max(0,num(m.weightKg,0)):0;
    seen.add(key);models.push({id:(m&&typeof m==='object'&&m.id)||uid('model'),name,manufacturer,type,portDefs,portCount,powerW,weightKg});
  });
  c.models=models;
  DEFAULT_ASSET_TYPES.forEach(x=>{if(!c.types.includes(x))c.types.push(x);});
  c.typeColors=(c.typeColors&&typeof c.typeColors==='object')?c.typeColors:{};
  state.assetCatalogs=c;
}
const BAYFACE_TYPE_DEFAULTS={'is-switch':'#4cc9f0','is-storage':'#9b8cff','is-power':'#f3b64d','is-patch':'#5ee0a2','is-security':'#f4748c','is-router':'#78a7ff','is-server':'#6fd38c'};
function defaultBayfaceTypeColor(type){return BAYFACE_TYPE_DEFAULTS[bayfaceAssetTypeClass(type)]||'#6fd38c';}
function bayfaceTypeColor(type){normalizeAssetCatalogs();return state.assetCatalogs.typeColors?.[type]||defaultBayfaceTypeColor(type);}
function setBayfaceTypeColor(type,color){normalizeAssetCatalogs();state.assetCatalogs.typeColors[type]=color;save();if($('bayfaceModal')?.classList.contains('open')){const rid=$('bayfaceModal').dataset.rackId;if(rid)openBayface(rid);}}
function renderCableTypesCatalog(){
  normalizeCableCatalogs();
  const el=$('catalogCableTypes'); if(!el)return;
  const types=state.cableCatalogs.types;
  el.innerHTML=types.map((t,i)=>`<div class="catalog-row"><span title="${esc(t.name)}">${esc(t.name)}</span><div><input type="color" class="catalog-color-swatch" data-cable-type-color="${i}" value="${esc(t.color)}" title="Cor deste tipo"><button type="button" class="iconbtn" data-cable-type-edit="${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-cable-type-delete="${i}" title="Excluir">×</button></div></div>`).join('')||'<div class="empty">Nenhum tipo cadastrado.</div>';
  el.querySelectorAll('[data-cable-type-color]').forEach(inp=>{
    inp.oninput=()=>{types[Number(inp.dataset.cableTypeColor)].color=inp.value;};
    inp.onchange=()=>{save();renderCables();render();};
  });
  el.querySelectorAll('[data-cable-type-edit]').forEach(btn=>btn.onclick=async()=>{
    const idx=Number(btn.dataset.cableTypeEdit); const oldName=types[idx].name;
    const newName=await uiPrompt('Digite o novo nome do tipo de cabo.',oldName,{title:'Renomear tipo de cabo',label:'Nome',confirmText:'Salvar'});
    if(newName===null)return;
    const trimmed=newName.trim();
    if(!trimmed){toast('Nome não pode ficar vazio.');return;}
    if(types.some((t,j)=>j!==idx&&catalogNormalize(t.name)===catalogNormalize(trimmed))){toast('Já existe um tipo de cabo com esse nome.');return;}
    types[idx].name=trimmed;
    state.cables.forEach(c=>{if(c.type===oldName)c.type=trimmed;});
    save();renderAll();renderCableTypesCatalog();
  });
  el.querySelectorAll('[data-cable-type-delete]').forEach(btn=>btn.onclick=async()=>{
    const idx=Number(btn.dataset.cableTypeDelete);
    if(types.length<=1){toast('Mantenha ao menos um tipo de cabo.');return;}
    const removed=types[idx].name;
    const inUse=state.cables.filter(c=>c.type===removed).length;
    const ok=await uiConfirm(inUse?`${inUse} cabo(s) usam esse tipo e passarão a usar o primeiro tipo restante da lista.`:'',{title:`Excluir "${removed}"?`,confirmText:'Excluir',danger:true});
    if(!ok)return;
    types.splice(idx,1);
    state.cables.forEach(c=>{if(!cableTypeNames().includes(c.type))c.type=defaultCableType();});
    save();renderAll();renderCableTypesCatalog();
  });
}
function renderAssetCatalogs(){
  normalizeAssetCatalogs();
  const typeEl=$('catalogTypes'), manEl=$('catalogManufacturers'), statusEl=$('catalogStatuses'), substatusEl=$('catalogSubstatuses'), modelEl=$('catalogModels');
  const typeQ=String($('catalogTypeSearch')?.value||'').toLowerCase().trim();
  const manQ=String($('catalogManufacturerSearch')?.value||'').toLowerCase().trim();
  const statusQ=String($('catalogStatusSearch')?.value||'').toLowerCase().trim();
  const substatusQ=String($('catalogSubstatusSearch')?.value||'').toLowerCase().trim();
  const modelQ=String($('catalogModelSearch')?.value||'').toLowerCase().trim();
  const selectedType=$('catalogModelType')?.value||'';
  const selectedManufacturer=$('catalogModelManufacturer')?.value||'';
  if(typeEl){
    const values=(state.assetCatalogs.types||[]).filter(v=>!typeQ||v.toLowerCase().includes(typeQ));
    typeEl.innerHTML=values.length?values.map(v=>{const i=state.assetCatalogs.types.indexOf(v);return `<div class="catalog-row"><span title="${esc(v)}">${esc(v)}</span><div><input type="color" class="catalog-color-swatch" data-catalog-color="${esc(v)}" value="${bayfaceTypeColor(v)}" title="Cor deste tipo no Bayface"><button type="button" class="iconbtn" data-catalog-edit="types:${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-delete="types:${i}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhum tipo encontrado.</div>';
  }
  if(manEl){
    const values=(state.assetCatalogs.manufacturers||[]).filter(v=>!manQ||v.toLowerCase().includes(manQ));
    manEl.innerHTML=values.length?values.map(v=>{const i=state.assetCatalogs.manufacturers.indexOf(v);return `<div class="catalog-row"><span title="${esc(v)}">${esc(v)}</span><div><button type="button" class="iconbtn" data-catalog-edit="manufacturers:${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-delete="manufacturers:${i}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhum fabricante encontrado.</div>';
  }
  if(statusEl){
    const values=(state.assetCatalogs.statuses||[]).filter(v=>!statusQ||v.toLowerCase().includes(statusQ));
    statusEl.innerHTML=values.length?values.map(v=>{const i=state.assetCatalogs.statuses.indexOf(v);return `<div class="catalog-row"><span title="${esc(v)}">${esc(v)}</span><div><button type="button" class="iconbtn" data-catalog-edit="statuses:${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-delete="statuses:${i}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhum status encontrado.</div>';
  }
  if(substatusEl){
    const values=(state.assetCatalogs.substatuses||[]).filter(v=>!substatusQ||v.toLowerCase().includes(substatusQ));
    substatusEl.innerHTML=values.length?values.map(v=>{const i=state.assetCatalogs.substatuses.indexOf(v);return `<div class="catalog-row"><span title="${esc(v)}">${esc(v)}</span><div><button type="button" class="iconbtn" data-catalog-edit="substatuses:${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-delete="substatuses:${i}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhum substatus encontrado.</div>';
  }
  if(modelEl){
    const values=(state.assetCatalogs.models||[]).filter(m=>(!selectedType||m.type===selectedType)&&(!selectedManufacturer||m.manufacturer===selectedManufacturer)&&(!modelQ||`${m.name} ${m.manufacturer} ${m.type}`.toLowerCase().includes(modelQ)));
    modelEl.innerHTML=values.length?values.map(m=>`<div class="catalog-row"><div class="catalog-model-info"><span title="${esc(m.name)}">${esc(m.name)}</span><small>${esc(m.type||'Outro')} · ${esc(m.manufacturer||'Sem fabricante')}${m.portCount?` · ${m.portCount} portas`:''}${m.powerW?` · ${m.powerW}W`:''}${m.weightKg?` · ${m.weightKg}kg`:''}</small></div><div><button type="button" class="iconbtn" data-catalog-model-edit="${esc(m.id)}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-model-delete="${esc(m.id)}" title="Excluir">×</button></div></div>`).join(''):'<div class="empty">Nenhum modelo encontrado.</div>';
  }
  const locEl=$('catalogLocations');
  if(locEl){
    normalizeLocations();
    const locQ=String($('catalogLocationSearch')?.value||'').toLowerCase().trim();
    const filtered=state.locations.map(l=>{
      const rooms=(l.rooms||[]).map(rid=>state.rooms.find(r=>r.id===rid)).filter(Boolean);
      const stocks=l.stocks||[];
      const locMatch=!locQ||l.name.toLowerCase().includes(locQ)||rooms.some(r=>r.name.toLowerCase().includes(locQ))||stocks.some(st=>st.name.toLowerCase().includes(locQ));
      if(!locMatch)return null;
      return {l,rooms,stocks};
    }).filter(Boolean);
    locEl.innerHTML=filtered.map(({l,rooms,stocks})=>{
      const roomRows=rooms.filter(r=>!locQ||r.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(r=>{
        const t=roomThermalLoad(r);
        const cap=t.capacity>0?`<small class="location-child-capacity cap-${t.level}">${t.watts}W / ${t.capacity}W</small>`:'';
        return `<div class="location-child-row"><span class="location-child-icon room">🚪</span><span class="location-child-name">${esc(r.name)}</span>${cap}<div class="location-child-actions"><button type="button" class="iconbtn" data-location-room-edit="${esc(r.id)}" title="Editar sala">✎</button><button type="button" class="iconbtn danger-icon" data-location-room-delete="${esc(r.id)}" title="Excluir sala">×</button></div></div>`;
      }).join('');
      const stockRows=stocks.filter(st=>!locQ||st.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(st=>`<div class="location-child-row"><span class="location-child-icon stock">📦</span><span class="location-child-name">${esc(st.name)}</span><div class="location-child-actions"><button type="button" class="iconbtn" data-location-stock-edit="${esc(l.id)}:${esc(st.id)}" title="Editar estoque">✎</button><button type="button" class="iconbtn danger-icon" data-location-stock-delete="${esc(l.id)}:${esc(st.id)}" title="Excluir estoque">×</button></div></div>`).join('');
      return `<div class="location-group">
        <div class="location-dc-row">
          <div class="location-dc-info"><span class="location-dc-icon">📍</span><div><strong>${esc(l.name)}</strong><small>${rooms.length} sala${rooms.length===1?'':'s'} · ${stocks.length} estoque${stocks.length===1?'':'s'}</small></div></div>
          <div class="location-dc-actions">
            <button type="button" class="iconbtn" data-location-room="${esc(l.id)}" title="Adicionar sala em ${esc(l.name)}">🚪＋</button>
            <button type="button" class="iconbtn" data-location-stock="${esc(l.id)}" title="Adicionar estoque em ${esc(l.name)}">📦＋</button>
            <button type="button" class="iconbtn" data-location-edit="${esc(l.id)}" title="Renomear">✎</button>
            <button type="button" class="iconbtn danger-icon" data-location-delete="${esc(l.id)}" title="Excluir Data Center">×</button>
          </div>
        </div>
        ${roomRows||stockRows?`<div class="location-children">${roomRows}${stockRows}</div>`:''}
      </div>`;
    }).join('')||'<div class="empty">Nenhuma localização encontrada.</div>';
  }
  document.querySelectorAll('[data-location-edit]').forEach(b=>b.onclick=()=>renameAssetLocation(b.dataset.locationEdit));
  document.querySelectorAll('[data-location-delete]').forEach(b=>b.onclick=()=>deleteAssetLocation(b.dataset.locationDelete));
  document.querySelectorAll('[data-location-stock]').forEach(b=>b.onclick=()=>addAssetStock(b.dataset.locationStock));
  document.querySelectorAll('[data-location-room]').forEach(b=>b.onclick=()=>addAssetRoom(b.dataset.locationRoom));
  document.querySelectorAll('[data-location-room-edit]').forEach(b=>b.onclick=()=>openRoomEditor(b.dataset.locationRoomEdit));
  document.querySelectorAll('[data-location-room-delete]').forEach(b=>b.onclick=()=>deleteAssetRoom(b.dataset.locationRoomDelete));
  document.querySelectorAll('[data-location-stock-edit]').forEach(b=>b.onclick=()=>renameAssetStock(...b.dataset.locationStockEdit.split(':')));
  document.querySelectorAll('[data-location-stock-delete]').forEach(b=>b.onclick=()=>deleteAssetStock(...b.dataset.locationStockDelete.split(':')));
  document.querySelectorAll('[data-catalog-edit]').forEach(b=>b.onclick=()=>openCatalogEditor(...b.dataset.catalogEdit.split(':')));
  document.querySelectorAll('[data-catalog-delete]').forEach(b=>b.onclick=()=>deleteCatalogItem(...b.dataset.catalogDelete.split(':')));
  document.querySelectorAll('[data-catalog-color]').forEach(inp=>inp.oninput=()=>setBayfaceTypeColor(inp.dataset.catalogColor,inp.value));
  document.querySelectorAll('[data-catalog-model-edit]').forEach(b=>b.onclick=()=>openCatalogEditor('models',b.dataset.catalogModelEdit));
  document.querySelectorAll('[data-catalog-model-delete]').forEach(b=>b.onclick=()=>deleteModelCatalogItem(b.dataset.catalogModelDelete));
  document.querySelectorAll('[data-catalog-add]').forEach(b=>b.onclick=()=>openCatalogEditor(b.dataset.catalogAdd));
}
async function addAssetRoom(locationId){
  normalizeLocations(); const loc=state.locations.find(x=>x.id===locationId); if(!loc)return;
  const name=await uiPrompt(`Dê um nome para a nova sala em ${loc.name}.`,'Sala '+(loc.rooms.length+1),{title:'Nova sala',label:'Nome da sala',confirmText:'Criar sala'}); if(!name?.trim())return;
  const n=name.trim(); if(loc.rooms.some(id=>{const r=state.rooms.find(x=>x.id===id);return r&&catalogNormalize(r.name)===catalogNormalize(n)})){toast('Essa sala já existe nessa localização.');return;}
  const base={rackUnits:state.rackUnits,rackWidth:state.rackWidth,rackGap:state.rackGap,rackDepth:state.rackDepth,defaultRowGap:state.defaultRowGap,lastUToTray:state.lastUToTray,defaultSlack:state.defaultSlack,rows:[],racks:[],cables:[],trays:[],trayLinks:[],trayRackLinks:[],structureLocked:false,snapToEdges:true};
  const room={id:uid('room'),name:n,locationId:loc.id,coolingCapacityW:0,data:base,updatedAt:new Date().toISOString()}; state.rooms.push(room); loc.rooms.push(room.id); save(); renderAssetCatalogs(); updateRoomUI(); toast('Sala criada');
}
function roomThermalLoad(room){
  if(!room)return {watts:0,capacity:0,pct:null,level:'none'};
  const watts=state.assets.filter(a=>a.roomId===room.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
  const capacity=num(room.coolingCapacityW,0);
  const pct=capacity>0?Math.round(watts/capacity*100):null;
  const level=capacity<=0?'none':(watts>capacity?'high':pct>=80?'mid':'low');
  return {watts,capacity,pct,level};
}
function renderRoomEditorThermalReadout(room){
  const el=$('roomEditorThermalReadout'); if(!el)return;
  const t=roomThermalLoad(room);
  el.className='rack-power-readout power-'+t.level;
  el.textContent=`Carga térmica estimada: ${t.watts}W${t.capacity>0?` de ${t.capacity}W (${t.pct}%)`:''}`;
}
function openRoomEditor(roomId){
  const room=state.rooms.find(r=>r.id===roomId); if(!room)return;
  $('roomEditorId').value=room.id;
  $('roomEditorName').value=room.name;
  $('roomEditorCooling').value=room.coolingCapacityW>0?room.coolingCapacityW:'';
  renderRoomEditorThermalReadout(room);
  const m=$('roomEditorModal'); m.classList.add('open'); m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>$('roomEditorName')?.focus());
}
function closeRoomEditor(){const m=$('roomEditorModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function saveRoomEditor(){
  const roomId=$('roomEditorId').value;
  const room=state.rooms.find(r=>r.id===roomId); if(!room)return;
  const name=$('roomEditorName').value.trim();
  if(!name){toast('Nome da sala é obrigatório.');return;}
  const loc=state.locations.find(l=>l.id===room.locationId);
  if(loc && loc.rooms.some(id=>id!==room.id)){
    const dup=loc.rooms.some(id=>{const r=state.rooms.find(x=>x.id===id);return r&&r.id!==room.id&&catalogNormalize(r.name)===catalogNormalize(name)});
    if(dup){toast('Essa sala já existe nessa localização.');return;}
  }
  room.name=name;
  room.coolingCapacityW=Math.max(0,num($('roomEditorCooling').value,0));
  room.updatedAt=new Date().toISOString();
  save(); renderAssetCatalogs(); updateRoomUI(); updateRoomThermalBadge(); closeRoomEditor(); toast('Sala atualizada');
}
async function deleteAssetRoom(roomId){
  const room=state.rooms.find(r=>r.id===roomId);if(!room)return;
  if(state.rooms.length<=1){toast('O projeto precisa ter pelo menos uma sala.');return;}
  if(state.assets.some(a=>a.roomId===roomId)){toast('Esta sala está sendo usada por assets.');return;}
  const ok=await uiConfirm(`Racks, calhas e cabos da sala "${room.name}" serão excluídos.`,{title:'Excluir sala?',confirmText:'Excluir sala',danger:true});
  if(!ok)return;
  const idx=state.rooms.findIndex(r=>r.id===roomId); if(idx<0)return; const loc=state.locations.find(l=>l.id===room.locationId); if(loc)loc.rooms=loc.rooms.filter(id=>id!==roomId); state.rooms.splice(idx,1); if(state.activeRoomId===roomId){state.activeRoomId=loc?.rooms?.map(id=>state.rooms.find(r=>r.id===id)).find(Boolean)?.id||state.rooms[0].id;applyRoomData(state.rooms.find(r=>r.id===state.activeRoomId).data);}
  save();renderAssetCatalogs();updateRoomUI();renderAll(false);toast('Sala excluída');
}
async function addAssetLocation(){normalizeLocations();const name=await uiPrompt('Dê um nome para o novo Data Center / localização.','DC AZ2',{title:'Nova localização',label:'Nome do Data Center',confirmText:'Criar localização'});if(!name?.trim())return;const n=name.trim();if(state.locations.some(l=>catalogNormalize(l.name)===catalogNormalize(n))){toast('Essa localização já existe.');return;}state.locations.push({id:uid('loc'),name:n,rooms:[],stocks:[{id:uid('stock'),name:'Estoque Principal'}]});save();renderAssetCatalogs();toast('Localização criada');}
async function renameAssetLocation(id){const l=state.locations.find(x=>x.id===id);if(!l)return;const name=await uiPrompt('Digite o novo nome da localização.',l.name,{title:'Renomear localização',label:'Nome do Data Center',confirmText:'Salvar'});if(!name?.trim())return;l.name=name.trim();save();renderAssetCatalogs();renderAssetsList();}
async function deleteAssetLocation(id){
  normalizeLocations();
  const loc=state.locations.find(x=>x.id===id);
  if(!loc)return;
  const assets=state.assets.filter(a=>a.locationId===id);
  if(assets.length){toast(`Não é possível excluir \"${loc.name}\": existem ${assets.length} asset(s) nesta localização.`);return;}
  const roomIds=new Set(loc.rooms||[]);
  const remainingRoomCount=(state.rooms||[]).filter(r=>!roomIds.has(r.id)).length;
  if(remainingRoomCount<1){toast('Não é possível excluir este Data Center porque o sistema precisa manter pelo menos uma sala.');return;}
  const roomNames=(state.rooms||[]).filter(r=>roomIds.has(r.id)).map(r=>r.name).join(', ');
  const stockCount=(loc.stocks||[]).length;
  const detail=[];
  if(roomNames)detail.push(`salas: ${roomNames}`);
  if(stockCount)detail.push(`estoques: ${stockCount}`);
  const ok=await uiConfirm(`${detail.join(' · ')} serão removidos.`,{title:`Excluir o Data Center "${loc.name}"?`,confirmText:'Excluir localização',danger:true});
  if(!ok)return;
  state.rooms=state.rooms.filter(r=>!roomIds.has(r.id));
  state.locations=state.locations.filter(x=>x.id!==id);
  if(roomIds.has(state.activeRoomId)){
    const next=state.rooms[0];
    if(next){state.activeRoomId=next.id;applyRoomData(next.data);}
  }
  save();
  renderAssetCatalogs();
  renderAssetsList($('assetsSearch')?.value||'');
  updateRoomUI();
  renderAll(false);
  toast(`Data Center \"${loc.name}\" excluído.`);
}
async function addAssetStock(locationId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const name=await uiPrompt(`Dê um nome para o novo estoque em ${l.name}.`,'Estoque '+(l.stocks.length+1),{title:'Novo estoque',label:'Nome do estoque',confirmText:'Criar estoque'});if(!name?.trim())return;const n=name.trim();if(l.stocks.some(s=>catalogNormalize(s.name)===catalogNormalize(n))){toast('Esse estoque já existe nessa localização.');return;}l.stocks.push({id:uid('stock'),name:n});save();renderAssetCatalogs();toast('Estoque criado');}
async function renameAssetStock(locationId,stockId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const st=l.stocks.find(x=>x.id===stockId);if(!st)return;const name=await uiPrompt(`Digite o novo nome do estoque em ${l.name}.`,st.name,{title:'Renomear estoque',label:'Nome do estoque',confirmText:'Salvar'});if(!name?.trim())return;const n=name.trim();if(l.stocks.some(s=>s.id!==stockId&&catalogNormalize(s.name)===catalogNormalize(n))){toast('Esse estoque já existe nessa localização.');return;}st.name=n;save();renderAssetCatalogs();renderAssetsList($('assetsSearch')?.value||'');renderAssetCatalogSelects();toast('Estoque atualizado');}
async function deleteAssetStock(locationId,stockId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const st=l.stocks.find(x=>x.id===stockId);if(!st)return;if(state.assets.some(a=>a.locationId===locationId&&a.stockId===stockId)){toast('Este estoque está sendo usado por assets.');return;}const ok=await uiConfirm('',{title:`Excluir o estoque "${st.name}"?`,confirmText:'Excluir estoque',danger:true});if(!ok)return;l.stocks=l.stocks.filter(x=>x.id!==stockId);if(!l.stocks.length)l.stocks.push({id:uid('stock'),name:'Estoque Principal'});save();renderAssetCatalogs();}
function openAssetCatalogModal(){normalizeAssetCatalogs();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderCableTypesCatalog();const m=$('assetCatalogModal');if(!m)return;m.classList.remove('locations-only');$('assetCatalogTitle').textContent='Cadastros';m.querySelector('.catalog-modal-head span').textContent='Tipos de ativo, fabricantes, modelos, status, substatus, tipos de cabo e localizações usados no sistema.';m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
function openLocationsModal(){normalizeLocations();renderAssetCatalogs();const m=$('assetCatalogModal');if(!m)return;m.classList.add('locations-only');$('assetCatalogTitle').textContent='Localizações';m.querySelector('.catalog-modal-head span').textContent='Gerencie Data Centers, salas e estoques.';m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
function closeAssetCatalogModal(){const m=$('assetCatalogModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');closeCatalogEditor();}
function renderAssetCatalogManufacturerSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelManufacturer');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os fabricantes</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.manufacturers.includes(current)?current:'';
}
function renderAssetCatalogTypeSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelType');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os tipos</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.types.includes(current)?current:'';
}
let catalogEditorPortDefs=[];
function renderCatalogPortDefsEditor(){
  const list=$('catalogPortDefsList'); if(!list)return;
  const total=totalPortDefsCount(catalogEditorPortDefs);
  if($('catalogPortDefsTotal'))$('catalogPortDefsTotal').textContent=total;
  list.innerHTML=catalogEditorPortDefs.length?catalogEditorPortDefs.map(def=>{
    if(def.kind==='range'){
      const range=buildPortRange(def.startLabel,def.endLabel);
      const count=range?range.length:0;
      return `<div class="port-def-row"><div><b>${esc(def.startLabel)} – ${esc(def.endLabel)}</b><small>${count} porta${count===1?'':'s'}${def.poe?' · PoE':''}${!range?' · padrão inválido':''}</small></div><button type="button" class="iconbtn danger-icon" data-portdef-remove="${esc(def.id)}" title="Remover">×</button></div>`;
    }
    return `<div class="port-def-row"><div><b>${esc(def.label)}</b><small>1 porta${def.poe?' · PoE':''}</small></div><button type="button" class="iconbtn danger-icon" data-portdef-remove="${esc(def.id)}" title="Remover">×</button></div>`;
  }).join(''):'<div class="empty">Nenhuma porta definida ainda.</div>';
  list.querySelectorAll('[data-portdef-remove]').forEach(b=>b.onclick=()=>{catalogEditorPortDefs=catalogEditorPortDefs.filter(d=>d.id!==b.dataset.portdefRemove);renderCatalogPortDefsEditor();});
}
function openCatalogEditor(key,id=null){
  normalizeAssetCatalogs(); const m=$('catalogEditorModal'); if(!m)return;
  $('catalogEditorKind').value=key; $('catalogEditorId').value=id||'';
  const title=$('catalogEditorTitle'), subtitle=$('catalogEditorSubtitle'), typeWrap=$('catalogEditorTypeWrap'), manWrap=$('catalogEditorManufacturerWrap'), portsWrap=$('catalogEditorPortsWrap'), powerWrap=$('catalogEditorPowerWrap'), weightWrap=$('catalogEditorWeightWrap');
  const isModel=key==='models';
  const isStatus=key==='statuses';
  let item=null;
  if(id){item=isModel?state.assetCatalogs.models.find(x=>x.id===id):state.assetCatalogs[key]?.[Number(id)];}
  title.textContent=id?(isModel?'Editar modelo':`Editar ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`):(isModel?'Novo modelo':`Novo ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`);
  subtitle.textContent=isModel?'Defina o tipo e o fabricante ao qual este modelo pertence.':'Cadastre um valor que poderá ser usado no inventário.';
  $('catalogEditorName').value=isModel?(item?.name||''):(item||'');
  typeWrap.classList.toggle('hidden',!isModel);manWrap.classList.toggle('hidden',!isModel);portsWrap?.classList.toggle('hidden',!isModel);powerWrap?.classList.toggle('hidden',!isModel);weightWrap?.classList.toggle('hidden',!isModel);
  if(isModel){
    $('catalogEditorType').innerHTML=state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorManufacturer').innerHTML='<option value="">Selecione o fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorType').value=item?.type||state.assetCatalogs.types[0]||'';
    $('catalogEditorManufacturer').value=item?.manufacturer||'';
    if($('catalogEditorPowerW'))$('catalogEditorPowerW').value=item?.powerW||'';
    if($('catalogEditorWeightKg'))$('catalogEditorWeightKg').value=item?.weightKg||'';
    catalogEditorPortDefs=item?.portDefs?cloneData(item.portDefs):(item?.portCount?[{id:uid('portdef'),kind:'range',startLabel:'Porta 1',endLabel:`Porta ${item.portCount}`,poe:false}]:[]);
    ['portRangeStart','portRangeEnd'].forEach(id=>{if($(id))$(id).value='';});
    if($('portRangePoe'))$('portRangePoe').checked=false;
    if($('portSingleName'))$('portSingleName').value='';
    if($('portSinglePoe'))$('portSinglePoe').checked=false;
    renderCatalogPortDefsEditor();
  }
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='1200';requestAnimationFrame(()=>$('catalogEditorName')?.focus());
}
function closeCatalogEditor(){const m=$('catalogEditorModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
async function saveCatalogEditor(){
  normalizeAssetCatalogs();
  const key=$('catalogEditorKind').value;
  const id=$('catalogEditorId').value;
  const name=$('catalogEditorName').value.trim();
  if(!name){toast('Informe um nome.');return;}

  // Capture the import context BEFORE changing catalog state or closing the modal.
  // This is the source of truth for inline creation from an import row.
  const createCtx = pendingCatalogCreate ? {...pendingCatalogCreate} : null;
  const importCtx = (pendingImport?.kind==='catalogs-single' && Array.isArray(pendingImport?.rows))
    ? {rows:pendingImport.rows, kind:pendingImport.kind}
    : null;

  if(key==='models'){
    const type=$('catalogEditorType').value, manufacturer=$('catalogEditorManufacturer').value;
    if(!type||!manufacturer){toast('Selecione o tipo e o fabricante.');return;}
    const duplicate=state.assetCatalogs.models.some(m=>m.id!==id&&catalogNormalize(m.name)===catalogNormalize(name)&&catalogNormalize(m.type)===catalogNormalize(type)&&catalogNormalize(m.manufacturer)===catalogNormalize(manufacturer));
    if(duplicate){toast('Esse modelo já existe para esse tipo e fabricante.');return;}
    const similar=state.assetCatalogs.models.filter(m=>m.id!==id&&catalogNormalize(m.type)===catalogNormalize(type)&&catalogNormalize(m.manufacturer)===catalogNormalize(manufacturer)).map(m=>m.name).filter(v=>catalogSimilarity(v,name)>=0.84);
    if(similar.length&&!(await uiConfirm(`Novo: ${name}\nJá cadastrado: ${similar[0]}`,{title:'Possível modelo duplicado',confirmText:'Cadastrar mesmo assim'})))return;
    let savedModel=null;
    const portCount=totalPortDefsCount(catalogEditorPortDefs);
    const powerW=Math.max(0,Math.floor(num($('catalogEditorPowerW')?.value,0)));
    const weightKg=Math.max(0,num($('catalogEditorWeightKg')?.value,0));
    if(id){const m=state.assetCatalogs.models.find(x=>x.id===id);if(!m)return;m.name=name;m.type=type;m.manufacturer=manufacturer;m.portDefs=cloneData(catalogEditorPortDefs);m.portCount=portCount;m.powerW=powerW;m.weightKg=weightKg;savedModel=m;}
    else {savedModel={id:uid('model'),name,type,manufacturer,portDefs:cloneData(catalogEditorPortDefs),portCount,powerW,weightKg};state.assetCatalogs.models.push(savedModel);}
    state.assetCatalogs.models.sort((a,b)=>(a.type+' '+a.manufacturer+' '+a.name).localeCompare(b.type+' '+b.manufacturer+' '+b.name,'pt-BR'));
    if(pendingImportModelIndex!==null && pendingImport?.rows?.[pendingImportModelIndex]){
      const item=pendingImport.rows[pendingImportModelIndex];
      item.data.Modelo=savedModel.name; item.data.Tipo=savedModel.type||''; item.data.Fabricante=savedModel.manufacturer||'';
      item._modelMissing=false; item._validated=false; item.valid=false; item.message='';
      pendingImportModelIndex=null;
      save(); closeCatalogEditor();
      renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();
      validateAssetImportRows(pendingImport.rows);
      renderEditableAssetImportPreview();
      updateImportPreviewSummary();
      toast('Modelo cadastrado, vinculado à linha e validado automaticamente');
      return;
    }
  }else{
    const arr=state.assetCatalogs[key]||[];
    const idx=Number(id);
    const exact=arr.find((x,i)=>i!==idx&&catalogNormalize(x)===catalogNormalize(name));
    if(exact){toast(`${catalogKeyLabel(key).replace(' de ativo','')} já cadastrado: ${exact}`);return;}
    const similar=arr.find((x,i)=>i!==idx&&catalogSimilarity(x,name)>=0.84);
    if(similar&&!(await uiConfirm(`Novo: ${name}\nJá cadastrado: ${similar}`,{title:'Possível duplicidade encontrada',confirmText:'Cadastrar mesmo assim'})))return;
    if(id!==''){
      const old=arr[idx];if(old===undefined)return;
      if(key==='manufacturers'&&old!==name)state.assetCatalogs.models.forEach(m=>{if(catalogNormalize(m.manufacturer)===catalogNormalize(old))m.manufacturer=name;});
      arr[idx]=name;
    } else arr.push(name);
    arr.sort((a,b)=>a.localeCompare(b,'pt-BR'));
  }

  save();
  // Keep the import context alive and resolve the exact row/canonical value.
  closeCatalogEditor();
  renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();

  if(createCtx && createCtx.kind==='models' && importCtx){
    const field=createCtx.field;
    const rows=importCtx.rows;
    const createdValue = field==='manufacturer'
      ? state.assetCatalogs.manufacturers.find(v=>catalogNormalize(v)===catalogNormalize(name))
      : state.assetCatalogs.types.find(v=>catalogNormalize(v)===catalogNormalize(name));
    if(createdValue){
      // Update every imported row using the newly-created dependency.
      rows.forEach(r=>{
        if(field==='manufacturer' && catalogNormalize(r.manufacturer)===catalogNormalize(name)){
          r.manufacturer=createdValue; r.missingManufacturer=false;
        }
        if(field==='type' && catalogNormalize(r.type)===catalogNormalize(name)){
          r.type=createdValue; r.missingType=false;
        }
      });
      // Re-run the COMPLETE validation immediately against the updated catalog.
      validateCatalogImportRows('models',rows);
      renderCatalogSinglePreviewRows('models',rows);
      pendingCatalogCreate=null;
      toast('Cadastro criado e importação revalidada automaticamente');
      return;
    }
  }
  pendingCatalogCreate=null;
  toast(id?'Cadastro atualizado':'Cadastro adicionado');
}
async function deleteCatalogItem(key,index){
  normalizeAssetCatalogs();const arr=state.assetCatalogs[key]||[], value=arr[Number(index)];if(value===undefined)return;
  if(key==='types'&&DEFAULT_ASSET_TYPES.includes(value)){toast('Os tipos padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='statuses'&&DEFAULT_ASSET_STATUSES.includes(value)){toast('Os status padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='substatuses'&&DEFAULT_ASSET_SUBSTATUSES.includes(value)){toast('Os substatus padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='statuses'&&state.assets.some(a=>String(a.status||'')===value)){toast('Este status está sendo usado por assets. Altere os assets antes de excluí-lo.');return;}
  if(key==='manufacturers'&&state.assetCatalogs.models.some(m=>m.manufacturer===value)){toast('Este fabricante possui modelos vinculados. Exclua ou reatribua esses modelos antes.');return;}
  const ok=await uiConfirm('Assets existentes que usam esse valor não serão alterados.',{title:`Excluir o cadastro "${value}"?`,confirmText:'Excluir cadastro',danger:true});
  if(!ok)return;arr.splice(Number(index),1);save();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();toast('Cadastro excluído');
}
async function deleteModelCatalogItem(id){
  normalizeAssetCatalogs();const m=state.assetCatalogs.models.find(x=>x.id===id);if(!m)return;
  const ok=await uiConfirm('',{title:`Excluir o modelo "${m.name}" do fabricante "${m.manufacturer}"?`,confirmText:'Excluir modelo',danger:true});
  if(!ok)return;state.assetCatalogs.models=state.assetCatalogs.models.filter(x=>x.id!==id);save();renderAssetCatalogs();renderAssetCatalogSelects();toast('Modelo excluído');
}
function renderAssetCatalogSelects(preserve={}){
  normalizeAssetCatalogs();
  const typeEl=$('assetType'),manEl=$('assetManufacturer'),modelEl=$('assetModel');
  if(typeEl){const current=preserve.assetType!==undefined?preserve.assetType:typeEl.value;typeEl.innerHTML='<option value="">Selecione o tipo</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');typeEl.value=current||'';}
  if(manEl){const current=preserve.assetManufacturer!==undefined?preserve.assetManufacturer:manEl.value;manEl.innerHTML='<option value="">Sem fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');manEl.value=current&&state.assetCatalogs.manufacturers.includes(current)?current:'';}
  const statusEl=$('assetStatus'); if(statusEl){const current=preserve.assetStatus!==undefined?preserve.assetStatus:statusEl.value;statusEl.innerHTML=assetStatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');statusEl.value=assetStatusValues().includes(current)?current:(assetStatusValues()[0]||'');}
  const subEl=$('assetSubstatus'); if(subEl){const current=preserve.assetSubstatus!==undefined?preserve.assetSubstatus:subEl.value;subEl.innerHTML='<option value="">Selecione o substatus</option>'+assetSubstatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');subEl.value=assetSubstatusValues().includes(current)?current:'';}
  if(modelEl){const current=preserve.assetModel!==undefined?preserve.assetModel:modelEl.value;const models=[...state.assetCatalogs.models].sort((a,b)=>(a.name+' '+a.manufacturer).localeCompare(b.name+' '+b.manufacturer,'pt-BR'));modelEl.innerHTML='<option value="">Sem modelo</option>'+models.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}${m.manufacturer?' — '+esc(m.manufacturer):''}</option>`).join('');modelEl.value=models.some(m=>m.name===current)?current:'';}
}
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
    id:a.id,name:String(a.name||'Equipamento'),type:String(a.type||'Equipamento'),manufacturer:String(a.manufacturer||''),model:String(a.model||''),assetTag:String(a.assetTag||''),serial:String(a.serial||''),locationType:a.locationType||(a.roomId?'room':'stock'),locationName:String(a.locationName||((a.roomId&&state.rooms?.find(r=>r.id===a.roomId)?.name)||(!a.roomId?'Estoque':''))),roomId:a.roomId||null,rackId:a.rackId||null,uStart:Math.max(1,Math.floor(num(a.uStart,1))),uHeight:Math.max(1,Math.floor(num(a.uHeight,1))),status:String(a.status||'Instalado'),substatus:String(a.substatus||''),locationId:a.locationId||null,stockId:a.stockId||null,ports:Array.isArray(a.ports)?a.ports.filter(p=>p&&p.id).map(p=>({id:String(p.id),label:String(p.label||'Porta'),poe:!!p.poe})):[],powerW:Math.max(0,Math.floor(num(a.powerW,0))),weightKg:Math.max(0,num(a.weightKg,0)),purchaseDate:/^\d{4}-\d{2}-\d{2}$/.test(a.purchaseDate)?a.purchaseDate:'',warrantyExpiration:/^\d{4}-\d{2}-\d{2}$/.test(a.warrantyExpiration)?a.warrantyExpiration:'',endOfLife:/^\d{4}-\d{2}-\d{2}$/.test(a.endOfLife)?a.endOfLife:''
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
}
function refreshAssetRackOptions(selected=''){
  const loc=$('assetLocation')?.value||''; const sel=$('assetRack'); if(!sel)return;
  const roomId=loc.startsWith('room:')?loc.slice(5):null;
  const room=roomId?(state.rooms||[]).find(r=>r.id===roomId):null;
  const racks=room?(room.data?.racks||[]):[];
  sel.innerHTML='<option value="">Sem rack</option>'+racks.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
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
function allProjectCables(){
  const activeId=state.activeRoomId;
  const others=(state.rooms||[]).filter(r=>r.id!==activeId).flatMap(r=>r.data?.cables||[]);
  return [...(state.cables||[]), ...others];
}
function findPortConnection(portId){
  return allProjectCables().find(c=>c.originPortId===portId||c.destPortId===portId)||null;
}
function setAssetPortsCollapsed(collapsed){
  const list=$('assetPortsList'); if(!list)return;
  list.classList.toggle('hidden',collapsed);
  const btn=$('assetPortsToggle');
  if(btn)btn.setAttribute('aria-expanded',collapsed?'false':'true');
  const label=$('assetPortsToggleLabel');
  if(label)label.textContent=collapsed?'Mostrar':'Ocultar';
}
function renderAssetPortsEditor(){
  const list=$('assetPortsList'); if(!list)return;
  $('assetPortsCount').textContent=assetEditPorts.length;
  const usedCount=assetEditPorts.filter(p=>findPortConnection(p.id)).length;
  if($('assetPortsUsedCount'))$('assetPortsUsedCount').textContent=assetEditPorts.length?`· ${usedCount} em uso · ${assetEditPorts.length-usedCount} disponível(is)`:'';
  list.innerHTML=assetEditPorts.length?assetEditPorts.map((p,i)=>{
    const conn=findPortConnection(p.id);
    let connLabel='';
    if(conn){
      const isOrigin=conn.originPortId===p.id;
      const otherRackId=isOrigin?conn.destRack:conn.originRack;
      const otherU=isOrigin?conn.destU:conn.originU;
      const otherPortId=isOrigin?conn.destPortId:conn.originPortId;
      connLabel=cableEndpointLabel(otherRackId,otherU,otherPortId,'',isOrigin?conn.destAssetName:conn.originAssetName);
    }
    return `<div class="asset-port-row ${conn?'is-used':'is-free'}"><span class="asset-port-index">${i+1}</span><div class="asset-port-fields"><input type="text" class="asset-port-name" data-port-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="Nome da porta">${conn?`<small class="asset-port-conn" title="${esc(conn.name)} → ${esc(connLabel)}">🔗 ${esc(conn.name)} → ${esc(connLabel)}</small>`:'<small class="asset-port-conn is-free-label">Disponível</small>'}</div><label class="asset-port-poe" title="Porta PoE"><input type="checkbox" data-port-poe="${esc(p.id)}" ${p.poe?'checked':''}><span>PoE</span></label><button type="button" class="iconbtn danger-icon" data-port-remove="${esc(p.id)}" title="Remover porta">×</button></div>`;
  }).join(''):'<div class="empty">Nenhuma porta cadastrada.</div>';
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
        connLabel=cableEndpointLabel(otherRackId,otherU,otherPortId,'',isOrigin?conn.destAssetName:conn.originAssetName);
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
  assetEditPorts=asset?.ports?cloneData(asset.ports):[];
  if(!assetEditPorts.length)autoFillPortsFromModelIfEmpty();
  setAssetPortsCollapsed(true);
  renderAssetPortsEditor();
  autoFillPortsFromModelIfEmpty();
  if($('assetPowerW')){$('assetPowerW').value=asset?.powerW||'';if(!$('assetPowerW').value)autoFillPowerFromModelIfEmpty();}
  if($('assetWeightKg')){$('assetWeightKg').value=asset?.weightKg||'';if(!$('assetWeightKg').value)autoFillWeightFromModelIfEmpty();}
  if($('assetPurchaseDate'))$('assetPurchaseDate').value=asset?.purchaseDate||'';
  if($('assetWarrantyExpiration'))$('assetWarrantyExpiration').value=asset?.warrantyExpiration||'';
  if($('assetEndOfLife'))$('assetEndOfLife').value=asset?.endOfLife||'';
  updateAssetLifecycleBadge();
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
  const locVal=$('assetLocation').value||''; const stockParts=locVal.startsWith('stock:')?locVal.split(':'):null; const finalLocationId=stockParts?.[1]||roomObj?.locationId||state.locations?.[0]?.id||null; const finalStockId=stockParts?.[2]||null; const asset={id:id||uid('asset'),name,type:$('assetType').value||'Equipamento',manufacturer:$('assetManufacturer').value.trim(),model:$('assetModel').value.trim(),assetTag:$('assetTag').value.trim(),serial,locationType,locationName:locationType==='stock'?'Estoque':(roomObj?.name||''),locationId:finalLocationId,stockId:finalStockId,roomId:locationRoomId,rackId,uStart,uHeight,status:$('assetStatus').value||'Instalado',substatus:$('assetSubstatus').value||'',ports:cloneData(assetEditPorts),powerW,weightKg,purchaseDate,warrantyExpiration,endOfLife};
  if(assetConflicts(asset,id||null)){toast('Não é possível: existe outro equipamento ocupando uma ou mais U.');return;}
  if(rack && powerW>0 && num(rack.powerCapacityW,0)>0){
    const othersPowerW=state.assets.filter(a=>a.rackId===rack.id && a.id!==asset.id).reduce((sum,a)=>sum+Math.max(0,num(a.powerW,0)),0);
    const totalPowerW=othersPowerW+powerW;
    if(totalPowerW>rack.powerCapacityW){
      const ok=await uiConfirm(`Isso leva o consumo estimado do rack "${rack.name}" a ${totalPowerW}W, acima da capacidade cadastrada de ${rack.powerCapacityW}W.`,{title:'Capacidade elétrica do rack excedida',confirmText:'Salvar mesmo assim',danger:true});
      if(!ok)return;
    }
  }
  if(rack && weightKg>0 && num(rack.weightCapacityKg,0)>0){
    const othersWeightKg=state.assets.filter(a=>a.rackId===rack.id && a.id!==asset.id).reduce((sum,a)=>sum+Math.max(0,num(a.weightKg,0)),0);
    const totalWeightKg=othersWeightKg+weightKg;
    if(totalWeightKg>rack.weightCapacityKg){
      const ok=await uiConfirm(`Isso leva o peso estimado do rack "${rack.name}" a ${totalWeightKg}kg, acima da capacidade de carga cadastrada de ${rack.weightCapacityKg}kg.`,{title:'Capacidade de carga do piso excedida',confirmText:'Salvar mesmo assim',danger:true});
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
function locateAsset(assetId){const a=state.assets.find(x=>x.id===assetId);if(!a)return;if(a.roomId&&a.roomId!==state.activeRoomId)switchRoom(a.roomId);if(a.rackId){state.selected={type:'rack',id:a.rackId};state.multiSelected=[a.rackId];state.trayMultiSelected=[];closeAssetsModal();closeBayface();renderAll(false);openBayface(a.rackId);}}
let assetColumnFilters={};
const ASSET_COLUMN_ORDER=['check','assetTag','name','type','manufacturer','model','serial','location','rack','u','uHeight','status','substatus','purchaseDate','warranty','eol','actions'];
const ASSET_COLUMN_WIDTHS_DEFAULT={check:36,assetTag:126,name:170,type:100,manufacturer:120,model:130,serial:130,location:170,rack:80,u:64,uHeight:64,status:100,substatus:100,purchaseDate:110,warranty:120,eol:120,actions:150};
const ASSET_COLUMN_MIN_WIDTHS={check:36,assetTag:70,name:90,type:70,manufacturer:70,model:70,serial:80,location:90,rack:60,u:48,uHeight:48,status:70,substatus:70,purchaseDate:80,warranty:80,eol:80,actions:120};
let assetColumnWidths={...ASSET_COLUMN_WIDTHS_DEFAULT};
let assetColumnsAutoFitted=false;
function measureTextWidth(text,font){
  if(!measureTextWidth._ctx) measureTextWidth._ctx=document.createElement('canvas').getContext('2d');
  measureTextWidth._ctx.font=font;
  return measureTextWidth._ctx.measureText(String(text||'')).width;
}
const ASSET_COLUMN_HEADER_LABELS={assetTag:'Asset Tag',name:'Nome',type:'Tipo',manufacturer:'Fabricante',model:'Modelo',serial:'SN',location:'Localização',rack:'Rack',u:'U',uHeight:'Qtd. U',status:'Status',substatus:'Substatus',purchaseDate:'Compra',warranty:'Garantia',eol:'EOL'};
function autoFitAssetColumnText(a,col){
  switch(col){
    case 'assetTag': return a.assetTag||'—';
    case 'name': return a.name||'';
    case 'type': return a.type||'';
    case 'manufacturer': return a.manufacturer||'—';
    case 'model': return a.model||'—';
    case 'serial': return a.serial||'—';
    case 'location': return assetLocationLabel(a);
    case 'rack': return assetRack(a.rackId)?.name||'Sem rack';
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
const ASSET_FILTER_COLUMNS={assetTag:'Asset Tag',name:'Nome',type:'Tipo',manufacturer:'Fabricante',model:'Modelo',serial:'Serial Number',location:'Localização',rack:'Rack',u:'U',uHeight:'Qtd. U',status:'Status',substatus:'Substatus',purchaseDate:'Data de compra',warranty:'Garantia',eol:'EOL'};
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
    case 'rack': return assetRack(a.rackId)?.name||'Sem rack';
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
  const searchMatches=state.assets.filter(a=>{const room=assetRoom(a);return !q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRack(a.rackId)?.name||''].join(' ').toLowerCase().includes(q);});
  const relevant=searchMatches.filter(a=>assetMatchesColumnFilters(a,col));
  const counts=new Map();
  relevant.forEach(a=>{const v=assetColumnValue(a,col);counts.set(v,(counts.get(v)||0)+1);});
  const values=[...counts.keys()].sort((x,y)=>x.localeCompare(y,'pt-BR'));
  const selected=assetColumnFilters[col]||new Set();
  const panel=document.createElement('div'); panel.className='col-filter-panel';
  panel.innerHTML=`<div class="col-filter-panel-head"><b>${esc(ASSET_FILTER_COLUMNS[col]||col)}</b>${selected.size?'<button type="button" class="col-filter-clear">Limpar</button>':''}</div><div class="col-filter-panel-list">${values.length?values.map(v=>`<label class="col-filter-option"><input type="checkbox" value="${esc(v)}" ${selected.has(v)?'checked':''}><span>${esc(v)}</span><small>${counts.get(v)}</small></label>`).join(''):'<div class="empty">Nenhum valor.</div>'}</div>`;
  document.body.appendChild(panel);
  const rect=anchorBtn.getBoundingClientRect();
  panel.style.top=`${rect.bottom+4}px`; panel.style.left=`${Math.min(rect.left,window.innerWidth-panel.offsetWidth-12)}px`;
  panel.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.onchange=()=>{
    const set=assetColumnFilters[col]instanceof Set?assetColumnFilters[col]:new Set();
    if(cb.checked)set.add(cb.value); else set.delete(cb.value);
    assetColumnFilters[col]=set;
    renderAssetsList($('assetsSearch')?.value||'');
    openAssetColumnFilterMenu(col,anchorBtn);
  });
  panel.querySelector('.col-filter-clear')?.addEventListener('click',()=>{
    delete assetColumnFilters[col];
    renderAssetsList($('assetsSearch')?.value||'');
    closeAssetColumnFilterMenus();
  });
}
let assetSortColumn=null, assetSortDir='asc';
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
    case 'rack': return (r?.name||'').toLowerCase();
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
  const bar=$('assetsBulkBar'); if(!bar)return;
  const count=assetSelectedIds.size;
  bar.classList.toggle('hidden',count===0);
  if($('assetsSelectedCount'))$('assetsSelectedCount').textContent=String(count);
  const statusSel=$('assetsBulkStatus');
  if(statusSel && statusSel.options.length<=1) statusSel.innerHTML='<option value="">Alterar status...</option>'+assetStatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const substatusSel=$('assetsBulkSubstatus');
  if(substatusSel && substatusSel.options.length<=1) substatusSel.innerHTML='<option value="">Alterar substatus...</option>'+assetSubstatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  const locSel=$('assetsBulkLocation');
  if(locSel && locSel.options.length<=1) locSel.innerHTML='<option value="">Alterar localização...</option>'+assetLocationChoices('').replace('<option value="">Selecione a localização</option>','');
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
  let items=state.assets.filter(a=>{const room=assetRoom(a);const matchesSearch=!q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRack(a.rackId)?.name||''].join(' ').toLowerCase().includes(q);return matchesSearch&&assetMatchesColumnFilters(a);});
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
  $('assetsCount').textContent=String(items.length); if($('assetsActiveCount'))$('assetsActiveCount').textContent=String(items.filter(a=>!isAssetArchived(a)).length); if($('assetsArchivedCount'))$('assetsArchivedCount').textContent=String(items.filter(isAssetArchived).length);
  const warrantyExpiredCount=items.filter(a=>assetWarrantyLevel(a)==='expired').length;
  if($('assetsWarrantyExpiredCount'))$('assetsWarrantyExpiredCount').textContent=String(warrantyExpiredCount);
  if($('assetsWarrantyExpiredStat'))$('assetsWarrantyExpiredStat').classList.toggle('hidden',warrantyExpiredCount===0);
  wrap.innerHTML=items.length?items.map(a=>{const r=assetRack(a.rackId),u=assetOccupancy(a),color=bayfaceTypeColor(a.type),checked=assetSelectedIds.has(a.id),warrantyLevel=assetWarrantyLevel(a),eolLevel=assetEndOfLifeLevel(a);return `<div class="asset-row ${isAssetArchived(a)?'asset-archived':''} ${checked?'is-selected':''}" style="--type-color:${esc(color)}"><div class="asset-cell asset-cell-check"><input type="checkbox" data-asset-select="${esc(a.id)}" ${checked?'checked':''}></div><div class="asset-cell"><strong>${esc(a.assetTag||'—')}</strong></div><div class="asset-cell">${esc(a.name)}</div><div class="asset-cell"><span class="asset-type-chip"><i></i>${esc(a.type)}</span></div><div class="asset-cell">${esc(a.manufacturer||'—')}</div><div class="asset-cell">${esc(a.model||'—')}</div><div class="asset-cell">${esc(a.serial||'—')}</div><div class="asset-cell">${esc(assetLocationLabel(a))}</div><div class="asset-cell">${esc(r?.name||'Sem rack')}</div><div class="asset-cell">${r?`U${u.start}${u.end!==u.start?'–U'+u.end:''}`:'—'}</div><div class="asset-cell">${r?esc(String(a.uHeight||1)+'U'):'—'}</div><div class="asset-cell"><span class="asset-status ${isAssetArchived(a)?'archived':''}">${esc(a.status||'—')}</span></div><div class="asset-cell">${esc(a.substatus||'—')}</div><div class="asset-cell">${esc(formatAssetDate(a.purchaseDate)||'—')}</div><div class="asset-cell">${warrantyLevel==='none'?'<span class="asset-warranty-chip level-none">—</span>':`<span class="asset-warranty-chip level-${warrantyLevel}" title="Vencimento: ${esc(formatAssetDate(a.warrantyExpiration))}"><i></i>${esc(formatAssetDate(a.warrantyExpiration))}</span>`}</div><div class="asset-cell">${eolLevel==='none'?'<span class="asset-warranty-chip level-none">—</span>':`<span class="asset-warranty-chip level-${eolLevel}" title="Fim de vida: ${esc(formatAssetDate(a.endOfLife))}"><i></i>${esc(formatAssetDate(a.endOfLife))}</span>`}</div><div class="asset-actions"><button class="iconbtn" type="button" data-asset-locate="${esc(a.id)}" title="Localizar no rack">⌖</button><button class="iconbtn" type="button" data-asset-edit="${esc(a.id)}" title="Editar asset">✎</button><button class="iconbtn" type="button" data-asset-history="${esc(a.id)}" title="Histórico">↺</button><button class="iconbtn danger-icon" type="button" data-asset-delete="${esc(a.id)}" title="Excluir permanentemente">×</button></div></div>`}).join(''):'<div class="empty">Nenhum asset encontrado.</div>';
  wrap.querySelectorAll('[data-asset-locate]').forEach(b=>b.onclick=()=>locateAsset(b.dataset.assetLocate));
  wrap.querySelectorAll('[data-asset-edit]').forEach(b=>b.onclick=()=>openAssetModal(b.dataset.assetEdit));
  wrap.querySelectorAll('[data-asset-history]').forEach(b=>b.onclick=()=>openAssetHistory(b.dataset.assetHistory));
  wrap.querySelectorAll('[data-asset-delete]').forEach(b=>b.onclick=()=>deleteAsset(b.dataset.assetDelete));
  wrap.querySelectorAll('[data-asset-select]').forEach(cb=>cb.onchange=()=>{
    if(cb.checked)assetSelectedIds.add(cb.dataset.assetSelect); else assetSelectedIds.delete(cb.dataset.assetSelect);
    cb.closest('.asset-row')?.classList.toggle('is-selected',cb.checked);
    if($('assetsSelectAll'))$('assetsSelectAll').checked=items.length>0&&assetSelectedIds.size===items.length;
    updateAssetsBulkBar();
  });
  if($('assetsSelectAll'))$('assetsSelectAll').checked=items.length>0&&assetSelectedIds.size===items.length;
  renderAssetsTableHead();
  renderAssetsTableSort();
  updateAssetsBulkBar();
  applyAssetColumnWidths();
  bindAssetColumnResize();
}
function openAssetsModal(){const m=$('assetsModal');if(!m)return;closeAssetModal();closeAssetCatalogModal();m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');$('assetsSearch').value='';assetColumnFilters={};assetSortColumn=null;assetSortDir='asc';assetSelectedIds=new Set();assetColumnWidths={...ASSET_COLUMN_WIDTHS_DEFAULT};assetAttentionOnly=false;assetColumnsAutoFitted=false;renderAssetsList();}
function closeAssetsModal(){const m=$('assetsModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
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
function renderBayfaceAssetPicker(){
  const modal=$('bayfaceAssetPickerModal'); if(!modal)return;
  const rackId=modal.dataset.rackId; const uStart=Math.max(1,Math.floor(Number(modal.dataset.uStart||1)));
  const rack=assetRack(rackId); const list=$('bayfaceAssetPickerList'); if(!list||!rack)return;
  const items=bayfacePickerAssets(rackId,uStart);
  const count=$('bayfaceAssetPickerCount'); if(count)count.textContent=`${items.length} asset${items.length===1?'':'s'}`;
  if(!items.length){list.innerHTML='<div class="empty bayface-picker-empty">Nenhum asset cadastrado disponível para esta U.</div>';return;}
  list.innerHTML=items.map(a=>{
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
      <span class="bayface-picker-action"><span class="btn small primary">Selecionar</span></span>
    </button>`;
  }).join('');
  list.querySelectorAll('[data-bay-pick-asset]').forEach(b=>b.addEventListener('click',()=>assignBayfaceAsset(b.dataset.bayPickAsset,rackId,uStart)));
}
function openBayfaceAssetPicker(rackId,uStart){
  const m=$('bayfaceAssetPickerModal'); if(!m)return;m.style.zIndex='1200';
  m.dataset.rackId=rackId; m.dataset.uStart=String(uStart||1);
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  const input=$('bayfaceAssetPickerSearch'); if(input){input.value=''; input.focus();}
  renderBayfaceAssetPicker();
}
function closeBayfaceAssetPicker(){const m=$('bayfaceAssetPickerModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function assignBayfaceAsset(assetId,rackId,uStart){
  const asset=state.assets.find(a=>a.id===assetId); const rack=assetRack(rackId); if(!asset||!rack)return;
  const height=Math.max(1,Math.floor(num(asset.uHeight,1))); const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  if(uStart<1||uStart+height-1>units){toast(`O asset ocupa ${height}U e não cabe a partir da U${uStart}.`);return;}
  const used=new Set();
  state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)&&a.id!==assetId).forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)used.add(u);});
  for(let u=uStart;u<uStart+height;u++)if(used.has(u)){toast(`Não é possível colocar o asset: U${u} já está ocupada.`);return;}
  const before={...asset};
  const room=assetRackRoom({rackId});
  asset.locationType='room'; asset.locationName=room?.name||state.rooms?.find(x=>x.id===state.activeRoomId)?.name||''; asset.locationId=room?.locationId||asset.locationId||null; asset.stockId=null; asset.roomId=room?.id||state.activeRoomId||null; asset.rackId=rackId; asset.uStart=uStart;
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
  const assets=state.assets.filter(a=>a.rackId===rackId && !isAssetArchived(a)).sort((a,b)=>a.uStart-b.uStart||a.name.localeCompare(b.name));
  const occupiedUnits=new Set();
  assets.forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)if(u>=1&&u<=units)occupiedUnits.add(u);});
  const usedUnits=occupiedUnits.size;
  const freeUnits=Math.max(0,units-usedUnits);
  const rowH=26;
  const gridH=units*rowH;
  let rows='';
  for(let u=units;u>=1;u--){
    const occupied=occupiedUnits.has(u);
    const major=u%5===0?' major':'';
    rows+=`<button type="button" class="bayface-u${major} ${occupied?'occupied':''}" data-bay-add-u="${u}" ${occupied?'disabled':''}><span class="bayface-u-num left">${u}</span><span class="bayface-u-slot"></span><span class="bayface-u-num right">${u}</span></button>`;
  }
  const assetLayer=assets.map(a=>{
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
    const subtitle=[a.assetTag?`Tag: ${a.assetTag}`:'',a.serial?`SN: ${a.serial}`:''].filter(Boolean).join(' · ');
    const identity=[name,model,manufacturer].filter(Boolean).join(' — ');
    const tooltip=[identity,a.assetTag,a.serial].filter(Boolean).join(' · ');
    const heightLabel=span===1?'1U':`${span}U`;
    const compact=span===1;
    return `<button type="button" class="bayface-asset ${compact?'is-compact':''}" style="top:${top}px;height:${h}px;--type-color:${esc(color)}" data-bay-edit="${esc(a.id)}" title="${esc(tooltip)} · U${clampedStart}${span>1?`–U${end}`:''}">
      <span class="bayface-asset-body"><span class="bayface-asset-name-row"><span class="bayface-asset-dot"></span><b>${esc(name)}</b></span>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span>
      <span class="bayface-asset-u">${heightLabel}</span>
    </button>`;
  }).join('');
  const usagePct=units?Math.round(usedUnits/units*100):0;
  const rail=Array.from({length:Math.min(8,Math.max(4,Math.floor(units/6)))},(_,i)=>`<span style="left:${6+i*12}%"></span>`).join('');
  return `<div class="bayface-wrap">
    <div class="bayface-head">
      <div class="bayface-title-block">
        <input type="text" class="bayface-rack-name-input" id="bayfaceRackNameInput" value="${esc(r.name)}" list="bayfaceRackNamesList" autocomplete="off" spellcheck="false" aria-label="Nome do rack">
        <datalist id="bayfaceRackNamesList">${orderedRackList().map(x=>`<option value="${esc(x.name)}"></option>`).join('')}</datalist>
        <div class="bayface-stats">
          <span class="bayface-stat">${units}U</span>
          <span class="bayface-stat">${assets.length} asset${assets.length===1?'':'s'}</span>
          <span class="bayface-stat ok">${usedUnits}U ocupadas</span>
          <span class="bayface-stat off">${freeUnits}U livres</span>
        </div>
        <div class="bayface-usage-bar" title="${usagePct}% ocupado"><span style="width:${usagePct}%"></span></div>
      </div>
    </div>
    <div class="bayface-stage">
      <button type="button" class="bayface-nav prev" id="bayfaceNavPrev" aria-label="Rack anterior" title="Rack anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4l-8 8 8 8"/></svg></button>
      <div class="bayface-rack" data-units="${units}" style="--bayface-row-h:${rowH}px;--bayface-grid-h:${gridH}px">
        <div class="bayface-topbar"><span class="bayface-brand">${esc(r.name)}</span><span class="bayface-rack-state">FRONT</span></div>
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
  let rowH=parseFloat(cs.getPropertyValue('--bayface-row-h'))||20;
  const overflow=card.scrollHeight-card.clientHeight;
  if(overflow>1){
    rowH=Math.max(10,rowH-Math.ceil(overflow/units));
    rack.style.setProperty('--bayface-row-h',rowH+'px');
    rack.style.setProperty('--bayface-grid-h',(rowH*units)+'px');
  }
}
function openBayface(rackId){
  const r=assetRack(rackId);if(!r)return;
  const m=$('bayfaceModal');if(!m)return;
  m.style.zIndex='1100';
  $('bayfaceTitle').textContent=`Bayface — ${r.name}`;
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
function renderProperties(){
  const p=$('properties');
  if(state.trayMultiSelected.length>1){
    const count=state.trayMultiSelected.length;
    setPropTitleSticky(`${count} calhas selecionadas`);
    p.innerHTML=`<div class="help">Várias calhas selecionadas. Para evitar alterações acidentais na geometria e nas conexões, somente a exclusão em lote está disponível.</div>
      <button class="btn danger full" id="delSelectedTrays">Excluir ${count} calhas selecionadas</button>
      <button class="btn ghost full" id="clearSelectedTrays">Limpar seleção</button>`;
    $('delSelectedTrays').onclick=deleteSelectedTrays;
    $('clearSelectedTrays').onclick=()=>{state.trayMultiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(state.multiSelected.length>1){
    const count=state.multiSelected.length;
    setPropTitleSticky(`${count} racks selecionados`);
    p.innerHTML=`${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. As propriedades dos racks estão somente para consulta.</div>':''}
      <div class="help">As propriedades abaixo serão aplicadas a todos os racks selecionados. Deixe um campo vazio para não alterá-lo. Largura e profundidade mantêm cada rack centrado.</div>
      <div class="grid2"><label>Qtd. U<input id="bulkUnits" type="number" min="1" max="60" placeholder="Não alterar"></label><label>Largura (m)<input id="bulkWidth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="bulkDepth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label><label>Distância próx. (m)<input id="bulkGap" type="number" min="0" step="0.01" placeholder="Não alterar"></label></div>
      <label>Altura da última U → calha (m)<input id="bulkRise" type="number" min="0" step="0.01" placeholder="Não alterar"></label>
      <div class="grid2"><label>Capacidade elétrica (W)<input id="bulkPowerCapacity" type="number" min="0" step="1" placeholder="Não alterar"></label><label>Capacidade de carga do piso (kg)<input id="bulkWeightCapacity" type="number" min="0" step="1" placeholder="Não alterar"></label></div>
      <button class="btn primary full" id="applyBulkRack">✓ Aplicar propriedades</button>
      <button class="btn danger full" id="delSelectedRacks">Excluir ${count} racks selecionados</button>
      <button class="btn ghost full" id="clearSelectedRacks">Limpar seleção</button>`;
    $('applyBulkRack').onclick=()=>{if(structureBlocked())return;
      const ids=new Set(state.multiSelected);
      const unitsVal=$('bulkUnits').value.trim(), widthVal=$('bulkWidth').value.trim(), depthVal=$('bulkDepth').value.trim(), gapVal=$('bulkGap').value.trim(), riseVal=$('bulkRise').value.trim(), powerCapVal=$('bulkPowerCapacity').value.trim(), weightCapVal=$('bulkWeightCapacity').value.trim();
      if(!unitsVal&&!widthVal&&!depthVal&&!gapVal&&!riseVal&&!powerCapVal&&!weightCapVal){toast('Informe pelo menos uma propriedade');return;}
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
  if(!state.selected){setPropTitleSticky('');p.innerHTML='<div class="empty">Selecione um rack, calha ou cabo.</div>';return;}
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
    p.innerHTML=`${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar este rack.</div>':''}
      <label>Nome<input id="prName" value="${esc(r.name)}"></label>
      <div class="grid2"><label>Qtd. U<input id="prUnits" type="number" min="1" max="60" value="${r.units}"></label><label>Largura (m)<input id="prWidth" type="number" min="0.1" step="0.01" value="${r.width}"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="prDepth" type="number" min="0.1" step="0.01" value="${r.depth??state.rackDepth}"></label><label>Distância próx. (m)<input id="prGapAfter" type="number" min="0" step="0.01" value="${r.gapAfter??state.rackGap}"></label></div>
      <label>Altura da última U → calha (m)<input id="prRiseToTray" type="number" min="0" step="0.01" value="${num(r.riseToTray,state.lastUToTray).toFixed(2)}"></label>
      <label>Capacidade elétrica (W) <small class="field-help-inline">(opcional)</small><input id="prPowerCapacity" type="number" min="0" step="1" placeholder="Sem limite definido" value="${powerCapacity>0?powerCapacity:''}"></label>
      <div class="rack-power-readout power-${powerLevel}">Consumo estimado: <b>${rackPowerW}W</b>${powerCapacity>0?` de ${powerCapacity}W (${powerPct}%)`:''}</div>
      <label>Capacidade de carga do piso (kg) <small class="field-help-inline">(opcional)</small><input id="prWeightCapacity" type="number" min="0" step="1" placeholder="Sem limite definido" value="${weightCapacity>0?weightCapacity:''}"></label>
      <div class="rack-power-readout power-${weightLevel}">Peso estimado: <b>${rackWeightKg}kg</b>${weightCapacity>0?` de ${weightCapacity}kg (${weightPct}%)`:''}</div>
      <button class="btn ghost full" id="openBayface">▦ Ver Bayface</button><button class="btn danger full" id="delRack">Excluir rack</button>
      <div class="help autosave">As alterações do rack são salvas automaticamente.</div>`;
    if($('prName'))$('prName').onchange=()=>{if(structureBlocked())return;r.name=$('prName').value.trim();refreshVisuals();renderProperties();};
    if($('prUnits'))$('prUnits').onchange=()=>{if(structureBlocked())return;r.units=Math.max(1,Math.min(60,Math.floor(num($('prUnits').value,state.rackUnits))));refreshVisuals();renderProperties();};
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
      autoJoinIntersectingTrays(t.id);save();renderAll();
    };
    $('delTray').onclick=()=>{if(structureBlocked())return;state.trays=state.trays.filter(x=>x.id!==t.id);state.selected=null;save();renderAll();toast('Calha removida');};
    return;
  }
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
  const rack=state.racks.find(r=>r.id===rackId);
  const uInvalid=!rack||u<1||u>Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  const asset=uInvalid?null:assetAtRackU(rackId,u);
  const field=$(side==='origin'?'cbOAssetName':'cbDAssetName'); if(!field)return;
  const hint=field.closest('label')?.querySelector('.field-help-inline');
  if(asset){
    if(side==='origin')c.originAssetName=asset.name; else c.destAssetName=asset.name;
    field.value=asset.name; field.disabled=true;
    if(hint)hint.textContent='(preenchido automaticamente pelo asset instalado nessa U)';
  }else{
    // Sem asset nessa U: NÃO apaga o que já está guardado no cabo — pode ser
    // uma referência que o usuário digitou pra uma posição sem asset formal.
    // Só garante que o campo fique editável e mostre o valor atual salvo.
    field.value=side==='origin'?(c.originAssetName||''):(c.destAssetName||'');
    field.disabled=false;
    if(hint)hint.textContent='(opcional — nem todo asset precisa estar cadastrado ainda)';
  }
}

function renderCableProperties(p,c){
  if(!c){p.innerHTML='<div class="empty">Cabo não encontrado.</div>';return;}
  const opts=state.racks.map(r=>`<option value="${r.id}">${esc(rowForRack(r)?.name||'')} / ${esc(r.name)} (${Math.floor(num(r.units,state.rackUnits))}U)</option>`).join('');
  const v=cableUnitValidation(c);
  const o=v.origin,d=v.dest;
  const ouMax=o?Math.floor(num(o.units,state.rackUnits)):1, duMax=d?Math.floor(num(d.units,state.rackUnits)):1;
  const ouInvalid=!o||Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ouMax;
  const duInvalid=!d||Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>duMax;
  const originAsset=!ouInvalid?assetAtRackU(c.originRack,Math.floor(num(c.originU,0))):null;
  const destAsset=!duInvalid?assetAtRackU(c.destRack,Math.floor(num(c.destU,0))):null;
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
  p.innerHTML=`<label>Nome<input id="cbName" value="${esc(c.name)}"></label>
  <label>Tipo<select id="cbType">${cableTypeNames().map(t=>`<option value="${esc(t)}" ${c.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
  <div class="grid2"><label>Rack origem<select id="cbOR">${opts}</select></label><label>U origem<input id="cbOU" class="${ouInvalid?'input-error':''}" type="number" min="1" max="${ouMax}" value="${c.originU}"><small id="cbOUError" class="field-error">${ouInvalid?`Máximo: ${ouMax}U.`:''}</small></label></div>
  ${!ouInvalid?`<label>Nome do asset na origem <small class="field-help-inline">${originAsset?'(preenchido automaticamente pelo asset instalado nessa U)':'(opcional — nem todo asset precisa estar cadastrado ainda)'}</small><input id="cbOAssetName" value="${esc(originAsset?originAsset.name:(c.originAssetName||''))}" placeholder="Nome do equipamento nessa U" ${originAsset?'disabled':''}></label>`:''}
  ${!ouInvalid?(originAsset?.ports?.length?`<label>Porta de origem <small class="field-help-inline">(${esc(originAsset.name)})</small><select id="cbOPort">${portOptions(originAsset,c.originPortId)}</select></label>${originConflict?`<div class="field-error">Porta já usada pelo cabo "${esc(originConflict.name)}".</div>`:''}`:`<label>Porta de origem <small class="field-help-inline">${originAsset?`(${esc(originAsset.name)}, sem portas cadastradas)`:'(opcional)'}</small><input id="cbOPortFree" value="${esc(c.originPortLabel||'')}" placeholder="Digite o nome da porta"></label>`):''}
  <div class="grid2"><label>Rack destino<select id="cbDR">${opts}</select></label><label>U destino<input id="cbDU" class="${duInvalid?'input-error':''}" type="number" min="1" max="${duMax}" value="${c.destU}"><small id="cbDUError" class="field-error">${duInvalid?`Máximo: ${duMax}U.`:''}</small></label></div>
  ${!duInvalid?`<label>Nome do asset no destino <small class="field-help-inline">${destAsset?'(preenchido automaticamente pelo asset instalado nessa U)':'(opcional — nem todo asset precisa estar cadastrado ainda)'}</small><input id="cbDAssetName" value="${esc(destAsset?destAsset.name:(c.destAssetName||''))}" placeholder="Nome do equipamento nessa U" ${destAsset?'disabled':''}></label>`:''}
  ${!duInvalid?(destAsset?.ports?.length?`<label>Porta de destino <small class="field-help-inline">(${esc(destAsset.name)})</small><select id="cbDPort">${portOptions(destAsset,c.destPortId)}</select></label>${destConflict?`<div class="field-error">Porta já usada pelo cabo "${esc(destConflict.name)}".</div>`:''}`:`<label>Porta de destino <small class="field-help-inline">${destAsset?`(${esc(destAsset.name)}, sem portas cadastradas)`:'(opcional)'}</small><input id="cbDPortFree" value="${esc(c.destPortLabel||'')}" placeholder="Digite o nome da porta"></label>`):''}
  ${!v.valid?`<div class="validation-error">⚠ ${v.errors.map(esc).join('<br>')}</div>`:''}
  <label>Folga (%)<input id="cbSlack" type="number" min="0" step="1" value="${c.slack??state.defaultSlack}"></label>
  <div class="result" id="cableResult"></div><div class="route-tools"><b>Roteamento</b><div class="help">Automática: o sistema encontra o caminho pelas calhas. Manual: escolha os racks intermediários e o sistema valida cada trecho.</div>
   <label class="route-mode-label">Modo<select id="routeMode"><option value="automatic" ${(c.routeMode||'automatic')==='automatic'?'selected':''}>Automática</option><option value="manual" ${c.routeMode==='manual'?'selected':''}>Manual</option></select></label>
   <div id="manualRoutePanel" class="manual-route-panel ${c.routeMode==='manual'?'':'hidden'}">
     <div class="manual-route-status" id="manualRouteStatus"></div>
     <button class="btn primary" id="pickRouteRack" type="button">Adicionar rack à rota</button>
     <div id="manualRouteList"></div>
     <button class="btn ghost" id="clearManualRoute" type="button" ${c.via?.length?'':'disabled'}>Limpar rota manual</button>
   </div>
   <button class="btn danger" id="delCable">Excluir cabo</button></div>`;
  $('cbOR').value=c.originRack;$('cbDR').value=c.destRack;
  const sync=()=>{refreshVisuals();renderProperties();};
  $('cbType').onchange=()=>{c.type=$('cbType').value;sync();};
  $('cbOR').onchange=()=>{c.originRack=$('cbOR').value;c.originPortId=null;c.originPortLabel='';c.originAssetName='';sync();};
  $('cbDR').onchange=()=>{c.destRack=$('cbDR').value;c.destPortId=null;c.destPortLabel='';c.destAssetName='';sync();};
  $('cbOU').oninput=()=>{c.originU=Math.floor(num($('cbOU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();updateCableAssetNameField(c,'origin');};
  $('cbDU').oninput=()=>{c.destU=Math.floor(num($('cbDU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();updateCableAssetNameField(c,'dest');};
  $('cbOU').onchange=()=>{c.originPortId=null;c.originPortLabel='';c.originAssetName='';save();renderProperties();};
  $('cbDU').onchange=()=>{c.destPortId=null;c.destPortLabel='';c.destAssetName='';save();renderProperties();};
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
  // Reconfere o campo de nome logo após o próximo quadro de tela — proteção
  // extra contra qualquer sequência de seleção que deixe o disabled/valor
  // fora de sincronia com o asset de verdade instalado na U.
  requestAnimationFrame(()=>{if(state.selected?.type==='cable'&&state.selected.id===c.id){updateCableAssetNameField(c,'origin');updateCableAssetNameField(c,'dest');}});
}
function updateCableResult(c){const el=$('cableResult');if(!el)return;const validation=cableUnitValidation(c);if(!validation.valid){el.innerHTML='<div class="validation-error">⚠ '+validation.errors.map(esc).join('<br>')+'</div>';return;}const res=calcCable(c);const rounded=res.reachable?Math.ceil(res.total):0;el.innerHTML=`<div class="metric"><span>Vertical origem</span><b>${res.v1.toFixed(2)} m</b></div><div class="metric"><span>Trecho pelas calhas</span><b>${res.tray.toFixed(2)} m</b></div><div class="metric"><span>Vertical destino</span><b>${res.v2.toFixed(2)} m</b></div><div class="metric"><span>Conexões</span><b>${res.connection.toFixed(2)} m</b></div><div class="metric"><span>Base</span><b>${res.base.toFixed(2)} m</b></div><div class="metric"><span>Folga ${c.slack??state.defaultSlack}%</span><b>${res.slack.toFixed(2)} m</b></div><div class="metric"><span>Total</span><b>${res.total.toFixed(2)} m</b></div><div class="metric total-rounded"><span>Total arredondado para cima</span><b>${res.reachable?rounded:'—'} m</b></div>${res.reachable?'':'<div class="unreachable">Não existe rota pelas calhas cadastradas.</div>'}`;}

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
  list.innerHTML=(c.via||[]).map((id,i)=>`<div class="route-node"><span class="route-index">${i+1}</span><span>${esc(rackNameById(id))}</span><button class="btn small danger" data-manual-via-del="${i}">×</button></div>`).join('');
  list.querySelectorAll('[data-manual-via-del]').forEach(b=>b.onclick=()=>{c.via.splice(+b.dataset.manualViaDel,1);window.__manualRoutePicking=false;refreshVisuals();renderProperties();});
  const md=manualRouteData(c);
  if(status){status.textContent=md.reachable?(c.via?.length?`Rota válida: ${[c.originRack,...c.via,c.destRack].map(rackNameById).join(' → ')}`:'Nenhum rack intermediário selecionado.'):`Rota impossível: ${rackNameById(md.failedFrom)} → ${rackNameById(md.failedTo)}`;status.className='manual-route-status '+(md.reachable?'valid':'invalid');}
  const clear=$('clearManualRoute');if(clear)clear.disabled=!(c.via||[]).length;
}
function refreshVisuals(){normalizeState();render();renderCables();updateAlertsCenterBadge();updateRoomThermalBadge();save();}

function addCable(){if(state.racks.length<2){toast('Crie pelo menos 2 racks');return;}const c={id:uid('cable'),name:`Cabo-${String(state.cables.length+1).padStart(3,'0')}`,originRack:state.racks[0].id,originU:state.racks[0].units,destRack:state.racks[1].id,destU:state.racks[1].units,slack:state.defaultSlack,type:defaultCableType(),via:[]};state.cables.push(c);state.multiSelected=[];state.selected={type:'cable',id:c.id};renderAll();toast('Cabo adicionado');}

function cableRouteLabel(c,res){
  if(!res?.reachable) return '';

  // Show only meaningful infrastructure waypoints:
  // origin -> rack where the route leaves one tray -> rack where it enters
  // the next tray -> ... -> destination. Do NOT list every rack simply
  // crossed by a horizontal tray.
  const graph=buildRouteGraph(c);
  if(!graph) return '';
  const path=res.path||[];
  if(path.length<2) return '';

  const route=[];
  const seen=new Set();
  const addRack=r=>{
    if(!r||seen.has(r.id))return;
    seen.add(r.id);
    route.push(r.name||r.id||'');
  };

  const origin=state.racks.find(r=>r.id===c.originRack);
  const dest=state.racks.find(r=>r.id===c.destRack);
  addRack(origin);

  // Find the rack whose physical access point is closest to a tray
  // transition. A transition is where the shortest path moves from one tray
  // to another (crossing or explicit tray-to-tray connection).
  function rackAtTrayPoint(tray,t){
    let best=null,bestErr=Infinity;
    state.racks.forEach(r=>{
      const row=rowForRack(r);
      if(!row)return;
      const rr=rackRect(r,geometry());
      const cx=rr.x+rr.w/2,cy=rr.y+rr.h/2;
      const dx=num(tray.x2)-num(tray.x1),dy=num(tray.y2)-num(tray.y1);
      const denom=dx*dx+dy*dy;
      if(denom<1e-12)return;
      const rt=((cx-num(tray.x1))*dx+(cy-num(tray.y1))*dy)/denom;
      if(rt<-0.000001||rt>1.000001)return;
      const pp=trayPointAt(tray,rt);
      const dist=Math.hypot(pp.x-cx,pp.y-cy);
      const err=Math.abs(rt-num(t));
      // The rack must actually sit on/near this tray access point. The
      // generous physical tolerance handles different rack widths and zoom.
      const tolerance=Math.max(14,geometry().scale*0.16);
      if(dist>tolerance)return;
      if(err<bestErr){bestErr=err;best=r;}
    });
    return best;
  }

  for(let i=1;i<path.length-1;i++){
    const prev=graph.nodes.get(path[i-1]);
    const cur=graph.nodes.get(path[i]);
    const next=graph.nodes.get(path[i+1]);
    if(!prev||!cur||!next)continue;

    const prevTray=prev.tray?.id;
    const curTray=cur.tray?.id;
    const nextTray=next.tray?.id;

    // The path can contain zero-cost alias/access nodes. What matters is the
    // actual tray change between consecutive meaningful tray nodes.
    if(cur.kind==='tray' && next.kind==='tray' && curTray && nextTray && curTray!==nextTray){
      const ra=rackAtTrayPoint(cur.tray,cur.t);
      const rb=rackAtTrayPoint(next.tray,next.t);
      addRack(ra);
      addRack(rb);
    }

    // Also catch a tray transition where the current node is an alias and the
    // next node is the first node on another tray.
    if(curTray && nextTray && curTray!==nextTray){
      const ra=rackAtTrayPoint(cur.tray,cur.t);
      const rb=rackAtTrayPoint(next.tray,next.t);
      addRack(ra);
      addRack(rb);
    }
  }

  addRack(dest);
  return route.filter(Boolean).join(' > ');
}
function applyTypeValidation(ws, range='B2:B1000'){
  if(!ws)return;
  const formula=`"${cableTypeNames().join(',')}"`;
  for(let row=2;row<=1000;row++){
    const cell=ws.getCell(`B${row}`);
    cell.dataValidation={type:'list',allowBlank:false,formulae:[formula]};
  }
}
async function downloadCableTemplate(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Nome Asset Origem','Porta Origem','Rack Destino','U Destino','Nome Asset Destino','Porta Destino'];
    ws.addRow(headers);
    ws.addRow(['FIB-001',defaultCableType(),'Row-1-01',40,'SWITCH01','G0/0/1','Row-2-01',40,'ROUTER01','G0/0/2']);
    ws.freezePanes={xSplit:0,ySplit:1};
    ws.autoFilter={from:'A1',to:'J2'};
    ws.getRow(1).font={bold:true};
    ws.columns=[{width:20},{width:24},{width:20},{width:12},{width:20},{width:16},{width:20},{width:12},{width:20},{width:16}];
    const note=ws.getCell('L1'); note.value='Porta Origem e Porta Destino são opcionais. Se o modelo do asset já tiver portas cadastradas, o nome precisa ser idêntico a uma delas. Se o modelo não tiver portas cadastradas, o texto informado é aceito livremente, sem validação. Nome Asset Origem/Destino é opcional: se já existir um asset cadastrado naquele rack/U, o sistema usa o nome dele automaticamente; se não existir, o texto informado é aceito livremente, sem criar nenhum asset novo.'; note.font={italic:true,color:{argb:'FF8B96AC'}};
    applyTypeValidation(ws);

    // Lista suspensa de racks (origem e destino), igual à de Tipo — usa uma
    // aba de referência oculta em vez de lista inline, pra não esbarrar no
    // limite de caracteres do Excel quando há muitos racks no projeto.
    const refWs=wb.addWorksheet('NÃO EDITAR - Referência');
    const allRacks=[...new Set(allProjectRacks().map(({rack:r})=>r.name).filter(Boolean))];
    refWs.getColumn(1).values=['Racks',...allRacks];
    refWs.state='hidden';
    const rackRange=`'NÃO EDITAR - Referência'!$A$2:$A$${Math.max(2,allRacks.length+1)}`;
    for(let row=2;row<=1000;row++){
      ws.getCell(`C${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
      ws.getCell(`G${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
    }

    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='template-importacao-cabos.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Template XLSX baixado');
  }catch(err){toast(err.message||'Erro ao baixar template');}
}
let pendingCableImportRows=null;
const CABLE_TYPE_AUTO_COLORS=['#f472b6','#a78bfa','#fb923c','#34d399','#60a5fa','#f87171','#c084fc','#38bdf8'];
function importCablesXLSX(file){
  try{
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const wb=XLSX.read(new Uint8Array(reader.result),{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(!rows.length)throw new Error('O arquivo Excel está vazio.');
        const headers=rows[0].map(v=>String(v??'').trim());
        const map={};headers.forEach((h,i)=>map[h]=i);
        const required=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino'];
        const missing=required.filter(h=>!(h in map));
        if(missing.length)throw new Error('Colunas obrigatórias ausentes: '+missing.join(', '));
        const dataRows=rows.slice(1).filter(row=>row.some(v=>v!==null&&String(v).trim()));

        // Detecta tipos usados na planilha que não batem (ignorando maiúscula/
        // minúscula e acentos) com nenhum tipo já cadastrado no catálogo.
        normalizeCableCatalogs();
        const existingTypes=cableTypeNames();
        const existingNorm=new Map(existingTypes.map(t=>[catalogNormalize(t),t]));
        const newTypesSeen=new Map(); // normalizado -> {label, count}
        dataRows.forEach(row=>{
          const raw=String(map['Tipo']!=null?(row[map['Tipo']]??''):'').trim();
          if(!raw)return;
          const norm=catalogNormalize(raw);
          if(existingNorm.has(norm))return;
          if(!newTypesSeen.has(norm))newTypesSeen.set(norm,{label:raw,count:0});
          newTypesSeen.get(norm).count++;
        });

        pendingCableImportRows={map,dataRows};
        if(newTypesSeen.size){
          openCableTypeReviewModal([...newTypesSeen.values()],existingTypes);
        }else{
          processCableImportRows();
        }
      }catch(err){toast(err.message||'Erro ao importar Excel');}
    };
    reader.readAsArrayBuffer(file);
  }catch(err){toast(err.message||'Erro ao importar Excel');}
}
function openCableTypeReviewModal(newTypes,existingTypes){
  const list=$('cableTypeReviewList');
  if(list){
    list.innerHTML=newTypes.map(t=>{
      const similar=catalogSimilar(t.label,existingTypes);
      return `<label class="cable-type-review-item"><input type="checkbox" data-cable-type-review="${esc(t.label)}" checked><span class="cable-type-review-name">${esc(t.label)}</span><span class="cable-type-review-count">${t.count}× na planilha</span></label>${similar.length?`<div class="cable-type-review-warning">⚠ Parecido com "${esc(similar[0])}", já cadastrado — pode ser o mesmo tipo escrito diferente.</div>`:''}`;
    }).join('');
  }
  const m=$('cableTypeReviewModal'); if(!m)return;
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
}
function closeCableTypeReviewModal(){
  const m=$('cableTypeReviewModal'); if(!m)return;
  m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');
}
function processCableImportRows(selectedNewTypes=[]){
  if(!pendingCableImportRows)return;
  const {map,dataRows}=pendingCableImportRows;
  pendingCableImportRows=null;
  // Cadastra no catálogo só os tipos marcados na revisão — os demais ainda
  // são usados nos cabos importados, só não ficam salvos pra uso futuro.
  if(selectedNewTypes.length){
    normalizeCableCatalogs();
    let colorIdx=state.cableCatalogs.types.length;
    selectedNewTypes.forEach(label=>{
      if(!cableTypeNames().some(t=>catalogNormalize(t)===catalogNormalize(label))){
        state.cableCatalogs.types.push({name:label,color:CABLE_TYPE_AUTO_COLORS[colorIdx%CABLE_TYPE_AUTO_COLORS.length]});
        colorIdx++;
      }
    });
  }
  const val=(row,name,def='')=>{const i=map[name];return i==null||i>=row.length||row[i]===''||row[i]==null?def:row[i];};
  let added=0,skipped=0,portsUnmatched=0;
  for(const row of dataRows){
    const origin=state.racks.find(r=>r.name===String(val(row,'Rack Origem','')).trim());
    const dest=state.racks.find(r=>r.name===String(val(row,'Rack Destino','')).trim());
    if(!origin||!dest){skipped++;continue;}
    const typeRaw=String(val(row,'Tipo',defaultCableType())).trim();
    // Usa o tipo já cadastrado com a grafia oficial dele (ignora diferença de
    // maiúscula/minúscula), ou o texto da planilha se for um tipo não marcado
    // pra cadastro (segue existindo só naquele cabo).
    const matched=cableTypeNames().find(t=>catalogNormalize(t)===catalogNormalize(typeRaw));
    const type=matched||typeRaw||defaultCableType();
    const originU=Math.floor(num(val(row,'U Origem',origin.units),origin.units));
    const destU=Math.floor(num(val(row,'U Destino',dest.units),dest.units));
    const originAsset=assetAtRackU(origin.id,originU);
    const destAsset=assetAtRackU(dest.id,destU);
    let originPortId=null, destPortId=null, originPortLabelFree='', destPortLabelFree='';
    const originPortLabel=String(val(row,'Porta Origem','')).trim();
    const destPortLabel=String(val(row,'Porta Destino','')).trim();
    if(originPortLabel){
      if(originAsset?.ports?.length){const port=originAsset.ports.find(p=>p.label===originPortLabel);if(port)originPortId=port.id;else portsUnmatched++;}
      else originPortLabelFree=originPortLabel; // sem portas cadastradas no modelo: aceita o texto livre sem validar
    }
    if(destPortLabel){
      if(destAsset?.ports?.length){const port=destAsset.ports.find(p=>p.label===destPortLabel);if(port)destPortId=port.id;else portsUnmatched++;}
      else destPortLabelFree=destPortLabel;
    }
    // Se já existe um asset instalado nessa U, o nome vem sempre dele;
    // senão, aceita o texto informado livremente, sem criar asset.
    const originAssetName=originAsset?originAsset.name:String(val(row,'Nome Asset Origem','')).trim();
    const destAssetName=destAsset?destAsset.name:String(val(row,'Nome Asset Destino','')).trim();
    state.cables.push({id:uid('cable'),name:String(val(row,'Nome',`Cabo-${String(state.cables.length+1).padStart(3,'0')}`)).trim(),type,originRack:origin.id,originU,originPortId,originPortLabel:originPortLabelFree,originAssetName,destRack:dest.id,destU,destPortId,destPortLabel:destPortLabelFree,destAssetName,slack:state.defaultSlack,via:[]});
    added++;
  }
  renderAll();
  const parts=[`${added} cabo(s) importado(s).`];
  if(skipped)parts.push(`${skipped} ignorado(s).`);
  if(portsUnmatched)parts.push(`${portsUnmatched} porta(s) não encontrada(s) e deixada(s) em branco.`);
  toast(parts.join(' '));
}
function cableSummaryRows(){
  const groups=new Map();
  let invalid=0,unreachable=0;
  for(const c of state.cables){
    const v=cableUnitValidation(c);
    if(!v.valid){invalid++;continue;}
    const res=calcCable(c);
    if(!res.reachable){unreachable++;continue;}
    const length=Math.ceil(res.total);
    const type=c.type||defaultCableType();
    const key=type+'|'+length;
    groups.set(key,(groups.get(key)||0)+1);
  }
  const order=new Map(cableTypeNames().map((t,i)=>[t,i]));
  return [...groups.entries()].map(([key,qty])=>{const [type,length]=key.split('|');return {type,length:Number(length),qty};})
    .sort((a,b)=>(order.get(a.type)-order.get(b.type))||a.length-b.length);
}
function cablePortAt(rackId,u,portId){if(!portId)return null;return assetAtRackU(rackId,u)?.ports?.find(p=>p.id===portId)||null;}
function cableEndpointLabel(rackId,u,portId,freeformLabel='',assetNameFallback=''){
  const rack=state.racks.find(r=>r.id===rackId);
  const asset=assetAtRackU(rackId,u);
  const port=cablePortAt(rackId,u,portId);
  return [rack?.name||'—',`${u}U`,asset?.name||assetNameFallback||'—',port?.label||freeformLabel||'—'].join(' - ');
}
function compactPortLabels(labels){
  if(!labels.length)return '';
  const groups=new Map();
  const singles=[];
  labels.forEach(label=>{
    const t=parsePortTemplate(label);
    if(!t){singles.push(label);return;}
    const key=t.prefix+'\u0000'+t.suffix;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({num:t.num,label});
  });
  const segments=[];
  groups.forEach(arr=>{
    arr.sort((a,b)=>a.num-b.num);
    let i=0;
    while(i<arr.length){
      let j=i;
      while(j+1<arr.length && arr[j+1].num===arr[j].num+1) j++;
      segments.push(j>i?`${arr[i].label} - ${arr[j].label}`:arr[i].label);
      i=j+1;
    }
  });
  return [...segments,...singles].join(', ');
}
function cablesByRoom(){
  syncActiveRoom();
  const map=new Map();
  (state.rooms||[]).forEach(r=>map.set(r.id,r.data?.cables||[]));
  return map;
}
async function exportAssetsXLSX(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Asset Tag','Nome','Tipo','Fabricante','Modelo','Serial Number','Localização','Rack','U Inicial','Quantidade U','Status','Substatus','Portas','Portas Disponíveis','Portas Usadas','Data de Compra','Vencimento da Garantia','Status da Garantia','Fim de Vida (EOL)'];
    const roomCables=cablesByRoom();
    const WARRANTY_LABELS={expired:'Vencida',soon:'Vence em breve',ok:'Em garantia',none:'—'};
    const rows=(state.assets||[]).map(a=>{
      const rack=assetRack(a.rackId);
      const ports=a.ports||[];
      const cables=roomCables.get(a.roomId)||[];
      const usedIds=new Set();
      cables.forEach(c=>{if(c.originPortId)usedIds.add(c.originPortId);if(c.destPortId)usedIds.add(c.destPortId);});
      const available=ports.filter(p=>!usedIds.has(p.id)).map(p=>p.label);
      const used=ports.filter(p=>usedIds.has(p.id)).map(p=>p.label);
      return [a.assetTag||'',a.name||'',a.type||'',a.manufacturer||'',a.model||'',a.serial||'',assetLocationLabel(a),rack?.name||'',rack?a.uStart||'':'',rack?(a.uHeight||1):'',a.status||'',a.substatus||'',compactPortLabels(ports.map(p=>p.label)),compactPortLabels(available),compactPortLabels(used),formatAssetDate(a.purchaseDate),formatAssetDate(a.warrantyExpiration),WARRANTY_LABELS[assetWarrantyLevel(a)],formatAssetDate(a.endOfLife)];
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
}
async function exportCablesXLSX(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Nome Asset Origem','Porta Origem','Rack Destino','U Destino','Nome Asset Destino','Porta Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Conexões (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota','Etiqueta'];
    const labelCol=headers.indexOf('Etiqueta')+1;
    const rows=state.cables.map(c=>{
      const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);
      const oPort=cablePortAt(c.originRack,c.originU,c.originPortId), dPort=cablePortAt(c.destRack,c.destU,c.destPortId);
      const label=`${cableEndpointLabel(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName)}\n${cableEndpointLabel(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName)}`;
      return [c.name,c.type||defaultCableType(),o?.name||'',c.originU,c.originAssetName||'',oPort?.label||c.originPortLabel||'',d?.name||'',c.destU,c.destAssetName||'',dPort?.label||c.destPortLabel||'',res.v1,res.tray,res.v2,res.connection,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res),label];
    });
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    ws.addRow(headers); rows.forEach(r=>ws.addRow(r));
    ws.freezePanes={xSplit:0,ySplit:1}; ws.autoFilter={from:'A1',to:`${excelColumnLetter(headers.length)}${Math.max(1,rows.length+1)}`}; ws.getRow(1).font={bold:true};
    ws.columns=headers.map((h,i)=>i+1===labelCol?{width:44}:{width:Math.min(60,Math.max(12,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))+2))});
    for(let i=2;i<=rows.length+1;i++){
      ws.getCell(`B${i}`).dataValidation={type:'list',allowBlank:false,formulae:[`"${cableTypeNames().join(',')}"`]};
      const cell=ws.getCell(i,labelCol); cell.alignment={wrapText:true,vertical:'top'};
      ws.getRow(i).height=30;
    }
    const summary=wb.addWorksheet('Resumo');
    summary.addRow(['RESUMO DE CABOS']); summary.getRow(1).font={bold:true,size:14};
    summary.addRow([]); summary.addRow(['Tipo','Metragem (m)','Quantidade']);
    summary.getRow(3).font={bold:true};
    const summaryRows=cableSummaryRows();
    summaryRows.forEach(r=>summary.addRow([r.type,r.length,r.qty]));
    const totalQty=summaryRows.reduce((s,r)=>s+r.qty,0);
    const totalMeters=summaryRows.reduce((s,r)=>s+r.length*r.qty,0);
    summary.addRow([]); summary.addRow(['TOTAL','',totalQty]);
    summary.addRow(['Metragem total arredondada (m)',totalMeters,'']);
    const invalid=state.cables.filter(c=>!cableUnitValidation(c).valid).length;
    const unreachable=state.cables.filter(c=>cableUnitValidation(c).valid&&!calcCable(c).reachable).length;
    summary.addRow([]); summary.addRow(['Cabos inválidos',invalid]); summary.addRow(['Cabos sem rota',unreachable]);
    summary.columns=[{width:26},{width:18},{width:16}];
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(state.projectName||'data-center')}-cabos.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Cabos exportados com resumo');
  }catch(err){toast(err.message||'Erro ao exportar Excel');}
}

let cablesSearchQuery='';
let cableMultiSelected=[];
function cableSearchHaystack(c){
  const o=state.racks.find(r=>r.id===c.originRack), d=state.racks.find(r=>r.id===c.destRack);
  const originLabel=cableEndpointLabel(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName);
  const destLabel=cableEndpointLabel(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName);
  return [c.name,c.type,o?.name,d?.name,c.originU,c.destU,c.originPortLabel,c.destPortLabel,c.originAssetName,c.destAssetName,originLabel,destLabel].filter(Boolean).join(' ').toLowerCase();
}
function renderCables(){
  const el=$('cablesList'); if(!el)return;
  $('cableCount').textContent=state.cables.length;
  cableMultiSelected=cableMultiSelected.filter(id=>state.cables.some(c=>c.id===id));
  const q=cablesSearchQuery.trim().toLowerCase();
  const filtered=q?state.cables.filter(c=>cableSearchHaystack(c).includes(q)):state.cables;
  if(!filtered.length){el.innerHTML=`<div class="empty">${q?'Nenhum cabo encontrado.':'Nenhum cabo cadastrado.'}</div>`;}
  else{
    el.innerHTML=filtered.map(c=>{
      const invalid=!cableUnitValidation(c).valid;
      const originLabel=cableEndpointLabel(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName);
      const destLabel=cableEndpointLabel(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName);
      const checked=cableMultiSelected.includes(c.id);
      const isSelected=state.selected?.type==='cable'&&state.selected.id===c.id;
      return `<div class="cable-item ${isSelected?'selected':''} ${invalid?'invalid':''} ${checked?'is-checked':''}" style="${isSelected?'':`border-left-color:${cableTypeColor(c.type)}`}" data-cable="${c.id}">
        <label class="cable-item-check" onclick="event.stopPropagation()"><input type="checkbox" data-cable-check="${c.id}" ${checked?'checked':''}></label>
        <div class="cable-item-body">
          <div class="cable-name-row"><span class="cable-name">${invalid?'⚠ ':''}${esc(c.name)}</span><span class="cable-type-tag" style="color:${cableTypeColor(c.type)}">${esc(c.type||'')}</span></div>
          <div class="cable-meta"><span>${esc(originLabel)}</span><span>${esc(destLabel)}</span></div>
        </div>
      </div>`;
    }).join('');
  }
  el.querySelectorAll('[data-cable]').forEach(x=>x.onclick=e=>{e.stopPropagation();state.multiSelected=[];state.selected={type:'cable',id:x.dataset.cable};renderAll();});
  el.querySelectorAll('[data-cable-check]').forEach(cb=>cb.onchange=()=>{
    const id=cb.dataset.cableCheck;
    if(cb.checked){if(!cableMultiSelected.includes(id))cableMultiSelected.push(id);}
    else cableMultiSelected=cableMultiSelected.filter(x=>x!==id);
    renderCables();
  });
  const selectAll=$('cablesSelectAll');
  if(selectAll){
    const visibleIds=filtered.map(c=>c.id);
    const selectedVisible=visibleIds.filter(id=>cableMultiSelected.includes(id)).length;
    selectAll.checked=visibleIds.length>0&&selectedVisible===visibleIds.length;
    selectAll.indeterminate=selectedVisible>0&&selectedVisible<visibleIds.length;
  }
  updateCablesBulkBar();
}
function updateCablesBulkBar(){
  const bar=$('cablesBulkBar'); if(!bar)return;
  bar.classList.toggle('hidden',cableMultiSelected.length===0);
  if($('cablesBulkCount'))$('cablesBulkCount').textContent=String(cableMultiSelected.length);
}
async function deleteCablesBulk(){
  const ids=[...cableMultiSelected];
  if(!ids.length)return;
  const ok=await uiConfirm('',{title:`Excluir ${ids.length} cabo(s) selecionado(s)?`,confirmText:'Excluir cabos',danger:true});
  if(!ok)return;
  state.cables=state.cables.filter(c=>!ids.includes(c.id));
  if(state.selected?.type==='cable' && ids.includes(state.selected.id))state.selected=null;
  cableMultiSelected=[];
  renderAll();toast(`${ids.length} cabo(s) excluído(s)`);
}
function ensureFields(){$('projectName').value=state.projectName;$('rowCount').value=state.rows.length;$('defaultRacks').value=state.rows[0]?.rackCount??0;$('rackUnits').value=state.rackUnits;$('rackWidth').value=state.rackWidth;$('rackDepth').value=state.rackDepth;$('rackGap').value=state.rackGap;$('rackPowerCapacity').value=state.rackPowerCapacityW>0?state.rackPowerCapacityW:'';$('rackWeightCapacity').value=state.rackWeightCapacityKg>0?state.rackWeightCapacityKg:'';$('defaultRowGap').value=state.defaultRowGap;$('lastUToTray').value=state.lastUToTray;$('defaultSlack').value=state.defaultSlack;}
function updateCanvasEmptyHint(){
  const hint=$('canvasEmptyHint'); if(!hint)return;
  const dismissed=localStorage.getItem('dccp_hint_dismissed')==='1';
  hint.classList.toggle('hidden',dismissed||state.rows.length>0);
}
function renderAll(persist=true){ensureFields();updateRoomUI();buildRowsPanel();render();renderProperties();renderCables();updateStructureControls();updateProjectSummary();updateMinimap();updateAlertsCenterBadge();updateRoomThermalBadge();updateCanvasEmptyHint();state.snapToEdges=true;if(persist)save();updateHistoryButtons();}

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
  const propSection=handle?.previousElementSibling;
  const right=handle?.closest('.sidebar.right');
  if(!handle||!propSection||!right)return;
  let startY=0,startH=0,dragging=false;
  const onMove=e=>{
    if(!dragging)return;
    const dy=e.clientY-startY;
    const maxAllowed=Math.max(120,right.clientHeight-140);
    const h=Math.max(120,Math.min(maxAllowed,startH+dy));
    propSection.style.maxHeight=h+'px';
  };
  const onUp=()=>{
    dragging=false;
    handle.classList.remove('is-dragging');
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
  };
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    dragging=true;
    startY=e.clientY;
    startH=propSection.getBoundingClientRect().height;
    handle.classList.add('is-dragging');
    document.addEventListener('pointermove',onMove);
    document.addEventListener('pointerup',onUp);
    e.preventDefault();
  });
}
function setupPan(){
  const wrap=$('canvasWrap'), stage=$('canvasStage');
  if(!wrap||!stage)return;
  let drag=null, raf=0;
  if(!window.__canvasPan) window.__canvasPan={x:-VIEW_PAD+40,y:-VIEW_PAD+40,zoom:1};
  const p=window.__canvasPan;
  if(!Number.isFinite(p.zoom))p.zoom=1;
  const clampZoom=z=>Math.max(0.55,Math.min(2.5,z));
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
  window.__applyCanvasPan=apply; window.__updateMinimap=()=>updateMinimap();
  window.__zoomIn=()=>{const evt={clientX:wrap.clientWidth/2,clientY:wrap.clientHeight/2,deltaY:-1,ctrlKey:false,preventDefault(){}};zoomAt(evt);};

  const zoomRange=$('zoomRange'), zoomValue=$('zoomReset');
  const syncZoomUI=()=>{
    const pct=Math.round((p.zoom||1)*100);
    if(zoomRange) zoomRange.value=String(Math.max(55,Math.min(250,pct)));
    if(zoomValue) zoomValue.textContent=`${pct}%`;
  };
  const setZoomAtCenter=(z)=>{
    const newZoom=clampZoom(Number(z)||1), oldZoom=p.zoom||1;
    if(newZoom===oldZoom){syncZoomUI();return;}
    const mx=wrap.clientWidth/2, my=wrap.clientHeight/2;
    const localX=(mx-p.x)/oldZoom, localY=(my-p.y)/oldZoom;
    p.zoom=newZoom; p.x=mx-localX*newZoom; p.y=my-localY*newZoom; apply(); syncZoomUI();
  };
  const fitToView=()=>{
    const svg=$('layout');
    if(!svg)return;
    // Fit the actual drawn plant, not the oversized internal canvas padding.
    const els=[...svg.querySelectorAll('.rack-body,.rack-face,.rack-text,.rack-width-label,.rack-depth-label,.svg-label,.tray-line,.tray-link,.tray-node,.tray-length,.cross-front,.cross-back,.route-line')];
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
    const z=clampZoom(Math.min((wrap.clientWidth-margin*2)/bw,(wrap.clientHeight-margin*2)/bh));
    p.zoom=z;
    p.x=(wrap.clientWidth-(box.x+box.x2)*z)/2;
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
  zoomRange?.addEventListener('input',e=>setZoomAtCenter(Number(e.target.value)/100));
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
function updateProjectSummary(){
  const s=projectSummaryStats(), inline=$('plannerProjectSummary');
  if(inline) inline.innerHTML=`<span>${s.rows} ${s.rows===1?'fileira':'fileiras'}</span><span>${s.racks} ${s.racks===1?'rack':'racks'}</span><span>${s.trays} ${s.trays===1?'calha':'calhas'}</span><span>${s.cables} ${s.cables===1?'cabo':'cabos'}</span>`;
  const grid=$('projectSummaryGrid'), name=$('summaryProjectName');
  if(name) name.textContent=state.projectName||'Data Center';
  if(grid){ const items=[['▤','Fileiras',s.rows],['▥','Racks',s.racks],['━','Calhas',s.trays],['⌁','Cabos',s.cables]]; grid.innerHTML=items.map(([icon,label,value])=>`<div class="summary-metric"><span class="summary-metric-icon">${icon}</span><div><strong>${value}</strong><span>${label}</span></div></div>`).join(''); }
}
function closeProjectSummary(){}

function searchableItems(query){
  const q=String(query||'').trim().toLowerCase(); if(!q)return [];
  const items=[];
  state.racks.forEach(r=>{const row=rowForRack(r); const hay=[r.name,row?.name,`rack ${r.name}`].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q))items.push({type:'rack',id:r.id,label:r.name||'Rack',meta:row?.name||'Fileira'});});
  state.trays.forEach(t=>{const hay=[t.name,`calha ${t.name}`].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q))items.push({type:'tray',id:t.id,label:t.name||'Calha',meta:'Calha'});});
  state.cables.forEach(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack); const hay=[c.name,`cabo ${c.name}`,o?.name,d?.name].filter(Boolean).join(' ').toLowerCase(); if(hay.includes(q))items.push({type:'cable',id:c.id,label:c.name||'Cabo',meta:`${o?.name||'?'} → ${d?.name||'?'}`});});
  return items.slice(0,30);
}
let quickSearchIndex=0, quickSearchItems=[];
function renderQuickSearchResults(query){
  const el=$('quickSearchResults'); if(!el)return; quickSearchItems=searchableItems(query);quickSearchIndex=Math.max(0,Math.min(quickSearchIndex,quickSearchItems.length-1));
  if(!String(query||'').trim()){el.innerHTML='<div class="empty">Digite para pesquisar.</div>';return;}
  if(!quickSearchItems.length){el.innerHTML='<div class="empty">Nenhum resultado encontrado.</div>';return;}
  el.innerHTML=quickSearchItems.map((x,i)=>`<button type="button" class="quick-result ${i===quickSearchIndex?'active':''}" data-search-type="${x.type}" data-search-id="${esc(x.id)}"><span class="quick-result-icon">${x.type==='rack'?'▥':x.type==='tray'?'━':'⌁'}</span><span><strong>${esc(x.label)}</strong><small>${esc(x.meta)}</small></span><b>${x.type==='rack'?'Rack':x.type==='tray'?'Calha':'Cabo'}</b></button>`).join('');
  el.querySelectorAll('[data-search-id]').forEach(b=>b.addEventListener('click',()=>activateSearchResult(b.dataset.searchType,b.dataset.searchId)));
}
function centerOnPoint(pt){
  const wrap=$('canvasWrap'),p=window.__canvasPan;if(!wrap||!p||!pt)return; const zoom=p.zoom||1; p.x=wrap.clientWidth/2-pt.x*zoom;p.y=wrap.clientHeight/2-pt.y*zoom; window.__applyCanvasPan?.();
}
function activateSearchResult(type,id){
  const g=geometry(); state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];
  if(type==='rack'){const r=state.racks.find(x=>x.id===id);if(!r)return;state.selected={type:'rack',id};state.multiSelected=[id];centerOnPoint(rackCenter(r,g));}
  else if(type==='tray'){const t=state.trays.find(x=>x.id===id);if(!t)return;state.selected={type:'tray',id};state.trayMultiSelected=[id];centerOnPoint({x:(t.x1+t.x2)/2,y:(t.y1+t.y2)/2});}
  else {const c=state.cables.find(x=>x.id===id);if(!c)return;state.selected={type:'cable',id};const pts=computeRoute(c,g);if(pts.length)centerOnPoint({x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length});}
  closeQuickSearch();renderAll(false);requestAnimationFrame(()=>window.__applyCanvasPan?.());
}
function openHelpModal(){const m=$('helpModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');}
function closeHelpModal(){const m=$('helpModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function switchHelpSection(section){
  document.querySelectorAll('[data-help-section]').forEach(b=>b.classList.toggle('active',b.dataset.helpSection===section));
  document.querySelectorAll('[data-help-panel]').forEach(p=>p.classList.toggle('hidden',p.dataset.helpPanel!==section));
}
function openQuickSearch(){const m=$('quickSearchModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');const i=$('quickSearchInput');if(i){i.value='';renderQuickSearchResults('');requestAnimationFrame(()=>i.focus());}}
function closeQuickSearch(){const m=$('quickSearchModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

function updateMinimap(){
  const box=$('minimap'),svg=$('minimapSvg'),wrap=$('canvasWrap'); if(!box||!svg||!wrap)return;
  const g=geometry(); if(!state.racks.length){svg.innerHTML='<text x="50%" y="50%" text-anchor="middle" class="minimap-empty">Sem racks</text>';return;}
  const pad=10,w=box.clientWidth||190,h=Math.max(110,(box.clientHeight||150)-34), sx=(w-pad*2)/Math.max(1,g.w), sy=(h-pad*2)/Math.max(1,g.h), sc=Math.min(sx,sy), ox=(w-g.w*sc)/2, oy=(h-g.h*sc)/2;
  const X=x=>ox+x*sc,Y=y=>oy+y*sc;
  let out=`<rect class="minimap-bg" x="0" y="0" width="${w}" height="${h}"/>`;
  state.trays.forEach(t=>{out+=`<line class="minimap-tray" x1="${X(t.x1)}" y1="${Y(t.y1)}" x2="${X(t.x2)}" y2="${Y(t.y2)}"/>`;});
  state.racks.forEach(r=>{const q=rackRect(r,g);out+=`<rect class="minimap-rack ${state.multiSelected.includes(r.id)?'selected':''}" x="${X(q.x)}" y="${Y(q.y)}" width="${Math.max(2,q.w*sc)}" height="${Math.max(3,q.h*sc)}"/>`;});
  const p=window.__canvasPan||{x:0,y:0,zoom:1},z=p.zoom||1; const vx=Math.max(0,(-p.x)/z),vy=Math.max(0,(-p.y)/z),vw=wrap.clientWidth/z,vh=wrap.clientHeight/z;
  out+=`<rect class="minimap-viewport" x="${X(vx)}" y="${Y(vy)}" width="${Math.max(4,vw*sc)}" height="${Math.max(4,vh*sc)}"/>`;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.innerHTML=out;svg.dataset.ox=ox;svg.dataset.oy=oy;svg.dataset.scale=sc;svg.dataset.gw=g.w;svg.dataset.gh=g.h;
}
function setupMinimap(){
  const toggle=$('minimapToggle'),box=$('minimap'),svg=$('minimapSvg'); if(!toggle||!box||!svg)return;
  const setOpen=open=>{box.classList.toggle('hidden',!open);if(open)requestAnimationFrame(updateMinimap);};
  toggle.addEventListener('click',()=>setOpen(box.classList.contains('hidden')));$('minimapClose')?.addEventListener('click',()=>setOpen(false));
  svg.addEventListener('pointerdown',e=>{const sc=Number(svg.dataset.scale)||1,ox=Number(svg.dataset.ox)||0,oy=Number(svg.dataset.oy)||0,g=geometry(),pt={x:(e.offsetX-ox)/sc,y:(e.offsetY-oy)/sc};const wrap=$('canvasWrap'),p=window.__canvasPan;if(!wrap||!p)return;const z=p.zoom||1;p.x=wrap.clientWidth/2-pt.x*z;p.y=wrap.clientHeight/2-pt.y*z;window.__applyCanvasPan?.();updateMinimap();e.preventDefault();});
  box.classList.add('hidden');
}
async function newProject(){
  const ok=await uiConfirm('O projeto atual continuará salvo na nuvem.',{title:'Criar um novo projeto?',confirmText:'Criar novo projeto'});
  if(!ok)return;
  await createNewCloudProject();
}


// --- Inventory import/export -------------------------------------------------
let pendingImport = null;
const CATALOG_SHEET_HEADERS = {
  types:['Tipo'],
  manufacturers:['Fabricante'],
  models:['Tipo','Fabricante','Modelo']
};
async function ensureJsPDF(){
  if(window.jspdf?.jsPDF)return true;
  if(window.__jspdfLoading)return window.__jspdfLoading;
  window.__jspdfLoading=new Promise(resolve=>{
    const s1=document.createElement('script');
    s1.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    s1.onload=()=>{
      const s2=document.createElement('script');
      s2.src='https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js';
      s2.onload=()=>resolve(!!window.jspdf?.jsPDF);
      s2.onerror=()=>resolve(false);
      document.head.appendChild(s2);
    };
    s1.onerror=()=>resolve(false);
    document.head.appendChild(s1);
  });
  return window.__jspdfLoading;
}
function hexToRgb(hex){
  const m=/^#([0-9a-f]{6})$/i.exec(hex||'');
  if(!m)return [148,163,184];
  const n=parseInt(m[1],16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}
function buildRackBayfaceTableBody(rack){
  const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
  const assets=state.assets.filter(a=>a.rackId===rack.id && !isAssetArchived(a));
  const occupiedByU=new Map();
  assets.forEach(a=>{
    const o=assetOccupancy(a);
    for(let u=Math.max(1,o.start);u<=Math.min(units,o.end);u++)occupiedByU.set(u,a);
  });
  const rows=[]; const startedAssets=new Set();
  // Uma entrada no array por U, sem pular nenhuma. A célula de U NUNCA mescla
  // (cada U sempre mostra o próprio número, mesmo dentro de um equipamento de
  // mais de uma U) — só a célula do equipamento mescla (rowSpan) ao longo do
  // bloco todo.
  for(let u=units;u>=1;u--){
    const asset=occupiedByU.get(u);
    if(asset){
      if(startedAssets.has(asset.id)){
        rows.push([{content:String(u),styles:{halign:'center',fillColor:[235,238,242],fontStyle:'bold'}}]);
        continue;
      }
      startedAssets.add(asset.id);
      const o=assetOccupancy(asset);
      const start=Math.max(1,o.start), end=Math.min(units,o.end);
      const span=end-start+1;
      const name=String(asset.name||asset.assetTag||'Equipamento');
      const tag=asset.assetTag?`Tag: ${asset.assetTag}`:'';
      const sn=asset.serial?`SN: ${asset.serial}`:'';
      const label=span===1?[name,tag,sn].filter(Boolean).join(' - '):`${[name,tag].filter(Boolean).join(' - ')}\n${sn}`;
      const [r,g,b]=hexToRgb(bayfaceTypeColor(asset.type));
      rows.push([
        {content:String(u),styles:{halign:'center',fillColor:[235,238,242],fontStyle:'bold'}},
        {content:label,rowSpan:span,styles:{fillColor:[r,g,b],textColor:255,fontStyle:'bold',valign:'middle'}},
        {content:`${span}U`,rowSpan:span,styles:{fillColor:[r,g,b],textColor:255,halign:'center',valign:'middle',fontStyle:'bold',fontSize:5}},
      ]);
    }else{
      rows.push([{content:String(u),styles:{halign:'center'}},{content:''},{content:''}]);
    }
  }
  return rows;
}
function pickRackTableStyle(units,availableHmm){
  // Escolhe fonte/espaçamento pra caber o rack inteiro numa página só,
  // reduzindo conforme a quantidade de U aumenta. Aplica uma margem de
  // segurança de 10% pra nunca estourar a página por uma estimativa imprecisa.
  const rowH=(availableHmm/units)*0.9;
  if(rowH>=6)return {fontSize:7.5,cellPadding:1.3};
  if(rowH>=4.5)return {fontSize:6,cellPadding:0.9};
  if(rowH>=3.2)return {fontSize:5,cellPadding:0.55};
  if(rowH>=2.4)return {fontSize:4.2,cellPadding:0.35};
  return {fontSize:3.5,cellPadding:0.2};
}

async function generatePDFReport(options={}){
  const opt={summary:true,status:true,lifecycle:true,cables:true,...options};
  try{
    toast('Gerando relatório...');
    if(!await ensureJsPDF()) throw new Error('Biblioteca de PDF não carregada.');
    syncActiveRoom();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;

    doc.setFontSize(18); doc.setFont(undefined,'bold'); doc.setTextColor(0);
    doc.text('Relatório do Data Center', margin, 20);
    doc.setFontSize(11); doc.setFont(undefined,'normal');
    doc.text(`Projeto: ${state.projectName||'Sem nome'}`, margin, 28);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, 34);

    const allRacksFull = allProjectRacks();
    const allRacks = options.rackIds?Array.isArray(options.rackIds)?allRacksFull.filter(({rack:r})=>options.rackIds.includes(r.id)):allRacksFull:allRacksFull;
    const activeAssets = state.assets.filter(a=>!isAssetArchived(a));
    const lifecycleIssues = assetsNeedingAttention();
    const capIssues = capacityIssues();
    let y = 40;

    if(opt.summary){
      doc.autoTable({
        startY: 42,
        head: [['Resumo geral', '']],
        body: [
          ['Salas', String(state.rooms.length)],
          ['Racks', String(allRacksFull.length)],
          ['Assets ativos', String(activeAssets.length)],
          ['Cabos cadastrados', String(state.cables.length)],
          ['Alertas de ciclo de vida', String(lifecycleIssues.length)],
          ['Alertas de capacidade', String(capIssues.length)],
        ],
        theme:'grid', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        columnStyles:{0:{fontStyle:'bold',cellWidth:70}},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Racks e capacidade ---
    const rackRows = allRacks.map(({rack:r,room})=>{
      const occupied = state.assets.filter(a=>a.rackId===r.id && !isAssetArchived(a)).reduce((s,a)=>s+Math.max(1,Math.floor(num(a.uHeight,1))),0);
      const units = Math.max(1,Math.floor(num(r.units,state.rackUnits)));
      const powerW = state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.powerW,0)),0);
      const powerCap = num(r.powerCapacityW,0);
      const weightKg = state.assets.filter(a=>a.rackId===r.id).reduce((s,a)=>s+Math.max(0,num(a.weightKg,0)),0);
      const weightCap = num(r.weightCapacityKg,0);
      return [
        room.name||'—', r.name||'—', `${occupied}U / ${units}U`,
        powerCap>0?`${powerW}W / ${powerCap}W`:`${powerW}W (sem limite)`,
        weightCap>0?`${weightKg}kg / ${weightCap}kg`:`${weightKg}kg (sem limite)`,
      ];
    });
    if(rackRows.length){
      if(y > pageHeight-40){ doc.addPage(); y=20; }
      doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Racks e capacidade', margin, y);
      doc.autoTable({
        startY: y+4,
        head: [['Sala','Rack','Ocupação','Energia','Carga do piso']],
        body: rackRows,
        theme:'striped', styles:{fontSize:8}, headStyles:{fillColor:[31,41,55]},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Bayface dos racks: tabela simples (U + equipamento), com bordas e
    // linhas mescladas para equipamentos de mais de uma U. Largura estreita,
    // proporcional a um rack de verdade, com vários lado a lado quando couberem. ---
    if(allRacks.length){
      doc.addPage(); y=20;
      doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.setTextColor(0);
      doc.text('Bayface dos racks', margin, y);
      y += 10;
      const rackColWidth=54, gap=5;
      const racksPerRow=Math.max(1,Math.floor((pageWidth-margin*2+gap)/(rackColWidth+gap)));
      for(let i=0;i<allRacks.length;i+=racksPerRow){
        // se sobrar pouco espaço na página atual, começa uma nova antes de
        // desenhar essa fileira de racks (evita espremer a fonte à toa)
        if(pageHeight-y-15 < 80){ doc.addPage(); y=20; }
        const availableH=pageHeight-y-15;
        let maxFinalY=y;
        const rowItems=allRacks.slice(i,i+racksPerRow);
        rowItems.forEach((item,idx)=>{
          const x=margin+idx*(rackColWidth+gap);
          const units=Math.max(1,Math.floor(num(item.rack.units,state.rackUnits)));
          doc.setFontSize(7.5); doc.setFont(undefined,'bold'); doc.setTextColor(0);
          doc.text(`${item.room.name||''} — ${item.rack.name||''}`, x, y, {maxWidth:rackColWidth});
          const style=pickRackTableStyle(units, availableH-6);
          doc.autoTable({
            startY: y+5,
            body: buildRackBayfaceTableBody(item.rack),
            theme:'grid',
            styles:{fontSize:style.fontSize,cellPadding:style.cellPadding,lineColor:[200,200,200],lineWidth:0.1},
            columnStyles:{0:{cellWidth:8},2:{cellWidth:8}},
            margin:{left:x},
            tableWidth:rackColWidth,
          });
          maxFinalY=Math.max(maxFinalY, doc.lastAutoTable.finalY);
        });
        y=maxFinalY+14;
      }
    }

    // --- Assets por status ---
    if(opt.status){
      const statusCounts = new Map();
      activeAssets.forEach(a=>{const s=a.status||'—'; statusCounts.set(s,(statusCounts.get(s)||0)+1);});
      if(statusCounts.size){
        if(y > pageHeight-40){ doc.addPage(); y=20; }
        doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Assets por status', margin, y);
        doc.autoTable({
          startY: y+4,
          head: [['Status','Quantidade']],
          body: [...statusCounts.entries()].map(([s,c])=>[s,String(c)]),
          theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        });
        y = doc.lastAutoTable.finalY + 10;
      }
    }

    // --- Alertas de ciclo de vida ---
    if(opt.lifecycle && lifecycleIssues.length){
      if(y > pageHeight-40){ doc.addPage(); y=20; }
      doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Alertas de ciclo de vida', margin, y);
      const rows = lifecycleIssues.map(a=>{
        const w=assetWarrantyLevel(a), e=assetEndOfLifeLevel(a);
        const reason=[w==='expired'?'Garantia vencida':w==='soon'?'Garantia vence em breve':null,e==='expired'?'EOL vencido':e==='soon'?'EOL vence em breve':null].filter(Boolean).join(' · ');
        return [a.name||a.assetTag||'—', reason];
      });
      doc.autoTable({
        startY: y+4,
        head: [['Asset','Alerta']],
        body: rows,
        theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[200,80,60]},
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // --- Resumo de cabos ---
    if(opt.cables){
      const cableRows = cableSummaryRows();
      if(cableRows.length){
        if(y > pageHeight-40){ doc.addPage(); y=20; }
        doc.setFontSize(13); doc.setFont(undefined,'bold'); doc.setTextColor(0); doc.text('Resumo de cabos', margin, y);
        doc.autoTable({
          startY: y+4,
          head: [['Tipo','Comprimento (m)','Quantidade']],
          body: cableRows.map(r=>[r.type, String(r.length), String(r.qty)]),
          theme:'striped', styles:{fontSize:9}, headStyles:{fillColor:[31,41,55]},
        });
      }
    }

    // --- Numeração de página ---
    const pageCount = doc.internal.getNumberOfPages();
    for(let i=1;i<=pageCount;i++){
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(140);
      doc.text(`Página ${i} de ${pageCount}`, pageWidth-margin, pageHeight-8, {align:'right'});
    }

    doc.save(`Relatorio_${(state.projectName||'DataCenter').replace(/[^A-Za-z0-9_-]/g,'_')}.pdf`);
    toast('Relatório PDF gerado');
  }catch(err){
    console.error('Erro ao gerar relatório PDF:',err);
    toast('Não foi possível gerar o relatório PDF: '+(err?.message||err));
  }
}
function openPdfReportOptions(){
  const m=$('pdfReportOptionsModal');if(!m)return;
  syncActiveRoom();
  const list=$('pdfRacksList');
  if(list){
    const racks=allProjectRacks();
    const byRoom=new Map();
    racks.forEach(({rack:r,room})=>{
      if(!byRoom.has(room.id))byRoom.set(room.id,{room,racks:[]});
      byRoom.get(room.id).racks.push(r);
    });
    let html='';
    byRoom.forEach(({room,racks:roomRacks})=>{
      html+=`<div class="pdf-report-room-group">
        <div class="pdf-report-room-header">
          <input type="checkbox" data-pdf-room="${esc(room.id)}" checked>
          <button type="button" class="pdf-report-room-chevron" data-room-expand="${esc(room.id)}">▸</button>
          <span>${esc(room.name||'Sala')}</span><small>(${roomRacks.length})</small>
        </div>
        <div class="pdf-report-room-racks hidden" data-room-racks="${esc(room.id)}">
          ${roomRacks.map(r=>`<label class="pdf-report-rack-row"><input type="checkbox" data-pdf-rack="${esc(r.id)}" data-pdf-room-of="${esc(room.id)}" checked><span>${esc(r.name||'Rack')}</span></label>`).join('')}
        </div>
      </div>`;
    });
    list.innerHTML=html||'<div class="empty">Nenhum rack no projeto.</div>';
    const updateRoomCheckbox=(roomId)=>{
      const rackBoxes=[...list.querySelectorAll(`[data-pdf-rack][data-pdf-room-of="${roomId}"]`)];
      const roomBox=list.querySelector(`[data-pdf-room="${roomId}"]`); if(!roomBox)return;
      const checkedCount=rackBoxes.filter(cb=>cb.checked).length;
      roomBox.checked=checkedCount===rackBoxes.length;
      roomBox.indeterminate=checkedCount>0&&checkedCount<rackBoxes.length;
    };
    list.querySelectorAll('[data-room-expand]').forEach(btn=>{
      const toggle=()=>{
        const racksEl=list.querySelector(`[data-room-racks="${btn.dataset.roomExpand}"]`);
        const nowHidden=racksEl.classList.toggle('hidden');
        btn.classList.toggle('expanded',!nowHidden);
      };
      btn.addEventListener('click',toggle);
      btn.closest('.pdf-report-room-header').querySelector('span').addEventListener('click',toggle);
    });
    list.querySelectorAll('[data-pdf-room]').forEach(roomBox=>roomBox.addEventListener('change',()=>{
      list.querySelectorAll(`[data-pdf-rack][data-pdf-room-of="${roomBox.dataset.pdfRoom}"]`).forEach(cb=>cb.checked=roomBox.checked);
      roomBox.indeterminate=false;
    }));
    list.querySelectorAll('[data-pdf-rack]').forEach(cb=>cb.addEventListener('change',()=>updateRoomCheckbox(cb.dataset.pdfRoomOf)));
  }
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
}
function closePdfReportOptions(){const m=$('pdfReportOptionsModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
async function ensureExcelJS(){
  if(window.ExcelJS)return true;
  if(window.__exceljsLoading)return window.__exceljsLoading;
  window.__exceljsLoading=new Promise(resolve=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload=()=>resolve(!!window.ExcelJS);
    s.onerror=()=>resolve(false);
    document.head.appendChild(s);
  });
  return window.__exceljsLoading;
}
function assetStatusValues(){ normalizeAssetCatalogs(); return state.assetCatalogs.statuses||DEFAULT_ASSET_STATUSES.slice(); }
async function makeAssetsTemplate(){
  try{
    if(!await ensureExcelJS()) throw new Error('Biblioteca ExcelJS não carregada.');
    normalizeAssetCatalogs(); normalizeLocations();
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Assets');
    const headers=['Asset Tag','Nome','Serial Number','Modelo','Localização','Rack','U Inicial','Quantidade U','Status','Substatus','Potência (W)','Peso (kg)','Data de compra','Vencimento da garantia','Fim de vida (EOL)'];
    ws.addRow(headers);
    (state.assets||[]).forEach(a=>{
      const room=assetRoom(a), rack=assetRack(a.rackId);
      const rackDisplay=rack ? `${room?.name||assetRackRoom(a)?.name||''} / ${rack.name||''}`.replace(/^ \/ /,'') : '';
      ws.addRow([a.assetTag||'',a.name||'',a.serial||'',a.model||'',assetLocationLabel(a),rackDisplay,a.uStart||'',a.uHeight||1,a.status||'Instalado',a.substatus||'',a.powerW||'',a.weightKg||'',a.purchaseDate||'',a.warrantyExpiration||'',a.endOfLife||'']);
    });
    ws.views=[{state:'frozen',ySplit:1}];
    ws.autoFilter={from:'A1',to:'O1'};
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F2937'}};
    ws.getRow(1).alignment={vertical:'middle'};
    ws.columns=[18,32,24,30,28,22,12,14,18,22,16,14,16,20,18].map(width=>({width}));
    ws.getRow(1).height=24;
    ws.getCell('A1').note='Opcional. Identificador interno do asset.';
    ws.getCell('B1').note='Obrigatório.';
    ws.getCell('C1').note='Obrigatório.';
    ws.getCell('D1').note='Obrigatório. O sistema usa o modelo cadastrado para identificar Tipo e Fabricante.';
    ws.getCell('E1').note='Obrigatório. Formato: Data Center / Sala ou Data Center / Estoque.';
    ws.getCell('F1').note='Opcional. Se informado, deve existir na sala selecionada.';
    ws.getCell('G1').note='Obrigatório somente quando um Rack for informado. O sistema valida se a U está livre.';
    ws.getCell('H1').note='Quantidade de U ocupadas pelo asset.';
    ws.getCell('I1').note='Status do asset. Valores sugeridos: Arquivado, Instalado, Reservado, Desligado, Estoque.';
    ws.getCell('J1').note='Substatus. Valores sugeridos: Em estoque, Ligado, Desligado, Disposed, Perdido, Retired, Retornado ao Vendor.';
    ws.getCell('K1').note='Opcional. Se deixado em branco, usa o valor cadastrado no modelo (Catálogo → Modelos), quando existir.';
    ws.getCell('L1').note='Opcional. Se deixado em branco, usa o valor cadastrado no modelo (Catálogo → Modelos), quando existir.';
    ws.getCell('M1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';
    ws.getCell('N1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';
    ws.getCell('O1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';

    // --- Aba de referência (oculta), fonte das listas suspensas e da busca
    // de potência/peso por modelo. Não é pra ser editada pelo usuário. ---
    const refWs=wb.addWorksheet('NÃO EDITAR - Referência');
    const allLocations=[];
    (state.locations||[]).forEach(l=>{
      (l.rooms||[]).forEach(rid=>{const r=state.rooms.find(x=>x.id===rid); if(r)allLocations.push(`${l.name} / ${r.name}`);});
      (l.stocks||[]).forEach(st=>allLocations.push(`${l.name} / ${st.name}`));
    });
    const allRacks=[...new Set(allProjectRacks().map(({rack:r})=>r.name).filter(Boolean))];
    const allModels=(state.assetCatalogs.models||[]).filter(m=>m.name);
    refWs.getColumn(1).values=['Localizações',...allLocations];
    refWs.getColumn(2).values=['Racks',...allRacks];
    refWs.getColumn(3).values=['Modelos',...allModels.map(m=>m.name)];
    refWs.getColumn(4).values=['Potência (W)',...allModels.map(m=>m.powerW||'')];
    refWs.getColumn(5).values=['Peso (kg)',...allModels.map(m=>m.weightKg||'')];
    refWs.getColumn(6).values=['Status',...assetStatusValues()];
    refWs.getColumn(7).values=['Substatus',...assetSubstatusValues()];
    refWs.state='hidden';

    const locRange=`'NÃO EDITAR - Referência'!$A$2:$A$${Math.max(2,allLocations.length+1)}`;
    const rackRange=`'NÃO EDITAR - Referência'!$B$2:$B$${Math.max(2,allRacks.length+1)}`;
    const modelRange=`'NÃO EDITAR - Referência'!$C$2:$C$${Math.max(2,allModels.length+1)}`;
    const statusRange=`'NÃO EDITAR - Referência'!$F$2:$F$${Math.max(2,assetStatusValues().length+1)}`;
    const substatusRange=`'NÃO EDITAR - Referência'!$G$2:$G$${Math.max(2,assetSubstatusValues().length+1)}`;
    const existingRows=(state.assets||[]).length;
    for(let row=2;row<=1000;row++){
      ws.getCell(`D${row}`).dataValidation={type:'list',allowBlank:true,formulae:[modelRange]};
      ws.getCell(`E${row}`).dataValidation={type:'list',allowBlank:true,formulae:[locRange]};
      ws.getCell(`F${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
      ws.getCell(`I${row}`).dataValidation={type:'list',allowBlank:true,formulae:[statusRange]};
      ws.getCell(`J${row}`).dataValidation={type:'list',allowBlank:true,formulae:[substatusRange]};
      // As fórmulas de potência/peso só vão nas linhas em branco (pra novos
      // assets) — nas linhas que já têm um asset exportado, mantém o valor
      // real dele, que pode ter sido alterado manualmente e ser diferente
      // do padrão cadastrado no modelo.
      if(row>existingRows+1){
        ws.getCell(`K${row}`).value={formula:`IFERROR(VLOOKUP(D${row},'NÃO EDITAR - Referência'!$C:$E,2,FALSE),"")`};
        ws.getCell(`L${row}`).value={formula:`IFERROR(VLOOKUP(D${row},'NÃO EDITAR - Referência'!$C:$E,3,FALSE),"")`};
      }
    }

    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download='Modelo_Importacao_Assets_Stratum.xlsx';a.style.display='none';
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},2000);
    toast('Modelo de importação baixado');
  }catch(err){console.error('Assets template error:',err);toast('Não foi possível gerar o modelo: '+(err?.message||err));}
}

function readWorkbookFile(file){return file.arrayBuffer().then(buf=>XLSX.read(buf,{type:'array',cellDates:false}));}
function sheetRows(wb,name){const ws=wb.Sheets[name];if(!ws)return[];return XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});}
function cleanHeaderMap(row){const out={};Object.entries(row||{}).forEach(([k,v])=>{out[String(k).trim().toLowerCase()]=String(v??'').trim();});return out;}
function getCol(row,aliases){
  const m=cleanHeaderMap(row);
  for(const a of aliases){const key=String(a).trim().toLowerCase(); if(m[key]!==undefined) return String(m[key]??'').trim();}
  // Fallback for simple one-column templates/CSV files whose header was altered
  // by Excel/LibreOffice (e.g. "Fabricantes", "Manufacturer Name").
  const keys=Object.keys(m);
  if(keys.length===1){const k=keys[0]; const v=String(m[k]??'').trim(); if(v) return v;}
  return '';
}
function assetImportCatalogOptions(kind, selected=''){
  normalizeAssetCatalogs();
  if(kind==='type') return '<option value="">Selecione</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='manufacturer') return '<option value="">Selecione</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='model'){
    const exists=(state.assetCatalogs.models||[]).some(m=>catalogNormalize(m.name)===catalogNormalize(selected));
    const missing=selected&&!exists?`<option value="${esc(selected)}" selected>⚠ ${esc(selected)} — não cadastrado</option>`:'';
    return '<option value="">Selecione</option>'+missing+(state.assetCatalogs.models||[]).map(m=>`<option value="${esc(m.name)}" data-model-type="${esc(m.type||'')}" data-model-manufacturer="${esc(m.manufacturer||'')}" ${catalogNormalize(m.name)===catalogNormalize(selected)?'selected':''}>${esc(m.name)}${m.manufacturer?` — ${esc(m.manufacturer)}`:''}</option>`).join('');
  }
  if(kind==='status') return '<option value="">Selecione</option>'+assetStatusValues().map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='substatus') return '<option value="">Selecione</option>'+assetSubstatusValues().map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  return '';
}
function resolveAssetImportLocation(value=''){
  normalizeLocations();
  const raw=String(value||'').trim();
  if(!raw) return {raw,loc:null,room:null,stock:null,isStock:false};
  const norm=catalogNormalize(raw);
  for(const loc of (state.locations||[])){
    for(const rid of (loc.rooms||[])){
      const room=state.rooms.find(r=>r.id===rid); if(!room) continue;
      if(norm===catalogNormalize(`${loc.name} / ${room.name}`)||norm===catalogNormalize(room.name)) return {raw,loc,room,stock:null,isStock:false};
    }
    for(const stock of (loc.stocks||[])){
      if(norm===catalogNormalize(`${loc.name} / ${stock.name}`)||norm===catalogNormalize(stock.name)) return {raw,loc,room:null,stock,isStock:true};
    }
  }
  return {raw,loc:null,room:null,stock:null,isStock:norm==='estoque'};
}
function assetImportRoomOptions(selected=''){normalizeLocations();let out='<option value="">Selecione</option>';state.locations.forEach(l=>{l.rooms.forEach(rid=>{const r=state.rooms.find(x=>x.id===rid);if(r){const v=`${l.name} / ${r.name}`;out+=`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`;}});l.stocks.forEach(st=>{const v=`${l.name} / ${st.name}`;out+=`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>📦 ${esc(v)}</option>`;});});return out;}
function assetImportRackOptions(roomName='',selected=''){
  const room=resolveAssetImportLocation(roomName).room;
  const racks=room?.data?.racks||[];
  return '<option value="">Selecione</option>'+racks.map(r=>`<option value="${esc(r.name)}" ${catalogNormalize(r.name)===catalogNormalize(selected)?'selected':''}>${esc(r.name)}</option>`).join('');
}
function assetImportUOptions(item){
  const room=resolveAssetImportLocation(item.data?.['Localização']??item.data?.Sala).room;
  const rack=room?.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(item.data?.Rack));
  if(!rack)return '<option value="">—</option>';
  const rackId=rack.id, height=Math.max(1,Math.floor(parseImportNumber(item.data?.['Quantidade U'],1)));
  const used=new Set();
  (state.assets||[]).filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)used.add(u);});
  const rows=pendingImport?.rows||[];
  rows.forEach(other=>{if(other===item||!other.valid)return;const rr=(state.rooms||[]).find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Sala));const rk=rr?.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Rack));if(rk?.id===rackId){const st=Math.floor(parseImportNumber(other.data?.['U Inicial'],0)),h=Math.max(1,Math.floor(parseImportNumber(other.data?.['Quantidade U'],1)));if(st)for(let u=st;u<st+h;u++)used.add(u);}});
  const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits))); const current=Math.floor(parseImportNumber(item.data?.['U Inicial'],0));
  let html='<option value="">Selecione</option>';
  for(let st=1;st<=units-height+1;st++){
    let free=true;for(let u=st;u<st+height;u++)if(used.has(u)&&st!==current){free=false;break;}
    if(free)html+=`<option value="${st}" ${st===current?'selected':''}>U${st}</option>`;
  }
  return html;
}
function validateAssetImportRows(rows){
  normalizeAssets(); ensureRooms(); normalizeAssetCatalogs();
  const existingBySerial=new Map((state.assets||[]).filter(a=>a.serial).map(a=>[catalogNormalize(a.serial),a]));
  const existingByName=new Map((state.assets||[]).filter(a=>a.name).map(a=>[catalogNormalize(a.name),a]));
  const occupiedByRack=new Map();
  (state.assets||[]).filter(a=>a.rackId&&!isAssetArchived(a)).forEach(a=>{
    const set=occupiedByRack.get(a.rackId)||new Set(), o=assetOccupancy(a);
    for(let u=o.start;u<=o.end;u++) set.add(u);
    occupiedByRack.set(a.rackId,set);
  });

  // Index the complete import first so duplicate checks are independent of row order
  // and of other validation errors in the same row.
  const serialRows=new Map(), nameRows=new Map();
  rows.forEach((item,idx)=>{
    const d=item.data||{};
    const sk=catalogNormalize(d['Serial Number']), nk=catalogNormalize(d.Nome);
    if(sk){const arr=serialRows.get(sk)||[];arr.push(idx);serialRows.set(sk,arr);}
    if(nk){const arr=nameRows.get(nk)||[];arr.push(idx);nameRows.set(nk,arr);}
  });

  // First resolve model -> type/manufacturer for every row.
  rows.forEach(item=>{
    const d=item.data||{};
    const model=(state.assetCatalogs.models||[]).find(m=>catalogNormalize(m.name)===catalogNormalize(d.Modelo));
    item._modelMissing=!!(d.Modelo && !model);
    if(model){d.Modelo=model.name;d.Tipo=model.type||'';d.Fabricante=model.manufacturer||'';item._modelMissing=false;}
  });

  // Validate all rules independently and collect EVERY problem, not only the first one.
  const plannedByRack=new Map();
  rows.forEach((item,idx)=>{
    const d=item.data||{};
    const problems=[];
    item.warning=''; item.message=''; item.valid=false; item._validated=true;

    const name=String(d.Nome||'').trim();
    const serial=String(d['Serial Number']||'').trim();
    const modelName=String(d.Modelo||'').trim();
    const status=String(d.Status||'Instalado').trim();
    const substatus=String(d.Substatus||'').trim();
    const locationName=String(d['Localização']??d.Sala??'').trim();
    const locationResolved=resolveAssetImportLocation(locationName);
    const isStock=locationResolved.isStock;
    const room=locationResolved.room;
    const rackName=String(d.Rack||'').trim();
    const uStart=Math.floor(parseImportNumber(d['U Inicial'],0));
    const uHeight=Math.max(1,Math.floor(parseImportNumber(d['Quantidade U'],1)));

    if(!name) problems.push('Nome é obrigatório.');
    if(!serial) problems.push('Serial Number é obrigatório.');
    if(!modelName) problems.push('Modelo é obrigatório.');
    const model=(state.assetCatalogs.models||[]).find(m=>catalogNormalize(m.name)===catalogNormalize(modelName));
    if(model){ d.Modelo=model.name; d.Tipo=model.type||''; d.Fabricante=model.manufacturer||''; item._modelMissing=false; }
    else if(modelName) problems.push(`Modelo "${modelName}" não está cadastrado.`);

    if(!assetStatusValues().some(v=>catalogNormalize(v)===catalogNormalize(status))){
      problems.push(`Status "${status}" não está cadastrado.`);
    } else if(!d.Status){ d.Status=status; }
    if(substatus && !assetSubstatusValues().some(v=>catalogNormalize(v)===catalogNormalize(substatus))) problems.push(`Substatus "${substatus}" não está cadastrado.`);

    if(!locationName) problems.push('Localização é obrigatória.');
    else if(!locationResolved.loc) problems.push(`Localização "${locationName}" não existe.`);

    const rack=room&&rackName?(room.data?.racks||[]).find(r=>catalogNormalize(r.name)===catalogNormalize(rackName)):null;
    // Rack is optional. If provided, it must exist in the selected room.
    if(rackName && !rack) problems.push(`Rack "${rackName}" não existe na sala.`);

    if(rack){
      if(uStart<1) problems.push('U Inicial é obrigatória quando um Rack é informado.');
      if(uHeight<1) problems.push('Quantidade U deve ser pelo menos 1.');
      const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
      if(uStart>=1 && uStart+uHeight-1>units) problems.push(`Posição U${uStart}–U${uStart+uHeight-1} ultrapassa o limite do rack (${units}U).`);

      const existing=occupiedByRack.get(rack.id)||new Set();
      const planned=plannedByRack.get(rack.id)||new Map();
      if(uStart>=1 && uStart+uHeight-1<=units){
        const conflictsExisting=[]; const conflictsImport=[];
        for(let u=uStart;u<uStart+uHeight;u++){
          if(existing.has(u)) conflictsExisting.push(`U${u}`);
          if(planned.has(u)) conflictsImport.push(`U${u}`);
        }
        if(conflictsExisting.length) problems.push(`U já ocupada por asset existente: ${conflictsExisting.join(', ')}.`);
        if(conflictsImport.length){
          const lines=[...new Set(conflictsImport.map(u=>planned.get(u)))].join(', ');
          problems.push(`Conflito de U com outra linha desta importação: ${conflictsImport.join(', ')} (linha(s) ${lines}).`);
        }
      }
      // Reserve all requested positions so conflicts are detected globally, even
      // when the current row has other unrelated validation errors.
      if(uStart>=1 && uStart+uHeight-1<=units){
        for(let u=uStart;u<uStart+uHeight;u++) if(!planned.has(u)) planned.set(u, item.line??idx+2);
        plannedByRack.set(rack.id,planned);
      }
    }

    const serialKey=catalogNormalize(serial), nameKey=catalogNormalize(name);
    const exS=serialKey?existingBySerial.get(serialKey):null;
    const exN=nameKey?existingByName.get(nameKey):null;
    if(serialKey && exS) problems.push('Serial Number já em uso.');
    if(serialKey && serialRows.get(serialKey)?.length>1){
      const others=serialRows.get(serialKey).filter(i=>i!==idx).map(i=>rows[i].line??i+2).join(', ');
      problems.push(`Serial Number duplicado nesta importação (também na linha ${others}).`);
    }
    if(nameKey && nameRows.get(nameKey)?.length>1){
      const others=nameRows.get(nameKey).filter(i=>i!==idx).map(i=>rows[i].line??i+2).join(', ');
      problems.push(`Nome duplicado nesta importação (também na linha ${others}).`);
    }
    if(nameKey && exN) problems.push('Nome já em uso.');

    // Similar names are warnings, never blockers.
    if(nameKey){
      const similar=(state.assets||[]).find(a=>!isAssetArchived(a)&&catalogNormalize(a.name)!==nameKey&&catalogSimilarity(a.name||'',name)>=0.90);
      if(similar) item.warning=`Possível asset semelhante: ${similar.name}.`;
    }

    item.roomId=room?.id||null; item.rackId=rack?.id||null; item.uStart=uStart; item.uHeight=uHeight;
    item.valid=problems.length===0;
    item.message=problems.join(' ');
  });

  return rows.filter(r=>!r.valid).map(item=>({line:item.line,message:item.message}));
}

function renderImportProblems(item,idx){
  const problems=String(item.message||'').split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map(x=>x.trim()).filter(Boolean);
  const warning=item.warning?`<div class="import-validation-warning">⚠ ${esc(item.warning)}</div>`:'';
  const list=problems.length?`<ul class="import-validation-list">${problems.map(p=>`<li>✕ ${esc(p)}</li>`).join('')}</ul>`:`<div class="import-validation-ok">✓ Válido</div>`;
  const model=item._modelMissing?`<button type="button" class="import-model-action" data-import-model="${idx}"><span>＋</span> Cadastrar modelo</button>`:'';
  return `<div class="import-validation-box ${problems.length?'has-errors':'is-valid'}">${list}${warning}${model}</div>`;
}
function renderEditableAssetImportPreview(){
  const rows=pendingImport?.rows||[], table=$('importPreviewTable'); if(!table)return;
  const fields=[['Nome','text'],['Serial Number','text'],['Modelo','model'],['Localização','room'],['Rack','rack'],['U Inicial','u'],['Quantidade U','number'],['Status','status'],['Substatus','substatus'],['Potência (W)','number'],['Peso (kg)','number'],['Data de compra','date'],['Vencimento da garantia','date'],['Fim de vida (EOL)','date']];
  table.innerHTML=`<table class="asset-import-edit-grid"><thead><tr><th></th>${fields.map(f=>`<th>${esc(f[0])}${['Nome','Serial Number','Modelo'].includes(f[0])?' *':''}</th>`).join('')}<th>Validação</th><th></th></tr></thead><tbody>${rows.map((item,idx)=>{const d=item.data||{};const status=item._validated?(item.valid?'valid':'invalid'):'pending';return `<tr class="import-row ${status==='valid'?'import-valid':status==='invalid'?'import-invalid':'import-pending'}" data-import-index="${idx}"><td class="import-row-state">${status==='valid'?'✓':status==='invalid'?'!':'•'}</td>${fields.map(([key,type])=>{let control='';if(type==='model')control=`<select data-import-field="${key}">${assetImportCatalogOptions('model',d[key]||'')}</select>`;else if(type==='room')control=`<select data-import-field="${key}">${assetImportRoomOptions(d[key]||'')}</select>`;else if(type==='rack')control=`<select data-import-field="${key}">${assetImportRackOptions(d['Localização']||d['Sala']||'',d[key]||'')}</select>`;else if(type==='status')control=`<select data-import-field="${key}">${assetImportCatalogOptions('status',d[key]||'Instalado')}</select>`;else if(type==='substatus')control=`<select data-import-field="${key}">${assetImportCatalogOptions('substatus',d[key]||'')}</select>`;else if(type==='u')control=`<select data-import-field="${key}">${assetImportUOptions(item)}</select>`;else if(type==='date')control=`<input data-import-field="${key}" type="date" value="${esc(d[key]??'')}">`;else control=`<input data-import-field="${key}" type="${type==='number'?'number':'text'}" value="${esc(d[key]??'')}" ${key==='Quantidade U'?'min="1" max="60"':''}>`;return `<td>${control}</td>`}).join('')}<td class="import-row-message">${status==='pending'?'<div class="import-validation-pending">⏳ Aguardando validação</div>':renderImportProblems(item,idx)}</td><td><button type="button" class="iconbtn danger-icon import-row-remove" data-import-remove="${idx}" title="Remover esta linha da importação">×</button></td></tr>`}).join('')}</tbody></table>`;
  table.querySelectorAll('[data-import-field]').forEach(el=>el.addEventListener('change',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:true})));
  table.querySelectorAll('[data-import-field="Nome"],[data-import-field="Serial Number"],[data-import-field="Quantidade U"],[data-import-field="Potência (W)"],[data-import-field="Peso (kg)"]').forEach(el=>el.addEventListener('input',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:false})));
  table.querySelectorAll('.import-model-action').forEach(btn=>btn.addEventListener('click',()=>openImportModelRegistration(Number(btn.dataset.importModel))));
  table.querySelectorAll('[data-import-remove]').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=Number(btn.dataset.importRemove); if(!pendingImport?.rows)return;
    pendingImport.rows.splice(idx,1);
    renderEditableAssetImportPreview();
    updateImportPreviewSummary();
  }));
}

let pendingImportModelIndex=null;
let pendingCatalogCreate=null;
function openImportModelRegistration(index){
  const item=pendingImport?.rows?.[index]; if(!item)return;
  pendingImportModelIndex=index;
  normalizeAssetCatalogs();
  const modal=$('catalogEditorModal'); if(!modal){toast('Tela de cadastro de modelos indisponível.');return;}
  $('catalogEditorKind').value='models'; $('catalogEditorId').value='';
  $('catalogEditorTitle').textContent='Cadastrar modelo';
  $('catalogEditorSubtitle').textContent='Cadastre este modelo e vincule-o a um tipo e fabricante.';
  $('catalogEditorName').value=String(item.data?.Modelo||'').trim();
  $('catalogEditorTypeWrap').classList.remove('hidden'); $('catalogEditorManufacturerWrap').classList.remove('hidden');
  $('catalogEditorType').innerHTML=state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  $('catalogEditorManufacturer').innerHTML='<option value="">Selecione o fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if(item.data?.Tipo) $('catalogEditorType').value=item.data.Tipo;
  if(item.data?.Fabricante) $('catalogEditorManufacturer').value=item.data.Fabricante;
  modal.classList.add('open');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');modal.style.zIndex='1200';
  requestAnimationFrame(()=>$('catalogEditorName')?.focus());
}
function updateEditableImportRow(tr, {rerenderRow=false}={}){
  const idx=Number(tr?.dataset.importIndex); const item=pendingImport?.rows?.[idx]; if(!item)return;
  tr.querySelectorAll('[data-import-field]').forEach(el=>item.data[el.dataset.importField]=el.value);
  const model=(state.assetCatalogs.models||[]).find(m=>catalogNormalize(m.name)===catalogNormalize(item.data.Modelo));
  item._modelMissing=!!(item.data.Modelo && !model);
  if(model){item.data.Modelo=model.name;item.data.Tipo=model.type||'';item.data.Fabricante=model.manufacturer||'';item._modelMissing=false;}
  const field=tr.querySelector('[data-import-field="Rack"]'); if(field)item.data.Rack=field.value;
  validateAssetImportRows(pendingImport.rows);
  if(rerenderRow){
    renderEditableAssetImportPreview();
    updateImportPreviewSummary();
  }else{
    // Never rebuild the table while typing: rebuilding destroys the active input
    // and was the cause of the one-character-and-focus-loss bug.
    pendingImport.rows.forEach((r,i)=>{
      const row=document.querySelector(`#importPreviewTable tr[data-import-index="${i}"]`); if(!row)return;
      row.classList.toggle('import-valid',!!r.valid);row.classList.toggle('import-invalid',!r.valid);
      const stateCell=row.querySelector('.import-row-state'); if(stateCell)stateCell.textContent=r.valid?'✓':'!';
      const msg=row.querySelector('.import-row-message'); if(msg)msg.innerHTML=renderImportProblems(r,i);
    });
    document.querySelectorAll('#importPreviewTable .import-model-action').forEach(btn=>btn.onclick=()=>openImportModelRegistration(Number(btn.dataset.importModel)));
    updateImportPreviewSummary();
  }
}
function updateImportPreviewSummary(){
  const rows=pendingImport?.rows||[], validated=rows.filter(r=>r._validated).length, valid=rows.filter(r=>r._validated&&r.valid).length, invalid=rows.filter(r=>r._validated&&!r.valid).length;
  if(!validated){$('importPreviewSummary').innerHTML=`<div><b>${rows.length}</b> linhas carregadas</div><div>⏳ Aguardando validação</div>`;}
  else $('importPreviewSummary').innerHTML=`<div class="import-stat-valid"><b>${valid}</b> válidos</div><div class="import-stat-invalid"><b>${invalid}</b> precisam de correção</div><div><b>${rows.length}</b> linhas analisadas</div>`;
  $('importPreviewConfirm').textContent=validated&&valid?`✓ Importar ${valid} válido${valid===1?'':'s'}`:'Importar'; $('importPreviewConfirm').disabled=!validated||valid===0;
  const errEl=$('importPreviewErrors'); const errors=rows.filter(r=>r._validated&&!r.valid); if(errors.length){errEl.classList.remove('hidden');errEl.innerHTML='<strong>Corrija as linhas em vermelho.</strong>';}else if(validated){errEl.classList.add('hidden');errEl.innerHTML='';}else{errEl.classList.add('hidden');errEl.innerHTML='';}
}
function openImportPreview(kind, rows, errors, title, subtitle, onConfirm){
  pendingImport={kind,rows,errors,onConfirm};
  $('importPreviewTitle').textContent=title; $('importPreviewSubtitle').textContent=subtitle;
  const m=$('importPreviewModal');m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');m.style.zIndex='500';
  if(kind==='assets'){
    // Validate immediately when the preview opens. The user should never need
    // a separate validation button; editing a cell revalidates automatically.
    validateAssetImportRows(rows);
    renderEditableAssetImportPreview();
    updateImportPreviewSummary();
    const vb=$('importPreviewValidate'); if(vb) vb.remove();
  }else{
    const valid=rows.filter(x=>x.valid).length,total=rows.length,errCount=errors.length;
    $('importPreviewSummary').innerHTML=`<div><b>${valid}</b> válidos</div><div><b>${errCount}</b> erros</div><div><b>${total}</b> linhas analisadas</div>`;
    const errEl=$('importPreviewErrors');if(errors.length){errEl.classList.remove('hidden');errEl.innerHTML='<strong>Problemas encontrados</strong>'+errors.slice(0,80).map(e=>`<div>Linha ${e.line}: ${esc(e.message)}</div>`).join('');}else{errEl.classList.add('hidden');errEl.innerHTML='';}
    const previewRows=rows.slice(0,80),headers=['Aba','Tipo','Fabricante','Modelo','Situação'];
    $('importPreviewTable').innerHTML=`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${previewRows.map(r=>`<tr><td>${esc(r.sheet)}</td><td>${esc(r.type)}</td><td>${esc(r.manufacturer)}</td><td>${esc(r.model)}</td><td>${r.valid?'✓ Válido':'⚠ Erro'}</td></tr>`).join('')}</tbody></table>`;
    $('importPreviewConfirm').textContent=valid?`✓ Importar ${valid} válido${valid===1?'':'s'}`:'Nenhum dado válido';$('importPreviewConfirm').disabled=!valid;
  }
}

function closeImportPreview(){pendingImport=null;const m=$('importPreviewModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

function catalogSingleLabel(kind){return ({types:'Tipos de ativo',manufacturers:'Fabricantes',models:'Modelos',statuses:'Status',substatuses:'Substatus',cableTypes:'Tipos de cabo'})[kind]||'Cadastros';}
function catalogSingleTemplate(kind){
  normalizeAssetCatalogs();
  const wb=XLSX.utils.book_new();
  let headers=[], rows=[];
  if(kind==='models'){
    headers=['Modelo','Fabricante','Tipo de Ativo'];
    rows=(state.assetCatalogs.models||[]).map(m=>[m.name||'',m.manufacturer||'',m.type||'']);
  }else if(kind==='cableTypes'){
    normalizeCableCatalogs();
    headers=['Nome','Cor (hex)'];
    rows=(state.cableCatalogs.types||[]).map(t=>[t.name||'',t.color||'']);
  }else{
    const key={types:'types',manufacturers:'manufacturers',statuses:'statuses',substatuses:'substatuses'}[kind];
    headers=[catalogSingleLabel(kind).replace('Tipos de ativo','Tipo')];
    rows=(state.assetCatalogs[key]||[]).map(v=>[v]);
  }
  const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  ws['!cols']=headers.map((h,i)=>({wch:Math.max(24,h.length+4, ...(rows.slice(0,20).map(r=>String(r[i]||'').length+2)))}));
  XLSX.utils.book_append_sheet(wb,ws,catalogSingleLabel(kind).replace(/[^A-Za-z0-9]/g,'').slice(0,31));
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Modelo_Importacao_${catalogSingleLabel(kind).replace(/\s+/g,'_')}.xlsx`;a.style.display='none';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1500);
  toast(`Modelo de ${catalogSingleLabel(kind)} baixado`);
}
function openCatalogSingleImport(kind){
  const input=$('catalogImportFile'); if(!input)return;
  input.dataset.catalogKind=kind; input.value=''; input.click();
}
function validateCatalogImportRows(kind,rows){
  normalizeAssetCatalogs();
  const seen=new Map();
  const arrKey={types:'types',manufacturers:'manufacturers',statuses:'statuses',substatuses:'substatuses'}[kind];
  const arr=arrKey?(state.assetCatalogs[arrKey]||[]):[];
  if(kind==='cableTypes')normalizeCableCatalogs();
  const cableTypesArr=kind==='cableTypes'?state.cableCatalogs.types:[];
  rows.forEach(r=>{
    const problems=[]; let warning=''; r.existing=false; r.missingManufacturer=false; r.missingType=false;
    if(kind==='models'){
      r.model=(r.model||'').trim(); r.manufacturer=(r.manufacturer||'').trim(); r.type=(r.type||'').trim();
      if(!r.model)problems.push('Modelo é obrigatório.');
      if(!r.manufacturer)problems.push('Fabricante é obrigatório.');
      if(!r.type)problems.push('Tipo de Ativo é obrigatório.');
      const knownType=state.assetCatalogs.types.find(v=>catalogNormalize(v)===catalogNormalize(r.type));
      const knownMan=state.assetCatalogs.manufacturers.find(v=>catalogNormalize(v)===catalogNormalize(r.manufacturer));
      if(r.type&&!knownType){problems.push('Tipo de Ativo não cadastrado.');r.missingType=true;}
      if(r.manufacturer&&!knownMan){problems.push('Fabricante não cadastrado.');r.missingManufacturer=true;}
      if(knownType)r.type=knownType; if(knownMan)r.manufacturer=knownMan;
      const key=[r.type,r.manufacturer,r.model].map(catalogNormalize).join('|');
      if(key==='||'){} else {
        const exact=state.assetCatalogs.models.find(m=>[m.type,m.manufacturer,m.name].map(catalogNormalize).join('|')===key);
        if(exact){r.existing=true; warning='Modelo já em uso — será mantido.';}
        const count=(seen.get(key)||0)+1; seen.set(key,count);
        if(count>1)problems.push('Modelo repetido nesta importação.');
        const near=state.assetCatalogs.models.filter(m=>catalogNormalize(m.type)===catalogNormalize(r.type)&&catalogNormalize(m.manufacturer)===catalogNormalize(r.manufacturer)).map(m=>m.name);
        const sim=catalogSimilar(r.model,near.filter(n=>catalogNormalize(n)!==catalogNormalize(r.model)));
        if(sim.length&&!warning)warning=`Possível duplicidade com: ${sim[0]}.`;
      }
    }else if(kind==='cableTypes'){
      r.name=(r.name||'').trim();
      r.color=/^#[0-9a-fA-F]{6}$/.test((r.color||'').trim())?r.color.trim():'#4f8cff';
      if(!r.name)problems.push('Nome é obrigatório.');
      const key=catalogNormalize(r.name);
      if(key){
        const count=(seen.get(key)||0)+1; seen.set(key,count);
        if(count>1)problems.push('Nome repetido nesta importação.');
        const exact=cableTypesArr.find(t=>catalogNormalize(t.name)===key);
        if(exact){r.existing=true; warning='Tipo de cabo já em uso — será mantido.';}
      }
    }else{
      r.value=(r.value||'').trim();
      if(!r.value)problems.push('Nome é obrigatório.');
      const key=catalogNormalize(r.value);
      if(key){
        const count=(seen.get(key)||0)+1; seen.set(key,count);
        if(count>1)problems.push('Valor repetido nesta importação.');
        const exact=arr.find(v=>catalogNormalize(v)===key);
        if(exact){r.existing=true; warning=`${catalogSingleLabel(kind).replace('Tipos de ativo','Tipo')} já em uso — será mantido.`;}
        const sim=catalogSimilar(r.value,arr.filter(v=>catalogNormalize(v)!==key));
        if(sim.length&&!warning)warning=`Possível duplicidade com: ${sim[0]}.`;
      }
    }
    r.problems=problems; r.warning=warning; r.valid=problems.length===0;
  });
  return rows;
}
function renderCatalogSinglePreviewRows(kind, rows){
  validateCatalogImportRows(kind,rows);
  const valid=rows.filter(r=>r.valid).length, invalid=rows.length-valid, newRows=rows.filter(r=>r.valid&&!r.existing).length;
  $('importPreviewSummary').innerHTML=`<div class="import-stat-valid"><b>${valid}</b> válidos</div><div class="import-stat-invalid"><b>${invalid}</b> com problemas</div><div><b>${rows.length}</b> linhas analisadas</div>`;
  $('importPreviewConfirm').textContent=newRows?`✓ Importar ${newRows} novo${newRows===1?'':'s'}`:(valid?'✓ Concluir':'Nenhum dado válido');
  $('importPreviewConfirm').disabled=valid===0;
  const headers=kind==='models'?['Linha','Modelo','Fabricante','Tipo de Ativo','Validação']:kind==='cableTypes'?['Linha','Nome','Cor','Validação']:['Linha','Nome','Validação'];
  const body=rows.slice(0,300).map((r,i)=>{
    const issues=[];
    if(r.problems?.length) r.problems.forEach(p=>issues.push(`<div class="import-problem-item">🔴 ${esc(p)}</div>`));
    if(r.warning) issues.push(`<div class="import-warning-item">🟡 ${esc(r.warning)}</div>`);
    if(kind==='models'){
      if(r.missingManufacturer) issues.push(`<button type="button" class="btn primary small catalog-inline-create" data-catalog-create="manufacturer" data-row="${i}">＋ Cadastrar fabricante</button>`);
      if(r.missingType) issues.push(`<button type="button" class="btn primary small catalog-inline-create" data-catalog-create="type" data-row="${i}">＋ Cadastrar tipo de ativo</button>`);
    }
    if(!issues.length && r.valid) issues.push(`<div class="import-ok-item">🟢 ${r.existing?'Já em uso — será mantido.':'Válido'}</div>`);
    const status=issues.join('');
    if(kind==='models') return `<tr class="${r.valid?'import-valid':'import-invalid'}"><td>${r.line}</td><td><input class="catalog-edit" data-row="${i}" data-field="model" value="${esc(r.model)}"></td><td><input class="catalog-edit" data-row="${i}" data-field="manufacturer" value="${esc(r.manufacturer)}"></td><td><input class="catalog-edit" data-row="${i}" data-field="type" value="${esc(r.type)}"></td><td class="catalog-validation">${status}</td></tr>`;
    if(kind==='cableTypes') return `<tr class="${r.valid?'import-valid':'import-invalid'}"><td>${r.line}</td><td><input class="catalog-edit" data-row="${i}" data-field="name" value="${esc(r.name)}"></td><td><input class="catalog-edit" type="color" data-row="${i}" data-field="color" value="${esc(r.color)}"></td><td class="catalog-validation">${status}</td></tr>`;
    return `<tr class="${r.valid?'import-valid':'import-invalid'}"><td>${r.line}</td><td><input class="catalog-edit" data-row="${i}" data-field="value" value="${esc(r.value)}"></td><td class="catalog-validation">${status}</td></tr>`;
  }).join('');
  $('importPreviewTable').innerHTML=`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('.catalog-edit').forEach(inp=>{
    const evt=inp.type==='color'?'change':'input';
    inp.addEventListener(evt,()=>{
      const row=rows[Number(inp.dataset.row)]; row[inp.dataset.field]=inp.value;
      const focus={row:Number(inp.dataset.row),field:inp.dataset.field,start:inp.selectionStart,end:inp.selectionEnd};
      renderCatalogSinglePreviewRows(kind,rows);
      const next=document.querySelector(`.catalog-edit[data-row="${focus.row}"][data-field="${focus.field}"]`);
      if(next){next.focus();try{next.setSelectionRange(focus.start,focus.end)}catch(e){}}
    });
  });
  document.querySelectorAll('.catalog-inline-create').forEach(btn=>btn.onclick=(ev)=>{
    ev.preventDefault(); ev.stopPropagation();
    const rowIndex=Number(btn.dataset.row), field=btn.dataset.catalogCreate, row=rows[rowIndex];
    if(!row)return;
    pendingCatalogCreate={kind:'models',rowIndex,field};
    openCatalogEditor(field==='manufacturer'?'manufacturers':'types');
    $('catalogEditorName').value=field==='manufacturer'?String(row.manufacturer||'').trim():String(row.type||'').trim();
  });
  const errEl=$('importPreviewErrors');
  if(invalid){errEl.classList.remove('hidden');errEl.innerHTML='<strong>Corrija as linhas vermelhas ou cadastre os itens faltantes diretamente nesta tela. Linhas verdes já podem ser importadas.</strong>';}else{errEl.classList.add('hidden');errEl.innerHTML='';}
}
function openCatalogSinglePreview(kind, rows){
  pendingImport={kind:'catalogs-single',rows,onConfirm:()=>{
    normalizeAssetCatalogs(); let added=0;
    if(kind==='cableTypes'){
      normalizeCableCatalogs();
      rows.filter(r=>r.valid&&!r.existing).forEach(r=>{state.cableCatalogs.types.push({name:r.name,color:r.color}); added++;});
      save(); renderCableTypesCatalog(); render(); renderCables();
      toast(added?`${added} tipo(s) de cabo importado(s)`:'Nenhum novo cadastro para importar');
      return;
    }
    rows.filter(r=>r.valid&&!r.existing).forEach(r=>{
      if(kind==='models') state.assetCatalogs.models.push({id:uid('model'),name:r.model,type:r.type,manufacturer:r.manufacturer});
      else state.assetCatalogs[{types:'types',manufacturers:'manufacturers',statuses:'statuses',substatuses:'substatuses'}[kind]].push(r.value);
      added++;
    });
    normalizeAssetCatalogs();save();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();toast(added?`${added} ${catalogSingleLabel(kind).toLowerCase()} importado(s)`:'Nenhum novo cadastro para importar');
  }};
  const m=$('importPreviewModal');m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');m.style.zIndex='600';
  $('importPreviewTitle').textContent=`Importar ${catalogSingleLabel(kind)}`;
  $('importPreviewSubtitle').textContent='Edite qualquer célula abaixo. A validação é automática e os registros já existentes permanecem verdes.';
  renderCatalogSinglePreviewRows(kind,rows);
}

async function importCatalogSingleWorkbook(file,kind){
  try{
    const wb=await readWorkbookFile(file), names=wb.SheetNames||[];
    const ws=wb.Sheets[names[0]];
    if(!ws){toast('Arquivo sem planilha válida.');return;}
    const raw=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false,blankrows:false});
    if(!raw.length){toast('A planilha está vazia.');return;}
    const rows=[];
    const valueAliases={
      types:['tipo','tipos','tipo de ativo','tipos de ativo','nome','name','asset type','asset type name'],
      manufacturers:['fabricante','fabricantes','manufacturer','manufacturers','manufacturer name','nome','name'],
      statuses:['status','statuses','situação','situacao','nome','name'],
      substatuses:['substatus','substatuses','nome','name']
    };
    raw.forEach((r,i)=>{
      const line=i+2;
      if(kind==='models'){
        rows.push({line,
          model:getCol(r,['modelo','model','nome do modelo','model name']),
          manufacturer:getCol(r,['fabricante','fabricantes','manufacturer','manufacturer name']),
          type:getCol(r,['tipo de ativo','tipo','tipos','asset type','type']),
          valid:false,existing:false,problems:[],warning:''
        });
      }else if(kind==='cableTypes'){
        rows.push({line,
          name:getCol(r,['nome','name','tipo','tipo de cabo']),
          color:getCol(r,['cor (hex)','cor','color','hex']),
          valid:false,existing:false,problems:[],warning:''
        });
      }else{
        let value=getCol(r,valueAliases[kind]||['nome','name']);
        // If the imported sheet has a single non-empty cell but the header was
        // not recognized, take that cell as the catalog value.
        if(!value){
          const vals=Object.values(r).map(v=>String(v??'').trim()).filter(Boolean);
          if(vals.length===1)value=vals[0];
        }
        rows.push({line,value,valid:false,existing:false,problems:[],warning:''});
      }
    });
    openCatalogSinglePreview(kind,rows);
  }catch(e){console.error('Catalog import error:',e);toast('Não foi possível ler a planilha: '+(e?.message||e));}
}

async function processAssetsWorkbook(file){
  try{
    const wb=await readWorkbookFile(file);
    // As listas suspensas da planilha modelo aplicam validação até a linha
    // 1000, o que faz o Excel/SheetJS considerar essas linhas como parte da
    // área usada da planilha, mesmo vazias — sem isso, uma lista de 3 assets
    // apareceria como "999 linhas" pra revisar. Descarta linhas totalmente
    // em branco antes de validar qualquer coisa.
    const rows=sheetRows(wb,'Assets').filter(r=>Object.values(r).some(v=>String(v||'').trim()));
    if(!rows.length){toast('A aba Assets está vazia ou não existe.');return;}
    normalizeAssets();ensureRooms();normalizeAssetCatalogs();
    const preview=[],errors=[],warnings=[];
    const getModel=(value)=>value?state.assetCatalogs.models.find(m=>catalogNormalize(m.name)===catalogNormalize(value)):null;
    const existingBySerial=new Map((state.assets||[]).filter(a=>a.serial).map(a=>[catalogNormalize(a.serial),a]));
    const existingByName=new Map((state.assets||[]).filter(a=>a.name).map(a=>[catalogNormalize(a.name),a]));
    const occupiedByRack=new Map();
    (state.assets||[]).filter(a=>a.rackId&&!isAssetArchived(a)).forEach(a=>{
      const set=occupiedByRack.get(a.rackId)||new Set(),o=assetOccupancy(a);
      for(let u=o.start;u<=o.end;u++)set.add(u); occupiedByRack.set(a.rackId,set);
    });
    const plannedByRack=new Map();
    const keyFor=(rackId,start,height)=>`${rackId||''}|${start}|${height}`;

    for(let i=0;i<rows.length;i++){
      const raw=rows[i],line=i+2;
      const d={
        'Asset Tag':getCol(raw,['asset tag','assettag','asset id','tag']),
        'Nome':getCol(raw,['nome','name','hostname','host name','asset name']),
        'Serial Number':getCol(raw,['serial number','serial','serialnumber','s/n','sn']),
        'Modelo':getCol(raw,['modelo','model','device model']),
        'Sala':getCol(raw,['sala','room','room name']),
        'Localização':getCol(raw,['localização','localizacao','location']),
        'Rack':getCol(raw,['rack','rack name']),
        'U Inicial':getCol(raw,['u inicial','u start','ustart','position','position u','u']),
        'Quantidade U':getCol(raw,['quantidade u','u height','uheight','quantidade de u','height','u size'])||'1',
        'Status':getCol(raw,['status','state'])||'Ativo',
        'Substatus':getCol(raw,['substatus','sub status']),
        'Potência (W)':getCol(raw,['potência (w)','potencia (w)','potência','potencia','power','power (w)']),
        'Peso (kg)':getCol(raw,['peso (kg)','peso','weight','weight (kg)']),
        'Data de compra':parseImportDate(getCol(raw,['data de compra','purchase date','data compra'])),
        'Vencimento da garantia':parseImportDate(getCol(raw,['vencimento da garantia','warranty expiration','garantia','vencimento garantia'])),
        'Fim de vida (EOL)':parseImportDate(getCol(raw,['fim de vida (eol)','fim de vida','end of life','eol']))
      };
      const model=getModel(d.Modelo);
      if(model){d.Modelo=model.name;d.Tipo=model.type;d.Fabricante=model.manufacturer;}
      let valid=true,message='';let warning='';
      if(!d.Nome){valid=false;message='Nome é obrigatório.';}
      else if(!d['Serial Number']){valid=false;message='Serial Number é obrigatório.';}
      else if(!d.Modelo){valid=false;message='Modelo é obrigatório.';}
      else if(!model){valid=false;message=`Modelo "${d.Modelo}" não está cadastrado.`;}
      if(valid && !assetStatusValues().some(v=>catalogNormalize(v)===catalogNormalize(d.Status))){valid=false;message=`Status "${d.Status}" não está cadastrado.`;}
      const room=d.Sala?state.rooms.find(r=>catalogNormalize(r.name)===catalogNormalize(d.Sala)):null;
      if(valid&&d.Sala&&!room){valid=false;message=`Sala "${d.Sala}" não existe.`;}
      const rack=room&&d.Rack?room.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(d.Rack)):null;
      if(valid&&d.Rack&&!rack){valid=false;message=`Rack "${d.Rack}" não existe na sala.`;}
      const uStart=d['U Inicial']===''?0:Math.floor(parseImportNumber(d['U Inicial'],0));
      const uHeight=Math.max(1,Math.floor(parseImportNumber(d['Quantidade U'],1)));
      if(valid&&rack&&uStart<1){valid=false;message='U Inicial é obrigatória quando um Rack é informado.';}
      if(valid&&rack){
        const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));
        if(uStart+uHeight-1>units){valid=false;message=`Posição U${uStart}–U${uStart+uHeight-1} ultrapassa o limite do rack (${units}U).`;}
        const used=new Set(occupiedByRack.get(rack.id)||[]);
        const planned=plannedByRack.get(rack.id)||new Set();
        for(let u=uStart;u<uStart+uHeight;u++){
          if(used.has(u)||planned.has(u)){valid=false;message=`U${u} já está ocupada ou foi reservada por outra linha desta importação.`;break;}
        }
        if(valid){for(let u=uStart;u<uStart+uHeight;u++)planned.add(u);plannedByRack.set(rack.id,planned);}
      }
      const serialKey=catalogNormalize(d['Serial Number']);
      const nameKey=catalogNormalize(d.Nome);
      const existingSerial=serialKey?existingBySerial.get(serialKey):null;
      const existingName=nameKey?existingByName.get(nameKey):null;
      if(valid&&existingSerial){valid=false;message=`Serial Number já cadastrado no asset "${existingSerial.name||'sem nome'}".`;}
      else if(valid&&existingName){warning=`Nome igual ao asset existente "${existingName.name}".`;}
      if(valid&&model&&d.Rack&&rack&&uStart){
        const exactLocation=(state.assets||[]).find(a=>!isAssetArchived(a)&&a.rackId===rack.id&&uStart<=assetOccupancy(a).end&&assetOccupancy(a).start<=uStart+uHeight-1);
        if(exactLocation){valid=false;message=`Conflito de U: a posição informada sobrepõe o asset "${exactLocation.name||'sem nome'}".`;}
      }
      if(valid&&model){
        const similarModels=catalogSimilar(model.name,state.assetCatalogs.models.filter(m=>catalogNormalize(m.type)===catalogNormalize(model.type)&&catalogNormalize(m.manufacturer)===catalogNormalize(model.manufacturer)).map(m=>m.name));
        if(similarModels.length)warning=warning||`Modelo semelhante cadastrado: ${similarModels[0]}.`;
      }
      if(valid&&model){
        const similarAssets=(state.assets||[]).filter(a=>!isAssetArchived(a)&&catalogSimilarity(a.name||'',d.Nome)>=0.90&&catalogNormalize(a.name)!==nameKey).slice(0,1);
        if(similarAssets.length)warning=warning||`Possível asset semelhante: ${similarAssets[0].name}.`;
      }
      preview.push({valid,line,data:d,roomId:room?.id||null,rackId:rack?.id||null,warning});
      if(!valid)errors.push({line,message});
      else if(warning)warnings.push({line,message:warning});
    }
    // Recompute planned occupancy only from valid rows so an invalid row never blocks another row.
    const validRows=preview.filter(r=>r.valid); const finalUsed=new Map();
    validRows.forEach(r=>{if(!r.rackId)return;const start=Math.max(1,Math.floor(parseImportNumber(r.data['U Inicial'],1))),height=Math.max(1,Math.floor(parseImportNumber(r.data['Quantidade U'],1)));const set=finalUsed.get(r.rackId)||new Set();for(let u=start;u<start+height;u++)set.add(u);finalUsed.set(r.rackId,set);});
    // Mark internal duplicate/conflicting positions among valid rows.
    for(const [rackId,set] of finalUsed){
      const seen=new Set();validRows.filter(r=>r.rackId===rackId).forEach(r=>{const st=Math.floor(parseImportNumber(r.data['U Inicial'],1)),h=Math.max(1,Math.floor(parseImportNumber(r.data['Quantidade U'],1)));for(let u=st;u<st+h;u++){if(seen.has(u)){r.valid=false;r.warning='Conflito de U com outra linha desta importação.';if(!errors.some(e=>e.line===r.line))errors.push({line:r.line,message:'Conflito de U com outra linha desta importação.'});break;}seen.add(u);}});
    }
    const validCount=preview.filter(r=>r.valid).length;
    openImportPreview('assets',preview,errors,'Importar assets',`Revise e corrija os registros diretamente nesta tela.${warnings.length?` ${warnings.length} alerta(s) de possível duplicidade.`:''}`,()=>{
      validateAssetImportRows(preview);
      const ready=preview.filter(r=>r.valid);
      ready.forEach(item=>{
        const d=item.data; const resolved=resolveAssetImportLocation(d['Localização']||d.Sala); const room=resolved.room; const stock=resolved.stock; const rack=room&&d.Rack?room.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(d.Rack)):null; const loc=resolved.loc; const asset=autoFillAssetFromModel({id:uid('asset'),name:d.Nome,type:d.Tipo,manufacturer:d.Fabricante,model:d.Modelo,assetTag:d['Asset Tag'],serial:d['Serial Number'],status:d.Status||'Instalado',substatus:d.Substatus||'',locationType:stock?'stock':'room',locationName:d['Localização']||d.Sala||'',locationId:loc?.id||null,stockId:stock?.id||null,roomId:room?.id||null,rackId:rack?.id||null,uStart:Math.max(1,Math.floor(parseImportNumber(d['U Inicial'],1))),uHeight:Math.max(1,Math.floor(parseImportNumber(d['Quantidade U'],1))),ports:[],powerW:Math.max(0,Math.floor(parseImportNumber(d['Potência (W)'],0))),weightKg:Math.max(0,parseImportNumber(d['Peso (kg)'],0)),purchaseDate:parseImportDate(d['Data de compra']),warrantyExpiration:parseImportDate(d['Vencimento da garantia']),endOfLife:parseImportDate(d['Fim de vida (EOL)'])}); state.assets.push(asset); recordAssetAudit({action:'CREATE',asset,after:asset,changes:[]});
      });
      const imported=ready.length;save();closeImportPreview();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');toast(`${imported} asset(s) importado(s)`);
    });
  }catch(e){console.error(e);toast('Não foi possível ler a planilha de assets.');}
}

async function importAssetsWorkbook(file){
  try{
    // O modelo oficial já define a estrutura; não há necessidade de uma etapa
    // intermediária de reconhecimento/mapeamento. A planilha vai direto para a
    // validação editável.
    const wb=await readWorkbookFile(file);
    const sheetName=wb.Sheets['Assets']?'Assets':wb.SheetNames[0];
    if(!sheetName){toast('A planilha não possui nenhuma aba.');return;}
    const rows=sheetRows(wb,sheetName);
    if(!rows.length){toast('A planilha está vazia.');return;}
    // processAssetsWorkbook espera a aba Assets; para arquivos de uma única aba
    // com outro nome, criamos uma cópia lógica em memória.
    if(sheetName==='Assets') return processAssetsWorkbook(file);
    const ws=wb.Sheets[sheetName];
    const json=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
    const temp=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(temp,ws,'Assets');
    const out=XLSX.write(temp,{bookType:'xlsx',type:'array'});
    const normalizedFile=new File([out],file.name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    return processAssetsWorkbook(normalizedFile);
  }catch(e){console.error(e);toast('Não foi possível ler o arquivo.');}
}


/* Cadastro em massa: o sistema calcula as U livres em vez de delegar isso ao Excel. */
function bulkLocationOptions(selected=''){
  normalizeLocations();
  let out='<option value="">Selecione a localização</option>';
  (state.locations||[]).forEach(l=>{
    const dc=assetLocationDcName(l.name);
    l.rooms.forEach(rid=>{
      const r=state.rooms.find(x=>x.id===rid); if(!r)return;
      const v=`room:${r.id}`;
      out+=`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(dc+' / '+r.name)}</option>`;
    });
    l.stocks.forEach(st=>{
      const v=`stock:${l.id}:${st.id}`;
      out+=`<option value="${esc(v)}" ${v===selected?'selected':''}>📦 ${esc(dc+' / '+st.name)}</option>`;
    });
  });
  return out;
}
function bulkRackOptions(selected='',locationValue=''){
  const roomId=String(locationValue||'').startsWith('room:')?String(locationValue).slice(5):'';
  const room=roomId?(state.rooms||[]).find(r=>r.id===roomId):null;
  const racks=room?.data?.racks||[];
  return '<option value="">Sem rack</option>'+racks.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?'selected':''}>${esc(r.name)}</option>`).join('');
}
function bulkCatalogOptions(kind,selected='',rowEl=null){
  normalizeAssetCatalogs();
  if(kind==='type')return '<option value="">Selecione</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='manufacturer')return '<option value="">Sem fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='status'){const vals=assetStatusValues();return vals.map(v=>`<option value="${esc(v)}" ${v===(selected||'Ativo')?'selected':''}>${esc(v)}</option>`).join('');}
  if(kind==='substatus'){const vals=assetSubstatusValues();return '<option value="">Sem substatus</option>'+vals.map(v=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(v)}</option>`).join('');}
  const models=state.assetCatalogs.models||[];
  return '<option value="">Sem modelo</option>'+models.map(m=>`<option value="${esc(m.name)}" data-model-id="${esc(m.id||'')}" data-model-type="${esc(m.type||'')}" data-model-manufacturer="${esc(m.manufacturer||'')}" ${m.name===selected?'selected':''}>${esc(m.name)}${m.manufacturer?` — ${esc(m.manufacturer)}`:''}</option>`).join('');
}
function bulkOccupiedSet(rackId,ignoreRow=null){
  const used=new Set();
  state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{const o=assetOccupancy(a);for(let u=o.start;u<=o.end;u++)used.add(u);});
  document.querySelectorAll('#assetsBulkBody tr').forEach(row=>{if(row===ignoreRow)return;const rid=row.querySelector('[data-bulk-field="rack"]')?.value||'';if(rid!==rackId)return;const start=Number(row.querySelector('[data-bulk-field="u"]')?.value||0),height=Math.max(1,Number(row.querySelector('[data-bulk-field="height"]')?.value||1));if(start>0)for(let u=start;u<start+height;u++)used.add(u);});
  return used;
}
function bulkAvailableStarts(rackId,height=1,ignoreRow=null){
  const rack=assetRack(rackId);if(!rack)return[];const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));const used=bulkOccupiedSet(rackId,ignoreRow);const out=[];for(let start=1;start<=units-height+1;start++){let ok=true;for(let u=start;u<start+height;u++)if(used.has(u)){ok=false;break;}if(ok)out.push(start);}return out;
}
function refreshBulkRow(row, preserveU=true){
  if(!row)return;
  const locationEl=row.querySelector('[data-bulk-field="location"]');
  const location=locationEl?.value||'';
  const rackEl=row.querySelector('[data-bulk-field="rack"]');
  const currentRack=rackEl?.value||'';
  if(rackEl){
    rackEl.innerHTML=bulkRackOptions(currentRack,location);
    if(![...rackEl.options].some(o=>o.value===currentRack))rackEl.value='';
    const hasRoom=location.startsWith('room:');
    rackEl.disabled=!hasRoom;
    rackEl.closest('td')?.classList.toggle('muted-field',!hasRoom);
  }
  const rack=rackEl?.value||'';
  const height=Math.max(1,Math.floor(Number(row.querySelector('[data-bulk-field="height"]')?.value||1)));
  const uEl=row.querySelector('[data-bulk-field="u"]');
  const old=Number(uEl?.value||0);
  if(!uEl)return;
  const starts=bulkAvailableStarts(rack,height,row);
  uEl.innerHTML='<option value="">Selecione</option>'+starts.map(u=>`<option value="${u}">U${u}</option>`).join('');
  if(preserveU&&starts.includes(old))uEl.value=String(old);else uEl.value=starts[0]!==undefined?String(starts[0]):'';
  const hasRack=!!rack;
  uEl.disabled=!hasRack;
  uEl.closest('td')?.classList.toggle('muted-field',!hasRack);
  // Quantidade de U é uma característica física do equipamento, não da
  // posição — deve continuar editável mesmo sem rack selecionado.
}
function refreshAllBulkRows(){document.querySelectorAll('#assetsBulkBody tr').forEach(r=>refreshBulkRow(r,true));const n=document.querySelectorAll('#assetsBulkBody tr').length;const valid=[...document.querySelectorAll('#assetsBulkBody tr')].filter(r=>r.querySelector('[data-bulk-field="name"]')?.value.trim()).length;$('assetsBulkSummary').textContent=`${n} linha(s) · ${valid} preenchida(s)`;}
function bulkRowHtml(){return `<tr>
<td><input class="bulk-name" data-bulk-field="name" placeholder="Ex.: Server 01"></td>
<td><select data-bulk-field="type">${bulkCatalogOptions('type')}</select></td>
<td><select data-bulk-field="manufacturer">${bulkCatalogOptions('manufacturer')}</select></td>
<td><select class="bulk-model" data-bulk-field="model"><option value="">Sem modelo</option></select></td>
<td><input class="bulk-tag" data-bulk-field="tag" placeholder="SW-001"></td>
<td><input class="bulk-serial" data-bulk-field="serial" required placeholder="Obrigatório"></td>
<td><select class="bulk-location" data-bulk-field="location">${bulkLocationOptions()}</select></td>
<td><select class="bulk-rack" data-bulk-field="rack">${bulkRackOptions()}</select></td>
<td><select class="bulk-u" data-bulk-field="u"><option value="">Selecione</option></select></td>
<td><input class="bulk-height" data-bulk-field="height" type="number" min="1" max="60" value="1"></td>
<td><select data-bulk-field="status">${bulkCatalogOptions('status')}</select></td>
<td><select data-bulk-field="substatus">${bulkCatalogOptions('substatus')}</select></td>
<td><input data-bulk-field="power" type="number" min="0" step="1" placeholder="Do modelo"></td>
<td><input data-bulk-field="weight" type="number" min="0" step="0.1" placeholder="Do modelo"></td>
<td><input data-bulk-field="purchase" type="date"></td>
<td><input data-bulk-field="warranty" type="date"></td>
<td><input data-bulk-field="eol" type="date"></td>
<td><button class="iconbtn danger-icon" type="button" data-bulk-remove title="Remover linha">×</button></td></tr>`;}
function initBulkTableResizers(){
  const table=document.querySelector('.bulk-assets-table');
  if(!table||table.dataset.resizersReady==='1')return;
  table.dataset.resizersReady='1';
  const cols=[...table.querySelectorAll('colgroup col')];
  const heads=[...table.querySelectorAll('thead th')];
  const defaults={name:10,type:5,manufacturer:7,model:8,tag:7,serial:9,location:13,rack:9,u:4,height:4,status:7,substatus:8,power:7,weight:7,purchase:8,warranty:9,eol:8,actions:3};
  const mins={name:90,type:62,manufacturer:80,model:82,tag:76,serial:105,location:150,rack:100,u:52,height:56,status:72,substatus:90,power:82,weight:82,purchase:118,warranty:130,eol:118,actions:34};
  cols.forEach(c=>{c.style.width=(defaults[c.dataset.col]||5)+'%';c.dataset.min=mins[c.dataset.col]||44;});
  heads.forEach((th,i)=>{
    if(i>=heads.length-1)return;
    const handle=document.createElement('span'); handle.className='bulk-col-resizer'; handle.title='Arraste para redimensionar';
    th.appendChild(handle);
    const autoFit=()=>{
      const col=cols[i]; if(!col)return;
      const cells=[th,...table.querySelectorAll(`tbody tr td:nth-child(${i+1})`)].slice(0,16);
      const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font:9px Arial;padding:0';document.body.appendChild(probe);
      let best=Number(col.dataset.min||44);
      cells.forEach(cell=>{probe.textContent=cell.innerText||cell.querySelector('input,select')?.value||cell.querySelector('input,select')?.placeholder||'';best=Math.max(best,probe.getBoundingClientRect().width+16);});
      probe.remove();
      const total=table.getBoundingClientRect().width, all=cols.map(c=>c.getBoundingClientRect().width), current=all[i], next=all[i+1];
      const target=Math.min(best,current+next-(Number(cols[i+1].dataset.min||44)));
      if(target<=current)return;
      cols.forEach((c,j)=>c.style.width=all[j]+'px');
      cols[i].style.width=target+'px';cols[i+1].style.width=(current+next-target)+'px';
      if(total>0)table.style.width=total+'px';
    };
    handle.addEventListener('dblclick',ev=>{ev.preventDefault();ev.stopPropagation();autoFit();});
    handle.addEventListener('mousedown',ev=>{
      ev.preventDefault(); ev.stopPropagation();
      const left=cols[i],right=cols[i+1]; if(!left||!right)return;
      const all=cols.map(c=>c.getBoundingClientRect().width);
      cols.forEach((c,j)=>c.style.width=all[j]+'px');
      const startX=ev.clientX, startL=all[i], startR=all[i+1];
      const minL=Number(left.dataset.min||44), minR=Number(right.dataset.min||44);
      const move=e=>{
        const delta=e.clientX-startX;
        const l=Math.max(minL,Math.min(startL+startR-minR,startL+delta)), r=startL+startR-l;
        left.style.width=l+'px';right.style.width=r+'px';
      };
      const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);document.body.classList.remove('bulk-resizing');};
      document.body.classList.add('bulk-resizing'); document.addEventListener('mousemove',move); document.addEventListener('mouseup',up);
    });
  });
}
function addBulkRow(){const body=$('assetsBulkBody');if(!body)return;body.insertAdjacentHTML('beforeend',bulkRowHtml());const row=body.lastElementChild;const type=row.querySelector('[data-bulk-field="type"]'),man=row.querySelector('[data-bulk-field="manufacturer"]'),model=row.querySelector('[data-bulk-field="model"]'),location=row.querySelector('[data-bulk-field="location"]'),rack=row.querySelector('[data-bulk-field="rack"]');const refreshModel=()=>{const current=model.value;model.innerHTML=bulkCatalogOptions('model',current,row);if(![...model.options].some(o=>o.value===current))model.value='';};
  type.addEventListener('change',refreshModel);
  man.addEventListener('change',refreshModel);
  model.addEventListener('change',()=>{const opt=model.selectedOptions?.[0];if(!opt||!opt.value)return;const mt=opt.dataset.modelType||'',mm=opt.dataset.modelManufacturer||'';if(mt){type.value=mt;}if(mm){man.value=mm;}refreshAllBulkRows();});
  location.addEventListener('change',()=>{rack.value='';row.querySelector('[data-bulk-field="u"]').value='';refreshAllBulkRows();});
  rack.addEventListener('change',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="height"]').addEventListener('input',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="u"]').addEventListener('change',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="name"]').addEventListener('input',()=>refreshAllBulkRows());row.querySelector('[data-bulk-remove]').addEventListener('click',()=>{row.remove();refreshAllBulkRows();});refreshModel();refreshAllBulkRows();row.querySelector('[data-bulk-field="name"]').focus();}
function openBulkAssetsModal(){normalizeAssets();normalizeAssetCatalogs();initBulkTableResizers();const m=$('assetsBulkModal');if(!m)return;$('assetsBulkBody').innerHTML='';for(let i=0;i<5;i++)addBulkRow();$('assetsBulkChooser')?.classList.remove('hidden');$('assetsBulkEditor')?.classList.add('hidden');m.querySelector('.bulk-assets-card')?.classList.remove('wide');m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='340';}
function closeBulkAssetsModal(){const m=$('assetsBulkModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function saveBulkAssets(){
  normalizeAssets();const rows=[...document.querySelectorAll('#assetsBulkBody tr')].filter(r=>r.querySelector('[data-bulk-field="name"]')?.value.trim());if(!rows.length){toast('Adicione pelo menos um asset.');return;}
  const errors=[],newAssets=[];
  rows.forEach((row,i)=>{const g=k=>row.querySelector(`[data-bulk-field="${k}"]`)?.value?.trim?.()||row.querySelector(`[data-bulk-field="${k}"]`)?.value||'';const name=g('name'),type=g('type'),manufacturer=g('manufacturer'),model=g('model'),tag=g('tag'),serial=g('serial'),locationValue=g('location'),rackId=g('rack'),uStart=Number(g('u')||0),uHeight=Math.max(1,Math.floor(Number(g('height')||1))),status=g('status')||'Ativo',substatus=g('substatus'),powerW=Math.max(0,Math.floor(Number(g('power')||0))),weightKg=Math.max(0,Number(g('weight')||0)),purchaseDate=g('purchase'),warrantyExpiration=g('warranty'),endOfLife=g('eol');const locParts=locationValue.startsWith('stock:')?locationValue.split(':'):null;const locationType=locationValue.startsWith('stock:')?'stock':'room';const roomId=locationType==='room'?locationValue.slice(5)||null:null;const locationId=locationType==='stock'?(locParts?.[1]||null):(roomId?(state.rooms.find(r=>r.id===roomId)?.locationId||null):null);const stockId=locationType==='stock'?(locParts?.[2]||null):null;const rack=assetRack(rackId);let msg='';if(!name)msg='Nome é obrigatório.';else if(!type)msg='Tipo é obrigatório.';else if(!serial)msg='Serial Number é obrigatório.';else if(!locationValue)msg='Localização é obrigatória.';else if(locationType==='stock'&&rackId)msg='Asset em estoque não pode ter rack.';else if(locationType==='stock'&&uStart)msg='Asset em estoque não pode ter U.';else if(rack&&uStart<1)msg='Selecione uma U disponível.';else if(rack&&uStart+uHeight-1>Math.floor(num(rack.units,state.rackUnits)))msg='Quantidade de U ultrapassa o rack.';else if(rack){const used=new Set(state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).flatMap(a=>{const o=assetOccupancy(a);return Array.from({length:o.end-o.start+1},(_,j)=>o.start+j);}));newAssets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{for(let u=a.uStart;u<a.uStart+a.uHeight;u++)used.add(u);});for(let u=uStart;u<uStart+uHeight;u++)if(used.has(u)){msg=`Conflito: U${u} já está ocupada.`;break;}}if(!msg){newAssets.push(autoFillAssetFromModel({id:uid('asset'),name,type,manufacturer,model,assetTag:tag,serial,locationType,locationName:locationType==='stock'?(state.locations.find(l=>l.id===locationId)?.name||'Estoque'):(state.rooms.find(r=>r.id===roomId)?.name||''),locationId,stockId,roomId,rackId:rackId||null,uStart:uStart||1,uHeight,status,substatus,ports:[],powerW,weightKg,purchaseDate,warrantyExpiration,endOfLife}));}if(msg)errors.push(`Linha ${i+1}: ${msg}`);});
  if(errors.length){toast(errors[0]);return;}
  state.assets.push(...newAssets);save();newAssets.forEach(asset=>recordAssetAudit({action:'CREATE',asset,after:asset,changes:[]}));closeBulkAssetsModal();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');if($('bayfaceModal')?.classList.contains('open'))renderBayface($('bayfaceModal').dataset.rackId);toast(`${newAssets.length} asset(s) cadastrado(s)`);
}

function openAssetsImportModal(){const m=$('assetsImportModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');m.style.zIndex='450';$('assetsImportMapping').classList.add('hidden');$('assetsImportFileInfo').classList.add('hidden');$('assetsImportContinue').disabled=true;}
function closeAssetsImportModal(){const m=$('assetsImportModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function bindAssetsImportModal(){const templateBtn=$('assetsImportTemplate');templateBtn?.addEventListener('click',makeAssetsTemplate);const choose=$('assetsImportChoose'),input=$('assetsImportFile'),drop=$('assetsImportDrop');choose?.addEventListener('click',()=>input?.click());$('assetsImportClose')?.addEventListener('click',closeAssetsImportModal);$('assetsImportCancel')?.addEventListener('click',closeAssetsImportModal);input?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f){closeAssetsImportModal();importAssetsWorkbook(f);}input.value='';});drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});drop?.addEventListener('dragleave',()=>drop.classList.remove('drag'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files?.[0];if(f){closeAssetsImportModal();importAssetsWorkbook(f);}});}

function bindImportUI(){
  bindAssetsImportModal();
  document.querySelectorAll('[data-catalog-template]').forEach(btn=>btn.addEventListener('click',()=>catalogSingleTemplate(btn.dataset.catalogTemplate)));
  document.querySelectorAll('[data-catalog-import]').forEach(btn=>btn.addEventListener('click',()=>openCatalogSingleImport(btn.dataset.catalogImport)));
  $('catalogImportFile')?.addEventListener('change',e=>{const f=e.target.files?.[0],kind=e.target.dataset.catalogKind;if(f&&kind)importCatalogSingleWorkbook(f,kind);e.target.value='';});
$('importPreviewConfirm')?.addEventListener('click',()=>{if(pendingImport?.onConfirm){const fn=pendingImport.onConfirm;closeImportPreview();fn();}});$('importPreviewClose')?.addEventListener('click',closeImportPreview);$('importPreviewCancel')?.addEventListener('click',closeImportPreview);
}
function setupSidebarToggle(){
  if(window.__dccpSidebarBound)return;
  const appShell=document.querySelector('.app'), sidebarToggle=$('sidebarToggle'), sidebarToggleIcon=$('sidebarToggleIcon');
  if(!appShell||!sidebarToggle)return;
  window.__dccpSidebarBound=true;
  const sidebarKey='dccp_sidebar_collapsed';
  const setSidebarCollapsed=(collapsed,persist=true)=>{
    appShell.classList.toggle('sidebar-collapsed',!!collapsed);
    if(sidebarToggleIcon)sidebarToggleIcon.textContent=collapsed?'›':'‹';
    sidebarToggle.title=collapsed?'Expandir barra lateral':'Recolher barra lateral';
    sidebarToggle.setAttribute('aria-label',sidebarToggle.title);
    if(persist)localStorage.setItem(sidebarKey,collapsed?'1':'0');
    requestAnimationFrame(()=>{ window.__updateMinimap?.(); });
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
  $('assetsBulkClose')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkCancel')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkManual')?.addEventListener('click',()=>{$('assetsBulkChooser')?.classList.add('hidden');$('assetsBulkEditor')?.classList.remove('hidden');$('assetsBulkModal')?.querySelector('.bulk-assets-card')?.classList.add('wide');});
  $('assetsBulkImport')?.addEventListener('click',()=>{closeBulkAssetsModal();openAssetsImportModal();});
  $('assetsBulkBack')?.addEventListener('click',()=>{$('assetsBulkEditor')?.classList.add('hidden');$('assetsBulkChooser')?.classList.remove('hidden');$('assetsBulkModal')?.querySelector('.bulk-assets-card')?.classList.remove('wide');});
  $('assetsBulkAddRow')?.addEventListener('click',addBulkRow);
  $('assetsBulkSave')?.addEventListener('click',saveBulkAssets);
  
  $('btnCatalogs')?.addEventListener('click',openAssetCatalogModal);
  $('assetCatalogClose')?.addEventListener('click',closeAssetCatalogModal);
  
  $('assetsSearch')?.addEventListener('input',e=>renderAssetsList(e.target.value));
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
  $('assetsBulkStatus')?.addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)bulkChangeAssetStatus(v);});
  $('assetsBulkSubstatus')?.addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)bulkChangeAssetSubstatus(v);});
  $('assetsBulkLocation')?.addEventListener('change',e=>{const v=e.target.value;e.target.value='';if(v)bulkChangeAssetLocation(v);});
  document.addEventListener('click',e=>{if(!e.target.closest('.col-filter-panel')&&!e.target.closest('[data-filter-col]')){closeAssetColumnFilterMenus();document.querySelectorAll('#assetsTableHead [data-filter-col]').forEach(b=>b.classList.remove('menu-open'));}});
  window.addEventListener('resize',closeAssetColumnFilterMenus);
  $('assetEditCancel')?.addEventListener('click',closeAssetModal);
  $('assetEditCancelTop')?.addEventListener('click',closeAssetModal);
  $('assetEditForm')?.addEventListener('submit',e=>{e.preventDefault();saveAssetForm();});
  $('roomEditorForm')?.addEventListener('submit',e=>{e.preventDefault();saveRoomEditor();});
  $('roomEditorClose')?.addEventListener('click',closeRoomEditor);
  $('roomEditorCancel')?.addEventListener('click',closeRoomEditor);
  $('assetPortsToggle')?.addEventListener('click',()=>{setAssetPortsCollapsed(!$('assetPortsList')?.classList.contains('hidden'));});
  $('assetPortsAdd')?.addEventListener('click',()=>{assetEditPorts.push({id:uid('port'),label:`Porta ${assetEditPorts.length+1}`,poe:false});setAssetPortsCollapsed(false);renderAssetPortsEditor();const inputs=document.querySelectorAll('#assetPortsList .asset-port-name');const last=inputs[inputs.length-1];if(last){last.focus();last.select();}});
  $('assetWarrantyExpiration')?.addEventListener('input',updateAssetLifecycleBadge);
  $('assetEndOfLife')?.addEventListener('input',updateAssetLifecycleBadge);
  $('assetPortsExport')?.addEventListener('click',exportAssetPortsXLSX);
  $('portRangeAdd')?.addEventListener('click',()=>{
    const start=$('portRangeStart').value.trim(), end=$('portRangeEnd').value.trim();
    if(!start||!end){toast('Informe a primeira e a última porta.');return;}
    const range=buildPortRange(start,end);
    if(!range){toast('Não foi possível calcular a sequência. Confira se o padrão das duas portas coincide (ex.: G0/0/1 até G0/0/24).');return;}
    const existing=new Set(expandPortDefs(catalogEditorPortDefs).map(p=>p.label));
    const conflicts=range.filter(label=>existing.has(label));
    if(conflicts.length){toast(`Essas portas já existem neste modelo: ${conflicts.slice(0,5).join(', ')}${conflicts.length>5?`... (${conflicts.length} no total)`:''}`);return;}
    catalogEditorPortDefs.push({id:uid('portdef'),kind:'range',startLabel:start,endLabel:end,poe:!!$('portRangePoe')?.checked});
    $('portRangeStart').value='';$('portRangeEnd').value='';if($('portRangePoe'))$('portRangePoe').checked=false;
    renderCatalogPortDefsEditor();
  });
  $('portSingleAdd')?.addEventListener('click',()=>{
    const label=$('portSingleName').value.trim();
    if(!label){toast('Informe o nome da porta.');return;}
    const existing=new Set(expandPortDefs(catalogEditorPortDefs).map(p=>p.label));
    if(existing.has(label)){toast(`A porta "${label}" já existe neste modelo.`);return;}
    catalogEditorPortDefs.push({id:uid('portdef'),kind:'single',label,poe:!!$('portSinglePoe')?.checked});
    $('portSingleName').value='';if($('portSinglePoe'))$('portSinglePoe').checked=false;
    renderCatalogPortDefsEditor();
  });
  $('assetManufacturer')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetType')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetLocation')?.addEventListener('change',()=>refreshAssetRackOptions(''));
  $('assetRack')?.addEventListener('change',updateAssetUFieldsState);
  $('assetModel')?.addEventListener('change',()=>{const modelName=$('assetModel')?.value||'';if(!modelName)return;normalizeAssetCatalogs();const m=state.assetCatalogs.models.find(x=>String(x.name)===String(modelName));if(!m)return;renderAssetCatalogSelects({assetType:m.type||'',assetManufacturer:m.manufacturer||'',assetModel:m.name||''});autoFillPortsFromModelIfEmpty();autoFillPowerFromModelIfEmpty();autoFillWeightFromModelIfEmpty();});
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
  $('bayfaceAssetPickerSearch')?.addEventListener('input',renderBayfaceAssetPicker);
  

  // Bindar os controles do canvas ANTES da renderização do projeto.
  // Isso garante que um erro em renderAll() não deixe os controles mudos.
  setupMinimap();
  setupSidebarToggle();
  setupStructureLockControl();

  load();renderAll(false);initHistory(cloudProjectId);setupPan();setupPropSectionResize();
  // A barra lateral já foi inicializada por setupSidebarToggle().
  $('btnQuickSearch')?.addEventListener('click',openQuickSearch);
  $('quickSearchClose')?.addEventListener('click',closeQuickSearch); $('summaryClose')?.addEventListener('click',closeProjectSummary);
  
  $('quickSearchInput')?.addEventListener('input',e=>{quickSearchIndex=0;renderQuickSearchResults(e.target.value);});
  $('quickSearchInput')?.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex+1)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='ArrowUp'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex-1+quickSearchItems.length)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='Enter'&&quickSearchItems[quickSearchIndex]){e.preventDefault();activateSearchResult(quickSearchItems[quickSearchIndex].type,quickSearchItems[quickSearchIndex].id);}});
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openQuickSearch();}else if(e.key==='Escape'){if(document.querySelector('.dc-select-panel'))closeStyledSelectPanels();else if($('cableTypeReviewModal')?.classList.contains('open')){pendingCableImportRows=null;closeCableTypeReviewModal();}else if($('pdfReportOptionsModal')?.classList.contains('open'))closePdfReportOptions();else if($('helpModal')?.classList.contains('open'))closeHelpModal();else if($('quickSearchModal')?.classList.contains('open'))closeQuickSearch();else if($('projectSummaryModal')?.classList.contains('open'))closeProjectSummary();else if($('catalogEditorModal')?.classList.contains('open'))closeCatalogEditor();else if($('assetCatalogModal')?.classList.contains('open'))closeAssetCatalogModal();else if($('assetsModal')?.classList.contains('open'))closeAssetsModal();else if($('assetEditModal')?.classList.contains('open'))closeAssetModal();else if($('bayfaceAssetPickerModal')?.classList.contains('open'))closeBayfaceAssetPicker();else if($('bayfaceModal')?.classList.contains('open'))closeBayface();}});
  // Cadeado já foi inicializado por setupStructureLockControl().
  updateStructureControls();
  if($('btnProjects'))$('btnProjects').onclick=async()=>{
    if(cloudDirty){
      const wantsSave=await uiConfirm('Existem alterações não salvas na nuvem.',{title:'Salvar antes de voltar para Projetos?',confirmText:'Salvar e voltar',cancelText:'Continuar sem salvar'});
      if(wantsSave){ const ok=await saveProjectToCloud(true); if(!ok)return; }
    }
    showDashboard();
  };

  requestAnimationFrame(()=>window.__applyCanvasPan&&window.__applyCanvasPan());
  $('btnBuildRows').onclick=rebuildStructureFromSettings;
  $('btnAddRow').onclick=()=>{
    if(structureBlocked())return;
    const rackCount=Math.max(0,Math.min(100,Math.floor(num($('defaultRacks')?.value,0))));
    addRow(rackCount,state.defaultRowGap);
    normalizeIndices();
    renderAll();
    toast(`Fileira ${state.rows.length} adicionada`);
  };
  $('btnAddTray').onclick=()=>{ if(structureBlocked())return; const g=geometry(); const y=g.rows.length?g.rows[0].y-80:VIEW_PAD; createIndependentTray(g,g.x0,y,g.x0+Math.max(240,g.scale*3),y); };
  $('btnAddCable').onclick=addCable;$('btnImport').onclick=()=>$('excelInput').click();
  $('cablesSearch')?.addEventListener('input',()=>{cablesSearchQuery=$('cablesSearch').value;renderCables();});
  $('cablesBulkDelete')?.addEventListener('click',deleteCablesBulk);
  $('cablesBulkClear')?.addEventListener('click',()=>{cableMultiSelected=[];renderCables();});
  $('cableTypeReviewClose')?.addEventListener('click',()=>{pendingCableImportRows=null;closeCableTypeReviewModal();});
  $('cableTypeReviewCancel')?.addEventListener('click',()=>{pendingCableImportRows=null;closeCableTypeReviewModal();toast('Importação cancelada');});
  $('cableTypeReviewConfirm')?.addEventListener('click',()=>{
    const selected=[...document.querySelectorAll('#cableTypeReviewList [data-cable-type-review]:checked')].map(cb=>cb.dataset.cableTypeReview);
    closeCableTypeReviewModal();
    processCableImportRows(selected);
  });
  $('cablesSelectAll')?.addEventListener('change',e=>{
    const q=cablesSearchQuery.trim().toLowerCase();
    const visible=q?state.cables.filter(c=>cableSearchHaystack(c).includes(q)):state.cables;
    if(e.target.checked){visible.forEach(c=>{if(!cableMultiSelected.includes(c.id))cableMultiSelected.push(c.id);});}
    else{const visibleIds=new Set(visible.map(c=>c.id));cableMultiSelected=cableMultiSelected.filter(id=>!visibleIds.has(id));}
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
  setCloudStatus(cloudDirty?'pending':'saved');
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

