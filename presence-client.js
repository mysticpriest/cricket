'use strict';
// Cricket presence reporter: sends workflow state, never caller identifiers or call notes.
(() => {
  const name = location.pathname.split('/').pop() || 'index.html';
  const pages = {
    'index.html':'overview','inbound.html':'inbound','outbound.html':'outbound',
    'cases.html':'cases','qc.html':'qc','staff.html':'staff','operations.html':'operations','analytics.html':'analytics'
  };
  const division = pages[name] || 'overview';
  const state = {division,route:'',step:'',stage:division==='inbound'?'intake':'idle'};
  const allowed=['division','route','step','stage'];
  let chain=Promise.resolve();
  let lastOk=0;
  let stopped=false;
  function signedIn() {
    try {
      return sessionStorage.getItem('cricket_tab_open')==='1'
        && Date.now()-(Number(sessionStorage.getItem('cricket_last_activity'))||0)<20*60*1000;
    }catch(_){return false;}
  }
  function send() {
    if(stopped || !signedIn())return Promise.resolve();
    const payload=JSON.stringify({...state});
    chain=chain.catch(()=>{}).then(async()=>{
      if(stopped||!signedIn())return;
      const response=await fetch('/api/presence',{
        method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:payload
      });
      if(response.status===401){
        stopped=true;
        window.CricketSession?.expire('idle');
      }else if(response.ok)lastOk=Date.now();
    }).catch(()=>{});
    return chain;
  }
  function set(update) {
    if(!update || typeof update!=='object')return;
    let changed=false;
    for(const key of allowed) {
      if(Object.prototype.hasOwnProperty.call(update,key) && state[key]!==update[key]){
        state[key]=update[key];
        changed=true;
      }
    }
    if(changed)void send();
  }
  window.CricketPresence={set,send,get:()=>({...state,lastSuccessAt:lastOk})};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void send(),{once:true});
  else void send();
  window.setInterval(()=>void send(),10000);
})();
