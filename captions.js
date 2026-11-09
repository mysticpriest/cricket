'use strict';
/*
 * Cricket English caller captions (browser-native Web Speech API).
 * No extra download, install, API key, model or Cricket transcription endpoint.
 * Chrome / Edge 135+ can accept a shared audio MediaStreamTrack in
 * SpeechRecognition.start(audioTrack). Never invoke start() without the track:
 * that would select the employee's microphone instead.
 *
 * IMPORTANT: Browser speech recognition may transmit audio to the browser
 * provider's speech service. This is NOT guaranteed to process audio locally.
 */
(()=>{
  const MAX_LINES=120;
  const $=id=>document.getElementById(id);
  const make=(tag,cls,content)=>{
    const element=document.createElement(tag);
    if(cls)element.className=cls;
    if(content!==undefined)element.textContent=String(content);
    return element;
  };
  function button(text,id,cls){
    const node=make('button',cls||'cc-utility',text);
    node.id=id;node.type='button';return node;
  }
  function supported(){
    const ua=navigator.userAgent||'';
    // Prevent older implementations from interpreting start(track) as
    // start() and silently recording the employee microphone.
    if(/Android|iPhone|iPad|iPod/i.test(ua))return false;
    const match=ua.match(/(?:Edg|Chrome)\/(\d+)/);
    const Recognizer=window.SpeechRecognition||window.webkitSpeechRecognition;
    return Boolean(match&&Number(match[1])>=135&&typeof Recognizer==='function'&&
      window.isSecureContext&&navigator.mediaDevices?.getDisplayMedia);
  }
  let stream=null,recognizer=null,active=false,opened=false,attempt=0;
  let generation=0,completed=new Set(),restartTimer=null,transcript=[];
  function status(text,kind='info'){
    const node=$('ccStatus');
    if(node){node.textContent=text;node.dataset.kind=kind;}
  }
  function renderControls(){
    $('ccStart').disabled=active||!supported();
    $('ccStop').disabled=!active;
    $('ccConsent').disabled=active;
    $('ccLauncher').classList.toggle('is-listening',active);
    $('ccLive').hidden=!active;
    $('ccTranscriptEmpty').hidden=transcript.length>0;
    $('ccCopy').disabled=transcript.length===0;
    $('ccClear').disabled=transcript.length===0;
  }
  function addCaption(text){
    const cleaned=String(text||'').trim();
    if(!cleaned)return;
    transcript.push({
      time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
      text:cleaned
    });
    if(transcript.length>MAX_LINES)transcript.shift();
    renderTranscript();
  }
  function renderTranscript(){
    const container=$('ccLines');
    const atBottom=container.scrollHeight-container.scrollTop-container.clientHeight<80;
    const fragment=document.createDocumentFragment();
    for(const line of transcript){
      const card=make('div','cc-line');
      const time=make('time','cc-time',line.time);
      const body=make('p','',line.text);
      card.append(time,body);fragment.append(card);
    }
    container.replaceChildren(fragment);
    if(atBottom)container.scrollTop=container.scrollHeight;
    $('ccTranscriptEmpty').hidden=transcript.length>0;
    renderControls();
  }
  function interim(text){
    const element=$('ccInterim');
    element.textContent=text||'';
    element.hidden=!text;
  }
  function clearRestart(){
    if(restartTimer!==null){clearTimeout(restartTimer);restartTimer=null;}
  }
  function stop(){
    if(!active&&!stream)return;
    const previous=stream;
    active=false;generation++;clearRestart();
    if(recognizer){
      recognizer.onresult=null;
      recognizer.onerror=null;
      recognizer.onend=null;
      try{recognizer.abort();}catch(_){}
    }
    recognizer=null;
    stream=null;completed.clear();attempt=0;
    if(previous)previous.getTracks().forEach(track=>track.stop());
    $('ccConsent').checked=false;interim('');
    status('Captions stopped. History is only kept in this tab until cleared.');
    renderControls();
  }
  function resume(generationId){
    if(!active||generationId!==generation||!stream)return;
    const audioTrack=stream.getAudioTracks()[0];
    if(!audioTrack||audioTrack.readyState!=='live'){
      stop();status('The shared audio source ended.','warning');return;
    }
    // The browser can end a recognition session after silence or a timeout.
    // Reuse the same explicitly shared audio track, never the microphone.
    const Recognizer=window.SpeechRecognition||window.webkitSpeechRecognition;
    const instance=new Recognizer();
    instance.lang='en-US';
    instance.continuous=true;
    instance.interimResults=true;
    instance.maxAlternatives=1;
    recognizer=instance;
    completed=new Set();
    let gotResult=false,ended=false;
    instance.onstart=()=>{
      if(generationId!==generation)return;
      status('Listening to shared caller audio…','live');
      attempt=0;
    };
    instance.onresult=event=>{
      if(generationId!==generation||!active)return;
      gotResult=true;
      const now=[];
      for(let i=0;i<event.results.length;i++){
        const result=event.results[i],phrase=result?.[0]?.transcript||'';
        if(result?.isFinal){
          if(!completed.has(i)){
            completed.add(i);addCaption(phrase);
          }
        }else if(phrase.trim())now.push(phrase.trim());
      }
      interim(now.join(' '));
    };
    instance.onerror=event=>{
      if(generationId!==generation||!active)return;
      const code=String(event?.error||'unknown');
      if(['not-allowed','service-not-allowed','audio-capture','language-not-supported'].includes(code)){
        stop();
        status('Browser speech recognition is unavailable or permission was denied ('+code+').','error');
        return;
      }
      if(code==='network'){
        stop();
        status('The browser speech service could not connect. Check your connection.','error');
        return;
      }
      if(code==='aborted')return;
      status('Speech recognition paused ('+code+'); retrying…','warning');
    };
    instance.onend=()=>{
      if(generationId!==generation||!active||ended)return;
      ended=true;
      interim('');
      // Reuse existing user-authorized shared audio without showing another prompt.
      // Back off after repeated short sessions so provider errors do not hot-loop.
      attempt=gotResult?0:attempt+1;
      if(attempt>6){
        stop();
        status('Recognition repeatedly stopped. Restart captions or try another shared tab.','error');
        return;
      }
      const delay=Math.min(3500,500*attempt);
      clearRestart();
      restartTimer=setTimeout(()=>{restartTimer=null;resume(generationId);},delay);
      status('Reconnecting to browser speech recognition…','warning');
    };
    try{
      // Supplying this LIVE audio track is essential. Do not call start() without it.
      instance.start(audioTrack);
    }catch(error){
      stop();
      status('Your browser could not recognize shared audio. Use current desktop Chrome or Edge.','error');
    }
  }
  async function start(){
    if(active)return;
    if(!supported()){
      status('Use desktop Chrome or Edge version 135+ over localhost or HTTPS to caption shared audio.','error');
      return;
    }
    if(!$('ccConsent').checked){
      status('Confirm authorization and any required caller consent first.','warning');
      $('ccConsent').focus();return;
    }
    let chosen;
    try{
      // Browser picker requires a direct user click; the mandatory video track
      // is not read, displayed, sent or recorded.
      chosen=await navigator.mediaDevices.getDisplayMedia({
        video:true,audio:true,systemAudio:'include',
        surfaceSwitching:'include',selfBrowserSurface:'exclude'
      });
    }catch(error){
      status(error?.name==='NotAllowedError'?
        'Sharing cancelled. Select the caller’s tab and enable audio.':
        'Could not open the audio-sharing picker.','error');
      return;
    }
    if(!chosen.getAudioTracks().length){
      chosen.getTracks().forEach(track=>track.stop());
      status('No audio was shared. Select the caller’s tab and tick “Share tab audio” (or share system audio).','error');
      return;
    }
    stream=chosen;active=true;attempt=0;
    const run=++generation;
    for(const track of stream.getTracks()){
      track.addEventListener('ended',()=>{
        if(active&&run===generation){
          stop();status('Screen or tab sharing ended. Captions are stopped.','warning');
        }
      },{once:true});
    }
    status('Starting browser speech recognition…','info');
    renderControls();
    resume(run);
  }
  function setup(){
    const launcher=button('◉  Caller captions','ccLauncher','cc-launcher');
    launcher.setAttribute('aria-controls','ccPanel');
    launcher.setAttribute('aria-expanded','false');
    const panel=make('aside','cc-panel');panel.id='ccPanel';panel.hidden=true;
    panel.setAttribute('aria-label','Live caller captions');
    const header=make('header','cc-head');
    const titles=make('div','cc-title');
    titles.append(make('span','cc-eyebrow','CALL WORKSPACE TOOLS'),
      make('h2','','Live caller captions'));
    const close=button('×','ccClose','cc-close');
    close.setAttribute('aria-label','Stop capturing and close captions');
    header.append(titles,close);
    const intro=make('p','cc-intro',
      'English captions using your browser. No Python, model downloads, API keys or extra installation.');
    const tips=make('div','cc-help',
      'Share the browser tab playing the caller’s voice and enable “Share tab audio”. Compatible Windows devices may also offer “Share system audio”.');
    const settings=make('div','cc-settings');
    settings.append(make('p','cc-language-fixed','English · Browser speech recognition'));
    const consent=make('label','cc-consent');
    const checkbox=make('input');checkbox.type='checkbox';checkbox.id='ccConsent';
    consent.append(checkbox,make('span','',
      'I confirm this call can be transcribed and any required caller consent has been obtained.'));
    const actions=make('div','cc-actions');
    actions.append(button('Start captions','ccStart','cc-primary'),button('Stop','ccStop','cc-secondary'));
    const state=make('div','cc-state');
    const live=make('span','cc-live','●  LIVE CAPTIONS');live.id='ccLive';live.hidden=true;
    const message=make('p','cc-status','Checking browser compatibility…');
    message.id='ccStatus';message.setAttribute('role','status');
    state.append(live,message);
    const label=make('div','cc-transcript-heading');
    label.append(make('strong','','Caller captions'));
    const transcriptBox=make('div','cc-transcript');
    const empty=make('p','cc-empty','Recognized English speech will appear here.');
    empty.id='ccTranscriptEmpty';
    const list=make('div','cc-lines');list.id='ccLines';list.setAttribute('aria-live','polite');
    const partial=make('p','cc-interim','');partial.id='ccInterim';partial.hidden=true;
    partial.setAttribute('aria-live','off');
    transcriptBox.append(empty,list,partial);
    const foot=make('div','cc-footer');
    foot.append(button('Copy captions','ccCopy','cc-utility'),button('Clear','ccClear','cc-utility'));
    const privacy=make('p','cc-privacy',
      'Your browser may send shared audio to its speech-recognition provider over the internet. Cricket does not send the audio to its own server or save captions automatically. Do not use with patient information without organizational approval.');
    panel.append(header,intro,tips,settings,consent,actions,state,label,transcriptBox,foot,privacy);
    document.body.append(launcher,panel);
    const toggle=show=>{
      if(!show)stop();
      opened=show;panel.hidden=!show;launcher.setAttribute('aria-expanded',String(show));
    };
    launcher.addEventListener('click',()=>toggle(!opened));
    close.addEventListener('click',()=>toggle(false));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&opened)toggle(false);});
    $('ccStart').addEventListener('click',start);
    $('ccStop').addEventListener('click',stop);
    $('ccCopy').addEventListener('click',async()=>{
      try{
        await navigator.clipboard.writeText(
          transcript.map(x=>'['+x.time+'] Caller: '+x.text).join('\n'));
        status('Captions copied to clipboard.');
      }catch(_){status('Could not copy captions. Check clipboard permissions.','error');}
    });
    $('ccClear').addEventListener('click',()=>{
      transcript=[];renderTranscript();interim('');
      status(active?'History cleared. Still listening.':'Caption history cleared.');
    });
    window.addEventListener('pagehide',()=>{stop();transcript=[];});
    renderControls();
    status(supported()?
      'Ready. Share the caller’s audio to start English captions.':
      'Use desktop Chrome or Edge 135+ over localhost or HTTPS. This browser does not support shared-audio captions.',
      supported()?'info':'warning');
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})();
