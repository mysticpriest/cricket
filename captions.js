'use strict';
/*
 * Caller captions — authorized computer/tab audio only, never microphone input.
 * Audio exists in memory for six seconds at a time and is sent to Cricket's
 * authenticated Azure Speech proxy. Transcript is never saved automatically.
 */
(()=>{
  const INTERVAL_SECONDS=6;
  const MAX_LINES=100;
  const $=id=>document.getElementById(id);
  const el=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=String(text);
    return node;
  };
  const button=(label,id,cls)=>{
    const node=el('button',cls||'cc-button',label);
    node.type='button';node.id=id;return node;
  };
  let configured=false,active=false,stream=null,context=null,source=null,processor=null,mute=null;
  let chunks=[],frames=0,queue=Promise.resolve(),inFlight=0,session=0;
  let transcript=[],opened=false,startTime=0;
  function status(message,kind='info'){
    const node=$('ccStatus');
    if(node){node.textContent=message;node.dataset.kind=kind;}
  }
  function refresh(){
    const live=active;
    $('ccStart').disabled=live||!configured;
    $('ccStop').disabled=!live;
    $('ccLanguage').disabled=live;
    $('ccConsent').disabled=live;
    $('ccLauncher').classList.toggle('is-listening',live);
    $('ccLive').hidden=!live;
    $('ccTranscriptEmpty').hidden=transcript.length>0;
    $('ccCopy').disabled=transcript.length===0;
    $('ccClear').disabled=transcript.length===0;
    $('ccPending').textContent=inFlight?inFlight+' segment'+(inFlight===1?'':'s')+' processing':'';
  }
  function display(){
    const host=$('ccLines');
    const nearEnd=host.scrollHeight-host.scrollTop-host.clientHeight<65;
    host.replaceChildren();
    for(const line of transcript){
      const entry=el('div','cc-line');
      const time=el('time','cc-time',line.time);
      const content=el('p','',line.text);
      entry.append(time,content);host.append(entry);
    }
    if(nearEnd)host.scrollTop=host.scrollHeight;
    refresh();
  }
  function addLine(text){
    if(!text||!text.trim())return;
    transcript.push({text:text.trim(),time:new Date().toLocaleTimeString([],{
      hour:'2-digit',minute:'2-digit',second:'2-digit'
    })});
    if(transcript.length>MAX_LINES)transcript.shift();
    display();
  }
  function downsample(samples,rate){
    const size=Math.floor(samples.length*16000/rate);
    const wav=new ArrayBuffer(44+size*2),view=new DataView(wav);
    const ascii=(pos,text)=>{for(let i=0;i<text.length;i++)view.setUint8(pos+i,text.charCodeAt(i));};
    ascii(0,'RIFF');view.setUint32(4,36+size*2,true);ascii(8,'WAVE');
    ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);
    view.setUint16(22,1,true);view.setUint32(24,16000,true);
    view.setUint32(28,32000,true);view.setUint16(32,2,true);
    view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,size*2,true);
    for(let i=0;i<size;i++){
      const position=i*rate/16000,left=Math.floor(position);
      const remainder=position-left;
      const value=(samples[left]||0)*(1-remainder)+(samples[Math.min(left+1,samples.length-1)]||0)*remainder;
      const clamped=Math.max(-1,Math.min(1,value));
      view.setInt16(44+i*2,clamped<0?Math.round(clamped*32768):Math.round(clamped*32767),true);
    }
    return wav;
  }
  function takeFrames(){
    const total=frames;
    if(!total)return null;
    const samples=new Float32Array(total);
    let offset=0;
    for(const part of chunks){samples.set(part,offset);offset+=part.length;}
    chunks=[];frames=0;return samples;
  }
  function enqueue(samples,rate,run){
    if(!samples||samples.length/rate<.5)return;
    if(inFlight>=2){
      status('Caption service is behind; a segment was skipped.','warning');
      return;
    }
    const wave=downsample(samples,rate);
    const language=$('ccLanguage').value;
    inFlight++;refresh();
    queue=queue.catch(()=>{}).then(async()=>{
      if(run!==session)return;
      try{
        const response=await fetch('/api/captions/transcribe',{
          method:'POST',credentials:'same-origin',
          headers:{
            'Content-Type':'audio/wav',
            'X-Cricket-Captions-Consent':'yes',
            'X-Cricket-Caption-Language':language
          },
          body:wave
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(payload.error||'Speech service unavailable');
        if(run!==session)return;
        if(payload.text)addLine(payload.text);
        if(active)status('Listening to shared computer audio…','live');
        else status('Capture stopped. Captions are held in this tab only.','info');
      }catch(error){
        if(run!==session)return;
        status(error.message||'Caption request failed','error');
        if(responseShouldStop(error))stop(false);
      }
    }).finally(()=>{if(run===session){inFlight=Math.max(0,inFlight-1);refresh();}});
  }
  function responseShouldStop(error){
    return /not configured|session|authorization|credentials|consent/i.test(String(error?.message||''));
  }
  function stop(flush=true){
    if(!active&&!stream)return;
    const wasActive=active;
    active=false;
    const remaining=flush&&wasActive?takeFrames():null;
    const rate=context?.sampleRate||48000,run=session;
    if(processor){processor.onaudioprocess=null;try{processor.disconnect();}catch(_){}}
    if(source)try{source.disconnect();}catch(_){}
    if(mute)try{mute.disconnect();}catch(_){}
    if(stream)stream.getTracks().forEach(t=>t.stop());
    stream=null;processor=null;source=null;mute=null;
    // Each new caller session must reconfirm recording/transcription consent.
    if($('ccConsent'))$('ccConsent').checked=false;
    if(context)void context.close().catch(()=>{});
    context=null;chunks=[];frames=0;
    if(remaining)enqueue(remaining,rate,run);
    if(wasActive)status('Capture stopped. Transcript stays in this tab until cleared.','info');
    refresh();
  }
  async function start(){
    if(active||!configured)return;
    if(!$('ccConsent').checked){
      status('Confirm permission and caller consent before starting.','warning');
      $('ccConsent').focus();return;
    }
    if(!window.isSecureContext||!navigator.mediaDevices?.getDisplayMedia){
      status('Audio sharing needs Chrome/Edge on localhost or HTTPS.','error');return;
    }
    // Screen or tab selection MUST be initiated directly by this user click.
    // A video track is mandatory for getDisplayMedia but is never examined.
    let selected;
    try{
      selected=await navigator.mediaDevices.getDisplayMedia({
        video:true,audio:true,systemAudio:'include',
        surfaceSwitching:'include',selfBrowserSurface:'exclude'
      });
    }catch(error){
      status(error?.name==='NotAllowedError'?'Audio sharing was cancelled.':
        'Could not start screen/tab audio sharing.','error');return;
    }
    const track=selected.getAudioTracks()[0];
    if(!track){
      selected.getTracks().forEach(t=>t.stop());
      status('No audio was shared. Select the caller’s tab and enable “Share tab audio”, or choose system audio.','error');
      return;
    }
    try{
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw Error('This browser cannot process shared audio.');
      stream=selected;
      context=new Audio();
      if(typeof context.createScriptProcessor!=='function')
        throw Error('This browser cannot process shared audio.');
      source=context.createMediaStreamSource(new MediaStream([track]));
      processor=context.createScriptProcessor(4096,1,1);
      mute=context.createGain();mute.gain.value=0;
      chunks=[];frames=0;queue=Promise.resolve();inFlight=0;
      const run=++session;
      processor.onaudioprocess=event=>{
        if(!active)return;
        const samples=event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(samples));frames+=samples.length;
        if(frames>=context.sampleRate*INTERVAL_SECONDS){
          enqueue(takeFrames(),context.sampleRate,run);
        }
      };
      source.connect(processor);processor.connect(mute);mute.connect(context.destination);
      active=true;startTime=Date.now();
      for(const item of selected.getTracks()){
        item.addEventListener('ended',()=>{if(active)stop(true);},{once:true});
      }
      if(context.state==='suspended')await context.resume();
      status('Listening to shared computer audio…','live');
      refresh();
    }catch(error){
      selected.getTracks().forEach(t=>t.stop());
      stop(false);
      status(error.message||'Could not create a caption session.','error');
    }
  }
  function setup(){
    const launch=button('◉  Caller captions','ccLauncher','cc-launcher');
    launch.setAttribute('aria-controls','ccPanel');
    launch.setAttribute('aria-expanded','false');
    const panel=el('aside','cc-panel');panel.id='ccPanel';panel.hidden=true;
    panel.setAttribute('aria-label','Caller computer-audio captions');
    const head=el('header','cc-head');
    const title=el('div','cc-title');
    title.append(el('span','cc-eyebrow','INBOUND / OUTBOUND TOOLS'),el('h2','', 'Live caller captions'));
    const close=button('×','ccClose','cc-close');close.setAttribute('aria-label','Stop capture and close captions');
    head.append(title,close);
    const intro=el('p','cc-intro','Transcribe computer or browser-tab audio. Microphone audio is not captured. Updates arrive about every 6 seconds.');
    const how=el('div','cc-help','Select the browser tab or screen playing the caller’s voice. Enable “Share tab audio” or “Share system audio” in the browser dialog.');
    const settings=el('div','cc-settings');
    const localeLabel=el('label','cc-label','Spoken language');
    const select=el('select','cc-select');select.id='ccLanguage';
    const locales=[
      ['en-US','English (US)'],['en-GB','English (UK)'],['mk-MK','Macedonian'],['es-ES','Spanish'],
      ['fr-FR','French'],['de-DE','German'],['it-IT','Italian'],['pt-PT','Portuguese']
    ];
    for(const [value,name] of locales){
      const option=el('option','',name);option.value=value;select.append(option);
    }
    localeLabel.append(select);settings.append(localeLabel);
    const consent=el('label','cc-consent');
    const check=el('input');check.type='checkbox';check.id='ccConsent';
    consent.append(check,el('span','','I confirm I am authorized to capture this call and have obtained any required consent.'));
    const actions=el('div','cc-actions');
    const startButton=button('Start captions','ccStart','cc-primary');
    const stopButton=button('Stop','ccStop','cc-secondary');
    actions.append(startButton,stopButton);
    const state=el('div','cc-state');
    const live=el('span','cc-live','●  CAPTURING AUDIO');live.id='ccLive';live.hidden=true;
    const msg=el('p','cc-status','Checking transcription service…');msg.id='ccStatus';msg.setAttribute('role','status');
    state.append(live,msg);
    const captionTitle=el('div','cc-transcript-heading');
    captionTitle.append(el('strong','', 'Conversation captions'),el('span','cc-pending',''));
    captionTitle.querySelector('span').id='ccPending';
    const transcriptBox=el('div','cc-transcript');
    const empty=el('p','cc-empty','Captions will appear here as the caller speaks.');empty.id='ccTranscriptEmpty';
    const lines=el('div','cc-lines');lines.id='ccLines';lines.setAttribute('aria-live','polite');
    transcriptBox.append(empty,lines);
    const footer=el('div','cc-footer');
    const copy=button('Copy captions','ccCopy','cc-utility');
    const clear=button('Clear','ccClear','cc-utility');
    footer.append(copy,clear);
    const privacy=el('p','cc-privacy','Audio is sent to your organization’s configured Azure Speech service for transcription. Closing this panel stops capture. Cricket does not save audio or captions to its database. Avoid sensitive personal information until approved.');
    panel.append(head,intro,how,settings,consent,actions,state,captionTitle,transcriptBox,footer,privacy);
    document.body.append(launch,panel);
    const toggle=visible=>{
      opened=visible;panel.hidden=!visible;launch.setAttribute('aria-expanded',String(visible));
    };
    launch.addEventListener('click',()=>toggle(!opened));
    close.addEventListener('click',()=>{stop(true);toggle(false);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened)toggle(false);});
    startButton.addEventListener('click',start);
    stopButton.addEventListener('click',()=>stop(true));
    copy.addEventListener('click',async()=>{
      try{
        await navigator.clipboard.writeText(transcript.map(x=>'['+x.time+'] Caller: '+x.text).join('\n'));
        status('Caption text copied to clipboard.','info');
      }catch(_){status('Clipboard permission denied. Try your browser permissions.','error');}
    });
    clear.addEventListener('click',()=>{
      transcript=[];display();status(active?'Caption history cleared; still listening.':'Caption history cleared.');
    });
    window.addEventListener('pagehide',()=>{session++;stop(false);transcript=[];});
    refresh();
    void fetch('/api/captions/config',{credentials:'same-origin'})
      .then(async res=>{if(!res.ok)throw Error('Caption service cannot be reached.');
        return res.json();})
      .then(data=>{
        configured=Boolean(data.enabled);
        status(configured?'Ready · Share the caller’s tab or computer audio to begin.':
          'Azure Speech is not configured. Set the server Speech key and region to enable captions.',
          configured?'info':'warning');
        refresh();
      })
      .catch(error=>{configured=false;status(error.message,'error');refresh();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();
