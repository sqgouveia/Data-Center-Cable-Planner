
// --- Supabase authentication -------------------------------------------------
const SUPABASE_URL = 'https://qfkygzzzavtvfupsohxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_t0XfFbIv0NkmC2GorCR7rw_jkif-gBA';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
let appStarted = false;
let guestMode = false;
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
function cloudProjectKey(){ return `dc-planner-cloud-project-${supabaseClient.auth?.getSession ? 'v1' : 'v1'}`; }
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
  if(Array.isArray(state.rooms)&&state.rooms.length){state.rooms.forEach(r=>{r.data=r.data||{};});if(!state.activeRoomId||!state.rooms.some(r=>r.id===state.activeRoomId))state.activeRoomId=state.rooms[0].id;migrateGlobalAssets();return;}
  state.rooms=[{id:uid('room'),name:'Sala 1',data:roomDataFromState()}];state.activeRoomId=state.rooms[0].id;migrateGlobalAssets();
}
function switchRoom(roomId){ensureRooms();const target=state.rooms.find(r=>r.id===roomId);if(!target)return;if(target.id===state.activeRoomId){updateRoomUI();return;}syncActiveRoom();persistHistoryContext();applyRoomData(target.data);state.activeRoomId=target.id;pan=null;initHistory(cloudProjectId,state.activeRoomId);updateRoomUI();renderAll(false);scheduleCloudSave();toast(`Sala aberta: ${target.name}`);}
function addRoom(){ensureRooms();const name=prompt('Nome da nova sala:','Sala '+(state.rooms.length+1));if(!name||!name.trim())return;syncActiveRoom();const base={rackUnits:state.rackUnits,rackWidth:state.rackWidth,rackGap:state.rackGap,rackDepth:state.rackDepth,defaultRowGap:state.defaultRowGap,lastUToTray:state.lastUToTray,defaultSlack:state.defaultSlack,rows:[],racks:[],cables:[],trays:[],trayLinks:[],trayRackLinks:[],structureLocked:false,snapToEdges:true};normalizeLocations();const parent=state.locations[0];const room={id:uid('room'),name:name.trim(),locationId:parent?.id||null,data:base,updatedAt:new Date().toISOString()};state.rooms.push(room);if(parent&&!parent.rooms.includes(room.id))parent.rooms.push(room.id);state.activeRoomId=room.id;applyRoomData(base);initHistory(cloudProjectId,state.activeRoomId,true);updateRoomUI();renderAll(false);scheduleCloudSave();toast(`Sala criada: ${room.name}`);}
function renameCurrentRoom(){ensureRooms();const room=state.rooms.find(r=>r.id===state.activeRoomId);if(!room)return;const name=prompt('Novo nome da sala:',room.name);if(!name||!name.trim())return;room.name=name.trim();room.updatedAt=new Date().toISOString();updateRoomUI();save();toast('Sala renomeada');}
function closeRoomMenu(){document.getElementById('roomMenu')?.remove();}
function showRoomMenu(){
  closeRoomMenu();
  const anchor=$('btnRenameRoom');
  const control=$('btnRenameRoom')?.closest('.room-control');
  if(!anchor||!control)return;
  const menu=document.createElement('div');
  menu.id='roomMenu';
  menu.className='room-menu';
  menu.innerHTML='<button type=\"button\" data-room-action=\"rename\"><span>✎</span>Renomear sala</button><button type=\"button\" data-room-action=\"delete\" class=\"danger\"><span>⌫</span>Excluir sala</button>';
  document.body.appendChild(menu);
  const r=control.getBoundingClientRect();
  const width=178;
  menu.style.left=Math.max(8,Math.min(window.innerWidth-width-8,r.right-width))+'px';
  menu.style.top=(r.bottom+6)+'px';
  menu.querySelector('[data-room-action=rename]').onclick=()=>{closeRoomMenu();renameCurrentRoom();};
  menu.querySelector('[data-room-action=delete]').onclick=()=>{closeRoomMenu();deleteCurrentRoom();};
}
function deleteCurrentRoom(){
  ensureRooms();
  if(state.rooms.length<=1){toast('O projeto precisa ter pelo menos uma sala.');return;}
  const current=state.rooms.find(r=>r.id===state.activeRoomId);
  if(!current)return;
  if(!confirm(`Excluir a sala \"${current.name}\"?\n\nTodos os racks, calhas e cabos desta sala serão excluídos. Essa ação não pode ser desfeita.`))return;
  syncActiveRoom();
  // Assets are project-level records. Removing a room only removes their location, never the asset itself.
  state.assets.forEach(a=>{if(a.roomId===current.id){a.roomId=null;a.rackId=null;}});
  const index=state.rooms.findIndex(r=>r.id===current.id);
  const wasActive=current.id===state.activeRoomId;
  state.rooms.splice(index,1);
  if(wasActive){
    const next=state.rooms[Math.min(index,state.rooms.length-1)];
    state.activeRoomId=next.id;
    applyRoomData(next.data);
    pan=null;
    updateRoomUI();
    renderAll(false);
    initHistory(cloudProjectId);
  }
  updateRoomUI();
  save();
  toast(`Sala excluída: ${current.name}`);
}
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
  if(locSelect){locSelect.innerHTML=state.locations.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');locSelect.value=loc?.id||'';fitTopbarSelect(locSelect);}
  const select=$('roomSelect');
  if(select){const rooms=loc?(loc.rooms||[]).map(id=>state.rooms.find(r=>r.id===id)).filter(Boolean):state.rooms;select.innerHTML=rooms.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');select.value=room.id;fitTopbarSelect(select);}
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
  const map=guestMode
    ? {saved:['●','Modo convidado — somente offline','guest'],saving:['●','Modo convidado — somente offline','guest'],pending:['●','Modo convidado — somente offline','guest'],error:['●','Modo convidado — somente offline','guest']}
    : {saved:['✓','Salvo na nuvem','saved'],saving:['⟳','Salvando...','saving'],pending:['●','Alterações não salvas','pending'],error:['⚠','Não sincronizado','error']};
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
  uStart:'U inicial', uHeight:'Quantidade de U', status:'Status', substatus:'Substatus'
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
async function recordAssetAudit({action,asset,before=null,after=null,changes=[]}){
  try{
    if(!cloudProjectId||!asset?.id)return false;
    const normalizedChanges=Array.isArray(changes)?changes:[];
    const actionName=String(action);
    // UPDATE sem nenhuma alteração real não deve gerar evento de auditoria.
    if(actionName==='UPDATE' && normalizedChanges.length===0)return false;
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user)return false;
    // Evita registros duplicados por duplo clique/duplo submit no mesmo instante.
    const dedupePayload=JSON.stringify({project_id:cloudProjectId,asset_id:String(asset.id),user_id:user.id,action:actionName,changes:normalizedChanges});
    const dedupeKey=btoa(unescape(encodeURIComponent(dedupePayload)));
    const now=Date.now();
    const last=assetAuditRecent.get(dedupeKey)||0;
    if(now-last<1500)return false;
    assetAuditRecent.set(dedupeKey,now);
    const row={project_id:cloudProjectId,asset_id:String(asset.id),user_id:user.id,user_email:user.email||null,action:actionName,asset_snapshot:after||asset||null,changes:normalizedChanges,changed_at:new Date().toISOString()};
    const {error}=await supabaseClient.from('asset_change_log').insert(row);
    if(error)throw error;
    return true;
  }catch(err){
    console.error('Asset audit log:',err);
    return false;
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
  }catch(err){console.error(err);list.innerHTML=`<div class="empty">Não foi possível carregar o histórico. Execute o SQL de migração da v16 no Supabase.</div>`;}
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
  if(guestMode || !cloudReady) return;
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
  if(guestMode || !cloudReady) return false;
  if(!cloudProjectId && !state.projectName) return false;
  if(lastCloudSnapshot===projectSnapshotForCloud() && cloudProjectId){ cloudDirty=false; setCloudStatus('saved'); return true; }
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
    if(typeof raw.persistedUi?.autosaveEnabled==='boolean') autosaveEnabled=raw.persistedUi.autosaveEnabled;

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
  const email=supabaseClient.auth?.getUser ? null : null;
  $('dashboardUserEmail').textContent=$('authUserEmail')?.textContent||'';
  renderDashboardProjects();
}
function hideDashboard(){
  appView='planner';
  $('dashboardScreen')?.classList.add('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','true');
  $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden'); $('minimapToggle')?.classList.remove('hidden'); if(localStorage.getItem('dccp_minimap_open')==='1') $('minimap')?.classList.remove('hidden');
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
        <div class="project-card-head"><div style="display:flex;gap:12px;align-items:flex-start"><div class="project-icon">📁</div><div><h3 class="project-name">${esc(project.name||'Projeto sem nome')}</h3><div class="project-date">Atualizado ${esc(formatProjectDate(project.updated_at))}</div></div></div>
          <div class="project-menu"><button class="btn ghost" data-project-menu="${esc(project.id)}" title="Mais opções">⋮</button></div></div>
        <div class="project-stats"><span><b>${st.rooms}</b> sala${st.rooms===1?'':'s'}</span><span><b>${st.rows}</b> fileira${st.rows===1?'':'s'}</span><span><b>${st.racks}</b> rack${st.racks===1?'':'s'}</span><span><b>${st.cables}</b> cabo${st.cables===1?'':'s'}</span><span><b>${st.trays}</b> calha${st.trays===1?'':'s'}</span></div>
        <div class="project-actions"><button class="btn primary" data-project-open="${esc(project.id)}">Abrir</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-project-open]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openCloudProject(b.dataset.projectOpen);}));
    grid.querySelectorAll('[data-project-menu]').forEach(b=>b.addEventListener('click',e=>{
      e.preventDefault(); e.stopPropagation(); closeProjectMenus();
      const project=projects.find(x=>String(x.id)===String(b.dataset.projectMenu));
      if(!project)return;
      const panel=document.createElement('div'); panel.className='project-menu-panel';
      panel.innerHTML='<button type="button" data-action="rename">Renomear</button><button type="button" data-action="duplicate">Duplicar</button><button type="button" data-action="export">Exportar projeto</button><button type="button" class="danger" data-action="delete">Excluir</button>';
      b.parentElement.appendChild(panel);
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
  state.projectName=name;state.rackUnits=48;state.rackWidth=.60;state.rackDepth=1.20;state.rackGap=0;state.defaultRowGap=1.20;state.lastUToTray=1.00;state.defaultSlack=10;state.rows=[];state.racks=[];state.cables=[];state.trays=[];state.trayLinks=[];state.trayRackLinks=[];state.assets=[];state.snapToEdges=true;state.assetCatalogs={types:[...DEFAULT_ASSET_TYPES],manufacturers:[],models:[],statuses:[...DEFAULT_ASSET_STATUSES],substatuses:[...DEFAULT_ASSET_SUBSTATUSES]}; state.locations=[];state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];state.theme=keepTheme;state.rooms=[];state.activeRoomId=null;ensureRooms();
  cloudProjectId=null;
  lastCloudSnapshot=null;
  cloudDirty=true;
  setCloudStatus('pending');
  updatePlannerProjectName();
  localStorage.removeItem(`${STORAGE}-cloud-id`);
  normalizeState();
}
async function createNewCloudProject(){
  const name=prompt('Nome do novo projeto:','Data Center');
  if(name===null)return;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject(String(name).trim()||'Data Center');
  cloudReady=true;
  await saveProjectToCloud(true);
  renderAll(false);initHistory(cloudProjectId);hideDashboard();toast('Novo projeto criado');
}
async function renameCloudProject(project){
  closeProjectMenus();
  const name=prompt('Novo nome do projeto:',project.name||'Projeto');
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
  if(!confirm(`Excluir o projeto "${project.name||'Projeto'}"? Esta ação não pode ser desfeita.`))return;
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
function setGuestUi(){
  document.body.classList.remove('auth-locked');
  $('authScreen')?.classList.add('hidden'); $('authScreen')?.setAttribute('aria-hidden','true');
  $('dashboardScreen')?.classList.add('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','true');
  $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden');
  // Em modo convidado a tela de dashboard pode ter ocultado os controles flutuantes.
  $('minimapToggle')?.classList.remove('hidden');
  if(localStorage.getItem('dccp_minimap_open')==='1') $('minimap')?.classList.remove('hidden'); else $('minimap')?.classList.add('hidden');
  $('authUserEmail').textContent='Modo convidado'; $('dashboardUserEmail').textContent='Modo convidado';
  const saveBtn=$('btnSave'); if(saveBtn){saveBtn.disabled=true;saveBtn.title='Indisponível no modo convidado';}
  const auto=$('autosaveToggle'); if(auto){auto.checked=false;auto.disabled=true;auto.title='Autosave na nuvem indisponível no modo convidado';}
  const autoLabel=$('autosaveLabel'); if(autoLabel)autoLabel.textContent='Offline';
  const projects=$('btnProjects'); if(projects){projects.disabled=true;projects.title='Projetos na nuvem indisponíveis no modo convidado';}
  const loc=$('btnLocations'); if(loc){};
  $('cloudStatus').textContent='● Modo convidado — somente offline'; $('cloudStatus').dataset.status='guest'; $('cloudStatus').title='O projeto não é salvo na nuvem. Use Exportar projeto para guardar uma cópia.';
  updatePlannerProjectName();
}
function enterGuestMode(){
  guestMode=true; appStarted=true; appView='planner'; cloudReady=false; cloudProjectId=null; cloudDirty=false; lastCloudSnapshot=null; STORAGE='dc-planner-v7-guest';
  clearTimeout(cloudSaveTimer);
  resetStateForNewProject('Projeto convidado');
  cloudDirty=false; cloudStatus='guest';
  if(typeof bind==='function') bind();
  setGuestUi();
  renderAll(false);
  initHistory(null,state.activeRoomId);
  updateHistoryButtons();
  toast('Modo convidado ativado');
}
function leaveGuestMode(){
  guestMode=false; appStarted=false; appView=null; cloudReady=false; cloudProjectId=null; cloudDirty=false; lastCloudSnapshot=null; STORAGE=GLOBAL_STORAGE;
  clearTimeout(cloudSaveTimer);
  $('btnSave')?.removeAttribute('disabled'); $('autosaveToggle')?.removeAttribute('disabled'); $('autosaveToggle').checked=autosaveEnabled; $('autosaveLabel').textContent='Autosave'; $('btnProjects')?.removeAttribute('disabled');
  $('mainTopbar')?.classList.add('hidden'); document.querySelector('.app')?.classList.add('hidden'); lockApp(); showAuthView('authLoginView'); $('loginPassword').value=''; $('loginEmail').focus();
}

function unlockApp(user, forceDashboard=false){
  if(user?.id){ STORAGE = `dc-planner-v7-user-${user.id}`; }
  document.body.classList.remove('auth-locked'); $('authScreen')?.classList.add('hidden'); $('authScreen')?.setAttribute('aria-hidden','true');
  const e=$('authUserEmail'); if(e)e.textContent=user?.email||'';
  $('dashboardUserEmail').textContent=user?.email||'';
  updatePlannerProjectName();
  if(forceDashboard || !appView) showDashboard();
}

async function startAuth(){
  lockApp();
  showAuthView('authLoginView');
  $('dashboardNewProject').onclick=createNewCloudProject; $('dashboardNewProjectEmpty').onclick=createNewCloudProject; $('dashboardLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  $('dashboardTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('authTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';localStorage.setItem(THEME_STORAGE,state.theme);applyTheme();};
  document.addEventListener('click',e=>{if(!e.target.closest('.project-menu'))closeProjectMenus();});
  $('btnGuest').onclick=enterGuestMode;
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
  $('btnLogout').onclick=async()=>{if(guestMode)return leaveGuestMode();await supabaseClient.auth.signOut();};
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(guestMode)return;
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

const U_MM = 44.45;
const GLOBAL_STORAGE = 'dc-planner-v7';
let STORAGE = GLOBAL_STORAGE;
const LEGACY_STORAGE = 'dc-planner-v6';
const THEME_STORAGE = 'dc-planner-theme';
const $ = id => document.getElementById(id);
const CABLE_TYPES = ['Fibra Multi Mode','Fibra Single Mode','UTP'];
const DEFAULT_CABLE_TYPE = 'UTP';

const state = {
  projectName: 'Data Center',
  rackUnits: 48,
  rackWidth: 0.60,
  rackGap: 0,
  rackDepth: 1.20,
  defaultRowGap: 1.20,
  lastUToTray: 1.00,
  defaultSlack: 10,
  rows: [], racks: [], cables: [], trays: [], trayLinks: [], assets: [], selected: null, multiSelected: [], trayMultiSelected: [],
  theme: localStorage.getItem(THEME_STORAGE) || localStorage.getItem('dc-theme') || 'dark',
  structureLocked: false, snapToEdges: true, rooms: [], activeRoomId: null, assetCatalogs: {types:['Servidor','Switch','Storage','PDU','Patch Panel','Firewall','Roteador','Outro'], manufacturers:[], models:[]}
};
let pan = null;
const VIEW_PAD = 700;
const ROW_GAP_VISUAL = 1.00;
const history = { undo: [], redo: [], last: null, restoring: false, max: 80, projectId: null, roomId: null, contexts: new Map() };
function isStructureLocked(){ return state.structureLocked===true; }
function setSnapToEdges(enabled=true,persist=false){
  // Snap is always enabled. Keep the legacy property for project compatibility.
  state.snapToEdges=true;
  if(persist)save();
}
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
function applyTheme(){
  const light=state.theme==='light';
  document.documentElement.classList.toggle('light',light);
  document.documentElement.dataset.theme=light?'light':'dark';
  document.documentElement.style.colorScheme=light?'light':'dark';
  localStorage.setItem(THEME_STORAGE,state.theme);
  const b=$('btnTheme');
  if(b){ b.textContent=light?'☀ Tema':'☾ Tema'; b.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const db=$('dashboardTheme'); if(db){ db.textContent=light?'☀ Tema':'☾ Tema'; db.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const ab=$('authTheme'); if(ab){ ab.textContent=light?'☀':'☾'; ab.title=light?'Alternar para tema escuro':'Alternar para tema claro'; ab.setAttribute('aria-label',ab.title); }
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

function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function cloneData(value){
  if(value===undefined)return undefined;
  if(value===null)return null;
  if(typeof structuredClone==='function'){try{return structuredClone(value);}catch(_){}}
  try{return JSON.parse(JSON.stringify(value));}catch(_){return value;}
}
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function toast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>t.classList.remove('show'),1800); }
function importProject(file){
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const raw=String(reader.result||'');
      if(!raw.trim())throw new Error('O arquivo está vazio.');
      const imported=JSON.parse(raw);
      if(!imported || typeof imported!=='object' || Array.isArray(imported)) throw new Error('Arquivo de projeto inválido.');

      // Keep volatile/session-only UI out of the imported project.
      const keepTheme=state.theme;
      const keepGuestMode=guestMode;

      // Accept the project JSON produced by Exportar projeto.  Clone first so
      // the file object never shares references with live state.
      const next=cloneData(imported);
      delete next.selected;
      delete next.multiSelected;
      delete next.trayMultiSelected;

      // Replace the project state in-place so existing UI bindings continue to work.
      Object.keys(state).forEach(k=>{ if(!(k in next) && k!=='theme') delete state[k]; });
      Object.assign(state,next);
      state.theme=keepTheme;
      state.selected=null;
      state.multiSelected=[];
      state.trayMultiSelected=[];
      state.snapToEdges=true;
      guestMode=keepGuestMode;
      cloudProjectId=guestMode?null:cloudProjectId;
      cloudDirty=!guestMode;
      lastCloudSnapshot=guestMode?null:projectSnapshotForCloud();
      ensureRooms();
      migrateGlobalAssets();
      normalizeState();
      const active=state.rooms.find(r=>r.id===state.activeRoomId)||state.rooms[0];
      if(active?.data)applyRoomData(active.data);
      syncActiveRoom();

      // Imported data is the new baseline: it must not be undoable back to the
      // unrelated project that was open before the import.
      history.contexts.clear();
      initHistory(cloudProjectId,state.activeRoomId,true);
      if(typeof updateRoomUI==='function')updateRoomUI();
      if(typeof applyTheme==='function')applyTheme();
      if(typeof renderAll==='function')renderAll(false);
      if(typeof updateStructureControls==='function')updateStructureControls();
      if(typeof updateMinimap==='function')updateMinimap();
      if(typeof setCloudStatus==='function')setCloudStatus(guestMode?'saved':'pending');
      if(typeof updatePlannerProjectName==='function')updatePlannerProjectName();
      if(!guestMode)scheduleCloudSave();
      toast(`Projeto importado: ${state.projectName||'Data Center'}`);
    }catch(err){
      console.error('Import project:',err);
      toast(err?.message||'Não foi possível importar o projeto.');
    }
  };
  reader.onerror=()=>toast('Não foi possível ler o arquivo do projeto.');
  reader.readAsText(file,'utf-8');
}
function save(){ recordHistory(); localStorage.setItem(THEME_STORAGE,state.theme); applyTheme(); updatePlannerProjectName(); scheduleCloudSave(); }
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
function rowForRack(r){ return r?state.rows.find(x=>x.id===r.rowId):null; }
function rowIndex(r){ return r?state.rows.findIndex(x=>x.id===r.rowId):-1; }
function racksInRow(rowId){ return state.racks.filter(r=>r.rowId===rowId).sort((a,b)=>a.index-b.index); }
function rackAt(rowId,index){ return racksInRow(rowId).find(r=>r.index===index)||null; }
function adjacentRows(row){ const i=state.rows.findIndex(x=>x.id===row?.id); if(i<0)return[]; return state.rows.filter((_,idx)=>Math.abs(idx-i)===1); }
function makeRack(row,index){ return {id:uid('rack'),rowId:row.id,index,name:`${row.name||'R'}-${String(index+1).padStart(2,'0')}`,units:state.rackUnits,width:state.rackWidth,depth:state.rackDepth,gapAfter:state.rackGap,riseToTray:state.lastUToTray,offset:0,yOffset:0,hasTray:false}; }
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
  state.cables.forEach(c=>{c.type=CABLE_TYPES.includes(c.type)?c.type:DEFAULT_CABLE_TYPE;c.via=(c.via||[]).filter(id=>rackIds.has(id));});
  if(state.selected?.type==='rack'&&!rackIds.has(state.selected.id))state.selected=null;
  state.multiSelected=Array.isArray(state.multiSelected)?state.multiSelected.filter(id=>rackIds.has(id)):[];
  if(state.selected?.type==='rack' && !state.multiSelected.includes(state.selected.id)) state.multiSelected=[state.selected.id];
  const trayIds=new Set(state.trays.map(t=>t.id));
  state.trayMultiSelected=Array.isArray(state.trayMultiSelected)?state.trayMultiSelected.filter(id=>trayIds.has(id)):[];
  if(state.selected?.type==='tray' && !state.trayMultiSelected.includes(state.selected.id)) state.trayMultiSelected=[state.selected.id];
}
function rebuildStructureFromSettings(){
  if(structureBlocked())return;
  if(state.rows.length || state.racks.length || state.trays.length){
    const ok=confirm('Reconstruir estrutura?\n\nRacks e calhas atuais serão recriados do zero usando as configurações atuais. Os cabos serão preservados quando origem e destino continuarem existindo.\n\nVocê poderá desfazer a reconstrução usando o botão Desfazer. Deseja continuar?');
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
  const msg=oldTrayCount?`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s); ${oldTrayCount} calha(s) antiga(s) removida(s) e a estrutura foi recriada do zero.`:`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s).`;
  toast(droppedCables?`${msg} ${droppedCables} cabo(s) removido(s) por falta de origem/destino.`:msg);
}

function initRows(){ return rebuildStructureFromSettings(); }
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

function rowDepth(row){
  // A row has its own fixed layout depth. Changing an individual rack depth
  // must not move the whole row or any other row.
  return Math.max(0.1,num(row?.depth,state.rackDepth));
}
function geometry(){
  const wrap=$('canvasWrap'), vw=wrap.clientWidth||900, vh=wrap.clientHeight||700;
  const maxSlot=Math.max(1,...state.rows.map(r=>Math.max(0,num(r.rackCount,0))),1);
  const nominalW=Math.max(0.1,num(state.rackWidth,.6));
  const scale=Math.max(95,Math.min(125,(vw-180)/(maxSlot*(nominalW+Math.max(0,num(state.rackGap,.02)))+1)));
  const x0=VIEW_PAD+90; let y=VIEW_PAD+70; const rows=[];
  state.rows.forEach((row,ri)=>{
    if(ri>0){
      const prev=state.rows[ri-1];
      y+=rowDepth(prev)*scale + Math.max(0,num(row.gap,0))*ROW_GAP_VISUAL*scale;
    }
    rows.push({row,y});
  });
  let maxRight=x0+200;
  let maxBottom=y+rowDepth(state.rows[state.rows.length-1]||{id:''})*scale+150;
  state.rows.forEach(row=>racksInRow(row.id).forEach(r=>{
    const x=x0+rowSlotPhysicalX(row,r.index)*scale+num(r.offset,0);
    maxRight=Math.max(maxRight,x+num(r.width,nominalW)*scale+140);
  }));
  return {w:Math.max(vw+VIEW_PAD*2,maxRight+VIEW_PAD),h:Math.max(vh+VIEW_PAD*2,maxBottom+VIEW_PAD),vw,vh,scale,x0,rows};
}
function slotPhysicalWidth(row,index){
  const r=rackAt(row.id,index);
  return r?num(r.width,state.rackWidth):num(state.rackWidth,.6);
}
function slotGapAfter(row,index){
  const r=rackAt(row.id,index);
  return r?Math.max(0,num(r.gapAfter,state.rackGap)):Math.max(0,num(state.rackGap,.02));
}
function rowSlotPhysicalX(row,index){
  let x=0;
  for(let i=0;i<Math.max(0,index);i++) x+=slotPhysicalWidth(row,i)+slotGapAfter(row,i);
  return x;
}
function rackRect(r,g){
  const info=g.rows.find(x=>x.row.id===r.rowId);
  const x=g.x0+rowSlotPhysicalX(rowForRack(r),r.index)*g.scale+num(r.offset,0);
  const y=(info?info.y:0)+num(r.yOffset,0);
  const ww=num(r.width,state.rackWidth)*g.scale;
  const hh=num(r.depth,state.rackDepth)*g.scale;
  return{x,y,w:ww,h:hh};
}
function rackCenter(r,g){const q=rackRect(r,g);return{x:q.x+q.w/2,y:q.y+q.h/2};}
function edgeRacks(rowId){const rs=racksInRow(rowId);return {first:rs[0]||null,last:rs[rs.length-1]||null};}
function isEdgeRack(r){const row=rowForRack(r);if(!row)return false;const e=edgeRacks(row.id);return !!e.first&&!!e.last&&(r.id===e.first.id||r.id===e.last.id);}
function edgeSideForRack(r){const e=edgeRacks(r.rowId);if(e.first?.id===r.id)return 'left';if(e.last?.id===r.id)return 'right';return null;}
function currentEdgeIndex(rowId,side){const e=edgeRacks(rowId);return side==='left'?(e.first?.index??0):(e.last?.index??0);} 

function rackSidePoint(r,g){const q=rackRect(r,g); const side=edgeSideForRack(r); return side==='left'?{x:q.x,y:q.y+q.h/2}:side==='right'?{x:q.x+q.w,y:q.y+q.h/2}:rackCenter(r,g);}
function rowCenterY(rowIndexValue,g){const info=g.rows[rowIndexValue]; if(!info)return 0; const rs=racksInRow(info.row.id); if(!rs.length)return info.y; const ys=rs.map(r=>rackCenter(r,g).y); return ys.reduce((a,b)=>a+b,0)/ys.length;}
function rowTrayBounds(row,g){
  const rs=racksInRow(row.id);
  const y=rowCenterY(state.rows.findIndex(x=>x.id===row.id),g);
  if(!rs.length){
    const x=g.x0;
    return {left:x-20,right:x-20,y};
  }
  const rects=rs.map(r=>rackRect(r,g));
  const left=Math.min(...rects.map(q=>q.x));
  const right=Math.max(...rects.map(q=>q.x+q.w));
  return {left:left-20,right:right+20,y};
}
function trayPointForRack(r,g){
  const row=rowForRack(r); if(!row)return rackCenter(r,g);
  const b=rowTrayBounds(row,g); if(!b)return rackCenter(r,g);
  if(r.index===0)return {x:b.left,y:b.y};
  const rs=racksInRow(row.id);
  const maxIndex=Math.max(...rs.map(x=>x.index));
  if(r.index===maxIndex)return {x:b.right,y:b.y};
  return {x:rackCenter(r,g).x,y:b.y};
}
function rackTrayPoint(r,g){return trayPointForRack(r,g);}
function trayPointForRowIndex(row,index,g,side){
  const b=rowTrayBounds(row,g);
  if(!b)return {x:g.x0,y:rowCenterY(state.rows.findIndex(x=>x.id===row.id),g)};
  const i=Math.max(0,Number(index)||0);
  const rs=racksInRow(row.id);
  const maxIndex=Math.max(0,Number(row.rackCount||0)-1);
  // Edge interconnections belong to the calha endpoint, never to the edge rack.
  if(side==='left')return {x:b.left,y:b.y};
  if(side==='right')return {x:b.right,y:b.y};
  if(i===0)return {x:b.left,y:b.y};
  if(i===maxIndex)return {x:b.right,y:b.y};
  const ref=rs.find(r=>r.index===i);
  if(ref)return {x:rackCenter(ref,g).x,y:b.y};
  const nominal=num(state.rackWidth,.6)*g.scale;
  let px=0; for(let k=0;k<i;k++) px+=slotPhysicalWidth(row,k)*g.scale+slotGapAfter(row,k)*g.scale;
  return {x:b.left+20+px+nominal/2,y:b.y};
}

function traySide(t,rowId){
  if(!t?.edge)return null;
  if(t.fromRowId===rowId && t.sideFrom)return t.sideFrom;
  if(t.toRowId===rowId && t.sideTo)return t.sideTo;
  const idx=t.fromRowId===rowId?t.fromIndex:t.toIndex;
  const row=state.rows.find(r=>r.id===rowId);
  if(!row)return null;
  const e=edgeRacks(row.id);
  if(e.first?.index===idx)return 'left';
  if(e.last?.index===idx)return 'right';
  return idx <= ((e.first?.index??0)+(e.last?.index??0))/2 ? 'left' : 'right';
}

function physicalPointOnRow(row,index,side){
  const maxIndex=Math.max(0,...racksInRow(row.id).map(r=>r.index));
  if(side==='left')return 0;
  if(side==='right'){
    let total=0;
    for(let i=0;i<=maxIndex;i++){
      total+=slotPhysicalWidth(row,i);
      if(i<maxIndex) total+=slotGapAfter(row,i);
    }
    return total;
  }
  const i=Math.max(0,Number(index)||0);
  let x=0;
  for(let k=0;k<i;k++) x+=slotPhysicalWidth(row,k)+slotGapAfter(row,k);
  return x+slotPhysicalWidth(row,i)/2;
}
function connectionPhysicalPosition(node){
  const row=state.rows.find(r=>r.id===node.rowId);
  return row?physicalPointOnRow(row,node.index,node.side):0;
}


function trayKey(t){return `${t.fromRowId}:${t.fromIndex}<->${t.toRowId}:${t.toIndex}`;}
function trayExists(a,b){return state.trays.some(t=>(t.fromRowId===a.rowId&&t.fromIndex===a.index&&t.toRowId===b.rowId&&t.toIndex===b.index)||(t.fromRowId===b.rowId&&t.fromIndex===b.index&&t.toRowId===a.rowId&&t.toIndex===a.index));}
function explicitTraysForRack(r){return state.trays.filter(t=>(t.fromRowId===r.rowId&&t.fromIndex===r.index)||(t.toRowId===r.rowId&&t.toIndex===r.index));}
function traysForRack(r){return explicitTraysForRack(r);}
function rackHasTray(r){return explicitTraysForRack(r).length>0;}
function addRackTrayToRow(r,targetRackId){
 const b=state.racks.find(x=>x.id===targetRackId);if(!b){toast('Selecione um rack de destino válido');return;}
 const targetRow=rowForRack(b),sourceRow=rowForRack(r);
 if(!targetRow||!sourceRow||!adjacentRows(sourceRow).some(x=>x.id===targetRow.id)){toast('A calha só pode interligar fileiras adjacentes');return;}
 if(b.index!==r.index){toast('A calha só pode interligar racks na mesma posição');return;}
 if(trayExists(r,b)){toast('Essa interligação de calha já existe');return;}
 const edge=isEdgeRack(r)&&isEdgeRack(b);
 state.trays.push({id:uid('tray'),fromRowId:r.rowId,toRowId:b.rowId,fromIndex:r.index,toIndex:b.index,edge,sideFrom:edge?edgeSideForRack(r):null,sideTo:edge?edgeSideForRack(b):null});
 normalizeState();renderAll();toast('Interligação de calha criada');
}
function removeRackTrays(r){/* infraestrutura sobrevive à exclusão do rack */}

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
// Keep tray endpoints that were snapped to racks physically attached to those
// racks. This makes an existing calha follow changes in rack width, depth or
// spacing without moving free/independent trays. The saved link also preserves
// which side/point of the rack the endpoint was attached to.
function syncStructuralTrayEndpoints(g){
  if(!g)return;
  // Inter-row calhas created from one rack/fileira to another are structural
  // connections, not free-floating geometry. Their endpoints must be derived
  // from the current rack positions on both rows every render. This makes them
  // follow changes to row spacing as well as rack width/gap changes.
  state.trays.forEach(t=>{
    if(!t?.fromRowId || !t?.toRowId)return;
    const ra=state.rows.find(r=>r.id===t.fromRowId);
    const rb=state.rows.find(r=>r.id===t.toRowId);
    if(!ra||!rb)return;
    const a=trayPointForRowIndex(ra,t.fromIndex,g,t.sideFrom||null);
    const b=trayPointForRowIndex(rb,t.toIndex,g,t.sideTo||null);
    if(a&&Number.isFinite(a.x)&&Number.isFinite(a.y)){t.x1=a.x;t.y1=a.y;}
    if(b&&Number.isFinite(b.x)&&Number.isFinite(b.y)){t.x2=b.x;t.y2=b.y;}
  });
}

function syncAttachedTrayEndpoints(g){
  if(!g)return;
  syncStructuralTrayEndpoints(g);
  if(!Array.isArray(state.trayRackLinks) || !state.trayRackLinks.length)return;
  state.trayRackLinks.forEach(link=>{
    const t=state.trays.find(x=>x.id===link.trayId);
    const r=state.racks.find(x=>x.id===link.rackId);
    if(!t||!r)return;
    const q=rackRect(r,g);
    let p;
    if(Number.isFinite(Number(link.rx)) && Number.isFinite(Number(link.ry)) && link.connectionKind==='edge'){
      p={x:q.x+Math.max(0,Math.min(1,Number(link.rx)))*q.w,y:q.y+Math.max(0,Math.min(1,Number(link.ry)))*q.h};
    }else{
      switch(link.point){
        case 'left': p={x:q.x,y:q.y+q.h/2}; break;
        case 'right': p={x:q.x+q.w,y:q.y+q.h/2}; break;
        case 'top': p={x:q.x+q.w/2,y:q.y}; break;
        case 'bottom': p={x:q.x+q.w/2,y:q.y+q.h}; break;
        case 'top-left': p={x:q.x,y:q.y}; break;
        case 'top-right': p={x:q.x+q.w,y:q.y}; break;
        case 'bottom-left': p={x:q.x,y:q.y+q.h}; break;
        case 'bottom-right': p={x:q.x+q.w,y:q.y+q.h}; break;
        default: p={x:q.x+q.w/2,y:q.y+q.h/2};
      }
    }
    if(Number(link.end)===0){t.x1=p.x;t.y1=p.y;}
    else {t.x2=p.x;t.y2=p.y;}
  });
}
function trayLengthPx(t){return Math.hypot(num(t.x2)-num(t.x1),num(t.y2)-num(t.y1));}
function trayLengthMeters(t,g){syncAttachedTrayEndpoints(g);return trayLengthPx(t)/Math.max(1,g.scale);}
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
      // Dimension line is intentionally placed outside the racks/fileira labels.
      // The extension lines point from the rack edge to the external dimension,
      // keeping the gap itself visually free even when rows are very close.
      const xDim=Math.max(40, g.x0-88);
      const xExt=g.x0-50;
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
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><rect class="rack-hit" x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="8"/><rect class="rack-body ${selected?'selected':''}" x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="7"/><rect class="rack-face" x="${faceX}" y="${faceY}" width="${faceW}" height="${faceH}" rx="5"/><line class="rack-topline" x1="${vx+8}" y1="${lineY}" x2="${vx+vw-8}" y2="${lineY}"/><circle class="rack-led" cx="${vx+14}" cy="${vy+13}" r="2"/><circle class="rack-led" cx="${vx+21}" cy="${vy+13}" r="2"/><circle class="rack-led" cx="${vx+28}" cy="${vy+13}" r="2"/><circle class="rack-led" cx="${vx+35}" cy="${vy+13}" r="2"/></g>`);
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
        svg.insertAdjacentHTML('beforeend',`<polyline class="route-line" points="${pts.map(p=>p.x+','+p.y).join(' ')}"/>`);
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
          curveMarkup=turns.map(p=>`<circle class="cable-route-turn" cx="${p.x}" cy="${p.y}" r="4"/>`).join('');
          svg.insertAdjacentHTML('beforeend',
            `<g class="cable-endpoints cable-route-markers" pointer-events="none">`+
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

function trayPointAt(t,tValue){
  const u=Math.max(0,Math.min(1,Number(tValue)||0));
  return {x:num(t.x1)+(num(t.x2)-num(t.x1))*u,y:num(t.y1)+(num(t.y2)-num(t.y1))*u};
}
function nearestPointOnSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  if(!den)return {x:ax,y:ay,t:0,d:Math.hypot(px-ax,py-ay)};
  let t=((px-ax)*dx+(py-ay)*dy)/den;t=Math.max(0,Math.min(1,t));
  const x=ax+t*dx,y=ay+t*dy;return {x,y,t,d:Math.hypot(px-x,py-y)};
}
function nearestTrayConnection(ignoreId,x,y,maxDist){
  let best=null,bestD=maxDist;
  state.trays.forEach(t=>{
    if(t.id===ignoreId)return;
    const q=nearestPointOnSegment(x,y,num(t.x1),num(t.y1),num(t.x2),num(t.y2));
    if(q.d<=bestD){best={type:'tray',tray:t,x:q.x,y:q.y,t:q.t,end:q.t<=0.001?'a':q.t>=0.999?'b':null};bestD=q.d;}
  });
  return best;
}
function nearestPointOnRectPerimeter(x,y,q){
  const candidates=[
    {side:'top',x:Math.max(q.x,Math.min(q.x+q.w,x)),y:q.y},
    {side:'bottom',x:Math.max(q.x,Math.min(q.x+q.w,x)),y:q.y+q.h},
    {side:'left',x:q.x,y:Math.max(q.y,Math.min(q.y+q.h,y))},
    {side:'right',x:q.x+q.w,y:Math.max(q.y,Math.min(q.y+q.h,y))}
  ];
  let best=candidates[0];
  let bestD=Math.hypot(x-best.x,y-best.y);
  for(let i=1;i<candidates.length;i++){
    const c=candidates[i],d=Math.hypot(x-c.x,y-c.y);
    if(d<bestD){best=c;bestD=d;}
  }
  return {...best,d:bestD};
}
function rackConnectionPoint(r,g,x,y){
  const q=rackRect(r,g);
  const cx=q.x+q.w/2,cy=q.y+q.h/2;
  const points=[
    {point:'center',x:cx,y:cy,kind:'center'},
    {point:'top',x:cx,y:q.y,kind:'edge',side:'top'},
    {point:'bottom',x:cx,y:q.y+q.h,kind:'edge',side:'bottom'},
    {point:'left',x:q.x,y:cy,kind:'edge',side:'left'},
    {point:'right',x:q.x+q.w,y:cy,kind:'edge',side:'right'},
    {point:'top-left',x:q.x,y:q.y,kind:'edge',side:'top-left'},
    {point:'top-right',x:q.x+q.w,y:q.y,kind:'edge',side:'top-right'},
    {point:'bottom-left',x:q.x,y:q.y+q.h,kind:'edge',side:'bottom-left'},
    {point:'bottom-right',x:q.x+q.w,y:q.y+q.h,kind:'edge',side:'bottom-right'}
  ];
  points.forEach(p=>p.d=Math.hypot(x-p.x,y-p.y));
  return {center:points[0],edgePoints:points.slice(1),points};
}
function nearestTrayOrRackSnap(ignoreTrayId,x,y,maxDist){
  const g=geometry();
  let best=null,bestD=maxDist;

  // 1) Existing tray-to-tray connection remains fully free-form: any point
  // along another calha can be used as a junction.
  const tray=nearestTrayConnection(ignoreTrayId,x,y,maxDist);
  if(tray){best=tray;bestD=Math.hypot(x-tray.x,y-tray.y);}

  // 2) Rack snap targets are deliberately discrete: center + center of each
  // lateral + four corners. We also detect when an existing tray passes close
  // to one of these exact rack anchors. In that situation, the preferred snap
  // is the rack anchor itself, while the tray junction is stored at the
  // corresponding point along the existing tray. This lets an intermediate
  // calha be connected cleanly at the rack's center/corner instead of ending
  // a few pixels away from the rack anchor.
  state.racks.forEach(r=>{
    const rc=rackConnectionPoint(r,g,x,y);
    const candidates=rc.points;
    candidates.forEach(c=>{
      const d=Math.hypot(x-c.x,y-c.y);
      if(d>maxDist)return;
      let linkedTray=null,linkedHit=null,linkedDist=Infinity;
      state.trays.forEach(other=>{
        if(other.id===ignoreTrayId)return;
        const hit=nearestPointOnSegment(c.x,c.y,num(other.x1),num(other.y1),num(other.x2),num(other.y2));
        if(hit.d<linkedDist){linkedDist=hit.d;linkedTray=other;linkedHit=hit;}
      });

      // A tray is considered to pass through a rack snap anchor when it is
      // physically close enough to that exact point. The allowance is slightly
      // larger than the ordinary mouse snap distance so small visual offsets
      // caused by zoom do not prevent a clean infrastructure junction.
      const trayAnchorTol=Math.min(Math.max(10,g.scale*0.08),Math.max(16,maxDist));
      const hasTrayAnchor=!!linkedTray && linkedDist<=trayAnchorTol;
      const result={type:hasTrayAnchor?'rack-tray':'rack',rack:r,x:c.x,y:c.y,point:c.point};
      if(c.kind==='edge'){
        result.connectionKind='edge';
        result.side=c.side;
        const q=rackRect(r,g);
        result.rx=(c.x-q.x)/Math.max(q.w,1);
        result.ry=(c.y-q.y)/Math.max(q.h,1);
      }else{
        result.connectionKind='center';
        result.rx=.5; result.ry=.5;
      }
      if(hasTrayAnchor){
        result.tray=linkedTray;
        result.trayX=linkedHit.x;
        result.trayY=linkedHit.y;
        result.trayT=linkedHit.t;
        // Prefer the exact rack anchor whenever the cursor is close to it.
        // Only fall back to a free tray target when the anchor is not in range.
        if(d<=bestD+6){best=result;bestD=d;}
      }else if(d<=bestD){
        best=result;bestD=d;
      }
    });
  });
  return best;
}
function linkTrayPoints(aTray,aT,bTray,bT){
  const exists=state.trayLinks.some(l=>
    (l.aTray===aTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-aT)<0.002&&l.bTray===bTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-bT)<0.002)||
    (l.aTray===bTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-bT)<0.002&&l.bTray===aTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-aT)<0.002));
  if(!exists)state.trayLinks.push({aTray,aT,bTray,bT});
}
function segmentIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y}, s={x:d.x-c.x,y:d.y-c.y};
  const cross=(u,v)=>u.x*v.y-u.y*v.x;
  const den=cross(r,s);
  const qmp={x:c.x-a.x,y:c.y-a.y};
  if(Math.abs(den)<1e-9)return null;
  const t=cross(qmp,s)/den, u=cross(qmp,r)/den;
  if(t<-1e-6||t>1+1e-6||u<-1e-6||u>1+1e-6)return null;
  return {x:a.x+t*r.x,y:a.y+t*r.y,tA:Math.max(0,Math.min(1,t)),tB:Math.max(0,Math.min(1,u))};
}
function trayLinkExistsAt(aTray,aT,bTray,bT,tol=0.002){
  return state.trayLinks.some(l=>{
    const la=l.aTray===aTray&&l.bTray===bTray&&Math.abs((l.aT??0)-aT)<=tol&&Math.abs((l.bT??0)-bT)<=tol;
    const lb=l.aTray===bTray&&l.bTray===aTray&&Math.abs((l.aT??0)-bT)<=tol&&Math.abs((l.bT??0)-aT)<=tol;
    return la||lb;
  });
}

// Remove automatically-created crossing junctions as soon as their geometry
// stops representing a real intersection. This runs during render so a stale
// junction cannot remain visible until another selection/render event.
function cleanupAutoCrossingLinks(){
  if(!Array.isArray(state.trayLinks)||!state.trayLinks.length)return;
  state.trayLinks=state.trayLinks.filter(l=>{
    if(!l.autoCrossing)return true;
    const a=state.trays.find(t=>t.id===l.aTray);
    const b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return false;
    const hit=segmentIntersection(
      {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
      {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
    );
    if(!hit)return false;
    const aT=Number.isFinite(l.aT)?l.aT:(l.aEnd==='a'?0:1);
    const bT=Number.isFinite(l.bT)?l.bT:(l.bEnd==='a'?0:1);
    // The saved junction must still be at the current physical intersection.
    if(Math.abs(hit.tA-aT)>0.002||Math.abs(hit.tB-bT)>0.002)return false;
    // A crossing is only a real infrastructure junction when at least one
    // of the two trays is fully connected at both endpoints.
    const fullyA=trayEndpointConnected(a.id,0)&&trayEndpointConnected(a.id,1);
    const fullyB=trayEndpointConnected(b.id,0)&&trayEndpointConnected(b.id,1);
    return fullyA||fullyB;
  });
}
function updateLinksForTray(id){
  // Existing links use normalized positions, so they follow the calha when it moves.
  // A simple crossing is NOT a connection while the calha is being dragged.
}
function trayEndpointConnected(trayId,end){
  const t=state.trays.find(x=>x.id===trayId);
  if(!t)return false;
  const ex=end===0?num(t.x1):num(t.x2);
  const ey=end===0?num(t.y1):num(t.y2);

  // 1) Explicit links created by the snap interaction.
  const viaTray=state.trayLinks.some(l=>{
    const a=l.aTray===trayId && Math.abs((l.aT??(l.aEnd==='a'?0:1))-end)<0.002;
    const b=l.bTray===trayId && Math.abs((l.bT??(l.bEnd==='a'?0:1))-end)<0.002;
    return a||b;
  });
  if(viaTray)return true;
  const viaRack=state.trayRackLinks.some(l=>l.trayId===trayId && l.end===end);
  if(viaRack)return true;

  // 2) Geometry fallback. A connection is also valid when the endpoint is
  // physically sitting on a rack connection point or on another tray. This
  // makes the routing robust even if an older project has the geometry but
  // is missing the corresponding link record.
  const g=geometry();
  const tol=6;
  for(const r of state.racks){
    const rc=rackConnectionPoint(r,g,ex,ey);
    const candidates=rc.points;
    if(candidates.some(pt=>pt.d<=tol))return true;
  }
  for(const other of state.trays){
    if(other.id===trayId)continue;
    const q=nearestPointOnSegment(ex,ey,num(other.x1),num(other.y1),num(other.x2),num(other.y2));
    if(q.d<=tol)return true;
  }
  return false;
}
function connectCrossingsForTray(trayId){
  const a=state.trays.find(t=>t.id===trayId); if(!a)return;
  // This is intentionally evaluated only after mouseup, and only when both
  // endpoints are already connected. At that point crossings become real
  // junctions in the infrastructure network.
  if(!trayEndpointConnected(trayId,0)||!trayEndpointConnected(trayId,1))return;
  state.trays.forEach(b=>{
    if(b.id===a.id)return;
    const hit=segmentIntersection(
      {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
      {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
    );
    if(!hit)return;
    // If the intersection is already one of the explicit links, keep it.
    if(trayLinkExistsAt(a.id,hit.tA,b.id,hit.tB))return;
    state.trayLinks.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,autoCrossing:true});
  });
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
function assetConflicts(asset, ignoreId=null){
  if(!asset.rackId)return false;
  const a=assetOccupancy(asset);
  return state.assets.some(x=>x.id!==ignoreId && x.rackId===asset.rackId && (()=>{const b=assetOccupancy(x);return a.start<=b.end&&b.start<=a.end;})());
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
    seen.add(key);models.push({id:(m&&typeof m==='object'&&m.id)||uid('model'),name,manufacturer,type});
  });
  c.models=models;
  DEFAULT_ASSET_TYPES.forEach(x=>{if(!c.types.includes(x))c.types.push(x);});
  state.assetCatalogs=c;
}
function catalogNormalize(value){
  return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'');
}
function catalogSimilarity(a,b){
  const x=catalogNormalize(a),y=catalogNormalize(b); if(!x||!y)return 0; if(x===y)return 1;
  const prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){let cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev.splice(0,prev.length,...cur);}
  return 1-prev[y.length]/Math.max(x.length,y.length);
}
function catalogSimilar(value,values){
  const norm=catalogNormalize(value); if(!norm)return [];
  return [...new Set((values||[]).map(v=>String(v))).values()].filter(v=>catalogNormalize(v)!==norm&&catalogSimilarity(value,v)>=0.84).sort((a,b)=>catalogSimilarity(value,b)-catalogSimilarity(value,a));
}
function catalogExact(value,values){const n=catalogNormalize(value);return (values||[]).find(v=>catalogNormalize(v)===n)||null;}
function catalogKeyLabel(key){return key==='types'?'Tipos de ativo':key==='manufacturers'?'Fabricantes':key==='statuses'?'Status':key==='substatuses'?'Substatus':'Modelos';}
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
    typeEl.innerHTML=values.length?values.map(v=>{const i=state.assetCatalogs.types.indexOf(v);return `<div class="catalog-row"><span title="${esc(v)}">${esc(v)}</span><div><button type="button" class="iconbtn" data-catalog-edit="types:${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-delete="types:${i}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhum tipo encontrado.</div>';
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
    modelEl.innerHTML=values.length?values.map(m=>`<div class="catalog-row"><div class="catalog-model-info"><span title="${esc(m.name)}">${esc(m.name)}</span><small>${esc(m.type||'Outro')} · ${esc(m.manufacturer||'Sem fabricante')}</small></div><div><button type="button" class="iconbtn" data-catalog-model-edit="${esc(m.id)}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-catalog-model-delete="${esc(m.id)}" title="Excluir">×</button></div></div>`).join(''):'<div class="empty">Nenhum modelo encontrado.</div>';
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
    locEl.innerHTML=filtered.map(({l,rooms,stocks})=>`<div class="catalog-row location-row"><div><strong>📍 ${esc(l.name)}</strong><small>${rooms.length} sala(s) · ${stocks.length} estoque(s)</small></div><div class="location-actions"><button type="button" class="btn ghost small location-action-btn" data-location-room="${esc(l.id)}" title="Adicionar sala">＋ Adicionar sala (${esc(l.name)})</button><button type="button" class="btn ghost small location-action-btn" data-location-stock="${esc(l.id)}" title="Adicionar estoque">＋ Adicionar estoque (${esc(l.name)})</button><button type="button" class="iconbtn" data-location-edit="${esc(l.id)}" title="Renomear">✎</button><button type="button" class="iconbtn danger-icon" data-location-delete="${esc(l.id)}" title="Excluir Data Center">×</button></div></div>${rooms.filter(r=>!locQ||r.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(r=>`<div class="catalog-row location-room-row"><span>▣ ${esc(r.name)} <small>(${esc(l.name)})</small></span><div><button type="button" class="iconbtn" data-location-room-edit="${esc(r.id)}" title="Editar sala">✎</button><button type="button" class="iconbtn danger-icon" data-location-room-delete="${esc(r.id)}" title="Excluir sala">×</button></div></div>`).join('')}${stocks.filter(st=>!locQ||st.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(st=>`<div class="catalog-row location-stock-row"><span>📦 ${esc(st.name)} <small>(${esc(l.name)})</small></span><div><button type="button" class="iconbtn" data-location-stock-edit="${esc(l.id)}:${esc(st.id)}" title="Editar estoque">✎</button><button type="button" class="iconbtn danger-icon" data-location-stock-delete="${esc(l.id)}:${esc(st.id)}" title="Excluir estoque">×</button></div></div>`).join('')}`).join('')||'<div class="empty">Nenhuma localização encontrada.</div>';
  }
  document.querySelectorAll('[data-location-edit]').forEach(b=>b.onclick=()=>renameAssetLocation(b.dataset.locationEdit));
  document.querySelectorAll('[data-location-delete]').forEach(b=>b.onclick=()=>deleteAssetLocation(b.dataset.locationDelete));
  document.querySelectorAll('[data-location-stock]').forEach(b=>b.onclick=()=>addAssetStock(b.dataset.locationStock));
  document.querySelectorAll('[data-location-room]').forEach(b=>b.onclick=()=>addAssetRoom(b.dataset.locationRoom));
  document.querySelectorAll('[data-location-room-edit]').forEach(b=>b.onclick=()=>renameAssetRoom(b.dataset.locationRoomEdit));
  document.querySelectorAll('[data-location-room-delete]').forEach(b=>b.onclick=()=>deleteAssetRoom(b.dataset.locationRoomDelete));
  document.querySelectorAll('[data-location-stock-edit]').forEach(b=>b.onclick=()=>renameAssetStock(...b.dataset.locationStockEdit.split(':')));
  document.querySelectorAll('[data-location-stock-delete]').forEach(b=>b.onclick=()=>deleteAssetStock(...b.dataset.locationStockDelete.split(':')));
  document.querySelectorAll('[data-catalog-edit]').forEach(b=>b.onclick=()=>openCatalogEditor(...b.dataset.catalogEdit.split(':')));
  document.querySelectorAll('[data-catalog-delete]').forEach(b=>b.onclick=()=>deleteCatalogItem(...b.dataset.catalogDelete.split(':')));
  document.querySelectorAll('[data-catalog-model-edit]').forEach(b=>b.onclick=()=>openCatalogEditor('models',b.dataset.catalogModelEdit));
  document.querySelectorAll('[data-catalog-model-delete]').forEach(b=>b.onclick=()=>deleteModelCatalogItem(b.dataset.catalogModelDelete));
  document.querySelectorAll('[data-catalog-add]').forEach(b=>b.onclick=()=>openCatalogEditor(b.dataset.catalogAdd));
}
function addAssetRoom(locationId){
  normalizeLocations(); const loc=state.locations.find(x=>x.id===locationId); if(!loc)return;
  const name=prompt(`Nome da nova sala em ${loc.name}:`,'Sala '+(loc.rooms.length+1)); if(!name?.trim())return;
  const n=name.trim(); if(loc.rooms.some(id=>{const r=state.rooms.find(x=>x.id===id);return r&&catalogNormalize(r.name)===catalogNormalize(n)})){toast('Essa sala já existe nessa localização.');return;}
  const base={rackUnits:state.rackUnits,rackWidth:state.rackWidth,rackGap:state.rackGap,rackDepth:state.rackDepth,defaultRowGap:state.defaultRowGap,lastUToTray:state.lastUToTray,defaultSlack:state.defaultSlack,rows:[],racks:[],cables:[],trays:[],trayLinks:[],trayRackLinks:[],structureLocked:false,snapToEdges:true};
  const room={id:uid('room'),name:n,locationId:loc.id,data:base,updatedAt:new Date().toISOString()}; state.rooms.push(room); loc.rooms.push(room.id); save(); renderAssetCatalogs(); updateRoomUI(); toast('Sala criada');
}
function renameAssetRoom(roomId){
  const room=state.rooms.find(r=>r.id===roomId); if(!room)return; const name=prompt('Novo nome da sala:',room.name); if(!name?.trim())return; const loc=state.locations.find(l=>l.id===room.locationId); if(loc&&loc.rooms.some(id=>id!==room.id)){const dup=loc.rooms.some(id=>{const r=state.rooms.find(x=>x.id===id);return r&&r.id!==room.id&&catalogNormalize(r.name)===catalogNormalize(name)});if(dup){toast('Essa sala já existe nessa localização.');return;}}
  room.name=name.trim();room.updatedAt=new Date().toISOString();save();renderAssetCatalogs();updateRoomUI();toast('Sala atualizada');
}
function deleteAssetRoom(roomId){
  const room=state.rooms.find(r=>r.id===roomId);if(!room)return;
  if(state.rooms.length<=1){toast('O projeto precisa ter pelo menos uma sala.');return;}
  if(state.assets.some(a=>a.roomId===roomId)){toast('Esta sala está sendo usada por assets.');return;}
  if(!confirm(`Excluir a sala "${room.name}"?\n\nRacks, calhas e cabos desta sala serão excluídos.`))return;
  const idx=state.rooms.findIndex(r=>r.id===roomId); if(idx<0)return; const loc=state.locations.find(l=>l.id===room.locationId); if(loc)loc.rooms=loc.rooms.filter(id=>id!==roomId); state.rooms.splice(idx,1); if(state.activeRoomId===roomId){state.activeRoomId=loc?.rooms?.map(id=>state.rooms.find(r=>r.id===id)).find(Boolean)?.id||state.rooms[0].id;applyRoomData(state.rooms.find(r=>r.id===state.activeRoomId).data);}
  save();renderAssetCatalogs();updateRoomUI();renderAll(false);toast('Sala excluída');
}
function addAssetLocation(){normalizeLocations();const name=prompt('Nome do Data Center/localização:','DC AZ2');if(!name?.trim())return;const n=name.trim();if(state.locations.some(l=>catalogNormalize(l.name)===catalogNormalize(n))){toast('Essa localização já existe.');return;}state.locations.push({id:uid('loc'),name:n,rooms:[],stocks:[{id:uid('stock'),name:'Estoque Principal'}]});save();renderAssetCatalogs();toast('Localização criada');}
function renameAssetLocation(id){const l=state.locations.find(x=>x.id===id);if(!l)return;const name=prompt('Novo nome da localização:',l.name);if(!name?.trim())return;l.name=name.trim();save();renderAssetCatalogs();renderAssetsList();}
function deleteAssetLocation(id){
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
  if(!confirm(`Excluir o Data Center \"${loc.name}\"?\n\n${detail.join(' · ')} serão removidos.`))return;
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
function addAssetStock(locationId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const name=prompt(`Nome do estoque em ${l.name}:`,'Estoque '+(l.stocks.length+1));if(!name?.trim())return;const n=name.trim();if(l.stocks.some(s=>catalogNormalize(s.name)===catalogNormalize(n))){toast('Esse estoque já existe nessa localização.');return;}l.stocks.push({id:uid('stock'),name:n});save();renderAssetCatalogs();toast('Estoque criado');}
function renameAssetStock(locationId,stockId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const st=l.stocks.find(x=>x.id===stockId);if(!st)return;const name=prompt(`Novo nome do estoque em ${l.name}:`,st.name);if(!name?.trim())return;const n=name.trim();if(l.stocks.some(s=>s.id!==stockId&&catalogNormalize(s.name)===catalogNormalize(n))){toast('Esse estoque já existe nessa localização.');return;}st.name=n;save();renderAssetCatalogs();renderAssetsList($('assetsSearch')?.value||'');renderAssetCatalogSelects();toast('Estoque atualizado');}
function deleteAssetStock(locationId,stockId){const l=state.locations.find(x=>x.id===locationId);if(!l)return;const st=l.stocks.find(x=>x.id===stockId);if(!st)return;if(state.assets.some(a=>a.locationId===locationId&&a.stockId===stockId)){toast('Este estoque está sendo usado por assets.');return;}if(!confirm(`Excluir o estoque "${st.name}"?`))return;l.stocks=l.stocks.filter(x=>x.id!==stockId);if(!l.stocks.length)l.stocks.push({id:uid('stock'),name:'Estoque Principal'});save();renderAssetCatalogs();}
function openAssetCatalogModal(){normalizeAssetCatalogs();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();const m=$('assetCatalogModal');if(!m)return;m.classList.remove('locations-only');$('assetCatalogTitle').textContent='Catálogo de equipamentos';m.querySelector('.catalog-modal-head span').textContent='Gerencie tipos, fabricantes, modelos, status e substatus usados no inventário.';m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
function openLocationsModal(){normalizeLocations();renderAssetCatalogs();const m=$('assetCatalogModal');if(!m)return;m.classList.add('locations-only');$('assetCatalogTitle').textContent='Localizações';m.querySelector('.catalog-modal-head span').textContent='Gerencie Data Centers, salas e estoques.';m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
function closeAssetCatalogModal(){const m=$('assetCatalogModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');closeCatalogEditor();}
function renderAssetCatalogManufacturerSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelManufacturer');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os fabricantes</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.manufacturers.includes(current)?current:'';
}
function renderAssetCatalogTypeSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelType');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os tipos</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.types.includes(current)?current:'';
}
function addCatalogItem(key){openCatalogEditor(key);}
function openCatalogEditor(key,id=null){
  normalizeAssetCatalogs(); const m=$('catalogEditorModal'); if(!m)return;
  $('catalogEditorKind').value=key; $('catalogEditorId').value=id||'';
  const title=$('catalogEditorTitle'), subtitle=$('catalogEditorSubtitle'), typeWrap=$('catalogEditorTypeWrap'), manWrap=$('catalogEditorManufacturerWrap');
  const isModel=key==='models';
  const isStatus=key==='statuses';
  let item=null;
  if(id){item=isModel?state.assetCatalogs.models.find(x=>x.id===id):state.assetCatalogs[key]?.[Number(id)];}
  title.textContent=id?(isModel?'Editar modelo':`Editar ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`):(isModel?'Novo modelo':`Novo ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`);
  subtitle.textContent=isModel?'Defina o tipo e o fabricante ao qual este modelo pertence.':'Cadastre um valor que poderá ser usado no inventário.';
  $('catalogEditorName').value=isModel?(item?.name||''):(item||'');
  typeWrap.classList.toggle('hidden',!isModel);manWrap.classList.toggle('hidden',!isModel);
  if(isModel){
    $('catalogEditorType').innerHTML=state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorManufacturer').innerHTML='<option value="">Selecione o fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorType').value=item?.type||state.assetCatalogs.types[0]||'';
    $('catalogEditorManufacturer').value=item?.manufacturer||'';
  }
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='1200';requestAnimationFrame(()=>$('catalogEditorName')?.focus());
}
function closeCatalogEditor(){const m=$('catalogEditorModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function saveCatalogEditor(){
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
    if(similar.length&&!confirm(`Possível modelo duplicado: ${similar[0]}\n\nNovo: ${name}\nJá cadastrado: ${similar[0]}\n\nDeseja continuar mesmo assim?`))return;
    let savedModel=null;
    if(id){const m=state.assetCatalogs.models.find(x=>x.id===id);if(!m)return;m.name=name;m.type=type;m.manufacturer=manufacturer;savedModel=m;}
    else {savedModel={id:uid('model'),name,type,manufacturer};state.assetCatalogs.models.push(savedModel);}
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
    if(similar&&!confirm(`Possível duplicidade encontrada.\n\nNovo: ${name}\nJá cadastrado: ${similar}\n\nDeseja continuar mesmo assim?`))return;
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
function editCatalogItem(key,index){openCatalogEditor(key,index);}
function deleteCatalogItem(key,index){
  normalizeAssetCatalogs();const arr=state.assetCatalogs[key]||[], value=arr[Number(index)];if(value===undefined)return;
  if(key==='types'&&DEFAULT_ASSET_TYPES.includes(value)){toast('Os tipos padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='statuses'&&DEFAULT_ASSET_STATUSES.includes(value)){toast('Os status padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='substatuses'&&DEFAULT_ASSET_SUBSTATUSES.includes(value)){toast('Os substatus padrão não podem ser removidos. Você pode editá-los.');return;}
  if(key==='statuses'&&state.assets.some(a=>String(a.status||'')===value)){toast('Este status está sendo usado por assets. Altere os assets antes de excluí-lo.');return;}
  if(key==='manufacturers'&&state.assetCatalogs.models.some(m=>m.manufacturer===value)){toast('Este fabricante possui modelos vinculados. Exclua ou reatribua esses modelos antes.');return;}
  if(!confirm(`Excluir o cadastro "${value}"?\n\nAssets existentes que usam esse valor não serão alterados.`))return;arr.splice(Number(index),1);save();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();toast('Cadastro excluído');
}
function deleteModelCatalogItem(id){
  normalizeAssetCatalogs();const m=state.assetCatalogs.models.find(x=>x.id===id);if(!m)return;if(!confirm(`Excluir o modelo "${m.name}" do fabricante "${m.manufacturer}"?`))return;state.assetCatalogs.models=state.assetCatalogs.models.filter(x=>x.id!==id);save();renderAssetCatalogs();renderAssetCatalogSelects();toast('Modelo excluído');
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
    id:a.id,name:String(a.name||'Equipamento'),type:String(a.type||'Equipamento'),manufacturer:String(a.manufacturer||''),model:String(a.model||''),assetTag:String(a.assetTag||''),serial:String(a.serial||''),locationType:a.locationType||(a.roomId?'room':'stock'),locationName:String(a.locationName||((a.roomId&&state.rooms?.find(r=>r.id===a.roomId)?.name)||(!a.roomId?'Estoque':''))),roomId:a.roomId||null,rackId:a.rackId||null,uStart:Math.max(1,Math.floor(num(a.uStart,1))),uHeight:Math.max(1,Math.floor(num(a.uHeight,1))),status:String(a.status||'Instalado'),substatus:String(a.substatus||''),locationId:a.locationId||null,stockId:a.stockId||null
  }));
}
function assetLocationOptions(selected=''){
  const rooms=(state.rooms||[]).map(r=>({value:'room:'+r.id,label:r.name}));
  const opts=[...rooms,{value:'stock:default',label:'Estoque'}];
  return '<option value="">Selecione a localização</option>'+opts.map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join('');
}
function refreshAssetRackOptions(selected=''){
  const loc=$('assetLocation')?.value||''; const sel=$('assetRack'); if(!sel)return;
  const roomId=loc.startsWith('room:')?loc.slice(5):null;
  const room=roomId?(state.rooms||[]).find(r=>r.id===roomId):null;
  const racks=room?(room.data?.racks||[]):[];
  sel.innerHTML='<option value="">Sem rack</option>'+racks.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
  sel.value=racks.some(r=>r.id===selected)?selected:'';
  const hasRack=!!sel.value; ['assetUStart','assetUHeight'].forEach(id=>{const el=$(id);if(el){el.disabled=!hasRack;el.closest('label')?.classList.toggle('muted-field',!hasRack);}});
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
  $('assetUStart').value=asset?.uStart||uStart||1;
  $('assetUHeight').value=asset?.uHeight||1;
  $('assetStatus').value=asset?.status||'Instalado'; $('assetSubstatus').value=asset?.substatus||'';
  $('assetEditModal').classList.add('open');$('assetEditModal').classList.remove('hidden');$('assetEditModal').setAttribute('aria-hidden','false');$('assetEditModal').style.zIndex='320';requestAnimationFrame(()=>$('assetName')?.focus());
}
function closeAssetModal(){const m=$('assetEditModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function saveAssetForm(){
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
  const locVal=$('assetLocation').value||''; const stockParts=locVal.startsWith('stock:')?locVal.split(':'):null; const finalLocationId=stockParts?.[1]||roomObj?.locationId||state.locations?.[0]?.id||null; const finalStockId=stockParts?.[2]||null; const asset={id:id||uid('asset'),name,type:$('assetType').value||'Equipamento',manufacturer:$('assetManufacturer').value.trim(),model:$('assetModel').value.trim(),assetTag:$('assetTag').value.trim(),serial,locationType,locationName:locationType==='stock'?'Estoque':(roomObj?.name||''),locationId:finalLocationId,stockId:finalStockId,roomId:locationRoomId,rackId,uStart,uHeight,status:$('assetStatus').value||'Instalado',substatus:$('assetSubstatus').value||''};
  if(assetConflicts(asset,id||null)){toast('Não é possível: existe outro equipamento ocupando uma ou mais U.');return;}
  const before=existingAsset?cloneData(existingAsset):null;
  const old=state.assets.findIndex(a=>a.id===asset.id);
  const changes=old>=0?assetLogDiff(before,asset):[];
  if(old>=0)state.assets[old]=asset;else state.assets.push(asset);
  const bayRack=$('bayfaceModal')?.classList.contains('open')?$('bayfaceModal').dataset.rackId:null; closeAssetModal(); save(); renderAll(false); renderAssetsList(); if(state.selected?.type==='rack')renderProperties(); if(bayRack)renderBayface(bayRack);
  recordAssetAudit({action:old>=0?'UPDATE':'CREATE',asset,before,after:asset,changes});
  toast(old>=0?'Asset atualizado':'Asset criado');
}

function archiveAsset(assetId){
  const a=state.assets.find(x=>x.id===assetId);if(!a)return;
  if(isAssetArchived(a)){ toast('Este asset já está arquivado.'); return; }
  if(!confirm(`Arquivar o asset "${a.name}"?\n\nEle continuará no inventário, mas deixará de aparecer no Bayface.`))return;
  const before=cloneData(a); a.status='Arquivado'; const after=cloneData(a); const changes=assetLogDiff(before,after);
  save(); renderAll(false); renderAssetsList($('assetsSearch')?.value||'');
  recordAssetAudit({action:'UPDATE',asset:a,before,after,changes});
  if($('bayfaceModal')?.classList.contains('open'))renderBayface(a.rackId); toast('Asset arquivado');
}
function deleteAsset(assetId){
  const a=state.assets.find(x=>x.id===assetId);if(!a)return;
  const password=prompt('Exclusão permanente\n\nDigite a senha para confirmar:');
  if(password===null)return;
  if(password!=='TESTE'){toast('Senha incorreta. O asset não foi excluído.');return;}
  if(!confirm(`Excluir PERMANENTEMENTE o asset "${a.name}"?\n\nEsta ação não pode ser desfeita.`))return;
  const snapshot=cloneData(a);
  state.assets=state.assets.filter(x=>x.id!==assetId);save();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');
  recordAssetAudit({action:'DELETE',asset:snapshot,before:snapshot,after:null,changes:[]});
  if($('bayfaceModal')?.classList.contains('open'))renderBayface(a.rackId);toast('Asset excluído permanentemente');
}
function locateAsset(assetId){const a=state.assets.find(x=>x.id===assetId);if(!a)return;if(a.roomId&&a.roomId!==state.activeRoomId)switchRoom(a.roomId);if(a.rackId){state.selected={type:'rack',id:a.rackId};state.multiSelected=[a.rackId];state.trayMultiSelected=[];closeAssetsModal();closeBayface();renderAll(false);openBayface(a.rackId);}}
function renderAssetsList(filter=''){
  normalizeLocations(); normalizeAssets(); const wrap=$('assetsList');if(!wrap)return; const q=String(filter||'').toLowerCase().trim();
  const items=state.assets.filter(a=>{const room=assetRoom(a);return !q||[a.name,a.type,a.manufacturer,a.model,a.assetTag,a.serial,a.locationName||'',room?.name||'',assetRack(a.rackId)?.name||''].join(' ').toLowerCase().includes(q);});
  $('assetsCount').textContent=String(items.length); if($('assetsActiveCount'))$('assetsActiveCount').textContent=String(items.filter(a=>!isAssetArchived(a)).length); if($('assetsArchivedCount'))$('assetsArchivedCount').textContent=String(items.filter(isAssetArchived).length);
  wrap.innerHTML=items.length?items.map(a=>{const r=assetRack(a.rackId),u=assetOccupancy(a);return `<div class="asset-row ${isAssetArchived(a)?'asset-archived':''}"><div class="asset-cell"><strong>${esc(a.assetTag||'—')}</strong></div><div class="asset-cell">${esc(a.name)}</div><div class="asset-cell">${esc(a.type)}</div><div class="asset-cell">${esc(a.manufacturer||'—')}</div><div class="asset-cell">${esc(a.model||'—')}</div><div class="asset-cell">${esc(a.serial||'—')}</div><div class="asset-cell">${esc(assetLocationLabel(a))}</div><div class="asset-cell">${esc(r?.name||'Sem rack')}</div><div class="asset-cell">${r?`U${u.start}${u.end!==u.start?'–U'+u.end:''}`:'—'}</div><div class="asset-cell">${r?esc(String(a.uHeight||1)+'U'):'—'}</div><div class="asset-cell"><span class="asset-status ${isAssetArchived(a)?'archived':''}">${esc(a.status||'—')}</span></div><div class="asset-cell">${esc(a.substatus||'—')}</div><div class="asset-actions"><button class="iconbtn" type="button" data-asset-locate="${esc(a.id)}" title="Localizar no rack">⌖</button><button class="iconbtn" type="button" data-asset-edit="${esc(a.id)}" title="Editar asset">✎</button><button class="iconbtn" type="button" data-asset-history="${esc(a.id)}" title="Histórico">↺</button><button class="iconbtn" type="button" data-asset-archive="${esc(a.id)}" title="Arquivar asset">▣</button><button class="iconbtn danger-icon" type="button" data-asset-delete="${esc(a.id)}" title="Excluir permanentemente">×</button></div></div>`}).join(''):'<div class="empty">Nenhum asset encontrado.</div>';
  wrap.querySelectorAll('[data-asset-locate]').forEach(b=>b.onclick=()=>locateAsset(b.dataset.assetLocate));
  wrap.querySelectorAll('[data-asset-edit]').forEach(b=>b.onclick=()=>openAssetModal(b.dataset.assetEdit));
  wrap.querySelectorAll('[data-asset-history]').forEach(b=>b.onclick=()=>openAssetHistory(b.dataset.assetHistory));
  wrap.querySelectorAll('[data-asset-archive]').forEach(b=>b.onclick=()=>archiveAsset(b.dataset.assetArchive));
  wrap.querySelectorAll('[data-asset-delete]').forEach(b=>b.onclick=()=>deleteAsset(b.dataset.assetDelete));
}
function openAssetsModal(){const m=$('assetsModal');if(!m)return;closeAssetModal();closeAssetCatalogModal();m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');$('assetsSearch').value='';renderAssetsList();}
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
  const availableH=Math.max(620,Math.floor(window.innerHeight-95));
  const targetGridH=Math.max(700,Math.min(920,availableH));
  const rowH=Math.max(17,Math.min(22,Math.floor(targetGridH/units)));
  const gridH=units*rowH;
  let rows='';
  for(let u=units;u>=1;u--){
    const occupied=occupiedUnits.has(u);
    rows+=`<button type="button" class="bayface-u ${occupied?'occupied':''}" data-bay-add-u="${u}" ${occupied?'disabled':''}><span class="bayface-u-num left">${u}</span><span class="bayface-u-slot"></span><span class="bayface-u-num right">${u}</span></button>`;
  }
  const assetLayer=assets.map(a=>{
    const o=assetOccupancy(a);
    const clampedStart=Math.max(1,Math.min(units,o.start));
    const end=Math.min(units,o.end);
    const span=Math.max(1,end-clampedStart+1);
    const top=(units-end)*rowH+1;
    const h=Math.max(1,span*rowH-2);
    const typeClass=bayfaceAssetTypeClass(a.type);
    const name=String(a.name||a.assetTag||a.type||'Equipamento');
    const model=String(a.model||'');
    const manufacturer=String(a.manufacturer||'');
    const identity=[name,model,manufacturer].filter(Boolean).join(' — ');
    const tooltip=[identity,a.assetTag,a.serial].filter(Boolean).join(' · ');
    const heightLabel=span===1?'1U':`${span}U`;
    const compact=span===1;
    return `<button type="button" class="bayface-asset ${typeClass} ${compact?'is-compact':''}" style="top:${top}px;height:${h}px" data-bay-edit="${esc(a.id)}" title="${esc(tooltip)} · U${clampedStart}${span>1?`–U${end}`:''}">
      <span class="bayface-asset-body"><b>${esc(identity)}</b></span>
      <span class="bayface-asset-u">${heightLabel}</span>
    </button>`;
  }).join('');
  const rail=Array.from({length:Math.min(8,Math.max(4,Math.floor(units/6)))},(_,i)=>`<span style="left:${6+i*12}%"></span>`).join('');
  return `<div class="bayface-wrap">
    <div class="bayface-head">
      <div class="bayface-title-block"><strong>${esc(r.name)} <i>–</i> ${units}U · ${assets.length} asset${assets.length===1?'':'s'} · ${usedUnits}U ocupadas · ${freeUnits}U livres</strong></div>
    </div>
    <div class="bayface-stage">
      <div class="bayface-rack" style="--bayface-row-h:${rowH}px;--bayface-grid-h:${gridH}px">
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
    </div>
  </div>`;
}
function openBayface(rackId){const r=assetRack(rackId);if(!r)return;const m=$('bayfaceModal');if(!m)return;m.style.zIndex='1100';$('bayfaceTitle').textContent=`Bayface — ${r.name}`;$('bayfaceContent').innerHTML=bayfaceMarkup(rackId);m.dataset.rackId=rackId;m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.querySelectorAll('[data-bay-edit]').forEach(b=>b.addEventListener('click',()=>openAssetModal(b.dataset.bayEdit)));m.querySelectorAll('[data-bay-add-u]').forEach(b=>b.addEventListener('click',()=>{if(b.disabled||b.classList.contains('occupied'))return;openBayfaceAssetPicker(rackId,Number(b.dataset.bayAddU));}));}
function renderBayface(rackId){openBayface(rackId);}
function closeBayface(){closeBayfaceAssetPicker();const m=$('bayfaceModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

function openRackBayface(rackId){if(!assetRack(rackId))return;openBayface(rackId);}

function renderProperties(){
  const p=$('properties');
  if(state.trayMultiSelected.length>1){
    const count=state.trayMultiSelected.length;
    p.innerHTML=`<div class="prop-title">${count} calhas selecionadas</div>
      <div class="help">Várias calhas selecionadas. Para evitar alterações acidentais na geometria e nas conexões, somente a exclusão em lote está disponível.</div>
      <button class="btn danger full" id="delSelectedTrays">Excluir ${count} calhas selecionadas</button>
      <button class="btn ghost full" id="clearSelectedTrays">Limpar seleção</button>`;
    $('delSelectedTrays').onclick=deleteSelectedTrays;
    $('clearSelectedTrays').onclick=()=>{state.trayMultiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(state.multiSelected.length>1){
    const count=state.multiSelected.length;
    p.innerHTML=`<div class="prop-title">${count} racks selecionados</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. As propriedades dos racks estão somente para consulta.</div>':''}
      <div class="help">As propriedades abaixo serão aplicadas a todos os racks selecionados. Deixe um campo vazio para não alterá-lo. Largura e profundidade mantêm cada rack centrado.</div>
      <div class="grid2"><label>Qtd. U<input id="bulkUnits" type="number" min="1" max="60" placeholder="Não alterar"></label><label>Largura (m)<input id="bulkWidth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="bulkDepth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label><label>Distância até o próximo (m)<input id="bulkGap" type="number" min="0" step="0.01" placeholder="Não alterar"></label></div>
      <label>Altura da última U → calha (m)<input id="bulkRise" type="number" min="0" step="0.01" placeholder="Não alterar"></label>
      <button class="btn primary full" id="applyBulkRack">✓ Aplicar propriedades</button>
      <button class="btn danger full" id="delSelectedRacks">Excluir ${count} racks selecionados</button>
      <button class="btn ghost full" id="clearSelectedRacks">Limpar seleção</button>`;
    $('applyBulkRack').onclick=()=>{if(structureBlocked())return;
      const ids=new Set(state.multiSelected);
      const unitsVal=$('bulkUnits').value.trim(), widthVal=$('bulkWidth').value.trim(), depthVal=$('bulkDepth').value.trim(), gapVal=$('bulkGap').value.trim(), riseVal=$('bulkRise').value.trim();
      if(!unitsVal&&!widthVal&&!depthVal&&!gapVal&&!riseVal){toast('Informe pelo menos uma propriedade');return;}
      state.racks.filter(r=>ids.has(r.id)).forEach(r=>{
        if(unitsVal){r.units=Math.max(1,Math.min(60,Math.floor(num(unitsVal,r.units))));}
        if(widthVal){const old=Math.max(.1,num(r.width,state.rackWidth)),next=Math.max(.1,num(widthVal,state.rackWidth));r.offset=num(r.offset,0)+(old-next)/2;r.width=next;}
        if(depthVal){const old=Math.max(.1,num(r.depth,state.rackDepth)),next=Math.max(.1,num(depthVal,state.rackDepth));r.yOffset=num(r.yOffset,0)+(old-next)/2;r.depth=next;}
        if(gapVal){r.gapAfter=Math.max(0,num(gapVal,r.gapAfter??state.rackGap));}
        if(riseVal){r.riseToTray=Math.max(0,num(riseVal,r.riseToTray??state.lastUToTray));}
      });
      refreshVisuals();renderProperties();toast(`${count} racks atualizados`);
    };
    $('delSelectedRacks').onclick=()=>{if(!structureBlocked())deleteSelectedRacks();};
    $('clearSelectedRacks').onclick=()=>{state.multiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(!state.selected){p.innerHTML='<div class="empty">Selecione um rack, calha ou cabo.</div>';return;}
  if(state.selected.type==='rack'){
    const r=state.racks.find(x=>x.id===state.selected.id); if(!r){state.selected=null;return renderProperties();}
    const row=rowForRack(r);
    p.innerHTML=`<div class="prop-title">${esc(r.name)}</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar este rack.</div>':''}
      <label>Nome<input id="prName" value="${esc(r.name)}"></label>
      <div class="grid2"><label>Qtd. U<input id="prUnits" type="number" min="1" max="60" value="${r.units}"></label><label>Largura (m)<input id="prWidth" type="number" min="0.1" step="0.01" value="${r.width}"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="prDepth" type="number" min="0.1" step="0.01" value="${r.depth??state.rackDepth}"></label><label>Distância até o próximo (m)<input id="prGapAfter" type="number" min="0" step="0.01" value="${r.gapAfter??state.rackGap}"></label></div>
      <label>Altura da última U → calha (m)<input id="prRiseToTray" type="number" min="0" step="0.01" value="${num(r.riseToTray,state.lastUToTray).toFixed(2)}"></label>
      <div class="help">A distância acima é específica deste rack e vale para o espaço até o próximo rack da mesma fileira. A altura até a calha também é individual e será usada no cálculo dos cabos deste rack.</div>
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
    if($('openBayface'))$('openBayface').onclick=()=>openRackBayface(r.id);
    if($('delRack'))$('delRack').onclick=()=>{if(structureBlocked())return;
      if(!confirm(`Excluir o rack ${r.name||''}?`))return;
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
    p.innerHTML=`<div class="prop-title">${esc(t.name||'Calha')}</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar esta calha.</div>':''}
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

function renderCableProperties(p,c){
  if(!c){p.innerHTML='<div class="empty">Cabo não encontrado.</div>';return;}
  const opts=state.racks.map(r=>`<option value="${r.id}">${esc(rowForRack(r)?.name||'')} / ${esc(r.name)} (${Math.floor(num(r.units,state.rackUnits))}U)</option>`).join('');
  const v=cableUnitValidation(c);
  const o=v.origin,d=v.dest;
  const ouMax=o?Math.floor(num(o.units,state.rackUnits)):1, duMax=d?Math.floor(num(d.units,state.rackUnits)):1;
  const ouInvalid=!o||Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ouMax;
  const duInvalid=!d||Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>duMax;
  p.innerHTML=`<div class="prop-title">${esc(c.name)}</div><label>Nome<input id="cbName" value="${esc(c.name)}"></label>
  <label>Tipo<select id="cbType">${CABLE_TYPES.map(t=>`<option value="${esc(t)}" ${c.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
  <div class="grid2"><label>Rack origem<select id="cbOR">${opts}</select></label><label>U origem<input id="cbOU" class="${ouInvalid?'input-error':''}" type="number" min="1" max="${ouMax}" value="${c.originU}"><small id="cbOUError" class="field-error">${ouInvalid?`Máximo: ${ouMax}U.`:''}</small></label></div>
  <div class="grid2"><label>Rack destino<select id="cbDR">${opts}</select></label><label>U destino<input id="cbDU" class="${duInvalid?'input-error':''}" type="number" min="1" max="${duMax}" value="${c.destU}"><small id="cbDUError" class="field-error">${duInvalid?`Máximo: ${duMax}U.`:''}</small></label></div>
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
  $('cbOR').onchange=()=>{c.originRack=$('cbOR').value;sync();};
  $('cbDR').onchange=()=>{c.destRack=$('cbDR').value;sync();};
  $('cbOU').oninput=()=>{c.originU=Math.floor(num($('cbOU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();};
  $('cbDU').oninput=()=>{c.destU=Math.floor(num($('cbDU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();};
  $('cbOU').onchange=()=>{renderProperties();};
  $('cbDU').onchange=()=>{renderProperties();};
  $('routeMode').onchange=()=>{c.routeMode=$('routeMode').value; if(c.routeMode==='automatic'){c.via=[];window.__manualRoutePicking=false;} refreshVisuals();renderProperties();};
  bindManualRouteControls(c);
  $('cbSlack').onchange=()=>{c.slack=Math.max(0,num($('cbSlack').value,0));refreshVisuals();renderProperties();};
  $('cbName').onchange=()=>{c.name=$('cbName').value.trim()||c.name;refreshVisuals();renderProperties();};
  $('delCable').onclick=()=>{state.cables=state.cables.filter(x=>x.id!==c.id);state.selected=null;window.__manualRoutePicking=false;renderAll();toast('Cabo removido');};
   updateCableResult(c);
}
function renderViaList(c){const el=$('viaList');if(!el)return;el.innerHTML='';(c.via||[]).forEach((id,i)=>{const d=document.createElement('div');d.className='route-node';d.innerHTML=`<select data-via="${i}">${state.racks.map(r=>`<option value="${r.id}" ${r.id===id?'selected':''}>${esc(rowForRack(r)?.name||'')} / ${esc(r.name)}</option>`).join('')}</select><button class="btn small danger" data-via-del="${i}">×</button>`;el.appendChild(d);});el.querySelectorAll('[data-via]').forEach(s=>s.onchange=()=>{c.via[+s.dataset.via]=s.value;refreshVisuals();renderProperties();});el.querySelectorAll('[data-via-del]').forEach(b=>b.onclick=()=>{c.via.splice(+b.dataset.viaDel,1);refreshVisuals();renderProperties();});}
function updateCableResult(c){const el=$('cableResult');if(!el)return;const validation=cableUnitValidation(c);if(!validation.valid){el.innerHTML='<div class="validation-error">⚠ '+validation.errors.map(esc).join('<br>')+'</div>';return;}const res=calcCable(c);const rounded=res.reachable?Math.ceil(res.total):0;el.innerHTML=`<div class="metric"><span>Vertical origem</span><b>${res.v1.toFixed(2)} m</b></div><div class="metric"><span>Trecho pelas calhas</span><b>${res.tray.toFixed(2)} m</b></div><div class="metric"><span>Vertical destino</span><b>${res.v2.toFixed(2)} m</b></div><div class="metric"><span>Conexões</span><b>${res.connection.toFixed(2)} m</b></div><div class="metric"><span>Base</span><b>${res.base.toFixed(2)} m</b></div><div class="metric"><span>Folga ${c.slack??state.defaultSlack}%</span><b>${res.slack.toFixed(2)} m</b></div><div class="metric"><span>Total</span><b>${res.total.toFixed(2)} m</b></div><div class="metric total-rounded"><span>Total arredondado para cima</span><b>${res.reachable?rounded:'—'} m</b></div>${res.reachable?'':'<div class="unreachable">Não existe rota pelas calhas cadastradas.</div>'}`;}

// ---------- Graph / shortest route ----------
// Infrastructure-first: only tray connection points are cross-row nodes. Intermediate racks are not waypoints.
function rowSlotX(row,index){return physicalPointOnRow(row,index,null);}
function rackIntervalOnRow(r){const row=rowForRack(r);if(!row)return null;const x=physicalPointOnRow(row,r.index,null);const w=slotPhysicalWidth(row,r.index);return {left:x,right:x+w};}
function rackEdgeDistance(a,b){
  if(a.rowId!==b.rowId)return Infinity;
  const ia=rackIntervalOnRow(a),ib=rackIntervalOnRow(b);if(!ia||!ib)return Infinity;
  if(ia.right<=ib.left)return Math.max(0,ib.left-ia.right);
  if(ib.right<=ia.left)return Math.max(0,ia.left-ib.right);
  return 0;
}
function rowPointDistance(a,b){return rackEdgeDistance(a,b);}
function sameRowDistance(a,b){return a.rowId===b.rowId?rowPointDistance(a,b):Infinity;}
function rowGapBetween(ra,rb){if(ra===rb)return 0;let d=0;const lo=Math.min(ra,rb),hi=Math.max(ra,rb);for(let i=lo+1;i<=hi;i++)d+=Math.max(0,num(state.rows[i]?.gap,0));return d;}
function rackCableRiseMeters(r,u,tray){
  const units=Math.max(1,num(r.units,state.rackUnits));
  const usedU=Math.max(1,Math.min(units,Math.floor(num(u,1))));
  // The vertical leg belongs exclusively to the rack. The tray has no
  // height-to-U property; each rack carries its own riseToTray value.
  const rise = Number.isFinite(Number(r.riseToTray)) ? Number(r.riseToTray) : num(state.lastUToTray,1);
  return Math.max(0,(units-usedU)*(U_MM/1000)) + Math.max(0,rise);
}
function ensureInfrastructureJunctions(){
  // Rebuild any valid crossing junctions before calculating a cable. This is
  // intentionally NOT called while a tray is being dragged. A tray only
  // participates in automatic crossings when both of its endpoints are
  // already connected to a valid destination (rack or tray).
  state.trays.forEach(t=>{
    if(trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1)){
      connectCrossingsForTray(t.id);
    }
  });
}
function buildRouteGraph(c){
  // Infrastructure-only graph. Crossings are derived from the current geometry
  // at calculation time, but ONLY between trays whose two endpoints are already
  // connected (to racks or to other trays). This keeps dragging non-destructive
  // while guaranteeing that valid cross-row intersections are recognized.
  ensureInfrastructureJunctions();
  const nodes=new Map(),edges=new Map();
  const addNode=(id,n)=>{if(!nodes.has(id)){nodes.set(id,n);edges.set(id,[]);}};
  const connect=(a,b,cost)=>{
    if(!Number.isFinite(cost)||cost<0)return;
    if(!nodes.has(a)||!nodes.has(b))return;
    edges.get(a).push({id:b,cost});edges.get(b).push({id:a,cost});
  };
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return null;
  const oid=`rack:${o.id}`,did=`rack:${d.id}`;
  addNode(oid,{kind:'rack',rack:o,role:'origin'});
  addNode(did,{kind:'rack',rack:d,role:'dest'});
  const g=geometry();
  syncAttachedTrayEndpoints(g);

  // Build a complete, current set of junction/access parameters for each tray.
  // A junction may come from an explicit endpoint link or from a valid crossing.
  const complete= t => trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1);
  const trayPoints=new Map();
  const crossingPairs=[];
  state.trays.forEach(t=>trayPoints.set(t.id,[]));

  // Explicit tray-to-tray links (including endpoint-to-endpoint snaps).
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray), b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    trayPoints.get(a.id).push({t:at,kind:'link',linkKey:`${i}:a`});
    trayPoints.get(b.id).push({t:bt,kind:'link',linkKey:`${i}:b`});
  });

  // Origin/destination: only an explicit physical rack connection is valid.
  // The route must start/end at the connection the user created, rather than
  // silently choosing a rack edge or the rack center.
  const explicitRackLinksByRack=new Map();
  state.trayRackLinks.forEach((l,i)=>{
    const t=state.trays.find(x=>x.id===l.trayId),r=state.racks.find(x=>x.id===l.rackId);
    if(!t||!r)return;
    if(r.id!==o.id&&r.id!==d.id)return;
    const arr=explicitRackLinksByRack.get(r.id)||[];
    arr.push({t,numEnd:Number(l.end),link:l,tray:t,linkKey:`rack:${i}`});
    explicitRackLinksByRack.set(r.id,arr);
    trayPoints.get(t.id).push({t:num(l.end,0),kind:'rack',rack:r,explicit:true,linkKey:`rack:${i}`});
  });

  // Intermediate racks are NOT connection points for the cable. They are
  // reference waypoints only and use the physical center of the rack. This
  // lets a same-row tray crossing a rack be understood geometrically without
  // requiring a user-created snap on that intermediate rack.
  const intermediateRacks=state.racks.filter(r=>r.id!==o.id&&r.id!==d.id);
  intermediateRacks.forEach(r=>{
    const row=rowForRack(r),q=rackRect(r,g);
    if(!row||!q)return;
    const cx=q.x+q.w/2,cy=q.y+q.h/2;
    state.trays.forEach(t=>{
      const hit=nearestPointOnSegment(cx,cy,num(t.x1),num(t.y1),num(t.x2),num(t.y2));
      if(hit.d>Math.max(10,g.scale*0.10))return;
      // Only same-row trays can use an intermediate rack as a geometric
      // waypoint. No vertical rise or cable termination is introduced here.
      const rowCenterYVal=rowCenterY(state.rows.indexOf(row),g);
      if(Math.abs(cy-rowCenterYVal)>Math.max(12,g.scale*0.12))return;
      trayPoints.get(t.id).push({t:hit.t,kind:'intermediate-rack',rack:r,center:true});
    });
  });

  // If an origin/destination rack has no explicit snap, infer its access
  // point from a tray that is genuinely usable for that rack's CENTER.
  // Important: do not choose a nearby vertical tray for a different rack just
  // because it is geometrically close. Prefer a tray whose axis crosses the
  // rack center; this keeps 101 -> 202 on rack 202's horizontal tray while
  // still allowing 101 -> 203 to use the vertical tray centered on 203.
  [o,d].forEach(r=>{
    if((explicitRackLinksByRack.get(r.id)||[]).length)return;
    const row=rowForRack(r),q=rackRect(r,g);
    if(!row||!q)return;
    const cx=q.x+q.w/2,cy=q.y+q.h/2;
    let best=null;
    state.trays.forEach(t=>{
      const x1=num(t.x1), y1=num(t.y1), x2=num(t.x2), y2=num(t.y2);
      const dx=x2-x1, dy=y2-y1;
      const horizontal=Math.abs(dx)>=Math.abs(dy);
      const vertical=!horizontal;
      const tolAxis=Math.max(4,g.scale*0.025);
      let eligible=false;

      if(horizontal){
        // A horizontal tray can serve the rack center when the rack center X
        // falls on the tray segment. Its Y may be above/below the rack because
        // the real rack-to-tray leg is vertical and is not part of the plan
        // view.
        const xmin=Math.min(x1,x2)-tolAxis, xmax=Math.max(x1,x2)+tolAxis;
        eligible=cx>=xmin && cx<=xmax;
      }else if(vertical){
        // A vertical tray can serve the rack center only when its X axis is
        // aligned with the rack center. This prevents the vertical tray of
        // rack 203 from being selected as the access for rack 202.
        const ymin=Math.min(y1,y2)-tolAxis, ymax=Math.max(y1,y2)+tolAxis;
        eligible=Math.abs((x1+x2)/2-cx)<=tolAxis && cy>=ymin && cy<=ymax;
      }
      if(!eligible)return;

      const hit=nearestPointOnSegment(cx,cy,x1,y1,x2,y2);
      const score=horizontal ? Math.abs(hit.x-cx)+Math.abs(hit.y-(q.y+q.h/2))*0.15 : hit.d;
      if(!best||score<best.score)best={tray:t,hit,score};
    });
    if(best){
      const t=best.tray,hit=best.hit;
      trayPoints.get(t.id).push({t:hit.t,kind:'rack',rack:r,center:true,explicit:false,fallback:true,linkKey:`center:${r.id}:${t.id}`});
    }
  });
  // A crossing becomes a real junction when at least ONE of the two trays
  // is fully connected at both endpoints. The fully connected tray is the
  // one that authorizes the junction; the other tray does NOT need both
  // endpoints connected. This matches the infrastructure rule: once the
  // tray being positioned has both ends connected (to a rack or another
  // tray), every tray it crosses becomes part of the usable network.
  for(let i=0;i<state.trays.length;i++){
    const a=state.trays[i];
    for(let j=i+1;j<state.trays.length;j++){
      const b=state.trays[j];
      if(!complete(a) && !complete(b))continue;
      const hit=segmentIntersection(
        {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
        {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
      );
      if(!hit)continue;
      const key=`${a.id}:${b.id}`;
      trayPoints.get(a.id).push({t:hit.tA,kind:'cross',crossKey:key});
      trayPoints.get(b.id).push({t:hit.tB,kind:'cross',crossKey:key});
      crossingPairs.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,key});
    }
  }

  // Add tray nodes, de-duplicate coincident parameters, then connect consecutive
  // points by the actual physical distance along that tray.
  state.trays.forEach(t=>{
    const pts=trayPoints.get(t.id)||[];
    pts.push({t:0,kind:'endpoint'}); pts.push({t:1,kind:'endpoint'});
    pts.sort((a,b)=>a.t-b.t);
    const groups=[];
    for(const pt of pts){
      const last=groups[groups.length-1];
      if(!last || Math.abs(last[0].t-pt.t)>0.000001)groups.push([pt]);
      else last.push(pt);
    }
    const ids=[];
    groups.forEach((group,gi)=>{
      const tv=group.reduce((sum,p)=>sum+p.t,0)/group.length;
      const p=trayPointAt(t,tv);
      const id=`tray:${t.id}:p:${gi}`;
      const rackPt=group.find(x=>x.kind==='rack'&&x.rack);
      addNode(id,{kind:'tray',tray:t,t:tv,x:p.x,y:p.y,access:!!rackPt,rack:rackPt?.rack||null});
      ids.push(id);
      // Same physical point on the same tray is a zero-cost alias.
      for(let k=1;k<group.length;k++){
        const alias=`tray:${t.id}:alias:${gi}:${k}`;
        addNode(alias,{kind:'alias',tray:t,t:tv,x:p.x,y:p.y});
        connect(id,alias,0);
      }
    });
    for(let i=1;i<ids.length;i++){
      const a=nodes.get(ids[i-1]),b=nodes.get(ids[i]);
      const meters=Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,g.scale);
      connect(ids[i-1],ids[i],meters);
    }
    // Connect every explicit/virtual rack access to its corresponding tray point.
    groups.forEach((group,gi)=>{
      const baseId=ids[gi];
      group.forEach((pt,k)=>{
        if(pt.kind!=='rack'||!pt.rack)return;
        // Only origin/destination racks can terminate a cable. Explicit snaps
        // use their exact physical connection point; the center fallback is
        // permitted only when no explicit connection exists for that rack.
        if(pt.rack.id!==o.id && pt.rack.id!==d.id)return;
        const isExplicit=!!pt.explicit;
        const hasExplicit=(explicitRackLinksByRack.get(pt.rack.id)||[]).length>0;
        if(!isExplicit && hasExplicit)return;
        const aid=`rack:${pt.rack.id}:access:${t.id}:${gi}:${k}`;
        addNode(aid,{kind:'tray',tray:t,t:pt.t,x:trayPointAt(t,pt.t).x,y:trayPointAt(t,pt.t).y,access:true,rack:pt.rack,explicit:isExplicit,centerFallback:!isExplicit});
        connect(baseId,aid,0);
        const u=pt.rack.id===o.id?num(c.originU,1):num(c.destU,1);
        connect(pt.rack.id===o.id?oid:did,aid,c.__routeTopologyOnly?0:rackCableRiseMeters(pt.rack,u,t));
      });
    });
  });

  // Valid crossings are zero-length junctions between the two tray graphs.
  // They are added only after both trays are fully connected.
  for(const pair of crossingPairs){
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.aTray).sort((x,y)=>Math.abs(x[1].t-pair.aT)-Math.abs(y[1].t-pair.aT));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.bTray).sort((x,y)=>Math.abs(x[1].t-pair.bT)-Math.abs(y[1].t-pair.bT));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  }

  // Explicit tray-to-tray snaps are zero-length transitions. Connect the
  // nearest graph nodes at their stored parameters; this covers endpoint snaps.
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray),b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===a.id).sort((x,y)=>Math.abs(x[1].t-at)-Math.abs(y[1].t-at));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===b.id).sort((x,y)=>Math.abs(x[1].t-bt)-Math.abs(y[1].t-bt));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  });

  return{nodes,edges,oid,did};
}
function shortestPathNodes(c){
  const g=buildRouteGraph(c);if(!g)return[];
  const{nodes,edges,oid,did}=g,dist=new Map(),prev=new Map(),used=new Set();
  for(const id of nodes.keys())dist.set(id,Infinity);
  dist.set(oid,0);
  while(used.size<nodes.size){
    let cur=null,best=Infinity;
    for(const[id,d]of dist)if(!used.has(id)&&d<best){best=d;cur=id;}
    if(cur===null)break;
    used.add(cur);if(cur===did)break;
    for(const e of edges.get(cur)||[]){const nd=best+e.cost;if(nd<dist.get(e.id)){dist.set(e.id,nd);prev.set(e.id,cur);}}
  }
  if(!Number.isFinite(dist.get(did)))return[];
  const ids=[];let cur=did;
  while(cur){ids.unshift(cur);if(cur===oid)break;cur=prev.get(cur);}
  return ids[0]===oid?ids:[];
}
function shortestPathRacks(c){const ids=shortestPathNodes(c);if(!ids.length)return[];const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);return o&&d?[o,d]:[];}
function calcSegment(a,b){return a.rowId===b.rowId?sameRowDistance(a,b):Infinity;}
function calcAutomaticTrayLength(c){
  const g=buildRouteGraph(c);if(!g)return{reachable:false,length:0,path:[]};
  const ids=shortestPathNodes(c);if(!ids.length)return{reachable:false,length:0,path:[]};
  let length=0;
  for(let i=1;i<ids.length;i++){
    const a=g.nodes.get(ids[i-1]),b=g.nodes.get(ids[i]);
    const e=(g.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
    if(e)length+=e.cost;
  }
  return{reachable:true,length,path:ids};
}
function rackUPoint(r,u,g,accessPoint){
  const q=rackRect(r,g);
  const units=Math.max(1,num(r.units,state.rackUnits));
  const uu=Math.max(1,Math.min(units,Math.floor(num(u,1))));
  // U numbering is bottom-up. Keep the access X exactly aligned with the
  // rack/tray connection point so the rack-to-tray leg is vertical.
  const x=accessPoint?.x??(q.x+q.w/2);
  const y=q.y+q.h-((uu-.5)/units)*q.h;
  return{x,y};
}
function routePointsForAutomatic(c,g){
  const ids=shortestPathNodes(c);if(!ids.length)return[];
  const graph=buildRouteGraph(c),pts=[];
  // The plan-view cable is drawn only along the tray network. The vertical
  // rack-to-tray portions are physical height and are already represented in
  // the numerical calculation; drawing them in the top view creates the
  // unwanted lines through the rack body. Therefore rack nodes are omitted
  // from the visual polyline and only their tray access points are rendered.
  ids.forEach(id=>{
    const n=graph.nodes.get(id);
    if(!n || n.kind!=='tray')return;
    pts.push({x:n.x,y:n.y});
  });
  return dedupeRoutePoints(pts);
}
function dedupeRoutePoints(pts){
  const out=[];pts.forEach(p=>{if(!out.length||Math.hypot(p.x-out[out.length-1].x,p.y-out[out.length-1].y)>0.5)out.push(p);});return out;
}
function routeBetweenRacks(aId,bId,c){
  const temp={...c,originRack:aId,destRack:bId,via:[],__routeTopologyOnly:true};
  const res=calcAutomaticTrayLength(temp);
  if(!res.reachable)return null;
  const graph=buildRouteGraph(temp);
  const pts=routePointsForAutomatic(temp,graph);
  return {reachable:true,length:res.length,path:res.path,points:pts};
}
function manualRouteSequence(c){
  const ids=[c.originRack,...(c.via||[]),c.destRack];
  return ids.filter((id,i)=>id && ids.indexOf(id)===i || i===ids.length-1);
}
function manualRouteData(c){
  if(c.originRack===c.destRack)return {reachable:true,length:0,points:[],segments:[]};
  const ids=[c.originRack,...(c.via||[]),c.destRack];
  let total=0,points=[],segments=[];
  for(let i=1;i<ids.length;i++){
    const seg=routeBetweenRacks(ids[i-1],ids[i],c);
    if(!seg)return {reachable:false,length:0,points:[],segments,failedFrom:ids[i-1],failedTo:ids[i]};
    total+=seg.length; segments.push(seg);
    if(seg.points.length){
      if(points.length && Math.hypot(points[points.length-1].x-seg.points[0].x,points[points.length-1].y-seg.points[0].y)<0.5) points.push(...seg.points.slice(1));
      else points.push(...seg.points);
    }
  }
  return {reachable:true,length:total,points:dedupeRoutePoints(points),segments};
}
function computeRoute(c,g){
  if(c.routeMode==='manual') return manualRouteData(c).points;
  return routePointsForAutomatic(c,g);
}
function validateManualRouteCandidate(c,rackId){
  if(!rackId || rackId===c.originRack || rackId===c.destRack || (c.via||[]).includes(rackId))return {ok:false,message:'Esse rack não pode ser adicionado à rota.'};
  const seq=[c.originRack,...(c.via||[])];
  const from=seq[seq.length-1];
  const seg=routeBetweenRacks(from,rackId,c);
  if(!seg)return {ok:false,message:`Não existe caminho pelas calhas entre ${rackNameById(from)} e ${rackNameById(rackId)}.`};
  return {ok:true};
}
function rackNameById(id){const r=state.racks.find(x=>x.id===id);return r?.name||id||'?';}
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
function calcCable(c){
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return{v1:0,v2:0,tray:0,connection:0,base:0,slack:0,total:0,reachable:false,path:[]};
  // Cabos entre duas portas/U do MESMO rack não sobem para a calha.
  // O comprimento é somente o percurso vertical interno entre as U.
  if(c.originRack===c.destRack){
    const direct=Math.abs(num(c.originU,1)-num(c.destU,1))*(U_MM/1000);
    const connection=0.30;
    const base=direct+connection;
    const slack=base*(num(c.slack,state.defaultSlack)/100);
    return{v1:direct,v2:0,tray:0,connection,base,slack,total:base+slack,reachable:true,path:[]};
  }
  const manual=c.routeMode==='manual';
  const md=manual?manualRouteData(c):null;
  const rr=manual?{reachable:md.reachable,length:md.length,path:[]} : calcAutomaticTrayLength(c),reachable=rr.reachable;
  const graph=reachable&&!manual?buildRouteGraph(c):null;
  let v1=0,v2=0,tray=manual?Math.max(0,md.length):0;
  if(manual){
    if(md.reachable&&md.segments.length){
      // Manual mode fixes the sequence of racks, but the infrastructure path
      // inside each segment is still chosen by the normal tray graph. The
      // selected racks in `via` are waypoints only: they never add a vertical
      // rack-to-tray leg. The tray distance is therefore the complete
      // topology-only distance, while V1/V2 come only from the actual first
      // and last endpoint connections selected by that same topology route.
      const ids=[c.originRack,...(c.via||[]),c.destRack];

      const firstTo=ids[1] || c.destRack;
      const firstTemp={...c,originRack:c.originRack,destRack:firstTo,via:[],__routeTopologyOnly:true};
      const firstGraph=buildRouteGraph(firstTemp);
      const firstPath=shortestPathNodes(firstTemp);
      if(firstGraph&&firstPath.length>1){
        const firstNode=firstGraph.nodes.get(firstPath[0]);
        const firstNext=firstGraph.nodes.get(firstPath[1]);
        const firstEdge=(firstGraph.edges.get(firstPath[0])||[]).find(x=>x.id===firstPath[1]);
        if(firstNode?.kind==='rack'&&firstNext?.kind==='tray'&&firstEdge){
          v1=rackCableRiseMeters(o,num(c.originU,1),firstNext.tray);
        }
      }

      const lastFrom=ids.length>1 ? ids[ids.length-2] : c.originRack;
      const lastTemp={...c,originRack:lastFrom,destRack:c.destRack,via:[],__routeTopologyOnly:true};
      const lastGraph=buildRouteGraph(lastTemp);
      const lastPath=shortestPathNodes(lastTemp);
      if(lastGraph&&lastPath.length>1){
        const lastNode=lastGraph.nodes.get(lastPath[lastPath.length-2]);
        const lastNext=lastGraph.nodes.get(lastPath[lastPath.length-1]);
        const lastEdge=(lastGraph.edges.get(lastPath[lastPath.length-2])||[]).find(x=>x.id===lastPath[lastPath.length-1]);
        if(lastNode?.kind==='tray'&&lastNext?.kind==='rack'&&lastEdge){
          v2=rackCableRiseMeters(d,num(c.destU,1),lastNode.tray);
        }
      }
    }
  } else if(reachable&&graph){
    const ids=rr.path;
    for(let i=1;i<ids.length;i++){
      const a=graph.nodes.get(ids[i-1]),b=graph.nodes.get(ids[i]),e=(graph.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
      if(!e)continue;
      if(a.kind==='rack'&&b.kind==='tray')v1+=e.cost;
      else if(a.kind==='tray'&&b.kind==='rack')v2+=e.cost;
      else tray+=e.cost;
    }
  }
  const connection=reachable?0.60:0;
  const base=reachable?v1+tray+v2+connection:0;
  const slack=base*(num(c.slack,state.defaultSlack)/100),total=base+slack;
  return{v1,v2,tray,connection,base,slack,total,reachable,path:rr.path};
}
function refreshVisuals(){normalizeState();render();renderCables();save();}
function addRackToRow(rowId){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const occupied=new Set(racksInRow(rowId).map(r=>r.index));
  let idx=0; while(occupied.has(idx))idx++;
  const r=makeRack(row,idx);
  state.racks.push(r);
  row.rackCount=Math.max(num(row.rackCount,0),idx+1);
  normalizeIndices();
  state.selected={type:'rack',id:r.id};
  renderAll();
  toast(`Rack adicionado em ${row.name||'fileira'}`);
}

function addCable(){if(state.racks.length<2){toast('Crie pelo menos 2 racks');return;}const c={id:uid('cable'),name:`Cabo-${String(state.cables.length+1).padStart(3,'0')}`,originRack:state.racks[0].id,originU:state.racks[0].units,destRack:state.racks[1].id,destU:state.racks[1].units,slack:state.defaultSlack,type:DEFAULT_CABLE_TYPE,via:[]};state.cables.push(c);state.multiSelected=[];state.selected={type:'cable',id:c.id};renderAll();toast('Cabo adicionado');}

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
function cableExportRows(){
  const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Conexões (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota'];
  return state.cables.map(c=>{
    const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);
    const vals=[c.name,c.type||DEFAULT_CABLE_TYPE,o?.name||'',c.originU,d?.name||'',c.destU,res.v1,res.tray,res.v2,res.connection,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res)];
    const obj={}; headers.forEach((h,i)=>obj[h]=vals[i]??''); return obj;
  });
}
function setColumnWidths(ws,headers,data){
  ws.columns=headers.map((h,i)=>({header:h,key:'c'+i,width:Math.min(60,Math.max(12,Math.max(h.length,...data.map(r=>String(r[i]??'').length))+2))}));
}
function applyTypeValidation(ws, range='B2:B1000'){
  if(!ws)return;
  for(let row=2;row<=1000;row++){
    const cell=ws.getCell(`B${row}`);
    cell.dataValidation={type:'list',allowBlank:false,formulae:['"Fibra Multi Mode,Fibra Single Mode,UTP"']};
  }
}
async function downloadCableTemplate(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino'];
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    ws.addRow(headers);
    ws.addRow(['FIB-001','Fibra Multi Mode','Row-1-01',40,'Row-2-01',40]);
    ws.freezePanes={xSplit:0,ySplit:1};
    ws.autoFilter={from:'A1',to:'F2'};
    ws.getRow(1).font={bold:true};
    ws.columns=[{width:20},{width:24},{width:20},{width:12},{width:20},{width:12}];
    applyTypeValidation(ws);
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='template-importacao-cabos.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Template XLSX baixado');
  }catch(err){toast(err.message||'Erro ao baixar template');}
}
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
        const val=(row,name,def='')=>{const i=map[name];return i==null||i>=row.length||row[i]===''||row[i]==null?def:row[i];};
        let added=0,skipped=0;
        for(const row of rows.slice(1)){
          if(!row.some(v=>v!==null&&String(v).trim()))continue;
          const origin=state.racks.find(r=>r.name===String(val(row,'Rack Origem','')).trim());
          const dest=state.racks.find(r=>r.name===String(val(row,'Rack Destino','')).trim());
          if(!origin||!dest){skipped++;continue;}
          const type=String(val(row,'Tipo',DEFAULT_CABLE_TYPE)).trim();
          if(!CABLE_TYPES.includes(type)){skipped++;continue;}
          state.cables.push({id:uid('cable'),name:String(val(row,'Nome',`Cabo-${String(state.cables.length+1).padStart(3,'0')}`)).trim(),type,originRack:origin.id,originU:Math.floor(num(val(row,'U Origem',origin.units),origin.units)),destRack:dest.id,destU:Math.floor(num(val(row,'U Destino',dest.units),dest.units)),slack:state.defaultSlack,via:[]});
          added++;
        }
        renderAll();
        toast(skipped?`${added} cabo(s) importado(s); ${skipped} ignorado(s).`:`${added} cabo(s) importado(s).`);
      }catch(err){toast(err.message||'Erro ao importar Excel');}
    };
    reader.readAsArrayBuffer(file);
  }catch(err){toast(err.message||'Erro ao importar Excel');}
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
    const type=c.type||DEFAULT_CABLE_TYPE;
    const key=type+'|'+length;
    groups.set(key,(groups.get(key)||0)+1);
  }
  const order=new Map(CABLE_TYPES.map((t,i)=>[t,i]));
  return [...groups.entries()].map(([key,qty])=>{const [type,length]=key.split('|');return {type,length:Number(length),qty};})
    .sort((a,b)=>(order.get(a.type)-order.get(b.type))||a.length-b.length);
}
async function exportCablesXLSX(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Conexões (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota'];
    const rows=state.cables.map(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);return [c.name,c.type||DEFAULT_CABLE_TYPE,o?.name||'',c.originU,d?.name||'',c.destU,res.v1,res.tray,res.v2,res.connection,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res)];});
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    ws.addRow(headers); rows.forEach(r=>ws.addRow(r));
    ws.freezePanes={xSplit:0,ySplit:1}; ws.autoFilter={from:'A1',to:`N${Math.max(1,rows.length+1)}`}; ws.getRow(1).font={bold:true};
    ws.columns=headers.map((h,i)=>({width:Math.min(60,Math.max(12,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))+2))}));
    for(let i=2;i<=rows.length+1;i++)ws.getCell(`B${i}`).dataValidation={type:'list',allowBlank:false,formulae:['"Fibra Multi Mode,Fibra Single Mode,UTP"']};
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

