'use strict';
const form=document.querySelector('#staffForm');
const list=document.querySelector('#staffList');
const message=document.querySelector('#staffMessage');
const create=document.querySelector('#createStaff');
async function request(url,options={}) {
 const response=await fetch(url,{credentials:'same-origin',...options});
 let data;try{data=await response.json()}catch(_){throw Error('Cricket backend unavailable')}
 if(response.status===401){location.replace('login.html?next=qc.html');throw Error('Sign in required')}
 if(!response.ok)throw Error(data.error||'Request failed');return data;
}
async function reload(){
 const {users}=await request('/api/users');
 list.replaceChildren();
 users.forEach(u=>{
  const row=document.createElement('div');row.style.cssText='padding:13px 0;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:10px;';
  const email=document.createElement('span');email.textContent=u.email;email.style.cssText='font-size:12px;overflow-wrap:anywhere;';
  const role=document.createElement('strong');role.textContent=u.role.toUpperCase();role.style.cssText='color:#2563eb;font-size:10px;';
  row.append(email,role);list.append(row);
 });
}
form.addEventListener('submit',async event=>{
 event.preventDefault();create.disabled=true;message.textContent='';
 try{
  await request('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.querySelector('#newEmail').value,password:document.querySelector('#newPassword').value,role:document.querySelector('#newRole').value})});
  form.reset(); message.style.color='#166534'; message.textContent='Account created successfully.';await reload();
 }catch(error){message.style.color='#b91c1c';message.textContent=error.message;}
 finally{create.disabled=false;}
});
(async()=>{try{const {user}=await request('/api/auth/me');if(!user){location.replace('login.html?next=qc.html');return;}if(user.role!=='admin'){list.textContent='Administrator access required.';form.hidden=true;return;}await reload();}catch(error){list.textContent=error.message;}})();
