import { $, $$, api, post, put, route, state, icon, esc, fmt, qty, fd, ago, today, badge, empty, fld, inp, sel, thumb, drawer, confirmBox, toast, go, debounce, csv, download, parseCSV, readFile, shrinkImage, owner } from '../core.js';
import { scanOnce } from './scan.js';
import { newDoc } from './docs.js';
import { printLabels } from './labels.js';

const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'box', 'packet', 'bag', 'dozen', 'metre', 'pair', 'set', 'bottle', 'strip'];
const GST = [0, 0.25, 3, 5, 12, 18, 28];
const F = { q: '', cat: '', st: '', view: 'table' };
try { F.view = localStorage.getItem('cfo-inv-view') || 'table'; } catch { }
let sel_ = new Set();

route('/inventory', async (v) => {
  const [P, cats] = await Promise.all([api('/products' + (F.st === 'archived' ? '?all=1' : '')), api('/categories')]);
  const totals = { n: P.filter(p => !p.archived).length, value: P.reduce((t, p) => t + (p.archived ? 0 : p.value), 0), low: P.filter(p => !p.archived && p.low).length, out: P.filter(p => !p.archived && p.qty <= 0).length };
  v.innerHTML = `<div class="ph"><div class="t"><h1>Inventory</h1><p>${totals.n} products · ${fmt(totals.value, 0)} at cost · <span class="${totals.low ? 'warn' : ''}">${totals.low} low</span> · <span class="${totals.out ? 'neg' : ''}">${totals.out} out of stock</span></p></div>
    <div class="acts"><button class="btn sec" id="imp">${icon('upload')}Import</button><button class="btn sec" id="exp">${icon('download')}Export</button><button class="btn sec" id="scanadd">${icon('scan')}Scan to add</button><button class="btn" id="add">${icon('plus')}Add product</button></div></div>
    <div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Search name, SKU, barcode, brand…" value="${esc(F.q)}"></div>
      <select id="cat"><option value="">All categories</option>${cats.map(c => `<option${c === F.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <div class="seg" id="st">${[['', 'All'], ['low', 'Low'], ['out', 'Out'], ['exp', 'Expiring'], ['archived', 'Archived']].map(([k, l]) => `<button data-k="${k}" class="${F.st === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div style="flex:1"></div><div class="seg" id="vw"><button data-k="table" class="${F.view === 'table' ? 'on' : ''}" title="Table">${icon('menu')}</button><button data-k="grid" class="${F.view === 'grid' ? 'on' : ''}" title="Grid">${icon('grid')}</button></div></div>
    <div id="bulk" class="card pad" style="display:none;margin-bottom:12px;padding:10px 14px;align-items:center;gap:10px;flex-wrap:wrap"></div>
    <div id="list"></div>`;
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const filtered = () => {
    const q = F.q.toLowerCase();
    return P.filter(p => (F.st === 'archived' ? p.archived : !p.archived) && (!F.cat || p.cat === F.cat) && (!q || [p.name, p.sku, p.barcode, p.brand, p.cat].join(' ').toLowerCase().includes(q))
      && (F.st !== 'low' || p.low) && (F.st !== 'out' || p.qty <= 0) && (F.st !== 'exp' || (p.expiry && p.expiry <= soon)));
  };
  const draw = () => {
    const L = filtered();
    if (!L.length) { $('#list').innerHTML = `<div class="card">${P.length ? empty('search', 'No matching products', 'Try a different search or filter.') : empty('box', 'No products yet', 'Add your first product, scan an existing barcode, or import a spreadsheet.', `<button class="btn" onclick="document.getElementById('add').click()">${icon('plus')}Add product</button>`)}</div>`; return bulk(); }
    if (F.view === 'grid') {
      $('#list').innerHTML = `<div class="tiles" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${L.map(p => `<a class="tile" href="#/inventory/${p.id}" style="text-decoration:none">${thumb(p, 'pthumb')}<b>${esc(p.name)}</b><small class="mut">${esc(p.cat || p.sku)}</small><div class="p"><span class="${p.qty <= 0 ? 'neg' : p.low ? 'warn' : ''}">${qty(p.qty)} ${esc(p.unit)}</span><b>${fmt(p.price)}</b></div></a>`).join('')}</div>`;
    } else {
      $('#list').innerHTML = `<div class="tw"><table><thead><tr><th style="width:36px"><input type="checkbox" id="all"></th><th>Product</th><th>Category</th><th>In stock</th><th class="n">Cost</th><th class="n">Price</th><th class="n">Margin</th><th class="n">Stock value</th><th>Days left</th></tr></thead><tbody>
      ${L.map(p => { const m = p.price ? (p.price - p.cost) / p.price * 100 : 0, pct = Math.min(100, p.th ? p.qty / (p.th * 3) * 100 : 100);
        return `<tr class="click" data-id="${p.id}"><td data-skip><input type="checkbox" data-c="${p.id}" ${sel_.has(p.id) ? 'checked' : ''}></td>
        <td><div class="pcell">${thumb(p)}<div><b>${esc(p.name)}</b><span class="sub mono">${esc(p.barcode || p.sku)}</span></div></div></td>
        <td>${p.cat ? `<span class="badge plain">${esc(p.cat)}</span>` : '<span class="mut">—</span>'}</td>
        <td><div style="display:flex;align-items:center;gap:10px"><b class="num ${p.qty <= 0 ? 'neg' : p.low ? 'warn' : ''}">${qty(p.qty)}</b><small class="mut">${esc(p.unit)}</small></div><div class="bar" style="width:90px;margin-top:4px"><i style="width:${pct}%;background:${p.qty <= 0 ? 'var(--danger)' : p.low ? 'var(--warn)' : 'var(--brand)'}"></i></div></td>
        <td class="n">${fmt(p.cost)}</td><td class="n"><b>${fmt(p.price)}</b>${p.mrp ? `<span class="sub">MRP ${fmt(p.mrp)}</span>` : ''}</td>
        <td class="n ${m < 10 ? 'warn' : 'pos'}">${m.toFixed(0)}%</td><td class="n">${fmt(p.value, 0)}</td>
        <td>${p.cover == null ? '<span class="mut">—</span>' : `<span class="badge ${p.cover <= 7 ? 'b-r' : p.cover <= 21 ? 'b-a' : 'b-g'}">${p.cover}d</span>`}${p.expiry && p.expiry <= soon ? ` <span class="badge b-a" title="Batch expires ${fd(p.expiry)}">exp ${fd(p.expiry)}</span>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
      $$('tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('[data-skip]')) return; go('/inventory/' + r.dataset.id); });
      $$('[data-c]').forEach(c => c.onchange = () => { c.checked ? sel_.add(+c.dataset.c) : sel_.delete(+c.dataset.c); bulk(); });
      $('#all').onchange = e => { L.forEach(p => e.target.checked ? sel_.add(p.id) : sel_.delete(p.id)); draw(); };
    }
    bulk();
  };
  const bulk = () => {
    const b = $('#bulk');
    if (!sel_.size) { b.style.display = 'none'; return; }
    b.style.display = 'flex';
    b.innerHTML = `<b>${sel_.size} selected</b><button class="btn sm sec" data-b="labels">${icon('barcode')}Print labels</button><button class="btn sm sec" data-b="price">${icon('tag')}Change prices</button><button class="btn sm sec" data-b="po">${icon('clipboard')}Purchase order</button>${F.st === 'archived' ? `<button class="btn sm sec" data-b="unarch">${icon('undo')}Restore</button>` : `<button class="btn sm danger" data-b="arch">${icon('archive')}Archive</button>`}<div style="flex:1"></div><button class="btn sm ghost" data-b="clear">Clear</button>`;
    const ids = [...sel_], pick = P.filter(p => sel_.has(p.id));
    const A = {
      labels: () => printLabels(pick), price: () => bulkPrice(ids), clear: () => { sel_.clear(); draw(); },
      po: () => newDoc('po', { lines: pick.map(p => ({ pid: p.id, qty: Math.max(1, p.reorder_qty || p.th * 2 || 1), price: p.cost })) }),
      arch: async () => { if (!await confirmBox(`Archive ${ids.length} product(s)? Their history stays saved.`, { ok: 'Archive', danger: true })) return; await Promise.all(ids.map(i => post(`/products/${i}/archive`))); sel_.clear(); go('/inventory'); },
      unarch: async () => { await Promise.all(ids.map(i => post(`/products/${i}/archive`, { archived: 0 }))); sel_.clear(); go('/inventory'); },
    };
    $$('[data-b]', b).forEach(x => x.onclick = A[x.dataset.b]);
  };
  $('#q').oninput = debounce(e => { F.q = $('#q').value; draw(); }, 120);
  $('#cat').onchange = e => { F.cat = e.target.value; draw(); };
  $$('#st button').forEach(b => b.onclick = () => { const was = F.st; F.st = b.dataset.k; if ((was === 'archived') !== (F.st === 'archived')) { sel_.clear(); go('/inventory'); } else { $$('#st button').forEach(x => x.classList.toggle('on', x === b)); draw(); } });
  $$('#vw button').forEach(b => b.onclick = () => { F.view = b.dataset.k; try { localStorage.setItem('cfo-inv-view', F.view); } catch { } $$('#vw button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#add').onclick = () => productForm();
  $('#imp').onclick = importForm;
  $('#exp').onclick = () => download(`products-${today()}.csv`, csv([['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'hsn', 'gst', 'cost', 'price', 'mrp', 'qty', 'alert_at', 'location'], ...P.filter(p => !p.archived).map(p => [p.name, p.sku, p.barcode, p.cat, p.brand, p.unit, p.hsn, p.gst, p.cost, p.price, p.mrp, p.qty, p.th, p.location])]));
  $('#scanadd').onclick = async () => {
    const code = await scanOnce('Scan the barcode printed on the product');
    if (!code) return;
    const r = await fetch('/api/lookup/' + encodeURIComponent(code));
    if (r.ok) { const p = await r.json(); toast(`${p.name} already has this barcode`); go('/inventory/' + p.id); }
    else productForm(null, { barcode: code });
  };
  draw();
});

// ---------- product page ----------
route('/inventory/:id', async (v, id) => {
  const p = await api('/products/' + id);
  const s = p.stats;
  v.innerHTML = `<div class="ph" style="margin-bottom:12px"><a class="btn ghost sm" href="#/inventory">${icon('back')}Inventory</a></div>
  <div class="card" style="margin-bottom:18px;overflow:hidden">
    <div class="prod-hero"><div class="prod-img">${p.image ? `<img src="/api/products/${p.id}/image?v=${Date.now()}">` : icon('box')}</div>
      <div style="min-width:0"><div class="meta" style="margin:0 0 6px">${p.archived ? badge('Archived', 'b-r') : ''}${p.cat ? badge(p.cat, 'plain') : ''}${p.brand ? `<span class="badge plain">${esc(p.brand)}</span>` : ''}${p.track_batch ? badge('Batch tracked', 'b-b') : ''}</div>
        <h1>${esc(p.name)}</h1>
        <div class="meta"><span class="mut mono">SKU ${esc(p.sku)}</span>${p.hsn ? `<span class="mut">· HSN ${esc(p.hsn)}</span>` : ''}<span class="mut">· GST ${p.gst || 0}%</span>${p.location ? `<span class="mut">· ${icon('tag')} ${esc(p.location)}</span>` : ''}${p.sup_name ? `<span class="mut">· from ${esc(p.sup_name)}</span>` : ''}</div>
        <div class="acts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
          <button class="btn" data-a="sell">${icon('receipt')}Sell</button><button class="btn sec" data-a="buy">${icon('truck')}Buy stock</button><button class="btn sec" data-a="adj">${icon('sliders')}Adjust</button><button class="btn sec" data-a="label">${icon('printer')}Labels</button><button class="btn sec" data-a="edit">${icon('edit')}Edit</button><button class="btn ghost" data-a="arch">${icon(p.archived ? 'undo' : 'archive')}${p.archived ? 'Restore' : 'Archive'}</button></div></div>
      <div class="codebox"><img src="/api/code.svg?type=ean13&text=${encodeURIComponent(p.barcode)}" style="height:74px" alt="barcode"><img src="/api/code.svg?type=qr&text=${encodeURIComponent(p.barcode)}" style="height:74px;width:74px" alt="QR"></div></div>
    <div class="stats">
      <div><small>In stock</small><b class="${p.qty <= 0 ? 'neg' : p.qty <= p.th ? 'warn' : ''}">${qty(p.qty)} ${esc(p.unit)}</b><small>alert at ${qty(p.th)}</small></div>
      <div><small>Selling price</small><b>${fmt(p.price)}</b><small>${p.mrp ? 'MRP ' + fmt(p.mrp) : 'excl. GST'}</small></div>
      <div><small>Avg. cost</small><b>${fmt(p.cost)}</b><small class="${p.margin < 10 ? 'warn' : 'pos'}">${p.margin}% margin</small></div>
      <div><small>Stock value</small><b>${fmt(p.value, 0)}</b><small>${fmt(p.qty * p.price, 0)} at price</small></div>
      <div><small>Sold (30 days)</small><b>${qty(s.q30)}</b><small>${fmt(s.rev30, 0)} sales</small></div>
      <div><small>Profit (30 days)</small><b class="pos">${fmt(s.profit30, 0)}</b><small>${fmt(s.profit, 0)} all time</small></div>
      <div><small>Days of stock</small><b class="${s.cover != null && s.cover <= 7 ? 'neg' : ''}">${s.cover ?? '—'}</b><small>${s.vel ? qty(s.vel) + '/day' : 'no recent sales'}</small></div>
      <div><small>Last purchase</small><b>${p.lastBuy ? fmt(p.lastBuy.price) : '—'}</b><small>${p.lastBuy ? fd(p.lastBuy.date) + (p.lastBuy.supplier ? ' · ' + esc(p.lastBuy.supplier) : '') : 'never'}</small></div>
    </div></div>
  <div class="row c2e">
    <div class="card"><div class="card-h"><h3>Batches & expiry</h3>${p.track_batch ? '' : '<span class="mut" style="font-size:12px">Turn on batch tracking in Edit</span>'}</div><div class="card-b">${p.batches.length ? `<table><thead><tr><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Cost</th></tr></thead><tbody>${p.batches.map(b => { const d = b.expiry ? Math.round((new Date(b.expiry) - new Date(today())) / 864e5) : null; return `<tr><td class="mono">${esc(b.code)}</td><td>${b.expiry ? fd(b.expiry) + ` <span class="badge ${d < 0 ? 'b-r' : d <= 30 ? 'b-a' : 'b-g'}">${d < 0 ? 'expired' : d + 'd'}</span>` : '<span class="mut">—</span>'}</td><td class="n">${qty(b.qty)}</td><td class="n">${fmt(b.cost)}</td></tr>`; }).join('')}</tbody></table>` : empty('layers', 'No batches', 'Batches appear when you buy stock with a batch number or expiry date.')}</div></div>
    <div class="card"><div class="card-h"><h3>Stock movement</h3><span class="mut" style="font-size:12px">${p.lastSale ? 'last sold ' + ago(p.lastSale) : ''}</span></div><div class="card-b" style="max-height:420px;overflow:auto">${p.moves.length ? p.moves.map(m => `<div class="list-i"><span class="ic ${m.q > 0 ? 'tone-g' : 'tone-r'}" style="width:30px;height:30px;border-radius:9px;display:grid;place-items:center">${icon(m.q > 0 ? 'down' : 'up')}</span><div class="m"><b>${esc(m.type)} ${m.ref ? `<span class="mono mut">${esc(m.ref)}</span>` : ''}</b><small>${fd(m.date)}${m.user ? ' · ' + esc(m.user) : ''}${m.note ? ' · ' + esc(m.note) : ''}</small></div><b class="num ${m.q > 0 ? 'pos' : 'neg'}">${m.q > 0 ? '+' : ''}${qty(m.q)}</b></div>`).join('') : empty('history', 'No movement yet')}</div></div>
  </div>`;
  const A = {
    sell: () => newDoc('sale', { lines: [{ pid: p.id, qty: 1, price: p.price }] }),
    buy: () => newDoc('purchase', { party_id: p.sup_id, lines: [{ pid: p.id, qty: Math.max(1, p.reorder_qty || 1), price: p.cost }] }),
    adj: () => adjustForm(p), edit: () => productForm(p), label: () => printLabels([p]),
    arch: async () => { if (!p.archived && !await confirmBox(`Archive ${p.name}? It will be hidden from lists but its history stays.`, { ok: 'Archive', danger: true })) return; await post(`/products/${p.id}/archive`, { archived: p.archived ? 0 : 1 }); toast(p.archived ? 'Restored' : 'Archived'); go('/inventory/' + p.id); },
  };
  $$('[data-a]', v).forEach(b => b.onclick = A[b.dataset.a]);
});

// ---------- forms ----------
export async function productForm(p, pre = {}) {
  const e = !!p; p = p || { unit: 'pcs', gst: 0, th: 5, ...pre };
  const [sups, cats] = await Promise.all([api('/parties?kind=s'), api('/categories')]);
  let image = null;
  drawer({
    title: e ? 'Edit product' : 'Add product', submit: e ? 'Save changes' : 'Add product',
    body: `<div style="display:flex;gap:14px;align-items:center;margin-bottom:16px"><label class="prod-img" style="width:84px;height:84px;cursor:pointer;flex:none" id="pimg" title="Add photo"><span id="pv" style="display:contents">${p.image ? `<img src="/api/products/${p.id}/image">` : icon('camera')}</span><input type="file" accept="image/*" capture="environment" hidden id="pfile" data-skip></label><div style="flex:1">${fld('Product name', inp('name', p.name, 'required placeholder="e.g. Tata Salt 1kg"'))}</div></div>
      <div class="grid2">${fld('Barcode', `<div style="display:flex;gap:6px"><input name="barcode" value="${esc(p.barcode || '')}" placeholder="Leave empty to auto-create" class="mono"><button type="button" class="btn sec icon" id="bscan" title="Scan existing barcode">${icon('scan')}</button></div>`, 'Scan the maker\'s barcode, or we create one you can print.')}${fld('SKU / item code', inp('sku', p.sku, e ? 'readonly' : 'placeholder="Auto"'))}</div>
      <div class="grid2">${fld('Category', `<input name="cat" list="cats" value="${esc(p.cat || '')}"><datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>`)}${fld('Brand', inp('brand', p.brand))}</div>
      <div class="grid3">${fld('Unit', sel('unit', UNITS.includes(p.unit) ? UNITS : [p.unit, ...UNITS], p.unit))}${fld('HSN / SAC', inp('hsn', p.hsn, 'inputmode="numeric"'))}${fld('GST rate', sel('gst', GST.map(g => [g, g + '%']), p.gst))}</div>
      <div class="grid3">${e ? '' : fld('Cost per unit (₹)', inp('cost', '', 'type="number" step="any" min="0"'))}${fld('Selling price (₹)', inp('price', p.price, 'type="number" step="any" min="0" required'))}${fld('MRP (₹)', inp('mrp', p.mrp, 'type="number" step="any" min="0"'))}</div>
      ${e ? '' : `<div class="grid3">${fld('Opening stock', inp('qty', '0', 'type="number" step="any" min="0"'))}${fld('Batch no.', inp('batch', '', 'placeholder="Optional"'))}${fld('Expiry', inp('expiry', '', 'type="date"'))}</div>`}
      <div class="grid3">${fld('Low stock alert at', inp('th', p.th, 'type="number" step="any" min="0"'))}${fld('Usual reorder qty', inp('reorder_qty', p.reorder_qty || '', 'type="number" step="any" min="0"'))}${fld('Rack / shelf', inp('location', p.location, 'placeholder="e.g. A3"'))}</div>
      ${fld('Usual supplier', sel('sup_id', [['', '—'], ...sups.map(s => [s.id, s.name])], p.sup_id))}
      <label class="check"><input type="checkbox" name="track_batch" ${p.track_batch ? 'checked' : ''}> Track batches and expiry dates (medicines, food, cosmetics)</label>
      ${fld('Notes', `<textarea name="notes" rows="2">${esc(p.notes || '')}</textarea>`)}`,
    onOpen: el => {
      $('#pfile', el).onchange = async ev => { const f = ev.target.files[0]; if (!f) return; image = await shrinkImage(f); $('#pv', el).innerHTML = `<img src="${image}">`; };
      $('#bscan', el).onclick = async () => { const c = await scanOnce('Scan the product barcode'); if (c) el.barcode.value = c; };
    },
    onSubmit: async d => {
      if (image) d.image = image;
      if (e) { await put('/products/' + p.id, d); toast('Saved'); go('/inventory/' + p.id); }
      else { const r = await post('/products', d); toast('Product added'); go('/inventory/' + r.id); }
    },
  });
}

export function adjustForm(p) {
  drawer({
    title: 'Adjust stock', submit: 'Save adjustment',
    body: `<div class="card pad" style="margin-bottom:16px;display:flex;gap:12px;align-items:center">${thumb(p)}<div><b>${esc(p.name)}</b><div class="mut">Now in stock: ${qty(p.qty)} ${esc(p.unit)}</div></div></div>
      <div class="seg" style="margin-bottom:14px" id="dir"><button type="button" data-d="1" class="on">${icon('plus')} Add</button><button type="button" data-d="-1">${icon('minus')} Remove</button><button type="button" data-d="0">Set exact count</button></div>
      ${fld('Quantity', inp('n', '', 'type="number" step="any" min="0" required'), '<span id="after"></span>')}
      ${fld('Reason', sel('reason', ['Correction', 'Damaged', 'Expired', 'Lost / theft', 'Free sample', 'Own use', 'Found extra', 'Opening stock'], 'Correction'))}
      ${p.track_batch ? `<div class="grid2">${fld('Batch', p.batches?.length ? sel('batch', [['', 'Auto (earliest expiry)'], ...p.batches.map(b => [b.code, `${b.code} (${qty(b.qty)})`])]) + '<small>For removals</small>' : inp('batch'))}${fld('Expiry (when adding)', inp('expiry', '', 'type="date"'))}</div>` : ''}
      ${fld('Note', inp('note', '', 'placeholder="Optional"'))}`,
    onOpen: el => {
      let dir = 1;
      const upd = () => { const n = +el.n.value || 0, q = dir === 0 ? n - p.qty : dir * n; $('#after', el).textContent = `Stock after: ${qty(p.qty + q)} ${p.unit} (${q >= 0 ? '+' : ''}${qty(q)})`; el.dataset.q = q; };
      $$('#dir button', el).forEach(b => b.onclick = () => { dir = +b.dataset.d; $$('#dir button', el).forEach(x => x.classList.toggle('on', x === b)); upd(); });
      el.n.oninput = upd;
    },
    onSubmit: async (d, el) => { await post(`/products/${p.id}/adjust`, { q: +el.dataset.q, reason: d.reason, note: d.note, batch: d.batch, expiry: d.expiry }); toast('Stock updated'); go('/inventory/' + p.id); },
  });
}

function bulkPrice(ids) {
  drawer({
    title: `Change prices (${ids.length} products)`, submit: 'Apply',
    body: `${fld('How', sel('mode', [['pct', 'Increase / decrease by %'], ['abs', 'Increase / decrease by ₹'], ['margin', 'Set price = cost + margin %']], 'pct'))}
      ${fld('Value', inp('value', '', 'type="number" step="any" required placeholder="e.g. 5 or -10"'), 'Use a minus sign to reduce.')}
      ${fld('Apply to', sel('field', [['price', 'Selling price'], ['mrp', 'MRP']], 'price'))}
      <label class="check"><input type="checkbox" name="round" checked> Round to the nearest rupee</label>`,
    onSubmit: async d => { const r = await post('/products/bulk-price', { ...d, ids, value: +d.value }); toast(`Updated ${r.count} prices`); sel_.clear(); go('/inventory'); },
  });
}

function importForm() {
  const sample = csv([['name', 'barcode', 'category', 'unit', 'hsn', 'gst', 'cost', 'price', 'mrp', 'qty', 'alert_at'], ['Tata Salt 1kg', '8901058000000', 'Grocery', 'pcs', '2501', '0', '22', '28', '28', '50', '10']]);
  let rows = null;
  drawer({
    title: 'Import products from Excel / CSV', submit: 'Import',
    body: `<div class="alert tone-i">${icon('file')}<div><b>Save your sheet as CSV</b>Columns we read: name, sku, barcode, category, brand, unit, hsn, gst, cost, price, mrp, qty, alert_at. Products are matched by barcode, SKU or name and updated; new ones are added.</div></div>
      <p><a id="tpl">Download a template</a></p>${fld('CSV file', '<input type="file" accept=".csv,text/csv" id="f" data-skip>')}<div id="pv"></div>`,
    onOpen: el => {
      $('#tpl', el).onclick = () => download('products-template.csv', sample);
      $('#f', el).onchange = async ev => {
        const R = parseCSV(await readFile(ev.target.files[0]));
        const H = R[0].map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
        const map = { category: 'cat', alert_at: 'th', low_stock: 'th', selling_price: 'price', cost_price: 'cost', stock: 'qty', quantity: 'qty', hsn_code: 'hsn', gst_rate: 'gst', item: 'name', product: 'name' };
        rows = R.slice(1).map(r => Object.fromEntries(H.map((h, i) => [map[h] || h, r[i] ?? '']).filter(([k]) => k))).filter(r => r.name || r.barcode);
        $('#pv', el).innerHTML = `<p><b>${rows.length}</b> rows found.</p><div class="tw" style="max-height:240px"><table><thead><tr><th>Name</th><th>Barcode</th><th class="n">Price</th><th class="n">Qty</th></tr></thead><tbody>${rows.slice(0, 20).map(r => `<tr><td>${esc(r.name)}</td><td class="mono">${esc(r.barcode)}</td><td class="n">${esc(r.price)}</td><td class="n">${esc(r.qty)}</td></tr>`).join('')}</tbody></table></div>`;
      };
    },
    onSubmit: async () => {
      if (!rows?.length) throw new Error('Choose a CSV file first.');
      const r = await post('/products/import', { rows });
      toast(`${r.added} added, ${r.updated} updated`);
      if (r.errors.length) { throw new Error(r.errors.slice(0, 5).join('\n')); }
      go('/inventory');
    },
  });
}
