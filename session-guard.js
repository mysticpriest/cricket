'use strict';
// Local demo session protection. Auth is enforced on the server as well.
(() => {
  const OPEN_KEY='cricket_tab_open';
  const ACTIVITY_KEY='cricket_last_activity';
  const IDLE_MS=20*60*1000;
  let signedOut=false;
  let lastHeartbeat=0;
  const tabOpen=()=>{try{return sessionStorage.getItem(OPEN_KEY)==='1';}catch(_){return false;}};
  const lastActivity=()=>{try{return Number(sessionStorage.getItem(ACTIVITY_KEY))||0;}catch(_){return 0;}};
  const clear=()=>{try{sessionStorage.removeItem(OPEN_KEY);sessionStorage.removeItem(ACTIVITY_KEY);}catch(_){}};
  function expire(reason='expired'){
    if(signedOut)return;
    signedOut=true;
    clear();
    document.documentElement.style.visibility='hidden';
    fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',keepalive:true})
      .catch(()=>{})
      .finally(()=>location.replace('login.html?reason='+reason));
  }
  window.CricketSession={clear,expire};
  if(!tabOpen()){
    expire('closed');
    return;
  }
  if(Date.now()-lastActivity()>=IDLE_MS){
    expire('idle');
    return;
  }
  let lastEvent=0;
  function onUserActivity(){
    if(signedOut || document.visibilityState==='hidden')return;
    const now=Date.now();
    if(now-lastActivity()>=IDLE_MS){expire('idle');return;}
    if(now-lastEvent<1000)return;
    lastEvent=now;
    try{sessionStorage.setItem(ACTIVITY_KEY,String(now));}catch(_){}
    if(now-lastHeartbeat>=45000){
      lastHeartbeat=now;
      fetch('/api/auth/activity',{method:'POST',credentials:'same-origin'})
        .then(response=>{if(response.status===401)expire('idle');})
        .catch(()=>{});
    }
  }
  for(const eventName of ['pointerdown','keydown','touchstart','scroll']){
    window.addEventListener(eventName,onUserActivity,{passive:true});
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible'){
      if(Date.now()-lastActivity()>=IDLE_MS)expire('idle');
      else onUserActivity();
    }
  });
  window.setInterval(()=>{
    if(!signedOut && Date.now()-lastActivity()>=IDLE_MS)expire('idle');
  },10000);
})();
