'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const NKEY='NEUTRAUMA-OPS-INTEGRATION-KEY-2026',PKEY='PLATFORM-OPS-INTEGRATION-KEY-2026';
const json=(method,body,cookie)=>({method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
async function req(origin,p,options={}){
 const res=await fetch(origin+p,options);
 let data=null;try{data=await res.json();}catch(_){}
 return {status:res.status,data,headers:res.headers,text:res};
}
const ck=resp=>resp.headers.getSetCookie()
 .find(x=>x.startsWith(resp.data.user.role==='platform_admin'?'cricket_platform_session=':'cricket_session=')).split(';')[0];
async function port(){return new Promise((resolve,reject)=>{
 const server=net.createServer();server.listen(0,'127.0.0.1',()=>{
  const p=server.address().port;server.close(()=>resolve(p));
 });server.on('error',reject);
});}
async function ready(url,proc){for(let i=0;i<65;i++){
 if(proc.exitCode!==null)throw Error('Server exited');
 try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}
 await new Promise(r=>setTimeout(r,65));
}throw Error('Server did not initialize');}
async function login(origin,key,email,password){
 const r=await req(origin,'/api/auth/login',json('POST',{officeKey:key,email,password}));
 assert.equal(r.status,200,email+' '+JSON.stringify(r.data));
 return {user:r.data.user,cookie:ck(r)};
}
test('Six operations features are tenant-isolated, role-gated and connected to cases/QC',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-ops-suite-'));
 const p=await port(),url='http://127.0.0.1:'+p;
 const env={...process.env,HOST:'127.0.0.1',PORT:String(p),CRICKET_DATA_DIR:dir,
  CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
  CRICKET_ADMIN_EMAIL:'suite-admin@example.test',CRICKET_ADMIN_PASSWORD:'suite-admin-secure-password',
  CRICKET_PLATFORM_OFFICE_KEY:PKEY,
  CRICKET_PLATFORM_ADMIN_EMAIL:'suite-platform@example.test',
  CRICKET_PLATFORM_ADMIN_PASSWORD:'suite-platform-secure-password',
  NODE_ENV:'development'};
 const child=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=String(chunk));
 try{
  await ready(url,child);
  const admin=await login(url,NKEY,'suite-admin@example.test','suite-admin-secure-password');
  const platform=await login(url,PKEY,'suite-platform@example.test','suite-platform-secure-password');
  const agentCreated=await req(url,'/api/users',json('POST',{
   displayName:'Suite Agent',email:'suite-agent@example.test',role:'agent',password:'suite-agent-secure-password'
  },admin.cookie));
  assert.equal(agentCreated.status,201,JSON.stringify(agentCreated.data));
  const qcCreated=await req(url,'/api/users',json('POST',{
   displayName:'Suite Reviewer',email:'suite-reviewer@example.test',role:'qc',password:'suite-qc-secure-password'
  },admin.cookie));
  assert.equal(qcCreated.status,201,JSON.stringify(qcCreated.data));
  const agent=await login(url,NKEY,'suite-agent@example.test','suite-agent-secure-password');
  const qc=await login(url,NKEY,'suite-reviewer@example.test','suite-qc-secure-password');
  const newOffice=await req(url,'/api/platform/offices',json('POST',{
   name:'Operations Demo Client',adminName:'Demo Client Owner',
   adminEmail:'demo-client-ops@example.test',adminPassword:'demo-client-secure-password',
   routes:[{name:'Delivery',instructions:'Use fictitious order data.'}]
  },platform.cookie));
  assert.equal(newOffice.status,201,JSON.stringify(newOffice.data));
  const officeB=await login(url,newOffice.data.officeKey,'demo-client-ops@example.test','demo-client-secure-password');
  // 1: Office-owned workflow builder + guided case submission.
  const definition={title:'Example billing support',description:'Fictional customer billing inquiry',
   status:'published',steps:[
    {label:'Was account verified?',type:'yesno',required:true,options:[]},
    {label:'Reason for contact',type:'text',required:true,options:[]},
    {label:'Final decision',type:'select',required:true,options:['Information','Escalated']}
   ]};
  assert.equal((await req(url,'/api/ops/workflows',json('POST',definition,agent.cookie))).status,403);
  assert.equal((await req(url,'/api/ops/workflows',json('POST',definition,platform.cookie))).status,403);
  const created=await req(url,'/api/ops/workflows',json('POST',definition,admin.cookie));
  assert.equal(created.status,201,JSON.stringify(created.data));
  const workflowId=created.data.workflow.id;
  assert.ok(/^[a-f0-9-]{36}$/i.test(workflowId));
  const published=await req(url,'/api/ops/workflows',{headers:{Cookie:agent.cookie}});
  assert.equal(published.status,200);
  assert.equal(published.data.workflows.length,1);
  assert.equal(published.data.workflows[0].title,definition.title);
  const foreign=await req(url,'/api/ops/workflows/'+workflowId,{headers:{Cookie:officeB.cookie}});
  assert.equal(foreign.status,404);
  const bList=await req(url,'/api/ops/workflows',{headers:{Cookie:officeB.cookie}});
  assert.equal(bList.data.workflows.length,0);
  const missing=await req(url,'/api/ops/workflows/'+workflowId+'/complete',json('POST',{
   outcome:'resolved',answers:{s1:'Yes',s2:''},note:'Fictional example'
  },agent.cookie));
  assert.equal(missing.status,400);
  const completed=await req(url,'/api/ops/workflows/'+workflowId+'/complete',json('POST',{
   outcome:'resolved',answers:{s1:'Yes',s2:'Explained statement line items',s3:'Information'},
   note:'Fictional caller. Guidance provided and call closed.'
  },agent.cookie));
  assert.equal(completed.status,201,JSON.stringify(completed.data));
  assert.equal(completed.data.saved,true);
  assert.equal(completed.data.caseId,undefined,'Agent must not receive private case ID');
  const cases=await req(url,'/api/cases',{headers:{Cookie:qc.cookie}});
  assert.equal(cases.status,200);
  assert.equal(cases.data.total,1,'Custom workflow enters the existing QC case list');
  const caseId=cases.data.cases[0].caseId;
  const fullCase=await req(url,'/api/cases/'+caseId,{headers:{Cookie:qc.cookie}});
  assert.equal(fullCase.status,200);
  assert.match(fullCase.data.case.note,/Reason for contact/);
  assert.equal((await req(url,'/api/cases',{headers:{Cookie:officeB.cookie}})).data.total,0);
  const review=await req(url,'/api/cases/'+caseId+'/reviews',json('POST',{
   decision:'approved',criteria:{verification:true,accuracy:true,resolution:true,documentation:true,professionalism:true},
   feedback:'Fictional example approved'
  },qc.cookie));
  assert.equal(review.status,201);
  // Notification center includes QC feedback for original agent.
  const afterQc=await req(url,'/api/ops/notifications',{headers:{Cookie:agent.cookie}});
  assert.equal(afterQc.status,200);
  assert.ok(afterQc.data.notifications.some(x=>x.type==='qc'&&x.title.includes('approved')));
  // 2: Separate announcements, messaging + notifications.
  const ann=await req(url,'/api/ops/team/announcements',json('POST',{
   title:'Office demonstration update',body:'Only Suite employees should receive this notice.'
  },admin.cookie));
  assert.equal(ann.status,201);
  assert.equal((await req(url,'/api/ops/team/announcements',json('POST',{
   title:'Not allowed',body:'Agents cannot publish announcements.'
  },agent.cookie))).status,403);
  const team=await req(url,'/api/ops/team',{headers:{Cookie:agent.cookie}});
  assert.equal(team.status,200);
  assert.equal(team.data.announcements.length,1);
  assert.equal((await req(url,'/api/ops/team',{headers:{Cookie:officeB.cookie}})).data.announcements.length,0);
  const badRecipient=await req(url,'/api/ops/team/messages',json('POST',{
   recipientId:officeB.user.id,body:'Other office must not receive this.'
  },agent.cookie));
  assert.equal(badRecipient.status,400);
  const sent=await req(url,'/api/ops/team/messages',json('POST',{
   recipientId:admin.user.id,body:'Can you approve my scheduled shift?'
  },agent.cookie));
  assert.equal(sent.status,201);
  assert.equal((await req(url,'/api/ops/team',{headers:{Cookie:admin.cookie}})).data.messages.length,1);
  assert.equal((await req(url,'/api/ops/team',{headers:{Cookie:officeB.cookie}})).data.messages.length,0);
  const adminAlerts=await req(url,'/api/ops/notifications',{headers:{Cookie:admin.cookie}});
  const messageAlert=adminAlerts.data.notifications.find(x=>x.type==='message');
  assert.ok(messageAlert);
  assert.equal((await req(url,'/api/ops/notifications/'+messageAlert.id+'/read',
   {method:'POST',headers:{Cookie:officeB.cookie}})).status,404);
  const mark=await req(url,'/api/ops/notifications/'+messageAlert.id+'/read',
   {method:'POST',headers:{Cookie:admin.cookie}});
  assert.equal(mark.status,200);
  // 3: Workforce schedules and time-clock correction approval.
  const start=new Date(Date.now()+36e5).toISOString(),end=new Date(Date.now()+7.2e6).toISOString();
  const schedule=await req(url,'/api/ops/workforce/schedules',json('POST',{
   userId:agent.user.id,startAt:start,endAt:end,notes:'Training shift'
  },admin.cookie));
  assert.equal(schedule.status,201,JSON.stringify(schedule.data));
  assert.equal((await req(url,'/api/ops/workforce/schedules',json('POST',{
   userId:agent.user.id,startAt:start,endAt:end,notes:'No permission'
  },agent.cookie))).status,403);
  assert.equal((await req(url,'/api/ops/workforce/schedules',json('POST',{
   userId:officeB.user.id,startAt:start,endAt:end,notes:'Foreign'
  },admin.cookie))).status,404);
  const agentWork=await req(url,'/api/ops/workforce',{headers:{Cookie:agent.cookie}});
  assert.equal(agentWork.data.schedules.length,1);
  assert.equal((await req(url,'/api/ops/workforce',{headers:{Cookie:officeB.cookie}})).data.schedules.length,0);
  const notifications=await req(url,'/api/ops/notifications',{headers:{Cookie:agent.cookie}});
  assert.ok(notifications.data.notifications.some(x=>x.type==='schedule'));
  assert.ok(notifications.data.notifications.some(x=>x.type==='announcement'));
  // Create completed shift through existing five-state clock API.
  assert.equal((await req(url,'/api/workspace/shift',json('POST',{action:'start_shift'},agent.cookie))).status,200);
  assert.equal((await req(url,'/api/workspace/shift',json('POST',{action:'end_shift'},agent.cookie))).status,200);
  const done=await req(url,'/api/ops/workforce',{headers:{Cookie:agent.cookie}});
  const shift=done.data.timesheets.find(x=>x.userId===agent.user.id&&x.endedAt);
  assert.ok(shift);
  const correction=await req(url,'/api/ops/workforce/corrections',json('POST',{
   shiftId:shift.id,startAt:new Date(Date.now()-7200000).toISOString(),
   endAt:new Date(Date.now()-3600000).toISOString(),reason:'Test correction of fictional work times.'
  },agent.cookie));
  assert.equal(correction.status,201,JSON.stringify(correction.data));
  assert.equal((await req(url,'/api/ops/workforce/corrections/'+correction.data.id,
   json('PATCH',{status:'approved',note:'Attempt by agent'},agent.cookie))).status,403);
  assert.equal((await req(url,'/api/ops/workforce/corrections/'+correction.data.id,
   json('PATCH',{status:'approved',note:'Attempt by other office'},officeB.cookie))).status,404);
  assert.equal((await req(url,'/api/ops/workforce/corrections/'+correction.data.id,
   json('PATCH',{status:'approved',note:'Approved fictional shift correction'},admin.cookie))).status,200);
  const approved=await req(url,'/api/ops/workforce',{headers:{Cookie:agent.cookie}});
  assert.equal(approved.data.corrections[0].status,'approved');
  assert.equal(approved.data.timesheets.find(x=>x.id===shift.id).startedAt,shift.startedAt,
   'Correction approvals do not alter original clock records');
  assert.equal((await req(url,'/api/ops/workforce/export',{headers:{Cookie:agent.cookie}})).status,403);
  const exportR=await fetch(url+'/api/ops/workforce/export',{headers:{Cookie:admin.cookie}});
  assert.equal(exportR.status,200);
  assert.match(exportR.headers.get('content-type'),/text\/csv/);
  assert.match(await exportR.text(),/Suite Agent/);
  // 4: Permission-filtered search (global Ctrl+K).
  const search=await req(url,'/api/ops/search?q=billing',{headers:{Cookie:agent.cookie}});
  assert.ok(search.data.results.some(x=>x.title===definition.title));
  const staffSearch=await req(url,'/api/ops/search?q=staff',{headers:{Cookie:agent.cookie}});
  assert.ok(!staffSearch.data.results.some(x=>x.href==='staff.html'));
  const admins=await req(url,'/api/ops/search?q=staff',{headers:{Cookie:admin.cookie}});
  assert.ok(admins.data.results.some(x=>x.href==='staff.html'));
  const searchB=await req(url,'/api/ops/search?q=billing',{headers:{Cookie:officeB.cookie}});
  assert.ok(!searchB.data.results.some(x=>x.title===definition.title));
  // Static pages require employee role boundaries.
  assert.equal((await fetch(url+'/workflow-builder.html',{headers:{Cookie:agent.cookie}})).status,403);
  assert.equal((await fetch(url+'/workflow-builder.html',{headers:{Cookie:admin.cookie}})).status,200);
  for(const page of ['workflow-runner.html','team-hub.html','workforce.html'])
   assert.equal((await fetch(url+'/'+page,{headers:{Cookie:agent.cookie}})).status,200,page);
  assert.equal((await req(url,'/api/ops/team',{headers:{Cookie:platform.cookie}})).status,403);
  assert.ok(!stderr.includes('Error:'),stderr);
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>{
   if(child.exitCode!==null)resolve();
   else{child.once('exit',resolve);setTimeout(resolve,2500);}
  });
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
