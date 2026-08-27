
// --- Supabase authentication -------------------------------------------------
const SUPABASE_URL = 'https://qfkygzzzavtvfupsohxu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_t0XfFbIv0NkmC2GorCR7rw_jkif-gBA';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
});
let appStarted = false;
let authInitialized = false;
let appView = null; // 'dashboard' or 'planner'


let cloudReady = false;
let cloudProjectId = null;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;
let cloudDirty = false;
let cloudStatus = 'saved';
let lastCloudSnapshot = null;
const AUTOSAVE_STORAGE = 'dc-planner-autosave';
let autosaveEnabled = localStorage.getItem(AUTOSAVE_STORAGE) !== 'off';
function cloudProjectKey(){ return `dc-planner-cloud-project-${supabaseClient.auth?.getSession ? 'v1' : 'v1'}`; }
function projectCloudPayload(){
  const copy=JSON.parse(JSON.stringify(state));
  delete copy.selected; delete copy.multiSelected; delete copy.trayMultiSelected;
  return copy;
}
function projectSnapshotForCloud(){ return JSON.stringify(projectCloudPayload()); }
function setCloudStatus(status){
  cloudStatus=status;
  const el=$('cloudStatus');
  if(!el)return;
  const map={saved:['✓','Salvo na nuvem','saved'],saving:['⟳','Salvando...','saving'],pending:['●','Alterações não salvas','pending'],error:['⚠','Não sincronizado','error']};
  const v=map[status]||map.saved;
  el.textContent=`${v[0]} ${v[1]}`; el.dataset.status=v[2]; el.title=v[1];
}
function updatePlannerProjectName(){
  const el=$('plannerProjectName');
  if(el)el.textContent=String(state.projectName||'Data Center');
}
function markCloudDirty(){
  const snap=projectSnapshotForCloud();
  cloudDirty=lastCloudSnapshot!==snap;
  if(cloudDirty)setCloudStatus('pending');
  return cloudDirty;
}
function scheduleCloudSave(){
  if(!cloudReady) return;
  markCloudDirty();
  if(!autosaveEnabled) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>saveProjectToCloud(false),900);
}
function updateAutosaveUI(){
  const toggle=$('autosaveToggle');
  const label=$('autosaveLabel');
  if(toggle) toggle.checked=autosaveEnabled;
  if(label) label.textContent=autosaveEnabled?'Autosave':'Autosave';
  if(toggle){
    toggle.title=autosaveEnabled?'Desativar salvamento automático':'Ativar salvamento automático';
    toggle.setAttribute('aria-label',toggle.title);
  }
}
function setAutosaveEnabled(enabled){
  autosaveEnabled=!!enabled;
  localStorage.setItem(AUTOSAVE_STORAGE,autosaveEnabled?'on':'off');
  clearTimeout(cloudSaveTimer);
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloudDirty?'pending':'saved');
  if(autosaveEnabled && cloudReady) scheduleCloudSave();
  toast(autosaveEnabled?'Autosave ativado':'Autosave desativado');
}

async function saveProjectToCloud(showToast=true){
  if(!cloudReady) return false;
  if(!cloudProjectId && !state.projectName) return false;
  if(lastCloudSnapshot===projectSnapshotForCloud() && cloudProjectId){ cloudDirty=false; setCloudStatus('saved'); return true; }
  setCloudStatus('saving');
  if(cloudSaveInFlight){ cloudSaveQueued=true; return; }
  cloudSaveInFlight=true;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user) return;
    const payload=projectCloudPayload();
    const name=String(state.projectName||'Data Center').trim()||'Data Center';
    let result;
    if(cloudProjectId){
      result=await supabaseClient.from('projects').update({name,data:payload,updated_at:new Date().toISOString()}).eq('id',cloudProjectId).eq('user_id',user.id).select('id').single();
      if(result.error && (result.error.code==='PGRST116' || result.error.code==='22P02')) cloudProjectId=null;
    }
    if(!cloudProjectId){
      result=await supabaseClient.from('projects').insert({user_id:user.id,name,data:payload}).select('id').single();
      if(!result.error) cloudProjectId=result.data.id;
    }
    if(result?.error) throw result.error;
    localStorage.setItem(`${STORAGE}-cloud-id`,cloudProjectId);
    lastCloudSnapshot=projectSnapshotForCloud();
    cloudDirty=false;
    setCloudStatus('saved');
    if(showToast) toast('Projeto salvo na nuvem');
    return true;
  }catch(err){
    console.error('Supabase project save:',err);
    cloudDirty=true;
    setCloudStatus('error');
    if(showToast) toast('Não foi possível salvar na nuvem');
    return false;
  }finally{
    cloudSaveInFlight=false;
    if(cloudSaveQueued){cloudSaveQueued=false;scheduleCloudSave();}
  }
}
async function loadProjectFromCloud(projectId=null){
  cloudReady=false;
  try{
    const {data:{user}}=await supabaseClient.auth.getUser();
    if(!user) return null;
    let query=supabaseClient.from('projects').select('id,name,data,updated_at').eq('user_id',user.id);
    if(projectId) query=query.eq('id',projectId);
    else {
      const savedId=localStorage.getItem(`${STORAGE}-cloud-id`);
      if(savedId) query=query.eq('id',savedId);
      query=query.order('updated_at',{ascending:false}).limit(1);
    }
    const {data,error}=await query.maybeSingle();
    if(error) throw error;
    if(data?.data){
      cloudProjectId=data.id;
      localStorage.setItem(`${STORAGE}-cloud-id`,cloudProjectId);
      Object.assign(state,data.data);
      if(data.name) state.projectName=data.name;
      normalizeState();
      applyTheme();
      lastCloudSnapshot=projectSnapshotForCloud();
      cloudDirty=false;
      setCloudStatus('saved');
      updatePlannerProjectName();
      return data;
    }
    cloudProjectId=null;
    lastCloudSnapshot=null;
    cloudDirty=false;
    setCloudStatus('saved');
    localStorage.removeItem(`${STORAGE}-cloud-id`);
    return null;
  }catch(err){
    console.error('Supabase project load:',err);
    toast('Projeto local mantido; não foi possível sincronizar a nuvem');
    return null;
  }finally{
    cloudReady=true;
  }
}

