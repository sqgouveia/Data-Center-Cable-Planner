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
let toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection, setPropHead, setPropTitleSticky;
export function configureBreakouts(deps){
  ({ toast, save, renderAll, breakoutTypeOf, breakoutLegCables, cablePortConflict, flashSelection, setPropHead, setPropTitleSticky } = deps);
}
const rackName=id=>{const r=state.racks.find(x=>x.id===id);return r?rackDisplayName(r):'—';};
// Rótulo da porta de destino: do asset (porta escolhida por id) ou o texto livre importado.
const destPortName=l=>(l.destPortId&&assetAtRackU(state.assets,l.destRack,l.destU,l.destFace)?.ports?.find(p=>p.id===l.destPortId)?.label)||l.destPortLabel||'';
const fmtM=v=>`${num(v,0).toFixed(2).replace('.',',')} m`;
function reasonText(r,type){
  if(r.reason==='empty')return `Cadastre os tamanhos de "${type}" no catálogo.`;
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
    const size=!r.reachable?'sem rota':r.pick?`${r.pick.m} m · pernas ${r.pick.leg} m`:'⚠';
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
export function addBreakout(){
  if(!state.racks.length){toast('Crie racks primeiro.');return;}
  const types=state.cableCatalogs.breakoutTypes||[];
  if(!types.length){toast('Cadastre um tipo de breakout no catálogo primeiro.');return;}
  const r=state.racks[0];
  const b={id:uid('breakout'),name:`Breakout-${String(state.breakouts.length+1).padStart(3,'0')}`,type:types[0].name,slack:state.defaultSlack,
    origin:{rack:r.id,u:r.units,face:'front',assetName:''},base:'',legs:[]};
  state.breakouts.push(b); state.selected={type:'breakout',id:b.id}; setCablesTab('breakouts'); renderAll(); toast('Breakout adicionado');
}
export function renderBreakoutProperties(p,b){
  if(!b){p.innerHTML='';return;}
  setPropHead('cable','Propriedades do breakout','Ponta MTP, pernas e tamanho do cabo.');
  setPropTitleSticky(b.name);
  const types=state.cableCatalogs.breakoutTypes||[];
  const asset=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face);
  const groups=laneGroups(asset);
  const r=breakoutCalc(b);
  const rackOpts=sel=>state.racks.map(x=>`<option value="${x.id}" ${x.id===sel?'selected':''}>${esc(rackDisplayName(x))}</option>`).join('');
  const destPorts=l=>{const a=l.destRack?assetAtRackU(state.assets,l.destRack,l.destU,l.destFace):null;return '<option value="">— Nenhuma —</option>'+(a?.ports||[]).map(pt=>`<option value="${esc(pt.id)}" ${pt.id===l.destPortId?'selected':''}>${esc(pt.label)}</option>`).join('');};
  const legRow=(l,i)=>{const lc=breakoutLegCables([b]).find(c=>c.id===`${b.id}:${l.lane}`)||{breakoutId:b.id,originRack:b.origin.rack};
    const conflict=l.destPortId?cablePortConflict(lc,'dest',l.destPortId):null;
    const originConflict=l.originPortId?cablePortConflict(lc,'origin',l.originPortId):null;
    return `<div class="breakout-leg" data-leg="${i}"><b>${esc(l.lane)}</b><select data-leg-rack><option value="">— livre —</option>${rackOpts(l.destRack)}</select><input type="number" min="1" data-leg-u value="${l.destU??''}" placeholder="U"><select data-leg-face><option value="front">Frente</option><option value="rear" ${l.destFace==='rear'?'selected':''}>Traseira</option></select><select data-leg-port>${destPorts(l)}</select>${originConflict?`<div class="field-error">Porta ${esc(l.lane)} da origem já usada por "${esc(originConflict.name)}".</div>`:''}${conflict?`<div class="field-error">Porta já usada por "${esc(conflict.name)}".</div>`:''}</div>`;};
  const pick=r.pick;
  p.innerHTML=`<div class="prop-group breakout-props">
    <label class="prop-field">Nome<input id="boName" value="${esc(b.name)}"></label>
    <label class="prop-field">Tipo<select id="boType">${types.map(t=>`<option ${t.name===b.type?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
    <div class="prop-subtitle">Origem (ponta MTP)</div>
    <label class="prop-field">Rack<select id="boRack">${rackOpts(b.origin.rack)}</select></label>
    <label class="prop-field">U<input id="boU" type="number" min="1" value="${b.origin.u}"></label>
    <label class="prop-field">Face<select id="boFace"><option value="front">Frente</option><option value="rear" ${b.origin.face==='rear'?'selected':''}>Traseira</option></select></label>
    <label class="prop-field">Porta MTP<select id="boBase"><option value="">—</option>${[...groups.keys()].map(k=>`<option ${k===b.base?'selected':''}>${esc(k)}</option>`).join('')}</select></label>
    ${asset&&!groups.size?'<div class="field-error">Este equipamento não tem portas no formato 1A, 1B…</div>':''}
    <div class="prop-subtitle">Pernas</div>
    ${b.legs.map(legRow).join('')||'<div class="empty">Escolha a porta MTP para listar as pernas.</div>'}
    <label class="prop-field">Folga (%)<input id="boSlack" type="number" min="0" step="1" value="${b.slack??state.defaultSlack}"></label>
    <div class="breakout-result">
      ${!r.reachable?'<div class="unreachable">Alguma perna não tem rota pelas calhas.</div>':`
      <div class="cable-metric"><span class="cable-metric-label">Tronco necessário</span><b>${fmtM(r.trunkNeeded)}</b></div>
      <div class="cable-metric"><span class="cable-metric-label">Perna necessária</span><b>${fmtM(r.legNeeded)}</b></div>
      ${pick?`<div class="cable-metric is-rounded"><span class="cable-metric-label">Cabo escolhido</span><b>${pick.m} m · pernas ${pick.leg} m · tronco ${Math.round((pick.m-pick.leg)*100)/100} m</b></div>`:''}
      ${pick?.price!=null?`<div class="cable-metric is-price"><span class="cable-metric-label">Preço</span><b>${formatBRL(pick.price)}</b></div>`:''}
      ${r.reason?`<div class="validation-error">${uiIcon('warn')} ${esc(reasonText(r,b.type))}</div>`:''}`}
    </div>
    <button type="button" id="delBreakout" class="btn danger small">${uiIcon('trash')} Excluir breakout</button>
  </div>`;
  const upd=fn=>()=>{fn();save();renderAll(false);};
  $('boName').onchange=upd(()=>{b.name=$('boName').value.trim()||b.name;});
  $('boType').onchange=upd(()=>{b.type=$('boType').value;});
  $('boSlack').onchange=upd(()=>{b.slack=Math.max(0,num($('boSlack').value,0));});
  const resetOrigin=()=>{b.base='';b.legs=[];b.origin.assetName=assetAtRackU(state.assets,b.origin.rack,b.origin.u,b.origin.face)?.name||'';};
  $('boRack').onchange=upd(()=>{b.origin.rack=$('boRack').value;resetOrigin();});
  $('boU').onchange=upd(()=>{b.origin.u=Math.max(1,Math.floor(num($('boU').value,1)));resetOrigin();});
  $('boFace').onchange=upd(()=>{b.origin.face=$('boFace').value==='rear'?'rear':'front';resetOrigin();});
  $('boBase').onchange=upd(()=>{
    const old=new Map(b.legs.map(l=>[l.lane,l])); b.base=$('boBase').value;
    b.legs=(groups.get(b.base)||[]).sort((x,y)=>x.lane.localeCompare(y.lane)).map(g=>({...(old.get(g.lane)||{destRack:null,destU:null,destFace:'front',destPortId:null,destPortLabel:'',destAssetName:''}),lane:g.lane,originPortId:g.port.id,originPortLabel:''}));
  });
  p.querySelectorAll('[data-leg]').forEach(row=>{
    const l=b.legs[Number(row.dataset.leg)];
    const destAsset=()=>l.destRack?assetAtRackU(state.assets,l.destRack,l.destU,l.destFace):null;
    const reset=()=>{l.destPortId=null;l.destPortLabel='';l.destAssetName=destAsset()?.name||'';};
    row.querySelector('[data-leg-rack]').onchange=upd(()=>{l.destRack=row.querySelector('[data-leg-rack]').value||null;l.destU=l.destU||state.racks.find(x=>x.id===l.destRack)?.units||1;reset();});
    row.querySelector('[data-leg-u]').onchange=upd(()=>{l.destU=Math.max(1,Math.floor(num(row.querySelector('[data-leg-u]').value,1)));reset();});
    row.querySelector('[data-leg-face]').onchange=upd(()=>{l.destFace=row.querySelector('[data-leg-face]').value==='rear'?'rear':'front';reset();});
    row.querySelector('[data-leg-port]').onchange=upd(()=>{l.destPortId=row.querySelector('[data-leg-port]').value||null;});
  });
  $('delBreakout').onclick=()=>{state.breakouts=state.breakouts.filter(x=>x!==b);state.selected=null;renderAll();toast('Breakout excluído');};
}
// Resumo de compra: 1 item por breakout, agrupado por tipo + total + perna.
export function breakoutSummaryRows(list=state.breakouts){
  const groups=new Map(); let noPick=0;
  for(const b of list){
    const r=breakoutCalc(b);
    if(!r.pick){noPick++;continue;}
    const key=`${b.type}|${r.pick.m}|${r.pick.leg}`;
    const g=groups.get(key)||{type:b.type,m:r.pick.m,leg:r.pick.leg,price:r.pick.price,qty:0};
    g.qty++; groups.set(key,g);
  }
  return{rows:[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.m-b.m||a.leg-b.leg),noPick};
}
