'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(ROOT,'fluent-shell.js'),'utf8');
const css=fs.readFileSync(path.join(ROOT,'fluent.css'),'utf8');
const pages=[
 'index.html','login.html','office.html','platform.html','subscription.html',
 'inbound.html','outbound.html','qc.html','analytics.html','cases.html','staff.html',
 'operations.html','office-workflow.html','team-hub.html','workforce.html',
 'workflow-builder.html','workflow-runner.html'
];

test('Fluent design system is applied to every first-class Cricket screen',()=>{
 assert.match(css,/Segoe UI/);
 assert.match(css,/--crk-primary:/);
 assert.match(css,/\.platform-overview/);
 assert.match(css,/\.app-shell \.sidebar/);
 assert.match(css,/@media\(max-width:650px\)/);
 assert.match(css,/@media\(orientation:portrait\)/);
 assert.doesNotMatch(css,/linear-gradient|radial-gradient|conic-gradient/i);
 for(const page of pages){
   const source=fs.readFileSync(path.join(ROOT,page),'utf8');
   assert.match(source,/href="fluent\.css"/,page+' should receive common styles');
   if(!['office.html','login.html'].includes(page))
     assert.match(source,/src="fluent-shell\.js"/,page+' should load the app switcher');
 }
});
test('Platform portfolio and subscription filters have matching real controls',()=>{
 const platform=fs.readFileSync(path.join(ROOT,'platform.html'),'utf8');
 const platformJs=fs.readFileSync(path.join(ROOT,'platform.js'),'utf8');
 for(const id of ['platformTotalClients','platformActiveClients','platformStaffTotal','platformCasesTotal']){
   assert.match(platform,new RegExp('id="'+id+'"'));
   assert.match(platformJs,new RegExp(id));
 }
 const subscription=fs.readFileSync(path.join(ROOT,'subscription.html'),'utf8');
 const clientJs=fs.readFileSync(path.join(ROOT,'subscription.js'),'utf8');
 for(const id of ['subSeatsUsed','subSeatsLimit','subEnabledCount','subDraftSubtotal']){
   assert.match(subscription,new RegExp('id="'+id+'"'));
   assert.match(clientJs,new RegExp(id));
 }
 assert.match(subscription,/data-module-filter="enabled"/);
 assert.match(subscription,/data-module-filter="planned"/);
 assert.match(clientJs,/data\.pricing\.knownSubtotalUsd/);
 assert.match(clientJs,/card\.hidden/);
});
function mock({role='agent',disabled=['team_hub','quality_control']}={}){
 class Element{
   constructor(tag){
     this.tagName=tag;this.children=[];this.attributes={};this.listeners={};
     this.dataset={};this.hidden=false;this.className='';
   }
   append(...nodes){this.children.push(...nodes);}
   prepend(...nodes){this.children.unshift(...nodes);}
   setAttribute(key,value){this.attributes[key]=String(value);}
   getAttribute(key){return this.attributes[key]||null;}
   addEventListener(event,listener){this.listeners[event]=listener;}
   focus(){}
   querySelector(query){
     if(query==='a')return this.children.find(x=>x.tagName==='a')||null;
     return null;
   }
 }
 const host=new Element('div');host.className='topbar-actions';
 const events={};
 const document={
   readyState:'complete',
   createElement:tag=>new Element(tag),
   createElementNS:(_ns,tag)=>new Element(tag),
   querySelector:query=>query.includes('topbar-actions')?host:null,
   querySelectorAll:()=>[],
   addEventListener:(type,cb)=>{events[type]=cb;}
 };
 const modules=['analytics','quality_control','team_hub','workflow_builder','workforce','case_management'];
 const fetch=async url=>({
   ok:true,json:async()=>url==='/api/auth/me'
     ?{user:{role,office:role==='platform_admin'?null:{id:1,workflowTemplate:'neutrauma'}}}
     :{modules:modules.map(key=>({key,enabled:!disabled.includes(key)}))}
 });
 const location={pathname:'/inbound.html'};
 vm.runInNewContext(script,{document,window:{},fetch,location,console},{filename:'fluent-shell.js'});
 return {host,events};
}
test('Accessible app switcher filters unavailable modules and role-restricted pages',async()=>{
 const agent=mock();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(agent.host.children.length,1);
 const shell=agent.host.children[0];
 assert.equal(shell.children[0].attributes['aria-haspopup'],'true');
 const menu=shell.children[1];
 const hrefs=menu.children.filter(x=>x.tagName==='a').map(x=>x.href);
 assert.ok(hrefs.includes('index.html'));
 assert.ok(hrefs.includes('inbound.html'));
 assert.ok(!hrefs.includes('qc.html'));
 assert.ok(!hrefs.includes('team-hub.html'));
 assert.ok(!hrefs.includes('staff.html'));
 assert.ok(!hrefs.includes('platform.html'));
 shell.children[0].listeners.click();
 assert.equal(menu.hidden,false);
 assert.equal(shell.children[0].attributes['aria-expanded'],'true');
 shell.children[0].listeners.click();
 assert.equal(menu.hidden,true);
 const admin=mock({role:'platform_admin'});
 await new Promise(resolve=>setImmediate(resolve));
 const adminLinks=admin.host.children[0].children[1].children.filter(x=>x.tagName==='a');
 assert.deepEqual(adminLinks.map(x=>x.href),['platform.html']);
});
