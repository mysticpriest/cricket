'use strict';
const byId=id=>document.getElementById(id);
let lastKey='';
const announce=(id,text)=>{byId(id).textContent=text;};
async function api(path,opts={}){
  const response=await fetch(path,{credentials:'same-origin',...opts});
  const data=await response.json();
  if(response.status===401){location.replace('office.html');throw Error('Platform session expired');}
  if(!response.ok)throw Error(data.error||'Request failed');
  return data;
}
const payload=(method,data)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function make(tag,text){
  const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;
}
function parseRoutes(input){
  return input.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{
    const pos=line.indexOf('|');
    if(pos<0)throw Error('Write each route as: Route name | Instructions');
    return {name:line.slice(0,pos).trim(),instructions:line.slice(pos+1).trim()};
  });
}
function routesText(routes){return routes.map(r=>r.name+' | '+r.instructions).join('\n');}
async function displayOffices(){
  const {offices}=await api('/api/platform/offices');
  const list=byId('platformOfficeList');list.replaceChildren();
  for(const office of offices){
    const panel=make('article');panel.className='platform-office-card';
    const title=make('div');title.className='platform-office-title';
    title.append(make('strong',office.name));
    const status=make('small',office.active?'ACTIVE':'INACTIVE');title.append(status);
    const desc=make('div',office.workflowTemplate+' workflow · '+office.employees+' employees · '+office.cases+' saved cases · '+office.routes.length+' routes');
    desc.className='platform-office-meta';
    const actions=make('div');actions.className='platform-office-actions';
    const rotate=make('button','↻ Generate new key');rotate.type='button';
    rotate.addEventListener('click',async()=>{
      if(!confirm('Rotate Office Key for '+office.name+'? The old key will stop working immediately.'))return;
      try{
        const data=await api('/api/platform/offices/'+office.id+'/key',{method:'POST'});
        showKey(data.officeKey);announce('platformListStatus','Key rotated for '+office.name+'. Copy the new key now.');
      }catch(error){announce('platformListStatus',error.message);}
    });
    const activate=make('button',office.active?'Deactivate':'Activate');activate.type='button';
    activate.addEventListener('click',async()=>{
      if(!confirm((office.active?'Deactivate':'Activate')+' '+office.name+'?'))return;
      try{
        await api('/api/platform/offices/'+office.id+'/status',payload('PATCH',{active:!office.active}));
        await displayOffices();
      }catch(error){announce('platformListStatus',error.message);}
    });
    actions.append(rotate,activate);
    panel.append(title,desc,actions);
    if(office.workflowTemplate==='starter'){
      const editor=make('div');editor.className='platform-office-editor';
      const label=make('label','Starter routes (Name | Instructions)');const text=make('textarea');
      text.className='platform-office-edit';text.rows=3;text.value=routesText(office.routes);
      const save=make('button','Save routes');save.type='button';
      save.addEventListener('click',async()=>{
        try{
          save.disabled=true;
          await api('/api/platform/offices/'+office.id+'/routes',payload('PATCH',{routes:parseRoutes(text.value)}));
          announce('platformListStatus','Routes saved for '+office.name+'.');
          await displayOffices();
        }catch(error){announce('platformListStatus',error.message);}
        finally{save.disabled=false;}
      });
      editor.append(label,text,save);panel.append(editor);
    }
    list.append(panel);
  }
}
function showKey(key){
  lastKey=key;byId('platformNewKey').hidden=false;byId('platformKeyValue').textContent=key;
  byId('platformNewKey').scrollIntoView({block:'nearest',behavior:'smooth'});
}
byId('platformCreateForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=byId('platformCreateButton');button.disabled=true;
  try{
    const data=await api('/api/platform/offices',payload('POST',{
      name:byId('platformOfficeName').value.trim(),
      adminName:byId('platformAdminName').value.trim(),
      adminEmail:byId('platformAdminEmail').value.trim(),
      adminPassword:byId('platformAdminPassword').value,
      routes:parseRoutes(byId('platformRoutes').value)
    }));
    showKey(data.officeKey);announce('platformCreateStatus','Office created. Save the Office Key before leaving this page.');
    byId('platformCreateForm').reset();
    await displayOffices();
  }catch(error){announce('platformCreateStatus',error.message);}
  finally{button.disabled=false;}
});
byId('platformKeyCopy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(lastKey);byId('platformKeyCopy').textContent='Copied';}
  catch(_){byId('platformKeyCopy').textContent='Select and copy the key manually';}
});
byId('platformLogout').addEventListener('click',async()=>{
  await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
  sessionStorage.removeItem('cricket_tab_open');sessionStorage.removeItem('cricket_last_activity');
  location.replace('office.html');
});
(async()=>{
  try{
    const {user}=await api('/api/auth/me');
    if(user?.role!=='platform_admin'){location.replace('office.html');return;}
    await displayOffices();
  }catch(error){announce('platformListStatus',error.message);}
})();
