// Reference modal: Guidelines / Error Categories / NCERT example questions.
// Self-contained — builds its own DOM and injects its own CSS, so it can be
// dropped into any page with a single <script src="js/reference.js"> plus a
// button that calls window.openReferenceModal().
(function () {
  const state = {
    built: false,
    tab: 'guidelines',
    guidelines: null,
    errorCategories: null,
    examplesMeta: null,
    examples: [],
    exGrade: '',
    exTopic: '',
    exQuery: '',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load ' + url);
    return res.json();
  }

  function injectStyles() {
    if (document.getElementById('refModalStyles')) return;
    const style = document.createElement('style');
    style.id = 'refModalStyles';
    style.textContent = `
      #refModalOverlay { position:fixed; inset:0; background:rgba(20,24,33,0.45); z-index:1000; display:none; align-items:center; justify-content:center; padding:24px; }
      #refModalOverlay.open { display:flex; }
      #refModal { background:var(--panel,#fff); width:min(920px,100%); max-height:88vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.3); display:flex; flex-direction:column; overflow:hidden; }
      #refModal header { display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--border,#e2e5ea); }
      #refModal header h2 { margin:0; font-size:16px; flex:1; }
      #refModal .ref-close { border:none; background:transparent; font-size:20px; line-height:1; cursor:pointer; color:var(--text-dim,#5b6270); padding:4px 8px; }
      #refModal nav { display:flex; gap:4px; padding:10px 18px 0; border-bottom:1px solid var(--border,#e2e5ea); }
      #refModal nav button { border:none; background:transparent; padding:9px 14px; font-weight:600; font-size:13.5px; color:var(--text-dim,#5b6270); border-bottom:2px solid transparent; cursor:pointer; }
      #refModal nav button.active { color:var(--primary,#3457d5); border-bottom-color:var(--primary,#3457d5); }
      #refModal .ref-body { padding:18px 22px; overflow-y:auto; flex:1; }
      .ref-guideline-item { display:flex; gap:10px; padding:10px 0; border-bottom:1px solid var(--border,#eee); font-size:14px; line-height:1.55; }
      .ref-guideline-item:last-child { border-bottom:none; }
      .ref-guideline-item .num { font-weight:700; color:var(--primary,#3457d5); flex-shrink:0; }
      .ref-cat-card { border:1px solid var(--border,#e2e5ea); border-radius:8px; padding:12px 14px; margin-bottom:10px; scroll-margin-top:12px; }
      .ref-cat-card.highlight { border-color:var(--primary,#3457d5); box-shadow:0 0 0 2px rgba(52,87,213,0.18); }
      .ref-cat-card h4 { margin:0 0 4px; font-size:14px; }
      .ref-cat-card .def { font-size:13.5px; margin-bottom:6px; }
      .ref-cat-card .ex { font-size:12.5px; color:var(--text-dim,#5b6270); background:var(--gray-bg,#eceef1); border-radius:6px; padding:7px 10px; }
      .ref-ex-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; position:sticky; top:0; background:var(--panel,#fff); padding-bottom:8px; }
      .ref-ex-filters select, .ref-ex-filters input { padding:7px 9px; border:1px solid var(--border,#e2e5ea); border-radius:6px; font-size:13px; }
      .ref-ex-filters input[type=text] { flex:1; min-width:160px; }
      table.ref-ex-table { width:100%; border-collapse:collapse; font-size:13px; }
      table.ref-ex-table th, table.ref-ex-table td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--border,#eee); vertical-align:top; }
      table.ref-ex-table th { color:var(--text-dim,#5b6270); font-size:11px; text-transform:uppercase; }
      .ref-ex-count { font-size:12px; color:var(--text-dim,#5b6270); margin-bottom:8px; }
      .ref-open-btn { display:inline-flex; align-items:center; gap:6px; }
    `;
    document.head.appendChild(style);
  }

  function buildModal() {
    if (state.built) return;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.id = 'refModalOverlay';
    overlay.innerHTML = `
      <div id="refModal" role="dialog" aria-modal="true">
        <header>
          <h2>Annotation reference</h2>
          <button class="ref-close" id="refCloseBtn" aria-label="Close">&times;</button>
        </header>
        <nav>
          <button data-tab="guidelines">Guidelines</button>
          <button data-tab="categories">Error categories</button>
          <button data-tab="examples">Example questions (NCERT)</button>
        </nav>
        <div class="ref-body" id="refBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeReferenceModal();
    });
    el('refCloseBtn').addEventListener('click', closeReferenceModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeReferenceModal();
    });
    overlay.querySelectorAll('nav button').forEach((btn) => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });
    state.built = true;
  }

  async function setTab(tab, focusKey) {
    state.tab = tab;
    document.querySelectorAll('#refModal nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const body = el('refBody');
    body.innerHTML = '<p style="color:var(--text-dim)">Loading…</p>';
    if (tab === 'guidelines') await renderGuidelines(body);
    else if (tab === 'categories') await renderCategories(body, focusKey);
    else await renderExamples(body);
  }

  async function renderGuidelines(body) {
    if (!state.guidelines) {
      const data = await fetchJson('/api/reference/guidelines');
      state.guidelines = data.guidelines;
    }
    body.innerHTML = state.guidelines
      .map((g) => `<div class="ref-guideline-item"><span class="num">${g.id}.</span><span>${escapeHtml(g.text)}</span></div>`)
      .join('');
  }

  async function renderCategories(body, focusKey) {
    if (!state.errorCategories) {
      const data = await fetchJson('/api/reference/error-categories');
      state.errorCategories = data.errorCategories;
    }
    body.innerHTML = state.errorCategories
      .map(
        (c) => `
        <div class="ref-cat-card" id="refcat-${c.key}">
          <h4>${escapeHtml(c.label)}</h4>
          <div class="def">${escapeHtml(c.definition)}</div>
          <div class="ex">${escapeHtml(c.example)}</div>
        </div>`
      )
      .join('');
    if (focusKey) {
      const card = el('refcat-' + focusKey);
      if (card) {
        card.classList.add('highlight');
        card.scrollIntoView({ block: 'center' });
        setTimeout(() => card.classList.remove('highlight'), 2000);
      }
    }
  }

  async function renderExamples(body) {
    if (!state.examplesMeta) {
      state.examplesMeta = await fetchJson('/api/reference/examples/meta');
    }
    body.innerHTML = `
      <div class="ref-ex-filters">
        <select id="refExGrade"><option value="">All grades</option>${state.examplesMeta.grades
          .map((g) => `<option value="${escapeHtml(g)}">Grade ${escapeHtml(g)}</option>`)
          .join('')}</select>
        <select id="refExTopic"><option value="">All topics</option>${state.examplesMeta.topics
          .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
          .join('')}</select>
        <input type="text" id="refExQuery" placeholder="Search question / topic…" />
      </div>
      <div class="ref-ex-count" id="refExCount"></div>
      <div style="overflow-x:auto"><table class="ref-ex-table">
        <thead><tr><th>Grade</th><th>Topic</th><th>Question</th><th>Answer</th></tr></thead>
        <tbody id="refExBody"></tbody>
      </table></div>
    `;
    el('refExGrade').value = state.exGrade;
    el('refExTopic').value = state.exTopic;
    el('refExQuery').value = state.exQuery;
    el('refExGrade').addEventListener('change', (e) => {
      state.exGrade = e.target.value;
      loadExamples();
    });
    el('refExTopic').addEventListener('change', (e) => {
      state.exTopic = e.target.value;
      loadExamples();
    });
    let debounce;
    el('refExQuery').addEventListener('input', (e) => {
      state.exQuery = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(loadExamples, 250);
    });
    await loadExamples();
  }

  async function loadExamples() {
    const params = new URLSearchParams();
    if (state.exGrade) params.set('grade', state.exGrade);
    if (state.exTopic) params.set('topic', state.exTopic);
    if (state.exQuery) params.set('q', state.exQuery);
    const data = await fetchJson('/api/reference/examples?' + params.toString());
    const countEl = el('refExCount');
    if (countEl) {
      countEl.textContent =
        data.total > data.items.length
          ? `Showing ${data.items.length} of ${data.total} matching examples — narrow your search to see more.`
          : `${data.total} example${data.total === 1 ? '' : 's'}`;
    }
    const tbody = el('refExBody');
    if (!tbody) return;
    tbody.innerHTML = data.items
      .map(
        (r) => `<tr><td>${escapeHtml(r.grade)}</td><td>${escapeHtml(r.topic)}</td><td>${escapeHtml(r.question)}</td><td>${escapeHtml(r.answer)}</td></tr>`
      )
      .join('');
  }

  window.openReferenceModal = function (tab, focusKey) {
    buildModal();
    el('refModalOverlay').classList.add('open');
    setTab(tab || state.tab, focusKey);
  };

  window.closeReferenceModal = function closeReferenceModal() {
    const overlay = el('refModalOverlay');
    if (overlay) overlay.classList.remove('open');
  };

  function closeReferenceModal() {
    window.closeReferenceModal();
  }

  // Auto-wire any element with data-open-reference="tab" (and optional data-focus-key).
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open-reference]');
    if (!trigger) return;
    window.openReferenceModal(trigger.dataset.openReference, trigger.dataset.focusKey);
  });
})();
