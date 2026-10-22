import { $, $$, api, post, route, state, icon, esc, fmt, qty, fd, thumb, empty, dialog, drawer, toast, go, confirmBox, debounce, badge } from '../core.js';

const FORMATS = () => { const F = window.Html5QrcodeSupportedFormats; return F ? [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX] : undefined; };
let n = 0;
const beep = () => { try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 1320; g.gain.value = .08; o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + .09); navigator.vibrate?.(40); } catch { } };

// Camera scanner bound to an element. Returns a stop() function.
async function startCamera(el, onCode, { continuous = false } = {}) {
  if (!window.Html5Qrcode) throw new Error('Scanner is still loading. Try again in a second.');
  if (!isSecureContext) throw new Error('insecure');
  const id = 'cam' + (++n);
  el.innerHTML = `<div id="${id}" style="width:100%;height:100%"></div><div class="reticle"></div>`;
  const h = new Html5Qrcode(id, { formatsToSupport: FORMATS(), useBarCodeDetectorIfSupported: true, verbose: false });
  let last = '', lastAt = 0, stopped = false;
  await h.start({ facingMode: 'environment' }, { fps: 12, aspectRatio: 4 / 3, disableFlip: true }, text => {
    const now = Date.now();
    if (text === last && now - lastAt < 2200) return;
    last = text; lastAt = now;
    beep(); el.classList.remove('scanflash'); void el.offsetWidth; el.classList.add('scanflash');
    onCode(text.trim());
  }, () => { });
  return async () => { if (stopped) return; stopped = true; try { await h.stop(); h.clear(); } catch { } };
}
async function scanImage(file) {
  const id = 'img' + (++n), d = document.createElement('div');
  d.id = id; d.hidden = true; document.body.append(d);
  try { return (await new Html5Qrcode(id, { formatsToSupport: FORMATS(), verbose: false }).scanFile(file, false)).trim(); }
  finally { d.remove(); }
}

const httpsHint = () => `<div class="alert tone-a" style="margin:0">${icon('alert')}<div><b>Live camera needs a secure link</b>On a phone, open <span class="mono">https://${location.hostname}:4643</span> (shown when the server starts) and accept the warning once. Or take a photo of the barcode below; that works everywhere.</div></div>`;

// Scanner dialog. onCode is called for every code; with continuous=false it closes after the first one.
export function openScanner({ continuous = false, onCode, title = 'Scan a barcode or QR code' } = {}) {
  const { el, close } = dialog(`<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><h2 style="flex:1">${esc(title)}</h2><button class="iconbtn" data-x>${icon('x')}</button></div>
    <div class="scanbox" id="sb"></div><div id="sm" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><label class="btn sec" style="flex:1">${icon('camera')}Photo<input type="file" accept="image/*" capture="environment" hidden id="sf"></label><form id="mf" style="display:flex;gap:8px;flex:2;min-width:200px"><input id="mc" placeholder="Or type the code" class="mono" data-scan="1"><button class="btn sec">Go</button></form></div>
    ${continuous ? '<p class="mut" style="font-size:12.5px;margin:10px 0 0">Keep scanning; each item is added. Close when done.</p>' : ''}`, { wide: false });
  let stop = null;
  const done = code => { if (!code) return; (onCode || handleScan)(code); if (!continuous) close(); };
  const sb = $('#sb', el);
  startCamera(sb, done, { continuous }).then(s => { stop = s; if (!el.isConnected) s(); }).catch(e => { sb.style.display = 'none'; $('#sm', el).innerHTML = e.message === 'insecure' ? httpsHint() : `<div class="alert tone-a" style="margin:0">${icon('alert')}<div><b>Camera not available</b>${esc(e.message || e)}. Use a photo or type the code.</div></div>`; });
  $('#sf', el).onchange = async ev => { const f = ev.target.files[0]; if (!f) return; try { done(await scanImage(f)); } catch { toast('No barcode found in that photo. Try closer and in good light.', 'err'); } ev.target.value = ''; };
  $('#mf', el).onsubmit = e => { e.preventDefault(); const c = $('#mc', el).value.trim(); $('#mc', el).value = ''; done(c); };
  new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); stop?.(); } }).observe(document.body, { childList: true });
  return { close, el };
}
export function scanOnce(title, { keepOpen, onCode } = {}) {
  return new Promise(res => {
    let got = null;
    const { el } = openScanner({ title, continuous: !!keepOpen, onCode: c => { got = c; onCode ? onCode(c) : res(c); } });
    new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); res(got); } }).observe(document.body, { childList: true });
  });
}

