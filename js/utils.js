// Pure helpers with no dependency on app state or the DOM.
export function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }

export function cloneData(value){
  if(value===undefined)return undefined;
  if(value===null)return null;
  if(typeof structuredClone==='function'){try{return structuredClone(value);}catch(_){}}
  try{return JSON.parse(JSON.stringify(value));}catch(_){return value;}
}

export function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
