import { cloneData, esc, $ } from './utils.js';
import { state, THEME_STORAGE } from './state.js';
import { uiConfirm, uiPrompt } from './dialogs.js';
import { syncSelectButton, bindStyledSelect } from './styled-select.js';
import { runtime } from './runtime.js';

// Estado mutável compartilhado com app.js. Vive num objeto porque um `let` de módulo
// não pode ser reatribuído por quem importa.
export const cloud = { cloudProjectId: null, cloudDirty: false };

// Funções e constantes que continuam em app.js; injetadas por configureCloudSync()
// para evitar import circular com app.js.
let applyRoomData, syncActiveRoom, migrateGlobalAssets, ensureRooms, updateRoomUI, setStructureLock,
  updateStructureControls, applyTheme, initHistory, toast, normalizeState, assetRack,
  DEFAULT_ASSET_TYPES, DEFAULT_ASSET_STATUSES, DEFAULT_ASSET_SUBSTATUSES, renderAll, openHelpModal,
  closeHelpModal, switchHelpSection, bind;
export function configureCloudSync(deps){
  ({ applyRoomData, syncActiveRoom, migrateGlobalAssets, ensureRooms, updateRoomUI,
    setStructureLock, updateStructureControls, applyTheme, initHistory, toast, normalizeState,
    assetRack, DEFAULT_ASSET_TYPES, DEFAULT_ASSET_STATUSES, DEFAULT_ASSET_SUBSTATUSES, renderAll,
    openHelpModal, closeHelpModal, switchHelpSection, bind } = deps);
}

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

let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;

let cloudStatus = 'saved';
let lastCloudSnapshot = null;
const AUTOSAVE_STORAGE = 'dc-planner-autosave';
let autosaveEnabled = localStorage.getItem(AUTOSAVE_STORAGE) !== 'off';
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
// JSON com as chaves ordenadas: normalizeState() e cia. reatribuem campos e mudam
// a ordem das chaves sem mudar o conteúdo, e isso não pode contar como edição.
function stableStringify(v){
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(x=>stableStringify(x)??'null').join(',')+']';
  return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+stableStringify(v[k])).join(',')+'}';
}
// Usado só para saber se algo mudou desde o último salvamento. `updatedAt` da sala
// é renovado a cada syncActiveRoom() (que roda ao montar este próprio snapshot);
// sem tirá-lo, qualquer save() sem mudança real marcava "Alterações não salvas".
function projectSnapshotForCloud(){
  const payload=projectCloudPayload();
  (payload.rooms||[]).forEach(r=>{delete r.updatedAt;});
  return stableStringify(payload);
}
export function setCloudStatus(status){
  cloudStatus=status;
  const el=$('cloudStatus');
  if(!el)return;
  const map={saved:['✓','Salvo na nuvem','saved'],saving:['⟳','Salvando...','saving'],pending:['●','Alterações não salvas','pending'],error:['⚠','Não sincronizado','error']};
  const v=map[status]||map.saved;
  el.textContent=`${v[0]} ${v[1]}`; el.dataset.status=v[2]; el.title=v[1];
}
export function updatePlannerProjectName(){
  const el=$('plannerProjectName');
  if(el)el.textContent=String(state.projectName||'Data Center');
}

