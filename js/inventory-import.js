import { uid, esc, num, $, catalogNormalize, catalogSimilarity, catalogSimilar, parseImportDate, parseImportNumber, beginTask, endTask, uiIcon } from './utils.js';
import { state } from './state.js';
import { isAssetArchived, assetOccupancy, occupiedUnits } from './occupancy.js';

// Estado da pré-visualização de importação (arquivo lido, linha aguardando
// cadastro de modelo, etc.). Vive num objeto porque app.js também lê e grava
// esses campos, e um `let` de módulo não pode ser reatribuído por quem importa.
export const importSession = { pending: null, modelIndex: null, catalogCreate: null };

// Funções e constantes que continuam em app.js (tocam DOM/estado do app);
// injetadas por configureInventoryImport() para evitar import circular.
let ensureRooms, recordAssetAudit, normalizeCableCatalogs, toast, save, render, assetRoom, assetRack,
  assetRackRoom, allProjectRacks, DEFAULT_ASSET_STATUSES, normalizeAssetCatalogs,
  renderCableTypesCatalog, renderAssetCatalogs, renderAssetCatalogManufacturerSelect,
  renderAssetCatalogTypeSelect, openCatalogEditor, renderAssetCatalogSelects, normalizeLocations,
  assetLocationLabel, assetSubstatusValues, normalizeAssets, autoFillAssetFromModel,
  ASSET_COLUMN_HEADER_LABELS, renderAssetsList, renderCables, renderAll;
export function configureInventoryImport(deps){
  ({ ensureRooms, recordAssetAudit, normalizeCableCatalogs, toast, save, render, assetRoom,
    assetRack, assetRackRoom, allProjectRacks, DEFAULT_ASSET_STATUSES, normalizeAssetCatalogs,
    renderCableTypesCatalog, renderAssetCatalogs, renderAssetCatalogManufacturerSelect,
    renderAssetCatalogTypeSelect, openCatalogEditor, renderAssetCatalogSelects, normalizeLocations,
    assetLocationLabel, assetSubstatusValues, normalizeAssets, autoFillAssetFromModel,
    ASSET_COLUMN_HEADER_LABELS, renderAssetsList, renderCables, renderAll } = deps);
}

