'use strict';
const form = document.querySelector('#loginForm');
const message = document.querySelector('#loginMessage');
const submit = document.querySelector('#loginButton');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const nextAllowed = {
  'index.html': ['agent','qc','admin'],
  'inbound.html': ['agent','admin'],
  'outbound.html': ['agent','admin'],
  'cases.html': ['agent','admin'],
  'qc.html': ['qc','admin'],
  'staff.html': ['admin']
};
const requested = new URLSearchParams(location.search).get('next');
const destination = Object.hasOwn(nextAllowed, requested) ? requested : 'index.html';
async function api(path, options = {}) {
  const response = await fetch(path, { credentials:'same-origin', ...options });
  let data = {};
  try { data = await response.json(); }
  catch (_) { throw Error('The Cricket backend is unavailable.'); }
  if (!response.ok) throw Error(data.error || 'Sign-in request failed.');
  return data;
}
function goToAuthorizedDestination(user) {
  if (!user || !user.role) throw Error('Employee account could not be verified.');
  const safe = nextAllowed[destination].includes(user.role) ? destination : 'index.html';
  location.replace(safe);
}
document.querySelector('#togglePassword').addEventListener('click', event => {
  const showing = passwordInput.type === 'text';
  passwordInput.type = showing ? 'password' : 'text';
  event.currentTarget.textContent = showing ? 'Show' : 'Hide';
  event.currentTarget.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});
(async () => {
  try {
    const data = await api('/api/auth/me');
    if (data.user) goToAuthorizedDestination(data.user);
  } catch (_) {
    message.textContent = 'Unable to contact the Cricket server. Confirm that npm.cmd start is running.';
  }
})();
form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  if (!emailInput.validity.valid || !passwordInput.value) {
    message.textContent = 'Enter a valid work email and your password.';
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const data = await api('/api/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:emailInput.value.trim(),password:passwordInput.value})
    });
    goToAuthorizedDestination(data.user);
  } catch (error) {
    message.textContent = error.message === 'Failed to fetch' ? 'Cannot reach the Cricket server.' : error.message;
    submit.disabled = false;
    submit.textContent = 'Sign in to Cricket →';
  }
});