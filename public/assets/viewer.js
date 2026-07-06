const state = { tables: [], rows: [] };

async function initViewer() {
  const [tablesData, filtersData] = await Promise.all([
    api('/api/tables', { auth: false }),
    api('/api/filters', { auth: false })
  ]);
  state.tables = tablesData.tables;
  renderMap(qs('[data-map]'), state.tables, loadTableModal);
  renderFilters(filtersData.filters, qs('[data-filters]'), [
    ['organisation', 'Organisation'],
    ['country', 'Country'],
    ['registration_type', 'Registration type'],
    ['admission_item', 'Admission item'],
    ['table_section', 'Section'],
    ['table_number', 'Table']
  ]);
  qs('[data-status]').textContent = `${state.tables.length} tables loaded`;
  bindViewer();
  await runSearch();
}

function bindViewer() {
  const debounced = debounce(runSearch, 180);
  qs('[data-search]').addEventListener('input', debounced);
  qsa('[data-filter]').forEach(select => select.addEventListener('change', runSearch));
  qs('[data-clear]').addEventListener('click', async () => {
    qs('[data-search]').value = '';
    qsa('[data-filter]').forEach(select => { select.value = ''; });
    highlightTable(null);
    await runSearch();
  });
}

async function runSearch() {
  const params = paramsFromControls(document);
  params.set('limit', '120');
  const hasQuery = [...params.keys()].some(key => key !== 'limit');
  const results = qs('[data-results]');
  const count = qs('[data-count]');
  if (!hasQuery) {
    results.innerHTML = '<p class="muted">Start typing or use a filter to find a person.</p>';
    count.textContent = '';
    return;
  }
  const data = await api(`/api/search?${params.toString()}`, { auth: false });
  state.rows = data.rows;
  count.textContent = `${data.rows.length} shown`;
  if (!data.rows.length) {
    results.innerHTML = '<p class="muted">No matches found.</p>';
    return;
  }
  results.innerHTML = data.rows.map(personCard).join('');
  qsa('.result-card', results).forEach(card => {
    card.addEventListener('click', () => {
      const person = state.rows.find(row => Number(row.id) === Number(card.dataset.personId));
      if (!person) return;
      qsa('.result-card', results).forEach(item => item.classList.remove('is-selected'));
      card.classList.add('is-selected');
      highlightTable(person.table_id);
      if (person.table_id) loadTableModal(person.table_id);
    });
  });
  const firstWithTable = data.rows.find(row => row.table_id);
  if (firstWithTable) highlightTable(firstWithTable.table_id);
}

initViewer().catch(error => {
  qs('[data-status]').textContent = 'Error';
  qs('[data-results]').innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
});
