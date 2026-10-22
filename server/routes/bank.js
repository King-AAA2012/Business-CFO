// Bank linking: statement import, auto-reconciliation, Account Aggregator live feed (Setu),
// IFSC lookup, and Razorpay payment links for invoices.
const crypto = require('crypto');
const { all, get, run, tx, insert, setting, setSetting } = require('../db');
const { r2, today, addDays, fail, docBal, expBal, accBalance, audit } = require('../core');
const { decorate } = require('./docs');
const { addExpense } = require('./money');

// ---------- CSV statement parsing ----------
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  const sep = (text.split('\n').slice(0, 30).join('').match(/\t/g) || []).length > (text.split('\n').slice(0, 30).join('').match(/,/g) || []).length ? '\t' : ',';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.some(c => c));
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function parseDate(s) {
  s = String(s || '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})/.exec(s))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  if ((m = /^(\d{1,2})[\/\-. ]([A-Za-z]{3})[A-Za-z]*[\/\-. ,]+(\d{2,4})/.exec(s)) && MON[m[2].toLowerCase()]) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
const money = s => { s = String(s || '').replace(/[₹,\s]|INR|Rs\.?/gi, ''); const neg = /dr$/i.test(s) || /^-/.test(s) || /^\(.*\)$/.test(s); const v = parseFloat(s.replace(/[^\d.]/g, '')); return isNaN(v) ? null : (neg ? -v : v); };

function detect(rows) {
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const H = rows[h].map(c => c.toLowerCase());
    const find = (re, not) => H.findIndex(c => re.test(c) && !(not && not.test(c)));
    const date = (() => { const t = find(/(txn|tran|transaction|posting).*date|^date$/); return t >= 0 ? t : find(/date/); })();
    const debit = find(/debit|withdraw|dr\b|paid out/, /credit/), credit = find(/credit|deposit|cr\b|paid in/, /debit/);
    const amount = find(/amount|amt/, /balance/), type = find(/dr\s*\/\s*cr|cr\s*\/\s*dr|^type$|txn type/);
    if (date < 0 || (debit < 0 && credit < 0 && amount < 0)) continue;
    return { header: h, date, narration: find(/narration|description|particular|remark|details/), ref: find(/ref|chq|cheque|utr/, /date/), debit, credit, amount, type, balance: find(/balance/) };
  }
  return null;
}

function importRows(accountId, list, source) {
  let added = 0, dup = 0;
  tx(() => list.forEach(t => {
    const hash = crypto.createHash('sha1').update([accountId, t.date, t.amount, t.narration, t.balance ?? '', t.ref || ''].join('|')).digest('hex');
    if (get('SELECT 1 FROM bank_txns WHERE hash=?', hash)) { dup++; return; }
    insert('bank_txns', { account_id: accountId, date: t.date, narration: t.narration || '', amount: r2(t.amount), balance: t.balance ?? null, ref: t.ref || '', hash, source, created_at: new Date().toISOString() });
    added++;
  }));
  const auto = autoMatch(accountId);
  return { added, duplicates: dup, ...auto };
}

// ---------- matching ----------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function openItems() {
  return {
    recv: all(`SELECT * FROM docs WHERE kind='sale' AND x=0`).map(decorate).filter(d => d.bal > 0.005).map(d => ({ ref_type: 'doc', id: d.id, no: d.no, party: d.party, bal: d.bal, date: d.date })),
    pay: [...all(`SELECT * FROM docs WHERE kind='purchase' AND x=0`).map(decorate).filter(d => d.bal > 0.005).map(d => ({ ref_type: 'doc', id: d.id, no: d.no, party: d.party, bal: d.bal, date: d.date })),
      ...all('SELECT * FROM expenses WHERE x=0').map(e => ({ ref_type: 'expense', id: e.id, no: e.descr, party: e.payee || e.cat, bal: expBal(e), date: e.date })).filter(e => e.bal > 0.005)],
  };
}
function suggest(t, items) {
  const L = t.amount > 0 ? items.recv : items.pay, amt = Math.abs(t.amount), n = norm(t.narration + ' ' + t.ref);
  return L.map(d => {
    let s = 0;
    if (d.no && n.includes(norm(d.no))) s += 5;
    const tok = norm(String(d.party).split(/\s+/)[0]);
    if (tok.length >= 3 && n.includes(tok)) s += 2;
    if (Math.abs(d.bal - amt) < 0.01) s += 3; else if (Math.abs(d.bal - amt) <= 1) s += 2; else if (amt < d.bal) s += 0.5; else s -= 3;
    return { ...d, score: s };
  }).filter(d => d.score >= 2).sort((a, b) => b.score - a.score).slice(0, 3);
}
// Links statement lines to payments already recorded, and auto-records payments
// when the narration carries an invoice/bill number (UPI QR payments carry it as the reference).
function autoMatch(accountId) {
  let linked = 0, recorded = 0;
  tx(() => {
    for (const t of all(`SELECT * FROM bank_txns WHERE account_id=? AND status='unmatched'`, accountId)) {
      const dir = t.amount > 0 ? 'in' : 'out';
      const p = get(`SELECT * FROM payments p WHERE x=0 AND account_id=? AND dir=? AND ABS(amt-?)<0.01 AND date BETWEEN ? AND ? AND NOT EXISTS(SELECT 1 FROM bank_txns b WHERE b.payment_id=p.id) ORDER BY ABS(julianday(date)-julianday(?)) LIMIT 1`, accountId, dir, Math.abs(t.amount), addDays(t.date, -4), addDays(t.date, 4), t.date);
      if (p) { run(`UPDATE bank_txns SET status='matched', payment_id=? WHERE id=?`, p.id, t.id); linked++; continue; }
      const items = openItems(), best = suggest(t, items)[0];
      if (best && best.score >= 5 && Math.abs(t.amount) <= best.bal + 0.01) {
        const pid = insert('payments', { dir, amt: r2(Math.abs(t.amount)), date: t.date, account_id: accountId, ref_type: best.ref_type, ref_id: best.id, party_id: best.ref_type === 'doc' ? get('SELECT party_id FROM docs WHERE id=?', best.id).party_id : null, method: /upi/i.test(t.narration) ? 'upi' : 'bank', utr: t.ref || '', note: 'Auto-matched from bank statement', created_at: new Date().toISOString() });
        run(`UPDATE bank_txns SET status='matched', payment_id=? WHERE id=?`, pid, t.id);
        recorded++;
      }
    }
  });
  return { linked, recorded };
}

