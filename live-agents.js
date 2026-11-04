'use strict';
// Presence summary visible to every signed-in Cricket employee.
(() => {
  const container=document.querySelector('[data-live-agents]');
  if(!container)return;
  const count=document.querySelector('[data-live-agent-count]');
  const routeNames={appointment:'Appointment Inquiry',clinic:'Clinic Information',scheduling:'Scheduling Inquiry'};
  const stageNames={intake:'Waiting for call number',selecting:'Selecting inquiry',working:'Handling inquiry',verification:'Verifying caller',documentation:'Documenting call',completed:'Call documented',idle:'Available'};
  let people=[];
  let skew=0;
  function e(tag,className,text){
    const n=document.createElement(tag);
    if(className)n.className=className;
    if(text!==undefined)n.textContent=text;
    return n;
  }
  function timeSince(timestamp) {
    if(!timestamp)return '';
    const seconds=Math.max(0,Math.floor((Date.now()-skew-Number(timestamp))/1000));
    const hours=Math.floor(seconds/3600);
    const mins=Math.floor((seconds%3600)/60);
    const secs=seconds%60;
    return hours?hours+'h '+String(mins).padStart(2,'0')+'m'
      : String(mins).padStart(2,'0')+':'+String(secs).padStart(2,'0');
  }
  function draw(){
    container.replaceChildren();
    if(count)count.textContent=people.length+' online';
    if(!people.length){
      container.append(e('p','live-agents-empty','No agents reporting activity right now. Open Inbound as an Agent to begin the live demo.'));
      return;
    }
    for(const user of people){
      const row=e('div','live-agent-row');
      const avatar=e('span','live-agent-avatar',(user.displayName||'A').slice(0,1).toUpperCase());
      const info=e('div','live-agent-text');
      info.append(e('strong','',user.displayName||'Agent'));
      const route=routeNames[user.route];
      info.append(e('span','',route
        ? route+' · '+(stageNames[user.stage]||'Working')
        : stageNames[user.stage]||'Online'));
      const right=e('div','live-agent-right');
      right.append(e('span','live-agent-live','● LIVE'));
      const time=e('span','live-agent-elapsed',user.routeStartedAt?'On route '+timeSince(user.routeStartedAt):'Online');
      if(user.routeStartedAt)time.dataset.startedAt=String(user.routeStartedAt);
      right.append(time);
      row.append(avatar,info,right);
      container.append(row);
    }
  }
  async function refresh(){
    if(document.hidden)return;
    try{
      const response=await fetch('/api/active-agents',{credentials:'same-origin'});
      if(response.status===401){window.CricketSession?.expire('idle');return;}
      if(!response.ok)throw Error('Live status unavailable');
      const data=await response.json();
      if(!Array.isArray(data.agents))throw Error('Invalid response');
      people=data.agents;
      skew=Date.now()-Number(data.serverTime);
      draw();
    }catch(_){
      container.replaceChildren(e('p','live-agents-empty','Connection to live agent status unavailable.'));
      if(count)count.textContent='Unavailable';
    }
  }
  window.setInterval(()=>{
    for(const elem of container.querySelectorAll('[data-started-at]')){
      elem.textContent='On route '+timeSince(elem.dataset.startedAt);
    }
  },1000);
  window.setInterval(refresh,5000);
  refresh();
})();
