'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

const ROOT=path.resolve(__dirname,'..');
test('all browser scripts parse as JavaScript without execution',()=>{
  const scripts=['script.js','login.js','inbound.js','qc.js','staff.js','cases.js',
    'qc-bridge.js','session-guard.js','presence-client.js','live-agents.js','operations.js'];
  for(const file of scripts){
    assert.ok(fs.existsSync(path.join(ROOT,file)),file+' must exist');
    const result=spawnSync(process.execPath,['--check',path.join(ROOT,file)],{encoding:'utf8'});
    assert.equal(result.status,0,file+' syntax error:\n'+result.stderr);
  }
});
test('live operations and shared dashboards load the presence components',()=>{
  for(const page of ['index.html','inbound.html','qc.html','cases.html','staff.html','outbound.html']){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.match(html,/presence-client\.js/,page+' missing presence reporting');
    assert.match(html,/session-guard\.js/,page+' missing inactivity guard');
  }
  for(const page of ['index.html','qc.html']){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.match(html,/live-agents\.js/,page+' missing live presence UI');
    assert.match(html,/data-live-agents/,page+' missing live presence container');
  }
  const admin=fs.readFileSync(path.join(ROOT,'operations.html'),'utf8');
  assert.match(admin,/operations\.js/);
  assert.match(admin,/opsAuditList/);
});
