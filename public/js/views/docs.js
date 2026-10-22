import { $, $$, api, post, route, state, icon, esc, fmt, qty, r2, fd, today, addDays, badge, empty, fld, inp, sel, drawer, confirmBox, toast, go, debounce, accountOpts, METHODS, waLink, printHTML, inWords, csv, download, refreshAccounts } from '../core.js';
import { scanOnce } from './scan.js';
import { paymentForm } from './money.js';

export const KIND = {
  sale: { t: 'Invoice', list: '/sales', party: 'c', pl: 'Customer', price: 'price' },
  quote: { t: 'Quotation', list: '/sales?tab=quote', party: 'c', pl: 'Customer', price: 'price' },
  return: { t: 'Credit note', list: '/sales?tab=return', party: 'c', pl: 'Customer', price: 'price' },
  purchase: { t: 'Purchase bill', list: '/purchases', party: 's', pl: 'Supplier', price: 'cost' },
  po: { t: 'Purchase order', list: '/purchases?tab=po', party: 's', pl: 'Supplier', price: 'cost' },
};

// ---------- lists ----------
function listPage(title, tabs) {
  return async (v, q) => {
    const tab = q.tab && tabs.some(t => t[0] === q.tab) ? q.tab : tabs[0][0];
    const F = { q: '', status: q.status || '', from: '', to: '' };
    v.innerHTML = `<div class="ph"><div class="t"><h1>${title}</h1><p id="sum">&nbsp;</p></div><div class="acts"><button class="btn sec" id="exp">${icon('download')}Export</button><button class="btn" id="new">${icon('plus')}New ${KIND[tab].t.toLowerCase()}</button></div></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Search number, name or amount"></div>
        <select id="st"><option value="">All statuses</option>${['Paid', 'Part-paid', 'Unpaid', 'Overdue', 'Open', 'Converted', 'Received', 'Expired', 'Issued', 'Cancelled'].map(s => `<option${s === F.status ? ' selected' : ''}>${s}</option>`).join('')}</select>
        <input type="date" id="f" style="width:auto" title="From"><input type="date" id="t" style="width:auto" title="To"></div><div id="list"></div>`;
    let L = [];
    const load = async () => {
      L = await api(`/docs?kind=${tab}&from=${F.from}&to=${F.to}&q=${encodeURIComponent(F.q)}&status=${F.status}`);
      const live = L.filter(d => d.status !== 'Cancelled'), tot = live.reduce((t, d) => t + d.total, 0), due = live.reduce((t, d) => t + d.bal, 0);
      $('#sum').innerHTML = `${live.length} ${KIND[tab].t.toLowerCase()}${live.length === 1 ? '' : 's'} · ${fmt(tot, 0)} total${['sale', 'purchase'].includes(tab) ? ` · <span class="${due > 0 ? 'warn' : ''}">${fmt(due, 0)} outstanding</span>` : ''}`;
      $('#list').innerHTML = L.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Number</th><th>${KIND[tab].pl}</th><th class="n">Total</th>${['sale', 'purchase'].includes(tab) ? '<th class="n">Balance</th><th>Due</th>' : ''}<th>Status</th></tr></thead><tbody>
        ${L.map(d => `<tr class="click" data-id="${d.id}"><td>${fd(d.date)}</td><td class="mono"><b>${esc(d.no)}</b></td><td>${esc(d.party)}</td><td class="n"><b>${fmt(d.total)}</b></td>${['sale', 'purchase'].includes(tab) ? `<td class="n ${d.bal > 0 ? 'warn' : 'mut'}">${d.status === 'Cancelled' ? '—' : fmt(d.bal)}</td><td>${d.due && d.bal > 0 ? `<span class="${d.due < today() ? 'neg' : ''}">${fd(d.due)}</span>` : '<span class="mut">—</span>'}</td>` : ''}<td>${badge(d.status)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="card">${empty(tab === 'purchase' || tab === 'po' ? 'truck' : 'receipt', `No ${KIND[tab].t.toLowerCase()}s yet`, F.q || F.status ? 'Nothing matches these filters.' : '', `<button class="btn" onclick="document.getElementById('new').click()">${icon('plus')}New ${KIND[tab].t.toLowerCase()}</button>`)}</div>`;
      $$('tr[data-id]').forEach(r => r.onclick = () => go('/doc/' + r.dataset.id));
    };
    $$('.tabs button', v).forEach(b => b.onclick = () => go(location.hash.slice(1).split('?')[0] + '?tab=' + b.dataset.t));
    $('#new').onclick = () => tab === 'return' ? pickInvoiceForReturn() : newDoc(tab);
    $('#q').oninput = debounce(() => { F.q = $('#q').value; load(); }, 200);
    $('#st').onchange = e => { F.status = e.target.value; load(); };
    $('#f').onchange = e => { F.from = e.target.value; load(); };
    $('#t').onchange = e => { F.to = e.target.value; load(); };
    $('#exp').onclick = () => download(`${tab}-${today()}.csv`, csv([['Date', 'Number', KIND[tab].pl, 'Taxable', 'GST', 'Total', 'Balance', 'Status'], ...L.map(d => [d.date, d.no, d.party, d.taxable, d.gst, d.total, d.bal, d.status])]));
    await load();
  };
}
route('/sales', listPage('Sales', [['sale', 'Invoices'], ['quote', 'Quotations'], ['return', 'Credit notes']]));
route('/purchases', listPage('Purchases', [['purchase', 'Purchase bills'], ['po', 'Purchase orders']]));

async function pickInvoiceForReturn() {
  const L = (await api('/docs?kind=sale')).filter(d => d.status !== 'Cancelled').slice(0, 300);
  drawer({
    title: 'Return goods: choose invoice', submit: 'Next',
    body: L.length ? fld('Invoice', `<input name="q" list="invl" placeholder="Type invoice no. or customer" required><datalist id="invl">${L.map(d => `<option value="${esc(d.no)}">${esc(d.party)} · ${fmt(d.total)} · ${fd(d.date)}</option>`).join('')}</datalist>`) : empty('receipt', 'No invoices to return against'),
    onSubmit: async d => { const inv = L.find(x => x.no.toLowerCase() === d.q.trim().toLowerCase()); if (!inv) throw new Error('Pick an invoice from the list.'); setTimeout(() => startReturn(inv.id)); },
  });
}
async function startReturn(id) {
  const d = await api('/docs/' + id);
  newDoc('return', { ref_doc: d.id, refNo: d.no, party_name: d.party, lines: d.lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price, gst_rate: l.gst_rate })) });
}

