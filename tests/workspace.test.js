'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const NKEY='NEUTRAUMA-PRIVATE-DESK-TEST-2026';
const PKEY='PLATFORM-PRIVATE-DESK-TEST-2026';
function json(method,body,cookie){
  return {method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify(body)};
}
async function req(url,pathname,options={}){
  const response=await fetch(url+pathname,options);
  let data={};try{data=await response.json();}catch(_){}
  return {status:response.status,data,headers:response.headers};
}
const cookie=response=>response.headers.get('set-cookie').split(';')[0];
const auth=cookie=>({Cookie:cookie});
async function port(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
    server.on('error',reject);
  });
}
async function wait(url,child){
  for(let i=0;i<65;i++){
    if(child.exitCode!==null)throw Error('Cricket server exited');
    try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,65));
  }
  throw Error('Cricket server not ready');
}
async function login(url,officeKey,email,password){
  const result=await req(url,'/api/auth/login',json('POST',{officeKey,email,password}));
  assert.equal(result.status,200,JSON.stringify(result.data));
  return {user:result.data.user,cookie:cookie(result)};
}
async function staff(url,admin,email,name,role='agent'){
  const result=await req(url,'/api/users',json('POST',{
    email,displayName:name,role,password:'employee-very-secure-pass'
  },admin));
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.data.user;
}
test('Private employee desk persists, shift clock is auditable, admin sees live statuses, offices stay isolated',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-personal-'));
  const p=await port(),url='http://127.0.0.1:'+p;
  const child=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT,env:{...process.env,HOST:'127.0.0.1',PORT:String(p),CRICKET_DATA_DIR:dir,
      CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
      CRICKET_ADMIN_EMAIL:'neu-admin@example.test',CRICKET_ADMIN_PASSWORD:'neu-admin-secure-password',
      CRICKET_PLATFORM_ADMIN_EMAIL:'platform-owner@example.test',
      CRICKET_PLATFORM_ADMIN_PASSWORD:'platform-owner-secure-pass',CRICKET_PLATFORM_OFFICE_KEY:PKEY
    },stdio:['ignore','pipe','pipe']
  });
  let stderr='';child.stderr.on('data',x=>stderr+=String(x));
  try{
    await wait(url,child);
    const admin=await login(url,NKEY,'neu-admin@example.test','neu-admin-secure-password');
    const owner=await login(url,PKEY,'platform-owner@example.test','platform-owner-secure-pass');
    const created=await staff(url,admin.cookie,'neu-agent@example.test','Neu Agent');
    const otherCreated=await staff(url,admin.cookie,'neu-other@example.test','Other Agent');
    const agent=await login(url,NKEY,'neu-agent@example.test','employee-very-secure-pass');
    const other=await login(url,NKEY,'neu-other@example.test','employee-very-secure-pass');

    const initial=await req(url,'/api/workspace/me',{headers:auth(agent.cookie)});
    assert.equal(initial.status,200);
    assert.equal(initial.data.notes.length,0);
    assert.equal(initial.data.reminders.length,0);
    assert.equal(initial.data.shift,null);
    assert.equal(initial.data.layout.widgets.length,8);
    assert.equal(initial.data.layout.nav.length,8);

    const layout=initial.data.layout;
    layout.widgets.reverse();
    layout.widgets[0].size='compact';
    layout.widgets[0].color='rose';
    layout.widgets[0].hidden=true;
    layout.nav.reverse();
    layout.nav[0].color='teal';
    layout.nav[0].hidden=true;
    const saved=await req(url,'/api/workspace/layout',json('PUT',layout,agent.cookie));
    assert.equal(saved.status,200);
    assert.equal(saved.data.layout.widgets[0].color,'rose');
    const wrongColor=JSON.parse(JSON.stringify(layout));
    wrongColor.widgets[0].color='url(javascript:alert(1))';
    assert.equal((await req(url,'/api/workspace/layout',json('PUT',wrongColor,agent.cookie))).status,400);
    const wrongWidget=JSON.parse(JSON.stringify(layout));
    wrongWidget.widgets[0].id='staff-private';
    assert.equal((await req(url,'/api/workspace/layout',json('PUT',wrongWidget,agent.cookie))).status,400);
    const hideOverview=JSON.parse(JSON.stringify(layout));
    hideOverview.nav.find(x=>x.id==='overview').hidden=true;
    const keepOverview=await req(url,'/api/workspace/layout',json('PUT',hideOverview,agent.cookie));
    assert.equal(keepOverview.status,200);
    assert.equal(keepOverview.data.layout.nav.find(x=>x.id==='overview').hidden,false);

    // Each employee keeps their own personal notes even within one office.
    const note=await req(url,'/api/workspace/notes',json('POST',{
      title:'My personal checklist',body:'Fictional demo follow-up tasks only.',
      color:'orange',pinned:true
    },agent.cookie));
    assert.equal(note.status,201);
    const noteId=note.data.notes[0].id;
    assert.equal(note.data.notes[0].pinned,true);
    assert.equal((await req(url,'/api/workspace/notes/'+noteId,
      json('PATCH',{title:'Not allowed',body:'',color:'blue',pinned:false},other.cookie))).status,404);
    const updatedNote=await req(url,'/api/workspace/notes/'+noteId,json('PATCH',{
      title:'Edited checklist',body:'Still private to this employee.',color:'violet',pinned:false
    },agent.cookie));
    assert.equal(updatedNote.status,200);
    assert.equal(updatedNote.data.notes[0].title,'Edited checklist');

    const when=new Date(Date.now()+3600000).toISOString();
    const reminder=await req(url,'/api/workspace/reminders',json('POST',{
      title:'Review example workflows',body:'No real caller information.',dueAt:when,done:false
    },agent.cookie));
    assert.equal(reminder.status,201);
    const reminderId=reminder.data.reminders[0].id;
    assert.equal((await req(url,'/api/workspace/reminders/'+reminderId,
      json('PATCH',{title:'No',body:'',dueAt:null,done:true},other.cookie))).status,404);
    const done=await req(url,'/api/workspace/reminders/'+reminderId,json('PATCH',{
      title:'Review example workflows',body:'No real caller information.',dueAt:when,done:true
    },agent.cookie));
    assert.equal(done.status,200);
    assert.equal(done.data.reminders[0].done,true);

    const secondLogin=await login(url,NKEY,'neu-agent@example.test','employee-very-secure-pass');
    const persisted=await req(url,'/api/workspace/me',{headers:auth(secondLogin.cookie)});
    assert.equal(persisted.data.layout.widgets[0].color,'rose');
    assert.equal(persisted.data.layout.nav[0].color,'teal');
    assert.equal(persisted.data.notes[0].title,'Edited checklist');
    assert.equal(persisted.data.reminders[0].done,true);
    const otherDesk=await req(url,'/api/workspace/me',{headers:auth(other.cookie)});
    assert.equal(otherDesk.data.notes.length,0);
    assert.equal(otherDesk.data.reminders.length,0);
    assert.equal(otherDesk.data.layout.widgets[0].id,'metrics');

    // The nine-dot drag handle on individual sticky notes persists order
    // on the server. Another employee cannot reorder someone else's notes.
    const secondNote=await req(url,'/api/workspace/notes',json('POST',{
      title:'Another demo note',body:'Separate fictional sticky note',color:'teal',pinned:false
    },agent.cookie));
    assert.equal(secondNote.status,201);
    const secondNoteId=secondNote.data.notes.find(n=>n.title==='Another demo note').id;
    const order=await req(url,'/api/workspace/notes/order',json('PUT',{
      ids:[secondNoteId,noteId]
    },agent.cookie));
    assert.equal(order.status,200);
    assert.deepEqual(order.data.notes.map(n=>n.id),[secondNoteId,noteId]);
    assert.equal((await req(url,'/api/workspace/notes/order',json('PUT',{
      ids:[secondNoteId,noteId]
    },other.cookie))).status,400);
    const savedOrder=await req(url,'/api/workspace/me',{headers:auth(secondLogin.cookie)});
    assert.deepEqual(savedOrder.data.notes.map(n=>n.id),[secondNoteId,noteId]);

    assert.equal((await req(url,'/api/workspace/shift',json('POST',{action:'break'},agent.cookie))).status,409);
    const actions=['start_shift','break','meeting','system_issues','start_shift','end_shift'];
    for(const action of actions){
      const changed=await req(url,'/api/workspace/shift',json('POST',{action},agent.cookie));
      assert.equal(changed.status,200,action+': '+JSON.stringify(changed.data));
    }
    const afterEnd=await req(url,'/api/workspace/me',{headers:auth(agent.cookie)});
    assert.equal(afterEnd.data.shift.status,'ended');
    assert.ok(afterEnd.data.shift.endedAt>=afterEnd.data.shift.startedAt);
    assert.equal((await req(url,'/api/workspace/shift',json('POST',{action:'meeting'},agent.cookie))).status,409);

    const clock=await req(url,'/api/admin/shifts',{headers:auth(admin.cookie)});
    assert.equal(clock.status,200);
    const employee=clock.data.people.find(x=>x.id===created.id);
    assert.equal(employee.status,'ended');
    assert.equal(employee.active,false);
    assert.equal(clock.data.summary.ended,1);
    assert.ok(clock.data.history.filter(e=>e.userId===created.id).length>=6);
    assert.deepEqual(clock.data.history.filter(e=>e.userId===created.id).slice(0,6)
      .map(e=>e.action),actions.slice().reverse());
    assert.ok(!JSON.stringify(clock.data).includes('Edited checklist'),'Admin clock view must not show private notes');
    assert.equal((await req(url,'/api/admin/shifts',{headers:auth(agent.cookie)})).status,403);
    assert.equal((await req(url,'/api/workspace/me',{headers:auth(owner.cookie)})).status,403);
    assert.equal((await req(url,'/api/admin/shifts',{headers:auth(owner.cookie)})).status,403);

    const resumed=await req(url,'/api/workspace/shift',json('POST',{action:'start_shift'},agent.cookie));
    assert.equal(resumed.status,200);
    assert.notEqual(resumed.data.shift.id,afterEnd.data.shift.id);
    assert.equal(resumed.data.shift.status,'working');

    // Second office has different staff, notes, clocks and no access to this user's records.
    const createdOffice=await req(url,'/api/platform/offices',json('POST',{
      name:'Second Client',adminName:'Second Admin',adminEmail:'second-admin@example.test',
      adminPassword:'second-client-secure-pass',routes:[{
        name:'Customer Support',instructions:'Handle fictional customer support inquiries.'
      }]
    },owner.cookie));
    assert.equal(createdOffice.status,201,JSON.stringify(createdOffice.data));
    const b=await login(url,createdOffice.data.officeKey,'second-admin@example.test','second-client-secure-pass');
    const shiftB=await req(url,'/api/admin/shifts',{headers:auth(b.cookie)});
    assert.equal(shiftB.status,200);
    assert.equal(shiftB.data.people.length,1);
    assert.equal(shiftB.data.people[0].email,'second-admin@example.test');
    assert.equal(shiftB.data.history.length,0);
    assert.ok(!JSON.stringify(shiftB.data).includes('neu-agent'));
    const deskB=await req(url,'/api/workspace/me',{headers:auth(b.cookie)});
    assert.equal(deskB.data.notes.length,0);
    assert.equal(deskB.data.reminders.length,0);
    assert.equal((await req(url,'/api/workspace/notes/'+noteId,{method:'DELETE',headers:auth(b.cookie)})).status,404);
    assert.equal((await req(url,'/api/workspace/reminders/'+reminderId,{method:'DELETE',headers:auth(b.cookie)})).status,404);

    const removeNote=await req(url,'/api/workspace/notes/'+noteId,{method:'DELETE',headers:auth(agent.cookie)});
    const removeSecondNote=await req(url,'/api/workspace/notes/'+secondNoteId,
      {method:'DELETE',headers:auth(agent.cookie)});
    const removeReminder=await req(url,'/api/workspace/reminders/'+reminderId,{method:'DELETE',headers:auth(agent.cookie)});
    assert.equal(removeNote.status,200);
    assert.equal(removeReminder.status,200);
    assert.equal(removeNote.data.notes.length,1);
    assert.equal(removeSecondNote.status,200);
    assert.equal(removeSecondNote.data.notes.length,0);
    assert.equal(removeReminder.data.reminders.length,0);
    assert.ok(!stderr.includes('Error:'),stderr);
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,2500);}});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