function renderCables(){const el=$('cablesList');$('cableCount').textContent=state.cables.length;if(!state.cables.length){el.innerHTML='<div class="empty">Nenhum cabo cadastrado.</div>';return;}el.innerHTML=state.cables.map(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);const invalid=!cableUnitValidation(c).valid;return`<div class="cable-item ${state.selected?.type==='cable'&&state.selected.id===c.id?'selected':''} ${invalid?'invalid':''}" data-cable="${c.id}"><div class="cable-name">${invalid?'⚠ ':''}${esc(c.name)}</div><div class="cable-meta">${esc(rowForRack(o)?.name||'?')} / ${esc(o?.name||'?')} U${c.originU} → ${esc(rowForRack(d)?.name||'?')} / ${esc(d?.name||'?')} U${c.destU}</div></div>`;}).join('');el.querySelectorAll('[data-cable]').forEach(x=>x.onclick=e=>{e.stopPropagation();state.multiSelected=[];state.selected={type:'cable',id:x.dataset.cable};renderAll();});}
function ensureFields(){$('projectName').value=state.projectName;$('rowCount').value=state.rows.length;$('defaultRacks').value=state.rows[0]?.rackCount??0;$('rackUnits').value=state.rackUnits;$('rackWidth').value=state.rackWidth;$('rackDepth').value=state.rackDepth;$('rackGap').value=state.rackGap;$('defaultRowGap').value=state.defaultRowGap;$('lastUToTray').value=state.lastUToTray;$('defaultSlack').value=state.defaultSlack;}
function renderAll(persist=true){ensureFields();updateRoomUI();buildRowsPanel();render();renderProperties();renderCables();updateStructureControls();updateProjectSummary();updateMinimap();state.snapToEdges=true;if(persist)save();updateHistoryButtons();}

