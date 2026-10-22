// Dashboard, P&L, GST, day book, stock insights, cash-flow forecast.
const { all, get } = require('../db');
const { r2, r4, today, addDays, docBal, expBal, accBalance, partyName } = require('../core');
const { decorate } = require('./docs');
const { listProducts, velocity } = require('./inventory');

const addMonths = (d, n) => { const [y, m, day] = d.split('-').map(Number), last = new Date(y, m - 1 + n + 1, 0).getDate(), x = new Date(y, m - 1 + n, Math.min(day, last)); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const sumOf =(sql, ...p) => r2(get(sql, ...p).s || 0);

function pnl(from, to) {
  const s = (kind, f) => sumOf(`SELECT SUM(${f}) s FROM docs WHERE kind=? AND x=0 AND date BETWEEN ? AND ?`, kind, from, to);
  const sales = s('sale', 'taxable'), returns = s('return', 'taxable'), cogs = r2(s('sale', 'cogs') - s('return', 'cogs'));
  const rev = r2(sales - returns), gp = r2(rev - cogs);
  const exp = all(`SELECT cat, SUM(total) t FROM expenses WHERE x=0 AND date BETWEEN ? AND ? GROUP BY cat ORDER BY t DESC`, from, to).map(r => ({ cat: r.cat, total: r2(r.t) }));
  const expT = r2(exp.reduce((t, e) => t + e.total, 0));
  const shrink = sumOf(`SELECT SUM(-m.q*p.cost) s FROM moves m JOIN products p ON p.id=m.pid WHERE m.date BETWEEN ? AND ? AND (m.type LIKE 'Adjustment%' OR m.type='Stocktake') AND m.q<0`, from, to);
  return {
    sales, returns, rev, cogs, gp, gpPct: rev ? r2(gp / rev * 100) : 0, expenses: exp, expT, shrink, net: r2(gp - expT - shrink), netPct: rev ? r2((gp - expT - shrink) / rev * 100) : 0,
    gstOut: r2(s('sale', 'gst') - s('return', 'gst')), gstIn: s('purchase', 'gst'), purchases: s('purchase', 'total'), bills: get(`SELECT COUNT(*) n FROM docs WHERE kind='sale' AND x=0 AND date BETWEEN ? AND ?`, from, to).n,
  };
}

function balances() {
  const recv = all(`SELECT * FROM docs WHERE kind='sale' AND x=0`).map(decorate).filter(d => d.bal > 0.005);
  const payDocs = all(`SELECT * FROM docs WHERE kind='purchase' AND x=0`).map(decorate).filter(d => d.bal > 0.005);
  const payExp = all('SELECT * FROM expenses WHERE x=0').map(e => ({ id: e.id, kind: 'expense', no: e.descr, party: e.payee || e.cat, due: e.due, date: e.date, total: e.total, bal: expBal(e) })).filter(e => e.bal > 0.005);
  const accts = all('SELECT id,name,type FROM accounts WHERE archived=0').map(a => ({ ...a, balance: accBalance(a.id) }));
  return { recv, pay: [...payDocs, ...payExp], accts };
}

function trend(days) {
  const from = addDays(today(), -days + 1), m = {};
  for (let i = 0; i < days; i++) m[addDays(from, i)] = { sales: 0, profit: 0, exp: 0 };
  for (const r of all(`SELECT date, SUM(CASE WHEN kind='sale' THEN taxable ELSE -taxable END) s, SUM(CASE WHEN kind='sale' THEN taxable-cogs ELSE -(taxable-cogs) END) p FROM docs WHERE kind IN ('sale','return') AND x=0 AND date>=? GROUP BY date`, from)) if (m[r.date]) { m[r.date].sales = r2(r.s); m[r.date].profit = r2(r.p); }
  for (const r of all(`SELECT date, SUM(total) t FROM expenses WHERE x=0 AND date>=? GROUP BY date`, from)) if (m[r.date]) m[r.date].exp = r2(r.t);
  return Object.entries(m).map(([date, v]) => ({ date, ...v }));
}
function monthly(n = 12) {
  const out = [];
  const d = new Date(); d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1), y = new Date(d.getFullYear(), d.getMonth() - i + 1, 0);
    const f = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`, t = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    const p = pnl(f, t);
    out.push({ month: f.slice(0, 7), sales: p.rev, net: p.net, exp: p.expT });
  }
  return out;
}

function topProducts(from, to, n = 5) {
  return all(`SELECT l.pid, l.name, SUM(l.qty) q, SUM(l.taxable) rev, SUM(l.taxable - l.qty*l.cost) profit FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='sale' AND d.x=0 AND d.date BETWEEN ? AND ? GROUP BY l.pid ORDER BY profit DESC LIMIT ?`, from, to, n).map(r => ({ ...r, q: r2(r.q), rev: r2(r.rev), profit: r2(r.profit) }));
}

function insights() {
  const P = listProducts(), v90 = velocity(90);
  const from90 = addDays(today(), -90);
  const rev = {};
  for (const r of all(`SELECT l.pid, SUM(l.taxable) r FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='sale' AND d.x=0 AND d.date>=? GROUP BY l.pid`, from90)) rev[r.pid] = r.r;
  const total = Object.values(rev).reduce((a, b) => a + b, 0);
  let cum = 0;
  const abc = {};
  Object.entries(rev).sort((a, b) => b[1] - a[1]).forEach(([pid, r]) => { cum += r; abc[pid] = cum / total <= 0.8 ? 'A' : cum / total <= 0.95 ? 'B' : 'C'; });
  const lastSale = {};
  for (const r of all(`SELECT l.pid, MAX(d.date) d FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='sale' AND d.x=0 GROUP BY l.pid`)) lastSale[r.pid] = r.d;
  const LEAD = 14;
  const rows = P.map(p => {
    const vel = p.vel || v90[p.id] || 0, cover = vel ? Math.round(p.qty / vel) : null;
    const target = Math.max(p.reorder_qty || 0, Math.ceil(vel * (LEAD + 30)));
    const suggest = (p.qty <= p.th || (cover != null && cover <= LEAD)) ? Math.max(0, Math.ceil(target - p.qty)) : 0;
    return { id: p.id, name: p.name, unit: p.unit, qty: p.qty, th: p.th, cost: p.cost, value: p.value, vel: r4(vel), cover, suggest, suggestValue: r2(suggest * p.cost), sup_id: p.sup_id, sup_name: p.sup_name, abc: abc[p.id] || (p.qty > 0 ? 'C' : '-'), lastSale: lastSale[p.id] || null, expiry: p.expiry };
  });
  const deadCut = addDays(today(), -60);
  return {
    reorder: rows.filter(r => r.suggest > 0).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9)),
    dead: rows.filter(r => r.qty > 0 && (!r.lastSale || r.lastSale < deadCut)).sort((a, b) => b.value - a.value),
    abc: rows.filter(r => r.abc !== '-'),
    expiring: all(`SELECT b.*, p.name, p.unit, p.cost FROM batches b JOIN products p ON p.id=b.pid WHERE b.qty>0 AND b.expiry IS NOT NULL AND b.expiry<>'' AND b.expiry<=? ORDER BY b.expiry`, addDays(today(), 60)).map(b => ({ ...b, value: r2(b.qty * b.cost), days: Math.round((new Date(b.expiry) - new Date(today())) / 864e5) })),
  };
}

// Day-by-day projection of money in hand from what is due in and out, plus recurring expenses.
function forecast(days = 30) {
  const { recv, pay, accts } = balances();
  let bal = r2(accts.reduce((t, a) => t + a.balance, 0));
  const start = bal, T = today(), out = [];
  const ev = {};
  const add = (d, amt, label) => { const k = !d || d < T ? T : d; (ev[k] = ev[k] || []).push({ amt, label }); };
  recv.forEach(d => add(d.due || addDays(d.date, 15), d.bal, `${d.party} pays ${d.no}`));
  pay.forEach(d => add(d.due || addDays(d.date, 15), -d.bal, `Pay ${d.party}${d.no ? ' (' + d.no + ')' : ''}`));
  const end = addDays(T, days);
  for (const r of all('SELECT * FROM recurring WHERE active=1')) {
    let d = r.next_date, n = 0;
    while (d <= end && n++ < 60) {
      add(d, -r.amount, r.descr);
      d = r.freq === 'weekly' ? addDays(d, 7) : addMonths(d, r.freq === 'quarterly' ? 3 : r.freq === 'yearly' ? 12 : 1);
    }
  }
  let low = { bal: start, date: T };
  for (let i = 0; i <= days; i++) {
    const d = addDays(T, i), e = ev[d] || [];
    bal = r2(bal + e.reduce((t, x) => t + x.amt, 0));
    if (bal < low.bal) low = { bal, date: d };
    out.push({ date: d, bal, in: r2(e.filter(x => x.amt > 0).reduce((t, x) => t + x.amt, 0)), out: r2(-e.filter(x => x.amt < 0).reduce((t, x) => t + x.amt, 0)), events: e });
  }
  return { start, end: bal, low, days: out };
}

function gst(from, to) {
  const docs = all(`SELECT * FROM docs WHERE kind IN ('sale','return') AND x=0 AND date BETWEEN ? AND ? ORDER BY date`, from, to);
  const party = {};
  const b2b = [], b2c = {}, hsn = {}, cn = [];
  for (const d of docs) {
    const p = d.party_id ? (party[d.party_id] = party[d.party_id] || get('SELECT * FROM parties WHERE id=?', d.party_id)) : null;
    const lines = all('SELECT * FROM doc_lines WHERE doc_id=?', d.id), sign = d.kind === 'return' ? -1 : 1;
    for (const l of lines) {
      const k = (l.hsn || 'NA') + '|' + l.gst_rate;
      const h = hsn[k] = hsn[k] || { hsn: l.hsn || 'NA', rate: l.gst_rate, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      h.qty += sign * l.qty; h.taxable = r2(h.taxable + sign * l.taxable);
      if (d.inter) h.igst = r2(h.igst + sign * l.tax); else { h.cgst = r2(h.cgst + sign * l.tax / 2); h.sgst = r2(h.sgst + sign * l.tax / 2); }
      if (d.kind === 'sale' && !p?.gstin) { const b = b2c[l.gst_rate] = b2c[l.gst_rate] || { rate: l.gst_rate, taxable: 0, tax: 0 }; b.taxable = r2(b.taxable + l.taxable); b.tax = r2(b.tax + l.tax); }
    }
    if (d.kind === 'sale' && p?.gstin) b2b.push({ no: d.no, date: d.date, gstin: p.gstin, name: p.name, pos: p.state, taxable: d.taxable, igst: d.inter ? d.gst : 0, cgst: d.inter ? 0 : r2(d.gst / 2), sgst: d.inter ? 0 : r2(d.gst / 2), total: d.total });
    if (d.kind === 'return') cn.push({ no: d.no, date: d.date, name: p?.name || '', gstin: p?.gstin || '', taxable: d.taxable, tax: d.gst, total: d.total, against: (get('SELECT no FROM docs WHERE id=?', d.ref_doc) || {}).no });
  }
  const inp = all(`SELECT * FROM docs WHERE kind='purchase' AND x=0 AND date BETWEEN ? AND ?`, from, to);
  const out = r2(Object.values(hsn).reduce((t, h) => t + h.igst + h.cgst + h.sgst, 0)), itc = r2(inp.reduce((t, d) => t + d.gst, 0));
  return { b2b, b2c: Object.values(b2c), hsn: Object.values(hsn), cn, purchases: inp.map(d => ({ no: d.no, date: d.date, supplier: partyName(d.party_id), gstin: (get('SELECT gstin FROM parties WHERE id=?', d.party_id) || {}).gstin || '', taxable: d.taxable, tax: d.gst, total: d.total })), outTax: out, itc, payable: r2(out - itc) };
}

function daybook(date) {
  const accts = all('SELECT id,name,type FROM accounts WHERE archived=0');
  const at = (id, d) => { const a = get('SELECT opening FROM accounts WHERE id=?', id).opening; const s = sql => get(sql, id, d).s || 0;
    return r2(a + s(`SELECT SUM(amt) s FROM payments WHERE x=0 AND dir='in' AND account_id=? AND date<=?`) - s(`SELECT SUM(amt) s FROM payments WHERE x=0 AND dir='out' AND account_id=? AND date<=?`) + s(`SELECT SUM(amt) s FROM transfers WHERE x=0 AND to_acc=? AND date<=?`) - s(`SELECT SUM(amt) s FROM transfers WHERE x=0 AND from_acc=? AND date<=?`)); };
  return {
    date,
    accounts: accts.map(a => ({ ...a, open: at(a.id, addDays(date, -1)), close: at(a.id, date) })),
    docs: all('SELECT * FROM docs WHERE date=? ORDER BY id', date).map(decorate),
    payments: all(`SELECT p.*, a.name account, CASE WHEN p.ref_type='doc' THEN (SELECT no FROM docs WHERE id=p.ref_id) ELSE (SELECT descr FROM expenses WHERE id=p.ref_id) END ref, (SELECT name FROM parties WHERE id=p.party_id) party FROM payments p LEFT JOIN accounts a ON a.id=p.account_id WHERE p.date=? AND p.x=0 ORDER BY p.id`, date),
    expenses: all('SELECT * FROM expenses WHERE date=? AND x=0', date),
    transfers: all('SELECT t.*, (SELECT name FROM accounts WHERE id=from_acc) f, (SELECT name FROM accounts WHERE id=to_acc) t2 FROM transfers t WHERE date=? AND x=0', date),
    pnl: pnl(date, date),
  };
}

function dashboard(from, to) {
  const p = pnl(from, to), b = balances(), T = today(), W = addDays(T, 7);
  const prods = listProducts();
  const span = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, pf = addDays(from, -span), pt = addDays(from, -1);
  return {
    pnl: p, prev: pnl(pf, pt),
    cash: r2(b.accts.reduce((t, a) => t + a.balance, 0)), accts: b.accts,
    recv: r2(b.recv.reduce((t, d) => t + d.bal, 0)), pay: r2(b.pay.reduce((t, d) => t + d.bal, 0)),
    stockValue: r2(prods.reduce((t, x) => t + x.value, 0)), stockRetail: r2(prods.reduce((t, x) => t + x.qty * x.price, 0)), products: prods.length,
    low: prods.filter(x => x.low).slice(0, 8),
    dueIn: b.recv.filter(d => d.due && d.due <= W).sort((a, c) => a.due > c.due ? 1 : -1).slice(0, 8),
    dueOut: b.pay.filter(d => d.due && d.due <= W).sort((a, c) => a.due > c.due ? 1 : -1).slice(0, 8),
    overdueIn: r2(b.recv.filter(d => d.due && d.due < T).reduce((t, d) => t + d.bal, 0)),
    expiring: get(`SELECT COUNT(*) n FROM batches WHERE qty>0 AND expiry IS NOT NULL AND expiry<>'' AND expiry<=?`, addDays(T, 30)).n,
    unmatched: get(`SELECT COUNT(*) n FROM bank_txns WHERE status='unmatched'`).n,
    trend: trend(30), top: topProducts(from, to), recent: all('SELECT * FROM docs ORDER BY id DESC LIMIT 6').map(decorate),
  };
}

module.exports = (app) => {
  const range = q => ({ from: q.from || today().slice(0, 8) + '01', to: q.to || today() });
  app.get('/api/dashboard', (req, res) => { const { from, to } = range(req.query); res.json(dashboard(from, to)); });
  app.get('/api/reports/pnl', (req, res) => { const { from, to } = range(req.query); res.json({ ...pnl(from, to), monthly: monthly(12) }); });
  app.get('/api/reports/gst', (req, res) => { const { from, to } = range(req.query); res.json(gst(from, to)); });
  app.get('/api/reports/daybook', (req, res) => res.json(daybook(req.query.date || today())));
  app.get('/api/reports/insights', (req, res) => res.json(insights()));
  app.get('/api/reports/forecast', (req, res) => res.json(forecast(+req.query.days || 30)));
  app.get('/api/reports/top', (req, res) => { const { from, to } = range(req.query); res.json(topProducts(from, to, 20)); });
};
Object.assign(module.exports, { pnl, balances, insights, forecast, dashboard, topProducts });
