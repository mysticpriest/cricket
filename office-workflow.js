'use strict';
const byId=id=>document.getElementById(id);
let activeRoute=null;
async function init(){
  try{
    const res=await fetch('/api/office/workflow',{credentials:'same-origin'});
    if(res.status===401){location.replace('office.html');return;}
    if(!res.ok)throw Error('Office workflows are unavailable');
    const {office}=await res.json();
    if(office.workflowTemplate!=='starter'){location.replace('index.html');return;}
    byId('officeFlowName').textContent=office.name;
    byId('officeFlowTitle').textContent=office.name+' workflows';
    byId('officeRouteCount').textContent=office.routes.length+' routes';
    const list=byId('officeRoutes');
    list.replaceChildren();
    if(!office.routes.length){
      const p=document.createElement('p');p.textContent='No routes configured yet. Contact your Cricket platform administrator.';p.style.cssText='color:#64748b;font-size:12px;line-height:1.7';list.append(p);
      return;
    }
    for(const route of office.routes){
      const button=document.createElement('button');
      button.type='button';button.className='office-route-card';button.textContent=route.name;
      button.addEventListener('click',()=>{
        list.querySelectorAll('button').forEach(x=>x.classList.remove('active'));
        button.classList.add('active');
        activeRoute=route;
        byId('officeRouteTitle').textContent=route.name;
        byId('officeRouteInstructions').textContent=route.instructions;
        byId('officeRouteDraft').hidden=false;
        byId('officeDraftNote').value='';
        byId('officeDraftMessage').textContent='';
      });
      list.append(button);
    }
    list.firstElementChild?.click();
  }catch(error){byId('officeRouteInstructions').textContent=error.message;}
}
byId('officeCopyDraft').addEventListener('click',async()=>{
  if(!activeRoute)return;
  const note=activeRoute.name+'\n'+byId('officeDraftNote').value.trim();
  try{await navigator.clipboard.writeText(note);byId('officeDraftMessage').textContent='Draft copied. It has not been saved as a Cricket case.';}
  catch(_){byId('officeDraftMessage').textContent='Clipboard unavailable; select the text and copy it manually.';}
});
init();