// Settings, barcode/QR images, activity log, backup/restore, AI assistant.
const bwip = require('bwip-js');
const { db, all, get, run, tx, setting, setSetting, DEFAULTS } = require('../db');
const { r2, today, addDays, fail, audit, ean13 } = require('../core');
const { ownerOnly } = require('../auth');
const R = require('./reports');

const SECRET = { razorpay: ['keySecret', 'webhookSecret'], setu: ['clientSecret'] };
const TABLES = ['settings', 'counters', 'accounts', 'products', 'batches', 'moves', 'parties', 'docs', 'doc_lines', 'expenses', 'recurring', 'payments', 'transfers', 'bank_txns', 'audit', 'users'];

function publicSettings(owner) {
  const o = {};
  for (const k of Object.keys(DEFAULTS)) {
    if (!owner && (k === 'razorpay' || k === 'setu')) continue;
    o[k] = setting(k);
    for (const s of SECRET[k] || []) o[k][s] = o[k][s] ? '••••••••' : '';
  }
  return o;
}

// ---------- AI assistant ----------
const fmt = n => (n < 0 ? '-₹' : '₹') + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
function context() {
  const T = today(), M = T.slice(0, 8) + '01';
  const d = R.dashboard(M, T), ins = R.insights(), fc = R.forecast(30);
  return {
    today: T, monthToDate: { sales: d.pnl.rev, grossProfit: d.pnl.gp, expenses: d.pnl.expT, netProfit: d.pnl.net, bills: d.pnl.bills, gstCollected: d.pnl.gstOut, gstPaidOnPurchases: d.pnl.gstIn },
    previousPeriod: { sales: d.prev.rev, netProfit: d.prev.net, expenses: d.prev.expT },
    expensesByCategory: d.pnl.expenses, moneyInAccounts: d.accts.map(a => ({ name: a.name, balance: a.balance })), totalMoney: d.cash,
    customersOwe: d.recv, overdueFromCustomers: d.overdueIn, youOwe: d.pay, stockValueAtCost: d.stockValue,
    lowStock: d.low.map(p => `${p.name}: ${p.qty} ${p.unit}`), reorderSuggestions: ins.reorder.slice(0, 8).map(r => `${r.name}: order ${r.suggest} ${r.unit} (${r.cover ?? '?'} days left)`),
    deadStock: ins.dead.slice(0, 5).map(r => `${r.name}: ${fmt(r.value)} unsold since ${r.lastSale || 'never sold'}`), expiringSoon: ins.expiring.slice(0, 5).map(b => `${b.name} batch ${b.code}: ${b.qty} expires ${b.expiry}`),
    topProductsByProfit: d.top.map(t => `${t.name}: ${fmt(t.profit)} profit on ${t.q} sold`),
    dueSoonFromCustomers: d.dueIn.map(x => `${x.party} ${x.no}: ${fmt(x.bal)} due ${x.due}`), dueSoonToPay: d.dueOut.map(x => `${x.party} ${x.no}: ${fmt(x.bal)} due ${x.due}`),
    cashForecast30d: { now: fc.start, in30days: fc.end, lowestPoint: fc.low },
  };
}
function ruleAnswer(q, c) {
  const m = c.monthToDate;
  if (/gst|tax/.test(q)) return `GST collected this month: ${fmt(m.gstCollected)}. GST paid on purchases (input credit): ${fmt(m.gstPaidOnPurchases)}. Estimated net GST: ${fmt(r2(m.gstCollected - m.gstPaidOnPurchases))}. Confirm with your CA before filing.`;
  if (/compare|last month|previous/.test(q)) return `This month vs the previous period:\nSales: ${fmt(m.sales)} vs ${fmt(c.previousPeriod.sales)}\nExpenses: ${fmt(m.expenses)} vs ${fmt(c.previousPeriod.expenses)}\nNet profit: ${fmt(m.netProfit)} vs ${fmt(c.previousPeriod.netProfit)}`;
  if (/profit/.test(q) && /most|product|item|best/.test(q)) return c.topProductsByProfit.length ? 'Top products by profit this month:\n' + c.topProductsByProfit.join('\n') : 'No sales recorded this month yet.';
  if (/profit|earn|margin/.test(q)) return `This month: sales ${fmt(m.sales)} (before GST), gross profit ${fmt(m.grossProfit)}, expenses ${fmt(m.expenses)}, estimated net profit ${fmt(m.netProfit)}.`;
  if (/forecast|next month|run out|short|enough|cash flow/.test(q)) return `You have ${fmt(c.cashForecast30d.now)} now. Based on dues and recurring costs you will have about ${fmt(c.cashForecast30d.in30days)} in 30 days. Lowest point: ${fmt(c.cashForecast30d.lowestPoint.bal)} on ${c.cashForecast30d.lowestPoint.date}.`;
  if (/money do i have|cash|bank|balance/.test(q)) return c.moneyInAccounts.map(a => `${a.name}: ${fmt(a.balance)}`).join('\n') + `\nTotal: ${fmt(c.totalMoney)}`;
  if (/owe me|customer|receiv|collect/.test(q)) return `Customers owe you ${fmt(c.customersOwe)} (${fmt(c.overdueFromCustomers)} overdue).` + (c.dueSoonFromCustomers.length ? '\nDue soon:\n' + c.dueSoonFromCustomers.join('\n') : '');
  if (/supplier|i owe|bills|pay/.test(q)) return `You owe ${fmt(c.youOwe)}.` + (c.dueSoonToPay.length ? '\nDue soon:\n' + c.dueSoonToPay.join('\n') : '');
  if (/reorder|order|restock|low/.test(q)) return c.reorderSuggestions.length ? 'Reorder these:\n' + c.reorderSuggestions.join('\n') : (c.lowStock.length ? 'Low stock:\n' + c.lowStock.join('\n') : 'Stock levels look fine.');
  if (/dead|not selling|slow/.test(q)) return c.deadStock.length ? 'Stock not sold in 60+ days:\n' + c.deadStock.join('\n') : 'No dead stock found.';
  if (/expir/.test(q)) return c.expiringSoon.length ? c.expiringSoon.join('\n') : 'Nothing expires in the next 60 days.';
  if (/expense|spend/.test(q)) return c.expensesByCategory.length ? 'Expenses this month:\n' + c.expensesByCategory.map(e => `${e.cat}: ${fmt(e.total)}`).join('\n') : 'No expenses recorded this month.';
  return [`Here is your snapshot:`, `Sales this month ${fmt(m.sales)}, net profit ${fmt(m.netProfit)}.`, `Money in accounts ${fmt(c.totalMoney)}. Customers owe ${fmt(c.customersOwe)}; you owe ${fmt(c.youOwe)}.`, c.reorderSuggestions.length ? `${c.reorderSuggestions.length} product(s) need reordering.` : 'Stock is fine.'].join('\n');
}
async function ollama(q, c, history) {
  const s = setting('ai');
  if (!s.model) return null;
  const sys = `You are the CFO assistant for an Indian small business. Answer ONLY from the JSON data given. Use ₹ and Indian number format. Be short and practical: lead with the answer, then at most 3 bullet points of advice. If the data does not contain the answer, say so. Never invent numbers.\nDATA:\n${JSON.stringify(c)}`;
  try {
    const r = await fetch(s.ollamaUrl.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.model, stream: false, options: { temperature: 0.2 }, messages: [{ role: 'system', content: sys }, ...history.slice(-6), { role: 'user', content: q }] }), signal: AbortSignal.timeout(90000) });
    if (!r.ok) return null;
    return (await r.json()).message?.content || null;
  } catch { return null; }
}