function clearRackMultiSelection(){ state.multiSelected=[]; if(state.selected?.type==='rack') state.selected=null; }
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

function deleteSelectedTrays(){
  if(structureBlocked())return;
  const ids=[...new Set(state.trayMultiSelected)].filter(id=>state.trays.some(t=>t.id===id));
  if(ids.length<2)return;
  if(!confirm(`Excluir ${ids.length} calhas selecionadas?`))return;
  const set=new Set(ids);
  state.trayLinks=state.trayLinks.filter(l=>!set.has(l.aTray)&&!set.has(l.bTray));
  state.trayRackLinks=state.trayRackLinks.filter(l=>!set.has(l.trayId));
  state.trays=state.trays.filter(t=>!set.has(t.id));
  state.trayMultiSelected=[];state.selected=null;
  normalizeState();renderAll();toast(`${ids.length} calhas excluídas`);
}

function deleteSelectedRacks(){
  if(structureBlocked())return;
  const ids=[...new Set(state.multiSelected)].filter(id=>state.racks.some(r=>r.id===id));
  if(ids.length<2)return;
  if(!confirm(`Excluir ${ids.length} racks selecionados?`))return;
  removeRackReferences(ids);
  state.assets.forEach(a=>{if(ids.includes(a.rackId)){a.rackId=null;}});
  state.racks=state.racks.filter(r=>!ids.includes(r.id));
  state.rows.forEach(row=>row.rackCount=racksInRow(row.id).length);
  state.multiSelected=[];state.selected=null;normalizeState();renderAll();toast(`${ids.length} racks excluídos`);
}

