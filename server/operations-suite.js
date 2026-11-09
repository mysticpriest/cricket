'use strict';
// Office-isolated operations suite. This is an internal/demo application:
// keep fictional data only until a production security/compliance review.
const crypto=require('node:crypto');
const uid=()=>crypto.randomUUID();
const now=()=>Date.now();
const iso=()=>new Date().toISOString();
const fail=(code,message)=>{const e=Error(message);e.status=code;throw e;};
const name=(value,max=100)=>typeof value==='string'?value.trim().slice(0,max+1):'';
const assert=(condition,message)=>{if(!condition)fail(400,message);};
const roles=['agent','qc','admin'];
const requireEmployee=user=>{
  if(!user)fail(401,'Sign in required');
  if(!roles.includes(user.role)||!user.office)fail(403,'Office staff only');
  return user.office.id;
};
const requireAdmin=user=>{requireEmployee(user);if(user.role!=='admin')fail(403,'Office administrator required');};
function setup(db){
  db.exec("CREATE TABLE IF NOT EXISTS ops_workflows ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "title TEXT NOT NULL,description TEXT NOT NULL,steps_json TEXT NOT NULL,"+
    "status TEXT NOT NULL CHECK(status IN ('draft','published')),"+
    "version INTEGER NOT NULL DEFAULT 1,created_by INTEGER NOT NULL REFERENCES users(id),"+
    "created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_workflow_office ON ops_workflows(office_id,status,updated_at DESC)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_workflow_entries ("+
    "id TEXT PRIMARY KEY,workflow_id TEXT NOT NULL REFERENCES ops_workflows(id),"+
    "office_id INTEGER NOT NULL REFERENCES offices(id),user_id INTEGER NOT NULL REFERENCES users(id),"+
    "case_id INTEGER NOT NULL REFERENCES cases(id),workflow_version INTEGER NOT NULL,created_at TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_announcements ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "author_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,"+
    "created_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_ann_office ON ops_announcements(office_id,created_at DESC)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_messages ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "sender_id INTEGER NOT NULL REFERENCES users(id),recipient_id INTEGER NOT NULL REFERENCES users(id),"+
    "body TEXT NOT NULL,created_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_msg_inbox ON ops_messages(office_id,recipient_id,created_at DESC)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_notifications ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "user_id INTEGER NOT NULL REFERENCES users(id),type TEXT NOT NULL,"+
    "title TEXT NOT NULL,body TEXT NOT NULL,href TEXT NOT NULL,source_key TEXT,"+
    "read_at TEXT,created_at TEXT NOT NULL,UNIQUE(office_id,user_id,source_key))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_notif_inbox ON ops_notifications(office_id,user_id,read_at,created_at DESC)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_schedules ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "user_id INTEGER NOT NULL REFERENCES users(id),start_at INTEGER NOT NULL,"+
    "end_at INTEGER NOT NULL,notes TEXT NOT NULL,created_by INTEGER NOT NULL REFERENCES users(id),"+
    "created_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_sched_office ON ops_schedules(office_id,start_at,user_id)");
  db.exec("CREATE TABLE IF NOT EXISTS ops_shift_corrections ("+
    "id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id),"+
    "shift_id INTEGER NOT NULL REFERENCES work_shifts(id),"+
    "user_id INTEGER NOT NULL REFERENCES users(id),"+
    "proposed_start INTEGER NOT NULL,proposed_end INTEGER NOT NULL,"+
    "reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),"+
    "reviewed_by INTEGER REFERENCES users(id),review_note TEXT,reviewed_at TEXT,created_at TEXT NOT NULL)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_ops_corrections ON ops_shift_corrections(office_id,status,created_at DESC)");
}
function workflowPayload(body){
  assert(body&&typeof body==='object'&&!Array.isArray(body),'Invalid workflow');
  const title=name(body.title,90),description=name(body.description,500);
  assert(title.length>=3&&title.length<=90,'Title must be 3–90 characters');
  assert(description.length<=500,'Description is too long');
  assert(['draft','published'].includes(body.status),'Invalid workflow status');
  assert(Array.isArray(body.steps)&&body.steps.length>=1&&body.steps.length<=12,'Add 1–12 workflow steps');
  const steps=body.steps.map((step,i)=>{
    assert(step&&typeof step==='object','Invalid step');
    const label=name(step.label,100);
    assert(label.length>=2&&label.length<=100,'Each step needs a label (2–100 characters)');
    assert(['text','yesno','select'].includes(step.type),'Invalid step type');
    assert(typeof step.required==='boolean','Step required setting missing');
    let options=[];
    if(step.type==='select'){
      assert(Array.isArray(step.options)&&step.options.length>=2&&step.options.length<=10,'Select step needs 2–10 choices');
      options=step.options.map(x=>name(x,80));
      assert(options.every(x=>x.length>=1&&x.length<=80)&&new Set(options).size===options.length,'Invalid or duplicated choices');
    }
    return {id:'s'+(i+1),label,type:step.type,required:step.required,options};
  });
  return {title,description,status:body.status,steps};
}
function notify(db,officeId,userId,type,title,body,href,sourceKey=null){
  db.prepare("INSERT OR IGNORE INTO ops_notifications(id,office_id,user_id,type,title,body,href,source_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(uid(),officeId,userId,type,name(title,120),name(body,600),href,sourceKey,iso());
}
function automaticNotifications(db,user){
  // Inbox evaluation is bounded and deduplicated. Polls do not create duplicate alerts.
  const limit=Date.now()+24*60*60*1000;
  const reminders=db.prepare("SELECT id,title,due_at FROM workspace_reminders WHERE office_id=? AND user_id=? AND done=0 AND due_at IS NOT NULL AND due_at<=? LIMIT 50")
    .all(user.office.id,user.id,new Date(limit).toISOString());
  for(const r of reminders){
    notify(db,user.office.id,user.id,'reminder','Reminder due: '+r.title,
      'Due '+new Date(r.due_at).toLocaleString('en-US',{timeZone:'UTC'})+' UTC',
      'index.html','reminder:'+r.id+':'+r.due_at);
  }
  const schedules=db.prepare("SELECT id,start_at FROM ops_schedules WHERE office_id=? AND user_id=? AND start_at BETWEEN ? AND ? LIMIT 30")
    .all(user.office.id,user.id,Date.now()-60*60*1000,limit);
  for(const shift of schedules){
    notify(db,user.office.id,user.id,'schedule','Shift coming up',
      'Scheduled '+new Date(shift.start_at).toISOString().replace('T',' ').slice(0,16)+' UTC',
      'workforce.html','schedule:'+shift.id);
  }
}
function listWorkflow(db,officeId,includeDraft){
  const rows=db.prepare("SELECT id,title,description,steps_json AS stepsJson,status,version,created_at AS createdAt,updated_at AS updatedAt FROM ops_workflows WHERE office_id=? "+(includeDraft?"":"AND status='published' ")+"ORDER BY updated_at DESC").all(officeId);
  return rows.map(({stepsJson,...x})=>({...x,steps:JSON.parse(stepsJson)}));
}
function listMessages(db,user){
  const office=user.office.id;
  return db.prepare("SELECT m.id,m.body,m.created_at AS createdAt,m.sender_id AS senderId,m.recipient_id AS recipientId,s.display_name AS senderName,r.display_name AS recipientName FROM ops_messages m JOIN users s ON s.id=m.sender_id AND s.office_id=m.office_id JOIN users r ON r.id=m.recipient_id AND r.office_id=m.office_id WHERE m.office_id=? AND (m.sender_id=? OR m.recipient_id=?) ORDER BY m.created_at DESC LIMIT 120")
    .all(office,user.id,user.id);
}
function schedules(db,user){
  const all=user.role==='admin';
  return db.prepare("SELECT s.id,s.user_id AS userId,u.display_name AS employee,s.start_at AS startAt,s.end_at AS endAt,s.notes FROM ops_schedules s JOIN users u ON u.id=s.user_id AND u.office_id=s.office_id WHERE s.office_id=? "+(all?"":"AND s.user_id=? ")+"ORDER BY s.start_at ASC LIMIT 300")
    .all(...(all?[user.office.id]:[user.office.id,user.id]));
}
function corrections(db,user){
  const all=user.role==='admin';
  return db.prepare("SELECT c.id,c.shift_id AS shiftId,c.user_id AS userId,u.display_name AS employee,c.proposed_start AS proposedStart,c.proposed_end AS proposedEnd,c.reason,c.status,c.review_note AS reviewNote,c.created_at AS createdAt FROM ops_shift_corrections c JOIN users u ON u.id=c.user_id AND u.office_id=c.office_id WHERE c.office_id=? "+(all?"":"AND c.user_id=? ")+"ORDER BY c.created_at DESC LIMIT 120")
    .all(...(all?[user.office.id]:[user.office.id,user.id]));
}
function timeEntries(db,user){
  const all=user.role==='admin';
  return db.prepare("SELECT s.id,s.user_id AS userId,u.display_name AS employee,s.started_at AS startedAt,s.ended_at AS endedAt,s.status FROM work_shifts s JOIN users u ON u.id=s.user_id AND u.office_id=s.office_id WHERE s.office_id=? "+(all?"":"AND s.user_id=? ")+"ORDER BY s.started_at DESC LIMIT 300")
    .all(...(all?[user.office.id]:[user.office.id,user.id]));
}
const csvCell=v=>'"'+String(v??'').replaceAll('"','""').replace(/^[=+@\t\r-]/,'')+'"';
function route(ctx){
  const {p,req,res,url,user,db,readBody,send,audit}=ctx;
  if(!p.startsWith('/api/ops/'))return false;
  const office=requireEmployee(user);
  const verb=req.method;
  if(p==='/api/ops/notifications'&&verb==='GET'){
    automaticNotifications(db,user);
    const list=db.prepare("SELECT id,type,title,body,href,read_at AS readAt,created_at AS createdAt FROM ops_notifications WHERE office_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 80").all(office,user.id);
    // The preview is limited; calculate the count across the full unread inbox.
    const unread=db.prepare("SELECT COUNT(*) AS total FROM ops_notifications WHERE office_id=? AND user_id=? AND read_at IS NULL").get(office,user.id).total;
    send(res,200,{notifications:list,unread});return true;
  }
  const seen=p.match(/^\/api\/ops\/notifications\/([a-f0-9-]{36})\/read$/i);
  if(seen&&verb==='POST'){
    const x=db.prepare("UPDATE ops_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND office_id=? AND user_id=?")
      .run(iso(),seen[1],office,user.id);
    if(!x.changes)fail(404,'Notification not found');
    send(res,200,{ok:true});return true;
  }
  if(p==='/api/ops/search'&&verb==='GET'){
    const q=name(url.searchParams.get('q'),80).toLowerCase();
    if(q.length<2){send(res,200,{results:[]});return true;}
    const nav=[
      ['Overview','index.html','page'],['Analytics','analytics.html','page'],
      ['Inbound','inbound.html','page'],['Outbound','outbound.html','page'],
      ['Office workflows','office-workflow.html','page'],
      ['Team hub','team-hub.html','page'],['Workforce calendar','workforce.html','page']
    ];
    if(user.role==='admin')nav.push(['Workflow Builder','workflow-builder.html','page'],['Staff accounts','staff.html','page'],['Live Operations','operations.html','page'],['Case archive','cases.html','page']);
    if(['admin','qc'].includes(user.role))nav.push(['Quality Control','qc.html','page']);
    const results=nav.filter(x=>x[0].toLowerCase().includes(q)).map(x=>({title:x[0],href:x[1],type:x[2]}));
    const workflows=db.prepare("SELECT id,title FROM ops_workflows WHERE office_id=? AND status='published' AND lower(title) LIKE ? ORDER BY updated_at DESC LIMIT 12")
      .all(office,'%'+q.replaceAll('%','')+'%');
    for(const wf of workflows)results.push({title:wf.title,href:'workflow-runner.html?id='+encodeURIComponent(wf.id),type:'workflow'});
    if(['admin','qc'].includes(user.role)){
      const matches=db.prepare("SELECT case_id FROM cases WHERE office_id=? AND deleted_at IS NULL AND case_id LIKE ? ORDER BY created_at DESC LIMIT 10")
        .all(office,'%'+q.replaceAll('%','')+'%');
      for(const row of matches)results.push({title:row.case_id,href:'qc.html',type:'case'});
    }
    send(res,200,{results:results.slice(0,25)});return true;
  }
  if(p==='/api/ops/workflows'&&verb==='GET'){
    send(res,200,{workflows:listWorkflow(db,office,user.role==='admin')});return true;
  }
  if(p==='/api/ops/workflows'&&verb==='POST')return readBody(req).then(body=>{
    requireAdmin(user);const value=workflowPayload(body),id=uid(),created=iso();
    db.prepare("INSERT INTO ops_workflows(id,office_id,title,description,steps_json,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id,office,value.title,value.description,JSON.stringify(value.steps),value.status,user.id,created,created);
    audit(null,user.id,'workflow_created',value.title);
    send(res,201,{workflow:{id,...value,version:1}});return true;
  });
  const workflow=p.match(/^\/api\/ops\/workflows\/([a-f0-9-]{36})$/i);
  if(workflow&&verb==='GET'){
    const row=db.prepare("SELECT * FROM ops_workflows WHERE id=? AND office_id=?").get(workflow[1],office);
    if(!row||(row.status!=='published'&&user.role!=='admin'))fail(404,'Workflow not found');
    send(res,200,{workflow:{id:row.id,title:row.title,description:row.description,status:row.status,steps:JSON.parse(row.steps_json),version:row.version}});return true;
  }
  if(workflow&&verb==='PUT')return readBody(req).then(body=>{
    requireAdmin(user);const value=workflowPayload(body);
    const r=db.prepare("UPDATE ops_workflows SET title=?,description=?,steps_json=?,status=?,version=version+1,updated_at=? WHERE id=? AND office_id=?")
      .run(value.title,value.description,JSON.stringify(value.steps),value.status,iso(),workflow[1],office);
    if(!r.changes)fail(404,'Workflow not found');
    audit(null,user.id,'workflow_updated',value.title);
    send(res,200,{ok:true});return true;
  });
  if(workflow&&verb==='DELETE'){
    requireAdmin(user);const r=db.prepare("UPDATE ops_workflows SET status='draft',updated_at=? WHERE id=? AND office_id=?")
      .run(iso(),workflow[1],office);
    if(!r.changes)fail(404,'Workflow not found');
    audit(null,user.id,'workflow_unpublished',workflow[1]);
    send(res,200,{ok:true});return true;
  }
  const complete=p.match(/^\/api\/ops\/workflows\/([a-f0-9-]{36})\/complete$/i);
  if(complete&&verb==='POST')return readBody(req).then(body=>{
    if(!['agent','admin'].includes(user.role))fail(403,'Agents or office administrators only');
    const wf=db.prepare("SELECT * FROM ops_workflows WHERE id=? AND office_id=? AND status='published'").get(complete[1],office);
    if(!wf)fail(404,'Published workflow not found');
    assert(body&&typeof body==='object'&&!Array.isArray(body),'Invalid submission');
    assert(['resolved','pending'].includes(body.outcome),'Choose a case outcome');
    const steps=JSON.parse(wf.steps_json),answers=body.answers;
    assert(answers&&typeof answers==='object'&&!Array.isArray(answers),'Invalid answers');
    const events=[],sections=[];
    for(const step of steps){
      const value=answers[step.id];
      const text=typeof value==='string'?value.trim():'';
      assert(text.length<=350,'Step answer is too long');
      if(step.required)assert(text.length>0,'Complete all required steps');
      if(step.type==='yesno'&&text)assert(['Yes','No'].includes(text),'Invalid yes/no answer');
      if(step.type==='select'&&text)assert(step.options.includes(text),'Invalid selection');
      if(text){sections.push(step.label+': '+text);events.push(step.label+' completed');}
    }
    const extra=name(body.note,2000);
    assert(extra.length<=2000,'Note too long');
    const note=['Workflow: '+wf.title,...sections,extra?'Additional notes: '+extra:''].filter(Boolean).join('\n').slice(0,4000);
    assert(note.length>=15,'Complete the workflow before saving');
    const created=iso(),record=uid();
    db.exec('BEGIN IMMEDIATE');
    try{
      const result=db.prepare("INSERT INTO cases(agent_id,request_id,department,inquiry,route,outcome,note,events_json,call_phone,call_started_at,created_at,office_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(user.id,record,'custom_workflow',wf.title,wf.title,body.outcome,note,JSON.stringify(events),null,created,created,office);
      const caseNum=Number(result.lastInsertRowid);
      const caseId='CR-'+created.slice(0,10).replaceAll('-','')+'-'+String(caseNum).padStart(6,'0');
      db.prepare('UPDATE cases SET case_id=? WHERE id=?').run(caseId,caseNum);
      db.prepare("INSERT INTO ops_workflow_entries(id,workflow_id,office_id,user_id,case_id,workflow_version,created_at) VALUES(?,?,?,?,?,?,?)")
        .run(record,wf.id,office,user.id,caseNum,wf.version,created);
      audit(caseNum,user.id,'custom_workflow_completed',wf.title);
      db.exec('COMMIT');
      send(res,201,user.role==='agent'?{saved:true,createdAt:created}:{saved:true,caseId,createdAt:created});
      return true;
    }catch(error){db.exec('ROLLBACK');throw error;}
  });
  if(p==='/api/ops/team'&&verb==='GET'){
    const staff=db.prepare("SELECT id,display_name AS displayName,role FROM users WHERE office_id=? ORDER BY display_name COLLATE NOCASE").all(office);
    const announcements=db.prepare("SELECT a.id,a.title,a.body,a.created_at AS createdAt,u.display_name AS author FROM ops_announcements a JOIN users u ON u.id=a.author_id AND u.office_id=a.office_id WHERE a.office_id=? ORDER BY a.created_at DESC LIMIT 60").all(office);
    send(res,200,{staff,announcements,messages:listMessages(db,user)});return true;
  }
  if(p==='/api/ops/team/announcements'&&verb==='POST')return readBody(req).then(body=>{
    requireAdmin(user);
    const title=name(body.title,120),text=name(body.body,1500);
    assert(title.length>=3&&title.length<=120&&text.length>=5&&text.length<=1500,'Enter a title and announcement (5–1500 characters)');
    const id=uid(),created=iso();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO ops_announcements(id,office_id,author_id,title,body,created_at) VALUES(?,?,?,?,?,?)")
        .run(id,office,user.id,title,text,created);
      for(const person of db.prepare('SELECT id FROM users WHERE office_id=?').all(office)){
        if(person.id!==user.id)notify(db,office,person.id,'announcement',title,text.slice(0,160),'team-hub.html','announcement:'+id);
      }
      audit(null,user.id,'office_announcement_created',title);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    send(res,201,{ok:true,id});return true;
  });
  if(p==='/api/ops/team/messages'&&verb==='POST')return readBody(req).then(body=>{
    const recipient=Number(body?.recipientId),text=name(body?.body,1200);
    assert(Number.isSafeInteger(recipient)&&text.length>=1&&text.length<=1200,'Choose a colleague and enter a message');
    const person=db.prepare('SELECT id FROM users WHERE office_id=? AND id=?').get(office,recipient);
    if(!person||person.id===user.id)fail(400,'Recipient must belong to your office');
    const id=uid();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare("INSERT INTO ops_messages(id,office_id,sender_id,recipient_id,body,created_at) VALUES(?,?,?,?,?,?)")
        .run(id,office,user.id,recipient,text,iso());
      notify(db,office,recipient,'message','New message from '+(user.displayName||user.email),text.slice(0,160),'team-hub.html','message:'+id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    send(res,201,{ok:true,id});return true;
  });
  if(p==='/api/ops/workforce'&&verb==='GET'){
    send(res,200,{schedules:schedules(db,user),corrections:corrections(db,user),timesheets:timeEntries(db,user)});return true;
  }
  if(p==='/api/ops/workforce/schedules'&&verb==='POST')return readBody(req).then(body=>{
    requireAdmin(user);
    const staffId=Number(body?.userId),start=Date.parse(body?.startAt),end=Date.parse(body?.endAt);
    const note=name(body?.notes||'',400);
    assert(Number.isSafeInteger(staffId)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=24*60*60*1000,
      'Enter an employee, a shift start, and an end within 24 hours');
    assert(note.length<=400,'Notes must be under 400 characters');
    const employee=db.prepare('SELECT id FROM users WHERE id=? AND office_id=?').get(staffId,office);
    if(!employee)fail(404,'Employee does not belong to your office');
    const id=uid();
    db.prepare("INSERT INTO ops_schedules(id,office_id,user_id,start_at,end_at,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id,office,staffId,start,end,note,user.id,iso());
    notify(db,office,staffId,'schedule','New shift scheduled',new Date(start).toUTCString(),'workforce.html','schedule:'+id);
    audit(null,user.id,'schedule_created','Staff schedule added');
    send(res,201,{ok:true,id});return true;
  });
  const schedule=p.match(/^\/api\/ops\/workforce\/schedules\/([a-f0-9-]{36})$/i);
  if(schedule&&verb==='DELETE'){
    requireAdmin(user);
    const row=db.prepare('SELECT user_id FROM ops_schedules WHERE id=? AND office_id=?').get(schedule[1],office);
    if(!row)fail(404,'Shift schedule not found');
    db.prepare('DELETE FROM ops_schedules WHERE id=? AND office_id=?').run(schedule[1],office);
    notify(db,office,row.user_id,'schedule','Scheduled shift cancelled','A scheduled shift was removed. Check your calendar.','workforce.html');
    audit(null,user.id,'schedule_cancelled','Staff schedule removed');
    send(res,200,{ok:true});return true;
  }
  if(p==='/api/ops/workforce/corrections'&&verb==='POST')return readBody(req).then(body=>{
    const shiftId=Number(body?.shiftId),start=Date.parse(body?.startAt),end=Date.parse(body?.endAt);
    const reason=name(body?.reason,600);
    assert(Number.isSafeInteger(shiftId)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=48*3600000&&reason.length>=8&&reason.length<=600,'Enter a completed shift, corrected times, and a reason (8–600 characters)');
    const shift=db.prepare("SELECT id FROM work_shifts WHERE id=? AND user_id=? AND office_id=? AND ended_at IS NOT NULL").get(shiftId,user.id,office);
    if(!shift)fail(404,'Your completed shift was not found');
    const existing=db.prepare("SELECT id FROM ops_shift_corrections WHERE office_id=? AND shift_id=? AND status='pending'").get(office,shiftId);
    if(existing)fail(409,'This shift already has a pending correction');
    const id=uid();
    db.prepare("INSERT INTO ops_shift_corrections(id,office_id,shift_id,user_id,proposed_start,proposed_end,reason,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id,office,shiftId,user.id,start,end,reason,iso());
    for(const admin of db.prepare("SELECT id FROM users WHERE office_id=? AND role='admin'").all(office)){
      notify(db,office,admin.id,'correction','Shift correction requested',(user.displayName||user.email)+' requested a time adjustment','workforce.html','correction:'+id);
    }
    send(res,201,{ok:true,id});return true;
  });
  const decision=p.match(/^\/api\/ops\/workforce\/corrections\/([a-f0-9-]{36})$/i);
  if(decision&&verb==='PATCH')return readBody(req).then(body=>{
    requireAdmin(user);
    assert(['approved','rejected'].includes(body?.status),'Choose approved or rejected');
    const note=name(body?.note||'',600);
    assert(note.length<=600,'Review note too long');
    const row=db.prepare("SELECT * FROM ops_shift_corrections WHERE id=? AND office_id=? AND status='pending'").get(decision[1],office);
    if(!row)fail(404,'Pending correction not found');
    const outcome=db.prepare("UPDATE ops_shift_corrections SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=? AND office_id=? AND status='pending'")
      .run(body.status,note,user.id,iso(),row.id,office);
    if(!outcome.changes)fail(409,'Correction already reviewed');
    notify(db,office,row.user_id,'correction','Shift correction '+body.status,note||'Your correction request has been reviewed.','workforce.html','correction-result:'+row.id);
    audit(null,user.id,'shift_correction_'+body.status,'Correction decision recorded');
    send(res,200,{ok:true});return true;
  });
  if(p==='/api/ops/workforce/export'&&verb==='GET'){
    requireAdmin(user);
    const rows=timeEntries(db,user);
    const header=['Employee','Clocked in (UTC)','Clocked out (UTC)','Duration (hours)','Status'];
    const data=rows.map(row=>[row.employee,new Date(row.startedAt).toISOString(),row.endedAt?new Date(row.endedAt).toISOString():'',
      row.endedAt?((row.endedAt-row.startedAt)/3600000).toFixed(2):'',row.status]);
    const csv=[header,...data].map(row=>row.map(csvCell).join(',')).join('\r\n');
    res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8',
      'Content-Disposition':'attachment; filename="Cricket-office-timesheets.csv"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(csv);
    audit(null,user.id,'timesheet_exported','Office timesheet exported');
    return true;
  }
  fail(404,'Operations endpoint not found');
}
module.exports={setup,route,notify};
