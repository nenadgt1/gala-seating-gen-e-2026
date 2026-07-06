const modState = { tables: [], rows: [], attendee: null, table: null, passwordRequired: true };
const MOD_TOKEN_KEY = 'gala_moderator_token';

async function initModerator() {
  const settings = await api('/api/settings', { auth: false });
  modState.passwordRequired = settings.moderator_password_required;
  if (modState.passwordRequired && !localStorage.getItem(MOD_TOKEN_KEY)) {
    qs('[data-login-panel]').classList.remove('hidden');
    qs('[data-moderator-app]').classList.add('hidden');
    qs('[data-mod-status]').textContent = 'Password required';
  } else {
    await openModeratorApp();
  }
  bindLogin();
}

function bindLogin() {
  qs('[data-mod-login]')?.addEventListener('click', async () => {
    const target = qs('[data-mod-login-message]');
    try {
      const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { role: 'moderator', password: qs('[data-mod-password]').value } });
      localStorage.setItem(MOD_TOKEN_KEY, data.token);
      notice(target, 'Moderator panel opened.', 'ok');
      await openModeratorApp();
    } catch (error) {
      notice(target, error.message, 'error');
    }
  });
}

async function openModeratorApp() {
  qs('[data-login-panel]').classList.add('hidden');
  qs('[data-moderator-app]').classList.remove('hidden');
  const tablesData = await api('/api/tables', { auth: false });
  modState.tables = tablesData.tables;
  renderMap(qs('[data-map]'), modState.tables, (id) => {
    modState.table = modState.tables.find(t => Number(t.id) === Number(id));
    highlightTable(id);
    renderSelection();
  });
  qs('[data-mod-status]').textContent = `${modState.tables.length} tables loaded`;
  bindModerator();
}

function bindModerator() {
  const search = debounce(runModeratorSearch, 180);
  qs('[data-search]').addEventListener('input', search);
  qs('[data-submit-request]').addEventListener('click', submitRequest);
}

async function runModeratorSearch() {
  const params = new URLSearchParams();
  const query = qs('[data-search]').value.trim();
  if (!query) {
    qs('[data-results]').innerHTML = '<p class="muted">Search for the attendee.</p>';
    return;
  }
  params.set('q', query);
  params.set('limit', '80');
  const data = await api(`/api/search?${params.toString()}`, { auth: false });
  modState.rows = data.rows;
  qs('[data-results]').innerHTML = data.rows.length ? data.rows.map(personCard).join('') : '<p class="muted">No attendees found.</p>';
  qsa('.result-card', qs('[data-results]')).forEach(card => {
    card.addEventListener('click', () => {
      modState.attendee = modState.rows.find(row => Number(row.id) === Number(card.dataset.personId));
      qsa('.result-card', qs('[data-results]')).forEach(item => item.classList.remove('is-selected'));
      card.classList.add('is-selected');
      if (modState.attendee?.table_id) highlightTable(modState.attendee.table_id);
      renderSelection();
    });
  });
}

function renderSelection() {
  const attendee = modState.attendee;
  const table = modState.table;
  qs('[data-selection]').innerHTML = `
    <div class="notice">
      <strong>Attendee:</strong> ${attendee ? escapeHtml(attendee.name) : 'Not selected'}<br>
      <strong>Current table:</strong> ${attendee?.table_number ? escapeHtml(attendee.table_number) : 'Unassigned'}<br>
      <strong>Requested table:</strong> ${table ? escapeHtml(table.table_number) + ` (${table.assigned_count}/${table.capacity})` : 'Not selected'}
    </div>
  `;
  qs('[data-submit-request]').disabled = !(attendee && table);
}

async function submitRequest() {
  const target = qs('[data-message]');
  try {
    const body = {
      submitter_name: qs('[data-submitter-name]').value,
      submitter_email: qs('[data-submitter-email]').value,
      submitter_organisation: qs('[data-submitter-org]').value,
      attendee_id: modState.attendee.id,
      table_id: modState.table.id,
      note: qs('[data-note]').value
    };
    await api('/api/moderator/request', { method: 'POST', tokenKey: MOD_TOKEN_KEY, body });
    notice(target, 'Request submitted. An admin needs to approve it before the seating changes.', 'ok');
    qs('[data-note]').value = '';
  } catch (error) {
    if (/Authentication/i.test(error.message)) localStorage.removeItem(MOD_TOKEN_KEY);
    notice(target, error.message, 'error');
  }
}

initModerator().catch(error => {
  qs('[data-mod-status]').textContent = 'Error';
  const target = qs('[data-login-panel]').classList.contains('hidden') ? qs('[data-message]') : qs('[data-mod-login-message]');
  notice(target, error.message, 'error');
});
