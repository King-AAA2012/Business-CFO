import { $, $$, api, post, route, state, icon, esc, fmt, qty, r2, thumb, empty, dialog, toast, go, printHTML, refreshAccounts, fd } from '../core.js';
import { openScanner } from './scan.js';

const cart = [];
let cust = '', disc = 0, catF = '';

const totals = () => {
  const incl = state.settings.invoice?.pricesIncludeGst;
  const sub = r2(cart.reduce((t, l) => t + l.qty * l.price, 0)), d = Math.min(disc, sub);
  let taxable = 0, gst = 0;
  for (const l of cart) { const g = l.qty * l.price, n = g - (sub ? d * g / sub : 0), t = incl ? n / (1 + l.gst / 100) : n; taxable += t; gst += incl ? n - t : t * l.gst / 100; }
  const raw = r2(taxable + gst), total = state.settings.invoice?.roundOff !== false ? Math.round(raw) : raw;
  return { sub, d, taxable: r2(taxable), gst: r2(gst), total };
};

route('/pos', async (v) => {
  let P = await api('/products');
  P = P.filter(p => !p.archived);
  const cats = [...new Set(P.map(p => p.cat).filter(Boolean))].sort();
  v.innerHTML = `<div class="ph" style="margin-bottom:12px"><div class="t"><h1>Quick bill</h1><p>Scan with a USB scanner or camera, or tap products. Press <span class="kbd">F2</span> to pay.</p></div></div>
  <div class="pos-grid"><div>
    <div class="toolbar"><div class="inwrap" style="max-width:none">${icon('search')}<input id="ps" placeholder="Search or scan barcode…" data-scan="1" autocomplete="off"></div><button class="btn sec" id="cam">${icon('camera')}Camera</button></div>
    ${cats.length ? `<div class="chips" id="cats"><button class="chip" data-c="" style="${!catF ? 'border-color:var(--brand);color:var(--brand)' : ''}">All</button>${cats.map(c => `<button class="chip" data-c="${esc(c)}" style="${catF === c ? 'border-color:var(--brand);color:var(--brand)' : ''}">${esc(c)}</button>`).join('')}</div>` : ''}
    <div class="tiles" id="tiles"></div></div>
    <div class="card cart" id="cart"></div></div>`;

  const tiles = () => {
    const q = $('#ps').value.toLowerCase().trim();
    const L = P.filter(p => (!catF || p.cat === catF) && (!q || [p.name, p.sku, p.barcode, p.brand].join(' ').toLowerCase().includes(q))).slice(0, 60);
    $('#tiles').innerHTML = L.length ? L.map(p => `<button class="tile" data-id="${p.id}">${thumb(p)}<b>${esc(p.name)}</b><div class="p"><span class="${p.qty <= 0 ? 'neg' : p.low ? 'warn' : 'mut'}">${qty(p.qty)} ${esc(p.unit)}</span><b>${fmt(p.price)}</b></div></button>`).join('') : `<div style="grid-column:1/-1">${empty('box', P.length ? 'No match' : 'No products yet', P.length ? '' : '<a href="#/inventory">Add products</a> to start billing.')}</div>`;
    $$('.tile', $('#tiles')).forEach(t => t.onclick = () => add(P.find(p => p.id == t.dataset.id)));
  };
  const add = (p, n = 1) => {
    if (!p) return;
    const l = cart.find(x => x.pid === p.id);
    if (l) l.qty = r2(l.qty + n); else cart.push({ pid: p.id, name: p.name, unit: p.unit, qty: n, price: p.price, gst: p.gst || 0, stock: p.qty });
    drawCart(p.id);
  };
  const drawCart = (flash) => {
    const t = totals();
    $('#cart').innerHTML = `<div class="card-h" style="padding-bottom:10px"><h3>${icon('cart')} Cart</h3>${cart.length ? `<button class="btn sm ghost" id="clr">Clear</button>` : ''}</div>
      <div style="padding:0 18px 10px"><input id="cust" placeholder="Customer name or phone (optional)" value="${esc(cust)}" list="custs"><datalist id="custs"></datalist></div>
      <div class="cart-l">${cart.length ? cart.map((l, i) => `<div class="ci ${l.pid === flash ? 'scanflash' : ''}" data-i="${i}"><div><b>${esc(l.name)}</b><div class="mut" style="font-size:12px">${l.qty > l.stock ? '<span class="neg">only ' + qty(l.stock) + ' in stock</span> · ' : ''}GST ${l.gst}%</div></div><b class="num">${fmt(l.qty * l.price)}</b>
        <div class="q"><button data-d="-1">−</button><input value="${l.qty}" inputmode="decimal" class="qi"><button data-d="1">+</button><span class="mut" style="font-size:12px;margin-left:4px">${esc(l.unit)}</span></div><div style="display:flex;gap:4px;align-items:center;justify-content:flex-end"><span class="mut" style="font-size:12px">@</span><input class="pr pi" value="${l.price}" inputmode="decimal"></div></div>`).join('') : `<div class="empty" style="padding:30px 0">${icon('scan')}<p style="margin-top:8px">Scan or tap a product</p></div>`}</div>
      <div class="totals"><div><span>Items</span><span>${cart.reduce((a, l) => a + l.qty, 0)}</span></div><div><span>Discount ₹</span><input id="disc" value="${disc || ''}" placeholder="0" inputmode="decimal" style="width:90px;height:28px;text-align:right;padding:0 8px;border-radius:8px"></div><div><span>Taxable</span><span>${fmt(t.taxable)}</span></div><div><span>GST</span><span>${fmt(t.gst)}</span></div><div class="big"><span>Total</span><span>${fmt(t.total)}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px"><button class="btn lg" data-pay="cash" ${!cart.length ? 'disabled' : ''}>${icon('wallet')}Cash</button><button class="btn lg" data-pay="upi" ${!cart.length ? 'disabled' : ''} style="--b:var(--accent);background:var(--accent)">${icon('qr')}UPI</button><button class="btn lg sec" data-pay="credit" ${!cart.length ? 'disabled' : ''}>Credit</button></div><button class="btn sec block" data-pay="card" style="margin-top:8px" ${!cart.length ? 'disabled' : ''}>Card</button></div>`;
    $$('.ci').forEach(row => {
      const l = cart[row.dataset.i];
      $$('[data-d]', row).forEach(b => b.onclick = () => { l.qty = r2(l.qty + +b.dataset.d); if (l.qty <= 0) cart.splice(row.dataset.i, 1); drawCart(); });
      $('.qi', row).onchange = e => { l.qty = +e.target.value || 0; if (l.qty <= 0) cart.splice(row.dataset.i, 1); drawCart(); };
      $('.pi', row).onchange = e => { l.price = +e.target.value || 0; drawCart(); };
    });
    $('#clr') && ($('#clr').onclick = () => { cart.length = 0; disc = 0; cust = ''; drawCart(); });
    $('#cust').oninput = e => cust = e.target.value;
    $('#disc').onchange = e => { disc = +e.target.value || 0; drawCart(); };
    $$('[data-pay]').forEach(b => b.onclick = () => checkout(b.dataset.pay));
    api('/parties?kind=c').then(L => { const dl = $('#custs'); if (dl) dl.innerHTML = L.map(c => `<option value="${esc(c.name)}">${esc(c.phone || '')}</option>`).join(''); });
  };
  const byCode = code => P.find(p => p.barcode === code || (p.sku || '').toLowerCase() === code.toLowerCase());
  state.scanHandler = code => { const p = byCode(code); if (!p) return toast('No product with code ' + code, 'err'); add(p); $('#ps').value = ''; tiles(); };
  $('#ps').oninput = tiles;
  $('#ps').onkeydown = e => { if (e.key === 'Enter') { const q = $('#ps').value.trim(), p = byCode(q) || P.find(x => x.name.toLowerCase().includes(q.toLowerCase())); if (p && q) { add(p); $('#ps').value = ''; tiles(); } } };
  $('#cam').onclick = () => openScanner({ continuous: true, onCode: state.scanHandler, title: 'Scan items into the cart' });
  $$('#cats .chip').forEach(c => c.onclick = () => { catF = c.dataset.c; $$('#cats .chip').forEach(x => x.style.cssText = x === c ? 'border-color:var(--brand);color:var(--brand)' : ''); tiles(); });
  tiles(); drawCart(); $('#ps').focus();

  async function checkout(mode) {
    const t = totals();
    if (mode === 'credit' && !cust.trim()) return toast('Enter the customer name for a credit sale', 'err');
    if (mode === 'upi') {
      const u = state.settings.upi || {};
      if (!u.vpa) return toast('Add your UPI ID under Bank & UPI first', 'err');
      const link = `upi://pay?${new URLSearchParams({ pa: u.vpa, pn: u.payee || state.settings.business?.name || 'Shop', am: t.total.toFixed(2), cu: 'INR', tn: 'Bill ' + (state.settings.business?.name || '') }).toString().replace(/\+/g, '%20')}`;
      const ok = await new Promise(res => {
        const { el, close } = dialog(`<div style="text-align:center"><h2>Scan to pay ${fmt(t.total)}</h2><p class="mut" style="margin:6px 0 14px">Ask the customer to scan with any UPI app.</p><img src="/api/code.svg?type=qr&text=${encodeURIComponent(link)}" style="width:240px;height:240px;background:#fff;padding:12px;border-radius:14px"><p class="mono mut">${esc(u.vpa)}</p><input id="utr" placeholder="UPI ref / UTR (optional)" style="margin:6px 0 12px"><div class="f" style="justify-content:center"><button class="btn sec" data-x>Cancel</button><button class="btn" id="got">${icon('check')}Payment received</button></div></div>`);
        $('#got', el).onclick = () => { const u = $('#utr', el).value; close(); res({ utr: u }); };
        new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); res(null); } }).observe(document.body, { childList: true });
      });
      if (!ok) return;
      return save('upi', t.total, ok.utr);
    }
    if (mode === 'cash') {
      const r = await new Promise(res => {
        const { el, close } = dialog(`<h2>Cash ${fmt(t.total)}</h2><label class="fld" style="margin-top:14px"><span>Cash received</span><input id="tend" type="number" step="any" value="${t.total}" style="font-size:20px;height:50px"></label><div id="chg" class="mut"></div><div class="f"><button class="btn sec" data-x>Cancel</button><button class="btn" id="ok">${icon('check')}Done</button></div>`);
        const inp = $('#tend', el), upd = () => { const c = (+inp.value || 0) - t.total; $('#chg', el).innerHTML = c >= 0 ? `Return change: <b style="font-size:20px;color:var(--brand)">${fmt(c)}</b>` : `<span class="neg">Short by ${fmt(-c)}</span>`; };
        inp.oninput = upd; upd(); inp.select();
        inp.onkeydown = e => e.key === 'Enter' && $('#ok', el).click();
        $('#ok', el).onclick = () => { close(); res(true); };
        new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); res(false); } }).observe(document.body, { childList: true });
      });
      if (!r) return;
      return save('cash', t.total);
    }
    return save(mode === 'card' ? 'card' : 'cash', mode === 'credit' ? 0 : t.total);
  }
  async function save(method, paid, utr = '', force = 0) {
    try {
      const r = await post('/docs', { kind: 'sale', party_name: cust.trim(), lines: cart.map(l => ({ pid: l.pid, qty: l.qty, price: l.price, gst_rate: l.gst })), disc, paid, method, utr, force });
      const d = await api('/docs/' + r.id);
      cart.length = 0; disc = 0; cust = '';
      refreshAccounts();
      P = (await api('/products')).filter(p => !p.archived);
      tiles(); drawCart();
      const { el, close } = dialog(`<div style="text-align:center"><div class="empty" style="padding:6px 0 0"><div class="ic tone-g">${icon('check')}</div><b>Sale saved: ${esc(d.no)}</b><p>${fmt(d.total)} · ${paid ? 'paid by ' + method : 'on credit'}</p></div><div class="f" style="justify-content:center;flex-wrap:wrap"><button class="btn sec" id="rcpt">${icon('printer')}Receipt</button><button class="btn sec" id="a4">${icon('file')}A4 invoice</button><button class="btn" data-x>New bill</button></div></div>`);
      $('#rcpt', el).onclick = () => printHTML(receipt(d), 'size:80mm auto;margin:3mm');
      $('#a4', el).onclick = () => { close(); go('/doc/' + d.id); };
    } catch (e) {
      if (e.confirm && confirm(e.message + '\n\nSave anyway?')) return save(method, paid, utr, 1);
      toast(e.message, 'err');
    }
  }
});

