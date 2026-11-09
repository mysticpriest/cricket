'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const engine=fs.readFileSync(path.join(ROOT,'sound-engine.js'),'utf8');

function browser({audio=true}={}){
  const listeners={};
  let oscillators=0,contexts=0;
  const requests=[];
  let preference={enabled:true,volume:25};
  const document={
    hidden:false,
    addEventListener:(name,fn)=>{
      if(!listeners[name])listeners[name]=[];
      listeners[name].push(fn);
    }
  };
  class FakeAudioContext{
    constructor(){contexts++;this.state='running';this.currentTime=0;this.destination={};}
    createOscillator(){
      return {
        type:'',
        frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
        connect(){},disconnect(){},
        start(){oscillators++;},stop(){},onended:null
      };
    }
    createGain(){
      return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},
        connect(){},disconnect(){}};
    }
    resume(){this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
  }
  const window={
    addEventListener:(name,fn)=>{
      if(!listeners[name])listeners[name]=[];
      listeners[name].push(fn);
    }
  };
  if(audio)window.AudioContext=FakeAudioContext;
  const fetch=async(url,options={})=>{
    requests.push({url,options});
    if(url!=='/api/sound/preferences')throw Error('Unexpected audio request '+url);
    if(options.method==='PATCH'){
      const candidate=JSON.parse(options.body);
      preference={enabled:candidate.enabled,volume:candidate.volume};
    }
    return {ok:true,json:async()=>({preferences:preference})};
  };
  vm.runInNewContext(engine,{document,window,fetch,Date,Math,Promise});
  const dispatch=(name,event={})=>{
    for(const fn of listeners[name]||[])fn(event);
  };
  return {
    sound:window.CricketSound,document,dispatch,requests,
    oscillators:()=>oscillators,contexts:()=>contexts
  };
}

test('Sound engine never autoplays, waits for a gesture, then plays quiet synthesized cues',async()=>{
  const b=browser();
  assert.ok(b.sound);
  assert.equal(b.sound.play('success'),false,'No sound before preference retrieval');
  assert.equal(b.oscillators(),0);
  await b.sound.load();
  assert.equal(b.sound.getPreferences().enabled,true);
  assert.equal(b.sound.getPreferences().volume,25);
  assert.equal(b.sound.play('click'),false,'Browser gesture is required');
  assert.equal(b.oscillators(),0,'Fetching settings does not autoplay');
  b.dispatch('pointerdown',{});
  assert.equal(b.oscillators(),0,'Unlock does not itself play a sound');
  assert.equal(b.sound.play('success'),true);
  assert.equal(b.oscillators(),2,'Success uses two original synthesized tones');
  assert.equal(b.sound.play('message'),true,'Direct messages have a distinct sound');
  assert.equal(b.oscillators(),5,'The direct-message chime has three soft tones');
  assert.ok(b.contexts()>=1);
  assert.equal(b.sound.play('unknown'),false,'Unsupported cues are ignored');
});

test('Each employee can mute sounds or select zero volume immediately',async()=>{
  const b=browser();
  await b.sound.load();
  b.dispatch('pointerdown',{});
  const muted=await b.sound.save({enabled:false,volume:25});
  assert.equal(muted.enabled,false);
  assert.equal(b.sound.play('notification'),false);
  assert.equal(b.oscillators(),0);
  await b.sound.save({enabled:true,volume:0});
  assert.equal(b.sound.play('success'),false);
  await b.sound.save({enabled:true,volume:50});
  assert.equal(b.sound.play('shift'),true);
  assert.equal(b.oscillators(),2);
  assert.equal(b.requests.filter(x=>x.options.method==='PATCH').length,3);
});

test('Background pages and unsupported browsers remain silent without breaking functionality',async()=>{
  const b=browser();
  await b.sound.load();
  b.dispatch('pointerdown',{});
  b.document.hidden=true;
  assert.equal(b.sound.play('notification'),false);
  assert.equal(b.oscillators(),0);
  const unsupported=browser({audio:false});
  await unsupported.sound.load();
  unsupported.dispatch('pointerdown',{});
  assert.equal(unsupported.sound.play('success'),false);
  assert.equal(unsupported.oscillators(),0);
});

test('Sound effects have no external audio assets and wire across every authorized page',()=>{
  assert.ok(!engine.includes('.mp3')&&!engine.includes('.wav')&&!engine.includes('<audio'),
    'All sounds are synthesized; no external audio files');
  assert.ok(engine.includes("window.CricketSound=Object.freeze"));
  assert.ok(engine.includes('document.addEventListener(\'click\''));
  assert.ok(engine.includes('window.AudioContext||window.webkitAudioContext'));
  assert.ok(engine.includes('document.hidden'));
  const universal=fs.readFileSync(path.join(ROOT,'universal-tools.js'),'utf8');
  assert.ok(universal.includes("function renderAudioSettings(host)"));
  assert.ok(universal.includes("priorNotificationIds!==null"));
  assert.ok(universal.includes("audio()?.play('notification')"));
  assert.ok(universal.includes("audio()?.play('shift')"));
  assert.ok(universal.includes('audio()?.load()'));
  const pages=[
    'index.html','analytics.html','qc.html','operations.html','cases.html',
    'staff.html','inbound.html','outbound.html','office-workflow.html',
    'workflow-builder.html','workflow-runner.html','team-hub.html','workforce.html'
  ];
  for(const page of pages){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.ok(html.includes('sound-engine.js'),page);
    assert.ok(html.indexOf('sound-engine.js')<html.indexOf('universal-tools.js'),
      'Load sound engine before the universal panel on '+page);
  }
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  assert.ok(server.includes("'/sound-engine.js', ['agent','qc','admin']"));
  assert.ok(server.includes("'/api/sound/preferences'"));
});
