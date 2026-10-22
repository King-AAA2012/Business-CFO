import { $, $$, api, put, route, state, icon, esc, fmt, qty, thumb, empty, fld, sel, drawer, toast, printHTML, debounce } from '../core.js';

// w/h in mm; cols>0 means an A4 sheet.
export const LAYOUTS = {
  '50x25': { name: 'Label roll 50 × 25 mm', w: 50, h: 25 },
  '38x25': { name: 'Label roll 38 × 25 mm', w: 38, h: 25 },
  '40x30': { name: 'Label roll 40 × 30 mm', w: 40, h: 30 },
  '58x40': { name: 'Label roll 58 × 40 mm', w: 58, h: 40 },
  '100x50': { name: 'Label roll 100 × 50 mm', w: 100, h: 50 },
  a4_65: { name: 'A4 sheet, 65 per page (38 × 21 mm)', w: 38.1, h: 21.2, cols: 5, rows: 13, mt: 10.7, ml: 4.7, gx: 2.5, gy: 0 },
  a4_40: { name: 'A4 sheet, 40 per page (52 × 30 mm)', w: 52.5, h: 29.7, cols: 4, rows: 10, mt: 0, ml: 0, gx: 0, gy: 0 },
  a4_24: { name: 'A4 sheet, 24 per page (64 × 34 mm)', w: 63.5, h: 33.9, cols: 3, rows: 8, mt: 12.9, ml: 7.2, gx: 2.5, gy: 0 },
  a4_12: { name: 'A4 sheet, 12 per page (105 × 48 mm)', w: 105, h: 48, cols: 2, rows: 6, mt: 4.5, ml: 0, gx: 0, gy: 0 },
};
const FIELDS = [['name', 'Product name'], ['price', 'Selling price'], ['mrp', 'MRP'], ['sku', 'SKU'], ['shop', 'Shop name'], ['loc', 'Rack / shelf']];

function label(p, o) {
  const L = LAYOUTS[o.size], small = L.h < 26, f = o.fields, code = encodeURIComponent(p.barcode);
  const type = o.code === 'ean13' && /^\d{12,13}$/.test(p.barcode) ? 'ean13' : 'code128';
  const name = f.includes('name') ? `<div class="n" style="font-size:${small ? 2.6 : 3.1}mm">${esc(p.name)}</div>` : '';
  const price = `${f.includes('price') ? `<span class="pr" style="font-size:${small ? 3.2 : 4}mm">${fmt(p.price)}</span>` : ''}${f.includes('mrp') && p.mrp ? ` <span style="font-size:2.3mm">MRP ${fmt(p.mrp)}</span>` : ''}`;
  const meta = [f.includes('sku') && p.sku, f.includes('loc') && p.location].filter(Boolean).map(esc).join(' · ');
  const shop = f.includes('shop') ? `<div style="font-size:2.1mm;font-weight:700;text-transform:uppercase;letter-spacing:.2mm">${esc(state.settings.business?.name || '')}</div>` : '';
  const style = `width:${L.w}mm;height:${L.h}mm`;
  if (o.code === 'qr' || o.code === 'both') {
    const qs = Math.min(L.h - 3, L.w * 0.42);
    return `<div class="lbl" style="${style}"><div class="rowx"><img src="/api/code.svg?type=qr&text=${code}" style="width:${qs}mm;height:${qs}mm;flex:none"><div>${shop}${name}<div>${price}</div>${o.code === 'both' ? `<img src="/api/code.svg?type=code128&text=${code}&h=6&text_=0" style="height:${Math.max(3, L.h * 0.18)}mm;width:100%;margin-top:.6mm">` : ''}<div style="font-size:2mm">${meta || esc(p.barcode)}</div></div></div></div>`;
  }
  const bh = L.h * (f.includes('name') ? 0.48 : 0.62) - (f.includes('shop') ? 2.5 : 0);
  return `<div class="lbl" style="${style}">${shop}${name}<img src="/api/code.svg?type=${type}&text=${code}&h=10" style="height:${bh}mm;max-width:${L.w - 3}mm;margin:.5mm 0">${price ? `<div>${price}</div>` : ''}${meta ? `<div style="font-size:2mm">${meta}</div>` : ''}</div>`;
}

