// Pure helpers with no dependency on app state or the DOM.
export const $ = id => document.getElementById(id);

// Barra de tarefa indeterminada para operações que demoram (importar/exportar
// planilha, gerar PDF). O contador aguenta chamadas aninhadas: só esconde
// quando a última tarefa termina.
let taskDepth = 0;
let taskHideTimer = null;
export function beginTask(label){
  taskDepth += 1;
  const bar = document.getElementById('taskBar');
  if(!bar) return;
  clearTimeout(taskHideTimer);
  const text = document.getElementById('taskBarLabel');
  if(text && label) text.textContent = label;
  bar.classList.remove('hidden');
  bar.setAttribute('aria-hidden','false');
}
export function endTask(){
  taskDepth = Math.max(0, taskDepth - 1);
  const bar = document.getElementById('taskBar');
  if(!bar || taskDepth > 0) return;
  taskHideTimer = setTimeout(()=>bar.classList.add('hidden'), 240);
}

export function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }

export function cloneData(value){
  if(value===undefined)return undefined;
  if(value===null)return null;
  if(typeof structuredClone==='function'){try{return structuredClone(value);}catch(_){}}
  try{return JSON.parse(JSON.stringify(value));}catch(_){return value;}
}

export function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }

export function dateUrgencyLevel(dateStr,warnDays){
  if(!dateStr)return 'none';
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime()))return 'none';
  const daysLeft=Math.round((d-today)/86400000);
  if(daysLeft<0)return 'expired';
  if(daysLeft<=warnDays)return 'soon';
  return 'ok';
}
export function formatAssetDate(dateStr){
  if(!dateStr)return '';
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d.getTime()))return '';
  return d.toLocaleDateString('pt-BR');
}

export function catalogNormalize(value){
  return String(value??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'');
}
export function catalogSimilarity(a,b){
  const x=catalogNormalize(a),y=catalogNormalize(b); if(!x||!y)return 0; if(x===y)return 1;
  const prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){let cur=[i];for(let j=1;j<=y.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev.splice(0,prev.length,...cur);}
  return 1-prev[y.length]/Math.max(x.length,y.length);
}
export function catalogSimilar(value,values){
  const norm=catalogNormalize(value); if(!norm)return [];
  return [...new Set((values||[]).map(v=>String(v))).values()].filter(v=>catalogNormalize(v)!==norm&&catalogSimilarity(value,v)>=0.84).sort((a,b)=>catalogSimilarity(value,b)-catalogSimilarity(value,a));
}
export function catalogKeyLabel(key){return key==='types'?'Tipos de ativo':key==='manufacturers'?'Fabricantes':key==='statuses'?'Status':key==='substatuses'?'Substatus':'Modelos';}

export function parsePortTemplate(str){
  const m=String(str||'').match(/^(.*?)(\d+)(\D*)$/);
  if(!m)return null;
  return {prefix:m[1],suffix:m[3],num:parseInt(m[2],10),width:m[2].length};
}
export function buildPortRange(startLabel,endLabel){
  const a=parsePortTemplate(startLabel), b=parsePortTemplate(endLabel);
  if(!a||!b)return null;
  if(a.prefix!==b.prefix||a.suffix!==b.suffix)return null;
  if(b.num<a.num)return null;
  if(b.num-a.num+1>500)return null;
  const width=Math.max(a.width,b.width);
  const out=[];
  for(let n=a.num;n<=b.num;n++) out.push(a.prefix+String(n).padStart(width,'0')+a.suffix);
  return out;
}
export function expandPortDefs(portDefs){
  const ports=[];
  (portDefs||[]).forEach(def=>{
    if(def.kind==='range'){
      const range=buildPortRange(def.startLabel,def.endLabel);
      if(!range)return;
      range.forEach(label=>ports.push({id:uid('port'),label,poe:!!def.poe}));
    }else{
      ports.push({id:uid('port'),label:def.label,poe:!!def.poe});
    }
  });
  return ports;
}
export function totalPortDefsCount(portDefs){
  return (portDefs||[]).reduce((sum,def)=>{
    if(def.kind==='range'){const r=buildPortRange(def.startLabel,def.endLabel);return sum+(r?r.length:0);}
    return sum+1;
  },0);
}

export function excelColumnLetter(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}

export function parseImportDate(value){
  const s=String(value||'').trim(); if(!s)return '';
  let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(m)return s;
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){const dd=m[1].padStart(2,'0'),mm=m[2].padStart(2,'0');return `${m[3]}-${mm}-${dd}`;}
  return '';
}
export function parseImportNumber(v,fallback=0){const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:fallback;}
