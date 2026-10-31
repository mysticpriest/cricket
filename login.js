'use strict';
const loginForm = document.querySelector('#loginForm');
const loginMessage = document.querySelector('#loginMessage');
const loginButton = document.querySelector('#loginButton');
const destination = (() => {
  const requested = new URLSearchParams(location.search).get('next');
  return requested === 'qc.html' || requested === 'inbound.html' ? requested : 'index.html';
})();
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}
(async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user) location.replace(destination);
  } catch (_) {
    loginMessage.textContent = 'The Cricket case server is unavailable. Start the backend locally before signing in.';
  }
})();
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginButton.disabled = true;
  loginMessage.textContent = '';
  try {
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
    });
    location.assign(destination === 'qc.html' && user.role === 'agent' ? 'inbound.html' : destination);
  } catch (error) {
    loginMessage.textContent = error.message === 'Failed to fetch' ? 'Cannot reach the Cricket backend.' : error.message;
    loginButton.disabled = false;
  }
});
