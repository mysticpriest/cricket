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
const NORTHSTAR_DEMO=[
  {name:'Order Status Inquiry',instructions:'Confirm a fictional order reference, check the order stage and explain the next expected update.'},
  {name:'Refund Request',instructions:'Clarify the refund concern. Explain eligibility according to the client policy, without promising approval.'},
  {name:'Delivery Issue',instructions:'Check a fictional tracking reference, record the issue and explain supported escalation options.'},
  {name:'Product Exchange',instructions:'Confirm the item, exchange reason and permitted options under the organization’s policy.'},
  {name:'Billing Question',instructions:'Clarify the charge in question and explain authorized billing procedures.'},
  {name:'Supervisor Escalation',instructions:'Summarize prior actions and refer the issue when the escalation criteria are met.'}
];
byId('platformLoadDemo').addEventListener('click',()=>{
  byId('platformOfficeName').value='Northstar Support';
  byId('platformRoutes').value=routesText(NORTHSTAR_DEMO);
  byId('platformAdminName').focus();
  announce('platformCreateStatus','Northstar demo routes loaded. Supply an administrator name, email and password, then create the office.');
});
async function displayOffices(){
  const {offices}=await api('/api/platform/offices');
  // Aggregate counts only: platform administration never reads private cases.
  const summary={
    platformTotalClients:offices.length,
    platformActiveClients:offices.filter(office=>office.active).length,
    platformStaffTotal:offices.reduce((sum,office)=>sum+Number(office.employees||0),0),
    platformCasesTotal:offices.reduce((sum,office)=>sum+Number(office.cases||0),0)
  };
  for(const [id,value] of Object.entries(summary)){
    const node=byId(id);
    if(node)node.textContent=value.toLocaleString('en-US');
  }
  const list=byId('platformOfficeList');list.replaceChildren();
  for(const office of offices){
    const panel=make('article');panel.className='platform-office-card';panel.dataset.officeId=String(office.id);
    const title=make('div');title.className='platform-office-title';
    title.append(make('strong',office.name));
    const status=make('small',office.active?'Active':'Inactive');status.className=office.active?'platform-office-active':'platform-office-inactive';title.append(status);
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
    const manage=make('button','Modules & seats');manage.type='button';
    manage.setAttribute('aria-expanded','false');
    const modulePanel=make('section');modulePanel.className='platform-subscription';modulePanel.hidden=true;
    manage.addEventListener('click',async()=>{
      if(!modulePanel.hidden){modulePanel.hidden=true;manage.setAttribute('aria-expanded','false');return;}
      modulePanel.hidden=false;manage.setAttribute('aria-expanded','true');
      modulePanel.replaceChildren(make('p','Loading module subscriptions…'));
      try{
        const data=await api('/api/platform/offices/'+office.id+'/modules');
        renderModules(office,modulePanel,data);
      }catch(error){modulePanel.replaceChildren(make('p','Could not load modules: '+error.message));}
    });
    actions.append(rotate,activate,manage);
    panel.append(title,desc,actions,modulePanel);
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
    const brand=office.branding||{};
    const editBrand=make('div');editBrand.className='platform-office-editor platform-brand-editor';
    const brandTitle=make('strong','Client sign-in branding');brandTitle.className='platform-brand-title';
    const taglineLabel=make('label','Tagline');const tagline=make('input');
    tagline.className='platform-office-edit';tagline.maxLength=70;
    tagline.value=brand.tagline||'Operations Workspace';
    const colorLabel=make('label','Accent color');const color=make('input');
    color.type='color';color.className='platform-office-edit platform-color-picker';
    color.value=brand.color||'#2563eb';
    const welcomeLabel=make('label','Welcome message');const welcome=make('textarea');
    welcome.className='platform-office-edit';welcome.rows=2;welcome.maxLength=180;
    welcome.value=brand.welcome||'Welcome to your workspace.';
    const brandSave=make('button','Save client branding');brandSave.type='button';
    brandSave.addEventListener('click',async()=>{
      brandSave.disabled=true;
      try{
        await api('/api/platform/offices/'+office.id+'/branding',
          payload('PATCH',{tagline:tagline.value.trim(),color:color.value,welcome:welcome.value.trim()}));
        announce('platformListStatus','Branding updated for '+office.name+'.');
        await displayOffices();
      }catch(error){announce('platformListStatus',error.message);}
      finally{brandSave.disabled=false;}
    });
    editBrand.append(brandTitle,taglineLabel,tagline,colorLabel,color,welcomeLabel,welcome,brandSave);
    panel.append(editBrand);
    list.append(panel);
  }
}

