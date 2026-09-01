const state = {
  user: null,
  flagDefs: [],
  model: null, // { ref, label, name } — `ref` is what the API is addressed by
  language: null,
  list: [], // [{id,row_index,grade,loLanguage,status,flagged}]
  filter: 'all',
  loFilter: 'all',
  currentRowIndex: null,
  currentRow: null, // full detail of loaded row
  dirty: false,
  saving: false,
};

let errorCategoriesCache = null;

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

// The model a problem came from is addressed by an opaque ref, never by name:
// annotators whose account has model visibility switched off must not be able
// to read it out of a URL or a stored key either.
const modelKey = (suffix) => `mwp_${suffix}_${state.user.username}_${state.model.ref}`;

async function init() {
  const { user } = await api('/api/me');
  if (!user) return (window.location.href = 'index.html');
  state.user = user;
  el('userChip').textContent = `${user.displayName || user.username}${user.isAdmin ? ' (admin)' : ''}`;

  const { flags } = await api('/api/flags');
  state.flagDefs = flags;

  const { models } = await api('/api/models');
  if (models.length === 0) {
    showEmpty('No models are assigned to your account yet. Ask your admin for access.');
    return;
  }

  wireStaticEvents();

  const savedRef = localStorage.getItem('mwp_model_' + user.username);
  const saved = models.find((m) => m.ref === savedRef);
  if (models.length === 1) {
    await selectModel(models[0]);
  } else if (saved) {
    await selectModel(saved);
  } else {
    renderModelPicker(models);
  }
}

function showEmpty(msg) {
  el('emptyView').style.display = 'block';
  el('emptyView').textContent = msg;
}

function renderModelPicker(models) {
  el('modelPickerView').style.display = 'block';
  el('pickerView').style.display = 'none';
  el('layoutView').style.display = 'none';
  const grid = el('modelPickerGrid');
  grid.innerHTML = '';
  for (const m of models) {
    const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'lang-card';
    card.innerHTML = `
      <h3>${escapeHtml(m.label)}</h3>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">${m.done} / ${m.total} reviewed &middot; ${m.flagged} flagged</div>
      <button class="btn block">Choose</button>
    `;
    card.querySelector('button').addEventListener('click', () => selectModel(m));
    grid.appendChild(card);
  }
}

async function selectModel(model) {
  state.model = model;
  localStorage.setItem('mwp_model_' + state.user.username, model.ref);
  el('modelPickerView').style.display = 'none';

  const { models } = await api('/api/models');
  const current = models.find((m) => m.ref === model.ref) || model;
  state.model = current;
  if (models.length > 1) {
    el('modelSelect').style.display = 'inline-block';
    el('modelBadge').style.display = 'none';
    const sel = el('modelSelect');
    sel.innerHTML = models.map((m) => `<option value="${escapeHtml(m.ref)}">${escapeHtml(m.label)}</option>`).join('');
    sel.value = current.ref;
  } else {
    el('modelBadge').style.display = 'inline-block';
    el('modelBadge').textContent = current.label;
    el('modelSelect').style.display = 'none';
  }

  const { languages } = await api(`/api/models/${encodeURIComponent(current.ref)}/languages`);
  if (languages.length === 0) {
    el('pickerView').style.display = 'none';
    el('layoutView').style.display = 'none';
    showEmpty('No languages are assigned to your account for this model yet. Ask your admin for access.');
    return;
  }
  el('emptyView').style.display = 'none';

  const saved = localStorage.getItem(modelKey('lang'));
  if (languages.length === 1) {
    await selectLanguage(languages[0].language);
  } else if (saved && languages.some((l) => l.language === saved)) {
    await selectLanguage(saved);
  } else {
    renderLanguagePicker(languages);
  }
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
  localStorage.setItem(modelKey('lang'), language);
  el('pickerView').style.display = 'none';
  el('layoutView').style.display = 'grid';
  el('progressWrap').style.display = 'flex';

  const { languages } = await api(`/api/models/${encodeURIComponent(state.model.ref)}/languages`);
  if (languages.length > 1) {
    el('langSelect').style.display = 'inline-block';
    el('langBadge').style.display = 'none';
    const sel = el('langSelect');
    sel.innerHTML = languages.map((l) => `<option value="${escapeHtml(l.language)}">${escapeHtml(l.language)}</option>`).join('');
    sel.value = language;
  } else {
    el('langBadge').style.display = 'inline-block';
    el('langBadge').textContent = language;
    el('langSelect').style.display = 'none';
  }

  await refreshList();
  const savedRow = Number(localStorage.getItem(modelKey('row') + '_' + language));
  const firstPending = state.list.find((r) => r.status !== 'reviewed');
  const startRow = savedRow && state.list.some((r) => r.row_index === savedRow)
    ? savedRow
    : (firstPending ? firstPending.row_index : (state.list[0] ? state.list[0].row_index : null));
  if (startRow) await loadRow(startRow);
}

