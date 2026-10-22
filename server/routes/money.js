// Accounts (cash / bank / UPI), payments, transfers, expenses, recurring expenses, customers & suppliers.
const { all, get, run, tx, insert, update } = require('../db');
const { r2, iso, today, addDays, fail, docBal, expBal, accBalance, accountFor, audit, partyName } = require('../core');
const { decorate } = require('./docs');

const VPA = /^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function accounts() {
  return all('SELECT * FROM accounts ORDER BY archived, is_default DESC, id').map(a => ({ ...a, balance: accBalance(a.id), unmatched: get(`SELECT COUNT(*) n FROM bank_txns WHERE account_id=? AND status='unmatched'`, a.id).n, lastStmt: get('SELECT date, balance FROM bank_txns WHERE account_id=? ORDER BY date DESC, id DESC LIMIT 1', a.id) || null }));
}

function partyBalance(p) {
  const kinds = p.kind === 'c' ? ['sale'] : ['purchase'];
  return r2(all(`SELECT * FROM docs WHERE x=0 AND kind=? AND party_id=?`, kinds[0], p.id).reduce((s, d) => s + docBal(d), 0));
}

// Chronological ledger with running balance (what the party owes you, or you owe them).
function ledger(id, from = '0000', to = '9999') {
  const p = get('SELECT * FROM parties WHERE id=?', id);
  if (!p) fail('Not found.');
  const c = p.kind === 'c', rows = [];
  for (const d of all(`SELECT * FROM docs WHERE x=0 AND party_id=? AND kind IN ('sale','purchase','return')`, id)) {
    if (d.kind === 'return') rows.push({ date: d.date, ref: d.no, id: d.id, what: 'Credit note (goods returned)', dr: 0, cr: d.total });
    else rows.push({ date: d.date, ref: d.no, id: d.id, what: c ? 'Invoice' : 'Purchase bill', dr: d.total, cr: 0 });
  }
  for (const y of all(`SELECT p.*, d.no, d.kind FROM payments p JOIN docs d ON d.id=p.ref_id AND p.ref_type='doc' WHERE p.x=0 AND d.party_id=?`, id)) {
    const refund = y.kind === 'return';
    rows.push({ date: y.date, ref: y.no, what: refund ? 'Refund paid' : (c ? 'Payment received' : 'Payment made') + ` (${y.method}${y.utr ? ' ' + y.utr : ''})`, dr: refund ? y.amt : 0, cr: refund ? 0 : y.amt });
  }
  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let bal = 0, opening = 0;
  const out = [];
  for (const r of rows) {
    bal = r2(bal + r.dr - r.cr);
    if (r.date < from) { opening = bal; continue; }
    if (r.date > to) continue;
    out.push({ ...r, bal });
  }
  return { party: p, opening, rows: out, closing: bal };
}

