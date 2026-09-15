// Styled replacements for window.confirm()/window.prompt(), backed by a
// single modal in index.html (#uiConfirmModal). Both return a Promise so
// call sites use `await uiConfirm(...)` / `await uiPrompt(...)`.
import { $ } from './utils.js';

function _uiDialogOpen(){
  const modal=$('uiConfirmModal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  return modal;
}
function _uiDialogClose(modal){
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}
const ICON_WARNING='<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>';
const ICON_HELP='<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.5 1.7c0 1.7-2.6 2.3-2.6 3.8"/><path d="M12 17.5h.01"/>';
const ICON_EDIT='<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
export function uiConfirm(message, opts={}){
  return new Promise(resolve=>{
    const modal=$('uiConfirmModal');
    const title=$('uiConfirmTitle'), sub=$('uiConfirmSubtitle'), body=$('uiConfirmBody'), icon=$('uiConfirmIcon');
    const ok=$('uiConfirmOk'), cancel=$('uiConfirmCancel'), promptWrap=$('uiConfirmPromptWrap');
    title.textContent=opts.title||'Confirmar ação';
    if(opts.subtitle){sub.textContent=opts.subtitle;sub.classList.remove('hidden');}else{sub.textContent='';sub.classList.add('hidden');}
    body.textContent=message||'';
    body.classList.toggle('hidden',!message);
    promptWrap.classList.add('hidden');
    ok.textContent=opts.confirmText||'Confirmar';
    cancel.textContent=opts.cancelText||'Cancelar';
    ok.className='btn '+(opts.danger?'danger-btn':'primary');
    icon.className='ui-confirm-icon'+(opts.danger?' danger':'');
    icon.querySelector('svg').innerHTML=opts.danger?ICON_WARNING:ICON_HELP;
    _uiDialogOpen();
    const finish=val=>{_uiDialogClose(modal);ok.onclick=null;cancel.onclick=null;modal.onclick=null;document.removeEventListener('keydown',onKey);resolve(val);};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(false);}else if(e.key==='Enter'){e.preventDefault();finish(true);}};
    document.addEventListener('keydown',onKey);
    ok.onclick=()=>finish(true);
    cancel.onclick=()=>finish(false);
    modal.onclick=e=>{if(e.target===modal)finish(false);};
    setTimeout(()=>ok.focus(),20);
  });
}
export function uiPrompt(message, defaultValue='', opts={}){
  return new Promise(resolve=>{
    const modal=$('uiConfirmModal');
    const title=$('uiConfirmTitle'), sub=$('uiConfirmSubtitle'), body=$('uiConfirmBody'), icon=$('uiConfirmIcon');
    const ok=$('uiConfirmOk'), cancel=$('uiConfirmCancel');
    const promptWrap=$('uiConfirmPromptWrap'), label=$('uiConfirmPromptLabel'), input=$('uiConfirmPromptInput'), err=$('uiConfirmPromptError');
    icon.className='ui-confirm-icon';
    icon.querySelector('svg').innerHTML=ICON_EDIT;
    title.textContent=opts.title||'Renomear';
    sub.textContent='';sub.classList.add('hidden');
    body.textContent=message||'';
    if(body.textContent)body.classList.remove('hidden');else body.classList.add('hidden');
    label.textContent=opts.label||'Nome';
    err.textContent='';
    promptWrap.classList.remove('hidden');
    input.type=opts.type||'text';
    input.value=defaultValue||'';
    ok.textContent=opts.confirmText||'Confirmar';
    cancel.textContent=opts.cancelText||'Cancelar';
    ok.className='btn primary';
    _uiDialogOpen();
    const finish=val=>{_uiDialogClose(modal);ok.onclick=null;cancel.onclick=null;input.onkeydown=null;modal.onclick=null;document.removeEventListener('keydown',onKey);body.classList.remove('hidden');resolve(val);};
    const onKey=e=>{if(e.key==='Escape'){e.preventDefault();finish(null);}};
    document.addEventListener('keydown',onKey);
    const submit=()=>{
      const v=input.value;
      if(opts.required!==false && !v.trim()){err.textContent=opts.errorText||'Preencha este campo.';input.focus();return;}
      finish(v);
    };
    ok.onclick=submit;
    cancel.onclick=()=>finish(null);
    modal.onclick=e=>{if(e.target===modal)finish(null);};
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();submit();}};
    setTimeout(()=>{input.focus();input.select();},20);
  });
}
