const adminState = { tables: [], attendees: [], pending: [], filters: {} };
const ADMIN_TOKEN_KEY = 'gala_admin_token';

async function initAdmin() {
  bindAdminLogin();
  if (localStorage.getItem(ADMIN_TOKEN_KEY)) {
    await openAdmin();
  }
}

function bindAdminLogin() {
  qs('[data-admin-login]').addEventListener('click', async () => {
    const target = qs('[data-login-message]');
    try {
      const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { role: 'admin', password: qs('[data-admin-password]').value } });
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      notice(target, 'Admin panel opened.', 'ok');
      await openAdmin();
    } catch (error) {
      notice(target, error.message, 'error');
    }
  });
  qs('[data-logout]').addEventListener('click', () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    location.reload();
  });
}

async function openAdmin() {
  qs('[data-login-panel]').classList.add('hidden');
  qs('[data-admin-app]').classList.remove('hidden');
  qs('[data-logout]').classList.remove('hidden');
  qs('[data-admin-status]').textContent = 'Unlocked';
  bindAdminApp();
  await refreshAll();
}

function bindAdminApp() {
  qs('[data-refresh]').onclick = refreshAll;
  qs('[data-import]').onclick = importCsv;
  qs('[data-export]').onclick = exportCsv;
  qs('[data-add-attendee]').onclick = addAttendee;
  qs('[data-search]').oninput = debounce(loadAttendees, 180);
  qs('[data-admin-org-filter]').onchange = loadAttendees;
  qs('[data-clear-search]').onclick = async () => {
    qs('[data-search]').value = '';
    qs('[data-admin-org-filter]').value = '';
    await loadAttendees();
  };
  qs('[data-bulk-assign]').onclick = bulkAssign;
  qs('[data-bulk-unassign]').onclick = bulkUnassign;
  qs('[data-csv-file]').onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    qs('[data-csv-text]').value = await file.text();
  };
}

async function refreshAll() {
  try {
    await loadAdminFilters();
    await Promise.all([loadSummary(), loadPending(), loadAttendees()]);
  } catch (error) {
    if (/Authentication/i.test(error.message)) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      location.reload();
      return;
    }
    alert(error.message);
  }
}

async function loadAdminFilters() {
  const select = qs('[data-admin-org-filter]');
  if (!select) return;
  const current = select.value;
  const data = await api('/api/filters', { auth: false });
  adminState.filters = data.filters || {};
  const organisations = adminState.filters.organisation || [];
  select.innerHTML = '<option value="">All organisations</option>' + organisations.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (organisations.includes(current)) select.value = current;
}

async function loadSummary() {
  const data = await api('/api/admin/summary', { tokenKey: ADMIN_TOKEN_KEY });
  adminState.tables = data.tables;
  qs('[data-stats]').innerHTML = Object.entries(data.summary).map(([key, value]) => `
    <div class="stat"><strong>${value}</strong><span>${escapeHtml(key.replace('_', ' '))}</span></div>
  `).join('');
  fillTableSelects();
  renderAdminTableGrid();
  renderMap(qs('[data-map]'), adminState.tables, async id => {
    highlightTable(id);
    qs('[data-search]').value = adminState.tables.find(t => Number(t.id) === Number(id))?.table_number || '';
    await loadAttendees();
  });
}

function fillTableSelects() {
  const options = '<option value="">Unassigned</option>' + adminState.tables.map(t => `<option value="${t.id}">${escapeHtml(t.table_number)} (${t.assigned_count}/${t.capacity})</option>`).join('');
  qsa('[data-table-select]').forEach(select => { select.innerHTML = options; });
  qs('[data-bulk-table]').innerHTML = '<option value="">Bulk table...</option>' + adminState.tables.map(t => `<option value="${t.id}" ${t.is_full ? 'disabled' : ''}>${escapeHtml(t.table_number)} (${t.assigned_count}/${t.capacity})</option>`).join('');
}

