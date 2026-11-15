'use strict';
/*
 * Cricket public interactive showcase.
 * Everything here is fictitious and calculated in memory.
 * No backend/API requests, login, recording, notification or storage.
 */
(()=>{
 const profiles=Object.freeze({
  bpo:{
   name:'Northstar CX',industry:'Customer operations',label:'Interaction',
   welcome:'A clear view of your customer operations.',
   metric:'Interactions handled',total:184,quality:94,staff:38,
   tasks:['Verify the fictional account reference','Confirm the customer request','Follow the approved resolution path','Document the outcome'],
   routes:[
    {name:'Order status inquiry',steps:['Verify a fictional order reference','Check the approved status', 'Explain the next update','Document the outcome']},
    {name:'Refund request',steps:['Verify a fictional order reference','Review the refund policy','Explain eligibility without promising approval','Document the next step']},
    {name:'Billing question',steps:['Confirm the fictional account','Clarify the invoice question','Check approved billing guidance','Document the resolution']}
   ],activity:['New contact routed to Inbound','Quality evaluation completed','Outbound follow-up documented'],workflowLabel:'Customer support workflow',
   refLabel:'Fictional reference',refPlaceholder:'ORDER-DEMO-1042',color:'#1769ad'
  },
  health:{
   name:'Harbor Health',industry:'Clinic administration',label:'Request',
   welcome:'Administrative requests, coordinated.',
   metric:'Scheduling requests',total:126,quality:96,staff:21,
   tasks:['Verify appointment request category','Locate the fictional scheduling queue','Provide an administrative next step','Document an anonymized outcome'],
   routes:[
    {name:'Appointment scheduling inquiry',steps:['Select the scheduling inquiry type','Check the fictional availability list','Provide administrative next steps','Document without patient data']},
    {name:'Appointment link support',steps:['Confirm the support issue category','Check the approved help instructions','Explain how to join the appointment','Document the outcome anonymously']},
    {name:'Clinic information inquiry',steps:['Identify the requested service','Review published general information','Explain office contact options','Document the result']}
   ],activity:['Scheduling queue updated','Administrative workflow completed','Staff coordination task created'],workflowLabel:'Scheduling administration',
   refLabel:'Anonymous demo ticket',refPlaceholder:'DEMO-TICKET-204',color:'#197d88'
  },
  agency:{
   name:'Fable Studio',industry:'Marketing operations',label:'Task',
   welcome:'Campaign work, without the chaos.',
   metric:'Campaign tasks',total:73,quality:91,staff:14,
   tasks:['Identify the fictional client project','Check the creative brief','Follow the campaign approval path','Document the next action'],
   routes:[
    {name:'Creative review',steps:['Open the fictional campaign brief','Review creative requirements','Request necessary changes','Document client approval state']},
    {name:'Client onboarding',steps:['Select the fictional client package','Confirm project deliverables','Assign an internal owner','Document the kickoff action']},
    {name:'Campaign launch check',steps:['Verify campaign readiness','Review channel requirements','Request stakeholder sign-off','Document the launch decision']}
   ],activity:['Campaign concept approved','Creative review marked complete','Team task assigned'],workflowLabel:'Campaign workflow',
   refLabel:'Fictional project code',refPlaceholder:'CAMPAIGN-DEMO-08',color:'#7055a4'
  }
 });
 const moduleCatalog=[
  {id:'workflow_builder',name:'Workflow Builder',desc:'Guided tasks, intake and outbound processes',price:400},
  {id:'quality_control',name:'Quality Control',desc:'Reviews, scorecards and coaching',price:300},
  {id:'communications',name:'Cricket Connect',desc:'Office chat, voice and video (real app preview)',price:250},
  {id:'staff_accounts',name:'Staff Accounts',desc:'Individual employee licenses',price:100,perSeat:true}
 ];
 const DEFAULT_ENABLED={workflow_builder:true,quality_control:true,communications:false,staff_accounts:true};
 const contactNames=['Alex Rivera','Morgan Hale','Casey Patel'];
 let state;
 const $=id=>document.getElementById(id);
 const clean=(v,max=200)=>String(v??'').slice(0,max);
 const esc=s=>clean(s,3000).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const html=(s)=>s;
 const prof=()=>profiles[state.industry];
 function createState(industry='bpo'){
  return {industry,view:'overview',title:null,workflow:0,steps:null,finished:0,lastNote:'',
   qc:{verification:90,accuracy:95,documentation:92,empathy:88},lastScore:null,
   seats:8,enabled:{...DEFAULT_ENABLED},selectedContact:0,
   messages:contactNames.map((_,i)=>[
    {mine:false,body:['Morning! Are we aligned on the support queue?','Can you review the latest fictional workflow?','I have a demo update ready for the team.'][i],time:'09:41'}
   ]),brand:profiles[industry].name,accent:profiles[industry].color,
   audit:['Demo organization initialized','Module preferences loaded (simulation)'],notice:''};
 }
 function setStateIndustry(industry){
  if(!profiles[industry])return;
  state=createState(industry);$('industrySelect').value=industry;
  updateAccent();navigate('overview');
 }
 function updateAccent(){document.documentElement.style.setProperty('--blue',state.accent);}
 function money(value){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);}
 function total(){
  return moduleCatalog.reduce((n,m)=>n+(state.enabled[m.id]?(m.perSeat?m.price*state.seats:m.price):0),0);
 }
 function notification(msg){
  state.notice=msg;
  const host=$('demoNotice');
  if(host){host.textContent=msg;host.hidden=false;}
 }
 function navEvents(){
  $('demoNav').addEventListener('click',e=>{
   const el=e.target.closest('button[data-view]');
   if(el)navigate(el.dataset.view);
  });
  $('industrySelect').addEventListener('change',e=>setStateIndustry(e.target.value));
  document.querySelectorAll('[data-industry]').forEach(el=>{
   el.addEventListener('click',()=>{
    setStateIndustry(el.dataset.industry);
    $('preview').scrollIntoView({behavior:'smooth',block:'start'});
   });
  });
  document.querySelectorAll('[data-jump-view]').forEach(el=>{
   el.addEventListener('click',()=>navigate(el.dataset.jumpView));
  });
  $('resetDemo').addEventListener('click',()=>{
   const industry=state.industry;setStateIndustry(industry);
   notification('Demo reset. All temporary changes have been cleared.');
  });
 }
 function navigate(view){
  const views=['overview','workflows','quality','connect','marketplace','admin'];
  if(!views.includes(view))return;
  state.view=view;
  $('demoNav').querySelectorAll('[data-view]').forEach(el=>{
   const active=el.dataset.view===view;
   el.classList.toggle('active',active);
   if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  const titles={overview:'Overview',workflows:'Workflow Builder',quality:'Quality Control',
    connect:'Cricket Connect',marketplace:'Subscriptions',admin:'Administration'};
  $('demoBreadcrumb').textContent='Workspace / '+titles[view];
  const renders={overview,workflows,quality,connect,marketplace,admin};
  const pane=$('demoPane');
  pane.innerHTML=renders[view]();
  const alert=document.createElement('div');
  alert.id='demoNotice';alert.className='inline-status';alert.hidden=!state.notice;
  alert.textContent=state.notice;
  pane.append(alert);state.notice='';
  const wire={overview:wireOverview,workflows:wireWorkflows,quality:wireQuality,
    connect:wireConnect,marketplace:wireMarketplace,admin:wireAdmin};
  wire[view]();
 }
 function section(title,lead,button=''){
  return '<div class="pane-title"><div><h2>'+esc(title)+'</h2><p class="lede">'+esc(lead)+'</p></div>'+button+'</div>';
 }
 function overview(){
  const p=prof();
  const bars=[48,62,55,79,69,89,77].map((h,i)=>'<div><span style="height:'+Math.min(100,h+state.finished*3)+'%"></span></div>').join('');
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<span>'+x+'</span>').join('');
  return section('Welcome to '+state.brand+'.',p.welcome+' This workspace changes with your business.',
   '<button class="pane-action" id="goFlow">Run a sample workflow →</button>')+
   '<div class="data-grid"><article class="metric"><span>'+esc(p.metric)+'</span><strong>'+(p.total+state.finished)+'</strong><small>Fictional activity</small></article>'+
   '<article class="metric"><span>Quality score</span><strong>'+esc(state.lastScore??p.quality)+'%</strong><small>Illustrative evaluation</small></article>'+
   '<article class="metric"><span>Team members</span><strong>'+p.staff+'</strong><small>Demo organization</small></article></div>'+
   '<div class="overview-columns"><section class="panel"><div class="panel-head"><h3>Activity overview</h3><small>Example week</small></div>'+
   '<div class="bar-chart" aria-label="Illustrative bar chart">'+bars+'</div><div class="chart-labels">'+days+'</div></section>'+
   '<section class="panel"><div class="panel-head"><h3>Recent activity</h3><span class="pill blue">Simulated</span></div><ul class="activity">'+
   [...(state.finished?['Sample route completed']:[]),...p.activity].slice(0,4)
    .map((x,i)=>'<li><span class="activity-icon">'+['◇','◎','✉','▦'][i%4]+'</span><div><strong>'+esc(x)+'</strong><p>Illustrative workspace activity · '+(i+1)*7+' min ago</p></div></li>').join('')+
   '</ul></section></div>';
 }
 function wireOverview(){$('goFlow').addEventListener('click',()=>navigate('workflows'));}
 function route(){return prof().routes[state.workflow]||prof().routes[0];}
 function currentSteps(){return state.steps||route().steps;}
 function workflows(){
  const p=prof(),steps=currentSteps();
  const options=p.routes.map((r,i)=>'<option value="'+i+'" '+(state.workflow===i?'selected':'')+'>'+esc(r.name)+'</option>').join('');
  const list=steps.map((x,i)=>'<li><span class="step-count">'+(i+1)+'</span><span>'+esc(x)+'</span><button type="button" data-remove-step="'+i+'" aria-label="Remove step '+(i+1)+'">×</button></li>').join('');
  return section(p.workflowLabel,'Build and run an illustrative workflow. No customer records are created.')+
   '<div class="workflow-layout"><section class="panel"><div class="panel-head"><h3>Workflow editor</h3><span class="pill blue">Editable in demo</span></div>'+
   '<div class="field"><label for="wfTemplate">Starter template</label><select id="wfTemplate">'+options+'</select></div>'+
   '<ol class="step-list" id="wfSteps">'+list+'</ol>'+
   '<div class="field" style="margin-top:20px"><label for="wfNewStep">Add a custom step</label>'+
   '<div style="display:flex;gap:9px"><input id="wfNewStep" maxlength="120" placeholder="Describe the next action"><button class="pane-action" id="wfAdd" type="button">Add</button></div></div>'+
   '<p class="muted">Steps are editable in this browser session only.</p></section>'+
   '<section class="panel"><div class="panel-head"><h3>Run the workflow</h3><span class="pill gray">Safe sandbox</span></div>'+
   '<form id="wfRun"><div class="field"><label for="wfRef">'+esc(p.refLabel)+'</label><input id="wfRef" maxlength="50" placeholder="'+esc(p.refPlaceholder)+'" required></div>'+
   '<div class="field"><label for="wfOutcome">Outcome</label><select id="wfOutcome"><option>Resolved</option><option>Follow-up required</option><option>Escalated</option></select></div>'+
   '<button class="pane-action strong" type="submit">Complete sample route</button></form>'+
   '<h3 style="margin:26px 0 11px">Generated note</h3>'+
   '<div class="result-box" id="wfResult">'+esc(state.lastNote)+'</div>'+
   '<button class="pane-action" type="button" id="wfCopy" style="margin-top:12px" '+(state.lastNote?'':'disabled')+'>Copy documentation</button>'+
   '</section></div>';
 }
 function wireWorkflows(){
  $('wfTemplate').addEventListener('change',e=>{state.workflow=Number(e.target.value);state.steps=null;state.lastNote='';navigate('workflows');});
  $('wfAdd').addEventListener('click',()=>{
   const value=$('wfNewStep').value.trim();
   if(!value)return notification('Enter a step description first.');
   const steps=[...currentSteps()];
   if(steps.length>=12)return notification('The demo supports up to 12 steps.');
   steps.push(clean(value,120));state.steps=steps;navigate('workflows');
  });
  $('wfSteps').addEventListener('click',e=>{
   const el=e.target.closest('button[data-remove-step]');
   if(!el)return;
   if(currentSteps().length<=1)return notification('A workflow requires at least one step.');
   const steps=[...currentSteps()];
   steps.splice(Number(el.dataset.removeStep),1);
   state.steps=steps;navigate('workflows');
  });
  $('wfRun').addEventListener('submit',e=>{
   e.preventDefault();const ref=$('wfRef').value.trim(),outcome=$('wfOutcome').value;
   if(!ref)return;
   state.lastNote='Demo '+prof().label.toLowerCase()+' '+ref+': '+route().name+'. '+
    currentSteps().length+' guided steps reviewed; outcome: '+outcome+'. Fictional training record only.';
   state.finished++;
   state.audit.unshift('Completed simulated workflow '+route().name);
   navigate('workflows');notification('Workflow completed — note generated in memory only.');
  });
  $('wfCopy').addEventListener('click',async()=>{
   if(!state.lastNote)return;
   try{await navigator.clipboard.writeText(state.lastNote);notification('Sample note copied.');}
   catch(_){notification('Clipboard unavailable in this browser. Select the note text to copy.');}
  });
 }
 function averageScore(){
  const vals=Object.values(state.qc);
  return Math.round(vals.reduce((sum,n)=>sum+n,0)/vals.length);
 }
 function quality(){
  const fields=[['verification','Process compliance'],['accuracy','Accuracy'],['documentation','Documentation'],['empathy','Communication']];
  const score=averageScore();
  return section('Quality Control','Review a fictional case and see how the scorecard updates as you evaluate each criterion.')+
   '<div class="score-layout"><section class="panel"><div class="panel-head"><h3>Sample evaluation</h3><span class="pill gray">TRAINING ONLY</span></div>'+
   '<p class="muted" style="margin-bottom:18px">Case DEMO-QC-014 · Jordan Demo · '+esc(prof().industry)+'</p><div class="criteria">'+
   fields.map(([key,label])=>'<div class="criterion"><div class="criterion-header"><strong>'+esc(label)+'</strong><output id="out_'+key+'">'+state.qc[key]+' / 100</output></div>'+
    '<input type="range" min="0" max="100" step="5" value="'+state.qc[key]+'" data-score="'+key+'" aria-label="'+esc(label)+' score"></div>').join('')+
   '</div><button type="button" id="qcSave" class="pane-action strong" style="margin-top:22px">Complete sample review</button></section>'+
   '<section class="panel"><div class="panel-head"><h3>Overall quality score</h3><span class="pill blue">Real-time calculation</span></div>'+
   '<div class="score-display"><strong id="overallScore">'+score+'%</strong><small>Average of four criteria</small></div>'+
   '<div class="score-track"><div id="scoreProgress" style="width:'+score+'%"></div></div>'+
   '<p class="muted">Modify the sliders to experience a live scorecard. The result stays in this demo only.</p>'+
   '<div class="result-box" style="margin-top:27px">'+
    (state.lastScore==null?'No completed review yet. Select a score and choose “Complete sample review”.':
     'Sample evaluation saved locally in memory. Current illustrative quality score: '+state.lastScore+'%.')+
   '</div></section></div>';
 }
 function wireQuality(){
  document.querySelectorAll('[data-score]').forEach(range=>range.addEventListener('input',()=>{
   const k=range.dataset.score;state.qc[k]=Number(range.value);
   $('out_'+k).textContent=state.qc[k]+' / 100';
   $('overallScore').textContent=averageScore()+'%';
   $('scoreProgress').style.width=averageScore()+'%';
  }));
  $('qcSave').addEventListener('click',()=>{
   state.lastScore=averageScore();
   state.audit.unshift('Sample QC review completed: '+state.lastScore+'%');
   navigate('quality');notification('Training scorecard updated (not stored).');
  });
 }
 function connect(){
  const colleague=contactNames[state.selectedContact],chat=state.messages[state.selectedContact];
  return section('Cricket Connect','Explore an illustrative conversation. Real-time messaging, camera and calls require the authenticated Cricket app.')+
   '<div class="connect-preview"><aside class="chat-contacts"><h3>COLLEAGUES</h3>'+
   contactNames.map((n,i)=>'<button type="button" data-contact="'+i+'" class="'+(state.selectedContact===i?'active':'')+'"><span class="contact-avatar">'+esc(n.split(' ').map(w=>w[0]).join(''))+'</span>'+esc(n)+'</button>').join('')+
   '</aside><div class="chat-box"><div class="chat-top"><div><strong>'+esc(colleague)+'</strong><br><small>Simulated direct message</small></div>'+
   '<div class="chat-actions"><button type="button" data-demo-call="voice">☎ Voice</button><button type="button" data-demo-call="video">▣ Video</button></div></div>'+
   '<div class="chat-history" id="chatHistory" aria-label="Demo conversation">'+chat.map(m=>'<div class="chat-bubble'+(m.mine?' mine':'')+'">'+esc(m.body)+'<small>'+esc(m.time)+' · Fictional</small></div>').join('')+'</div>'+
   '<form class="chat-compose" id="chatCompose"><input id="chatInput" maxlength="280" aria-label="Write a simulated message" placeholder="Type an example message…" required><button type="submit">Send →</button></form></div></div>'+
   '<p class="muted" id="callNotice" style="margin-top:16px">No real employee is contacted in this public demo. This preview does not access your microphone, camera or screen.</p>';
 }
 function wireConnect(){
  document.querySelectorAll('[data-contact]').forEach(b=>b.addEventListener('click',()=>{
   state.selectedContact=Number(b.dataset.contact);navigate('connect');
  }));
  document.querySelectorAll('[data-demo-call]').forEach(b=>b.addEventListener('click',()=>{
   const kind=b.dataset.demoCall==='video'?'video':'voice';
   $('callNotice').textContent='Preview only: '+kind+' calling uses browser WebRTC in the authenticated Connect app. No call or device access was started here.';
   notification('No '+kind+' call started. This is a fictional sales demo.');
  }));
  $('chatCompose').addEventListener('submit',e=>{
   e.preventDefault();
   const input=$('chatInput'),text=clean(input.value.trim(),280);
   if(!text)return;
   const now=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
   state.messages[state.selectedContact].push({mine:true,body:text,time:now});
   state.messages[state.selectedContact].push({mine:false,body:'Thanks! This is a scripted demo reply, not a real employee.',time:now});
   navigate('connect');notification('Message simulated on this page. Nothing was sent.');
   $('chatHistory').scrollTop=$('chatHistory').scrollHeight;
  });
 }
 function marketplace(){
  const fields=moduleCatalog.map(m=>'<label class="module-option"><input type="checkbox" data-module="'+m.id+'" '+(state.enabled[m.id]?'checked':'')+
   (m.id==='staff_accounts'?' disabled aria-label="Staff Accounts are required"':'')+
   '><span><strong>'+esc(m.name)+'</strong><small>'+esc(m.desc)+'</small></span><span class="module-price">'+money(m.price)+(m.perSeat?'/seat':'/mo')+'</span></label>').join('');
  return section('Your module marketplace','Configure a sample monthly subscription. Prices are draft ideas, not purchasable plans.')+
   '<div class="market-layout"><section class="panel"><div class="panel-head"><h3>Choose your modules</h3><span class="pill gray">Preview pricing</span></div>'+
   '<div class="module-config">'+fields+'</div>'+
   '<div class="field" style="margin-top:23px"><label for="seatCount">Staff accounts ('+state.seats+')</label><input id="seatCount" type="range" min="1" max="30" value="'+state.seats+'" step="1"></div>'+
   '<p class="muted">Analytics, Case Management and Workforce do not have final prices yet and are excluded from this subtotal.</p></section>'+
   '<aside class="invoice-card"><h3>Subscription estimate</h3><div id="invoiceRows">'+invoiceRows()+'</div>'+
   '<div class="invoice-total"><strong id="invoiceTotal">'+money(total())+'</strong><span>per month*</span></div>'+
   '<p class="invoice-note">*Illustrative USD prices only. The real product does not yet have active billing or automatic subscriptions. This is not an offer or invoice.</p>'+
   '<button id="showPricing" class="pane-action" type="button" style="margin-top:13px;width:100%">View configuration summary</button></aside></div>';
 }
 function invoiceRows(){
  return moduleCatalog.filter(m=>state.enabled[m.id]).map(m=>'<div class="invoice-row"><span>'+esc(m.name)+(m.perSeat?' × '+state.seats:'')+'</span><b>'+money(m.perSeat?state.seats*m.price:m.price)+'</b></div>').join('');
 }
 function wireMarketplace(){
  document.querySelectorAll('[data-module]').forEach(input=>input.addEventListener('change',()=>{
   if(input.dataset.module==='staff_accounts'){input.checked=true;return;}
   state.enabled[input.dataset.module]=input.checked;
   $('invoiceRows').innerHTML=invoiceRows();
   $('invoiceTotal').textContent=money(total());
   state.audit.unshift((input.checked?'Enabled ':'Disabled ')+input.dataset.module+' (simulated)');
  }));
  $('seatCount').addEventListener('input',e=>{
   state.seats=Number(e.target.value);
   const label=document.querySelector('label[for="seatCount"]');
   if(label)label.textContent='Staff accounts ('+state.seats+')';
   $('invoiceRows').innerHTML=invoiceRows();
   $('invoiceTotal').textContent=money(total());
  });
  $('showPricing').addEventListener('click',()=>{
   notification('Sample monthly subtotal: '+money(total())+'. This is not a real subscription or charge.');
  });
 }
 function admin(){
  const people=['Jordan Demo — Administrator','Alex Rivera — Agent','Morgan Hale — Quality reviewer','Casey Patel — Agent'];
  const swatches=['#1769ad','#197d88','#7055a4','#32664d'];
  return section('Client administration','Illustrative settings for the fictional '+prof().industry.toLowerCase()+' organization.')+
   '<div class="admin-layout"><section class="panel"><div class="panel-head"><h3>Workspace identity</h3><span class="pill gray">Client admin</span></div>'+
   '<div class="field"><label for="brandName">Organization name</label><input id="brandName" maxlength="44" value="'+esc(state.brand)+'"></div>'+
   '<span class="field-label">Brand accent color</span><div class="swatches" id="colorSwatches">'+
   swatches.map(c=>'<button type="button" data-accent="'+c+'" class="'+(c===state.accent?'selected':'')+'" aria-label="Choose accent '+c+'" style="background:'+c+'"></button>').join('')+
   '</div><button class="pane-action strong" id="saveBrand" type="button">Apply branding</button>'+
   '<h3 style="margin:27px 0 14px">Team roles</h3><ul class="audit-log">'+people.map(n=>'<li><strong>'+esc(n)+'</strong></li>').join('')+'</ul>'+
   '</section><section class="panel"><div class="panel-head"><h3>Platform activity</h3><span class="pill gray">Simulated</span></div>'+
   '<ul class="audit-log">'+state.audit.slice(0,8).map(a=>'<li><strong>'+esc(a)+'</strong><br><small>Demo session · no server storage</small></li>').join('')+'</ul>'+
   '<div class="result-box" style="margin-top:25px">Real Cricket separates platform administration from each office administrator. Role and module permissions are enforced by the backend—not by this showcase.</div></section></div>';
 }
 function wireAdmin(){
  document.querySelectorAll('[data-accent]').forEach(b=>b.addEventListener('click',()=>{
   state.accent=b.dataset.accent;updateAccent();
   document.querySelectorAll('[data-accent]').forEach(x=>x.classList.toggle('selected',x===b));
  }));
  $('saveBrand').addEventListener('click',()=>{
   const value=$('brandName').value.trim();
   if(!value)return notification('Enter an organization name.');
   state.brand=clean(value,44);state.audit.unshift('Demo branding changed');
   navigate('admin');notification('Branding updated for this browser session only.');
  });
 }
 function init(){
  state=createState();
  navEvents();updateAccent();navigate('overview');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();