'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
async function openPort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});server.on('error',reject);});}
async function ready(url,proc){for(let i=0;i<50;i++){if(proc.exitCode!==null)throw Error('Server exited');try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}await new Promise(r=>setTimeout(r,70));}throw Error('Server not ready');}
const body=(method,payload,cookie)=>({method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(payload)});
async function call(url,endpoint,options={}){const response=await fetch(url+endpoint,options);let data;try{data=await response.json();}catch(_){data={};}return {status:response.status,data,headers:response.headers};}
const cookie=result=>result.headers.get('set-cookie').split(';')[0];
const dateAgo=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,10)+'T12:00:00.000Z';
test('role-separated analytics, temporal series, filtering, QC reviews and privacy',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-analytics-'));
  const p=await openPort();const url='http://127.0.0.1:'+p;
  const proc=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,
    CRICKET_DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(p),
    CRICKET_ADMIN_EMAIL:'analytics-admin@example.test',
    CRICKET_ADMIN_PASSWORD:'long-analytics-admin-password'},stdio:['ignore','pipe','pipe']});
  let stderr='';proc.stderr.on('data',x=>{stderr+=x.toString();});
  try{
    await ready(url,proc);
    const anon=await call(url,'/api/analytics/agents');assert.equal(anon.status,401);
    const adminLogin=await call(url,'/api/auth/login',body('POST',{email:'analytics-admin@example.test',password:'long-analytics-admin-password'}));
    assert.equal(adminLogin.status,200);
    const admin=cookie(adminLogin);
    const agents=[];
    for(const [name,email] of [['Agent One','agent1@example.test'],['Agent Two','agent2@example.test']]){
      const user=await call(url,'/api/users',body('POST',{displayName:name,email,role:'agent',password:'long-analytics-agent-pass'},admin));
      assert.equal(user.status,201);
      const login=await call(url,'/api/auth/login',body('POST',{email,password:'long-analytics-agent-pass'}));
      assert.equal(login.status,200);
      agents.push({id:user.data.user.id,cookie:cookie(login),name});
    }
    const qcs=[];
    for(const [name,email] of [['QC First','qc1@example.test'],['QC Second','qc2@example.test']]){
      const user=await call(url,'/api/users',body('POST',{displayName:name,email,role:'qc',password:'long-analytics-review-pass'},admin));
      assert.equal(user.status,201);
      const login=await call(url,'/api/auth/login',body('POST',{email,password:'long-analytics-review-pass'}));
      assert.equal(login.status,200);
      qcs.push({id:user.data.user.id,cookie:cookie(login),name});
    }
    for(const person of [...agents,...qcs,{cookie:admin}]){
      const page=await fetch(url+'/analytics.html',{headers:{Cookie:person.cookie},redirect:'manual'});
      assert.equal(page.status,200,'All signed-in roles can see Analytics HTML');
      const js=await fetch(url+'/analytics.js',{headers:{Cookie:person.cookie},redirect:'manual'});
      assert.equal(js.status,200);
    }
    const anonPage=await fetch(url+'/analytics.html',{redirect:'manual'});
    assert.equal(anonPage.status,302);
    const agentQc=await call(url,'/api/analytics/qc',{headers:{Cookie:agents[0].cookie}});
    assert.equal(agentQc.status,403,'Agent cannot read QC figures by direct API call');
    const anonymousQc=await call(url,'/api/analytics/qc');assert.equal(anonymousQc.status,401);
    const qcAgent=await call(url,'/api/analytics/agents',{headers:{Cookie:qcs[0].cookie}});
    assert.equal(qcAgent.status,200);
    assert.equal(qcAgent.data.kind,'agents');
    const payload={department:'Appointment Inquiry',inquiry:'When is my fictional appointment?',
      route:'timeComplete',outcome:'resolved',callPhone:'4045550199',
      note:'Verified fictional caller and provided fictional scheduling information for the demonstration.',
      events:['Verified fictional caller','Provided appointment information']};
    async function add(agent,details={}){
      const result=await call(url,'/api/cases',body('POST',{...payload,...details},agent.cookie));
      assert.equal(result.status,201);
      assert.equal(result.data.caseId,undefined,'Agents cannot receive Case IDs');
      const rows=await call(url,'/api/cases?limit=1',{headers:{Cookie:qcs[0].cookie}});
      assert.equal(rows.status,200);
      return rows.data.cases[0].caseId;
    }
    const ids=[];
    ids.push(await add(agents[0]));                           // today
    ids.push(await add(agents[0],{outcome:'pending'}));        // today
    ids.push(await add(agents[1]));                           // today
    ids.push(await add(agents[1],{department:'Outbound Follow-up',route:'outboundDemo'})); // intentionally seeded Outbound record
    ids.push(await add(agents[0]));                           // 12 days ago
    ids.push(await add(agents[1]));                           // 40 days ago
    ids.push(await add(agents[1]));                           // 120 days ago
    ids.push(await add(agents[0]));                           // deleted
    // Timestamp seed only in an isolated test database; production dates are server assigned.
    const db=new DatabaseSync(path.join(dataDir,'cricket.db'));
    db.prepare('UPDATE cases SET created_at=? WHERE case_id=?').run(dateAgo(12),ids[4]);
    db.prepare('UPDATE cases SET created_at=? WHERE case_id=?').run(dateAgo(40),ids[5]);
    db.prepare('UPDATE cases SET created_at=? WHERE case_id=?').run(dateAgo(120),ids[6]);
    const deleted=await call(url,'/api/cases/'+ids[7],body('DELETE',{confirmCaseId:ids[7]},qcs[0].cookie));
    assert.equal(deleted.status,200);
    const agents7=await call(url,'/api/analytics/agents?range=7',{headers:{Cookie:agents[0].cookie}});
    assert.equal(agents7.status,200);
    const d=agents7.data;
    assert.equal(d.range.days,7);
    assert.equal(d.daily.length,7);
    assert.equal(d.totals.total,4);
    assert.equal(d.totals.inbound,3);
    assert.equal(d.totals.outbound,1);
    assert.equal(d.totals.resolved,3);
    assert.equal(d.totals.pending,1);
    assert.equal(d.totals.activeAgents,2);
    assert.equal(d.daily.reduce((sum,x)=>sum+x.total,0),d.totals.total);
    assert.equal(d.byAgent.find(x=>x.id===agents[0].id).total,2);
    assert.equal(d.byAgent.find(x=>x.id===agents[1].id).total,2);
    assert.ok(!JSON.stringify(d).includes('4045550199'),'No caller number leaks in analytics');
    assert.ok(!JSON.stringify(d).includes(payload.note),'No case notes leak in analytics');
    assert.ok(!Object.hasOwn(d,'byReviewer'),'Agent response must not include QC metrics');
    const thirty=await call(url,'/api/analytics/agents?range=30',{headers:{Cookie:admin}});
    assert.equal(thirty.data.totals.total,5);
    const ninety=await call(url,'/api/analytics/agents?range=90',{headers:{Cookie:qcs[1].cookie}});
    assert.equal(ninety.data.totals.total,6);
    assert.equal(ninety.data.daily.length,90);
    const agentFilter=await call(url,'/api/analytics/agents?range=7&agentId='+agents[0].id,{headers:{Cookie:agents[1].cookie}});
    assert.equal(agentFilter.data.totals.total,2);
    assert.equal(agentFilter.data.byAgent.length,1);
    const outbound=await call(url,'/api/analytics/agents?range=7&department=outbound',{headers:{Cookie:agents[0].cookie}});
    assert.equal(outbound.data.totals.total,1);
    assert.equal(outbound.data.totals.inbound,0);
    const pending=await call(url,'/api/analytics/agents?range=7&outcome=pending',{headers:{Cookie:agents[0].cookie}});
    assert.equal(pending.data.totals.total,1);
    const invalid=await call(url,'/api/analytics/agents?range=999',{headers:{Cookie:admin}});
    assert.equal(invalid.status,400);
    const badDate=await call(url,'/api/analytics/agents?range=custom&from=2026-02-30&to=2026-03-01',{headers:{Cookie:admin}});
    assert.equal(badDate.status,400);
    const badAgent=await call(url,'/api/analytics/agents?agentId=999999',{headers:{Cookie:admin}});
    assert.equal(badAgent.status,400);
    const today=new Date().toISOString().slice(0,10);
    const custom=await call(url,'/api/analytics/agents?range=custom&from='+today+'&to='+today,{headers:{Cookie:admin}});
    assert.equal(custom.status,200);
    assert.equal(custom.data.range.days,1);
    assert.equal(custom.data.totals.total,4);
    // Two QC employees submit five evaluations against four distinct cases.
    const criteria=(passes)=>({
      verification:passes>=1,accuracy:passes>=2,resolution:passes>=3,
      documentation:passes>=4,professionalism:passes>=5
    });
    async function review(qc,id,decision,passes){
      const result=await call(url,'/api/cases/'+id+'/reviews',body('POST',{
        decision,criteria:criteria(passes),feedback:decision==='approved'?'':'Fictional quality coaching note.'
      },qc.cookie));
      assert.equal(result.status,201);
    }
    await review(qcs[0],ids[0],'approved',5);
    await review(qcs[0],ids[1],'coaching',3);
    await review(qcs[0],ids[0],'coaching',4);
    await review(qcs[1],ids[2],'flagged',1);
    await review(qcs[1],ids[3],'approved',5);
    const agentAfterReview=await call(url,'/api/analytics/agents',{headers:{Cookie:agents[0].cookie}});
    assert.equal(agentAfterReview.data.totals.total,4,'Agent figures unaffected by QC reviews');
    assert.equal((await call(url,'/api/analytics/qc',{headers:{Cookie:agents[0].cookie}})).status,403);
    const report=await call(url,'/api/analytics/qc?range=7',{headers:{Cookie:qcs[0].cookie}});
    assert.equal(report.status,200);
    const q=report.data;
    assert.equal(q.kind,'qc');
    assert.equal(q.totals.total,5);
    assert.equal(q.totals.uniqueCases,4);
    assert.equal(q.totals.approved,2);
    assert.equal(q.totals.coaching,2);
    assert.equal(q.totals.flagged,1);
    assert.equal(q.totals.averageScore,72);
    assert.equal(q.totals.activeReviewers,2);
    assert.equal(q.byReviewer.find(x=>x.id===qcs[0].id).total,3);
    assert.equal(q.byReviewer.find(x=>x.id===qcs[0].id).uniqueCases,2);
    assert.equal(q.byReviewer.find(x=>x.id===qcs[1].id).total,2);
    assert.equal(q.daily.reduce((sum,x)=>sum+x.total,0),5);
    assert.ok(!JSON.stringify(q).includes('4045550199'));
    const onlyFirst=await call(url,'/api/analytics/qc?range=7&reviewerId='+qcs[0].id,{headers:{Cookie:admin}});
    assert.equal(onlyFirst.data.totals.total,3);
    assert.equal(onlyFirst.data.totals.uniqueCases,2);
    const onlyApproved=await call(url,'/api/analytics/qc?range=7&decision=approved',{headers:{Cookie:qcs[1].cookie}});
    assert.equal(onlyApproved.data.totals.total,2);
    assert.equal(onlyApproved.data.totals.approved,2);
    assert.equal(onlyApproved.data.totals.averageScore,100);
    assert.equal((await call(url,'/api/analytics/qc?decision=invalid',{headers:{Cookie:admin}})).status,400);
    // Read-only chart polling should not extend sessions.
    const hash=crypto.createHash('sha256').update(agents[0].cookie.split('=')[1]).digest('hex');
    const before=db.prepare('SELECT last_active_at FROM sessions WHERE token_hash=?').get(hash).last_active_at;
    await call(url,'/api/analytics/agents',{headers:{Cookie:agents[0].cookie}});
    const after=db.prepare('SELECT last_active_at FROM sessions WHERE token_hash=?').get(hash).last_active_at;
    assert.equal(after,before);
    db.close();
  }finally{
    proc.kill('SIGTERM');
    await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else{proc.once('exit',resolve);setTimeout(resolve,2500);}});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
  assert.ok(!stderr.includes('Error:'),stderr);
});