// Global scan entry point (USB scanner keystrokes, scanner dialog, scan page).
export async function handleScan(code) {
  if (state.scanHandler) return state.scanHandler(code);
  const r = await fetch('/api/lookup/' + encodeURIComponent(code));
  if (!r.ok) return notFound(code);
  productCard(await r.json());
}
function notFound(code) {
  const { el, close } = dialog(`<div class="empty" style="padding:8px 0"><div class="ic tone-a">${icon('search')}</div><b>No product with this code</b><p class="mono">${esc(code)}</p></div><div class="f" style="justify-content:center"><button class="btn sec" data-x>Close</button><button class="btn" id="cr">${icon('plus')}Create product with this barcode</button></div>`);
  $('#cr', el).onclick = async () => { close(); (await import('./inventory.js')).productForm(null, { barcode: code }); };
}
export function productCard(p) {
  const { el, close } = dialog(`<div style="display:flex;gap:14px;align-items:flex-start"><div class="prod-img" style="width:86px;height:86px">${p.image ? `<img src="/api/products/${p.id}/image">` : icon('box')}</div><div style="flex:1;min-width:0"><div class="meta" style="margin:0 0 4px">${p.cat ? badge(p.cat, 'plain') : ''}${p.archived ? badge('Archived', 'b-r') : ''}${p.matchedBatch ? badge('Batch ' + p.matchedBatch.code, 'b-b') : ''}</div><h2>${esc(p.name)}</h2><div class="mono mut" style="font-size:12px">${esc(p.barcode)} · ${esc(p.sku)}</div></div><button class="iconbtn" data-x>${icon('x')}</button></div>
    <div class="stats" style="margin:16px -22px 0;border-bottom:1px solid var(--line)"><div><small>Price</small><b>${fmt(p.price)}</b>${p.mrp ? `<small>MRP ${fmt(p.mrp)}</small>` : ''}</div><div><small>In stock</small><b class="${p.qty <= 0 ? 'neg' : p.qty <= p.th ? 'warn' : 'pos'}">${qty(p.qty)} ${esc(p.unit)}</b>${p.location ? `<small>${esc(p.location)}</small>` : ''}</div><div><small>Cost · margin</small><b>${fmt(p.cost)}</b><small>${p.margin}%</small></div><div><small>Sold 30d</small><b>${qty(p.stats.q30)}</b><small>${p.stats.cover != null ? p.stats.cover + ' days left' : ''}</small></div></div>
    ${p.batches.length ? `<div style="margin-top:14px">${p.batches.slice(0, 4).map(b => `<div class="list-i" style="padding:6px 0"><span class="mono">${esc(b.code)}</span><div class="m"><small>${b.expiry ? 'Expires ' + fd(b.expiry) : ''}</small></div><b>${qty(b.qty)}</b></div>`).join('')}</div>` : ''}
    <div class="f" style="flex-wrap:wrap;justify-content:stretch"><button class="btn" data-a="sell" style="flex:1">${icon('receipt')}Sell</button><button class="btn sec" data-a="adj" style="flex:1">${icon('sliders')}Adjust</button><button class="btn sec" data-a="label">${icon('printer')}</button><button class="btn sec" data-a="open">${icon('arrow')}Details</button></div>`, { wide: true });
  const A = {
    sell: async () => { close(); (await import('./docs.js')).newDoc('sale', { lines: [{ pid: p.id, qty: 1, price: p.price }] }); },
    adj: async () => { close(); (await import('./inventory.js')).adjustForm(p); },
    label: async () => { close(); (await import('./labels.js')).printLabels([p]); },
    open: () => { close(); go('/inventory/' + p.id); },
  };
  $$('[data-a]', el).forEach(b => b.onclick = A[b.dataset.a]);
}

