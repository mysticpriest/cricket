'use strict';
const op={
  online:document.querySelector('#opsOnline'),routes:document.querySelector('#opsRoutes'),
  audits:document.querySelector('#opsAudits'),people:document.querySelector('#opsPeople'),
  updated:document.querySelector('#opsLastUpdated'),list:document.querySelector('#opsAuditList'),
  form:document.querySelector('#opsAuditForm'),actor:document.querySelector('#opsActor'),
  scope:document.querySelector('#opsScope'),info:document.querySelector('#opsAuditInfo'),
  prev:document.querySelector('#opsAuditPrev'),next:document.querySelector('#opsAuditNext'),
  page:document.querySelector('#opsAuditPage'),refresh:document.querySelector('#opsRefresh')
};
const routes={appointment:'Appointment Inquiry',clinic:'Clinic Information',scheduling:'Scheduling Inquiry'};
const stages={idle:'Available',intake:'Call intake',selecting:'Selecting inquiry',working:'On workflow',
  verification:'Verifying caller',documentation:'Writing documentation',completed:'Route completed'};
const actions={
  signed_in:'Signed in',signed_out:'Signed out',workspace_opened:'Opened workspace',
  route_started:'Started route',route_left:'Left route',route_progress:'Moved through route',
  case_created:'Documented a case',review_submitted:'Submitted QC review',
  case_removed:'Removed a case',case_restored:'Restored a case',
  case_exported:'Exported a case',cases_exported:'Exported QC cases',
  work_later_saved:'Saved case for later',work_later_removed:'Removed saved case',
  staff_created:'Created employee account',staff_name_updated:'Updated employee name'
};
const state={offset:0,limit:50,total:0,actorId:'',scope:'day',people:[],skew:0,loaded:false};
function n(tag,cls,text){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined)e.textContent=String(text);
  return e;
}
async function api(path){
  const response=await fetch(path,{credentials:'same-origin'});
  let data={};
  try{data=await response.json();}catch(_){throw Error('Server response unavailable');}
  if(response.status===401){location.replace('login.html?next=operations.html');throw Error('Session expired');}
  if(response.status===403){location.replace('index.html');throw Error('Administrator access required');}
  if(!response.ok)throw Error(data.error||'Unable to retrieve operations data');
  return data;
}
function dateString(value){
  const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString();
}
function timeSince(timestamp) {
  if(!timestamp)return '—';
  const seconds=Math.max(0,Math.floor((Date.now()-state.skew-Number(timestamp))/1000));
  const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return h? h+'h '+String(m).padStart(2,'0')+'m '+String(s).padStart(2,'0')+'s'
    :String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function prettyStep(step){
  if(!step)return '—';
  if(step==='__verification__')return 'Patient verification';
  return step.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ')
    .replace(/\b\w/g,x=>x.toUpperCase());
}
function fact(label,value,timer){
  const root=n('div','ops-fact');
  root.append(n('label','',label));
  const strong=n('strong',timer?'ops-timer':'',value);
  if(timer)strong.dataset.routeStarted=String(timer);
  root.append(strong);return root;
}
function drawPeople(){
  op.people.replaceChildren();
  op.online.textContent=String(state.people.length);
  op.routes.textContent=String(state.people.filter(x=>x.role==='agent'&&x.route).length);
  if(!state.people.length){
    op.people.append(n('p','ops-empty','No employees are currently reporting from Cricket. Sign in on another device to begin a live test.'));
    return;
  }
  for(const person of state.people){
    const panel=n('article','ops-person');
    const head=n('div','ops-person-head');
    const avatar=n('div','ops-avatar',(person.displayName||'E').slice(0,1).toUpperCase());
    const employee=n('div','ops-employee');
    employee.append(n('strong','',person.displayName||person.email),n('span','',person.email));
    head.append(avatar,employee,n('span','ops-role',person.role));
    const grid=n('div','ops-person-body');
    grid.append(
      fact('Workspace',person.division==='inbound'?'Inbound':prettyStep(person.division)),
      fact('Current route',person.route?routes[person.route]||prettyStep(person.route):'No active route'),
      fact('Current step',person.step?prettyStep(person.step):stages[person.stage]||'Available'),
      fact('Time on route',person.routeStartedAt?timeSince(person.routeStartedAt):'—',person.routeStartedAt),
      fact('Stage',stages[person.stage]||'Working'),
      fact('Last seen',timeSince(person.lastSeenAt)+' ago')
    );
    panel.append(head,grid);
    op.people.append(panel);
  }
}
function drawAudit(data){
  state.total=data.total;
  op.audits.textContent=String(data.total);
  op.list.replaceChildren();
  if(!data.events.length)op.list.append(n('p','ops-empty','No actions match this employee and time period.'));
  for(const event of data.events){
    const item=n('article','ops-audit-item');
    const symbol=n('span','ops-audit-icon',event.action.includes('route')?'↗'
      :event.action.includes('case')?'▤':event.action.includes('sign')?'↪':'✓');
    const main=n('div','ops-audit-main');
    const who=event.actorName||event.actorEmail;
    main.append(n('strong','',who+' · '+(actions[event.action]||prettyStep(event.action))));
    const detail=[event.details,event.caseId].filter(Boolean).join(' · ');
    if(detail)main.append(n('span','',detail));
    main.append(n('span','',event.actorEmail+' · '+event.actorRole.toUpperCase()));
    const when=n('time','ops-audit-time',dateString(event.createdAt));
    item.append(symbol,main,when);
    op.list.append(item);
  }
  const count=data.events.length;
  op.info.textContent=count?('Showing '+(state.offset+1)+'–'+(state.offset+count)+' of '+data.total+' events'):'No events';
  op.page.textContent='Page '+(Math.floor(state.offset/state.limit)+1);
  op.prev.disabled=state.offset===0;
  op.next.disabled=state.offset+count>=data.total;
}
async function refreshPeople(){
  if(document.hidden)return;
  try{
    const data=await api('/api/admin/operations');
    state.people=data.people;
    state.skew=Date.now()-Number(data.serverTime);
    drawPeople();
    op.updated.textContent='Updated '+new Date().toLocaleTimeString();
  }catch(error){op.updated.textContent=error.message;}
}
async function refreshAudit(){
  if(document.hidden)return;
  const params=new URLSearchParams({scope:state.scope,limit:String(state.limit),offset:String(state.offset)});
  if(state.actorId)params.set('actorId',state.actorId);
  try{drawAudit(await api('/api/admin/audit?'+params));}
  catch(error){op.info.textContent=error.message;}
}
function chooseFilter(){
  state.actorId=op.actor.value;
  state.scope=op.scope.value;
  state.offset=0;
  refreshAudit();
}
op.actor.addEventListener('change',()=>{
  op.scope.querySelector('[value="shift"]').disabled=!op.actor.value;
  if(!op.actor.value&&op.scope.value==='shift')op.scope.value='day';
  chooseFilter();
});
op.scope.addEventListener('change',chooseFilter);
op.form.addEventListener('submit',event=>{event.preventDefault();chooseFilter();});
op.prev.addEventListener('click',()=>{if(state.offset>=state.limit){state.offset-=state.limit;refreshAudit();}});
op.next.addEventListener('click',()=>{if(state.offset+state.limit<state.total){state.offset+=state.limit;refreshAudit();}});
op.refresh.addEventListener('click',()=>Promise.all([refreshPeople(),refreshAudit()]));
setInterval(()=>{
  for(const element of document.querySelectorAll('[data-route-started]'))
    element.textContent=timeSince(element.dataset.routeStarted);
},1000);
setInterval(()=>{refreshPeople();refreshAudit();},4000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshPeople();refreshAudit();}});
(async()=>{
  try{
    const {user}=await api('/api/auth/me');
    if(!user||user.role!=='admin'){location.replace('index.html');return;}
    const {users}=await api('/api/users');
    for(const user of users){
      const option=n('option','',user.displayName||user.email);
      option.value=String(user.id);op.actor.append(option);
    }
    await Promise.all([refreshPeople(),refreshAudit()]);
    state.loaded=true;
  }catch(error){op.info.textContent=error.message;op.updated.textContent='Unable to connect';}
})();
