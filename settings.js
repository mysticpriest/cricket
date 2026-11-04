'use strict';
// Server-persisted personal appearance. One random color is assigned to each account;
// no preference is stored in shared localStorage or derived from an email address.
(() => {
  const PALETTE = {
    ocean:  {name:'Ocean',  accent:'#0759a6',dark:'#084a88',soft:'#e9f3ff',canvas:'#f4f9ff',border:'#beddfb'},
    violet: {name:'Violet', accent:'#7137b6',dark:'#5e239e',soft:'#f5edff',canvas:'#faf7ff',border:'#e0c7fa'},
    emerald:{name:'Emerald',accent:'#147a58',dark:'#0f6247',soft:'#e9f8f0',canvas:'#f3fbf7',border:'#bde9d2'},
    rose:   {name:'Rose',   accent:'#b91b65',dark:'#9b1755',soft:'#fff0f6',canvas:'#fff7fa',border:'#f8c7dd'},
    amber:  {name:'Amber',  accent:'#976213',dark:'#754a0e',soft:'#fff5dc',canvas:'#fffbf3',border:'#f5dca2'},
    teal:   {name:'Teal',   accent:'#08777a',dark:'#075c60',soft:'#e9f8f8',canvas:'#f4fbfb',border:'#b6e5e5'},
    indigo: {name:'Indigo', accent:'#3944a8',dark:'#303a86',soft:'#edf0ff',canvas:'#f7f8ff',border:'#c9cefc'},
    coral:  {name:'Coral',  accent:'#b74630',dark:'#923722',soft:'#fff0eb',canvas:'#fff8f5',border:'#f8ccb9'}
  };
  const DEFAULT={color:'ocean',mode:'personal',density:'comfortable',textSize:'standard',reduceMotion:false};
  let prefs={...DEFAULT};
  let account=null;
  let saveChain=Promise.resolve();
  let saved={...DEFAULT};
  let launcher=null,drawer=null,backdrop=null,previousFocus=null,status=null,refreshUi=null;
  const el=(tag,klass,txt)=>{
    const node=document.createElement(tag);
    if(klass)node.className=klass;
    if(txt!==undefined)node.textContent=String(txt);
    return node;
  };
  function validated(value) {
    if(!value||typeof value!=='object')return {...DEFAULT};
    return {
      color:Object.hasOwn(PALETTE,value.color)?value.color:DEFAULT.color,
      mode:['personal','legacy'].includes(value.mode)?value.mode:DEFAULT.mode,
      density:['comfortable','compact'].includes(value.density)?value.density:DEFAULT.density,
      textSize:['standard','large','extra-large'].includes(value.textSize)?value.textSize:DEFAULT.textSize,
      reduceMotion:value.reduceMotion===true
    };
  }
  function apply() {
    const root=document.documentElement;
    const palette=PALETTE[prefs.color]||PALETTE.ocean;
    const isPersonal=prefs.mode==='personal';
    const c=isPersonal?palette:PALETTE.ocean;
    const a=isPersonal?palette.accent:'#2563eb';
    const d=isPersonal?palette.dark:'#1d4ed8';
    const soft=isPersonal?palette.soft:'#eff6ff';
    const border=isPersonal?palette.border:'#bfdbfe';
    const canvas=isPersonal?palette.canvas:'#f5f8fc';
    root.dataset.cricketTheme=prefs.mode;
    root.dataset.cricketDensity=prefs.density;
    root.dataset.cricketTextSize=prefs.textSize;
    root.dataset.cricketMotion=prefs.reduceMotion?'reduce':'standard';
    root.style.setProperty('--cricket-accent',a);
    root.style.setProperty('--cricket-accent-dark',d);
    root.style.setProperty('--cricket-accent-soft',soft);
    root.style.setProperty('--cricket-accent-border',border);
    root.style.setProperty('--cricket-canvas',canvas);
    root.style.setProperty('--cricket-preview-accent',palette.accent);
    root.style.setProperty('--cricket-preview-soft',palette.soft);
    root.style.setProperty('--cricket-accent-light',c.accent);
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=canvas;
    window.dispatchEvent(new CustomEvent('cricket-theme-updated',{detail:{...prefs}}));
  }
  function feedback(message,error=false) {
    if(!status)return;
    status.textContent=message;
    status.classList.toggle('error',error);
  }
  function update(change) {
    prefs=validated({...prefs,...change});
    apply();
    if(refreshUi)refreshUi();
    feedback('Saving your settings…');
    const snapshot={...prefs};
    saveChain=saveChain.catch(()=>{}).then(async()=>{
      const response=await fetch('/api/preferences',{
        method:'PATCH',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(snapshot)
      });
      let data={};
      try{data=await response.json();}catch(_){}
      if(response.status===401){window.CricketSession?.expire('idle');throw Error('Your session expired.');}
      if(!response.ok)throw Error(data.error||'Could not save settings.');
      saved=validated(data.preferences);
      if(JSON.stringify(snapshot)===JSON.stringify(prefs))feedback('✓ Saved to your employee account');
    }).catch(error=>{
      if(JSON.stringify(snapshot)===JSON.stringify(prefs)){
        feedback(error.message+' Change a setting to retry.',true);
      }
    });
  }
  function makeButton(label,klass,onClick) {
    const button=el('button',klass,label);
    button.type='button';
    button.addEventListener('click',onClick);
    return button;
  }
  function selectButton(label,klass,onClick) {
    const button=makeButton(label,klass,onClick);
    button.setAttribute('aria-pressed','false');
    return button;
  }
  function makeSection(title,description) {
    const section=el('section','cricket-settings-section');
    section.append(el('h3','',title),el('p','',description));
    return section;
  }
  function close() {
    if(!drawer||drawer.hidden)return;
    drawer.hidden=true;
    backdrop.hidden=true;
    document.body.classList.remove('cricket-settings-open');
    launcher?.setAttribute('aria-expanded','false');
    (previousFocus&&previousFocus.isConnected?previousFocus:launcher)?.focus();
  }
  function open() {
    if(!drawer)return;
    previousFocus=document.activeElement;
    drawer.hidden=false;
    backdrop.hidden=false;
    document.body.classList.add('cricket-settings-open');
    launcher.setAttribute('aria-expanded','true');
    drawer.querySelector('.cricket-settings-dismiss')?.focus();
  }
  function build() {
    const header=document.querySelector('header.topbar,header.qc-topbar,header.an-topbar,header.simple-topbar,header.operations-topbar');
    if(!header)return;
    const target=header.querySelector('.topbar-actions,.topbar-right,.operations-top-actions')||header;
    launcher=makeButton('Settings','cricket-settings-launcher',()=>{
      if(drawer.hidden)open();else close();
    });
    launcher.setAttribute('aria-label','Open appearance settings');
    launcher.setAttribute('aria-haspopup','dialog');
    launcher.setAttribute('aria-expanded','false');
    const gear=document.createElementNS('http://www.w3.org/2000/svg','svg');
    gear.setAttribute('viewBox','0 0 24 24');gear.setAttribute('aria-hidden','true');
    for(const [type,attrs] of [
      ['path',{d:'M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z'}],
      ['path',{d:'M19.5 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1-1.6 2.8-.2-.1a1.5 1.5 0 0 0-1.7-.2 8 8 0 0 1-1.3.7 1.5 1.5 0 0 0-1 1.3V21h-3.3v-.2a1.5 1.5 0 0 0-1-1.3 8 8 0 0 1-1.3-.7 1.5 1.5 0 0 0-1.7.2l-.2.1-1.6-2.8.1-.1a1.5 1.5 0 0 0 .3-1.7 8 8 0 0 1 0-1.5 1.5 1.5 0 0 0-.3-1.7l-.1-.1 1.6-2.8.2.1a1.5 1.5 0 0 0 1.7.2 8 8 0 0 1 1.3-.7 1.5 1.5 0 0 0 1-1.3V6h3.3v.2a1.5 1.5 0 0 0 1 1.3 8 8 0 0 1 1.3.7 1.5 1.5 0 0 0 1.7-.2l.2-.1 1.6 2.8-.1.1a1.5 1.5 0 0 0-.3 1.7 8 8 0 0 1 0 1.5Z'}]
    ]){
      const node=document.createElementNS('http://www.w3.org/2000/svg',type);
      for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);
      gear.append(node);
    }
    launcher.prepend(gear);
    target.insertBefore(launcher,target.querySelector('#logoutButton')||null);

    backdrop=el('div','cricket-settings-overlay');backdrop.hidden=true;
    backdrop.addEventListener('click',close);
    drawer=el('aside','cricket-settings-drawer');drawer.hidden=true;
    drawer.setAttribute('role','dialog');
    drawer.setAttribute('aria-modal','true');
    drawer.setAttribute('aria-labelledby','cricketSettingsTitle');
    const head=el('div','cricket-settings-head');
    const titleBlock=el('div');
    titleBlock.append(el('span','cricket-settings-eyebrow','PERSONAL WORKSPACE'));
    const h2=el('h2','','Settings');h2.id='cricketSettingsTitle';
    titleBlock.append(h2);
    const dismiss=makeButton('×','cricket-settings-dismiss',close);
    dismiss.setAttribute('aria-label','Close settings');
    head.append(titleBlock,dismiss);
    const scroll=el('div','cricket-settings-scroll');
    const accountRow=el('div','cricket-settings-account');
    const name=account.displayName||account.email||'Employee';
    accountRow.append(el('div','cricket-settings-avatar',name.slice(0,1).toUpperCase()));
    const who=el('div');
    who.append(el('strong','',name),el('small','',account.email+' · '+account.role.toUpperCase()));
    accountRow.append(who);scroll.append(accountRow);

    const appearance=makeSection('Appearance','Choose your assigned accent color or return to Cricket’s classic white, blue and black interface.');
    const modes=el('div','cricket-settings-mode-grid');
    const modeBtns={};
    for(const [mode,label,desc] of [
      ['personal','My color','A colorful workspace, just for you'],
      ['legacy','Original Cricket','The classic blue/white/black look']
    ]){
      const button=selectButton('','cricket-settings-mode',()=>update({mode}));
      const preview=el('div','cricket-settings-preview '+(mode==='legacy'?'legacy':'personal'));
      preview.append(el('i'),el('i'));
      button.append(preview,el('strong','',label),el('small','',desc));
      modeBtns[mode]=button;modes.append(button);
    }
    appearance.append(modes);
    scroll.append(appearance);

    const colorSection=makeSection('Your color','One randomly assigned color follows your employee account. Pick a different one whenever you want.');
    const swatches=el('div','cricket-settings-swatches');
    const colorBtns={};
    for(const [key,palette] of Object.entries(PALETTE)){
      const button=selectButton('','cricket-settings-swatch',()=>update({color:key,mode:'personal'}));
      button.setAttribute('aria-label','Switch to '+palette.name+' color');
      const dot=el('span');dot.style.background=palette.accent;
      button.append(dot,el('small','',palette.name));
      colorBtns[key]=button;
      swatches.append(button);
    }
    colorSection.append(swatches);
    const tools=el('div','cricket-settings-toolbar');
    const surprise=makeButton('↻ Surprise me','cricket-settings-surprise',()=>{
      const colors=Object.keys(PALETTE).filter(color=>color!==prefs.color);
      update({color:colors[Math.floor(Math.random()*colors.length)],mode:'personal'});
    });
    tools.append(surprise,el('small','', 'Your choice is saved across devices'));
    colorSection.append(tools);scroll.append(colorSection);

    const densitySection=makeSection('Layout density','Choose between roomy panels and a more compact workspace.');
    const densityBtns={};
    const densityChoices=el('div','cricket-settings-options');
    for(const [value,label] of [['comfortable','Comfortable'],['compact','Compact']]){
      const button=selectButton(label,'cricket-settings-option',()=>update({density:value}));
      densityBtns[value]=button;densityChoices.append(button);
    }
    densitySection.append(densityChoices);scroll.append(densitySection);

    const textSection=makeSection('Text size','Increase the interface size for more comfortable reading.');
    const sizeBtns={};
    const sizeChoices=el('div','cricket-settings-options');
    for(const [value,label] of [['standard','Standard'],['large','Large'],['extra-large','Extra large']]){
      const button=selectButton(label,'cricket-settings-option',()=>update({textSize:value}));
      sizeBtns[value]=button;sizeChoices.append(button);
    }
    textSection.append(sizeChoices);scroll.append(textSection);

    const motionSection=makeSection('Motion & accessibility','Reduce animations, transitions and animated graphs when preferred.');
    const toggle=selectButton('','cricket-settings-toggle',()=>update({reduceMotion:!prefs.reduceMotion}));
    const motionLabel=el('span');
    motionLabel.append(el('strong','','Reduce motion'),el('small','','Minimal animation across Cricket'));
    toggle.append(motionLabel,el('span','cricket-settings-switch'));
    motionSection.append(toggle);
    scroll.append(motionSection);

    const reset=makeButton('Reset display preferences','cricket-settings-reset',()=>{
      update({mode:'personal',density:'comfortable',textSize:'standard',reduceMotion:false});
    });
    scroll.append(reset);
    const footer=el('div','cricket-settings-footer');
    status=el('span','cricket-settings-save-status','Your choices save to your account');
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    const done=makeButton('Done','cricket-settings-done',close);
    footer.append(status,done);
    drawer.append(head,scroll,footer);
    document.body.append(backdrop,drawer);

    refreshUi=()=>{
      for(const [key,button] of Object.entries(modeBtns)){
        button.classList.toggle('active',prefs.mode===key);
        button.setAttribute('aria-pressed',String(prefs.mode===key));
      }
      for(const [key,button] of Object.entries(colorBtns)){
        const active=prefs.color===key;
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      }
      for(const [key,button] of Object.entries(densityBtns)){
        button.classList.toggle('active',prefs.density===key);
        button.setAttribute('aria-pressed',String(prefs.density===key));
      }
      for(const [key,button] of Object.entries(sizeBtns)){
        button.classList.toggle('active',prefs.textSize===key);
        button.setAttribute('aria-pressed',String(prefs.textSize===key));
      }
      toggle.setAttribute('aria-pressed',String(prefs.reduceMotion));
    };
    refreshUi();

    drawer.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Tab')return;
      const focusable=Array.from(drawer.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])'));
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
  }
  window.CricketAppearance={get:()=>({...prefs}),colors:Object.keys(PALETTE)};
  async function initialize() {
    try{
      const response=await fetch('/api/auth/me',{credentials:'same-origin'});
      if(!response.ok)return;
      const data=await response.json();
      if(!data.user||!data.user.preferences)return;
      account=data.user;
      prefs=validated(data.user.preferences);
      saved={...prefs};
      apply();
      build();
    }catch(_){ /* Server/client routing already handles unreachable sessions. */ }
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else void initialize();
})();