function sheet(items, o) {
  const L = LAYOUTS[o.size], all = items.flatMap(({ p, n }) => Array(Math.max(0, n | 0)).fill(p));
  if (!L.cols) return { html: all.map(p => `<div style="page-break-after:always;break-after:page">${label(p, o)}</div>`).join(''), page: `size:${L.w}mm ${L.h}mm;margin:0` };
  const skip = Array(Math.max(0, +o.skip || 0)).fill(null);
  const cells = [...skip, ...all];
  return { html: `<div class="labels" style="display:grid;grid-template-columns:repeat(${L.cols},${L.w}mm);column-gap:${L.gx}mm;row-gap:${L.gy}mm;padding:${L.mt + (+o.dy || 0)}mm 0 0 ${L.ml + (+o.dx || 0)}mm">${cells.map(p => p ? label(p, o) : `<div style="width:${L.w}mm;height:${L.h}mm"></div>`).join('')}</div>`, page: 'size:A4;margin:0' };
}

// Opens the label designer for the given products.
export async function printLabels(products) {
  const saved = state.settings.labels || {};
  const o = { size: LAYOUTS[saved.size] ? saved.size : '50x25', code: saved.code || 'ean13', fields: saved.fields || ['name', 'price'], skip: 0, dx: 0, dy: 0 };
  const items = products.map(p => ({ p, n: 1 }));
  const { el } = drawer({
    title: 'Print barcode labels', wide: true, submit: `${icon('printer')} Print`,
    body: `<div class="grid2"><div>${fld('Label size', sel('size', Object.entries(LAYOUTS).map(([k, v]) => [k, v.name]), o.size))}
        ${fld('Code', sel('code', [['ean13', 'Barcode (EAN-13)'], ['code128', 'Barcode (Code 128)'], ['qr', 'QR code'], ['both', 'QR + barcode']], o.code), 'Both work with any scanner and with this app\'s camera scanner.')}
        <div class="fld"><span>Show on label</span>${FIELDS.map(([k, l]) => `<label class="check" style="margin-bottom:8px"><input type="checkbox" data-f="${k}" ${o.fields.includes(k) ? 'checked' : ''} data-skip> ${l}</label>`).join('')}</div>
        <div id="a4opts" class="grid3">${fld('Skip first', '<input name="skip" type="number" min="0" value="0">', 'Used stickers')}${fld('Shift right (mm)', '<input name="dx" type="number" step="0.5" value="0">')}${fld('Shift down (mm)', '<input name="dy" type="number" step="0.5" value="0">')}</div></div>
      <div><div class="fld"><span>Preview</span></div><div id="pv" style="background:repeating-conic-gradient(var(--surface-3) 0 25%,var(--surface) 0 50%) 0 0/16px 16px;border-radius:12px;padding:24px;display:grid;place-items:center;min-height:180px;border:1px solid var(--line)"></div><p class="mut" style="font-size:12.5px">In the print dialog choose your label printer, set scale to 100% (no “fit to page”) and margins to none.</p></div></div>
      <h3 style="margin:8px 0 10px">Copies</h3><div class="tw" style="max-height:300px"><table><thead><tr><th>Product</th><th>Barcode</th><th class="n">In stock</th><th style="width:150px">Labels</th></tr></thead><tbody>${items.map(({ p }, i) => `<tr><td><div class="pcell">${thumb(p)}<b>${esc(p.name)}</b></div></td><td class="mono">${esc(p.barcode)}</td><td class="n">${qty(p.qty)}</td><td><div style="display:flex;gap:6px"><input type="number" min="0" value="1" data-n="${i}" style="height:34px;width:70px" data-skip><button type="button" class="btn sm ghost" data-all="${i}" title="One per unit in stock">= stock</button></div></td></tr>`).join('')}</tbody></table></div><p id="cnt" class="mut"></p>`,
    onSubmit: async () => {
      const { html, page } = sheet(items, o);
      if (!html.includes('lbl')) throw new Error('Set at least one label to print.');
      printHTML(html, page);
      put('/settings/labels', { size: o.size, code: o.code, fields: o.fields }).catch(() => { });
      return false;
    },
  });
  const upd = () => {
    o.size = el.size.value; o.code = el.code.value; o.skip = el.skip.value; o.dx = el.dx.value; o.dy = el.dy.value;
    o.fields = $$('[data-f]', el).filter(c => c.checked).map(c => c.dataset.f);
    $('#a4opts', el).style.display = LAYOUTS[o.size].cols ? '' : 'none';
    const L = LAYOUTS[o.size], scale = Math.min(3.2, 300 / (L.w * 3.78));
    $('#pv', el).innerHTML = items[0] ? `<div style="transform:scale(${scale});transform-origin:center;box-shadow:0 4px 14px rgba(0,0,0,.18)">${label(items[0].p, o)}</div>` : '';
    $('#pv', el).style.minHeight = (L.h * 3.78 * scale + 48) + 'px';
    const total = items.reduce((t, i) => t + (i.n | 0), 0);
    $('#cnt', el).textContent = `${total} label${total === 1 ? '' : 's'}` + (L.cols ? ` · ${Math.ceil((total + (+o.skip || 0)) / (L.cols * L.rows))} A4 sheet(s)` : '');
  };
  ['size', 'code', 'skip', 'dx', 'dy'].forEach(n => el[n].addEventListener('input', upd));
  $$('[data-f]', el).forEach(c => c.onchange = upd);
  $$('[data-n]', el).forEach(i => i.oninput = () => { items[i.dataset.n].n = +i.value || 0; upd(); });
  $$('[data-all]', el).forEach(b => b.onclick = () => { const i = b.dataset.all, n = Math.max(0, Math.ceil(items[i].p.qty)); items[i].n = n; $(`[data-n="${i}"]`, el).value = n; upd(); });
  upd();
}

