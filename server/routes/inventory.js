const { all, get, run, tx, insert, update, next } = require('../db');
const { r2, r4, today, addDays, fail, stockIn, stockOut, audit, newBarcode, partyName } = require('../core');

const FIELDS = ['name', 'unit', 'cat', 'brand', 'hsn', 'gst', 'price', 'mrp', 'th', 'reorder_qty', 'sup_id', 'location', 'notes', 'image', 'track_batch', 'barcode'];
const NUM = ['gst', 'price', 'mrp', 'th', 'reorder_qty'];

function clean(b) {
  const o = {};
  for (const k of FIELDS) if (k in b) o[k] = NUM.includes(k) ? (b[k] === '' || b[k] == null ? null : +b[k]) : b[k];
  if ('name' in o) { o.name = String(o.name || '').trim(); if (!o.name) fail('Enter a product name.'); }
  if ('price' in o && !(o.price >= 0)) fail('Enter a valid selling price.');
  if ('barcode' in o) o.barcode = String(o.barcode || '').trim() || null;
  if ('track_batch' in o) o.track_batch = o.track_batch ? 1 : 0;
  if ('sup_id' in o) o.sup_id = o.sup_id ? +o.sup_id : null;
  if (o.image && o.image.length > 400000) fail('Image is too large. Use a smaller photo.');
  return o;
}

// Units sold per product over the last N days (net of returns).
function velocity(days) {
  const from = addDays(today(), -days);
  const m = {};
  for (const r of all(`SELECT pid, -SUM(q) q FROM moves WHERE date>=? AND type IN ('Sale','Sale cancelled','Return') GROUP BY pid`, from)) m[r.pid] = Math.max(0, r.q) / days;
  return m;
}

function listProducts(includeArchived) {
  const v = velocity(30);
  const exp = {};
  for (const b of all(`SELECT pid, MIN(expiry) e FROM batches WHERE qty>0 AND expiry IS NOT NULL AND expiry<>'' GROUP BY pid`)) exp[b.pid] = b.e;
  return all(`SELECT p.*, s.name sup_name FROM products p LEFT JOIN parties s ON s.id=p.sup_id ${includeArchived ? '' : 'WHERE p.archived=0'} ORDER BY p.name COLLATE NOCASE`).map(p => {
    const vel = v[p.id] || 0;
    return { ...p, image: p.image ? 1 : 0, value: r2(p.qty * p.cost), low: p.qty <= p.th, vel: r4(vel), cover: vel ? Math.round(p.qty / vel) : null, expiry: exp[p.id] || null };
  });
}

function detail(id) {
  const p = get('SELECT * FROM products WHERE id=?', id);
  if (!p) fail('Product not found.');
  const sold = (from) => get(`SELECT COALESCE(SUM(l.qty),0) q, COALESCE(SUM(l.taxable),0) rev, COALESCE(SUM(l.qty*l.cost),0) cogs FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='sale' AND d.x=0 AND l.pid=? AND d.date>=?`, id, from);
  const all30 = sold(addDays(today(), -30)), ever = sold('0000');
  const lastBuy = get(`SELECT d.date, l.price, d.party_id FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='purchase' AND d.x=0 AND l.pid=? ORDER BY d.date DESC, d.id DESC LIMIT 1`, id);
  const lastSale = get(`SELECT d.date FROM doc_lines l JOIN docs d ON d.id=l.doc_id WHERE d.kind='sale' AND d.x=0 AND l.pid=? ORDER BY d.date DESC LIMIT 1`, id);
  const vel = all30.q / 30;
  return {
    ...p, sup_name: partyName(p.sup_id), value: r2(p.qty * p.cost),
    margin: p.price ? r2((p.price - p.cost) / p.price * 100) : 0,
    batches: all('SELECT * FROM batches WHERE pid=? AND qty<>0 ORDER BY expiry', id),
    moves: all('SELECT * FROM moves WHERE pid=? ORDER BY at DESC, id DESC LIMIT 60', id),
    stats: { q30: r2(all30.q), rev30: r2(all30.rev), profit30: r2(all30.rev - all30.cogs), q: r2(ever.q), rev: r2(ever.rev), profit: r2(ever.rev - ever.cogs), vel: r4(vel), cover: vel ? Math.round(p.qty / vel) : null },
    lastBuy: lastBuy ? { ...lastBuy, supplier: partyName(lastBuy.party_id) } : null,
    lastSale: lastSale?.date || null,
  };
}

