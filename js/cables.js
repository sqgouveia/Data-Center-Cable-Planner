import { uid, esc, num, $, catalogNormalize, catalogSimilar, parsePortTemplate, excelColumnLetter, beginTask, endTask, uiIcon } from './utils.js';
import { state } from './state.js';
import { uiConfirm } from './dialogs.js';
import { rowForRack, geometry, rackRect, trayPointAt, rackDisplayName, findRackByLabel } from './geometry.js';
import { buildRouteGraph, calcCable } from './routing.js';
import { assetAtRackU, assetOwningPort } from './occupancy.js';

// Estado mutável compartilhado com app.js. Vive num objeto porque um `let` de módulo
// não pode ser reatribuído por quem importa.
export const cables = { pendingCableImportRows: null, cablesSearchQuery: '', cableMultiSelected: [], cablesFilterMode: 'all' };

// Funções e constantes que continuam em app.js; injetadas por configureCables()
// para evitar import circular com app.js.
let syncActiveRoom, normalizeCableCatalogs, cableTypeNames, defaultCableType, cableTypeColor, toast,
  cableUnitValidation, renderAll, flashSelection;
export function configureCables(deps){
  ({ syncActiveRoom, normalizeCableCatalogs, cableTypeNames, defaultCableType, cableTypeColor,
    toast, cableUnitValidation, renderAll, flashSelection } = deps);
}