// ---------- create form ----------
const compute = (lines, disc, incl, roundOff) => {
  const sub = r2(lines.reduce((t, l) => t + l.qty * l.price, 0)); disc = Math.min(Math.max(+disc || 0, 0), sub);
  let taxable = 0, gst = 0;
  for (const l of lines) { const g = l.qty * l.price, n = g - (sub ? disc * g / sub : 0), r = +l.gst_rate || 0, t = incl ? n / (1 + r / 100) : n; taxable += t; gst += incl ? n - t : t * r / 100; }
  taxable = r2(taxable); gst = r2(gst);
  const raw = r2(taxable + gst), total = roundOff ? Math.round(raw) : raw;
  return { sub, disc, taxable, gst, roundoff: r2(total - raw), total: r2(total) };
};

export async function newDoc(kind, pre = {}) {
  const K = KIND[kind], biz = state.settings.business || {}, inv = state.settings.invoice || {};
  const [P, parties] = await Promise.all([api('/products'), api('/parties?kind=' + K.party)]);
  const byId = Object.fromEntries(P.map(p => [p.id, p]));
  const L = (pre.lines || []).map(l => ({ ...l, gst_rate: l.gst_rate ?? byId[l.pid]?.gst ?? 0 }));
  if (!L.length) L.push({ pid: '', qty: 1, price: '', gst_rate: '' });
  const party0 = pre.party_id ? parties.find(p => p.id == pre.party_id) : null;
  const pay = kind === 'sale' || kind === 'purchase';
  const isRet = kind === 'return';

  const { el, close } = drawer({
    title: (pre.from_doc ? 'Convert to ' : 'New ') + K.t.toLowerCase() + (isRet ? ` against ${pre.refNo}` : ''), wide: true, submit: `Save ${K.t.toLowerCase()}`,
    body: `<div class="grid3">
        ${isRet ? fld(K.pl, `<input value="${esc(pre.party_name)}" readonly>`) : fld(K.pl + (kind === 'sale' || kind === 'quote' ? ' <span class="mut">(empty = walk-in)</span>' : ''), `<input name="party_name" list="pl" value="${esc(party0?.name || pre.party_name || '')}" placeholder="Type a name" autocomplete="off" ${kind === 'purchase' || kind === 'po' ? 'required' : ''}><datalist id="pl">${parties.map(p => `<option value="${esc(p.name)}">${p.phone ? esc(p.phone) : ''}${p.balance ? ' · owes ' + fmt(p.balance, 0) : ''}</option>`).join('')}</datalist>`, '<span id="pinfo"></span>')}
        ${fld('Date', inp('date', today(), 'type="date"'))}
        ${isRet ? '' : fld(kind === 'quote' ? 'Valid until' : kind === 'po' ? 'Expected by' : 'Payment due', inp('due', pre.due || '', 'type="date"'), `<span class="chipsx">${[0, 7, 15, 30].map(n => `<a data-due="${n}" style="margin-right:8px">${n ? n + 'd' : 'Today'}</a>`).join('')}</span>`)}</div>
      <div style="display:flex;align-items:center;gap:10px;margin:4px 0 8px"><h3 style="flex:1">Items</h3><button type="button" class="btn sm sec" id="lscan">${icon('scan')}Scan to add</button></div>
      <div class="lines" id="lines"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm ghost" id="addl">${icon('plus')}Add line</button></div>
      <div class="grid2" style="margin-top:14px"><div>
        ${fld('Discount on bill (₹)', inp('disc', '0', 'type="number" step="any" min="0"'))}
        <label class="check"><input type="checkbox" name="incl" ${inv.pricesIncludeGst ? 'checked' : ''}> Prices include GST</label>
        <label class="check"><input type="checkbox" name="inter" id="inter"> Other-state ${K.pl.toLowerCase()} (IGST instead of CGST + SGST)</label>
        <label class="check"><input type="checkbox" name="roundOff" ${inv.roundOff !== false ? 'checked' : ''}> Round off total</label></div>
        <div class="sumbox" id="sum"></div></div>
      ${pay ? `<h3 style="margin:6px 0 12px">Payment ${kind === 'sale' ? 'received' : 'made'} now</h3><div class="grid3">${fld('Amount (₹)', `<div style="display:flex;gap:6px"><input name="paid" type="number" step="any" min="0" value="0"><button type="button" class="btn sec sm" id="full" style="height:40px">Full</button></div>`)}${fld('Method', sel('method', METHODS, kind === 'sale' ? 'cash' : 'bank'))}${fld('Into / from account', sel('account_id', [['', 'Automatic'], ...accountOpts()], ''))}</div>${fld('UPI / bank reference (optional)', inp('utr', '', 'placeholder="UTR or transaction ID"'))}` : ''}
      ${fld('Notes', inp('notes', '', 'placeholder="Shown on the document"'))}`,
    onSubmit: async (d, f) => {
      const lines = L.filter(l => l.pid).map(l => ({ pid: l.pid, qty: +l.qty, price: +l.price, gst_rate: l.gst_rate, batch: l.batch, expiry: l.expiry }));
      const body = { ...d, kind, lines, incl: !!d.incl, inter: !!d.inter, roundOff: !!d.roundOff, from_doc: pre.from_doc, ref_doc: pre.ref_doc, party_id: !d.party_name && party0 ? party0.id : undefined };
      const r = await post('/docs', body);
      toast(`${K.t} saved`);
      refreshAccounts();
      go('/doc/' + r.id);
    },
  });

  const lines = $('#lines', el);
  const total = () => {
    const live = L.filter(l => l.pid).map(l => ({ qty: +l.qty || 0, price: +l.price || 0, gst_rate: +l.gst_rate || 0 }));
    const t = compute(live, el.disc.value, el.incl.checked, el.roundOff.checked), inter = el.inter.checked;
    $('#sum', el).innerHTML = `<div><span>Subtotal</span><span>${fmt(t.sub)}</span></div>${t.disc ? `<div><span>Discount</span><span>−${fmt(t.disc)}</span></div>` : ''}<div><span>Taxable value</span><span>${fmt(t.taxable)}</span></div>${inter ? `<div><span>IGST</span><span>${fmt(t.gst)}</span></div>` : `<div><span>CGST</span><span>${fmt(t.gst / 2)}</span></div><div><span>SGST</span><span>${fmt(t.gst / 2)}</span></div>`}${t.roundoff ? `<div><span>Round off</span><span>${t.roundoff > 0 ? '+' : ''}${t.roundoff.toFixed(2)}</span></div>` : ''}<div class="big"><span>Total</span><span>${fmt(t.total)}</span></div>`;
    el.dataset.total = t.total;
  };
  const rowHTML = (l, i) => {
    const p = byId[l.pid], showBatch = (kind === 'purchase' && p?.track_batch);
    return `<div class="ln" data-i="${i}"><div class="picker"><input class="pn" value="${esc(p?.name || '')}" placeholder="Search or scan product…" autocomplete="off" data-skip><div class="dd" hidden></div>${p ? `<small class="mut" style="font-size:11.5px">${qty(p.qty)} ${esc(p.unit)} in stock${p.hsn ? ' · HSN ' + esc(p.hsn) : ''}</small>` : ''}</div>
      <input type="number" step="any" min="0" class="lq" value="${l.qty}" placeholder="Qty" data-skip><input type="number" step="any" min="0" class="lp" value="${l.price}" placeholder="${kind === 'purchase' || kind === 'po' ? 'Cost' : 'Price'}" data-skip>
      <select class="lg gst" data-skip>${[0, 0.25, 3, 5, 12, 18, 28].map(g => `<option value="${g}"${+l.gst_rate === g ? ' selected' : ''}>${g}%</option>`).join('')}</select>
      <button type="button" class="iconbtn lx" title="Remove">${icon('x')}</button>
      ${showBatch ? `<div class="extra"><input class="lb" placeholder="Batch no." value="${esc(l.batch || '')}" data-skip><input type="date" class="le" value="${esc(l.expiry || '')}" title="Expiry" data-skip></div>` : ''}</div>`;
  };
  const draw = (focus) => {
    lines.innerHTML = `<div class="ln h"><span>Product</span><span>Qty</span><span>${kind === 'purchase' || kind === 'po' ? 'Cost' : 'Price'}</span><span class="gst">GST</span><span></span></div>` + L.map(rowHTML).join('');
    $$('.ln[data-i]', lines).forEach(wire);
    total();
    const fx = focus != null && $(`.ln[data-i="${focus}"] ${focus === L.length - 1 && !L[focus].pid ? '.pn' : '.lq'}`, lines);
    if (fx) { fx.focus(); fx.select?.(); }
  };
  const choose = (i, p) => {
    const existing = L.findIndex((l, j) => j !== i && l.pid == p.id);
    if (existing >= 0 && !isRet) { L[existing].qty = (+L[existing].qty || 0) + 1; if (!L[i].pid) L.splice(i, 1); }
    else Object.assign(L[i], { pid: p.id, price: L[i].price && L[i].pid == p.id ? L[i].price : p[K.price] || p.price, gst_rate: p.gst || 0 });
    if (L[L.length - 1].pid) L.push({ pid: '', qty: 1, price: '', gst_rate: '' });
    draw(existing >= 0 ? existing : i);
  };
  function wire(row) {
    const i = +row.dataset.i, l = L[i], pn = $('.pn', row), dd = $('.dd', row);
    let hits = [], hi = 0;
    const show = () => {
      const q = pn.value.toLowerCase().trim();
      hits = P.filter(p => !p.archived && (!q || [p.name, p.sku, p.barcode, p.brand].join(' ').toLowerCase().includes(q))).slice(0, 8);
      dd.hidden = !hits.length;
      dd.innerHTML = hits.map((p, j) => `<div data-j="${j}" class="${j === hi ? 'on' : ''}"><span>${esc(p.name)}</span><small>${qty(p.qty)} ${esc(p.unit)} · ${fmt(p[K.price] || p.price)}</small></div>`).join('');
      $$('[data-j]', dd).forEach(x => x.onmousedown = e => { e.preventDefault(); choose(i, hits[x.dataset.j]); });
    };
    pn.onfocus = () => { hi = 0; show(); };
    pn.oninput = () => { hi = 0; const ex = P.find(p => p.barcode === pn.value.trim()); if (ex) return choose(i, ex); show(); };
    pn.onblur = () => setTimeout(() => { dd.hidden = true; if (l.pid) pn.value = byId[l.pid].name; }, 120);
    pn.onkeydown = e => {
      if (e.key === 'ArrowDown') { hi = Math.min(hits.length - 1, hi + 1); show(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); show(); e.preventDefault(); }
      if (e.key === 'Enter') { e.preventDefault(); if (hits[hi]) choose(i, hits[hi]); }
    };
    $('.lq', row).oninput = e => { l.qty = e.target.value; total(); };
    $('.lp', row).oninput = e => { l.price = e.target.value; total(); };
    $('.lg', row).onchange = e => { l.gst_rate = e.target.value; total(); };
    $('.lx', row).onclick = () => { L.splice(i, 1); if (!L.length) L.push({ pid: '', qty: 1, price: '', gst_rate: '' }); draw(); };
    $('.lb', row) && ($('.lb', row).oninput = e => l.batch = e.target.value);
    $('.le', row) && ($('.le', row).oninput = e => l.expiry = e.target.value);
  }
  const addCode = code => { const p = P.find(x => x.barcode === code || x.sku?.toLowerCase() === code.toLowerCase()); if (!p) return toast('No product with code ' + code, 'err'); const i = L.findIndex(l => !l.pid); choose(i >= 0 ? i : (L.push({ pid: '', qty: 1, price: '', gst_rate: '' }), L.length - 1), p); toast('Added ' + p.name); };
  const prevScan = state.scanHandler;
  state.scanHandler = addCode;
  new MutationObserver((m, o) => { if (!el.isConnected) { o.disconnect(); state.scanHandler = prevScan; } }).observe(document.body, { childList: true });

  $('#addl', el).onclick = () => { L.push({ pid: '', qty: 1, price: '', gst_rate: '' }); draw(L.length - 1); };
  $('#lscan', el).onclick = async () => { const c = await scanOnce('Scan a product to add it', { keepOpen: true, onCode: addCode }); };
  ['disc', 'incl', 'roundOff', 'inter'].forEach(n => el[n].addEventListener('input', total));
  $$('[data-due]', el).forEach(a => a.onclick = () => el.due.value = addDays(el.date.value || today(), +a.dataset.due));
  if (pay) $('#full', el).onclick = () => el.paid.value = el.dataset.total;
  const syncParty = () => {
    const p = parties.find(x => x.name.toLowerCase() === (el.party_name?.value || '').trim().toLowerCase());
    if (p && biz.state && p.state) el.inter.checked = p.state.toLowerCase() !== biz.state.toLowerCase();
    $('#pinfo', el) && ($('#pinfo', el).innerHTML = p ? `${p.gstin ? 'GSTIN ' + esc(p.gstin) + ' · ' : ''}${p.balance ? `<span class="warn">${K.party === 'c' ? 'owes you' : 'you owe'} ${fmt(p.balance, 0)}</span>` : 'no balance due'}${p.credit_limit ? ' · limit ' + fmt(p.credit_limit, 0) : ''}` : (el.party_name?.value ? 'New ' + K.pl.toLowerCase() + ' will be saved' : ''));
    total();
  };
  el.party_name && (el.party_name.oninput = syncParty);
  syncParty();
  draw();
}

