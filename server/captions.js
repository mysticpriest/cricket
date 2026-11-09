'use strict';
// Local, English-only caller captions. No cloud API, credential, or audio logging.
// An authenticated browser sends bounded PCM WAV segments to a persistent
// Faster-Whisper worker running on the same machine as Cricket's Node process.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const ROOT=path.resolve(__dirname,'..');
const MODELS=path.join(ROOT,'data','caption-models');
const MODEL=['base.en','tiny.en'].includes(process.env.CRICKET_CAPTIONS_MODEL)
  ?process.env.CRICKET_CAPTIONS_MODEL:'base.en';
const MAX_BYTES=400000,MIN_AUDIO_BYTES=16000,MAX_QUEUED=5;
const requestWindows=new Map();
let worker=null,starting=null,startingResolve=null,startingReject=null,workerReady=false;
let buffer='',sequence=0;
const pending=new Map();

function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function failure(message){return Object.assign(new Error(message),{status:503});}
function pythonExecutable(){
  const override=process.env.CRICKET_CAPTIONS_PYTHON;
  if(override)return path.resolve(override);
  return process.platform==='win32'
    ?path.join(ROOT,'.venv','Scripts','python.exe')
    :path.join(ROOT,'.venv','bin','python');
}
function configured(){
  return fs.existsSync(pythonExecutable()) &&
    fs.existsSync(path.join(MODELS,MODEL+'.ready'));
}
function validateWav(wav){
  if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>MAX_BYTES)
    fail(400,'Invalid or oversized audio segment');
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||
     wav.toString('ascii',12,16)!=='fmt '||wav.readUInt32LE(16)!==16||
     wav.readUInt16LE(20)!==1||wav.readUInt16LE(22)!==1||
     wav.readUInt32LE(24)!==16000||wav.readUInt32LE(28)!==32000||
     wav.readUInt16LE(32)!==2||wav.readUInt16LE(34)!==16||
     wav.toString('ascii',36,40)!=='data')
    fail(415,'Captions require PCM WAV audio (16 kHz, mono, 16-bit)');
  const size=wav.readUInt32LE(40);
  if(size<MIN_AUDIO_BYTES||size>352000||size+44!==wav.length||
     wav.readUInt32LE(4)!==wav.length-8)
    fail(400,'Audio segment must contain between 0.5 and 11 seconds of PCM audio');
}
function readAudio(req){
  return new Promise((resolve,reject)=>{
    const declared=Number(req.headers['content-length']);
    if(Number.isFinite(declared)&&declared>MAX_BYTES)
      return reject(Object.assign(Error('Audio segment too large'),{status:413}));
    let size=0,oversized=false;
    const chunks=[];
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>MAX_BYTES){oversized=true;return;}
      chunks.push(chunk);
    });
    req.on('end',()=>oversized?
      reject(Object.assign(Error('Audio segment too large'),{status:413})):
      resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}
