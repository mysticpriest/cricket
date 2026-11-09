'use strict';
/*
 * Cricket sound engine — quiet, original Web Audio micro-interactions.
 * No sound files, external services, autoplay, or stored browser identifiers.
 * An employee's settings load from the authenticated /api/sound/preferences API.
 * Browsers only unlock playback after a real user gesture.
 */
(()=>{
  const CUES=Object.freeze({
    click:[{from:520,to:460,at:0,duration:.043,gain:.11,type:'sine'}],
    navigate:[{from:460,to:570,at:0,duration:.058,gain:.10,type:'sine'}],
    success:[
      {from:620,to:690,at:0,duration:.095,gain:.13,type:'sine'},
      {from:860,to:880,at:.085,duration:.13,gain:.12,type:'sine'}
    ],
    error:[
      {from:420,to:345,at:0,duration:.11,gain:.11,type:'triangle'},
      {from:320,to:285,at:.11,duration:.09,gain:.08,type:'sine'}
    ],
    notification:[
      {from:760,to:810,at:0,duration:.10,gain:.095,type:'sine'},
      {from:990,to:1000,at:.14,duration:.14,gain:.09,type:'sine'}
    ],
    message:[
      {from:660,to:770,at:0,duration:.085,gain:.11,type:'sine'},
      {from:900,to:1080,at:.10,duration:.105,gain:.10,type:'sine'},
      {from:1120,to:1180,at:.22,duration:.13,gain:.075,type:'sine'}
    ],
    shift:[
      {from:440,to:560,at:0,duration:.085,gain:.11,type:'sine'},
      {from:680,to:730,at:.10,duration:.11,gain:.10,type:'sine'}
    ]
  });
  const NORMAL={enabled:true,volume:25};
  let settings={...NORMAL};
  let ready=false,gesture=false,context=null,loading=null,lastCue='',lastPlayed=0;
  let saveSequence=Promise.resolve(),preferenceRevision=0;
  const clamp=v=>Math.max(0,Math.min(100,Math.round(Number(v)||0)));
  const validate=value=>({
    enabled:value?.enabled===true,
    volume:clamp(value?.volume)
  });
  function contextForPlayback(){
    if(!gesture||!ready||!settings.enabled||settings.volume===0||document.hidden)return null;
    if(!context){
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(typeof Audio!=='function')return null;
      try{context=new Audio();}
      catch(_){return null;}
    }
    if(context.state==='suspended'){
      try{void context.resume().catch(()=>{});}catch(_){}
    }
    return context;
  }
  function play(type){
    const parts=CUES[type];
    if(!parts)return false;
    const ctx=contextForPlayback();
    if(!ctx)return false;
    const time=Date.now();
    const limit=type==='notification'||type==='message'?3500:type==='click'||type==='navigate'?75:180;
    if(type===lastCue&&time-lastPlayed<limit)return false;
    lastCue=type;lastPlayed=time;
    const start=ctx.currentTime+.005;
    for(const note of parts){
      try{
        const osc=ctx.createOscillator(),gain=ctx.createGain();
        const t=start+note.at,finish=t+note.duration;
        const peak=Math.max(.00001,note.gain*(settings.volume/100));
        osc.type=note.type;
        osc.frequency.setValueAtTime(note.from,t);
        osc.frequency.exponentialRampToValueAtTime(note.to,finish);
        gain.gain.setValueAtTime(.00001,t);
        gain.gain.exponentialRampToValueAtTime(peak,t+.010);
        gain.gain.exponentialRampToValueAtTime(.00001,finish);
        osc.connect(gain);gain.connect(ctx.destination);
        osc.start(t);osc.stop(finish+.015);
        osc.onended=()=>{try{osc.disconnect();gain.disconnect();}catch(_){}};
      }catch(_){return false;}
    }
    return true;
  }
  function unlock(){
    gesture=true;
    // No automatic sound upon unlocking. The interaction itself may play.
    if(context?.state==='suspended'){
      try{void context.resume().catch(()=>{});}catch(_){}
    }
  }
  document.addEventListener('pointerdown',unlock,{capture:true,passive:true});
  document.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key===' '||event.key==='Spacebar')unlock();
  },{capture:true});
  // One soft sound per intentional control activation; never on hover,
  // text entry, loading, document refresh or background API polling.
  document.addEventListener('click',event=>{
    const target=event.target;
    if(!target?.closest)return;
    const action=target.closest('button,a,[role="button"]');
    if(!action||action.disabled||action.getAttribute('aria-disabled')==='true')return;
    if(action.closest('[data-sound-silent]'))return;
    play(action.tagName==='A'?'navigate':'click');
  },true);
  async function load(){
    if(loading)return loading;
    loading=(async()=>{
      try{
        const response=await fetch('/api/sound/preferences',{credentials:'same-origin'});
        if(!response.ok)throw Error('Sound settings unavailable');
        const payload=await response.json();
        settings=validate(payload.preferences);
        ready=true;
        return {...settings};
      }catch(error){
        // Fail closed: no surprise audio if settings cannot be retrieved.
        settings={enabled:false,volume:NORMAL.volume};
        ready=false;loading=null;
        throw error;
      }
    })();
    return loading;
  }
  async function save(prefs){
    const next=validate(prefs);
    const previous={...settings};
    const revision=++preferenceRevision;
    settings=next; // Immediate UI feedback, with rollback on save error.
    ready=true;
    const send=async()=>{
      try{
        const response=await fetch('/api/sound/preferences',{
          method:'PATCH',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},body:JSON.stringify(next)
        });
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(payload.error||'Sound settings could not be saved');
        // Only the latest save is allowed to settle the active preference.
        const saved=validate(payload.preferences);
        if(revision===preferenceRevision){settings=saved;ready=true;}
        return saved;
      }catch(error){
        // A stale failing request must not disable a newer successful choice.
        if(revision===preferenceRevision){
          settings={...previous,enabled:false};ready=false;
        }
        throw error;
      }
    };
    saveSequence=saveSequence.catch(()=>{}).then(send);
    return saveSequence;
  }
  function preview(){return play('success');}
  function getPreferences(){return {...settings};}
  window.CricketSound=Object.freeze({play,load,save,getPreferences,preview});
  // Separate pages can use the same employee-facing engine without
  // duplicating settings requests.
  window.addEventListener('pagehide',()=>{
    if(context&&context.state!=='closed'){
      try{void context.close().catch(()=>{});}catch(_){}
    }
    context=null;
  });
})();