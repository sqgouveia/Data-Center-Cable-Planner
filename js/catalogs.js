import { uid, cloneData, esc, num, $, catalogNormalize, catalogSimilarity, catalogKeyLabel, buildPortRange, totalPortDefsCount } from './utils.js';
import { state } from './state.js';
import { uiConfirm, uiPrompt } from './dialogs.js';
import { importSession, assetStatusValues, validateAssetImportRows, renderEditableAssetImportPreview, updateImportPreviewSummary, validateCatalogImportRows, renderCatalogSinglePreviewRows } from './inventory-import.js';
import { renderCables } from './cables.js';

// Estado mutável compartilhado com app.js. Vive num objeto porque um `let` de módulo
// não pode ser reatribuído por quem importa.
export const catalogs = { catalogEditorPortDefs: [] };

// Funções e constantes que continuam em app.js; injetadas por configureCatalogs()
// para evitar import circular com app.js.
let applyRoomData, updateRoomUI, normalizeCableCatalogs, cableTypeNames, defaultCableType, toast,
  save, render, normalizeLocations, assetSubstatusValues, renderAssetsList,
  bayfaceAssetTypeClass, openBayface, renderAll;
export function configureCatalogs(deps){
  ({ applyRoomData, updateRoomUI, normalizeCableCatalogs, cableTypeNames, defaultCableType, toast,
    save, render, normalizeLocations, assetSubstatusValues,
    renderAssetsList, bayfaceAssetTypeClass, openBayface, renderAll } = deps);
}