// ---------- document page ----------
export function invoiceHTML(d) {
  const b = d.business || {}, p = d.partyInfo || {}, K = KIND[d.kind], bank = state.accounts.find(a => a.type === 'bank' && a.is_default && !a.archived) || state.accounts.find(a => a.type === 'bank' && !a.archived);
  const title = d.kind === 'sale' ? (b.gstin ? 'Tax Invoice' : 'Invoice') : d.kind === 'return' ? 'Credit Note' : K.t;
  const cg = l => d.inter ? '' : `<td class="r">${fmt(l.tax / 2)}</td><td class="r">${fmt(l.tax / 2)}</td>`;
  return `<div class="inv"><div class="top"><div>${b.logo ? `<img src="${esc(b.logo)}" style="max-height:56px;margin-bottom:6px">` : ''}<h1>${esc(b.name || 'Your Business')}</h1><div>${esc(b.address || '').replace(/\n/g, '<br>')}</div><div>${b.phone ? 'Ph: ' + esc(b.phone) : ''}${b.email ? ' · ' + esc(b.email) : ''}</div>${b.gstin ? `<div><b>GSTIN:</b> ${esc(b.gstin)}${b.state ? ' · State: ' + esc(b.state) : ''}</div>` : ''}</div>
    <div class="r"><h1 style="color:#111;font-size:20px;text-transform:uppercase;letter-spacing:.04em">${title}</h1><div><b>${esc(d.no)}</b></div><div>Date: ${fd(d.date)}</div>${d.due ? `<div>${d.kind === 'quote' ? 'Valid till' : 'Due'}: ${fd(d.due)}</div>` : ''}${d.refDoc ? `<div>Against: ${esc(d.refDoc.no)}</div>` : ''}</div></div>
    <div class="grid"><div><div style="color:#666;font-size:11px;text-transform:uppercase;font-weight:700">${K.party === 'c' ? 'Bill to' : 'Supplier'}</div><b style="font-size:14px">${esc(d.party)}</b>${p.address ? '<div>' + esc(p.address) + '</div>' : ''}${p.phone ? '<div>Ph: ' + esc(p.phone) + '</div>' : ''}${p.gstin ? '<div>GSTIN: ' + esc(p.gstin) + '</div>' : ''}</div>
      <div class="r">${p.state || b.state ? `<div>Place of supply: <b>${esc(p.state || b.state)}</b></div>` : ''}<div>${d.inter ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</div></div></div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable</th><th class="r">GST</th>${d.inter ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}<th class="r">Amount</th></tr></thead><tbody>
    ${d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.batch ? `<div style="color:#666;font-size:11px">Batch ${esc(l.batch)}${l.expiry ? ' · Exp ' + fd(l.expiry) : ''}</div>` : ''}</td><td>${esc(l.hsn || '')}</td><td class="r">${qty(l.qty)} ${esc(l.unit || '')}</td><td class="r">${fmt(l.price)}</td><td class="r">${fmt(l.taxable)}</td><td class="r">${l.gst_rate}%</td>${d.inter ? `<td class="r">${fmt(l.tax)}</td>` : cg(l)}<td class="r">${fmt(l.taxable + l.tax)}</td></tr>`).join('')}</tbody></table>
    <div class="grid"><div>${d.kind === 'sale' && d.upi && d.bal > 0 ? `<div style="display:flex;gap:10px;align-items:center;border:1px solid #cfd4dc;border-radius:8px;padding:8px;width:max-content"><img src="/api/code.svg?type=qr&text=${encodeURIComponent(d.upi)}" style="width:96px;height:96px"><div><b>Scan to pay ${fmt(d.bal)}</b><div style="color:#666">Any UPI app</div><div>${esc(state.settings.upi?.vpa || '')}</div></div></div>` : ''}
      ${bank && d.kind === 'sale' ? `<div style="margin-top:8px"><b>Bank:</b> ${esc(bank.bank || bank.name)}${bank.acno ? ' · A/c ' + esc(bank.acno) : ''}${bank.ifsc ? ' · IFSC ' + esc(bank.ifsc) : ''}</div>` : ''}
      <div style="margin-top:8px"><b>Amount in words:</b> ${inWords(d.total)}</div>${d.notes ? `<div style="margin-top:6px"><b>Notes:</b> ${esc(d.notes)}</div>` : ''}</div>
      <table class="tot"><tr><td>Taxable value</td><td class="r">${fmt(d.taxable)}</td></tr>${d.disc ? `<tr><td>Discount (included)</td><td class="r">${fmt(d.disc)}</td></tr>` : ''}${d.inter ? `<tr><td>IGST</td><td class="r">${fmt(d.gst)}</td></tr>` : `<tr><td>CGST</td><td class="r">${fmt(d.gst / 2)}</td></tr><tr><td>SGST</td><td class="r">${fmt(d.gst / 2)}</td></tr>`}${d.roundoff ? `<tr><td>Round off</td><td class="r">${d.roundoff.toFixed(2)}</td></tr>` : ''}<tr class="g"><td>Total</td><td class="r">${fmt(d.total)}</td></tr>${d.kind === 'sale' && d.total !== d.bal ? `<tr><td>Paid / credited</td><td class="r">${fmt(d.total - d.bal)}</td></tr><tr><td><b>Balance due</b></td><td class="r"><b>${fmt(d.bal)}</b></td></tr>` : ''}</table></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:24px;gap:20px"><div style="color:#555;font-size:11px;max-width:60%">${esc(d.invoice?.terms || '')}<br>${esc(d.invoice?.footer || '')}</div><div class="r"><div style="height:44px"></div><div style="border-top:1px solid #999;padding-top:4px">For ${esc(b.name || '')}<br>Authorised signatory</div></div></div></div>`;
}