const ASSET_LOG_FIELDS = {
  name:'Nome', type:'Tipo', manufacturer:'Fabricante', model:'Modelo', assetTag:'Asset Tag', serial:'Serial Number',
  locationType:'Tipo de localização', locationName:'Localização', locationId:'Localização (ID)', stockId:'Estoque', roomId:'Sala', rackId:'Rack',
  uStart:'U inicial', uHeight:'Quantidade de U', status:'Status', substatus:'Substatus', ports:'Portas', powerW:'Potência (W)', weightKg:'Peso (kg)',
  purchaseDate:'Data de compra', warrantyExpiration:'Vencimento da garantia', endOfLife:'Fim de vida (EOL)', notes:'Observações'
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
export function assetLogDiff(oldAsset,newAsset){
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
export function recordAssetAudit({action,asset,before=null,after=null,changes=[]}){
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
  if(!cloud.cloudProjectId)return; // projeto ainda não tem id na nuvem; mantém a fila para a próxima tentativa
  const entries=pendingAssetAuditEntries;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user)return;
    const rows=entries.map(e=>({
      project_id:cloud.cloudProjectId,
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
  if(!cloud.cloudProjectId)throw new Error('Projeto não está salvo na nuvem.');
  const {data:{user}}=await supabaseClient.auth.getUser();
  if(!user)throw new Error('Sem sessão.');
  const {data,error}=await supabaseClient.from('asset_change_log').select('id,action,asset_id,user_id,user_email,asset_snapshot,changes,changed_at').eq('project_id',cloud.cloudProjectId).eq('asset_id',String(assetId)).eq('user_id',user.id).order('changed_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
export async function openAssetHistory(assetId){
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
    if(!cloud.cloudProjectId){list.innerHTML=`<div class="empty">Histórico indisponível: você está no modo convidado, sem conexão com a nuvem. Faça login com uma conta pra acompanhar o histórico de alterações.</div>`;}
    else list.innerHTML=`<div class="empty">Não foi possível carregar o histórico. Execute o SQL de migração da v16 no Supabase.</div>`;
  }
}
export function closeAssetHistory(){const m=$('assetHistoryModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');currentAssetHistoryAssetId=null;currentAssetHistoryRows=[];}

let currentAssetHistoryAssetId=null;
let currentAssetHistoryRows=[];
export async function exportCurrentAssetHistory(){
  if(!currentAssetHistoryAssetId || !currentAssetHistoryRows.length){toast('Nenhum histórico disponível para exportar.');return;}
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
  }catch(err){console.error('Exportar histórico:',err);toast('Não foi possível exportar o histórico.');}
}
function markCloudDirty(){
  const snap=projectSnapshotForCloud();
  cloud.cloudDirty=lastCloudSnapshot!==snap;
  if(cloud.cloudDirty)setCloudStatus('pending');
  else if(cloudStatus==='pending')setCloudStatus('saved'); // voltou ao estado salvo (ex.: desfez a edição)
  return cloud.cloudDirty;
}
export function scheduleCloudSave(){
  if(!cloudReady) return;
  markCloudDirty();
  if(!autosaveEnabled) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>saveProjectToCloud(false),900);
}
export function updateAutosaveUI(){
  const toggle=$('autosaveToggle');
  const label=$('autosaveLabel');
  if(toggle) toggle.checked=autosaveEnabled;
  if(label) label.textContent=autosaveEnabled?'Autosave':'Autosave';
  if(toggle){
    toggle.title=autosaveEnabled?'Desativar salvamento automático':'Ativar salvamento automático';
    toggle.setAttribute('aria-label',toggle.title);
  }
}
export function setAutosaveEnabled(enabled){
  autosaveEnabled=!!enabled;
  localStorage.setItem(AUTOSAVE_STORAGE,autosaveEnabled?'on':'off');
  clearTimeout(cloudSaveTimer);
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloud.cloudDirty?'pending':'saved');
  if(autosaveEnabled && cloudReady) scheduleCloudSave();
  toast(autosaveEnabled?'Autosave ativado':'Autosave desativado');
}

export async function saveProjectToCloud(showToast=true){
  if(!cloudReady) return false;
  if(!cloud.cloudProjectId && !state.projectName) return false;
  if(lastCloudSnapshot===projectSnapshotForCloud() && cloud.cloudProjectId){ cloud.cloudDirty=false; setCloudStatus('saved'); flushAssetAuditQueue(); return true; }
  setCloudStatus('saving');
  if(cloudSaveInFlight){ cloudSaveQueued=true; return; }
  cloudSaveInFlight=true;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user) return;
    const payload=projectCloudPayload();
    const name=String(state.projectName||'Data Center').trim()||'Data Center';
    let result;
    if(cloud.cloudProjectId){
      result=await supabaseClient.from('projects').update({name,data:payload,updated_at:new Date().toISOString()}).eq('id',cloud.cloudProjectId).eq('user_id',user.id).select('id').single();
      if(result.error && (result.error.code==='PGRST116' || result.error.code==='22P02')) cloud.cloudProjectId=null;
    }
    if(!cloud.cloudProjectId){
      result=await supabaseClient.from('projects').insert({user_id:user.id,name,data:payload}).select('id').single();
      if(!result.error) cloud.cloudProjectId=result.data.id;
    }
    if(result?.error) throw result.error;
    localStorage.setItem(`${runtime.STORAGE}-cloud-id`,cloud.cloudProjectId);
    lastCloudSnapshot=projectSnapshotForCloud();
    cloud.cloudDirty=false;
    setCloudStatus('saved');
    flushAssetAuditQueue();
    if(showToast) toast('Projeto salvo na nuvem');
    return true;
  }catch(err){
    console.error('Supabase project save:',err);
    cloud.cloudDirty=true;
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
      const savedId=localStorage.getItem(`${runtime.STORAGE}-cloud-id`);
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

    cloud.cloudProjectId=data.id;
    localStorage.setItem(`${runtime.STORAGE}-cloud-id`,cloud.cloudProjectId);
    updateRoomUI();
    applyTheme();
    lastCloudSnapshot=projectSnapshotForCloud();
    cloud.cloudDirty=false;
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

export async function importProject(file){
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

    runtime.pan=null;
    initHistory(cloud.cloudProjectId,state.activeRoomId,true);
    updateRoomUI();
    applyTheme();
    renderAll(false);
    cloud.cloudDirty=true;
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
  try{const d=new Date(v);return `${new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium'}).format(d)}, ${new Intl.DateTimeFormat('pt-BR',{timeStyle:'short'}).format(d)}`;}catch(_){return v;}
}
function closeProjectMenus(){document.querySelectorAll('.project-menu-panel').forEach(x=>x.remove());}
export function showDashboard(){
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
let dashboardProjects=[], projectsQuery='', projectsSort='recent';
let projectsView=(()=>{try{return localStorage.getItem('dccp_projects_view')==='grid'?'grid':'list';}catch(_){return 'list';}})();
const PROJECT_STAT_ICONS={
  rooms:'<path d="M4 21V5.5L12 3l8 2.5V21"/><path d="M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/>',
  rows:'<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  racks:'<rect x="3" y="3" width="18" height="5" rx="1.2"/><rect x="3" y="9.5" width="18" height="5" rx="1.2"/><rect x="3" y="16" width="18" height="5" rx="1.2"/><path d="M7 5.5h.01M7 12h.01M7 18.5h.01"/>',
  cables:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trays:'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 11h18"/>'
};
function projectStatChip(kind,n,one,many){return `<span class="project-stat"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PROJECT_STAT_ICONS[kind]}</svg><span class="project-stat-text"><b>${n}</b><small>${n===1?one:many}</small></span></span>`;}
function visibleDashboardProjects(){
  const q=projectsQuery.trim().toLowerCase();
  const list=q?dashboardProjects.filter(p=>String(p.name||'').toLowerCase().includes(q)):dashboardProjects.slice();
  const time=p=>new Date(p.updated_at||p.created_at||0).getTime()||0;
  const byName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{numeric:true,sensitivity:'base'});
  const sorters={recent:(a,b)=>time(b)-time(a),oldest:(a,b)=>time(a)-time(b),name:byName,nameDesc:(a,b)=>byName(b,a)};
  return list.sort(sorters[projectsSort]||sorters.recent);
}
function syncDashboardControls(){
  $('projectsViewList')?.classList.toggle('is-active',projectsView==='list');
  $('projectsViewGrid')?.classList.toggle('is-active',projectsView==='grid');
  syncSelectButton('projectsSort','projectsSortBtn');
}
function paintDashboardProjects(){
  const grid=$('projectsGrid'); if(!grid||!dashboardProjects.length)return;
  grid.classList.toggle('is-grid',projectsView==='grid');
  const projects=visibleDashboardProjects();
  if(!projects.length){grid.innerHTML='<div class="dashboard-loading">Nenhum projeto encontrado.</div>';return;}
  grid.innerHTML=projects.map(project=>{
    const st=projectStats(project);
    return `<article class="project-card" data-project-card="${esc(project.id)}">
      <div class="project-card-head"><div class="project-icon"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8 13h8M8 17h5"/></svg></div><div class="project-title-block"><h3 class="project-name">${esc(project.name||'Projeto sem nome')}</h3><div class="project-date">${project.updated_at?`Atualizado em ${esc(formatProjectDate(project.updated_at))}`:'Sem data de atualização'}</div></div></div>
      <div class="project-stats">${projectStatChip('rooms',st.rooms,'sala','salas')}${projectStatChip('rows',st.rows,'fileira','fileiras')}${projectStatChip('racks',st.racks,'rack','racks')}${projectStatChip('cables',st.cables,'cabo','cabos')}${projectStatChip('trays',st.trays,'calha','calhas')}</div>
      <div class="project-menu"><button class="btn ghost" data-project-menu="${esc(project.id)}" title="Mais opções" aria-label="Mais opções">⋮</button></div>
      <div class="project-actions"><button class="btn primary" data-project-open="${esc(project.id)}">Abrir</button></div>
    </article>`;
  }).join('');
  grid.querySelectorAll('[data-project-open]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openCloudProject(b.dataset.projectOpen);}));
  grid.querySelectorAll('[data-project-menu]').forEach(b=>b.addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation(); closeProjectMenus();
    const project=dashboardProjects.find(x=>String(x.id)===String(b.dataset.projectMenu));
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
}
async function renderDashboardProjects(){
  const grid=$('projectsGrid'),empty=$('projectsEmpty');
  if(!grid)return;
  grid.innerHTML='<div class="dashboard-loading">Carregando projetos...</div>'; empty?.classList.add('hidden');
  syncDashboardControls();
  try{
    dashboardProjects=await fetchCloudProjects();
    if(!dashboardProjects.length){grid.innerHTML='';empty?.classList.remove('hidden');return;}
    paintDashboardProjects();
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
    initHistory(cloud.cloudProjectId);
    centerCanvasOnContent();
    setStructureLock(state.structureLocked,false);
    updateStructureControls();
    // Projetos antigos são ajustados ao montar a tela (campos novos de asset, geometria
    // das calhas). Isso não é edição do usuário: a linha de base para "Alterações não
    // salvas" passa a ser o estado já ajustado, e não o que veio da nuvem.
    lastCloudSnapshot=projectSnapshotForCloud();
    cloud.cloudDirty=false;
    setCloudStatus('saved');
    toast('Projeto aberto');
  }catch(err){
    console.error('Open project UI:',err);
    toast(`Projeto carregado, mas houve um erro ao montar a interface: ${err?.message||'erro desconhecido'}`);
  }
}
function resetStateForNewProject(name='Data Center'){
  const keepTheme=state.theme;
  state.projectName=name;state.rackUnits=48;state.rackWidth=.60;state.rackDepth=1.20;state.rackGap=0;state.rackPowerCapacityW=0;state.rackWeightCapacityKg=0;state.defaultRowGap=1.20;state.lastUToTray=1.00;state.defaultSlack=10;state.rows=[];state.racks=[];state.cables=[];state.trays=[];state.trayLinks=[];state.trayRackLinks=[];state.assets=[];state.snapToEdges=true;state.assetCatalogs={types:[...DEFAULT_ASSET_TYPES],manufacturers:[],models:[],statuses:[...DEFAULT_ASSET_STATUSES],substatuses:[...DEFAULT_ASSET_SUBSTATUSES]}; state.locations=[];state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];state.theme=keepTheme;state.rooms=[];state.activeRoomId=null;ensureRooms();
  cloud.cloudProjectId=null;
  lastCloudSnapshot=null;
  cloud.cloudDirty=true;
  setCloudStatus('pending');
  updatePlannerProjectName();
  localStorage.removeItem(`${runtime.STORAGE}-cloud-id`);
  normalizeState();
}
export async function createNewCloudProject(){
  const name=await uiPrompt('Dê um nome para o novo projeto.','Data Center',{title:'Novo projeto',label:'Nome do projeto',confirmText:'Criar projeto'});
  if(name===null)return;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject(String(name).trim()||'Data Center');
  cloudReady=true;
  await saveProjectToCloud(true);
  renderAll(false);initHistory(cloud.cloudProjectId);hideDashboard();toast('Novo projeto criado');
}
async function renameCloudProject(project){
  closeProjectMenus();
  const name=await uiPrompt('Digite o novo nome do projeto.',project.name||'Projeto',{title:'Renomear projeto',label:'Nome do projeto',confirmText:'Salvar'});
  if(name===null)return;
  const next=String(name).trim();if(!next)return;
  try{const {error}=await supabaseClient.from('projects').update({name:next,updated_at:new Date().toISOString()}).eq('id',project.id);if(error)throw error; if(cloud.cloudProjectId===project.id){state.projectName=next;updatePlannerProjectName();lastCloudSnapshot=projectSnapshotForCloud();cloud.cloudDirty=false;setCloudStatus('saved');} await renderDashboardProjects();toast('Projeto renomeado');}catch(err){console.error(err);toast('Não foi possível renomear o projeto');}
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
  try{const {error}=await supabaseClient.from('projects').delete().eq('id',project.id);if(error)throw error;if(cloud.cloudProjectId===project.id){cloud.cloudProjectId=null;localStorage.removeItem(`${runtime.STORAGE}-cloud-id`);}await renderDashboardProjects();toast('Projeto excluído');}catch(err){console.error(err);toast('Não foi possível excluir o projeto');}
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
  cloudReady=false; cloud.cloudProjectId=null;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject('Meu Projeto');
  renderAll(false); initHistory(null); hideDashboard();
  const saveBtn=$('btnSave'); if(saveBtn){saveBtn.disabled=true;saveBtn.title='Indisponível no modo convidado — use Exportar/Importar projeto.';}
  toast('Modo convidado: use Exportar/Importar projeto para salvar seu trabalho.');
}
function unlockApp(user, forceDashboard=false){
  if(user?.id){ runtime.STORAGE = `dc-planner-v7-user-${user.id}`; }
  document.body.classList.remove("auth-locked"); $("authScreen")?.classList.add("hidden"); $("authScreen")?.setAttribute("aria-hidden","true");
  // Se o usuário tinha entrado no modo convidado antes e agora fez login de
  // verdade (sem recarregar a página), remove a marca de convidado — senão
  // o botão "Salvar na nuvem" ficaria preso desativado mesmo estando logado.
  document.body.classList.remove('guest-mode');
  const saveBtn=$('btnSave'); if(saveBtn){saveBtn.disabled=false;saveBtn.removeAttribute('title');}
  const e=$("authUserEmail"); if(e){e.textContent=user?.email||"";} const av=$("userAvatar"); if(av)av.textContent=(user?.email||"").charAt(0).toUpperCase();
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

export async function startAuth(){
  applyTheme();
  lockApp();
  showAuthView('authLoginView');
  $('btnGuestMode')?.addEventListener('click',enterGuestMode);
  bindPasswordToggles();
  $('dashboardNewProject').onclick=createNewCloudProject; $('dashboardNewProjectEmpty').onclick=createNewCloudProject; $('dashboardLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  bindStyledSelect('projectsSort','projectsSortBtn');
  $('projectsSort')?.addEventListener('change',()=>{projectsSort=$('projectsSort').value;syncDashboardControls();paintDashboardProjects();});
  $('projectsSearch')?.addEventListener('input',()=>{projectsQuery=$('projectsSearch').value;paintDashboardProjects();});
  [['projectsViewList','list'],['projectsViewGrid','grid']].forEach(([id,v])=>$(id)?.addEventListener('click',()=>{projectsView=v;try{localStorage.setItem('dccp_projects_view',v);}catch(_){}syncDashboardControls();paintDashboardProjects();}));
  syncDashboardControls();
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
  // Menu da conta: avatar + seta; o painel (e-mail + Sair) é criado no body, como os menus de projeto.
  $('userMenuBtn')?.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    const btn=$('userMenuBtn'), wasOpen=!!document.querySelector('.user-menu-panel');
    closeProjectMenus(); btn.setAttribute('aria-expanded','false');
    if(wasOpen)return;
    const panel=document.createElement('div'); panel.className='project-menu-panel user-menu-panel'; panel.setAttribute('role','menu');
    panel.innerHTML=`<div class="user-menu-email">${esc($('authUserEmail')?.textContent||'Modo convidado')}</div><div class="menu-divider"></div><button type="button" role="menuitem" data-action="logout"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>Sair</button>`;
    document.body.appendChild(panel);
    const r=btn.getBoundingClientRect(), pw=panel.offsetWidth||200;
    panel.style.left=Math.max(8,Math.min(window.innerWidth-pw-8,r.right-pw))+'px';
    panel.style.top=(r.bottom+6)+'px';
    requestAnimationFrame(()=>panel.classList.add('open'));
    btn.setAttribute('aria-expanded','true');
    panel.querySelector('[data-action="logout"]').addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();closeProjectMenus();btn.setAttribute('aria-expanded','false');$('btnLogout')?.click();});
  });
  document.addEventListener('click',()=>{if(!document.querySelector('.user-menu-panel'))$('userMenuBtn')?.setAttribute('aria-expanded','false');});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.user-menu-panel')){closeProjectMenus();$('userMenuBtn')?.setAttribute('aria-expanded','false');}});
  $('helpClose')?.addEventListener('click',closeHelpModal);
  document.querySelectorAll('[data-help-section]').forEach(b=>b.onclick=()=>switchHelpSection(b.dataset.helpSection));
  $('canvasEmptyHintClose')?.addEventListener('click',()=>{localStorage.setItem('dccp_hint_dismissed','1');$('canvasEmptyHint')?.classList.add('hidden');});
  $('canvasEmptyHintHelp')?.addEventListener('click',openHelpModal);
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){lockApp();showAuthView('authResetView');return;}
    if(session?.user){ unlockApp(session.user, event==='SIGNED_IN' && !appStarted); } else if(event==='SIGNED_OUT'){ cloudReady=false; cloud.cloudProjectId=null; appStarted=false; $('dashboardScreen')?.classList.add('hidden'); $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden'); appView=null; lockApp(); showAuthView('authLoginView'); $('loginPassword').value=''; }
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

