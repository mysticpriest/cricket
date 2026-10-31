'use strict';

const form = document.querySelector('#staffForm');
const list = document.querySelector('#staffList');
const message = document.querySelector('#staffMessage');
const create = document.querySelector('#createStaff');

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  let data;
  try { data = await response.json(); }
  catch (_) { throw Error('Cricket backend unavailable'); }
  if (response.status === 401) {
    location.replace('login.html?next=staff.html');
    throw Error('Sign in required');
  }
  if (!response.ok) throw Error(data.error || 'Request failed');
  return data;
}

function node(tag, text, css) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (css) element.style.cssText = css;
  return element;
}
function showMessage(text, good) {
  message.textContent = text;
  message.style.color = good ? '#166534' : '#b91c1c';
}
function showEmployee(user) {
  const container = node('div', undefined, 'padding:16px 0;border-bottom:1px solid #e2e8f0;');
  const top = node('div', undefined, 'display:flex;align-items:center;justify-content:space-between;gap:12px;');
  const left = node('div', undefined, 'min-width:0;flex:1;');
  const name = node('strong', user.displayName || 'Name not set', 'display:block;font-size:13px;color:#1f2937;overflow-wrap:anywhere;');
  const email = node('span', user.email, 'display:block;margin-top:5px;font-size:11px;color:#64748b;overflow-wrap:anywhere;');
  left.append(name, email);
  const badge = node('span', user.role.toUpperCase(), 'background:#eff6ff;color:#1d4ed8;border-radius:15px;padding:7px 10px;font-weight:800;font-size:10px;white-space:nowrap;');
  top.append(left, badge);
  const edit = node('button', 'Edit name', 'display:inline-flex;margin-top:10px;padding:6px 0;border:0;background:none;color:#2563eb;font-weight:800;font-size:11px;cursor:pointer;');
  edit.type = 'button';

  edit.addEventListener('click', () => {
    edit.hidden = true;
    const editor = node('form', undefined, 'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px;');
    const field = node('input');
    field.type = 'text';
    field.required = true;
    field.minLength = 2;
    field.maxLength = 80;
    field.value = user.displayName || '';
    field.placeholder = 'Employee full name';
    field.setAttribute('aria-label', 'Employee name for ' + user.email);
    field.style.cssText = 'flex:1;min-width:150px;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;';

    const save = node('button', 'Save name', 'padding:10px 13px;border:0;background:#2563eb;color:#fff;border-radius:8px;font-weight:800;font-size:11px;cursor:pointer;');
    save.type = 'submit';
    const cancel = node('button', 'Cancel', 'padding:10px;border:1px solid #e2e8f0;background:#fff;color:#64748b;border-radius:8px;font-size:11px;cursor:pointer;');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { editor.remove(); edit.hidden = false; });
    const feedback = node('p', '', 'font-size:11px;color:#b91c1c;flex-basis:100%;margin:0;');
    feedback.setAttribute('role', 'status');

    editor.append(field, save, cancel, feedback);
    editor.addEventListener('submit', async event => {
      event.preventDefault();
      save.disabled = true;
      feedback.textContent = '';
      try {
        await request('/api/users/' + user.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: field.value })
        });
        await reload();
        showMessage('Employee display name updated. The new name appears at the next dashboard refresh.', true);
      } catch (error) {
        feedback.textContent = error.message;
        save.disabled = false;
      }
    });
    container.append(editor);
    field.focus();
    field.select();
  });
  container.append(top, edit);
  return container;
}

async function reload() {
  const { users } = await request('/api/users');
  list.replaceChildren();
  if (!users.length) list.append(node('p', 'No employee accounts created yet.', 'font-size:12px;color:#64748b;'));
  else for (const employee of users) list.append(showEmployee(employee));
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  create.disabled = true;
  showMessage('', false);
  try {
    const payload = {
      displayName: document.querySelector('#newName').value,
      email: document.querySelector('#newEmail').value,
      password: document.querySelector('#newPassword').value,
      role: document.querySelector('#newRole').value
    };
    await request('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    form.reset();
    showMessage('Employee account created successfully.', true);
    await reload();
  } catch (error) {
    showMessage(error.message, false);
  } finally {
    create.disabled = false;
  }
});
(async () => {
  try {
    const { user } = await request('/api/auth/me');
    if (!user) { location.replace('login.html?next=staff.html'); return; }
    if (user.role !== 'admin') {
      list.textContent = 'Administrator access required.';
      form.hidden = true;
      return;
    }
    await reload();
  } catch (error) { list.textContent = error.message; }
})();