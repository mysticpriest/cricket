'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {route,validateWav,LANGUAGES}=require('../server/captions');

function wave(seconds=1){
  const length=Math.floor(32000*seconds),wav=Buffer.alloc(44+length);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(length,40);return wav;
}
function request(body=wave(),headers={}){
  const req=Readable.from([body]);
  req.headers={
    'content-type':'audio/wav','x-cricket-captions-consent':'yes',
    'x-cricket-caption-language':'en-US',...headers
  };
  return req;
}
async function invoke({p='/api/captions/transcribe',req=request(),fetcher}={}){
  let answer;
  await route({p,req,res:{},user:{id:2501,office:{id:2461}},
    send:(_res,status,body)=>{answer={status,body};},fetcher});
  return answer;
}
test('PCM validator rejects compressed, stereo, malformed and oversized audio',()=>{
  assert.doesNotThrow(()=>validateWav(wave(1)));
  for(const mutator of [
    b=>b.writeUInt16LE(2,22),b=>b.writeUInt32LE(8000,24),
    b=>b.writeUInt16LE(3,20),b=>b.writeUInt32LE(999,40),
    b=>b.writeUInt16LE(8,34)
  ]){const invalid=wave();mutator(invalid);assert.throws(()=>validateWav(invalid));}
  assert.throws(()=>validateWav(Buffer.from('RIFF')),/Invalid/);
});
test('config reports disabled without exposing credentials',async()=>{
  const oldKey=process.env.CRICKET_AZURE_SPEECH_KEY,oldRegion=process.env.CRICKET_AZURE_SPEECH_REGION;
  try{
    delete process.env.CRICKET_AZURE_SPEECH_KEY;
    delete process.env.CRICKET_AZURE_SPEECH_REGION;
    const reply=await invoke({p:'/api/captions/config'});
    assert.equal(reply.status,200);assert.equal(reply.body.enabled,false);
    assert.ok(reply.body.languages.includes('en-US'));
    assert.ok(!JSON.stringify(reply).includes('CRICKET_AZURE_SPEECH_KEY'));
    await assert.rejects(()=>invoke(),error=>error.status===503);
  }finally{
    if(oldKey===undefined)delete process.env.CRICKET_AZURE_SPEECH_KEY;
    else process.env.CRICKET_AZURE_SPEECH_KEY=oldKey;
    if(oldRegion===undefined)delete process.env.CRICKET_AZURE_SPEECH_REGION;
    else process.env.CRICKET_AZURE_SPEECH_REGION=oldRegion;
  }
});
test('authorized six-second caption segments are proxied to the regional Azure endpoint',async()=>{
  const oldKey=process.env.CRICKET_AZURE_SPEECH_KEY,oldRegion=process.env.CRICKET_AZURE_SPEECH_REGION;
  process.env.CRICKET_AZURE_SPEECH_KEY='fake-azure-key';
  process.env.CRICKET_AZURE_SPEECH_REGION='eastus';
  try{
    let called=0;
    const reply=await invoke({req:request(wave(6)),fetcher:async(url,options)=>{
      called++;
      assert.match(url,/^https:\/\/eastus\.stt\.speech\.microsoft\.com\/speech\/recognition\/conversation\//);
      assert.match(url,/language=en-US/);
      assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'fake-azure-key');
      assert.equal(options.method,'POST');
      validateWav(options.body);
      return {ok:true,json:async()=>({RecognitionStatus:'Success',DisplayText:'Hello, I need an appointment.'})};
    }});
    assert.equal(called,1);
    assert.deepEqual(reply,{status:200,body:{text:'Hello, I need an appointment.'}});
    assert.ok(!JSON.stringify(reply).includes('fake-azure-key'));
    const silence=await invoke({fetcher:async()=>({
      ok:true,json:async()=>({RecognitionStatus:'NoMatch'})})});
    assert.equal(silence.body.text,'');
    await assert.rejects(()=>invoke({req:request(wave(),{'x-cricket-captions-consent':'no'})}),e=>e.status===403);
    await assert.rejects(()=>invoke({req:request(wave(),{'x-cricket-caption-language':'zz-XX'})}),e=>e.status===400);
    await assert.rejects(()=>invoke({req:request(wave(),{'content-type':'text/plain'})}),e=>e.status===415);
  }finally{
    if(oldKey===undefined)delete process.env.CRICKET_AZURE_SPEECH_KEY;
    else process.env.CRICKET_AZURE_SPEECH_KEY=oldKey;
    if(oldRegion===undefined)delete process.env.CRICKET_AZURE_SPEECH_REGION;
    else process.env.CRICKET_AZURE_SPEECH_REGION=oldRegion;
  }
});
test('caption UI uses screen audio, requires consent, and never auto-saves the transcript',()=>{
  const root=path.resolve(__dirname,'..');
  const ui=fs.readFileSync(path.join(root,'captions.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'server','server.js'),'utf8');
  assert.match(ui,/getDisplayMedia/);
  assert.doesNotMatch(ui,/getUserMedia\s*\(/);
  assert.match(ui,/ccConsent/);assert.match(ui,/getAudioTracks/);
  assert.match(ui,/\/api\/captions\/config/);assert.match(ui,/\/api\/captions\/transcribe/);
  assert.match(server,/requireRole\(user,'agent','admin'\)/);
  assert.match(server,/captionRoute/);
  for(const page of ['inbound.html','outbound.html']){
    const text=fs.readFileSync(path.join(root,page),'utf8');
    assert.match(text,/captions\.js/);assert.match(text,/captions\.css/);
  }
  assert.deepEqual(LANGUAGES.includes('en-US'),true);
});
