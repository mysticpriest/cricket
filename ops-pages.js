'use strict';
// Four office-scoped operations interfaces — no external JS dependencies.
(()=>{
 const page=document.body.dataset.opsPage;
 if(!page)return;
 const $=id=>document.getElementById(id);
 const el=(tag,cls,text)=>{
   const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=String(text);
   return x;
 };
 const button=(label,action,cls='op-ghost')=>{
   const b=el('button',cls,label);b.type='button';b.addEventListener('click',action);return b;
 };
 const api=async(url,options={})=>{
   const res=await fetch(url,{credentials:'same-origin',...options});
   let body={};try{body=await res.json();}catch(_){}
   if(!res.ok)throw Error(body.error||('Request failed ('+res.status+')'));
   return body;
 };
 const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const status=(message,error=false)=>{
   const node=$('opStatus');node.textContent=message;node.classList.toggle('error',error);
   if(message)window.CricketSound?.play(error?'error':'success');
 };
 const date=stamp=>new Date(stamp).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
 const local=millis=>{
   const d=new Date(millis),shifted=new Date(d.getTime()-d.getTimezoneOffset()*60000);
   return shifted.toISOString().slice(0,16);
 };
 const safe=fn=>async event=>{
   try{await fn(event);}catch(error){status(error.message,true);}
 };
 let user,workflows=[],selected=null,teamData=null,workforceData=null;

 function stepEditor(initial={}){
   const row=el('div','op-step-editor');
   const controls=el('div','op-step-top');
   controls.append(el('strong','', 'Guided step'));
   controls.append(button('↑',()=>{
     if(row.previousElementSibling)row.parentElement.insertBefore(row,row.previousElementSibling);
   }));
   controls.append(button('↓',()=>{
     if(row.nextElementSibling)row.parentElement.insertBefore(row.nextElementSibling,row);
   }));
   controls.append(button('Remove',()=>{row.remove();},'op-remove'));
   const label=el('input');label.className='op-step-label';label.maxLength=100;label.minLength=2;label.required=true;
   label.placeholder='Question or instruction';label.value=initial.label||'';
   label.setAttribute('aria-label','Step label');
   const type=el('select','op-step-type');
   for(const [value,title] of [['text','Text answer'],['yesno','Yes / No'],['select','Multiple choice']]){
     const o=el('option','',title);o.value=value;type.append(o);
   }
   type.value=initial.type||'text';
   const required=el('label','op-check');
   const check=el('input');check.type='checkbox';check.checked=initial.required!==false;
   required.append(check,el('span','', 'Required'));
   const options=el('textarea','op-step-options');
   options.rows=2;options.placeholder='Choices — one per line';
   options.value=(initial.options||[]).join('\n');options.setAttribute('aria-label','Multiple choice options');
   options.hidden=type.value!=='select';
   type.addEventListener('change',()=>options.hidden=type.value!=='select');
   const settings=el('div','op-step-settings');settings.append(type,required);
   row.append(controls,label,settings,options);return row;
 }
 function stepValues(){
   return [...$('wbSteps').children].map(row=>{
     const type=row.querySelector('.op-step-type').value;
     return {label:row.querySelector('.op-step-label').value.trim(),type,
       required:row.querySelector('.op-check input').checked,
       options:type==='select'?row.querySelector('.op-step-options').value.split('\n').map(x=>x.trim()).filter(Boolean):[]};
   });
 }
 async function loadBuilder(){
   const response=await api('/api/ops/workflows');
   workflows=response.workflows;renderBuilderList();
 }
 function renderBuilderList(){
   const host=$('wbList');host.replaceChildren();
   if(!workflows.length)host.append(el('p','op-muted','No custom workflows yet. Create the first route.'));
   for(const workflow of workflows){
     const entry=el('article','op-list-entry');
     entry.append(el('strong','',workflow.title),el('p','',workflow.description||'No description'));
     const row=el('div','op-list-meta');
     row.append(el('small','',workflow.status.toUpperCase()+' · '+workflow.steps.length+' steps'),
       button('Edit',()=>selectBuilder(workflow)));
     entry.append(row);host.append(entry);
   }
 }
 function selectBuilder(workflow){
   selected=workflow?.id||null;
   $('wbEditorTitle').textContent=workflow?'Edit workflow':'Create a workflow';
   $('wbTitle').value=workflow?.title||'';
   $('wbDescription').value=workflow?.description||'';
   $('wbStatus').value=workflow?.status||'draft';
   const steps=$('wbSteps');steps.replaceChildren();
   for(const item of workflow?.steps||[{}])steps.append(stepEditor(item));
   $('wbUnpublish').hidden=!workflow||workflow.status!=='published';
   status('');
 }
 function builder(){
   $('wbNew').addEventListener('click',()=>selectBuilder(null));
   $('wbAddStep').addEventListener('click',()=>{
     const steps=$('wbSteps');
     if(steps.children.length>=12){status('Maximum 12 steps per workflow',true);return;}
     steps.append(stepEditor());
   });
   $('wbForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     const value={title:$('wbTitle').value,description:$('wbDescription').value,
       status:$('wbStatus').value,steps:stepValues()};
     const path=selected?'/api/ops/workflows/'+selected:'/api/ops/workflows';
     const response=await api(path,json(selected?'PUT':'POST',value));
     const id=selected||response.workflow.id;
     await loadBuilder();
     selectBuilder(workflows.find(x=>x.id===id));
     status('Workflow saved. Published routes are immediately available to your office.');
   }));
   $('wbUnpublish').addEventListener('click',safe(async()=>{
     if(!selected)return;
     await api('/api/ops/workflows/'+selected,{method:'DELETE'});
     await loadBuilder();selectBuilder(workflows.find(x=>x.id===selected));
     status('Workflow unpublished; previously completed cases remain in QC.');
   }));
   void loadBuilder().then(()=>selectBuilder(null)).catch(error=>status(error.message,true));
 }
 function selectRunner(workflow){
   selected=workflow.id;
   $('wrTitle').textContent=workflow.title;
   $('wrDescription').textContent=workflow.description||'Complete the questions below.';
   const host=$('wrSteps');host.replaceChildren();
   for(const step of workflow.steps){
     const wrap=el('label','op-run-step');
     wrap.append(el('strong','',step.label+(step.required?' *':'')));
     let input;
     if(step.type==='text'){
       input=el('textarea');input.rows=2;input.maxLength=350;
       input.placeholder='Enter your answer';
     }else{
       input=el('select');const blank=el('option','', 'Choose an answer');blank.value='';
       input.append(blank);
       const choices=step.type==='yesno'?['Yes','No']:step.options;
       for(const value of choices){
         const option=el('option','',value);option.value=value;input.append(option);
       }
     }
     input.dataset.stepId=step.id;input.required=step.required;
     wrap.append(input);host.append(wrap);
   }
   $('wrForm').hidden=false;
   $('wrNote').value='';$('wrOutcome').value='resolved';
 }
 async function loadRunner(){
   const response=await api('/api/ops/workflows');workflows=response.workflows.filter(x=>x.status==='published');
   $('wrCount').textContent=workflows.length+' routes';
   const list=$('wrList');list.replaceChildren();
   if(!workflows.length){
     list.append(el('p','op-muted','No published custom workflows yet. Ask your office administrator to create one.'));
     return;
   }
   for(const wf of workflows){
     const card=el('button','op-route-button');
     card.type='button';card.append(el('strong','',wf.title),el('small','',wf.steps.length+' steps'));
     card.addEventListener('click',()=>{
       for(const node of list.children)node.classList.remove('active');
       card.classList.add('active');selectRunner(wf);
     });
     list.append(card);
   }
   const requested=new URLSearchParams(location.search).get('id');
   const index=Math.max(0,workflows.findIndex(x=>x.id===requested));
   list.children[index]?.click();
 }
 function runner(){
   $('wrForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     if(!selected)throw Error('Select a route');
     const answers={};
     for(const control of $('wrSteps').querySelectorAll('[data-step-id]'))
       answers[control.dataset.stepId]=control.value.trim();
     const result=await api('/api/ops/workflows/'+selected+'/complete',
       json('POST',{answers,note:$('wrNote').value,outcome:$('wrOutcome').value}));
     status('Case documented successfully'+(result.caseId?' · '+result.caseId:'')+'. It is now available to authorized QC reviewers.');
     for(const control of $('wrSteps').querySelectorAll('[data-step-id]'))control.value='';
     $('wrNote').value='';
   }));
   void loadRunner().catch(error=>status(error.message,true));
 }
 function card(title,text,caption){
   const wrap=el('article','op-list-entry');
   wrap.append(el('strong','',title));
   if(text)wrap.append(el('p','',text));
   if(caption)wrap.append(el('small','op-caption',caption));
   return wrap;
 }
 async function loadTeam(){
   teamData=await api('/api/ops/team');
   const announcements=$('teamAnnouncements');announcements.replaceChildren();
   if(!teamData.announcements.length)announcements.append(el('p','op-muted','No office announcements yet.'));
   for(const item of teamData.announcements)announcements.append(card(item.title,item.body,
     item.author+' · '+date(item.createdAt)));
   const messages=$('teamMessages');messages.replaceChildren();
   if(!teamData.messages.length)messages.append(el('p','op-muted','Your messages will appear here.'));
   for(const msg of teamData.messages){
     const from=msg.senderId===user.id?'To '+msg.recipientName:'From '+msg.senderName;
     messages.append(card(from,msg.body,date(msg.createdAt)));
   }
   const select=$('teamRecipient'),selectedValue=select.value;
   select.replaceChildren();
   const choose=el('option','', 'Choose a colleague');choose.value='';select.append(choose);
   for(const staff of teamData.staff.filter(x=>x.id!==user.id)){
     const option=el('option','',staff.displayName+' ('+staff.role+')');option.value=String(staff.id);
     select.append(option);
   }
   select.value=selectedValue;
 }
 function team(){
   if(user.role==='admin')$('teamAnnounceForm').hidden=false;
   $('teamAnnounceForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     await api('/api/ops/team/announcements',
       json('POST',{title:$('teamAnnounceTitle').value,body:$('teamAnnounceBody').value}));
     event.target.reset();await loadTeam();status('Announcement published to your office.');
   }));
   $('teamMessageForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     await api('/api/ops/team/messages',json('POST',{
       recipientId:Number($('teamRecipient').value),body:$('teamBody').value
     }));
     $('teamBody').value='';await loadTeam();status('Message sent.');
   }));
   void loadTeam().catch(error=>status(error.message,true));
 }
 async function loadWorkforce(){
   workforceData=await api('/api/ops/workforce');
   const scheduleHost=$('workSchedules');scheduleHost.replaceChildren();
   if(!workforceData.schedules.length)scheduleHost.append(el('p','op-muted','No scheduled shifts yet.'));
   for(const shift of workforceData.schedules){
     const item=card(shift.employee||'Scheduled shift',
       date(shift.startAt)+' → '+date(shift.endAt),shift.notes);
     if(user.role==='admin'){
       item.append(button('Remove schedule',safe(async()=>{
         if(!confirm('Remove this scheduled shift?'))return;
         await api('/api/ops/workforce/schedules/'+encodeURIComponent(shift.id),{method:'DELETE'});
         await loadWorkforce();status('Scheduled shift removed.');
       }),'op-remove'));
     }
     scheduleHost.append(item);
   }
   const sheet=$('workTimesheets');sheet.replaceChildren();
   if(!workforceData.timesheets.length)sheet.append(el('p','op-muted','No recorded shifts.'));
   for(const shift of workforceData.timesheets.slice(0,40)){
     const duration=shift.endedAt?((shift.endedAt-shift.startedAt)/3600000).toFixed(2)+' hours':'Open shift';
     sheet.append(card(shift.employee,date(shift.startedAt)+' → '+(shift.endedAt?date(shift.endedAt):'Active'),duration));
   }
   const select=$('workShift'),prior=select.value;
   select.replaceChildren();
   const empty=el('option','', 'Select your completed shift');empty.value='';select.append(empty);
   for(const shift of workforceData.timesheets.filter(x=>x.userId===user.id&&x.endedAt)){
     const opt=el('option','',date(shift.startedAt));opt.value=String(shift.id);
     opt.dataset.start=String(shift.startedAt);opt.dataset.end=String(shift.endedAt);
     select.append(opt);
   }
   select.value=prior||'';
   const requests=$('workCorrections');requests.replaceChildren();
   if(!workforceData.corrections.length)requests.append(el('p','op-muted','No correction requests.'));
   for(const request of workforceData.corrections){
     const item=card(request.employee+' · '+request.status,
       date(request.proposedStart)+' → '+date(request.proposedEnd),
       request.reason+(request.reviewNote?' · '+request.reviewNote:''));
     if(user.role==='admin'&&request.status==='pending'){
       const decisions=el('div','op-form-actions');
       for(const state of ['approved','rejected']){
         decisions.append(button(state==='approved'?'Approve':'Reject',safe(async()=>{
           await api('/api/ops/workforce/corrections/'+encodeURIComponent(request.id),
             json('PATCH',{status:state,note:'Reviewed by office administrator'}));
           await loadWorkforce();status('Correction '+state+'. Original timestamps remain unchanged.');
         }),state==='approved'?'op-button':'op-remove'));
       }
       item.append(decisions);
     }
     requests.append(item);
   }
 }
 async function loadStaff(){
   const data=await api('/api/ops/team');
   const select=$('workEmployee');select.replaceChildren();
   for(const person of data.staff){
     const option=el('option','',person.displayName+' ('+person.role+')');
     option.value=String(person.id);select.append(option);
   }
 }
 function workforce(){
   if(user.role==='admin'){
     $('workScheduleForm').hidden=false;
     $('workExport').hidden=false;
     void loadStaff().catch(error=>status(error.message,true));
   }
   $('workScheduleForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     await api('/api/ops/workforce/schedules',json('POST',{
       userId:Number($('workEmployee').value),startAt:new Date($('workStart').value).toISOString(),
       endAt:new Date($('workEnd').value).toISOString(),notes:$('workNotes').value
     }));
     event.target.reset();await loadWorkforce();status('Shift scheduled and employee notified.');
   }));
   $('workShift').addEventListener('change',()=>{
     const o=$('workShift').selectedOptions[0];
     if(o?.dataset.start){$('workFixStart').value=local(Number(o.dataset.start));$('workFixEnd').value=local(Number(o.dataset.end));}
   });
   $('workCorrectionForm').addEventListener('submit',safe(async event=>{
     event.preventDefault();
     await api('/api/ops/workforce/corrections',json('POST',{
       shiftId:Number($('workShift').value),startAt:new Date($('workFixStart').value).toISOString(),
       endAt:new Date($('workFixEnd').value).toISOString(),reason:$('workReason').value
     }));
     event.target.reset();await loadWorkforce();status('Correction request submitted for administrative review.');
   }));
   void loadWorkforce().catch(error=>status(error.message,true));
 }
 async function boot(){
   try{
     const response=await api('/api/auth/me');
     user=response.user;if(!user||!user.office)throw Error('Sign in with an office account');
     if(page==='builder'){
       if(user.role!=='admin')throw Error('Only office administrators can configure workflows');
       builder();
     }else if(page==='runner'){
       if(!['agent','admin'].includes(user.role))throw Error('Agent workspace required');
       runner();
     }else if(page==='team')team();
     else if(page==='workforce')workforce();
   }catch(error){status(error.message,true);}
 }
 void boot();
})();