function setupPan(){
  const wrap=$('canvasWrap'), stage=$('canvasStage');
  if(!wrap||!stage)return;
  let drag=null, raf=0;
  if(!window.__canvasPan) window.__canvasPan={x:-VIEW_PAD+40,y:-VIEW_PAD+40,zoom:1};
  const p=window.__canvasPan;
  if(!Number.isFinite(p.zoom))p.zoom=1;
  const clampZoom=z=>Math.max(0.55,Math.min(2.5,z));
  const getBounds=()=>{
    const sw=Math.max(stage.offsetWidth*p.zoom,wrap.clientWidth);
    const sh=Math.max(stage.offsetHeight*p.zoom,wrap.clientHeight);
    return {
      minX:Math.min(0,wrap.clientWidth-sw-40), maxX:40,
      minY:Math.min(0,wrap.clientHeight-sh-40), maxY:40
    };
  };
  const apply=()=>{
    const b=getBounds();
    p.x=Math.max(b.minX,Math.min(b.maxX,p.x));
    p.y=Math.max(b.minY,Math.min(b.maxY,p.y));
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
    raf=requestAnimationFrame(apply);
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
function openProjectSummary(){ updateProjectSummary(); }
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
  const setOpen=open=>{box.classList.toggle('hidden',!open);localStorage.setItem('dccp_minimap_open',open?'1':'0');if(open)requestAnimationFrame(updateMinimap);};
  toggle.addEventListener('click',()=>setOpen(box.classList.contains('hidden')));$('minimapClose')?.addEventListener('click',()=>setOpen(false));
  svg.addEventListener('pointerdown',e=>{const sc=Number(svg.dataset.scale)||1,ox=Number(svg.dataset.ox)||0,oy=Number(svg.dataset.oy)||0,g=geometry(),pt={x:(e.offsetX-ox)/sc,y:(e.offsetY-oy)/sc};const wrap=$('canvasWrap'),p=window.__canvasPan;if(!wrap||!p)return;const z=p.zoom||1;p.x=wrap.clientWidth/2-pt.x*z;p.y=wrap.clientHeight/2-pt.y*z;window.__applyCanvasPan?.();updateMinimap();e.preventDefault();});
  if(localStorage.getItem('dccp_minimap_open')==='1')box.classList.remove('hidden'); else box.classList.add('hidden');
}
async function newProject(){
  if(!confirm('Criar um novo projeto? O projeto atual continuará salvo na nuvem.'))return;
  await createNewCloudProject();
}


// --- Inventory import/export -------------------------------------------------
let pendingImport = null;
const CATALOG_SHEET_HEADERS = {
  types:['Tipo'],
  manufacturers:['Fabricante'],
  models:['Tipo','Fabricante','Modelo']
};
const ASSET_HEADERS = ['Asset Tag','Nome','Serial Number','Modelo','Localização','Rack','U Inicial','Quantidade U','Status','Substatus'];
function downloadWorkbook(workbook,name){
  if(!window.XLSX){toast('Biblioteca de planilhas indisponível.');return;}
  XLSX.writeFile(workbook,name,{bookType:'xlsx'});
}
function excelCol(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
function excelSafeName(value){let s=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9_]/g,'_');if(!s||/^\d/.test(s))s='L_'+s;return s.slice(0,80);}
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
async function saveExcelJSWorkbook(wb,name){
  if(!await ensureExcelJS()){toast('Não foi possível carregar a biblioteca de planilhas. Verifique a conexão e tente novamente.');return false;}
  try{
    const buffer=await wb.xlsx.writeBuffer();
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},1500);
    return true;
  }catch(err){console.error('ExcelJS download error',err);toast('Não foi possível gerar o arquivo XLSX.');return false;}
}
function styleExcelSheet(ws){ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:excelCol(Math.max(1,ws.columnCount))+'1'};ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F2937'}};ws.getRow(1).alignment={vertical:'middle'};}
function addListValidation(ws,range,formula){ws.dataValidations.add(range,{type:'list',allowBlank:true,formulae:[formula],showErrorMessage:true,errorStyle:'stop',errorTitle:'Valor inválido',error:'Selecione um valor da lista.'});}
function createDefinedList(wb,ws,name,values,col=1,startRow=2){const clean=[...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))];ws.getCell(1,col).value=name;clean.forEach((v,i)=>ws.getCell(startRow+i,col).value=v);if(clean.length)wb.definedNames.add(name,`'Listas'!$${excelCol(col)}$${startRow}:$${excelCol(col)}$${startRow+clean.length-1}`);return clean;}
function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function xlsxCol(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
function addDefinedNameXml(xml,name,ref){const tag=`<definedName name="${xmlEsc(name)}">${xmlEsc(ref)}</definedName>`;if(xml.includes('<definedNames>'))return xml.replace('</definedNames>',tag+'</definedNames>');return xml.includes('<calcPr') ? xml.replace(/(<calcPr\b)/,`<definedNames>${tag}</definedNames>$1`) : xml.replace('</workbook>',`<definedNames>${tag}</definedNames></workbook>`);}
function patchXlsxDataValidations(buf, sheetValidations=[], definedNames=[]){
  if(!window.JSZip){throw new Error('JSZip indisponível');}
  return JSZip.loadAsync(buf).then(async zip=>{
    const wbPath='xl/workbook.xml';let wbXml=await zip.file(wbPath).async('string');
    definedNames.forEach(d=>{wbXml=addDefinedNameXml(wbXml,d.name,d.ref);});zip.file(wbPath,wbXml);
    for(const item of sheetValidations){const path=`xl/worksheets/sheet${item.index}.xml`;const f=zip.file(path);if(!f)continue;let xml=await f.async('string');if(item.validations?.length){const body=item.validations.map(v=>`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop" sqref="${xmlEsc(v.sqref)}"><formula1>${xmlEsc(v.formula)}</formula1></dataValidation>`).join('');const block=`<dataValidations count="${item.validations.length}">${body}</dataValidations>`;if(xml.includes('<dataValidations'))xml=xml.replace(/<dataValidations[\s\S]*?<\/dataValidations>/,block);else xml=xml.replace('</sheetData>',`</sheetData>${block}`);zip.file(path,xml);}}
    return zip.generateAsync({type:'arraybuffer'});
  });
}
async function downloadSheetJSWorkbook(wb,name,sheetValidations=[],definedNames=[]){
  if(!window.XLSX){toast('Biblioteca de planilhas indisponível.');return false;}
  try{
    let buf=XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true});
    if(sheetValidations.length||definedNames.length){
      try{
        buf=await patchXlsxDataValidations(buf,sheetValidations,definedNames);
      }catch(patchErr){
        console.warn('Não foi possível aplicar validações avançadas; baixando o XLSX básico.',patchErr);
        toast('Template gerado; algumas listas avançadas podem não estar disponíveis.');
      }
    }
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=name;a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},2000);
    return true;
  }catch(e){
    console.error('XLSX download error',e);
    toast('Não foi possível gerar o arquivo XLSX.');
    return false;
  }
}
function makeSheetJSList(wb,name,values){const ws=XLSX.utils.aoa_to_sheet([[name],...(values||[]).map(v=>[v])]);ws['!cols']=[{wch:34}];XLSX.utils.book_append_sheet(wb,ws,name);return ws;}
function addDefinedList(defs,name,sheet,col,values){const clean=[...new Set((values||[]).map(v=>String(v??'').trim()).filter(Boolean))];const start=2,end=Math.max(2,start+clean.length-1);const ref=`'${sheet}'!$${xlsxCol(col)}$${start}:$${xlsxCol(col)}$${end}`;defs.push({name,ref});return clean;}
function makeCatalogTemplate(){
  normalizeAssetCatalogs();const wb=XLSX.utils.book_new();const info=XLSX.utils.aoa_to_sheet([['Template de cadastros — Data Center Cable Planner'],['Preencha Tipos, Fabricantes e Modelos.'],['Na aba Modelos, cada linha DEVE informar Tipo e Fabricante.'],['O Modelo será vinculado ao Tipo + Fabricante informados.']]);info['!cols']=[{wch:105}];XLSX.utils.book_append_sheet(wb,info,'Instruções');
  const types=state.assetCatalogs.types||[],mans=state.assetCatalogs.manufacturers||[],models=state.assetCatalogs.models||[];
  const wt=XLSX.utils.aoa_to_sheet([['Tipo'],...types.map(v=>[v])]);wt['!cols']=[{wch:32}];XLSX.utils.book_append_sheet(wb,wt,'Tipos');
  const wm=XLSX.utils.aoa_to_sheet([['Fabricante'],...mans.map(v=>[v])]);wm['!cols']=[{wch:36}];XLSX.utils.book_append_sheet(wb,wm,'Fabricantes');
  const wmod=XLSX.utils.aoa_to_sheet([['Tipo','Fabricante','Modelo'],...models.map(m=>[m.type||'',m.manufacturer||'',m.name||''])]);wmod['!cols']=[{wch:28},{wch:34},{wch:42}];XLSX.utils.book_append_sheet(wb,wmod,'Modelos');
  const lists=XLSX.utils.aoa_to_sheet([['LISTA_TIPOS','LISTA_FABRICANTES'],...types.map((v,i)=>[v,mans[i]||''])]);lists['!hidden']=true;XLSX.utils.book_append_sheet(wb,lists,'Listas');
  const defs=[];addDefinedList(defs,'LISTA_TIPOS','Listas',1,types);addDefinedList(defs,'LISTA_FABRICANTES','Listas',2,mans);
  wb.Workbook={Sheets:wb.SheetNames.map(n=>({name:n,Hidden:n==='Listas'?1:0}))};const validations=[{index:3,validations:[{sqref:'A2:A500',formula:'=LISTA_TIPOS'},{sqref:'B2:B500',formula:'=LISTA_FABRICANTES'}]}];
  downloadSheetJSWorkbook(wb,'Template_Cadastros_DataCenterCablePlanner.xlsx',validations,defs).then(ok=>{if(ok)toast('Template de cadastros baixado');});
}
function assetStatusValues(){ normalizeAssetCatalogs(); return state.assetCatalogs.statuses||DEFAULT_ASSET_STATUSES.slice(); }
async function makeAssetsTemplate(){
  try{
    if(!await ensureExcelJS()) throw new Error('Biblioteca ExcelJS não carregada.');
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Assets');
    const headers=['Asset Tag','Nome','Serial Number','Modelo','Localização','Rack','U Inicial','Quantidade U','Status','Substatus'];
    ws.addRow(headers);
    (state.assets||[]).forEach(a=>{
      const room=assetRoom(a), rack=assetRack(a.rackId);
      const rackDisplay=rack ? `${room?.name||assetRackRoom(a)?.name||''} / ${rack.name||''}`.replace(/^ \/ /,'') : '';
      ws.addRow([a.assetTag||'',a.name||'',a.serial||'',a.model||'',assetLocationLabel(a),rackDisplay,a.uStart||'',a.uHeight||1,a.status||'Instalado',a.substatus||'']);
    });
    ws.views=[{state:'frozen',ySplit:1}];
    ws.autoFilter={from:'A1',to:'J1'};
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F2937'}};
    ws.getRow(1).alignment={vertical:'middle'};
    ws.columns=[18,32,24,30,28,22,12,14,18,22].map(width=>({width}));
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
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download='Modelo_Importacao_Assets_DataCenterCablePlanner.xlsx';a.style.display='none';
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
  const fields=[['Nome','text'],['Serial Number','text'],['Modelo','model'],['Localização','room'],['Rack','rack'],['U Inicial','u'],['Quantidade U','number'],['Status','status'],['Substatus','substatus']];
  table.innerHTML=`<table class="asset-import-edit-grid"><thead><tr><th></th>${fields.map(f=>`<th>${esc(f[0])}${['Nome','Serial Number','Modelo'].includes(f[0])?' *':''}</th>`).join('')}<th>Validação</th></tr></thead><tbody>${rows.map((item,idx)=>{const d=item.data||{};const status=item._validated?(item.valid?'valid':'invalid'):'pending';return `<tr class="import-row ${status==='valid'?'import-valid':status==='invalid'?'import-invalid':'import-pending'}" data-import-index="${idx}"><td class="import-row-state">${status==='valid'?'✓':status==='invalid'?'!':'•'}</td>${fields.map(([key,type])=>{let control='';if(type==='model')control=`<select data-import-field="${key}">${assetImportCatalogOptions('model',d[key]||'')}</select>`;else if(type==='room')control=`<select data-import-field="${key}">${assetImportRoomOptions(d[key]||'')}</select>`;else if(type==='rack')control=`<select data-import-field="${key}">${assetImportRackOptions(d['Localização']||d['Sala']||'',d[key]||'')}</select>`;else if(type==='status')control=`<select data-import-field="${key}">${assetImportCatalogOptions('status',d[key]||'Instalado')}</select>`;else if(type==='substatus')control=`<select data-import-field="${key}">${assetImportCatalogOptions('substatus',d[key]||'')}</select>`;else if(type==='u')control=`<select data-import-field="${key}">${assetImportUOptions(item)}</select>`;else control=`<input data-import-field="${key}" type="${type==='number'?'number':'text'}" value="${esc(d[key]??'')}" ${key==='Quantidade U'?'min="1" max="60"':''}>`;return `<td>${control}</td>`}).join('')}<td class="import-row-message">${status==='pending'?'<div class="import-validation-pending">⏳ Aguardando validação</div>':renderImportProblems(item,idx)}</td></tr>`}).join('')}</tbody></table>`;
  table.querySelectorAll('[data-import-field]').forEach(el=>el.addEventListener('change',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:true})));
  table.querySelectorAll('[data-import-field="Nome"],[data-import-field="Serial Number"],[data-import-field="Quantidade U"]').forEach(el=>el.addEventListener('input',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:false})));
  table.querySelectorAll('.import-model-action').forEach(btn=>btn.addEventListener('click',()=>openImportModelRegistration(Number(btn.dataset.importModel))));
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
async function importCatalogWorkbook(file){
  try{
    const wb=await readWorkbookFile(file); const rows=[]; const errors=[];
    const incomingTypes=new Set(), incomingManufacturers=new Set();
    const rawSheets={Tipos:sheetRows(wb,'Tipos'),Fabricantes:sheetRows(wb,'Fabricantes'),Modelos:sheetRows(wb,'Modelos')};
    rawSheets.Tipos.forEach(raw=>{const v=getCol(raw,['tipo']);if(v)incomingTypes.add(v.toLowerCase());});
    rawSheets.Fabricantes.forEach(raw=>{const v=getCol(raw,['fabricante']);if(v)incomingManufacturers.add(v.toLowerCase());});
    const knownTypes=new Set((state.assetCatalogs.types||[]).map(catalogNormalize));
    const knownManufacturers=new Set((state.assetCatalogs.manufacturers||[]).map(catalogNormalize));
    incomingTypes.forEach(v=>knownTypes.add(catalogNormalize(v))); incomingManufacturers.forEach(v=>knownManufacturers.add(catalogNormalize(v)));
    for(const [sheet,key] of [['Tipos','types'],['Fabricantes','manufacturers'],['Modelos','models']]){
      rawSheets[sheet].forEach((raw,i)=>{
        const line=i+2; let type='',manufacturer='',model='';
        if(key==='types') type=getCol(raw,['tipo']);
        if(key==='manufacturers') manufacturer=getCol(raw,['fabricante']);
        if(key==='models'){type=getCol(raw,['tipo']);manufacturer=getCol(raw,['fabricante']);model=getCol(raw,['modelo']);}
        const label=key==='types'?type:key==='manufacturers'?manufacturer:model; let valid=!!label,message='';
        if(!valid)message='Campo obrigatório vazio.';
        if(key==='models'&&valid&&(!type||!manufacturer)){valid=false;message='Modelo precisa de Tipo e Fabricante.';}
        if(key==='models'&&valid&&!knownTypes.has(catalogNormalize(type))){valid=false;message=`Tipo "${type}" não está cadastrado nem foi incluído no arquivo.`;}
        if(key==='models'&&valid&&!knownManufacturers.has(catalogNormalize(manufacturer))){valid=false;message=`Fabricante "${manufacturer}" não está cadastrado nem foi incluído no arquivo.`;}
        if(valid&&key==='models'){
          const existingType=state.assetCatalogs.types.find(v=>catalogNormalize(v)===catalogNormalize(type));
          const existingMan=state.assetCatalogs.manufacturers.find(v=>catalogNormalize(v)===catalogNormalize(manufacturer));
          if(existingType)type=existingType;
          if(existingMan)manufacturer=existingMan;
        }
        rows.push({sheet,type,manufacturer,model,valid,line,message}); if(!valid)errors.push({line,sheet,message});
      });
    }
    const seenT=new Set(),seenF=new Set(),seenM=new Set();
    rows.forEach(r=>{if(!r.valid)return;
      if(r.sheet==='Tipos'){
        const k=catalogNormalize(r.type); const exact=state.assetCatalogs.types.find(v=>catalogNormalize(v)===k);
        if(seenT.has(k)||exact){r.valid=false;r.message=`Tipo já cadastrado${exact?`: ${exact}`:''} ou repetido no arquivo.`;errors.push({line:r.line,message:r.message});} else {const similar=catalogSimilar(r.type,state.assetCatalogs.types);if(similar.length)r.warning=`Possível duplicidade com: ${similar[0]}`;seenT.add(k);}
      } else if(r.sheet==='Fabricantes'){
        const k=catalogNormalize(r.manufacturer); const exact=state.assetCatalogs.manufacturers.find(v=>catalogNormalize(v)===k);
        if(seenF.has(k)||exact){r.valid=false;r.message=`Fabricante já cadastrado${exact?`: ${exact}`:''} ou repetido no arquivo.`;errors.push({line:r.line,message:r.message});} else {const similar=catalogSimilar(r.manufacturer,state.assetCatalogs.manufacturers);if(similar.length)r.warning=`Possível duplicidade com: ${similar[0]}`;seenF.add(k);}
      } else {
        const k=[r.type,r.manufacturer,r.model].map(catalogNormalize).join('|');
        const exact=state.assetCatalogs.models.find(m=>catalogNormalize(m.type)===catalogNormalize(r.type)&&catalogNormalize(m.manufacturer)===catalogNormalize(r.manufacturer)&&catalogNormalize(m.name)===catalogNormalize(r.model));
        if(seenM.has(k)||exact){r.valid=false;r.message=`Modelo já cadastrado${exact?`: ${exact.name}`:''} ou repetido no arquivo.`;errors.push({line:r.line,message:r.message});} else {const similar=state.assetCatalogs.models.filter(m=>catalogNormalize(m.type)===catalogNormalize(r.type)&&catalogNormalize(m.manufacturer)===catalogNormalize(r.manufacturer)).map(m=>m.name);const near=catalogSimilar(r.model,similar);if(near.length)r.warning=`Possível duplicidade com: ${near[0]}`;seenM.add(k);}
      }
    });
    openImportPreview('catalogs',rows,errors,'Importar cadastros','Revise os dados antes de adicioná-los ao catálogo.',()=>{
      rows.filter(r=>r.valid).forEach(r=>{if(r.sheet==='Tipos')state.assetCatalogs.types.push(r.type);else if(r.sheet==='Fabricantes')state.assetCatalogs.manufacturers.push(r.manufacturer);else state.assetCatalogs.models.push({id:uid('model'),name:r.model,type:r.type,manufacturer:r.manufacturer});});
      normalizeAssetCatalogs();save();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();toast('Cadastros importados');
    });
  }catch(e){console.error(e);toast('Não foi possível ler a planilha.');}
}

