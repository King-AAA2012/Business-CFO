import { $, $$, api, route, state, icon, esc, fmt, fmtK, fd, fds, today, addDays, badge, empty, go, qty } from '../core.js';
import { lineChart, donut } from '../charts.js';
import { newDoc } from './docs.js';
import { productForm } from './inventory.js';
import { expenseForm, paymentForm } from './money.js';
import { openScanner } from './scan.js';

const PERIODS = { today: 'Today', week: '7 days', month: 'This month', fy: 'This FY' };
function range(p) {
  const T = today(), y = +T.slice(0, 4), fy = T.slice(5, 7) >= '04' ? y : y - 1;
  return { today: [T, T], week: [addDays(T, -6), T], month: [T.slice(0, 8) + '01', T], fy: [fy + '-04-01', T] }[p];
}
let period = 'month';

const delta = (a, b) => {
  if (!(b > 0) || a < 0) return '';
  const d = (a - b) / b * 100;
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${icon(d >= 0 ? 'up' : 'down')}${Math.abs(d).toFixed(0)}%</span>`;
};

route('/', async (v) => {
  const [from, to] = range(period);
  const d = await api(`/dashboard?from=${from}&to=${to}`);
  const p = d.pnl, hour = new Date().getHours();
  const hello = (hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening') + ', ' + esc(state.me.name.split(' ')[0]);
  const fresh = !d.products && !d.recent.length;
  const alerts = [
    d.overdueIn > 0 && `<a class="alert tone-r" href="#/sales?status=Overdue">${icon('alert')}<div><b>${fmt(d.overdueIn)} overdue from customers</b>Send reminders on WhatsApp from the invoice page.</div></a>`,
    d.low.length && `<a class="alert tone-a" href="#/insights">${icon('box')}<div><b>${d.low.length} product${d.low.length > 1 ? 's' : ''} running low</b>See reorder suggestions based on how fast they sell.</div></a>`,
    d.expiring && `<a class="alert tone-a" href="#/insights?tab=expiring">${icon('clock')}<div><b>${d.expiring} batch${d.expiring > 1 ? 'es' : ''} expiring within 30 days</b>Sell or return them before they go to waste.</div></a>`,
    d.unmatched && `<a class="alert tone-i" href="#/banking">${icon('bank')}<div><b>${d.unmatched} bank line${d.unmatched > 1 ? 's' : ''} to reconcile</b>Match them to invoices and bills in one click.</div></a>`,
  ].filter(Boolean);

  v.innerHTML = `
  <div class="ph"><div class="t"><h1>${hello}</h1><p>${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · here is how the business is doing.</p></div>
    <div class="seg">${Object.entries(PERIODS).map(([k, l]) => `<button data-p="${k}" class="${k === period ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  ${fresh ? `<div class="card pad" style="margin-bottom:18px;background:linear-gradient(135deg,var(--brand-soft),var(--accent-soft));border:0"><h2>Let's set up your shop</h2><p class="mut" style="margin:6px 0 14px">Three steps and you are ready to bill.</p><div class="quick" style="margin:0">
     <button class="qa" data-a="prod"><span class="ic tone-g">${icon('box')}</span>1. Add products</button><a class="qa" href="#/banking"><span class="ic tone-b">${icon('bank')}</span>2. Link bank & UPI</a><a class="qa" href="#/settings"><span class="ic tone-a">${icon('settings')}</span>3. Business & GST details</a></div></div>` : ''}
  <div class="quick">
    <button class="qa" data-a="sale"><span class="ic tone-g">${icon('receipt')}</span>New sale</button>
    <a class="qa" href="#/pos"><span class="ic tone-g">${icon('zap')}</span>Quick bill</a>
    <button class="qa" data-a="scan"><span class="ic tone-b">${icon('scan')}</span>Scan product</button>
    <button class="qa" data-a="purchase"><span class="ic tone-i">${icon('truck')}</span>New purchase</button>
    <button class="qa" data-a="exp"><span class="ic tone-a">${icon('wallet')}</span>Add expense</button>
    <button class="qa" data-a="recv"><span class="ic tone-b">${icon('rupee')}</span>Receive payment</button>
  </div>
  <div class="kpis">
    <div class="kpi hero ${p.net < 0 ? 'neg' : ''}"><div class="k"><span class="ic">${icon('trend')}</span>Net profit (est.)</div><b class="num">${fmt(p.net, 0)}${delta(p.net, d.prev.net)}</b><small>${p.netPct}% margin · after ${fmt(p.expT, 0)} expenses</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('receipt')}</span>Sales</div><b class="num">${fmt(p.rev, 0)}${delta(p.rev, d.prev.rev)}</b><small>${p.bills} bill${p.bills === 1 ? '' : 's'} · before GST</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('pie')}</span>Gross profit</div><b class="num">${fmt(p.gp, 0)}</b><small>${p.gpPct}% margin on sales</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('wallet')}</span>Money in hand</div><b class="num">${fmt(d.cash, 0)}</b><small>${d.accts.length} account${d.accts.length === 1 ? '' : 's'} · <a href="#/forecast">forecast</a></small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('down')}</span>Customers owe you</div><b class="num">${fmt(d.recv, 0)}</b><small class="${d.overdueIn ? 'neg' : ''}">${d.overdueIn ? fmt(d.overdueIn, 0) + ' overdue' : 'Nothing overdue'}</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('up')}</span>You owe</div><b class="num">${fmt(d.pay, 0)}</b><small>Suppliers and bills</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('box')}</span>Stock value</div><b class="num">${fmt(d.stockValue, 0)}</b><small>${fmt(d.stockRetail, 0)} at selling price</small></div>
    <div class="kpi"><div class="k"><span class="ic">${icon('shield')}</span>GST payable (est.)</div><b class="num">${fmt(p.gstOut - p.gstIn, 0)}</b><small>${fmt(p.gstOut, 0)} collected − ${fmt(p.gstIn, 0)} input</small></div>
  </div>
  ${alerts.length ? `<div class="row c2e" style="gap:12px;margin-bottom:6px">${alerts.join('')}</div>` : ''}
  <div class="row c2">
    <div class="card"><div class="card-h"><h3>Last 30 days</h3><div class="legend"><span><i style="background:var(--brand)"></i>Sales</span><span><i style="background:var(--accent)"></i>Gross profit</span><span><i style="background:var(--warn)"></i>Expenses</span></div></div><div class="card-b"><div id="trend"></div></div></div>
    <div class="card"><div class="card-h"><h3>Where money went</h3><a href="#/expenses">All expenses</a></div><div class="card-b" id="exp"></div></div>
  </div>
  <div class="row c3">
    <div class="card"><div class="card-h"><h3>Best sellers</h3><span class="mut" style="font-size:12px">by profit</span></div><div class="card-b">${d.top.length ? d.top.map((t, i) => `<a class="list-i" href="#/inventory/${t.pid}" style="color:inherit;text-decoration:none"><span class="badge plain ${i === 0 ? 'b-g' : ''}">#${i + 1}</span><div class="m"><b>${esc(t.name)}</b><small>${qty(t.q)} sold · ${fmt(t.rev, 0)} sales</small></div><b class="num pos">${fmt(t.profit, 0)}</b></a>`).join('') : empty('trend', 'No sales yet', 'Your top products will show here.')}</div></div>
    <div class="card"><div class="card-h"><h3>Coming in</h3><a href="#/sales">Invoices</a></div><div class="card-b">${dueList(d.dueIn, 'Nothing due from customers this week.')}</div></div>
    <div class="card"><div class="card-h"><h3>Going out</h3><a href="#/purchases">Bills</a></div><div class="card-b">${dueList(d.dueOut, 'No payments due this week.')}</div></div>
  </div>
  <div class="row c2e">
    <div class="card"><div class="card-h"><h3>Low stock</h3><a href="#/insights">Reorder plan</a></div><div class="card-b">${d.low.length ? d.low.map(p => `<a class="list-i" href="#/inventory/${p.id}" style="color:inherit;text-decoration:none"><div class="m"><b>${esc(p.name)}</b><small>Alert at ${qty(p.th)} ${esc(p.unit)}${p.cover != null ? ` · ~${p.cover} days left` : ''}</small></div><span class="badge b-r">${qty(p.qty)} left</span></a>`).join('') : empty('check', 'All stocked up', 'No product is at its alert level.')}</div></div>
    <div class="card"><div class="card-h"><h3>Recent activity</h3><a href="#/sales">See all</a></div><div class="card-b">${d.recent.length ? d.recent.map(x => `<a class="list-i" href="#/doc/${x.id}" style="color:inherit;text-decoration:none"><div class="m"><b>${esc(x.no)} · ${esc(x.party)}</b><small>${fd(x.date)}</small></div><b class="num">${fmt(x.total, 0)}</b>${badge(x.status)}</a>`).join('') : empty('receipt', 'No bills yet', 'Create your first sale to see it here.')}</div></div>
  </div>`;

  $$('[data-p]', v).forEach(b => b.onclick = () => { period = b.dataset.p; go('/'); });
  const acts = { sale: () => newDoc('sale'), purchase: () => newDoc('purchase'), exp: () => expenseForm(), recv: () => paymentForm('in'), scan: () => openScanner(), prod: () => productForm() };
  $$('[data-a]', v).forEach(b => b.onclick = () => acts[b.dataset.a]());
  const draw = () => {
    const t = $('#trend'); if (!t) return;
    lineChart(t, d.trend, [{ key: 'sales', label: 'Sales', color: 'var(--brand)', area: true }, { key: 'profit', label: 'Gross profit', color: 'var(--accent)' }, { key: 'exp', label: 'Expenses', color: 'var(--warn)', dash: true }]);
  };
  draw();
  new ResizeObserver(draw).observe($('#trend').parentNode);
  const ex = p.expenses.filter(e => e.total > 0);
  $('#exp').innerHTML = '';
  if (ex.length) donut($('#exp'), ex.slice(0, 6).map(e => ({ label: e.cat, value: e.total })).concat(ex.length > 6 ? [{ label: 'Other', value: ex.slice(6).reduce((t, e) => t + e.total, 0) }] : []));
  else $('#exp').innerHTML = empty('wallet', 'No expenses in this period', 'Add rent, salaries and bills to see true profit.');
});

function dueList(L, none) {
  if (!L.length) return empty('calendar', 'All clear', none);
  return L.map(x => `<a class="list-i" href="${x.kind === 'expense' ? '#/expenses' : '#/doc/' + x.id}" style="color:inherit;text-decoration:none"><div class="m"><b>${esc(x.party)}</b><small>${esc(x.no)} · <span class="${x.due < today() ? 'neg' : ''}">${x.due < today() ? 'overdue since' : 'due'} ${fds(x.due)}</span></small></div><b class="num">${fmt(x.bal, 0)}</b></a>`).join('');
}