module.exports = (app) => {
  // ---- accounts ----
  app.get('/api/accounts', (req, res) => res.json(accounts()));
  app.post('/api/accounts', (req, res) => {
    const b = req.body, o = { name: String(b.name || '').trim(), type: ['cash', 'bank', 'upi', 'card'].includes(b.type) ? b.type : 'bank', bank: b.bank || '', branch: b.branch || '', ifsc: (b.ifsc || '').toUpperCase().trim(), acno: (b.acno || '').replace(/\s/g, ''), upi: (b.upi || '').trim(), opening: +b.opening || 0 };
    if (!o.name) fail('Give the account a name.');
    if (o.ifsc && !IFSC.test(o.ifsc)) fail('IFSC should look like SBIN0001234 (11 characters).');
    if (o.acno && !/^\d{6,18}$/.test(o.acno)) fail('Account number should be 6 to 18 digits.');
    if (o.upi && !VPA.test(o.upi)) fail('UPI ID should look like yourname@okhdfcbank.');
    if (b.id) update('accounts', +b.id, o);
    else b.id = insert('accounts', { ...o, created: new Date().toISOString() });
    if (b.is_default) { run('UPDATE accounts SET is_default=0 WHERE type=?', o.type); run('UPDATE accounts SET is_default=1 WHERE id=?', +b.id); }
    audit(req.user.name, 'Saved account ' + o.name);
    res.json({ id: +b.id });
  });
  app.post('/api/accounts/:id/archive', (req, res) => { run('UPDATE accounts SET archived=? WHERE id=?', req.body.archived === 0 ? 0 : 1, +req.params.id); res.json({ ok: 1 }); });
  app.get('/api/accounts/:id/entries', (req, res) => {
    const id = +req.params.id;
    const p = all(`SELECT p.id, p.date, p.dir, p.amt, p.method, p.utr, p.ref_type, p.ref_id, p.x, CASE WHEN p.ref_type='doc' THEN (SELECT no FROM docs WHERE id=p.ref_id) ELSE (SELECT descr FROM expenses WHERE id=p.ref_id) END ref, (SELECT name FROM parties WHERE id=p.party_id) party FROM payments p WHERE account_id=? ORDER BY date DESC, id DESC LIMIT 300`, id);
    const t = all(`SELECT t.*, (SELECT name FROM accounts WHERE id=t.from_acc) fromName, (SELECT name FROM accounts WHERE id=t.to_acc) toName FROM transfers t WHERE (from_acc=? OR to_acc=?) ORDER BY date DESC LIMIT 100`, id, id);
    res.json({ payments: p, transfers: t });
  });

  // ---- payments ----
  app.post('/api/payments', (req, res) => {
    const b = req.body, amt = r2(+b.amt);
    if (!(amt > 0)) fail('Enter an amount above zero.');
    let dir, party_id = null;
    if (b.ref_type === 'doc') {
      const d = get('SELECT * FROM docs WHERE id=?', +b.ref_id);
      if (!d || d.x || !['sale', 'purchase'].includes(d.kind)) fail('This document cannot take payments.');
      if (amt > docBal(d) + 0.005) fail(`That is more than the ₹${docBal(d)} still due.`);
      dir = d.kind === 'sale' ? 'in' : 'out'; party_id = d.party_id;
    } else if (b.ref_type === 'expense') {
      const e = get('SELECT * FROM expenses WHERE id=?', +b.ref_id);
      if (!e || e.x) fail('Expense not found.');
      if (amt > expBal(e) + 0.005) fail(`That is more than the ₹${expBal(e)} still due.`);
      dir = 'out';
    } else fail('Choose what this payment is for.');
    const id = insert('payments', { dir, amt, date: b.date || today(), account_id: accountFor(b.method, b.account_id), ref_type: b.ref_type, ref_id: +b.ref_id, party_id, method: b.method || 'cash', utr: b.utr || '', note: b.note || '', created_at: new Date().toISOString() });
    if (b.bank_txn) run(`UPDATE bank_txns SET status='matched', payment_id=? WHERE id=?`, id, +b.bank_txn);
    audit(req.user.name, `Payment ₹${amt} ${dir}`);
    res.json({ id });
  });
  app.post('/api/payments/:id/cancel', (req, res) => {
    run('UPDATE payments SET x=1 WHERE id=?', +req.params.id);
    run(`UPDATE bank_txns SET status='unmatched', payment_id=NULL WHERE payment_id=?`, +req.params.id);
    audit(req.user.name, 'Cancelled payment #' + req.params.id);
    res.json({ ok: 1 });
  });
  // Open items to pay against (used by payment forms and bank matching).
  app.get('/api/open-items', (req, res) => {
    const recv = all(`SELECT * FROM docs WHERE kind='sale' AND x=0`).map(decorate).filter(d => d.bal > 0.005);
    const pay = [...all(`SELECT * FROM docs WHERE kind='purchase' AND x=0`).map(decorate).filter(d => d.bal > 0.005).map(d => ({ ...d, ref_type: 'doc' })),
      ...all('SELECT * FROM expenses WHERE x=0').map(e => ({ id: e.id, ref_type: 'expense', no: e.descr, party: e.payee || e.cat, date: e.date, due: e.due, total: e.total, bal: expBal(e) })).filter(e => e.bal > 0.005)];
    res.json({ recv: recv.map(d => ({ ...d, ref_type: 'doc' })), pay });
  });

  // ---- transfers ----
  app.post('/api/transfers', (req, res) => {
    const b = req.body, amt = r2(+b.amt);
    if (!(amt > 0)) fail('Enter an amount above zero.');
    if (!b.from_acc || !b.to_acc || +b.from_acc === +b.to_acc) fail('Choose two different accounts.');
    insert('transfers', { from_acc: +b.from_acc, to_acc: +b.to_acc, amt, date: b.date || today(), note: b.note || '' });
    audit(req.user.name, `Transfer ₹${amt}`);
    res.json({ ok: 1 });
  });
  app.post('/api/transfers/:id/cancel', (req, res) => { run('UPDATE transfers SET x=1 WHERE id=?', +req.params.id); res.json({ ok: 1 }); });

  // ---- expenses ----
  app.get('/api/expenses', (req, res) => res.json(all('SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 2000').map(e => ({ ...e, bal: e.x ? 0 : expBal(e) }))));
  app.post('/api/expenses', (req, res) => res.json({ id: addExpense(req.body, req.user.name) }));
  app.post('/api/expenses/:id/cancel', (req, res) => {
    run('UPDATE expenses SET x=1 WHERE id=?', +req.params.id);
    run(`UPDATE payments SET x=1 WHERE ref_type='expense' AND ref_id=?`, +req.params.id);
    audit(req.user.name, 'Cancelled expense #' + req.params.id);
    res.json({ ok: 1 });
  });

  // ---- recurring expenses ----
  app.get('/api/recurring', (req, res) => res.json(all('SELECT * FROM recurring ORDER BY active DESC, next_date')));
  app.post('/api/recurring', (req, res) => {
    const b = req.body, o = { descr: String(b.descr || '').trim(), cat: b.cat || 'Other', amount: +b.amount, payee: b.payee || '', freq: ['weekly', 'monthly', 'quarterly', 'yearly'].includes(b.freq) ? b.freq : 'monthly', next_date: b.next_date || today(), active: b.active === 0 ? 0 : 1 };
    if (!o.descr || !(o.amount > 0)) fail('Enter what it is for and an amount.');
    b.id ? update('recurring', +b.id, o) : insert('recurring', o);
    runRecurring();
    res.json({ ok: 1 });
  });
  app.post('/api/recurring/:id/delete', (req, res) => { run('UPDATE recurring SET active=0 WHERE id=?', +req.params.id); res.json({ ok: 1 }); });

  // ---- parties ----
  app.get('/api/parties', (req, res) => {
    const L = all('SELECT * FROM parties WHERE kind=? ORDER BY name COLLATE NOCASE', req.query.kind === 's' ? 's' : 'c');
    res.json(L.map(p => ({ ...p, balance: partyBalance(p), last: get(`SELECT MAX(date) d FROM docs WHERE party_id=? AND x=0`, p.id).d })));
  });
  app.post('/api/parties', (req, res) => {
    const b = req.body, o = { kind: b.kind === 's' ? 's' : 'c', name: String(b.name || '').trim(), phone: b.phone || '', email: b.email || '', gstin: (b.gstin || '').toUpperCase().trim(), address: b.address || '', state: b.state || '', credit_limit: +b.credit_limit || 0, notes: b.notes || '' };
    if (!o.name) fail('Enter a name.');
    if (o.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(o.gstin)) fail('That GSTIN does not look right. It has 15 characters, like 27ABCDE1234F1Z5.');
    if (b.id) update('parties', +b.id, o); else b.id = insert('parties', { ...o, created: today() });
    res.json({ id: +b.id });
  });
  app.get('/api/parties/:id/ledger', (req, res) => res.json(ledger(+req.params.id, req.query.from, req.query.to)));
};

