'use strict';
/* Cricket employee workspace — account-persisted personal desk. All mutations
   require an authenticated office account; never store content in localStorage.
   Handles desktop drag/drop and keyboard/touch Move Up / Move Down controls. */
(()=>{
  const WIDGETS=[
    ['metrics','Case snapshot'],['presence','Active agents'],
    ['divisions','Workspace tabs'],['shift','My shift clock'],
    ['sticky','Sticky notes'],['reminders','Reminders'],
    ['guide','Shift walkthrough'],['quick','Quick access']
  ];
  const TABS=[
    ['overview','Overview'],['analytics','Analytics'],['inbound','Inbound / Office workflows'],
    ['outbound','Outbound'],['cases','Case archive'],['qc','Quality control'],
    ['operations','Live operations'],['staff','Staff accounts']
  ];
  const COLORS={
    blue:'#2563eb',indigo:'#4f46e5',teal:'#0f766e',green:'#15803d',
    orange:'#c26718',rose:'#be185d',slate:'#475569',violet:'#7c3aed'
  };
  const SIZES=[['compact','Small'],['standard','Medium'],['wide','Full width']];
  const ACTIONS=[
    ['start_shift','Start Shift','working'],['break','Break','break'],
    ['meeting','Meeting','meeting'],['system_issues','System Issues','system_issues'],
    ['end_shift','End Shift','ended']
  ];
  const byId=id=>document.getElementById(id);
  const make=(tag,klass,text)=>{
    const n=document.createElement(tag);if(klass)n.className=klass;
    if(text!==undefined)n.textContent=String(text);
    return n;
  };
  const data={user:null,layout:null,notes:[],reminders:[],shift:null,
    edit:false,widgets:new Map(),nav:new Map(),busy:false,saveChain:Promise.resolve(),
    saveVersion:0,serverOffset:0,ready:false,editingNote:null,editingReminder:null};
  const defaultLayout=()=>({
    widgets:WIDGETS.map(([id])=>({id,size:['metrics','presence','divisions'].includes(id)?'wide':'standard',color:'blue',hidden:false})),
    nav:TABS.map(([id])=>({id,color:'blue',hidden:false}))
  });
  async function api(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options});
    let payload={};
    try{payload=await response.json();}
    catch(_){throw Error('Cricket did not respond with valid JSON');}
    if(response.status===401){
      location.replace('login.html?next=index.html');throw Error('Session expired');
    }
    if(!response.ok)throw Error(payload.error||'Unable to save your workspace');
    return payload;
  }
  const json=(method,value)=>({
    method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)
  });
  const feedback=(text,error=false)=>{
    const el=byId('wsSaveMessage');if(!el)return;
    el.textContent=text;el.classList.toggle('error',error);
  };
  function persistLayout(){
    const version=++data.saveVersion;
    const snapshot=JSON.parse(JSON.stringify(data.layout));
    feedback('Saving your layout…');
    data.saveChain=data.saveChain.catch(()=>{}).then(async()=>{
      try{
        await api('/api/workspace/layout',json('PUT',snapshot));
        if(version===data.saveVersion)feedback('Saved to your employee account ✓');
      }catch(error){if(version===data.saveVersion)feedback(error.message,true);}
    });
  }
  function moveEntry(kind,id,direction){
    const items=data.layout[kind];
    const old=items.findIndex(x=>x.id===id),pos=old+direction;
    if(old<0||pos<0||pos>=items.length)return;
    const [entry]=items.splice(old,1);items.splice(pos,0,entry);
    applyLayout();renderEditor();persistLayout();
  }
  function setEntry(kind,id,patch){
    const row=data.layout[kind].find(x=>x.id===id);
    if(!row)return;
    Object.assign(row,patch);
    if(kind==='nav'&&id==='overview')row.hidden=false;
    applyLayout();renderEditor();persistLayout();
  }
  function optionSelect(options,value,onChange,title){
    const select=make('select','ws-mini-select');
    select.setAttribute('aria-label',title);
    for(const [id,label] of options){
      const option=make('option','',label);option.value=id;select.append(option);
    }
    select.value=value;select.addEventListener('change',()=>onChange(select.value));
    return select;
  }
  function button(label,css,click,title){
    const b=make('button',css,label);b.type='button';
    if(title)b.title=title;
    b.addEventListener('click',click);
    return b;
  }
  function mountDashboard(){
    const grid=byId('workspaceTiles');
    if(!grid)return;
    const stats=document.querySelector('.workspace-body > .stats');
    const presence=document.querySelector('.workspace-body > .live-agent-panel');
    const divisions=document.querySelector('.workspace-body > .division-grid');
    const divisionHead=divisions?.previousElementSibling;
    const support=document.querySelector('.workspace-body > .support-grid');
    const guideHead=support?.previousElementSibling;
    const guide=support?.firstElementChild;
    const quick=support?.lastElementChild;
    const contents={
      metrics:stats?[stats]:[],presence:presence?[presence]:[],
      divisions:[divisionHead,divisions].filter(Boolean),
      guide:[guideHead,guide].filter(Boolean),quick:quick?[quick]:[]
    };
    for(const [id,label] of WIDGETS){
      const section=make('section','ws-widget');
      section.dataset.widget=id;
      const header=make('header','ws-widget-header');
      const identity=make('div','ws-widget-heading');
      identity.append(make('span','ws-widget-accent'),make('h2','',label));
      const tools=make('div','ws-widget-tools');
      const drag=button('⋮⋮','ws-drag-handle',()=>{},'Drag to rearrange this block');
      drag.draggable=false;drag.setAttribute('aria-label','Drag '+label+' to rearrange');
      tools.append(drag);
      const up=button('↑','ws-move-button',()=>moveEntry('widgets',id,-1),'Move '+label+' up');
      const down=button('↓','ws-move-button',()=>moveEntry('widgets',id,1),'Move '+label+' down');
      tools.append(up,down);
      header.append(identity,tools);
      const content=make('div','ws-widget-content');
      for(const el of contents[id]||[])content.append(el);
      section.append(header,content);
      if(id==='shift')setupShift(content);
      if(id==='sticky')setupNotes(content);
      if(id==='reminders')setupReminders(content);
      section.addEventListener('dragstart',event=>{
        if(!data.edit){event.preventDefault();return;}
        const originated=event.target.closest('.ws-drag-handle');
        if(!originated){event.preventDefault();return;}
        event.dataTransfer.effectAllowed='move';
        event.dataTransfer.setData('text/plain',id);
        section.classList.add('ws-is-dragging');
      });
      section.addEventListener('dragend',()=>section.classList.remove('ws-is-dragging'));
      section.addEventListener('dragover',event=>{
        if(!data.edit)return;
        event.preventDefault();event.dataTransfer.dropEffect='move';
        section.classList.add('ws-drag-target');
      });
      section.addEventListener('dragleave',()=>section.classList.remove('ws-drag-target'));
      section.addEventListener('drop',event=>{
        if(!data.edit)return;
        event.preventDefault();
        section.classList.remove('ws-drag-target');
        const dragged=event.dataTransfer.getData('text/plain');
        if(dragged&&dragged!==id){
          const from=data.layout.widgets.findIndex(x=>x.id===dragged);
          const to=data.layout.widgets.findIndex(x=>x.id===id);
          if(from>=0&&to>=0){
            const [item]=data.layout.widgets.splice(from,1);
            data.layout.widgets.splice(to,0,item);
            applyLayout();renderEditor();persistLayout();
          }
        }
      });
      // Native drag originates from the draggable handle, never textareas or cards.
      // Touch and keyboard users get the adjacent Move Up / Down controls.
      drag.addEventListener('dragstart',event=>{
        if(!data.edit)event.preventDefault();
      });
      data.widgets.set(id,section);grid.append(section);
    }
    support?.remove();
    mountNav();
    byId('workspacePersonalControls').hidden=false;
    byId('wsCustomize').addEventListener('click',()=>{
      data.edit=!data.edit;
      byId('wsCustomize').textContent=data.edit?'Finish customizing':'Customize workspace';
      byId('wsCustomize').setAttribute('aria-pressed',String(data.edit));
      document.body.classList.toggle('ws-editing',data.edit);
      byId('wsCustomizePanel').hidden=!data.edit;
      for(const section of data.widgets.values()){
        section.draggable=false;
        section.querySelector('.ws-drag-handle').draggable=data.edit;
      }
      applyLayout();renderEditor();
    });
  }
  function mountNav(){
    const primary=document.querySelector('.sidebar .nav');
    if(!primary)return;
    const secondary=document.querySelectorAll('.sidebar .nav')[1];
    const links=[...document.querySelectorAll('.sidebar .nav-item')];
    for(const a of links){
      const href=a.getAttribute('href')||'';
      const id=href==='office-workflow.html'?'inbound':{
        'index.html':'overview','analytics.html':'analytics','inbound.html':'inbound',
        'outbound.html':'outbound','cases.html':'cases','qc.html':'qc',
        'operations.html':'operations','staff.html':'staff'
      }[href];
      if(id){a.dataset.wsNav=id;data.nav.set(id,a);primary.append(a);}
    }
    if(secondary){const heading=secondary.previousElementSibling;
      if(heading?.classList.contains('sidebar-section-title'))heading.hidden=true;
      secondary.hidden=true;
    }
  }
  function applyLayout(){
    const grid=byId('workspaceTiles');
    for(const item of data.layout.widgets){
      const widget=data.widgets.get(item.id);if(!widget)continue;
      widget.dataset.size=item.size;
      widget.style.setProperty('--ws-accent',COLORS[item.color]);
      widget.dataset.color=item.color;
      widget.hidden=item.hidden&&!data.edit;
      widget.classList.toggle('ws-muted-widget',item.hidden);
      grid.append(widget);
    }
    const navHost=document.querySelector('.sidebar .nav');
    for(const item of data.layout.nav){
      const el=data.nav.get(item.id);if(!el)continue;
      const roleAllowed=!el.dataset.access||el.dataset.access.split(',').includes(data.user.role);
      const productAllowed=!(data.user.office?.workflowTemplate==='starter'&&item.id==='outbound');
      el.hidden=!roleAllowed||!productAllowed||item.hidden;
      el.style.setProperty('--ws-accent',COLORS[item.color]);
      el.dataset.wsColor=item.color;
      if(el.classList.contains('active'))el.style.setProperty('--ws-active',COLORS[item.color]);
      navHost?.append(el);
      const tile=document.querySelector('.division[data-division="'+item.id+'"]');
      if(tile){
        tile.style.setProperty('--ws-accent',COLORS[item.color]);
        tile.hidden=item.hidden;
      }
    }
    // Division cards are also tabs: move them into the employee's chosen order.
    const tileHost=document.querySelector('.division-grid');
    if(tileHost)for(const tab of data.layout.nav){
      const tile=tileHost.querySelector('.division[data-division="'+tab.id+'"]');
      if(tile){tileHost.append(tile);tile.style.setProperty('--ws-accent',COLORS[tab.color]);}
    }
  }
  function renderEditor(){
    const host=byId('wsCustomizePanel');
    if(!host||!data.edit)return;
    host.replaceChildren();
    const intro=make('p','ws-customize-description',
      'Move blocks using drag handles or the arrows. Choose size and accent colors, and hide blocks you do not need. Changes save to your account automatically.');
    host.append(intro);
    for(const kind of ['widgets','nav']){
      const section=make('div','ws-editor-column');
      section.append(make('h3','',kind==='widgets'?'Dashboard blocks':'Sidebar & division tabs'));
      for(const [index,item] of data.layout[kind].entries()){
        const isWidget=kind==='widgets';
        const name=(isWidget?WIDGETS:TABS).find(x=>x[0]===item.id)?.[1]||item.id;
        const row=make('div','ws-editor-row');
        const caption=make('strong','',name);
        const controls=make('div','ws-editor-controls');
        const color=optionSelect(Object.keys(COLORS).map(id=>[id,id[0].toUpperCase()+id.slice(1)]),
          item.color,value=>setEntry(kind,item.id,{color:value}),name+' accent color');
        controls.append(color);
        if(isWidget)controls.append(optionSelect(SIZES,item.size,
          value=>setEntry(kind,item.id,{size:value}),name+' block size'));
        const visibility=button(item.hidden?'Show':'Hide','ws-editor-toggle',
          ()=>setEntry(kind,item.id,{hidden:!item.hidden}),item.hidden?'Show '+name:'Hide '+name);
        visibility.disabled=kind==='nav'&&item.id==='overview';
        controls.append(visibility);
        const up=button('↑','ws-editor-move',()=>moveEntry(kind,item.id,-1),'Move '+name+' up');
        const down=button('↓','ws-editor-move',()=>moveEntry(kind,item.id,1),'Move '+name+' down');
        up.disabled=index===0;down.disabled=index===data.layout[kind].length-1;
        controls.append(up,down);
        row.append(caption,controls);section.append(row);
      }
      host.append(section);
    }
    host.append(button('Restore default arrangement','ws-editor-reset',()=>{
      if(!confirm('Reset your tab order, block visibility, sizes and colors? Notes, reminders and shifts will stay.'))return;
      data.layout=defaultLayout();applyLayout();renderEditor();persistLayout();
    }));
  }
  function setupShift(host){
    const current=make('div','ws-shift-current');
    current.append(make('span','ws-eyebrow','CURRENT SHIFT'));
    const status=make('strong','ws-shift-status','Not clocked in');
    status.id='wsShiftStatus';current.append(status);
    const time=make('span','ws-shift-elapsed','00:00:00');
    time.id='wsShiftTimer';current.append(time);
    const hint=make('p','ws-shift-hint','Start Shift begins your time record. Select it again to return to work after a break or meeting.');
    current.append(hint);
    const actions=make('div','ws-shift-actions');
    for(const [action,label] of ACTIONS){
      const b=button(label,'ws-shift-action',()=>changeShift(action));
      b.dataset.action=action;
      b.setAttribute('aria-label',label);
      actions.append(b);
    }
    const msg=make('p','ws-form-feedback');msg.id='wsShiftMessage';
    host.append(current,actions,msg);
  }
  async function changeShift(action){
    const buttons=[...document.querySelectorAll('.ws-shift-action')];
    buttons.forEach(b=>b.disabled=true);
    byId('wsShiftMessage').textContent='Updating shift status…';
    try{
      const result=await api('/api/workspace/shift',json('POST',{action}));
      data.shift=result.shift;data.serverOffset=Date.now()-result.serverTime;
      drawShift();
      byId('wsShiftMessage').textContent='Your shift status has been recorded.';
    }catch(error){byId('wsShiftMessage').textContent=error.message;drawShift();}
  }
  function drawShift(){
    const shift=data.shift,active=!!shift&&!shift.endedAt;
    const status={working:'On shift',break:'On break',meeting:'In a meeting',
      system_issues:'System issues',ended:'Shift ended'};
    const name=shift?status[shift.status]||shift.status:'Not clocked in';
    const el=byId('wsShiftStatus');if(!el)return;
    el.textContent=name;
    el.dataset.status=shift?.status||'not_started';
    for(const b of document.querySelectorAll('.ws-shift-action')){
      const action=b.dataset.action;
      b.disabled=action==='start_shift'?active&&shift.status==='working':!active;
      b.classList.toggle('selected',(action==='start_shift'&&shift?.status==='working')||
        action===shift?.status);
    }
    drawShiftTimer();
  }
  function drawShiftTimer(){
    const target=byId('wsShiftTimer');if(!target)return;
    const shift=data.shift;
    if(!shift){target.textContent='00:00:00';return;}
    const t=shift.endedAt||Date.now()-data.serverOffset;
    const seconds=Math.max(0,Math.floor((t-shift.startedAt)/1000));
    const two=n=>String(n).padStart(2,'0');
    target.textContent=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(two).join(':');
  }
  function setupNotes(host){
    const info=make('p','ws-tool-intro','Your personal notes, saved for the next shift. Do not store patient or customer-identifying information.');
    const list=make('div','ws-sticky-list');list.id='wsStickyList';
    const form=make('form','ws-inline-form');form.id='wsNoteForm';
    const title=make('input');title.id='wsNoteTitle';title.placeholder='Note title';title.maxLength=100;title.required=true;
    title.setAttribute('aria-label','Sticky note title');
    const body=make('textarea');body.id='wsNoteBody';body.placeholder='Write a private reminder to yourself…';
    body.maxLength=4000;body.rows=3;body.setAttribute('aria-label','Sticky note text');
    const bottom=make('div','ws-form-actions');
    const color=optionSelect(Object.keys(COLORS).map(x=>[x,x[0].toUpperCase()+x.slice(1)]),
      'blue',()=>{},'Sticky note color');color.id='wsNoteColor';
    const pinned=make('label','ws-check-label');
    const pin=make('input');pin.type='checkbox';pin.id='wsNotePinned';
    pinned.append(pin,document.createTextNode('Pin'));
    const save=make('button','button ws-inline-save','Save note');save.type='submit';save.id='wsNoteSave';
    const clear=button('Cancel','ws-inline-cancel',resetNoteForm);
    bottom.append(color,pinned,save,clear);
    form.append(title,body,bottom);
    const msg=make('p','ws-form-feedback');msg.id='wsNoteMessage';
    host.append(info,list,form,msg);
    form.addEventListener('submit',saveNote);
  }
  function resetNoteForm(){
    data.editingNote=null;
    byId('wsNoteForm')?.reset();
    byId('wsNoteSave').textContent='Save note';
    byId('wsNoteMessage').textContent='';
  }
  function drawNotes(){
    const list=byId('wsStickyList');if(!list)return;
    list.replaceChildren();
    if(!data.notes.length){list.append(make('p','ws-empty','No notes yet. Add one below to keep it for your next shift.'));return;}
    for(const note of data.notes){
      const card=make('article','ws-note-card');
      card.style.setProperty('--ws-note-color',COLORS[note.color]||COLORS.blue);
      const head=make('div','ws-note-header');
      const title=make('strong','',note.title);
      head.append(title);
      if(note.pinned)head.append(make('span','ws-pin','Pinned'));
      const body=make('p','ws-note-body',note.body||'No additional details');
      const actions=make('div','ws-note-actions');
      actions.append(
        button('Edit','ws-note-control',()=>{
          data.editingNote=note.id;
          byId('wsNoteTitle').value=note.title;
          byId('wsNoteBody').value=note.body;
          byId('wsNoteColor').value=note.color;
          byId('wsNotePinned').checked=note.pinned;
          byId('wsNoteSave').textContent='Update note';
          byId('wsNoteTitle').focus();
        }),
        button('Delete','ws-note-control danger',async()=>{
          if(!confirm('Delete this private note?'))return;
          try{
            const response=await api('/api/workspace/notes/'+encodeURIComponent(note.id),{method:'DELETE'});
            data.notes=response.notes;if(data.editingNote===note.id)resetNoteForm();
            drawNotes();
          }catch(error){byId('wsNoteMessage').textContent=error.message;}
        })
      );
      card.append(head,body,actions);
      list.append(card);
    }
  }
  async function saveNote(event){
    event.preventDefault();
    const id=data.editingNote;
    const value={
      title:byId('wsNoteTitle').value.trim(),body:byId('wsNoteBody').value.trim(),
      color:byId('wsNoteColor').value,pinned:byId('wsNotePinned').checked
    };
    const b=byId('wsNoteSave');b.disabled=true;
    try{
      const result=await api(id?'/api/workspace/notes/'+encodeURIComponent(id):'/api/workspace/notes',
        json(id?'PATCH':'POST',value));
      data.notes=result.notes;resetNoteForm();drawNotes();
      byId('wsNoteMessage').textContent='Note saved to your account.';
    }catch(error){byId('wsNoteMessage').textContent=error.message;}
    finally{b.disabled=false;}
  }
  function setupReminders(host){
    host.append(make('p','ws-tool-intro',
      'Set a due date, track what is coming up, and mark reminders complete. They stay with your employee account.'));
    const list=make('div','ws-reminder-list');list.id='wsReminderList';
    const form=make('form','ws-inline-form');form.id='wsReminderForm';
    const title=make('input');title.id='wsReminderTitle';title.placeholder='Reminder title';title.required=true;title.maxLength=130;
    title.setAttribute('aria-label','Reminder title');
    const details=make('textarea');details.id='wsReminderDetails';details.rows=2;details.maxLength=1200;
    details.placeholder='Optional details';details.setAttribute('aria-label','Reminder details');
    const dueLabel=make('label','ws-date-label','Remind me by (optional)');
    const due=make('input');due.id='wsReminderDue';due.type='datetime-local';
    dueLabel.append(due);
    const actions=make('div','ws-form-actions');
    const save=make('button','button ws-inline-save','Save reminder');save.type='submit';save.id='wsReminderSave';
    actions.append(save,button('Cancel','ws-inline-cancel',resetReminderForm));
    form.append(title,details,dueLabel,actions);
    const msg=make('p','ws-form-feedback');msg.id='wsReminderMessage';
    host.append(list,form,msg);form.addEventListener('submit',saveReminder);
  }
  function dueLabel(iso){
    if(!iso)return 'No due date';
    const d=new Date(iso);
    if(Number.isNaN(d.getTime()))return 'No due date';
    return d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  }
  function resetReminderForm(){
    data.editingReminder=null;
    byId('wsReminderForm')?.reset();
    byId('wsReminderSave').textContent='Save reminder';
    byId('wsReminderMessage').textContent='';
  }
  function drawReminders(){
    const host=byId('wsReminderList');if(!host)return;
    host.replaceChildren();
    if(!data.reminders.length){host.append(make('p','ws-empty','Your reminders will appear here.'));return;}
    for(const reminder of data.reminders){
      const row=make('article','ws-reminder-row');
      row.classList.toggle('completed',reminder.done);
      const check=make('input','ws-reminder-check');check.type='checkbox';
      check.checked=reminder.done;check.setAttribute('aria-label','Complete '+reminder.title);
      check.addEventListener('change',async()=>{
        check.disabled=true;
        try{
          const result=await api('/api/workspace/reminders/'+encodeURIComponent(reminder.id),
            json('PATCH',{title:reminder.title,body:reminder.body,dueAt:reminder.dueAt,done:check.checked}));
          data.reminders=result.reminders;drawReminders();
        }catch(error){check.checked=!check.checked;check.disabled=false;byId('wsReminderMessage').textContent=error.message;}
      });
      const text=make('div','ws-reminder-details');
      text.append(make('strong','',reminder.title));
      if(reminder.body)text.append(make('p','',reminder.body));
      const due=make('small','',dueLabel(reminder.dueAt));
      if(!reminder.done&&reminder.dueAt&&Date.parse(reminder.dueAt)<Date.now()){
        due.classList.add('overdue');due.textContent='Overdue · '+due.textContent;
      }
      text.append(due);
      const actions=make('div','ws-note-actions');
      actions.append(
        button('Edit','ws-note-control',()=>{
          data.editingReminder=reminder.id;
          byId('wsReminderTitle').value=reminder.title;
          byId('wsReminderDetails').value=reminder.body;
          if(reminder.dueAt){
            const d=new Date(reminder.dueAt);
            const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
            byId('wsReminderDue').value=local.toISOString().slice(0,16);
          }else byId('wsReminderDue').value='';
          byId('wsReminderSave').textContent='Update reminder';
          byId('wsReminderTitle').focus();
        }),
        button('Delete','ws-note-control danger',async()=>{
          if(!confirm('Delete this reminder?'))return;
          try{
            const result=await api('/api/workspace/reminders/'+encodeURIComponent(reminder.id),{method:'DELETE'});
            data.reminders=result.reminders;
            if(data.editingReminder===reminder.id)resetReminderForm();
            drawReminders();
          }catch(error){byId('wsReminderMessage').textContent=error.message;}
        })
      );
      text.append(actions);row.append(check,text);host.append(row);
    }
  }
  async function saveReminder(event){
    event.preventDefault();
    const id=data.editingReminder;
    const val=byId('wsReminderDue').value;
    const dueAt=val?new Date(val).toISOString():null;
    const current=data.reminders.find(r=>r.id===id);
    const value={
      title:byId('wsReminderTitle').value.trim(),
      body:byId('wsReminderDetails').value.trim(),
      dueAt,done:current?.done||false
    };
    const b=byId('wsReminderSave');b.disabled=true;
    try{
      const result=await api(id?'/api/workspace/reminders/'+encodeURIComponent(id):'/api/workspace/reminders',
        json(id?'PATCH':'POST',value));
      data.reminders=result.reminders;resetReminderForm();drawReminders();
      byId('wsReminderMessage').textContent='Reminder saved to your account.';
    }catch(error){byId('wsReminderMessage').textContent=error.message;}
    finally{b.disabled=false;}
  }
  async function boot(user){
    if(data.ready)return;
    data.ready=true;data.user=user;
    try{
      const response=await api('/api/workspace/me');
      data.layout=response.layout||defaultLayout();
      data.notes=response.notes||[];
      data.reminders=response.reminders||[];
      data.shift=response.shift;
      data.serverOffset=Date.now()-response.serverTime;
      mountDashboard();
      applyLayout();drawNotes();drawReminders();drawShift();
      feedback('Saved to your employee account');
      window.setInterval(()=>{if(!document.hidden)drawShiftTimer();},1000);
      window.setInterval(()=>{if(!document.hidden)drawReminders();},60000);
    }catch(error){
      data.ready=false;
      const notice=byId('notice');
      if(notice)notice.textContent='Personal workspace features unavailable: '+error.message;
    }
  }
  window.addEventListener('cricket-dashboard-ready',event=>{void boot(event.detail.user);});
})();
