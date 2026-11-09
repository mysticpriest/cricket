'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(ROOT,'captions.js'),'utf8');

function browserFixture({ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36',
  audio=true}={}){
  const elements=new Map(),recognitions=[],screenRequests=[];
  const audioTrack={
    kind:'audio',readyState:'live',stop(){this.readyState='ended';this.stopped=true;},
    addEventListener(type,handler){if(type==='ended')this.ended=handler;}
  };
  const videoTrack={
    kind:'video',readyState:'live',stop(){this.readyState='ended';this.stopped=true;},
    addEventListener(type,handler){if(type==='ended')this.ended=handler;}
  };
  const tracks=audio?[audioTrack,videoTrack]:[videoTrack];
  const stream={
    getTracks(){return tracks;},
    getAudioTracks(){return audio?[audioTrack]:[];}
  };
  class Node{
    constructor(tag){
      this.tag=tag;this.children=[];this.listeners={};this.textContent='';
      this.hidden=false;this.disabled=false;this.checked=false;this.scrollHeight=0;
      this.scrollTop=0;this.clientHeight=0;this.dataset={};
      this.classList={toggle:()=>{}};
    }
    set id(value){this._id=value;elements.set(value,this);}
    get id(){return this._id;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    addEventListener(type,handler){this.listeners[type]=handler;}
    setAttribute(k,v){this[k]=v;}
    focus(){this.focused=true;}
  }
  const document={
    readyState:'complete',body:new Node('body'),
    createElement:tag=>new Node(tag),
    createDocumentFragment:()=>new Node('fragment'),
    getElementById:id=>elements.get(id),
    addEventListener(){}
  };
  class Recognition{
    constructor(){recognitions.push(this);this.abortCount=0;}
    start(track){this.track=track;this.started=true;if(this.onstart)this.onstart();}
    abort(){this.abortCount++;if(this.onend)this.onend();}
  }
  const window={
    isSecureContext:true,SpeechRecognition:Recognition,
    addEventListener(){},
  };
  const navigator={
    userAgent:ua,
    mediaDevices:{getDisplayMedia:async options=>{screenRequests.push(options);return stream;}},
    clipboard:{writeText:async text=>{navigator.copied=text;}}
  };
  const context={window,navigator,document,
    setTimeout,clearTimeout,console,Date};
  vm.runInNewContext(script,context,{filename:'captions.js',timeout:3000});
  const click=async id=>{
    const node=elements.get(id);
    assert.ok(node,'Missing control '+id);
    await node.listeners.click();
  };
  return {elements,window,navigator,audioTrack,videoTrack,stream,
    recognitions,screenRequests,click};
}
test('Browser-native captions require zero Python installs, Azure keys, or Cricket audio APIs',()=>{
  assert.match(script,/SpeechRecognition/);
  assert.match(script,/getDisplayMedia/);
  assert.match(script,/\.start\(audioTrack\)/);
  assert.doesNotMatch(script,/getUserMedia\s*\(/);
  assert.doesNotMatch(script,/\/api\/captions\/|Faster-Whisper|setup-captions|transcribe\.local/i);
  assert.doesNotMatch(script,/fetch\s*\(/);
  assert.match(script,/browser.*may send shared audio/i);
  assert.match(script,/ccConsent/);
  const server=fs.readFileSync(path.join(ROOT,'server/server.js'),'utf8');
  assert.doesNotMatch(server,/captionRoute|\/api\/captions\//);
  for(const page of ['inbound.html','outbound.html','office-workflow.html','workflow-runner.html']){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.match(html,/captions\.js/);
    assert.match(html,/captions\.css/);
  }
});
test('Caller captions demand consent, then recognize the selected audio track (not microphone)',async()=>{
  const b=browserFixture();
  await b.click('ccLauncher');
  await b.click('ccStart');
  assert.equal(b.screenRequests.length,0,'Cannot share before consent');
  assert.match(b.elements.get('ccStatus').textContent,/consent/i);
  b.elements.get('ccConsent').checked=true;
  await b.click('ccStart');
  assert.equal(b.screenRequests.length,1);
  assert.equal(b.screenRequests[0].audio,true);
  assert.equal(b.recognitions.length,1);
  assert.equal(b.recognitions[0].track,b.audioTrack);
  assert.equal(b.elements.get('ccStop').disabled,false);
  b.recognitions[0].onresult({
    results:[Object.assign([{transcript:'Hello, I am calling about an appointment.'}],{isFinal:true})]
  });
  const lines=b.elements.get('ccLines').children;
  assert.equal(lines.length,1);
  assert.equal(lines[0].children.length,1);
  assert.equal(lines[0].children[0].children[1].textContent,'Hello, I am calling about an appointment.');
  await b.click('ccStop');
  assert.equal(b.audioTrack.stopped,true);
  assert.equal(b.videoTrack.stopped,true);
  assert.equal(b.elements.get('ccConsent').checked,false);
  assert.equal(b.recognitions[0].abortCount,1);
});
test('Old Chromium browsers are blocked rather than falling back to the microphone',async()=>{
  const b=browserFixture({ua:'Mozilla/5.0 (Windows NT 10.0) Chrome/134.0.0.0'});
  assert.equal(b.elements.get('ccStart').disabled,true);
  b.elements.get('ccConsent').checked=true;
  await b.click('ccStart');
  assert.equal(b.recognitions.length,0);
  assert.equal(b.screenRequests.length,0);
  assert.match(b.elements.get('ccStatus').textContent,/135/);
});
test('Missing shared audio track fails safely and stops the screen capture',async()=>{
  const b=browserFixture({audio:false});
  await b.click('ccLauncher');
  b.elements.get('ccConsent').checked=true;
  await b.click('ccStart');
  assert.equal(b.recognitions.length,0);
  assert.equal(b.videoTrack.stopped,true);
  assert.match(b.elements.get('ccStatus').textContent,/no audio/i);
});
test('Browser recognition can be copied and closing the captions panel ends capture',async()=>{
  const b=browserFixture();
  b.elements.get('ccConsent').checked=true;
  await b.click('ccLauncher');
  await b.click('ccStart');
  const a=b.recognitions[0];
  a.onresult({results:[Object.assign([{transcript:'Can you help me?'}],{isFinal:true})]});
  await b.click('ccCopy');
  assert.match(b.navigator.copied,/Caller: Can you help me\?/);
  await b.click('ccClose');
  assert.equal(b.audioTrack.stopped,true);
  assert.equal(b.elements.get('ccPanel').hidden,true);
  await b.click('ccClear');
  assert.equal(b.elements.get('ccLines').children.length,1); // fragment holds no text
  assert.equal(b.elements.get('ccCopy').disabled,true);
});
