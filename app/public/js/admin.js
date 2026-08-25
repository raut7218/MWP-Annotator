const el = (id) => document.getElementById(id);
let availableLanguages = [];

async function api(url, opts) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) return (window.location.href = 'index.html');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function init() {
  const { user } = await api('/api/me');
  if (!user) return (window.location.href = 'index.html');
  if (!user.isAdmin) return (window.location.href = 'annotate.html');
  el('userChip').textContent = user.displayName || user.username;

  el('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = 'index.html';
  });

  await loadOverview();
  await loadUsers();

  el('exportAllBtn').addEventListener('click', () => {
    window.location.href = '/api/admin/export-all';
  });

  el('addUserBtn').addEventListener('click', addUser);
}

async function loadOverview() {
  const { overview } = await api('/api/admin/overview');
  const grid = el('overviewGrid');
  grid.innerHTML = '';
  const exportButtons = el('exportButtons');
  exportButtons.innerHTML = '';
  for (const [lang, stats] of Object.entries(overview)) {
    const pct = stats.total ? Math.round(((stats.reviewed || 0) / stats.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'overview-card';
    card.innerHTML = `
      <div class="lang-name">${escapeHtml(lang)}</div>
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div style="font-size:12.5px;color:var(--text-dim)">${stats.reviewed || 0} / ${stats.total} reviewed (${pct}%)</div>
    `;
    grid.appendChild(card);

    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = `Export ${lang}`;
    btn.addEventListener('click', () => {
      window.location.href = `/api/admin/export/${encodeURIComponent(lang)}`;
    });
    exportButtons.appendChild(btn);
  }
}

async function loadUsers() {
  const { users, availableLanguages: langs } = await api('/api/admin/users');
  availableLanguages = langs;
  renderNewUserLangs();

  const body = el('usersBody');
  body.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    const langTags = u.isAdmin
      ? '<span class="tag">ALL</span>'
      : u.languages.map((l) => `<span class="tag">${escapeHtml(l)}</span>`).join('');
    tr.innerHTML = `
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.displayName || '')}</td>
      <td>${langTags}</td>
      <td>${u.isAdmin ? 'Yes' : 'No'}</td>
      <td>${u.active ? 'Active' : 'Disabled'}</td>
      <td></td>
    `;
    const actionsTd = tr.lastElementChild;

    if (!u.isAdmin) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn ghost';
      editBtn.textContent = 'Edit languages';
      editBtn.addEventListener('click', () => editLanguages(u));
      actionsTd.appendChild(editBtn);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn ghost';
    toggleBtn.textContent = u.active ? 'Disable' : 'Enable';
    toggleBtn.style.marginLeft = '6px';
    toggleBtn.addEventListener('click', async () => {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
      loadUsers();
    });
    actionsTd.appendChild(toggleBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn ghost';
    resetBtn.textContent = 'Reset password';
    resetBtn.style.marginLeft = '6px';
    resetBtn.addEventListener('click', async () => {
      const pw = prompt(`New password for ${u.username}:`);
      if (!pw) return;
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ password: pw }) });
      alert('Password updated.');
    });
    actionsTd.appendChild(resetBtn);

    body.appendChild(tr);
  }
}

async function editLanguages(u) {
  const current = u.languages.join(', ');
  const input = prompt(`Languages for ${u.username} (comma-separated, from: ${availableLanguages.join(', ')})`, current);
  if (input === null) return;
  const langs = input.split(',').map((s) => s.trim()).filter(Boolean);
  await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ languages: langs }) });
  loadUsers();
}

function renderNewUserLangs() {
  const wrap = el('newUserLangs');
  wrap.innerHTML = availableLanguages
    .map((l) => `<label><input type="checkbox" value="${escapeHtml(l)}" /> ${escapeHtml(l)}</label>`)
    .join('');
}

async function addUser() {
  el('addUserError').innerHTML = '';
  const username = el('newUsername').value.trim();
  const displayName = el('newDisplayName').value.trim();
  const password = el('newPassword').value;
  const isAdmin = el('newUserAdmin').checked;
  const languages = Array.from(el('newUserLangs').querySelectorAll('input:checked')).map((i) => i.value);

  if (!username || !password) {
    el('addUserError').innerHTML = '<div class="error-msg">Username and password are required.</div>';
    return;
  }
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, displayName, password, isAdmin, languages }),
    });
    el('newUsername').value = '';
    el('newDisplayName').value = '';
    el('newPassword').value = '';
    el('newUserAdmin').checked = false;
    el('newUserLangs').querySelectorAll('input:checked').forEach((i) => (i.checked = false));
    loadUsers();
  } catch (err) {
    el('addUserError').innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init().catch((err) => console.error(err));