async function fetchCloudProjects(){
  const {data:{user}}=await supabaseClient.auth.getUser();
  if(!user) return [];
  const {data,error}=await supabaseClient.from('projects').select('id,name,data,created_at,updated_at').eq('user_id',user.id).order('updated_at',{ascending:false});
  if(error) throw error;
  return data||[];
}
function projectStats(project){
  const d=project?.data||{};
  return {rows:Array.isArray(d.rows)?d.rows.length:0,racks:Array.isArray(d.racks)?d.racks.length:0,cables:Array.isArray(d.cables)?d.cables.length:0,trays:Array.isArray(d.trays)?d.trays.length:0};
}
function formatProjectDate(v){
  if(!v)return 'Sem data';
  try{return new Intl.DateTimeFormat('pt-BR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}catch(_){return v;}
}
function closeProjectMenus(){document.querySelectorAll('.project-menu-panel').forEach(x=>x.remove());}
function showDashboard(){
  appView='dashboard';
  $('dashboardScreen')?.classList.remove('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','false');
  $('mainTopbar')?.classList.add('hidden'); document.querySelector('.app')?.classList.add('hidden');
  const email=supabaseClient.auth?.getUser ? null : null;
  $('dashboardUserEmail').textContent=$('authUserEmail')?.textContent||'';
  renderDashboardProjects();
}
function hideDashboard(){
  appView='planner';
  $('dashboardScreen')?.classList.add('hidden'); $('dashboardScreen')?.setAttribute('aria-hidden','true');
  $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden');
}
async function renderDashboardProjects(){
  const grid=$('projectsGrid'),empty=$('projectsEmpty');
  if(!grid)return;
  grid.innerHTML='<div class="dashboard-loading">Carregando projetos...</div>'; empty?.classList.add('hidden');
  try{
    const projects=await fetchCloudProjects();
    if(!projects.length){grid.innerHTML='';empty?.classList.remove('hidden');return;}
    grid.innerHTML=projects.map(project=>{
      const st=projectStats(project);
      return `<article class="project-card" data-project-card="${esc(project.id)}">
        <div class="project-card-head"><div style="display:flex;gap:12px;align-items:flex-start"><div class="project-icon">📁</div><div><h3 class="project-name">${esc(project.name||'Projeto sem nome')}</h3><div class="project-date">Atualizado ${esc(formatProjectDate(project.updated_at))}</div></div></div>
          <div class="project-menu"><button class="btn ghost" data-project-menu="${esc(project.id)}" title="Mais opções">⋮</button></div></div>
        <div class="project-stats"><span><b>${st.rows}</b> fileira${st.rows===1?'':'s'}</span><span><b>${st.racks}</b> rack${st.racks===1?'':'s'}</span><span><b>${st.cables}</b> cabo${st.cables===1?'':'s'}</span><span><b>${st.trays}</b> calha${st.trays===1?'':'s'}</span></div>
        <div class="project-actions"><button class="btn primary" data-project-open="${esc(project.id)}">Abrir</button></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('[data-project-open]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openCloudProject(b.dataset.projectOpen);}));
    grid.querySelectorAll('[data-project-menu]').forEach(b=>b.addEventListener('click',e=>{
      e.preventDefault(); e.stopPropagation(); closeProjectMenus();
      const project=projects.find(x=>String(x.id)===String(b.dataset.projectMenu));
      if(!project)return;
      const panel=document.createElement('div'); panel.className='project-menu-panel';
      panel.innerHTML='<button type="button" data-action="rename">Renomear</button><button type="button" data-action="duplicate">Duplicar</button><button type="button" data-action="export">Exportar projeto</button><button type="button" class="danger" data-action="delete">Excluir</button>';
      b.parentElement.appendChild(panel);
      const bindAction=(selector,fn)=>panel.querySelector(selector).addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();fn(project);});
      bindAction('[data-action="rename"]',renameCloudProject);
      bindAction('[data-action="duplicate"]',duplicateCloudProject);
      bindAction('[data-action="export"]',exportCloudProject);
      bindAction('[data-action="delete"]',deleteCloudProject);
    }));
  }catch(err){console.error('Dashboard projects:',err);grid.innerHTML='<div class="dashboard-error">Não foi possível carregar seus projetos. Verifique sua conexão e tente novamente.</div>';}
}
function centerCanvasOnContent(){
  const wrap=$('canvasWrap'),stage=$('canvasStage'),svg=$('layout');
  if(!wrap||!stage||!svg||!state.racks.length)return;
  requestAnimationFrame(()=>{
    const els=[...svg.querySelectorAll('.rack-body, .tray-line')];
    if(!els.length)return;
    let box=null;
    for(const el of els){
      try{const b=el.getBBox(); if(!box)box={x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height}; else {box.x=Math.min(box.x,b.x);box.y=Math.min(box.y,b.y);box.right=Math.max(box.right,b.x+b.width);box.bottom=Math.max(box.bottom,b.y+b.height);}}catch(_){}
    }
    if(!box)return;
    const zoom=window.__canvasPan?.zoom||1;
    const contentCx=(box.x+box.right)/2, contentCy=(box.y+box.bottom)/2;
    const p=window.__canvasPan||(window.__canvasPan={x:0,y:0,zoom:1});
    p.x=wrap.clientWidth/2-contentCx*zoom;
    p.y=wrap.clientHeight/2-contentCy*zoom;
    window.__applyCanvasPan?.();
  });
}

async function openCloudProject(id){
  closeProjectMenus();
  try{
    if(!appStarted){appStarted=true;bind();}
    const project=await loadProjectFromCloud(id);
    if(!project) throw new Error('Projeto não encontrado');
    hideDashboard();
    renderAll(false);initHistory();
    centerCanvasOnContent();
    toast('Projeto aberto');
  }catch(err){console.error(err);toast('Não foi possível abrir o projeto');}
}
function resetStateForNewProject(name='Data Center'){
  const keepTheme=state.theme;
  state.projectName=name;state.rackUnits=48;state.rackWidth=.60;state.rackDepth=1.20;state.rackGap=0;state.defaultRowGap=1.20;state.lastUToTray=1.00;state.defaultSlack=10;state.rows=[];state.racks=[];state.cables=[];state.trays=[];state.trayLinks=[];state.trayRackLinks=[];state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];state.theme=keepTheme;
  cloudProjectId=null;
  lastCloudSnapshot=null;
  cloudDirty=true;
  setCloudStatus('pending');
  updatePlannerProjectName();
  localStorage.removeItem(`${STORAGE}-cloud-id`);
  normalizeState();
  localStorage.setItem(STORAGE,JSON.stringify(state));
}
async function createNewCloudProject(){
  const name=prompt('Nome do novo projeto:','Data Center');
  if(name===null)return;
  if(!appStarted){appStarted=true;bind();}
  resetStateForNewProject(String(name).trim()||'Data Center');
  cloudReady=true;
  await saveProjectToCloud(true);
  renderAll(false);initHistory();hideDashboard();toast('Novo projeto criado');
}
async function renameCloudProject(project){
  closeProjectMenus();
  const name=prompt('Novo nome do projeto:',project.name||'Projeto');
  if(name===null)return;
  const next=String(name).trim();if(!next)return;
  try{const {error}=await supabaseClient.from('projects').update({name:next,updated_at:new Date().toISOString()}).eq('id',project.id);if(error)throw error; if(cloudProjectId===project.id){state.projectName=next;updatePlannerProjectName();lastCloudSnapshot=projectSnapshotForCloud();cloudDirty=false;setCloudStatus('saved');} await renderDashboardProjects();toast('Projeto renomeado');}catch(err){console.error(err);toast('Não foi possível renomear o projeto');}
}
async function duplicateCloudProject(project){
  closeProjectMenus();
  try{const {data:{user}}=await supabaseClient.auth.getUser();if(!user)throw new Error('Sem sessão');const copy=JSON.parse(JSON.stringify(project.data||{}));copy.selected=null;copy.multiSelected=[];copy.trayMultiSelected=[];const name=(project.name||'Projeto')+' — cópia';const {data,error}=await supabaseClient.from('projects').insert({user_id:user.id,name,data:copy}).select('id').single();if(error)throw error;await renderDashboardProjects();toast('Projeto duplicado');}catch(err){console.error(err);toast('Não foi possível duplicar o projeto');}
}
function exportCloudProject(project){
  closeProjectMenus();
  const blob=new Blob([JSON.stringify({...project.data,projectName:project.name},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(project.name||'data-center')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function deleteCloudProject(project){
  closeProjectMenus();
  if(!confirm(`Excluir o projeto "${project.name||'Projeto'}"? Esta ação não pode ser desfeita.`))return;
  try{const {error}=await supabaseClient.from('projects').delete().eq('id',project.id);if(error)throw error;if(cloudProjectId===project.id){cloudProjectId=null;localStorage.removeItem(`${STORAGE}-cloud-id`);}await renderDashboardProjects();toast('Projeto excluído');}catch(err){console.error(err);toast('Não foi possível excluir o projeto');}
}

function authRedirectUrl(){ return window.location.origin + window.location.pathname; }
function authViews(){ return ['authLoginView','authSignupView','authForgotView','authResetView'].map(id=>$(id)).filter(Boolean); }
function showAuthView(id){
  authViews().forEach(v=>v.classList.toggle('hidden',v.id!==id));
  ['loginError','signupMessage','forgotMessage','resetMessage'].forEach(id=>{const e=$(id);if(e)e.textContent='';e?.classList.remove('error','success');});
}
function authMessage(id,text,type=''){ const e=$(id); if(!e)return; e.textContent=text||''; e.classList.remove('error','success'); if(type)e.classList.add(type); }
function setAuthBusy(id,busy,label){ const b=$(id); if(!b)return; b.disabled=busy; if(busy){b.dataset.original=b.textContent;b.textContent='Aguarde...';}else if(b.dataset.original){b.textContent=label||b.dataset.original;} }
function lockApp(){ document.body.classList.add('auth-locked'); $('authScreen')?.classList.remove('hidden'); $('authScreen')?.setAttribute('aria-hidden','false'); }
function unlockApp(user, forceDashboard=false){
  if(user?.id){
    STORAGE = `dc-planner-v7-user-${user.id}`;
    const migrated = localStorage.getItem('dc-planner-v7-user-migrated');
    if(!migrated){
      try{
        const old = localStorage.getItem(GLOBAL_STORAGE);
        const userKey = STORAGE;
        if(old && !localStorage.getItem(userKey)) localStorage.setItem(userKey,old);
        localStorage.setItem('dc-planner-v7-user-migrated','1');
      }catch(_){ }
    }
  }
  document.body.classList.remove('auth-locked'); $('authScreen')?.classList.add('hidden'); $('authScreen')?.setAttribute('aria-hidden','true');
  const e=$('authUserEmail'); if(e)e.textContent=user?.email||'';
  $('dashboardUserEmail').textContent=user?.email||'';
  updatePlannerProjectName();
  if(forceDashboard || !appView) showDashboard();
}

async function startAuth(){
  lockApp();
  showAuthView('authLoginView');
  $('dashboardNewProject').onclick=createNewCloudProject; $('dashboardNewProjectEmpty').onclick=createNewCloudProject; $('dashboardLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  $('dashboardTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('authTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();};
  document.addEventListener('click',e=>{if(!e.target.closest('.project-menu'))closeProjectMenus();});
  $('showSignup').onclick=()=>showAuthView('authSignupView');
  $('showForgot').onclick=()=>{ $('forgotEmail').value=$('loginEmail')?.value||''; showAuthView('authForgotView'); };
  $('showLoginFromSignup').onclick=()=>showAuthView('authLoginView');
  $('showLoginFromForgot').onclick=()=>showAuthView('authLoginView');
  $('loginForm').onsubmit=async e=>{
    e.preventDefault(); authMessage('loginError',''); setAuthBusy('btnLogin',true);
    const {error}=await supabaseClient.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
    setAuthBusy('btnLogin',false,'Entrar');
    if(error)authMessage('loginError',friendlyAuthError(error),'error');
  };
  $('signupForm').onsubmit=async e=>{
    e.preventDefault(); const email=$('signupEmail').value.trim(),p1=$('signupPassword').value,p2=$('signupPassword2').value;
    if(p1!==p2){authMessage('signupMessage','As senhas não coincidem.','error');return;}
    setAuthBusy('btnSignup',true);
    const {data,error}=await supabaseClient.auth.signUp({email,password:p1,options:{emailRedirectTo:authRedirectUrl()}});
    setAuthBusy('btnSignup',false,'Criar conta');
    if(error){authMessage('signupMessage',friendlyAuthError(error),'error');return;}
    if(data.session)unlockApp(data.user); else authMessage('signupMessage','Conta criada. Verifique seu e-mail para confirmar a conta antes de entrar.','success');
  };
  $('forgotForm').onsubmit=async e=>{
    e.preventDefault(); setAuthBusy('btnForgot',true);
    const {error}=await supabaseClient.auth.resetPasswordForEmail($('forgotEmail').value.trim(),{redirectTo:authRedirectUrl()});
    setAuthBusy('btnForgot',false,'Enviar link');
    if(error)authMessage('forgotMessage',friendlyAuthError(error),'error'); else authMessage('forgotMessage','Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.','success');
  };
  $('resetForm').onsubmit=async e=>{
    e.preventDefault(); const p1=$('resetPassword').value,p2=$('resetPassword2').value;
    if(p1!==p2){authMessage('resetMessage','As senhas não coincidem.','error');return;}
    setAuthBusy('btnResetPassword',true); const {error}=await supabaseClient.auth.updateUser({password:p1});
    setAuthBusy('btnResetPassword',false,'Salvar nova senha');
    if(error)authMessage('resetMessage',friendlyAuthError(error),'error'); else {authMessage('resetMessage','Senha alterada com sucesso. Entrando...','success');setTimeout(()=>supabaseClient.auth.getSession(),700);}
  };
  $('btnLogout').onclick=async()=>{await supabaseClient.auth.signOut();};
  supabaseClient.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){lockApp();showAuthView('authResetView');return;}
    if(session?.user){ unlockApp(session.user, event==='SIGNED_IN' && !appStarted); } else if(event==='SIGNED_OUT'){ cloudReady=false; cloudProjectId=null; appStarted=false; $('dashboardScreen')?.classList.add('hidden'); $('mainTopbar')?.classList.remove('hidden'); document.querySelector('.app')?.classList.remove('hidden'); appView=null; lockApp(); showAuthView('authLoginView'); $('loginPassword').value=''; }
  });
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user)unlockApp(session.user); else { lockApp(); showAuthView('authLoginView'); }
  authInitialized=true;
}
function friendlyAuthError(error){
  const m=String(error?.message||'Erro de autenticação.');
  const low=m.toLowerCase();
  if(low.includes('invalid login credentials'))return 'E-mail ou senha incorretos.';
  if(low.includes('email not confirmed'))return 'Confirme seu e-mail antes de entrar.';
  if(low.includes('password should be at least'))return 'A senha precisa ter pelo menos 6 caracteres.';
  if(low.includes('rate limit'))return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return m;
}

const U_MM = 44.45;
const GLOBAL_STORAGE = 'dc-planner-v7';
let STORAGE = GLOBAL_STORAGE;
const LEGACY_STORAGE = 'dc-planner-v6';
const THEME_STORAGE = 'dc-planner-theme';
const $ = id => document.getElementById(id);
const CABLE_TYPES = ['Fibra Multi Mode','Fibra Single Mode','UTP'];
const DEFAULT_CABLE_TYPE = 'UTP';

const state = {
  projectName: 'Data Center',
  rackUnits: 48,
  rackWidth: 0.60,
  rackGap: 0,
  rackDepth: 1.20,
  defaultRowGap: 1.20,
  lastUToTray: 1.00,
  defaultSlack: 10,
  rows: [], racks: [], cables: [], trays: [], trayLinks: [], selected: null, multiSelected: [], trayMultiSelected: [],
  theme: localStorage.getItem(THEME_STORAGE) || localStorage.getItem('dc-theme') || 'dark',
  structureLocked: false
};
let pan = null;
const VIEW_PAD = 700;
const ROW_GAP_VISUAL = 1.00;
const history = { undo: [], redo: [], last: null, restoring: false, max: 80 };
function isStructureLocked(){ return state.structureLocked===true; }
function setStructureLock(locked, persist=true){
  state.structureLocked=!!locked;
  const btn=$('structureLock'), icon=$('structureLockIcon');
  if(btn){
    btn.classList.toggle('locked', state.structureLocked);
    btn.title=state.structureLocked?'Desbloquear estrutura':'Bloquear estrutura';
    btn.setAttribute('aria-label',btn.title);
  }
  if(icon) icon.textContent=state.structureLocked?'🔒':'🔓';
  document.body.classList.toggle('structure-is-locked',state.structureLocked);
  updateStructureControls();
  renderProperties();
  updateStructureControls();
  if(persist) save();
}
function updateStructureControls(){
  const disabled=isStructureLocked();
  ['btnAddTray','btnBuildRows'].forEach(id=>{const el=$(id);if(el)el.disabled=disabled;});
  document.querySelectorAll('[data-row-name],[data-row-count],[data-row-gap],[data-rename-row],[data-del-row]').forEach(el=>{el.disabled=disabled;el.setAttribute('aria-disabled',String(disabled));});
  document.querySelectorAll('#properties input:not(#cbName):not(#cbType):not(#cbOR):not(#cbOU):not(#cbDR):not(#cbDU):not(#cbSlack), #properties select:not(#cbType):not(#cbOR):not(#cbDR), #properties button#delRack, #properties button#delTray, #properties button#applyBulkRack, #properties button#delSelectedRacks, #properties button#delSelectedTrays').forEach(el=>{el.disabled=disabled;});
  const btn=$('structureLock'), icon=$('structureLockIcon');
  if(btn){btn.classList.toggle('locked',disabled);btn.title=disabled?'Desbloquear estrutura':'Bloquear estrutura';btn.setAttribute('aria-label',btn.title);}
  if(icon)icon.textContent=disabled?'🔒':'🔓';
}
function structureBlocked(){
  if(isStructureLocked()){ toast('🔒 Estrutura bloqueada. Desbloqueie para alterar racks ou calhas.'); return true; }
  return false;
}
function projectSnapshot(){
  const copy=JSON.parse(JSON.stringify(state));
  delete copy.selected;
  delete copy.multiSelected;
  delete copy.trayMultiSelected;
  delete copy.theme;
  return JSON.stringify(copy);
}
function applyTheme(){
  const light=state.theme==='light';
  document.documentElement.classList.toggle('light',light);
  document.documentElement.dataset.theme=light?'light':'dark';
  document.documentElement.style.colorScheme=light?'light':'dark';
  localStorage.setItem(THEME_STORAGE,state.theme);
  const b=$('btnTheme');
  if(b){ b.textContent=light?'☀ Tema':'☾ Tema'; b.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const db=$('dashboardTheme'); if(db){ db.textContent=light?'☀ Tema':'☾ Tema'; db.title=light?'Alternar para tema escuro':'Alternar para tema claro'; }
  const ab=$('authTheme'); if(ab){ ab.textContent=light?'☀':'☾'; ab.title=light?'Alternar para tema escuro':'Alternar para tema claro'; ab.setAttribute('aria-label',ab.title); }
}
function initHistory(){
  history.undo=[]; history.redo=[]; history.last=projectSnapshot(); updateHistoryButtons();
}
function recordHistory(){
  if(history.restoring)return;
  const current=projectSnapshot();
  if(!history.last){ history.last=current; updateHistoryButtons(); return; }
  if(current!==history.last){
    // Prefer the last persisted project as the undo source. This makes Undo/Redo
    // reliable even when a UI handler mutates state before calling save().
    let previous=history.last;
    try{
      const persisted=localStorage.getItem(STORAGE);
      if(persisted){
        const obj=JSON.parse(persisted);
        delete obj.selected; delete obj.multiSelected; delete obj.trayMultiSelected; delete obj.theme;
        previous=JSON.stringify(obj);
      }
    }catch(_){ }
    if(previous!==current){
      history.undo.push(previous);
      if(history.undo.length>history.max)history.undo.shift();
      history.redo=[];
      history.last=current;
    }
  }
  updateHistoryButtons();
}
function updateHistoryButtons(){
  const u=$('btnUndo'),r=$('btnRedo');
  if(u){u.disabled=history.undo.length===0;u.setAttribute('aria-disabled',String(u.disabled));}
  if(r){r.disabled=history.redo.length===0;r.setAttribute('aria-disabled',String(r.disabled));}
}
function restoreSnapshot(snapshot){
  history.restoring=true;
  const restored=JSON.parse(snapshot);
  const currentTheme=state.theme;
  Object.assign(state,restored);
  state.theme=currentTheme;
  normalizeState();
  history.last=projectSnapshot();
  history.restoring=false;
  applyTheme();
  renderAll(false);
  localStorage.setItem(STORAGE,JSON.stringify(state));
  scheduleCloudSave();
  updateHistoryButtons();
}
function undo(){
  if(!history.undo.length)return;
  const current=projectSnapshot();
  const target=history.undo.pop();
  history.redo.push(current);
  restoreSnapshot(target);
  toast('Desfeito');
}
function redo(){
  if(!history.redo.length)return;
  const current=projectSnapshot();
  const target=history.redo.pop();
  history.undo.push(current);
  restoreSnapshot(target);
  toast('Refeito');
}

function uid(prefix){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function num(v,fallback=0){ const n=Number(v); return Number.isFinite(n)?n:fallback; }
function toast(text){ const t=$('toast'); t.textContent=text; t.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>t.classList.remove('show'),1800); }
function save(){ recordHistory(); localStorage.setItem(STORAGE,JSON.stringify(state)); localStorage.setItem(THEME_STORAGE,state.theme); applyTheme(); updatePlannerProjectName(); scheduleCloudSave(); }
function load(){
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem(STORAGE)); } catch(_){ }
  if(!saved){ try { saved=JSON.parse(localStorage.getItem(LEGACY_STORAGE)); } catch(_){ } }
  if(saved) Object.assign(state,saved);
  const savedTheme=localStorage.getItem(THEME_STORAGE)||localStorage.getItem('dc-theme');
  if(savedTheme==='light'||savedTheme==='dark') state.theme=savedTheme;
  state.rows=Array.isArray(state.rows)?state.rows:[];
  state.racks=Array.isArray(state.racks)?state.racks:[];
  state.rows.forEach(r=>{ if(!Number.isFinite(Number(r.depth))) r.depth=Math.max(0.1,num(state.rackDepth,1.20)); else r.depth=Math.max(0.1,Number(r.depth)); });
  state.cables=Array.isArray(state.cables)?state.cables:[];
  state.trays=Array.isArray(state.trays)?state.trays:[];
  if(!Number.isFinite(Number(state.rackGap))) state.rackGap=0;
  state.rackGap=Math.max(0,Number(state.rackGap));
  if(!Number.isFinite(Number(state.rackDepth))) state.rackDepth=1.20;
  state.rackDepth=Math.max(0.1,Number(state.rackDepth));
  if(state.theme!=='light'&&state.theme!=='dark')state.theme='dark';
  applyTheme();
  normalizeState();
}
function rowForRack(r){ return r?state.rows.find(x=>x.id===r.rowId):null; }
function rowIndex(r){ return r?state.rows.findIndex(x=>x.id===r.rowId):-1; }
function racksInRow(rowId){ return state.racks.filter(r=>r.rowId===rowId).sort((a,b)=>a.index-b.index); }
function rackAt(rowId,index){ return racksInRow(rowId).find(r=>r.index===index)||null; }
function adjacentRows(row){ const i=state.rows.findIndex(x=>x.id===row?.id); if(i<0)return[]; return state.rows.filter((_,idx)=>Math.abs(idx-i)===1); }
function makeRack(row,index){ return {id:uid('rack'),rowId:row.id,index,name:`${row.name||'R'}-${String(index+1).padStart(2,'0')}`,units:state.rackUnits,width:state.rackWidth,depth:state.rackDepth,gapAfter:state.rackGap,riseToTray:state.lastUToTray,offset:0,yOffset:0,hasTray:false}; }
function normalizeIndices(){
  // Physical slot indexes are preserved so deleting a rack does not move the
  // remaining racks.  rackCount, however, represents the actual number of
  // racks currently present in the row, not the highest occupied slot.
  state.rows.forEach(row=>{
    const rs=racksInRow(row.id);
    row.rackCount=rs.length;
  });
}
function normalizeState(){
  state.structureLocked=state.structureLocked===true;
  const rowIds=new Set(state.rows.map(r=>r.id));
  state.racks=state.racks.filter(r=>rowIds.has(r.rowId));
  state.racks.forEach(r=>{
    if(!Number.isFinite(Number(r.width))) r.width=state.rackWidth;
    r.width=Math.max(0.1,Number(r.width));
    if(!Number.isFinite(Number(r.depth))) r.depth=state.rackDepth;
    r.depth=Math.max(0.1,Number(r.depth));
    if(!Number.isFinite(Number(r.gapAfter))) r.gapAfter=state.rackGap;
    r.gapAfter=Math.max(0,Number(r.gapAfter));
    if(!Number.isFinite(Number(r.riseToTray))) r.riseToTray=state.lastUToTray;
    r.riseToTray=Math.max(0,Number(r.riseToTray));
    if(!Number.isFinite(Number(r.offset))) r.offset=0;
    r.offset=Number(r.offset);
    if(!Number.isFinite(Number(r.yOffset))) r.yOffset=0;
    r.yOffset=Number(r.yOffset);
  });
  normalizeIndices();
  // V8.1: calhas são infraestrutura independente. Dados antigos permanecem marcados
  // como _legacy até o primeiro render, quando são convertidos para coordenadas livres.
  state.trays=(Array.isArray(state.trays)?state.trays:[]).map(t=>{
    if(Number.isFinite(Number(t.x1))&&Number.isFinite(Number(t.y1))&&Number.isFinite(Number(t.x2))&&Number.isFinite(Number(t.y2))){
      return {
        id:t.id||uid('tray'),name:t.name||'Calha',
        x1:+t.x1,y1:+t.y1,x2:+t.x2,y2:+t.y2,width:num(t.width,.10),
        // Structural inter-row calhas keep their rack/fileira anchors so their
        // endpoints can be recomputed whenever rack geometry or row spacing changes.
        ...(t.fromRowId?{fromRowId:t.fromRowId}:{}),
        ...(t.toRowId?{toRowId:t.toRowId}:{}),
        ...(Number.isFinite(Number(t.fromIndex))?{fromIndex:Number(t.fromIndex)}:{}),
        ...(Number.isFinite(Number(t.toIndex))?{toIndex:Number(t.toIndex)}:{}),
        ...(t.edge!==undefined?{edge:!!t.edge}:{}),
        ...(t.sideFrom?{sideFrom:t.sideFrom}:{}),
        ...(t.sideTo?{sideTo:t.sideTo}:{}),
      };
    }
    return {...t,_legacy:true,name:t.name||'Calha'};
  });
  state.trayLinks=Array.isArray(state.trayLinks)?state.trayLinks:[];
  state.trayRackLinks=Array.isArray(state.trayRackLinks)?state.trayRackLinks:[];
  // Keep only links whose endpoint objects still exist.
  state.trayLinks=state.trayLinks.filter(l=>state.trays.some(t=>t.id===l.aTray)&&state.trays.some(t=>t.id===l.bTray));
  state.trayRackLinks=state.trayRackLinks.filter(l=>state.trays.some(t=>t.id===l.trayId)&&state.racks.some(r=>r.id===l.rackId));
  state.racks.forEach(r=>{r.hasTray=false;});
  const rackIds=new Set(state.racks.map(r=>r.id));
  state.cables=state.cables.filter(c=>rackIds.has(c.originRack)&&rackIds.has(c.destRack));
  state.cables.forEach(c=>{c.type=CABLE_TYPES.includes(c.type)?c.type:DEFAULT_CABLE_TYPE;c.via=(c.via||[]).filter(id=>rackIds.has(id));});
  if(state.selected?.type==='rack'&&!rackIds.has(state.selected.id))state.selected=null;
  state.multiSelected=Array.isArray(state.multiSelected)?state.multiSelected.filter(id=>rackIds.has(id)):[];
  if(state.selected?.type==='rack' && !state.multiSelected.includes(state.selected.id)) state.multiSelected=[state.selected.id];
  const trayIds=new Set(state.trays.map(t=>t.id));
  state.trayMultiSelected=Array.isArray(state.trayMultiSelected)?state.trayMultiSelected.filter(id=>trayIds.has(id)):[];
  if(state.selected?.type==='tray' && !state.trayMultiSelected.includes(state.selected.id)) state.trayMultiSelected=[state.selected.id];
}
function rebuildStructureFromSettings(){
  if(structureBlocked())return;
  if(state.rows.length || state.racks.length || state.trays.length){
    const ok=confirm('Reconstruir estrutura?\n\nRacks e calhas atuais serão recriados do zero usando as configurações atuais. Os cabos serão preservados quando origem e destino continuarem existindo.\n\nVocê poderá desfazer a reconstrução usando o botão Desfazer. Deseja continuar?');
    if(!ok)return;
  }

  // Keep cable endpoint references by their physical row/rack slot before rebuilding.
  // This lets cables survive a full structural rebuild even though rack IDs are recreated.
  const oldRows=[...state.rows];
  const oldRacks=[...state.racks];
  const oldRackKey=new Map(oldRacks.map(r=>[r.id,`${oldRows.findIndex(row=>row.id===r.rowId)}:${r.index}`]));
  const oldCables=Array.isArray(state.cables)?JSON.parse(JSON.stringify(state.cables)):[];
  const oldTrayCount=state.trays.length;

  state.projectName=$('projectName').value.trim()||'Data Center';
  state.rackUnits=Math.max(1,Math.min(60,Math.floor(num($('rackUnits').value,48))));
  state.rackWidth=Math.max(.1,num($('rackWidth').value,.6));
  state.rackDepth=Math.max(.1,num($('rackDepth').value,1.2));
  state.rackGap=Math.max(0,num($('rackGap').value,0));
  state.defaultRowGap=Math.max(0,num($('defaultRowGap').value,1.2));
  state.lastUToTray=Math.max(0,num($('lastUToTray').value,1));
  state.defaultSlack=Math.max(0,num($('defaultSlack').value,0));

  state.rows=[]; state.racks=[]; state.trays=[]; state.trayLinks=[]; state.trayRackLinks=[];
  state.selected=null; state.multiSelected=[]; state.trayMultiSelected=[];

  const count=Math.max(0,Math.min(30,Math.floor(num($('rowCount').value,0))));
  const racks=Math.max(0,Math.min(100,Math.floor(num($('defaultRacks').value,0))));
  for(let i=0;i<count;i++) addRow(racks,i===0?0:state.defaultRowGap);

  // Map old cable endpoints to the newly-created rack IDs using row position + rack slot.
  const newRackByKey=new Map(state.racks.map(r=>[`${state.rows.findIndex(row=>row.id===r.rowId)}:${r.index}`,r.id]));
  let droppedCables=0;
  state.cables=oldCables.map(c=>{
    const originKey=oldRackKey.get(c.originRack), destKey=oldRackKey.get(c.destRack);
    const originRack=newRackByKey.get(originKey), destRack=newRackByKey.get(destKey);
    if(!originRack||!destRack){droppedCables++;return null;}
    const via=(c.via||[]).map(id=>newRackByKey.get(oldRackKey.get(id))).filter(Boolean);
    return {...c,originRack,destRack,via};
  }).filter(Boolean);

  normalizeState();
  renderAll();
  const msg=oldTrayCount?`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s); ${oldTrayCount} calha(s) antiga(s) removida(s) e a estrutura foi recriada do zero.`:`Estrutura reconstruída. ${state.cables.length} cabo(s) preservado(s).`;
  toast(droppedCables?`${msg} ${droppedCables} cabo(s) removido(s) por falta de origem/destino.`:msg);
}

function initRows(){ return rebuildStructureFromSettings(); }
function addRow(rackCount=0,gap=state.defaultRowGap){
  const i=state.rows.length;
  const row={id:uid('row'),name:`Row-${i+1}`,rackCount:0,gap:i===0?0:Math.max(0,gap),depth:Math.max(0.1,num(state.rackDepth,1.20))};
  state.rows.push(row);
  for(let j=0;j<rackCount;j++)state.racks.push(makeRack(row,j));
  row.rackCount=rackCount; normalizeIndices(); return row;
}
function removeRackReferences(ids){
  const set=new Set(ids);
  // NEVER remove or rewrite tray infrastructure when a rack is deleted. Fixed-slot
  // links remain at their physical slot; edge links adapt by side during normalizeState().
  state.cables=state.cables.filter(c=>!set.has(c.originRack)&&!set.has(c.destRack));
  state.cables.forEach(c=>c.via=(c.via||[]).filter(id=>!set.has(id)));
}
function resizeRow(rowId,count){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  count=Math.max(0,Math.min(100,Math.floor(count)));
  let rs=racksInRow(rowId);
  // Fill the first empty physical slots instead of compacting existing racks.
  const occupied=new Set(rs.map(r=>r.index));
  for(let idx=0;idx<count;idx++){
    if(!occupied.has(idx)){
      const r=makeRack(row,idx);
      state.racks.push(r);
      occupied.add(idx);
    }
  }
  // Reducing the row removes only racks beyond the requested slot count; gaps inside remain.
  const ids=state.racks.filter(r=>r.rowId===rowId && r.index>=count).map(r=>r.id);
  if(ids.length){ state.racks=state.racks.filter(r=>!ids.includes(r.id)); removeRackReferences(ids); }
  row.rackCount=count;
  normalizeIndices(); renderAll(); toast(`Racks de ${row.name} atualizados`);
}
function deleteRow(id){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===id); if(!row)return;
  const ids=racksInRow(id).map(r=>r.id);
  state.rows=state.rows.filter(r=>r.id!==id);
  state.racks=state.racks.filter(r=>r.rowId!==id);
  removeRackReferences(ids); normalizeState(); state.selected=null; renderAll(); toast('Fileira excluída');
}
function buildRowsPanel(){
  const p=$('rowsPanel'); p.innerHTML='';
  if(!state.rows.length){ p.innerHTML='<div class="empty">Nenhuma fileira. Você pode criar 0 fileiras e adicionar depois.</div>'; return; }
  state.rows.forEach(row=>{
    const d=document.createElement('div'); d.className='row-card';
    const displayName = row.name ? esc(row.name) : '<span class="mini">(sem nome)</span>';
    d.innerHTML=`<div class="row-title"><span>${displayName}</span><div class="row-actions"><button class="iconbtn" data-del-row="${row.id}" title="Excluir fileira">×</button></div></div>
      <div class="grid2"><label>Nome<input data-row-name="${row.id}" value="${esc(row.name)}"></label><label>Racks<input data-row-count="${row.id}" type="number" min="0" max="100" value="${row.rackCount}"></label></div>
      <button class="btn small full" data-rename-row="${row.id}">✎ Renomear racks</button>
      ${state.rows.indexOf(row)>0?`<label>Distância para a fileira anterior (m)<input data-row-gap="${row.id}" type="number" min="0" step="0.01" value="${row.gap||0}"></label>`:''}`;
    p.appendChild(d);
  });
  p.querySelectorAll('[data-row-name]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;
    const r=state.rows.find(x=>x.id===e.dataset.rowName);
    if(!r)return;
    const oldName=r.name;
    const newName=e.value.trim();
    r.name=newName;
    racksInRow(r.id).forEach(rack=>{
      // Keep custom/blank rack names. Only auto-generated names follow the row name.
      const suffix=String(rack.index+1).padStart(2,'0');
      const wasAuto = oldName
        ? (rack.name===`${oldName}-${suffix}` || rack.name===`${oldName}-${String(rack.index+1)}`)
        : (rack.name===suffix || rack.name===String(rack.index+1));
      if(wasAuto) rack.name = newName ? `${newName}-${suffix}` : suffix;
    });
    normalizeIndices();
    renderAll();
  });
  p.querySelectorAll('[data-row-count]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;resizeRow(e.dataset.rowCount,num(e.value,0));});
  p.querySelectorAll('[data-row-gap]').forEach(e=>e.onchange=()=>{if(structureBlocked())return;const r=state.rows.find(x=>x.id===e.dataset.rowGap);if(!r)return;r.gap=Math.max(0,num(e.value,0));renderAll();});
  p.querySelectorAll('[data-rename-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();openRenameRowModal(e.dataset.renameRow);});
  p.querySelectorAll('[data-del-row]').forEach(e=>e.onclick=ev=>{if(structureBlocked())return;ev.stopPropagation();deleteRow(e.dataset.delRow);});
}

function openRenameRowModal(rowId){
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const racks=racksInRow(rowId); if(!racks.length){toast('Esta fileira não possui racks');return;}
  const rowIndexValue=state.rows.findIndex(r=>r.id===rowId);
  const prefixDefault=`${rowIndexValue+1}0`;
  $('renameRowId').value=rowId;
  $('renamePrefix').value=prefixDefault;
  $('renameStart').value=1;
  $('renamePad').value=0;
  $('renameRowTitle').textContent=`Renomear racks — ${row.name||'Fileira'}`;
  $('renameRowError').textContent='';
  $('renameRowModal').classList.add('open');
  updateRenamePreview();
  setTimeout(()=>{$('renamePrefix').focus();$('renamePrefix').select();},0);
}
function closeRenameRowModal(){$('renameRowModal').classList.remove('open');}
function buildRenameNames(){
  const rowId=$('renameRowId').value;
  const racks=racksInRow(rowId);
  const prefix=$('renamePrefix').value.trim();
  const start=Math.max(0,Math.floor(num($('renameStart').value,1)));
  // 'Zeros à esquerda' is the number of zeros to add before the number,
  // not the total width of the numeric portion. Example: 1 -> 01, 2 -> 001.
  const zeros=Math.max(0,Math.min(6,Math.floor(num($('renamePad').value,0))));
  return racks.map((rack,i)=>{
    const n=String(start+i);
    return `${prefix}${n.padStart(n.length+zeros,'0')}`;
  });
}
function updateRenamePreview(){
  const rowId=$('renameRowId').value;
  const racks=racksInRow(rowId);
  const names=buildRenameNames();
  const currentIds=new Set(racks.map(r=>r.id));
  const duplicate=new Set(names).size!==names.length;
  const existingConflict=state.racks.some(r=>!currentIds.has(r.id)&&names.includes(r.name));
  const err=duplicate?'Os novos nomes possuem duplicidade.':existingConflict?'Um ou mais nomes já estão sendo usados por outro rack.':'';
  const preview=$('renamePreview');
  preview.innerHTML=racks.map((r,i)=>`<div class="rename-preview-row"><span>${esc(r.name)}</span><b>→</b><span>${esc(names[i])}</span></div>`).join('');
  $('renameRowError').textContent=err;
  $('renameApply').disabled=!!err;
}
function applyRenameRow(){
  if(structureBlocked())return;
  const rowId=$('renameRowId').value;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const racks=racksInRow(rowId), names=buildRenameNames();
  const currentIds=new Set(racks.map(r=>r.id));
  if(new Set(names).size!==names.length || state.racks.some(r=>!currentIds.has(r.id)&&names.includes(r.name))){toast('Não foi possível aplicar: nomes duplicados');return;}
  racks.forEach((r,i)=>r.name=names[i]);
  closeRenameRowModal();
  renderAll();
  toast(`${racks.length} racks renomeados`);
}

function rowDepth(row){
  // A row has its own fixed layout depth. Changing an individual rack depth
  // must not move the whole row or any other row.
  return Math.max(0.1,num(row?.depth,state.rackDepth));
}
function geometry(){
  const wrap=$('canvasWrap'), vw=wrap.clientWidth||900, vh=wrap.clientHeight||700;
  const maxSlot=Math.max(1,...state.rows.map(r=>Math.max(0,num(r.rackCount,0))),1);
  const nominalW=Math.max(0.1,num(state.rackWidth,.6));
  const scale=Math.max(95,Math.min(125,(vw-180)/(maxSlot*(nominalW+Math.max(0,num(state.rackGap,.02)))+1)));
  const x0=VIEW_PAD+90; let y=VIEW_PAD+70; const rows=[];
  state.rows.forEach((row,ri)=>{
    if(ri>0){
      const prev=state.rows[ri-1];
      y+=rowDepth(prev)*scale + Math.max(0,num(row.gap,0))*ROW_GAP_VISUAL*scale;
    }
    rows.push({row,y});
  });
  let maxRight=x0+200;
  let maxBottom=y+rowDepth(state.rows[state.rows.length-1]||{id:''})*scale+150;
  state.rows.forEach(row=>racksInRow(row.id).forEach(r=>{
    const x=x0+rowSlotPhysicalX(row,r.index)*scale+num(r.offset,0);
    maxRight=Math.max(maxRight,x+num(r.width,nominalW)*scale+140);
  }));
  return {w:Math.max(vw+VIEW_PAD*2,maxRight+VIEW_PAD),h:Math.max(vh+VIEW_PAD*2,maxBottom+VIEW_PAD),vw,vh,scale,x0,rows};
}
function slotPhysicalWidth(row,index){
  const r=rackAt(row.id,index);
  return r?num(r.width,state.rackWidth):num(state.rackWidth,.6);
}
function slotGapAfter(row,index){
  const r=rackAt(row.id,index);
  return r?Math.max(0,num(r.gapAfter,state.rackGap)):Math.max(0,num(state.rackGap,.02));
}
function rowSlotPhysicalX(row,index){
  let x=0;
  for(let i=0;i<Math.max(0,index);i++) x+=slotPhysicalWidth(row,i)+slotGapAfter(row,i);
  return x;
}
function rackRect(r,g){
  const info=g.rows.find(x=>x.row.id===r.rowId);
  const x=g.x0+rowSlotPhysicalX(rowForRack(r),r.index)*g.scale+num(r.offset,0);
  const y=(info?info.y:0)+num(r.yOffset,0);
  const ww=num(r.width,state.rackWidth)*g.scale;
  const hh=num(r.depth,state.rackDepth)*g.scale;
  return{x,y,w:ww,h:hh};
}
function rackCenter(r,g){const q=rackRect(r,g);return{x:q.x+q.w/2,y:q.y+q.h/2};}
function edgeRacks(rowId){const rs=racksInRow(rowId);return {first:rs[0]||null,last:rs[rs.length-1]||null};}
function isEdgeRack(r){const row=rowForRack(r);if(!row)return false;const e=edgeRacks(row.id);return !!e.first&&!!e.last&&(r.id===e.first.id||r.id===e.last.id);}
function edgeSideForRack(r){const e=edgeRacks(r.rowId);if(e.first?.id===r.id)return 'left';if(e.last?.id===r.id)return 'right';return null;}
function currentEdgeIndex(rowId,side){const e=edgeRacks(rowId);return side==='left'?(e.first?.index??0):(e.last?.index??0);} 

function rackSidePoint(r,g){const q=rackRect(r,g); const side=edgeSideForRack(r); return side==='left'?{x:q.x,y:q.y+q.h/2}:side==='right'?{x:q.x+q.w,y:q.y+q.h/2}:rackCenter(r,g);}
function rowCenterY(rowIndexValue,g){const info=g.rows[rowIndexValue]; if(!info)return 0; const rs=racksInRow(info.row.id); if(!rs.length)return info.y; const ys=rs.map(r=>rackCenter(r,g).y); return ys.reduce((a,b)=>a+b,0)/ys.length;}
function rowTrayBounds(row,g){
  const rs=racksInRow(row.id);
  const y=rowCenterY(state.rows.findIndex(x=>x.id===row.id),g);
  if(!rs.length){
    const x=g.x0;
    return {left:x-20,right:x-20,y};
  }
  const rects=rs.map(r=>rackRect(r,g));
  const left=Math.min(...rects.map(q=>q.x));
  const right=Math.max(...rects.map(q=>q.x+q.w));
  return {left:left-20,right:right+20,y};
}
function trayPointForRack(r,g){
  const row=rowForRack(r); if(!row)return rackCenter(r,g);
  const b=rowTrayBounds(row,g); if(!b)return rackCenter(r,g);
  if(r.index===0)return {x:b.left,y:b.y};
  const rs=racksInRow(row.id);
  const maxIndex=Math.max(...rs.map(x=>x.index));
  if(r.index===maxIndex)return {x:b.right,y:b.y};
  return {x:rackCenter(r,g).x,y:b.y};
}
function rackTrayPoint(r,g){return trayPointForRack(r,g);}
function trayPointForRowIndex(row,index,g,side){
  const b=rowTrayBounds(row,g);
  if(!b)return {x:g.x0,y:rowCenterY(state.rows.findIndex(x=>x.id===row.id),g)};
  const i=Math.max(0,Number(index)||0);
  const rs=racksInRow(row.id);
  const maxIndex=Math.max(0,Number(row.rackCount||0)-1);
  // Edge interconnections belong to the calha endpoint, never to the edge rack.
  if(side==='left')return {x:b.left,y:b.y};
  if(side==='right')return {x:b.right,y:b.y};
  if(i===0)return {x:b.left,y:b.y};
  if(i===maxIndex)return {x:b.right,y:b.y};
  const ref=rs.find(r=>r.index===i);
  if(ref)return {x:rackCenter(ref,g).x,y:b.y};
  const nominal=num(state.rackWidth,.6)*g.scale;
  let px=0; for(let k=0;k<i;k++) px+=slotPhysicalWidth(row,k)*g.scale+slotGapAfter(row,k)*g.scale;
  return {x:b.left+20+px+nominal/2,y:b.y};
}

function traySide(t,rowId){
  if(!t?.edge)return null;
  if(t.fromRowId===rowId && t.sideFrom)return t.sideFrom;
  if(t.toRowId===rowId && t.sideTo)return t.sideTo;
  const idx=t.fromRowId===rowId?t.fromIndex:t.toIndex;
  const row=state.rows.find(r=>r.id===rowId);
  if(!row)return null;
  const e=edgeRacks(row.id);
  if(e.first?.index===idx)return 'left';
  if(e.last?.index===idx)return 'right';
  return idx <= ((e.first?.index??0)+(e.last?.index??0))/2 ? 'left' : 'right';
}

function physicalPointOnRow(row,index,side){
  const maxIndex=Math.max(0,...racksInRow(row.id).map(r=>r.index));
  if(side==='left')return 0;
  if(side==='right'){
    let total=0;
    for(let i=0;i<=maxIndex;i++){
      total+=slotPhysicalWidth(row,i);
      if(i<maxIndex) total+=slotGapAfter(row,i);
    }
    return total;
  }
  const i=Math.max(0,Number(index)||0);
  let x=0;
  for(let k=0;k<i;k++) x+=slotPhysicalWidth(row,k)+slotGapAfter(row,k);
  return x+slotPhysicalWidth(row,i)/2;
}
function connectionPhysicalPosition(node){
  const row=state.rows.find(r=>r.id===node.rowId);
  return row?physicalPointOnRow(row,node.index,node.side):0;
}


function trayKey(t){return `${t.fromRowId}:${t.fromIndex}<->${t.toRowId}:${t.toIndex}`;}
function trayExists(a,b){return state.trays.some(t=>(t.fromRowId===a.rowId&&t.fromIndex===a.index&&t.toRowId===b.rowId&&t.toIndex===b.index)||(t.fromRowId===b.rowId&&t.fromIndex===b.index&&t.toRowId===a.rowId&&t.toIndex===a.index));}
function explicitTraysForRack(r){return state.trays.filter(t=>(t.fromRowId===r.rowId&&t.fromIndex===r.index)||(t.toRowId===r.rowId&&t.toIndex===r.index));}
function traysForRack(r){return explicitTraysForRack(r);}
function rackHasTray(r){return explicitTraysForRack(r).length>0;}
function addRackTrayToRow(r,targetRackId){
 const b=state.racks.find(x=>x.id===targetRackId);if(!b){toast('Selecione um rack de destino válido');return;}
 const targetRow=rowForRack(b),sourceRow=rowForRack(r);
 if(!targetRow||!sourceRow||!adjacentRows(sourceRow).some(x=>x.id===targetRow.id)){toast('A calha só pode interligar fileiras adjacentes');return;}
 if(b.index!==r.index){toast('A calha só pode interligar racks na mesma posição');return;}
 if(trayExists(r,b)){toast('Essa interligação de calha já existe');return;}
 const edge=isEdgeRack(r)&&isEdgeRack(b);
 state.trays.push({id:uid('tray'),fromRowId:r.rowId,toRowId:b.rowId,fromIndex:r.index,toIndex:b.index,edge,sideFrom:edge?edgeSideForRack(r):null,sideTo:edge?edgeSideForRack(b):null});
 normalizeState();renderAll();toast('Interligação de calha criada');
}
function removeRackTrays(r){/* infraestrutura sobrevive à exclusão do rack */}

function migrateLegacyTrays(g){
  const legacy=state.trays.filter(t=>t._legacy); if(!legacy.length)return;
  const converted=[];
  legacy.forEach(t=>{
    const ra=state.rows.find(r=>r.id===t.fromRowId), rb=state.rows.find(r=>r.id===t.toRowId);
    if(!ra||!rb)return;
    const sa=trayPointForRowIndex(ra,t.fromIndex,g,t.sideFrom||null);
    const sb=trayPointForRowIndex(rb,t.toIndex,g,t.sideTo||null);
    converted.push({
      id:t.id||uid('tray'),name:t.name||'Calha',x1:sa.x,y1:sa.y,x2:sb.x,y2:sb.y,width:num(t.width,.10),
      fromRowId:t.fromRowId,toRowId:t.toRowId,fromIndex:Number(t.fromIndex),toIndex:Number(t.toIndex),
      edge:!!t.edge,sideFrom:t.sideFrom||null,sideTo:t.sideTo||null
    });
  });
  state.trays=state.trays.filter(t=>!t._legacy).concat(converted);
  if(converted.length)localStorage.setItem(STORAGE,JSON.stringify(state));
}
// Keep tray endpoints that were snapped to racks physically attached to those
// racks. This makes an existing calha follow changes in rack width, depth or
// spacing without moving free/independent trays. The saved link also preserves
// which side/point of the rack the endpoint was attached to.
function syncStructuralTrayEndpoints(g){
  if(!g)return;
  // Inter-row calhas created from one rack/fileira to another are structural
  // connections, not free-floating geometry. Their endpoints must be derived
  // from the current rack positions on both rows every render. This makes them
  // follow changes to row spacing as well as rack width/gap changes.
  state.trays.forEach(t=>{
    if(!t?.fromRowId || !t?.toRowId)return;
    const ra=state.rows.find(r=>r.id===t.fromRowId);
    const rb=state.rows.find(r=>r.id===t.toRowId);
    if(!ra||!rb)return;
    const a=trayPointForRowIndex(ra,t.fromIndex,g,t.sideFrom||null);
    const b=trayPointForRowIndex(rb,t.toIndex,g,t.sideTo||null);
    if(a&&Number.isFinite(a.x)&&Number.isFinite(a.y)){t.x1=a.x;t.y1=a.y;}
    if(b&&Number.isFinite(b.x)&&Number.isFinite(b.y)){t.x2=b.x;t.y2=b.y;}
  });
}

function syncAttachedTrayEndpoints(g){
  if(!g)return;
  syncStructuralTrayEndpoints(g);
  if(!Array.isArray(state.trayRackLinks) || !state.trayRackLinks.length)return;
  state.trayRackLinks.forEach(link=>{
    const t=state.trays.find(x=>x.id===link.trayId);
    const r=state.racks.find(x=>x.id===link.rackId);
    if(!t||!r)return;
    const q=rackRect(r,g);
    let p;
    switch(link.point){
      case 'left': p={x:q.x,y:q.y+q.h/2}; break;
      case 'right': p={x:q.x+q.w,y:q.y+q.h/2}; break;
      case 'top': p={x:q.x+q.w/2,y:q.y}; break;
      case 'bottom': p={x:q.x+q.w/2,y:q.y+q.h}; break;
      default: p={x:q.x+q.w/2,y:q.y+q.h/2};
    }
    if(Number(link.end)===0){t.x1=p.x;t.y1=p.y;}
    else {t.x2=p.x;t.y2=p.y;}
  });
}
function trayLengthPx(t){return Math.hypot(num(t.x2)-num(t.x1),num(t.y2)-num(t.y1));}
function trayLengthMeters(t,g){syncAttachedTrayEndpoints(g);return trayLengthPx(t)/Math.max(1,g.scale);}
function createIndependentTray(g,x1,y1,x2,y2){
  if(structureBlocked())return;
  const t={id:uid('tray'),name:`Calha ${state.trays.length+1}`,x1,y1,x2,y2,width:.10};
  state.trays.push(t);state.multiSelected=[];state.trayMultiSelected=[t.id];state.selected={type:'tray',id:t.id};renderAll();toast('Calha independente criada');
}

function render(){
  const svg=$('layout'),stage=$('canvasStage'),g=geometry();
  migrateLegacyTrays(g);
  syncAttachedTrayEndpoints(g);
  // The stage is deliberately sized to the complete drawing so the scroll container
  // always has real horizontal AND vertical overflow when the plant is larger than the viewport.
  // Keep a real, larger-than-viewport scroll surface. This is intentionally independent
  // of the SVG viewBox so both native scrollbars always have a measurable range.
  const surfaceW=Math.max(g.w, g.vw+VIEW_PAD*2);
  const surfaceH=Math.max(g.h, g.vh+VIEW_PAD*2);
  stage.style.width=`${surfaceW}px`; stage.style.height=`${surfaceH}px`; stage.style.minWidth=`${surfaceW}px`; stage.style.minHeight=`${surfaceH}px`;
  svg.setAttribute('viewBox',`0 0 ${g.w} ${g.h}`); svg.setAttribute('width',g.w); svg.setAttribute('height',g.h); svg.style.width=`${g.w}px`; svg.style.height=`${g.h}px`; svg.style.minWidth=`${g.w}px`; svg.style.minHeight=`${g.h}px`; svg.style.maxWidth='none'; svg.style.maxHeight='none'; svg.style.display='block';
  svg.innerHTML='';
  if(window.__applyCanvasPan)requestAnimationFrame(window.__applyCanvasPan);
  for(let x=0;x<g.w;x+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="${x}" y1="0" x2="${x}" y2="${g.h}"/>`);
  for(let y=0;y<g.h;y+=40)svg.insertAdjacentHTML('beforeend',`<line class="gridline" x1="0" y1="${y}" x2="${g.w}" y2="${y}"/>`);

  state.rows.forEach((row,ri)=>{
    const cy=rowCenterY(ri,g);
    svg.insertAdjacentHTML('beforeend',`<text class="svg-row" x="${Math.max(8,g.x0-46)}" y="${cy+4}" text-anchor="end">${esc(row.name)}</text>`);
    if(ri>0){
      const prev=g.rows[ri-1],cur=g.rows[ri];
      const gap=Math.max(0,num(row.gap,0));
      const upperBottom=prev.y+(rowDepth(prev)*g.scale);
      const lowerTop=cur.y;
      // Dimension line is intentionally placed outside the racks/fileira labels.
      // The extension lines point from the rack edge to the external dimension,
      // keeping the gap itself visually free even when rows are very close.
      const xDim=Math.max(40, g.x0-88);
      const xExt=g.x0-50;
      const midY=(upperBottom+lowerTop)/2;
      svg.insertAdjacentHTML('beforeend',`<line class="row-gap-dim" x1="${xDim}" y1="${upperBottom}" x2="${xDim}" y2="${lowerTop}"/>`
        +`<line class="row-gap-ext" x1="${xDim}" y1="${upperBottom}" x2="${xExt}" y2="${upperBottom}"/>`
        +`<line class="row-gap-ext" x1="${xDim}" y1="${lowerTop}" x2="${xExt}" y2="${lowerTop}"/>`
        +`<line class="row-gap-tick" x1="${xDim-5}" y1="${upperBottom}" x2="${xDim+5}" y2="${upperBottom}"/>`
        +`<line class="row-gap-tick" x1="${xDim-5}" y1="${lowerTop}" x2="${xDim+5}" y2="${lowerTop}"/>`
        +`<text class="row-gap-label" x="${xDim-9}" y="${midY+3}" text-anchor="end">${gap.toFixed(2)} m</text>`);
    }
  });

  // Camada 1: corpos dos racks. As calhas ficam visualmente acima deles.
  state.racks.forEach(r=>{
    const q=rackRect(r,g),selected=state.multiSelected.includes(r.id) || (state.selected?.type==='rack'&&state.selected.id===r.id);
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><rect class="rack-body ${selected?'selected':''}" x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="7"/></g>`);
  });

  // Camada 2: calhas e seus nós. Elas sempre ficam por cima do corpo dos racks.
  state.trays.forEach(t=>{
    const selected=state.trayMultiSelected.includes(t.id) || (state.selected?.type==='tray'&&state.selected.id===t.id);
    const len=trayLengthMeters(t,g);
    const mx=(t.x1+t.x2)/2,my=(t.y1+t.y2)/2;
    svg.insertAdjacentHTML('beforeend',`<line data-tray="${t.id}" class="tray-line ${selected?'selected-tray':''}" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"/>`);
    svg.insertAdjacentHTML('beforeend',`<text class="tray-length" x="${mx}" y="${my-8}" text-anchor="middle">${len.toFixed(2)} m</text>`);
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-node-hit" data-tray="${t.id}" data-tray-node="a" cx="${t.x1}" cy="${t.y1}" r="11"/><circle class="tray-node-hit" data-tray="${t.id}" data-tray-node="b" cx="${t.x2}" cy="${t.y2}" r="11"/><circle class="tray-node" cx="${t.x1}" cy="${t.y1}" r="5"/><circle class="tray-node" cx="${t.x2}" cy="${t.y2}" r="5"/>`);
  });

  // Interligações: se os pontos já estão fisicamente coincidentes (snap),
  // mostramos somente a junção. Não desenhamos uma segunda linha por cima da calha.
  state.trayLinks.forEach(l=>{
    const a=state.trays.find(t=>t.id===l.aTray),b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const ap=trayPointAt(a,Number.isFinite(l.aT)?l.aT:(l.aEnd==='a'?0:1));
    const bp=trayPointAt(b,Number.isFinite(l.bT)?l.bT:(l.bEnd==='a'?0:1));
    const same=Math.hypot(ap.x-bp.x,ap.y-bp.y)<1.5;
    if(!same) svg.insertAdjacentHTML('beforeend',`<line class="tray-link" x1="${ap.x}" y1="${ap.y}" x2="${bp.x}" y2="${bp.y}"/>`);
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-junction" cx="${ap.x}" cy="${ap.y}" r="4"/><circle class="tray-junction" cx="${bp.x}" cy="${bp.y}" r="4"/>`);
  });

  // Camada 3: nomes e U dos racks ficam acima das calhas.
  state.racks.forEach(r=>{
    const q=rackRect(r,g),c=rackCenter(r,g);
    svg.insertAdjacentHTML('beforeend',`<g data-rack="${r.id}" class="rackg"><text class="rack-text" x="${c.x}" y="${c.y+4}">${esc(r.name)}</text><text class="svg-label" x="${c.x}" y="${q.y+q.h+14}" style="font-size:9px;text-anchor:middle">${r.units}U</text><text class="rack-width-label" x="${c.x}" y="${q.y+q.h+27}" text-anchor="middle">L ${num(r.width,state.rackWidth).toFixed(2)} m</text><text class="rack-depth-label" x="${c.x}" y="${q.y+q.h+40}" text-anchor="middle">P ${num(r.depth,state.rackDepth).toFixed(2)} m</text></g>`);
  });

  // Caixas de seleção múltipla. Shift = racks; Ctrl/Cmd+Shift = calhas.
  if(window.__rackSelectionBox){
    const b=window.__rackSelectionBox;
    svg.insertAdjacentHTML('beforeend',`<rect class="rack-selection-box" x="${Math.min(b.x1,b.x2)}" y="${Math.min(b.y1,b.y2)}" width="${Math.abs(b.x2-b.x1)}" height="${Math.abs(b.y2-b.y1)}"/>`);
  }
  if(window.__traySelectionBox){
    const b=window.__traySelectionBox;
    svg.insertAdjacentHTML('beforeend',`<rect class="tray-selection-box" x="${Math.min(b.x1,b.x2)}" y="${Math.min(b.y1,b.y2)}" width="${Math.abs(b.x2-b.x1)}" height="${Math.abs(b.y2-b.y1)}"/>`);
  }

  // Indicador visual do snap magnético durante o arraste de uma ponta.
  if(window.__traySnapGuide){
    const sg=window.__traySnapGuide;
    svg.insertAdjacentHTML('beforeend',`<circle class="tray-snap-guide" cx="${sg.x}" cy="${sg.y}" r="9"/>`);
  }
  if(state.selected?.type==='cable'){const c=state.cables.find(x=>x.id===state.selected.id);if(c){const pts=computeRoute(c,g);if(pts.length>1)svg.insertAdjacentHTML('beforeend',`<polyline class="route-line" points="${pts.map(p=>p.x+','+p.y).join(' ')}"/>`);}}
  // Textos dos racks ficam visualmente acima das calhas, mas não capturam o clique.
  // Assim uma calha que passa sobre um rack continua selecionável.
  svg.querySelectorAll('[data-rack]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const id=el.dataset.rack, multi=e.ctrlKey||e.metaKey;
    state.trayMultiSelected=[];
    if(multi){
      const set=new Set(state.multiSelected);
      if(set.has(id)){ set.delete(id); } else { set.add(id); }
      state.multiSelected=[...set].filter(rid=>state.racks.some(r=>r.id===rid));
      if(state.multiSelected.length){ state.selected={type:'rack',id:state.multiSelected[state.multiSelected.length-1]}; }
      else state.selected=null;
    }else{
      state.multiSelected=[id];
      state.selected={type:'rack',id};
    }
    renderAll();
  }));
  svg.querySelectorAll('.rack-text,.svg-label').forEach(el=>el.style.pointerEvents='none');
  svg.querySelectorAll('[data-tray]').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const id=el.dataset.tray, multi=e.ctrlKey||e.metaKey;
    // mousedown already handles Ctrl/Cmd multi-selection so a normal click
    // after it must not toggle the same calha a second time.
    if(window.__trayMouseMultiHandled===id){
      window.__trayMouseMultiHandled=null;
      renderAll();
      return;
    }
    if(multi){
      const set=new Set(state.trayMultiSelected);
      if(set.has(id)) set.delete(id); else set.add(id);
      state.trayMultiSelected=[...set].filter(tid=>state.trays.some(t=>t.id===tid));
      state.multiSelected=[];
      state.selected=state.trayMultiSelected.length?{type:'tray',id:state.trayMultiSelected[state.trayMultiSelected.length-1]}:null;
    }else{
      state.multiSelected=[];
      state.trayMultiSelected=[id];
      state.selected={type:'tray',id};
    }
    renderAll();
  }));
  // Clique em uma área vazia do canvas limpa a seleção atual. O grid não
  // captura ponteiro, portanto clicar sobre o fundo do SVG também conta como vazio.
  svg.addEventListener('click',e=>{
    if(e.target===svg){
      if(state.selected||state.multiSelected.length||state.trayMultiSelected.length){state.selected=null;state.multiSelected=[];state.trayMultiSelected=[];renderAll();}
    }
  });
  // Calhas: a linha move a calha; as pontas são redimensionáveis.
  // Ao aproximar uma ponta de outra calha, o ponto entra em SNAP magnético
  // imediatamente e passa a usar a mesma coordenada física.
  svg.querySelectorAll('[data-tray]').forEach(el=>el.addEventListener('mousedown',e=>{
    e.stopPropagation();
    const id=el.dataset.tray,t=state.trays.find(x=>x.id===id); if(!t)return;
    const node=el.dataset.trayNode;
    // Selecionar imediatamente ao pressionar a calha, inclusive quando ela
    // estiver sobre um rack. A linha fica destacada enquanto selecionada.
    const multiSelect=e.ctrlKey||e.metaKey;
    if(multiSelect){
      const set=new Set(state.trayMultiSelected);
      if(!set.has(id)) set.add(id);
      state.trayMultiSelected=[...set].filter(tid=>state.trays.some(x=>x.id===tid));
      state.multiSelected=[];
      window.__trayMouseMultiHandled=id;
    }else{
      state.trayMultiSelected=[id];
      state.multiSelected=[];
    }
    state.selected={type:'tray',id};
    render();
    if(structureBlocked()){ return; }
    const zoom=(window.__canvasPan&&Number.isFinite(window.__canvasPan.zoom))?window.__canvasPan.zoom:1;
    if(node){
      const end=node;
      // Arrastar uma ponta conectada significa editar essa ponta: a conexão antiga
      // é liberada antes do movimento. A nova conexão só é criada quando houver
      // um novo snap magnético. Isso evita linhas de ligação soltas/dobradas.
      const endT=end==='a'?0:1;
      state.trayLinks=state.trayLinks.filter(l=>{
        const at=l.aTray===t.id && Math.abs((l.aT??(l.aEnd==='a'?0:1))-endT)<0.002;
        const bt=l.bTray===t.id && Math.abs((l.bT??(l.bEnd==='a'?0:1))-endT)<0.002;
        return !(at||bt);
      });
      state.trayRackLinks=state.trayRackLinks.filter(l=>!(l.trayId===t.id && l.end===endT));
      const ox=e.clientX,oy=e.clientY,baseX=end==='a'?t.x1:t.x2,baseY=end==='a'?t.y1:t.y2;
      const move=ev=>{
        let rawX=baseX+(ev.clientX-ox)/zoom, rawY=baseY+(ev.clientY-oy)/zoom;
        // Shift trava a extensão em um único eixo, mantendo a calha reta.
        if(ev.shiftKey){
          const otherX=end==='a'?t.x2:t.x1, otherY=end==='a'?t.y2:t.y1;
          const dx=Math.abs(rawX-otherX),dy=Math.abs(rawY-otherY);
          if(dx>=dy) rawY=otherY; else rawX=otherX;
        }
        // Durante o movimento a ponta permanece livre. A conexão/snap só é
        // efetivada no mouseup, evitando que a calha "grude" enquanto ainda
        // está sendo arrastada. O guia apenas mostra onde o snap ocorrerá.
        const snap=nearestTrayOrRackSnap(t.id,rawX,rawY,34/zoom);
        if(end==='a'){t.x1=rawX;t.y1=rawY;}else{t.x2=rawX;t.y2=rawY;}
        window.__traySnapGuide=snap?{x:snap.x,y:snap.y,type:snap.type}:null;
        render();
      };
      const up=()=>{
        document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
        const ex=end==='a'?t.x1:t.x2,ey=end==='a'?t.y1:t.y2;
        const snap=nearestTrayOrRackSnap(t.id,ex,ey,38/zoom);
        if(snap){
          if(end==='a'){t.x1=snap.x;t.y1=snap.y;}else{t.x2=snap.x;t.y2=snap.y;}
          if(snap.type==='tray'){
            linkTrayPoints(t.id,end==='a'?0:1,snap.tray.id,snap.t);
            toast(`Snap: ${t.name} ↔ ${snap.tray.name}`);
          }else{
            state.trayRackLinks.push({trayId:t.id,end:end==='a'?0:1,rackId:snap.rack.id,point:snap.point});
            toast(`Snap: ${t.name} ↔ ${snap.rack.name}`);
          }
        }
        // Só depois de soltar e somente quando AS DUAS pontas desta calha
        // estiverem conectadas a qualquer destino válido (calha ou rack),
        // os cruzamentos passam a ser junções reais da infraestrutura.
        if(trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1)){
          connectCrossingsForTray(t.id);
        }
        window.__traySnapGuide=null;
        save();renderAll();
      };
      document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
      return;
    }

    // Se uma das pontas já estiver conectada, arrastar a linha usa a ponta oposta
    // como extremidade livre. Isso permite aumentar/reduzir a calha em vez de
    // criar um deslocamento estranho da conexão.
    const linkedA=trayEndpointConnected(t.id,0);
    const linkedB=trayEndpointConnected(t.id,1);
    const ox=e.clientX,oy=e.clientY,x1=t.x1,y1=t.y1,x2=t.x2,y2=t.y2;
    const move=ev=>{
      let dx=(ev.clientX-ox)/zoom,dy=(ev.clientY-oy)/zoom;
      if(ev.shiftKey){ if(Math.abs(dx)>=Math.abs(dy)) dy=0; else dx=0; }
      if(linkedA&&!linkedB){
        t.x2=x2+dx;t.y2=y2+dy;
      }else if(linkedB&&!linkedA){
        t.x1=x1+dx;t.y1=y1+dy;
      }else{
        t.x1=x1+dx;t.y1=y1+dy;t.x2=x2+dx;t.y2=y2+dy;
      }
      updateLinksForTray(t.id);render();
    };
    const up=()=>{
      document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
      if(trayEndpointConnected(t.id,0)&&trayEndpointConnected(t.id,1)) connectCrossingsForTray(t.id);
      save();renderAll();
    };
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  }));

}

