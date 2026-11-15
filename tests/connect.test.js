'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const K='CONNECT-DEFAULT-OFFICE-KEY-2026';
const PK='CONNECT-PLATFORM-OFFICE-KEY-2026';
async function port(){
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const p=server.address().port;server.close(()=>resolve(p));
  });
 });
}
async function http(base,path,method='GET',data,cookie,signal){
 const res=await fetch(base+path,{
  method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),
    ...(cookie?{Cookie:cookie}:{})},
  ...(data!==undefined?{body:JSON.stringify(data)}:{}),signal
 });
 let json={};try{json=await res.json();}catch(_){}
 return {status:res.status,body:json,headers:res.headers};
}
const ck=result=>result.headers.get('set-cookie')?.split(';')[0];
async function login(base,key,email,password){
 const res=await http(base,'/api/auth/login','POST',{officeKey:key,email,password});
 assert.equal(res.status,200,'Login '+email+' '+JSON.stringify(res.body));
 return ck(res);
}
async function started(base,child){
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw Error('Cricket server quit before startup');
  try{if((await fetch(base+'/api/health')).ok)return;}catch(_){}
  await new Promise(r=>setTimeout(r,75));
 }
 throw Error('Could not start Cricket server');
}
function openEvents(base,cookie){
 const ctrl=new AbortController();
 return fetch(base+'/api/connect/events',{headers:{Cookie:cookie},signal:ctrl.signal})
  .then(res=>{
   assert.equal(res.status,200,'SSE access');
   const reader=res.body.getReader();let buffer='';
   return {
    ctrl,
    async next(predicate=()=>true){
     const guard=setTimeout(()=>ctrl.abort(),6000);
     try{
      for(;;){
       let cut=buffer.indexOf('\n\n');
       if(cut<0){
        const value=await reader.read();
        if(value.done)throw Error('SSE ended before expected event');
        buffer+=Buffer.from(value.value).toString('utf8');
        cut=buffer.indexOf('\n\n');
        if(cut<0)continue;
       }
       const item=buffer.slice(0,cut).replace(/\r/g,'');
       buffer=buffer.slice(cut+2);
       const line=item.split('\n').find(x=>x.startsWith('data: '));
       if(!line)continue;
       const data=JSON.parse(line.slice(6));
       if(predicate(data))return data;
      }
     }finally{clearTimeout(guard);}
    },
    close(){ctrl.abort();}
   };
  });
}
test('Connect: tenant isolation, optional subscription, private messages and live WebRTC signaling',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-connect-'));
 const p=await port(),base='http://127.0.0.1:'+p;
 const env={...process.env,HOST:'127.0.0.1',PORT:String(p),NODE_ENV:'development',
  CRICKET_DATA_DIR:dir,CRICKET_ADMIN_EMAIL:'connect-admin@example.test',
  CRICKET_ADMIN_PASSWORD:'connect-administrator-password-2026',
  CRICKET_NEUTRAUMA_OFFICE_KEY:K,
  CRICKET_PLATFORM_ADMIN_EMAIL:'connect-platform@example.test',
  CRICKET_PLATFORM_ADMIN_PASSWORD:'connect-platform-password-2026',
  CRICKET_PLATFORM_OFFICE_KEY:PK};
 const child=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',x=>stderr+=String(x));
 let stream=null;
 try{
  await started(base,child);
  const admin=await login(base,K,env.CRICKET_ADMIN_EMAIL,env.CRICKET_ADMIN_PASSWORD);
  const platform=await login(base,PK,env.CRICKET_PLATFORM_ADMIN_EMAIL,env.CRICKET_PLATFORM_ADMIN_PASSWORD);
  const me=await http(base,'/api/modules/me','GET',undefined,admin);
  const office=me.body.office.id;
  assert.equal(me.body.modules.find(x=>x.key==='communications').enabled,false);
  assert.equal((await http(base,'/connect.html','GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/connect.js','GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/connect-alerts.js','GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/connect-alerts.css','GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/api/connect/bootstrap','GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/api/connect/bootstrap','GET',undefined,platform)).status,403);
  const enabled=await http(base,'/api/platform/offices/'+office+'/modules/communications',
   'PATCH',{enabled:true},platform);
  assert.equal(enabled.status,200);
  assert.equal((await http(base,'/connect.html','GET',undefined,admin)).status,200);
  assert.equal((await http(base,'/connect-alerts.js','GET',undefined,admin)).status,200);
  assert.equal((await http(base,'/connect-alerts.css','GET',undefined,admin)).status,200);
  const userCreated=await http(base,'/api/users','POST',{
   displayName:'Connect Agent',email:'connect-agent@example.test',password:'connect-agent-password-2026',role:'agent'
  },admin);
  assert.equal(userCreated.status,201,JSON.stringify(userCreated.body));
  const agent=await login(base,K,'connect-agent@example.test','connect-agent-password-2026');
  const one=await http(base,'/api/connect/bootstrap','GET',undefined,admin);
  const two=await http(base,'/api/connect/bootstrap','GET',undefined,agent);
  assert.equal(one.status,200);
  assert.equal(two.status,200);
  const adminId=one.body.self.id,agentId=two.body.self.id;
  assert.equal(one.body.staff.some(x=>x.id===agentId),true);
  assert.equal(two.body.staff.some(x=>x.id===adminId),true);
  assert.ok(Array.isArray(one.body.iceServers));
  stream=await openEvents(base,agent);
  const ready=await stream.next(x=>x.type==='ready');
  assert.equal(ready.type,'ready');
  const created=await http(base,'/api/connect/messages','POST',{
   recipientId:agentId,body:'Hello from Connect!'
  },admin);
  assert.equal(created.status,201,JSON.stringify(created.body));
  const event=await stream.next(x=>x.type==='message');
  assert.equal(event.from,adminId);
  const inbox=await http(base,'/api/connect/messages?peer='+adminId,'GET',undefined,agent);
  assert.equal(inbox.body.messages.length,1);
  assert.equal(inbox.body.messages[0].body,'Hello from Connect!');
  assert.equal((await http(base,'/api/connect/messages?peer='+99999,'GET',undefined,agent)).status,404);
  assert.equal((await http(base,'/api/connect/messages','POST',{recipientId:agentId,body:'x'},agent)).status,400);
  assert.equal((await http(base,'/api/connect/messages','POST',{recipientId:adminId,body:'z'.repeat(2001)},agent)).status,400);

  const invited=await http(base,'/api/connect/calls','POST',{recipientId:agentId,kind:'video'},admin);
  assert.equal(invited.status,201);
  const callId=invited.body.call.id;
  const incoming=await stream.next(x=>x.type==='call'&&x.action==='incoming');
  assert.equal(incoming.call.id,callId);
  const caller=await http(base,'/api/connect/calls','GET',undefined,admin);
  assert.equal(caller.body.call.state,'ringing');
  assert.equal((await http(base,'/api/connect/calls/'+callId+'/signal','POST',{
   type:'offer',payload:{type:'offer',sdp:'v=0\\r\\nm=audio\\r\\n'}},admin)).status,409,
   'Cannot signal before call acceptance');
  const accepted=await http(base,'/api/connect/calls/'+callId+'/respond','POST',{accept:true},agent);
  assert.equal(accepted.status,200);
  const result=await http(base,'/api/connect/calls/'+callId+'/signal','POST',{
   type:'offer',payload:{type:'offer',sdp:'v=0\\r\\nm=audio\\r\\n'}},admin);
  assert.equal(result.status,200,JSON.stringify(result.body));
  const signaling=await stream.next(x=>x.type==='signal');
  assert.equal(signaling.signalType,'offer');
  assert.equal(signaling.from,adminId);
  assert.equal((await http(base,'/api/connect/calls/'+callId+'/signal','POST',{
   type:'ice',payload:{candidate:{bad:true}}},agent)).status,400);
  const ended=await http(base,'/api/connect/calls/'+callId+'/hangup','POST',{},agent);
  assert.equal(ended.status,200);
  assert.equal((await http(base,'/api/connect/calls','GET',undefined,admin)).body.call,null);

  // Platform users cannot see messages, and an unrelated client has independent
  // module flags and employees.
  const other=await http(base,'/api/platform/offices','POST',{
   name:'Connect Independent Office',adminName:'Second Administrator',
   adminEmail:'connect-second@example.test',adminPassword:'second-office-secure-pass-2026',
   routes:[{name:'Support',instructions:'Handle fictional support questions with approved office guidance.'}]
  },platform);
  assert.equal(other.status,201,JSON.stringify(other.body));
  const otherAdmin=await login(base,other.body.officeKey,
   'connect-second@example.test','second-office-secure-pass-2026');
  assert.equal((await http(base,'/api/connect/bootstrap','GET',undefined,otherAdmin)).status,403);
  const otherEnabled=await http(base,
   '/api/platform/offices/'+other.body.office.id+'/modules/communications',
   'PATCH',{enabled:true},platform);
  assert.equal(otherEnabled.status,200);
  const otherBoot=await http(base,'/api/connect/bootstrap','GET',undefined,otherAdmin);
  assert.equal(otherBoot.status,200);
  assert.deepEqual(otherBoot.body.staff,[]);
  assert.deepEqual(otherBoot.body.recent,[]);
  assert.equal((await http(base,'/api/connect/messages?peer='+adminId,'GET',undefined,otherAdmin)).status,404);
  assert.equal((await http(base,'/api/connect/messages','POST',{
   recipientId:adminId,body:'Cross tenant attempt'},otherAdmin)).status,404);
  // Disabling removes access immediately, including existing conversations.
  const disabled=await http(base,'/api/platform/offices/'+office+'/modules/communications',
   'PATCH',{enabled:false},platform);
  assert.equal(disabled.status,200);
  assert.equal((await http(base,'/api/connect/messages?peer='+agentId,'GET',undefined,admin)).status,403);
  assert.equal((await http(base,'/connect.html','GET',undefined,agent)).status,403);
  assert.equal((await http(base,'/connect-alerts.js','GET',undefined,agent)).status,403);
 }catch(e){e.message+=' | server stderr: '+stderr.slice(0,800);throw e;}
 finally{
  stream?.close();child.kill('SIGTERM');
  await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,2200))]);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
