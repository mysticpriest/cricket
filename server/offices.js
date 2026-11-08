'use strict';
// Cricket multi-office foundation. Keep office keys secret; only SHA-256 hashes are persisted.
const crypto=require('node:crypto');
const OFFICE_COOKIE='cricket_office';
const OFFICE_SELECTION_MS=15*60*1000;
const TEMPLATES=new Set(['neutrauma','starter']);
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
  return neutrauma;
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
  readOfficeSelection,findOfficeByKey,OFFICE_COOKIE,OFFICE_SELECTION_MS,TEMPLATES};
