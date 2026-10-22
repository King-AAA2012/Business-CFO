// Business rules shared by all routes: money maths, GST, stock movement, balances.
const { all, get, run, insert, update, next, setting } = require('./db');

const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const r4 = n => Math.round(n * 1e4) / 1e4;
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return iso(d); };

class UserError extends Error { constructor(m, code = 400) { super(m); this.code = code; } }
const fail = m => { throw new UserError(m); };

const KINDS = {
  sale: { prefix: 'INV-', label: 'Invoice', party: 'c', stock: -1 },
  purchase: { prefix: 'BILL-', label: 'Purchase bill', party: 's', stock: 1 },
  quote: { prefix: 'QT-', label: 'Quotation', party: 'c', stock: 0 },
  po: { prefix: 'PO-', label: 'Purchase order', party: 's', stock: 0 },
  return: { prefix: 'CN-', label: 'Credit note', party: 'c', stock: 1 },
};
function docNo(kind) {
  const p = kind === 'sale' ? setting('invoice').prefix || 'INV-' : KINDS[kind].prefix;
  return p + String(next('doc_' + kind)).padStart(4, '0');
}

// Doc-level discount is split across lines by value, then GST is worked out per line.
function computeDoc(lines, { disc = 0, incl = false, roundOff = true } = {}) {
  const sub = r2(lines.reduce((t, l) => t + l.qty * l.price, 0));
  disc = Math.min(Math.max(+disc || 0, 0), sub);
  let taxable = 0, gst = 0;
  const out = lines.map(l => {
    const gross = l.qty * l.price, net = gross - (sub ? disc * gross / sub : 0), rate = +l.gst_rate || 0;
    const lt = incl ? net / (1 + rate / 100) : net, tax = incl ? net - lt : lt * rate / 100;
    taxable += lt; gst += tax;
    return { ...l, taxable: r2(lt), tax: r2(tax) };
  });
  taxable = r2(taxable); gst = r2(gst);
  const raw = r2(taxable + gst), total = roundOff ? Math.round(raw) : raw;
  return { lines: out, sub, disc: r2(disc), taxable, gst, roundoff: r2(total - raw), total: r2(total) };
}

// A document only ever receives payments in one direction (sale: in; bill, expense, refund: out).
const paidOf = (type, id) => r2(get(`SELECT COALESCE(SUM(amt),0) s FROM payments WHERE x=0 AND ref_type=? AND ref_id=?`, type, id).s);
const creditedOf = id => r2(get(`SELECT COALESCE(SUM(total),0) s FROM docs WHERE kind='return' AND x=0 AND ref_doc=?`, id).s);
function docBal(d) {
  if (d.kind === 'sale') return r2(d.total - paidOf('doc', d.id) - creditedOf(d.id));
  if (d.kind === 'purchase') return r2(d.total - paidOf('doc', d.id));
  return 0;
}
function docStatus(d) {
  if (d.x) return 'Cancelled';
  if (d.kind === 'quote') return d.converted ? 'Converted' : (d.due && d.due < today() ? 'Expired' : 'Open');
  if (d.kind === 'po') return d.converted ? 'Received' : 'Open';
  if (d.kind === 'return') return 'Issued';
  const b = docBal(d);
  if (b <= 0.005) return 'Paid';
  return b < d.total - 0.005 ? 'Part-paid' : (d.due && d.due < today() ? 'Overdue' : 'Unpaid');
}
const expBal = e => r2(e.total - paidOf('expense', e.id));

