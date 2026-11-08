'use strict';
// Cricket multi-office foundation. Keep office keys secret; only SHA-256 hashes are persisted.
const crypto=require('node:crypto');
const OFFICE_COOKIE='cricket_office';
const OFFICE_SELECTION_MS=15*60*1000;
const TEMPLATES=new Set(['neutrauma','starter']);
const DEMO_ROUTES=[
  {name:'Order Status Inquiry',instructions:'Confirm a fictional order reference. Check the order stage in the approved order system and explain the next expected update. Never invent a delivery date.'},
  {name:'Refund Request',instructions:'Identify the customer's reason for the refund. Explain eligibility based on the organization’s current policy. Give the expected next step without promising approval.'},
  {name:'Delivery Issue',instructions:'Confirm the fictional order reference and the delivery concern. Check tracking details, document the issue and offer the supported escalation path.'},
  {name:'Product Exchange',instructions:'Review the item and reason for an exchange. Confirm the permitted options under the client policy and explain how the customer starts the exchange.'},
  {name:'Billing Question',instructions:'Clarify the charge being questioned. Explain only authorized account information. Escalate suspected duplicate or incorrect charges according to the billing procedure.'},
  {name:'Supervisor Escalation',instructions:'Summarize the concern neutrally, document actions already taken and hand off to a supervisor when the documented escalation criteria are met.'}
];
const BRAND_DEFAULTS={
  neutrauma:{
    tagline:'Concussion Care',
    color:'#24679f',
    logoUrl:'/assets/neutrauma-logo.webp',
    welcome:'Your care team’s workflow, organized.'
  },
  northstar:{
    tagline:'Customer Experience',
    color:'#16788e',
    logoUrl:null,
    welcome:'Thoughtful support starts here.'
  },
  generic:{
    tagline:'Operations Workspace',
    color:'#2563eb',
    logoUrl:null,
    welcome:'One workspace. Clearer work.'
  }
};
function brandForRow(row){
  if(!row)return null;
  const fallback=row.slug==='neutrauma'?BRAND_DEFAULTS.neutrauma:
    row.slug==='northstar-support'?BRAND_DEFAULTS.northstar:BRAND_DEFAULTS.generic;
  const logo=row.brand_logo_url==='/assets/neutrauma-logo.webp'
    ?row.brand_logo_url:fallback.logoUrl;
  const c=typeof row.brand_color==='string'&&/^#[0-9a-f]{6}$/i.test(row.brand_color)
    ?row.brand_color:fallback.color;
  return {
    tagline:row.brand_tagline||fallback.tagline,
    color:c,
    logoUrl:logo,
    welcome:row.brand_welcome||fallback.welcome
  };
}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function generateKey(){return 'CRK-'+crypto.randomBytes(24).toString('base64url');}
function validKey(key){return typeof key==='string'&&key.length>=16&&key.length<=128&&/^[A-Za-z0-9_-]+$/.test(key);}
function validateRoutes(routes){
  if(!Array.isArray(routes)||routes.length>20)throw Object.assign(Error('Provide up to 20 workflow routes'),{status:400});
  return routes.map((item,i)=>{
    const name=typeof item?.name==='string'?item.name.trim():'';
    const instructions=typeof item?.instructions==='string'?item.instructions.trim():'';
    if(name.length<3||name.length>80||instructions.length<5||instructions.length>1500)
      throw Object.assign(Error('Each route needs a name (3–80 characters) and instructions (5–1500 characters)'),{status:400});
    return {id:'route-'+(i+1),name,instructions};
  });
}
function safeOffice(row){
  if(!row)return null;
  return {
    id:row.id,name:row.name,slug:row.slug,
    workflowTemplate:row.workflow_template,active:!!row.active,
    branding:brandForRow(row),
    routes:JSON.parse(row.routes_json||'[]')
  };
}
function migrateOffices(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS offices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      office_key_hash TEXT NOT NULL UNIQUE,
      workflow_template TEXT NOT NULL CHECK(workflow_template IN ('neutrauma','starter')),
      routes_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS office_selections (
      token_hash TEXT PRIMARY KEY,
      office_id INTEGER REFERENCES offices(id),
      scope TEXT NOT NULL CHECK(scope IN ('office','platform')),
      expires_at INTEGER NOT NULL
    );
  `);
  for(const [table,definition] of [
    ['users','INTEGER REFERENCES offices(id)'],
    ['cases','INTEGER REFERENCES offices(id)'],
    ['reviews','INTEGER REFERENCES offices(id)'],
    ['audit_events','INTEGER REFERENCES offices(id)'],
    ['live_presence','INTEGER REFERENCES offices(id)']
  ]){
    if(!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==='office_id')){
      db.exec(`ALTER TABLE ${table} ADD COLUMN office_id ${definition}`);
    }
  }
  // Additive client-branding fields; preserve any custom values during upgrades.
  for(const [column,definition] of [
    ['brand_tagline',"TEXT NOT NULL DEFAULT ''"],
    ['brand_color',"TEXT NOT NULL DEFAULT ''"],
    ['brand_logo_url',"TEXT NOT NULL DEFAULT ''"],
    ['brand_welcome',"TEXT NOT NULL DEFAULT ''"]
  ]){
    if(!db.prepare('PRAGMA table_info(offices)').all().some(row=>row.name===column))
      db.exec('ALTER TABLE offices ADD COLUMN '+column+' '+definition);
  }
  db.prepare(`UPDATE offices SET
    brand_tagline=CASE WHEN brand_tagline='' THEN ? ELSE brand_tagline END,
    brand_color=CASE WHEN brand_color='' THEN ? ELSE brand_color END,
    brand_logo_url=CASE WHEN brand_logo_url='' THEN ? ELSE brand_logo_url END,
    brand_welcome=CASE WHEN brand_welcome='' THEN ? ELSE brand_welcome END
    WHERE slug='neutrauma'`).run(
    BRAND_DEFAULTS.neutrauma.tagline,BRAND_DEFAULTS.neutrauma.color,
    BRAND_DEFAULTS.neutrauma.logoUrl,BRAND_DEFAULTS.neutrauma.welcome);
  let neutrauma=db.prepare("SELECT * FROM offices WHERE slug='neutrauma'").get();
  if(!neutrauma){
    const key=process.env.CRICKET_NEUTRAUMA_OFFICE_KEY||generateKey();
    if(!validKey(key))throw Error('CRICKET_NEUTRAUMA_OFFICE_KEY must contain 16–128 letters, numbers, underscores or hyphens');
    const result=db.prepare(`INSERT INTO offices(name,slug,office_key_hash,workflow_template,routes_json,active,created_at)
      VALUES(?,?,?,?,?,1,?)`).run('NeuTrauma','neutrauma',hash(key),'neutrauma','[]',new Date().toISOString());
    neutrauma=db.prepare('SELECT * FROM offices WHERE id=?').get(result.lastInsertRowid);
    if(!process.env.CRICKET_NEUTRAUMA_OFFICE_KEY)
      process.stdout.write('\nFIRST-RUN NeuTrauma Office Key (save it now; it will not be displayed again): '+key+'\n\n');
  }
  // This migration is additive: every pre-existing account, case, review and audit
  // belongs to NeuTrauma. Platform users are introduced only *after* this migration.
  db.prepare("UPDATE users SET office_id=? WHERE office_id IS NULL AND role IN ('agent','qc','admin')").run(neutrauma.id);
  db.prepare('UPDATE cases SET office_id=? WHERE office_id IS NULL').run(neutrauma.id);
  db.exec('UPDATE reviews SET office_id=(SELECT office_id FROM cases WHERE cases.id=reviews.case_id) WHERE office_id IS NULL');
  db.exec('UPDATE audit_events SET office_id=(SELECT office_id FROM users WHERE users.id=audit_events.actor_id) WHERE office_id IS NULL');
  db.exec('UPDATE live_presence SET office_id=(SELECT office_id FROM users WHERE users.id=live_presence.user_id) WHERE office_id IS NULL');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_office ON users(office_id,role);
    CREATE INDEX IF NOT EXISTS idx_cases_office ON cases(office_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_reviews_office ON reviews(office_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_office ON audit_events(office_id,id DESC);
    CREATE INDEX IF NOT EXISTS idx_presence_office ON live_presence(office_id,last_seen_at DESC);
  `);
  // Ensure the initial NeuTrauma office gets its brand identity as well.
  db.prepare(`UPDATE offices SET brand_tagline=?,brand_color=?,brand_logo_url=?,brand_welcome=?
    WHERE slug='neutrauma' AND brand_tagline=''`)
    .run(BRAND_DEFAULTS.neutrauma.tagline,BRAND_DEFAULTS.neutrauma.color,
      BRAND_DEFAULTS.neutrauma.logoUrl,BRAND_DEFAULTS.neutrauma.welcome);
  return db.prepare("SELECT * FROM offices WHERE slug='neutrauma'").get();
}
function readOfficeSelection(db,token){
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const row=db.prepare(`SELECT s.*,o.active FROM office_selections s
    LEFT JOIN offices o ON o.id=s.office_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hash(token),Date.now());
  if(!row || (row.scope==='office'&&!row.active))return null;
  return row;
}
function findOfficeByKey(db,key){
  if(!validKey(key))return null;
  const office=db.prepare('SELECT * FROM offices WHERE office_key_hash=? AND active=1').get(hash(key));
  return office||null;
}
module.exports={migrateOffices,hash,generateKey,validKey,validateRoutes,safeOffice,
  brandForRow,BRAND_DEFAULTS,DEMO_ROUTES,
  readOfficeSelection,findOfficeByKey,OFFICE_COOKIE,OFFICE_SELECTION_MS,TEMPLATES};
