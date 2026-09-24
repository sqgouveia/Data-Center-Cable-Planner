// Modelo do cabo MTP breakout, sem DOM: perna pela letra da porta (1A…1H), produtos do
// fornecedor (total + perna), escolha do produto, perna como cabo virtual e o agrupamento
// das linhas importadas. Testado em js/test/breakout-model.test.mjs.
import { catalogNormalize, parseImportNumber } from './utils.js';

const LANES = 'ABCDEFGH';

export function breakoutLane(label){
  const m=/^(.*\d)([A-H])$/i.exec(String(label??'').trim());
  return m?{base:m[1],lane:m[2].toUpperCase()}:null;
}
export function isBreakoutTypeName(name,breakoutTypes=[]){
  const n=catalogNormalize(name);
  return n.includes('breakout')||n.includes('mtp')||breakoutTypes.some(t=>catalogNormalize(t.name)===n);
}
// Produtos do fornecedor: { m: total, leg: perna, price? }. Só m>0, leg>0 e leg<m; um por
// (total, perna); ordenados por total e depois perna — pickBreakoutLength depende dessa ordem.
export function normalizeBreakoutLengths(list){
  const byKey=new Map();
  (Array.isArray(list)?list:[]).forEach(x=>{
    const m=Math.round(parseImportNumber(x?.m,0)*100)/100, leg=Math.round(parseImportNumber(x?.leg,0)*100)/100;
    if(!(m>0&&leg>0&&leg<m))return;
    const p=x?.price===''||x?.price==null?NaN:parseImportNumber(x.price,NaN);
    byKey.set(m+'|'+leg,Number.isFinite(p)&&p>=0?{m,leg,price:p}:{m,leg});
  });
  return [...byKey.values()].sort((a,b)=>a.m-b.m||a.leg-b.leg);
}
export function pickBreakoutLength(trunkNeeded,legNeeded,lengths){
  const list=lengths||[], eps=1e-9;
  const pick=list.find(x=>x.leg>=legNeeded-eps&&x.m-x.leg>=trunkNeeded-eps);
  if(pick)return{pick:{m:pick.m,leg:pick.leg,price:pick.price??null},reason:null};
  if(!list.length)return{pick:null,reason:'empty'};
  return{pick:null,reason:list.some(x=>x.leg>=legNeeded-eps)?'total':'leg'};
}
// Cada perna, para o resto do app, é um cabo comum da porta da perna até o destino dela.
export function breakoutLegCable(b,l){
  return{id:`${b.id}:${l.lane}`,breakoutId:b.id,name:`${b.name} ${l.lane}`,type:b.type,
    originRack:b.origin.rack,originU:b.origin.u,originFace:b.origin.face,originPortId:l.originPortId||null,originPortLabel:l.originPortLabel||'',originAssetName:b.origin.assetName||'',
    destRack:l.destRack,destU:l.destU,destFace:l.destFace,destPortId:l.destPortId||null,destPortLabel:l.destPortLabel||'',destAssetName:l.destAssetName||'',
    slack:b.slack,routeMode:'automatic',via:[]};
}
function flipCable(c){
  return{...c,originRack:c.destRack,originU:c.destU,originFace:c.destFace,originPortId:c.destPortId,originPortLabel:c.destPortLabel,originAssetName:c.destAssetName,
    destRack:c.originRack,destU:c.originU,destFace:c.originFace,destPortId:c.originPortId,destPortLabel:c.originPortLabel,destAssetName:c.originAssetName};
}
// Separa dos cabos importados as pernas de breakout: tipo breakout/MTP e porta com letra na
// origem (ou no destino — aí a linha é invertida). Mesmo equipamento (rack+U+face) e mesma base
// de porta = um breakout. portLabel(c,'origin'|'dest') devolve o rótulo da porta.
export function groupBreakoutCables(cables,portLabel,isBreakoutType){
  const rest=[], groups=new Map();
  for(const c of cables){
    if(!isBreakoutType(c.type)){rest.push(c);continue;}
    const side=breakoutLane(portLabel(c,'origin'))?'origin':breakoutLane(portLabel(c,'dest'))?'dest':null;
    if(!side){rest.push(c);continue;}
    const f=side==='origin'?c:flipCable(c);
    const {base,lane}=breakoutLane(portLabel(c,side));
    const key=[f.originRack,f.originU,f.originFace,catalogNormalize(base)].join('|');
    // O export grava cada perna como "<nome> <letra>": tira a letra para não crescer a cada ida e volta.
    if(!groups.has(key))groups.set(key,{name:String(f.name??'').replace(new RegExp(`\\s+${lane}$`,'i'),''),type:f.type,slack:f.slack,origin:{rack:f.originRack,u:f.originU,face:f.originFace,assetName:f.originAssetName||''},base,legs:[]});
    const g=groups.get(key);
    if(g.legs.some(l=>l.lane===lane)){rest.push(c);continue;}
    g.legs.push({lane,originPortId:f.originPortId||null,originPortLabel:f.originPortLabel||'',destRack:f.destRack,destU:f.destU,destFace:f.destFace,destPortId:f.destPortId||null,destPortLabel:f.destPortLabel||'',destAssetName:f.destAssetName||''});
  }
  const breakouts=[...groups.values()].map(g=>({...g,legs:g.legs.sort((a,b)=>a.lane.localeCompare(b.lane))}));
  return{cables:rest,breakouts};
}
// Tipo do breakout importado: o próprio nome, se já é tipo de breakout; senão um tipo que
// contenha o nome do cabo e tenha pernas bastantes; senão um novo "<tipo> — breakout 1×N".
export function resolveBreakoutType(typeName,maxLane,breakoutTypes){
  const n=catalogNormalize(typeName), legs=Math.max(4,LANES.indexOf(maxLane)+1);
  const exact=breakoutTypes.find(t=>catalogNormalize(t.name)===n);
  if(exact)return{name:exact.name,created:null};
  const near=breakoutTypes.find(t=>catalogNormalize(t.name).includes(n)&&(t.legs||4)>=legs);
  if(near)return{name:near.name,created:null};
  const name=`${typeName} — breakout 1×${legs}`;
  return{name,created:{name,color:'#2dd4bf',legs,lengths:[]}};
}