// ---------- scan page ----------
route('/scan', async (v) => {
  v.innerHTML = `<div class="ph"><div class="t"><h1>Scan</h1><p>Point the camera at any barcode or QR label. USB and Bluetooth scanners work on every page too.</p></div></div>
  <div class="row c2e" style="align-items:start"><div class="card pad"><div class="scanbox" id="sb"></div><div id="sm" style="margin-top:10px"></div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><label class="btn sec">${icon('camera')}Scan from photo<input type="file" accept="image/*" capture="environment" hidden id="sf"></label><form id="mf" style="display:flex;gap:8px;flex:1;min-width:200px"><input id="mc" placeholder="Type barcode, SKU or batch" class="mono" data-scan="1"><button class="btn sec">Find</button></form></div></div>
    <div id="res"><div class="card">${empty('scan', 'Ready to scan', 'The product, its stock, price, batches and actions will appear here.')}</div></div></div>`;
  const show = async code => {
    const r = await fetch('/api/lookup/' + encodeURIComponent(code));
    if (!r.ok) { $('#res').innerHTML = `<div class="card">${empty('search', 'No product with this code', `<span class="mono">${esc(code)}</span>`, `<button class="btn" id="cr">${icon('plus')}Create product</button>`)}</div>`; $('#cr').onclick = async () => (await import('./inventory.js')).productForm(null, { barcode: code }); return; }
    const p = await r.json();
    $('#res').innerHTML = `<div class="card scanflash" style="overflow:hidden"><div class="prod-hero" style="grid-template-columns:auto 1fr"><div class="prod-img" style="width:96px;height:96px">${p.image ? `<img src="/api/products/${p.id}/image">` : icon('box')}</div><div><h2 style="font-size:22px">${esc(p.name)}</h2><div class="mono mut" style="font-size:12px">${esc(p.barcode)}</div><div class="meta">${p.cat ? badge(p.cat, 'plain') : ''}${p.matchedBatch ? badge('Batch ' + p.matchedBatch.code + (p.matchedBatch.expiry ? ' · exp ' + fd(p.matchedBatch.expiry) : ''), 'b-b') : ''}</div></div></div>
      <div class="stats"><div><small>Price</small><b>${fmt(p.price)}</b></div><div><small>In stock</small><b class="${p.qty <= 0 ? 'neg' : p.qty <= p.th ? 'warn' : 'pos'}">${qty(p.qty)} ${esc(p.unit)}</b></div><div><small>Cost</small><b>${fmt(p.cost)}</b></div><div><small>Sold 30d</small><b>${qty(p.stats.q30)}</b></div></div>
      <div style="padding:16px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-a="sell">${icon('receipt')}Sell</button><button class="btn sec" data-a="adj">${icon('sliders')}Adjust stock</button><button class="btn sec" data-a="label">${icon('printer')}Print label</button><a class="btn sec" href="#/inventory/${p.id}">${icon('arrow')}Full details</a></div></div>`;
    const A = { sell: async () => (await import('./docs.js')).newDoc('sale', { lines: [{ pid: p.id, qty: 1, price: p.price }] }), adj: async () => (await import('./inventory.js')).adjustForm(p), label: async () => (await import('./labels.js')).printLabels([p]) };
    $$('[data-a]', $('#res')).forEach(b => b.onclick = A[b.dataset.a]);
  };
  state.scanHandler = show;
  startCamera($('#sb'), show, { continuous: true }).then(stop => {
    const t = setInterval(() => { if (!$('#sb')) { clearInterval(t); stop(); } }, 500);
  }).catch(e => { $('#sb').style.display = 'none'; $('#sm').innerHTML = e.message === 'insecure' ? httpsHint() : `<div class="alert tone-a" style="margin:0">${icon('alert')}<div><b>Camera not available</b>${esc(e.message || e)}</div></div>`; });
  $('#sf').onchange = async ev => { try { show(await scanImage(ev.target.files[0])); } catch { toast('No barcode found in that photo', 'err'); } ev.target.value = ''; };
  $('#mf').onsubmit = e => { e.preventDefault(); const c = $('#mc').value.trim(); if (c) show(c); $('#mc').value = ''; };
});

