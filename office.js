'use strict';
const keyForm=document.querySelector('#officeKeyForm');
const keyInput=document.querySelector('#officeKey');
const message=document.querySelector('#officeKeyMessage');
const submit=document.querySelector('#officeKeySubmit');
const next=new URLSearchParams(location.search).get('next');
const allowed=new Set(['index.html','inbound.html','outbound.html','qc.html','analytics.html','staff.html','cases.html','operations.html','office-workflow.html']);
const dest=allowed.has(next)?next:'index.html';
const brandColor=color=>/^#[0-9a-f]{6}$/i.test(color||'')?color:'#215d90';
document.querySelector('#officeToggle').addEventListener('click',()=>{
  const show=keyInput.type==='password';keyInput.type=show?'text':'password';
  document.querySelector('#officeToggle').textContent=show?'Hide':'Show';
});
function showOfficeHandoff(result){
  const office=result.office||{};
  const brand=office.branding||{};
  const name=result.scope==='platform'?'Cricket Platform':office.name||'Your office';
  const overlay=document.querySelector('#officeHandoff');
  document.querySelector('#handoffOfficeName').textContent=name;
  document.querySelector('#handoffTagline').textContent=brand.tagline||'Preparing your workspace';
  overlay.style.setProperty('--handoff-color',brandColor(brand.color));
  const logo=document.querySelector('#handoffLogo');
  const monogram=document.querySelector('#handoffMonogram');
  if(brand.logoUrl==='/assets/neutrauma-logo.webp'){
    logo.src=brand.logoUrl;logo.alt=name+' logo';logo.hidden=false;monogram.hidden=true;
  }else{
    logo.hidden=true;monogram.hidden=false;monogram.textContent=name.trim().slice(0,1).toUpperCase();
  }
  overlay.hidden=false;
  requestAnimationFrame(()=>overlay.classList.add('is-visible'));
}
keyForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const key=keyInput.value.trim();
  if(key.length<16){message.textContent='Enter the office key issued by your organization.';return;}
  submit.disabled=true;submit.textContent='Checking key…';message.textContent='';
  try{
    // A new office selection always ends the previous employee/platform session.
    await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
    const response=await fetch('/api/office/resolve',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({officeKey:key})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Office key was not accepted');
    try{sessionStorage.removeItem('cricket_tab_open');sessionStorage.removeItem('cricket_last_activity');}catch(_){}
    keyInput.value='';
    showOfficeHandoff(result);
    const delay=window.matchMedia('(prefers-reduced-motion: reduce)').matches?120:1250;
    window.setTimeout(()=>location.replace('login.html?next='+encodeURIComponent(dest)),delay);
  }catch(error){
    message.textContent=error.message==='Failed to fetch'?'Cannot reach the Cricket server.':error.message;
    submit.disabled=false;submit.innerHTML='Continue <span aria-hidden="true">→</span>';
  }
});