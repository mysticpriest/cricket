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
const NKEY='CRICKET-MODULES-NEUTRAUMA-KEY-2026';
const PKEY='CRICKET-MODULES-PLATFORM-KEY-2026';
function json(method,data,cookie){
  return {method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)};
}
async function http(origin,p,options={}){
  const res=await fetch(origin+p,options);
  let data={};try{data=await res.json();}catch(_){}
  return {status:res.status,data,headers:res.headers};
}
function cookie(result){return result.headers.get('set-cookie').split(';')[0];}
function port(){return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.listen(0,'127.0.0.1',()=>{const number=server.address().port;server.close(()=>resolve(number));});
  server.on('error',reject);
});}
async function ready(origin,child){
  for(let i=0;i<70;i++){
    if(child.exitCode!==null)throw Error('Cricket exited before startup');
    try{if((await fetch(origin+'/api/health')).ok)return;}catch(_){}
    await new Promise(r=>setTimeout(r,80));
  }
  throw Error('Cricket server did not start');
}
async function login(origin,key,email,password){
  const result=await http(origin,'/api/auth/login',json('POST',{officeKey:key,email,password}));
  assert.equal(result.status,200,email+' '+JSON.stringify(result.data));
  return cookie(result);
}
test('Modular subscriptions isolate offices, preserve existing access and enforce server-side entitlements and seat caps',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-modules-'));
  const number=await port(),origin='http://127.0.0.1:'+number;
  const child=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT,env:{...process.env,HOST:'127.0.0.1',PORT:String(number),CRICKET_DATA_DIR:dir,
      CRICKET_ADMIN_EMAIL:'mod-admin@example.test',CRICKET_ADMIN_PASSWORD:'modules-strong-admin-password',
      CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
      CRICKET_PLATFORM_ADMIN_EMAIL:'platform-mod@example.test',
      CRICKET_PLATFORM_ADMIN_PASSWORD:'platform-module-very-secure-password',
      CRICKET_PLATFORM_OFFICE_KEY:PKEY,NODE_ENV:'development'},
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';child.stderr.on('data',data=>stderr+=String(data));
  try{
    await ready(origin,child);
    const admin=await login(origin,NKEY,'mod-admin@example.test','modules-strong-admin-password');
    const platform=await login(origin,PKEY,'platform-mod@example.test','platform-module-very-secure-password');
    const headers=c=>({headers:{Cookie:c}});

    const mine=await http(origin,'/api/modules/me',headers(admin));
    assert.equal(mine.status,200);
    assert.equal(mine.data.pricing.draft,true);
    assert.equal(mine.data.seats.used,1);
    assert.equal(mine.data.modules.find(x=>x.key==='workflow_builder').enabled,true);
    assert.equal(mine.data.modules.find(x=>x.key==='communications').enabled,false);
    assert.equal((await http(origin,'/api/qc/work-later',headers(admin))).status,200);
    assert.equal((await http(origin,'/subscription.html',headers(admin))).status,200);
    assert.equal((await http(origin,'/api/platform/modules',headers(admin))).status,403);
    assert.equal((await http(origin,'/api/modules/me',headers(platform))).status,403);
    const list=await http(origin,'/api/platform/modules',headers(platform));
    assert.equal(list.status,200);
    assert.equal(list.data.catalog.find(x=>x.key==='communications').priceUsd,250);
    assert.equal(list.data.catalog.find(x=>x.key==='workflow_builder').priceUsd,400);
    assert.equal(list.data.catalog.find(x=>x.key==='quality_control').priceUsd,300);
    assert.equal(list.data.catalog.find(x=>x.key==='staff_accounts').priceUsd,100);
    assert.equal((await http(origin,'/subscription.html',headers(platform))).status,403);

    const officeId=mine.data.office.id;
    const bad=await http(origin,'/api/platform/offices/'+officeId+'/modules/communications',json('PATCH',{enabled:true},platform));
    assert.equal(bad.status,400,'Planned Connect cannot be enabled as a fake product');
    const disableQc=await http(origin,'/api/platform/offices/'+officeId+'/modules/quality_control',
      json('PATCH',{enabled:false},platform));
    assert.equal(disableQc.status,200);
    assert.equal(disableQc.data.modules.find(x=>x.key==='quality_control').enabled,false);
    assert.equal((await http(origin,'/api/qc/work-later',headers(admin))).status,403);
    assert.equal((await http(origin,'/qc.html',headers(admin))).status,403);
    assert.equal((await http(origin,'/api/cases',headers(admin))).status,200,
      'Case storage is a separate module, not disabled along with QC');

    const create=await http(origin,'/api/platform/offices',json('POST',{
      name:'Modular New Client',adminName:'Client Administrator',
      adminEmail:'mod-client@example.test',adminPassword:'new-client-secure-password',
      routes:[{name:'Support',instructions:'Use fictional request data for customer support.'}]
    },platform));
    assert.equal(create.status,201,JSON.stringify(create.data));
    const id=create.data.office.id;
    const client=await login(origin,create.data.officeKey,'mod-client@example.test','new-client-secure-password');
    const clientModules=await http(origin,'/api/modules/me',headers(client));
    assert.equal(clientModules.status,200);
    assert.equal(clientModules.data.modules.find(x=>x.key==='quality_control').enabled,true);
    assert.equal((await http(origin,'/api/qc/work-later',headers(client))).status,200,
      'Other office retains QC even if the original office disabled it');
    assert.equal((await http(origin,'/api/platform/offices/'+id+'/modules',headers(admin))).status,403,
      'Office admins cannot modify platform-managed entitlements');
    const disableWorkflow=await http(origin,'/api/platform/offices/'+id+'/modules/workflow_builder',
      json('PATCH',{enabled:false},platform));
    assert.equal(disableWorkflow.status,200);
    assert.equal((await http(origin,'/api/ops/workflows',headers(client))).status,403);
    assert.equal((await http(origin,'/workflow-runner.html',headers(client))).status,403);
    assert.equal((await http(origin,'/api/ops/team',headers(client))).status,200,
      'Disabling workflows does not disable team communications');
    assert.equal((await http(origin,'/api/ops/workflows',headers(admin))).status,200,
      'Changing one tenant cannot disable a separate tenant');

    const invalid=await http(origin,'/api/platform/offices/'+id+'/seats',
      json('PATCH',{limit:0},platform));
    assert.equal(invalid.status,400);
    const capped=await http(origin,'/api/platform/offices/'+id+'/seats',
      json('PATCH',{limit:1},platform));
    assert.equal(capped.status,200);
    assert.equal(capped.data.seats.limit,1);
    const seatBlocked=await http(origin,'/api/users',json('POST',{
      displayName:'Second User',email:'seat-blocked@example.test',
      password:'seat-cap-strong-password',role:'agent'
    },client));
    assert.equal(seatBlocked.status,409);
    const expanded=await http(origin,'/api/platform/offices/'+id+'/seats',
      json('PATCH',{limit:2},platform));
    assert.equal(expanded.status,200);
    const seatAllowed=await http(origin,'/api/users',json('POST',{
      displayName:'Second User',email:'seat-allowed@example.test',
      password:'seat-cap-strong-password',role:'agent'
    },client));
    assert.equal(seatAllowed.status,201);
    assert.equal((await http(origin,'/api/platform/offices/'+id+'/seats',
      json('PATCH',{limit:1},platform))).status,409,
      'Do not under-provision an office with existing staff accounts');
    const summary=await http(origin,'/api/platform/offices/'+id+'/modules',headers(platform));
    assert.equal(summary.data.seats.used,2);
    assert.equal(summary.data.seats.limit,2);
    assert.equal(summary.data.pricing.draft,true);
  }finally{
    child.kill('SIGTERM');
    await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);setTimeout(r,2500);});
    const dbPath=path.join(dir,'cricket.db');
    if(fs.existsSync(dbPath)){
      const db=new DatabaseSync(dbPath);
      const row=db.prepare("SELECT enabled FROM office_modules WHERE module_key='quality_control' AND office_id=(SELECT id FROM offices WHERE slug='neutrauma')").get();
      assert.equal(row?.enabled,0,'Changes must persist across server restarts');
      db.close();
    }
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
  }
});
