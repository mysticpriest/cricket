'use strict';
/* Office-admin time clock, server timestamps and immutable shift event history.
   Polls four-second snapshots; it does not change staff status or extend idle sessions. */
(()=>{
  const statusInfo={
    working:{name:'Start Shift',color:'green'},
    break:{name:'Break',color:'orange'},
    meeting:{name:'Meeting',color:'violet'},
    system_issues:{name:'System Issues',color:'rose'},
    ended:{name:'End Shift',color:'slate'},
    not_started:{name:'Not started',color:'slate'}
  };
  const actionNames={start_shift:'Start Shift',break:'Break',meeting:'Meeting',
    system_issues:'System Issues',end_shift:'End Shift'};
  const byId=id=>document.getElementById(id);
  const make=(tag,klass,text)=>{
    const e=document.createElement(tag);
    if(klass)e.className=klass;
    if(text!==undefined)e.textContent=String(text);
    return e;
  };
  let snapshot=null,offset=0,busy=false;
  function localDate(milliseconds){
    if(!Number.isFinite(Number(milliseconds))||!milliseconds)return '—';
    return new Date(Number(milliseconds)).toLocaleString();
  }
  function timer(value){
    if(!value)return '—';
    const seconds=Math.max(0,Math.floor((Date.now()-offset-Number(value))/1000));
    const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
    return h? h+'h '+String(m).padStart(2,'0')+'m':m+'m '+String(s).padStart(2,'0')+'s';
  }
  function render(){
    if(!snapshot)return;
    const counts=byId('opsShiftSummary');counts.replaceChildren();
    for(const key of ['working','break','meeting','system_issues','ended','not_started']){
      const card=make('div','ops-shift-count');
      card.dataset.status=key;
      card.append(make('span','',statusInfo[key].name),make('strong','',snapshot.summary[key]||0));
      counts.append(card);
    }
    const list=byId('opsShiftRoster');list.replaceChildren();
    const choice=byId('opsShiftFilter').value;
    const people=snapshot.people.filter(person=>choice==='all'||person.status===choice);
    if(!people.length){
      list.append(make('p','ops-empty','No employee clocks match this filter.'));
    }
    for(const person of people){
      const row=make('article','ops-clock-row');
      const head=make('div','ops-clock-identity');
      head.append(make('strong','',person.displayName||person.email),
        make('small','',person.role.toUpperCase()+' · '+person.email));
      const status=make('div','ops-clock-state');
      status.dataset.status=person.status;
      status.append(make('span','ops-shift-dot'),make('strong','',statusInfo[person.status]?.name||'Not started'));
      const start=make('div','ops-clock-fact');
      start.append(make('small','','Clocked in'),make('strong','',localDate(person.startedAt)));
      const change=make('div','ops-clock-fact');
      change.append(make('small','','Last transition'),make('strong','',localDate(person.updatedAt)));
      const elapsed=make('div','ops-clock-fact');
      elapsed.append(make('small','','Shift length'));
      const value=make('strong','',person.startedAt?timer(person.startedAt):'—');
      if(person.startedAt){
        value.dataset.shiftStarted=String(person.startedAt);
        value.dataset.shiftEnded=person.endedAt?String(person.endedAt):'';
      }
      elapsed.append(value);
      row.append(head,status,start,change,elapsed);
      list.append(row);
    }
    const events=byId('opsShiftEvents');events.replaceChildren();
    if(!snapshot.history.length)events.append(make('p','ops-empty','No clock events have been recorded.'));
    for(const event of snapshot.history.slice(0,35)){
      const line=make('article','ops-clock-event');
      const name=make('strong','',event.displayName||event.email);
      const what=make('span','',actionNames[event.action]||event.action);
      what.dataset.status=event.action==='start_shift'?'working':
        event.action==='end_shift'?'ended':event.action;
      line.append(name,what,make('time','',localDate(event.createdAt)));
      events.append(line);
    }
  }
  async function refresh(){
    if(document.hidden||busy)return;
    busy=true;
    try{
      const res=await fetch('/api/admin/shifts',{credentials:'same-origin'});
      if(res.status===401){location.replace('login.html?next=operations.html');return;}
      if(res.status===403)return;
      if(!res.ok)throw Error('Unable to load shift activity');
      snapshot=await res.json();
      offset=Date.now()-Number(snapshot.serverTime);
      render();
      byId('opsShiftUpdated').textContent='Updated '+new Date().toLocaleTimeString();
    }catch(error){byId('opsShiftUpdated').textContent=error.message;}
    finally{busy=false;}
  }
  byId('opsShiftFilter').addEventListener('change',render);
  window.setInterval(()=>{
    if(document.hidden)return;
    document.querySelectorAll('[data-shift-started]').forEach(node=>{
      const started=Number(node.dataset.shiftStarted);
      const ended=Number(node.dataset.shiftEnded);
      if(ended&&started){
        const seconds=Math.max(0,Math.floor((ended-started)/1000));
        node.textContent=Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m';
      }else node.textContent=timer(started);
    });
  },1000);
  window.setInterval(refresh,4000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  void refresh();
})();