function create(b, user) {
  const o = clean(b);
  if (!o.name) fail('Enter a product name.');
  if (get('SELECT 1 FROM products WHERE archived=0 AND name=? COLLATE NOCASE', o.name)) fail('A product with this name already exists.');
  if (o.barcode && get('SELECT 1 FROM products WHERE barcode=?', o.barcode)) fail('Another product already uses this barcode.');
  const q = +b.qty || 0, cost = +b.cost || 0;
  if (q < 0 || cost < 0) fail('Stock and cost cannot be negative.');
  if (q > 0 && cost <= 0) fail('Enter the cost per unit of your current stock.');
  return tx(() => {
    const id = insert('products', { unit: 'pcs', gst: 0, th: 5, ...o, sku: b.sku?.trim() || 'SKU-' + String(next('sku')).padStart(4, '0'), barcode: o.barcode || newBarcode(), qty: 0, cost, created: today() });
    if (q > 0) stockIn(id, q, cost, 'Opening stock', '', null, user, { code: b.batch, expiry: b.expiry });
    audit(user, 'Added product ' + o.name);
    return id;
  });
}

module.exports = (app) => {
  app.get('/api/products', (req, res) => res.json(listProducts(req.query.all)));
  app.get('/api/products/:id', (req, res) => res.json(detail(+req.params.id)));
  app.get('/api/products/:id/image', (req, res) => {
    const p = get('SELECT image FROM products WHERE id=?', +req.params.id);
    const m = /^data:(image\/[\w+]+);base64,(.+)$/.exec(p?.image || '');
    if (!m) return res.status(404).end();
    res.type(m[1]).set('Cache-Control', 'private, max-age=60').send(Buffer.from(m[2], 'base64'));
  });
  app.get('/api/categories', (req, res) => res.json(all(`SELECT DISTINCT cat FROM products WHERE cat IS NOT NULL AND cat<>'' ORDER BY cat`).map(r => r.cat)));

  // Scan lookup: barcode, then SKU, then batch code.
  app.get('/api/lookup/:code', (req, res) => {
    const c = String(req.params.code).trim();
    let p = get('SELECT id FROM products WHERE barcode=?', c) || get('SELECT id FROM products WHERE sku=? COLLATE NOCASE', c);
    let batch = null;
    if (!p) { const b = get('SELECT * FROM batches WHERE code=? ORDER BY id DESC', c); if (b) { p = { id: b.pid }; batch = b; } }
    if (!p) return res.status(404).json({ error: 'No product has this code.', code: c });
    res.json({ ...detail(p.id), matchedBatch: batch });
  });

  app.post('/api/products', (req, res) => res.json({ id: create(req.body, req.user.name) }));

  app.put('/api/products/:id', (req, res) => {
    const id = +req.params.id, o = clean(req.body);
    if (o.name && get('SELECT 1 FROM products WHERE archived=0 AND id<>? AND name=? COLLATE NOCASE', id, o.name)) fail('A product with this name already exists.');
    if (o.barcode && get('SELECT 1 FROM products WHERE id<>? AND barcode=?', id, o.barcode)) fail('Another product already uses this barcode.');
    if ('barcode' in o && !o.barcode) o.barcode = newBarcode();
    update('products', id, o);
    audit(req.user.name, 'Edited product ' + (o.name || id));
    res.json({ ok: 1 });
  });

  app.post('/api/products/:id/adjust', (req, res) => {
    const id = +req.params.id, q = +req.body.q, p = get('SELECT * FROM products WHERE id=?', id);
    if (!q) fail('Enter how much to add or remove.');
    if (p.qty + q < 0) fail('Stock cannot go below zero.');
    tx(() => {
      const label = 'Adjustment: ' + (req.body.reason || 'Correction');
      if (q > 0) stockIn(id, q, req.body.cost ? +req.body.cost : null, label, '', null, req.user.name, { code: req.body.batch, expiry: req.body.expiry });
      else stockOut(id, -q, label, '', null, req.user.name, req.body.batch);
      if (req.body.note) run('UPDATE moves SET note=? WHERE id=(SELECT MAX(id) FROM moves WHERE pid=?)', req.body.note, id);
      audit(req.user.name, `Stock adjusted: ${p.name} ${q > 0 ? '+' : ''}${q}`);
    });
    res.json({ ok: 1 });
  });

  app.post('/api/products/:id/archive', (req, res) => {
    run('UPDATE products SET archived=? WHERE id=?', req.body.archived === 0 ? 0 : 1, +req.params.id);
    res.json({ ok: 1 });
  });

  // CSV import: updates by barcode/SKU/name match, otherwise creates.
  app.post('/api/products/import', (req, res) => {
    const rows = req.body.rows || [];
    let added = 0, updated = 0; const errors = [];
    tx(() => rows.forEach((r, i) => {
      try {
        const ex = (r.barcode && get('SELECT * FROM products WHERE barcode=?', String(r.barcode))) || (r.sku && get('SELECT * FROM products WHERE sku=? COLLATE NOCASE', r.sku)) || (r.name && get('SELECT * FROM products WHERE archived=0 AND name=? COLLATE NOCASE', r.name));
        if (ex) {
          const o = clean(Object.fromEntries(Object.entries(r).filter(([k, v]) => v !== '' && v != null && k !== 'qty' && k !== 'cost')));
          update('products', ex.id, o); updated++;
          if (r.qty !== '' && r.qty != null && +r.qty !== ex.qty) {
            const d = r4(+r.qty - ex.qty);
            d > 0 ? stockIn(ex.id, d, r.cost ? +r.cost : null, 'Import', '', null, req.user.name) : stockOut(ex.id, -d, 'Import', '', null, req.user.name);
          }
        } else { create({ ...r, price: r.price || 0 }, req.user.name); added++; }
      } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
    }));
    audit(req.user.name, `Imported products: ${added} added, ${updated} updated`);
    res.json({ added, updated, errors });
  });

  app.post('/api/products/bulk-price', (req, res) => {
    const { ids, cat, mode, value, field = 'price', round } = req.body;
    const f = field === 'mrp' ? 'mrp' : 'price';
    const L = ids?.length ? all(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : all('SELECT * FROM products WHERE archived=0' + (cat ? ' AND cat=?' : ''), ...(cat ? [cat] : []));
    tx(() => L.forEach(p => {
      let v = mode === 'margin' ? p.cost * (1 + value / 100) : mode === 'abs' ? (p[f] || 0) + +value : (p[f] || 0) * (1 + value / 100);
      v = round ? Math.round(v) : r2(v);
      run(`UPDATE products SET ${f}=? WHERE id=?`, Math.max(0, v), p.id);
    }));
    audit(req.user.name, `Bulk ${f} update on ${L.length} products`);
    res.json({ count: L.length });
  });

  // Stocktake: counted vs recorded, posts the differences as adjustments.
  app.post('/api/stocktake', (req, res) => {
    const counts = req.body.counts || [], out = [];
    tx(() => counts.forEach(c => {
      const p = get('SELECT * FROM products WHERE id=?', +c.pid);
      const d = r4(+c.counted - p.qty);
      if (!d) return;
      d > 0 ? stockIn(p.id, d, null, 'Stocktake', '', null, req.user.name) : stockOut(p.id, -d, 'Stocktake', '', null, req.user.name);
      out.push({ name: p.name, diff: d, value: r2(d * p.cost) });
    }));
    audit(req.user.name, `Stocktake posted: ${out.length} differences`);
    res.json({ changes: out, value: r2(out.reduce((t, x) => t + x.value, 0)) });
  });

  app.post('/api/batches/:id', (req, res) => {
    run('UPDATE batches SET code=COALESCE(?,code), expiry=? WHERE id=?', req.body.code || null, req.body.expiry || null, +req.params.id);
    res.json({ ok: 1 });
  });
};
module.exports.listProducts = listProducts;
module.exports.velocity = velocity;