function catalogSingleLabel(kind){return ({types:'Tipos de ativo',manufacturers:'Fabricantes',models:'Modelos',statuses:'Status',substatuses:'Substatus'})[kind]||'Cadastros';}
function catalogSingleTemplate(kind){
  normalizeAssetCatalogs();
  const wb=XLSX.utils.book_new();
  let headers=[], rows=[];
  if(kind==='models'){
    headers=['Modelo','Fabricante','Tipo de Ativo'];
    rows=(state.assetCatalogs.models||[]).map(m=>[m.name||'',m.manufacturer||'',m.type||'']);
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
  const headers=kind==='models'?['Linha','Modelo','Fabricante','Tipo de Ativo','Validação']:['Linha','Nome','Validação'];
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
    return `<tr class="${r.valid?'import-valid':'import-invalid'}"><td>${r.line}</td><td><input class="catalog-edit" data-row="${i}" data-field="value" value="${esc(r.value)}"></td><td class="catalog-validation">${status}</td></tr>`;
  }).join('');
  $('importPreviewTable').innerHTML=`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  document.querySelectorAll('.catalog-edit').forEach(inp=>inp.addEventListener('input',()=>{
    const row=rows[Number(inp.dataset.row)]; row[inp.dataset.field]=inp.value;
    const focus={row:Number(inp.dataset.row),field:inp.dataset.field,start:inp.selectionStart,end:inp.selectionEnd};
    renderCatalogSinglePreviewRows(kind,rows);
    const next=document.querySelector(`.catalog-edit[data-row="${focus.row}"][data-field="${focus.field}"]`);
    if(next){next.focus();try{next.setSelectionRange(focus.start,focus.end)}catch(e){}}
  }));
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

function parseImportNumber(v,fallback=0){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:fallback;}
async function processAssetsWorkbook(file){
  try{
    const wb=await readWorkbookFile(file);const rows=sheetRows(wb,'Assets');
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
        'Rack':getCol(raw,['rack','rack name']),
        'U Inicial':getCol(raw,['u inicial','u start','ustart','position','position u','u']),
        'Quantidade U':getCol(raw,['quantidade u','u height','uheight','quantidade de u','height','u size'])||'1',
        'Status':getCol(raw,['status','state'])||'Ativo'
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
        const d=item.data; const resolved=resolveAssetImportLocation(d['Localização']||d.Sala); const room=resolved.room; const stock=resolved.stock; const rack=room&&d.Rack?room.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(d.Rack)):null; const loc=resolved.loc; const asset={id:uid('asset'),name:d.Nome,type:d.Tipo,manufacturer:d.Fabricante,model:d.Modelo,assetTag:d['Asset Tag'],serial:d['Serial Number'],status:d.Status||'Instalado',substatus:d.Substatus||'',locationType:stock?'stock':'room',locationName:d['Localização']||d.Sala||'',locationId:loc?.id||null,stockId:stock?.id||null,roomId:room?.id||null,rackId:rack?.id||null,uStart:Math.max(1,Math.floor(parseImportNumber(d['U Inicial'],1))),uHeight:Math.max(1,Math.floor(parseImportNumber(d['Quantidade U'],1)))}; state.assets.push(asset); recordAssetAudit({action:'CREATE',asset,after:asset,changes:[]});
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
function bulkAllRacks(){
  const out=[],seen=new Set();
  const add=(r,roomName='')=>{if(!r?.id||seen.has(r.id))return;seen.add(r.id);const room=state.rooms?.find(x=>x.id===r.roomId)||state.rooms?.find(x=>x.data?.racks?.some(y=>y.id===r.id));out.push({r,room:room||null,roomName:roomName||room?.name||''});};
  (state.racks||[]).forEach(r=>add(r));
  (state.rooms||[]).forEach(room=>(room.data?.racks||[]).forEach(r=>add(r,room.name)));
  return out;
}
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
  const hEl=row.querySelector('[data-bulk-field="height"]');
  if(hEl)hEl.disabled=!hasRack;
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
<td><button class="iconbtn danger-icon" type="button" data-bulk-remove title="Remover linha">×</button></td></tr>`;}
function initBulkTableResizers(){
  const table=document.querySelector('.bulk-assets-table');
  if(!table||table.dataset.resizersReady==='1')return;
  table.dataset.resizersReady='1';
  const cols=[...table.querySelectorAll('colgroup col')];
  const heads=[...table.querySelectorAll('thead th')];
  const defaults={name:13,type:7,manufacturer:9,model:10,tag:9,serial:13,location:18,rack:13,u:6,height:6,status:9,substatus:11,actions:4};
  const mins={name:90,type:62,manufacturer:80,model:82,tag:76,serial:105,location:150,rack:100,u:52,height:56,status:72,substatus:90,actions:34};
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
function openBulkAssetsModal(){normalizeAssets();normalizeAssetCatalogs();initBulkTableResizers();const m=$('assetsBulkModal');if(!m)return;$('assetsBulkBody').innerHTML='';for(let i=0;i<5;i++)addBulkRow();$('assetsBulkChooser')?.classList.remove('hidden');$('assetsBulkEditor')?.classList.add('hidden');m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='340';}
function closeBulkAssetsModal(){const m=$('assetsBulkModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function saveBulkAssets(){
  normalizeAssets();const rows=[...document.querySelectorAll('#assetsBulkBody tr')].filter(r=>r.querySelector('[data-bulk-field="name"]')?.value.trim());if(!rows.length){toast('Adicione pelo menos um asset.');return;}
  const errors=[],newAssets=[];
  rows.forEach((row,i)=>{const g=k=>row.querySelector(`[data-bulk-field="${k}"]`)?.value?.trim?.()||row.querySelector(`[data-bulk-field="${k}"]`)?.value||'';const name=g('name'),type=g('type'),manufacturer=g('manufacturer'),model=g('model'),tag=g('tag'),serial=g('serial'),locationValue=g('location'),rackId=g('rack'),uStart=Number(g('u')||0),uHeight=Math.max(1,Math.floor(Number(g('height')||1))),status=g('status')||'Ativo',substatus=g('substatus');const locParts=locationValue.startsWith('stock:')?locationValue.split(':'):null;const locationType=locationValue.startsWith('stock:')?'stock':'room';const roomId=locationType==='room'?locationValue.slice(5)||null:null;const locationId=locationType==='stock'?(locParts?.[1]||null):(roomId?(state.rooms.find(r=>r.id===roomId)?.locationId||null):null);const stockId=locationType==='stock'?(locParts?.[2]||null):null;const rack=assetRack(rackId);let msg='';if(!name)msg='Nome é obrigatório.';else if(!type)msg='Tipo é obrigatório.';else if(!serial)msg='Serial Number é obrigatório.';else if(!locationValue)msg='Localização é obrigatória.';else if(locationType==='stock'&&rackId)msg='Asset em estoque não pode ter rack.';else if(locationType==='stock'&&uStart)msg='Asset em estoque não pode ter U.';else if(rack&&uStart<1)msg='Selecione uma U disponível.';else if(rack&&uStart+uHeight-1>Math.floor(num(rack.units,state.rackUnits)))msg='Quantidade de U ultrapassa o rack.';else if(rack){const used=new Set(state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).flatMap(a=>{const o=assetOccupancy(a);return Array.from({length:o.end-o.start+1},(_,j)=>o.start+j);}));newAssets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{for(let u=a.uStart;u<a.uStart+a.uHeight;u++)used.add(u);});for(let u=uStart;u<uStart+uHeight;u++)if(used.has(u)){msg=`Conflito: U${u} já está ocupada.`;break;}}if(!msg){newAssets.push({id:uid('asset'),name,type,manufacturer,model,assetTag:tag,serial,locationType,locationName:locationType==='stock'?(state.locations.find(l=>l.id===locationId)?.name||'Estoque'):(state.rooms.find(r=>r.id===roomId)?.name||''),locationId,stockId,roomId,rackId:rackId||null,uStart:uStart||1,uHeight,status,substatus});}if(msg)errors.push(`Linha ${i+1}: ${msg}`);});
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
  $('btnAddRoom')?.addEventListener('click',addRoom);
  $('btnRenameRoom')?.addEventListener('click',showRoomMenu);
  $('btnLocations')?.addEventListener('click',openLocationsModal);
  $('btnAssets')?.addEventListener('click',openAssetsModal);
  $('assetHistoryClose')?.addEventListener('click',closeAssetHistory);
  $('assetHistoryExport')?.addEventListener('click',exportCurrentAssetHistory);
  $('assetsClose')?.addEventListener('click',closeAssetsModal);
  $('assetsNew')?.addEventListener('click',()=>openAssetModal());
  $('assetsBulk')?.addEventListener('click',openBulkAssetsModal);
  $('assetsBulkClose')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkCancel')?.addEventListener('click',closeBulkAssetsModal);
  $('assetsBulkManual')?.addEventListener('click',()=>{$('assetsBulkChooser')?.classList.add('hidden');$('assetsBulkEditor')?.classList.remove('hidden');});
  $('assetsBulkImport')?.addEventListener('click',()=>{closeBulkAssetsModal();openAssetsImportModal();});
  $('assetsBulkTemplate')?.addEventListener('click',makeAssetsTemplate);
  $('assetsBulkBack')?.addEventListener('click',()=>{$('assetsBulkEditor')?.classList.add('hidden');$('assetsBulkChooser')?.classList.remove('hidden');});
  $('assetsBulkAddRow')?.addEventListener('click',addBulkRow);
  $('assetsBulkSave')?.addEventListener('click',saveBulkAssets);
  
  $('assetsCatalogs')?.addEventListener('click',openAssetCatalogModal);
  $('assetCatalogClose')?.addEventListener('click',closeAssetCatalogModal);
  
  $('assetsSearch')?.addEventListener('input',e=>renderAssetsList(e.target.value));
  $('assetEditCancel')?.addEventListener('click',closeAssetModal);
  $('assetEditCancelTop')?.addEventListener('click',closeAssetModal);
  $('assetEditForm')?.addEventListener('submit',e=>{e.preventDefault();saveAssetForm();});
  $('assetManufacturer')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetType')?.addEventListener('change',()=>{renderAssetCatalogSelects({assetType:$('assetType')?.value||'',assetManufacturer:$('assetManufacturer')?.value||'',assetModel:''});});
  $('assetLocation')?.addEventListener('change',()=>refreshAssetRackOptions(''));
  $('assetModel')?.addEventListener('change',()=>{const modelName=$('assetModel')?.value||'';if(!modelName)return;normalizeAssetCatalogs();const m=state.assetCatalogs.models.find(x=>String(x.name)===String(modelName));if(!m)return;renderAssetCatalogSelects({assetType:m.type||'',assetManufacturer:m.manufacturer||'',assetModel:m.name||''});});
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
  $('catalogEditorSave')?.addEventListener('click',saveCatalogEditor);
  $('catalogEditorCancel')?.addEventListener('click',closeCatalogEditor);
  $('catalogEditorClose')?.addEventListener('click',closeCatalogEditor);
  
  
  $('bayfaceClose')?.addEventListener('click',closeBayface);
  $('bayfaceAssetPickerClose')?.addEventListener('click',closeBayfaceAssetPicker);
  $('bayfaceAssetPickerSearch')?.addEventListener('input',renderBayfaceAssetPicker);
  
  document.addEventListener('click',e=>{if(!e.target.closest('#roomMenu')&&!e.target.closest('#btnRenameRoom'))closeRoomMenu();});
  window.addEventListener('resize',closeRoomMenu);
  window.addEventListener('scroll',closeRoomMenu,true);

  // Bindar os controles do canvas ANTES da renderização do projeto.
  // Isso garante que um erro em renderAll() não deixe os controles mudos.
  setupMinimap();
  setupSidebarToggle();
  setupStructureLockControl();

  load();renderAll(false);initHistory(cloudProjectId);setupPan();
  // A barra lateral já foi inicializada por setupSidebarToggle().
  $('btnQuickSearch')?.addEventListener('click',openQuickSearch);
  $('quickSearchClose')?.addEventListener('click',closeQuickSearch); $('summaryClose')?.addEventListener('click',closeProjectSummary);
  
  $('quickSearchInput')?.addEventListener('input',e=>{quickSearchIndex=0;renderQuickSearchResults(e.target.value);});
  $('quickSearchInput')?.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex+1)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='ArrowUp'){e.preventDefault();if(quickSearchItems.length){quickSearchIndex=(quickSearchIndex-1+quickSearchItems.length)%quickSearchItems.length;renderQuickSearchResults(e.target.value);}}else if(e.key==='Enter'&&quickSearchItems[quickSearchIndex]){e.preventDefault();activateSearchResult(quickSearchItems[quickSearchIndex].type,quickSearchItems[quickSearchIndex].id);}});
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openQuickSearch();}else if(e.key==='Escape'){if($('quickSearchModal')?.classList.contains('open'))closeQuickSearch();else if($('projectSummaryModal')?.classList.contains('open'))closeProjectSummary();else if($('catalogEditorModal')?.classList.contains('open'))closeCatalogEditor();else if($('assetCatalogModal')?.classList.contains('open'))closeAssetCatalogModal();else if($('assetsModal')?.classList.contains('open'))closeAssetsModal();else if($('assetEditModal')?.classList.contains('open'))closeAssetModal();else if($('bayfaceAssetPickerModal')?.classList.contains('open'))closeBayfaceAssetPicker();else if($('bayfaceModal')?.classList.contains('open'))closeBayface();}});
  // Cadeado já foi inicializado por setupStructureLockControl().
  updateStructureControls();
  if($('btnProjects'))$('btnProjects').onclick=async()=>{
    if(guestMode){toast('Projetos na nuvem não estão disponíveis no modo convidado. Use Exportar projeto.');return;}
    if(cloudDirty){
      const wantsSave=confirm('Existem alterações não salvas na nuvem. Deseja salvar antes de voltar para Projetos?');
      if(wantsSave){ const ok=await saveProjectToCloud(true); if(!ok)return; }
      else { const leave=confirm('Voltar sem salvar pode deixar alterações apenas neste navegador. Deseja continuar?'); if(!leave)return; }
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
  $('btnTemplate').onclick=downloadCableTemplate;
  $('btnExportCables').onclick=exportCablesXLSX;
  $('excelInput').onchange=e=>{const f=e.target.files[0];if(f)importCablesXLSX(f);e.target.value='';};
  $('btnTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('btnUndo').onclick=undo; $('btnRedo').onclick=redo;
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}});
  $('btnSave').onclick=async()=>{ if(guestMode){toast('Modo convidado: exporte o projeto para salvar uma cópia.');return;} save(); await saveProjectToCloud(true); };
  $('autosaveToggle')?.addEventListener('change',e=>setAutosaveEnabled(e.target.checked));
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloudDirty?'pending':'saved');
  $('btnExport').onclick=()=>{
    try{
      // Always synchronize the live room into its persisted representation
      // before exporting.  This guarantees that room-scoped infrastructure
      // such as trays, tray links and cables is present in the JSON even when
      // the user exports immediately after making an edit.
      syncActiveRoom();
      normalizeState();
      const payload=projectCloudPayload();
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),
            a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=(state.projectName||'data-center')+'.json';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Projeto completo exportado');
    }catch(err){
      console.error('Export project:',err);
      toast('Não foi possível exportar o projeto.');
    }
  };
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

