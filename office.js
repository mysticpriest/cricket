'use strict';
const keyForm=document.querySelector('#officeKeyForm');
const keyInput=document.querySelector('#officeKey');
const message=document.querySelector('#officeKeyMessage');
const submit=document.querySelector('#officeKeySubmit');
const next=new URLSearchParams(location.search).get('next');
const allowed=new Set(['index.html','inbound.html','outbound.html','qc.html','analytics.html','staff.html','cases.html','operations.html','office-workflow.html']);
const dest=allowed.has(next)?next:'index.html';
document.querySelector('#officeToggle').addEventListener('click',()=>{
  const show=keyInput.type==='password';keyInput.type=show?'text':'password';
  document.querySelector('#officeToggle').textContent=show?'Hide':'Show';
});
keyForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const key=keyInput.value.trim();
  if(key.length<16){message.textContent='Enter the Office Key issued by your organization.';return;}
  submit.disabled=true;submit.textContent='Verifying Office Key…';message.textContent='';
  try{
    // Switching offices always ends any existing employee or platform session.
    await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});
    const response=await fetch('/api/office/resolve',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({officeKey:key})
    });
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Office Key was not accepted');
    try{sessionStorage.removeItem('cricket_tab_open');sessionStorage.removeItem('cricket_last_activity');}catch(_){}
    keyInput.value='';
    location.replace('login.html?next='+encodeURIComponent(dest));
  }catch(error){
    message.textContent=error.message==='Failed to fetch'?'Unable to reach the Cricket server.':error.message;
    submit.disabled=false;submit.textContent='Continue to sign in →';
  }
});