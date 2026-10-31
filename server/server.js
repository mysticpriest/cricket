'use strict';

/* Cricket QC development server. Not approved for handling PHI. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.CRICKET_DATA_DIR || path.join(ROOT, 'data'));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const SECURE = process.env.NODE_ENV === 'production';
const COOKIE = 'cricket_session';
const SESSION_AGE_MS = 8 * 60 * 60 * 1000;
const ROLES = new Set(['agent', 'qc', 'admin']);
const OUTCOMES = new Set(['resolved', 'pending']);
const REVIEWS = new Set(['approved', 'coaching', 'flagged']);
const FILE_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const loginAttempts = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw Error('Invalid PORT');
if (SECURE && (!process.env.PUBLIC_ORIGIN || !process.env.PUBLIC_ORIGIN.startsWith('https://'))) {
  throw Error('Production requires PUBLIC_ORIGIN with an HTTPS URL');
}
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(DATA, 'cricket.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('agent','qc','admin')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES users(id),
  request_id TEXT UNIQUE,
  department TEXT NOT NULL,
  inquiry TEXT NOT NULL,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('resolved','pending')),
  note TEXT NOT NULL,
  events_json TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK(decision IN ('approved','coaching','flagged')),
  criteria_json TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  feedback TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER REFERENCES cases(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_agent ON cases(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_case ON reviews(case_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id, id);
`);

// Additive migrations preserve existing employees, local sessions, and case history.
for (const [table, column, definition] of [
  ['users', 'display_name', "TEXT NOT NULL DEFAULT ''"],
  ['cases', 'call_phone', "TEXT"],
  ['cases', 'call_started_at', "TEXT"]
]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_cases_phone ON cases(call_phone);');

function now() { return new Date().toISOString(); }
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== 64) return false;
  const computed = crypto.scryptSync(password, parts[1], expected.length);
  return crypto.timingSafeEqual(computed, expected);
}
function validatePassword(p) { return typeof p === 'string' && p.length >= 12 && p.length <= 128; }
function validateEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254; }
function clean(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function employeeName(v) {
  if (typeof v !== 'string' || v.trim().length > 80) return null;
  const name = v.trim().replace(/\s+/g, ' ');
  return name.length >= 2 && /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name) ? name : null;
}
function normalizeCallPhone(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const raw = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (raw.startsWith('+') ? '+' : '') + digits;
}
function err(status, message) { const error = new Error(message); error.status = status; throw error; }
function send(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 32768) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function parseCookie(req) {
  const entry = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  return entry ? entry.slice(COOKIE.length + 1) : null;
}
function sessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function tokenHash(raw) { return crypto.createHash('sha256').update(raw).digest('hex'); }
function setCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_AGE_MS / 1000)}${SECURE ? '; Secure' : ''}`;
}
function clearCookie() { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`; }
function currentUser(req) {
  const token = parseCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.role, u.display_name AS displayName FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), Date.now());
  return row || null;
}
function requireRole(user, ...allowed) {
  if (!user) err(401, 'Sign in required');
  if (!allowed.includes(user.role)) err(403, 'Insufficient permission');
}
function requireOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const expected = process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
  const origin = req.headers.origin;
  if (origin && origin !== expected) err(403, 'Invalid request origin');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) err(403, 'Cross-site request denied');
}
function audit(caseId, actorId, action, details = '') {
  db.prepare('INSERT INTO audit_events(case_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)').run(caseId, actorId, action, details, now());
}
function rateCheck(email) {
  const key = email.toLowerCase(); const time = Date.now();
  const existing = loginAttempts.get(key) || { n: 0, start: time };
  if (time - existing.start > 15 * 60000) { existing.n = 0; existing.start = time; }
  if (existing.n >= 8) err(429, 'Too many attempts. Try again later.');
  existing.n++;
  loginAttempts.set(key, existing);
}
function mapCase(row) {
  return {
    caseId: row.case_id, department: row.department, inquiry: row.inquiry, route: row.route,
    outcome: row.outcome, note: row.note, events: JSON.parse(row.events_json),
    callPhone: row.call_phone || null, callStartedAt: row.call_started_at || null,
    reviewStatus: row.review_status, createdAt: row.created_at,
    agent: row.agent_email, agentName: row.agent_name || null
  };
}
function listQuery(url, user) {
  const search = clean(url.searchParams.get('search'), 100);
  const status = clean(url.searchParams.get('status'), 32);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  let query = `FROM cases c JOIN users u ON u.id=c.agent_id WHERE 1=1`;
  const params = [];
  if (user.role === 'agent') { query += ' AND c.agent_id=?'; params.push(user.id); }
  if (status && ['pending_review','approved','coaching','flagged'].includes(status)) { query += ' AND c.review_status=?'; params.push(status); }
  if (search) {
    const phoneSearch = normalizeCallPhone(search);
    query += ' AND (c.case_id LIKE ? OR c.inquiry LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?';
    params.push(...Array(4).fill('%' + search + '%'));
    if (phoneSearch) {
      query += ' OR c.call_phone LIKE ?';
      params.push('%' + phoneSearch.replace(/\D/g, '') + '%');
    }
    query += ')';
  }
  const total = db.prepare('SELECT count(*) AS n ' + query).get(...params).n;
  const rows = db.prepare(`SELECT c.*, u.email AS agent_email, u.display_name AS agent_name ${query} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, cases: rows.map(mapCase) };
}
function processAPI(req, res, url) {
  requireOrigin(req);
  const user = currentUser(req);
  const p = url.pathname;
  if (p === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, mode: 'development' });
  if (p === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user });
  if (p === '/api/dashboard' && req.method === 'GET') {
    requireRole(user, 'agent', 'qc', 'admin');
    const where = user.role === 'agent' ? 'WHERE agent_id=?' : '';
    const args = user.role === 'agent' ? [user.id] : [];
    const metrics = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN review_status='pending_review' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN review_status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN outcome='resolved' THEN 1 ELSE 0 END) AS resolved
      FROM cases ${where}`).get(...args);
    return send(res, 200, {
      total: metrics.total || 0,
      pending: metrics.pending || 0,
      approved: metrics.approved || 0,
      resolved: metrics.resolved || 0,
      scope: user.role === 'agent' ? 'my_cases' : 'all_cases'
    });
  }
  if (p === '/api/auth/login' && req.method === 'POST') return readBody(req).then(data => {
    const email = clean(data.email, 254).toLowerCase(); const password = data.password;
    rateCheck(email);
    const found = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (typeof password !== 'string' || !found || !verifyPassword(password, found.password_hash)) err(401, 'Incorrect email or password');
    loginAttempts.delete(email);
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    const token = sessionToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), found.id, Date.now() + SESSION_AGE_MS);
    return send(res, 200, { user: { id: found.id, email: found.email, role: found.role, displayName: found.display_name || '' } }, { 'Set-Cookie': setCookie(token) });
  });
  if (p === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookie(req); if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
  }
  if (p === '/api/users' && req.method === 'GET') {
    requireRole(user, 'admin');
    return send(res, 200, { users: db.prepare('SELECT id,email,display_name AS displayName,role,created_at FROM users ORDER BY id').all() });
  }
  if (p === '/api/users' && req.method === 'POST') {
    requireRole(user, 'admin');
    return readBody(req).then(data => {
      const email = clean(data.email, 254).toLowerCase();
      const password = data.password;
      const role = data.role;
      const displayName = employeeName(data.displayName);
      if (!validateEmail(email) || !validatePassword(password) || !ROLES.has(role) || !displayName) {
        err(400, 'Enter an employee name, valid email, role, and password of at least 12 characters');
      }
      try {
        const result = db.prepare('INSERT INTO users(email,display_name,role,password_hash,created_at) VALUES(?,?,?,?,?)')
          .run(email, displayName, role, hashPassword(password), now());
        return send(res, 201, { user: { id: Number(result.lastInsertRowid), email, displayName, role } });
      }
      catch (e) { if (e.code === 'ERR_SQLITE_ERROR') err(409, 'Account already exists'); throw e; }
    });
  }
  const employeeMatch = p.match(/^\/api\/users\/(\d+)$/);
  if (employeeMatch && req.method === 'PATCH') {
    requireRole(user, 'admin');
    return readBody(req).then(data => {
      const displayName = employeeName(data.displayName);
      if (!displayName) err(400, 'Enter a valid employee name (2–80 characters)');
      const targetId = Number(employeeMatch[1]);
      const result = db.prepare('UPDATE users SET display_name=? WHERE id=?').run(displayName, targetId);
      if (!result.changes) err(404, 'Employee not found');
      return send(res, 200, { user: { id: targetId, displayName } });
    });
  }
  if (p === '/api/cases' && req.method === 'POST') {
    requireRole(user, 'agent', 'admin');
    return readBody(req).then(data => {
      const department = clean(data.department, 60);
      const inquiry = clean(data.inquiry, 150);
      const route = clean(data.route, 100);
      const note = clean(data.note, 4000);
      const outcome = data.outcome;
      const events = data.events;
      const requestId = clean(data.requestId, 64);
      const callPhone = normalizeCallPhone(data.callPhone);
      if (!callPhone) err(400, 'Enter a valid call phone number before submitting a case');
      const rawStarted = data.callStartedAt;
      const callStartedAt = typeof rawStarted === 'string' && rawStarted.length <= 40 && !Number.isNaN(Date.parse(rawStarted))
        ? new Date(rawStarted).toISOString()
        : now();
      if (requestId && !/^[a-f0-9-]{36}$/i.test(requestId)) err(400, 'Invalid submission request ID');
      if (!department || !inquiry || !route || note.length < 15 || !OUTCOMES.has(outcome) || !Array.isArray(events) || events.length > 50 || !events.every(x => typeof x === 'string' && x.length <= 250)) err(400, 'Invalid case data');
      const created = now();
      if (requestId) {
        const existing = db.prepare('SELECT case_id FROM cases WHERE request_id=? AND agent_id=?').get(requestId, user.id);
        if (existing) return send(res, 200, { caseId: existing.case_id, reviewStatus: 'pending_review', duplicate: true });
      }
      // SQLite autoincrement ID guarantees uniqueness across concurrent requests.
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('INSERT INTO cases(agent_id,request_id,department,inquiry,route,outcome,note,events_json,call_phone,call_started_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(user.id, requestId || null, department, inquiry, route, outcome, note, JSON.stringify(events), callPhone, callStartedAt, created);
        const id = Number(result.lastInsertRowid);
        const caseId = `CR-${created.slice(0, 10).replaceAll('-', '')}-${String(id).padStart(6, '0')}`;
        db.prepare('UPDATE cases SET case_id=? WHERE id=?').run(caseId, id);
        audit(id, user.id, 'case_created', `outcome=${outcome}`);
        db.exec('COMMIT');
        return send(res, 201, { caseId, reviewStatus: 'pending_review', createdAt: created });
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    });
  }
  if (p === '/api/cases' && req.method === 'GET') {
    requireRole(user, 'agent', 'qc', 'admin');
    return send(res, 200, listQuery(url, user));
  }
  const match = p.match(/^\/api\/cases\/(CR-\d{8}-\d{6,})$/);
  if (match && req.method === 'GET') {
    requireRole(user, 'agent', 'qc', 'admin');
    const row = db.prepare('SELECT c.*, u.email AS agent_email, u.display_name AS agent_name FROM cases c JOIN users u ON u.id=c.agent_id WHERE c.case_id=?').get(match[1]);
    if (!row) err(404, 'Case not found');
    if (user.role === 'agent' && row.agent_id !== user.id) err(403, 'Insufficient permission');
    const reviews = db.prepare('SELECT r.id,r.decision,r.criteria_json,r.score,r.feedback,r.created_at,u.email AS reviewer FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.case_id=? ORDER BY r.id DESC').all(row.id).map(x => ({ ...x, criteria: JSON.parse(x.criteria_json), criteria_json: undefined }));
    const history = db.prepare('SELECT a.action,a.details,a.created_at,u.email AS actor FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.case_id=? ORDER BY a.id ASC').all(row.id);
    return send(res, 200, { case: mapCase(row), reviews, history });
  }
  const reviewMatch = p.match(/^\/api\/cases\/(CR-\d{8}-\d{6,})\/reviews$/);
  if (reviewMatch && req.method === 'POST') {
    requireRole(user, 'qc', 'admin');
    return readBody(req).then(data => {
      const found = db.prepare('SELECT id FROM cases WHERE case_id=?').get(reviewMatch[1]);
      if (!found) err(404, 'Case not found');
      const decision = data.decision;
      const criteria = data.criteria;
      const feedback = clean(data.feedback, 2000);
      const keys = ['verification', 'accuracy', 'resolution', 'documentation', 'professionalism'];
      if (!REVIEWS.has(decision) || !criteria || typeof criteria !== 'object' || !keys.every(k => [true, false, null].includes(criteria[k]))) err(400, 'Invalid review criteria');
      const applicable = keys.filter(k => criteria[k] !== null);
      if (!applicable.length) err(400, 'Select at least one applicable criterion');
      if (decision !== 'approved' && feedback.length < 5) err(400, 'Feedback is required for coaching or flagged reviews');
      const score = Math.round(applicable.filter(k => criteria[k]).length / applicable.length * 100);
      const created = now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO reviews(case_id,reviewer_id,decision,criteria_json,score,feedback,created_at) VALUES(?,?,?,?,?,?,?)').run(found.id, user.id, decision, JSON.stringify(criteria), score, feedback, created);
        db.prepare('UPDATE cases SET review_status=? WHERE id=?').run(decision, found.id);
        audit(found.id, user.id, 'review_submitted', `decision=${decision};score=${score}`);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 201, { ok: true, decision, score, createdAt: created });
    });
  }
  err(404, 'API endpoint not found');
}

/* Authenticated workspace files are protected on the server.
   Frontend role cards are only visual hints; this is the access boundary. */