// ---- stock ----
function mv(pid, q, type, ref, docId, user, batchId = null, note = '', date = today()) {
  insert('moves', { pid, batch_id: batchId, date, at: Date.now(), q, type, ref, doc_id: docId, note, user });
}
// Takes stock out, oldest-expiry batches first. Returns the cost of the units removed.
function stockOut(pid, qty, type, ref, docId, user, batchCode, date) {
  const p = get('SELECT * FROM products WHERE id=?', pid);
  let left = qty;
  if (p.track_batch) {
    const bs = batchCode
      ? all('SELECT * FROM batches WHERE pid=? AND code=? AND qty>0', pid, batchCode)
      : all(`SELECT * FROM batches WHERE pid=? AND qty>0 ORDER BY CASE WHEN expiry IS NULL OR expiry='' THEN 1 ELSE 0 END, expiry, id`, pid);
    for (const b of bs) {
      if (left <= 0) break;
      const take = Math.min(b.qty, left);
      run('UPDATE batches SET qty=? WHERE id=?', r4(b.qty - take), b.id);
      mv(pid, -take, type, ref, docId, user, b.id, '', date);
      left = r4(left - take);
    }
  }
  if (left > 0) mv(pid, -left, type, ref, docId, user, null, '', date);
  run('UPDATE products SET qty=? WHERE id=?', r4(p.qty - qty), pid);
  return r2(qty * p.cost);
}
// Adds stock and re-averages cost (weighted average).
function stockIn(pid, qty, unitCost, type, ref, docId, user, batch = {}, date) {
  const p = get('SELECT * FROM products WHERE id=?', pid);
  const q0 = Math.max(p.qty, 0);
  const cost = unitCost == null ? p.cost : r4((q0 * p.cost + qty * unitCost) / (q0 + qty || 1));
  let batchId = null;
  if (batch.code || (p.track_batch && batch.expiry)) {
    const code = batch.code || 'B' + today().replace(/-/g, '');
    const b = get('SELECT * FROM batches WHERE pid=? AND code=?', pid, code);
    if (b) { run('UPDATE batches SET qty=?, expiry=COALESCE(?,expiry) WHERE id=?', r4(b.qty + qty), batch.expiry || null, b.id); batchId = b.id; }
    else batchId = insert('batches', { pid, code, expiry: batch.expiry || null, qty, cost: unitCost ?? p.cost, created: today() });
  }
  mv(pid, qty, type, ref, docId, user, batchId, '', date);
  update('products', pid, { qty: r4(p.qty + qty), cost });
}
// Undo every stock movement made by a document.
function reverseMoves(docId, label, user) {
  for (const m of all('SELECT * FROM moves WHERE doc_id=?', docId)) {
    if (m.type.includes('cancelled')) continue;
    const p = get('SELECT * FROM products WHERE id=?', m.pid);
    if (m.batch_id) run('UPDATE batches SET qty=qty-? WHERE id=?', m.q, m.batch_id);
    mv(m.pid, -m.q, label, m.ref, docId, user, m.batch_id);
    run('UPDATE products SET qty=? WHERE id=?', r4(p.qty - m.q), m.pid);
  }
}

// ---- money ----
function accBalance(id) {
  const a = get('SELECT * FROM accounts WHERE id=?', id);
  const s = (sql) => get(sql, id).s || 0;
  return r2(a.opening
    + s(`SELECT SUM(amt) s FROM payments WHERE x=0 AND dir='in' AND account_id=?`)
    - s(`SELECT SUM(amt) s FROM payments WHERE x=0 AND dir='out' AND account_id=?`)
    + s(`SELECT SUM(amt) s FROM transfers WHERE x=0 AND to_acc=?`)
    - s(`SELECT SUM(amt) s FROM transfers WHERE x=0 AND from_acc=?`));
}
function defaultAccount(type) {
  return get(`SELECT * FROM accounts WHERE archived=0 AND type=? ORDER BY is_default DESC, id LIMIT 1`, type)
    || get(`SELECT * FROM accounts WHERE archived=0 ORDER BY is_default DESC, id LIMIT 1`);
}
// Picks the account a payment method should land in.
function accountFor(method, accountId) {
  if (accountId) return +accountId;
  const t = method === 'cash' ? 'cash' : method === 'upi' ? 'upi' : 'bank';
  const exact = get(`SELECT * FROM accounts WHERE archived=0 AND type=? ORDER BY is_default DESC, id LIMIT 1`, t);
  const a = exact || (t !== 'cash' && get(`SELECT * FROM accounts WHERE archived=0 AND type IN ('bank','upi') ORDER BY is_default DESC, id LIMIT 1`)) || defaultAccount('cash');
  if (!a) fail('Add a cash or bank account first.');
  return a.id;
}

const audit = (user, action) => insert('audit', { at: new Date().toISOString(), user: user || 'system', action });

// Generates an in-store EAN-13 (prefix 2x is reserved for internal use, so it never clashes with retail codes).
function ean13(n) {
  const body = '2' + String(n).padStart(11, '0');
  const sum = [...body].reduce((t, d, i) => t + +d * (i % 2 ? 3 : 1), 0);
  return body + ((10 - sum % 10) % 10);
}
function newBarcode() {
  let code;
  do code = ean13(next('barcode')); while (get('SELECT 1 FROM products WHERE barcode=?', code));
  return code;
}

function partyName(id) { return id ? (get('SELECT name FROM parties WHERE id=?', id) || {}).name : null; }

module.exports = { r2, r4, iso, today, addDays, UserError, fail, KINDS, docNo, computeDoc, paidOf, creditedOf, docBal, docStatus, expBal, mv, stockOut, stockIn, reverseMoves, accBalance, accountFor, defaultAccount, audit, newBarcode, ean13, partyName };
