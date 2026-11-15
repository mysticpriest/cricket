'use strict';
// Integration test for optional HTTPS development hosting.
// A throwaway OpenSSL certificate is used in CI; it is NOT part of Cricket.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const https=require('node:https');
const {spawn,spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const keys='TEST-LAN-TLS-NEUTRAUMA-KEY-2026';
const email='lan-https-admin@example.test';
const password='lan-https-admin-password-2026';
const passphrase='temporary-test-pfx-password';
function available(){return spawnSync('openssl',['version'],{encoding:'utf8'}).status===0;}
async function port(){
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});
 });
}
function request(port,endpoint,method='GET',body){
 return new Promise((resolve,reject)=>{
  const origin='https://127.0.0.1:'+port;
  const data=body===undefined?null:JSON.stringify(body);
  const r=https.request(origin+endpoint,{
   method,headers:{
    ...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),
    Origin:origin
   },
   // ONLY for this throwaway self-signed test fixture. Never bypass
   // certificate verification in the Cricket client or server.
   rejectUnauthorized:false
  },response=>{
   let text='';
   response.on('data',x=>text+=String(x));
   response.on('end',()=>{
    let json={};try{json=JSON.parse(text);}catch(_){}
    resolve({status:response.statusCode,headers:response.headers,body:json});
   });
  });
  r.on('error',reject);
  if(data)r.write(data);
  r.end();
 });
}
test('Cricket can host LAN HTTPS and accept secure-origin login with Secure cookies', {skip:!available()},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-https-'));
 const cert=path.join(dir,'test.crt'),key=path.join(dir,'test.key'),pfx=path.join(dir,'test.pfx');
 const portNumber=await port();
 let child,stderr='';
 try{
  const make=spawnSync('openssl',[
   'req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,
   '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'
  ],{encoding:'utf8'});
  assert.equal(make.status,0,make.stderr);
  const bundle=spawnSync('openssl',[
   'pkcs12','-export','-out',pfx,'-inkey',key,'-in',cert,
   '-passout','pass:'+passphrase
  ],{encoding:'utf8'});
  assert.equal(bundle.status,0,bundle.stderr);
  const env={...process.env,NODE_ENV:'development',
   HOST:'127.0.0.1',PORT:String(portNumber),CRICKET_DATA_DIR:path.join(dir,'data'),
   CRICKET_ADMIN_EMAIL:email,CRICKET_ADMIN_PASSWORD:password,
   CRICKET_NEUTRAUMA_OFFICE_KEY:keys,
   CRICKET_TLS_PFX:pfx,CRICKET_TLS_PFX_PASSWORD:passphrase};
  child=spawn(process.execPath,['server/server.js'],{
   cwd:ROOT,env,stdio:['ignore','pipe','pipe']
  });
  child.stderr.on('data',x=>stderr+=String(x));
  let ready=false;
  for(let i=0;i<90;i++){
   if(child.exitCode!==null)throw Error('HTTPS server exited: '+stderr.slice(0,800));
   try{
    const health=await request(portNumber,'/api/health');
    if(health.status===200){ready=true;break;}
   }catch(_){}
   await new Promise(resolve=>setTimeout(resolve,75));
  }
  assert.equal(ready,true,'TLS server should boot');
  const signed=await request(portNumber,'/api/auth/login','POST',
   {officeKey:keys,email,password});
  assert.equal(signed.status,200,JSON.stringify(signed.body));
  assert.match(signed.headers['set-cookie']?.join(';')||'',/;\s*Secure/i,
   'Session cookie must use Secure when locally hosted over HTTPS');
  assert.equal(signed.body.user.role,'admin');
  const css=await request(portNumber,'/fluent.css');
  assert.equal(css.status,200,'Login design stylesheet still works on HTTPS');
 }finally{
  if(child){
   child.kill('SIGTERM');
   await Promise.race([
    new Promise(r=>{if(child.exitCode!==null)r();else child.once('exit',r);}),
    new Promise(r=>setTimeout(r,1800))
   ]);
  }
  fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
});
