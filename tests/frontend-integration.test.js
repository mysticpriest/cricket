'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');

const ROOT=path.resolve(__dirname,'..');
test('all browser scripts parse as JavaScript without execution',()=>{
  const scripts=['script.js','login.js','inbound.js','qc.js','staff.js','cases.js',
    'qc-bridge.js','session-guard.js','presence-client.js','live-agents.js','operations.js','analytics.js','qc-insights.js','settings.js','office.js','office-workflow.js','platform.js','workspace-personal.js','shift-operations.js',
    'server/analytics.js','server/offices.js','server/personal-workspace.js'];
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
test('analytics is linked for all roles, with a protected QC reporting scope',()=>{
  const dashboard=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const qc=fs.readFileSync(path.join(ROOT,'qc.html'),'utf8');
  const analytics=fs.readFileSync(path.join(ROOT,'analytics.html'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  const login=fs.readFileSync(path.join(ROOT,'login.js'),'utf8');
  assert.match(dashboard,/href="analytics\.html" data-access="agent,qc,admin"/);
  assert.match(qc,/href="analytics\.html"/);
  assert.match(analytics,/session-guard\.js/);
  assert.match(analytics,/presence-client\.js/);
  assert.match(analytics,/analytics\.js/);
  assert.doesNotMatch(analytics,/analyticsQcTab/);
  assert.match(qc,/qcInsightsTitle/);
  assert.match(server,/\/api\/analytics\/agents/);
  assert.match(server,/\/api\/analytics\/qc/);
  assert.match(login,/analytics\.html/);
});

test('all protected workspaces have persistent, shared appearance controls',()=>{
  const pages=['index.html','inbound.html','qc.html','analytics.html','cases.html','staff.html','outbound.html','operations.html'];
  for(const page of pages){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.match(html,/settings\.css/,page+' missing appearance styles');
    assert.match(html,/settings\.js/,page+' missing settings menu');
  }
  const settings=fs.readFileSync(path.join(ROOT,'settings.js'),'utf8');
  assert.match(settings,/CricketAppearance/);
  assert.match(settings,/\/api\/preferences/);
  assert.match(settings,/cricket-theme-updated/);
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  assert.match(server,/\/api\/preferences/);
  assert.match(server,/theme_color/);
});

test('Agent Analytics is cube-based while QC insights live exclusively on QC dashboard',()=>{
  const agentPage=fs.readFileSync(path.join(ROOT,'analytics.html'),'utf8');
  const qcPage=fs.readFileSync(path.join(ROOT,'qc.html'),'utf8');
  const agentCode=fs.readFileSync(path.join(ROOT,'analytics.js'),'utf8');
  const qcCode=fs.readFileSync(path.join(ROOT,'qc-insights.js'),'utf8');
  assert.match(agentPage,/analyticsAgentCubes/);
  assert.doesNotMatch(agentPage,/analyticsQcTab/);
  assert.doesNotMatch(agentPage,/analyticsTeamRows/);
  assert.match(qcPage,/qcInsightsTitle/);
  assert.match(qcPage,/qc-insights\.js/);
  assert.match(qcCode,/\/api\/analytics\/qc/);
  assert.match(agentCode,/an-agent-stat-cube/);
  assert.match(agentCode,/\/api\/analytics\/agents/);
  assert.match(agentPage,/analyticsSeriesLegend/);
  assert.doesNotMatch(agentPage,/analyticsBarView|analyticsOutcome|>Resolved<|>Pending</);
  assert.match(agentCode,/agentSeries/);
  assert.match(agentCode,/an-agent-chart-line/);
  assert.match(agentCode,/const CUBE_METRICS=/);
  const metrics=agentCode.match(/const CUBE_METRICS=\[([\s\S]*?)\];/);
  assert.ok(metrics,'Compact agent cube definitions must exist');
  assert.deepEqual([...metrics[1].matchAll(/\['(total|inbound|outbound)'/g)].map(match=>match[1]),
    ['total','inbound','outbound']);
  assert.doesNotMatch(metrics[1],/resolved|pending/);
  assert.doesNotMatch(agentCode,/A\.barView|A\.lineView/);
});
test('case records and IDs are hidden from agents by both UI and backend',()=>{
  const dashboard=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const inbound=fs.readFileSync(path.join(ROOT,'inbound.html'),'utf8');
  const bridge=fs.readFileSync(path.join(ROOT,'qc-bridge.js'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server/server.js'),'utf8');
  assert.match(dashboard,/href="cases\.html" data-access="admin"/);
  assert.doesNotMatch(inbound,/href="cases\.html"/);
  assert.doesNotMatch(bridge,/My cases/);
  assert.match(server,/\/cases\.html', \['admin'\]/);
  assert.match(server,/user\.role==='agent' \? \{ saved:true/);
});

test('multi-client Office Key entry, starter routes and platform console are wired',()=>{
  const office=fs.readFileSync(path.join(ROOT,'office.html'),'utf8');
  const login=fs.readFileSync(path.join(ROOT,'login.html'),'utf8');
  const starter=fs.readFileSync(path.join(ROOT,'office-workflow.html'),'utf8');
  const platform=fs.readFileSync(path.join(ROOT,'platform.html'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  const dashboard=fs.readFileSync(path.join(ROOT,'script.js'),'utf8');
  assert.match(office,/officeKeyForm/);
  assert.match(office,/office\.js/);
  assert.match(login,/officeLoginName/);
  assert.match(starter,/officeRoutes/);
  assert.match(platform,/platformCreateForm/);
  assert.match(server,/\/api\/office\/resolve/);
  assert.match(server,/\/api\/platform\/offices/);
  assert.match(server,/currentPlatform/);
  assert.ok(dashboard.includes('office?.workflowTemplate'));
});
test('client branded login, supplied NeuTrauma logo, and Northstar template are wired',()=>{
  const office=fs.readFileSync(path.join(ROOT,'office.html'),'utf8');
  const officeJs=fs.readFileSync(path.join(ROOT,'office.js'),'utf8');
  const login=fs.readFileSync(path.join(ROOT,'login.html'),'utf8');
  const loginJs=fs.readFileSync(path.join(ROOT,'login.js'),'utf8');
  const platform=fs.readFileSync(path.join(ROOT,'platform.html'),'utf8');
  const platformJs=fs.readFileSync(path.join(ROOT,'platform.js'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  const offices=fs.readFileSync(path.join(ROOT,'server','offices.js'),'utf8');
  const asset=path.join(ROOT,'assets','neutrauma-logo.webp');
  assert.match(office,/officeHandoff/);
  assert.match(officeJs,/showOfficeHandoff/);
  assert.match(officeJs,/prefers-reduced-motion/);
  assert.match(login,/clientBrandImage/);
  assert.ok(login.includes('login.css'));
  assert.match(loginJs,/applyClientBrand/);
  assert.ok(loginJs.includes('neutrauma-logo.webp'));
  assert.ok(fs.statSync(asset).size>2000);
  assert.ok(server.includes("'image/webp'"));
  assert.match(server,/brandForRow/);
  assert.match(server,/CRICKET_SEED_DEMO_OFFICE/);
  assert.match(platform,/platformLoadDemo/);
  assert.match(platformJs,/branding/);
  assert.match(offices,/DEMO_ROUTES/);
  assert.match(offices,/brand_tagline/);
});

test('personal workspace controls and admin time clocks are included with role-based protection',()=>{
  const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const client=fs.readFileSync(path.join(ROOT,'workspace-personal.js'),'utf8');
  const operations=fs.readFileSync(path.join(ROOT,'operations.html'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  const personal=fs.readFileSync(path.join(ROOT,'server','personal-workspace.js'),'utf8');
  assert.match(index,/id="workspaceTiles"/);
  assert.match(index,/id="wsCustomize"/);
  assert.ok(index.includes('workspace-personal.js'));
  assert.match(client,/wsStickyList/);
  assert.match(client,/wsReminderList/);
  assert.match(client,/wsShiftStatus/);
  assert.match(client,/persistLayout/);
  for(const action of ['start_shift','break','meeting','system_issues','end_shift'])
    assert.ok(client.includes(action));
  assert.match(operations,/id="opsShiftRoster"/);
  assert.ok(operations.includes('shift-operations.js'));
  assert.match(server,/setupPersonalWorkspace/);
  assert.match(server,/personalWorkspaceRoute/);
  assert.ok(server.includes("'/shift-operations.js'"));
  assert.match(personal,/idx_work_shifts_one_open/);
  assert.ok(personal.includes('/api/admin/shifts'));
});
test('every rearrangeable dashboard block and tab uses nine dots with brush below',()=>{
  const client=fs.readFileSync(path.join(ROOT,'workspace-personal.js'),'utf8');
  const css=fs.readFileSync(path.join(ROOT,'workspace-personal.css'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  assert.ok(client.includes('for(let i=0;i<9;i++)grid.append(make'));
  assert.ok(client.includes("function beginPointerDrag("));
  assert.ok(client.includes("window.addEventListener('pointermove',move"));
  assert.ok(client.includes("window.addEventListener('pointerup',end"));
  assert.ok(client.includes("function toolRail(kind,id,name,host,container,selector)"));
  assert.ok(client.includes("toolRail('widgets'"));
  assert.ok(client.includes("toolRail('nav'"));
  assert.ok(client.includes("toolRail('notes'"));
  assert.ok(client.includes("persistNoteOrder()"));
  assert.ok(client.includes("setEntry(kind,id,{color})"));
  assert.ok(css.includes('.ws-action-rail{display:flex;flex-direction:column'));
  assert.ok(css.includes('.ws-color-swatches'));
  assert.ok(css.includes('.ws-floating-ghost'));
  assert.ok(html.includes('Custom Layout'));
  assert.ok(html.includes('wsCustomizeBackdrop'));
  assert.ok(html.includes('wsCustomizePanel'));
  assert.ok(!html.includes('Normal shift workflow'));
  assert.match(client,/aria-expanded/);
});

test('new Custom Layout library starts with Workspace Tabs, supports add/remove and full gradients',()=>{
  const client=fs.readFileSync(path.join(ROOT,'workspace-personal.js'),'utf8');
  const css=fs.readFileSync(path.join(ROOT,'workspace-personal.css'),'utf8');
  const backend=fs.readFileSync(path.join(ROOT,'server','personal-workspace.js'),'utf8');
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  assert.ok(html.includes('Custom Layout'));
  assert.ok(!html.includes('Your shift, step by step'));
  assert.ok(!client.includes('Shift walkthrough'));
  assert.ok(!backend.includes("'guide'"));
  assert.ok(client.includes("version:2"));
  assert.ok(client.includes("hidden:id!=='divisions'"));
  assert.ok(backend.includes("hidden:id!=='divisions'"));
  assert.ok(client.includes('function addWidget(id)'));
  assert.ok(client.includes('function removeWidget(id)'));
  assert.ok(client.includes('function setLibraryOpen(open)'));
  assert.ok(client.includes('function renderEditor()'));
  assert.ok(css.includes('.ws-catalog-item'));
  assert.ok(css.includes('.ws-customize-panel[hidden]'));
  assert.ok(css.includes('linear-gradient(135deg,'));
  assert.ok(css.includes('.ws-division-shell>.division{'));
  assert.ok(css.includes('.sidebar .ws-nav-row>.nav-item{'));
  assert.ok(css.includes('.ws-note-card{'));
});
