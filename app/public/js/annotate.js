const state = {
  user: null,
  flagDefs: [],
  language: null,
  list: [], // [{id,row_index,status,flagged}]
  filter: 'all',
  currentRowIndex: null,
  currentRow: null, // full detail of loaded row
  dirty: false,
  saving: false,
};

const el = (id) => document.getElementById(id);

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = 'index.html';
    throw new Error('Not logged in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function init() {
  const { user } = await api('/api/me');
  if (!user) return (window.location.href = 'index.html');
  state.user = user;
  el('userChip').textContent = `${user.displayName || user.username}${user.isAdmin ? ' (admin)' : ''}`;

  const { flags } = await api('/api/flags');
  state.flagDefs = flags;

  const { languages } = await api('/api/languages');
  if (languages.length === 0) {
    showEmpty('No languages are assigned to your account yet. Ask your admin for access.');
    return;
  }

  const saved = localStorage.getItem('mwp_lang_' + user.username);
  if (languages.length === 1) {
    await selectLanguage(languages[0].language);
  } else if (saved && languages.some((l) => l.language === saved)) {
    await selectLanguage(saved);
  } else {
    renderLanguagePicker(languages);
  }

  wireStaticEvents();
}

function showEmpty(msg) {
  el('emptyView').style.display = 'block';
  el('emptyView').textContent = msg;
}

function renderLanguagePicker(languages) {
  el('pickerView').style.display = 'block';
  el('layoutView').style.display = 'none';
  const grid = el('langPickerGrid');
  grid.innerHTML = '';
  for (const l of languages) {
    const pct = l.total ? Math.round((l.done / l.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'lang-card';
    card.innerHTML = `
      <h3>${escapeHtml(l.language)}</h3>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">${l.done} / ${l.total} reviewed &middot; ${l.flagged} flagged</div>
      <button class="btn block">Start annotating</button>
    `;
    card.querySelector('button').addEventListener('click', () => selectLanguage(l.language));
    grid.appendChild(card);
  }
}

async function selectLanguage(language) {
  state.language = language;
  localStorage.setItem('mwp_lang_' + state.user.username, language);
  el('pickerView').style.display = 'none';
  el('layoutView').style.display = 'grid';
  el('progressWrap').style.display = 'flex';

  const { languages } = await api('/api/languages');
  if (languages.length > 1) {
    el('langSelect').style.display = 'inline-block';
    el('langBadge').style.display = 'none';
    const sel = el('langSelect');
    sel.innerHTML = languages.map((l) => `<option value="${l.language}">${l.language}</option>`).join('');
    sel.value = language;
  } else {
    el('langBadge').style.display = 'inline-block';
    el('langBadge').textContent = language;
    el('langSelect').style.display = 'none';
  }

  await refreshList();
  const savedRow = Number(localStorage.getItem('mwp_row_' + state.user.username + '_' + language));
  const firstPending = state.list.find((r) => r.status !== 'reviewed');
  const startRow = savedRow && state.list.some((r) => r.row_index === savedRow)
    ? savedRow
    : (firstPending ? firstPending.row_index : (state.list[0] ? state.list[0].row_index : null));
  if (startRow) await loadRow(startRow);
}

async function refreshList() {
  const { items } = await api(`/api/rows/${encodeURIComponent(state.language)}/list`);
  state.list = items;
  renderGridNav();
  renderProgress();
}

function renderProgress() {
  const total = state.list.length;
  const done = state.list.filter((r) => r.status === 'reviewed').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  el('progressFill').style.width = pct + '%';
  el('progressText').textContent = `${done} / ${total} reviewed`;
}

function filteredList() {
  if (state.filter === 'pending') return state.list.filter((r) => r.status !== 'reviewed');
  if (state.filter === 'reviewed') return state.list.filter((r) => r.status === 'reviewed');
  if (state.filter === 'flagged') return state.list.filter((r) => r.flagged);
  return state.list;
}

function renderGridNav() {
  const grid = el('gridNav');
  grid.innerHTML = '';
  el('navCount').textContent = state.list.length;
  const flist = filteredList();
  const visible = new Set(flist.map((r) => r.row_index));
  for (const r of state.list) {
    const cell = document.createElement('div');
    let cls = 'grid-cell ';
    cls += r.status === 'reviewed' ? (r.flagged ? 'reviewed-flagged' : 'reviewed-clean') : 'pending';
    if (r.row_index === state.currentRowIndex) cls += ' current';
    if (!visible.has(r.row_index)) cell.style.opacity = '0.25';
    cell.className = cls;
    cell.textContent = r.row_index;
    cell.title = `Row ${r.row_index} — ${r.status}${r.flagged ? ', flagged' : ''}`;
    cell.addEventListener('click', () => goToRow(r.row_index));
    grid.appendChild(cell);
  }
}

async function goToRow(rowIndex) {
  await maybeAutosave();
  await loadRow(rowIndex);
}

async function loadRow(rowIndex) {
  const { row, total } = await api(`/api/rows/${encodeURIComponent(state.language)}/${rowIndex}`);
  state.currentRow = row;
  state.currentRowIndex = rowIndex;
  state.dirty = false;
  localStorage.setItem('mwp_row_' + state.user.username + '_' + state.language, rowIndex);

  el('pillGrade').textContent = row.grade ? `Grade ${row.grade}` : 'Grade —';
  el('pillTopic').textContent = row.topic || '';
  el('pillTopic').title = row.topic || '';
  el('rowIndexPill').textContent = `Row ${rowIndex} of ${total}`;
  setStatusBadge(row.status);

  el('parseWarning').style.display = row.parseError ? 'block' : 'none';
  el('questionText').textContent = row.question || '(empty)';
  el('answerText').textContent = row.answer || (row.parseError ? '(missing — cut off in source data)' : '(empty)');

  renderFlags(row.flags);
  el('commentsBox').value = row.comments || '';
  el('saveStatus').textContent = '';
  el('saveStatus').className = 'save-status';

  document.querySelectorAll('#flagsGrid input').forEach((cb) => cb.addEventListener('change', markDirty));
  el('commentsBox').oninput = markDirty;

  renderGridNav();
  const cur = grid_scrollToCurrent();
  updatePrevNextEnabled();
}

function grid_scrollToCurrent() {
  const current = el('gridNav').querySelector('.current');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

function setStatusBadge(status) {
  const badge = el('statusBadge');
  badge.textContent = status === 'reviewed' ? 'Reviewed' : 'Pending';
  badge.className = 'status-badge ' + (status === 'reviewed' ? 'reviewed' : 'pending');
}

function renderFlags(flagValues) {
  const grid = el('flagsGrid');
  grid.innerHTML = '';
  for (const f of state.flagDefs) {
    const wrap = document.createElement('label');
    wrap.className = 'flag-item' + (flagValues[f.key] ? ' checked' : '');
    wrap.innerHTML = `
      <input type="checkbox" data-key="${f.key}" ${flagValues[f.key] ? 'checked' : ''} />
      <span>
        <div class="flabel">${escapeHtml(f.label)} <a href="#" class="finfo" title="View definition & example">ⓘ</a></div>
        <div class="fhint">${escapeHtml(f.hint)}</div>
      </span>
    `;
    wrap.querySelector('.finfo').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.openReferenceModal('categories', f.key);
    });
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => {
      wrap.classList.toggle('checked', input.checked);
    });
    grid.appendChild(wrap);
  }
}

