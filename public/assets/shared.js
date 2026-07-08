const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const debounce = (fn, delay = 220) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const TABLE_SECTION_COLORS = Object.freeze({
  A: '#266075',
  F: '#128d9c',
  E: '#15a1b0',
  D: '#1bbdc9',
  C: '#8bd2da',
  B: '#c5e8ef'
});
const TABLE_SECTION_TEXT_COLORS = Object.freeze({
  A: '#ffffff',
  F: '#ffffff',
  E: '#ffffff',
  D: '#17343d',
  C: '#17343d',
  B: '#17343d'
});

function tableSection(table) {
  const fromSection = String(table?.section || '').trim().toUpperCase();
  if (fromSection) return fromSection.charAt(0);
  const fromNumber = String(table?.table_number || '').trim().toUpperCase().match(/[A-Z]$/);
  return fromNumber ? fromNumber[0] : '';
}

function tablePinColor(table) {
  return TABLE_SECTION_COLORS[tableSection(table)] || '#266075';
}

function tablePinTextColor(table) {
  return TABLE_SECTION_TEXT_COLORS[tableSection(table)] || '#ffffff';
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = localStorage.getItem(options.tokenKey || 'gala_admin_token');
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok || payload.ok === false) {
    const message = payload.error || payload.message || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

function notice(target, message, type = '') {
  if (!target) return;
  target.innerHTML = message ? `<div class="notice ${type}">${escapeHtml(message)}</div>` : '';
}

function personCard(person, options = {}) {
  const table = person.table_number ? `<span class="pill ok">Table ${escapeHtml(person.table_number)}</span>` : '<span class="pill">Unassigned</span>';
  const email = options.showEmail && person.email ? `<span>${escapeHtml(person.email)}</span>` : '';
  return `
    <article class="result-card" data-person-id="${person.id}">
      <h3>${escapeHtml(person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.email || 'Unnamed attendee')}</h3>
      <div class="result-meta">
        ${table}
        ${person.organisation ? `<span>${escapeHtml(person.organisation)}</span>` : ''}
        ${person.country ? `<span>${escapeHtml(person.country)}</span>` : ''}
        ${person.registration_type ? `<span>${escapeHtml(person.registration_type)}</span>` : ''}
        ${email}
      </div>
    </article>
  `;
}

function renderFilters(filters, container, names) {
  container.innerHTML = names.map(([key, label]) => {
    const values = filters[key] || [];
    return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <select data-filter="${escapeHtml(key)}">
          <option value="">All</option>
          ${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}
        </select>
      </div>
    `;
  }).join('');
}

function paramsFromControls(root) {
  const params = new URLSearchParams();
  const search = qs('[data-search]', root)?.value.trim();
  if (search) params.set('q', search);
  qsa('[data-filter]', root).forEach(select => {
    if (select.value) params.set(select.dataset.filter, select.value);
  });
  return params;
}

function renderMap(container, tables, onClick) {
  container.innerHTML = `
    <div class="map-scroll">
      <div class="real-map">
        <img src="/assets/gala-seating-map.jpg" alt="Gala seating chart" loading="eager">
        ${tables.map(table => `
          <button class="map-pin ${table.is_full ? 'is-full' : ''}" data-table-id="${table.id}" data-table-number="${escapeHtml(table.table_number)}" style="--x:${(table.x / 1440) * 100}%;--y:${(table.y / 810) * 100}%;--pin-bg:${tablePinColor(table)};--pin-fg:${tablePinTextColor(table)}" title="Table ${escapeHtml(table.table_number)}: ${table.assigned_count}/${table.capacity}">
            <span class="pin-label">${escapeHtml(table.table_number)}</span>
            <span class="pin-count">${table.assigned_count}/${table.capacity}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  const scroller = qs('.map-scroll', container);
  const image = qs('.real-map img', container);
  const centerMap = () => {
    if (!scroller) return;
    scroller.scrollLeft = Math.max(0, (scroller.scrollWidth - scroller.clientWidth) / 2);
  };
  if (image?.complete) requestAnimationFrame(centerMap);
  else image?.addEventListener('load', centerMap, { once: true });
  qsa('.map-pin', container).forEach(pin => pin.addEventListener('click', () => onClick(Number(pin.dataset.tableId), pin.dataset.tableNumber)));
}

function highlightTable(tableId) {
  qsa('.map-pin').forEach(pin => pin.classList.toggle('is-active', Number(pin.dataset.tableId) === Number(tableId)));
}

function closeModal() {
  qs('[data-modal]')?.remove();
}

function openModal(title, body) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.dataset.modal = 'true';
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h2>${escapeHtml(title)}</h2>
        <button class="btn ghost" type="button" data-close-modal>Close</button>
      </div>
      ${body}
    </div>
  `;
  document.body.appendChild(wrap);
  qs('[data-close-modal]', wrap).addEventListener('click', closeModal);
  wrap.addEventListener('click', event => { if (event.target === wrap) closeModal(); });
}

async function loadTableModal(tableId) {
  const data = await api(`/api/table/${tableId}`, { auth: false });
  const body = `
    <p class="muted">${data.table.assigned_count}/${data.table.capacity} people assigned.</p>
    <div class="table-people">
      ${data.people.length ? data.people.map(personCard).join('') : '<p class="muted">No attendees assigned to this table yet.</p>'}
    </div>
  `;
  openModal(`Table ${data.table.table_number}`, body);
  highlightTable(tableId);
}
