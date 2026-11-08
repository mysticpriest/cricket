'use strict';
// Cricket employee dashboard. All authorization is independently enforced by the server.
const dashboard = document.querySelector('#dashboard');
const notice = document.querySelector('#notice');
const roleDescriptions = {
  agent: { title: 'Agent', intro: 'Your inbound call workspace and call documentation, all in one place.', action: 'inbound.html', label: 'Start handling calls', quickHeading: 'Ready for your next call?', quickDescription: 'Open Inbound to handle a fictional patient inquiry and submit documentation directly to QC.' },
  qc: { title: 'QC reviewer', intro: 'Your quality review queue, case histories, and scorecards in one workspace.', action: 'qc.html', label: 'Open review queue', quickHeading: 'Ready to review a case?', quickDescription: 'Open the QC console to search Case IDs, inspect documented actions, and evaluate the outcome.' },
  admin: { title: 'Administrator', intro: 'Manage Cricket operations, employee access, and quality oversight.', action: 'inbound.html', label: 'Explore inbound workflows', quickHeading: 'Present the full call journey', quickDescription: 'Use the Inbound workspace to create a fictional case, then open QC to review the same Case ID.' }
};
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  let body = {};
  try { body = await response.json(); } catch (_) { throw new Error('Cricket backend is unreachable.'); }
  if (response.status === 401) {
    location.replace('login.html?next=index.html');
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error(body.error || 'Could not load workspace.');
  return body;
}
function setText(selector, value) { const el = document.querySelector(selector); if (el) el.textContent = value; }
function updateDivisionPermissions(role) {
  let available = 0;
  document.querySelectorAll('[data-access]').forEach(element => {
    const allowed = element.dataset.access.split(',').includes(role);
    if (element.classList.contains('nav-item')) {
      element.hidden = !allowed;
      return;
    }
    element.classList.toggle('available', allowed);
    element.classList.toggle('restricted', !allowed);
    if (allowed) { available++; return; }
    element.removeAttribute('href');
    element.setAttribute('aria-disabled', 'true');
    element.setAttribute('tabindex', '-1');
    element.querySelector('.division-badge').textContent = 'RESTRICTED';
    element.querySelector('.division-badge').classList.remove('ready');
    element.querySelector('.division-label').textContent = 'ACCESS RESTRICTED';
    element.querySelector('p').textContent = 'This division requires a different account role. Contact your administrator for access.';
  });
  setText('#workspaceCount', available + ' available to your role');
}
function renderUser(user) {
  const starter=user.office?.workflowTemplate==='starter';
  const base=roleDescriptions[user.role];
  const settings=starter && ['agent','admin'].includes(user.role) ? {
    ...base,
    intro:'Your office-specific routes, instructions, and workspace tools in one place.',
    action:'office-workflow.html',label:'Open office workflows',
    quickHeading:'Ready for your next workflow?',
    quickDescription:'Choose your office route to view the instructions and prepare a fictional draft note.'
  } : base;
  if (!settings) throw new Error('Unknown employee role.');
  const email = user.email || 'Employee';
  // Never guess a person's real name from their email username.
  const name = typeof user.displayName === 'string' && user.displayName.trim()
    ? user.displayName.trim()
    : (user.role === 'admin' ? 'Administrator' : 'there');
  const currentHour = new Date().getHours();
  const greeting = currentHour < 12 ? 'Good morning' : currentHour < 18 ? 'Good afternoon' : 'Good evening';
  setText('#greeting', greeting + ', ' + name.split(' ')[0] + '.');
  setText('#accountEmail', email);
  setText('#accountRole', settings.title);
  setText('#avatar', name === 'there' ? 'C' : name[0].toUpperCase());
  setText('#roleIntro', settings.intro);
  const officeName=user.office?.name||'Cricket';
  setText('#officeHeaderName',officeName);
  setText('#sidebarOfficeName',officeName+' workspace');
  setText('#dateStamp', new Intl.DateTimeFormat(undefined, { weekday:'short', month:'short', day:'numeric' }).format(new Date()));
  const primary = document.querySelector('#primaryAction');
  primary.href = settings.action;
  primary.textContent = settings.label + ' →';
  const quick = document.querySelector('#quickLink');
  quick.href = settings.action;
  quick.textContent = settings.label + ' →';
  setText('#quickHeading', settings.quickHeading);
  setText('#quickDescription', settings.quickDescription);
  if (user.role === 'qc') {
    setText('#totalLabel', 'Cases in QC queue');
    setText('#completedLabel', 'Approved cases');
    setText('#completedNote', 'Quality reviews approved');
  } else if (user.role === 'agent') {
    setText('#totalLabel', 'My documented calls');
  }
  updateDivisionPermissions(user.role);
  if(starter){
    const inboundNav=document.querySelector('.nav-item[href="inbound.html"]');
    if(inboundNav){inboundNav.href='office-workflow.html';inboundNav.textContent='↙ Office workflows';}
    const outboundNav=document.querySelector('.nav-item[href="outbound.html"]');
    if(outboundNav)outboundNav.hidden=true;
    const inboundCard=document.querySelector('[data-division="inbound"]');
    if(inboundCard){
      inboundCard.href='office-workflow.html';
      inboundCard.querySelector('h3').textContent='Office workflows';
      inboundCard.querySelector('p').textContent='Open route guidance configured specifically for '+officeName+'.';
      inboundCard.querySelector('.division-badge').textContent='CLIENT ROUTES';
    }
    const outboundCard=document.querySelector('[data-division="outbound"]');
    if(outboundCard)outboundCard.hidden=true;
  }
}
async function loadMetrics(user) {
  try {
    const metrics = await api('/api/dashboard');
    setText('#caseTotal', metrics.total.toLocaleString());
    setText('#casePending', metrics.pending.toLocaleString());
    setText('#caseResolved', (user.role === 'qc' ? metrics.approved : metrics.resolved).toLocaleString());
  } catch (error) { notice.textContent = error.message; }
}
// Responsive workspace navigation for narrow and portrait displays.
// Keeps every authorized route reachable when the persistent sidebar becomes a drawer.
const mobileMenu=document.querySelector('#wsMobileNavToggle');
const mobileClose=document.querySelector('#wsMobileNavClose');
const mobileBackdrop=document.querySelector('#wsMobileNavBackdrop');
const mobileSidebar=document.querySelector('#appSidebar');
function setMobileNavigation(open){
  if(!mobileMenu||!mobileBackdrop||!mobileSidebar)return;
  const shouldOpen=!!open&&window.matchMedia('(max-width: 850px)').matches;
  dashboard.classList.toggle('ws-nav-open',shouldOpen);
  mobileBackdrop.hidden=!shouldOpen;
  mobileMenu.setAttribute('aria-expanded',String(shouldOpen));
  mobileSidebar.setAttribute('aria-hidden',String(!shouldOpen&&window.matchMedia('(max-width: 850px)').matches));
  document.body.classList.toggle('ws-mobile-nav-open',shouldOpen);
  if(shouldOpen)mobileClose?.focus();
  else if(open===false&&dashboard.classList.contains('ready'))mobileMenu.focus();
}
mobileMenu?.addEventListener('click',()=>setMobileNavigation(true));
mobileClose?.addEventListener('click',()=>setMobileNavigation(false));
mobileBackdrop?.addEventListener('click',()=>setMobileNavigation(false));
mobileSidebar?.querySelectorAll('a[href]')?.forEach(a=>a.addEventListener('click',()=>setMobileNavigation(false)));
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&dashboard.classList.contains('ws-nav-open'))setMobileNavigation(false);
});
window.addEventListener('resize',()=>{
  if(window.innerWidth>850&&dashboard.classList.contains('ws-nav-open'))setMobileNavigation(false);
});
document.querySelector('#logoutButton').addEventListener('click', async () => {
  const button = document.querySelector('#logoutButton');
  button.disabled = true;
  try { await api('/api/auth/logout', { method: 'POST' }); window.CricketSession?.clear(); location.replace('login.html'); }
  catch (error) { button.disabled = false; notice.textContent = error.message; }
});
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) { location.replace('login.html?next=index.html'); return; }
    renderUser(user);
    // Show the shell and a clear loading state, not the raw template sections.
    dashboard.classList.add('ready');
    // Explicitly await the personal workspace before revealing the dashboard.
    // The previous fire-and-forget event could be missed on a fast auth response.
    if(!window.CricketPersonalWorkspace?.boot){
      throw new Error('Personal workspace script did not load. Reload to retry.');
    }
    await window.CricketPersonalWorkspace.boot(user);
    dashboard.classList.add('ready');
    dashboard.setAttribute('aria-busy','false');
    await loadMetrics(user);
  } catch (error) {
    // Fail visibly rather than showing a misleading uncustomized dashboard.
    notice.replaceChildren();
    const text=document.createElement('span');
    text.textContent='Your workspace did not finish loading: '+error.message+'. ';
    const retry=document.createElement('button');
    retry.type='button';
    retry.className='button button-outline small-button';
    retry.textContent='Retry loading workspace';
    retry.addEventListener('click',()=>location.reload());
    notice.append(text,retry);
    notice.hidden=false;
    const loader=document.querySelector('#wsPersonalLoadState');
    if(loader)loader.hidden=true;
    dashboard.classList.add('ready');
    dashboard.setAttribute('aria-busy','false');
  }
})();