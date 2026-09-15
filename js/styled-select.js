// Dropdown estilizado para <select> (o navegador não permite estilizar
// a lista aberta de um <select> nativo). O <select> real continua no DOM
// como fonte de verdade dos valores; este botão só espelha a seleção.
import { $, esc } from './utils.js';

export function closeStyledSelectPanels(){document.querySelectorAll('.dc-select-panel').forEach(p=>p.remove());document.querySelectorAll('.dc-select-btn[aria-expanded="true"]').forEach(b=>b.setAttribute('aria-expanded','false'));}
export function syncSelectButton(selectId,btnId){
  const sel=$(selectId), btn=$(btnId);
  if(!sel||!btn)return;
  const opt=sel.options[sel.selectedIndex];
  const label=btn.querySelector('.dc-select-label');
  if(label)label.textContent=opt?opt.textContent:'—';
}
export function openStyledSelectPanel(selectId,btnId){
  const sel=$(selectId), btn=$(btnId);
  if(!sel||!btn)return;
  const alreadyOpen=btn.getAttribute('aria-expanded')==='true';
  closeStyledSelectPanels();
  if(alreadyOpen)return;
  const panel=document.createElement('div');
  panel.className='dc-select-panel';
  panel.setAttribute('role','listbox');
  panel.innerHTML=[...sel.options].map(o=>`<button type="button" role="option" data-value="${esc(o.value)}" aria-selected="${o.value===sel.value}">${esc(o.textContent)}</button>`).join('');
  document.body.appendChild(panel);
  const r=btn.getBoundingClientRect();
  const pw=panel.offsetWidth||190;
  panel.style.left=Math.max(8,Math.min(window.innerWidth-pw-8,r.left))+'px';
  panel.style.top=(r.bottom+6)+'px';
  requestAnimationFrame(()=>panel.classList.add('open'));
  btn.setAttribute('aria-expanded','true');
  panel.querySelectorAll('button').forEach(o=>o.addEventListener('click',ev=>{
    ev.preventDefault();ev.stopPropagation();
    sel.value=o.dataset.value;
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    closeStyledSelectPanels();
    btn.focus();
  }));
}
export function bindStyledSelect(selectId,btnId){
  const btn=$(btnId);
  if(!btn||btn.dataset.bound)return;
  btn.dataset.bound='1';
  btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openStyledSelectPanel(selectId,btnId);});
}
