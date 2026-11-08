'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

const ROOT=path.resolve(__dirname,'..');
async function port(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.listen(0,'127.0.0.1',()=>{const number=server.address().port;server.close(()=>resolve(number));});
    server.on('error',reject);
  });
}
async function ready(url,proc){
  for(let n=0;n<45;n++){
    if(proc.exitCode!==null)throw Error('Server exited during startup');
    try{const response=await fetch(url+'/api/health');if(response.ok)return;}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw Error('Server did not start');
}
async function call(url,endpoint,options={}){
  const res=await fetch(url+endpoint,options);
  const text=await res.text();
  let body;try{body=JSON.parse(text);}catch(_){body={};}
  return {status:res.status,body,headers:res.headers};
}
function json(method,body,cookie){
  return {method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)};
}
function cookie(login){return login.headers.get('set-cookie').split(';')[0];}

test('live presence, route duration, shift audit and role isolation',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-live-'));
  const serverPort=await port();
  const url='http://127.0.0.1:'+serverPort;
  const proc=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT,env:{...process.env,CRICKET_NEUTRAUMA_OFFICE_KEY:'NEUTRAUMA-TEST-KEY-2026',CRICKET_DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(serverPort),
      CRICKET_ADMIN_EMAIL:'admin-live@example.test',CRICKET_ADMIN_PASSWORD:'secure-admin-live-pass'},
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';proc.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  try{
    await ready(url,proc);
    const anonymous=await call(url,'/api/active-agents');
    assert.equal(anonymous.status,401);
    const adminLogin=await call(url,'/api/auth/login',json('POST',{officeKey:'NEUTRAUMA-TEST-KEY-2026',email:'admin-live@example.test',password:'secure-admin-live-pass'}));
    assert.equal(adminLogin.status,200);
    const adminCookie=cookie(adminLogin);
    const a=await call(url,'/api/users',json('POST',{displayName:'Demo Agent',email:'agent-live@example.test',role:'agent',password:'long-agent-live-pass'},adminCookie));
    assert.equal(a.status,201);
    const q=await call(url,'/api/users',json('POST',{displayName:'QC Teammate',email:'qc-live@example.test',role:'qc',password:'long-qc-live-pass123'},adminCookie));
    assert.equal(q.status,201);
    const agentLogin=await call(url,'/api/auth/login',json('POST',{officeKey:'NEUTRAUMA-TEST-KEY-2026',email:'agent-live@example.test',password:'long-agent-live-pass'}));
    const agentCookie=cookie(agentLogin);
    const qcLogin=await call(url,'/api/auth/login',json('POST',{officeKey:'NEUTRAUMA-TEST-KEY-2026',email:'qc-live@example.test',password:'long-qc-live-pass123'}));
    const qcCookie=cookie(qcLogin);
    const agentForbiddenPage=await fetch(url+'/operations.html',{headers:{Cookie:agentCookie},redirect:'manual'});
    const qcForbiddenPage=await fetch(url+'/operations.js',{headers:{Cookie:qcCookie},redirect:'manual'});
    const adminPage=await fetch(url+'/operations.html',{headers:{Cookie:adminCookie},redirect:'manual'});
    assert.equal(agentForbiddenPage.status,403);
    assert.equal(qcForbiddenPage.status,403);
    assert.equal(adminPage.status,200);
    assert.equal((await call(url,'/api/admin/operations',{headers:{Cookie:agentCookie}})).status,403);
    assert.equal((await call(url,'/api/admin/audit',{headers:{Cookie:qcCookie}})).status,403);
    const spoof=await call(url,'/api/presence',json('POST',{division:'inbound',route:'appointment',step:'start',stage:'working'},qcCookie));
    assert.equal(spoof.status,400);
    const intake=await call(url,'/api/presence',json('POST',{division:'inbound',route:'',step:'',stage:'intake'},agentCookie));
    assert.equal(intake.status,200);
    const route=await call(url,'/api/presence',json('POST',{
      division:'inbound',route:'appointment',step:'start',stage:'working',userId:999,
      callPhone:'this-must-not-be-copied',note:'secret-note'
    },agentCookie));
    assert.equal(route.status,200);
    assert.ok(route.body.routeStartedAt>0);
    const step=await call(url,'/api/presence',json('POST',{division:'inbound',route:'appointment',step:'providerLink',stage:'working'},agentCookie));
    assert.equal(step.status,200);
    assert.equal(step.body.routeStartedAt,route.body.routeStartedAt,'Timer should not restart on each step');
    const invalid=await call(url,'/api/presence',json('POST',{division:'inbound',route:'fake-route',step:'x',stage:'working'},agentCookie));
    assert.equal(invalid.status,400);
    const directory=await call(url,'/api/active-agents',{headers:{Cookie:qcCookie}});
    assert.equal(directory.status,200);
    assert.equal(directory.body.total,1);
    assert.equal(directory.body.agents[0].id,a.body.user.id);
    assert.equal(directory.body.agents[0].route,'appointment');
    assert.equal(directory.body.agents[0].step,'providerLink');
    assert.equal(directory.body.agents[0].displayName,'Demo Agent');
    assert.ok(!JSON.stringify(directory.body).includes('this-must-not-be-copied'));
    const qcPresence=await call(url,'/api/presence',json('POST',{division:'qc',route:'',step:'',stage:'idle'},qcCookie));
    assert.equal(qcPresence.status,200);
    const adminOperations=await call(url,'/api/admin/operations',{headers:{Cookie:adminCookie}});
    assert.equal(adminOperations.status,200);
    assert.equal(adminOperations.body.total,2);
    assert.ok(adminOperations.body.people.some(p=>p.id===a.body.user.id&&p.route==='appointment'));
    assert.ok(adminOperations.body.people.some(p=>p.id===q.body.user.id&&p.division==='qc'));
    const history=await call(url,'/api/admin/audit?actorId='+a.body.user.id+'&scope=shift',{headers:{Cookie:adminCookie}});
    assert.equal(history.status,200);
    assert.ok(history.body.events.some(e=>e.action==='signed_in'));
    assert.ok(history.body.events.some(e=>e.action==='route_started'&&e.details==='appointment'));
    assert.ok(history.body.events.some(e=>e.action==='route_progress'&&e.details.includes('providerLink')));
    assert.ok(history.body.events.every(e=>e.actorId===a.body.user.id));
    assert.ok(!JSON.stringify(history.body).includes('this-must-not-be-copied'));
    const db=new DatabaseSync(path.join(dataDir,'cricket.db'));
    const adminHash=crypto.createHash('sha256').update(adminCookie.split('=')[1]).digest('hex');
    const before=db.prepare('SELECT last_active_at FROM sessions WHERE token_hash=?').get(adminHash).last_active_at;
    await call(url,'/api/admin/operations',{headers:{Cookie:adminCookie}});
    await call(url,'/api/admin/audit',{headers:{Cookie:adminCookie}});
    const after=db.prepare('SELECT last_active_at FROM sessions WHERE token_hash=?').get(adminHash).last_active_at;
    assert.equal(after,before,'Passive monitor refresh must not extend 20-minute idle timeout');
    const logout=await call(url,'/api/auth/logout',{method:'POST',headers:{Cookie:agentCookie}});
    assert.equal(logout.status,200);
    const afterLogout=await call(url,'/api/active-agents',{headers:{Cookie:adminCookie}});
    assert.equal(afterLogout.body.total,0,'Logged-out agent should disappear immediately');
    const shiftAfterLogout=await call(url,'/api/admin/audit?actorId='+a.body.user.id+'&scope=shift',{headers:{Cookie:adminCookie}});
    assert.ok(shiftAfterLogout.body.events.some(e=>e.action==='signed_out'));
    const qcHash=crypto.createHash('sha256').update(qcCookie.split('=')[1]).digest('hex');
    db.prepare('UPDATE sessions SET last_active_at=? WHERE token_hash=?').run(Date.now()-21*60*1000,qcHash);
    db.close();
    assert.equal((await call(url,'/api/presence',json('POST',{division:'qc',route:'',step:'',stage:'idle'},qcCookie))).status,401);
    const expired=await call(url,'/api/admin/operations',{headers:{Cookie:adminCookie}});
    assert.equal(expired.body.total,0,'Expired QC session should not show online');
  }finally{
    proc.kill('SIGTERM');
    await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else{proc.once('exit',resolve);setTimeout(resolve,2500);}});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
  assert.ok(!stderr.includes('Error:'),stderr);
});