// ---------- Account Aggregator (Setu FIU) ----------
async function setu(path, opts = {}) {
  const s = setting('setu');
  if (!s.clientId || !s.clientSecret || !s.productInstanceId) fail('Add your Setu Account Aggregator keys in Settings → Integrations first.');
  const base = s.env === 'production' ? 'https://fiu.setu.co' : 'https://fiu-sandbox.setu.co';
  const r = await fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', 'x-client-id': s.clientId, 'x-client-secret': s.clientSecret, 'x-product-instance-id': s.productInstanceId } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail('Setu: ' + (j.errorMsg || j.message || j.error?.message || r.status));
  return j;
}
const isoT = d => new Date(d + 'T00:00:00Z').toISOString();

// ---------- Razorpay ----------
async function rzp(path, opts = {}) {
  const s = setting('razorpay');
  if (!s.keyId || !s.keySecret) fail('Add your Razorpay keys in Settings → Integrations first.');
  const r = await fetch('https://api.razorpay.com/v1' + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(s.keyId + ':' + s.keySecret).toString('base64') } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail('Razorpay: ' + (j.error?.description || r.status));
  return j;
}
function recordGatewayPayment(docId, amount, payId) {
  if (get('SELECT 1 FROM payments WHERE utr=? AND x=0', payId)) return false;
  const d = get('SELECT * FROM docs WHERE id=?', docId);
  if (!d || d.x) return false;
  const acc = get(`SELECT id FROM accounts WHERE archived=0 AND type IN ('bank','upi') ORDER BY type='bank' DESC, is_default DESC LIMIT 1`) || get('SELECT id FROM accounts LIMIT 1');
  insert('payments', { dir: 'in', amt: r2(Math.min(amount, docBal(d))), date: today(), account_id: acc.id, ref_type: 'doc', ref_id: d.id, party_id: d.party_id, method: 'upi', utr: payId, note: 'Razorpay payment link', created_at: new Date().toISOString() });
  audit('Razorpay', `Payment ₹${amount} received on ${d.no}`);
  return true;
}

