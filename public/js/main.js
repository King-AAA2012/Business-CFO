import { $, $$, api, post, state, icon, esc, fmt, toast, go, current, match, refreshAccounts, initials, closeAll, debounce, owner, fld } from './core.js';
import './views/dashboard.js';
import './views/inventory.js';
import './views/docs.js';
import './views/pos.js';
import './views/parties.js';
import './views/money.js';
import './views/reports.js';
import './views/scan.js';
import './views/labels.js';
import './views/ai.js';
import './views/settings.js';
import { openScanner, handleScan } from './views/scan.js';
import { newDoc } from './views/docs.js';
import { productForm } from './views/inventory.js';
import { expenseForm } from './views/money.js';

const NAV = [
  ['Overview', [['/', 'home', 'Dashboard'], ['/ai', 'sparkles', 'AI CFO']]],
  ['Sell', [['/pos', 'zap', 'Quick bill (POS)'], ['/sales', 'receipt', 'Invoices & quotes'], ['/customers', 'users', 'Customers']]],
  ['Buy', [['/purchases', 'truck', 'Bills & orders'], ['/suppliers', 'users', 'Suppliers'], ['/expenses', 'wallet', 'Expenses']]],
  ['Stock', [['/inventory', 'box', 'Inventory'], ['/scan', 'scan', 'Scan'], ['/labels', 'barcode', 'Barcode labels'], ['/stocktake', 'clipboard', 'Stocktake'], ['/insights', 'layers', 'Stock insights']]],
  ['Money', [['/banking', 'bank', 'Bank & UPI'], ['/forecast', 'trend', 'Cash flow']]],
  ['Reports', [['/reports', 'chart', 'Reports & GST'], ['/settings', 'settings', 'Settings']]],
];

async function boot() {
  const r = await api('/auth/me');
  if (!r.user) return authScreen(r.setup);
  state.me = r.user;
  [state.settings] = await Promise.all([api('/settings'), refreshAccounts()]);
  shell();
  window.addEventListener('hashchange', render);
  render();
}