export const DEFAULT_ASSET_TYPES=['Servidor','Switch','Storage','PDU','Patch Panel','Firewall','Roteador','Outro'];
export const DEFAULT_ASSET_STATUSES=['Arquivado','Instalado','Reservado','Desligado','Estoque'];
export const DEFAULT_ASSET_SUBSTATUSES=['Em estoque','Ligado','Desligado','Disposed','Perdido','Retired','Retornado ao Vendor'];
export function normalizeAssetCatalogs(){
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
export function bayfaceTypeColor(type){normalizeAssetCatalogs();return state.assetCatalogs.typeColors?.[type]||defaultBayfaceTypeColor(type);}
function setBayfaceTypeColor(type,color){normalizeAssetCatalogs();state.assetCatalogs.typeColors[type]=color;save();if($('bayfaceModal')?.classList.contains('open')){const rid=$('bayfaceModal').dataset.rackId;if(rid)openBayface(rid);}}
export function renderCableTypesCatalog(){
  normalizeCableCatalogs();
  const el=$('catalogCableTypes'); if(!el)return;
  const types=state.cableCatalogs.types;
  const q=String($('catalogCableTypeSearch')?.value||'').toLowerCase().trim();
  const filtered=types.map((t,i)=>({t,i})).filter(({t})=>!q||t.name.toLowerCase().includes(q));
  el.innerHTML=filtered.map(({t,i})=>`<div class="catalog-row"><span title="${esc(t.name)}">${esc(t.name)}</span><div><input type="color" class="catalog-color-swatch" data-cable-type-color="${i}" value="${esc(t.color)}" title="Cor deste tipo"><button type="button" class="iconbtn" data-cable-type-edit="${i}" title="Editar">✎</button><button type="button" class="iconbtn danger-icon" data-cable-type-delete="${i}" title="Excluir">×</button></div></div>`).join('')||'<div class="empty">Nenhum tipo cadastrado.</div>';
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
export function renderAssetCatalogs(){
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
    const totalRooms=filtered.reduce((n,{rooms})=>n+rooms.length,0);
    const totalStocks=filtered.reduce((n,{stocks})=>n+stocks.length,0);
    if($('locationsFooterStats'))$('locationsFooterStats').textContent=`${filtered.length} data center${filtered.length===1?'':'s'} · ${totalRooms} sala${totalRooms===1?'':'s'} · ${totalStocks} estoque${totalStocks===1?'':'s'}`;
    const locationCols=Math.max(1,Math.min(4,filtered.length));
    locEl.style.gridTemplateColumns=`repeat(${locationCols}, 235px)`;
    locEl.innerHTML=filtered.map(({l,rooms,stocks})=>{
      const roomRows=rooms.filter(r=>!locQ||r.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(r=>{
        const t=roomThermalLoad(r);
        const cap=t.capacity>0?`<small class="location-child-capacity cap-${t.level}">${t.watts}W / ${t.capacity}W</small>`:'<small class="location-child-capacity">—</small>';
        return `<div class="location-child-row"><span class="location-child-icon room"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="10" height="20" rx="1"/><path d="M11 12h.01"/></svg></span><div class="location-child-text"><span class="location-child-name">${esc(r.name)}</span>${cap}</div><div class="location-child-kebab"><button type="button" class="iconbtn" data-menu-toggle title="Mais ações">⋮</button><div class="mini-menu hidden"><button type="button" data-location-room-edit="${esc(r.id)}">Editar sala</button><button type="button" class="danger" data-location-room-delete="${esc(r.id)}">Excluir sala</button></div></div></div>`;
      }).join('');
      const stockRows=stocks.filter(st=>!locQ||st.name.toLowerCase().includes(locQ)||l.name.toLowerCase().includes(locQ)).map(st=>`<div class="location-child-row"><span class="location-child-icon stock"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg></span><div class="location-child-text"><span class="location-child-name">${esc(st.name)}</span></div><div class="location-child-kebab"><button type="button" class="iconbtn" data-menu-toggle title="Mais ações">⋮</button><div class="mini-menu hidden"><button type="button" data-location-stock-edit="${esc(l.id)}:${esc(st.id)}">Editar estoque</button><button type="button" class="danger" data-location-stock-delete="${esc(l.id)}:${esc(st.id)}">Excluir estoque</button></div></div></div>`).join('');
      return `<div class="location-group">
        <div class="location-dc-row">
          <span class="location-dc-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/></svg></span>
          <div class="location-dc-info"><strong>${esc(l.name)}</strong><small>${rooms.length} sala${rooms.length===1?'':'s'} · ${stocks.length} estoque${stocks.length===1?'':'s'}</small></div>
          <div class="location-dc-kebab">
            <button type="button" class="iconbtn" data-menu-toggle title="Mais ações">⋮</button>
            <div class="mini-menu hidden">
              <button type="button" data-location-edit="${esc(l.id)}">Renomear</button>
              <button type="button" class="danger" data-location-delete="${esc(l.id)}">Excluir Data Center</button>
            </div>
          </div>
        </div>
        <div class="location-subsection">
          <div class="location-subsection-head"><button type="button" class="location-collapse-toggle" data-collapse-toggle title="Recolher/expandir">▾</button><span class="location-subsection-title">Salas <small>(${rooms.length})</small></span><button type="button" class="btn ghost small" data-location-room="${esc(l.id)}">＋ Sala</button></div>
          <div class="location-subsection-list">${roomRows||'<div class="empty">Nenhuma sala.</div>'}</div>
        </div>
        <div class="location-subsection">
          <div class="location-subsection-head"><button type="button" class="location-collapse-toggle" data-collapse-toggle title="Recolher/expandir">▾</button><span class="location-subsection-title">Estoques <small>(${stocks.length})</small></span><button type="button" class="btn ghost small" data-location-stock="${esc(l.id)}">＋ Estoque</button></div>
          <div class="location-subsection-list">${stockRows||'<div class="empty">Nenhum estoque.</div>'}</div>
        </div>
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
export function roomThermalLoad(room){
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
export function openRoomEditor(roomId){
  const room=state.rooms.find(r=>r.id===roomId); if(!room)return;
  $('roomEditorId').value=room.id;
  $('roomEditorName').value=room.name;
  $('roomEditorCooling').value=room.coolingCapacityW>0?room.coolingCapacityW:'';
  renderRoomEditorThermalReadout(room);
  const m=$('roomEditorModal'); m.classList.add('open'); m.classList.remove('hidden'); m.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>$('roomEditorName')?.focus());
}
export function closeRoomEditor(){const m=$('roomEditorModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
export function saveRoomEditor(){
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
  save(); renderAssetCatalogs(); updateRoomUI(); closeRoomEditor(); toast('Sala atualizada');
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
export async function addAssetLocation(){normalizeLocations();const name=await uiPrompt('Dê um nome para o novo Data Center / localização.','DC AZ2',{title:'Nova localização',label:'Nome do Data Center',confirmText:'Criar localização'});if(!name?.trim())return;const n=name.trim();if(state.locations.some(l=>catalogNormalize(l.name)===catalogNormalize(n))){toast('Essa localização já existe.');return;}state.locations.push({id:uid('loc'),name:n,rooms:[],stocks:[{id:uid('stock'),name:'Estoque Principal'}]});save();renderAssetCatalogs();toast('Localização criada');}
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
const CATALOG_MODAL_ICON='<path d="m9 2 1.5 1.5L14 6l-8 8-4 1 1-4 8-8Z"/><path d="M13 5.5 16 2l4.5 4.5L17 10"/>';
const LOCATIONS_MODAL_ICON='<path d="M12 21s7-5.2 7-12A7 7 0 1 0 5 9c0 6.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>';
export function openAssetCatalogModal(){normalizeAssetCatalogs();renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderCableTypesCatalog();const m=$('assetCatalogModal');if(!m)return;m.classList.remove('locations-only');$('assetCatalogTitle').textContent='Cadastros';m.querySelector('.catalog-modal-head span').textContent='Tipos de ativo, fabricantes, modelos, status, substatus, tipos de cabo e localizações usados no sistema.';const icon=m.querySelector('.catalog-modal-head .modal-icon svg');if(icon)icon.innerHTML=CATALOG_MODAL_ICON;m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
export function openLocationsModal(){normalizeLocations();renderAssetCatalogs();const m=$('assetCatalogModal');if(!m)return;m.classList.add('locations-only');$('assetCatalogTitle').textContent='Localizações';m.querySelector('.catalog-modal-head span').textContent='Gerencie Data Centers, salas e estoques.';const icon=m.querySelector('.catalog-modal-head .modal-icon svg');if(icon)icon.innerHTML=LOCATIONS_MODAL_ICON;m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='300';}
export function closeAssetCatalogModal(){const m=$('assetCatalogModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');closeCatalogEditor();}
export function renderAssetCatalogManufacturerSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelManufacturer');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os fabricantes</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.manufacturers.includes(current)?current:'';
}
export function renderAssetCatalogTypeSelect(){
  normalizeAssetCatalogs();const el=$('catalogModelType');if(!el)return;const current=el.value||'';el.innerHTML='<option value="">Todos os tipos</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');el.value=current&&state.assetCatalogs.types.includes(current)?current:'';
}

export function renderCatalogPortDefsEditor(){
  const list=$('catalogPortDefsList'); if(!list)return;
  const total=totalPortDefsCount(catalogs.catalogEditorPortDefs);
  if($('catalogPortDefsTotal'))$('catalogPortDefsTotal').textContent=total;
  list.innerHTML=catalogs.catalogEditorPortDefs.length?catalogs.catalogEditorPortDefs.map(def=>{
    if(def.kind==='range'){
      const range=buildPortRange(def.startLabel,def.endLabel);
      const count=range?range.length:0;
      return `<div class="port-def-row"><div><b>${esc(def.startLabel)} – ${esc(def.endLabel)}</b><small>${count} porta${count===1?'':'s'}${def.poe?' · PoE':''}${!range?' · padrão inválido':''}</small></div><button type="button" class="iconbtn danger-icon" data-portdef-remove="${esc(def.id)}" title="Remover">×</button></div>`;
    }
    return `<div class="port-def-row"><div><b>${esc(def.label)}</b><small>1 porta${def.poe?' · PoE':''}</small></div><button type="button" class="iconbtn danger-icon" data-portdef-remove="${esc(def.id)}" title="Remover">×</button></div>`;
  }).join(''):`<div class="port-defs-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8.5h.01"/></svg><b>Nenhuma porta definida ainda.</b><span>Adicione as portas de rede disponíveis neste modelo.</span></div>`;
  list.querySelectorAll('[data-portdef-remove]').forEach(b=>b.onclick=()=>{catalogs.catalogEditorPortDefs=catalogs.catalogEditorPortDefs.filter(d=>d.id!==b.dataset.portdefRemove);renderCatalogPortDefsEditor();});
}
export function openCatalogEditor(key,id=null){
  normalizeAssetCatalogs(); const m=$('catalogEditorModal'); if(!m)return;
  $('catalogEditorKind').value=key; $('catalogEditorId').value=id||'';
  const title=$('catalogEditorTitle'), subtitle=$('catalogEditorSubtitle'), typeWrap=$('catalogEditorTypeWrap'), manWrap=$('catalogEditorManufacturerWrap'), portsWrap=$('catalogEditorPortsWrap'), powerWrap=$('catalogEditorPowerWrap'), weightWrap=$('catalogEditorWeightWrap');
  const isModel=key==='models';
  const isStatus=key==='statuses';
  let item=null;
  if(id){item=isModel?state.assetCatalogs.models.find(x=>x.id===id):state.assetCatalogs[key]?.[Number(id)];}
  title.textContent=id?(isModel?'Editar modelo':`Editar ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`):(isModel?'Novo modelo':`Novo ${key==='types'?'tipo de ativo':key==='statuses'?'status':'fabricante'}`);
  subtitle.textContent=isModel?'Defina o tipo e o fabricante ao qual este modelo pertence.':'Cadastre um valor que poderá ser usado no inventário.';
  // Chrome do formulário: passos numerados, rótulos e ícones do modo "modelo"
  // só aparecem quando o cadastro é de fato um modelo.
  m.querySelector('.catalog-editor-card')?.classList.toggle('is-model',isModel);
  if($('catalogEditorNameLabel'))$('catalogEditorNameLabel').innerHTML=isModel?'Nome do modelo <i class="req">*</i>':'Nome <i class="req">*</i>';
  if($('catalogEditorName'))$('catalogEditorName').placeholder=isModel?'Digite o nome do modelo':'Digite o nome';
  if($('catalogEditorSaveLabel'))$('catalogEditorSaveLabel').textContent=isModel?'Salvar modelo':'Salvar';
  if($('catalogStepBasicTitle'))$('catalogStepBasicTitle').textContent=isModel?'Informações básicas':'Dados do cadastro';
  if($('catalogStepBasicHint'))$('catalogStepBasicHint').textContent=isModel?'Dados gerais do modelo':'Dados gerais do cadastro';
  if($('catalogEditorHelpText'))$('catalogEditorHelpText').textContent=isModel?'Modelos são vinculados ao tipo e ao fabricante selecionados.':'Valores cadastrados ficam disponíveis no inventário de assets.';
  $('catalogEditorName').value=isModel?(item?.name||''):(item||'');
  typeWrap.classList.toggle('hidden',!isModel);manWrap.classList.toggle('hidden',!isModel);portsWrap?.classList.toggle('hidden',!isModel);powerWrap?.classList.toggle('hidden',!isModel);weightWrap?.classList.toggle('hidden',!isModel);
  if(isModel){
    $('catalogEditorType').innerHTML=state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorManufacturer').innerHTML='<option value="">Selecione o fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('catalogEditorType').value=item?.type||state.assetCatalogs.types[0]||'';
    $('catalogEditorManufacturer').value=item?.manufacturer||'';
    if($('catalogEditorPowerW'))$('catalogEditorPowerW').value=item?.powerW||'';
    if($('catalogEditorWeightKg'))$('catalogEditorWeightKg').value=item?.weightKg||'';
    catalogs.catalogEditorPortDefs=item?.portDefs?cloneData(item.portDefs):(item?.portCount?[{id:uid('portdef'),kind:'range',startLabel:'Porta 1',endLabel:`Porta ${item.portCount}`,poe:false}]:[]);
    ['portRangeStart','portRangeEnd'].forEach(id=>{if($(id))$(id).value='';});
    if($('portRangePoe'))$('portRangePoe').checked=false;
    if($('portSingleName'))$('portSingleName').value='';
    if($('portSinglePoe'))$('portSinglePoe').checked=false;
    renderCatalogPortDefsEditor();
  }
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='1200';requestAnimationFrame(()=>$('catalogEditorName')?.focus());
}
export function closeCatalogEditor(){const m=$('catalogEditorModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
export async function saveCatalogEditor(){
  normalizeAssetCatalogs();
  const key=$('catalogEditorKind').value;
  const id=$('catalogEditorId').value;
  const name=$('catalogEditorName').value.trim();
  if(!name){toast('Informe um nome.');return;}

  // Capture the import context BEFORE changing catalog state or closing the modal.
  // This is the source of truth for inline creation from an import row.
  const createCtx = importSession.catalogCreate ? {...importSession.catalogCreate} : null;
  const importCtx = (importSession.pending?.kind==='catalogs-single' && Array.isArray(importSession.pending?.rows))
    ? {rows:importSession.pending.rows, kind:importSession.pending.kind}
    : null;

  if(key==='models'){
    const type=$('catalogEditorType').value, manufacturer=$('catalogEditorManufacturer').value;
    if(!type||!manufacturer){toast('Selecione o tipo e o fabricante.');return;}
    const duplicate=state.assetCatalogs.models.some(m=>m.id!==id&&catalogNormalize(m.name)===catalogNormalize(name)&&catalogNormalize(m.type)===catalogNormalize(type)&&catalogNormalize(m.manufacturer)===catalogNormalize(manufacturer));
    if(duplicate){toast('Esse modelo já existe para esse tipo e fabricante.');return;}
    const similar=state.assetCatalogs.models.filter(m=>m.id!==id&&catalogNormalize(m.type)===catalogNormalize(type)&&catalogNormalize(m.manufacturer)===catalogNormalize(manufacturer)).map(m=>m.name).filter(v=>catalogSimilarity(v,name)>=0.84);
    if(similar.length&&!(await uiConfirm(`Novo: ${name}\nJá cadastrado: ${similar[0]}`,{title:'Possível modelo duplicado',confirmText:'Cadastrar mesmo assim'})))return;
    let savedModel=null;
    const portCount=totalPortDefsCount(catalogs.catalogEditorPortDefs);
    const powerW=Math.max(0,Math.floor(num($('catalogEditorPowerW')?.value,0)));
    const weightKg=Math.max(0,num($('catalogEditorWeightKg')?.value,0));
    if(id){const m=state.assetCatalogs.models.find(x=>x.id===id);if(!m)return;m.name=name;m.type=type;m.manufacturer=manufacturer;m.portDefs=cloneData(catalogs.catalogEditorPortDefs);m.portCount=portCount;m.powerW=powerW;m.weightKg=weightKg;savedModel=m;}
    else {savedModel={id:uid('model'),name,type,manufacturer,portDefs:cloneData(catalogs.catalogEditorPortDefs),portCount,powerW,weightKg};state.assetCatalogs.models.push(savedModel);}
    state.assetCatalogs.models.sort((a,b)=>(a.type+' '+a.manufacturer+' '+a.name).localeCompare(b.type+' '+b.manufacturer+' '+b.name,'pt-BR'));
    if(importSession.modelIndex!==null && importSession.pending?.rows?.[importSession.modelIndex]){
      const item=importSession.pending.rows[importSession.modelIndex];
      item.data.Modelo=savedModel.name; item.data.Tipo=savedModel.type||''; item.data.Fabricante=savedModel.manufacturer||'';
      item._modelMissing=false; item._validated=false; item.valid=false; item.message='';
      importSession.modelIndex=null;
      save(); closeCatalogEditor();
      renderAssetCatalogManufacturerSelect();renderAssetCatalogTypeSelect();renderAssetCatalogs();renderAssetCatalogSelects();
      validateAssetImportRows(importSession.pending.rows);
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
      importSession.catalogCreate=null;
      toast('Cadastro criado e importação revalidada automaticamente');
      return;
    }
  }
  importSession.catalogCreate=null;
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
export function renderAssetCatalogSelects(preserve={}){
  normalizeAssetCatalogs();
  const typeEl=$('assetType'),manEl=$('assetManufacturer'),modelEl=$('assetModel');
  if(typeEl){const current=preserve.assetType!==undefined?preserve.assetType:typeEl.value;typeEl.innerHTML='<option value="">Selecione o tipo</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');typeEl.value=current||'';}
  if(manEl){const current=preserve.assetManufacturer!==undefined?preserve.assetManufacturer:manEl.value;manEl.innerHTML='<option value="">Sem fabricante</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');manEl.value=current&&state.assetCatalogs.manufacturers.includes(current)?current:'';}
  const statusEl=$('assetStatus'); if(statusEl){const current=preserve.assetStatus!==undefined?preserve.assetStatus:statusEl.value;statusEl.innerHTML=assetStatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');statusEl.value=assetStatusValues().includes(current)?current:(assetStatusValues()[0]||'');}
  const subEl=$('assetSubstatus'); if(subEl){const current=preserve.assetSubstatus!==undefined?preserve.assetSubstatus:subEl.value;subEl.innerHTML='<option value="">Selecione o substatus</option>'+assetSubstatusValues().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');subEl.value=assetSubstatusValues().includes(current)?current:'';}
  if(modelEl){const current=preserve.assetModel!==undefined?preserve.assetModel:modelEl.value;const models=[...state.assetCatalogs.models].sort((a,b)=>(a.name+' '+a.manufacturer).localeCompare(b.name+' '+b.manufacturer,'pt-BR'));modelEl.innerHTML='<option value="">Sem modelo</option>'+models.map(m=>`<option value="${esc(m.name)}">${esc(m.name)}${m.manufacturer?' — '+esc(m.manufacturer):''}</option>`).join('');modelEl.value=models.some(m=>m.name===current)?current:'';}
}