// ---------- stocktake ----------
const KEY = 'cfo-stocktake';
route('/stocktake', async (v) => {
  const P = (await api('/products')).filter(p => !p.archived);
  let counts = {};
  try { counts = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { }
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(counts)); } catch { } };
  let q = '', only = false;
  v.innerHTML = `<div class="ph"><div class="t"><h1>Stocktake</h1><p>Count what is on the shelf. Scan each item (every scan adds 1) or type the count. Differences are posted as adjustments.</p></div>
    <div class="acts"><button class="btn sec" id="cam">${icon('camera')}Scan with camera</button><button class="btn sec" id="reset">${icon('refresh')}Start over</button><button class="btn" id="post">${icon('check')}Post differences</button></div></div>
    <div class="kpis" id="sk"></div>
    <div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Filter products"></div><label class="check" style="margin:0"><input type="checkbox" id="only"> Only counted</label></div><div id="list"></div>`;
  const stats = () => {
    const C = P.filter(p => counts[p.id] != null), diff = C.filter(p => counts[p.id] !== p.qty), val = C.reduce((t, p) => t + (counts[p.id] - p.qty) * p.cost, 0);
    $('#sk').innerHTML = `<div class="kpi"><div class="k">Counted</div><b>${C.length} / ${P.length}</b></div><div class="kpi"><div class="k">With differences</div><b class="${diff.length ? 'warn' : ''}">${diff.length}</b></div><div class="kpi"><div class="k">Value difference</div><b class="${val < 0 ? 'neg' : 'pos'}">${fmt(val, 0)}</b></div>`;
  };
  const draw = () => {
    const L = P.filter(p => (!q || [p.name, p.barcode, p.sku, p.location].join(' ').toLowerCase().includes(q)) && (!only || counts[p.id] != null));
    $('#list').innerHTML = `<div class="tw"><table><thead><tr><th>Product</th><th>Shelf</th><th class="n">Recorded</th><th style="width:140px">Counted</th><th class="n">Difference</th></tr></thead><tbody>${L.map(p => { const c = counts[p.id], d = c == null ? null : c - p.qty; return `<tr data-id="${p.id}"><td><div class="pcell">${thumb(p)}<div><b>${esc(p.name)}</b><span class="sub mono">${esc(p.barcode)}</span></div></div></td><td>${esc(p.location || '—')}</td><td class="n">${qty(p.qty)} ${esc(p.unit)}</td><td><input type="number" step="any" min="0" value="${c ?? ''}" placeholder="—" data-c="${p.id}" style="height:34px"></td><td class="n">${d == null ? '<span class="mut">—</span>' : `<b class="${d < 0 ? 'neg' : d > 0 ? 'pos' : 'mut'}">${d > 0 ? '+' : ''}${qty(d)}</b>`}</td></tr>`; }).join('')}</tbody></table></div>`;
    $$('[data-c]').forEach(i => i.onchange = () => { i.value === '' ? delete counts[i.dataset.c] : counts[i.dataset.c] = +i.value; saveLocal(); stats(); draw(); });
    stats();
  };
  const bump = code => { const p = P.find(x => x.barcode === code || (x.sku || '').toLowerCase() === code.toLowerCase()); if (!p) return toast('Unknown code ' + code, 'err'); counts[p.id] = (counts[p.id] || 0) + 1; saveLocal(); draw(); toast(`${p.name}: ${counts[p.id]}`); $(`tr[data-id="${p.id}"]`)?.scrollIntoView({ block: 'center' }); };
  state.scanHandler = bump;
  $('#q').oninput = debounce(e => { q = $('#q').value.toLowerCase(); draw(); });
  $('#only').onchange = e => { only = e.target.checked; draw(); };
  $('#cam').onclick = () => openScanner({ continuous: true, onCode: bump, title: 'Scan items to count' });
  $('#reset').onclick = async () => { if (await confirmBox('Clear all counts?', { danger: true, ok: 'Clear' })) { counts = {}; saveLocal(); draw(); } };
  $('#post').onclick = async () => {
    const L = Object.entries(counts).map(([pid, counted]) => ({ pid: +pid, counted })).filter(c => P.find(p => p.id === c.pid && p.qty !== c.counted));
    if (!L.length) return toast('No differences to post');
    if (!await confirmBox(`Post ${L.length} stock correction(s)? Stock will be set to your counts.`, { ok: 'Post' })) return;
    const r = await post('/stocktake', { counts: L });
    counts = {}; saveLocal();
    toast(`Posted. Value change ${fmt(r.value, 0)}`);
    go('/stocktake');
  };
  draw();
});