module.exports = (app) => {
  app.get('/api/bank/ifsc/:code', async (req, res) => {
    const c = String(req.params.code).toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(c)) fail('IFSC should be 11 characters, like SBIN0001234.');
    const r = await fetch('https://ifsc.razorpay.com/' + c).catch(() => null);
    if (!r || !r.ok) fail('Could not find that IFSC. Check it, or type the bank name yourself.');
    const j = await r.json();
    res.json({ bank: j.BANK, branch: j.BRANCH, city: j.CITY, state: j.STATE, address: j.ADDRESS, upi: j.UPI });
  });

  app.post('/api/bank/:acc/import', (req, res) => {
    const acc = +req.params.acc, rows = parseCSV(String(req.body.text || '')), m = req.body.mapping || detect(rows);
    if (!m) fail('Could not find the date and amount columns. Make sure the file is a CSV exported from net banking.');
    const list = [];
    for (const r of rows.slice(m.header + 1)) {
      const date = parseDate(r[m.date]);
      if (!date) continue;
      let amt;
      if (m.debit >= 0 || m.credit >= 0) { const cr = Math.abs(money(r[m.credit]) || 0), dr = Math.abs(money(r[m.debit]) || 0); amt = cr - dr; }
      else { amt = money(r[m.amount]); if (m.type >= 0 && /^d/i.test(r[m.type] || '')) amt = -Math.abs(amt); else if (m.type >= 0) amt = Math.abs(amt); }
      if (!amt) continue;
      list.push({ date, amount: amt, narration: r[m.narration] || '', ref: m.ref >= 0 ? r[m.ref] : '', balance: m.balance >= 0 ? money(r[m.balance]) : null });
    }
    if (!list.length) fail('No transactions found in this file.');
    const out = importRows(acc, list, 'csv');
    audit(req.user.name, `Imported bank statement: ${out.added} lines`);
    res.json({ ...out, total: list.length, mapping: m });
  });

  app.get('/api/bank/:acc/txns', (req, res) => {
    const acc = +req.params.acc, st = req.query.status || 'unmatched';
    const L = all(`SELECT b.*, p.ref_type, p.ref_id, CASE WHEN p.ref_type='doc' THEN (SELECT no FROM docs WHERE id=p.ref_id) ELSE (SELECT descr FROM expenses WHERE id=p.ref_id) END matched_to FROM bank_txns b LEFT JOIN payments p ON p.id=b.payment_id WHERE b.account_id=? ${st === 'all' ? '' : 'AND b.status=?'} ORDER BY b.date DESC, b.id DESC LIMIT 500`, ...(st === 'all' ? [acc] : [acc, st]));
    const items = openItems();
    const stmt = get('SELECT balance, date FROM bank_txns WHERE account_id=? AND balance IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1', acc);
    res.json({
      txns: L.map(t => t.status === 'unmatched' ? { ...t, suggestions: suggest(t, items) } : t),
      summary: { app: accBalance(acc), statement: stmt?.balance ?? null, stmtDate: stmt?.date ?? null, counts: Object.fromEntries(all('SELECT status, COUNT(*) n FROM bank_txns WHERE account_id=? GROUP BY status', acc).map(r => [r.status, r.n])) },
    });
  });
  app.post('/api/bank/:acc/automatch', (req, res) => res.json(autoMatch(+req.params.acc)));

  app.post('/api/bank/txns/:id/match', (req, res) => {
    const t = get('SELECT * FROM bank_txns WHERE id=?', +req.params.id);
    if (!t || t.status !== 'unmatched') fail('This line is already handled.');
    const { ref_type, ref_id } = req.body, dir = t.amount > 0 ? 'in' : 'out';
    let bal, party_id = null;
    if (ref_type === 'doc') { const d = get('SELECT * FROM docs WHERE id=?', +ref_id); bal = docBal(d); party_id = d.party_id; if ((d.kind === 'sale') !== (dir === 'in')) fail('Money in can only settle sales, and money out only bills or expenses.'); }
    else { const e = get('SELECT * FROM expenses WHERE id=?', +ref_id); bal = expBal(e); if (dir === 'in') fail('Money in cannot pay an expense.'); }
    const amt = r2(Math.min(Math.abs(t.amount), bal));
    if (amt <= 0) fail('Nothing is due on that item.');
    const pid = insert('payments', { dir, amt, date: t.date, account_id: t.account_id, ref_type, ref_id: +ref_id, party_id, method: /upi/i.test(t.narration) ? 'upi' : 'bank', utr: t.ref || '', note: 'From bank statement', created_at: new Date().toISOString() });
    run(`UPDATE bank_txns SET status='matched', payment_id=? WHERE id=?`, pid, t.id);
    audit(req.user.name, `Reconciled bank line ₹${t.amount}`);
    res.json({ ok: 1, partial: amt < Math.abs(t.amount) });
  });
  app.post('/api/bank/txns/:id/expense', (req, res) => {
    const t = get('SELECT * FROM bank_txns WHERE id=?', +req.params.id);
    if (!t || t.status !== 'unmatched' || t.amount >= 0) fail('Only unmatched money-out lines can become expenses.');
    addExpense({ descr: req.body.descr || t.narration.slice(0, 60), cat: req.body.cat || 'Other', date: t.date, total: -t.amount, paid: -t.amount, method: 'bank', account_id: t.account_id, utr: t.ref, bank_txn: t.id }, req.user.name);
    res.json({ ok: 1 });
  });
  app.post('/api/bank/txns/:id/status', (req, res) => {
    const s = req.body.status === 'ignored' ? 'ignored' : 'unmatched';
    const t = get('SELECT * FROM bank_txns WHERE id=?', +req.params.id);
    if (s === 'unmatched' && t.payment_id && t.status === 'matched') run('UPDATE bank_txns SET payment_id=NULL WHERE id=?', t.id);
    run('UPDATE bank_txns SET status=? WHERE id=?', s, t.id);
    res.json({ ok: 1 });
  });

  // Account Aggregator: consent → (customer approves in AA app) → fetch statements.
  app.post('/api/bank/:acc/aa/consent', async (req, res) => {
    const acc = +req.params.acc, mobile = String(req.body.mobile || '').replace(/\D/g, '').slice(-10);
    if (mobile.length !== 10) fail('Enter the 10-digit mobile number linked to the bank account.');
    const base = `${req.protocol}://${req.get('host')}`;
    const j = await setu('/v2/consents', { method: 'POST', body: JSON.stringify({ consentDuration: { unit: 'MONTH', value: '12' }, vua: mobile, dataRange: { from: isoT(addDays(today(), -365)), to: new Date().toISOString() }, context: [], redirectUrl: `${base}/#/money/accounts` }) });
    run('UPDATE accounts SET aa_consent=?, aa_status=? WHERE id=?', j.id, j.status || 'PENDING', acc);
    res.json({ url: j.url, status: j.status });
  });
  app.post('/api/bank/:acc/aa/sync', async (req, res) => {
    const acc = get('SELECT * FROM accounts WHERE id=?', +req.params.acc);
    if (!acc.aa_consent) fail('Link this account through Account Aggregator first.');
    const c = await setu('/v2/consents/' + acc.aa_consent);
    run('UPDATE accounts SET aa_status=? WHERE id=?', c.status, acc.id);
    if (c.status !== 'ACTIVE') return res.json({ status: c.status, message: c.status === 'PENDING' ? 'Waiting for you to approve the consent in your Account Aggregator app.' : 'Consent is ' + c.status + '. Link again.' });
    const last = get('SELECT MAX(date) d FROM bank_txns WHERE account_id=?', acc.id).d || addDays(today(), -180);
    const s = await setu('/v2/sessions', { method: 'POST', body: JSON.stringify({ consentId: acc.aa_consent, dataRange: { from: isoT(addDays(last, -3)), to: new Date().toISOString() }, format: 'json' }) });
    let data;
    for (let i = 0; i < 15; i++) {
      data = await setu('/v2/sessions/' + s.id);
      if (['COMPLETED', 'PARTIAL', 'FAILED', 'EXPIRED'].includes(data.status)) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!['COMPLETED', 'PARTIAL'].includes(data.status)) fail('The bank did not send data yet (' + data.status + '). Try again in a minute.');
    const list = [];
    for (const fip of data.fips || []) for (const a of fip.accounts || []) {
      const T = a.data?.account?.transactions?.transaction || [];
      for (const t of T) list.push({ date: (t.valueDate || t.transactionTimestamp || '').slice(0, 10), amount: (t.type === 'DEBIT' ? -1 : 1) * Math.abs(+t.amount), narration: t.narration || '', ref: t.reference || t.txnId || '', balance: t.currentBalance != null ? +t.currentBalance : null });
    }
    const out = importRows(acc.id, list.filter(t => t.date), 'aa');
    audit(req.user.name, `Bank feed synced: ${out.added} new lines`);
    res.json({ status: 'ACTIVE', ...out });
  });

  // Razorpay payment link for an invoice (customer can pay by UPI, card or netbanking).
  app.post('/api/docs/:id/paylink', async (req, res) => {
    const d = get('SELECT * FROM docs WHERE id=?', +req.params.id), bal = docBal(d);
    if (d.kind !== 'sale' || bal <= 0) fail('Nothing is due on this invoice.');
    const p = d.party_id ? get('SELECT * FROM parties WHERE id=?', d.party_id) : {};
    const biz = setting('business');
    const j = await rzp('/payment_links', { method: 'POST', body: JSON.stringify({ amount: Math.round(bal * 100), currency: 'INR', description: `${d.no} from ${biz.name || 'us'}`, reference_id: `${d.no}-${Date.now().toString(36)}`, customer: { name: p.name || 'Customer', contact: p.phone || undefined, email: p.email || undefined }, notify: { sms: false, email: false }, reminder_enable: false, notes: { doc_id: String(d.id) } }) });
    run('UPDATE docs SET paylink=? WHERE id=?', JSON.stringify({ id: j.id, url: j.short_url }), d.id);
    res.json({ url: j.short_url });
  });
  app.post('/api/docs/:id/paylink/check', async (req, res) => {
    const d = get('SELECT * FROM docs WHERE id=?', +req.params.id), pl = JSON.parse(d.paylink || 'null');
    if (!pl) fail('No payment link on this invoice.');
    const j = await rzp('/payment_links/' + pl.id);
    let got = false;
    for (const p of j.payments || []) if (p.status === 'captured') got = recordGatewayPayment(d.id, p.amount / 100, p.payment_id) || got;
    res.json({ status: j.status, recorded: got });
  });
};

// Raw-body webhook (registered before the JSON parser).
module.exports.webhook = (req, res) => {
  const s = setting('razorpay');
  const sig = crypto.createHmac('sha256', s.webhookSecret || '').update(req.body).digest('hex');
  const given = String(req.headers['x-razorpay-signature'] || '');
  if (!s.webhookSecret || given.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(given))) return res.status(400).send('bad signature');
  const ev = JSON.parse(req.body.toString());
  if (ev.event === 'payment_link.paid') {
    const pl = ev.payload.payment_link.entity, pay = ev.payload.payment.entity;
    recordGatewayPayment(+pl.notes?.doc_id, pay.amount / 100, pay.id);
  }
  res.json({ ok: 1 });
};
module.exports.parseCSV = parseCSV;
module.exports.parseDate = parseDate;
