'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Dashboard waits for personal layout even if employee authentication is instantaneous',async()=>{
  const script=read('script.js');
  const bootstrap=script.slice(script.lastIndexOf('(async () => {'));
  assert.ok(bootstrap.startsWith('(async () => {'));
  let resolveBoot,bootCalls=0,metricsCalls=0;
  const bootPromise=new Promise(resolve=>resolveBoot=resolve);
  const classes=new Set(),attributes={};
  const dashboard={classList:{add:n=>classes.add(n),contains:n=>classes.has(n)},
    setAttribute:(name,value)=>attributes[name]=value};
  const context={
    api:async()=>({user:{id:1,role:'agent',office:{id:1}}}),
    renderUser:()=>{},
    window:{CricketPersonalWorkspace:{boot:()=>{bootCalls++;return bootPromise;}}},
    dashboard,notice:{},loadMetrics:async()=>{metricsCalls++;},
    location:{replace(){}},CustomEvent:class{}
  };
  const running=vm.runInNewContext(bootstrap,context);
  await flush();
  assert.equal(bootCalls,1,'Personal workspace initialized without a one-time event');
  assert.equal(metricsCalls,0,'Metrics do not race the personal layout');
  assert.equal(attributes['aria-busy'],undefined,'Dashboard remains busy during layout retrieval');
  assert.ok(classes.has('ready'),'Loading shell remains visible');
  resolveBoot(true);
  await running;
  assert.equal(metricsCalls,1);
  assert.equal(attributes['aria-busy'],'false');
});

test('Personal workspace boot retries transient failures and coalesces duplicate calls',async()=>{
  const source=read('workspace-personal.js');
  const start=source.indexOf('  const delay=ms=>');
  const end=source.indexOf('\n})();',start);
  assert.ok(start>0&&end>start);
  const content=source.slice(start,end);
  let requests=0,mounts=0,draws=0;
  const classes=new Set();
  const data={ready:false,bootPromise:null,user:null,layout:null,notes:[],reminders:[],shift:null,serverOffset:0};
  const document={
    querySelector:selector=>selector?{}:null,
    body:{classList:{add:n=>classes.add(n)}}
  };
  const window={setInterval:()=>0};
  const context={data,document,window,Date,Promise,
    setTimeout:(cb)=>{cb();return 0;},
    api:async()=>{
      requests++;
      if(requests<3){const error=Error('Temporary server response');error.status=503;throw error;}
      return {layout:{version:2,widgets:[],nav:[]},notes:[],reminders:[],shift:null,serverTime:Date.now()};
    },
    defaultLayout:()=>({version:2}),
    mountDashboard:()=>{mounts++;},
    applyLayout:()=>{draws++;},drawNotes:()=>{draws++;},
    drawReminders:()=>{draws++;},drawShift:()=>{draws++;},
    feedback:()=>{}
  };
  vm.runInNewContext(content,context);
  assert.equal(typeof window.CricketPersonalWorkspace.boot,'function');
  const user={id:1,office:{id:1}};
  await Promise.all([window.CricketPersonalWorkspace.boot(user),window.CricketPersonalWorkspace.boot(user)]);
  assert.equal(requests,3,'Retry after temporary failures instead of losing the layout');
  assert.equal(mounts,1,'Concurrent boot attempts must not mount widgets twice');
  assert.equal(draws,4);
  assert.equal(data.ready,true);
  assert.equal(classes.has('ws-personal-ready'),true);
  await window.CricketPersonalWorkspace.boot(user);
  assert.equal(requests,3,'Already hydrated view should not fetch again');
});

test('Page loading is deterministic and raw template widgets never flash on refresh',()=>{
  const html=read('index.html'),script=read('script.js'),personal=read('workspace-personal.js');
  const css=read('workspace-personal.css');
  assert.ok(html.indexOf('src="workspace-personal.js"')<html.indexOf('src="script.js"'));
  assert.ok(script.includes('await window.CricketPersonalWorkspace.boot(user)'));
  assert.ok(!script.includes("dispatchEvent(new CustomEvent('cricket-dashboard-ready'"));
  assert.ok(personal.includes('window.CricketPersonalWorkspace=Object.freeze({boot})'));
  assert.ok(personal.includes('if(data.bootPromise)return data.bootPromise'));
  assert.ok(html.includes('id="wsPersonalLoadState"'));
  assert.ok(css.includes('body:not(.ws-personal-ready) .ws-raw-template'));
  for(const klass of ['stats ws-raw-template','live-agent-panel ws-raw-template','division-grid ws-raw-template','support-grid ws-raw-template'])
    assert.ok(html.includes(klass),klass);
  assert.ok(script.includes('Retry loading workspace'));
});

test('Every key workflow page includes portrait support and mobile menu is reachable',()=>{
  const files=['index.html','analytics.html','qc.html','operations.html',
    'cases.html','staff.html','inbound.html','outbound.html','office-workflow.html'];
  for(const page of files)assert.ok(read(page).includes('portrait-layout.css'),page);
  const responsive=read('portrait-layout.css');
  assert.ok(responsive.includes('(orientation:portrait)'));
  for(const selector of ['.ws-layout-grid','.an-graphs','.qc-content-grid','.ops-clock-row','.office-flow-layout'])
    assert.ok(responsive.includes(selector),selector);
  const index=read('index.html'),script=read('script.js'),css=read('workspace-personal.css');
  assert.ok(index.includes('id="wsMobileNavToggle"'));
  assert.ok(index.includes('id="wsMobileNavBackdrop"'));
  assert.ok(index.includes('id="wsMobileNavClose"'));
  assert.ok(script.includes('function setMobileNavigation(open)'));
  assert.ok(css.includes('.app-shell.ws-nav-open .sidebar'));
  assert.ok(css.includes('@media(max-width:850px)'));
});
