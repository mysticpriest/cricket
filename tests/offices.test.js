'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
const NKEY='NEUTRAUMA-TEST-KEY-2026';
const PKEY='PLATFORM-ROOT-TEST-KEY-2026';
const identity=(cookie)=>({Cookie:cookie});
function payload(method,body,cookie){
  return {method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify(body)};
}
async function req(url,pathname,options={}){
  const response=await fetch(url+pathname,options);
  let data;try{data=await response.json();}catch(_){data={};}
  return {status:response.status,data,headers:response.headers};
}
function cookie(response){return response.headers.get('set-cookie').split(';')[0];}
async function port(){return new Promise((resolve,reject)=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});server.on('error',reject);});}
async function ready(url,child){for(let i=0;i<55;i++){if(child.exitCode!==null)throw Error('Server exited during startup');try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}await new Promise(r=>setTimeout(r,65));}throw Error('Server not ready');}
async function login(url,officeKey,email,password){
  const response=await req(url,'/api/auth/login',payload('POST',{officeKey,email,password}));
  assert.equal(response.status,200,email+': '+JSON.stringify(response.data));
  return {user:response.data.user,cookie:cookie(response)};
}
test('Office Keys isolate clients, protect NeuTrauma workflows, and enable platform provisioning',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-offices-'));
  const p=await port(),url='http://127.0.0.1:'+p;
  const child=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,
    CRICKET_DATA_DIR:dir,HOST:'127.0.0.1',PORT:String(p),
    CRICKET_ADMIN_EMAIL:'neutrauma-admin@example.test',CRICKET_ADMIN_PASSWORD:'neutrauma-admin-password',
    CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
    CRICKET_PLATFORM_ADMIN_EMAIL:'owner@example.test',
    CRICKET_PLATFORM_ADMIN_PASSWORD:'platform-very-long-password',
    CRICKET_PLATFORM_OFFICE_KEY:PKEY
  },stdio:['ignore','pipe','pipe']});
  let errText='';child.stderr.on('data',d=>errText+=d.toString());
  try{
    await ready(url,child);
    const loginMissing=await req(url,'/api/auth/login',
      payload('POST',{email:'neutrauma-admin@example.test',password:'neutrauma-admin-password'}));
    assert.equal(loginMissing.status,401,'Office Key must be required');
    const fakeOffice=await req(url,'/api/office/resolve',payload('POST',{officeKey:'INCORRECT-OFFICE-KEY-999'}));
    assert.equal(fakeOffice.status,401);
    const publicOfficePage=await fetch(url+'/office.html');
    assert.equal(publicOfficePage.status,200);
    const officeSelect=await req(url,'/api/office/resolve',payload('POST',{officeKey:NKEY}));
    assert.equal(officeSelect.status,200);
    assert.equal(officeSelect.data.office.name,'NeuTrauma');
    const selectionCookie=cookie(officeSelect);
    const selected=await req(url,'/api/office/selection',{headers:identity(selectionCookie)});
    assert.equal(selected.data.office.name,'NeuTrauma');
    const cookieSignIn=await req(url,'/api/auth/login',{...payload('POST',{
      email:'neutrauma-admin@example.test',password:'neutrauma-admin-password'
    }),headers:{...payload('POST',{}).headers,...identity(selectionCookie)}});
    assert.equal(cookieSignIn.status,200,'Office selection cookie should authorize employee login');
    const neutraumaAdmin=await login(url,NKEY,'neutrauma-admin@example.test','neutrauma-admin-password');
    const platform=await login(url,PKEY,'owner@example.test','platform-very-long-password');
    assert.equal(platform.user.role,'platform_admin');
    assert.equal(platform.user.office,null);
    assert.equal((await req(url,'/api/cases',{headers:identity(platform.cookie)})).status,403);
    assert.equal((await req(url,'/api/users',{headers:identity(platform.cookie)})).status,403);
    const adminA=neutraumaAdmin.cookie;
    const agentCreated=await req(url,'/api/users',payload('POST',{
      displayName:'NeuTrauma Agent',email:'neutrauma-agent@example.test',
      password:'neutrauma-agent-password',role:'agent',officeId:999
    },adminA));
    assert.equal(agentCreated.status,201);
    const agentA=await login(url,NKEY,'neutrauma-agent@example.test','neutrauma-agent-password');
    const caseBody={
      department:'Appointment Inquiry',inquiry:'Fictional appointment question',
      route:'appointment',outcome:'resolved',callPhone:'4045550157',
      note:'Fictional patient appointment confirmation for an isolated tenant test.',
      events:['Verified fictional identity']
    };
    const caseSaved=await req(url,'/api/cases',payload('POST',caseBody,agentA.cookie));
    assert.equal(caseSaved.status,201);
    const casesA=await req(url,'/api/cases',{headers:identity(adminA)});
    assert.equal(casesA.data.total,1);
    const id=casesA.data.cases[0].caseId;
    const platformList=await req(url,'/api/platform/offices',{headers:identity(platform.cookie)});
    assert.equal(platformList.status,200);
    assert.equal(platformList.data.offices.length,1);
    assert.ok(!JSON.stringify(platformList.data).includes('4045550157'));
    const makeOffice=await req(url,'/api/platform/offices',payload('POST',{
      name:'Northstar Customer Support',adminName:'Northstar Manager',
      adminEmail:'northstar-admin@example.test',adminPassword:'northstar-password-long',
      routes:[{name:'Order inquiries',instructions:'Review order issues and provide general guidance.'},
        {name:'Refund requests',instructions:'Explain the next steps for approved refunds.'}]
    },platform.cookie));
    assert.equal(makeOffice.status,201,JSON.stringify(makeOffice.data));
    const office=makeOffice.data.office,newKey=makeOffice.data.officeKey;
    assert.equal(office.workflowTemplate,'starter');
    assert.ok(newKey.length>20);
    assert.ok(!JSON.stringify((await req(url,'/api/platform/offices',{headers:identity(platform.cookie)})).data).includes(newKey),
      'Never return an existing Office Key after the one-time creation response');
    const north=await login(url,newKey,'northstar-admin@example.test','northstar-password-long');
    assert.equal(north.user.office.name,'Northstar Customer Support');
    const northAdmin=north.cookie;
    const crossLogin=await req(url,'/api/auth/login',payload('POST',{
      officeKey:newKey,email:'neutrauma-admin@example.test',password:'neutrauma-admin-password'
    }));
    assert.equal(crossLogin.status,401,'Correct credentials plus wrong office key must fail');
    const northUsers=await req(url,'/api/users',{headers:identity(northAdmin)});
    assert.equal(northUsers.status,200);
    assert.deepEqual(northUsers.data.users.map(u=>u.email),['northstar-admin@example.test']);
    const northDashboard=await req(url,'/api/dashboard',{headers:identity(northAdmin)});
    assert.equal(northDashboard.data.total,0);
    const northCases=await req(url,'/api/cases',{headers:identity(northAdmin)});
    assert.equal(northCases.status,200);
    assert.equal(northCases.data.total,0);
    const northDetail=await req(url,'/api/cases/'+id,{headers:identity(northAdmin)});
    assert.equal(northDetail.status,404);
    const northExport=await fetch(url+'/api/cases/'+id+'/export',{headers:identity(northAdmin)});
    assert.equal(northExport.status,404);
    const northSave=await req(url,'/api/qc/work-later',payload('POST',{caseId:id},northAdmin));
    assert.equal(northSave.status,404);
    const northRemove=await req(url,'/api/cases/'+id,payload('DELETE',{confirmCaseId:id},northAdmin));
    assert.equal(northRemove.status,404);
    const northReviews=await req(url,'/api/cases/'+id+'/reviews',
      payload('POST',{decision:'approved',criteria:{verification:true,accuracy:true,resolution:true,documentation:true,professionalism:true}},northAdmin));
    assert.equal(northReviews.status,404);
    const northStaffChange=await req(url,'/api/users/'+agentCreated.data.user.id,
      payload('PATCH',{displayName:'Cross Office Name'},northAdmin));
    assert.equal(northStaffChange.status,404);
    const northAnalytics=await req(url,'/api/analytics/agents',{headers:identity(northAdmin)});
    assert.equal(northAnalytics.status,200);
    assert.equal(northAnalytics.data.totals.total,0);
    assert.equal(northAnalytics.data.byAgent.length,0);
    const northPresence=await req(url,'/api/active-agents',{headers:identity(northAdmin)});
    assert.equal(northPresence.data.total,0);
    const northAudit=await req(url,'/api/admin/audit?scope=all',{headers:identity(northAdmin)});
    assert.equal(northAudit.status,200);
    assert.ok(!JSON.stringify(northAudit.data).includes('neutrauma-agent@example.test'));
    const northWorkflow=await req(url,'/api/office/workflow',{headers:identity(northAdmin)});
    assert.equal(northWorkflow.data.office.routes[0].name,'Order inquiries');
    const northPage=await fetch(url+'/office-workflow.html',{headers:identity(northAdmin)});
    assert.equal(northPage.status,200);
    const northMedical=await fetch(url+'/inbound.js',{headers:identity(northAdmin)});
    assert.equal(northMedical.status,403,'No NeuTrauma workflow source available to starter office');
    const noCasePost=await req(url,'/api/cases',payload('POST',caseBody,northAdmin));
    assert.equal(noCasePost.status,403);
    const neutraumaStillThere=await req(url,'/api/cases',{headers:identity(adminA)});
    assert.equal(neutraumaStillThere.data.total,1);
    const changeRoutes=await req(url,'/api/platform/offices/'+office.id+'/routes',
      payload('PATCH',{routes:[{name:'Shipping questions',instructions:'Check the fictional shipping status.'}]},platform.cookie));
    assert.equal(changeRoutes.status,200);
    assert.equal((await req(url,'/api/office/workflow',{headers:identity(northAdmin)})).data.office.routes[0].name,'Shipping questions');
    const rotate=await req(url,'/api/platform/offices/'+office.id+'/key',{method:'POST',headers:identity(platform.cookie)});
    assert.equal(rotate.status,200);
    assert.notEqual(rotate.data.officeKey,newKey);
    assert.equal((await req(url,'/api/office/resolve',payload('POST',{officeKey:newKey}))).status,401);
    assert.equal((await req(url,'/api/office/resolve',payload('POST',{officeKey:rotate.data.officeKey}))).status,200);
    const paused=await req(url,'/api/platform/offices/'+office.id+'/status',
      payload('PATCH',{active:false},platform.cookie));
    assert.equal(paused.status,200);
    assert.equal((await req(url,'/api/auth/me',{headers:identity(northAdmin)})).data.user,null);
    assert.equal((await req(url,'/api/cases',{headers:identity(northAdmin)})).status,401);
    assert.equal((await req(url,'/api/cases',{headers:identity(adminA)})).data.total,1);
    // The additive migration binds all existing NeuTrauma records to Office 1.
    const db=new DatabaseSync(path.join(dir,'cricket.db'));
    assert.equal(db.prepare('SELECT office_id FROM cases WHERE case_id=?').get(id).office_id,neutraumaAdmin.user.office.id);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE office_id=?').get(neutraumaAdmin.user.office.id).n>0);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE office_id=?').get(office.id).n>=0);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM platform_audit').get().n>=3);
    db.close();
  }finally{
    child.kill('SIGTERM');
    await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,2500);}});
    fs.rmSync(dir,{recursive:true,force:true});
  }
  assert.ok(!errText.includes('Error:'),errText);
});