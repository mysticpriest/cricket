'use strict';

const els = {
  caseList: document.querySelector('#caseList'),
  caseDetail: document.querySelector('#caseDetail'),
  searchForm: document.querySelector('#searchForm'),
  caseSearch: document.querySelector('#caseSearch'),
  statusFilter: document.querySelector('#statusFilter'),
  totalCases: document.querySelector('#totalCases'),
  pendingCases: document.querySelector('#pendingCases'),
  selectedCase: document.querySelector('#selectedCase'),
  listInfo: document.querySelector('#listInfo'),
  pageLabel: document.querySelector('#pageLabel'),
  prevPage: document.querySelector('#prevPage'),
  nextPage: document.querySelector('#nextPage'),
  refreshButton: document.querySelector('#refreshButton'),
  signedInAs: document.querySelector('#signedInAs'),
  logoutButton: document.querySelector('#logoutButton'),
  toast: document.querySelector('#toast')
};
const CRITERIA = [
  ['verification', 'Patient verification'],
  ['accuracy', 'Information accuracy'],
  ['resolution', 'Appropriate resolution'],
  ['documentation', 'Documentation quality'],
  ['professionalism', 'Professionalism']
];
const state = { offset: 0, limit: 25, total: 0, selected: null, user: null };
let toastTimer = null;
function node(tag, className = '', text = null) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== null) n.textContent = String(text);
  return n;
}
function button(label, className, handler) {
  const b = node('button', className, label); b.type = 'button'; b.addEventListener('click', handler); return b;
}
function displayDate(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : d.toLocaleString();
}
function badge(value) {
  const labels = { pending_review: 'Pending review', approved: 'Approved', coaching: 'Needs coaching', flagged: 'Flagged' };
  return node('span', `qc-badge ${value}`, labels[value] || value);
}
function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 3300);
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); } catch (_) { throw Error('The Cricket backend is unavailable.'); }
  if (response.status === 401) { location.href = 'login.html?next=qc.html'; throw Error('Session expired'); }
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
async function loadCases() {
  els.caseList.replaceChildren(node('p', 'qc-empty', 'Loading cases...'));
  const params = new URLSearchParams({ search: els.caseSearch.value.trim(), status: els.statusFilter.value, limit: String(state.limit), offset: String(state.offset) });
  try {
    const data = await api('/api/cases?' + params.toString());
    state.total = data.total;
    els.totalCases.textContent = String(data.total);
    els.pendingCases.textContent = String(data.cases.filter(x => x.reviewStatus === 'pending_review').length) + ' on page';
    els.listInfo.textContent = `${data.cases.length} displayed`;
    els.caseList.replaceChildren();
    if (!data.cases.length) els.caseList.append(node('p', 'qc-empty', 'No cases match the current search.'));
    for (const item of data.cases) {
      const card = button('', 'qc-case' + (state.selected === item.caseId ? ' selected' : ''), () => selectCase(item.caseId));
      const top = node('div', 'qc-case-line');
      top.append(node('span', 'qc-case-id', item.caseId), badge(item.reviewStatus));
      card.append(top, node('strong', 'qc-case-route', item.inquiry), node('div', 'qc-case-meta', `${item.department} · ${item.agent} · ${displayDate(item.createdAt)}`));
      els.caseList.append(card);
    }
    els.prevPage.disabled = state.offset === 0;
    els.nextPage.disabled = state.offset + data.cases.length >= data.total;
    els.pageLabel.textContent = data.total ? `${state.offset + 1}–${state.offset + data.cases.length} of ${data.total}` : '0 cases';
  } catch (error) {
    els.caseList.replaceChildren(node('p', 'qc-empty', error.message));
    toast(error.message);
  }
}
function fact(label, value) {
  const box = node('div');
  box.append(node('span', '', label), node('strong', '', value));
  return box;
}
function title(text) { return node('h3', 'qc-section-title', text); }
async function selectCase(caseId) {
  state.selected = caseId;
  els.selectedCase.textContent = caseId;
  els.caseDetail.replaceChildren(node('p', 'qc-empty', 'Loading case...'));
  for (const c of els.caseList.querySelectorAll('.qc-case')) c.classList.toggle('selected', c.querySelector('.qc-case-id')?.textContent === caseId);
  try {
    const data = await api('/api/cases/' + encodeURIComponent(caseId));
    renderCase(data);
  } catch (error) {
    els.caseDetail.replaceChildren(node('p', 'qc-empty', error.message));
    toast(error.message);
  }
}
function renderCase(data) {
  const item = data.case;
  els.caseDetail.replaceChildren();
  const head = node('div', 'qc-detail-header');
  const h = node('div'); h.append(node('div', 'qc-eyebrow', 'CASE REVIEW'), node('h2', '', item.caseId));
  head.append(h, badge(item.reviewStatus));
  const meta = node('div', 'qc-detail-meta');
  meta.append(fact('Agent', item.agent), fact('Department', item.department), fact('Inquiry', item.inquiry), fact('Outcome', item.outcome), fact('Created', displayDate(item.createdAt)), fact('Route', item.route));
  const note = node('div', 'qc-note', item.note);
  const timeline = node('ul', 'qc-timeline');
  for (const entry of item.events) timeline.append(node('li', '', entry));
  if (!item.events.length) timeline.append(node('li', '', 'No route events recorded.'));
  els.caseDetail.append(head, meta, title('Agent documentation'), note, title('Confirmed workflow actions'), timeline);
  if (data.reviews.length) {
    els.caseDetail.append(title('Previous QC evaluations'));
    for (const review of data.reviews) {
      const block = node('div', 'qc-review-history-item');
      block.append(node('strong', '', `${review.score}% · ${review.decision.replaceAll('_', ' ')}`), node('p', '', review.feedback || 'No reviewer comments.'), node('small', '', `${review.reviewer} · ${displayDate(review.created_at)}`));
      els.caseDetail.append(block);
    }
  }
  if (data.history.length) {
    els.caseDetail.append(title('Audit history'));
    const history = node('ul', 'qc-timeline');
    for (const entry of data.history) history.append(node('li', '', `${entry.action} — ${entry.actor} (${displayDate(entry.created_at)})`));
    els.caseDetail.append(history);
  }
  if (['qc', 'admin'].includes(state.user.role)) els.caseDetail.append(createReviewForm(item.caseId));
}
function createReviewForm(caseId) {
  const form = node('form', 'qc-review-form');
  form.append(title('New QC evaluation'), node('p', 'qc-muted', 'Choose Pass, Fail, or N/A for each criterion. The server calculates the score.'));
  const fieldset = node('fieldset');
  fieldset.append(node('legend', '', 'Quality criteria'));
  for (const [key, label] of CRITERIA) {
    const row = node('div', 'qc-criterion');
    row.append(node('span', '', label));
    const options = node('div', 'qc-criterion-options');
    for (const [value, text] of [['true', 'Pass'], ['false', 'Fail'], ['na', 'N/A']]) {
      const wrapper = node('label');
      const radio = node('input'); radio.type = 'radio'; radio.name = key; radio.value = value; radio.required = true;
      wrapper.append(radio, node('span', '', text)); options.append(wrapper);
    }
    row.append(options); fieldset.append(row);
  }
  form.append(fieldset);
  const decisionLabel = node('label', '', 'Review decision'); decisionLabel.htmlFor = 'qcDecision';
  const decision = node('select'); decision.id = 'qcDecision'; decision.required = true;
  for (const [value, text] of [['approved','Approved'],['coaching','Needs coaching'],['flagged','Flagged']]) { const opt = node('option', '', text); opt.value = value; decision.append(opt); }
  const feedbackLabel = node('label', '', 'Feedback for agent'); feedbackLabel.htmlFor = 'qcFeedback';
  const feedback = node('textarea'); feedback.id = 'qcFeedback'; feedback.maxLength = 2000; feedback.placeholder = 'Explain coaching opportunities, flagged concerns, or positive performance.';
  const actions = node('div', 'qc-review-actions');
  const scoreLabel = node('span', 'qc-review-score', 'Score: —');
  const submit = node('button', 'qc-btn qc-btn-primary', 'Save QC Evaluation'); submit.type = 'submit';
  actions.append(scoreLabel, submit);
  form.append(decisionLabel, decision, feedbackLabel, feedback, actions);
  function readCriteria() {
    const criteria = {};
    for (const [key] of CRITERIA) {
      const found = form.querySelector(`input[name="${key}"]:checked`);
      criteria[key] = found ? (found.value === 'na' ? null : found.value === 'true') : undefined;
    }
    return criteria;
  }
  fieldset.addEventListener('change', () => {
    const items = Object.values(readCriteria()).filter(x => x !== undefined && x !== null);
    scoreLabel.textContent = 'Score: ' + (items.length ? Math.round(items.filter(Boolean).length / items.length * 100) + '%' : '—');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const criteria = readCriteria();
    if (Object.values(criteria).includes(undefined)) { toast('Select every criterion (Pass, Fail or N/A).'); return; }
    if (Object.values(criteria).every(x => x === null)) { toast('Choose at least one applicable criterion.'); return; }
    submit.disabled = true;
    try {
      await api('/api/cases/' + encodeURIComponent(caseId) + '/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: decision.value, feedback: feedback.value, criteria })
      });
      toast('QC evaluation saved.');
      await Promise.all([selectCase(caseId), loadCases()]);
    } catch (error) { toast(error.message); submit.disabled = false; }
  });
  return form;
}
els.searchForm.addEventListener('submit', event => { event.preventDefault(); state.offset = 0; loadCases(); });
els.statusFilter.addEventListener('change', () => { state.offset = 0; loadCases(); });
els.prevPage.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadCases(); });
els.nextPage.addEventListener('click', () => { state.offset += state.limit; loadCases(); });
els.refreshButton.addEventListener('click', loadCases);
els.logoutButton.addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.href = 'login.html?next=qc.html'; } });
(async () => {
  try {
    const data = await api('/api/auth/me');
    if (!data.user) { location.replace('login.html?next=qc.html'); return; }
    state.user = data.user;
    els.signedInAs.textContent = `${data.user.email} · ${data.user.role.toUpperCase()}`;
    if (data.user.role === 'admin') document.querySelector('#staffLink').hidden = false;
    if (!['qc','admin'].includes(data.user.role)) {
      els.caseList.replaceChildren(node('p','qc-empty','Your account has no access to the QC review queue.'));
      return;
    }
    await loadCases();
    const id = new URLSearchParams(location.search).get('case');
    if (id && /^CR-\d{8}-\d{6,}$/.test(id)) await selectCase(id);
  } catch (error) {
    els.caseList.replaceChildren(node('p','qc-empty',error.message));
    toast(error.message);
  }
})();