function money(usd){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(usd);}
function renderModules(office,container,data){
  container.replaceChildren();
  const heading=make('h3','Module subscriptions');heading.className='platform-subscription-title';
  container.append(heading);
  const explanatory=make('p','Configure this office’s modules. Pricing is a draft preview; no payments are collected.');
  explanatory.className='platform-subscription-help';container.append(explanatory);
  const list=make('div');list.className='platform-module-list';
  for(const mod of data.modules){
    const item=make('label');item.className='platform-module-row';
    const check=make('input');check.type='checkbox';check.checked=mod.enabled;
    check.disabled=mod.status!=='available';
    check.setAttribute('aria-label',mod.name+' for '+office.name);
    const details=make('span');details.className='platform-module-detail';
    const label=make('strong',mod.name);
    const description=make('small',mod.description);
    const badge=make('small',mod.status==='planned'?'Coming soon':
      mod.status==='core'?'Core module':mod.priceUsd==null?'Pricing TBD':
      money(mod.priceUsd)+' / month');
    badge.className='platform-module-price';
    details.append(label,description);
    item.append(check,details,badge);
    list.append(item);
    if(mod.status==='available'){
      check.addEventListener('change',async()=>{
        check.disabled=true;
        try{
          const updated=await api('/api/platform/offices/'+office.id+'/modules/'+mod.key,
            payload('PATCH',{enabled:check.checked}));
          renderModules(office,container,updated);
          announce('platformListStatus',mod.name+(check.checked?' enabled':' disabled')+' for '+office.name+'.');
        }catch(error){
          check.checked=!check.checked;check.disabled=false;
          announce('platformListStatus',error.message);
        }
      });
    }
  }
  container.append(list);
  const seatRow=make('div');seatRow.className='platform-seat-row';
  const limits=make('div');limits.className='platform-seat-info';
  limits.append(make('strong','Staff account limit'),
    make('small',data.seats.used+' accounts currently used · core access'));
  const control=make('input');control.type='number';control.min='1';control.max='100000';
  control.placeholder='Unlimited';control.value=data.seats.limit??'';
  control.setAttribute('aria-label','Staff seat limit for '+office.name);
  const save=make('button','Save limit');save.type='button';
  save.addEventListener('click',async()=>{
    save.disabled=true;
    const raw=control.value.trim(),limit=raw===''?null:Number(raw);
    try{
      const updated=await api('/api/platform/offices/'+office.id+'/seats',payload('PATCH',{limit}));
      renderModules(office,container,updated);
      announce('platformListStatus','Seat limit saved for '+office.name+'.');
    }catch(error){announce('platformListStatus',error.message);save.disabled=false;}
  });
  seatRow.append(limits,control,save);
  const helper=make('small','Leave empty for unlimited during the current preview. The existing accounts are never removed when a limit changes.');
  helper.className='platform-subscription-help';
  container.append(seatRow,helper);
  const total=make('p',
    'Draft known-price subtotal: '+money(data.pricing.knownSubtotalUsd)+'/month'
    +(data.pricing.unpricedModules.length?' · Additional module prices TBD':''));
  total.className='platform-price-total';container.append(total);
  const warning=make('p','PREVIEW ONLY · Not an invoice or an active paid subscription.');
  warning.className='platform-subscription-disclaimer';container.append(warning);
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