async function refreshList() {
  const { items } = await api(
    `/api/rows/${encodeURIComponent(state.model.ref)}/${encodeURIComponent(state.language)}/list`
  );
  state.list = items;
  renderLoFilter();
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

// The same learning objective was prompted in more than one language, so a
// sheet holds two passes over the same objectives; this lets an annotator work
// one pass at a time. Hidden when a sheet only has one.
function renderLoFilter() {
  const langs = [...new Set(state.list.map((r) => r.loLanguage).filter(Boolean))].sort();
  const wrap = el('loFilterBlock');
  if (langs.length < 2) {
    wrap.style.display = 'none';
    state.loFilter = 'all';
    return;
  }
  wrap.style.display = 'block';
  const row = el('loFilterRow');
  row.innerHTML =
    `<button class="chip${state.loFilter === 'all' ? ' active' : ''}" data-lo="all">All</button>` +
    langs
      .map((l) => `<button class="chip${state.loFilter === l ? ' active' : ''}" data-lo="${escapeHtml(l)}">${escapeHtml(l)}</button>`)
      .join('');
}

function filteredList() {
  let list = state.list;
  if (state.loFilter !== 'all') list = list.filter((r) => r.loLanguage === state.loFilter);
  if (state.filter === 'pending') return list.filter((r) => r.status !== 'reviewed');
  if (state.filter === 'reviewed') return list.filter((r) => r.status === 'reviewed');
  if (state.filter === 'flagged') return list.filter((r) => r.flagged);
  return list;
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
  const { row, total, otherAnnotators } = await api(
    `/api/rows/${encodeURIComponent(state.model.ref)}/${encodeURIComponent(state.language)}/${rowIndex}`
  );
  state.currentRow = row;
  state.currentRowIndex = rowIndex;
  state.dirty = false;
  localStorage.setItem(modelKey('row') + '_' + state.language, rowIndex);

  el('pillGrade').textContent = row.grade ? `Grade ${row.grade}` : 'Grade —';
  setPill('pillTopic', row.topic);
  setPill('pillLoLang', row.loLanguage ? `LO in ${row.loLanguage}` : '');
  // Only present when the account is allowed to see it.
  setPill('pillModel', row.model.name ? `Model: ${row.model.name}` : '');
  el('rowIndexPill').textContent = `Row ${rowIndex} of ${total}`;
  setStatusBadge(row.status);

  const loBlock = el('loBlock');
  if (row.learningObjective) {
    loBlock.style.display = 'block';
    el('loLabel').textContent = row.loCode ? `Learning objective (${row.loCode})` : 'Learning objective';
    el('loText').textContent = row.learningObjective;
  } else {
    loBlock.style.display = 'none';
  }

  const others = el('otherAnnotators');
  others.style.display = otherAnnotators > 0 ? 'block' : 'none';
  others.textContent =
    otherAnnotators === 1
      ? '1 other annotator has already reviewed this problem — annotate it independently.'
      : `${otherAnnotators} other annotators have already reviewed this problem — annotate it independently.`;

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
  grid_scrollToCurrent();
  updatePrevNextEnabled();
}

function setPill(id, text) {
  const node = el(id);
  node.textContent = text || '';
  node.title = text || '';
  node.style.display = text ? 'inline-block' : 'none';
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
      showErrorInfo(f.key);
    });
    const input = wrap.querySelector('input');
    input.addEventListener('change', () => {
      wrap.classList.toggle('checked', input.checked);
    });
    grid.appendChild(wrap);
  }
}

async function getErrorCategories() {
  if (!errorCategoriesCache) {
    const data = await api('/api/reference/error-categories');
    errorCategoriesCache = data.errorCategories;
  }
  return errorCategoriesCache;
}

async function showErrorInfo(key) {
  const categories = await getErrorCategories();
  const cat = categories.find((c) => c.key === key);
  if (!cat) return;
  el('errorInfoLabel').textContent = cat.label;
  el('errorInfoDef').textContent = cat.definition;
  el('errorInfoEx').textContent = cat.example;
  const box = el('errorInfoBox');
  box.style.display = 'block';
  box.scrollIntoView({ block: 'nearest' });
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
    // Saves this annotator's own annotation; anyone else on the same sheet
    // keeps theirs.
    const { row } = await api(`/api/annotations/${state.currentRow.id}`, {
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
  el('saveNextBtn').textContent = pos >= 0 && pos < flist.length - 1 ? 'Save & Next →' : 'Save';
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

  el('modelSelect').addEventListener('change', async (e) => {
    await maybeAutosave();
    const { models } = await api('/api/models');
    const picked = models.find((m) => m.ref === e.target.value);
    if (picked) await selectModel(picked);
  });

  el('langSelect').addEventListener('change', async (e) => {
    await maybeAutosave();
    await selectLanguage(e.target.value);
  });

  el('errorInfoClose').addEventListener('click', () => {
    el('errorInfoBox').style.display = 'none';
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

  el('loFilterRow').addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.loFilter = btn.dataset.lo;
    renderLoFilter();
    const first = filteredList()[0];
    if (first) {
      await goToRow(first.row_index);
    } else {
      renderGridNav();
      updatePrevNextEnabled();
    }
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
