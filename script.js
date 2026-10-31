'use strict';
// Cricket employee dashboard. All authorization is independently enforced by the server.
const dashboard = document.querySelector('#dashboard');
const notice = document.querySelector('#notice');
const roleDescriptions = {
  agent: { title: 'Agent', intro: 'Your inbound call workspace and documented cases, all in one place.', action: 'inbound.html', label: 'Start handling calls', quickHeading: 'Ready for your next call?', quickDescription: 'Open Inbound to handle a fictional patient inquiry, complete the note, and generate a Case ID.' },
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
  const settings = roleDescriptions[user.role];
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
}
async function loadMetrics(user) {
  try {
    const metrics = await api('/api/dashboard');
    setText('#caseTotal', metrics.total.toLocaleString());
    setText('#casePending', metrics.pending.toLocaleString());
    setText('#caseResolved', (user.role === 'qc' ? metrics.approved : metrics.resolved).toLocaleString());
  } catch (error) { notice.textContent = error.message; }
}
document.querySelector('#logoutButton').addEventListener('click', async () => {
  const button = document.querySelector('#logoutButton');
  button.disabled = true;
  try { await api('/api/auth/logout', { method: 'POST' }); location.replace('login.html'); }
  catch (error) { button.disabled = false; notice.textContent = error.message; }
});
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (!user) { location.replace('login.html?next=index.html'); return; }
    renderUser(user);
    dashboard.classList.add('ready');
    dashboard.setAttribute('aria-busy', 'false');
    await loadMetrics(user);
  } catch (error) {
    notice.textContent = error.message;
    dashboard.classList.add('ready');
    dashboard.setAttribute('aria-busy', 'false');
  }
})();