const el = (id) => document.getElementById(id);
let availableLanguages = [];
let availableModels = [];

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
  await wireImport();
}

// ---------------------------------------------------------------------------
// Import workbook
//
// Two steps on purpose: `preview` parses and reports, `commit` parses and
// writes. The file goes up as a raw body — it is one binary blob, so there is
// nothing multipart would add.
// ---------------------------------------------------------------------------
async function wireImport() {
  const { formats } = await api('/api/admin/import/formats');
  const sel = el('importFormat');
  for (const f of formats) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.label;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', syncImportOptions);
  el('importFile').addEventListener('change', () => {
    el('importCommitBtn').style.display = 'none';
    el('importResult').innerHTML = '';
  });
  el('importPreviewBtn').addEventListener('click', () => runImport('preview'));
  el('importCommitBtn').addEventListener('click', () => runImport('commit'));
  syncImportOptions();
}

function syncImportOptions() {
  const f = el('importFormat').value;
  el('importEvalOpts').style.display = f === 'combined' ? 'none' : 'flex';
  el('importCombinedOpts').style.display = f === 'combined' ? 'flex' : 'none';
}

async function runImport(step) {
  const file = el('importFile').files[0];
  const out = el('importResult');
  if (!file) {
    out.innerHTML = '<div class="error-msg">Choose an .xlsx file first.</div>';
    return;
  }
  const params = new URLSearchParams({ filename: file.name });
  if (el('importFormat').value) params.set('format', el('importFormat').value);
  if (el('importLanguage').value.trim()) params.set('language', el('importLanguage').value.trim());
  if (el('importSheet').value.trim()) params.set('sheet', el('importSheet').value.trim());
  if (el('importModel').value.trim()) params.set('model', el('importModel').value.trim());

  const btn = step === 'commit' ? el('importCommitBtn') : el('importPreviewBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = step === 'commit' ? 'Importing…' : 'Reading…';
  out.innerHTML = '';
  try {
    const res = await fetch(`/api/admin/import/${step}?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Import failed');
    renderImportSummary(data, step);
    if (step === 'preview') {
      el('importCommitBtn').style.display = 'inline-block';
    } else {
      el('importCommitBtn').style.display = 'none';
      await loadOverview();
      await loadUsers();
    }
  } catch (err) {
    out.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    el('importCommitBtn').style.display = 'none';
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function renderImportSummary(data, step) {
  const s = data.summary;
  const kv = (o) => Object.entries(o).map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ') || '—';
  const los = s.learningObjectives.length
    ? `<tr><th>Learning objectives</th><td>${s.learningObjectives
        .map((l) => `${escapeHtml(l.code)} [${escapeHtml(l.languages.join('+'))}]`)
        .join(', ')}</td></tr>`
    : '';
  const warnings = s.warnings.length
    ? `<div class="import-warnings"><strong>Notes</strong><ul>${s.warnings
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join('')}</ul></div>`
    : '';
  const sample = s.sample
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.model)}</td><td>${r.rowIndex}</td><td>${escapeHtml(r.grade || '')}</td>` +
        `<td>${escapeHtml(r.loCode || '')}${r.loLanguage ? ' · ' + escapeHtml(r.loLanguage) : ''}</td>` +
        `<td>${escapeHtml(r.question)}</td><td>${escapeHtml(r.answer)}</td></tr>`
    )
    .join('');
  const written = data.result
    ? `<div class="import-done">Imported: ${data.result.inserted} new row(s), ${data.result.updated} refreshed, ` +
      `${data.result.learningObjectives} learning objective(s).</div>`
    : '<div class="import-hint">Nothing has been written yet. Check the numbers below, then press “Import into database”.</div>';

  el('importResult').innerHTML = `
    ${step === 'commit' ? written : written}
    <table class="data-table import-summary">
      <tr><th>Format</th><td>${escapeHtml(s.format)}${data.detected ? ` (detected: ${escapeHtml(data.detected)})` : ''}</td></tr>
      <tr><th>Sheet</th><td>${escapeHtml(s.sheetName || s.sheetNames.join(', '))}</td></tr>
      <tr><th>Problems</th><td>${s.totalRows} (${s.hiddenRows} hidden from annotators, ${s.flaggedRows} flagged as failed/truncated)</td></tr>
      <tr><th>Models</th><td>${kv(s.byModel)}</td></tr>
      <tr><th>Languages</th><td>${kv(s.byLanguage)}</td></tr>
      ${Object.keys(s.byLoLanguage).length ? `<tr><th>LO wording</th><td>${kv(s.byLoLanguage)}</td></tr>` : ''}
      ${los}
      ${s.repairedCells ? `<tr><th>Repaired cells</th><td>${s.repairedCells} date-mangled answer(s) recovered</td></tr>` : ''}
    </table>
    ${warnings}
    <div class="qa-label" style="margin-top:12px">First rows</div>
    <table class="data-table">
      <thead><tr><th>Model</th><th>#</th><th>Grade</th><th>LO</th><th>Question</th><th>Answer</th></tr></thead>
      <tbody>${sample}</tbody>
    </table>
  `;
}

async function loadOverview() {
  const { overview } = await api('/api/admin/overview');
  const grid = el('overviewGrid');
  grid.innerHTML = '';
  const exportButtons = el('exportButtons');
  exportButtons.innerHTML = '';
  const deleteButtons = el('deleteButtons');
  deleteButtons.innerHTML = '';
  for (const stats of overview) {
    const label = `${stats.model} · ${stats.language}`;
    const card = document.createElement('div');
    card.className = 'overview-card';
    // Progress is per annotator: a double-annotated sheet gets one bar each,
    // so it is obvious at a glance who has finished and who has not.
    const annotators = (stats.annotators || []).slice().sort((a, b) => b.reviewed - a.reviewed);
    const bars = annotators
      .map((a) => {
        const pct = stats.total ? Math.round((a.reviewed / stats.total) * 100) : 0;
        return `
          <div class="annotator-row">
            <div class="who"><strong>${escapeHtml(a.displayName)}</strong><span>${a.reviewed} / ${stats.total} · ${a.flagged} flagged</span></div>
            <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
          </div>`;
      })
      .join('');
    card.innerHTML = `
      <div class="lang-name">${escapeHtml(label)}</div>
      <div style="font-size:12.5px;color:var(--text-dim)">${stats.total} problems &middot; ${annotators.length} annotator(s)</div>
      ${annotators.length ? `<div class="annotator-rows">${bars}</div>` : '<div class="no-annotators">Not started yet.</div>'}
    `;
    grid.appendChild(card);

    const btn = document.createElement('button');
    btn.className = 'btn secondary';
    btn.textContent = `Export ${label}`;
    btn.addEventListener('click', () => {
      window.location.href = `/api/admin/export/${encodeURIComponent(stats.model)}/${encodeURIComponent(stats.language)}`;
    });
    exportButtons.appendChild(btn);

    // Clearing a sheet imported wrongly. Deleting rows cascades to their
    // annotations, so confirm with the actual counts rather than a bare yes.
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = `Delete ${label}`;
    del.addEventListener('click', () => deleteDataset(stats));
    deleteButtons.appendChild(del);
  }
}

async function deleteDataset(stats) {
  const annotators = (stats.annotators || []).reduce((n, a) => n + a.reviewed, 0);
  const ok = confirm(
    `Delete all ${stats.total} imported problems for ${stats.model} · ${stats.language}?\n\n` +
      `This also deletes ${annotators} saved annotation(s) on them. This cannot be undone.`
  );
  if (!ok) return;
  try {
    await api(
      `/api/admin/data/${encodeURIComponent(stats.model)}/${encodeURIComponent(stats.language)}?confirmRows=${stats.total}`,
      { method: 'DELETE' }
    );
    await loadOverview();
    await loadUsers();
  } catch (err) {
    alert(err.message);
  }
}

async function loadUsers() {
  const { users, availableLanguages: langs, availableModels: models } = await api('/api/admin/users');
  availableLanguages = langs;
  availableModels = models;
  renderNewUserLangs();
  renderNewUserModels();

  const body = el('usersBody');
  body.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    const modelTags = u.isAdmin
      ? '<span class="tag">ALL</span>'
      : u.models.map((m) => `<span class="tag">${escapeHtml(m)}</span>`).join('');
    const langTags = u.isAdmin
      ? '<span class="tag">ALL</span>'
      : u.languages.map((l) => `<span class="tag">${escapeHtml(l)}</span>`).join('');
    tr.innerHTML = `
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.displayName || '')}</td>
      <td>${modelTags}</td>
      <td>${langTags}</td>
      <td class="toggle-cell"></td>
      <td>${u.reviewedCount || 0}</td>
      <td>${u.isAdmin ? 'Yes' : 'No'}</td>
      <td>${u.active ? 'Active' : 'Disabled'}</td>
      <td></td>
    `;
    const seesModelTd = tr.children[4];
    const actionsTd = tr.lastElementChild;

    // Whether this annotator is told which LLM generated each problem. Admins
    // always see it; for everyone else it is this switch.
    if (u.isAdmin) {
      seesModelTd.textContent = 'Yes (admin)';
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = u.canSeeModel;
      cb.title = u.canSeeModel
        ? 'This annotator sees the model name. Uncheck to hide it.'
        : 'Model name is hidden from this annotator (shown as "Set 1", "Set 2", ...).';
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ canSeeModel: cb.checked }) });
          loadUsers();
        } catch (err) {
          cb.checked = !cb.checked;
          cb.disabled = false;
          alert(err.message);
        }
      });
      seesModelTd.appendChild(cb);
    }

    if (!u.isAdmin) {
      const editModelsBtn = document.createElement('button');
      editModelsBtn.className = 'btn ghost';
      editModelsBtn.textContent = 'Edit models';
      editModelsBtn.addEventListener('click', () => editModels(u));
      actionsTd.appendChild(editModelsBtn);

      const editBtn = document.createElement('button');
      editBtn.className = 'btn ghost';
      editBtn.textContent = 'Edit languages';
      editBtn.style.marginLeft = '6px';
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

async function editModels(u) {
  const current = u.models.join(', ');
  const input = prompt(`Models for ${u.username} (comma-separated, from: ${availableModels.join(', ')})`, current);
  if (input === null) return;
  const models = input.split(',').map((s) => s.trim()).filter(Boolean);
  await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ models }) });
  loadUsers();
}