export function addCable(){if(state.racks.length<2){toast('Crie pelo menos 2 racks');return;}const c={id:uid('cable'),name:`Cabo-${String(state.cables.length+1).padStart(3,'0')}`,originRack:state.racks[0].id,originU:state.racks[0].units,originFace:'front',destRack:state.racks[1].id,destU:state.racks[1].units,destFace:'front',slack:state.defaultSlack,type:defaultCableType(),via:[]};state.cables.push(c);state.multiSelected=[];state.selected={type:'cable',id:c.id};renderAll();toast('Cabo adicionado');flashSelection?.();}

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
    route.push(rackDisplayName(r)||r.id||'');
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
export async function downloadCableTemplate(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Face Origem','Nome Asset Origem','Porta Origem','Rack Destino','U Destino','Face Destino','Nome Asset Destino','Porta Destino'];
    ws.addRow(headers);
    ws.addRow(['FIB-001',defaultCableType(),'Row-1-01',40,'Frente','SWITCH01','G0/0/1','Row-2-01',40,'Frente','ROUTER01','G0/0/2']);
    ws.freezePanes={xSplit:0,ySplit:1};
    ws.autoFilter={from:'A1',to:'L2'};
    ws.getRow(1).font={bold:true};
    ws.columns=[{width:20},{width:24},{width:20},{width:12},{width:14},{width:20},{width:16},{width:20},{width:12},{width:14},{width:20},{width:16}];
    const note=ws.getCell('N1'); note.value='Porta Origem e Porta Destino são opcionais. Se o modelo do asset já tiver portas cadastradas, o nome precisa ser idêntico a uma delas. Se o modelo não tiver portas cadastradas, o texto informado é aceito livremente, sem validação. Nome Asset Origem/Destino é opcional: se já existir um asset cadastrado naquele rack/U/face, o sistema usa o nome dele automaticamente; se não existir, o texto informado é aceito livremente, sem criar nenhum asset novo. Face Origem/Destino: Frente ou Traseira (deixado em branco vira Frente).'; note.font={italic:true,color:{argb:'FF8B96AC'}};
    applyTypeValidation(ws);

    // Lista suspensa de racks (origem e destino) e de face, igual à de Tipo —
    // usa uma aba de referência oculta em vez de lista inline, pra não esbarrar
    // no limite de caracteres do Excel quando há muitos racks no projeto.
    const refWs=wb.addWorksheet('NÃO EDITAR - Referência');
    // Cabos são por sala — a lista só traz racks da sala ativa, não do projeto
    // inteiro, senão apareceria rack de outra sala pra escolher aqui.
    const allRacks=[...new Set(state.racks.map(r=>rackDisplayName(r)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    refWs.getColumn(1).values=['Racks',...allRacks];
    refWs.getColumn(2).values=['Face','Frente','Traseira'];
    refWs.state='hidden';
    const rackRange=`'NÃO EDITAR - Referência'!$A$2:$A$${Math.max(2,allRacks.length+1)}`;
    const faceRange=`'NÃO EDITAR - Referência'!$B$2:$B$3`;
    for(let row=2;row<=1000;row++){
      ws.getCell(`C${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
      ws.getCell(`E${row}`).dataValidation={type:'list',allowBlank:true,formulae:[faceRange]};
      ws.getCell(`H${row}`).dataValidation={type:'list',allowBlank:true,formulae:[rackRange]};
      ws.getCell(`J${row}`).dataValidation={type:'list',allowBlank:true,formulae:[faceRange]};
    }

    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='template-importacao-cabos.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Template XLSX baixado');
  }catch(err){toast(err.message||'Erro ao baixar template');}
}

const CABLE_TYPE_AUTO_COLORS=['#f472b6','#a78bfa','#fb923c','#34d399','#60a5fa','#f87171','#c084fc','#38bdf8'];
export function importCablesXLSX(file){
  beginTask('Lendo planilha de cabos…');
  try{
    const reader=new FileReader();
    reader.onload=()=>{
      endTask();
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

        cables.pendingCableImportRows={map,dataRows};
        if(newTypesSeen.size){
          openCableTypeReviewModal([...newTypesSeen.values()],existingTypes);
        }else{
          processCableImportRows();
        }
      }catch(err){toast(err.message||'Erro ao importar Excel');}
    };
    reader.readAsArrayBuffer(file);
  }catch(err){endTask();toast(err.message||'Erro ao importar Excel');}
}
function openCableTypeReviewModal(newTypes,existingTypes){
  const list=$('cableTypeReviewList');
  if(list){
    list.innerHTML=newTypes.map(t=>{
      const similar=catalogSimilar(t.label,existingTypes);
      return `<label class="cable-type-review-item"><input type="checkbox" data-cable-type-review="${esc(t.label)}" checked><span class="cable-type-review-name">${esc(t.label)}</span><span class="cable-type-review-count">${t.count}× na planilha</span></label>${similar.length?`<div class="cable-type-review-warning">${uiIcon('warn')} Parecido com "${esc(similar[0])}", já cadastrado — pode ser o mesmo tipo escrito diferente.</div>`:''}`;
    }).join('');
  }
  const m=$('cableTypeReviewModal'); if(!m)return;
  m.classList.add('open');m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
}
export function closeCableTypeReviewModal(){
  const m=$('cableTypeReviewModal'); if(!m)return;
  m.classList.remove('open');m.classList.add('hidden');m.setAttribute('aria-hidden','true');
}
export function processCableImportRows(selectedNewTypes=[]){
  if(!cables.pendingCableImportRows)return;
  const {map,dataRows}=cables.pendingCableImportRows;
  cables.pendingCableImportRows=null;
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
    // Aceita o nome do rack, o rótulo com a fileira (A-101) e o formato antigo — assim a
    // planilha exportada volta a importar sem edição.
    const origin=findRackByLabel(val(row,'Rack Origem',''),state.racks,state.rows);
    const dest=findRackByLabel(val(row,'Rack Destino',''),state.racks,state.rows);
    if(!origin||!dest){skipped++;continue;}
    const typeRaw=String(val(row,'Tipo',defaultCableType())).trim();
    // Usa o tipo já cadastrado com a grafia oficial dele (ignora diferença de
    // maiúscula/minúscula), ou o texto da planilha se for um tipo não marcado
    // pra cadastro (segue existindo só naquele cabo).
    const matched=cableTypeNames().find(t=>catalogNormalize(t)===catalogNormalize(typeRaw));
    const type=matched||typeRaw||defaultCableType();
    const originU=Math.floor(num(val(row,'U Origem',origin.units),origin.units));
    const destU=Math.floor(num(val(row,'U Destino',dest.units),dest.units));
    const originFace=String(val(row,'Face Origem','')).trim().toLowerCase()==='traseira'?'rear':'front';
    const destFace=String(val(row,'Face Destino','')).trim().toLowerCase()==='traseira'?'rear':'front';
    const originAssets=[assetAtRackU(state.assets,origin.id,originU,originFace)].filter(Boolean);
    const destAssets=[assetAtRackU(state.assets,dest.id,destU,destFace)].filter(Boolean);
    const findPortByLabel=(list,label)=>{
      for(const a of list){
        const port=(a.ports||[]).find(p=>p.label===label);
        if(port)return {asset:a,port};
      }
      return null;
    };
    let originPortId=null, destPortId=null, originPortLabelFree='', destPortLabelFree='';
    const originPortLabel=String(val(row,'Porta Origem','')).trim();
    const destPortLabel=String(val(row,'Porta Destino','')).trim();
    const originHit=originPortLabel?findPortByLabel(originAssets,originPortLabel):null;
    const destHit=destPortLabel?findPortByLabel(destAssets,destPortLabel):null;
    if(originPortLabel){
      if(originHit)originPortId=originHit.port.id;
      else if(originAssets.some(a=>a.ports?.length))portsUnmatched++;
      else originPortLabelFree=originPortLabel; // sem portas cadastradas no modelo: aceita o texto livre sem validar
    }
    if(destPortLabel){
      if(destHit)destPortId=destHit.port.id;
      else if(destAssets.some(a=>a.ports?.length))portsUnmatched++;
      else destPortLabelFree=destPortLabel;
    }
    // Se já existe um asset instalado nessa U, o nome vem sempre dele;
    // senão, aceita o texto informado livremente, sem criar asset.
    const originAsset=originHit?.asset||(originAssets.length===1?originAssets[0]:null);
    const destAsset=destHit?.asset||(destAssets.length===1?destAssets[0]:null);
    const originAssetName=originAsset?originAsset.name:String(val(row,'Nome Asset Origem','')).trim();
    const destAssetName=destAsset?destAsset.name:String(val(row,'Nome Asset Destino','')).trim();
    state.cables.push({id:uid('cable'),name:String(val(row,'Nome',`Cabo-${String(state.cables.length+1).padStart(3,'0')}`)).trim(),type,originRack:origin.id,originU,originFace,originPortId,originPortLabel:originPortLabelFree,originAssetName,destRack:dest.id,destU,destFace,destPortId,destPortLabel:destPortLabelFree,destAssetName,slack:state.defaultSlack,via:[]});
    added++;
  }
  renderAll();
  const parts=[`${added} cabo(s) importado(s).`];
  if(skipped)parts.push(`${skipped} ignorado(s).`);
  if(portsUnmatched)parts.push(`${portsUnmatched} porta(s) não encontrada(s) e deixada(s) em branco.`);
  toast(parts.join(' '));
}
export function cableSummaryRows(){
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
function cablePortAt(rackId,u,portId,face='front'){
  if(!portId)return null;
  const asset=assetOwningPort(state.assets,portId)||assetAtRackU(state.assets,rackId,u,face);
  const p=asset?.ports?.find(p=>p.id===portId);
  return p||null;
}
export function cableEndpointLabel(rackId,u,portId,freeformLabel='',assetNameFallback='',face='front'){
  const rack=state.racks.find(r=>r.id===rackId);
  const asset=assetOwningPort(state.assets,portId)||assetAtRackU(state.assets,rackId,u,face);
  const port=cablePortAt(rackId,u,portId,face);
  return [rack?rackDisplayName(rack):'—',`${u}U`,asset?.name||assetNameFallback||'—',port?.label||freeformLabel||'—'].join(' - ');
}
export function compactPortLabels(labels){
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
export function cablesByRoom(){
  syncActiveRoom();
  const map=new Map();
  (state.rooms||[]).forEach(r=>map.set(r.id,r.data?.cables||[]));
  return map;
}
export async function exportCablesXLSX(){
  beginTask('Exportando cabos…');
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Face Origem','Nome Asset Origem','Porta Origem','Rack Destino','U Destino','Face Destino','Nome Asset Destino','Porta Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Conexões (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota','Etiqueta'];
    const labelCol=headers.indexOf('Etiqueta')+1;
    const rows=state.cables.map(c=>{
      const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);
      const originFace=c.originFace==='rear'?'rear':'front', destFace=c.destFace==='rear'?'rear':'front';
      const oPort=cablePortAt(c.originRack,c.originU,c.originPortId,originFace), dPort=cablePortAt(c.destRack,c.destU,c.destPortId,destFace);
      const label=`${cableEndpointLabel(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName,originFace)}\n${cableEndpointLabel(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName,destFace)}`;
      return [c.name,c.type||defaultCableType(),o?rackDisplayName(o):'',c.originU,originFace==='rear'?'Traseira':'Frente',c.originAssetName||'',oPort?.label||c.originPortLabel||'',d?rackDisplayName(d):'',c.destU,destFace==='rear'?'Traseira':'Frente',c.destAssetName||'',dPort?.label||c.destPortLabel||'',res.v1,res.tray,res.v2,res.connection,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res),label];
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
  finally{endTask();}
}

export function cableSearchHaystack(c){
  const o=state.racks.find(r=>r.id===c.originRack), d=state.racks.find(r=>r.id===c.destRack);
  const originLabel=cableEndpointLabel(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName,c.originFace);
  const destLabel=cableEndpointLabel(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName,c.destFace);
  return [c.name,c.type,o?.name,o&&rackDisplayName(o),d?.name,d&&rackDisplayName(d),c.originU,c.destU,c.originPortLabel,c.destPortLabel,c.originAssetName,c.destAssetName,originLabel,destLabel].filter(Boolean).join(' ').toLowerCase();
}

const CABLE_ICONS={
  plug:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v9l-3 3H8l-3-3Z"/><path d="M9 6v4M12 6v4M15 6v4"/></svg>',
  ruler:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16 12-12 4 4L8 20z"/><path d="m8 12 2 2M11 9l2 2M14 6l2 2"/></svg>'
};
function cableEndpointParts(rackId,u,portId,freeformLabel='',assetNameFallback='',face='front'){
  const rack=state.racks.find(r=>r.id===rackId);
  const asset=assetOwningPort(state.assets,portId)||assetAtRackU(state.assets,rackId,u,face);
  const port=cablePortAt(rackId,u,portId,face);
  return {rack:rack?.name||'',u,asset:asset?.name||assetNameFallback||'',port:port?.label||freeformLabel||''};
}
function cableStatusInfo(c){
  if(!cableUnitValidation(c).valid)return {key:'bad',text:'Cabo inválido',total:0,reachable:false};
  const res=calcCable(c);
  const o=cableEndpointParts(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName,c.originFace);
  const d=cableEndpointParts(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName,c.destFace);
  const oOk=!!(o.asset&&o.port), dOk=!!(d.asset&&d.port);
  const base={total:res.total,reachable:res.reachable};
  if(!oOk&&!dOk)return {...base,key:'warn',text:'Portas não definidas'};
  if(!oOk)return {...base,key:'warn',text:'Origem não definida'};
  if(!dOk)return {...base,key:'warn',text:'Destino não definido'};
  if(!res.reachable)return {...base,key:'warn',text:'Sem rota'};
  return {...base,key:'ok',text:'Conectado'};
}
export function renderCables(){
  const el=$('cablesList'); if(!el)return;
  // Reescrever a lista (innerHTML) zera a rolagem do próprio container: quem estava no meio da
  // lista voltava ao topo ao escolher outro cabo. Guardar e devolver mantém a posição.
  const rolagem=el.scrollTop;
  $('cableCount').textContent=`${state.cables.length} cabo${state.cables.length===1?'':'s'}`;
  cables.cableMultiSelected=cables.cableMultiSelected.filter(id=>state.cables.some(c=>c.id===id));
  const q=cables.cablesSearchQuery.trim().toLowerCase();
  const infoOf=new Map(state.cables.map(c=>[c.id,cableStatusInfo(c)]));
  const filtered=state.cables.filter(c=>(!q||cableSearchHaystack(c).includes(q))&&(cables.cablesFilterMode==='all'||(cables.cablesFilterMode==='ok')===(infoOf.get(c.id).key==='ok')));
  if(!filtered.length){el.innerHTML=`<div class="empty">${(q||cables.cablesFilterMode!=='all')?'Nenhum cabo encontrado.':'Nenhum cabo cadastrado.'}</div>`;}
  else{
    el.innerHTML=filtered.map(c=>{
      const invalid=!cableUnitValidation(c).valid;
      const info=infoOf.get(c.id);
      const o=cableEndpointParts(c.originRack,c.originU,c.originPortId,c.originPortLabel,c.originAssetName,c.originFace);
      const d=cableEndpointParts(c.destRack,c.destU,c.destPortId,c.destPortLabel,c.destAssetName,c.destFace);
      const checked=cables.cableMultiSelected.includes(c.id);
      const isSelected=state.selected?.type==='cable'&&state.selected.id===c.id;
      const color=cableTypeColor(c.type);
      const length=info.reachable?`${Math.ceil(info.total)} m`:'—';
      const endBox=(kind,e)=>{const text=[e.rack||'—',e.u?`U${e.u}`:'—',e.asset||'—',e.port||'—'].join(' - ');return `<div class="cable-end ${kind}" title="${esc(text)}"><i></i><span class="cable-end-text">${esc(text)}</span></div>`;};
      return `<div class="cable-item ${isSelected?'selected':''} ${invalid?'invalid':''} ${checked?'is-checked':''}" style="--cable-color:${esc(color)};${isSelected?'':`border-left-color:${esc(color)}`}" data-cable="${c.id}">
        <label class="cable-item-check" onclick="event.stopPropagation()"><input type="checkbox" data-cable-check="${c.id}" ${checked?'checked':''}></label>
        <div class="cable-item-main">
          <div class="cable-item-top">
            <span class="cable-item-icon">${CABLE_ICONS.plug}</span>
            <div class="cable-item-title"><div class="cable-name-row"><span class="cable-name">${esc(c.name)}</span><span class="cable-len" title="Comprimento arredondado">${CABLE_ICONS.ruler}${length}</span></div></div>
            <span class="cable-type-tag">${esc(c.type||'')}</span>
          </div>
          <div class="cable-route">
            ${endBox('origin',o)}
            <div class="cable-route-foot">
              ${endBox('dest',d)}
              <button type="button" class="iconbtn cable-del" data-cable-del="${c.id}" title="Excluir ${esc(c.name)}" aria-label="Excluir o cabo ${esc(c.name)}">${uiIcon('trash')}</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  }
  el.querySelectorAll('[data-cable]').forEach(x=>x.onclick=e=>{e.stopPropagation();state.multiSelected=[];state.selected={type:'cable',id:x.dataset.cable};renderAll();});
  el.querySelectorAll('[data-cable-check]').forEach(cb=>cb.onchange=()=>{
    const id=cb.dataset.cableCheck;
    if(cb.checked){if(!cables.cableMultiSelected.includes(id))cables.cableMultiSelected.push(id);}
    else cables.cableMultiSelected=cables.cableMultiSelected.filter(x=>x!==id);
    renderCables();
  });
  // Excluir um cabo pela própria linha: o clique não pode virar seleção, então para aqui.
  el.querySelectorAll('[data-cable-del]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    deleteCableById(btn.dataset.cableDel);
  });
  const selectAll=$('cablesSelectAll');
  if(selectAll){
    const visibleIds=filtered.map(c=>c.id);
    const selectedVisible=visibleIds.filter(id=>cables.cableMultiSelected.includes(id)).length;
    selectAll.checked=visibleIds.length>0&&selectedVisible===visibleIds.length;
    selectAll.indeterminate=selectedVisible>0&&selectedVisible<visibleIds.length;
  }
  updateCablesBulkBar();
  el.scrollTop=rolagem;
}
function updateCablesBulkBar(){
  const bar=$('cablesBulkBar'); if(!bar)return;
  bar.classList.toggle('hidden',cables.cableMultiSelected.length===0);
  if($('cablesBulkCount'))$('cablesBulkCount').textContent=String(cables.cableMultiSelected.length);
}
// Excluir um cabo só, direto da lista. Sem confirmação: a barra de ferramentas tem
// Desfazer, e o mesmo caminho do painel de propriedades também remove na hora.
export function deleteCableById(id){
  const c=state.cables.find(x=>x.id===id); if(!c)return;
  state.cables=state.cables.filter(x=>x.id!==id);
  cables.cableMultiSelected=cables.cableMultiSelected.filter(x=>x!==id);
  if(state.selected?.type==='cable'&&state.selected.id===id)state.selected=null;
  renderAll();
  toast(`Cabo ${c.name} exclu\u00eddo`);
}
export async function deleteCablesBulk(){
  const ids=[...cables.cableMultiSelected];
  if(!ids.length)return;
  const ok=await uiConfirm('',{title:`Excluir ${ids.length} cabo(s) selecionado(s)?`,confirmText:'Excluir cabos',danger:true});
  if(!ok)return;
  state.cables=state.cables.filter(c=>!ids.includes(c.id));
  if(state.selected?.type==='cable' && ids.includes(state.selected.id))state.selected=null;
  cables.cableMultiSelected=[];
  renderAll();toast(`${ids.length} cabo(s) excluído(s)`);
}
