'use strict';
// Cricket Connect: isolated office communication. No npm dependencies.
// SQLite stores text messages only; signaling and presence remain in memory.
const crypto=require('node:crypto');
const streams=new Map(),calls=new Map(),limits=new Map();
const roles=new Set(['agent','qc','admin']);
const error=(status,message)=>{const e=Error(message);e.status=status;throw e;};
const key=(office,id)=>office+':'+id;
function setup(db){
 db.exec('CREATE TABLE IF NOT EXISTS connect_messages('+
  'id TEXT PRIMARY KEY,office_id INTEGER NOT NULL REFERENCES offices(id) ON DELETE CASCADE,'+
  'sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
  'recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,'+
  'body TEXT NOT NULL,created_at INTEGER NOT NULL)');
 db.exec('CREATE INDEX IF NOT EXISTS idx_connect_messages_from ON connect_messages(office_id,sender_id,recipient_id,created_at DESC)');
 db.exec('CREATE INDEX IF NOT EXISTS idx_connect_messages_to ON connect_messages(office_id,recipient_id,created_at DESC)');
}
function rate(user,name,max){
 const at=Date.now(),id=key(user.office.id,user.id)+':'+name;
 if(limits.size>5000)for(const [k,v] of limits)if(at-v.start>=60000)limits.delete(k);
 let row=limits.get(id);
 if(!row||at-row.start>=60000){row={start:at,n:0};limits.set(id,row);}
 if(++row.n>max)error(429,'Too many Connect requests; please slow down');
}
function colleague(db,user,id){
 if(!Number.isSafeInteger(id)||id<1||id===user.id)error(400,'Choose a colleague');
 const row=db.prepare('SELECT id,display_name AS name,role FROM users WHERE id=? AND office_id=?').get(id,user.office.id);
 if(!row)error(404,'Colleague not found in this office');
 return row;
}
function notify(office,id,message){
 const recipients=streams.get(key(office,id));
 if(!recipients)return;
 const data='event: connect\ndata: '+JSON.stringify(message)+'\n\n';
 for(const res of [...recipients])if(!res.destroyed&&!res.writableEnded){
   try{res.write(data);}catch(_){recipients.delete(res);}
 }
}
function tellOffice(office,message){
 for(const id of streams.keys())if(id.startsWith(office+':'))
  notify(office,Number(id.slice((office+':').length)),message);
}
function isOnline(office,id){return Boolean(streams.get(key(office,id))?.size);}
function events(req,res,user,hasAccess){
 const office=user.office.id,id=user.id,identity=key(office,id);
 let connections=streams.get(identity);
 if(!connections){connections=new Set();streams.set(identity,connections);}
 if(connections.size>=4)error(429,'Too many Connect windows');
 const wasOffline=!connections.size;
 res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',
   'Cache-Control':'no-store, no-transform','Connection':'keep-alive',
   'X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
 res.write('retry: 3000\n\n');
 connections.add(res);
 notify(office,id,{type:'ready'});
 if(wasOffline)tellOffice(office,{type:'presence',userId:id,online:true});
 const timer=setInterval(()=>{
   if(!hasAccess(office)){res.end();return;}
   try{res.write(': heartbeat\n\n');}catch(_){}
 },20000);
 timer.unref?.();
 let closed=false;
 const close=()=>{
  if(closed)return;closed=true;clearInterval(timer);
  const current=streams.get(identity);current?.delete(res);
  if(current?.size===0){streams.delete(identity);tellOffice(office,{type:'presence',userId:id,online:false});}
 };
 // The incoming HTTP request may complete immediately for a GET; only
 // the streaming response's close event indicates a disconnected subscriber.
 res.on('close',close);res.on('error',close);
 return true;
}
function disconnectOffice(office){
 // Shut down active peer connections before closing the signaling channel.
 tellOffice(office,{type:'disabled'});
 for(const [id,set] of [...streams])if(id.startsWith(office+':')){
  for(const res of set)try{res.end();}catch(_){}
  streams.delete(id);
 }
 for(const [id,call] of calls)if(call.office===office)calls.delete(id);
}
function closeAll(){
 for(const set of streams.values())for(const res of set)try{res.end();}catch(_){}
 streams.clear();calls.clear();
}
function expire(){
 const at=Date.now();
 for(const [id,c] of calls)if(c.expiry<=at){
  calls.delete(id);
  notify(c.office,c.from,{type:'call',action:'expired',callId:id});
  notify(c.office,c.to,{type:'call',action:'expired',callId:id});
 }
}
// Expire unanswered invitations even when neither employee sends a request.
const expireTimer=setInterval(expire,5000);
expireTimer.unref?.();
function active(user){
 expire();
 for(const c of calls.values())if(c.office===user.office.id&&(c.from===user.id||c.to===user.id))return c;
 return null;
}
function callView(db,c){
 if(!c)return null;
 const from=db.prepare('SELECT display_name AS name FROM users WHERE id=? AND office_id=?').get(c.from,c.office);
 const to=db.prepare('SELECT display_name AS name FROM users WHERE id=? AND office_id=?').get(c.to,c.office);
 return {id:c.id,from:c.from,to:c.to,fromName:from?.name||'Colleague',
   toName:to?.name||'Colleague',kind:c.kind,state:c.state,createdAt:c.createdAt};
}
function iceServers(){
 const value=process.env.CRICKET_CONNECT_ICE_SERVERS;
 if(!value)return [{urls:'stun:stun.l.google.com:19302'}];
 try{
  const parsed=JSON.parse(value);
  if(!Array.isArray(parsed)||parsed.length>8)throw Error();
  return parsed.filter(x=>x&&JSON.stringify(x).length<2500&&
   (typeof x.urls==='string'||Array.isArray(x.urls)))
   .map(x=>({urls:x.urls,...(typeof x.username==='string'?{username:x.username}:{}),
     ...(typeof x.credential==='string'?{credential:x.credential}:{})}));
 }catch(_){return [];}
}
function checkSignal(body){
 if(!body||!['offer','answer','ice'].includes(body.type))error(400,'Unknown call signal');
 const p=body.payload;
 if(!p||typeof p!=='object'||Array.isArray(p)||JSON.stringify(p).length>14500)
  error(400,'Invalid call signal');
 if(body.type!=='ice'){
  if(p.type!==body.type||typeof p.sdp!=='string'||p.sdp.length<12||p.sdp.length>14000)
    error(400,'Invalid session description');
  return {type:p.type,sdp:p.sdp};
 }
 if(p.candidate!==null&&typeof p.candidate!=='string')error(400,'Invalid ICE candidate');
 if(typeof p.candidate==='string'&&p.candidate.length>3000)error(400,'ICE candidate too long');
 if(p.sdpMid!=null&&(typeof p.sdpMid!=='string'||p.sdpMid.length>120))
  error(400,'Invalid ICE media');
 if(p.sdpMLineIndex!=null&&(!Number.isInteger(p.sdpMLineIndex)||p.sdpMLineIndex<0||p.sdpMLineIndex>64))
  error(400,'Invalid ICE media index');
 return {candidate:p.candidate??null,sdpMid:p.sdpMid??null,sdpMLineIndex:p.sdpMLineIndex??null};
}
async function route({p,req,res,user,db,send,readBody,hasAccess}){
 if(!user)error(401,'Sign in required');
 if(!roles.has(user.role)||!user.office?.id)error(403,'Office account required');
 const office=user.office.id,verb=req.method;
 if(p==='/api/connect/events'&&verb==='GET')return events(req,res,user,hasAccess);
 if(p==='/api/connect/bootstrap'&&verb==='GET'){
  const staff=db.prepare('SELECT id,display_name AS name,role FROM users WHERE office_id=? AND id<>? ORDER BY display_name COLLATE NOCASE LIMIT 500')
   .all(office,user.id).map(x=>({...x,online:isOnline(office,x.id)}));
  const recent=db.prepare('SELECT id,sender_id AS senderId,recipient_id AS recipientId,body,created_at AS createdAt FROM connect_messages WHERE office_id=? AND (sender_id=? OR recipient_id=?) ORDER BY created_at DESC,id DESC LIMIT 100')
   .all(office,user.id,user.id);
  return send(res,200,{self:{id:user.id,name:user.displayName||user.email},
   office:{name:user.office.name},staff,recent,call:callView(db,active(user)),iceServers:iceServers()});
 }
 if(p==='/api/connect/messages'&&verb==='GET'){
  const id=Number(new URL(req.url,'http://localhost').searchParams.get('peer'));
  colleague(db,user,id);
  const messages=db.prepare('SELECT id,sender_id AS senderId,recipient_id AS recipientId,body,created_at AS createdAt FROM connect_messages WHERE office_id=? AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) ORDER BY created_at DESC,id DESC LIMIT 100')
   .all(office,user.id,id,id,user.id).reverse();
  return send(res,200,{messages});
 }
 if(p==='/api/connect/messages'&&verb==='POST'){
  rate(user,'messages',30);
  const data=await readBody(req),other=colleague(db,user,Number(data?.recipientId));
  const body=typeof data?.body==='string'?data.body.trim():'';
  if(!body||body.length>2000)error(400,'Message must contain 1–2000 characters');
  const id=crypto.randomUUID(),createdAt=Date.now();
  db.prepare('INSERT INTO connect_messages(id,office_id,sender_id,recipient_id,body,created_at) VALUES(?,?,?,?,?,?)')
   .run(id,office,user.id,other.id,body,createdAt);
  const message={id,senderId:user.id,recipientId:other.id,body,createdAt};
  notify(office,other.id,{type:'message',from:user.id,to:other.id});
  notify(office,user.id,{type:'message',from:user.id,to:other.id});
  return send(res,201,{message});
 }
 if(p==='/api/connect/calls'&&verb==='GET')return send(res,200,{call:callView(db,active(user))});
 if(p==='/api/connect/calls'&&verb==='POST'){
  rate(user,'calls',12);
  const data=await readBody(req),other=colleague(db,user,Number(data?.recipientId));
  if(!['audio','video'].includes(data?.kind))error(400,'Select voice or video');
  if(active(user))error(409,'Finish your current call first');
  for(const c of calls.values())if(c.office===office&&(c.from===other.id||c.to===other.id))
   error(409,'Colleague is already in a call');
  const id=crypto.randomUUID(),createdAt=Date.now();
  const c={id,office,from:user.id,to:other.id,kind:data.kind,state:'ringing',createdAt,expiry:createdAt+90000};
  calls.set(id,c);
  const view=callView(db,c);
  notify(office,other.id,{type:'call',action:'incoming',call:view});
  notify(office,user.id,{type:'call',action:'outgoing',call:view});
  return send(res,201,{call:view});
 }
 const hit=p.match(/^\/api\/connect\/calls\/([0-9a-f-]{36})\/(respond|signal|hangup)$/);
 if(!hit)return false;
 if(verb!=='POST')error(405,'Method not allowed');
 const c=calls.get(hit[1]);
 if(!c||c.office!==office||(c.from!==user.id&&c.to!==user.id))error(404,'Call not found');
 if(c.expiry<=Date.now()){calls.delete(c.id);error(410,'Call expired');}
 const other=c.from===user.id?c.to:c.from;
 if(hit[2]==='respond'){
  const data=await readBody(req);
  if(c.state!=='ringing'||c.to!==user.id||typeof data?.accept!=='boolean')
   error(409,'Call cannot be answered');
  if(data.accept){c.state='active';c.expiry=Date.now()+7200000;}
  else calls.delete(c.id);
  for(const id of [c.from,c.to])notify(office,id,{type:'call',action:data.accept?'accepted':'declined',callId:c.id});
  return send(res,200,{accepted:data.accept});
 }
 if(hit[2]==='signal'){
  if(c.state!=='active')error(409,'Accept call before signaling');
  rate(user,'signals',240);
  const data=await readBody(req),payload=checkSignal(data);
  notify(office,other,{type:'signal',callId:c.id,from:user.id,signalType:data.type,payload});
  return send(res,200,{ok:true});
 }
 if(hit[2]==='hangup'){
  calls.delete(c.id);
  for(const id of [c.from,c.to])notify(office,id,{type:'call',action:'ended',callId:c.id});
  return send(res,200,{ok:true});
 }
 return false;
}
module.exports={setup,route,disconnectOffice,closeAll};
