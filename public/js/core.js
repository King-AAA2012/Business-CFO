// Shared UI toolkit: API client, formatting, icons, overlays, router.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const state = { me: null, settings: {}, accounts: [] };

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/auth')) { location.reload(); throw new Error('Signed out'); }
  if (!r.ok) { const e = new Error(j.error || 'Request failed'); e.confirm = j.confirm; e.status = r.status; throw e; }
  return j;
}
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });

// ---- format ----
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const r2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
export const fmt = (n, d = 2) => (n < 0 ? '-₹' : '₹') + Math.abs(+n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
export const fmtK = n => { const a = Math.abs(n), s = n < 0 ? '-₹' : '₹'; return a >= 1e7 ? s + (a / 1e7).toFixed(2) + 'Cr' : a >= 1e5 ? s + (a / 1e5).toFixed(2) + 'L' : a >= 1e3 ? s + (a / 1e3).toFixed(1) + 'k' : s + Math.round(a); };
export const qty = n => (+n || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const fd = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
export const fds = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
export const ago = d => { const n = Math.round((new Date(today()) - new Date(d)) / 864e5); return n === 0 ? 'today' : n === 1 ? 'yesterday' : n > 0 ? n + ' days ago' : 'in ' + -n + ' days'; };
export const debounce = (f, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
export const initials = s => String(s || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const owner = () => state.me?.role === 'owner';
export function inWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : '');
  const three = x => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  let r = Math.floor(Math.abs(n)), p = Math.round((Math.abs(n) - r) * 100), s = '';
  const parts = [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand']];
  for (const [v, w] of parts) if (r >= v) { s += three(Math.floor(r / v)) + ' ' + w + ' '; r %= v; }
  s += three(r);
  return 'Rupees ' + (s.trim() || 'Zero') + (p ? ' and ' + two(p) + ' Paise' : '') + ' Only';
}

// ---- icons (Lucide-style, MIT) ----
const P = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10.5 8v8M14 8v8M17 8v8"/>',
  barcode: '<path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62L18.3 9.38a1 1 0 0 0-.78-.38H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  bank: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
  settings: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', chev: '<path d="m9 18 6-6-6-6"/>', back: '<path d="m15 18-6-6 6-6"/>',
  up: '<path d="M7 17 17 7M7 7h10v10"/>', down: '<path d="m7 7 10 10M17 7v10H7"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  trend: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  rupee: '<path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.67 0 6.67-10 0-10"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || P.box}</svg>`;

// ---- small templates ----
export const STATUS_TONE = { Paid: 'b-g', 'Part-paid': 'b-a', Unpaid: 'b-i', Overdue: 'b-r', Cancelled: '', Open: 'b-i', Converted: 'b-g', Received: 'b-g', Expired: 'b-r', Issued: 'b-b', matched: 'b-g', unmatched: 'b-a', ignored: '' };
export const badge = (s, tone) => `<span class="badge ${tone ?? STATUS_TONE[s] ?? ''}">${esc(s)}</span>`;
export const empty = (ic, title, text = '', action = '') => `<div class="empty"><div class="ic">${icon(ic)}</div><b>${esc(title)}</b><p>${text}</p>${action}</div>`;
export const fld = (label, inner, hint = '') => `<label class="fld"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
export const inp = (name, v = '', a = '') => `<input name="${name}" value="${esc(v)}" ${a}>`;
export const sel = (name, opts, v, a = '') => `<select name="${name}" ${a}>${opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}"${String(val) === String(v ?? '') ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
export const thumb = (p, cls = 'pthumb') => `<div class="${cls}">${p.image ? `<img src="/api/products/${p.id}/image?v=${p.imgv || ''}" alt="" loading="lazy">` : icon('box')}</div>`;
export const accountOpts = (type) => state.accounts.filter(a => !a.archived && (!type || a.type === type)).map(a => [a.id, `${a.name} (${a.type.toUpperCase()})`]);
export const METHODS = [['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank transfer / NEFT / IMPS'], ['card', 'Card'], ['cheque', 'Cheque']];

// ---- toasts ----
export function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = icon(type === 'err' ? 'alert' : 'check') + `<span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = 0; setTimeout(() => el.remove(), 300); }, type === 'err' ? 5000 : 2600);
}

// ---- overlays ----
const stack = [];
function layer(el, onClose) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  document.body.append(scrim, el);
  const close = () => { scrim.remove(); el.remove(); const i = stack.indexOf(entry); if (i >= 0) stack.splice(i, 1); onClose?.(); };
  const entry = { close, el };
  scrim.onclick = close;
  stack.push(entry);
  return close;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) { stack[stack.length - 1].close(); e.stopPropagation(); } });
export const closeAll = () => [...stack].reverse().forEach(s => s.close());

// Drawer with a form. onSubmit(data, form) may return a promise; throw to show an error.
export function drawer({ title, body, onSubmit, submit = 'Save', wide = false, foot = '', onClose, onOpen }) {
  const el = document.createElement('form');
  el.className = 'drawer' + (wide ? ' wide' : '');
  el.noValidate = true;
  el.innerHTML = `<div class="drawer-h"><h2>${title}</h2><button type="button" class="iconbtn" data-x>${icon('x')}</button></div><div class="drawer-b">${body}</div>${onSubmit || foot ? `<div class="drawer-f"><div class="err"></div>${foot}${onSubmit ? `<button type="button" class="btn sec" data-x>Cancel</button><button class="btn" type="submit">${submit}</button>` : ''}</div>` : ''}`;
  const close = layer(el, onClose);
  $$('[data-x]', el).forEach(b => b.onclick = close);
  el.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', el), err = $('.err', el);
    err.textContent = ''; btn.disabled = true;
    try { const r = await onSubmit(formData(el), el); if (r !== false) close(); }
    catch (x) {
      if (x.confirm && await confirmBox(x.message, { ok: 'Continue anyway' })) { el.dataset.force = 1; btn.disabled = false; return el.requestSubmit(); }
      err.textContent = x.message;
    }
    finally { btn.disabled = false; }
  };
  setTimeout(() => { onOpen?.(el); $('input:not([type=hidden]):not([readonly]),select,textarea', $('.drawer-b', el))?.focus(); }, 30);
  return { el, close };
}
export function formData(f) {
  const o = {};
  for (const el of f.elements) {
    if (!el.name || el.closest('[data-skip]')) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked ? 1 : 0;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  if (f.dataset.force) o.force = 1;
  return o;
}
export function dialog(html, { wide } = {}) {
  const el = document.createElement('div');
  el.className = 'dialog' + (wide ? ' wide' : '');
  el.innerHTML = html;
  const close = layer(el);
  $$('[data-x]', el).forEach(b => b.onclick = close);
  return { el, close };
}
export function confirmBox(msg, { ok = 'Confirm', danger = false, title = 'Are you sure?' } = {}) {
  return new Promise(res => {
    let done = false;
    const { el, close } = dialog(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><div class="f"><button class="btn sec" data-no>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-ok>${esc(ok)}</button></div>`);
    const fin = v => { if (!done) { done = true; close(); res(v); } };
    $('[data-ok]', el).onclick = () => fin(true);
    $('[data-no]', el).onclick = () => fin(false);
    $('[data-ok]', el).focus();
    new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); if (!done) { done = true; res(false); } } }).observe(document.body, { childList: true });
  });
}
export function promptBox(title, label, value = '', type = 'text') {
  return new Promise(res => {
    const d = drawer({ title, body: fld(label, `<input name="v" type="${type}" value="${esc(value)}" step="any">`), onSubmit: v => res(v.v), onClose: () => res(null) });
  });
}