function renderAdminTableGrid() {
  qs('[data-table-grid]').innerHTML = adminState.tables.map(t => `
    <button class="table-card ${t.is_full ? 'is-full' : ''}" data-admin-table="${t.id}">
      <strong>${escapeHtml(t.table_number)}</strong>
      <span class="muted small">Section ${escapeHtml(t.section)}</span><br>
      <span class="pill ${t.is_full ? 'full' : 'ok'}">${t.assigned_count}/${t.capacity}</span>
    </button>
  `).join('');
  qsa('[data-admin-table]').forEach(card => card.addEventListener('click', () => {
    qsa('.table-card').forEach(x => x.classList.remove('is-selected'));
    card.classList.add('is-selected');
    highlightTable(card.dataset.adminTable);
  }));
}

async function loadAttendees() {
  const params = new URLSearchParams();
  const query = qs('[data-search]').value.trim();
  const organisation = qs('[data-admin-org-filter]')?.value || '';
  if (query) params.set('q', query);
  if (organisation) params.set('organisation', organisation);
  params.set('limit', '500');
  const data = await api(`/api/admin/attendees?${params.toString()}`, { tokenKey: ADMIN_TOKEN_KEY });
  adminState.attendees = data.rows;
  qs('[data-admin-count]').textContent = `${data.rows.length} shown`;
  const options = '<option value="">Unassigned</option>' + adminState.tables.map(t => `<option value="${t.id}">${escapeHtml(t.table_number)} (${t.assigned_count}/${t.capacity})</option>`).join('');
  qs('[data-attendees-list]').innerHTML = data.rows.length ? data.rows.map(a => `
    <article class="result-card" data-admin-attendee="${a.id}">
      <div class="actions-row" style="justify-content:space-between">
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-select-attendee value="${a.id}" style="width:auto"> <strong>${escapeHtml(a.name || a.email || 'Unnamed attendee')}</strong></label>
        <button class="btn danger" data-delete-attendee="${a.id}" style="min-height:34px;padding:7px 10px">Delete</button>
      </div>
      <div class="result-meta">
        ${a.email ? `<span>${escapeHtml(a.email)}</span>` : ''}
        ${a.organisation ? `<span>${escapeHtml(a.organisation)}</span>` : ''}
        ${a.country ? `<span>${escapeHtml(a.country)}</span>` : ''}
      </div>
      <div class="actions-row">
        <select data-row-table="${a.id}" style="max-width:220px">${options}</select>
        <button class="btn ghost" data-save-row="${a.id}">Save table</button>
      </div>
    </article>
  `).join('') : '<p class="muted">No attendees found.</p>';
  qsa('[data-row-table]').forEach(select => {
    const person = adminState.attendees.find(a => Number(a.id) === Number(select.dataset.rowTable));
    select.value = person?.table_id || '';
  });
  qsa('[data-save-row]').forEach(button => button.addEventListener('click', async () => {
    const id = Number(button.dataset.saveRow);
    const tableId = Number(qs(`[data-row-table="${id}"]`).value || 0);
    await assignAttendees([id], tableId);
  }));
  qsa('[data-delete-attendee]').forEach(button => button.addEventListener('click', async () => {
    const person = adminState.attendees.find(a => Number(a.id) === Number(button.dataset.deleteAttendee));
    if (!confirm(`Delete ${person?.name || 'this attendee'}?`)) return;
    await api(`/api/admin/attendee/${button.dataset.deleteAttendee}`, { method: 'DELETE', tokenKey: ADMIN_TOKEN_KEY });
    await refreshAll();
  }));
}

function selectedAttendeeIds() {
  return qsa('[data-select-attendee]:checked').map(input => Number(input.value));
}

async function assignAttendees(ids, tableId) {
  await api('/api/admin/assign', { method: 'POST', tokenKey: ADMIN_TOKEN_KEY, body: { attendee_ids: ids, table_id: tableId } });
  await refreshAll();
  if (tableId) highlightTable(tableId);
}

