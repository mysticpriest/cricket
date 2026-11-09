'use strict';
// Universal personal tools on every authenticated Cricket section.
// Uses the current server session; no credentials, notes or messages in localStorage.
(()=>{
  const $=(id)=>document.getElementById(id);
  const make=(tag,cls,text)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!==undefined)el.textContent=String(text);
    return el;
  };
  const button=(label,action,cls='ut-btn')=>{
    const b=make('button',cls,label);b.type='button';b.addEventListener('click',action);return b;
  };
  const api=async(path,options={})=>{
    const res=await fetch(path,{credentials:'same-origin',...options});
    if(res.status===401)throw Error('Your session has expired');
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.error||'Request failed');return data;
  };
  const json=(method,obj)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
  let user,desk,notifications=[],open=false,selected='desk',searchTimer;
  let priorNotificationIds=null;
  const audio=()=>window.CricketSound;
  const allowed=(url)=>{
    if(user?.role==='admin')return true;
    if(['staff.html','operations.html','workflow-builder.html','cases.html'].includes(url))return false;
    if(['qc.html'].includes(url)&&user?.role!=='qc')return false;
    if(['workflow-runner.html','outbound.html','inbound.html'].includes(url)&&user?.role==='qc')return false;
    if(user?.office?.workflowTemplate==='starter'&&['inbound.html','outbound.html'].includes(url))return false;
    if(user?.office?.workflowTemplate!=='starter'&&url==='office-workflow.html')return false;
    return true;
  };
  function link(label,href,cls){
    const a=make('a',cls||'ut-link',label);a.href=href;return a;
  }
  const links=[
    ['Overview','index.html'],['Analytics','analytics.html'],['Inbound','inbound.html'],
    ['Outbound','outbound.html'],['Office routes','office-workflow.html'],
    ['Team hub','team-hub.html'],['Workforce calendar','workforce.html'],
    ['Workflow Builder','workflow-builder.html'],['Quality Control','qc.html'],
    ['Case archive','cases.html'],['Live Operations','operations.html'],
    ['Staff accounts','staff.html']
  ];
  function setOpen(value){
    open=!!value;
    $('utPanel').hidden=!open;
    $('utShade').hidden=!open;
    $('utLaunch').setAttribute('aria-expanded',String(open));
    document.body.classList.toggle('ut-panel-open',open);
    if(open){renderPanel();void refresh();}
  }
  async function refresh(){
    if(!user)return;
    try{
      const [state,notifs]=await Promise.all([api('/api/workspace/me'),api('/api/ops/notifications')]);
      desk=state;notifications=notifs.notifications;
      // Establish a silent baseline on first load; only newly arriving,
      // unread notifications make a sound on later polls.
      const unreadIds=new Set(notifications.filter(x=>!x.readAt).map(x=>x.id));
      if(priorNotificationIds!==null&&
        [...unreadIds].some(id=>!priorNotificationIds.has(id))&&!document.hidden)
        audio()?.play('notification');
      priorNotificationIds=unreadIds;
      $('utCounter').textContent=String(notifs.unread||'');
      $('utCounter').hidden=!notifs.unread;
      if(open)renderPanel();
    }catch(error){if(open)$('utStatus').textContent=error.message;}
  }
  function renderPanel(){
    const host=$('utContent');host.replaceChildren();
    $('utPanelTitle').textContent=selected==='desk'?'My workspace':'Notifications';
    $('utDeskTab').classList.toggle('selected',selected==='desk');
    $('utAlertsTab').classList.toggle('selected',selected==='alerts');
    if(selected==='alerts'){renderNotifications(host);return;}
    const nav=make('section','ut-section');
    nav.append(make('h3','', 'Go to'));
    const navGrid=make('div','ut-nav');
    for(const [label,href] of links)if(allowed(href))navGrid.append(link(label,href));
    nav.append(navGrid);host.append(nav);
    renderAudioSettings(host);
    const shift=make('section','ut-section');
    shift.append(make('h3','', 'Time clock'));
    const status=desk?.shift?.status||'not_started';
    const names={not_started:'Not clocked in',working:'Working',break:'On break',meeting:'In meeting',system_issues:'System issues',ended:'Shift ended'};
    shift.append(make('p','ut-current','Current: '+(names[status]||status)));
    const actions=make('div','ut-actions');
    for(const [action,label] of [['start_shift','Start Shift'],['break','Break'],['meeting','Meeting'],
      ['system_issues','System Issues'],['end_shift','End Shift']]){
      const b=button(label,async()=>{
        b.disabled=true;try{
          const result=await api('/api/workspace/shift',json('POST',{action}));
          desk.shift=result.shift;
          audio()?.play('shift');
          renderPanel();
        }catch(error){$('utStatus').textContent=error.message; b.disabled=false;}
      });
      const active=!!desk?.shift&&!desk.shift.endedAt;
      b.disabled=action==='start_shift'?(active&&status==='working'):!active;
      actions.append(b);
    }
    shift.append(actions);host.append(shift);
    const note=make('section','ut-section');note.append(make('h3','', 'Sticky notes'));
    for(const item of (desk?.notes||[]).slice(0,12)){
      const card=make('div','ut-note');
      card.append(make('strong','',item.title),make('p','',item.body.slice(0,140)));
      note.append(card);
    }
    if(!desk?.notes?.length)note.append(make('p','ut-muted','No personal notes yet.'));
    const noteForm=make('form','ut-form');
    const title=make('input');title.placeholder='Quick note title';title.maxLength=100;title.required=true;title.setAttribute('aria-label','Quick note title');
    const body=make('textarea');body.placeholder='Write a short note';body.maxLength=4000;body.setAttribute('aria-label','Quick note text');
    noteForm.append(title,body,make('button','ut-primary','Save note'));
    noteForm.addEventListener('submit',async event=>{
      event.preventDefault();
      try{
        const result=await api('/api/workspace/notes',json('POST',{title:title.value,body:body.value,color:'blue',pinned:false}));
        desk.notes=result.notes;renderPanel();
      }catch(error){$('utStatus').textContent=error.message;}
    });
    note.append(noteForm);host.append(note);
    const remind=make('section','ut-section');remind.append(make('h3','', 'Reminders'));
    for(const task of (desk?.reminders||[]).filter(r=>!r.done).slice(0,12)){
      const line=make('label','ut-task');
      const check=make('input');check.type='checkbox';
      check.addEventListener('change',async()=>{
        try{
          const result=await api('/api/workspace/reminders/'+encodeURIComponent(task.id),
            json('PATCH',{title:task.title,body:task.body,dueAt:task.dueAt,done:true}));
          desk.reminders=result.reminders;renderPanel();
        }catch(error){$('utStatus').textContent=error.message;}
      });
      line.append(check,make('span','',task.title));remind.append(line);
    }
    const form=make('form','ut-form');
    const title2=make('input');title2.placeholder='Reminder title';title2.required=true;title2.maxLength=130;title2.setAttribute('aria-label','New reminder');
    const due=make('input');due.type='datetime-local';due.setAttribute('aria-label','Optional due date');
    form.append(title2,due,make('button','ut-primary','Add reminder'));
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      try{
        const result=await api('/api/workspace/reminders',json('POST',{
          title:title2.value,body:'',dueAt:due.value?new Date(due.value).toISOString():null,done:false
        }));
        desk.reminders=result.reminders;renderPanel();
      }catch(error){$('utStatus').textContent=error.message;}
    });
    remind.append(form);host.append(remind);
  }
  function renderAudioSettings(host){
    if(!audio())return;
    const prefs=audio().getPreferences();
    const section=make('section','ut-section ut-sound-section');
    const title=make('div','ut-sound-title');
    title.append(make('h3','', 'Sound effects'));
    const toggle=button(prefs.enabled?'Sound on':'Muted',async()=>{
      toggle.disabled=true;
      try{
        const newEnabled=!audio().getPreferences().enabled;
        const saving=audio().save({...audio().getPreferences(),enabled:newEnabled});
        // Preview within the user gesture; browsers can reject newly created
        // AudioContexts when playback waits until after a network request.
        if(newEnabled)audio().preview();
        const next=await saving;
        toggle.textContent=next.enabled?'Sound on':'Muted';
        toggle.setAttribute('aria-pressed',String(next.enabled));
        slider.disabled=!next.enabled;
        $('utStatus').textContent='Sound preference saved.';
      }catch(error){
        $('utStatus').textContent=error.message;
      }finally{toggle.disabled=false;}
    },'ut-sound-toggle');
    toggle.setAttribute('aria-label','Enable or mute Cricket sound effects');
    toggle.setAttribute('aria-pressed',String(prefs.enabled));
    title.append(toggle);
    const label=make('label','ut-sound-volume-label');
    label.textContent='Volume';
    const percentage=make('output','ut-sound-percentage',prefs.volume+'%');
    const slider=make('input','ut-sound-slider');
    slider.type='range';slider.min='0';slider.max='100';slider.step='5';
    slider.value=String(prefs.volume);slider.disabled=!prefs.enabled;
    slider.setAttribute('aria-label','Cricket sound volume');
    slider.addEventListener('input',()=>{
      percentage.textContent=slider.value+'%';
    });
    slider.addEventListener('change',async()=>{
      slider.disabled=true;
      try{
        const saving=audio().save({...audio().getPreferences(),volume:Number(slider.value)});
        audio().preview();
        await saving;
        $('utStatus').textContent='Sound volume saved.';
      }catch(error){$('utStatus').textContent=error.message;}
      finally{slider.disabled=!audio().getPreferences().enabled;}
    });
    label.append(percentage);
    const help=make('p','ut-muted',
      'Soft clicks and cues for completed actions, notifications and shifts. Settings follow your employee account.');
    section.append(title,label,slider,help);
    host.append(section);
  }
  function renderNotifications(host){
    if(!notifications.length)host.append(make('p','ut-muted','No notifications yet.'));
    for(const item of notifications){
      const card=make('article','ut-notification');
      if(!item.readAt)card.classList.add('unread');
      card.append(make('strong','',item.title),make('p','',item.body));
      const row=make('div','ut-notification-actions');
      const href=String(item.href||'index.html');
      if(/^(?:[a-z-]+\.html)(?:\?[a-zA-Z0-9=&_-]*)?$/.test(href)&&allowed(href.split('?')[0]))
        row.append(link('Open',href));
      if(!item.readAt)row.append(button('Mark read',async()=>{
        try{await api('/api/ops/notifications/'+encodeURIComponent(item.id)+'/read',{method:'POST'});
          item.readAt=new Date().toISOString();await refresh();
        }catch(error){$('utStatus').textContent=error.message;}
      }));
      card.append(row);host.append(card);
    }
  }
  function openSearch(){
    $('utSearchShade').hidden=false;
    $('utSearch').value='';$('utSearchResults').replaceChildren();
    $('utSearch').focus();
  }
  function closeSearch(){$('utSearchShade').hidden=true;}
  async function search(value){
    if(value.trim().length<2){$('utSearchResults').replaceChildren();return;}
    try{
      const {results}=await api('/api/ops/search?q='+encodeURIComponent(value.trim()));
      const box=$('utSearchResults');box.replaceChildren();
      if(!results.length)box.append(make('p','ut-muted','No matching routes or pages.'));
      for(const item of results){
        const itemLink=link(item.title,item.href,'ut-search-item');
        itemLink.append(make('small','',item.type));box.append(itemLink);
      }
    }catch(error){$('utSearchResults').textContent=error.message;}
  }
  function setup(){
    const launch=button('☰  Workspace',()=>setOpen(!open),'ut-launch');
    launch.id='utLaunch';launch.setAttribute('aria-controls','utPanel');launch.setAttribute('aria-expanded','false');
    const count=make('span','ut-counter');count.id='utCounter';count.hidden=true;launch.append(count);
    const shade=make('div','ut-shade');shade.id='utShade';shade.hidden=true;shade.addEventListener('click',()=>setOpen(false));
    const panel=make('aside','ut-panel');panel.id='utPanel';panel.hidden=true;
    panel.setAttribute('aria-label','Universal Cricket workspace tools');
    const head=make('header','ut-head');
    head.append(make('strong','', 'cricket.'),
      button('×',()=>setOpen(false),'ut-close'));
    const tabs=make('div','ut-tabs');
    const deskTab=button('My desk',()=>{selected='desk';renderPanel();});deskTab.id='utDeskTab';
    const alertTab=button('Notifications',()=>{selected='alerts';renderPanel();});alertTab.id='utAlertsTab';
    tabs.append(deskTab,alertTab);
    const h=make('h2','ut-title');h.id='utPanelTitle';
    const content=make('div','ut-content');content.id='utContent';
    const status=make('p','ut-status');status.id='utStatus';status.setAttribute('role','status');
    panel.append(head,tabs,h,content,status);
    const searchShade=make('div','ut-search-shade');searchShade.id='utSearchShade';searchShade.hidden=true;
    const searchModal=make('div','ut-search-dialog');
    searchModal.setAttribute('role','dialog');searchModal.setAttribute('aria-label','Cricket search and command palette');
    const bar=make('div','ut-search-row');
    const input=make('input');input.id='utSearch';input.type='search';
    input.placeholder='Search workflows, cases and pages…';input.setAttribute('aria-label','Search Cricket');
    input.addEventListener('input',()=>{
      clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>void search(input.value),180);
    });
    bar.append(input,button('Esc',closeSearch,'ut-search-dismiss'));
    const results=make('div','ut-search-results');results.id='utSearchResults';
    searchModal.append(bar,results);searchShade.append(searchModal);
    searchShade.addEventListener('click',event=>{if(event.target===searchShade)closeSearch();});
    document.body.append(shade,launch,panel,searchShade);
    document.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();setOpen(false);openSearch();
      }
      if(event.key==='Escape'){closeSearch();setOpen(false);}
    });
    // Quick-search action accessible to users who do not know the shortcut.
    panel.querySelector('.ut-head').append(button('⌕ Search',()=>{setOpen(false);openSearch();},'ut-head-search'));
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    try{
      const response=await api('/api/auth/me');
      user=response.user;
      if(!user||!user.office)return;
      setup();
      try{await audio()?.load();}
      catch(_){/* Sound fails silent; navigation and work must still load. */}
      await refresh();
      window.setInterval(()=>{if(!document.hidden)void refresh();},18000);
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
    }catch(_){/* Ignore non-employee/login pages; backend owns access checks. */}
  });
})();