const PUBLIC_FILES = new Set(['/login.html', '/login.js', '/workspace.css']);
const PAGE_ROLES = new Map([
  ['/inbound.html', ['agent', 'admin']],
  ['/inbound.css', ['agent', 'admin']],
  ['/inbound.js', ['agent', 'admin']],
  ['/qc-bridge.js', ['agent', 'admin']],
  ['/outbound.html', ['agent', 'admin']],
  ['/cases.html', ['agent', 'admin']],
  ['/cases.js', ['agent', 'admin']],
  ['/qc.html', ['qc', 'admin']],
  ['/qc.js', ['qc', 'admin']],
  ['/staff.html', ['admin']],
  ['/staff.js', ['admin']]
]);

function denyWorkspaceAccess(req, res, decoded) {
  if (PUBLIC_FILES.has(decoded)) return false;
  const user = currentUser(req);
  const isPage = decoded.endsWith('.html');
  if (!user) {
    if (isPage) {
      const next = encodeURIComponent(decoded.slice(1));
      res.writeHead(302, { Location: '/login.html?next=' + next, 'Cache-Control': 'no-store' });
      res.end();
    } else send(res, 401, { error: 'Sign in required' });
    return true;
  }
  const roles = PAGE_ROLES.get(decoded);
  if (roles && !roles.includes(user.role)) {
    if (isPage) {
      res.writeHead(403, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      if (req.method === 'HEAD') res.end();
      else res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access restricted · Cricket</title><body style="font:16px system-ui;padding:12vh 8vw;background:#f7f9fc;color:#14223d"><p style="color:#2563eb;font-weight:700">CRICKET · ACCESS CONTROL</p><h1>This workspace is restricted.</h1><p>Your account does not have the required role for this division.</p><p><a href="/index.html">Return to your dashboard</a></p></body></html>');
    } else send(res, 403, { error: 'Insufficient permission' });
    return true;
  }
  return false;
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (_) { return send(res, 400, { error: 'Invalid path' }); }
  if (decoded === '/') decoded = '/index.html';
  if (decoded.includes('\\') || decoded.includes('\0') || decoded !== path.posix.normalize(decoded) || decoded.split('/').includes('..')) return send(res, 403, { error: 'Forbidden' });
  const filename = path.resolve(ROOT, '.' + decoded);
  if (!filename.startsWith(ROOT + path.sep) || filename.startsWith(path.join(ROOT, 'server') + path.sep) || filename.startsWith(path.join(ROOT, 'tests') + path.sep) || filename.startsWith(path.join(ROOT, 'data') + path.sep) || path.basename(filename).startsWith('.')) return send(res, 404, { error: 'Not found' });
  const type = FILE_TYPES[path.extname(filename)];
  if (!type) return send(res, 404, { error: 'Not found' });
  if (denyWorkspaceAccess(req, res, decoded)) return;
  fs.readFile(filename, (error, content) => {
    if (error) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

const initialCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (!initialCount) {
  const email = String(process.env.CRICKET_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.CRICKET_ADMIN_PASSWORD;
  const adminName = employeeName(process.env.CRICKET_ADMIN_NAME) || 'Administrator';
  if (!validateEmail(email) || !validatePassword(password)) throw Error('First run requires CRICKET_ADMIN_EMAIL and CRICKET_ADMIN_PASSWORD (12+ characters). See README.md.');
  db.prepare('INSERT INTO users(email,display_name,role,password_hash,created_at) VALUES(?,?,?,?,?)').run(email, adminName, 'admin', hashPassword(password), now());
  process.stdout.write('Cricket QC administrator initialized.\n');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) await processAPI(req, res, url);
    else serveStatic(req, res, url.pathname);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
    if (!error.status) console.error('[Cricket QC]', error);
  }
});
server.listen(PORT, HOST, () => process.stdout.write(`Cricket QC available at http://${HOST}:${PORT}\n`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
