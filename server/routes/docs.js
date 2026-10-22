// Sales invoices, purchase bills, quotations, purchase orders and credit notes.
const { all, get, run, tx, insert, update, setting } = require('../db');
const C = require('../core');
const { r2, r4, today, fail, KINDS, computeDoc, docBal, docStatus, stockIn, stockOut, reverseMoves, accountFor, audit, partyName } = C;

function resolveParty(kind, b) {
  const pk = KINDS[kind].party;
  if (b.party_id) return +b.party_id;
  const n = String(b.party_name || '').trim();
  if (!n) return null;
  const ex = get('SELECT id FROM parties WHERE kind=? AND name=? COLLATE NOCASE', pk, n);
  return ex ? ex.id : insert('parties', { kind: pk, name: n, phone: b.party_phone || '', created: today() });
}

function decorate(d) {
  return { ...d, party: partyName(d.party_id) || (d.kind === 'sale' || d.kind === 'quote' ? 'Walk-in customer' : 'Supplier'), status: docStatus(d), bal: docBal(d) };
}

function upiLink(d) {
  const u = setting('upi'), b = setting('business');
  if (!u.vpa) return null;
  const amt = docBal(d);
  if (amt <= 0) return null;
  const q = new URLSearchParams({ pa: u.vpa, pn: u.payee || b.name || 'Merchant', am: amt.toFixed(2), cu: 'INR', tn: `${d.no} ${b.name || ''}`.trim().slice(0, 50), tr: d.no });
  return 'upi://pay?' + q.toString().replace(/\+/g, '%20');
}

function full(id) {
  const d = get('SELECT * FROM docs WHERE id=?', id);
  if (!d) fail('Document not found.');
  const party = d.party_id ? get('SELECT * FROM parties WHERE id=?', d.party_id) : null;
  return {
    ...decorate(d), partyInfo: party,
    lines: all('SELECT l.*, p.unit, p.barcode FROM doc_lines l LEFT JOIN products p ON p.id=l.pid WHERE doc_id=?', id),
    payments: all('SELECT p.*, a.name account FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE ref_type=? AND ref_id=? ORDER BY date', 'doc', id),
    credits: all(`SELECT id,no,date,total,x FROM docs WHERE kind='return' AND ref_doc=?`, id),
    refDoc: d.ref_doc ? get('SELECT id,no,kind FROM docs WHERE id=?', d.ref_doc) : null,
    convertedTo: d.converted ? get('SELECT id,no,kind FROM docs WHERE id=?', d.converted) : null,
    upi: upiLink(d),
    business: setting('business'), invoice: setting('invoice'),
  };
}

