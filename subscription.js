'use strict';
// Client-facing read-only subscription center. All privileges enforced by server.
(()=>{
 const $=id=>document.getElementById(id);
 const create=(tag,text,cls)=>{
   const node=document.createElement(tag);
   if(text!==undefined)node.textContent=String(text);
   if(cls)node.className=cls;
   return node;
 };
 async function load(){
   try{
     const me=await fetch('/api/auth/me',{credentials:'same-origin'});
     if(!me.ok)throw Error('Please sign in to your office.');
     const session=await me.json();
     if(session.user?.role!=='admin'){
       $('subError').textContent='Only your office administrator can view subscription details.';
       $('subModules').replaceChildren();return;
     }
     const response=await fetch('/api/modules/me',{credentials:'same-origin'});
     if(!response.ok)throw Error('Could not load module details.');
     const data=await response.json();
     $('subOfficeName').textContent=data.office.name+' · Subscription and enabled features';
     $('subSeatsUsed').textContent=String(data.seats.used);
     $('subSeatsLimit').textContent=data.seats.limit==null?'Unlimited':String(data.seats.limit);
     $('subEnabledCount').textContent=String(data.modules.filter(mod=>mod.enabled).length);
     $('subDraftSubtotal').textContent=new Intl.NumberFormat('en-US',{
       style:'currency',currency:'USD',maximumFractionDigits:0
     }).format(data.pricing.knownSubtotalUsd);
     const list=$('subModules');list.replaceChildren();
     for(const module of data.modules){
       const card=create('article',undefined,'sub-module');
       card.dataset.moduleStatus=module.status==='planned'?'planned':module.enabled?'enabled':'disabled';
       const icon=create('span',module.enabled?'✓':module.status==='planned'?'◷':'—','sub-icon');
       icon.setAttribute('aria-hidden','true');
       const description=create('div',undefined,'sub-module-body');
       description.append(create('h3',module.name),create('p',module.description));
       const meta=create('div',undefined,'sub-module-meta');
       const state=module.status==='planned'?'Coming soon':module.enabled?'Enabled':'Not enabled';
       const flag=create('strong',state,module.enabled?'sub-active':'sub-inactive');
       const draft=module.priceUsd==null?'Pricing to be determined':
         '$'+module.priceUsd.toLocaleString('en-US')+
         (module.unit==='seat'?' per seat / month':' / month');
       meta.append(flag,create('span',draft));
       card.append(icon,description,meta);list.append(card);
     }
     for(const control of document.querySelectorAll('[data-module-filter]')){
       control.addEventListener('click',()=>{
         const selected=control.dataset.moduleFilter;
         for(const tab of document.querySelectorAll('[data-module-filter]'))
           tab.setAttribute('aria-pressed',String(tab===control));
         for(const card of list.querySelectorAll('.sub-module'))
           card.hidden=selected!=='all'&&card.dataset.moduleStatus!==selected;
       });
     }
   }catch(error){$('subModules').replaceChildren();$('subError').textContent=error.message;}
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});
 else void load();
})();