// ---- print ----
export function printHTML(html, pageCss = '') {
  let p = $('#print');
  if (!p) { p = document.createElement('div'); p.id = 'print'; document.body.append(p); }
  p.innerHTML = `<style>@page{${pageCss || 'size:A4;margin:10mm'}}</style>` + html;
  document.body.classList.add('printing');
  const imgs = $$('img', p).filter(i => !i.complete);
  Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => {
    setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing'), 300); }, 50);
  });
}

// ---- downloads ----
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const csv = rows => rows.map(r => r.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}
export const readFile = (file, as = 'text') => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; as === 'url' ? r.readAsDataURL(file) : r.readAsText(file); });
// Shrinks a photo to a small JPEG data URL for storage.
export async function shrinkImage(file, max = 480) {
  const url = await readFile(file, 'url');
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

// ---- WhatsApp ----
export const waLink = (phone, text) => { const p = String(phone || '').replace(/\D/g, ''); return `https://wa.me/${p.length === 10 ? '91' + p : p}?text=${encodeURIComponent(text)}`; };

// ---- router ----
const routes = [];
export const route = (pattern, render) => routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), render });
export const go = h => { if (location.hash === '#' + h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; };
export const current = () => location.hash.slice(1) || '/';
export function match(path) {
  const [p, qs] = path.split('?');
  for (const r of routes) { const m = r.re.exec(p); if (m) return { render: r.render, params: m.slice(1).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(qs || '')) }; }
  return null;
}
export async function refreshAccounts() { state.accounts = await api('/accounts'); return state.accounts; }