// ---------- labels page ----------
route('/labels', async (v) => {
  const P = (await api('/products')).filter(p => !p.archived);
  const picked = new Set();
  v.innerHTML = `<div class="ph"><div class="t"><h1>Barcode labels</h1><p>Every product gets its own barcode. Print labels, stick them on the product, and scanning them anywhere in the app opens that exact product.</p></div><div class="acts"><button class="btn" id="go" disabled>${icon('printer')}Print labels</button></div></div>
    <div class="row c3" style="margin-bottom:18px">${[['scan', 'Scan with any scanner', 'USB and Bluetooth scanners type the code; phone cameras work on the Scan page.'], ['barcode', 'In-store EAN-13 codes', 'Codes starting with 2 are reserved for shop use, so they never clash with brand barcodes.'], ['tag', 'Already has a barcode?', 'Scan it into the product\'s Barcode field and we use the maker\'s code instead.']].map(([i, t, d]) => `<div class="card pad" style="display:flex;gap:12px"><span class="ic tone-g" style="width:38px;height:38px;border-radius:11px;display:grid;place-items:center;flex:none">${icon(i)}</span><div><b>${t}</b><p class="mut" style="margin:2px 0 0;font-size:13px">${d}</p></div></div>`).join('')}</div>
    <div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Filter products"></div><button class="btn sec sm" id="allb">Select all shown</button><button class="btn sec sm" id="newb">Select products added today</button></div><div id="list"></div>`;
  let q = '';
  const shown = () => P.filter(p => !q || [p.name, p.barcode, p.sku, p.cat].join(' ').toLowerCase().includes(q));
  const draw = () => {
    const L = shown();
    $('#list').innerHTML = L.length ? `<div class="tw"><table><thead><tr><th style="width:36px"></th><th>Product</th><th>Barcode</th><th class="n">Price</th><th class="n">In stock</th></tr></thead><tbody>${L.map(p => `<tr class="click" data-id="${p.id}"><td><input type="checkbox" ${picked.has(p.id) ? 'checked' : ''}></td><td><div class="pcell">${thumb(p)}<b>${esc(p.name)}</b></div></td><td><img src="/api/code.svg?type=${/^\d{13}$/.test(p.barcode) ? 'ean13' : 'code128'}&text=${encodeURIComponent(p.barcode)}&h=7" style="height:34px;background:#fff;border-radius:4px;padding:2px" loading="lazy"></td><td class="n">${fmt(p.price)}</td><td class="n">${qty(p.qty)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('barcode', 'No products', '<a href="#/inventory">Add products</a> first.')}</div>`;
    $$('tr[data-id]').forEach(r => r.onclick = () => { const id = +r.dataset.id; picked.has(id) ? picked.delete(id) : picked.add(id); $('input', r).checked = picked.has(id); $('#go').disabled = !picked.size; $('#go').innerHTML = `${icon('printer')}Print labels${picked.size ? ` (${picked.size})` : ''}`; });
  };
  $('#q').oninput = debounce(() => { q = $('#q').value.toLowerCase(); draw(); });
  $('#allb').onclick = () => { shown().forEach(p => picked.add(p.id)); draw(); $('#go').disabled = !picked.size; };
  $('#newb').onclick = () => { const t = new Date().toISOString().slice(0, 10); P.filter(p => p.created === t).forEach(p => picked.add(p.id)); draw(); $('#go').disabled = !picked.size; };
  $('#go').onclick = () => printLabels(P.filter(p => picked.has(p.id)));
  draw();
});