function addExpense(b, user, recurringId) {
  const amt = r2(+b.total), paid = r2(+b.paid || 0), descr = String(b.descr || '').trim();
  if (!descr) fail('Say what the expense is for.');
  if (!(amt > 0)) fail('Enter an amount above zero.');
  if (paid < 0 || paid > amt) fail('Paid amount must be between 0 and the total.');
  return tx(() => {
    const id = insert('expenses', { descr, cat: b.cat || 'Other', date: b.date || today(), total: amt, payee: b.payee || '', due: b.due || null, recurring_id: recurringId || null, created_at: new Date().toISOString() });
    if (paid > 0) {
      const pid = insert('payments', { dir: 'out', amt: paid, date: b.date || today(), account_id: accountFor(b.method, b.account_id), ref_type: 'expense', ref_id: id, method: b.method || 'cash', utr: b.utr || '', created_at: new Date().toISOString() });
      if (b.bank_txn) run(`UPDATE bank_txns SET status='matched', payment_id=? WHERE id=?`, pid, +b.bank_txn);
    }
    audit(user, `Expense ${descr} ₹${amt}`);
    return id;
  });
}

// Posts any recurring expenses that have come due (as unpaid bills, due on that date).
function runRecurring() {
  const addMonths = (d, n) => { const [y, m, day] = d.split('-').map(Number), last = new Date(y, m - 1 + n + 1, 0).getDate(); return iso(new Date(y, m - 1 + n, Math.min(day, last))); };
  const step = { weekly: d => addDays(d, 7), monthly: d => addMonths(d, 1), quarterly: d => addMonths(d, 3), yearly: d => addMonths(d, 12) };
  for (const r of all('SELECT * FROM recurring WHERE active=1 AND next_date<=?', today())) {
    let d = r.next_date, n = 0;
    while (d <= today() && n++ < 60) {
      addExpense({ descr: r.descr, cat: r.cat, date: d, total: r.amount, payee: r.payee, due: d }, 'Auto (recurring)', r.id);
      d = step[r.freq](d);
    }
    run('UPDATE recurring SET next_date=? WHERE id=?', d, r.id);
  }
}

module.exports.runRecurring = runRecurring;
module.exports.addExpense = addExpense;
module.exports.accounts = accounts;
module.exports.partyBalance = partyBalance;
