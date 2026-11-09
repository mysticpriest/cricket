'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Readable}=require('node:stream');
const {route,validateWav,configured}=require('../server/captions');

const ROOT=path.resolve(__dirname,'..');
function wave(seconds=1){
  const size=Math.floor(32000*seconds),wav=Buffer.alloc(44+size);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);
  wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(size,40);
  return wav;
}
function request(data=wave(),headers={}){
  const req=Readable.from([data]);
  req.headers={'content-type':'audio/wav','x-cricket-captions-consent':'yes',...headers};
  return req;
}
async function invoke({
  p='/api/captions/transcribe',req=request(),available=()=>true,transcriber=async()=>'Yes, hello.'
}={}){
  req.method=p==='/api/captions/config'?'GET':'POST';
  let result=null;
  await route({p,req,res:{},user:{id:4251,office:{id:4250}},available,transcriber,
    send:(_res,status,body)=>{result={status,body};}});
  return result;
}
test('Local caption PCM validator rejects malformed, stereo, wrong sample rate, oversized segments',()=>{
  assert.doesNotThrow(()=>validateWav(wave(6)));
  for(const mutate of [
    x=>x.writeUInt16LE(2,22),x=>x.writeUInt32LE(44100,24),
    x=>x.writeUInt16LE(3,20),x=>x.writeUInt32LE(999,40),
    x=>x.writeUInt16LE(8,34)
  ]){
    const bad=wave();mutate(bad);
    assert.throws(()=>validateWav(bad));
  }
  assert.throws(()=>validateWav(wave(12)),e=>e.status===400);
  assert.throws(()=>validateWav(Buffer.from('RIFF')),e=>e.status===400);
});
test('Configuration is English-only, free and disabled safely before local installation',async()=>{
  const absent=await invoke({p:'/api/captions/config',available:()=>false});
  assert.equal(absent.status,200);
  assert.equal(absent.body.enabled,false);
  assert.deepEqual(absent.body.languages,['en']);
  assert.equal(absent.body.provider,'local-faster-whisper');
  assert.equal(absent.body.intervalSeconds,6);
  const installed=await invoke({p:'/api/captions/config',available:()=>true});
  assert.equal(installed.body.enabled,true);
  assert.equal(typeof configured(),'boolean');
  await assert.rejects(()=>invoke({available:()=>false}),e=>e.status===503);
});
test('Local worker receives validated English WAV only after explicit consent',async()=>{
  let calls=0;
  const data=wave(6);
  const response=await invoke({req:request(data),transcriber:async pcm=>{
    calls++;assert.equal(Buffer.compare(pcm,data),0);
    return 'Yes, I would like to check my appointment.';
  }});
  assert.equal(calls,1);
  assert.deepEqual(response,{status:200,body:{text:'Yes, I would like to check my appointment.'}});
  await assert.rejects(
    ()=>invoke({req:request(data,{'x-cricket-captions-consent':'no'})}),
    e=>e.status===403);
  await assert.rejects(
    ()=>invoke({req:request(data,{'x-cricket-caption-language':'mk-MK'})}),
    e=>e.status===400);
  await assert.rejects(
    ()=>invoke({req:request(data,{'content-type':'text/plain'})}),
    e=>e.status===415);
  await assert.rejects(
    ()=>invoke({req:request(wave(.1))}),
    e=>e.status===400);
});
test('Source files use a local Python worker, never Azure or remote recognition APIs',()=>{
  const backend=fs.readFileSync(path.join(ROOT,'server','captions.js'),'utf8');
  const worker=fs.readFileSync(path.join(ROOT,'server','local-caption-worker.py'),'utf8');
  const ui=fs.readFileSync(path.join(ROOT,'captions.js'),'utf8');
  const installer=fs.readFileSync(path.join(ROOT,'setup-captions.ps1'),'utf8');
  const reqs=fs.readFileSync(path.join(ROOT,'requirements-captions.txt'),'utf8');
  const server=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
  assert.match(backend,/spawn\(pythonExecutable\(\)/);
  assert.match(backend,/local-caption-worker\.py/);
  assert.match(backend,/local-faster-whisper/);
  assert.doesNotMatch(backend,/speech\.microsoft\.com|AZURE_SPEECH|\.stt\./);
  assert.match(worker,/from faster_whisper import WhisperModel/);
  assert.match(worker,/language="en"/);
  assert.match(worker,/local_files_only=not warmup/);
  assert.match(installer,/--warmup/);
  assert.match(reqs,/faster-whisper==1\.2\.1/);
  assert.match(ui,/getDisplayMedia/);
  assert.doesNotMatch(ui,/getUserMedia\s*\(/);
  assert.doesNotMatch(ui,/ccLanguage|Azure Speech/);
  assert.match(ui,/ccConsent/);
  assert.match(ui,/\/api\/captions\/config/);
  assert.match(ui,/\/api\/captions\/transcribe/);
  assert.match(server,/requireRole\(user,'agent','admin'\)/);
  assert.match(server,/captionRoute/);
  for(const page of ['inbound.html','outbound.html','office-workflow.html','workflow-runner.html']){
    const html=fs.readFileSync(path.join(ROOT,page),'utf8');
    assert.match(html,/captions\.js/);
    assert.match(html,/captions\.css/);
  }
});
