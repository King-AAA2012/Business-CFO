// SQLite store (Node's built-in node:sqlite). One file: data/cfo.db
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA = process.env.CFO_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'cfo.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, username TEXT UNIQUE, pass TEXT, role TEXT DEFAULT 'staff', active INTEGER DEFAULT 1, created TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER, exp INTEGER);
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS counters(k TEXT PRIMARY KEY, n INTEGER);
CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY, name TEXT, type TEXT, bank TEXT, branch TEXT, ifsc TEXT, acno TEXT, upi TEXT, opening REAL DEFAULT 0, is_default INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, aa_consent TEXT, aa_status TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, sku TEXT, barcode TEXT UNIQUE, name TEXT, unit TEXT, cat TEXT, brand TEXT, hsn TEXT, gst REAL DEFAULT 0, cost REAL DEFAULT 0, price REAL DEFAULT 0, mrp REAL, qty REAL DEFAULT 0, th REAL DEFAULT 5, reorder_qty REAL DEFAULT 0, sup_id INTEGER, location TEXT, notes TEXT, image TEXT, track_batch INTEGER DEFAULT 0, archived INTEGER DEFAULT 0, created TEXT);
CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY, pid INTEGER, code TEXT, expiry TEXT, qty REAL, cost REAL, created TEXT);
CREATE TABLE IF NOT EXISTS moves(id INTEGER PRIMARY KEY, pid INTEGER, batch_id INTEGER, date TEXT, at INTEGER, q REAL, type TEXT, ref TEXT, doc_id INTEGER, note TEXT, user TEXT);
CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY, kind TEXT, name TEXT, phone TEXT, email TEXT, gstin TEXT, address TEXT, state TEXT, credit_limit REAL DEFAULT 0, notes TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, kind TEXT, no TEXT, date TEXT, due TEXT, party_id INTEGER, inter INTEGER DEFAULT 0, incl INTEGER DEFAULT 0, disc REAL DEFAULT 0, sub REAL, taxable REAL, gst REAL, roundoff REAL DEFAULT 0, total REAL, cogs REAL DEFAULT 0, notes TEXT, ref_doc INTEGER, converted INTEGER, x INTEGER DEFAULT 0, paylink TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS doc_lines(id INTEGER PRIMARY KEY, doc_id INTEGER, pid INTEGER, name TEXT, hsn TEXT, qty REAL, price REAL, gst_rate REAL, taxable REAL, tax REAL, cost REAL DEFAULT 0, batch TEXT, expiry TEXT);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY, descr TEXT, cat TEXT, date TEXT, total REAL, payee TEXT, due TEXT, recurring_id INTEGER, x INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS recurring(id INTEGER PRIMARY KEY, descr TEXT, cat TEXT, amount REAL, payee TEXT, freq TEXT, next_date TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, dir TEXT, amt REAL, date TEXT, account_id INTEGER, ref_type TEXT, ref_id INTEGER, party_id INTEGER, method TEXT, utr TEXT, note TEXT, x INTEGER DEFAULT 0, created_at TEXT);
CREATE TABLE IF NOT EXISTS transfers(id INTEGER PRIMARY KEY, from_acc INTEGER, to_acc INTEGER, amt REAL, date TEXT, note TEXT, x INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS bank_txns(id INTEGER PRIMARY KEY, account_id INTEGER, date TEXT, narration TEXT, amount REAL, balance REAL, ref TEXT, hash TEXT UNIQUE, status TEXT DEFAULT 'unmatched', payment_id INTEGER, source TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT, user TEXT, action TEXT);
CREATE INDEX IF NOT EXISTS i_moves_pid ON moves(pid);
CREATE INDEX IF NOT EXISTS i_lines_doc ON doc_lines(doc_id);
CREATE INDEX IF NOT EXISTS i_pay_ref ON payments(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS i_docs_kind ON docs(kind, date);
`);

const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

// Runs fn inside a transaction; nested calls join the outer one.
let depth = 0;
function tx(fn) {
  if (depth) return fn();
  db.exec('BEGIN');
  depth++;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  const r = run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map(k => obj[k] ?? null));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => obj[k] ?? null), id);
}
function next(k) {
  run('INSERT INTO counters(k,n) VALUES(?,1) ON CONFLICT(k) DO UPDATE SET n=n+1', k);
  return get('SELECT n FROM counters WHERE k=?', k).n;
}

const DEFAULTS = {
  business: { name: '', legal: '', gstin: '', phone: '', email: '', address: '', state: '', pan: '', logo: '' },
  invoice: { prefix: 'INV-', terms: 'Goods once sold will be exchanged only with bill within 7 days.', roundOff: true, pricesIncludeGst: false, footer: 'Thank you for your business!' },
  upi: { vpa: '', payee: '' },
  labels: { size: '50x25', fields: ['name', 'price', 'barcode'], code: 'ean13' },
  ai: { ollamaUrl: 'http://127.0.0.1:11434', model: '' },
  razorpay: { keyId: '', keySecret: '', webhookSecret: '' },
  setu: { clientId: '', clientSecret: '', productInstanceId: '', env: 'sandbox' },
};
function setting(k) {
  const r = get('SELECT v FROM settings WHERE k=?', k);
  return { ...DEFAULTS[k], ...(r ? JSON.parse(r.v) : {}) };
}
function setSetting(k, v) {
  run('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, JSON.stringify({ ...setting(k), ...v }));
}

module.exports = { db, all, get, run, tx, insert, update, next, setting, setSetting, DEFAULTS, DATA };
