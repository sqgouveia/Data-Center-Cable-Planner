// Cabos MTP breakout: aba "Breakouts" do card Cabos, painel de propriedades, novo breakout e
// as linhas de resumo/export. A conta fica em routing.js (calcBreakout); o modelo em
// breakout-model.js.
import { uid, esc, num, $, uiIcon, formatBRL } from './utils.js';
import { state } from './state.js';
import { rackDisplayName } from './geometry.js';
import { calcBreakout } from './routing.js';
import { breakoutLane } from './breakout-model.js';
import { assetAtRackU } from './occupancy.js';
export const breakouts = { tab: 'cables', query: '' };
let toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection, setPropHead, setPropTitleSticky, propIcon, bindCablePanelSections, CABLE_METRIC_ICONS;
export function configureBreakouts(deps){
  ({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection, setPropHead, setPropTitleSticky, propIcon, bindCablePanelSections, CABLE_METRIC_ICONS } = deps);
}
const rackName=id=>{const r=state.racks.find(x=>x.id===id);return r?rackDisplayName(r):'—';};
// Rótulo da porta de destino: do asset (porta escolhida por id) ou o texto livre importado.
const destPortName=l=>(l.destPortId&&assetAtRackU(state.assets,l.destRack,l.destU,l.destFace)?.ports?.find(p=>p.id===l.destPortId)?.label)||l.destPortLabel||'';
const fmtM=v=>`${num(v,0).toFixed(2).replace('.',',')} m`;
function reasonText(r,type){
  if(r.reason==='empty')return r.pick?.legShort?`Medida estimada com pernas de 1 m, mas a perna precisa de ${fmtM(r.legNeeded)}. Cadastre os tamanhos de "${type}" no catálogo.`:`Medida estimada: tronco + pernas de 1 m. Cadastre os tamanhos de "${type}" para usar os do fornecedor.`;
  if(r.reason==='leg')return 'Destinos muito distantes para este breakout — considere tronco MTP + cassete.';
  if(r.reason==='total')return 'Passa do maior tamanho cadastrado para este tipo.';
  return '';
}
export function breakoutCalc(b){return calcBreakout(b,breakoutTypeOf(b.type));}
export function setCablesTab(tab){
  breakouts.tab=tab;
  document.querySelectorAll('[data-cables-tab]').forEach(t=>{const on=t.dataset.cablesTab===tab;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on));});
  $('cablesPane')&&($('cablesPane').hidden=tab!=='cables');
  $('breakoutsPane')&&($('breakoutsPane').hidden=tab!=='breakouts');
  renderBreakoutsList();
}
export function renderBreakoutsList(){
  const el=$('breakoutsList'); if(!el)return;
  $('breakoutsTabCount')&&($('breakoutsTabCount').textContent=state.breakouts.length);
  $('cablesTabCount')&&($('cablesTabCount').textContent=state.cables.length);
  const q=breakouts.query.toLowerCase().trim();
  const hay=b=>[b.name,b.type,rackName(b.origin.rack),b.origin.assetName,...b.legs.flatMap(l=>[l.lane,rackName(l.destRack),l.destAssetName,destPortName(l)])].join(' ').toLowerCase();
  const list=state.breakouts.filter(b=>!q||hay(b).includes(q));
  el.innerHTML=list.map(b=>{
    const r=breakoutCalc(b), color=breakoutTypeOf(b.type)?.color||'var(--route)';
    const size=!r.reachable?'sem rota':r.pick?`${r.pick.m} m · pernas ${r.pick.leg} m${r.pick.estimated?' (estimado)':''}`:'⚠';
    const sel=state.selected?.type==='breakout'&&state.selected.id===b.id;
    return `<div class="cable-item breakout-item ${sel?'selected':''}" style="--cable-color:${esc(color)};border-left-color:${esc(color)}" data-breakout="${b.id}">
      <div class="cable-item-main"><div class="cable-name-row"><span class="cable-name">${esc(b.name)}</span><span class="cable-len">${esc(size)}</span></div>
      <div class="breakout-legs">${b.legs.map(l=>`<div class="cable-end"><i></i><span class="cable-end-text">${esc(l.lane)} → ${esc(l.destRack?[rackName(l.destRack),'U'+l.destU,l.destAssetName||'—',destPortName(l)||'—'].join(' · '):'livre')}</span></div>`).join('')}</div></div></div>`;
  }).join('')||'<div class="empty">Nenhum breakout. Importe a planilha de cabos (tipo MTP/breakout e portas 1A, 1B…) ou clique em "+ Breakout".</div>';
  el.querySelectorAll('[data-breakout]').forEach(it=>it.onclick=()=>{state.selected={type:'breakout',id:it.dataset.breakout};state.multiSelected=[];renderAll(false);flashSelection?.();});
}
// Portas do equipamento de origem agrupadas pela base (1 → 1A,1B,1C,1D).
function laneGroups(asset){
  const m=new Map();
  (asset?.ports||[]).forEach(p=>{const l=breakoutLane(p.label);if(!l)return;if(!m.has(l.base))m.set(l.base,[]);m.get(l.base).push({...l,port:p});});
  return m;
}
// Cabo novo com tipo de breakout escolhido: vira breakout na mesma origem. Se a porta de origem
// é uma perna (1A…), a porta MTP é a base dela e o destino do cabo vai para essa perna.
export function cableToBreakout(c,typeName){
  const asset=assetAtRackU(state.assets,c.originRack,c.originU,c.originFace||'front');
  const lane=breakoutLane(asset?.ports?.find(p=>p.id===c.originPortId)?.label);
  const group=lane?(laneGroups(asset).get(lane.base)||[]):[];
  const empty={destRack:null,destU:null,destFace:'front',destPortId:null,destPortLabel:'',destAssetName:''};
  const legs=group.sort((x,y)=>x.lane.localeCompare(y.lane)).map(g=>({...(g.lane===lane.lane?{destRack:c.destRack,destU:c.destU,destFace:c.destFace||'front',destPortId:c.destPortId||null,destPortLabel:c.destPortLabel||'',destAssetName:c.destAssetName||''}:empty),lane:g.lane,originPortId:g.port.id,originPortLabel:''}));
  const b={id:uid('breakout'),name:c.name,type:typeName,slack:c.slack??state.defaultSlack,
    origin:{rack:c.originRack,u:c.originU,face:c.originFace||'front',assetName:asset?.name||c.originAssetName||''},base:lane?.base||'',legs};
  state.cables=state.cables.filter(x=>x!==c);
  state.breakouts.push(b); state.selected={type:'breakout',id:b.id}; setCablesTab('breakouts'); renderAll(); toast('Cabo convertido em breakout');
}
export function addBreakout(){
  if(!state.racks.length){toast('Crie racks primeiro.');return;}
  const types=state.cableCatalogs.breakoutTypes||[];
  if(!types.length){toast('Cadastre um tipo de breakout no catálogo primeiro.');return;}
  const r=state.racks[0];
  const b={id:uid('breakout'),name:`Breakout-${String(state.breakouts.length+1).padStart(3,'0')}`,type:types[0].name,slack:state.defaultSlack,
    origin:{rack:r.id,u:r.units,face:'front',assetName:''},base:'',legs:[]};
  state.breakouts.push(b); state.selected={type:'breakout',id:b.id}; setCablesTab('breakouts'); renderAll(); toast('Breakout adicionado');
}
// Pernas do breakout: uma linha por perna do tipo (4 pernas = A–D), mais as que já têm destino
// além disso. A porta de origem de cada perna é a porta MTP + a letra (1A…): ligada à porta do
// equipamento quando ela existe, senão fica como texto.
const LANES='ABCDEFGH';
function syncLegs(b){
  const asset=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face);
  const used=b.legs.filter(l=>l.destRack||l.destPortLabel).map(l=>LANES.indexOf(l.lane)+1);
  const n=Math.min(8,Math.max(breakoutTypeOf(b.type)?.legs||4,...used));
  const old=new Map(b.legs.map(l=>[l.lane,l]));
  b.legs=[...LANES.slice(0,n)].map(lane=>{
    const l=old.get(lane)||{destRack:null,destU:null,destFace:'front',destPortId:null,destPortLabel:'',destAssetName:''};
    const label=b.base?`${b.base}${lane}`:'';
    const port=label?(asset?.ports||[]).find(p=>p.label.toLowerCase()===label.toLowerCase()):null;
    return{...l,lane,originPortId:port?.id||null,originPortLabel:port?'':label};
  });
}
export function renderBreakoutProperties(p,b){
  if(!b){p.innerHTML='';return;}
  setPropHead('cable','Propriedades do breakout','Ponta MTP, pernas e tamanho do cabo.');
  setPropTitleSticky(b.name);
  syncLegs(b);
  const types=state.cableCatalogs.breakoutTypes||[];
  const asset=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face);
  const r=breakoutCalc(b);
  const hasDest=b.legs.some(l=>l.destRack);
  const rackOpts=sel=>state.racks.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(rackDisplayName(x))}</option>`).join('');
  const destAssetOf=l=>l.destRack?assetAtRackU(state.assets,l.destRack,l.destU,l.destFace):null;
  // Mesma linguagem visual do painel do cabo: cartão, rótulo com ícone, caixa por campo e
  // sub-cartões recolhíveis (Origem, Pernas, Extras).
  const caret='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const fieldLabel=(icon,label,req)=>`<span class="prop-field-label">${propIcon(icon)}<span class="prop-field-text">${label}${req?' <i class="req">*</i>':''}</span></span>`;
  const subHead=(icon,label)=>`<header class="prop-sub-head">${fieldLabel(icon,label)}<button type="button" class="panel-step-toggle" aria-expanded="true" aria-label="Recolher ${label}">${caret}</button></header>`;
  const faceOpts=f=>`<option value="front" ${f!=='rear'?'selected':''}>Frente</option><option value="rear" ${f==='rear'?'selected':''}>Traseira</option>`;
  const metric=(icon,label,value,cls='')=>`<div class="cable-metric ${cls}"><span class="cable-metric-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${CABLE_METRIC_ICONS[icon]}</svg></span><span class="cable-metric-label">${label}</span><b>${value}</b></div>`;
  const legRow=(l,i)=>{const lc=breakoutLegCables([b]).find(c=>c.id===`${b.id}:${l.lane}`)||{breakoutId:b.id,originRack:b.origin.rack};
    const conflict=l.destPortId?cablePortConflict(lc,'dest',l.destPortId):null;
    const originConflict=l.originPortId?cablePortConflict(lc,'origin',l.originPortId):null;
    const da=destAssetOf(l), portText=(l.destPortId&&da?.ports?.find(pt=>pt.id===l.destPortId)?.label)||l.destPortLabel||'';
    return `<div class="breakout-leg" data-leg="${i}">
      <div class="breakout-leg-head"><b>Perna ${esc(l.lane)}</b><span>${esc(b.base?`porta ${b.base}${l.lane}`:'')}</span></div>
      <div class="prop-grid-3">
        <label class="prop-field">${fieldLabel('rack','Rack')}<span class="prop-field-box"><select data-leg-rack><option value="">— livre —</option>${rackOpts(l.destRack)}</select></span></label>
        <label class="prop-field prop-field-u">${fieldLabel('u','U')}<span class="prop-field-box has-spin"><input type="number" min="1" data-leg-u value="${l.destU??''}"></span></label>
        <label class="prop-field">${fieldLabel('face','Face')}<span class="prop-field-box"><select data-leg-face>${faceOpts(l.destFace)}</select></span></label>
      </div>
      <div class="grid2">
        <label class="prop-field">${fieldLabel('asset','Asset')}<span class="prop-field-box"><input data-leg-asset value="${esc(da?.name||l.destAssetName||'')}" placeholder="Equipamento" ${da?'disabled':''}></span></label>
        <label class="prop-field">${fieldLabel('port','Porta')}<span class="prop-field-box"><input data-leg-port list="boPorts${i}" value="${esc(portText)}" placeholder="Ex.: eth1" autocomplete="off"></span><datalist id="boPorts${i}">${(da?.ports||[]).map(pt=>`<option value="${esc(pt.label)}"></option>`).join('')}</datalist></label>
      </div>
      ${originConflict?`<div class="field-error">Porta ${esc(b.base+l.lane)} da origem já usada pelo cabo "${esc(originConflict.name)}".</div>`:''}${conflict?`<div class="field-error">Porta já usada pelo cabo "${esc(conflict.name)}".</div>`:''}
    </div>`;};
  const pick=r.pick;
  const bases=[...laneGroups(asset).keys()];
  p.innerHTML=`<div class="prop-card cable-panel breakout-props">
  <div class="grid2">
    <label class="prop-field">${fieldLabel('name','Nome',true)}<span class="prop-field-box"><input id="boName" value="${esc(b.name)}"></span></label>
    <label class="prop-field">${fieldLabel('type','Tipo',true)}<span class="prop-field-box"><select id="boType">${types.map(t=>`<option ${t.name===b.type?'selected':''}>${esc(t.name)}</option>`).join('')}</select></span></label>
  </div>
  <div class="prop-card-sub" data-panel-step="origem">
    ${subHead('arrowUp','Origem (ponta MTP)')}
    <div class="prop-sub-body">
      <div class="prop-grid-3">
        <label class="prop-field">${fieldLabel('rack','Rack',true)}<span class="prop-field-box"><select id="boRack">${rackOpts(b.origin.rack)}</select></span></label>
        <label class="prop-field prop-field-u">${fieldLabel('u','U',true)}<span class="prop-field-box has-spin"><input id="boU" type="number" min="1" value="${b.origin.u}"></span></label>
        <label class="prop-field">${fieldLabel('face','Face',true)}<span class="prop-field-box"><select id="boFace">${faceOpts(b.origin.face)}</select></span></label>
      </div>
      <div class="grid2">
        <label class="prop-field">${fieldLabel('asset','Asset')}<span class="prop-field-box"><input id="boAsset" value="${esc(asset?.name||b.origin.assetName||'')}" placeholder="Nome do equipamento" ${asset?'disabled':''}></span><small class="field-help-inline">${asset?'(automático)':'(opcional)'}</small></label>
        <label class="prop-field">${fieldLabel('port','Porta MTP')}<span class="prop-field-box"><input id="boBase" list="boBases" value="${esc(b.base||'')}" placeholder="Ex.: 1" autocomplete="off"></span><datalist id="boBases">${bases.map(k=>`<option value="${esc(k)}"></option>`).join('')}</datalist></label>
      </div>
    </div>
  </div>
  <div class="prop-card-sub" data-panel-step="pernas">
    ${subHead('arrowDown',`Pernas (${b.legs.length})`)}
    <div class="prop-sub-body">${b.legs.map(legRow).join('')}</div>
  </div>
  <div class="prop-card-sub" data-panel-step="extras">
    ${subHead('sliders','Extras')}
    <div class="prop-sub-body">
      <label class="prop-field">${fieldLabel('percent','Folga (%)')}<span class="prop-field-box has-spin"><input id="boSlack" type="number" min="0" step="1" value="${b.slack??state.defaultSlack}"></span></label>
      <div class="prop-readout">${propIcon('info','prop-readout-icon')}<span>A folga entra no tronco e na perna.</span></div>
    </div>
  </div>
  <div class="cable-metrics">
    ${!hasDest?'<div class="unreachable">Informe o destino de pelo menos uma perna.</div>':!r.reachable?'<div class="unreachable">Alguma perna não tem rota pelas calhas.</div>':
      metric('tray','Tronco necessário',fmtM(r.trunkNeeded))
      +metric('downArrow','Perna necessária',fmtM(r.legNeeded))
      +(pick?metric('upArrow',pick.estimated?'Cabo estimado':'Cabo escolhido',`${pick.m} m · pernas ${pick.leg} m`,'is-rounded'):'')
      +(pick?.price!=null?metric('ruler','Preço',formatBRL(pick.price),'is-price'):'')
      +(r.reason?`<div class="validation-error">${uiIcon('warn')} ${esc(reasonText(r,b.type))}</div>`:'')}
  </div>
  <button class="btn danger full" id="delBreakout" type="button">${propIcon('trash')}Excluir breakout</button>
  <div class="prop-footnote">${propIcon('info')}Alterações salvas automaticamente.</div>
  </div>`;
  bindCablePanelSections(p);
  const upd=fn=>()=>{fn();syncLegs(b);save();renderAll(false);};
  $('boName').onchange=upd(()=>{b.name=$('boName').value.trim()||b.name;});
  $('boType').onchange=upd(()=>{b.type=$('boType').value;});
  $('boSlack').onchange=upd(()=>{b.slack=Math.max(0,num($('boSlack').value,0));});
  const originAsset=()=>{b.origin.assetName=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face)?.name||b.origin.assetName||'';};
  $('boRack').onchange=upd(()=>{b.origin.rack=$('boRack').value;originAsset();});
  $('boU').onchange=upd(()=>{b.origin.u=Math.max(1,Math.floor(num($('boU').value,1)));originAsset();});
  $('boFace').onchange=upd(()=>{b.origin.face=$('boFace').value==='rear'?'rear':'front';originAsset();});
  $('boAsset').onchange=upd(()=>{b.origin.assetName=$('boAsset').value.trim();});
  // "1A" digitado vira a porta MTP "1".
  $('boBase').onchange=upd(()=>{const v=$('boBase').value.trim();b.base=breakoutLane(v)?.base||v;});
  p.querySelectorAll('[data-leg]').forEach(row=>{
    const l=b.legs[Number(row.dataset.leg)];
    const reset=()=>{l.destPortId=null;l.destPortLabel='';l.destAssetName=destAssetOf(l)?.name||'';};
    row.querySelector('[data-leg-rack]').onchange=upd(()=>{l.destRack=row.querySelector('[data-leg-rack]').value||null;l.destU=l.destU||state.racks.find(x=>x.id===l.destRack)?.units||1;reset();});
    row.querySelector('[data-leg-u]').onchange=upd(()=>{l.destU=Math.max(1,Math.floor(num(row.querySelector('[data-leg-u]').value,1)));reset();});
    row.querySelector('[data-leg-face]').onchange=upd(()=>{l.destFace=row.querySelector('[data-leg-face]').value==='rear'?'rear':'front';reset();});
    row.querySelector('[data-leg-asset]').onchange=upd(()=>{l.destAssetName=row.querySelector('[data-leg-asset]').value.trim();});
    // Porta digitada: se bate com uma porta do equipamento de destino, liga nela; senão fica o texto.
    row.querySelector('[data-leg-port]').onchange=upd(()=>{
      const text=row.querySelector('[data-leg-port]').value.trim();
      const port=(destAssetOf(l)?.ports||[]).find(pt=>pt.label.toLowerCase()===text.toLowerCase());
      l.destPortId=port?.id||null; l.destPortLabel=port?'':text;
    });
  });
  $('delBreakout').onclick=()=>{state.breakouts=state.breakouts.filter(x=>x!==b);state.selected=null;renderAll();toast('Breakout excluído');};
}
// Resumo de compra: 1 item por breakout, agrupado por tipo + total + perna.
export function breakoutSummaryRows(list=state.breakouts){
  const groups=new Map(); let noPick=0;
  for(const b of list){
    const r=breakoutCalc(b);
    if(!r.pick){noPick++;continue;}
    const key=`${b.type}|${r.pick.m}|${r.pick.leg}|${!!r.pick.estimated}`;
    const g=groups.get(key)||{type:b.type,m:r.pick.m,leg:r.pick.leg,price:r.pick.price,estimated:!!r.pick.estimated,qty:0};
    g.qty++; groups.set(key,g);
  }
  return{rows:[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.m-b.m||a.leg-b.leg),noPick};
}