function create(b, user) {
  const kind = b.kind;
  if (!KINDS[kind]) fail('Unknown document type.');
  const date = b.date || today();
  const raw = (b.lines || []).filter(l => l.pid);
  if (!raw.length) fail('Add at least one product.');
  if (raw.some(l => !(+l.qty > 0) || +l.price < 0)) fail('Each line needs a quantity above zero and a valid price.');
  const party_id = kind === 'return' ? (get('SELECT party_id FROM docs WHERE id=?', +b.ref_doc) || {}).party_id : resolveParty(kind, b);
  if ((kind === 'purchase' || kind === 'po') && !party_id) fail('Enter the supplier name.');
  const party = party_id ? get('SELECT * FROM parties WHERE id=?', party_id) : null;
  const biz = setting('business'), inv = setting('invoice');
  const inter = b.inter != null ? +!!b.inter : +(!!(party?.state && biz.state && party.state.toLowerCase() !== biz.state.toLowerCase()));

  const prods = {};
  const lines = raw.map(l => {
    const p = prods[l.pid] = prods[l.pid] || get('SELECT * FROM products WHERE id=?', +l.pid);
    if (!p) fail('A product on this bill no longer exists.');
    return { pid: p.id, name: p.name, hsn: p.hsn || '', qty: +l.qty, price: +l.price, gst_rate: l.gst_rate === '' || l.gst_rate == null ? p.gst || 0 : +l.gst_rate, batch: l.batch || null, expiry: l.expiry || null };
  });
  const t = computeDoc(lines, { disc: b.disc, incl: b.incl ?? inv.pricesIncludeGst, roundOff: b.roundOff ?? inv.roundOff });
  if (t.total <= 0 && kind !== 'quote') fail('Total must be above zero.');

  let src = null;
  if (kind === 'return') {
    src = get(`SELECT * FROM docs WHERE id=? AND kind='sale' AND x=0`, +b.ref_doc);
    if (!src) fail('Choose the invoice the goods are coming back from.');
    for (const l of lines) {
      const sold = get('SELECT COALESCE(SUM(qty),0) q FROM doc_lines WHERE doc_id=? AND pid=?', src.id, l.pid).q;
      const back = get(`SELECT COALESCE(SUM(l.qty),0) q FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='return' AND d.x=0 AND d.ref_doc=? AND l.pid=?`, src.id, l.pid).q;
      if (l.qty > sold - back + 1e-9) fail(`Only ${r2(sold - back)} of ${l.name} can still be returned on ${src.no}.`);
    }
  }

  // Warnings the user can override (stock shortfall, credit limit).
  if (kind === 'sale' && !b.force) {
    const need = {};
    lines.forEach(l => need[l.pid] = (need[l.pid] || 0) + l.qty);
    const short = Object.keys(need).filter(i => prods[i].qty < need[i]).map(i => `${prods[i].name} (have ${prods[i].qty})`);
    const warn = [];
    if (short.length) warn.push('Not enough stock for: ' + short.join(', ') + '. Stock will go below zero.');
    if (party?.credit_limit > 0) {
      const owed = all(`SELECT * FROM docs WHERE kind='sale' AND x=0 AND party_id=?`, party.id).reduce((s, d) => s + docBal(d), 0);
      const after = r2(owed + t.total - (+b.paid || 0));
      if (after > party.credit_limit) warn.push(`${party.name} would owe ₹${after.toLocaleString('en-IN')}, above their credit limit of ₹${party.credit_limit.toLocaleString('en-IN')}.`);
    }
    if (warn.length) { const e = new C.UserError(warn.join('\n'), 409); e.confirm = true; throw e; }
  }

  return tx(() => {
    const no = C.docNo(kind);
    const id = insert('docs', { kind, no, date, due: b.due || null, party_id, inter, incl: b.incl ?? inv.pricesIncludeGst ? 1 : 0, disc: t.disc, sub: t.sub, taxable: t.taxable, gst: t.gst, roundoff: t.roundoff, total: t.total, notes: b.notes || '', ref_doc: src?.id || null, created_by: user, created_at: new Date().toISOString() });
    let cogs = 0;
    for (const l of t.lines) {
      let cost = 0;
      if (kind === 'sale') { cost = r4(prods[l.pid].cost); cogs += stockOut(l.pid, l.qty, 'Sale', no, id, user, l.batch, date); }
      if (kind === 'purchase') { cost = r4(l.taxable / l.qty); stockIn(l.pid, l.qty, cost, 'Purchase', no, id, user, { code: l.batch, expiry: l.expiry }, date); }
      if (kind === 'return') {
        const orig = get('SELECT cost FROM doc_lines WHERE doc_id=? AND pid=? LIMIT 1', src.id, l.pid);
        cost = orig?.cost ?? prods[l.pid].cost;
        stockIn(l.pid, l.qty, cost, 'Return', no, id, user, { code: l.batch }, date);
        cogs += r2(l.qty * cost);
      }
      insert('doc_lines', { doc_id: id, pid: l.pid, name: l.name, hsn: l.hsn, qty: l.qty, price: l.price, gst_rate: l.gst_rate, taxable: l.taxable, tax: l.tax, cost, batch: l.batch, expiry: l.expiry });
    }
    run('UPDATE docs SET cogs=? WHERE id=?', r2(cogs), id);

    const pay = (amt, dir, refId) => insert('payments', { dir, amt: r2(amt), date, account_id: accountFor(b.method, b.account_id), ref_type: 'doc', ref_id: refId, party_id, method: b.method || 'cash', utr: b.utr || '', note: '', created_at: new Date().toISOString() });
    const paid = +b.paid || 0;
    if (kind === 'sale' || kind === 'purchase') {
      if (paid < 0 || paid > t.total + 0.005) fail(`Amount paid must be between 0 and ₹${t.total}.`);
      if (paid > 0) pay(paid, kind === 'sale' ? 'in' : 'out', id);
    }
    if (kind === 'return') {
      // The credit first clears what is still due on the invoice; anything beyond that is refunded.
      const dueBefore = r2(src.total - C.paidOf('doc', src.id) - C.creditedOf(src.id) + t.total);
      const refund = r2(Math.max(0, t.total - Math.max(0, dueBefore)));
      if (refund > 0) pay(refund, 'out', id);
    }
    if (b.from_doc) run('UPDATE docs SET converted=? WHERE id=?', id, +b.from_doc);
    audit(user, `Created ${KINDS[kind].label} ${no} for ₹${t.total}`);
    return id;
  });
}