module.exports = (app) => {
  app.get('/api/settings', (req, res) => res.json(publicSettings(req.user.role === 'owner')));
  app.put('/api/settings/:k', ownerOnly, (req, res) => {
    const k = req.params.k;
    if (!DEFAULTS[k]) fail('Unknown setting.');
    const v = { ...req.body };
    for (const s of SECRET[k] || []) if (v[s] === '••••••••') delete v[s];
    if (k === 'upi' && v.vpa && !/^[\w.\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,64}$/.test(v.vpa)) fail('UPI ID should look like yourname@okhdfcbank.');
    if (k === 'business' && v.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(v.gstin.toUpperCase())) fail('That GSTIN does not look right.');
    setSetting(k, v);
    audit(req.user.name, 'Changed settings: ' + k);
    res.json({ ok: 1 });
  });

  app.get('/api/ollama/models', async (req, res) => {
    try { const r = await fetch(setting('ai').ollamaUrl.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(3000) }); res.json((await r.json()).models.map(m => m.name)); }
    catch { res.json([]); }
  });

  // Barcode / QR as SVG. type: ean13 | code128 | qrcode
  app.get('/api/code.svg', (req, res) => {
    const text = String(req.query.text || '').slice(0, 500), type = req.query.type || 'code128';
    if (!text) return res.status(400).end();
    let bcid = { ean13: 'ean13', code128: 'code128', qr: 'qrcode', qrcode: 'qrcode' }[type] || 'code128';
    if (bcid === 'ean13' && !/^\d{12,13}$/.test(text)) bcid = 'code128';
    try {
      const opts = bcid === 'qrcode'
        ? { bcid, text, scale: 3, eclevel: 'M' }
        : { bcid, text: bcid === 'ean13' ? text.slice(0, 12) : text, scale: 3, height: +req.query.h || 12, includetext: req.query.text_ !== '0', textxalign: 'center', textsize: 9, paddingwidth: 2 };
      const svg = bwip.toSVG(opts);
      res.type('image/svg+xml').set('Cache-Control', 'private, max-age=86400').send(svg);
    } catch (e) { res.status(400).type('text/plain').send(e.message); }
  });

  app.get('/api/audit', (req, res) => res.json(all('SELECT * FROM audit ORDER BY id DESC LIMIT 500')));

  app.get('/api/backup', ownerOnly, (req, res) => {
    const out = { app: 'ai-business-cfo', version: 2, at: new Date().toISOString(), tables: {} };
    for (const t of TABLES) out.tables[t] = all(`SELECT * FROM ${t}`);
    audit(req.user.name, 'Downloaded backup');
    res.set('Content-Disposition', `attachment; filename="cfo-backup-${today()}.json"`).json(out);
  });
  app.post('/api/restore', ownerOnly, (req, res) => {
    const b = req.body;
    if (b?.app !== 'ai-business-cfo' || !b.tables) fail('This is not a backup file from this app.');
    tx(() => {
      for (const t of TABLES) {
        if (!b.tables[t]) continue;
        run(`DELETE FROM ${t}`);
        for (const r of b.tables[t]) { const k = Object.keys(r); run(`INSERT INTO ${t}(${k.join(',')}) VALUES(${k.map(() => '?').join(',')})`, ...k.map(x => r[x])); }
      }
    });
    audit(req.user.name, 'Restored from backup');
    res.json({ ok: 1 });
  });

  app.post('/api/ai', async (req, res) => {
    const q = String(req.body.q || '').trim();
    if (!q) fail('Ask a question.');
    const c = context();
    const llm = await ollama(q, c, (req.body.history || []).map(m => ({ role: m.me ? 'user' : 'assistant', content: String(m.t) })));
    res.json({ answer: llm || ruleAnswer(q.toLowerCase(), c), source: llm ? 'ollama' : 'rules' });
  });
};
