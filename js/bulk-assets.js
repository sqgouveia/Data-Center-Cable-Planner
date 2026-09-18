import { uid, esc, num, $ } from './utils.js';
import { state } from './state.js';
import { isAssetArchived, assetOccupancy, occupiedUnits } from './occupancy.js';
import { importSession, assetStatusValues, makeAssetsTemplate, closeImportPreview, catalogSingleTemplate, openCatalogSingleImport, importCatalogSingleWorkbook, importAssetsWorkbook } from './inventory-import.js';
import { recordAssetAudit } from './cloud-sync.js';

// Funções e constantes que continuam em app.js; injetadas por configureBulkAssets()
// para evitar import circular com app.js.
let toast, save, assetRack, normalizeAssetCatalogs, normalizeLocations, assetLocationDcName,
  assetSubstatusValues, normalizeAssets, autoFillAssetFromModel, renderAssetsList, renderBayface,
  renderAll;
export function configureBulkAssets(deps){
  ({ toast, save, assetRack, normalizeAssetCatalogs, normalizeLocations, assetLocationDcName,
    assetSubstatusValues, normalizeAssets, autoFillAssetFromModel, renderAssetsList, renderBayface,
    renderAll } = deps);
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
function bulkOccupiedSet(rackId,face,ignoreRow=null){
  const used=occupiedUnits(state.assets,rackId,face);
  document.querySelectorAll('#assetsBulkBody tr').forEach(row=>{if(row===ignoreRow)return;const rid=row.querySelector('[data-bulk-field="rack"]')?.value||'';if(rid!==rackId)return;const rface=row.querySelector('[data-bulk-field="face"]')?.value||'';if(rface!==face)return;const start=Number(row.querySelector('[data-bulk-field="u"]')?.value||0),height=Math.max(1,Number(row.querySelector('[data-bulk-field="height"]')?.value||1));if(start>0)for(let u=start;u<start+height;u++)used.add(u);});
  return used;
}
function bulkAvailableStarts(rackId,face,height=1,ignoreRow=null){
  const rack=assetRack(rackId);if(!rack||!face)return[];const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits)));const used=bulkOccupiedSet(rackId,face,ignoreRow);const out=[];for(let start=1;start<=units-height+1;start++){let ok=true;for(let u=start;u<start+height;u++)if(used.has(u)){ok=false;break;}if(ok)out.push(start);}return out;
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
  const faceEl=row.querySelector('[data-bulk-field="face"]');
  const hasRackForFace=!!rackEl?.value;
  if(faceEl){
    faceEl.disabled=!hasRackForFace;
    faceEl.closest('td')?.classList.toggle('muted-field',!hasRackForFace);
    if(!hasRackForFace)faceEl.value='';
  }
  const face=faceEl?.value||'';
  const rack=rackEl?.value||'';
  const height=Math.max(1,Math.floor(Number(row.querySelector('[data-bulk-field="height"]')?.value||1)));
  const uEl=row.querySelector('[data-bulk-field="u"]');
  const old=Number(uEl?.value||0);
  if(!uEl)return;
  const starts=bulkAvailableStarts(rack,face,height,row);
  uEl.innerHTML='<option value="">Selecione</option>'+starts.map(u=>`<option value="${u}">U${u}</option>`).join('');
  if(preserveU&&starts.includes(old))uEl.value=String(old);else uEl.value=starts[0]!==undefined?String(starts[0]):'';
  const ready=!!rack&&!!face;
  uEl.disabled=!ready;
  uEl.closest('td')?.classList.toggle('muted-field',!ready);
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
<td><select class="bulk-face" data-bulk-field="face"><option value="">Selecione</option><option value="front">Frente</option><option value="rear">Traseira</option></select></td>
<td><select class="bulk-u" data-bulk-field="u"><option value="">Selecione</option></select></td>
<td><input class="bulk-height" data-bulk-field="height" type="number" min="1" max="60" value="1"></td>
<td><select data-bulk-field="status">${bulkCatalogOptions('status')}</select></td>
<td><select data-bulk-field="substatus">${bulkCatalogOptions('substatus')}</select></td>
<td><input data-bulk-field="power" type="number" min="0" step="1" placeholder="Do modelo"></td>
<td><input data-bulk-field="weight" type="number" min="0" step="0.1" placeholder="Do modelo"></td>
<td><input data-bulk-field="purchase" type="date"></td>
<td><input data-bulk-field="warranty" type="date"></td>
<td><input data-bulk-field="eol" type="date"></td>
<td><button class="iconbtn danger-icon" type="button" data-bulk-remove title="Remover linha"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg></button></td></tr>`;}
function initBulkTableResizers(){
  const table=document.querySelector('.bulk-assets-table');
  if(!table||table.dataset.resizersReady==='1')return;
  table.dataset.resizersReady='1';
  const cols=[...table.querySelectorAll('colgroup col')];
  const heads=[...table.querySelectorAll('thead th')];
  const defaults={name:10,type:5,manufacturer:7,model:8,tag:7,serial:9,location:13,rack:9,face:5,u:4,height:4,status:7,substatus:8,power:7,weight:7,purchase:8,warranty:9,eol:8,actions:3};
  const mins={name:90,type:62,manufacturer:80,model:82,tag:76,serial:105,location:150,rack:100,face:74,u:52,height:56,status:72,substatus:90,power:82,weight:82,purchase:118,warranty:130,eol:118,actions:34};
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
export function addBulkRow(){const body=$('assetsBulkBody');if(!body)return;body.insertAdjacentHTML('beforeend',bulkRowHtml());const row=body.lastElementChild;const type=row.querySelector('[data-bulk-field="type"]'),man=row.querySelector('[data-bulk-field="manufacturer"]'),model=row.querySelector('[data-bulk-field="model"]'),location=row.querySelector('[data-bulk-field="location"]'),rack=row.querySelector('[data-bulk-field="rack"]');const refreshModel=()=>{const current=model.value;model.innerHTML=bulkCatalogOptions('model',current,row);if(![...model.options].some(o=>o.value===current))model.value='';};
  type.addEventListener('change',refreshModel);
  man.addEventListener('change',refreshModel);
  model.addEventListener('change',()=>{const opt=model.selectedOptions?.[0];if(!opt||!opt.value)return;const mt=opt.dataset.modelType||'',mm=opt.dataset.modelManufacturer||'';if(mt){type.value=mt;}if(mm){man.value=mm;}refreshAllBulkRows();});
  location.addEventListener('change',()=>{rack.value='';row.querySelector('[data-bulk-field="u"]').value='';refreshAllBulkRows();});
  rack.addEventListener('change',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="face"]')?.addEventListener('change',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="height"]').addEventListener('input',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="u"]').addEventListener('change',()=>refreshAllBulkRows());row.querySelector('[data-bulk-field="name"]').addEventListener('input',()=>refreshAllBulkRows());row.querySelector('[data-bulk-remove]').addEventListener('click',()=>{row.remove();refreshAllBulkRows();});refreshModel();refreshAllBulkRows();row.querySelector('[data-bulk-field="name"]').focus();}
export function openBulkAssetsModal(){normalizeAssets();normalizeAssetCatalogs();initBulkTableResizers();const m=$('assetsBulkModal');if(!m)return;$('assetsBulkBody').innerHTML='';for(let i=0;i<5;i++)addBulkRow();$('assetsBulkChooser')?.classList.remove('hidden');$('assetsBulkEditor')?.classList.add('hidden');m.querySelector('.bulk-assets-card')?.classList.remove('wide');m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');m.style.zIndex='340';}
export function closeBulkAssetsModal(){const m=$('assetsBulkModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
export function saveBulkAssets(){
  normalizeAssets();const rows=[...document.querySelectorAll('#assetsBulkBody tr')].filter(r=>r.querySelector('[data-bulk-field="name"]')?.value.trim());if(!rows.length){toast('Adicione pelo menos um asset.');return;}
  const errors=[],newAssets=[];
  rows.forEach((row,i)=>{const g=k=>row.querySelector(`[data-bulk-field="${k}"]`)?.value?.trim?.()||row.querySelector(`[data-bulk-field="${k}"]`)?.value||'';const name=g('name'),type=g('type'),manufacturer=g('manufacturer'),model=g('model'),tag=g('tag'),serial=g('serial'),locationValue=g('location'),rackId=g('rack'),face=g('face'),uStart=Number(g('u')||0),uHeight=Math.max(1,Math.floor(Number(g('height')||1))),status=g('status')||'Ativo',substatus=g('substatus'),powerW=Math.max(0,Math.floor(Number(g('power')||0))),weightKg=Math.max(0,Number(g('weight')||0)),purchaseDate=g('purchase'),warrantyExpiration=g('warranty'),endOfLife=g('eol');if(rackId&&!face){toast(`Linha ${i+1}: escolha a face do rack.`);return;}const locParts=locationValue.startsWith('stock:')?locationValue.split(':'):null;const locationType=locationValue.startsWith('stock:')?'stock':'room';const roomId=locationType==='room'?locationValue.slice(5)||null:null;const locationId=locationType==='stock'?(locParts?.[1]||null):(roomId?(state.rooms.find(r=>r.id===roomId)?.locationId||null):null);const stockId=locationType==='stock'?(locParts?.[2]||null):null;const rack=assetRack(rackId);let msg='';if(!name)msg='Nome é obrigatório.';else if(!type)msg='Tipo é obrigatório.';else if(!serial)msg='Serial Number é obrigatório.';else if(!locationValue)msg='Localização é obrigatória.';else if(locationType==='stock'&&rackId)msg='Asset em estoque não pode ter rack.';else if(locationType==='stock'&&uStart)msg='Asset em estoque não pode ter U.';else if(rack&&uStart<1)msg='Selecione uma U disponível.';else if(rack&&uStart+uHeight-1>Math.floor(num(rack.units,state.rackUnits)))msg='Quantidade de U ultrapassa o rack.';else if(rack){const used=new Set(state.assets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).flatMap(a=>{const o=assetOccupancy(a);return Array.from({length:o.end-o.start+1},(_,j)=>o.start+j);}));newAssets.filter(a=>a.rackId===rackId&&!isAssetArchived(a)).forEach(a=>{for(let u=a.uStart;u<a.uStart+a.uHeight;u++)used.add(u);});for(let u=uStart;u<uStart+uHeight;u++)if(used.has(u)){msg=`Conflito: U${u} já está ocupada.`;break;}}if(!msg){newAssets.push(autoFillAssetFromModel({id:uid('asset'),name,type,manufacturer,model,assetTag:tag,serial,locationType,locationName:locationType==='stock'?(state.locations.find(l=>l.id===locationId)?.name||'Estoque'):(state.rooms.find(r=>r.id===roomId)?.name||''),locationId,stockId,roomId,rackId:rackId||null,face:rackId?(face||null):null,uStart:uStart||1,uHeight,status,substatus,ports:[],powerW,weightKg,purchaseDate,warrantyExpiration,endOfLife}));}if(msg)errors.push(`Linha ${i+1}: ${msg}`);});
  if(errors.length){toast(errors[0]);return;}
  state.assets.push(...newAssets);save();newAssets.forEach(asset=>recordAssetAudit({action:'CREATE',asset,after:asset,changes:[]}));closeBulkAssetsModal();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');if($('bayfaceModal')?.classList.contains('open'))renderBayface($('bayfaceModal').dataset.rackId);toast(`${newAssets.length} asset(s) cadastrado(s)`);
}

export function openAssetsImportModal(){const m=$('assetsImportModal');if(!m)return;m.classList.remove('hidden');m.classList.add('open');m.setAttribute('aria-hidden','false');m.style.zIndex='450';$('assetsImportMapping').classList.add('hidden');$('assetsImportFileInfo').classList.add('hidden');$('assetsImportContinue').disabled=true;}
function closeAssetsImportModal(){const m=$('assetsImportModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}
function bindAssetsImportModal(){const templateBtn=$('assetsImportTemplate');templateBtn?.addEventListener('click',makeAssetsTemplate);const choose=$('assetsImportChoose'),input=$('assetsImportFile'),drop=$('assetsImportDrop');choose?.addEventListener('click',()=>input?.click());$('assetsImportClose')?.addEventListener('click',closeAssetsImportModal);$('assetsImportCancel')?.addEventListener('click',closeAssetsImportModal);$('assetsImportBack')?.addEventListener('click',()=>{closeAssetsImportModal();openBulkAssetsModal();});input?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f){closeAssetsImportModal();importAssetsWorkbook(f);}input.value='';});drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')});drop?.addEventListener('dragleave',()=>drop.classList.remove('drag'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files?.[0];if(f){closeAssetsImportModal();importAssetsWorkbook(f);}});}

export function bindImportUI(){
  bindAssetsImportModal();
  document.querySelectorAll('[data-catalog-template]').forEach(btn=>btn.addEventListener('click',()=>catalogSingleTemplate(btn.dataset.catalogTemplate)));
  document.querySelectorAll('[data-catalog-import]').forEach(btn=>btn.addEventListener('click',()=>openCatalogSingleImport(btn.dataset.catalogImport)));
  $('catalogImportFile')?.addEventListener('change',e=>{const f=e.target.files?.[0],kind=e.target.dataset.catalogKind;if(f&&kind)importCatalogSingleWorkbook(f,kind);e.target.value='';});
$('importPreviewErrors')?.addEventListener('click',e=>{if(!e.target.closest('.import-alert-close'))return;const el=$('importPreviewErrors');el.dataset.dismissed='1';el.classList.add('hidden');});$('importPreviewConfirm')?.addEventListener('click',()=>{if(importSession.pending?.onConfirm){const fn=importSession.pending.onConfirm;closeImportPreview();fn();}});$('importPreviewClose')?.addEventListener('click',closeImportPreview);$('importPreviewCancel')?.addEventListener('click',closeImportPreview);
}
