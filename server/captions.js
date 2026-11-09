'use strict';
// Caller-side captions: short, explicitly-authorized PCM audio segments.
// Never store, log, or return the raw audio or an Azure credential.
const LANGUAGES=Object.freeze(['en-US','en-GB','es-ES','fr-FR','de-DE','it-IT','pt-PT']);
const MAX_BYTES=400000;
const MIN_AUDIO_BYTES=16000; // at least 0.5s of 16 kHz, 16-bit, mono
const requestWindows=new Map();
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function configured(){
  return Boolean(process.env.CRICKET_AZURE_SPEECH_KEY?.trim()&&
    /^[a-z0-9-]{2,35}$/.test(process.env.CRICKET_AZURE_SPEECH_REGION||''));
}
function validateWav(wav){
  if(!Buffer.isBuffer(wav)||wav.length<44||wav.length>MAX_BYTES)fail(400,'Invalid or oversized audio segment');
  if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE'||
    wav.toString('ascii',12,16)!=='fmt '||
    wav.readUInt32LE(16)!==16||wav.readUInt16LE(20)!==1||
    wav.readUInt16LE(22)!==1||wav.readUInt32LE(24)!==16000||
    wav.readUInt32LE(28)!==32000||wav.readUInt16LE(32)!==2||
    wav.readUInt16LE(34)!==16||wav.toString('ascii',36,40)!=='data')
    fail(415,'Captions require PCM WAV audio (16 kHz, mono, 16-bit)');
  const chunkSize=wav.readUInt32LE(40);
  if(chunkSize<MIN_AUDIO_BYTES||chunkSize>352000||chunkSize+44!==wav.length||
    wav.readUInt32LE(4)!==wav.length-8)
    fail(400,'Audio segment must contain between 0.5 and 11 seconds of PCM audio');
}
function readAudio(req){
  return new Promise((resolve,reject)=>{
    const declared=Number(req.headers['content-length']);
    if(Number.isFinite(declared)&&declared>MAX_BYTES)return reject(Object.assign(Error('Audio segment too large'),{status:413}));
    let bytes=0,invalid=false;
    const chunks=[];
    req.on('data',part=>{
      bytes+=part.length;
      if(bytes>MAX_BYTES){invalid=true;return;}
      chunks.push(part);
    });
    req.on('end',()=>{
      if(invalid)return reject(Object.assign(Error('Audio segment too large'),{status:413}));
      resolve(Buffer.concat(chunks));
    });
    req.on('error',reject);
  });
}
function reserve(user){
  const key=user.office.id+':'+user.id,at=Date.now();
  if(requestWindows.size>4000)for(const [k,v] of requestWindows)if(at-v.since>60000)requestWindows.delete(k);
  let row=requestWindows.get(key);
  if(!row||at-row.since>60000){row={since:at,count:0,active:0};requestWindows.set(key,row);}
  if(row.count>=15||row.active>=2)fail(429,'Caption requests are arriving too quickly');
  row.count++;row.active++;
  return ()=>{row.active=Math.max(0,row.active-1);};
}
async function transcribe(audio,language,fetcher=globalThis.fetch){
  const region=process.env.CRICKET_AZURE_SPEECH_REGION;
  const endpoint='https://'+region+'.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language='+
    encodeURIComponent(language)+'&format=simple';
  let response;
  try{
    response=await fetcher(endpoint,{
      method:'POST',
      headers:{
        'Ocp-Apim-Subscription-Key':process.env.CRICKET_AZURE_SPEECH_KEY,
        'Content-Type':'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Accept':'application/json'
      },
      body:audio,signal:AbortSignal.timeout(20000)
    });
  }catch(_){fail(504,'Speech service is unavailable. Check your connection and try again.');}
  if(!response.ok){
    if(response.status===401||response.status===403)fail(502,'Azure Speech rejected the configured credentials or region');
    if(response.status===429)fail(503,'Azure Speech rate limit reached. Try again shortly.');
    fail(502,'Azure Speech could not process this audio segment');
  }
  let data;
  try{data=await response.json();}catch(_){fail(502,'Invalid response from speech service');}
  if(data.RecognitionStatus==='Success')
    return typeof data.DisplayText==='string'?data.DisplayText.slice(0,2500):'';
  if(data.RecognitionStatus==='NoMatch'||data.RecognitionStatus==='InitialSilenceTimeout'||
    data.RecognitionStatus==='BabbleTimeout'||data.RecognitionStatus==='EndOfDictation')
    return '';
  fail(502,'Speech recognition failed for this audio segment');
}
async function route({p,req,res,user,send,fetcher}){
  if(p==='/api/captions/config'&&req.method==='GET'){
    return send(res,200,{enabled:configured(),languages:LANGUAGES,
      mode:'segmented',intervalSeconds:6});
  }
  if(p==='/api/captions/transcribe'&&req.method==='POST'){
    if(!configured())fail(503,'Captions are not configured. Add Azure Speech key and region to the server.');
    if(req.headers['x-cricket-captions-consent']!=='yes')
      fail(403,'Confirm authorization and consent before enabling captions');
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('audio/wav'))
      fail(415,'Audio must be submitted as PCM WAV');
    const language=String(req.headers['x-cricket-caption-language']||'en-US');
    if(!LANGUAGES.includes(language))fail(400,'Unsupported caption language');
    const release=reserve(user);
    try{
      const audio=await readAudio(req);
      validateWav(audio);
      const text=await transcribe(audio,language,fetcher);
      return send(res,200,{text});
    }finally{release();}
  }
  fail(404,'Caption endpoint not found');
}
module.exports={route,validateWav,LANGUAGES};
