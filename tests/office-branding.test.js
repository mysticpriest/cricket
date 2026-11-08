'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const net=require('node:net');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
const NKEY='NEUTRAUMA-BRANDING-TEST-KEY-2026';
async function availablePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});
    server.on('error',reject);
  });
}
function json(method,body){
  return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
}
async function response(url,path,options={}){
  const r=await fetch(url+path,options);
  let data={};try{data=await r.json();}catch(_){}
  return {status:r.status,data,headers:r.headers};
}
async function waitForServer(url,proc){
  for(let count=0;count<65;count++){
    if(proc.exitCode!==null)throw Error('Server exited before HTTP became available');
    try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  throw Error('Server did not start in time');
}
async function shutDown(proc){
  proc.kill('SIGTERM');
  await new Promise(resolve=>{
    if(proc.exitCode!==null)return resolve();
    proc.once('exit',resolve);setTimeout(resolve,2500);
  });
}
test('Client branding, original NeuTrauma logo and opt-in Northstar demo bootstrap',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-brands-'));
  const port=await availablePort(),url='http://127.0.0.1:'+port;
  const env={...process.env,HOST:'127.0.0.1',PORT:String(port),
    CRICKET_DATA_DIR:dir,CRICKET_SEED_DEMO_OFFICE:'1',
    CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
    CRICKET_ADMIN_EMAIL:'brand-admin@example.test',
    CRICKET_ADMIN_PASSWORD:'secure-brand-admin-password',
    NODE_ENV:'development'};
  const proc=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
  let output='',stderr='';
  proc.stdout.on('data',chunk=>output+=String(chunk));
  proc.stderr.on('data',chunk=>stderr+=String(chunk));
  try{
    await waitForServer(url,proc);
    const demoKey=output.match(/Office Key:\s*(CRK-[A-Za-z0-9_-]+)/)?.[1];
    const demoPassword=output.match(/Password:\s*([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(demoKey,'On first startup the demo Office Key must be displayed once');
    assert.ok(demoPassword&&demoPassword.length>=12,'Demo admin receives a secure random password');
    assert.notEqual(demoKey,NKEY);

    const page=await fetch(url+'/office.html');
    assert.equal(page.status,200);
    const login=await fetch(url+'/login.html');
    assert.equal(login.status,200);
    const loginHtml=await login.text();
    assert.match(loginHtml,/clientBrandImage/);
    assert.match(loginHtml,/login\.css/);

    const logo=await fetch(url+'/assets/neutrauma-logo.webp');
    assert.equal(logo.status,200);
    assert.match(logo.headers.get('content-type'),/image\/webp/);
    assert.ok((await logo.arrayBuffer()).byteLength>2000);

    const n=await response(url,'/api/office/resolve',json('POST',{officeKey:NKEY}));
    assert.equal(n.status,200);
    assert.equal(n.data.office.name,'NeuTrauma');
    assert.equal(n.data.office.branding.logoUrl,'/assets/neutrauma-logo.webp');
    assert.equal(n.data.office.branding.tagline,'Concussion Care');
    const selectedCookie=n.headers.get('set-cookie').split(';')[0];
    const selection=await response(url,'/api/office/selection',{headers:{Cookie:selectedCookie}});
    assert.equal(selection.data.office.branding.color,n.data.office.branding.color);

    const d=await response(url,'/api/office/resolve',json('POST',{officeKey:demoKey}));
    assert.equal(d.status,200);
    assert.equal(d.data.office.name,'Northstar Support');
    assert.equal(d.data.office.branding.tagline,'Customer Experience');
    assert.equal(d.data.office.branding.logoUrl,null);
    assert.notEqual(d.data.office.branding.color,n.data.office.branding.color);

    const signed=await response(url,'/api/auth/login',
      json('POST',{officeKey:demoKey,email:'northstar-demo@cricket.example.test',password:demoPassword}));
    assert.equal(signed.status,200,JSON.stringify(signed.data));
    assert.equal(signed.data.user.role,'admin');
    assert.equal(signed.data.user.office.name,'Northstar Support');
    const cookie=signed.headers.get('set-cookie').split(';')[0];
    const workflow=await response(url,'/api/office/workflow',{headers:{Cookie:cookie}});
    assert.equal(workflow.status,200);
    assert.equal(workflow.data.office.workflowTemplate,'starter');
    assert.deepEqual(workflow.data.office.routes.map(r=>r.name),[
      'Order Status Inquiry','Refund Request','Delivery Issue','Product Exchange',
      'Billing Question','Supervisor Escalation'
    ]);
    assert.equal((await response(url,'/api/dashboard',{headers:{Cookie:cookie}})).data.total,0);
    assert.equal((await response(url,'/api/cases',{headers:{Cookie:cookie}})).data.total,0);
    assert.equal((await fetch(url+'/inbound.js',{headers:{Cookie:cookie}})).status,403);

    const db=new DatabaseSync(path.join(dir,'cricket.db'));
    const offices=db.prepare('SELECT slug,brand_tagline,brand_color FROM offices ORDER BY id').all();
    assert.equal(offices.length,2);
    assert.deepEqual(offices.map(x=>x.slug),['neutrauma','northstar-support']);
    assert.notEqual(offices[0].brand_color,offices[1].brand_color);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE office_id=(SELECT id FROM offices WHERE slug='northstar-support')").get().n,1);
    db.close();

    await shutDown(proc);
    // Seeding is idempotent: a normal subsequent startup cannot issue another
    // password or overwrite the client's existing account.
    const port2=await availablePort();
    const second=spawn(process.execPath,['server/server.js'],{
      cwd:ROOT,env:{...env,PORT:String(port2)},stdio:['ignore','pipe','pipe']});
    let secondOutput='';
    second.stdout.on('data',chunk=>secondOutput+=String(chunk));
    try{
      await waitForServer('http://127.0.0.1:'+port2,second);
      assert.doesNotMatch(secondOutput,/NORTHSTAR DEMO OFFICE/);
    }finally{await shutDown(second);}
  }finally{
    if(proc.exitCode===null)await shutDown(proc);
    fs.rmSync(dir,{recursive:true,force:true});
  }
  assert.equal(stderr,'');
});