route('/doc/:id', async (v, id) => {
  const d = await api('/docs/' + id), K = KIND[d.kind], live = d.status !== 'Cancelled';
  const phone = d.partyInfo?.phone, biz = state.settings.business?.name || 'us';
  const waText = d.kind === 'sale'
    ? `Hello ${d.party},\nYour invoice ${d.no} from ${biz} is for ${fmt(d.total)}${d.bal > 0 && d.bal < d.total ? `, balance due ${fmt(d.bal)}` : ''}${d.due ? `, due on ${fd(d.due)}` : ''}.${d.bal > 0 && d.upi ? `\nPay by UPI: ${state.settings.upi?.vpa} (ref ${d.no})` : ''}${d.paylink ? `\nPay online: ${JSON.parse(d.paylink).url}` : ''}\nThank you!`
    : `${K.t} ${d.no} from ${biz}: ${d.lines.map(l => `${l.name} x ${qty(l.qty)}`).join(', ')}. Total ${fmt(d.total)}.`;
  const pl = d.paylink ? JSON.parse(d.paylink) : null;
  v.innerHTML = `<div class="ph" style="margin-bottom:12px"><a class="btn ghost sm" href="#${K.list}">${icon('back')}${d.kind === 'purchase' || d.kind === 'po' ? 'Purchases' : 'Sales'}</a></div>
  <div class="ph"><div class="t"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h1>${K.t} ${esc(d.no)}</h1>${badge(d.status)}</div><p>${esc(d.party)} · ${fd(d.date)}${d.created_by ? ' · by ' + esc(d.created_by) : ''}${d.convertedTo ? ` · converted to <a href="#/doc/${d.convertedTo.id}">${esc(d.convertedTo.no)}</a>` : ''}${d.refDoc ? ` · against <a href="#/doc/${d.refDoc.id}">${esc(d.refDoc.no)}</a>` : ''}</p></div>
    <div class="acts"><button class="btn sec" id="prt">${icon('printer')}Print / PDF</button>${live ? `<a class="btn sec" target="_blank" rel="noopener" href="${waLink(phone, waText)}">${icon('msg')}WhatsApp</a>` : ''}${live && d.bal > 0 && (d.kind === 'sale' || d.kind === 'purchase') ? `<button class="btn" id="pay">${icon('rupee')}Record payment</button>` : ''}</div></div>
  <div class="row c2" style="align-items:start">
    <div class="card" style="padding:18px;overflow:auto;background:#fff;color:#111">${invoiceHTML(d)}</div>
    <div style="display:grid;gap:18px">
      <div class="card pad"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="mut">Total</span><b style="font-size:26px;letter-spacing:-.02em">${fmt(d.total)}</b></div>
        ${d.kind === 'sale' || d.kind === 'purchase' ? `<div class="bar" style="margin:12px 0 8px;height:8px"><i style="width:${d.total ? Math.min(100, (d.total - d.bal) / d.total * 100) : 0}%"></i></div><div style="display:flex;justify-content:space-between"><span class="mut">${d.kind === 'sale' ? 'Received' : 'Paid'} ${fmt(d.total - d.bal)}</span><b class="${d.bal > 0 ? 'warn' : 'pos'}">${d.bal > 0 ? fmt(d.bal) + ' due' : 'Settled'}</b></div>` : ''}
        <div style="display:grid;gap:8px;margin-top:16px">
          ${live && d.kind === 'quote' && !d.convertedTo ? `<button class="btn" data-a="convert">${icon('arrow')}Convert to invoice</button>` : ''}
          ${live && d.kind === 'po' && !d.convertedTo ? `<button class="btn" data-a="convert">${icon('download')}Receive goods (create bill)</button>` : ''}
          ${live && d.kind === 'sale' ? `<button class="btn sec" data-a="return">${icon('undo')}Return goods (credit note)</button>` : ''}
          ${live && d.kind === 'sale' && d.bal > 0 ? `<button class="btn sec" data-a="paylink">${icon('link')}${pl ? 'Check online payment' : 'Create payment link (Razorpay)'}</button>${pl ? `<a class="mut" href="${esc(pl.url)}" target="_blank" rel="noopener" style="font-size:12.5px;word-break:break-all">${esc(pl.url)}</a>` : ''}` : ''}
          <button class="btn sec" data-a="dup">${icon('copy')}Duplicate</button>
          ${live ? `<button class="btn danger" data-a="cancel">${icon('x')}Cancel ${K.t.toLowerCase()}</button>` : ''}
        </div></div>
      ${d.kind === 'sale' && d.upi && d.bal > 0 ? `<div class="card pad" style="text-align:center"><h3>Collect by UPI</h3><p class="mut" style="margin:4px 0 12px">Customer scans with GPay, PhonePe, Paytm or any bank app. Amount ${fmt(d.bal)} is filled in.</p><img src="/api/code.svg?type=qr&text=${encodeURIComponent(d.upi)}" style="width:200px;height:200px;background:#fff;padding:10px;border-radius:12px;border:1px solid var(--line)"><p class="mono mut" style="margin:10px 0 0">${esc(state.settings.upi?.vpa)}</p><p class="mut" style="font-size:12.5px">When the money shows in your bank statement, it is matched to ${esc(d.no)} automatically.</p></div>` : d.kind === 'sale' && d.bal > 0 && !state.settings.upi?.vpa ? `<div class="alert tone-i">${icon('qr')}<div><b>Add your UPI ID</b>Show a pay-by-UPI QR on every invoice. <a href="#/banking">Set it up</a></div></div>` : ''}
      ${d.payments.length ? `<div class="card"><div class="card-h"><h3>Payments</h3></div><div class="card-b">${d.payments.map(y => `<div class="list-i"><div class="m"><b>${fmt(y.amt)} ${y.x ? badge('Cancelled', '') : ''}</b><small>${fd(y.date)} · ${esc(y.method)} · ${esc(y.account || '')}${y.utr ? ' · ' + esc(y.utr) : ''}${y.note ? ' · ' + esc(y.note) : ''}</small></div>${!y.x ? `<button class="btn sm ghost" data-unpay="${y.id}" title="Cancel payment">${icon('x')}</button>` : ''}</div>`).join('')}</div></div>` : ''}
      ${d.credits.length ? `<div class="card"><div class="card-h"><h3>Credit notes</h3></div><div class="card-b">${d.credits.map(c => `<a class="list-i" href="#/doc/${c.id}"><div class="m"><b>${esc(c.no)}</b><small>${fd(c.date)}</small></div><b>${fmt(c.total)}</b>${c.x ? badge('Cancelled') : ''}</a>`).join('')}</div></div>` : ''}
    </div></div>`;
  $('#prt').onclick = () => printHTML(invoiceHTML(d));
  $('#pay') && ($('#pay').onclick = () => paymentForm(d.kind === 'sale' ? 'in' : 'out', { ref_type: 'doc', id: d.id }));
  const A = {
    convert: () => newDoc(d.kind === 'quote' ? 'sale' : 'purchase', { from_doc: d.id, party_id: d.party_id, lines: d.lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price, gst_rate: l.gst_rate })) }),
    return: () => startReturn(d.id),
    dup: () => newDoc(d.kind === 'return' ? 'sale' : d.kind, { party_id: d.party_id, lines: d.lines.map(l => ({ pid: l.pid, qty: l.qty, price: l.price, gst_rate: l.gst_rate })) }),
    cancel: async () => { if (!await confirmBox(`Cancel ${d.no}? Stock and payments will be reversed. It stays in history as cancelled.`, { ok: 'Cancel it', danger: true })) return; await post(`/docs/${d.id}/cancel`); toast('Cancelled'); refreshAccounts(); go('/doc/' + d.id); },
    paylink: async () => {
      if (pl) { const r = await post(`/docs/${d.id}/paylink/check`); toast(r.recorded ? 'Payment received and recorded' : 'Link status: ' + r.status); return go('/doc/' + d.id); }
      const r = await post(`/docs/${d.id}/paylink`); toast('Payment link created'); navigator.clipboard?.writeText(r.url).catch(() => { }); go('/doc/' + d.id);
    },
  };
  $$('[data-a]', v).forEach(b => b.onclick = async () => { try { await A[b.dataset.a](); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-unpay]', v).forEach(b => b.onclick = async () => { if (!await confirmBox('Cancel this payment?', { danger: true, ok: 'Cancel payment' })) return; await post(`/payments/${b.dataset.unpay}/cancel`); toast('Payment cancelled'); refreshAccounts(); go('/doc/' + d.id); });
});
