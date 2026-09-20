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

// Conjunto único de ícones do sistema. Todo ícone é SVG de traço, herdando
// currentColor — nada de glifo de texto (×, ＋, ✓) convivendo com SVG.
export const UI_ICONS = {
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="M5 13l4 4L19 7"/>',
  warn:'<path d="M12 4 2.6 19.4h18.8L12 4Z"/><path d="M12 9.4v4.4M12 16.6h.01"/>',
  pencil:'<path d="m9 2 1.5 1.5L14 6l-8 8-4 1 1-4 8-8Z"/><path d="M13 5.5 16 2l4.5 4.5L17 10"/>',
  trash:'<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  chevron:'<path d="M6 9.5l6 6 6-6"/>',
  link:'<path d="M9.5 14.5 14.5 9.5"/><path d="M7 12 4.8 14.2a3.7 3.7 0 0 0 5.2 5.2L12.2 17"/><path d="M12 7 14.2 4.8a3.7 3.7 0 0 1 5.2 5.2L17.2 12"/>',
  hourglass:'<path d="M7 3h10v4l-5 5 5 5v4H7v-4l5-5-5-5V3Z"/>',
  refresh:'<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4.6h-4.6"/>',
  dot:'<circle cx="12" cy="12" r="4.6" fill="currentColor" stroke="none"/>'
  ,lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'
  ,unlock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.4-2.1"/>'
};
export function uiIcon(name,cls='ic'){
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${UI_ICONS[name]||UI_ICONS.dot}</svg>`;
}

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