// ---------- auth ----------
function authScreen(setup) {
  $('#root').innerHTML = `<div class="auth"><div class="auth-art"><div class="brandmark"><div class="logo">${icon('trend')}</div><div><b style="font-size:17px">AI Business CFO</b></div></div>
    <div><h1>Run your shop's money like a pro.</h1><p>Billing, stock, barcodes, bank and UPI reconciliation, GST and an AI CFO in one place. Your data stays on this computer.</p>
    <ul>${['Scan barcodes with your phone camera or a USB scanner', 'GST invoices with a UPI QR the customer scans to pay', 'Import bank statements and auto-match payments', 'Know what to reorder, what is not selling and what expires'].map(t => `<li>${icon('check')} ${t}</li>`).join('')}</ul></div>
    <small style="color:#6b8f80">Works offline on your network. No subscription.</small></div>
    <div class="auth-form"><form id="af">${setup
      ? `<h2>Set up your business</h2><p>Create the owner account. You can add staff later.</p>${fld('Business name', '<input name="bname" required placeholder="e.g. Shah General Store">')}<div class="grid2">${fld('Your name', '<input name="name" required>')}${fld('Username', '<input name="username" required autocomplete="username">')}</div>${fld('Password', '<input name="password" type="password" required minlength="6" autocomplete="new-password">', 'At least 6 characters.')}`
      : `<h2>Welcome back</h2><p>Sign in to continue.</p>${fld('Username', '<input name="username" required autocomplete="username">')}${fld('Password', '<input name="password" type="password" required autocomplete="current-password">')}`}
      <div class="err" style="color:var(--danger);margin-bottom:10px;min-height:20px"></div><button class="btn lg block">${setup ? 'Create account' : 'Sign in'} ${icon('arrow')}</button></form></div></div>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      if (setup) await post('/auth/setup', { ...d, business: { name: d.bname } });
      else await post('/auth/login', d);
      location.hash = '/'; location.reload();
    } catch (x) { $('.err', e.target).textContent = x.message; }
  };
}

// ---------- shell ----------
function shell() {
  const biz = state.settings.business?.name || 'My Business';
  $('#root').innerHTML = `<div id="app"><aside class="side" id="side"><div class="brandmark"><div class="logo">${icon('trend')}</div><div style="min-width:0"><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(biz)}</b><small>AI Business CFO</small></div></div>
    ${NAV.map(([g, items]) => `<div class="nav-g">${g}</div>` + items.map(([h, ic, l]) => `<a class="nav" href="#${h}" data-h="${h}">${icon(ic)}<span>${l}</span>${h === '/banking' ? '<span class="cnt" id="unm" hidden></span>' : ''}</a>`).join('')).join('')}
    <div class="side-foot"><div class="avatar">${esc(initials(state.me.name))}</div><div class="who"><b>${esc(state.me.name)}</b><small>${state.me.role === 'owner' ? 'Owner' : 'Staff'}</small></div><button class="iconbtn" id="theme" title="Theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button><button class="iconbtn" id="logout" title="Sign out">${icon('logout')}</button></div></aside>
    <main><div class="topbar" id="top"><button class="iconbtn" id="menu" style="display:none">${icon('menu')}</button><div class="search" id="sbox">${icon('search')}<span>Search products, invoices, customers…</span><span class="kbd">Ctrl K</span></div><div class="grow"></div>
      <button class="btn sec icon" id="tscan" title="Scan a barcode">${icon('scan')}</button><button class="btn" id="tnew">${icon('plus')}<span class="hide-s">New sale</span></button></div>
      <div id="view"></div></main></div>
    <nav class="mnav"><button data-h="/">${icon('home')}Home</button><button data-h="/inventory">${icon('box')}Stock</button><button id="mscan"><span class="fab">${icon('scan')}</span></button><button data-h="/pos">${icon('zap')}Sell</button><button id="mmore">${icon('menu')}More</button></nav>`;
  const mq = matchMedia('(max-width:860px)'), sync = () => { $('#menu').style.display = mq.matches ? '' : 'none'; $('.hide-s') && ($('.hide-s').style.display = mq.matches ? 'none' : ''); };
  mq.addEventListener('change', sync); sync();
  const openSide = () => { const s = $('#side'); s.classList.add('open'); const sc = document.createElement('div'); sc.className = 'scrim'; sc.style.zIndex = 110; sc.onclick = () => { s.classList.remove('open'); sc.remove(); }; document.body.append(sc); $$('.nav', s).forEach(n => n.addEventListener('click', () => sc.click(), { once: true })); };
  $('#menu').onclick = openSide; $('#mmore').onclick = openSide;
  $$('.mnav [data-h]').forEach(b => b.onclick = () => go(b.dataset.h));
  $('#mscan').onclick = $('#tscan').onclick = () => openScanner();
  $('#tnew').onclick = () => newDoc('sale');
  $('#sbox').onclick = palette;
  $('#logout').onclick = async () => { await post('/auth/logout'); location.reload(); };
  $('#theme').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const t = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('cfo-theme', t); } catch { }
    $('#theme').innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
  };
  addEventListener('scroll', () => $('#top')?.classList.toggle('scrolled', scrollY > 4), { passive: true });
  badgeCount();
}
export async function badgeCount() {
  const n = state.accounts.reduce((t, a) => t + (a.unmatched || 0), 0), el = $('#unm');
  if (el) { el.hidden = !n; el.textContent = n; }
}

let rendering = 0;
async function render() {
  const path = current(), m = match(path);
  closeAll();
  state.scanHandler = null;
  $$('.nav').forEach(n => n.classList.toggle('on', n.dataset.h === '/' ? path === '/' : (path.split('?')[0] + '/').startsWith(n.dataset.h + '/')));
  $$('.mnav [data-h]').forEach(n => n.classList.toggle('on', n.dataset.h === path.split('?')[0]));
  const v = $('#view'), my = ++rendering;
  if (!m) { v.innerHTML = '<div class="empty"><b>Page not found</b></div>'; return; }
  v.style.animation = 'none'; v.offsetHeight; v.style.animation = '';
  try { await m.render(v, ...m.params, m.query); }
  catch (e) { if (my === rendering) v.innerHTML = `<div class="alert tone-r">${icon('alert')}<div><b>Could not load this page</b>${esc(e.message)}</div></div>`; console.error(e); }
  if (my === rendering) scrollTo(0, 0);
}

// ---------- command palette ----------
async function palette() {
  if ($('.cmdk')) return;
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('div'); el.className = 'cmdk';
  el.innerHTML = `<div class="inwrap">${icon('search')}<input placeholder="Type a product, invoice no., customer or command…" autocomplete="off"></div><ul></ul>`;
  document.body.append(scrim, el);
  const close = () => { scrim.remove(); el.remove(); };
  scrim.onclick = close;
  const input = $('input', el), ul = $('ul', el);
  const cmds = [
    ['New sale invoice', 'receipt', () => newDoc('sale')], ['New purchase bill', 'truck', () => newDoc('purchase')], ['New quotation', 'file', () => newDoc('quote')], ['New purchase order', 'clipboard', () => newDoc('po')],
    ['Add product', 'box', () => productForm()], ['Add expense', 'wallet', () => expenseForm()], ['Scan barcode', 'scan', () => openScanner()], ['Open POS', 'zap', () => go('/pos')],
    ...NAV.flatMap(([, i]) => i.map(([h, ic, l]) => ['Go to ' + l, ic, () => go(h)])),
  ].map(([label, ic, run]) => ({ label, ic, run, grp: 'Actions' }));
  let prods = [], parties = [], docs = [], sel = 0, items = [];
  Promise.all([api('/products'), api('/parties?kind=c'), api('/parties?kind=s')]).then(([p, c, s]) => { prods = p; parties = [...c.map(x => ({ ...x, k: 'Customer' })), ...s.map(x => ({ ...x, k: 'Supplier' }))]; draw(); });
  const fetchDocs = debounce(async q => { docs = q.length > 1 ? (await api('/docs?q=' + encodeURIComponent(q))).slice(0, 6) : []; draw(); }, 180);
  function draw() {
    const q = input.value.toLowerCase().trim();
    const has = s => !q || s.toLowerCase().includes(q);
    items = [
      ...prods.filter(p => q && has(p.name + ' ' + p.sku + ' ' + p.barcode)).slice(0, 6).map(p => ({ grp: 'Products', label: p.name, ic: 'box', hint: `${p.qty} ${p.unit} · ${fmt(p.price)}`, run: () => go('/inventory/' + p.id) })),
      ...docs.map(d => ({ grp: 'Documents', label: `${d.no} · ${d.party}`, ic: 'receipt', hint: fmt(d.total), run: () => go('/doc/' + d.id) })),
      ...parties.filter(p => q && has(p.name + ' ' + p.phone)).slice(0, 5).map(p => ({ grp: p.k + 's', label: p.name, ic: 'users', hint: p.balance ? fmt(p.balance) : '', run: () => go(`/${p.kind === 'c' ? 'customers' : 'suppliers'}/${p.id}`) })),
      ...cmds.filter(c => has(c.label)).slice(0, q ? 6 : 12),
    ];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let g = '';
    ul.innerHTML = items.map((it, i) => (it.grp !== g ? `<div class="grp">${g = it.grp}</div>` : '') + `<li data-i="${i}" class="${i === sel ? 'on' : ''}">${icon(it.ic)}<span>${esc(it.label)}</span>${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</li>`).join('') || '<div class="empty" style="padding:24px">Nothing found</div>';
    $$('li', ul).forEach(li => li.onclick = () => { close(); items[li.dataset.i].run(); });
  }
  input.oninput = () => { sel = 0; draw(); fetchDocs(input.value.trim()); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && items[sel]) { close(); items[sel].run(); }
    if (e.key === 'Escape') close();
  };
  draw(); input.focus();
}

// ---------- keyboard: shortcuts + USB/Bluetooth barcode scanners (they type fast and press Enter) ----------
let buf = '', last = 0;
document.addEventListener('keydown', e => {
  if (!state.me) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
  const t = e.target, typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.dataset.scan;
  const now = performance.now();
  if (now - last > 60) buf = '';
  last = now;
  if (e.key === 'Enter') {
    if (buf.length >= 4 && !typing) { e.preventDefault(); const code = buf; buf = ''; handleScan(code); }
    buf = ''; return;
  }
  if (e.key.length === 1) buf += e.key;
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $('.drawer,.dialog,.cmdk')) return;
  if (e.key === '/') { e.preventDefault(); palette(); }
}, true);

boot().catch(e => { $('#root').innerHTML = `<div class="empty"><b>Could not reach the server</b><p>${esc(e.message)}</p></div>`; });