function trayPointAt(t,tValue){
  const u=Math.max(0,Math.min(1,Number(tValue)||0));
  return {x:num(t.x1)+(num(t.x2)-num(t.x1))*u,y:num(t.y1)+(num(t.y2)-num(t.y1))*u};
}
function nearestPointOnSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  if(!den)return {x:ax,y:ay,t:0,d:Math.hypot(px-ax,py-ay)};
  let t=((px-ax)*dx+(py-ay)*dy)/den;t=Math.max(0,Math.min(1,t));
  const x=ax+t*dx,y=ay+t*dy;return {x,y,t,d:Math.hypot(px-x,py-y)};
}
function nearestTrayConnection(ignoreId,x,y,maxDist){
  let best=null,bestD=maxDist;
  state.trays.forEach(t=>{
    if(t.id===ignoreId)return;
    const q=nearestPointOnSegment(x,y,num(t.x1),num(t.y1),num(t.x2),num(t.y2));
    if(q.d<=bestD){best={type:'tray',tray:t,x:q.x,y:q.y,t:q.t,end:q.t<=0.001?'a':q.t>=0.999?'b':null};bestD=q.d;}
  });
  return best;
}
function nearestTrayOrRackSnap(ignoreTrayId,x,y,maxDist){
  const tray=nearestTrayConnection(ignoreTrayId,x,y,maxDist);
  let best=tray,bestD=tray?Math.hypot(x-tray.x,y-tray.y):maxDist;
  const g=geometry();
  state.racks.forEach(r=>{
    const q=rackRect(r,g);
    const candidates=[
      {point:'center',x:q.x+q.w/2,y:q.y+q.h/2},
      {point:'left',x:q.x,y:q.y+q.h/2},
      {point:'right',x:q.x+q.w,y:q.y+q.h/2},
      {point:'top',x:q.x+q.w/2,y:q.y},
      {point:'bottom',x:q.x+q.w/2,y:q.y+q.h}
    ];
    candidates.forEach(c=>{
      const d=Math.hypot(x-c.x,y-c.y);
      if(d<=bestD){
        best={type:'rack',rack:r,x:c.x,y:c.y,point:c.point};
        bestD=d;
      }
    });
  });
  return best;
}
function linkTrayPoints(aTray,aT,bTray,bT){
  const exists=state.trayLinks.some(l=>
    (l.aTray===aTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-aT)<0.002&&l.bTray===bTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-bT)<0.002)||
    (l.aTray===bTray&&Math.abs((l.aT??(l.aEnd==='a'?0:1))-bT)<0.002&&l.bTray===aTray&&Math.abs((l.bT??(l.bEnd==='a'?0:1))-aT)<0.002));
  if(!exists)state.trayLinks.push({aTray,aT,bTray,bT});
}
function segmentIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y}, s={x:d.x-c.x,y:d.y-c.y};
  const cross=(u,v)=>u.x*v.y-u.y*v.x;
  const den=cross(r,s);
  const qmp={x:c.x-a.x,y:c.y-a.y};
  if(Math.abs(den)<1e-9)return null;
  const t=cross(qmp,s)/den, u=cross(qmp,r)/den;
  if(t<-1e-6||t>1+1e-6||u<-1e-6||u>1+1e-6)return null;
  return {x:a.x+t*r.x,y:a.y+t*r.y,tA:Math.max(0,Math.min(1,t)),tB:Math.max(0,Math.min(1,u))};
}
function trayLinkExistsAt(aTray,aT,bTray,bT,tol=0.002){
  return state.trayLinks.some(l=>{
    const la=l.aTray===aTray&&l.bTray===bTray&&Math.abs((l.aT??0)-aT)<=tol&&Math.abs((l.bT??0)-bT)<=tol;
    const lb=l.aTray===bTray&&l.bTray===aTray&&Math.abs((l.aT??0)-bT)<=tol&&Math.abs((l.bT??0)-aT)<=tol;
    return la||lb;
  });
}
function updateLinksForTray(id){
  // Existing links use normalized positions, so they follow the calha when it moves.
  // A simple crossing is NOT a connection while the calha is being dragged.
}
function trayEndpointConnected(trayId,end){
  const t=state.trays.find(x=>x.id===trayId);
  if(!t)return false;
  const ex=end===0?num(t.x1):num(t.x2);
  const ey=end===0?num(t.y1):num(t.y2);

  // 1) Explicit links created by the snap interaction.
  const viaTray=state.trayLinks.some(l=>{
    const a=l.aTray===trayId && Math.abs((l.aT??(l.aEnd==='a'?0:1))-end)<0.002;
    const b=l.bTray===trayId && Math.abs((l.bT??(l.bEnd==='a'?0:1))-end)<0.002;
    return a||b;
  });
  if(viaTray)return true;
  const viaRack=state.trayRackLinks.some(l=>l.trayId===trayId && l.end===end);
  if(viaRack)return true;

  // 2) Geometry fallback. A connection is also valid when the endpoint is
  // physically sitting on a rack connection point or on another tray. This
  // makes the routing robust even if an older project has the geometry but
  // is missing the corresponding link record.
  const g=geometry();
  const tol=6;
  for(const r of state.racks){
    const q=rackRect(r,g);
    const pts=[
      {x:q.x+q.w/2,y:q.y+q.h/2},
      {x:q.x,y:q.y+q.h/2},{x:q.x+q.w,y:q.y+q.h/2},
      {x:q.x+q.w/2,y:q.y},{x:q.x+q.w/2,y:q.y+q.h}
    ];
    if(pts.some(pt=>Math.hypot(ex-pt.x,ey-pt.y)<=tol))return true;
  }
  for(const other of state.trays){
    if(other.id===trayId)continue;
    const q=nearestPointOnSegment(ex,ey,num(other.x1),num(other.y1),num(other.x2),num(other.y2));
    if(q.d<=tol)return true;
  }
  return false;
}
function connectCrossingsForTray(trayId){
  const a=state.trays.find(t=>t.id===trayId); if(!a)return;
  // This is intentionally evaluated only after mouseup, and only when both
  // endpoints are already connected. At that point crossings become real
  // junctions in the infrastructure network.
  if(!trayEndpointConnected(trayId,0)||!trayEndpointConnected(trayId,1))return;
  state.trays.forEach(b=>{
    if(b.id===a.id)return;
    const hit=segmentIntersection(
      {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
      {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
    );
    if(!hit)return;
    // If the intersection is already one of the explicit links, keep it.
    if(trayLinkExistsAt(a.id,hit.tA,b.id,hit.tB))return;
    state.trayLinks.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,autoCrossing:true});
  });
}