// --- Inventory import/export -------------------------------------------------
const CATALOG_SHEET_HEADERS = {
  types:['Tipo'],
  manufacturers:['Fabricante'],
  models:['Tipo','Fabricante','Modelo']
};
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
export function assetStatusValues(){ normalizeAssetCatalogs(); return state.assetCatalogs.statuses||DEFAULT_ASSET_STATUSES.slice(); }
export async function makeAssetsTemplate(){
  try{
    if(!await ensureExcelJS()) throw new Error('Biblioteca ExcelJS não carregada.');
    normalizeAssetCatalogs(); normalizeLocations();
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Assets');
    const headers=['Asset Tag','Nome','Serial Number','Modelo','Localização','Rack','Face','U Inicial','Quantidade U','Status','Substatus','Potência (W)','Peso (kg)','Data de compra','Vencimento da garantia','Fim de vida (EOL)','Observações'];
    ws.addRow(headers);
    (state.assets||[]).forEach(a=>{
      const room=assetRoom(a), rack=assetRack(a.rackId);
      const rackDisplay=rack ? `${room?.name||assetRackRoom(a)?.name||''} / ${rack.name||''}`.replace(/^ \/ /,'') : '';
      const faceDisplay=rack ? (a.face==='rear'?'Traseira':'Frente') : '';
      ws.addRow([a.assetTag||'',a.name||'',a.serial||'',a.model||'',assetLocationLabel(a),rackDisplay,faceDisplay,a.uStart||'',a.uHeight||1,a.status||'Instalado',a.substatus||'',a.powerW||'',a.weightKg||'',a.purchaseDate||'',a.warrantyExpiration||'',a.endOfLife||'',a.notes||'']);
    });
    ws.views=[{state:'frozen',ySplit:1}];
    ws.autoFilter={from:'A1',to:'Q1'};
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
    ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F2937'}};
    ws.getRow(1).alignment={vertical:'middle'};
    ws.columns=[18,32,24,30,28,22,12,12,14,18,22,16,14,16,20,18,32].map(width=>({width}));
    ws.getRow(1).height=24;
    ws.getCell('A1').note='Opcional. Identificador interno do asset.';
    ws.getCell('B1').note='Obrigatório.';
    ws.getCell('C1').note='Obrigatório.';
    ws.getCell('D1').note='Obrigatório. O sistema usa o modelo cadastrado para identificar Tipo e Fabricante.';
    ws.getCell('E1').note='Obrigatório. Formato: Data Center / Sala ou Data Center / Estoque.';
    ws.getCell('F1').note='Opcional. Se informado, deve existir na sala selecionada.';
    ws.getCell('G1').note='Obrigatória somente quando um Rack for informado. Frente ou Traseira.';
    ws.getCell('H1').note='Obrigatório somente quando um Rack for informado. O sistema valida se a U está livre.';
    ws.getCell('I1').note='Quantidade de U ocupadas pelo asset.';
    ws.getCell('J1').note='Status do asset. Valores sugeridos: Arquivado, Instalado, Reservado, Desligado, Estoque.';
    ws.getCell('K1').note='Substatus. Valores sugeridos: Em estoque, Ligado, Desligado, Disposed, Perdido, Retired, Retornado ao Vendor.';
    ws.getCell('L1').note='Opcional. Se deixado em branco, usa o valor cadastrado no modelo (Catálogo → Modelos), quando existir.';
    ws.getCell('M1').note='Opcional. Se deixado em branco, usa o valor cadastrado no modelo (Catálogo → Modelos), quando existir.';
    ws.getCell('N1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';
    ws.getCell('O1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';
    ws.getCell('P1').note='Opcional. Formato AAAA-MM-DD ou DD/MM/AAAA.';
    ws.getCell('Q1').note='Opcional. Até 500 caracteres.';

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
    refWs.getColumn(8).values=['Face','Frente','Traseira'];
    refWs.state='hidden';

    const locRange=`'NÃO EDITAR - Referência'!$A$2:$A$${Math.max(2,allLocations.length+1)}`;
    const rackRange=`'NÃO EDITAR - Referência'!$B$2:$B$${Math.max(2,allRacks.length+1)}`;
    const modelRange=`'NÃO EDITAR - Referência'!$C$2:$C$${Math.max(2,allModels.length+1)}`;
    const statusRange=`'NÃO EDITAR - Referência'!$F$2:$F$${Math.max(2,assetStatusValues().length+1)}`;
    const substatusRange=`'NÃO EDITAR - Referência'!$G$2:$G$${Math.max(2,assetSubstatusValues().length+1)}`;
    const faceRange=`'NÃO EDITAR - Referência'!$H$2:$H$3`;
    const existingRows=(state.assets||[]).length;
    for(let row=2;row<=1000;row++){
      ws.getCell(`D${row}`).dataValidation={type:'list',allowBlank:true,formulae:[modelRange]};
      ws.getCell(`E${row}`).dataValidation={type:'list',allowBlank:true,formulae:[locRange]};
      ws.getCell(`F${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
      ws.getCell(`G${row}`).dataValidation={type:'list',allowBlank:true,formulae:[faceRange]};
      ws.getCell(`J${row}`).dataValidation={type:'list',allowBlank:true,formulae:[statusRange]};
      ws.getCell(`K${row}`).dataValidation={type:'list',allowBlank:true,formulae:[substatusRange]};
      // As fórmulas de potência/peso só vão nas linhas em branco (pra novos
      // assets) — nas linhas que já têm um asset exportado, mantém o valor
      // real dele, que pode ter sido alterado manualmente e ser diferente
      // do padrão cadastrado no modelo.
      if(row>existingRows+1){
        ws.getCell(`L${row}`).value={formula:`IFERROR(VLOOKUP(D${row},'NÃO EDITAR - Referência'!$C:$E,2,FALSE),"")`};
        ws.getCell(`M${row}`).value={formula:`IFERROR(VLOOKUP(D${row},'NÃO EDITAR - Referência'!$C:$E,3,FALSE),"")`};
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
function parseImportFace(raw){
  const v=catalogNormalize(String(raw||''));
  if(v==='traseira'||v==='tras'||v==='rear'||v==='back')return 'rear';
  return 'front';
}
function assetImportCatalogOptions(kind, selected=''){
  normalizeAssetCatalogs();
  if(kind==='type') return '<option value="">Selecione</option>'+state.assetCatalogs.types.map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='manufacturer') return '<option value="">Selecione</option>'+state.assetCatalogs.manufacturers.map(v=>`<option value="${esc(v)}" ${catalogNormalize(v)===catalogNormalize(selected)?'selected':''}>${esc(v)}</option>`).join('');
  if(kind==='model'){
    const exists=(state.assetCatalogs.models||[]).some(m=>catalogNormalize(m.name)===catalogNormalize(selected));
    const missing=selected&&!exists?`<option value="${esc(selected)}" selected>${esc(selected)} — não cadastrado</option>`:'';
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
  const face=parseImportFace(item.data?.Face);
  const used=occupiedUnits(state.assets,rackId,face);
  const rows=importSession.pending?.rows||[];
  rows.forEach(other=>{if(other===item||!other.valid)return;if(parseImportFace(other.data?.Face)!==face)return;const rr=(state.rooms||[]).find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Sala));const rk=rr?.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(other.data?.Rack));if(rk?.id===rackId){const st=Math.floor(parseImportNumber(other.data?.['U Inicial'],0)),h=Math.max(1,Math.floor(parseImportNumber(other.data?.['Quantidade U'],1)));if(st)for(let u=st;u<st+h;u++)used.add(u);}});
  const units=Math.max(1,Math.floor(num(rack.units,state.rackUnits))); const current=Math.floor(parseImportNumber(item.data?.['U Inicial'],0));
  let html='<option value="">Selecione</option>';
  for(let st=1;st<=units-height+1;st++){
    let free=true;for(let u=st;u<st+height;u++)if(used.has(u)&&st!==current){free=false;break;}
    if(free)html+=`<option value="${st}" ${st===current?'selected':''}>U${st}</option>`;
  }
  return html;
}
export function validateAssetImportRows(rows){
  normalizeAssets(); ensureRooms(); normalizeAssetCatalogs();
  const existingBySerial=new Map((state.assets||[]).filter(a=>a.serial).map(a=>[catalogNormalize(a.serial),a]));
  const existingByName=new Map((state.assets||[]).filter(a=>a.name).map(a=>[catalogNormalize(a.name),a]));
  const occupiedByRack=new Map();
  (state.assets||[]).filter(a=>a.rackId&&!isAssetArchived(a)).forEach(a=>{
    const key=`${a.rackId}|${a.face||'front'}`;
    const set=occupiedByRack.get(key)||new Set(), o=assetOccupancy(a);
    for(let u=o.start;u<=o.end;u++) set.add(u);
    occupiedByRack.set(key,set);
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

      const faceKey=`${rack.id}|${parseImportFace(d.Face)}`;
      const existing=occupiedByRack.get(faceKey)||new Set();
      const planned=plannedByRack.get(faceKey)||new Map();
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
        plannedByRack.set(faceKey,planned);
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

const IMPORT_ICON_INVALID='<svg class="import-state-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.6h.01"/></svg>';
const IMPORT_ICON_VALID='<svg class="import-state-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12.4 2.8 2.8L16 9.6"/></svg>';
function importStateIcon(status){return status==='valid'?IMPORT_ICON_VALID:status==='invalid'?IMPORT_ICON_INVALID:uiIcon('dot','import-state-icon');}
function setImportConfirmLabel(text){const el=$('importPreviewConfirmLabel');if(el)el.textContent=text;}
function setImportFooterStats(total,valid,invalid){
  const el=$('importPreviewFooterStats'); if(!el)return;
  const info='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5M12 7.6h.01"/></svg>';
  el.innerHTML=`<span>${info}${total} linha${total===1?'':'s'} no total</span>`+(valid===null?'':`<span>${valid} válida${valid===1?'':'s'}</span><span>${invalid} precisa${invalid===1?'':'m'} de correção</span>`);
}
function renderImportProblems(item,idx){
  const problems=String(item.message||'').split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map(x=>x.trim()).filter(Boolean);
  const warning=item.warning?`<div class="import-validation-warning">${uiIcon('warn')} ${esc(item.warning)}</div>`:'';
  const list=problems.length?`<ul class="import-validation-list">${problems.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:`<div class="import-validation-ok">${uiIcon('check')} Válido</div>`;
  const model=item._modelMissing?`<button type="button" class="import-model-action" data-import-model="${idx}">${uiIcon('plus')} Cadastrar modelo</button>`:'';
  return `<div class="import-validation-box ${problems.length?'has-errors':'is-valid'}">${list}${warning}${model}</div>`;
}
export function renderEditableAssetImportPreview(){
  const rows=importSession.pending?.rows||[], table=$('importPreviewTable'); if(!table)return;
  // key (usada em data-import-field e como chave em item.data, precisa bater com o
  // cabeçalho da coluna no Excel) e label (texto exibido) são independentes aqui —
  // label segue os mesmos rótulos curtos de ASSET_COLUMN_HEADER_LABELS (inventário),
  // sem precisar renomear a coluna que o usuário vê na planilha.
  const L=ASSET_COLUMN_HEADER_LABELS;
  const fields=[['Asset Tag','text',90,L.assetTag],['Nome','text',130,L.name],['Serial Number','text',110,L.serial],['Modelo','model',130,L.model],['Localização','room',130,L.location],['Rack','rack',70,L.rack],['Face','face',80,L.face],['U Inicial','u',68,L.u],['Quantidade U','number',60,L.uHeight],['Status','status',90,L.status],['Substatus','substatus',100,L.substatus],['Potência (W)','number',70,'Potência (W)'],['Peso (kg)','number',70,'Peso (kg)'],['Data de compra','date',120,L.purchaseDate],['Vencimento da garantia','date',120,L.warranty],['Fim de vida (EOL)','date',120,L.eol]];
  // Largura fixa por coluna (th e td), não deixada pro navegador decidir pelo conteúdo
  // (table-layout:fixed no CSS depende disso — sem largura no th, a coluna volta a
  // esticar pro texto mais longo do header, tipo "VENCIMENTO DA GARANTIA").
  table.innerHTML=`<table class="asset-import-edit-grid"><thead><tr><th style="width:38px">#</th><th style="width:34px"></th>${fields.map(f=>`<th style="width:${f[2]}px">${esc(f[3])}${['Nome','Serial Number','Modelo'].includes(f[0])?' *':''}</th>`).join('')}<th style="width:300px">Validação</th><th style="width:36px"></th></tr></thead><tbody>${rows.map((item,idx)=>{const d=item.data||{};const status=item._validated?(item.valid?'valid':'invalid'):'pending';return `<tr class="import-row ${status==='valid'?'import-valid':status==='invalid'?'import-invalid':'import-pending'}" data-import-index="${idx}"><td class="import-row-num">${idx+1}</td><td class="import-row-state">${importStateIcon(status)}</td>${fields.map(([key,type])=>{let control='';if(type==='model')control=`<select data-import-field="${key}">${assetImportCatalogOptions('model',d[key]||'')}</select>`;else if(type==='room')control=`<select data-import-field="${key}">${assetImportRoomOptions(d[key]||'')}</select>`;else if(type==='rack')control=`<select data-import-field="${key}">${assetImportRackOptions(d['Localização']||d['Sala']||'',d[key]||'')}</select>`;else if(type==='status')control=`<select data-import-field="${key}">${assetImportCatalogOptions('status',d[key]||'Instalado')}</select>`;else if(type==='substatus')control=`<select data-import-field="${key}">${assetImportCatalogOptions('substatus',d[key]||'')}</select>`;else if(type==='u')control=`<select data-import-field="${key}">${assetImportUOptions(item)}</select>`;else if(type==='face')control=`<select data-import-field="${key}"><option value="">Selecione</option><option value="Frente" ${catalogNormalize(d[key]||'')==='frente'?'selected':''}>Frente</option><option value="Traseira" ${catalogNormalize(d[key]||'')==='traseira'?'selected':''}>Traseira</option></select>`;else if(type==='date')control=`<input data-import-field="${key}" type="date" value="${esc(d[key]??'')}">`;else control=`<input data-import-field="${key}" type="${type==='number'?'number':'text'}" value="${esc(d[key]??'')}" ${key==='Quantidade U'?'min="1" max="60"':''}>`;return `<td>${control}</td>`}).join('')}<td class="import-row-message">${status==='pending'?`<div class="import-validation-pending">${uiIcon('hourglass')} Aguardando validação</div>`:renderImportProblems(item,idx)}</td><td><button type="button" class="iconbtn danger-icon import-row-remove" data-import-remove="${idx}" title="Remover esta linha da importação">${uiIcon('close')}</button></td></tr>`}).join('')}</tbody></table>`;
  table.querySelectorAll('[data-import-field]').forEach(el=>el.addEventListener('change',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:true})));
  table.querySelectorAll('[data-import-field="Nome"],[data-import-field="Serial Number"],[data-import-field="Quantidade U"],[data-import-field="Potência (W)"],[data-import-field="Peso (kg)"]').forEach(el=>el.addEventListener('input',()=>updateEditableImportRow(el.closest('tr'),{rerenderRow:false})));
  table.querySelectorAll('.import-model-action').forEach(btn=>btn.addEventListener('click',()=>openImportModelRegistration(Number(btn.dataset.importModel))));
  table.querySelectorAll('[data-import-remove]').forEach(btn=>btn.addEventListener('click',()=>{
    const idx=Number(btn.dataset.importRemove); if(!importSession.pending?.rows)return;
    importSession.pending.rows.splice(idx,1);
    renderEditableAssetImportPreview();
    updateImportPreviewSummary();
  }));
}

function openImportModelRegistration(index){
  const item=importSession.pending?.rows?.[index]; if(!item)return;
  importSession.modelIndex=index;
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
  const idx=Number(tr?.dataset.importIndex); const item=importSession.pending?.rows?.[idx]; if(!item)return;
  tr.querySelectorAll('[data-import-field]').forEach(el=>item.data[el.dataset.importField]=el.value);
  const model=(state.assetCatalogs.models||[]).find(m=>catalogNormalize(m.name)===catalogNormalize(item.data.Modelo));
  item._modelMissing=!!(item.data.Modelo && !model);
  if(model){item.data.Modelo=model.name;item.data.Tipo=model.type||'';item.data.Fabricante=model.manufacturer||'';item._modelMissing=false;}
  const field=tr.querySelector('[data-import-field="Rack"]'); if(field)item.data.Rack=field.value;
  validateAssetImportRows(importSession.pending.rows);
  if(rerenderRow){
    renderEditableAssetImportPreview();
    updateImportPreviewSummary();
  }else{
    // Never rebuild the table while typing: rebuilding destroys the active input
    // and was the cause of the one-character-and-focus-loss bug.
    importSession.pending.rows.forEach((r,i)=>{
      const row=document.querySelector(`#importPreviewTable tr[data-import-index="${i}"]`); if(!row)return;
      row.classList.toggle('import-valid',!!r.valid);row.classList.toggle('import-invalid',!r.valid);
      const stateCell=row.querySelector('.import-row-state'); if(stateCell)stateCell.innerHTML=importStateIcon(r.valid?'valid':'invalid');
      const msg=row.querySelector('.import-row-message'); if(msg)msg.innerHTML=renderImportProblems(r,i);
    });
    document.querySelectorAll('#importPreviewTable .import-model-action').forEach(btn=>btn.onclick=()=>openImportModelRegistration(Number(btn.dataset.importModel)));
    updateImportPreviewSummary();
  }
}
export function updateImportPreviewSummary(){
  const rows=importSession.pending?.rows||[], validated=rows.filter(r=>r._validated).length, valid=rows.filter(r=>r._validated&&r.valid).length, invalid=rows.filter(r=>r._validated&&!r.valid).length;
  if(!validated){$('importPreviewSummary').innerHTML=`<div><b>${rows.length}</b> linhas carregadas</div><div>${uiIcon('hourglass')} Aguardando validação</div>`;setImportFooterStats(rows.length,null,null);}
  else{$('importPreviewSummary').innerHTML=`<div class="import-stat-valid"><b>${valid}</b> válidos</div><div class="import-stat-invalid"><b>${invalid}</b> precisam de correção</div><div><b>${rows.length}</b> linhas analisadas</div>`;setImportFooterStats(rows.length,valid,invalid);}
  setImportConfirmLabel(validated&&valid?`Importar ${valid} válido${valid===1?'':'s'}`:'Importar'); $('importPreviewConfirm').disabled=!validated||valid===0;
  const errEl=$('importPreviewErrors'); const errors=rows.filter(r=>r._validated&&!r.valid); if(errors.length){errEl.classList.toggle('hidden',errEl.dataset.dismissed==='1');errEl.innerHTML=`${IMPORT_ICON_INVALID}<span>Corrija as linhas em vermelho <em>para continuar.</em></span><button type="button" class="import-alert-close" aria-label="Dispensar aviso">${uiIcon('close')}</button>`;}else if(validated){errEl.classList.add('hidden');errEl.innerHTML='';}else{errEl.classList.add('hidden');errEl.innerHTML='';}
}
function openImportPreview(kind, rows, errors, title, subtitle, onConfirm){
  importSession.pending={kind,rows,errors,onConfirm};
  const alertEl=$('importPreviewErrors'); alertEl.classList.toggle('is-alert',kind==='assets'); delete alertEl.dataset.dismissed;
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
    $('importPreviewTable').innerHTML=`<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${previewRows.map(r=>`<tr><td>${esc(r.sheet)}</td><td>${esc(r.type)}</td><td>${esc(r.manufacturer)}</td><td>${esc(r.model)}</td><td>${r.valid?uiIcon('check')+' Válido':uiIcon('warn')+' Erro'}</td></tr>`).join('')}</tbody></table>`;
    setImportConfirmLabel(valid?`Importar ${valid} válido${valid===1?'':'s'}`:'Nenhum dado válido');setImportFooterStats(total,valid,total-valid);$('importPreviewConfirm').disabled=!valid;
  }
}

export function closeImportPreview(){importSession.pending=null;const m=$('importPreviewModal');if(!m)return;m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');}

function catalogSingleLabel(kind){return ({types:'Tipos de ativo',manufacturers:'Fabricantes',models:'Modelos',statuses:'Status',substatuses:'Substatus',cableTypes:'Tipos de cabo'})[kind]||'Cadastros';}
export function catalogSingleTemplate(kind){
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
export function openCatalogSingleImport(kind){
  const input=$('catalogImportFile'); if(!input)return;
  input.dataset.catalogKind=kind; input.value=''; input.click();
}
export function validateCatalogImportRows(kind,rows){
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
export function renderCatalogSinglePreviewRows(kind, rows){
  validateCatalogImportRows(kind,rows);
  const valid=rows.filter(r=>r.valid).length, invalid=rows.length-valid, newRows=rows.filter(r=>r.valid&&!r.existing).length;
  $('importPreviewSummary').innerHTML=`<div class="import-stat-valid"><b>${valid}</b> válidos</div><div class="import-stat-invalid"><b>${invalid}</b> com problemas</div><div><b>${rows.length}</b> linhas analisadas</div>`;
  setImportConfirmLabel(newRows?`Importar ${newRows} novo${newRows===1?'':'s'}`:(valid?'Concluir':'Nenhum dado válido'));setImportFooterStats(rows.length,valid,invalid);
  $('importPreviewConfirm').disabled=valid===0;
  const headers=kind==='models'?['Linha','Modelo','Fabricante','Tipo de Ativo','Validação']:kind==='cableTypes'?['Linha','Nome','Cor','Validação']:['Linha','Nome','Validação'];
  const body=rows.slice(0,300).map((r,i)=>{
    const issues=[];
    if(r.problems?.length) r.problems.forEach(p=>issues.push(`<div class="import-problem-item">🔴 ${esc(p)}</div>`));
    if(r.warning) issues.push(`<div class="import-warning-item">🟡 ${esc(r.warning)}</div>`);
    if(kind==='models'){
      if(r.missingManufacturer) issues.push(`<button type="button" class="btn primary small catalog-inline-create" data-catalog-create="manufacturer" data-row="${i}">${uiIcon('plus')} Cadastrar fabricante</button>`);
      if(r.missingType) issues.push(`<button type="button" class="btn primary small catalog-inline-create" data-catalog-create="type" data-row="${i}">${uiIcon('plus')} Cadastrar tipo de ativo</button>`);
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
    importSession.catalogCreate={kind:'models',rowIndex,field};
    openCatalogEditor(field==='manufacturer'?'manufacturers':'types');
    $('catalogEditorName').value=field==='manufacturer'?String(row.manufacturer||'').trim():String(row.type||'').trim();
  });
  const errEl=$('importPreviewErrors');
  if(invalid){errEl.classList.remove('hidden');errEl.innerHTML='<strong>Corrija as linhas vermelhas ou cadastre os itens faltantes diretamente nesta tela. Linhas verdes já podem ser importadas.</strong>';}else{errEl.classList.add('hidden');errEl.innerHTML='';}
}
function openCatalogSinglePreview(kind, rows){
  importSession.pending={kind:'catalogs-single',rows,onConfirm:()=>{
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
  $('importPreviewErrors').classList.remove('is-alert');
  $('importPreviewTitle').textContent=`Importar ${catalogSingleLabel(kind)}`;
  $('importPreviewSubtitle').textContent='Edite qualquer célula abaixo. A validação é automática e os registros já existentes permanecem verdes.';
  renderCatalogSinglePreviewRows(kind,rows);
}

export async function importCatalogSingleWorkbook(file,kind){
  beginTask('Lendo planilha…');
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
  finally{endTask();}
}

async function processAssetsWorkbook(file){
  beginTask('Lendo planilha de assets…');
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
      const key=`${a.rackId}|${a.face||'front'}`;
      const set=occupiedByRack.get(key)||new Set(),o=assetOccupancy(a);
      for(let u=o.start;u<=o.end;u++)set.add(u); occupiedByRack.set(key,set);
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
        'Face':getCol(raw,['face','frente/traseira','front/rear']),
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
        const faceKey=`${rack.id}|${parseImportFace(d.Face)}`;
        const used=new Set(occupiedByRack.get(faceKey)||[]);
        const planned=plannedByRack.get(faceKey)||new Set();
        for(let u=uStart;u<uStart+uHeight;u++){
          if(used.has(u)||planned.has(u)){valid=false;message=`U${u} já está ocupada ou foi reservada por outra linha desta importação.`;break;}
        }
        if(valid){for(let u=uStart;u<uStart+uHeight;u++)planned.add(u);plannedByRack.set(faceKey,planned);}
      }
      const serialKey=catalogNormalize(d['Serial Number']);
      const nameKey=catalogNormalize(d.Nome);
      const existingSerial=serialKey?existingBySerial.get(serialKey):null;
      const existingName=nameKey?existingByName.get(nameKey):null;
      if(valid&&existingSerial){valid=false;message=`Serial Number já cadastrado no asset "${existingSerial.name||'sem nome'}".`;}
      else if(valid&&existingName){warning=`Nome igual ao asset existente "${existingName.name}".`;}
      if(valid&&model&&d.Rack&&rack&&uStart){
        const rowFace=parseImportFace(d.Face);
        const exactLocation=(state.assets||[]).find(a=>!isAssetArchived(a)&&a.rackId===rack.id&&(a.face||'front')===rowFace&&uStart<=assetOccupancy(a).end&&assetOccupancy(a).start<=uStart+uHeight-1);
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
    openImportPreview('assets',preview,errors,'Importar assets',`Revise e corrija os registros antes de importar.${warnings.length?` ${warnings.length} alerta(s) de possível duplicidade.`:''}`,()=>{
      validateAssetImportRows(preview);
      const ready=preview.filter(r=>r.valid);
      ready.forEach(item=>{
        const d=item.data; const resolved=resolveAssetImportLocation(d['Localização']||d.Sala); const room=resolved.room; const stock=resolved.stock; const rack=room&&d.Rack?room.data?.racks?.find(r=>catalogNormalize(r.name)===catalogNormalize(d.Rack)):null; const loc=resolved.loc; const asset=autoFillAssetFromModel({id:uid('asset'),name:d.Nome,type:d.Tipo,manufacturer:d.Fabricante,model:d.Modelo,assetTag:d['Asset Tag'],serial:d['Serial Number'],status:d.Status||'Instalado',substatus:d.Substatus||'',locationType:stock?'stock':'room',locationName:d['Localização']||d.Sala||'',locationId:loc?.id||null,stockId:stock?.id||null,roomId:room?.id||null,rackId:rack?.id||null,face:rack?parseImportFace(d.Face):null,uStart:Math.max(1,Math.floor(parseImportNumber(d['U Inicial'],1))),uHeight:Math.max(1,Math.floor(parseImportNumber(d['Quantidade U'],1))),ports:[],powerW:Math.max(0,Math.floor(parseImportNumber(d['Potência (W)'],0))),weightKg:Math.max(0,parseImportNumber(d['Peso (kg)'],0)),purchaseDate:parseImportDate(d['Data de compra']),warrantyExpiration:parseImportDate(d['Vencimento da garantia']),endOfLife:parseImportDate(d['Fim de vida (EOL)']),notes:String(d['Observações']||'').slice(0,500)}); state.assets.push(asset); recordAssetAudit({action:'CREATE',asset,after:asset,changes:[]});
      });
      const imported=ready.length;save();closeImportPreview();renderAll(false);renderAssetsList($('assetsSearch')?.value||'');toast(`${imported} asset(s) importado(s)`);
    });
  }catch(e){console.error(e);toast('Não foi possível ler a planilha de assets.');}
  finally{endTask();}
}

export async function importAssetsWorkbook(file){
  beginTask('Lendo planilha de assets…');
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
  finally{endTask();}
}