function reserve(user){
  const key=user.office.id+':'+user.id,at=Date.now();
  if(requestWindows.size>4000)for(const [id,row] of requestWindows)
    if(at-row.since>60000)requestWindows.delete(id);
  let row=requestWindows.get(key);
  if(!row||at-row.since>60000){
    row={since:at,count:0,active:0};requestWindows.set(key,row);
  }
  if(row.count>=15||row.active>=2)
    fail(429,'Caption requests are arriving too quickly');
  row.count++;row.active++;
  return ()=>{row.active=Math.max(0,row.active-1);};
}
function stopWorker(error,instance){
  if(instance!==worker)return;
  worker=null;workerReady=false;
  buffer='';
  const rejectStart=startingReject;
  starting=null;startingReject=null;startingResolve=null;
  if(rejectStart)rejectStart(error);
  for(const [,item] of pending){
    clearTimeout(item.timer);
    item.reject(error);
  }
  pending.clear();
  try{instance.kill();}catch(_){}
}
function receive(data,instance){
  if(instance!==worker)return;
  buffer+=data.toString('utf8');
  if(buffer.length>35000){
    stopWorker(failure('Local caption worker sent an invalid response'),instance);
    return;
  }
  while(buffer.includes('\n')){
    const end=buffer.indexOf('\n');
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    let msg;
    try{msg=JSON.parse(line);}catch(_){continue;}
    if(msg.type==='ready'){
      workerReady=true;
      const resolve=startingResolve;
      startingResolve=null;startingReject=null;starting=null;
      if(resolve)resolve();
      continue;
    }
    if(!Number.isSafeInteger(msg.id))continue;
    const item=pending.get(msg.id);
    if(!item)continue;
    pending.delete(msg.id);clearTimeout(item.timer);
    if(msg.error)item.reject(failure('Local caption recognition failed; try again.'));
    else item.resolve(typeof msg.text==='string'?msg.text.slice(0,2500):'');
  }
}
function ensureWorker(){
  if(worker&&workerReady)return Promise.resolve();
  if(starting)return starting;
  if(!configured())return Promise.reject(failure(
    'Free captions are not installed. Run .\\setup-captions.ps1 from the Cricket folder.'));
  let instance;
  try{
    instance=spawn(pythonExecutable(),['-u',path.join(__dirname,'local-caption-worker.py')],{
      cwd:ROOT,windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUNBUFFERED:'1'}
    });
  }catch(_){return Promise.reject(failure('Could not start the local caption engine.'));}
  worker=instance;workerReady=false;buffer='';
  starting=new Promise((resolve,reject)=>{
    startingResolve=resolve;startingReject=reject;
  });
  instance.stdout.on('data',data=>receive(data,instance));
  // Do not log stdout or stderr: speech content is never written to server logs.
  instance.stderr.on('data',()=>{});
  instance.on('error',()=>stopWorker(failure('Local captions could not start. Re-run setup-captions.ps1.'),instance));
  instance.on('exit',()=>stopWorker(failure('Local caption engine stopped. Re-run setup-captions.ps1.'),instance));
  const timeout=setTimeout(()=>{
    if(instance===worker&&!workerReady)
      stopWorker(failure('Local caption engine did not start. Verify the model installation.'),instance);
  },90000);
  instance.once('exit',()=>clearTimeout(timeout));
  // Unref startup timeout after process initialization; it should not
  // keep a shutting-down server running.
  timeout.unref?.();
  return starting;
}
async function transcribeLocal(wav){
  await ensureWorker();
  if(!worker||!workerReady)fail(503,'Local captions are not ready');
  if(pending.size>=MAX_QUEUED)fail(429,'Local caption engine is busy; retry shortly');
  const id=++sequence,instance=worker;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      if(!pending.has(id))return;
      stopWorker(failure('Local captions took too long. Try the faster tiny.en model.'),instance);
    },45000);
    pending.set(id,{resolve,reject,timer});
    try{
      instance.stdin.write(JSON.stringify({id,audio:wav.toString('base64')})+'\n',error=>{
        if(error)stopWorker(failure('Could not send audio to local captions'),instance);
      });
    }catch(_){stopWorker(failure('Could not send audio to local captions'),instance);}
  });
}
async function route({p,req,res,user,send,transcriber=transcribeLocal,available=configured}){
  if(p==='/api/captions/config'&&req.method==='GET'){
    return send(res,200,{enabled:Boolean(available()),languages:['en'],
      provider:'local-faster-whisper',model:MODEL,mode:'segmented',intervalSeconds:6});
  }
  if(p==='/api/captions/transcribe'&&req.method==='POST'){
    if(!available())fail(503,'Free captions are not installed. Run .\\setup-captions.ps1 in the Cricket folder.');
    if(req.headers['x-cricket-captions-consent']!=='yes')
      fail(403,'Confirm authorization and consent before enabling captions');
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('audio/wav'))
      fail(415,'Audio must be submitted as PCM WAV');
    const lang=req.headers['x-cricket-caption-language'];
    if(lang!==undefined&&!['en-US','en-GB','en'].includes(String(lang)))
      fail(400,'Captions support English only');
    const release=reserve(user);
    try{
      const audio=await readAudio(req);
      validateWav(audio);
      const text=await transcriber(audio);
      return send(res,200,{text:typeof text==='string'?text.slice(0,2500):''});
    }finally{release();}
  }
  fail(404,'Caption endpoint not found');
}
process.once('exit',()=>{if(worker)try{worker.kill();}catch(_){}});
module.exports={route,validateWav,configured};
