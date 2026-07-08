const state = { tables: [], rows: [] };

async function initViewer() {
  const [tablesData, filtersData] = await Promise.all([
    api('/api/tables', { auth: false }),
    api('/api/filters', { auth: false })
  ]);
  state.tables = tablesData.tables;
  renderMap(qs('[data-map]'), state.tables, loadTableModal);
  renderFilters(filtersData.filters, qs('[data-filters]'), [
    ['organisation', 'Organisation']
  ]);
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
  results.innerHTML = data.rows.map(viewerPersonCard).join('');
  bindResultActions(results);
  const firstWithTable = data.rows.find(row => row.table_id);
  if (firstWithTable) highlightTable(firstWithTable.table_id);
}

function viewerPersonCard(person) {
  const name = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.email || 'Unnamed attendee';
  const hasTable = Boolean(person.table_id);
  const table = person.table_number ? `<span class="pill ok">Table ${escapeHtml(person.table_number)}</span>` : '<span class="pill">Unassigned</span>';
  return `
    <article class="result-card" data-person-id="${escapeHtml(person.id)}">
      <div class="result-card-head">
        <div>
          <h3>${escapeHtml(name)}</h3>
          <div class="result-meta">
            ${table}
            ${person.organisation ? `<span>${escapeHtml(person.organisation)}</span>` : ''}
            ${person.country ? `<span>${escapeHtml(person.country)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="result-actions">
        <button class="btn find-table-btn" type="button" data-action="find-table" ${hasTable ? '' : 'disabled'}>Find table</button>
        <button class="btn ghost more-info-btn" type="button" data-action="more-info">More info</button>
      </div>
      <div class="result-extra hidden" data-extra></div>
    </article>
  `;
}

function bindResultActions(container) {
  qsa('[data-action="find-table"]', container).forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const card = button.closest('.result-card');
      const person = personFromCard(card);
      if (!person || !person.table_id) return;
      selectResultCard(card);
      highlightTable(person.table_id);
      scrollToMap(person.table_id);
    });
  });

  qsa('[data-action="more-info"]', container).forEach(button => {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      const card = button.closest('.result-card');
      const person = personFromCard(card);
      if (!person) return;
      selectResultCard(card);
      await toggleMoreInfo(card, person, button);
    });
  });

  qsa('.result-card', container).forEach(card => {
    card.addEventListener('click', () => {
      const person = personFromCard(card);
      if (!person) return;
      selectResultCard(card);
      if (person.table_id) highlightTable(person.table_id);
    });
  });
}

function personFromCard(card) {
  return state.rows.find(row => Number(row.id) === Number(card?.dataset.personId));
}

function selectResultCard(card) {
  qsa('.result-card').forEach(item => item.classList.remove('is-selected'));
  card?.classList.add('is-selected');
}

function scrollToMap(tableId) {
  const mapPanel = qs('#room-plan');
  mapPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => centerMapOnTable(tableId), 360);
}

function centerMapOnTable(tableId) {
  const pin = qs(`.map-pin[data-table-id="${CSS.escape(String(tableId))}"]`);
  const scroller = pin?.closest('.map-scroll');
  if (!pin || !scroller) return;
  const left = Math.max(0, pin.offsetLeft - (scroller.clientWidth / 2) + (pin.offsetWidth / 2));
  const top = Math.max(0, pin.offsetTop - (scroller.clientHeight / 2) + (pin.offsetHeight / 2));
  scroller.scrollTo({ left, top, behavior: 'smooth' });
}

async function toggleMoreInfo(card, person, button) {
  const extra = qs('[data-extra]', card);
  if (!extra) return;
  if (!extra.classList.contains('hidden')) {
    extra.classList.add('hidden');
    button.textContent = 'More info';
    return;
  }
  qsa('.result-extra').forEach(panel => panel.classList.add('hidden'));
  qsa('[data-action="more-info"]').forEach(btn => { btn.textContent = 'More info'; });
  extra.classList.remove('hidden');
  button.textContent = 'Hide info';

  if (!person.table_id) {
    extra.innerHTML = '<div class="notice">This attendee is not assigned to a table yet.</div>';
    return;
  }

  extra.innerHTML = '<p class="muted small">Loading table information...</p>';
  try {
    const data = await api(`/api/table/${person.table_id}`, { auth: false });
    const currentId = Number(person.id);
    const people = data.people || [];
    extra.innerHTML = `
      <div class="notice">Table ${escapeHtml(data.table.table_number)} has ${escapeHtml(data.table.assigned_count)}/${escapeHtml(data.table.capacity)} people assigned.</div>
      <div class="table-mates">
        <strong>Also seated at this table</strong>
        ${people.length ? people.map(item => `
          <div class="table-mate ${Number(item.id) === currentId ? 'is-current' : ''}">
            <span>${escapeHtml(item.name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unnamed attendee')}</span>
            ${item.organisation ? `<small>${escapeHtml(item.organisation)}</small>` : ''}
            ${Number(item.id) === currentId ? '<em>You selected this attendee</em>' : ''}
          </div>
        `).join('') : '<p class="muted small">No attendees assigned to this table yet.</p>'}
      </div>
    `;
  } catch (error) {
    extra.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
  }
}

initViewer().catch(error => {
  const status = qs('[data-status]');
  if (status) status.textContent = 'Error';
  qs('[data-results]').innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`;
});
