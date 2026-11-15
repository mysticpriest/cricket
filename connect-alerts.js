'use strict';
/*
 * Cross-workspace Cricket Connect alerts.
 * Loaded ONLY for entitled signed-in employee offices by Fluent shell.
 * On connect.html, Connect itself owns SSE signaling; this module owns sounds
 * and visual/desktop notifications. It never sends message text to the OS.
 */
(()=>{
 if(window.CricketConnectAlerts)return;
 const isConnect=location.pathname.split('/').pop()==='connect.html';
 const state={self:null,staff:[],stream:null,ringTimer:null,ringId:null,
   ringKind:null,unread:0,activeToast:null,ready:false};
 const $=id=>document.getElementById(id);
 const make=(tag,cls,text)=>{
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(text!==undefined)node.textContent=String(text);
  return node;
 };
 const sound=name=>window.CricketSound?.play(name);
 const nameOf=id=>state.staff.find(x=>x.id===id)?.name||'a colleague';
 function setUnread(n){
  state.unread=Math.max(0,n);
  const target=$('cnCount');
  if(target){target.textContent=state.unread>99?'99+':String(state.unread);target.hidden=!state.unread;}
 }
 function stopTone(){
  if(state.ringTimer!==null){clearInterval(state.ringTimer);state.ringTimer=null;}
  state.ringId=null;state.ringKind=null;
 }
 function ring(id,kind){
  if(state.ringId===id&&state.ringKind===kind)return;
  stopTone();state.ringId=id;state.ringKind=kind;
  const type=kind==='incoming'?'connect-incoming':'connect-ringback';
  sound(type);
  state.ringTimer=setInterval(()=>sound(type),kind==='incoming'?2900:3100);
 }
 function removeCallToast(){
  if(state.activeToast){state.activeToast.remove();state.activeToast=null;}
 }
 function popup(title,description,href,kind='message',persistent=false){
  const stack=$('cnNotificationStack');
  if(!stack)return;
  if(kind==='call')removeCallToast();
  const card=make('article','cn-toast');
  card.dataset.type=kind;
  if(kind==='call')card.append(make('span','cn-call-indicator'));
  const body=make('div','cn-toast-copy');
  body.append(make('strong','',title),make('p','',description));
  const actions=make('div','cn-toast-actions');
  if(href){
   const go=make('a','',kind==='call'?'Open call':'Read message');
   go.href=href;actions.append(go);
  }
  const close=make('button','cn-toast-close','×');
  close.type='button';close.setAttribute('aria-label','Dismiss Connect notification');
  close.addEventListener('click',()=>{card.remove();if(state.activeToast===card)state.activeToast=null;});
  body.append(actions);
  card.append(body,close);
  stack.prepend(card);
  if(kind==='call')state.activeToast=card;
  if(!persistent)setTimeout(()=>{card.remove();if(state.activeToast===card)state.activeToast=null;},7800);
  while(stack.children.length>4){
   const last=stack.lastElementChild;
   if(last===state.activeToast)break;
   last?.remove();
  }
 }
 function desktop(title,body,href){
  if(!window.isSecureContext||!('Notification' in window)||
     Notification.permission!=='granted'||!document.hidden)return;
  try{
   const n=new Notification(title,{body,tag:'cricket-connect-'+href,
     silent:true,icon:undefined});
   n.onclick=()=>{try{window.focus();location.assign(href);}finally{n.close();}};
   setTimeout(()=>n.close(),12000);
  }catch(_){/* In-app banner is available if desktop alerts are blocked. */}
 }
 function message(packet){
  if(!state.self||packet.from===state.self.id)return;
  const sender=nameOf(packet.from),href='connect.html?peer='+encodeURIComponent(packet.from);
  setUnread(state.unread+1);
  sound('connect-text');
  // When already viewing Connect, avoid duplicate message overlays; the
  // conversation itself updates via Connect's own stream.
  if(!isConnect)popup('Message from '+sender,'You have a new private message.',href);
  desktop('Cricket Connect · New message','Message from '+sender,href);
 }
 function call(packet){
  if(!state.self)return;
  if(packet.action==='incoming'&&packet.call?.to===state.self.id){
   const other=nameOf(packet.call.from);
   ring(packet.call.id,'incoming');
   const href='connect.html?call='+encodeURIComponent(packet.call.id);
   if(!isConnect)popup('Incoming '+packet.call.kind+' call',
     other+' is calling. Open Connect to accept or decline.',href,'call',true);
   desktop('Incoming Cricket Connect call',other+' is calling.',href);
  }else if(packet.action==='outgoing'&&packet.call?.from===state.self.id){
   if(isConnect)ring(packet.call.id,'outgoing');
  }else if(['accepted','declined','ended','expired'].includes(packet.action)){
   if(state.ringId===packet.callId){
    stopTone();removeCallToast();
    if(packet.action==='declined'||packet.action==='ended'||packet.action==='expired')
     sound('connect-ended');
   }
  }
 }
 function handle(packet){
  if(!packet||typeof packet!=='object')return;
  if(packet.type==='message')message(packet);
  else if(packet.type==='call')call(packet);
  else if(packet.type==='disabled'){
   stopTone();removeCallToast();state.stream?.close();
   state.stream=null;$('cnDock')?.remove();
   popup('Cricket Connect disabled','Your organization no longer has access to this module.',null);
  }
 }
 function render(){
  const dock=make('aside','cn-dock');dock.id='cnDock';
  const bell=make('button','cn-bell');
  bell.id='cnBell';bell.type='button';
  bell.setAttribute('aria-label','Cricket Connect notifications');
  bell.setAttribute('aria-expanded','false');
  bell.setAttribute('aria-controls','cnMenu');
  bell.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M5 18h14l-2-3V9a5 5 0 0 0-10 0v6l-2 3zM10 21h4"/></svg>';
  bell.append(make('span','','Connect'));
  const badge=make('span','cn-count','0');badge.id='cnCount';badge.hidden=true;bell.append(badge);
  const menu=make('section','cn-menu');menu.id='cnMenu';menu.hidden=true;
  const top=make('div','cn-menu-head');
  top.append(make('strong','','Connect alerts'),make('span','','Office only'));
  menu.append(top,make('p','','New messages and incoming calls appear here while you are signed in to Cricket and have a page open.'));
  const open=make('a','','Open Cricket Connect');
  open.href='connect.html';menu.append(open);
  const audio=make('button','','Play test notification sound');audio.type='button';
  audio.addEventListener('click',()=>{if(!sound('connect-text'))renderSoundStatus('Enable sound effects in Cricket settings and interact with this page first.');});
  menu.append(audio);
  const permissions=make('button','','Enable desktop notifications');permissions.type='button';
  if(!window.isSecureContext||!('Notification' in window)){
   permissions.disabled=true;
   permissions.textContent='Desktop alerts require HTTPS';
  }else if(Notification.permission==='granted'){
   permissions.disabled=true;permissions.textContent='Desktop alerts enabled';
  }else if(Notification.permission==='denied'){
   permissions.disabled=true;permissions.textContent='Desktop alerts blocked in browser';
  }else{
   permissions.addEventListener('click',async()=>{
    // Browser permission is requested only when the employee clicks this.
    try{
     const result=await Notification.requestPermission();
     permissions.textContent=result==='granted'?'Desktop alerts enabled':
      'Desktop alerts not enabled';
     permissions.disabled=result!=='default';
    }catch(_){permissions.textContent='Could not enable desktop notifications';}
   });
  }
  menu.append(permissions);
  const status=make('p','','Sounds follow your existing Cricket sound settings and browser autoplay permissions.');
  status.id='cnSoundStatus';menu.append(status);
  bell.addEventListener('click',()=>{
   menu.hidden=!menu.hidden;
   bell.setAttribute('aria-expanded',String(!menu.hidden));
   if(!menu.hidden)setUnread(0);
  });
  document.addEventListener('keydown',ev=>{
   if(ev.key==='Escape'&&!menu.hidden){menu.hidden=true;bell.setAttribute('aria-expanded','false');}
  });
  document.addEventListener('pointerdown',ev=>{
   if(!dock.contains(ev.target)&&!menu.hidden){
    menu.hidden=true;bell.setAttribute('aria-expanded','false');
   }
  });
  dock.append(bell,menu);
  const stack=make('div','cn-notification-stack');stack.id='cnNotificationStack';
  stack.setAttribute('aria-live','polite');
  document.body.append(dock,stack);
 }
 function renderSoundStatus(text){
  if($('cnSoundStatus'))$('cnSoundStatus').textContent=text;
 }
 function openStream(){
  if(isConnect||!window.EventSource)return;
  const es=new EventSource('/api/connect/events');
  state.stream=es;
  es.addEventListener('connect',ev=>{
   try{handle(JSON.parse(ev.data));}catch(_){}
  });
  es.onerror=()=>{renderSoundStatus('Live notifications reconnect automatically if the network drops.');};
 }
 async function init(){
  try{
   const res=await fetch('/api/connect/bootstrap',{credentials:'same-origin'});
   if(!res.ok)return;
   const info=await res.json();
   if(!info.self?.id)return;
   state.self=info.self;
   state.staff=info.staff||[];
   render();state.ready=true;
   // Use the same employee sound preferences as the rest of Cricket.
   try{await window.CricketSound?.load();}catch(_){}
   if(info.call?.state==='ringing'){
    if(info.call.to===state.self.id)handle({type:'call',action:'incoming',call:info.call});
    else if(isConnect)handle({type:'call',action:'outgoing',call:info.call});
   }
   openStream();
  }catch(_){/* Never break the host workspace if Connect is unavailable. */}
 }
 window.CricketConnectAlerts=Object.freeze({
  handle,stop:()=>{stopTone();removeCallToast();},
  startDial:callInfo=>handle({type:'call',action:'outgoing',call:callInfo}),
  isReady:()=>state.ready
 });
 window.addEventListener('pagehide',()=>{stopTone();state.stream?.close();});
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',()=>void init(),{once:true});
 else void init();
})();