function markDirty() {
  state.dirty = true;
  el('saveStatus').textContent = 'Unsaved changes';
  el('saveStatus').className = 'save-status';
}

function collectForm() {
  const flags = {};
  document.querySelectorAll('#flagsGrid input').forEach((cb) => {
    flags[cb.dataset.key] = cb.checked;
  });
  return { flags, comments: el('commentsBox').value };
}

async function saveRow() {
  if (!state.currentRow || state.saving) return;
  state.saving = true;
  const { flags, comments } = collectForm();
  try {
    const { row } = await api(`/api/rows/${state.currentRow.id}`, {
      method: 'PUT',
      body: JSON.stringify({ flags, comments, status: 'reviewed' }),
    });
    state.currentRow = row;
    state.dirty = false;
    setStatusBadge(row.status);
    el('saveStatus').textContent = 'Saved ✓';
    el('saveStatus').className = 'save-status ok';
    const item = state.list.find((r) => r.row_index === state.currentRowIndex);
    if (item) {
      item.status = row.status;
      item.flagged = Object.values(row.flags).some(Boolean);
    }
    renderGridNav();
    renderProgress();
  } finally {
    state.saving = false;
  }
}

async function maybeAutosave() {
  if (state.dirty) await saveRow();
}

function currentPosInFiltered() {
  const flist = filteredList();
  return flist.findIndex((r) => r.row_index === state.currentRowIndex);
}

function updatePrevNextEnabled() {
  const flist = filteredList();
  const pos = currentPosInFiltered();
  el('prevBtn').disabled = !(pos > 0);
  el('saveNextBtn').textContent = pos >= 0 && pos < flist.length - 1 ? 'Save & Next →' : 'Save (last row)';
}

async function goNext() {
  const flist = filteredList();
  const pos = currentPosInFiltered();
  const nextItem = pos >= 0 && pos < flist.length - 1 ? flist[pos + 1] : null;
  if (nextItem) await goToRow(nextItem.row_index);
}

async function goPrev() {
  const flist = filteredList();
  const pos = currentPosInFiltered();
  const prevItem = pos > 0 ? flist[pos - 1] : null;
  if (prevItem) await goToRow(prevItem.row_index);
}

function wireStaticEvents() {
  el('logoutBtn').addEventListener('click', async () => {
    await maybeAutosave();
    await api('/api/logout', { method: 'POST' });
    window.location.href = 'index.html';
  });

  el('langSelect').addEventListener('change', async (e) => {
    await maybeAutosave();
    await selectLanguage(e.target.value);
  });

  el('filterRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    document.querySelectorAll('#filterRow .chip').forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderGridNav();
    updatePrevNextEnabled();
  });

  el('jumpInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const n = Number(el('jumpInput').value);
    if (!n || !state.list.some((r) => r.row_index === n)) return;
    await goToRow(n);
    el('jumpInput').value = '';
  });

  el('prevBtn').addEventListener('click', async () => {
    await maybeAutosave();
    await goPrev();
  });
  el('saveBtn').addEventListener('click', saveRow);
  el('saveNextBtn').addEventListener('click', async () => {
    await saveRow();
    await goNext();
  });
  el('clearBtn').addEventListener('click', async () => {
    document.querySelectorAll('#flagsGrid input').forEach((cb) => {
      cb.checked = false;
      cb.closest('.flag-item').classList.remove('checked');
    });
    markDirty();
    await saveRow();
    await goNext();
  });

  document.addEventListener('keydown', async (e) => {
    const tag = document.activeElement.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        await saveRow();
        await goNext();
      }
      return;
    }
    if (e.key === 'ArrowRight') {
      await maybeAutosave();
      await goNext();
    } else if (e.key === 'ArrowLeft') {
      await maybeAutosave();
      await goPrev();
    } else if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      await saveRow();
      await goNext();
    } else if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      el('clearBtn').click();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init().catch((err) => {
  console.error(err);
  showEmpty('Something went wrong loading the app: ' + err.message);
});
