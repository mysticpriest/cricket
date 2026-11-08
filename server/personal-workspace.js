'use strict';
/* Employee-owned dashboard customization, private notes/reminders, and shift status.
 * All data is scoped by authenticated user_id + office_id. No client supplied IDs
 * are used for authorization, and no platform admin can read private notes.
 */
const crypto=require('node:crypto');
const WIDGET_IDS=['metrics','presence','divisions','quick','sticky','reminders','shift'];
const NAV_IDS=['overview','analytics','inbound','outbound','cases','qc','operations','staff'];
const SIZES=new Set(['compact','standard','wide']);
const COLORS=new Set(['blue','indigo','teal','green','orange','rose','slate','violet']);
const SHIFT_ACTIONS=new Map([
  ['start_shift','working'],['break','break'],['meeting','meeting'],
  ['system_issues','system_issues'],['end_shift','ended']
]);
const statusNames={working:'Start Shift',break:'Break',meeting:'Meeting',system_issues:'System Issues',ended:'End Shift',not_started:'Not started'};
const stamp=()=>new Date().toISOString();
const issue=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
function setup(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_layouts(
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      office_id INTEGER NOT NULL REFERENCES offices(id),
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspace_notes(
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      office_id INTEGER NOT NULL REFERENCES offices(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      color TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_notes_owner
      ON workspace_notes(office_id,user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS workspace_reminders(
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      office_id INTEGER NOT NULL REFERENCES offices(id),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      due_at TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_reminders_owner
      ON workspace_reminders(office_id,user_id,done,due_at);
    CREATE TABLE IF NOT EXISTS work_shifts(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      office_id INTEGER NOT NULL REFERENCES offices(id),
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('working','break','meeting','system_issues','ended')),
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_shifts_one_open
      ON work_shifts(user_id) WHERE ended_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_work_shifts_office
      ON work_shifts(office_id,user_id,started_at DESC);
    CREATE TABLE IF NOT EXISTS work_shift_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL REFERENCES work_shifts(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      office_id INTEGER NOT NULL REFERENCES offices(id),
      action TEXT NOT NULL CHECK(action IN ('start_shift','break','meeting','system_issues','end_shift')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_shift_events_office
      ON work_shift_events(office_id,created_at DESC,id DESC);
  `);
  // Existing notes are assigned a stable position once; never overwrite order
  // in later startups. User's historic notes and text remain untouched.
  if(!db.prepare('PRAGMA table_info(workspace_notes)').all().some(x=>x.name==='sort_index')){
    db.exec('ALTER TABLE workspace_notes ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0');
    const rows=db.prepare('SELECT id FROM workspace_notes ORDER BY pinned DESC,updated_at DESC,id').all();
    const update=db.prepare('UPDATE workspace_notes SET sort_index=? WHERE id=?');
    rows.forEach((row,index)=>update.run(index+1,row.id));
  }
}
function defaultLayout(){
  return {
    version:2,
    widgets:WIDGET_IDS.map(id=>({id,size:id==='divisions'?'wide':'standard',
      color:'blue',hidden:id!=='divisions'})),
    nav:NAV_IDS.map(id=>({id,color:'blue',hidden:false}))
  };
}
function validateLayout(value){
  if(!value||typeof value!=='object'||Array.isArray(value))issue(400,'Invalid workspace layout');
  if(value.version!==2)issue(400,'Unsupported workspace layout version');
  const normalize=(items,ids,widget)=>{
    if(!Array.isArray(items)||items.length!==ids.length)issue(400,'Invalid workspace layout sections');
    const seen=new Set();
    return items.map(x=>{
      if(!x||typeof x!=='object'||!ids.includes(x.id)||seen.has(x.id)||!COLORS.has(x.color)
        ||typeof x.hidden!=='boolean'||(widget&&!SIZES.has(x.size)))issue(400,'Invalid workspace layout configuration');
      seen.add(x.id);
      return widget?{id:x.id,size:x.size,color:x.color,hidden:x.hidden}:{id:x.id,color:x.color,hidden:x.hidden};
    });
  };
  const widgets=normalize(value.widgets,WIDGET_IDS,true);
  // Workspace Tabs is the permanent foundation of every dashboard.
  // Client-side hide requests must never remove the last route entry.
  widgets.find(item=>item.id==='divisions').hidden=false;
  const nav=normalize(value.nav,NAV_IDS,false);
  // The Overview link is permanently available so navigation cannot lock out the account.
  const overview=nav.find(x=>x.id==='overview');overview.hidden=false;
  return {version:2,widgets,nav};
}
function upgradeLegacyLayout(value){
  // Existing v1 accounts had all blocks visible. Migrate once so each user
  // starts from Workspace Tabs only while preserving their chosen colors,
  // sizes, and ordering if they add a hidden block back later.
  const defaults=defaultLayout();
  if(!value||!Array.isArray(value.widgets)||!Array.isArray(value.nav))return defaults;
  const allowed=new Set(WIDGET_IDS);
  const filtered=value.widgets.filter(x=>allowed.has(x?.id));
  const byId=new Map(filtered.map(x=>[x.id,x]));
  const widgets=[...filtered,...defaults.widgets.filter(x=>!byId.has(x.id))]
    .map(x=>({...x,hidden:x.id!=='divisions'}));
  return validateLayout({version:2,widgets,nav:value.nav});
}
function getLayout(db,user){
  const row=db.prepare('SELECT layout_json FROM workspace_layouts WHERE user_id=? AND office_id=?')
    .get(user.id,user.office.id);
  if(!row)return defaultLayout();
  try{
    const parsed=JSON.parse(row.layout_json);
    if(parsed.version===2)return validateLayout(parsed);
    const upgraded=upgradeLegacyLayout(parsed);
    db.prepare('UPDATE workspace_layouts SET layout_json=?,updated_at=? WHERE user_id=? AND office_id=?')
      .run(JSON.stringify(upgraded),stamp(),user.id,user.office.id);
    return upgraded;
  }catch(_){return defaultLayout();}
}
function getNotes(db,user){
  return db.prepare(`SELECT id,title,body,color,pinned,created_at AS createdAt,updated_at AS updatedAt
    FROM workspace_notes WHERE user_id=? AND office_id=? ORDER BY sort_index ASC,created_at ASC`)
    .all(user.id,user.office.id).map(row=>({...row,pinned:!!row.pinned}));
}
function getReminders(db,user){
  return db.prepare(`SELECT id,title,body,due_at AS dueAt,done,created_at AS createdAt,updated_at AS updatedAt
    FROM workspace_reminders WHERE user_id=? AND office_id=?
    ORDER BY done ASC,CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at ASC,created_at DESC`)
    .all(user.id,user.office.id).map(row=>({...row,done:!!row.done}));
}
function currentShift(db,user){
  const row=db.prepare(`SELECT id,status,started_at AS startedAt,ended_at AS endedAt,updated_at AS updatedAt
    FROM work_shifts WHERE user_id=? AND office_id=?
    ORDER BY started_at DESC,id DESC LIMIT 1`).get(user.id,user.office.id);
  return row||null;
}
function jsonNote(data,required=true){
  if(!data||typeof data!=='object'||Array.isArray(data))issue(400,'Invalid note');
  const title=typeof data.title==='string'?data.title.trim():'';
  const body=typeof data.body==='string'?data.body.trim():'';
  const color=data.color;
  if(!title||title.length>100||body.length>4000||!COLORS.has(color)||typeof data.pinned!=='boolean')
    issue(400,'Note needs a title (1–100), body (0–4000), valid color and pinned setting');
  return {title,body,color,pinned:data.pinned?1:0};
}
function jsonReminder(data){
  if(!data||typeof data!=='object'||Array.isArray(data))issue(400,'Invalid reminder');
  const title=typeof data.title==='string'?data.title.trim():'';
  const body=typeof data.body==='string'?data.body.trim():'';
  if(!title||title.length>130||body.length>1200||typeof data.done!=='boolean')
    issue(400,'Reminder needs a title (1–130), details (0–1200) and completion state');
  let dueAt=null;
  if(data.dueAt!==null&&data.dueAt!==undefined&&data.dueAt!==''){
    if(typeof data.dueAt!=='string'||data.dueAt.length>40)issue(400,'Invalid reminder date');
    const d=new Date(data.dueAt);
    if(!Number.isFinite(d.getTime())||d.getUTCFullYear()<2020||d.getUTCFullYear()>2100)
      issue(400,'Invalid reminder date');
    dueAt=d.toISOString();
  }
  return {title,body,dueAt,done:data.done?1:0};
}
function employeeView(db,user){
  return {
    layout:getLayout(db,user),notes:getNotes(db,user),reminders:getReminders(db,user),
    shift:currentShift(db,user),serverTime:Date.now()
  };
}
function adminShifts(db,user){
  const office=user.office.id;
  const people=db.prepare(`SELECT u.id,u.email,u.display_name AS displayName,u.role,
    s.id AS shiftId,s.status,s.started_at AS startedAt,s.ended_at AS endedAt,
    s.updated_at AS updatedAt
    FROM users u
    LEFT JOIN work_shifts s ON s.id=(
      SELECT id FROM work_shifts WHERE user_id=u.id AND office_id=u.office_id
      ORDER BY started_at DESC,id DESC LIMIT 1)
    WHERE u.office_id=? ORDER BY u.display_name COLLATE NOCASE,u.email`).all(office)
    .map(row=>({...row,status:row.status||'not_started',
      active:row.shiftId!==null&&row.endedAt===null}));
  const history=db.prepare(`SELECT e.id,e.action,e.created_at AS createdAt,
      s.started_at AS shiftStartedAt,s.ended_at AS shiftEndedAt,
      u.id AS userId,u.display_name AS displayName,u.email,u.role
    FROM work_shift_events e
    JOIN work_shifts s ON s.id=e.shift_id AND s.office_id=e.office_id
    JOIN users u ON u.id=e.user_id AND u.office_id=e.office_id
    WHERE e.office_id=?
    ORDER BY e.created_at DESC,e.id DESC LIMIT 100`).all(office);
  const summary={working:0,break:0,meeting:0,system_issues:0,ended:0,not_started:0};
  people.forEach(person=>{summary[person.status]++;});
  return {people,history,summary,serverTime:Date.now()};
}
function route(ctx){
  const {p,req,res,user,db,readBody,send,audit}=ctx;
  if(!p.startsWith('/api/workspace/')&&p!=='/api/admin/shifts')return false;
  if(!user)issue(401,'Sign in required');
  if(p==='/api/admin/shifts'){
    if(user.role!=='admin'||!user.office)issue(403,'Office administrator access required');
    if(req.method!=='GET')issue(405,'Method not allowed');
    send(res,200,adminShifts(db,user));return true;
  }
  if(!user.office||!['agent','qc','admin'].includes(user.role))issue(403,'Employee workspace required');
  const id=user.id,office=user.office.id;
  if(p==='/api/workspace/me'&&req.method==='GET'){
    send(res,200,employeeView(db,user));return true;
  }
  if(p==='/api/workspace/layout'&&req.method==='PUT')return readBody(req).then(value=>{
    const layout=validateLayout(value);
    db.prepare(`INSERT INTO workspace_layouts(user_id,office_id,layout_json,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET office_id=excluded.office_id,
      layout_json=excluded.layout_json,updated_at=excluded.updated_at`)
      .run(id,office,JSON.stringify(layout),stamp());
    send(res,200,{layout});return true;
  });
  if(p==='/api/workspace/notes/order'&&req.method==='PUT')return readBody(req).then(data=>{
    const ids=data?.ids;
    if(!Array.isArray(ids)||ids.length>60||new Set(ids).size!==ids.length||
       !ids.every(value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value)))
      issue(400,'Invalid note arrangement');
    const existing=db.prepare('SELECT id FROM workspace_notes WHERE user_id=? AND office_id=?')
      .all(id,office).map(row=>row.id);
    if(ids.length!==existing.length||ids.some(noteId=>!existing.includes(noteId)))
      issue(400,'Note arrangement does not match your saved notes');
    db.exec('BEGIN IMMEDIATE');
    try{
      const update=db.prepare('UPDATE workspace_notes SET sort_index=? WHERE id=? AND user_id=? AND office_id=?');
      ids.forEach((noteId,index)=>update.run(index+1,noteId,id,office));
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    send(res,200,{notes:getNotes(db,user)});return true;
  });
  if(p==='/api/workspace/notes'&&req.method==='POST')return readBody(req).then(data=>{
    const value=jsonNote(data);
    if(db.prepare('SELECT count(*) AS n FROM workspace_notes WHERE user_id=? AND office_id=?').get(id,office).n>=60)
      issue(409,'Maximum 60 personal notes');
    const uuid=crypto.randomUUID(),now=stamp();
    const position=db.prepare(`SELECT COALESCE(MAX(sort_index),0)+1 AS next
      FROM workspace_notes WHERE user_id=? AND office_id=?`).get(id,office).next;
    db.prepare(`INSERT INTO workspace_notes
      (id,user_id,office_id,title,body,color,pinned,created_at,updated_at,sort_index)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(uuid,id,office,value.title,value.body,value.color,value.pinned,now,now,position);
    send(res,201,{notes:getNotes(db,user)});return true;
  });
  const noteMatch=p.match(/^\/api\/workspace\/notes\/([a-f0-9-]{36})$/i);
  if(noteMatch&&req.method==='PATCH')return readBody(req).then(data=>{
    const value=jsonNote(data);
    const updated=db.prepare(`UPDATE workspace_notes SET title=?,body=?,color=?,pinned=?,updated_at=?
      WHERE id=? AND user_id=? AND office_id=?`)
      .run(value.title,value.body,value.color,value.pinned,stamp(),noteMatch[1],id,office);
    if(!updated.changes)issue(404,'Note not found');
    send(res,200,{notes:getNotes(db,user)});return true;
  });
  if(noteMatch&&req.method==='DELETE'){
    const deleted=db.prepare('DELETE FROM workspace_notes WHERE id=? AND user_id=? AND office_id=?')
      .run(noteMatch[1],id,office);
    if(!deleted.changes)issue(404,'Note not found');
    send(res,200,{notes:getNotes(db,user)});return true;
  }
  if(p==='/api/workspace/reminders'&&req.method==='POST')return readBody(req).then(data=>{
    const value=jsonReminder(data);
    if(db.prepare('SELECT count(*) AS n FROM workspace_reminders WHERE user_id=? AND office_id=?').get(id,office).n>=120)
      issue(409,'Maximum 120 personal reminders');
    const uuid=crypto.randomUUID(),created=stamp();
    db.prepare(`INSERT INTO workspace_reminders
      (id,user_id,office_id,title,body,due_at,done,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(uuid,id,office,value.title,value.body,value.dueAt,value.done,created,created);
    send(res,201,{reminders:getReminders(db,user)});return true;
  });
  const reminderMatch=p.match(/^\/api\/workspace\/reminders\/([a-f0-9-]{36})$/i);
  if(reminderMatch&&req.method==='PATCH')return readBody(req).then(data=>{
    const value=jsonReminder(data);
    const updated=db.prepare(`UPDATE workspace_reminders SET title=?,body=?,due_at=?,done=?,updated_at=?
      WHERE id=? AND user_id=? AND office_id=?`)
      .run(value.title,value.body,value.dueAt,value.done,stamp(),reminderMatch[1],id,office);
    if(!updated.changes)issue(404,'Reminder not found');
    send(res,200,{reminders:getReminders(db,user)});return true;
  });
  if(reminderMatch&&req.method==='DELETE'){
    const deleted=db.prepare('DELETE FROM workspace_reminders WHERE id=? AND user_id=? AND office_id=?')
      .run(reminderMatch[1],id,office);
    if(!deleted.changes)issue(404,'Reminder not found');
    send(res,200,{reminders:getReminders(db,user)});return true;
  }
  if(p==='/api/workspace/shift'&&req.method==='POST')return readBody(req).then(data=>{
    if(!SHIFT_ACTIONS.has(data?.action))issue(400,'Unknown shift status');
    const action=data.action,target=SHIFT_ACTIONS.get(action),time=Date.now();
    let shift=db.prepare(`SELECT * FROM work_shifts WHERE user_id=? AND office_id=?
      AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`).get(id,office);
    if(!shift&&action!=='start_shift')issue(409,'Start your shift first');
    if(shift&&shift.status===target){
      send(res,200,{shift:currentShift(db,user),serverTime:time,unchanged:true});return true;
    }
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!shift){
        const result=db.prepare(`INSERT INTO work_shifts(user_id,office_id,started_at,ended_at,status,updated_at)
          VALUES(?,?,?,NULL,'working',?)`).run(id,office,time,time);
        shift={id:Number(result.lastInsertRowid)};
      }else{
        db.prepare('UPDATE work_shifts SET status=?,ended_at=?,updated_at=? WHERE id=? AND user_id=? AND office_id=?')
          .run(target,action==='end_shift'?time:null,time,shift.id,id,office);
      }
      db.prepare(`INSERT INTO work_shift_events(shift_id,user_id,office_id,action,created_at)
        VALUES(?,?,?,?,?)`).run(shift.id,id,office,action,time);
      // Audit entries are visible only to admins within the same office.
      audit(null,id,'shift_'+action,'Employee changed shift status');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    send(res,200,{shift:currentShift(db,user),serverTime:time});return true;
  });
  issue(405,'Unknown workspace action');
}
module.exports={setup,route,defaultLayout,validateLayout,WIDGET_IDS,NAV_IDS,statusNames};
