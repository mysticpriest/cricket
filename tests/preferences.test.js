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
const COLORS=new Set(['ocean','violet','emerald','rose','amber','teal','indigo','coral']);
async function availablePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
async function ready(url,proc){for(let n=0;n<50;n++){if(proc.exitCode!==null)throw Error('Server exited during startup');try{if((await fetch(url+'/api/health')).ok)return;}catch(_){}await new Promise(resolve=>setTimeout(resolve,70));}throw Error('Server failed to start');}
function json(method,data,cookie=''){return {method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)};}
async function request(url,p,opts={}){const r=await fetch(url+p,opts);let data;try{data=await r.json();}catch(_){data={};}return {status:r.status,data,headers:r.headers};}
const session=r=>r.headers.get('set-cookie').split(';')[0];

test('random account colors and private server-persisted display preferences',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-pref-'));
  const port=await availablePort();const url='http://127.0.0.1:'+port;
  const proc=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,
    CRICKET_DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port),
    CRICKET_ADMIN_EMAIL:'prefs-admin@example.test',CRICKET_ADMIN_PASSWORD:'secure-admin-preferences-pass'},
    stdio:['ignore','pipe','pipe']});
  let stderr='';proc.stderr.on('data',b=>{stderr+=b.toString();});
  try{
    await ready(url,proc);
    const anon=await request(url,'/api/preferences');
    assert.equal(anon.status,401);
    const anonPatch=await request(url,'/api/preferences',json('PATCH',{color:'violet'}));
    assert.equal(anonPatch.status,401);
    const login=await request(url,'/api/auth/login',json('POST',{email:'prefs-admin@example.test',password:'secure-admin-preferences-pass'}));
    assert.equal(login.status,200);
    const admin=session(login);
    const a=login.data.user.preferences;
    assert.ok(COLORS.has(a.color));
    assert.equal(a.mode,'personal');
    assert.equal(a.density,'comfortable');
    assert.equal(a.textSize,'standard');
    assert.equal(a.reduceMotion,false);
    const adminUsersBefore=await request(url,'/api/users',{headers:{Cookie:admin}});
    assert.equal(adminUsersBefore.status,200);
    assert.equal(adminUsersBefore.data.users[0].themeColor,a.color);
    const employees=[];
    for(const [email,role] of [['agent1@example.test','agent'],['agent2@example.test','agent'],['qc1@example.test','qc']]){
      const name=role==='qc'?'QC Tester':email.startsWith('agent1')?'Agent One':'Agent Two';
      const result=await request(url,'/api/users',json('POST',{email,role,displayName:name,password:'secure-staff-test-password'},admin));
      assert.equal(result.status,201);
      assert.ok(COLORS.has(result.data.user.themeColor));
      const logged=await request(url,'/api/auth/login',json('POST',{email,password:'secure-staff-test-password'}));
      assert.equal(logged.status,200);
      assert.equal(logged.data.user.preferences.color,result.data.user.themeColor);
      employees.push({cookie:session(logged),id:result.data.user.id,assigned:result.data.user.themeColor,role});
    }
    const agent1=employees[0],agent2=employees[1],qc=employees[2];
    const originalAgent2=await request(url,'/api/preferences',{headers:{Cookie:agent2.cookie}});
    assert.equal(originalAgent2.data.preferences.color,agent2.assigned);
    const preferences={color:'coral',mode:'personal',density:'compact',textSize:'extra-large',reduceMotion:true};
    const save=await request(url,'/api/preferences',json('PATCH',preferences,agent1.cookie));
    assert.equal(save.status,200);
    assert.deepEqual(save.data.preferences,preferences);
    const check1=await request(url,'/api/auth/me',{headers:{Cookie:agent1.cookie}});
    assert.deepEqual(check1.data.user.preferences,preferences);
    const check2=await request(url,'/api/preferences',{headers:{Cookie:agent2.cookie}});
    assert.deepEqual(check2.data.preferences,originalAgent2.data.preferences,'Other agent appearance must not change');
    const qcPrefs=await request(url,'/api/preferences',{headers:{Cookie:qc.cookie}});
    assert.equal(qcPrefs.data.preferences.color,qc.assigned);
    const legacy=await request(url,'/api/preferences',json('PATCH',{...preferences,mode:'legacy'},agent1.cookie));
    assert.equal(legacy.status,200);
    assert.equal(legacy.data.preferences.mode,'legacy');
    assert.equal(legacy.data.preferences.color,'coral','Switching to legacy must preserve selected personal color');
    const modern=await request(url,'/api/preferences',json('PATCH',{...preferences,mode:'personal'},agent1.cookie));
    assert.equal(modern.data.preferences.color,'coral');
    for(const patch of [
      {...preferences,color:'javascript:alert(1)'},
      {...preferences,color:'#ff0000'},
      {...preferences,density:'unknown'},
      {...preferences,mode:'dark'},
      {...preferences,textSize:'huge'},
      {...preferences,reduceMotion:'true'},
      {...preferences,userId:agent2.id},
      {color:'ocean'}
    ]){
      const rejected=await request(url,'/api/preferences',json('PATCH',patch,agent1.cookie));
      assert.equal(rejected.status,400,JSON.stringify(patch)+' must be rejected');
    }
    assert.deepEqual((await request(url,'/api/preferences',{headers:{Cookie:agent1.cookie}})).data.preferences,preferences);
    const newLogin=await request(url,'/api/auth/login',json('POST',{email:'agent1@example.test',password:'secure-staff-test-password'}));
    assert.deepEqual(newLogin.data.user.preferences,preferences,'Preferences persist across new sessions');
    // Authoritative storage on disk, not browser-only state.
    const database=new DatabaseSync(path.join(dataDir,'cricket.db'));
    const stored=database.prepare('SELECT theme_color,theme_mode,ui_density,text_size,reduce_motion FROM users WHERE id=?').get(agent1.id);
    assert.deepEqual({...stored},{theme_color:'coral',theme_mode:'personal',ui_density:'compact',text_size:'extra-large',reduce_motion:1});
    const audit=database.prepare("SELECT action FROM audit_events WHERE actor_id=? AND action='display_preferences_updated'").all(agent1.id);
    assert.ok(audit.length>=3);
    database.close();
    for(const file of ['/index.html','/inbound.html','/qc.html','/analytics.html','/cases.html','/staff.html','/outbound.html','/operations.html']){
      const cookie=file==='/qc.html'?qc.cookie:file==='/staff.html'||file==='/operations.html'||file==='/cases.html'?admin:agent1.cookie;
      const page=await fetch(url+file,{headers:{Cookie:cookie},redirect:'manual'});
      assert.equal(page.status,200,file+' should be accessible with allowed role');
      const html=await page.text();
      assert.match(html,/settings\.css/);
      assert.match(html,/settings\.js/);
    }
    const gear=await fetch(url+'/settings.js',{headers:{Cookie:agent1.cookie}});
    const style=await fetch(url+'/settings.css',{headers:{Cookie:agent1.cookie}});
    assert.equal(gear.status,200);assert.equal(style.status,200);
    const unauth=await fetch(url+'/settings.js');
    assert.equal(unauth.status,401);
  }finally{
    proc.kill('SIGTERM');
    await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else{proc.once('exit',resolve);setTimeout(resolve,2500);}});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
  assert.ok(!stderr.includes('Error:'),stderr);
});
