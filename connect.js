'use strict';
/* Cricket Connect client: office DMs + 1:1 WebRTC calling. No external JS. */
(()=>{
 const $=id=>document.getElementById(id);
 const state={self:null,staff:[],recent:[],peer:null,stream:null,
   call:null,local:null,screen:null,pc:null,videoSender:null,remoteStream:null,
   pendingIce:[],iceServers:[],request:0,busy:false};
 let toastTimeout=null;
 const elem=(tag,cls,text)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;
  if(text!==undefined)e.textContent=String(text);return e;
 };
 const button=(id,action)=>$(id).addEventListener('click',action);
 const short=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
 const time=timestamp=>new Date(timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
 const peerName=id=>state.staff.find(x=>x.id===id)?.name||'Colleague';
 function toast(message,bad=false){
  const target=$('coToast');target.textContent=message;target.dataset.error=String(bad);
  target.hidden=false;clearTimeout(toastTimeout);
  toastTimeout=setTimeout(()=>{target.hidden=true;},5000);
 }
 async function api(path,options={}){
  const res=await fetch(path,{credentials:'same-origin',...options});
  let body={};try{body=await res.json();}catch(_){}
  if(!res.ok)throw Error(body.error||'Connect request failed ('+res.status+')');
  return body;
 }
 const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 function roster(){
  const list=$('coPeople'),query=$('coSearch').value.trim().toLowerCase();
  list.replaceChildren();
  const filtered=state.staff.filter(x=>x.name.toLowerCase().includes(query));
  $('coPeopleCount').textContent=String(filtered.length);
  if(!filtered.length){list.append(elem('p','connect-hint','No matching colleagues.'));return;}
  for(const person of filtered){
   const item=elem('button','connect-person');item.type='button';item.setAttribute('role','listitem');
   item.dataset.online=String(person.online);
   item.classList.toggle('active',state.peer===person.id);
   item.setAttribute('aria-pressed',String(state.peer===person.id));
   const avatar=elem('span','connect-avatar',short(person.name));
   avatar.append(elem('span','connect-online'));
   const detail=elem('span','connect-person-meta');
   detail.append(elem('strong','',person.name),
     elem('small','',person.online?'Online · '+person.role:'Offline · '+person.role));
   item.append(avatar,detail);
   item.addEventListener('click',()=>void selectPeer(person.id));
   list.append(item);
  }
 }
 async function selectPeer(id){
  if(!state.staff.some(x=>x.id===id))return;
  state.peer=id;const person=state.staff.find(x=>x.id===id);
  $('coPeerName').textContent=person.name;
  $('coPeerAvatar').textContent=short(person.name);
  $('coPeerMeta').textContent=(person.online?'Online':'Offline')+' · '+person.role;
  $('coAudio').disabled=false;$('coVideo').disabled=false;
  $('coMessage').disabled=false;$('coSend').disabled=false;
  $('coMessage').placeholder='Message '+person.name+'…';
  $('coEmpty').hidden=true;
  roster();await loadMessages(id);
 }
 async function loadMessages(id=state.peer){
  if(!id)return;
  const ticket=++state.request;
  try{
   const result=await api('/api/connect/messages?peer='+id);
   if(ticket!==state.request||state.peer!==id)return;
   const box=$('coMessages');box.replaceChildren();
   if(!result.messages.length){
    const hint=elem('div','connect-chat-placeholder');
    hint.append(elem('h2','','Start a new conversation'),
      elem('p','','Say hello to '+peerName(id)+'. Your messages are visible only to the two of you.'));
    box.append(hint);return;
   }
   for(const item of result.messages){
    const own=item.senderId===state.self.id;
    const outer=elem('article','connect-message'+(own?' own':''));
    if(!own)outer.append(elem('span','connect-avatar',short(peerName(id))));
    const bubble=elem('div','connect-message-bubble');
    bubble.append(elem('p','',item.body),elem('div','connect-message-time',time(item.createdAt)));
    outer.append(bubble);box.append(outer);
   }
   const container=$('coChatBody');container.scrollTop=container.scrollHeight;
  }catch(e){toast(e.message,true);}
 }
 async function sendMessage(ev){
  ev.preventDefault();
  if(!state.peer||state.busy)return;
  const input=$('coMessage'),body=input.value.trim();
  if(!body||body.length>2000)return;
  state.busy=true;$('coSend').disabled=true;
  try{
   await api('/api/connect/messages',json({recipientId:state.peer,body}));
   input.value='';await loadMessages();
  }catch(e){toast(e.message,true);}
  finally{state.busy=false;$('coSend').disabled=false;input.focus();}
 }
 function updateCallerView(){
  const call=state.call;
  if(!call){$('coCall').hidden=true;document.body.style.overflow='';return;}
  $('coCall').hidden=false;document.body.style.overflow='hidden';
  const incoming=call.state==='ringing'&&call.to===state.self.id;
  const outgoing=call.state==='ringing'&&call.from===state.self.id;
  $('coIncomingActions').hidden=!incoming;
  $('coOutgoingActions').hidden=!outgoing;
  $('coActiveActions').hidden=call.state!=='active';
  const other=call.from===state.self.id?call.to:call.from;
  const label=peerName(other);
  $('coCallName').textContent=label;
  $('coCallMode').textContent=call.kind==='video'?'Video':'Voice';
  $('coRemoteAvatar').textContent=short(label);
  $('coRemoteName').textContent=label;
  if(incoming)$('coCallStatus').textContent='Incoming '+call.kind+' call';
  else if(outgoing)$('coCallStatus').textContent='Ringing…';
  else $('coCallStatus').textContent='Connecting securely…';
  $('coCamera').disabled=call.kind!=='video';
  $('coCamera').setAttribute('aria-pressed','false');
  $('coCamera').textContent='Camera off';
  if(incoming)$('coAccept').focus();
 }
 function stopMedia(){
  if(state.screen){for(const t of state.screen.getTracks())t.stop();}
  if(state.local){for(const t of state.local.getTracks())t.stop();}
  if(state.pc){try{state.pc.ontrack=null;state.pc.onicecandidate=null;state.pc.close();}catch(_){}}
  state.screen=null;state.local=null;state.pc=null;state.videoSender=null;
  state.remoteStream=null;state.pendingIce=[];
  $('coLocal').srcObject=null;$('coLocal').hidden=true;
  $('coRemote').srcObject=null;$('coRemote').hidden=true;
  $('coVideoEmpty').hidden=false;
  $('coShare').setAttribute('aria-pressed','false');$('coShare').textContent='Share screen';
  $('coMute').setAttribute('aria-pressed','false');$('coMute').textContent='Mute microphone';
  $('coCamera').setAttribute('aria-pressed','false');$('coCamera').textContent='Camera off';
 }
 function clearCall(){
  stopMedia();state.call=null;updateCallerView();
 }
 async function hangup(){
  const id=state.call?.id;
  if(!id)return;
  clearCall();
  try{await api('/api/connect/calls/'+id+'/hangup',json({}));}
  catch(_){/* The local call has already ended; stop tracks regardless. */}
 }
 async function getLocal(kind){
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)
   throw Error('Calls require HTTPS or localhost. On a LAN IP using HTTP, text chat still works.');
  let media;
  try{
   media=await navigator.mediaDevices.getUserMedia({
    audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},
    video:kind==='video'?{width:{ideal:960},height:{ideal:540}}:false
   });
  }catch(error){
   if(kind==='video'){
    try{media=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      toast('Camera unavailable; continuing with your microphone.');}
    catch(_){throw Error('Allow microphone access to start a call.');}
   }else throw Error('Allow microphone access to start a call.');
  }
  return media;
 }
 function makeConnection(){
  if(!state.call||!state.local)return;
  const current=state.call;
  const pc=new RTCPeerConnection({iceServers:state.iceServers});
  state.pc=pc;state.remoteStream=new MediaStream();
  for(const track of state.local.getTracks())pc.addTrack(track,state.local);
  const cam=state.local.getVideoTracks()[0];
  if(cam)state.videoSender=pc.getSenders().find(sender=>sender.track===cam)||null;
  else state.videoSender=pc.addTransceiver('video',{direction:'sendrecv'}).sender;
  const audio=state.local.getAudioTracks()[0];
  if(audio)audio.enabled=true;
  const video=$('coLocal');
  video.srcObject=state.local;video.hidden=!cam;
  video.play().catch(()=>{});
  $('coCamera').disabled=!cam;
  $('coCamera').textContent=cam?'Camera on':'No camera';
  $('coCamera').setAttribute('aria-pressed',String(Boolean(cam&&cam.enabled)));
  pc.onicecandidate=event=>{
   if(!state.call||state.call.id!==current.id)return;
   // Only send genuine candidate records; remote end-of-candidates is implicit.
   if(event.candidate)void signal('ice',event.candidate.toJSON());
  };
  pc.ontrack=event=>{
   if(!state.call||state.call.id!==current.id)return;
   const remote=state.remoteStream;
   if(!remote.getTracks().some(t=>t.id===event.track.id))remote.addTrack(event.track);
   const viewer=$('coRemote');viewer.srcObject=remote;
   viewer.hidden=!remote.getVideoTracks().length;
   $('coVideoEmpty').hidden=!viewer.hidden;
   viewer.play().catch(()=>{toast('Click the remote video if your browser blocks automatic playback.');});
   event.track.onunmute=()=>{
    viewer.hidden=!remote.getVideoTracks().some(t=>t.readyState==='live'&&!t.muted);
    $('coVideoEmpty').hidden=!viewer.hidden;
   };
  };
  pc.onconnectionstatechange=()=>{
   if(!state.call||state.call.id!==current.id)return;
   const status=pc.connectionState;
   $('coCallStatus').textContent=status==='connected'?'Connected · Encrypted call':
    status==='failed'?'Call connection failed — a TURN relay may be required':
    status==='disconnected'?'Connection interrupted…':'Connecting…';
  };
  return pc;
 }
 async function signal(type,payload){
  if(!state.call)return;
  try{await api('/api/connect/calls/'+state.call.id+'/signal',json({type,payload}));}
  catch(e){toast('Call connection: '+e.message,true);}
 }
 async function flushIce(){
  while(state.pc?.remoteDescription&&state.pendingIce.length){
   const c=state.pendingIce.shift();
   try{await state.pc.addIceCandidate(c);}catch(_){}
  }
 }
 async function onSignal(packet){
  if(!state.call||state.call.id!==packet.callId||!state.pc)return;
  const pc=state.pc;
  try{
   if(packet.signalType==='offer'){
    if(state.call.to!==state.self.id)return;
    await pc.setRemoteDescription(packet.payload);
    await flushIce();
    const answer=await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await signal('answer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
   }else if(packet.signalType==='answer'){
    if(state.call.from!==state.self.id)return;
    await pc.setRemoteDescription(packet.payload);await flushIce();
   }else if(packet.signalType==='ice'){
    if(!pc.remoteDescription)state.pendingIce.push(packet.payload);
    else await pc.addIceCandidate(packet.payload);
   }
  }catch(e){toast('WebRTC negotiation failed. End the call and try again.',true);}
 }
 async function startCall(kind){
  if(!state.peer||state.call)return;
  let local;
  try{local=await getLocal(kind);}catch(e){toast(e.message,true);return;}
  state.local=local;
  try{
   const result=await api('/api/connect/calls',json({recipientId:state.peer,kind}));
   state.call=result.call;updateCallerView();
  }catch(e){stopMedia();toast(e.message,true);}
 }
 async function acceptCall(){
  if(!state.call||state.call.state!=='ringing')return;
  const call=state.call;
  $('coAccept').disabled=true;
  try{
   state.local=await getLocal(call.kind);
   makeConnection(); // Ready before the caller receives the accepted event.
   await api('/api/connect/calls/'+call.id+'/respond',json({accept:true}));
   state.call.state='active';updateCallerView();
   $('coCallStatus').textContent='Waiting for the caller to connect…';
  }catch(e){
   toast(e.message,true);
   try{await api('/api/connect/calls/'+call.id+'/respond',json({accept:false}));}catch(_){}
   clearCall();
  }finally{$('coAccept').disabled=false;}
 }
 async function declineCall(){
  if(!state.call)return;
  const call=state.call;
  clearCall();
  try{await api('/api/connect/calls/'+call.id+'/respond',json({accept:false}));}
  catch(e){toast(e.message,true);}
 }
 async function callEvent(packet){
  if(packet.action==='incoming'||packet.action==='outgoing'){
   state.call=packet.call;updateCallerView();
   if(packet.action==='incoming')toast('Incoming '+packet.call.kind+' call from '+peerName(packet.call.from));
  }else if(packet.action==='accepted'){
   if(!state.call||state.call.id!==packet.callId)return;
   state.call.state='active';updateCallerView();
   if(state.call.from===state.self.id&&state.local&&!state.pc){
    try{
     const pc=makeConnection(),offer=await pc.createOffer();
     await pc.setLocalDescription(offer);
     await signal('offer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
    }catch(e){toast('Could not start call: '+e.message,true);await hangup();}
   }
  }else if(['declined','ended','expired'].includes(packet.action)){
   if(state.call?.id===packet.callId){
    clearCall();toast(packet.action==='declined'?'Call declined':packet.action==='expired'?'Call timed out':'Call ended');
   }
  }
 }
 async function connectEvents(){
  if(!state.self)return;
  const es=new EventSource('/api/connect/events');
  state.stream=es;
  es.onopen=()=>{$('coConnection').textContent='Live updates connected';
    $('coConnection').parentElement.dataset.live='true';};
  es.onerror=()=>{$('coConnection').textContent='Reconnecting to team…';
    $('coConnection').parentElement.dataset.live='false';};
  es.addEventListener('connect',event=>{
   let packet;try{packet=JSON.parse(event.data);}catch(_){return;}
   if(packet.type==='presence'){
    const person=state.staff.find(x=>x.id===packet.userId);
    if(person){person.online=packet.online;roster();
      if(state.peer===person.id)$('coPeerMeta').textContent=(person.online?'Online':'Offline')+' · '+person.role;}
   }else if(packet.type==='message'){
    const other=packet.from===state.self.id?packet.to:packet.from;
    if(other===state.peer)void loadMessages(other);
    else if(packet.from!==state.self.id)toast('New message from '+peerName(packet.from));
   }else if(packet.type==='call')void callEvent(packet);
   else if(packet.type==='signal')void onSignal(packet);
  });
 }
 async function toggleMic(){
  const mic=state.local?.getAudioTracks()[0];
  if(!mic)return;
  mic.enabled=!mic.enabled;
  $('coMute').setAttribute('aria-pressed',String(!mic.enabled));
  $('coMute').textContent=mic.enabled?'Mute microphone':'Unmute microphone';
 }
 function toggleCamera(){
  const cam=state.local?.getVideoTracks()[0];
  if(!cam||state.screen)return;
  cam.enabled=!cam.enabled;
  $('coCamera').setAttribute('aria-pressed',String(cam.enabled));
  $('coCamera').textContent=cam.enabled?'Camera on':'Camera off';
 }
 async function stopSharing(){
  const stream=state.screen;if(!stream)return;
  state.screen=null;
  const cam=state.local?.getVideoTracks()[0]||null;
  try{await state.videoSender?.replaceTrack(cam);}catch(e){toast('Could not restore camera.',true);}
  for(const t of stream.getTracks())t.stop();
  $('coLocal').srcObject=state.local;
  $('coLocal').hidden=!cam;$('coLocal').play().catch(()=>{});
  $('coShare').textContent='Share screen';$('coShare').setAttribute('aria-pressed','false');
 }
 async function toggleShare(){
  if(!state.pc||!state.videoSender)return;
  if(state.screen){await stopSharing();return;}
  if(!navigator.mediaDevices?.getDisplayMedia||!window.isSecureContext){
   toast('Screen sharing requires HTTPS or localhost.',true);return;
  }
  try{
   // Browser permission is requested only from this explicit click.
   const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
   const track=stream.getVideoTracks()[0];
   if(!track){stream.getTracks().forEach(t=>t.stop());return;}
   await state.videoSender.replaceTrack(track);
   state.screen=stream;
   $('coLocal').srcObject=stream;$('coLocal').hidden=false;
   $('coLocal').play().catch(()=>{});
   $('coShare').textContent='Stop sharing';$('coShare').setAttribute('aria-pressed','true');
   track.addEventListener('ended',()=>{if(state.screen===stream)void stopSharing();},{once:true});
  }catch(e){toast('Screen sharing cancelled or unavailable.',true);}
 }
 async function init(){
  try{
   const boot=await api('/api/connect/bootstrap');
   state.self=boot.self;state.staff=boot.staff;state.recent=boot.recent||[];
   state.iceServers=boot.iceServers||[];
   $('coOffice').textContent=boot.office.name+' · '+boot.staff.length+' colleagues';
   roster();
   if(boot.call){
    state.call=boot.call;
    if(boot.call.state==='active'){
     await hangup();toast('Previous call closed after reconnecting this page.');
    }else updateCallerView();
   }
   await connectEvents();
  }catch(e){
   $('coPeople').replaceChildren(elem('p','connect-hint','Connect could not load. '+e.message));
   $('coConnection').textContent='Offline';toast(e.message,true);
  }
 }
 function wire(){
  $('coSearch').addEventListener('input',roster);
  $('coMessageForm').addEventListener('submit',ev=>void sendMessage(ev));
  $('coMessage').addEventListener('keydown',ev=>{
   if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();
    $('coMessageForm').requestSubmit();}
  });
  button('coAudio',()=>void startCall('audio'));
  button('coVideo',()=>void startCall('video'));
  button('coAccept',()=>void acceptCall());
  button('coDecline',()=>void declineCall());
  button('coHangup',()=>void hangup());
  button('coCancelCall',()=>void hangup());
  button('coMute',toggleMic);button('coCamera',toggleCamera);
  button('coShare',()=>void toggleShare());
  window.addEventListener('pagehide',()=>{
   state.stream?.close();
   if(state.call?.id){
    fetch('/api/connect/calls/'+state.call.id+'/hangup',{
      method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:'{}',keepalive:true}).catch(()=>{});
   }
   clearCall();
  });
  void init();
 }
 if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',wire,{once:true});
 else wire();
})();
