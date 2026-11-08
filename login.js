'use strict';
const form=document.querySelector('#loginForm');
const message=document.querySelector('#loginMessage');
const submit=document.querySelector('#loginButton');
const emailInput=document.querySelector('#email');
const passwordInput=document.querySelector('#password');
const nextAllowed={
  'index.html':['agent','qc','admin'],
  'inbound.html':['agent','admin'],
  'outbound.html':['agent','admin'],
  'cases.html':['admin'],
  'qc.html':['qc','admin'],
  'staff.html':['admin'],
  'operations.html':['admin'],
  'analytics.html':['agent','qc','admin'],
  'office-workflow.html':['agent','admin']
};
const requested=new URLSearchParams(location.search).get('next');
const destination=Object.hasOwn(nextAllowed,requested)?requested:'index.html';
async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options});
  let data={};
  try{data=await response.json();}
  catch(_){throw Error('Cricket backend is unavailable.');}
  if(!response.ok)throw Error(data.error||'Sign-in failed.');
  return data;
}
function applyClientBrand(result){
  const office=result.office||{};
  const branding=office.branding||{};
  const platform=result.scope==='platform';
  const name=platform?'Cricket Platform':office.name||'Your office';
  const color=/^#[0-9a-f]{6}$/i.test(branding.color||'')?branding.color:'#24679f';
  document.body.style.setProperty('--client-accent',color);
  document.querySelector('#officeLoginName').textContent=name;
  document.querySelector('#officeLoginLabel').textContent=platform?'PLATFORM ADMINISTRATION':'EMPLOYEE ACCESS';
  document.querySelector('#clientBrandName').textContent=name;
  document.querySelector('#clientBrandTagline').textContent=platform?'Platform Operations':branding.tagline||'Operations Workspace';
  document.querySelector('#clientBrandWelcome').textContent=platform
    ?'Manage client offices, keys, and workflow configuration.'
    :branding.welcome||'The right tools for your team, all in one place.';
  document.querySelector('#clientBrandFoot').textContent=platform?'CRICKET ADMINISTRATOR':name.toUpperCase();
  const image=document.querySelector('#clientBrandImage');
  const mark=document.querySelector('#clientBrandMark');
  if(branding.logoUrl==='/assets/neutrauma-logo.webp'&&!platform){
    image.src=branding.logoUrl;
    image.alt=name+' logo';
    image.hidden=false;
    mark.hidden=true;
  }else{
    image.hidden=true;
    mark.hidden=false;
    mark.textContent=platform?'C':name.trim().slice(0,1).toUpperCase();
  }
  document.title='Cricket | '+name+' Sign In';
}
function goToAuthorizedDestination(user){
  if(!user||!user.role)throw Error('Employee account could not be verified.');
  if(user.role==='platform_admin'){location.replace('platform.html');return;}
  const safe=nextAllowed[destination].includes(user.role)?destination:'index.html';
  location.replace(user.office?.workflowTemplate==='starter'&&safe==='inbound.html'
    ?'office-workflow.html':safe);
}
document.querySelector('#togglePassword').addEventListener('click',event=>{
  const show=passwordInput.type==='password';
  passwordInput.type=show?'text':'password';
  event.currentTarget.textContent=show?'Hide':'Show';
  event.currentTarget.setAttribute('aria-label',show?'Hide password':'Show password');
});
const TAB_KEY='cricket_tab_open';
const ACTIVITY_KEY='cricket_last_activity';
const sessionInitialization=(async()=>{
  try{
    const {user}=await api('/api/auth/me');
    if(!user){
      const response=await fetch('/api/office/selection',{credentials:'same-origin'});
      if(!response.ok){location.replace('office.html?next='+encodeURIComponent(destination));return;}
      const selection=await response.json();
      applyClientBrand(selection);
      return;
    }
    const tabActive=sessionStorage.getItem(TAB_KEY)==='1';
    const previous=Number(sessionStorage.getItem(ACTIVITY_KEY))||0;
    if(tabActive&&previous>0&&Date.now()-previous<20*60*1000){
      goToAuthorizedDestination(user);return;
    }
    sessionStorage.removeItem(TAB_KEY);
    sessionStorage.removeItem(ACTIVITY_KEY);
    await api('/api/auth/logout',{method:'POST'});
    location.replace('office.html?next='+encodeURIComponent(destination));
  }catch(_){
    message.textContent='Cannot reach Cricket. Confirm the server is running.';
  }
})();
form.addEventListener('submit',async event=>{
  event.preventDefault();
  await sessionInitialization;
  message.textContent='';
  if(!emailInput.validity.valid||!passwordInput.value){
    message.textContent='Enter a valid work email and password.';return;
  }
  submit.disabled=true;submit.textContent='Signing in…';
  try{
    const {user}=await api('/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:emailInput.value.trim(),password:passwordInput.value})
    });
    sessionStorage.setItem(TAB_KEY,'1');
    sessionStorage.setItem(ACTIVITY_KEY,String(Date.now()));
    goToAuthorizedDestination(user);
  }catch(error){
    message.textContent=error.message==='Failed to fetch'?'Cannot reach the Cricket server.':error.message;
    submit.disabled=false;submit.innerHTML='Sign in <span aria-hidden="true">→</span>';
  }
});