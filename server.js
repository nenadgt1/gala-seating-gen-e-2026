const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const APP_SECRET = process.env.APP_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-admin-password';
const MODERATOR_PASSWORD = process.env.MODERATOR_PASSWORD || '';
const ADMIN_PATH = cleanRoute(process.env.ADMIN_PATH || 'gala-admin-2026');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'gala-data.json');
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || '*';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SEED_FILE = path.join(__dirname, 'table-seed.json');
const MAX_BODY_BYTES = 15 * 1024 * 1024;

function cleanRoute(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || 'gala-admin-2026';
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readSeedTables() {
  const rows = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  return rows.map((t, index) => ({
    id: Number(t.id || index + 1),
    table_number: String(t.table_number),
    section: String(t.section || '').toUpperCase(),
    capacity: 10,
    x: Number(t.x),
    y: Number(t.y),
    notes: 'Gala seating chart 2026 real map'
  }));
}

function defaultData() {
  return {
    meta: {
      version: 1,
      created_at: nowIso(),
      updated_at: nowIso()
    },
    tables: readSeedTables(),
    attendees: [],
    pending: []
  };
}

function normalizeData(data) {
  const seedTables = readSeedTables();
  const byNumber = new Map((data.tables || []).map(t => [String(t.table_number).toUpperCase(), t]));
  const tables = seedTables.map(seed => ({ ...seed, ...(byNumber.get(seed.table_number.toUpperCase()) || {}), capacity: 10, x: seed.x, y: seed.y, section: seed.section }));
  const validTableIds = new Set(tables.map(t => Number(t.id)));
  const attendees = (data.attendees || []).map((a, index) => normalizeAttendee({ ...a, id: Number(a.id || index + 1) }, validTableIds)).filter(Boolean);
  const pending = (data.pending || []).map((p, index) => ({
    id: Number(p.id || index + 1),
    status: String(p.status || 'pending'),
    created_at: p.created_at || nowIso(),
    reviewed_at: p.reviewed_at || '',
    reviewed_by: p.reviewed_by || '',
    admin_note: stringField(p.admin_note),
    note: stringField(p.note),
    submitter_name: stringField(p.submitter_name),
    submitter_email: stringField(p.submitter_email),
    submitter_organisation: stringField(p.submitter_organisation),
    attendee_id: Number(p.attendee_id || 0),
    requested_table_id: Number(p.requested_table_id || 0),
    requested_table_number: stringField(p.requested_table_number),
    attendee_snapshot: p.attendee_snapshot || {}
  }));
  return {
    meta: { ...(data.meta || {}), version: 1, updated_at: (data.meta && data.meta.updated_at) || nowIso() },
    tables,
    attendees,
    pending
  };
}

function loadData() {
  ensureDir(DATA_FILE);
  if (!fs.existsSync(DATA_FILE)) {
    const data = defaultData();
    saveData(data);
    return data;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const normalized = normalizeData(parsed);
    return normalized;
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    try { fs.copyFileSync(DATA_FILE, backup); } catch (_) {}
    const data = defaultData();
    saveData(data);
    return data;
  }
}

function saveData(data) {
  ensureDir(DATA_FILE);
  data.meta = { ...(data.meta || {}), version: 1, updated_at: nowIso() };
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let db = loadData();

function stringField(value) {
  return String(value ?? '').trim();
}

function normalizeAttendee(a, validTableIds) {
  const tableId = Number(a.table_id || a.tableId || 0);
  const item = {
    id: Number(a.id || 0),
    first_name: stringField(a.first_name || a.firstName || a.name?.split(' ')?.[0]),
    last_name: stringField(a.last_name || a.lastName || (a.name ? String(a.name).split(' ').slice(1).join(' ') : '')),
    email: stringField(a.email).toLowerCase(),
    organisation: stringField(a.organisation || a.organization),
    position: stringField(a.position),
    country: stringField(a.country),
    gender: stringField(a.gender),
    ja_profile: stringField(a.ja_profile || a.jaProfile),
    registration_type: stringField(a.registration_type || a.registrationType),
    admission_item: stringField(a.admission_item || a.admissionItem),
    dietary_requirements: stringField(a.dietary_requirements || a.dietary || a.dietaryRequirements),
    additional_comments: stringField(a.additional_comments || a.comments || a.additionalComments),
    departure_date: stringField(a.departure_date || a.departureDate),
    table_id: validTableIds && !validTableIds.has(tableId) ? 0 : tableId,
    created_at: a.created_at || nowIso(),
    updated_at: nowIso()
  };
  if (!item.first_name && !item.last_name && !item.email) return null;
  return item;
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1;
}

function tableById(id) {
  return db.tables.find(t => Number(t.id) === Number(id));
}

function tableByNumber(number) {
  const key = String(number || '').trim().toUpperCase();
  return db.tables.find(t => String(t.table_number).toUpperCase() === key);
}

function attendeeById(id) {
  return db.attendees.find(a => Number(a.id) === Number(id));
}

function countAssigned(tableId, excludeAttendeeIds = []) {
  const exclude = new Set(excludeAttendeeIds.map(Number));
  return db.attendees.filter(a => Number(a.table_id) === Number(tableId) && !exclude.has(Number(a.id))).length;
}

function tablesWithCounts() {
  return db.tables.map(t => ({
    ...t,
    assigned_count: countAssigned(t.id),
    is_full: countAssigned(t.id) >= Number(t.capacity || 10)
  }));
}

function publicAttendee(a) {
  const table = tableById(a.table_id);
  return {
    id: a.id,
    name: `${a.first_name} ${a.last_name}`.trim(),
    first_name: a.first_name,
    last_name: a.last_name,
    organisation: a.organisation,
    position: a.position,
    country: a.country,
    ja_profile: a.ja_profile,
    registration_type: a.registration_type,
    admission_item: a.admission_item,
    table_id: a.table_id || 0,
    table_number: table ? table.table_number : ''
  };
}

function adminAttendee(a) {
  const table = tableById(a.table_id);
  return {
    ...a,
    name: `${a.first_name} ${a.last_name}`.trim(),
    table_number: table ? table.table_number : ''
  };
}

function matchesText(a, q) {
  if (!q) return true;
  const haystack = [
    a.first_name, a.last_name, a.email, a.organisation, a.position, a.country,
    a.gender, a.ja_profile, a.registration_type, a.admission_item, a.dietary_requirements,
    tableById(a.table_id)?.table_number || ''
  ].join(' ').toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function matchesFilters(a, params) {
  const map = {
    organisation: a.organisation,
    country: a.country,
    gender: a.gender,
    ja_profile: a.ja_profile,
    registration_type: a.registration_type,
    admission_item: a.admission_item,
    dietary: a.dietary_requirements,
    table_number: tableById(a.table_id)?.table_number || '',
    table_section: tableById(a.table_id)?.section || '',
    assigned: a.table_id ? 'assigned' : 'unassigned'
  };
  for (const [key, value] of Object.entries(map)) {
    const requested = stringField(params.get(key));
    if (requested && String(value).toLowerCase() !== requested.toLowerCase()) return false;
  }
  return true;
}

function searchAttendees(params, mode = 'public') {
  const q = stringField(params.get('q'));
  const limit = Math.min(Number(params.get('limit') || 100), mode === 'admin' ? 1000 : 120);
  return db.attendees
    .filter(a => matchesText(a, q) && matchesFilters(a, params))
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`))
    .slice(0, limit);
}

function filterOptions() {
  const options = {
    organisation: new Set(), country: new Set(), gender: new Set(), ja_profile: new Set(),
    registration_type: new Set(), admission_item: new Set(), dietary: new Set(),
    table_number: new Set(db.tables.map(t => t.table_number)), table_section: new Set(db.tables.map(t => t.section)),
    assigned: new Set(['assigned', 'unassigned'])
  };
  for (const a of db.attendees) {
    if (a.organisation) options.organisation.add(a.organisation);
    if (a.country) options.country.add(a.country);
    if (a.gender) options.gender.add(a.gender);
    if (a.ja_profile) options.ja_profile.add(a.ja_profile);
    if (a.registration_type) options.registration_type.add(a.registration_type);
    if (a.admission_item) options.admission_item.add(a.admission_item);
    if (a.dietary_requirements) options.dietary.add(a.dietary_requirements);
  }
  return Object.fromEntries(Object.entries(options).map(([key, set]) => [key, [...set].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))]));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let insideQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === '"') {
      if (insideQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (ch === ',' && !insideQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !insideQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(v => String(v).trim() !== '')) rows.push(row);
  return rows;
}

function headerKey(header) {
  return String(header || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function valueFrom(record, keys) {
  for (const key of keys) {
    const normalized = headerKey(key);
    if (record[normalized] !== undefined && stringField(record[normalized]) !== '') return record[normalized];
  }
  return '';
}

function importCsv(csv, mode) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { imported: 0, skipped: 0, errors: ['CSV has no data rows.'] };
  const headers = rows[0].map(headerKey);
  const validTableIds = new Set(db.tables.map(t => Number(t.id)));
  const imported = [];
  const errors = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const record = {};
    headers.forEach((h, idx) => { record[h] = rows[i][idx] ?? ''; });
    const tableNumber = stringField(valueFrom(record, ['table_number', 'table no', 'table', 'table_no'])).toUpperCase();
    const table = tableNumber ? tableByNumber(tableNumber) : null;
    if (tableNumber && !table) errors.push(`Row ${i + 1}: table ${tableNumber} does not exist.`);
    const attendee = normalizeAttendee({
      first_name: valueFrom(record, ['first_name', 'first name', 'name', 'given_name']),
      last_name: valueFrom(record, ['last_name', 'last name', 'surname', 'family_name']),
      email: valueFrom(record, ['email', 'e-mail', 'mail']),
      organisation: valueFrom(record, ['organisation', 'organization', 'company', 'school']),
      position: valueFrom(record, ['position', 'role', 'job_title']),
      country: valueFrom(record, ['country', 'ja_country', 'ja country']),
      gender: valueFrom(record, ['gender']),
      ja_profile: valueFrom(record, ['ja_profile', 'ja profile', 'profile']),
      registration_type: valueFrom(record, ['registration_type', 'registration type']),
      admission_item: valueFrom(record, ['admission_item', 'admission item']),
      dietary_requirements: valueFrom(record, ['dietary_requirements', 'dietary requirements', 'dietary']),
      additional_comments: valueFrom(record, ['additional_comments', 'additional comments', 'comments', 'allergies', 'accessibility']),
      departure_date: valueFrom(record, ['departure_date', 'departure date']),
      table_id: table ? table.id : 0
    }, validTableIds);
    if (!attendee) {
      skipped++;
      continue;
    }
    imported.push(attendee);
  }

  if (String(mode || '').toLowerCase() === 'replace') {
    db.attendees = [];
  }

  let count = 0;
  for (const a of imported) {
    const existing = a.email
      ? db.attendees.find(x => x.email && x.email.toLowerCase() === a.email.toLowerCase())
      : db.attendees.find(x => x.first_name.toLowerCase() === a.first_name.toLowerCase() && x.last_name.toLowerCase() === a.last_name.toLowerCase() && x.organisation.toLowerCase() === a.organisation.toLowerCase());
    if (a.table_id && countAssigned(a.table_id, existing ? [existing.id] : []) >= 10) {
      errors.push(`${a.first_name} ${a.last_name}: table ${tableById(a.table_id)?.table_number || a.table_id} is full.`);
      a.table_id = 0;
    }
    if (existing) {
      Object.assign(existing, a, { id: existing.id, created_at: existing.created_at || nowIso(), updated_at: nowIso() });
    } else {
      db.attendees.push({ ...a, id: nextId(db.attendees), created_at: nowIso(), updated_at: nowIso() });
    }
    count++;
  }
  saveData(db);
  return { imported: count, skipped, errors };
}

function toCsv(rows) {
  const headers = ['first_name','last_name','email','organisation','position','country','gender','ja_profile','registration_type','admission_item','dietary_requirements','additional_comments','departure_date','table_number'];
  const escape = value => {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    const table = tableById(row.table_id);
    lines.push(headers.map(h => escape(h === 'table_number' ? (table?.table_number || '') : row[h])).join(','));
  }
  return lines.join('\n');
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function notFound(res) {
  text(res, 404, 'Not found');
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function staticFile(res, relativePath, replacements = {}) {
  const safe = path.normalize(relativePath).replace(/^([.][.][\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return notFound(res);
  let body = fs.readFileSync(filePath);
  const type = mimeType(filePath);
  if (type.startsWith('text/html')) {
    let html = body.toString('utf8');
    for (const [key, value] of Object.entries(replacements)) html = html.replaceAll(`{{${key}}}`, String(value));
    body = Buffer.from(html, 'utf8');
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': type.startsWith('image/') ? 'public, max-age=86400' : 'no-store',
    'Content-Security-Policy': `frame-ancestors ${FRAME_ANCESTORS}`
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body) return {};
  return JSON.parse(body);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(input) {
  return crypto.createHmac('sha256', APP_SECRET).update(input).digest('base64url');
}

function makeToken(role) {
  const payload = base64url(JSON.stringify({ role, exp: Date.now() + 12 * 60 * 60 * 1000 }));
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = hmac(payload);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (Date.now() > Number(parsed.exp || 0)) return null;
  return parsed;
}

function authInfo(req) {
  const auth = req.headers.authorization || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  try { return verifyToken(auth.slice(7).trim()); } catch (_) { return null; }
}

function requireRole(req, res, roles) {
  const info = authInfo(req);
  if (!info || !roles.includes(info.role)) {
    json(res, 401, { ok: false, error: 'Authentication required.' });
    return null;
  }
  return info;
}

function sendSettings(res) {
  json(res, 200, {
    ok: true,
    moderator_password_required: Boolean(MODERATOR_PASSWORD),
    viewer_path: '/viewer',
    moderator_path: '/moderator'
  });
}

function validateAssignment(attendeeIds, tableId) {
  const ids = attendeeIds.map(Number).filter(Boolean);
  const table = tableId ? tableById(tableId) : null;
  if (tableId && !table) return { ok: false, error: 'Table not found.' };
  const people = ids.map(attendeeById);
  if (people.some(p => !p)) return { ok: false, error: 'One or more attendees were not found.' };
  if (table) {
    const current = countAssigned(table.id, ids);
    if (current + ids.length > table.capacity) return { ok: false, error: `Table ${table.table_number} is full or would exceed 10 people.` };
  }
  return { ok: true, people, table };
}

function pendingWithNames() {
  return db.pending.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(p => {
    const attendee = attendeeById(p.attendee_id);
    const table = tableById(p.requested_table_id);
    return {
      ...p,
      attendee: attendee ? adminAttendee(attendee) : p.attendee_snapshot,
      requested_table_number: table ? table.table_number : p.requested_table_number
    };
  });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'GET' && url.pathname === '/api/settings') return sendSettings(res);
    if (req.method === 'GET' && url.pathname === '/api/tables') return json(res, 200, { ok: true, tables: tablesWithCounts() });
    if (req.method === 'GET' && url.pathname === '/api/filters') return json(res, 200, { ok: true, filters: filterOptions() });
    if (req.method === 'GET' && url.pathname === '/api/search') {
      const rows = searchAttendees(url.searchParams, 'public').map(publicAttendee);
      return json(res, 200, { ok: true, rows });
    }
    const tableMatch = url.pathname.match(/^\/api\/table\/(\d+)$/);
    if (req.method === 'GET' && tableMatch) {
      const table = tablesWithCounts().find(t => Number(t.id) === Number(tableMatch[1]));
      if (!table) return json(res, 404, { ok: false, error: 'Table not found.' });
      const people = db.attendees.filter(a => Number(a.table_id) === Number(table.id)).map(publicAttendee).sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, { ok: true, table, people });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJson(req);
      const role = body.role === 'moderator' ? 'moderator' : 'admin';
      const expected = role === 'moderator' ? MODERATOR_PASSWORD : ADMIN_PASSWORD;
      if (!expected && role === 'moderator') return json(res, 200, { ok: true, token: makeToken('moderator'), role: 'moderator' });
      if (String(body.password || '') !== String(expected)) return json(res, 401, { ok: false, error: 'Wrong password.' });
      return json(res, 200, { ok: true, token: makeToken(role), role });
    }
    if (req.method === 'POST' && url.pathname === '/api/moderator/request') {
      if (MODERATOR_PASSWORD && !requireRole(req, res, ['moderator', 'admin'])) return;
      const body = await readJson(req);
      const attendee = attendeeById(body.attendee_id);
      const table = tableById(body.table_id);
      if (!attendee || !table) return json(res, 400, { ok: false, error: 'Please choose a valid attendee and table.' });
      db.pending.push({
        id: nextId(db.pending),
        status: 'pending',
        created_at: nowIso(),
        reviewed_at: '',
        reviewed_by: '',
        admin_note: '',
        note: stringField(body.note),
        submitter_name: stringField(body.submitter_name),
        submitter_email: stringField(body.submitter_email).toLowerCase(),
        submitter_organisation: stringField(body.submitter_organisation),
        attendee_id: attendee.id,
        requested_table_id: table.id,
        requested_table_number: table.table_number,
        attendee_snapshot: publicAttendee(attendee)
      });
      saveData(db);
      return json(res, 200, { ok: true, message: 'Request submitted for admin approval.' });
    }

    if (url.pathname.startsWith('/api/admin')) {
      if (!requireRole(req, res, ['admin'])) return;
      if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
        const unassigned = db.attendees.filter(a => !a.table_id).length;
        const assigned = db.attendees.length - unassigned;
        const pending = db.pending.filter(p => p.status === 'pending').length;
        return json(res, 200, { ok: true, summary: { attendees: db.attendees.length, assigned, unassigned, pending, tables: db.tables.length }, tables: tablesWithCounts() });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/attendees') {
        const rows = searchAttendees(url.searchParams, 'admin').map(adminAttendee);
        return json(res, 200, { ok: true, rows });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/import') {
        const body = await readJson(req);
        const result = importCsv(body.csv || '', body.mode || 'upsert');
        return json(res, 200, { ok: true, result });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/export.csv') {
        const csv = toCsv(db.attendees);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="gala-attendees-export.csv"',
          'Cache-Control': 'no-store'
        });
        return res.end(csv);
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/attendee') {
        const body = await readJson(req);
        const validTableIds = new Set(db.tables.map(t => Number(t.id)));
        const attendee = normalizeAttendee({ ...body, id: nextId(db.attendees) }, validTableIds);
        if (!attendee) return json(res, 400, { ok: false, error: 'Please add at least a name or an email.' });
        if (attendee.table_id && countAssigned(attendee.table_id) >= 10) return json(res, 400, { ok: false, error: 'That table is already full.' });
        db.attendees.push(attendee);
        saveData(db);
        return json(res, 200, { ok: true, attendee: adminAttendee(attendee) });
      }
      const attendeeMatch = url.pathname.match(/^\/api\/admin\/attendee\/(\d+)$/);
      if (attendeeMatch && req.method === 'PUT') {
        const body = await readJson(req);
        const attendee = attendeeById(attendeeMatch[1]);
        if (!attendee) return json(res, 404, { ok: false, error: 'Attendee not found.' });
        const validTableIds = new Set(db.tables.map(t => Number(t.id)));
        const normalized = normalizeAttendee({ ...attendee, ...body, id: attendee.id, created_at: attendee.created_at }, validTableIds);
        if (normalized.table_id && countAssigned(normalized.table_id, [attendee.id]) >= 10) return json(res, 400, { ok: false, error: 'That table is already full.' });
        Object.assign(attendee, normalized, { id: attendee.id, updated_at: nowIso() });
        saveData(db);
        return json(res, 200, { ok: true, attendee: adminAttendee(attendee) });
      }
      if (attendeeMatch && req.method === 'DELETE') {
        const id = Number(attendeeMatch[1]);
        db.attendees = db.attendees.filter(a => Number(a.id) !== id);
        saveData(db);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/assign') {
        const body = await readJson(req);
        const ids = Array.isArray(body.attendee_ids) ? body.attendee_ids : [body.attendee_id];
        const tableId = Number(body.table_id || 0);
        const validation = validateAssignment(ids, tableId);
        if (!validation.ok) return json(res, 400, { ok: false, error: validation.error });
        for (const attendee of validation.people) attendee.table_id = tableId;
        saveData(db);
        return json(res, 200, { ok: true, message: tableId ? `Assigned to table ${validation.table.table_number}.` : 'Unassigned.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/pending') {
        return json(res, 200, { ok: true, rows: pendingWithNames() });
      }
      const pendingMatch = url.pathname.match(/^\/api\/admin\/pending\/(\d+)\/(approve|reject)$/);
      if (pendingMatch && req.method === 'POST') {
        const body = await readJson(req);
        const item = db.pending.find(p => Number(p.id) === Number(pendingMatch[1]));
        if (!item) return json(res, 404, { ok: false, error: 'Request not found.' });
        if (item.status !== 'pending') return json(res, 400, { ok: false, error: 'This request is already reviewed.' });
        if (pendingMatch[2] === 'approve') {
          const validation = validateAssignment([item.attendee_id], item.requested_table_id);
          if (!validation.ok) return json(res, 400, { ok: false, error: validation.error });
          validation.people[0].table_id = item.requested_table_id;
          item.status = 'approved';
        } else {
          item.status = 'rejected';
        }
        item.admin_note = stringField(body.admin_note);
        item.reviewed_at = nowIso();
        item.reviewed_by = 'admin';
        saveData(db);
        return json(res, 200, { ok: true });
      }
    }

    return notFound(res);
  } catch (error) {
    return json(res, 500, { ok: false, error: error.message || 'Server error.' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (url.pathname === '/health') return json(res, 200, { ok: true });
  if (url.pathname === '/') return redirect(res, '/viewer');
  if (url.pathname === '/viewer' || url.pathname === '/embed/viewer') return staticFile(res, 'viewer.html');
  if (url.pathname === '/moderator' || url.pathname === '/embed/moderator') return staticFile(res, 'moderator.html');
  if (url.pathname === `/${ADMIN_PATH}` || url.pathname === `/embed/${ADMIN_PATH}`) return staticFile(res, 'admin.html');
  if (url.pathname === '/admin' || url.pathname === '/wp-admin' || url.pathname === '/gala-admin') return notFound(res);
  return staticFile(res, url.pathname.slice(1));
});

server.listen(PORT, () => {
  console.log(`Gala seating app running on port ${PORT}`);
  console.log(`Viewer: /viewer`);
  console.log(`Moderator: /moderator`);
  console.log(`Admin: /${ADMIN_PATH}`);
  if (ADMIN_PASSWORD === 'change-this-admin-password') console.warn('Set ADMIN_PASSWORD before using this app publicly.');
});
