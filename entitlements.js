'use strict';
// Visual navigation hints only. Real feature access is always checked by Node.
(()=>{
  const routeModule={
    'analytics.html':'analytics','qc.html':'quality_control','cases.html':'case_management',
    'inbound.html':'workflow_builder','outbound.html':'workflow_builder',
    'office-workflow.html':'workflow_builder','workflow-builder.html':'workflow_builder',
    'workflow-runner.html':'workflow_builder','team-hub.html':'team_hub',
    'workforce.html':'workforce','operations.html':'workforce'
  };
  function apply(root,availability){
    const links=root.querySelectorAll?.('a[href]')||[];
    for(const link of links){
      const uri=link.getAttribute('href')?.split('?')[0]?.split('#')[0]?.replace(/^\.\//,'')||'';
      const module=routeModule[uri];
      if(module)link.classList.toggle('module-unavailable',availability[module]===false);
    }
  }
  async function init(){
    const root=document.getElementById('dashboard');
    if(!root)return;
    try{
      const response=await fetch('/api/modules/me',{credentials:'same-origin'});
      if(!response.ok)return;
      const data=await response.json();
      const available=Object.fromEntries(data.modules.map(mod=>[mod.key,mod.enabled]));
      apply(document,available);
      const tiles=document.getElementById('workspaceTiles');
      if(tiles&&window.MutationObserver){
        new MutationObserver(()=>apply(tiles,available)).observe(tiles,{childList:true,subtree:true});
      }
    }catch(_){/* The server continues enforcing access if this hint fails. */}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else void init();
})();