async function bulkAssign() {
  const ids = selectedAttendeeIds();
  const tableId = Number(qs('[data-bulk-table]').value || 0);
  if (!ids.length || !tableId) return alert('Select at least one attendee and one table.');
  await assignAttendees(ids, tableId);
}

async function bulkUnassign() {
  const ids = selectedAttendeeIds();
  if (!ids.length) return alert('Select at least one attendee.');
  await assignAttendees(ids, 0);
}

async function importCsv() {
  const target = qs('[data-import-message]');
  try {
    const csv = qs('[data-csv-text]').value;
    const mode = qs('[data-import-mode]').value;
    const data = await api('/api/admin/import', { method: 'POST', tokenKey: ADMIN_TOKEN_KEY, body: { csv, mode } });
    const errors = data.result.errors?.length ? ` Warnings: ${data.result.errors.slice(0, 8).join(' | ')}` : '';
    notice(target, `Imported ${data.result.imported} attendee rows.${errors}`, data.result.errors?.length ? '' : 'ok');
    await refreshAll();
  } catch (error) {
    notice(target, error.message, 'error');
  }
}

async function exportCsv() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  const response = await fetch('/api/admin/export.csv', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return alert('Export failed.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gala-attendees-export.csv';
  link.click();
  URL.revokeObjectURL(url);
}

async function addAttendee() {
  const target = qs('[data-add-message]');
  try {
    const body = {};
    qsa('[data-add]').forEach(input => { body[input.dataset.add] = input.value; });
    await api('/api/admin/attendee', { method: 'POST', tokenKey: ADMIN_TOKEN_KEY, body });
    qsa('[data-add]').forEach(input => { input.value = ''; });
    notice(target, 'Attendee added.', 'ok');
    await refreshAll();
  } catch (error) {
    notice(target, error.message, 'error');
  }
}

async function loadPending() {
  const data = await api('/api/admin/pending', { tokenKey: ADMIN_TOKEN_KEY });
  adminState.pending = data.rows;
  const pending = data.rows.filter(row => row.status === 'pending');
  qs('[data-pending-list]').innerHTML = pending.length ? pending.map(row => `
    <article class="request-card" data-request="${row.id}">
      <strong>${escapeHtml(row.attendee?.name || row.attendee_snapshot?.name || 'Attendee')} → Table ${escapeHtml(row.requested_table_number || '')}</strong>
      <div class="result-meta">
        <span>Requested by: ${escapeHtml(row.submitter_name || 'Unknown')}</span>
        ${row.submitter_email ? `<span>${escapeHtml(row.submitter_email)}</span>` : ''}
        ${row.submitter_organisation ? `<span>${escapeHtml(row.submitter_organisation)}</span>` : ''}
      </div>
      ${row.note ? `<p class="muted">${escapeHtml(row.note)}</p>` : ''}
      <div class="actions-row">
        <button class="btn ok" data-approve="${row.id}">Approve</button>
        <button class="btn danger" data-reject="${row.id}">Reject</button>
      </div>
    </article>
  `).join('') : '<p class="muted">No pending moderator requests.</p>';
  qsa('[data-approve]').forEach(button => button.addEventListener('click', () => reviewRequest(button.dataset.approve, 'approve')));
  qsa('[data-reject]').forEach(button => button.addEventListener('click', () => reviewRequest(button.dataset.reject, 'reject')));
}

async function reviewRequest(id, action) {
  await api(`/api/admin/pending/${id}/${action}`, { method: 'POST', tokenKey: ADMIN_TOKEN_KEY, body: {} });
  await refreshAll();
}

initAdmin().catch(error => {
  notice(qs('[data-login-message]'), error.message, 'error');
  localStorage.removeItem(ADMIN_TOKEN_KEY);
});
