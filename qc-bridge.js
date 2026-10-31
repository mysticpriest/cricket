/* Cricket Inbound → Quality Control submission bridge.
   The backend must be running. No browser-side API secrets. */
(() => {
  'use strict';

  const api = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', ...options });
    let data;
    try { data = await response.json(); }
    catch (_) { throw Error('Case server unavailable'); }
    if (!response.ok) throw Error(data.error || 'Case request failed');
    return data;
  };

  let account = null;
  const banner = document.createElement('div');
  banner.className = 'cricket-qc-account';
  banner.setAttribute('aria-live', 'polite');
  banner.style.cssText = 'margin:12px 0;padding:11px 14px;border:1px solid #bfdbfe;border-radius:9px;background:#eff6ff;font:600 12px/1.7 "DM Sans",sans-serif;color:#1e40af;';
  banner.textContent = 'QC connection: checking sign-in...';
  const top = document.querySelector('.workflow-top');
  if (top) top.insertAdjacentElement('afterend', banner);

  function makeLink(url, label) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = label;
    a.style.cssText = 'color:#1d4ed8;text-decoration:underline;margin-left:8px;';
    return a;
  }

  async function checkAccount() {
    try {
      const { user } = await api('/api/auth/me');
      account = user;
      banner.replaceChildren();
      if (account && (account.role === 'agent' || account.role === 'admin')) {
        banner.append(document.createTextNode(`QC sync ready · ${account.email}`));
        banner.append(makeLink('qc.html', 'QC workspace'));
      } else if (account) {
        banner.append(document.createTextNode('Signed in with a QC reviewer account. Sign in as an agent to submit new cases.'));
      } else {
        banner.append(document.createTextNode('Case sync inactive. Sign in before handling calls to save cases for QC review.'));
        banner.append(makeLink('login.html?next=inbound.html', 'Sign in'));
      }
    } catch (_) {
      account = null;
      banner.replaceChildren(document.createTextNode('Case server offline — call notes will remain local only. Run Cricket through its backend to enable shared cases.'));
    }
    return account;
  }

  async function submitCase(payload, host) {
    if (!payload || typeof payload.note !== 'string') throw Error('Missing call documentation');
    let output = host && host.querySelector('.cricket-qc-result');
    if (!output) {
      output = document.createElement('div');
      output.className = 'cricket-qc-result';
      output.setAttribute('role', 'status');
      output.style.cssText = 'margin-top:14px;border-radius:10px;padding:14px 16px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font:700 12px/1.7 "DM Sans",sans-serif;';
      if (host) host.append(output);
    }
    output.textContent = 'Submitting case to QC...';
    try {
      const result = await api('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      output.replaceChildren(document.createTextNode(`Case saved for QC · ${result.caseId}`));
      output.append(makeLink(`qc.html?case=${encodeURIComponent(result.caseId)}`, 'Open case'));
      return result;
    } catch (error) {
      output.replaceChildren(document.createTextNode('QC case was NOT saved: ' + error.message + '.'));
      if (error.message === 'Sign in required') {
        output.append(makeLink('login.html?next=inbound.html', 'Sign in'));
      }
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry QC submission';
      retry.style.cssText = 'display:inline-block;margin-left:10px;padding:6px 10px;border:1px solid #93c5fd;border-radius:6px;color:#1d4ed8;background:#fff;cursor:pointer;';
      retry.addEventListener('click', () => submitCase(payload, host));
      output.append(retry);
      // Preserve edited note in the existing shift log; no silent success.
      return null;
    }
  }

  window.CricketCaseBridge = { submitCase, checkAccount };
  checkAccount();
})();
