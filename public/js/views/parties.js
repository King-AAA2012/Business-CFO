import { $, $$, api, post, route, state, icon, esc, fmt, fd, ago, today, badge, empty, fld, inp, drawer, toast, go, debounce, initials, waLink, printHTML, csv, download } from '../core.js';
import { newDoc } from './docs.js';
import { paymentForm } from './money.js';

const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
export const stateSelect = (name, v) => `<select name="${name}"><option value="">—</option>${STATES.map(s => `<option${s === v ? ' selected' : ''}>${s}</option>`).join('')}</select>`;

const list = kind => async (v) => {
  const c = kind === 'c', L = await api('/parties?kind=' + kind);
  const owed = L.reduce((t, p) => t + p.balance, 0);
  v.innerHTML = `<div class="ph"><div class="t"><h1>${c ? 'Customers' : 'Suppliers'}</h1><p>${L.length} ${c ? 'customers' : 'suppliers'} · <span class="${owed > 0 ? 'warn' : ''}">${fmt(owed, 0)} ${c ? 'owed to you' : 'you owe'}</span></p></div><div class="acts"><button class="btn sec" id="exp">${icon('download')}Export</button><button class="btn" id="add">${icon('plus')}Add ${c ? 'customer' : 'supplier'}</button></div></div>
    <div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Search name, phone, GSTIN"></div><div class="seg" id="f"><button data-k="" class="on">All</button><button data-k="due">${c ? 'Owe you' : 'You owe'}</button><button data-k="over">Over limit</button></div></div><div id="list"></div>`;
  let q = '', f = '';
  const draw = () => {
    const R = L.filter(p => (!q || [p.name, p.phone, p.gstin, p.email].join(' ').toLowerCase().includes(q)) && (f !== 'due' || p.balance > 0) && (f !== 'over' || (p.credit_limit && p.balance > p.credit_limit)));
    $('#list').innerHTML = R.length ? `<div class="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>GSTIN</th><th>Last activity</th><th class="n">${c ? 'Owes you' : 'You owe'}</th></tr></thead><tbody>${R.map(p => `<tr class="click" data-id="${p.id}"><td><div class="pcell"><div class="avatar" style="width:32px;height:32px;font-size:12px">${esc(initials(p.name))}</div><div><b>${esc(p.name)}</b>${p.state ? `<span class="sub">${esc(p.state)}</span>` : ''}</div></div></td><td>${esc(p.phone || '—')}</td><td class="mono">${esc(p.gstin || '—')}</td><td>${p.last ? ago(p.last) : '<span class="mut">—</span>'}</td><td class="n"><b class="${p.balance > 0 ? (c ? 'warn' : 'neg') : 'mut'}">${fmt(p.balance)}</b>${p.credit_limit ? `<span class="sub ${p.balance > p.credit_limit ? 'neg' : ''}">limit ${fmt(p.credit_limit, 0)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="card">${empty('users', L.length ? 'No matches' : `No ${c ? 'customers' : 'suppliers'} yet`, L.length ? '' : 'They are also added automatically when you type a new name on a bill.')}</div>`;
    $$('tr[data-id]').forEach(r => r.onclick = () => go(`/${c ? 'customers' : 'suppliers'}/${r.dataset.id}`));
  };
  $('#q').oninput = debounce(() => { q = $('#q').value.toLowerCase(); draw(); });
  $$('#f button').forEach(b => b.onclick = () => { f = b.dataset.k; $$('#f button').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#add').onclick = () => partyForm(kind);
  $('#exp').onclick = () => download(`${c ? 'customers' : 'suppliers'}-${today()}.csv`, csv([['Name', 'Phone', 'Email', 'GSTIN', 'State', 'Address', 'Balance', 'Credit limit'], ...L.map(p => [p.name, p.phone, p.email, p.gstin, p.state, p.address, p.balance, p.credit_limit])]));
  draw();
};
route('/customers', list('c'));
route('/suppliers', list('s'));

export function partyForm(kind, p = {}) {
  const c = kind === 'c';
  drawer({
    title: p.id ? 'Edit ' + p.name : 'Add ' + (c ? 'customer' : 'supplier'),
    body: `${fld('Name', inp('name', p.name, 'required'))}<div class="grid2">${fld('Phone (WhatsApp)', inp('phone', p.phone, 'type="tel" inputmode="tel"'))}${fld('Email', inp('email', p.email, 'type="email"'))}</div>
      <div class="grid2">${fld('GSTIN', inp('gstin', p.gstin, 'class="mono" maxlength="15" style="text-transform:uppercase"'), 'For B2B tax invoices.')}${fld('State', stateSelect('state', p.state), 'Decides CGST+SGST vs IGST.')}</div>
      ${fld('Address', `<textarea name="address" rows="2">${esc(p.address || '')}</textarea>`)}
      ${c ? fld('Credit limit (₹)', inp('credit_limit', p.credit_limit || '', 'type="number" min="0" step="any" placeholder="No limit"'), 'You get a warning before billing beyond this.') : ''}
      ${fld('Notes', inp('notes', p.notes))}`,
    onSubmit: async d => {
      if (d.gstin && !d.state) { const code = +d.gstin.slice(0, 2); const m = { 1: 'Jammu and Kashmir', 2: 'Himachal Pradesh', 3: 'Punjab', 4: 'Chandigarh', 5: 'Uttarakhand', 6: 'Haryana', 7: 'Delhi', 8: 'Rajasthan', 9: 'Uttar Pradesh', 10: 'Bihar', 18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 36: 'Telangana', 37: 'Andhra Pradesh' }; d.state = m[code] || ''; }
      const r = await post('/parties', { ...d, kind, id: p.id });
      toast('Saved');
      go(`/${c ? 'customers' : 'suppliers'}/${r.id}`);
    },
  });
}

const page = kind => async (v, id, q) => {
  const c = kind === 'c', from = q.from || '', to = q.to || '';
  const [led, docs] = await Promise.all([api(`/parties/${id}/ledger?from=${from}&to=${to}`), api(`/docs?party=${id}`)]);
  const p = led.party, biz = state.settings.business?.name || '';
  const remind = `Hello ${p.name}, this is a friendly reminder from ${biz}. Your outstanding balance is ${fmt(led.closing)}.${state.settings.upi?.vpa ? ` You can pay by UPI to ${state.settings.upi.vpa}.` : ''} Thank you!`;
  v.innerHTML = `<div class="ph" style="margin-bottom:12px"><a class="btn ghost sm" href="#/${c ? 'customers' : 'suppliers'}">${icon('back')}${c ? 'Customers' : 'Suppliers'}</a></div>
  <div class="ph"><div class="t" style="display:flex;gap:14px;align-items:center"><div class="avatar" style="width:52px;height:52px;font-size:18px">${esc(initials(p.name))}</div><div><h1>${esc(p.name)}</h1><p>${[p.phone, p.email, p.gstin && 'GSTIN ' + p.gstin, p.state].filter(Boolean).map(esc).join(' · ') || 'No contact details'}</p></div></div>
    <div class="acts"><button class="btn sec" id="edit">${icon('edit')}Edit</button>${p.phone ? `<a class="btn sec" target="_blank" rel="noopener" href="${waLink(p.phone, remind)}">${icon('msg')}${c ? 'Send reminder' : 'WhatsApp'}</a>` : ''}<button class="btn sec" id="stmt">${icon('printer')}Statement</button><button class="btn" id="new">${icon('plus')}${c ? 'New invoice' : 'New bill'}</button></div></div>
  <div class="kpis"><div class="kpi ${led.closing > 0 && c ? 'hero' : ''}"><div class="k">${c ? 'Owes you' : 'You owe'}</div><b>${fmt(led.closing)}</b><small>${p.credit_limit ? `Credit limit ${fmt(p.credit_limit, 0)}` : 'No credit limit'}</small></div>
    <div class="kpi"><div class="k">Total ${c ? 'billed' : 'purchased'}</div><b>${fmt(docs.filter(d => d.kind === (c ? 'sale' : 'purchase') && d.status !== 'Cancelled').reduce((t, d) => t + d.total, 0), 0)}</b><small>${docs.length} documents</small></div>
    <div class="kpi"><div class="k">Overdue</div><b class="neg">${fmt(docs.filter(d => d.status === 'Overdue').reduce((t, d) => t + d.bal, 0), 0)}</b><small>past due date</small></div></div>
  <div class="tabs"><button class="on" data-t="led">Ledger</button><button data-t="docs">Documents</button></div>
  <div id="tab"></div>`;
  const ledger = () => `<div class="toolbar"><input type="date" id="lf" value="${from}" style="width:auto"> to <input type="date" id="lt" value="${to}" style="width:auto"><button class="btn sm sec" id="lgo">Apply</button>${led.closing > 0 ? `<div style="flex:1"></div><button class="btn sm" id="rp">${icon('rupee')}Record payment</button>` : ''}</div>
    <div class="tw"><table><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead><tbody>${from ? `<tr><td>${fd(from)}</td><td colspan="4"><b>Opening balance</b></td><td class="n"><b>${fmt(led.opening)}</b></td></tr>` : ''}${led.rows.map(r => `<tr><td>${fd(r.date)}</td><td>${esc(r.what)}</td><td class="mono">${r.id ? `<a href="#/doc/${r.id}">${esc(r.ref)}</a>` : esc(r.ref)}</td><td class="n">${r.dr ? fmt(r.dr) : ''}</td><td class="n">${r.cr ? fmt(r.cr) : ''}</td><td class="n"><b>${fmt(r.bal)}</b></td></tr>`).join('') || `<tr><td colspan="6">${empty('book', 'No entries')}</td></tr>`}</tbody></table></div>`;
  const docsT = () => docs.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Number</th><th class="n">Total</th><th class="n">Balance</th><th>Status</th></tr></thead><tbody>${docs.map(d => `<tr class="click" onclick="location.hash='/doc/${d.id}'"><td>${fd(d.date)}</td><td class="mono">${esc(d.no)}</td><td class="n">${fmt(d.total)}</td><td class="n">${fmt(d.bal)}</td><td>${badge(d.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('receipt', 'No documents yet');
  const tab = t => {
    $('#tab').innerHTML = t === 'led' ? ledger() : docsT();
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'led') {
      $('#lgo').onclick = () => go(`/${c ? 'customers' : 'suppliers'}/${id}?from=${$('#lf').value}&to=${$('#lt').value}`);
      $('#rp') && ($('#rp').onclick = () => paymentForm(c ? 'in' : 'out', { party: p.id }));
    }
  };
  $$('.tabs button').forEach(b => b.onclick = () => tab(b.dataset.t));
  $('#edit').onclick = () => partyForm(kind, p);
  $('#new').onclick = () => newDoc(c ? 'sale' : 'purchase', { party_id: p.id });
  $('#stmt').onclick = () => printHTML(`<div class="inv"><div class="top"><div><h1>${esc(biz)}</h1><div>${esc(state.settings.business?.address || '')}</div></div><div class="r"><h1 style="color:#111;font-size:18px">STATEMENT OF ACCOUNT</h1><div>${from ? fd(from) : 'Beginning'} to ${fd(to || today())}</div></div></div><p><b>${esc(p.name)}</b><br>${esc(p.address || '')}${p.gstin ? '<br>GSTIN ' + esc(p.gstin) : ''}</p>
    <table><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>${from ? `<tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td></td><td class="r">${fmt(led.opening)}</td></tr>` : ''}${led.rows.map(r => `<tr><td>${fd(r.date)}</td><td>${esc(r.what)}</td><td>${esc(r.ref)}</td><td class="r">${r.dr ? fmt(r.dr) : ''}</td><td class="r">${r.cr ? fmt(r.cr) : ''}</td><td class="r">${fmt(r.bal)}</td></tr>`).join('')}</tbody></table>
    <p style="font-size:15px;text-align:right;margin-top:14px"><b>Closing balance: ${fmt(led.closing)}</b></p></div>`);
  tab('led');
};
route('/customers/:id', page('c'));
route('/suppliers/:id', page('s'));
