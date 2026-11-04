'use strict';

/* Cricket QC development server. Not approved for handling PHI. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { workbookXlsx } = require('./xlsx');
const { analyticsAgents, analyticsQc } = require('./analytics');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.CRICKET_DATA_DIR || path.join(ROOT, 'data'));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const SECURE = process.env.NODE_ENV === 'production';
const COOKIE = 'cricket_session';
const SESSION_AGE_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 20 * 60 * 1000;
const PRESENCE_FRESH_MS = 50 * 1000;
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
  ['cases', 'call_started_at', "TEXT"],
  ['cases', 'deleted_at', 'TEXT'],
  ['cases', 'deleted_by', 'INTEGER'],
  ['sessions', 'last_active_at', 'INTEGER NOT NULL DEFAULT 0']
]) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_cases_phone ON cases(call_phone);');
db.exec(`
CREATE TABLE IF NOT EXISTS live_presence (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  division TEXT NOT NULL,
  route TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL,
  route_started_at INTEGER,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON live_presence(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_events(actor_id,created_at DESC);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS qc_saved_cases (
  reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(reviewer_id, case_id)
);
CREATE INDEX IF NOT EXISTS idx_qc_saved_reviewer ON qc_saved_cases(reviewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_deleted ON cases(deleted_at, id);
`);

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
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${SECURE ? '; Secure' : ''}`; // browser-session cookie, no persistent Max-Age
}
function clearCookie() { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}`; }
function currentUser(req, touch = true) {
  const token = parseCookie(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const timestamp = Date.now();
  const hash = tokenHash(token);
  const row = db.prepare(`SELECT u.id, u.email, u.role, u.display_name AS displayName
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? AND s.last_active_at>?`)
    .get(hash, timestamp, timestamp - SESSION_IDLE_MS);
  if (row && touch) db.prepare('UPDATE sessions SET last_active_at=? WHERE token_hash=?').run(timestamp, hash);
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
    reviewStatus: row.review_status, createdAt: row.created_at, deletedAt: row.deleted_at || null,
    agent: row.agent_email, agentName: row.agent_name || null
  };
}
function listQuery(url, user, maxLimit = 100) {
  const search = clean(url.searchParams.get('search'), 100);
  const status = clean(url.searchParams.get('status'), 32);
  const limit = Math.min(maxLimit, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const savedOnly = url.searchParams.get('saved') === '1';
  const deletedOnly = url.searchParams.get('deleted') === '1' && user.role === 'admin';
  if (savedOnly && !['qc','admin'].includes(user.role)) err(403, 'Insufficient permission');
  let query = `FROM cases c JOIN users u ON u.id=c.agent_id WHERE c.deleted_at IS ${deletedOnly ? 'NOT NULL' : 'NULL'}`;
  const params = [];
  if (savedOnly) {
    query += ' AND EXISTS (SELECT 1 FROM qc_saved_cases sc WHERE sc.case_id=c.id AND sc.reviewer_id=?)';
    params.push(user.id);
  }
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
function sendXlsx(res, filename, sheets) {
  const buffer = workbookXlsx(sheets);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(buffer);
}

function processAPI(req, res, url) {
  requireOrigin(req);
  const p = url.pathname;
  // Polling/monitoring endpoints are read-only and must not extend idle sessions.
  const user = currentUser(req, req.method !== 'GET' && p !== '/api/presence');
  if (p === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, mode: 'development' });
  if (p === '/api/auth/me' && req.method === 'GET') return send(res, 200, { user });
  if (p === '/api/presence' && req.method === 'POST') {
    requireRole(user,'agent','qc','admin');
    return readBody(req).then(data=>{
      const divisions = new Set(['overview','inbound','outbound','cases','qc','staff','operations','analytics']);
      const stages = new Set(['idle','intake','selecting','working','verification','documentation','completed']);
      const routes = new Set(['','appointment','clinic','scheduling']);
      const division = data.division;
      const stage = data.stage;
      const route = typeof data.route === 'string' ? data.route : '';
      const step = typeof data.step === 'string' ? data.step : '';
      if(!divisions.has(division) || !stages.has(stage) ||
         (division==='inbound' && user.role==='qc') ||
         (['qc','operations','staff'].includes(division) && user.role==='agent') ||
         (['operations','staff'].includes(division) && user.role!=='admin') ||
         !routes.has(route) || (route && division !== 'inbound') ||
         !/^[a-zA-Z0-9_-]{0,64}$/.test(step) ||
         (division !== 'inbound' && (stage !== 'idle' || step))) {
        err(400,'Invalid presence state');
      }
      // Server derives user identity from the session; no impersonation fields.
      const token = parseCookie(req);
      const hash = tokenHash(token);
      const previous=db.prepare('SELECT * FROM live_presence WHERE token_hash=?').get(hash);
      const time=Date.now();
      const routeStarted = route ? (previous && previous.route===route && previous.route_started_at
        ? previous.route_started_at : time) : null;
      db.prepare(`INSERT INTO live_presence(token_hash,user_id,division,route,step,stage,route_started_at,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(token_hash) DO UPDATE SET user_id=excluded.user_id,division=excluded.division,
        route=excluded.route,step=excluded.step,stage=excluded.stage,
        route_started_at=excluded.route_started_at,last_seen_at=excluded.last_seen_at`)
        .run(hash,user.id,division,route,step,stage,routeStarted,time);
      // Never log callers, phone numbers, patient details, or freeform inputs.
      if (!previous || previous.division !== division) {
        audit(null,user.id,'workspace_opened',division);
      }
      if (route && (!previous || previous.route !== route)) {
        audit(null,user.id,'route_started',route);
      } else if (previous && previous.route && !route) {
        audit(null,user.id,'route_left',previous.route);
      }
      if (route && previous && previous.route===route && (previous.step!==step || previous.stage!==stage)) {
        audit(null,user.id,'route_progress',route+' / '+stage+' / '+(step||'—'));
      }
      return send(res,200,{ok:true,serverTime:time,routeStartedAt:routeStarted});
    });
  }
  if (p === '/api/active-agents' && req.method === 'GET') {
    requireRole(user,'agent','qc','admin');
    const timestamp=Date.now();
    const rows=db.prepare(`
      SELECT u.id,u.email,u.display_name AS displayName,p.division,p.route,p.step,p.stage,
        MIN(p.route_started_at) AS routeStartedAt,MAX(p.last_seen_at) AS lastSeenAt
      FROM live_presence p
      JOIN users u ON u.id=p.user_id
      JOIN sessions s ON s.token_hash=p.token_hash
      WHERE u.role='agent' AND p.last_seen_at>? AND s.expires_at>? AND s.last_active_at>?
      GROUP BY u.id,p.division,p.route,p.step,p.stage
      ORDER BY lastSeenAt DESC LIMIT 100`)
      .all(timestamp-PRESENCE_FRESH_MS,timestamp,timestamp-SESSION_IDLE_MS);
    const agents = [];
    const unique=new Set();
    for(const row of rows){
      if(unique.has(row.id)) continue;
      unique.add(row.id);
      agents.push({id:row.id,displayName:row.displayName||'Agent',division:row.division,
        route:row.route,step:row.step,stage:row.stage,
        routeStartedAt:row.routeStartedAt,lastSeenAt:row.lastSeenAt});
    }
    return send(res,200,{agents,total:agents.length,serverTime:timestamp,refreshSeconds:5});
  }
  if (p === '/api/admin/operations' && req.method === 'GET') {
    requireRole(user,'admin');
    const timestamp=Date.now();
    const rows=db.prepare(`
      SELECT u.id,u.display_name AS displayName,u.email,u.role,p.division,p.route,p.step,
        p.stage,p.route_started_at AS routeStartedAt,p.last_seen_at AS lastSeenAt,
        s.last_active_at AS lastActiveAt
      FROM live_presence p JOIN users u ON u.id=p.user_id
      JOIN sessions s ON s.token_hash=p.token_hash
      WHERE p.last_seen_at>? AND s.expires_at>? AND s.last_active_at>?
      ORDER BY p.last_seen_at DESC LIMIT 200`)
      .all(timestamp-PRESENCE_FRESH_MS,timestamp,timestamp-SESSION_IDLE_MS);
    const seen=new Set();
    const people=rows.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;});
    return send(res,200,{people,total:people.length,serverTime:timestamp});
  }
  if (p === '/api/admin/audit' && req.method === 'GET') {
    requireRole(user,'admin');
    const actorRaw=url.searchParams.get('actorId')||'';
    const actorId=actorRaw && /^\d+$/.test(actorRaw) ? Number(actorRaw) : null;
    if (actorRaw && (!actorId || !Number.isSafeInteger(actorId))) err(400,'Invalid employee filter');
    const scope=url.searchParams.get('scope')||'day';
    if(!['shift','day','week','all'].includes(scope))err(400,'Invalid date filter');
    if(scope==='shift' && !actorId)err(400,'Select an employee for shift history');
    const conditions=[];const args=[];
    if(actorId){conditions.push('a.actor_id=?');args.push(actorId);}
    let since=null;
    if(scope==='day') since=new Date(Date.now()-24*60*60*1000).toISOString();
    if(scope==='week') since=new Date(Date.now()-7*24*60*60*1000).toISOString();
    if(scope==='shift'){
      const last=db.prepare("SELECT created_at FROM audit_events WHERE actor_id=? AND action='signed_in' ORDER BY id DESC LIMIT 1").get(actorId);
      since=last ? last.created_at : new Date(Date.now()-12*60*60*1000).toISOString();
    }
    if(since){conditions.push('a.created_at>=?');args.push(since);}
    const where=conditions.length?'WHERE '+conditions.join(' AND '):'';
    const limit=Math.min(100,Math.max(1,parseInt(url.searchParams.get('limit'),10)||50));
    const offset=Math.min(10000,Math.max(0,parseInt(url.searchParams.get('offset'),10)||0));
    const total=db.prepare(`SELECT count(*) AS n FROM audit_events a ${where}`).get(...args).n;
    const events=db.prepare(`
      SELECT a.id,a.action,a.details,a.created_at AS createdAt,
        c.case_id AS caseId,u.id AS actorId,u.email AS actorEmail,
        u.display_name AS actorName,u.role AS actorRole
      FROM audit_events a JOIN users u ON u.id=a.actor_id
      LEFT JOIN cases c ON c.id=a.case_id
      ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
      .all(...args,limit,offset);
    return send(res,200,{events,total,limit,offset,serverTime:Date.now(),scope,actorId});
  }

  // Agent analytics are company-wide and available to all authenticated employees.
  // QC analytics are a separate, server-enforced QC/admin-only reporting scope.
  if (p === '/api/analytics/agents' && req.method === 'GET') {
    requireRole(user, 'agent', 'qc', 'admin');
    return send(res, 200, analyticsAgents(db, url.searchParams));
  }
  if (p === '/api/analytics/qc' && req.method === 'GET') {
    requireRole(user, 'qc', 'admin');
    return send(res, 200, analyticsQc(db, url.searchParams));
  }
  if (p === '/api/dashboard' && req.method === 'GET') {
    requireRole(user, 'agent', 'qc', 'admin');
    const where = user.role === 'agent' ? 'WHERE agent_id=?' : '';
    const args = user.role === 'agent' ? [user.id] : [];
    const metrics = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN review_status='pending_review' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN review_status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN outcome='resolved' THEN 1 ELSE 0 END) AS resolved
      FROM cases ${where ? where + ' AND deleted_at IS NULL' : 'WHERE deleted_at IS NULL'}`).get(...args);
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
    db.prepare('DELETE FROM sessions WHERE expires_at<? OR last_active_at<?').run(Date.now(), Date.now() - SESSION_IDLE_MS);
    const token = sessionToken();
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,last_active_at) VALUES(?,?,?,?)').run(tokenHash(token), found.id, Date.now() + SESSION_AGE_MS, Date.now());
    audit(null,found.id,'signed_in','Employee began a session');
    return send(res, 200, { user: { id: found.id, email: found.email, role: found.role, displayName: found.display_name || '' } }, { 'Set-Cookie': setCookie(token) });
  });
  if (p === '/api/auth/activity' && req.method === 'POST') {
    requireRole(user, 'agent', 'qc', 'admin');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    if (user) audit(null,user.id,'signed_out','Employee ended their session');
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
        const newId=Number(result.lastInsertRowid); audit(null,user.id,'staff_created',`Account #${newId} · role=${role}`); return send(res, 201, { user: { id: newId, email, displayName, role } });
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
      audit(null,user.id,'staff_name_updated',`Updated display name on account #${targetId}`);
      return send(res, 200, { user: { id: targetId, displayName } });
    });
  }
  if (p === '/api/qc/work-later' && req.method === 'GET') {
    requireRole(user, 'qc', 'admin');
    const rows = db.prepare(`
      SELECT c.case_id FROM qc_saved_cases s JOIN cases c ON c.id=s.case_id
      WHERE s.reviewer_id=? AND c.deleted_at IS NULL ORDER BY s.created_at DESC
    `).all(user.id);
    return send(res, 200, { caseIds: rows.map(row => row.case_id), total: rows.length });
  }
  if (p === '/api/qc/work-later' && req.method === 'POST') {
    requireRole(user, 'qc', 'admin');
    return readBody(req).then(data => {
      const id = typeof data.caseId === 'string' ? data.caseId : '';
      const found = db.prepare('SELECT id FROM cases WHERE case_id=? AND deleted_at IS NULL').get(id);
      if (!found) err(404, 'Case not found');
      const inserted=db.prepare('INSERT OR IGNORE INTO qc_saved_cases(reviewer_id,case_id,created_at) VALUES(?,?,?)').run(user.id, found.id, now());
      if(inserted.changes) audit(found.id,user.id,'work_later_saved','Saved case to personal work folder');
      return send(res, 200, { ok: true, caseId: id, saved: true });
    });
  }
  const savedMatch = p.match(/^\/api\/qc\/work-later\/(CR-\d{8}-\d{6,})$/);
  if (savedMatch && req.method === 'DELETE') {
    requireRole(user, 'qc', 'admin');
    const found=db.prepare('SELECT id FROM cases WHERE case_id=?').get(savedMatch[1]);
    if(found) {
      const result=db.prepare('DELETE FROM qc_saved_cases WHERE reviewer_id=? AND case_id=?').run(user.id,found.id);
      if(result.changes) audit(found.id,user.id,'work_later_removed','Removed from personal work folder');
    }
    return send(res, 200, { ok: true, caseId: savedMatch[1], saved: false });
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
    if (!row || (row.deleted_at && user.role !== 'admin')) err(404, 'Case not found');
    if (user.role === 'agent' && row.agent_id !== user.id) err(403, 'Insufficient permission');
    const reviews = db.prepare('SELECT r.id,r.decision,r.criteria_json,r.score,r.feedback,r.created_at,u.email AS reviewer FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.case_id=? ORDER BY r.id DESC').all(row.id).map(x => ({ ...x, criteria: JSON.parse(x.criteria_json), criteria_json: undefined }));
    const history = db.prepare('SELECT a.action,a.details,a.created_at,u.email AS actor FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.case_id=? ORDER BY a.id ASC').all(row.id);
    return send(res, 200, { case: mapCase(row), reviews, history });
  }
  const caseAction = p.match(/^\/api\/cases\/(CR-\d{8}-\d{6,})\/(export|restore)$/);
  if (caseAction && req.method === 'GET' && caseAction[2] === 'export') {
    requireRole(user, 'qc', 'admin');
    const row = db.prepare('SELECT c.*, u.email AS agent_email, u.display_name AS agent_name FROM cases c JOIN users u ON u.id=c.agent_id WHERE c.case_id=? AND c.deleted_at IS NULL').get(caseAction[1]);
    if (!row) err(404, 'Case not found');
    const caseData = mapCase(row);
    const reviews = db.prepare('SELECT r.*, u.email AS reviewer_email FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE case_id=? ORDER BY r.id DESC').all(row.id);
    const info = [
      ['Field','Value'], ['Case ID',caseData.caseId], ['Agent',caseData.agentName || caseData.agent],
      ['Agent email',caseData.agent], ['Caller number',caseData.callPhone || 'Not captured'],
      ['Call started',caseData.callStartedAt || 'Not captured'], ['Created',caseData.createdAt],
      ['Department',caseData.department], ['Inquiry',caseData.inquiry], ['Route',caseData.route],
      ['Outcome',caseData.outcome], ['QC status',caseData.reviewStatus], ['Documentation',caseData.note]
    ];
    const sheets = [
      { name:'Case details', rows:info },
      { name:'Workflow actions', rows:[['Step','Confirmed action'], ...caseData.events.map((event, i) => [i+1,event])] },
      { name:'QC reviews', rows:[['Reviewed at','Reviewer','Decision','Score','Feedback'],...reviews.map(review=>[review.created_at,review.reviewer_email,review.decision,review.score,review.feedback])] }
    ];
    audit(row.id,user.id,'case_exported','Exported Excel workbook');
    return sendXlsx(res, 'Cricket-' + caseData.caseId + '.xlsx', sheets);
  }
  if (p === '/api/qc/export' && req.method === 'GET') {
    requireRole(user, 'qc', 'admin');
    const opts = new URL(url);
    opts.searchParams.set('limit','1000');
    opts.searchParams.set('offset','0');
    if (opts.searchParams.get('deleted') === '1') err(400,'Removed cases cannot be exported');
    const result = listQuery(opts,user,1000);
    const head = ['Case ID','Agent name','Agent email','Caller phone','Call started','Department','Inquiry','Route','Outcome','Review status','Created','Documentation','Workflow events'];
    const rows = result.cases.map(item=>[item.caseId,item.agentName || '',item.agent,item.callPhone || '',item.callStartedAt || '',item.department,item.inquiry,item.route,item.outcome,item.reviewStatus,item.createdAt,item.note,item.events.join(' | ')]);
    audit(null,user.id,'cases_exported','Exported '+rows.length+' case(s)');
    return sendXlsx(res,'Cricket-QC-cases-'+new Date().toISOString().slice(0,10)+'.xlsx',[{name:'QC cases',rows:[head,...rows]}]);
  }
  if (caseAction && caseAction[2] === 'restore' && req.method === 'POST') {
    requireRole(user, 'admin');
    const found=db.prepare('SELECT id FROM cases WHERE case_id=? AND deleted_at IS NOT NULL').get(caseAction[1]);
    if (!found) err(404,'Removed case not found');
    db.prepare('UPDATE cases SET deleted_at=NULL, deleted_by=NULL WHERE id=?').run(found.id);
    audit(found.id,user.id,'case_restored','Restored to QC queue');
    return send(res, 200, {ok:true,caseId:caseAction[1]});
  }
  const caseDelete = p.match(/^\/api\/cases\/(CR-\d{8}-\d{6,})$/);
  if (caseDelete && req.method === 'DELETE') {
    requireRole(user,'qc','admin');
    return readBody(req).then(data=>{
      if (data.confirmCaseId !== caseDelete[1]) err(400,'Type the exact Case ID to confirm removal');
      const found=db.prepare('SELECT id FROM cases WHERE case_id=? AND deleted_at IS NULL').get(caseDelete[1]);
      if (!found) err(404,'Case not found');
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('UPDATE cases SET deleted_at=?,deleted_by=? WHERE id=?').run(now(),user.id,found.id);
        audit(found.id,user.id,'case_removed','Soft-deleted from active QC queue');
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      return send(res,200,{ok:true,caseId:caseDelete[1],removed:true});
    });
  }

  const reviewMatch = p.match(/^\/api\/cases\/(CR-\d{8}-\d{6,})\/reviews$/);
  if (reviewMatch && req.method === 'POST') {
    requireRole(user, 'qc', 'admin');
    return readBody(req).then(data => {
      const found = db.prepare('SELECT id FROM cases WHERE case_id=? AND deleted_at IS NULL').get(reviewMatch[1]);
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
  ['/staff.js', ['admin']],
  ['/operations.html', ['admin']],
  ['/operations.js', ['admin']],
  ['/operations.css', ['admin']],
  ['/analytics.html', ['agent', 'qc', 'admin']],
  ['/analytics.js', ['agent', 'qc', 'admin']],
  ['/analytics.css', ['agent', 'qc', 'admin']]
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