module.exports = (app) => {
  app.get('/api/docs', (req, res) => {
    const { kind, q, status, from, to, party } = req.query;
    const w = ['1=1'], p = [];
    if (kind) { w.push(`kind IN (${kind.split(',').map(() => '?').join(',')})`); p.push(...kind.split(',')); }
    if (from) { w.push('date>=?'); p.push(from); }
    if (to) { w.push('date<=?'); p.push(to); }
    if (party) { w.push('party_id=?'); p.push(+party); }
    let L = all(`SELECT * FROM docs WHERE ${w.join(' AND ')} ORDER BY date DESC, id DESC LIMIT 2000`, ...p).map(decorate);
    if (q) { const s = q.toLowerCase(); L = L.filter(d => (d.no + ' ' + d.party + ' ' + d.total).toLowerCase().includes(s)); }
    if (status) L = L.filter(d => d.status === status);
    res.json(L);
  });

  app.get('/api/docs/:id', (req, res) => res.json(full(+req.params.id)));

  app.post('/api/docs', (req, res) => res.json({ id: create(req.body, req.user.name) }));

  app.post('/api/docs/:id/cancel', (req, res) => {
    const d = get('SELECT * FROM docs WHERE id=?', +req.params.id);
    if (!d || d.x) fail('Already cancelled.');
    if (d.kind === 'sale' && get(`SELECT 1 FROM docs WHERE kind='return' AND x=0 AND ref_doc=?`, d.id)) fail('Cancel the credit notes on this invoice first.');
    if (d.kind === 'purchase') {
      for (const l of all('SELECT * FROM doc_lines WHERE doc_id=?', d.id)) {
        const p = get('SELECT * FROM products WHERE id=?', l.pid);
        if (p.qty < l.qty) fail(`Cannot cancel: some ${p.name} from this bill is already sold. Use a stock adjustment instead.`);
      }
    }
    tx(() => {
      if (d.kind === 'purchase') {
        // Undo the cost averaging before removing the stock.
        for (const l of all('SELECT * FROM doc_lines WHERE doc_id=?', d.id)) {
          const p = get('SELECT * FROM products WHERE id=?', l.pid), n = p.qty - l.qty;
          if (n > 0) run('UPDATE products SET cost=? WHERE id=?', r4(Math.max(0, (p.qty * p.cost - l.qty * l.cost) / n)), p.id);
        }
      }
      reverseMoves(d.id, (KINDS[d.kind].label) + ' cancelled', req.user.name);
      run('UPDATE docs SET x=1 WHERE id=?', d.id);
      run(`UPDATE payments SET x=1 WHERE ref_type='doc' AND ref_id=?`, d.id);
      run('UPDATE docs SET converted=NULL WHERE converted=?', d.id);
      audit(req.user.name, 'Cancelled ' + d.no);
    });
    res.json({ ok: 1 });
  });
};
module.exports.full = full;
module.exports.upiLink = upiLink;
module.exports.decorate = decorate;
