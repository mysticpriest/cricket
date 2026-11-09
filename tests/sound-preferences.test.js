'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const NKEY='NEUTRAUMA-SOUND-TEST-KEY-2026';
const PKEY='CRICKET-PLATFORM-SOUND-TEST-KEY-2026';
const json=(method,body,cookie)=>({
  method,
  headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},
  body:JSON.stringify(body)
});
async function req(origin,p,options={}){
  const result=await fetch(origin+p,options);
  let data=null;
  try{data=await result.json();}catch(_){}
  return {status:result.status,data,headers:result.headers};
}
const cookie=response=>{
  const values=response.headers.getSetCookie();
  const name=response.data.user?.role==='platform_admin'?'cricket_platform_session=':'cricket_session=';
  const item=values.find(x=>x.startsWith(name));
  assert.ok(item,'Expected authenticated session cookie');
  return item.split(';')[0];
};
async function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.listen(0,'127.0.0.1',()=>{
      const p=server.address().port;
      server.close(()=>resolve(p));
    });
    server.on('error',reject);
  });
}
async function wait(url,proc){
  for(let i=0;i<80;i++){
    if(proc.exitCode!==null)throw Error('Cricket exited unexpectedly');
    try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}
    await new Promise(resolve=>setTimeout(resolve,55));
  }
  throw Error('Cricket did not start');
}
async function login(url,officeKey,email,password){
  const response=await req(url,'/api/auth/login',json('POST',{officeKey,email,password}));
  assert.equal(response.status,200,JSON.stringify(response.data));
  return {cookie:cookie(response),user:response.data.user};
}
test('Sound settings are saved per employee and office across sessions without changing display settings',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-sound-'));
  const port=await freePort(),url='http://127.0.0.1:'+port;
  const proc=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT,
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),
      CRICKET_DATA_DIR:dir,CRICKET_NEUTRAUMA_OFFICE_KEY:NKEY,
      CRICKET_ADMIN_EMAIL:'sound-admin@example.test',
      CRICKET_ADMIN_PASSWORD:'sound-admin-password-secure',
      CRICKET_PLATFORM_ADMIN_EMAIL:'sound-platform@example.test',
      CRICKET_PLATFORM_ADMIN_PASSWORD:'sound-platform-password-secure',
      CRICKET_PLATFORM_OFFICE_KEY:PKEY,NODE_ENV:'development'},
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';
  proc.stderr.on('data',data=>stderr+=String(data));
  try{
    await wait(url,proc);
    const admin=await login(url,NKEY,'sound-admin@example.test','sound-admin-password-secure');
    const platform=await login(url,PKEY,'sound-platform@example.test','sound-platform-password-secure');
    const headers=c=>({Cookie:c});
    const defaults=await req(url,'/api/sound/preferences',{headers:headers(admin.cookie)});
    assert.equal(defaults.status,200);
    assert.deepEqual(defaults.data.preferences,{enabled:true,volume:25});

    const display=await req(url,'/api/preferences',{headers:headers(admin.cookie)});
    assert.equal(display.status,200);
    assert.ok(Object.hasOwn(display.data.preferences,'color'));
    assert.equal(Object.hasOwn(display.data.preferences,'enabled'),false);

    const updates=[
      {enabled:false,volume:35},
      {enabled:true,volume:0},
      {enabled:true,volume:100},
      {enabled:false,volume:35}
    ];
    for(const value of updates){
      const r=await req(url,'/api/sound/preferences',json('PATCH',value,admin.cookie));
      assert.equal(r.status,200,JSON.stringify(r.data));
      assert.deepEqual(r.data.preferences,value);
    }
    for(const bad of [
      {enabled:'false',volume:25},{enabled:true,volume:-1},
      {enabled:true,volume:101},{enabled:true,volume:22.5},
      {enabled:true},{enabled:true,volume:25,userId:admin.user.id},
      null,[true,25]
    ]){
      const r=await req(url,'/api/sound/preferences',json('PATCH',bad,admin.cookie));
      assert.equal(r.status,400,JSON.stringify(bad));
    }

    const agentCreate=await req(url,'/api/users',json('POST',{
      displayName:'Sound Test Agent',email:'sound-agent@example.test',
      role:'agent',password:'sound-agent-password-secure'
    },admin.cookie));
    assert.equal(agentCreate.status,201,JSON.stringify(agentCreate.data));
    const agent=await login(url,NKEY,'sound-agent@example.test','sound-agent-password-secure');
    const agentDefault=await req(url,'/api/sound/preferences',{headers:headers(agent.cookie)});
    assert.deepEqual(agentDefault.data.preferences,{enabled:true,volume:25});
    const agentUpdated=await req(url,'/api/sound/preferences',
      json('PATCH',{enabled:true,volume:50},agent.cookie));
    assert.equal(agentUpdated.status,200);
    const adminAgain=await login(url,NKEY,'sound-admin@example.test','sound-admin-password-secure');
    const adminSaved=await req(url,'/api/sound/preferences',{headers:headers(adminAgain.cookie)});
    assert.deepEqual(adminSaved.data.preferences,{enabled:false,volume:35},
      'Admin mute preference persists after new sign-in');
    const agentAgain=await login(url,NKEY,'sound-agent@example.test','sound-agent-password-secure');
    const agentSaved=await req(url,'/api/sound/preferences',{headers:headers(agentAgain.cookie)});
    assert.deepEqual(agentSaved.data.preferences,{enabled:true,volume:50},
      'Agent has an independently saved volume');

    const newOffice=await req(url,'/api/platform/offices',json('POST',{
      name:'Sound Demo Client',adminName:'Sound Client Owner',
      adminEmail:'sound-client@example.test',adminPassword:'sound-client-password-secure',
      routes:[{name:'Fictional Support',instructions:'Use fictional details.'}]
    },platform.cookie));
    assert.equal(newOffice.status,201,JSON.stringify(newOffice.data));
    const other=await login(url,newOffice.data.officeKey,'sound-client@example.test','sound-client-password-secure');
    const otherDefaults=await req(url,'/api/sound/preferences',{headers:headers(other.cookie)});
    assert.deepEqual(otherDefaults.data.preferences,{enabled:true,volume:25});
    assert.equal((await req(url,'/api/sound/preferences',{headers:headers(platform.cookie)})).status,403);
    assert.equal((await req(url,'/api/sound/preferences',{headers:{}})).status,401);
    const js=await fetch(url+'/sound-engine.js',{headers:headers(agent.cookie)});
    assert.equal(js.status,200);
    assert.match(js.headers.get('content-type'),/javascript/);
    assert.equal((await fetch(url+'/sound-engine.js')).status,401);
    assert.ok(!stderr.includes('Error:'),stderr);
  }finally{
    proc.kill('SIGTERM');
    await new Promise(resolve=>{
      if(proc.exitCode!==null)resolve();
      else{proc.once('exit',resolve);setTimeout(resolve,2500);}
    });
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
