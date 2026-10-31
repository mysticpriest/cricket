'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.resolve(__dirname, '..');
function openPort() { return new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0,'127.0.0.1',()=> {const p=s.address().port;s.close(()=>resolve(p));}); s.on('error',reject); }); }
async function waitReady(url, proc) { for(let i=0;i<40;i++){ if(proc.exitCode !== null) throw Error('Server exited unexpectedly'); try { const r = await fetch(url+'/api/health'); if(r.ok)return; }catch(_){} await new Promise(r=>setTimeout(r,70)); } throw Error('Server did not become ready'); }
async function request(url, path, opts={}) {
  const r = await fetch(url+path,opts);
  let data; try {data=await r.json();}catch(_){data={};}
  return {status:r.status,data,headers:r.headers};
}
const json = (method, body, cookie='') => ({method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
test('QC backend: roles, case IDs, review scoring and audit', async () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(),'cricket-qc-'));
  const port = await openPort();
  const url = `http://127.0.0.1:${port}`;
  const proc=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,CRICKET_DATA_DIR:dbDir,PORT:String(port),HOST:'127.0.0.1',CRICKET_ADMIN_EMAIL:'admin@example.test',CRICKET_ADMIN_PASSWORD:'secure-admin-password-123'},stdio:['ignore','pipe','pipe']});
  let stderr=''; proc.stderr.on('data',x=>{stderr+=x.toString()});
  try {
    await waitReady(url,proc);
    const health=await request(url,'/api/health'); assert.equal(health.status,200);
    // The login shell is public, but workspace HTML is protected.
    const loginPage=await fetch(url+'/login.html'); assert.equal(loginPage.status,200);
    const loginStyles=await fetch(url+'/workspace.css'); assert.equal(loginStyles.status,200);
    for (const page of ['/', '/index.html','/inbound.html','/outbound.html','/cases.html','/qc.html','/staff.html']) {
      const anonymous=await fetch(url+page, {redirect:'manual'});
      assert.equal(anonymous.status,302, page+' must redirect anonymous users');
      assert.match(anonymous.headers.get('location'), /^\/login.html\?next=/);
    }
    const hidden=await fetch(url+'/server/server.js'); assert.equal(hidden.status,404);
    const unauthorized=await request(url,'/api/cases'); assert.equal(unauthorized.status,401);
    const badLogin=await request(url,'/api/auth/login',json('POST',{email:'admin@example.test',password:'bad'})); assert.equal(badLogin.status,401);
    const adminLogin=await request(url,'/api/auth/login',json('POST',{email:'admin@example.test',password:'secure-admin-password-123'})); assert.equal(adminLogin.status,200);
    const adminCookie=adminLogin.headers.get('set-cookie').split(';')[0]; assert.match(adminCookie,/cricket_session=/);
    const addAgent=await request(url,'/api/users',json('POST',{email:'agent@example.test',password:'agent-account-password-123',role:'agent'},adminCookie));assert.equal(addAgent.status,201);
    const addQc=await request(url,'/api/users',json('POST',{email:'qc@example.test',password:'qc-account-password-12345',role:'qc'},adminCookie));assert.equal(addQc.status,201);
    const agentLogin=await request(url,'/api/auth/login',json('POST',{email:'agent@example.test',password:'agent-account-password-123'}));
    const agentCookie=agentLogin.headers.get('set-cookie').split(';')[0];
    const qcLogin=await request(url,'/api/auth/login',json('POST',{email:'qc@example.test',password:'qc-account-password-12345'}));
    const qcCookie=qcLogin.headers.get('set-cookie').split(';')[0];
    async function staticStatus(page, cookie) { return (await fetch(url+page, {headers:{Cookie:cookie},redirect:'manual'})).status; }
    for(const page of ['/index.html','/inbound.html','/outbound.html','/cases.html','/staff.html','/qc.html']){
      assert.equal(await staticStatus(page,adminCookie),200,'admin should open '+page);
    }
    for(const page of ['/index.html','/inbound.html','/outbound.html','/cases.html']){
      assert.equal(await staticStatus(page,agentCookie),200,'agent should open '+page);
    }
    // Percent-encoded path separators must not bypass static role checks.
    for (const page of ['/%2Fqc.html', '/private%2F..%2Fqc.html']) {
      assert.equal(await staticStatus(page,agentCookie),403,'noncanonical URL must be blocked');
    }
    for(const page of ['/qc.html','/staff.html','/qc.js']){
      assert.equal(await staticStatus(page,agentCookie),403,'agent must be blocked from '+page);
    }
    for(const page of ['/index.html','/qc.html']){
      assert.equal(await staticStatus(page,qcCookie),200,'qc reviewer should open '+page);
    }
    for(const page of ['/inbound.html','/outbound.html','/cases.html','/staff.html','/inbound.js','/qc-bridge.js']){
      assert.equal(await staticStatus(page,qcCookie),403,'qc reviewer must be blocked from '+page);
    }
    const anonMetrics=await request(url,'/api/dashboard');assert.equal(anonMetrics.status,401);
    const emptyMetrics=await request(url,'/api/dashboard',{headers:{Cookie:agentCookie}});assert.equal(emptyMetrics.status,200);assert.equal(emptyMetrics.data.total,0);assert.equal(emptyMetrics.data.scope,'my_cases');
    const body={department:'Appointment Inquiry',inquiry:'When is my appointment?',route:'timeComplete',outcome:'resolved',note:'Verified caller details and provided confirmed appointment date and time.',events:['Verified identity','Provided appointment information']};
    const created=await request(url,'/api/cases',json('POST',body,agentCookie)); assert.equal(created.status,201); assert.match(created.data.caseId,/^CR-\d{8}-\d{6}$/);
    const repeat=await request(url,'/api/cases',json('POST',{...body,requestId:'12345678-1234-1234-1234-123456789012'},agentCookie));assert.equal(repeat.status,201);
    const repeatAgain=await request(url,'/api/cases',json('POST',{...body,requestId:'12345678-1234-1234-1234-123456789012'},agentCookie));assert.equal(repeatAgain.status,200);assert.equal(repeatAgain.data.caseId,repeat.data.caseId);
    const created2=await request(url,'/api/cases',json('POST',{...body,inquiry:'Who is my provider?'},agentCookie));assert.equal(created2.status,201);assert.notEqual(created2.data.caseId,created.data.caseId);
    const agentCannotReview=await request(url,`/api/cases/${created.data.caseId}/reviews`,json('POST',{decision:'approved',criteria:{verification:true,accuracy:true,resolution:true,documentation:true,professionalism:true},feedback:''},agentCookie));assert.equal(agentCannotReview.status,403);
    const qcCannotCreate=await request(url,'/api/cases',json('POST',body,qcCookie));assert.equal(qcCannotCreate.status,403);
    const list=await request(url,'/api/cases?search='+created.data.caseId,{headers:{Cookie:qcCookie}});assert.equal(list.status,200);assert.equal(list.data.total,1);assert.equal(list.data.cases[0].agent,'agent@example.test');
    const detail=await request(url,'/api/cases/'+created.data.caseId,{headers:{Cookie:qcCookie}});assert.equal(detail.status,200);assert.equal(detail.data.case.note,body.note);assert.equal(detail.data.history.length,1);
    const review=await request(url,`/api/cases/${created.data.caseId}/reviews`,json('POST',{decision:'coaching',criteria:{verification:true,accuracy:true,resolution:false,documentation:true,professionalism:null},feedback:'Review resolution confirmation.'},qcCookie));assert.equal(review.status,201);assert.equal(review.data.score,75);
    const updated=await request(url,'/api/cases/'+created.data.caseId,{headers:{Cookie:qcCookie}});assert.equal(updated.data.case.reviewStatus,'coaching');assert.equal(updated.data.reviews.length,1);assert.equal(updated.data.history.length,2);
    const agentList=await request(url,'/api/cases',{headers:{Cookie:agentCookie}});assert.equal(agentList.data.total,3);
    const agentMetrics=await request(url,'/api/dashboard',{headers:{Cookie:agentCookie}});
    assert.equal(agentMetrics.data.total,3);assert.equal(agentMetrics.data.pending,2);
    const qcMetrics=await request(url,'/api/dashboard',{headers:{Cookie:qcCookie}});
    assert.equal(qcMetrics.data.total,3);assert.equal(qcMetrics.data.scope,'all_cases');
    assert.equal(qcMetrics.data.approved,0);
    const crossSite=await request(url,'/api/cases', {...json('POST',body,agentCookie),headers:{...json('POST',body,agentCookie).headers,Origin:'https://not-our-site.invalid'}});assert.equal(crossSite.status,403);
  } finally {
    proc.kill('SIGTERM');
    await new Promise(resolve=>{ if(proc.exitCode !== null)resolve(); else {proc.once('exit',resolve);setTimeout(resolve,2500);} });
    fs.rmSync(dbDir,{recursive:true,force:true});
  }
  assert.ok(!stderr.replace(/\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n\(Use `node --trace-warnings ...` to show where the warning was created\)\n/g, '').trim(), stderr);
});