addEventListener('keydown', e => { if (e.key === 'F2' && location.hash.startsWith('#/pos')) { e.preventDefault(); $('[data-pay="cash"]')?.click(); } });

function receipt(d) {
  const b = d.business || {};
  return `<div style="font:12px/1.35 'Courier New',monospace;width:72mm;color:#000"><div style="text-align:center"><b style="font-size:15px">${esc(b.name || '')}</b><br>${esc(b.address || '').replace(/\n/g, '<br>')}${b.phone ? '<br>Ph ' + esc(b.phone) : ''}${b.gstin ? '<br>GSTIN ' + esc(b.gstin) : ''}</div><hr style="border:0;border-top:1px dashed #000">
  ${esc(d.no)}  ${fd(d.date)}<br>${esc(d.party)}<hr style="border:0;border-top:1px dashed #000">
  ${d.lines.map(l => `<div>${esc(l.name)}</div><div style="display:flex;justify-content:space-between"><span>${qty(l.qty)} x ${l.price.toFixed(2)}</span><span>${(l.taxable + l.tax).toFixed(2)}</span></div>`).join('')}
  <hr style="border:0;border-top:1px dashed #000"><div style="display:flex;justify-content:space-between"><span>Taxable</span><span>${d.taxable.toFixed(2)}</span></div><div style="display:flex;justify-content:space-between"><span>GST</span><span>${d.gst.toFixed(2)}</span></div>${d.roundoff ? `<div style="display:flex;justify-content:space-between"><span>Round off</span><span>${d.roundoff.toFixed(2)}</span></div>` : ''}<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:bold"><span>TOTAL</span><span>₹${d.total.toFixed(2)}</span></div>
  <hr style="border:0;border-top:1px dashed #000"><div style="text-align:center">${esc(d.invoice?.footer || 'Thank you!')}</div></div>`;
}
