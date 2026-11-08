'use strict';
/* Cricket employee workspace — account-persisted personal desk. All mutations
   require an authenticated office account; never store content in localStorage.
   Nine-dot direct drag and brush palette work with mouse, touch and pen. */
(()=>{
  const WIDGETS=[
    ['metrics','Case snapshot'],['presence','Active agents'],
    ['divisions','Workspace tabs'],['shift','My shift clock'],
    ['sticky','Sticky notes'],['reminders','Reminders'],
    ['quick','Quick access']
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
    saveVersion:0,noteSaveChain:Promise.resolve(),
    serverOffset:0,ready:false,editingNote:null,editingReminder:null};
  const defaultLayout=()=>({
    version:2,
    widgets:WIDGETS.map(([id])=>({id,size:id==='divisions'?'wide':'standard',color:'blue',hidden:id!=='divisions'})),
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
  function persistNoteOrder(){
    const ids=data.notes.map(note=>note.id);
    data.noteSaveChain=data.noteSaveChain.catch(()=>{}).then(async()=>{
      try{
        const response=await api('/api/workspace/notes/order',json('PUT',{ids}));
        // Preserve the current order if the employee is making another drag.
        if(ids.join(',')===data.notes.map(note=>note.id).join(','))data.notes=response.notes;
        feedback('Sticky note order saved ✓');
      }catch(error){byId('wsNoteMessage').textContent=error.message;}
    });
  }
  function moveNote(id,direction){
    const index=data.notes.findIndex(x=>x.id===id),target=index+direction;
    if(index<0||target<0||target>=data.notes.length)return;
    const [note]=data.notes.splice(index,1);
    data.notes.splice(target,0,note);
    drawNotes();persistNoteOrder();
  }
  function setEntry(kind,id,patch){
    const row=data.layout[kind].find(x=>x.id===id);
    if(!row)return;
    Object.assign(row,patch);
    if((kind==='nav'&&id==='overview')||(kind==='widgets'&&id==='divisions'))row.hidden=false;
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

  // Direct-manipulation controls are visible on every movable block and tab.
  // Pointer events (not HTML5 drag/drop) work with a mouse, pen and touch.
  function dots(){
    const grid=make('span','ws-nine-dots');
    grid.setAttribute('aria-hidden','true');
    for(let i=0;i<9;i++)grid.append(make('i'));
    return grid;
  }
  function paintIcon(){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','17');svg.setAttribute('height','17');
    svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','m14.5 6.5 3 3M3 21c3 0 6-2 6-6l8-8-3-3-8 8c-1 1-2 3-2 9Z');
    svg.append(path);svg.setAttribute('aria-hidden','true');
    return svg;
  }
  function closePalettes(except){
    document.querySelectorAll('.ws-color-popover').forEach(menu=>{
      if(menu===except)return;
      menu.hidden=true;
      const trigger=menu.parentElement?.querySelector('.ws-brush-trigger');
      if(trigger)trigger.setAttribute('aria-expanded','false');
    });
  }
  function toolRail(kind,id,name,host,container,selector){
    const rail=make('div','ws-action-rail');
    const grip=make('button','ws-grip-trigger');
    grip.type='button';grip.title='Drag '+name+' to move around the grid';
    grip.setAttribute('aria-label','Drag '+name+' to rearrange. Press arrow keys to move.');
    grip.append(dots());
    grip.addEventListener('pointerdown',event=>{
      beginPointerDrag(event,{kind,id,source:host,container,selector});
    });
    grip.addEventListener('keydown',event=>{
      if(event.key==='ArrowUp'||event.key==='ArrowLeft'){
        event.preventDefault();
        if(kind==='notes')moveNote(id,-1);
        else moveEntry(kind,id,-1);
      }else if(event.key==='ArrowDown'||event.key==='ArrowRight'){
        event.preventDefault();
        if(kind==='notes')moveNote(id,1);
        else moveEntry(kind,id,1);
      }
    });
    const brush=make('button','ws-brush-trigger');
    brush.type='button';brush.title='Change '+name+' color';
    brush.setAttribute('aria-label','Change '+name+' color');
    brush.setAttribute('aria-haspopup','true');
    brush.setAttribute('aria-expanded','false');
    brush.append(paintIcon());
    const popover=make('div','ws-color-popover');
    popover.hidden=true;
    popover.setAttribute('role','group');
    popover.setAttribute('aria-label','Choose '+name+' color');
    const heading=make('span','ws-color-caption','ACCENT COLOR');
    const swatches=make('div','ws-color-swatches');
    for(const [color,hex] of Object.entries(COLORS)){
      const swatch=make('button','ws-color-swatch');
      swatch.type='button';swatch.style.setProperty('--swatch-color',hex);
      swatch.dataset.swatch=color;
      swatch.title=color[0].toUpperCase()+color.slice(1);
      swatch.setAttribute('aria-label','Set '+name+' to '+color);
      swatch.addEventListener('click',event=>{
        event.preventDefault();event.stopPropagation();
        if(kind==='notes'){
          const note=data.notes.find(item=>item.id===id);
          if(!note)return;
          const oldColor=note.color;
          note.color=color;
          host.style.setProperty('--ws-note-color',COLORS[color]);
          host.style.setProperty('--ws-accent',COLORS[color]);
          api('/api/workspace/notes/'+encodeURIComponent(id),
            json('PATCH',{title:note.title,body:note.body,color,pinned:note.pinned}))
            .then(response=>{data.notes=response.notes;drawNotes();})
            .catch(error=>{
              note.color=oldColor;
              host.style.setProperty('--ws-note-color',COLORS[oldColor]);
              byId('wsNoteMessage').textContent=error.message;
            });
        }else setEntry(kind,id,{color});
        closePalettes();
      });
      swatches.append(swatch);
    }
    popover.append(heading,swatches);
    brush.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const willOpen=popover.hidden;
      closePalettes();
      popover.hidden=!willOpen;
      brush.setAttribute('aria-expanded',String(willOpen));
      if(willOpen)updateSwatches();
    });
    function updateSwatches(){
      const selected=kind==='notes'?
        data.notes.find(item=>item.id===id)?.color:
        data.layout[kind].find(item=>item.id===id)?.color;
      for(const swatch of swatches.children){
        const chosen=swatch.dataset.swatch===selected;
        swatch.classList.toggle('selected',chosen);
        swatch.setAttribute('aria-pressed',String(chosen));
      }
    }
    rail.append(grip,brush,popover);
    return rail;
  }
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.ws-action-rail'))closePalettes();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')closePalettes();
  });
  function reorderFromDom(kind,container,selector){
    const ids=[...container.children].filter(node=>node.matches(selector))
      .map(node=>kind==='widgets'?node.dataset.widget:
        kind==='notes'?node.dataset.note:node.dataset.wsTab||node.dataset.wsNav);
    if(!ids.length)return;
    if(kind==='notes'){
      const lookup=new Map(data.notes.map(item=>[item.id,item]));
      data.notes=ids.filter(id=>lookup.has(id)).map(id=>lookup.get(id));
      drawNotes();persistNoteOrder();
      return;
    }
    const original=data.layout[kind];
    const lookup=new Map(original.map(item=>[item.id,item]));
    const validIds=ids.filter(id=>lookup.has(id));
    if(kind==='widgets'){
      // Hidden widgets stay in the list but visible cards can occupy any grid slot.
      const rest=original.filter(item=>!validIds.includes(item.id));
      data.layout.widgets=[...validIds.map(id=>lookup.get(id)),...rest];
    }else{
      // Keep inaccessible / hidden office-specific entries in their original slots.
      let position=0;
      const set=new Set(validIds);
      data.layout.nav=original.map(item=>set.has(item.id)?lookup.get(validIds[position++]):item);
    }
    applyLayout();renderEditor();persistLayout();
  }
  function beginPointerDrag(event,{kind,id,source,container,selector}){
    if(event.button!==undefined&&event.button!==0)return;
    if(event.isPrimary===false)return;
    event.preventDefault();
    closePalettes();
    const pointerId=event.pointerId,startX=event.clientX,startY=event.clientY;
    const containerNode=typeof container==='function'?container():container;
    if(!containerNode)return;
    let active=false,ghost=null,lastMoved=null;
    const label=kind==='notes'?data.notes.find(item=>item.id===id)?.title||'Sticky note':
      (kind==='widgets'?WIDGETS:TABS).find(pair=>pair[0]===id)?.[1]||id;
    const move=next=>{
      if(next.pointerId!==pointerId)return;
      const distance=Math.hypot(next.clientX-startX,next.clientY-startY);
      if(!active&&distance<7)return;
      if(!active){
        active=true;
        document.body.classList.add('ws-pointer-sorting');
        source.classList.add('ws-drag-source');
        ghost=make('div','ws-floating-ghost');
        ghost.append(dots(),make('span','',label));
        const accent=kind==='notes'?data.notes.find(item=>item.id===id)?.color:
          data.layout[kind].find(item=>item.id===id)?.color;
        ghost.style.setProperty('--ws-accent',COLORS[accent]||COLORS.blue);
        document.body.append(ghost);
        feedback('Move to a new position…');
      }
      next.preventDefault();
      ghost.style.left=(next.clientX+14)+'px';
      ghost.style.top=(next.clientY+14)+'px';
      const under=document.elementFromPoint(next.clientX,next.clientY);
      const candidate=under?.closest(selector);
      if(candidate&&candidate!==source&&candidate.parentElement===containerNode){
        const rect=candidate.getBoundingClientRect();
        const horizontal=kind==='widgets'||kind==='nav'&&selector==='.ws-division-shell';
        const before=horizontal
          ?(Math.abs(next.clientY-(rect.top+rect.height/2))<rect.height*.30
              ?next.clientX<rect.left+rect.width/2
              :next.clientY<rect.top+rect.height/2)
          :next.clientY<rect.top+rect.height/2;
        if(before){
          if(candidate.previousElementSibling!==source)containerNode.insertBefore(source,candidate);
        }else if(candidate.nextElementSibling!==source){
          containerNode.insertBefore(source,candidate.nextSibling);
        }
        lastMoved=candidate;
      }else if(containerNode.contains(under)){
        const items=[...containerNode.children].filter(node=>node.matches(selector)&&node!==source&&!node.hidden);
        const tail=items.at(-1);
        if(tail){
          const rect=tail.getBoundingClientRect();
          if(next.clientY>rect.bottom+12)containerNode.append(source);
        }
      }
      if(next.clientY<45)window.scrollBy(0,-16);
      if(next.clientY>window.innerHeight-45)window.scrollBy(0,16);
    };
    const end=final=>{
      if(final.pointerId!==pointerId)return;
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',end);
      window.removeEventListener('pointercancel',cancel);
      if(!active)return;
      ghost?.remove();
      source.classList.remove('ws-drag-source');
      document.body.classList.remove('ws-pointer-sorting');
      reorderFromDom(kind,containerNode,selector);
    };
    const cancel=final=>{
      if(final.pointerId!==pointerId)return;
      window.removeEventListener('pointermove',move);
      window.removeEventListener('pointerup',end);
      window.removeEventListener('pointercancel',cancel);
      ghost?.remove();source.classList.remove('ws-drag-source');
      document.body.classList.remove('ws-pointer-sorting');
      applyLayout();
    };
    window.addEventListener('pointermove',move,{passive:false});
    window.addEventListener('pointerup',end);
    window.addEventListener('pointercancel',cancel);
  }
  function mountDashboard(){
    const grid=byId('workspaceTiles');
    if(!grid)return;
    const stats=document.querySelector('.workspace-body > .stats');
    const presence=document.querySelector('.workspace-body > .live-agent-panel');
    const divisions=document.querySelector('.workspace-body > .division-grid');
    const divisionHead=divisions?.previousElementSibling;
    const support=document.querySelector('.workspace-body > .support-grid');
    const quick=support?.lastElementChild;
    const contents={
      metrics:stats?[stats]:[],presence:presence?[presence]:[],
      divisions:[divisionHead,divisions].filter(Boolean),
      quick:quick?[quick]:[]
    };
    for(const [id,label] of WIDGETS){
      const section=make('section','ws-widget');
      section.dataset.widget=id;
      const header=make('header','ws-widget-header');
      const identity=make('div','ws-widget-heading');
      identity.append(make('span','ws-widget-accent'),make('h2','',label));
      const rail=toolRail('widgets',id,label,section,grid,'.ws-widget');
      header.append(identity,rail);
      const content=make('div','ws-widget-content');
      for(const el of contents[id]||[])content.append(el);
      section.append(header,content);
      if(id==='shift')setupShift(content);
      if(id==='sticky')setupNotes(content);
      if(id==='reminders')setupReminders(content);
      data.widgets.set(id,section);
      grid.append(section);
    }
    support?.remove();
    mountNav();
    mountDivisionTabs();
    byId('workspacePersonalControls').hidden=false;
    byId('wsCustomize').addEventListener('click',()=>setLibraryOpen(!data.edit));
    byId('wsCustomizeBackdrop').addEventListener('click',()=>setLibraryOpen(false));
    window.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&data.edit){setLibraryOpen(false);event.preventDefault();}
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
      if(!id)continue;
      a.dataset.wsNav=id;
      const wrapper=make('div','ws-nav-row');
      wrapper.dataset.wsNav=id;
      wrapper.append(a);
      wrapper.append(toolRail('nav',id,a.textContent.trim(),wrapper,primary,'.ws-nav-row'));
      data.nav.set(id,wrapper);
      primary.append(wrapper);
    }
    if(secondary){
      const heading=secondary.previousElementSibling;
      if(heading?.classList.contains('sidebar-section-title'))heading.hidden=true;
      secondary.hidden=true;
    }
  }
  function mountDivisionTabs(){
    const grid=document.querySelector('.division-grid');
    if(!grid)return;
    for(const tile of [...grid.querySelectorAll(':scope > .division[data-division]')]){
      const id=tile.dataset.division;
      const wrapper=make('div','ws-division-shell');
      wrapper.dataset.wsTab=id;
      grid.replaceChild(wrapper,tile);
      wrapper.append(tile,toolRail('nav',id,tile.querySelector('h3')?.textContent||id,
        wrapper,grid,'.ws-division-shell'));
    }
  }
  function applyLayout(){
    const grid=byId('workspaceTiles');
    for(const item of data.layout.widgets){
      const widget=data.widgets.get(item.id);
      if(!widget)continue;
      widget.dataset.size=item.size;
      widget.style.setProperty('--ws-accent',COLORS[item.color]);
      widget.dataset.color=item.color;
      widget.hidden=item.hidden;
      widget.classList.toggle('ws-muted-widget',item.hidden);
      grid.append(widget);
    }
    const navHost=document.querySelector('.sidebar .nav');
    for(const item of data.layout.nav){
      const wrapper=data.nav.get(item.id);
      if(!wrapper)continue;
      const el=wrapper.querySelector('a.nav-item');
      if(!el)continue;
      const roleAllowed=!el.dataset.access||el.dataset.access.split(',').includes(data.user.role);
      const productAllowed=!(data.user.office?.workflowTemplate==='starter'&&item.id==='outbound');
      wrapper.hidden=!roleAllowed||!productAllowed||item.hidden;
      wrapper.style.setProperty('--ws-accent',COLORS[item.color]);
      el.hidden=false;
      if(el.classList.contains('active'))el.style.setProperty('--ws-active',COLORS[item.color]);
      navHost?.append(wrapper);
    }
    const tileHost=document.querySelector('.division-grid');
    if(tileHost)for(const tab of data.layout.nav){
      const tile=tileHost.querySelector('.ws-division-shell[data-ws-tab="'+tab.id+'"]');
      if(tile){
        tileHost.append(tile);
        tile.hidden=tab.hidden||!!tile.querySelector('a.division')?.hidden;
        tile.style.setProperty('--ws-accent',COLORS[tab.color]);
      }
    }
  }

  const WIDGET_DETAILS={
    divisions:{icon:'◫',description:'Your available routes, dashboards and role-based tools.'},
    metrics:{icon:'▥',description:'Case totals and quality-control overview at a glance.'},
    presence:{icon:'◉',description:'See active colleagues and their current workflow.'},
    quick:{icon:'↗',description:'Fast access to your next route and commonly used actions.'},
    reminders:{icon:'◷',description:'Track follow-ups, due dates and completed tasks.'},
    sticky:{icon:'▤',description:'Keep color-coded notes saved to your employee account.'},
    shift:{icon:'◴',description:'Clock in and switch between the five shift statuses.'}
  };
  function setLibraryOpen(open){
    data.edit=!!open;
    const drawer=byId('wsCustomizePanel'),backdrop=byId('wsCustomizeBackdrop');
    drawer.hidden=!open;
    backdrop.hidden=!open;
    byId('wsCustomize').setAttribute('aria-expanded',String(open));
    document.body.classList.toggle('ws-library-open',open);
    if(open){renderEditor();drawer.focus();}
    else{closePalettes();byId('wsCustomize').focus();}
  }
  function addWidget(id){
    const index=data.layout.widgets.findIndex(x=>x.id===id);
    if(index<0||id==='divisions')return;
    const [item]=data.layout.widgets.splice(index,1);
    data.layout.widgets.push({...item,hidden:false});
    applyLayout();
    const widget=data.widgets.get(id);
    if(widget){
      widget.classList.remove('ws-widget-enter');
      void widget.offsetWidth;
      widget.classList.add('ws-widget-enter');
    }
    persistLayout();renderEditor();
    feedback(WIDGETS.find(pair=>pair[0]===id)?.[1]+' added ✓');
  }
  function removeWidget(id){
    if(id==='divisions')return;
    setEntry('widgets',id,{hidden:true});
  }
  function renderEditor(){
    const host=byId('wsCustomizePanel');
    if(!host||!data.edit)return;
    const lastScroll=host.scrollTop;
    host.replaceChildren();
    const top=make('div','ws-library-top');
    const heading=make('div','ws-library-title');
    heading.append(make('span','ws-library-eyebrow','PERSONAL WORKSPACE'),
      make('h2','', 'Custom Layout'),
      make('p','', 'Create your own desk. Add only the blocks you need. Your changes are saved automatically.'));
    top.append(heading,button('×','ws-library-close',()=>setLibraryOpen(false),'Close custom layout'));
    host.append(top);
    const pinned=make('div','ws-library-featured');
    pinned.append(make('span','ws-library-featured-icon','◫'));
    const pinnedText=make('div','');
    pinnedText.append(make('strong','', 'Workspace Tabs'),
      make('small','', 'Always visible · Your workspace foundation'));
    pinned.append(pinnedText,make('span','ws-library-installed','ACTIVE'));
    host.append(pinned);
    const addTitle=make('div','ws-library-section-title');
    const available=data.layout.widgets.filter(item=>item.id!=='divisions'&&item.hidden);
    addTitle.append(make('h3','', 'Add to your workspace'),
      make('span','',available.length+' available'));
    host.append(addTitle);
    const catalog=make('div','ws-widget-catalog');
    if(available.length===0){
      catalog.append(make('p','ws-library-empty','All available blocks have been added. You can remove any below.'));
    }
    for(const item of available){
      const details=WIDGET_DETAILS[item.id];
      const card=make('article','ws-catalog-item');
      const icon=make('span','ws-catalog-icon',details.icon);
      icon.style.setProperty('--ws-accent',COLORS[item.color]);
      const copy=make('div','ws-catalog-text');
      copy.append(make('strong','',WIDGETS.find(x=>x[0]===item.id)?.[1]||item.id),
        make('p','',details.description));
      const add=button('+ Add','ws-catalog-add',()=>addWidget(item.id),'Add '+item.id+' block');
      card.append(icon,copy,add);catalog.append(card);
    }
    host.append(catalog);
    const activeTitle=make('div','ws-library-section-title ws-library-active-title');
    const active=data.layout.widgets.filter(item=>!item.hidden);
    activeTitle.append(make('h3','', 'Your active blocks'),
      make('span','',active.length+' in layout'));
    host.append(activeTitle);
    const installed=make('div','ws-library-installed-list');
    for(const item of active){
      const id=item.id,label=WIDGETS.find(pair=>pair[0]===id)?.[1]||id;
      const row=make('div','ws-library-installed-row');
      const mark=make('span','ws-library-mini-mark',WIDGET_DETAILS[id].icon);
      mark.style.setProperty('--ws-accent',COLORS[item.color]);
      const info=make('div','ws-library-installed-info');
      info.append(make('strong','',label));
      if(id==='divisions'){
        info.append(make('small','','Required block'));
      }else info.append(make('small','','Drag the nine dots on the dashboard to reorder'));
      const controls=make('div','ws-library-installed-controls');
      controls.append(optionSelect(SIZES,item.size,
        value=>setEntry('widgets',id,{size:value}),label+' block size'));
      if(id!=='divisions'){
        controls.append(button('Remove','ws-library-remove',
          ()=>removeWidget(id),'Remove '+label+' from dashboard'));
      }
      row.append(mark,info,controls);installed.append(row);
    }
    host.append(installed);
    const foot=make('div','ws-library-footer');
    foot.append(make('p','', 'Use each card’s nine-dot grip to drag it, or its brush to choose a gradient. Colors, layout and block sizes stay saved for your next shift.'));
    foot.append(button('Reset to Workspace Tabs only','ws-library-reset',()=>{
      if(!confirm('Reset your workspace to only Workspace Tabs? Your saved notes, reminders, shift records and office access will not be deleted.'))return;
      data.layout=defaultLayout();
      applyLayout();renderEditor();persistLayout();
    }));
    host.append(foot);
    host.scrollTop=lastScroll;
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
      card.dataset.note=note.id;
      card.style.setProperty('--ws-note-color',COLORS[note.color]||COLORS.blue);
      card.style.setProperty('--ws-accent',COLORS[note.color]||COLORS.blue);
      card.append(toolRail('notes',note.id,note.title,card,list,'.ws-note-card'));
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
