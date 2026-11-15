'use strict';
// Cricket modular SaaS foundation. Catalog prices are DRAFT USD/month,
// not charges or subscriptions. No payment processor is connected.
const CATALOG=Object.freeze([
  {key:'workflow_builder',name:'Workflow Builder',description:'Inbound, outbound and guided workflows',status:'available',priceUsd:400,unit:'office'},
  {key:'quality_control',name:'Quality Control',description:'Review queues, scorecards and coaching',status:'available',priceUsd:300,unit:'office'},
  {key:'case_management',name:'Case Management',description:'Office-scoped case records and archive',status:'available',priceUsd:null,unit:'office'},
  {key:'analytics',name:'Analytics',description:'Team and QC performance reports',status:'available',priceUsd:null,unit:'office'},
  {key:'team_hub',name:'Team Hub',description:'Existing announcements and basic colleague messages',status:'available',priceUsd:null,unit:'office'},
  {key:'workforce',name:'Workforce',description:'Shifts, schedules and live operations',status:'available',priceUsd:null,unit:'office'},
  {key:'staff_accounts',name:'Staff Accounts',description:'User seats and administrative controls',status:'core',priceUsd:100,unit:'seat'},
  {key:'communications',name:'Cricket Connect',description:'Future standalone chat, voice/video and screen sharing',status:'planned',priceUsd:250,unit:'office'}
]);
const BY_KEY=new Map(CATALOG.map(m=>[m.key,m]));
const ACCESS_PATHS=Object.freeze({
  '/analytics.html':'analytics','/analytics.js':'analytics','/analytics.css':'analytics',
  '/qc.html':'quality_control','/qc.js':'quality_control','/qc-insights.js':'quality_control',
  '/qc.css':'quality_control','/cases.html':'case_management','/cases.js':'case_management',
  '/inbound.html':'workflow_builder','/inbound.js':'workflow_builder','/inbound.css':'workflow_builder',
  '/outbound.html':'workflow_builder','/office-workflow.html':'workflow_builder',
  '/office-workflow.js':'workflow_builder','/office-workflow.css':'workflow_builder',
  '/workflow-runner.html':'workflow_builder','/workflow-builder.html':'workflow_builder',
  '/team-hub.html':'team_hub','/workforce.html':'workforce',
  '/operations.html':'workforce','/operations.js':'workforce','/operations.css':'workforce'
});
function moduleForApi(p){
  if(p.startsWith('/api/ops/workflows'))return 'workflow_builder';
  if(p.startsWith('/api/ops/team'))return 'team_hub';
  if(p.startsWith('/api/ops/workforce'))return 'workforce';
  if(p==='/api/admin/shifts'||p==='/api/admin/operations'||p==='/api/active-agents')return 'workforce';
  if(p.startsWith('/api/qc/')||/^\/api\/cases\/[^/]+\/reviews$/.test(p))return 'quality_control';
  if(p==='/api/cases'||p.startsWith('/api/cases/'))return 'case_management';
  if(p.startsWith('/api/analytics/'))return 'analytics';
  return null;
}
function moduleForAsset(path){return ACCESS_PATHS[path]||null;}
function fail(status,message){const e=Error(message);e.status=status;throw e;}
function install(db){
  db.exec("CREATE TABLE IF NOT EXISTS office_modules ("+
    "office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,"+
    "module_key TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),"+
    "updated_at TEXT NOT NULL,PRIMARY KEY(office_id,module_key))");
  db.exec("CREATE TABLE IF NOT EXISTS office_subscription_settings ("+
    "office_id INTEGER PRIMARY KEY REFERENCES offices(id) ON DELETE CASCADE,"+
    "seat_limit INTEGER CHECK(seat_limit IS NULL OR seat_limit>=1),"+
    "billing_state TEXT NOT NULL DEFAULT 'preview' CHECK(billing_state='preview'),"+
    "updated_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_office_modules ON office_modules(office_id,module_key,enabled)");
  for(const office of db.prepare('SELECT id FROM offices').all())ensureOffice(db,office.id);
}
function ensureOffice(db,officeId){
  const stamp=new Date().toISOString();
  const insert=db.prepare('INSERT OR IGNORE INTO office_modules(office_id,module_key,enabled,updated_at) VALUES(?,?,?,?)');
  for(const module of CATALOG)insert.run(officeId,module.key,module.status==='planned'?0:1,stamp);
  db.prepare("INSERT OR IGNORE INTO office_subscription_settings(office_id,seat_limit,billing_state,updated_at) VALUES(?,NULL,'preview',?)").run(officeId,stamp);
}
function has(db,officeId,key){
  if(!officeId)return false;
  const module=BY_KEY.get(key);
  if(!module||module.status==='planned')return false;
  const row=db.prepare('SELECT enabled FROM office_modules WHERE office_id=? AND module_key=?').get(officeId,key);
  return row?.enabled===1;
}
function requireModule(db,user,key){
  if(!user)fail(401,'Sign in required');
  if(!user.office?.id)fail(403,'Office employee account required');
  if(!has(db,user.office.id,key))fail(403,'Module not enabled for this office: '+(BY_KEY.get(key)?.name||key));
}
function seats(db,officeId){
  const limits=db.prepare('SELECT seat_limit AS seatLimit,billing_state AS billingState FROM office_subscription_settings WHERE office_id=?').get(officeId);
  const count=db.prepare('SELECT COUNT(*) AS n FROM users WHERE office_id=?').get(officeId).n;
  return {limit:limits?.seatLimit??null,used:count,remaining:limits?.seatLimit==null?null:Math.max(0,limits.seatLimit-count),billingState:'preview'};
}
function requireSeat(db,officeId){
  const s=seats(db,officeId);
  if(s.limit!==null&&s.used>=s.limit)fail(409,'Staff account limit reached. Contact Cricket platform administration.');
}
function catalog(db,officeId){
  const rows=new Map(db.prepare('SELECT module_key,enabled FROM office_modules WHERE office_id=?').all(officeId)
    .map(x=>[x.module_key,x.enabled===1]));
  return CATALOG.map(m=>({...m,enabled:m.status==='planned'?false:rows.get(m.key)===true}));
}
function preview(db,officeId){
  const items=catalog(db,officeId);
  const s=seats(db,officeId);
  let estimate=0;const incomplete=[];
  for(const m of items){
    if(!m.enabled)continue;
    if(m.priceUsd==null){incomplete.push(m.key);continue;}
    estimate+=m.priceUsd*(m.unit==='seat'?s.used:1);
  }
  return {modules:items,seats:s,pricing:{currency:'USD',period:'month',
    knownSubtotalUsd:estimate,unpricedModules:incomplete,
    draft:true,disclaimer:'Illustrative catalog prices only. No billing, charges, or payment processing.'}};
}
function requirePlatform(user){
  if(!user)fail(401,'Sign in required');
  if(user.role!=='platform_admin')fail(403,'Platform administration required');
}
async function route({p,req,res,user,db,send,readBody}){
  if(p==='/api/modules/me'&&req.method==='GET'){
    if(!user)fail(401,'Sign in required');
    if(!user.office?.id)fail(403,'Office account required');
    const data=preview(db,user.office.id);
    return send(res,200,{office:{id:user.office.id,name:user.office.name},...data});
  }
  if(p==='/api/platform/modules'&&req.method==='GET'){
    requirePlatform(user);
    return send(res,200,{catalog:CATALOG,pricingDraft:true});
  }
  const management=p.match(/^\/api\/platform\/offices\/(\d+)\/(modules(?:\/([a-z_]+))?|seats)$/);
  if(!management)return false;
  requirePlatform(user);
  const officeId=Number(management[1]),action=management[2],key=management[3];
  if(!Number.isSafeInteger(officeId)||officeId<=0||
    !db.prepare('SELECT id FROM offices WHERE id=?').get(officeId))fail(404,'Office not found');
  if(action==='modules'&&req.method==='GET')return send(res,200,{officeId,...preview(db,officeId)});
  if(key&&req.method==='PATCH'){
    const module=BY_KEY.get(key);
    if(!module)fail(404,'Module does not exist');
    if(module.status!=='available')fail(400,'This module cannot be changed yet');
    const body=await readBody(req);
    if(!body||typeof body.enabled!=='boolean'||Object.keys(body).length!==1)
      fail(400,'Set enabled to true or false');
    const updated=db.prepare('UPDATE office_modules SET enabled=?,updated_at=? WHERE office_id=? AND module_key=?')
      .run(body.enabled?1:0,new Date().toISOString(),officeId,key);
    if(!updated.changes)fail(404,'Module not found for office');
    db.prepare('INSERT INTO platform_audit(admin_id,action,office_id,created_at) VALUES(?,?,?,?)')
      .run(user.id,body.enabled?'module_enabled:'+key:'module_disabled:'+key,officeId,new Date().toISOString());
    return send(res,200,{officeId,...preview(db,officeId)});
  }
  if(action==='seats'&&req.method==='PATCH'){
    const body=await readBody(req);
    const limit=body?.limit;
    if(!body||Object.keys(body).length!==1||
      (limit!==null&&(!Number.isSafeInteger(limit)||limit<1||limit>100000)))
      fail(400,'Seat limit must be a whole number from 1 to 100000, or null for unlimited');
    const used=seats(db,officeId).used;
    if(limit!==null&&limit<used)fail(409,'Seat limit cannot be lower than the number of existing accounts ('+used+').');
    db.prepare('UPDATE office_subscription_settings SET seat_limit=?,updated_at=? WHERE office_id=?')
      .run(limit,new Date().toISOString(),officeId);
    db.prepare('INSERT INTO platform_audit(admin_id,action,office_id,created_at) VALUES(?,?,?,?)')
      .run(user.id,'seat_limit_updated',officeId,new Date().toISOString());
    return send(res,200,{officeId,...preview(db,officeId)});
  }
  fail(405,'Method not allowed');
}
module.exports={CATALOG,install,ensureOffice,has,requireModule,requireSeat,
  moduleForApi,moduleForAsset,preview,route};