function renderNewUserLangs() {
  const wrap = el('newUserLangs');
  wrap.innerHTML = availableLanguages
    .map((l) => `<label><input type="checkbox" value="${escapeHtml(l)}" /> ${escapeHtml(l)}</label>`)
    .join('');
}

function renderNewUserModels() {
  const wrap = el('newUserModels');
  wrap.innerHTML = availableModels
    .map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}" /> ${escapeHtml(m)}</label>`)
    .join('');
}

async function addUser() {
  el('addUserError').innerHTML = '';
  const username = el('newUsername').value.trim();
  const displayName = el('newDisplayName').value.trim();
  const password = el('newPassword').value;
  const isAdmin = el('newUserAdmin').checked;
  const languages = Array.from(el('newUserLangs').querySelectorAll('input:checked')).map((i) => i.value);
  const models = Array.from(el('newUserModels').querySelectorAll('input:checked')).map((i) => i.value);
  const canSeeModel = el('newUserSeesModel').checked;

  if (!username || !password) {
    el('addUserError').innerHTML = '<div class="error-msg">Username and password are required.</div>';
    return;
  }
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, displayName, password, isAdmin, languages, models, canSeeModel }),
    });
    el('newUsername').value = '';
    el('newDisplayName').value = '';
    el('newPassword').value = '';
    el('newUserAdmin').checked = false;
    el('newUserSeesModel').checked = true;
    el('newUserLangs').querySelectorAll('input:checked').forEach((i) => (i.checked = false));
    el('newUserModels').querySelectorAll('input:checked').forEach((i) => (i.checked = false));
    loadUsers();
  } catch (err) {
    el('addUserError').innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init().catch((err) => console.error(err));
