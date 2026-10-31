'use strict';
// Upgrade verification: an earlier Cricket database must remain readable.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(()=>resolve(port));
    });
    server.on('error',reject);
  });
}
async function waitReady(url) {
  for (let i=0;i<40;i++){
    try { if((await fetch(url+'/api/health')).ok)return; }catch(_){}
    await new Promise(resolve=>setTimeout(resolve,70));
  }
  throw Error('Could not start legacy-upgrade test server');
}
test('additive schema migration preserves older accounts and case history',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'cricket-upgrade-'));
  const oldDb=new DatabaseSync(path.join(dataDir,'cricket.db'));
  oldDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('agent','qc','admin')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT UNIQUE,
      agent_id INTEGER NOT NULL REFERENCES users(id),
      request_id TEXT UNIQUE,
      department TEXT NOT NULL,
      inquiry TEXT NOT NULL,
      route TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('resolved','pending')),
      note TEXT NOT NULL,
      events_json TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      created_at TEXT NOT NULL
    );
  `);
  const password='secure-legacy-admin-123';
  const salt=crypto.randomBytes(16).toString('hex');
  const hash='scrypt:'+salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
  oldDb.prepare('INSERT INTO users(email,role,password_hash,created_at) VALUES(?,?,?,?)')
    .run('legacy-admin@example.test','admin',hash,'2026-09-01T00:00:00Z');
  oldDb.prepare('INSERT INTO cases(case_id,agent_id,department,inquiry,route,outcome,note,events_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('CR-20260901-000001',1,'Clinic Information','Legacy call','legacy','resolved','This historical record must remain unchanged.','[]','2026-09-01T10:00:00Z');
  oldDb.close();
  const port=await availablePort();
  const url='http://127.0.0.1:'+port;
  const proc=spawn(process.execPath,['server/server.js'],{
    cwd:ROOT,env:{...process.env,CRICKET_DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port)},
    stdio:['ignore','pipe','pipe']
  });
  let stderr='';
  proc.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  try{
    await waitReady(url);
    const signedIn=await fetch(url+'/api/auth/login',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'legacy-admin@example.test',password})
    });
    assert.equal(signedIn.status,200);
    const payload=await signedIn.json();
    assert.equal(payload.user.displayName,'');
    const cookie=signedIn.headers.get('set-cookie').split(';')[0];
    const caseResp=await fetch(url+'/api/cases/CR-20260901-000001',{headers:{Cookie:cookie}});
    assert.equal(caseResp.status,200);
    const legacy=await caseResp.json();
    assert.equal(legacy.case.note,'This historical record must remain unchanged.');
    assert.equal(legacy.case.callPhone,null);
    assert.equal(legacy.case.callStartedAt,null);
    const patched=await fetch(url+'/api/users/1',{
      method:'PATCH',
      headers:{'Content-Type':'application/json',Cookie:cookie},
      body:JSON.stringify({displayName:'Legacy Admin'})
    });
    assert.equal(patched.status,200);
    const refreshed=await fetch(url+'/api/auth/me',{headers:{Cookie:cookie}});
    assert.equal((await refreshed.json()).user.displayName,'Legacy Admin');
  }finally{
    proc.kill('SIGTERM');
    await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else{proc.once('exit',resolve);setTimeout(resolve,2000);}});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
  assert.ok(!stderr.includes('Error:'), stderr);
});