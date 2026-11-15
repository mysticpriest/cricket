'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const ORIGIN='https://staging.demo.example';
const KEY='STAGING-NEUTRAUMA-OFFICE-KEY-2026';
async function availablePort(){
 return new Promise((resolve,reject)=>{
  const socket=net.createServer();socket.on('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});
 });
}
test('Cloud reverse-proxy production mode is HTTPS-origin locked, health checked and cookie secure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-stage-'));
 const port=await availablePort();
 const env={...process.env,CRICKET_DATA_DIR:dir,NODE_ENV:'production',
  PUBLIC_ORIGIN:ORIGIN,HOST:'127.0.0.1',PORT:String(port),
  CRICKET_ADMIN_EMAIL:'staging-demo@example.test',
  CRICKET_ADMIN_PASSWORD:'staging-demo-very-strong-pass-2026',
  CRICKET_NEUTRAUMA_OFFICE_KEY:KEY,
  CRICKET_PLATFORM_ADMIN_EMAIL:'staging-platform@example.test',
  CRICKET_PLATFORM_ADMIN_PASSWORD:'staging-platform-strong-pass-2026',
  CRICKET_PLATFORM_OFFICE_KEY:'STAGING-PLATFORM-KEY-PRIVATE-2026'};
 const child=spawn(process.execPath,['server/server.js'],{
  cwd:ROOT,env,stdio:['ignore','pipe','pipe']
 });
 let stderr='';child.stderr.on('data',d=>stderr+=String(d));
 const base='http://127.0.0.1:'+port;
 try{
  let ready=false;
  for(let i=0;i<90;i++){
   if(child.exitCode!==null)throw Error('Server crashed: '+stderr);
   try{
    const r=await fetch(base+'/api/health');
    if(r.ok){const data=await r.json();assert.equal(data.mode,'production');ready=true;break;}
   }catch(_){}
   await new Promise(r=>setTimeout(r,75));
  }
  assert.equal(ready,true,'Production backend must serve health');
  const payload=JSON.stringify({
   officeKey:KEY,email:env.CRICKET_ADMIN_EMAIL,password:env.CRICKET_ADMIN_PASSWORD
  });
  const login=await fetch(base+'/api/auth/login',{
   method:'POST',headers:{'Content-Type':'application/json',Origin:ORIGIN},body:payload
  });
  assert.equal(login.status,200,await login.text());
  assert.match(login.headers.get('set-cookie'),/;\s*Secure/i,
   'Secure cookie is essential when HTTPS terminates at reverse proxy');
  const cross=await fetch(base+'/api/auth/login',{
   method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:payload
  });
  assert.equal(cross.status,403,'Origin must match PUBLIC_ORIGIN');
  const data=await cross.json();
  assert.match(data.error,/origin/i);
 }finally{
  child.kill('SIGTERM');
  await Promise.race([
   new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);}),
   new Promise(resolve=>setTimeout(resolve,1800))
  ]);
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
