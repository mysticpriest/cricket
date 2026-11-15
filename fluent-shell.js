'use strict';
/*
 * Cricket / shared enterprise shell enhancements.
 * Progressive enhancement only: if this file is unavailable, all native
 * navigation and pages keep working. No frameworks, tracking, or external APIs.
 */
(()=>{
 const NS='http://www.w3.org/2000/svg';
 const GLYPHS=Object.freeze({
   apps:['M4 4h6v6H4z','M14 4h6v6h-6z','M4 14h6v6H4z','M14 14h6v6h-6z'],
   overview:['M3 3h8v8H3z','M13 3h8v5h-8z','M13 10h8v11h-8z','M3 13h8v8H3z'],
   analytics:['M4 20V10','M10 20V4','M16 20v-7','M22 20V8','M2 20h21'],
   inbound:['M4 4v6h6','M4 10l8-8','M6 17a5 5 0 0 0 5 5','M13 22h7v-7'],
   outbound:['M20 20v-6h-6','M20 14l-8 8','M18 7a5 5 0 0 0-5-5','M11 2H4v7'],
   cases:['M8 3h8l4 4v14H4V3z','M8 11h8','M8 15h8','M8 19h5'],
   qc:['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z','M9 12l2 2 4-4'],
   operations:['M4 20h16','M5 20V9h5v11','M14 20V4h5v16'],
   workflow:['M6 3h12v4H6z','M6 17h12v4H6z','M12 7v10','M3 11h6v3H3z','M15 11h6v3h-6z'],
   team:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z','M17 11a4 4 0 0 0 0-8','M22 21v-2a4 4 0 0 0-3-3.87'],
   calendar:['M4 6h16v15H4z','M8 3v6','M16 3v6','M4 11h16','M8 15h3'],
   staff:['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z','M4 21v-2a8 8 0 0 1 16 0v2z'],
   settings:['M12 3v3','M12 18v3','M3 12h3','M18 12h3','M5.6 5.6l2.1 2.1','M16.3 16.3l2.1 2.1','M18.4 5.6l-2.1 2.1','M7.7 16.3l-2.1 2.1','M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
   search:['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z','M17 17l5 5'],
   briefcase:['M3 7h18v14H3z','M8 7V4h8v3','M3 13h18','M10 13v2h4v-2'],
   arrow:['M5 12h14','M13 6l6 6-6 6']
 });
 function svg(name){
   const node=document.createElementNS(NS,'svg');
   node.setAttribute('viewBox','0 0 24 24');
   node.setAttribute('fill','none');
   node.setAttribute('stroke','currentColor');
   node.setAttribute('stroke-width','1.8');
   node.setAttribute('stroke-linecap','round');
   node.setAttribute('stroke-linejoin','round');
   node.setAttribute('aria-hidden','true');
   node.setAttribute('focusable','false');
   for(const d of GLYPHS[name]||GLYPHS.apps){
     const path=document.createElementNS(NS,'path');
     path.setAttribute('d',d);node.append(path);
   }
   return node;
 }
 const moduleItems=[
  {title:'Overview',href:'index.html',icon:'overview'},
  {title:'Analytics',href:'analytics.html',icon:'analytics',module:'analytics'},
  {title:'Inbound',href:'inbound.html',icon:'inbound',module:'workflow_builder',roles:['agent','admin'],template:'neutrauma'},
  {title:'Outbound',href:'outbound.html',icon:'outbound',module:'workflow_builder',roles:['agent','admin'],template:'neutrauma'},
  {title:'Office workflows',href:'office-workflow.html',icon:'workflow',module:'workflow_builder',roles:['agent','admin'],template:'starter'},
  {title:'Guided workflows',href:'workflow-runner.html',icon:'workflow',module:'workflow_builder',roles:['agent','admin']},
  {title:'Quality control',href:'qc.html',icon:'qc',module:'quality_control',roles:['qc','admin']},
  {title:'Case archive',href:'cases.html',icon:'cases',module:'case_management',roles:['admin']},
  {title:'Team Hub',href:'team-hub.html',icon:'team',module:'team_hub'},
  {title:'Workforce',href:'workforce.html',icon:'calendar',module:'workforce'},
  {title:'Live operations',href:'operations.html',icon:'operations',module:'workforce',roles:['admin']},
  {title:'Workflow Builder',href:'workflow-builder.html',icon:'workflow',module:'workflow_builder',roles:['admin']},
  {title:'Staff accounts',href:'staff.html',icon:'staff',roles:['admin']},
  {title:'My modules',href:'subscription.html',icon:'apps',roles:['admin']}
 ];
 const hrefIcon=Object.freeze(Object.fromEntries(moduleItems.map(x=>[x.href,x.icon])));
 function insertNavIcons(){
   for(const link of document.querySelectorAll('#appSidebar .nav-item')){
     const raw=link.getAttribute('href')||'';
     const value=raw.split('?')[0].split('#')[0].replace(/^\.\//,'');
     const iconName=hrefIcon[value];
     const slot=link.querySelector('.nav-icon');
     if(!iconName||!slot||slot.dataset.crkIcon===iconName)return;
     // Leave label, link and permissions alone. Only replace the decorative glyph.
     slot.replaceChildren(svg(iconName));
     slot.dataset.crkIcon=iconName;
   }
 }
 function button(label){
   const control=document.createElement('button');control.type='button';
   control.className='crk-switcher-button';
   control.setAttribute('aria-label',label);
   return control;
 }
 async function getSession(){
   try{
     const response=await fetch('/api/auth/me',{credentials:'same-origin'});
     if(!response.ok)return null;
     const data=await response.json();
     return data.user||null;
   }catch(_){return null;}
 }
 async function getModules(user){
   if(!user.office)return {};
   try{
     const response=await fetch('/api/modules/me',{credentials:'same-origin'});
     if(!response.ok)return {};
     const data=await response.json();
     return Object.fromEntries((data.modules||[]).map(x=>[x.key,x.enabled]));
   }catch(_){return {};}
 }
 function createSwitcher(user,availability){
   if(document.querySelector('.crk-switcher'))return;
   const host=document.querySelector('#dashboard .topbar .topbar-actions, body > header, body > .topbar');
   if(!host)return;
   const shell=document.createElement('div');shell.className='crk-switcher';
   const trigger=button('Open Cricket app switcher');
   trigger.setAttribute('aria-haspopup','true');
   trigger.setAttribute('aria-expanded','false');
   trigger.setAttribute('aria-controls','crkSwitcherMenu');
   trigger.append(svg('apps'));
   const name=document.createElement('span');
   name.className='crk-switcher-label';name.textContent='Apps';
   const hint=document.createElement('kbd');hint.textContent='Alt + G';
   trigger.append(name,hint);
   const menu=document.createElement('nav');
   menu.className='crk-switcher-menu';menu.id='crkSwitcherMenu';
   menu.setAttribute('aria-label','Cricket apps and workspaces');
   menu.hidden=true;
   const title=document.createElement('div');title.className='crk-switcher-title';
   title.textContent=user.role==='platform_admin'?'Platform tools':'Your workspaces';
   menu.append(title);
   const options=user.role==='platform_admin'
     ? [{title:'Platform administration',href:'platform.html',icon:'apps'}]
     :moduleItems.filter(item=>{
       if(item.roles&&!item.roles.includes(user.role))return false;
       if(item.template&&item.template!==user.office?.workflowTemplate)return false;
       if(item.module&&availability[item.module]===false)return false;
       return true;
     });
   const pathname=location.pathname.split('/').pop()||'index.html';
   for(const item of options){
     const link=document.createElement('a');
     link.href=item.href;link.className='crk-switcher-item';
     if(item.href===pathname)link.setAttribute('aria-current','page');
     link.append(svg(item.icon));
     const text=document.createElement('span');text.textContent=item.title;
     link.append(text);menu.append(link);
   }
   const footer=document.createElement('div');footer.className='crk-switcher-hint';
   footer.textContent='Press Escape to close · Alt + G to reopen';
   menu.append(footer);
   shell.append(trigger,menu);
   // The dashboard header has right-side identity/sign-out controls. Preserve
   // their order. Other pages can append at the end of their own header.
   if(host.classList.contains('topbar-actions'))host.prepend(shell);
   else host.append(shell);
   const setOpen=visible=>{
     menu.hidden=!visible;
     trigger.setAttribute('aria-expanded',String(visible));
     if(visible)menu.querySelector('a')?.focus();
     else trigger.focus();
   };
   trigger.addEventListener('click',()=>{
     const visible=menu.hidden;
     setOpen(visible);
     if(!visible)trigger.focus();
   });
   document.addEventListener('pointerdown',e=>{
     if(!menu.hidden&&!shell.contains(e.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}
   });
   document.addEventListener('keydown',e=>{
     const editable=e.target?.closest?.('input,textarea,select,[contenteditable=true]');
     if(e.altKey&&!e.ctrlKey&&!e.metaKey&&e.key.toLowerCase()==='g'&&!editable){
       e.preventDefault();setOpen(menu.hidden);
     }
     if(e.key==='Escape'&&!menu.hidden){e.preventDefault();setOpen(false);}
   });
 }
 async function initialize(){
   const page=location.pathname.split('/').pop();
   if(['office.html','login.html'].includes(page))return;
   insertNavIcons();
   const user=await getSession();
   if(!user)return;
   const available=await getModules(user);
   createSwitcher(user,available);
   // In legacy rendering a navigation link may be replaced after login, so
   // restore glyphs when its underlying element changes, never a label.
   const nav=document.querySelector('#appSidebar .nav');
   if(nav&&window.MutationObserver){
     new MutationObserver(()=>insertNavIcons()).observe(nav,{childList:true,subtree:true});
   }
   for(const a of document.querySelectorAll('.op-top nav a')){
     if(a.getAttribute('href')===page)a.setAttribute('aria-current','page');
   }
 }
 if(document.readyState==='loading')
   document.addEventListener('DOMContentLoaded',()=>void initialize(),{once:true});
 else void initialize();
})();