function renderProperties(){
  const p=$('properties');
  if(state.trayMultiSelected.length>1){
    const count=state.trayMultiSelected.length;
    p.innerHTML=`<div class="prop-title">${count} calhas selecionadas</div>
      <div class="help">Várias calhas selecionadas. Para evitar alterações acidentais na geometria e nas conexões, somente a exclusão em lote está disponível.</div>
      <button class="btn danger full" id="delSelectedTrays">Excluir ${count} calhas selecionadas</button>
      <button class="btn ghost full" id="clearSelectedTrays">Limpar seleção</button>`;
    $('delSelectedTrays').onclick=deleteSelectedTrays;
    $('clearSelectedTrays').onclick=()=>{state.trayMultiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(state.multiSelected.length>1){
    const count=state.multiSelected.length;
    p.innerHTML=`<div class="prop-title">${count} racks selecionados</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. As propriedades dos racks estão somente para consulta.</div>':''}
      <div class="help">As propriedades abaixo serão aplicadas a todos os racks selecionados. Deixe um campo vazio para não alterá-lo. Largura e profundidade mantêm cada rack centrado.</div>
      <div class="grid2"><label>Qtd. U<input id="bulkUnits" type="number" min="1" max="60" placeholder="Não alterar"></label><label>Largura (m)<input id="bulkWidth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="bulkDepth" type="number" min="0.1" step="0.01" placeholder="Não alterar"></label><label>Distância até o próximo (m)<input id="bulkGap" type="number" min="0" step="0.01" placeholder="Não alterar"></label></div>
      <label>Altura da última U → calha (m)<input id="bulkRise" type="number" min="0" step="0.01" placeholder="Não alterar"></label>
      <button class="btn primary full" id="applyBulkRack">✓ Aplicar propriedades</button>
      <button class="btn danger full" id="delSelectedRacks">Excluir ${count} racks selecionados</button>
      <button class="btn ghost full" id="clearSelectedRacks">Limpar seleção</button>`;
    $('applyBulkRack').onclick=()=>{if(structureBlocked())return;
      const ids=new Set(state.multiSelected);
      const unitsVal=$('bulkUnits').value.trim(), widthVal=$('bulkWidth').value.trim(), depthVal=$('bulkDepth').value.trim(), gapVal=$('bulkGap').value.trim(), riseVal=$('bulkRise').value.trim();
      if(!unitsVal&&!widthVal&&!depthVal&&!gapVal&&!riseVal){toast('Informe pelo menos uma propriedade');return;}
      state.racks.filter(r=>ids.has(r.id)).forEach(r=>{
        if(unitsVal){r.units=Math.max(1,Math.min(60,Math.floor(num(unitsVal,r.units))));}
        if(widthVal){const old=Math.max(.1,num(r.width,state.rackWidth)),next=Math.max(.1,num(widthVal,state.rackWidth));r.offset=num(r.offset,0)+(old-next)/2;r.width=next;}
        if(depthVal){const old=Math.max(.1,num(r.depth,state.rackDepth)),next=Math.max(.1,num(depthVal,state.rackDepth));r.yOffset=num(r.yOffset,0)+(old-next)/2;r.depth=next;}
        if(gapVal){r.gapAfter=Math.max(0,num(gapVal,r.gapAfter??state.rackGap));}
        if(riseVal){r.riseToTray=Math.max(0,num(riseVal,r.riseToTray??state.lastUToTray));}
      });
      refreshVisuals();renderProperties();toast(`${count} racks atualizados`);
    };
    $('delSelectedRacks').onclick=()=>{if(!structureBlocked())deleteSelectedRacks();};
    $('clearSelectedRacks').onclick=()=>{state.multiSelected=[];state.selected=null;renderAll();};
    return;
  }
  if(!state.selected){p.innerHTML='<div class="empty">Selecione um rack, calha ou cabo.</div>';return;}
  if(state.selected.type==='rack'){
    const r=state.racks.find(x=>x.id===state.selected.id); if(!r){state.selected=null;return renderProperties();}
    const row=rowForRack(r);
    p.innerHTML=`<div class="prop-title">${esc(r.name)}</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar este rack.</div>':''}
      <label>Nome<input id="prName" value="${esc(r.name)}"></label>
      <div class="grid2"><label>Qtd. U<input id="prUnits" type="number" min="1" max="60" value="${r.units}"></label><label>Largura (m)<input id="prWidth" type="number" min="0.1" step="0.01" value="${r.width}"></label></div>
      <div class="grid2"><label>Profundidade (m)<input id="prDepth" type="number" min="0.1" step="0.01" value="${r.depth??state.rackDepth}"></label><label>Distância até o próximo (m)<input id="prGapAfter" type="number" min="0" step="0.01" value="${r.gapAfter??state.rackGap}"></label></div>
      <label>Altura da última U → calha (m)<input id="prRiseToTray" type="number" min="0" step="0.01" value="${num(r.riseToTray,state.lastUToTray).toFixed(2)}"></label>
      <div class="help">A distância acima é específica deste rack e vale para o espaço até o próximo rack da mesma fileira. A altura até a calha também é individual e será usada no cálculo dos cabos deste rack.</div>
      <button class="btn danger full" id="delRack">Excluir rack</button>
      <div class="help autosave">As alterações do rack são salvas automaticamente.</div>`;
    if($('prName'))$('prName').onchange=()=>{if(structureBlocked())return;r.name=$('prName').value.trim();refreshVisuals();renderProperties();};
    if($('prUnits'))$('prUnits').onchange=()=>{if(structureBlocked())return;r.units=Math.max(1,Math.min(60,Math.floor(num($('prUnits').value,state.rackUnits))));refreshVisuals();renderProperties();};
    if($('prWidth'))$('prWidth').onchange=()=>{if(structureBlocked())return;
      const oldWidth=Math.max(.1,num(r.width,state.rackWidth));
      const nextWidth=Math.max(.1,num($('prWidth').value,state.rackWidth));
      // Keep the rack centered while changing its width. The offset is the
      // horizontal correction applied after the slot position is calculated.
      r.offset=num(r.offset,0)+(oldWidth-nextWidth)/2;
      r.width=nextWidth;
      refreshVisuals();renderProperties();
    };
    if($('prDepth'))$('prDepth').onchange=()=>{if(structureBlocked())return;
      const oldDepth=Math.max(.1,num(r.depth,state.rackDepth));
      const nextDepth=Math.max(.1,num($('prDepth').value,state.rackDepth));
      // Keep the rack centered vertically while changing its depth.
      r.yOffset=num(r.yOffset,0)+(oldDepth-nextDepth)/2;
      r.depth=nextDepth;
      refreshVisuals();renderProperties();
    };
    if($('prGapAfter'))$('prGapAfter').onchange=()=>{if(structureBlocked())return;r.gapAfter=Math.max(0,num($('prGapAfter').value,state.rackGap));refreshVisuals();renderProperties();};
    if($('prRiseToTray'))$('prRiseToTray').onchange=()=>{if(structureBlocked())return;r.riseToTray=Math.max(0,num($('prRiseToTray').value,state.lastUToTray));refreshVisuals();renderProperties();};
    if($('delRack'))$('delRack').onclick=()=>{if(structureBlocked())return;
      if(!confirm(`Excluir o rack ${r.name||''}?`))return;
      const parentRow=rowForRack(r);
      removeRackReferences([r.id]);
      state.racks=state.racks.filter(x=>x.id!==r.id);
      // The row property must reflect the number of racks that actually
      // remain.  Do not use r.index+1 here because physical slot indexes may
      // contain gaps after a rack is deleted.
      if(parentRow) parentRow.rackCount=racksInRow(parentRow.id).length;
      state.selected=null;
      state.multiSelected=[];
      normalizeState();renderAll();toast('Rack excluído');
    };
    return;
  }
  if(state.selected.type==='tray'){
    const t=state.trays.find(x=>x.id===state.selected.id); if(!t){state.selected=null;return renderProperties();}
    const g=geometry();
    const currentLength=trayLengthMeters(t,g);
    p.innerHTML=`<div class="prop-title">${esc(t.name||'Calha')}</div>
      ${isStructureLocked()?'<div class="structure-lock-note">🔒 Estrutura bloqueada. Desbloqueie para alterar esta calha.</div>':''}
      <label>Nome<input id="trName" value="${esc(t.name||'Calha')}"></label>
      <label>Comprimento da calha (m)<input id="trLength" type="number" min="0.01" step="0.01" value="${currentLength.toFixed(2)}"></label>
      <div class="help">Calha independente: não está vinculada a nenhuma fileira ou rack. Pode existir sozinha em qualquer área do ambiente.</div>
      <div class="result"><div class="metric"><span>Comprimento atual</span><b>${currentLength.toFixed(2)} m</b></div></div>
      <button class="btn danger full" id="delTray">Excluir calha</button>`;
    $('trName').onchange=e=>{if(structureBlocked())return;t.name=e.target.value.trim()||'Calha';save();renderAll();};
    $('trLength').onchange=e=>{if(structureBlocked())return;
      const target=Math.max(0.01,num(e.target.value,currentLength));
      const dx=num(t.x2)-num(t.x1),dy=num(t.y2)-num(t.y1),px=Math.hypot(dx,dy);
      if(px<1e-6){t.x2=num(t.x1)+target*Math.max(1,g.scale);t.y2=num(t.y1);}
      else {
        const targetPx=target*Math.max(1,g.scale);
        t.x2=num(t.x1)+(dx/px)*targetPx;
        t.y2=num(t.y1)+(dy/px)*targetPx;
      }
      autoJoinIntersectingTrays(t.id);save();renderAll();
    };
    $('delTray').onclick=()=>{if(structureBlocked())return;state.trays=state.trays.filter(x=>x.id!==t.id);state.selected=null;save();renderAll();toast('Calha removida');};
    return;
  }
  if(state.selected.type==='cable')renderCableProperties(p,state.cables.find(x=>x.id===state.selected.id));
}

function cableUnitValidation(c){
  const o=state.racks.find(r=>r.id===c.originRack);
  const d=state.racks.find(r=>r.id===c.destRack);
  const ou=Math.floor(num(c.originU,0));
  const du=Math.floor(num(c.destU,0));
  const errors=[];
  if(!o) errors.push('Rack de origem não encontrado.');
  else if(ou<1 || ou>Math.max(1,Math.floor(num(o.units,state.rackUnits)))) errors.push(`U origem inválida: ${o.name} possui ${Math.floor(num(o.units,state.rackUnits))}U.`);
  if(!d) errors.push('Rack de destino não encontrado.');
  else if(du<1 || du>Math.max(1,Math.floor(num(d.units,state.rackUnits)))) errors.push(`U destino inválida: ${d.name} possui ${Math.floor(num(d.units,state.rackUnits))}U.`);
  return {valid:errors.length===0,errors,origin:o,dest:d};
}
function refreshCableValidation(c){
  const v=cableUnitValidation(c);
  const ou=$('cbOU'), du=$('cbDU'), oe=$('cbOUError'), de=$('cbDUError'), save=$('saveCable');
  if(ou && v.origin){ou.max=Math.floor(num(v.origin.units,state.rackUnits));ou.classList.toggle('input-error',Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ou.max);}
  if(du && v.dest){du.max=Math.floor(num(v.dest.units,state.rackUnits));du.classList.toggle('input-error',Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>du.max);}
  if(oe)oe.textContent=v.origin && (Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>Math.floor(num(v.origin.units,state.rackUnits)))?`Máximo: ${Math.floor(num(v.origin.units,state.rackUnits))}U.`:'';
  if(de)de.textContent=v.dest && (Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>Math.floor(num(v.dest.units,state.rackUnits)))?`Máximo: ${Math.floor(num(v.dest.units,state.rackUnits))}U.`:'';
  return v;
}

function renderCableProperties(p,c){
  if(!c){p.innerHTML='<div class="empty">Cabo não encontrado.</div>';return;}
  const opts=state.racks.map(r=>`<option value="${r.id}">${esc(rowForRack(r)?.name||'')} / ${esc(r.name)} (${Math.floor(num(r.units,state.rackUnits))}U)</option>`).join('');
  const v=cableUnitValidation(c);
  const o=v.origin,d=v.dest;
  const ouMax=o?Math.floor(num(o.units,state.rackUnits)):1, duMax=d?Math.floor(num(d.units,state.rackUnits)):1;
  const ouInvalid=!o||Math.floor(num(c.originU,0))<1||Math.floor(num(c.originU,0))>ouMax;
  const duInvalid=!d||Math.floor(num(c.destU,0))<1||Math.floor(num(c.destU,0))>duMax;
  p.innerHTML=`<div class="prop-title">${esc(c.name)}</div><label>Nome<input id="cbName" value="${esc(c.name)}"></label>
  <label>Tipo<select id="cbType">${CABLE_TYPES.map(t=>`<option value="${esc(t)}" ${c.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>
  <div class="grid2"><label>Rack origem<select id="cbOR">${opts}</select></label><label>U origem<input id="cbOU" class="${ouInvalid?'input-error':''}" type="number" min="1" max="${ouMax}" value="${c.originU}"><small id="cbOUError" class="field-error">${ouInvalid?`Máximo: ${ouMax}U.`:''}</small></label></div>
  <div class="grid2"><label>Rack destino<select id="cbDR">${opts}</select></label><label>U destino<input id="cbDU" class="${duInvalid?'input-error':''}" type="number" min="1" max="${duMax}" value="${c.destU}"><small id="cbDUError" class="field-error">${duInvalid?`Máximo: ${duMax}U.`:''}</small></label></div>
  ${!v.valid?`<div class="validation-error">⚠ ${v.errors.map(esc).join('<br>')}</div>`:''}
  <label>Folga (%)<input id="cbSlack" type="number" min="0" step="1" value="${c.slack??state.defaultSlack}"></label>
  <div class="result" id="cableResult"></div><div class="route-tools"><b>Rota</b><div class="help">A rota automática utiliza somente as calhas e interligações existentes.</div>
   <button class="btn primary" id="autoRoute" ${v.valid?'':'disabled'}>Usar rota automática</button><button class="btn danger" id="delCable">Excluir cabo</button></div>`;
  $('cbOR').value=c.originRack;$('cbDR').value=c.destRack;
  const sync=()=>{refreshVisuals();renderProperties();};
  $('cbType').onchange=()=>{c.type=$('cbType').value;sync();};
  $('cbOR').onchange=()=>{c.originRack=$('cbOR').value;sync();};
  $('cbDR').onchange=()=>{c.destRack=$('cbDR').value;sync();};
  $('cbOU').oninput=()=>{c.originU=Math.floor(num($('cbOU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();};
  $('cbDU').oninput=()=>{c.destU=Math.floor(num($('cbDU').value,0));refreshCableValidation(c);updateCableResult(c);refreshVisuals();};
  $('cbOU').onchange=()=>{renderProperties();};
  $('cbDU').onchange=()=>{renderProperties();};
  $('cbSlack').onchange=()=>{c.slack=Math.max(0,num($('cbSlack').value,0));refreshVisuals();renderProperties();};
  $('cbName').onchange=()=>{c.name=$('cbName').value.trim()||c.name;refreshVisuals();renderProperties();};
  $('autoRoute').onclick=()=>{const path=shortestPathRacks(c);if(path.length===2&&path[0].id===c.originRack&&path[1].id===c.destRack){c.via=[];refreshVisuals();renderProperties();toast('Rota automática calculada pelas calhas');}else if(c.originRack===c.destRack){c.via=[];refreshVisuals();renderProperties();}else toast('Não existe rota pelas calhas cadastradas');};
  $('delCable').onclick=()=>{state.cables=state.cables.filter(x=>x.id!==c.id);state.selected=null;renderAll();toast('Cabo removido');};
   updateCableResult(c);
}
function renderViaList(c){const el=$('viaList');if(!el)return;el.innerHTML='';(c.via||[]).forEach((id,i)=>{const d=document.createElement('div');d.className='route-node';d.innerHTML=`<select data-via="${i}">${state.racks.map(r=>`<option value="${r.id}" ${r.id===id?'selected':''}>${esc(rowForRack(r)?.name||'')} / ${esc(r.name)}</option>`).join('')}</select><button class="btn small danger" data-via-del="${i}">×</button>`;el.appendChild(d);});el.querySelectorAll('[data-via]').forEach(s=>s.onchange=()=>{c.via[+s.dataset.via]=s.value;refreshVisuals();renderProperties();});el.querySelectorAll('[data-via-del]').forEach(b=>b.onclick=()=>{c.via.splice(+b.dataset.viaDel,1);refreshVisuals();renderProperties();});}
function updateCableResult(c){const el=$('cableResult');if(!el)return;const validation=cableUnitValidation(c);if(!validation.valid){el.innerHTML='<div class="validation-error">⚠ '+validation.errors.map(esc).join('<br>')+'</div>';return;}const res=calcCable(c);const rounded=res.reachable?Math.ceil(res.total):0;el.innerHTML=`<div class="metric"><span>Vertical origem</span><b>${res.v1.toFixed(2)} m</b></div><div class="metric"><span>Trecho pelas calhas</span><b>${res.tray.toFixed(2)} m</b></div><div class="metric"><span>Vertical destino</span><b>${res.v2.toFixed(2)} m</b></div><div class="metric"><span>Base</span><b>${res.base.toFixed(2)} m</b></div><div class="metric"><span>Folga ${c.slack??state.defaultSlack}%</span><b>${res.slack.toFixed(2)} m</b></div><div class="metric"><span>Total</span><b>${res.total.toFixed(2)} m</b></div><div class="metric total-rounded"><span>Total arredondado para cima</span><b>${res.reachable?rounded:'—'} m</b></div>${res.reachable?'':'<div class="unreachable">Não existe rota pelas calhas cadastradas.</div>'}`;}

// ---------- Graph / shortest route ----------
// Infrastructure-first: only tray connection points are cross-row nodes. Intermediate racks are not waypoints.
function rowSlotX(row,index){return physicalPointOnRow(row,index,null);}
function rackIntervalOnRow(r){const row=rowForRack(r);if(!row)return null;const x=physicalPointOnRow(row,r.index,null);const w=slotPhysicalWidth(row,r.index);return {left:x,right:x+w};}
function rackEdgeDistance(a,b){
  if(a.rowId!==b.rowId)return Infinity;
  const ia=rackIntervalOnRow(a),ib=rackIntervalOnRow(b);if(!ia||!ib)return Infinity;
  if(ia.right<=ib.left)return Math.max(0,ib.left-ia.right);
  if(ib.right<=ia.left)return Math.max(0,ia.left-ib.right);
  return 0;
}
function rowPointDistance(a,b){return rackEdgeDistance(a,b);}
function sameRowDistance(a,b){return a.rowId===b.rowId?rowPointDistance(a,b):Infinity;}
function rowGapBetween(ra,rb){if(ra===rb)return 0;let d=0;const lo=Math.min(ra,rb),hi=Math.max(ra,rb);for(let i=lo+1;i<=hi;i++)d+=Math.max(0,num(state.rows[i]?.gap,0));return d;}
function rackCableRiseMeters(r,u,tray){
  const units=Math.max(1,num(r.units,state.rackUnits));
  const usedU=Math.max(1,Math.min(units,Math.floor(num(u,1))));
  // The vertical leg belongs exclusively to the rack. The tray has no
  // height-to-U property; each rack carries its own riseToTray value.
  const rise = Number.isFinite(Number(r.riseToTray)) ? Number(r.riseToTray) : num(state.lastUToTray,1);
  return Math.max(0,(units-usedU)*(U_MM/1000)) + Math.max(0,rise);
}
function ensureInfrastructureJunctions(){
  // Rebuild any valid crossing junctions before calculating a cable. This is
  // intentionally NOT called while a tray is being dragged. A tray only
  // participates in automatic crossings when both of its endpoints are
  // already connected to a valid destination (rack or tray).
  state.trays.forEach(t=>{
    if(trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1)){
      connectCrossingsForTray(t.id);
    }
  });
}
function buildRouteGraph(c){
  // Infrastructure-only graph. Crossings are derived from the current geometry
  // at calculation time, but ONLY between trays whose two endpoints are already
  // connected (to racks or to other trays). This keeps dragging non-destructive
  // while guaranteeing that valid cross-row intersections are recognized.
  ensureInfrastructureJunctions();
  const nodes=new Map(),edges=new Map();
  const addNode=(id,n)=>{if(!nodes.has(id)){nodes.set(id,n);edges.set(id,[]);}};
  const connect=(a,b,cost)=>{
    if(!Number.isFinite(cost)||cost<0)return;
    if(!nodes.has(a)||!nodes.has(b))return;
    edges.get(a).push({id:b,cost});edges.get(b).push({id:a,cost});
  };
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return null;
  const oid=`rack:${o.id}`,did=`rack:${d.id}`;
  addNode(oid,{kind:'rack',rack:o,role:'origin'});
  addNode(did,{kind:'rack',rack:d,role:'dest'});
  const g=geometry();
  syncAttachedTrayEndpoints(g);

  // Build a complete, current set of junction/access parameters for each tray.
  // A junction may come from an explicit endpoint link or from a valid crossing.
  const complete= t => trayEndpointConnected(t.id,0) && trayEndpointConnected(t.id,1);
  const trayPoints=new Map();
  const crossingPairs=[];
  state.trays.forEach(t=>trayPoints.set(t.id,[]));

  // Explicit tray-to-tray links (including endpoint-to-endpoint snaps).
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray), b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    trayPoints.get(a.id).push({t:at,kind:'link',linkKey:`${i}:a`});
    trayPoints.get(b.id).push({t:bt,kind:'link',linkKey:`${i}:b`});
  });

  // Explicit rack access points are always infrastructure nodes.
  state.trayRackLinks.forEach((l,i)=>{
    const t=state.trays.find(x=>x.id===l.trayId),r=state.racks.find(x=>x.id===l.rackId);
    if(!t||!r)return;
    if(r.id!==o.id&&r.id!==d.id)return;
    trayPoints.get(t.id).push({t:num(l.end,0),kind:'rack',rack:r,explicit:true,linkKey:`rack:${i}`});
  });

  // Virtual access: a horizontal tray can be entered from a rack only when
  // the tray is physically on the SAME ROW as that rack. The previous
  // implementation projected the rack X onto every horizontal tray in the
  // project; that accidentally connected Row A racks directly to Row B
  // trays and was the cause of routes such as A-01 -> B-05 using only the
  // bottom horizontal tray.
  //
  // Explicit rack-to-tray snaps remain authoritative for trays that are not
  // horizontal or are deliberately positioned away from the row centre.
  [o,d].forEach(r=>{
    const q=rackRect(r,g),rx=q.x+q.w/2,ry=q.y+q.h/2;
    state.trays.forEach(t=>{
      const dx=num(t.x2)-num(t.x1),dy=num(t.y2)-num(t.y1);
      if(Math.abs(dx)<1e-6)return; // vertical/diagonal access requires explicit snap
      const tv=(rx-num(t.x1))/dx;
      if(tv<-1e-6||tv>1+1e-6)return;
      const p=trayPointAt(t,tv);
      // Only a tray running through the same rack row may receive this
      // implicit access. Use a small tolerance in canvas pixels.
      if(Math.abs(p.y-ry)>Math.max(8,g.scale*0.08))return;
      trayPoints.get(t.id).push({t:tv,kind:'rack',rack:r,virtual:true});
    });
  });

  // A crossing becomes a real junction when at least ONE of the two trays
  // is fully connected at both endpoints. The fully connected tray is the
  // one that authorizes the junction; the other tray does NOT need both
  // endpoints connected. This matches the infrastructure rule: once the
  // tray being positioned has both ends connected (to a rack or another
  // tray), every tray it crosses becomes part of the usable network.
  for(let i=0;i<state.trays.length;i++){
    const a=state.trays[i];
    for(let j=i+1;j<state.trays.length;j++){
      const b=state.trays[j];
      if(!complete(a) && !complete(b))continue;
      const hit=segmentIntersection(
        {x:num(a.x1),y:num(a.y1)},{x:num(a.x2),y:num(a.y2)},
        {x:num(b.x1),y:num(b.y1)},{x:num(b.x2),y:num(b.y2)}
      );
      if(!hit)continue;
      const key=`${a.id}:${b.id}`;
      trayPoints.get(a.id).push({t:hit.tA,kind:'cross',crossKey:key});
      trayPoints.get(b.id).push({t:hit.tB,kind:'cross',crossKey:key});
      crossingPairs.push({aTray:a.id,aT:hit.tA,bTray:b.id,bT:hit.tB,key});
    }
  }

  // Add tray nodes, de-duplicate coincident parameters, then connect consecutive
  // points by the actual physical distance along that tray.
  state.trays.forEach(t=>{
    const pts=trayPoints.get(t.id)||[];
    pts.push({t:0,kind:'endpoint'}); pts.push({t:1,kind:'endpoint'});
    pts.sort((a,b)=>a.t-b.t);
    const groups=[];
    for(const pt of pts){
      const last=groups[groups.length-1];
      if(!last || Math.abs(last[0].t-pt.t)>0.000001)groups.push([pt]);
      else last.push(pt);
    }
    const ids=[];
    groups.forEach((group,gi)=>{
      const tv=group.reduce((sum,p)=>sum+p.t,0)/group.length;
      const p=trayPointAt(t,tv);
      const id=`tray:${t.id}:p:${gi}`;
      const rackPt=group.find(x=>x.kind==='rack'&&x.rack);
      addNode(id,{kind:'tray',tray:t,t:tv,x:p.x,y:p.y,access:!!rackPt,rack:rackPt?.rack||null});
      ids.push(id);
      // Same physical point on the same tray is a zero-cost alias.
      for(let k=1;k<group.length;k++){
        const alias=`tray:${t.id}:alias:${gi}:${k}`;
        addNode(alias,{kind:'alias',tray:t,t:tv,x:p.x,y:p.y});
        connect(id,alias,0);
      }
    });
    for(let i=1;i<ids.length;i++){
      const a=nodes.get(ids[i-1]),b=nodes.get(ids[i]);
      const meters=Math.hypot(b.x-a.x,b.y-a.y)/Math.max(1,g.scale);
      connect(ids[i-1],ids[i],meters);
    }
    // Connect every explicit/virtual rack access to its corresponding tray point.
    groups.forEach((group,gi)=>{
      const baseId=ids[gi];
      group.forEach((pt,k)=>{
        if(pt.kind!=='rack'||!pt.rack)return;
        const aid=`rack:${pt.rack.id}:access:${t.id}:${gi}:${k}`;
        addNode(aid,{kind:'tray',tray:t,t:pt.t,x:trayPointAt(t,pt.t).x,y:trayPointAt(t,pt.t).y,access:true,rack:pt.rack});
        connect(baseId,aid,0);
        const u=pt.rack.id===o.id?num(c.originU,1):num(c.destU,1);
        connect(pt.rack.id===o.id?oid:did,aid,rackCableRiseMeters(pt.rack,u,t));
      });
    });
  });

  // Valid crossings are zero-length junctions between the two tray graphs.
  // They are added only after both trays are fully connected.
  for(const pair of crossingPairs){
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.aTray).sort((x,y)=>Math.abs(x[1].t-pair.aT)-Math.abs(y[1].t-pair.aT));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===pair.bTray).sort((x,y)=>Math.abs(x[1].t-pair.bT)-Math.abs(y[1].t-pair.bT));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  }

  // Explicit tray-to-tray snaps are zero-length transitions. Connect the
  // nearest graph nodes at their stored parameters; this covers endpoint snaps.
  state.trayLinks.forEach((l,i)=>{
    const a=state.trays.find(t=>t.id===l.aTray),b=state.trays.find(t=>t.id===l.bTray);
    if(!a||!b)return;
    const at=num(l.aT,0),bt=num(l.bT,0);
    const aIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===a.id).sort((x,y)=>Math.abs(x[1].t-at)-Math.abs(y[1].t-at));
    const bIds=[...nodes.entries()].filter(([id,n])=>n.kind==='tray'&&n.tray?.id===b.id).sort((x,y)=>Math.abs(x[1].t-bt)-Math.abs(y[1].t-bt));
    if(aIds[0]&&bIds[0])connect(aIds[0][0],bIds[0][0],0);
  });

  return{nodes,edges,oid,did};
}
function shortestPathNodes(c){
  const g=buildRouteGraph(c);if(!g)return[];
  const{nodes,edges,oid,did}=g,dist=new Map(),prev=new Map(),used=new Set();
  for(const id of nodes.keys())dist.set(id,Infinity);
  dist.set(oid,0);
  while(used.size<nodes.size){
    let cur=null,best=Infinity;
    for(const[id,d]of dist)if(!used.has(id)&&d<best){best=d;cur=id;}
    if(cur===null)break;
    used.add(cur);if(cur===did)break;
    for(const e of edges.get(cur)||[]){const nd=best+e.cost;if(nd<dist.get(e.id)){dist.set(e.id,nd);prev.set(e.id,cur);}}
  }
  if(!Number.isFinite(dist.get(did)))return[];
  const ids=[];let cur=did;
  while(cur){ids.unshift(cur);if(cur===oid)break;cur=prev.get(cur);}
  return ids[0]===oid?ids:[];
}
function shortestPathRacks(c){const ids=shortestPathNodes(c);if(!ids.length)return[];const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);return o&&d?[o,d]:[];}
function calcSegment(a,b){return a.rowId===b.rowId?sameRowDistance(a,b):Infinity;}
function calcAutomaticTrayLength(c){
  const g=buildRouteGraph(c);if(!g)return{reachable:false,length:0,path:[]};
  const ids=shortestPathNodes(c);if(!ids.length)return{reachable:false,length:0,path:[]};
  let length=0;
  for(let i=1;i<ids.length;i++){
    const a=g.nodes.get(ids[i-1]),b=g.nodes.get(ids[i]);
    const e=(g.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
    if(e)length+=e.cost;
  }
  return{reachable:true,length,path:ids};
}
function rackUPoint(r,u,g,accessPoint){
  const q=rackRect(r,g);
  const units=Math.max(1,num(r.units,state.rackUnits));
  const uu=Math.max(1,Math.min(units,Math.floor(num(u,1))));
  // U numbering is bottom-up. Keep the access X exactly aligned with the
  // rack/tray connection point so the rack-to-tray leg is vertical.
  const x=accessPoint?.x??(q.x+q.w/2);
  const y=q.y+q.h-((uu-.5)/units)*q.h;
  return{x,y};
}
function routePointsForAutomatic(c,g){
  const ids=shortestPathNodes(c);if(!ids.length)return[];
  const graph=buildRouteGraph(c),pts=[];
  // The plan-view cable is drawn only along the tray network. The vertical
  // rack-to-tray portions are physical height and are already represented in
  // the numerical calculation; drawing them in the top view creates the
  // unwanted lines through the rack body. Therefore rack nodes are omitted
  // from the visual polyline and only their tray access points are rendered.
  ids.forEach(id=>{
    const n=graph.nodes.get(id);
    if(!n || n.kind!=='tray')return;
    pts.push({x:n.x,y:n.y});
  });
  return dedupeRoutePoints(pts);
}
function dedupeRoutePoints(pts){
  const out=[];pts.forEach(p=>{if(!out.length||Math.hypot(p.x-out[out.length-1].x,p.y-out[out.length-1].y)>0.5)out.push(p);});return out;
}
function computeRoute(c,g){
  // Manual waypoints never bypass infrastructure. Recalculate the automatic
  // shortest route so every rendered cable remains on the tray network.
  return routePointsForAutomatic(c,g);
}
function calcCable(c){
  const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);
  if(!o||!d)return{v1:0,v2:0,tray:0,base:0,slack:0,total:0,reachable:false,path:[]};
  const rr=calcAutomaticTrayLength(c),reachable=rr.reachable;
  const graph=reachable?buildRouteGraph(c):null;
  let v1=0,v2=0,tray=0;
  if(reachable&&graph){
    const ids=rr.path;
    for(let i=1;i<ids.length;i++){
      const a=graph.nodes.get(ids[i-1]),b=graph.nodes.get(ids[i]),e=(graph.edges.get(ids[i-1])||[]).find(x=>x.id===ids[i]);
      if(!e)continue;
      if(a.kind==='rack'&&b.kind==='tray')v1+=e.cost;
      else if(a.kind==='tray'&&b.kind==='rack')v2+=e.cost;
      else tray+=e.cost;
    }
  }
  const base=reachable?v1+tray+v2:0;
  const slack=base*(num(c.slack,state.defaultSlack)/100),total=base+slack;
  return{v1,v2,tray,base,slack,total,reachable,path:rr.path};
}
function refreshVisuals(){normalizeState();render();renderCables();save();}
function addRackToRow(rowId){
  if(structureBlocked())return;
  const row=state.rows.find(r=>r.id===rowId); if(!row)return;
  const occupied=new Set(racksInRow(rowId).map(r=>r.index));
  let idx=0; while(occupied.has(idx))idx++;
  const r=makeRack(row,idx);
  state.racks.push(r);
  row.rackCount=Math.max(num(row.rackCount,0),idx+1);
  normalizeIndices();
  state.selected={type:'rack',id:r.id};
  renderAll();
  toast(`Rack adicionado em ${row.name||'fileira'}`);
}

function addCable(){if(state.racks.length<2){toast('Crie pelo menos 2 racks');return;}const c={id:uid('cable'),name:`Cabo-${String(state.cables.length+1).padStart(3,'0')}`,originRack:state.racks[0].id,originU:state.racks[0].units,destRack:state.racks[1].id,destU:state.racks[1].units,slack:state.defaultSlack,type:DEFAULT_CABLE_TYPE,via:[]};state.cables.push(c);state.multiSelected=[];state.selected={type:'cable',id:c.id};renderAll();toast('Cabo adicionado');}

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
    route.push(r.name||r.id||'');
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
function cableExportRows(){
  const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota'];
  return state.cables.map(c=>{
    const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);
    const vals=[c.name,c.type||DEFAULT_CABLE_TYPE,o?.name||'',c.originU,d?.name||'',c.destU,res.v1,res.tray,res.v2,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res)];
    const obj={}; headers.forEach((h,i)=>obj[h]=vals[i]??''); return obj;
  });
}
function setColumnWidths(ws,headers,data){
  ws.columns=headers.map((h,i)=>({header:h,key:'c'+i,width:Math.min(60,Math.max(12,Math.max(h.length,...data.map(r=>String(r[i]??'').length))+2))}));
}
function applyTypeValidation(ws, range='B2:B1000'){
  if(!ws)return;
  for(let row=2;row<=1000;row++){
    const cell=ws.getCell(`B${row}`);
    cell.dataValidation={type:'list',allowBlank:false,formulae:['"Fibra Multi Mode,Fibra Single Mode,UTP"']};
  }
}
async function downloadCableTemplate(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino'];
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    ws.addRow(headers);
    ws.addRow(['FIB-001','Fibra Multi Mode','Row-1-01',40,'Row-2-01',40]);
    ws.freezePanes={xSplit:0,ySplit:1};
    ws.autoFilter={from:'A1',to:'F2'};
    ws.getRow(1).font={bold:true};
    ws.columns=[{width:20},{width:24},{width:20},{width:12},{width:20},{width:12}];
    applyTypeValidation(ws);
    const buf=await wb.xlsx.writeBuffer();
    const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='template-importacao-cabos.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    toast('Template XLSX baixado');
  }catch(err){toast(err.message||'Erro ao baixar template');}
}
function importCablesXLSX(file){
  try{
    const reader=new FileReader();
    reader.onload=()=>{
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
        const val=(row,name,def='')=>{const i=map[name];return i==null||i>=row.length||row[i]===''||row[i]==null?def:row[i];};
        let added=0,skipped=0;
        for(const row of rows.slice(1)){
          if(!row.some(v=>v!==null&&String(v).trim()))continue;
          const origin=state.racks.find(r=>r.name===String(val(row,'Rack Origem','')).trim());
          const dest=state.racks.find(r=>r.name===String(val(row,'Rack Destino','')).trim());
          if(!origin||!dest){skipped++;continue;}
          const type=String(val(row,'Tipo',DEFAULT_CABLE_TYPE)).trim();
          if(!CABLE_TYPES.includes(type)){skipped++;continue;}
          state.cables.push({id:uid('cable'),name:String(val(row,'Nome',`Cabo-${String(state.cables.length+1).padStart(3,'0')}`)).trim(),type,originRack:origin.id,originU:Math.floor(num(val(row,'U Origem',origin.units),origin.units)),destRack:dest.id,destU:Math.floor(num(val(row,'U Destino',dest.units),dest.units)),slack:state.defaultSlack,via:[]});
          added++;
        }
        renderAll();
        toast(skipped?`${added} cabo(s) importado(s); ${skipped} ignorado(s).`:`${added} cabo(s) importado(s).`);
      }catch(err){toast(err.message||'Erro ao importar Excel');}
    };
    reader.readAsArrayBuffer(file);
  }catch(err){toast(err.message||'Erro ao importar Excel');}
}
function cableSummaryRows(){
  const groups=new Map();
  let invalid=0,unreachable=0;
  for(const c of state.cables){
    const v=cableUnitValidation(c);
    if(!v.valid){invalid++;continue;}
    const res=calcCable(c);
    if(!res.reachable){unreachable++;continue;}
    const length=Math.ceil(res.total);
    const type=c.type||DEFAULT_CABLE_TYPE;
    const key=type+'|'+length;
    groups.set(key,(groups.get(key)||0)+1);
  }
  const order=new Map(CABLE_TYPES.map((t,i)=>[t,i]));
  return [...groups.entries()].map(([key,qty])=>{const [type,length]=key.split('|');return {type,length:Number(length),qty};})
    .sort((a,b)=>(order.get(a.type)-order.get(b.type))||a.length-b.length);
}
async function exportCablesXLSX(){
  try{
    if(!window.ExcelJS)throw new Error('Biblioteca ExcelJS não carregada.');
    const headers=['Nome','Tipo','Rack Origem','U Origem','Rack Destino','U Destino','Vertical Origem (m)','Trecho Calhas (m)','Vertical Destino (m)','Base (m)','Folga (m)','Total (m)','Total Arredondado (m)','Rota'];
    const rows=state.cables.map(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack),res=calcCable(c);return [c.name,c.type||DEFAULT_CABLE_TYPE,o?.name||'',c.originU,d?.name||'',c.destU,res.v1,res.tray,res.v2,res.base,res.slack,res.total,res.reachable?Math.ceil(res.total):'',cableRouteLabel(c,res)];});
    const wb=new ExcelJS.Workbook();
    const ws=wb.addWorksheet('Cabos');
    ws.addRow(headers); rows.forEach(r=>ws.addRow(r));
    ws.freezePanes={xSplit:0,ySplit:1}; ws.autoFilter={from:'A1',to:`N${Math.max(1,rows.length+1)}`}; ws.getRow(1).font={bold:true};
    ws.columns=headers.map((h,i)=>({width:Math.min(60,Math.max(12,Math.max(h.length,...rows.map(r=>String(r[i]??'').length))+2))}));
    for(let i=2;i<=rows.length+1;i++)ws.getCell(`B${i}`).dataValidation={type:'list',allowBlank:false,formulae:['"Fibra Multi Mode,Fibra Single Mode,UTP"']};
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
}

function renderCables(){const el=$('cablesList');$('cableCount').textContent=state.cables.length;if(!state.cables.length){el.innerHTML='<div class="empty">Nenhum cabo cadastrado.</div>';return;}el.innerHTML=state.cables.map(c=>{const o=state.racks.find(r=>r.id===c.originRack),d=state.racks.find(r=>r.id===c.destRack);const invalid=!cableUnitValidation(c).valid;return`<div class="cable-item ${state.selected?.type==='cable'&&state.selected.id===c.id?'selected':''} ${invalid?'invalid':''}" data-cable="${c.id}"><div class="cable-name">${invalid?'⚠ ':''}${esc(c.name)}</div><div class="cable-meta">${esc(rowForRack(o)?.name||'?')} / ${esc(o?.name||'?')} U${c.originU} → ${esc(rowForRack(d)?.name||'?')} / ${esc(d?.name||'?')} U${c.destU}</div></div>`;}).join('');el.querySelectorAll('[data-cable]').forEach(x=>x.onclick=e=>{e.stopPropagation();state.multiSelected=[];state.selected={type:'cable',id:x.dataset.cable};renderAll();});}
function ensureFields(){$('projectName').value=state.projectName;$('rowCount').value=state.rows.length;$('defaultRacks').value=state.rows[0]?.rackCount??0;$('rackUnits').value=state.rackUnits;$('rackWidth').value=state.rackWidth;$('rackDepth').value=state.rackDepth;$('rackGap').value=state.rackGap;$('defaultRowGap').value=state.defaultRowGap;$('lastUToTray').value=state.lastUToTray;$('defaultSlack').value=state.defaultSlack;}
function renderAll(persist=true){ensureFields();buildRowsPanel();render();renderProperties();renderCables();updateStructureControls();if(persist)save();updateHistoryButtons();}

function clearRackMultiSelection(){ state.multiSelected=[]; if(state.selected?.type==='rack') state.selected=null; }
function svgLocalPoint(clientX,clientY){
  const stage=$('canvasStage');
  const rect=stage.getBoundingClientRect();
  const zoom=(window.__canvasPan&&Number.isFinite(window.__canvasPan.zoom))?window.__canvasPan.zoom:1;
  // getBoundingClientRect() already includes the current canvas translation and scroll.
  // Dividing by zoom converts the pointer back to the SVG/stage coordinate system.
  return {x:(clientX-rect.left)/zoom,y:(clientY-rect.top)/zoom};
}
function selectRacksInBox(b){
  // Use the rendered rack bodies in screen coordinates. This is deliberately
  // independent of the canvas zoom/pan transform, so Shift+drag keeps working
  // at any zoom level and after scrolling/panning.
  const x1=Math.min(b.clientX1,b.clientX2),x2=Math.max(b.clientX1,b.clientX2);
  const y1=Math.min(b.clientY1,b.clientY2),y2=Math.max(b.clientY1,b.clientY2);
  const ids=[];
  document.querySelectorAll('#layout .rack-body').forEach(el=>{
    const r=el.getBoundingClientRect();
    const cx=r.left+r.width/2, cy=r.top+r.height/2;
    if(cx>=x1&&cx<=x2&&cy>=y1&&cy<=y2){
      const g=el.closest('[data-rack]');
      if(g?.dataset.rack) ids.push(g.dataset.rack);
    }
  });
  state.multiSelected=[...new Set(ids)];
  state.selected=ids.length?{type:'rack',id:ids[ids.length-1]}:null;
}
function selectTraysInBox(b){
  const x1=Math.min(b.clientX1,b.clientX2),x2=Math.max(b.clientX1,b.clientX2);
  const y1=Math.min(b.clientY1,b.clientY2),y2=Math.max(b.clientY1,b.clientY2);
  const ids=[];
  document.querySelectorAll('#layout .tray-line[data-tray]').forEach(el=>{
    const r=el.getBoundingClientRect();
    const intersects=!(r.right<x1 || r.left>x2 || r.bottom<y1 || r.top>y2);
    if(intersects && el.dataset.tray) ids.push(el.dataset.tray);
  });
  state.multiSelected=[];
  state.trayMultiSelected=[...new Set(ids)];
  state.selected=ids.length?{type:'tray',id:ids[ids.length-1]}:null;
}

function deleteSelectedTrays(){
  if(structureBlocked())return;
  const ids=[...new Set(state.trayMultiSelected)].filter(id=>state.trays.some(t=>t.id===id));
  if(ids.length<2)return;
  if(!confirm(`Excluir ${ids.length} calhas selecionadas?`))return;
  const set=new Set(ids);
  state.trayLinks=state.trayLinks.filter(l=>!set.has(l.aTray)&&!set.has(l.bTray));
  state.trayRackLinks=state.trayRackLinks.filter(l=>!set.has(l.trayId));
  state.trays=state.trays.filter(t=>!set.has(t.id));
  state.trayMultiSelected=[];state.selected=null;
  normalizeState();renderAll();toast(`${ids.length} calhas excluídas`);
}

function deleteSelectedRacks(){
  if(structureBlocked())return;
  const ids=[...new Set(state.multiSelected)].filter(id=>state.racks.some(r=>r.id===id));
  if(ids.length<2)return;
  if(!confirm(`Excluir ${ids.length} racks selecionados?`))return;
  removeRackReferences(ids);
  state.racks=state.racks.filter(r=>!ids.includes(r.id));
  state.rows.forEach(row=>row.rackCount=racksInRow(row.id).length);
  state.multiSelected=[];state.selected=null;normalizeState();renderAll();toast(`${ids.length} racks excluídos`);
}

function setupPan(){
  const wrap=$('canvasWrap'), stage=$('canvasStage');
  if(!wrap||!stage)return;
  let drag=null, raf=0;
  if(!window.__canvasPan) window.__canvasPan={x:-VIEW_PAD+40,y:-VIEW_PAD+40,zoom:1};
  const p=window.__canvasPan;
  if(!Number.isFinite(p.zoom))p.zoom=1;
  const clampZoom=z=>Math.max(0.55,Math.min(2.5,z));
  const getBounds=()=>{
    const sw=Math.max(stage.offsetWidth*p.zoom,wrap.clientWidth);
    const sh=Math.max(stage.offsetHeight*p.zoom,wrap.clientHeight);
    return {
      minX:Math.min(0,wrap.clientWidth-sw-40), maxX:40,
      minY:Math.min(0,wrap.clientHeight-sh-40), maxY:40
    };
  };
  const apply=()=>{
    const b=getBounds();
    p.x=Math.max(b.minX,Math.min(b.maxX,p.x));
    p.y=Math.max(b.minY,Math.min(b.maxY,p.y));
    stage.style.transform=`translate3d(${p.x}px,${p.y}px,0) scale(${p.zoom})`;
    stage.style.transformOrigin='0 0';
  };
  const begin=(e)=>{
    if(e.button!==0 || e.target.closest('[data-rack]') || e.target.closest('[data-tray]'))return;
    const layout=document.getElementById('layout');
    const stageEl=document.getElementById('canvasStage');
    const onCanvasBackground=(e.target===wrap || e.target===stageEl || e.target===layout || !!e.target.closest?.('#layout'));
    if(e.shiftKey && onCanvasBackground){
      const isTraySelection=e.ctrlKey||e.metaKey;
      const start=svgLocalPoint(e.clientX,e.clientY);
      const box={x1:start.x,y1:start.y,x2:start.x,y2:start.y,clientX1:e.clientX,clientY1:e.clientY,clientX2:e.clientX,clientY2:e.clientY};
      if(isTraySelection){
        window.__traySelectionBox=box;
        window.__traySelectionDrag=true;
      }else{
        window.__rackSelectionBox=box;
        window.__rackSelectionDrag=true;
      }
      // Capture the pointer on the canvas so replacing the SVG during render()
      // cannot interrupt the selection gesture.
      try{wrap.setPointerCapture?.(e.pointerId);}catch(_){}
      const moveSelect=ev=>{
        const pt=svgLocalPoint(ev.clientX,ev.clientY);
        box.x2=pt.x;box.y2=pt.y;
        box.clientX2=ev.clientX;box.clientY2=ev.clientY;
        render();ev.preventDefault();
      };
      const stopSelect=ev=>{
        document.removeEventListener('pointermove',moveSelect);
        document.removeEventListener('pointerup',stopSelect);
        document.removeEventListener('pointercancel',stopSelect);
        try{wrap.releasePointerCapture?.(e.pointerId);}catch(_){}
        const area=Math.abs(box.clientX2-box.clientX1)*Math.abs(box.clientY2-box.clientY1);
        window.__rackSelectionBox=null;window.__rackSelectionDrag=false;
        window.__traySelectionBox=null;window.__traySelectionDrag=false;
        if(area>9){
          if(isTraySelection) selectTraysInBox(box);
          else selectRacksInBox(box);
        }else{
          state.multiSelected=[];state.trayMultiSelected=[];state.selected=null;
        }
        renderAll();
        ev?.preventDefault?.();
      };
      document.addEventListener('pointermove',moveSelect,{passive:false});
      document.addEventListener('pointerup',stopSelect,{once:true});
      document.addEventListener('pointercancel',stopSelect,{once:true});
      e.preventDefault();
      return;
    }
    drag={x:e.clientX,y:e.clientY,startX:p.x,startY:p.y};
    wrap.classList.add('panning');
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',stop,{once:true});
    window.addEventListener('pointercancel',stop,{once:true});
    e.preventDefault();
  };
  const move=(e)=>{
    if(!drag)return;
    p.x=drag.startX+(e.clientX-drag.x);
    p.y=drag.startY+(e.clientY-drag.y);
    if(raf)cancelAnimationFrame(raf);
    raf=requestAnimationFrame(apply);
    e.preventDefault();
  };
  const stop=()=>{
    if(!drag)return;
    if(raf)cancelAnimationFrame(raf);
    drag=null;
    wrap.classList.remove('panning');
    apply();
  };
  const zoomAt=(e)=>{
    if(e.ctrlKey)return;
    const rect=wrap.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const oldZoom=p.zoom;
    const factor=e.deltaY<0?1.12:0.89;
    const newZoom=clampZoom(oldZoom*factor);
    if(newZoom===oldZoom){e.preventDefault();return;}
    const localX=(mx-p.x)/oldZoom, localY=(my-p.y)/oldZoom;
    p.zoom=newZoom;
    p.x=mx-localX*newZoom;
    p.y=my-localY*newZoom;
    apply();
    e.preventDefault();
  };
  wrap.addEventListener('pointerdown',begin,{passive:false});
  wrap.addEventListener('wheel',zoomAt,{passive:false});
  window.__applyCanvasPan=apply;
  window.__zoomIn=()=>{const evt={clientX:wrap.clientWidth/2,clientY:wrap.clientHeight/2,deltaY:-1,ctrlKey:false,preventDefault(){}};zoomAt(evt);};
  requestAnimationFrame(apply);
}

async function newProject(){
  if(!confirm('Criar um novo projeto? O projeto atual continuará salvo na nuvem.'))return;
  await createNewCloudProject();
}

function bind(){
  load();renderAll(false);initHistory();setupPan();
  // Toggle da barra lateral: estado visual persistido localmente.
  const sidebarKey='dccp_sidebar_collapsed';
  const appShell=document.querySelector('.app');
  const sidebarToggle=$('sidebarToggle');
  const sidebarToggleIcon=$('sidebarToggleIcon');
  const setSidebarCollapsed=(collapsed,persist=true)=>{
    if(!appShell||!sidebarToggle)return;
    appShell.classList.toggle('sidebar-collapsed',!!collapsed);
    if(sidebarToggleIcon)sidebarToggleIcon.textContent=collapsed?'›':'‹';
    sidebarToggle.title=collapsed?'Expandir barra lateral':'Recolher barra lateral';
    sidebarToggle.setAttribute('aria-label',collapsed?'Expandir barra lateral':'Recolher barra lateral');
    if(persist)localStorage.setItem(sidebarKey,collapsed?'1':'0');
    requestAnimationFrame(()=>window.__applyCanvasPan&&window.__applyCanvasPan());
  };
  if(sidebarToggle){
    const savedSidebar=localStorage.getItem(sidebarKey)==='1';
    setSidebarCollapsed(savedSidebar,false);
    sidebarToggle.addEventListener('click',()=>setSidebarCollapsed(!appShell?.classList.contains('sidebar-collapsed')));
  }
  $('structureLock')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();setStructureLock(!isStructureLocked(),true);toast(isStructureLocked()?'Estrutura bloqueada':'Estrutura desbloqueada');});
  updateStructureControls();
  if($('btnProjects'))$('btnProjects').onclick=async()=>{
    if(cloudDirty){
      const wantsSave=confirm('Existem alterações não salvas na nuvem. Deseja salvar antes de voltar para Projetos?');
      if(wantsSave){ const ok=await saveProjectToCloud(true); if(!ok)return; }
      else { const leave=confirm('Voltar sem salvar pode deixar alterações apenas neste navegador. Deseja continuar?'); if(!leave)return; }
    }
    showDashboard();
  };

  requestAnimationFrame(()=>window.__applyCanvasPan&&window.__applyCanvasPan());
  $('btnBuildRows').onclick=rebuildStructureFromSettings;
  $('btnAddTray').onclick=()=>{ if(structureBlocked())return; const g=geometry(); const y=g.rows.length?g.rows[0].y-80:VIEW_PAD; createIndependentTray(g,g.x0,y,g.x0+Math.max(240,g.scale*3),y); };
  $('btnAddCable').onclick=addCable;$('btnImport').onclick=()=>$('excelInput').click();
  $('btnTemplate').onclick=downloadCableTemplate;
  $('btnExportCables').onclick=exportCablesXLSX;
  $('excelInput').onchange=e=>{const f=e.target.files[0];if(f)importCablesXLSX(f);e.target.value='';};
  $('btnTheme').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();localStorage.setItem(THEME_STORAGE,state.theme);toast(state.theme==='light'?'Tema claro':'Tema escuro');};
  $('btnUndo').onclick=undo; $('btnRedo').onclick=redo;
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}});
  $('btnSave').onclick=async()=>{ save(); await saveProjectToCloud(true); };
  $('autosaveToggle')?.addEventListener('change',e=>setAutosaveEnabled(e.target.checked));
  updateAutosaveUI();
  updatePlannerProjectName();
  setCloudStatus(cloudDirty?'pending':'saved');
  $('btnExport').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(state.projectName||'data-center')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('btnImportProject').onclick=()=>{if(structureBlocked())return;$('projectInput').click();};
  $('projectInput').onchange=e=>{const f=e.target.files[0];if(f&&!isStructureLocked())importProject(f);e.target.value='';};
  $('btnReset').onclick=newProject;
  $('renameApply').onclick=applyRenameRow;
  $('renameCancel').onclick=closeRenameRowModal;
  $('renameCancelTop').onclick=closeRenameRowModal;
  $('renamePrefix').oninput=updateRenamePreview;
  $('renameStart').oninput=updateRenamePreview;
  $('renamePad').oninput=updateRenamePreview;
  $('renameRowModal').addEventListener('click',e=>{if(e.target.id==='renameRowModal')closeRenameRowModal();});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('renameRowModal').classList.contains('open'))closeRenameRowModal();});
  window.addEventListener('resize',()=>{render();});
}
startAuth();
