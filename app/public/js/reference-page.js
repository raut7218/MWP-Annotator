// Standalone reference page: Guidelines / Error Categories / NCERT example
// questions. Opened in its own browser tab (see annotate.html sidebar links
// and the per-issue info icon), driven by ?tab=&focus= query params.
(function () {
  const state = {
    guidelines: null,
    errorCategories: null,
    examplesMeta: null,
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

  async function setTab(tab, focusKey) {
    document.querySelectorAll('.ref-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    const body = el('refBody');
    body.innerHTML = '<p style="color:var(--text-dim)">Loading…</p>';
    if (tab === 'guidelines') await renderGuidelines(body);
    else if (tab === 'categories') await renderCategories(body, focusKey);
    else await renderExamples(body);
    const url = new URL(location.href);
    url.searchParams.set('tab', tab);
    if (focusKey) url.searchParams.set('focus', focusKey);
    else url.searchParams.delete('focus');
    history.replaceState(null, '', url);
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

  document.querySelectorAll('.ref-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  const params = new URLSearchParams(location.search);
  setTab(params.get('tab') || 'guidelines', params.get('focus') || undefined);
})();
