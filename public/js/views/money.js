import { $, $$, api, post, put, route, state, icon, esc, fmt, fd, today, badge, empty, fld, inp, sel, drawer, dialog, toast, go, accountOpts, METHODS, refreshAccounts, readFile, printHTML, confirmBox, owner, debounce, csv, download } from '../core.js';
import { badgeCount } from '../main.js';

const TYPE = { cash: ['wallet', 'Cash'], bank: ['bank', 'Bank account'], upi: ['qr', 'UPI'], card: ['receipt', 'Card / POS'] };
const mask = a => a ? '•••• ' + String(a).slice(-4) : '';
export const EXP_CATS = ['Rent', 'Salaries', 'Electricity', 'Internet & phone', 'Transport', 'Packaging', 'Repairs', 'Marketing', 'Bank charges', 'Professional fees', 'Taxes & fees', 'Food & tea', 'Supplies', 'Other'];

// ---------- Bank & UPI ----------
route('/banking', async (v) => {
  const A = await refreshAccounts(); badgeCount();
  const u = state.settings.upi || {}, total = A.filter(a => !a.archived).reduce((t, a) => t + a.balance, 0);
  const upiLink = u.vpa ? `upi://pay?pa=${encodeURIComponent(u.vpa)}&pn=${encodeURIComponent(u.payee || state.settings.business?.name || '')}&cu=INR` : '';
  v.innerHTML = `<div class="ph"><div class="t"><h1>Bank & UPI</h1><p>${fmt(total, 0)} across ${A.filter(a => !a.archived).length} accounts. Link your bank statement to reconcile every rupee.</p></div>
    <div class="acts"><button class="btn sec" id="tr">${icon('repeat')}Transfer / deposit</button><button class="btn" id="add">${icon('plus')}Add account</button></div></div>
  <div class="row c2" style="align-items:start">
    <div style="display:grid;gap:14px">${A.filter(a => !a.archived).map(a => `<div class="card"><div style="display:flex;gap:14px;align-items:center;padding:18px">
        <span class="ic ${a.type === 'cash' ? 'tone-a' : a.type === 'upi' ? 'tone-b' : 'tone-g'}" style="width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex:none">${icon(TYPE[a.type][0])}</span>
        <div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">${esc(a.name)}</b>${a.is_default ? badge('Default', 'b-g') : ''}${a.aa_status === 'ACTIVE' ? badge('Live feed', 'b-b') : a.aa_status ? badge('Feed ' + a.aa_status.toLowerCase(), 'b-a') : ''}</div>
          <div class="mut" style="font-size:13px">${a.type === 'bank' ? [a.bank, a.branch, a.ifsc, mask(a.acno)].filter(Boolean).map(esc).join(' · ') || 'Bank account' : a.type === 'upi' ? esc(a.upi || 'UPI') : TYPE[a.type][1]}</div></div>
        <div style="text-align:right"><b style="font-size:20px;letter-spacing:-.02em" class="num">${fmt(a.balance)}</b><div class="mut" style="font-size:12px">${a.lastStmt?.balance != null ? `Statement ${fmt(a.lastStmt.balance, 0)} on ${fd(a.lastStmt.date)}` : 'as recorded'}</div></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 16px">${a.type !== 'cash' ? `<a class="btn sm ${a.unmatched ? '' : 'sec'}" href="#/banking/${a.id}">${icon('check')}Reconcile${a.unmatched ? ` (${a.unmatched})` : ''}</a><button class="btn sm sec" data-imp="${a.id}">${icon('upload')}Import statement</button>${a.type === 'bank' ? `<button class="btn sm sec" data-aa="${a.id}">${icon('link')}${a.aa_status === 'ACTIVE' ? 'Sync live feed' : 'Link live feed'}</button>` : ''}` : ''}<button class="btn sm ghost" data-hist="${a.id}">${icon('history')}History</button><button class="btn sm ghost" data-edit="${a.id}">${icon('edit')}Edit</button></div></div>`).join('')}
      ${A.some(a => a.archived) ? `<details><summary class="mut">Archived accounts</summary>${A.filter(a => a.archived).map(a => `<div class="list-i"><div class="m">${esc(a.name)}</div><button class="btn sm ghost" data-unarch="${a.id}">Restore</button></div>`).join('')}</details>` : ''}</div>
    <div style="display:grid;gap:14px">
      <div class="card pad" style="text-align:center"><h3>Your UPI QR</h3>${u.vpa ? `<p class="mut" style="margin:4px 0 12px">Customers scan to pay you. Invoices get a QR with the exact amount filled in.</p><img src="/api/code.svg?type=qr&text=${encodeURIComponent(upiLink)}" style="width:190px;height:190px;background:#fff;padding:10px;border-radius:14px;border:1px solid var(--line)"><p class="mono" style="margin:10px 0">${esc(u.vpa)}</p><div style="display:flex;gap:8px;justify-content:center"><button class="btn sm sec" id="upie">${icon('edit')}Change</button><button class="btn sm" id="stand">${icon('printer')}Print counter standee</button></div>`
      : `<p class="mut" style="margin:4px 0 14px">Add your UPI ID (from GPay, PhonePe, Paytm or your bank app) to show a pay-by-UPI QR on every invoice and at the counter.</p><button class="btn" id="upie">${icon('qr')}Add UPI ID</button>`}</div>
      <div class="card pad"><h3>How bank linking works</h3><ol class="mut" style="padding-left:18px;margin:10px 0 0;font-size:13.5px;line-height:1.7"><li><b>Statement import:</b> download a CSV from net banking and import it. Works with SBI, HDFC, ICICI, Axis, Kotak and most banks.</li><li><b>Auto-match:</b> UPI payments carry the invoice number, so they are matched and marked paid automatically. Others get one-click suggestions.</li><li><b>Live feed (optional):</b> link through RBI's Account Aggregator network (via Setu) to pull transactions without downloading files. Needs Setu keys in Settings.</li><li><b>Payment links (optional):</b> add Razorpay keys to send card/UPI/netbanking links that mark invoices paid on their own.</li></ol></div></div></div>`;
  const byId = id => A.find(a => a.id == id);
  $('#add').onclick = () => accountForm();
  $('#tr').onclick = transferForm;
  $('#upie').onclick = upiForm;
  $('#stand') && ($('#stand').onclick = () => printHTML(`<div style="text-align:center;font-family:Inter,Arial;padding:20mm 10mm;border:3px solid #059669;border-radius:10mm;width:150mm;margin:10mm auto"><div style="font-size:12mm;font-weight:800;color:#065f46">Scan & Pay</div><div style="font-size:7mm;margin:3mm 0 8mm">${esc(state.settings.business?.name || u.payee || '')}</div><img src="/api/code.svg?type=qr&text=${encodeURIComponent(upiLink)}" style="width:100mm;height:100mm"><div style="font-size:6mm;margin-top:6mm;font-family:monospace">${esc(u.vpa)}</div><div style="font-size:5mm;margin-top:4mm;color:#555">GPay · PhonePe · Paytm · BHIM · any UPI app</div></div>`));
  $$('[data-edit]').forEach(b => b.onclick = () => accountForm(byId(b.dataset.edit)));
  $$('[data-imp]').forEach(b => b.onclick = () => importStatement(byId(b.dataset.imp)));
  $$('[data-aa]').forEach(b => b.onclick = () => aaLink(byId(b.dataset.aa)));
  $$('[data-hist]').forEach(b => b.onclick = () => accountHistory(byId(b.dataset.hist)));
  $$('[data-unarch]').forEach(b => b.onclick = async () => { await post(`/accounts/${b.dataset.unarch}/archive`, { archived: 0 }); go('/banking'); });
});

function upiForm() {
  const u = state.settings.upi || {};
  if (!owner()) return toast('Only the owner can change the UPI ID', 'err');
  drawer({
    title: 'UPI ID', body: `${fld('UPI ID (VPA)', inp('vpa', u.vpa, 'placeholder="shopname@okhdfcbank" class="mono" required autocapitalize="off"'), 'Find it in your UPI app under profile. Use a business/merchant UPI ID if you have one.')}${fld('Name shown to the payer', inp('payee', u.payee || state.settings.business?.name))}`,
    onSubmit: async d => {
      await put('/settings/upi', d); state.settings = await api('/settings');
      if (!state.accounts.some(a => a.type === 'upi' && a.upi === d.vpa) && !state.accounts.some(a => a.type === 'bank')) await post('/accounts', { name: 'UPI ' + d.vpa, type: 'upi', upi: d.vpa });
      toast('UPI ID saved'); go('/banking');
    },
  });
}

export function accountForm(a = { type: 'bank' }) {
  const { el } = drawer({
    title: a.id ? 'Edit ' + a.name : 'Add account',
    body: `${fld('Type', sel('type', Object.entries(TYPE).map(([k, v]) => [k, v[1]]), a.type))}
      <div data-t="bank"><div class="grid2">${fld('IFSC code', `<div style="display:flex;gap:6px"><input name="ifsc" value="${esc(a.ifsc || '')}" class="mono" maxlength="11" style="text-transform:uppercase" placeholder="SBIN0001234"><button type="button" class="btn sec" id="look">Find</button></div>`, '<span id="ifr">We fill in the bank and branch.</span>')}${fld('Account number', inp('acno', a.acno, 'inputmode="numeric" class="mono"'))}</div>
        <div class="grid2">${fld('Bank', inp('bank', a.bank))}${fld('Branch', inp('branch', a.branch))}</div></div>
      <div data-t="upi">${fld('UPI ID', inp('upi', a.upi, 'class="mono" placeholder="name@bank"'), 'Payments to this UPI ID will be recorded in this account.')}</div>
      ${fld('Display name', inp('name', a.name, 'required placeholder="e.g. HDFC Current"'))}
      ${fld('Balance today (₹)', inp('opening', a.opening ?? 0, 'type="number" step="any"'), a.id ? 'Opening balance before any recorded entries.' : 'What the account has right now. Entries you record are added to this.')}
      <label class="check"><input type="checkbox" name="is_default" ${a.is_default ? 'checked' : ''}> Default account for this payment type</label>`,
    onOpen: el => {
      const t = () => $$('[data-t]', el).forEach(x => x.style.display = x.dataset.t === el.type.value ? '' : 'none');
      el.type.onchange = t; t();
      const look = async () => {
        const c = el.ifsc.value.trim().toUpperCase(); if (c.length !== 11) return;
        try { const r = await api('/bank/ifsc/' + c); el.bank.value = r.bank; el.branch.value = r.branch; $('#ifr', el).innerHTML = `<span class="pos">${icon('check')} ${esc(r.bank)}, ${esc(r.branch)}, ${esc(r.city)}</span>`; if (!el.name.value) el.name.value = r.bank.split(' ')[0] + ' ' + (el.acno.value ? el.acno.value.slice(-4) : ''); }
        catch (e) { $('#ifr', el).innerHTML = `<span class="neg">${esc(e.message)}</span>`; }
      };
      $('#look', el).onclick = look; el.ifsc.onblur = look;
    },
    onSubmit: async d => { await post('/accounts', { ...d, id: a.id }); await refreshAccounts(); toast('Account saved'); go('/banking'); },
    foot: a.id ? `<button type="button" class="btn danger" id="arch">${icon('archive')}Archive</button>` : '',
  });
  $('#arch', el) && ($('#arch', el).onclick = async () => { await post(`/accounts/${a.id}/archive`); await refreshAccounts(); toast('Archived'); go('/banking'); });
}

function importStatement(a) {
  let text = null;
  drawer({
    title: 'Import statement: ' + a.name, submit: `${icon('upload')} Import`,
    body: `<div class="alert tone-i">${icon('file')}<div><b>Download a CSV from your net banking</b>Usually under Accounts → Statement → Download → CSV / Excel. If you only get Excel, open it and Save As CSV.</div></div>${fld('Statement file (.csv)', '<input type="file" accept=".csv,.txt,text/csv" id="f" data-skip>')}<div id="pv" class="mut"></div><p class="mut" style="font-size:12.5px">Lines already imported are skipped, so you can import overlapping statements safely.</p>`,
    onOpen: el => { $('#f', el).onchange = async e => { text = await readFile(e.target.files[0]); $('#pv', el).textContent = `${text.split('\n').length} lines read.`; }; },
    onSubmit: async () => {
      if (!text) throw new Error('Choose the CSV file first.');
      const r = await post(`/bank/${a.id}/import`, { text });
      toast(`${r.added} new lines · ${r.linked + r.recorded} matched automatically`);
      await refreshAccounts(); badgeCount();
      go('/banking/' + a.id);
    },
  });
}

async function aaLink(a) {
  if (a.aa_status === 'ACTIVE' || a.aa_status === 'PENDING') {
    try { toast('Syncing with your bank…'); const r = await post(`/bank/${a.id}/aa/sync`); if (r.message) return toast(r.message, 'err'); toast(`${r.added} new transactions, ${r.linked + r.recorded} matched`); await refreshAccounts(); return go('/banking/' + a.id); }
    catch (e) { return toast(e.message, 'err'); }
  }
  drawer({
    title: 'Link live bank feed', submit: 'Continue to approve',
    body: `<div class="alert tone-i">${icon('shield')}<div><b>RBI Account Aggregator</b>Your bank shares read-only statements after you approve in an AA app (OneMoney, Finvu, CAMS etc). No passwords are shared with this app, and you can revoke consent anytime.</div></div>
      ${fld('Mobile number linked to this bank account', inp('mobile', '', 'type="tel" inputmode="numeric" maxlength="10" required'))}
      <p class="mut" style="font-size:12.5px">Requires a Setu Account Aggregator (FIU) account. The owner adds the keys under Settings → Integrations. Until then, use statement import.</p>`,
    onSubmit: async d => { const r = await post(`/bank/${a.id}/aa/consent`, d); window.open(r.url, '_blank', 'noopener'); toast('Approve the request in the window that opened, then press "Sync live feed".'); await refreshAccounts(); go('/banking'); },
  });
}

async function accountHistory(a) {
  const r = await api(`/accounts/${a.id}/entries`);
  const rows = [...r.payments.map(p => ({ date: p.date, what: `${p.ref || ''}${p.party ? ' · ' + p.party : ''}`, m: p.method + (p.utr ? ' ' + p.utr : ''), amt: p.dir === 'in' ? p.amt : -p.amt, x: p.x })), ...r.transfers.map(t => ({ date: t.date, what: `Transfer ${t.fromName} → ${t.toName}${t.note ? ' · ' + t.note : ''}`, m: '', amt: t.to_acc === a.id ? t.amt : -t.amt, x: t.x }))].sort((x, y) => x.date < y.date ? 1 : -1);
  drawer({ title: a.name + ': entries', wide: true, body: rows.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Details</th><th>Method</th><th class="n">Amount</th></tr></thead><tbody>${rows.map(x => `<tr style="${x.x ? 'opacity:.45;text-decoration:line-through' : ''}"><td>${fd(x.date)}</td><td>${esc(x.what)}</td><td>${esc(x.m)}</td><td class="n ${x.amt > 0 ? 'pos' : 'neg'}">${x.amt > 0 ? '+' : ''}${fmt(x.amt)}</td></tr>`).join('')}</tbody></table></div>` : empty('history', 'No entries yet') });
}

function transferForm() {
  drawer({
    title: 'Move money between accounts',
    body: `<div class="grid2">${fld('From', sel('from_acc', accountOpts(), state.accounts.find(a => a.type === 'cash')?.id))}${fld('To', sel('to_acc', accountOpts(), state.accounts.find(a => a.type === 'bank')?.id))}</div><div class="grid2">${fld('Amount (₹)', inp('amt', '', 'type="number" step="any" min="0" required'))}${fld('Date', inp('date', today(), 'type="date"'))}</div>${fld('Note', inp('note', '', 'placeholder="e.g. Cash deposited at branch"'))}`,
    onSubmit: async d => { await post('/transfers', d); await refreshAccounts(); toast('Transfer recorded'); go(location.hash.slice(1)); },
  });
}

// ---------- reconcile ----------
route('/banking/:id', async (v, id, q) => {
  const st = q.status || 'unmatched';
  const [r, open] = await Promise.all([api(`/bank/${id}/txns?status=${st}`), api('/open-items')]);
  const a = state.accounts.find(x => x.id == id) || (await refreshAccounts()).find(x => x.id == id);
  const s = r.summary, diff = s.statement != null ? s.statement - s.app : null;
  v.innerHTML = `<div class="ph" style="margin-bottom:12px"><a class="btn ghost sm" href="#/banking">${icon('back')}Bank & UPI</a></div>
  <div class="ph"><div class="t"><h1>Reconcile ${esc(a.name)}</h1><p>Match each statement line to an invoice, bill or expense. Matched lines are recorded as payments.</p></div><div class="acts"><button class="btn sec" id="auto">${icon('zap')}Auto-match</button><button class="btn" id="imp">${icon('upload')}Import statement</button></div></div>
  <div class="kpis"><div class="kpi"><div class="k">Balance in app</div><b>${fmt(s.app)}</b></div><div class="kpi"><div class="k">Bank statement says</div><b>${s.statement != null ? fmt(s.statement) : '—'}</b><small>${s.stmtDate ? 'as of ' + fd(s.stmtDate) : 'import a statement'}</small></div><div class="kpi ${diff && Math.abs(diff) > 0.5 ? '' : 'hero'}"><div class="k">Difference</div><b class="${diff && Math.abs(diff) > 0.5 ? 'warn' : ''}">${diff == null ? '—' : fmt(diff)}</b><small>${diff == null ? '' : Math.abs(diff) <= 0.5 ? 'Fully reconciled' : 'Clear the unmatched lines below'}</small></div><div class="kpi"><div class="k">To review</div><b>${s.counts.unmatched || 0}</b><small>${s.counts.matched || 0} matched · ${s.counts.ignored || 0} ignored</small></div></div>
  <div class="tabs">${[['unmatched', 'To review'], ['matched', 'Matched'], ['ignored', 'Ignored'], ['all', 'All']].map(([k, l]) => `<button data-s="${k}" class="${k === st ? 'on' : ''}">${l}${s.counts[k] ? `<span class="cnt">${s.counts[k]}</span>` : ''}</button>`).join('')}</div>
  ${r.txns.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Narration</th><th class="n">Amount</th><th>${st === 'unmatched' ? 'Match to' : 'Status'}</th></tr></thead><tbody>${r.txns.map(t => `<tr><td>${fd(t.date)}</td><td style="white-space:normal;max-width:380px"><div>${esc(t.narration)}</div>${t.ref ? `<span class="sub mono">${esc(t.ref)}</span>` : ''}</td><td class="n"><b class="${t.amount > 0 ? 'pos' : 'neg'}">${t.amount > 0 ? '+' : ''}${fmt(t.amount)}</b></td>
    <td style="white-space:normal">${t.status === 'unmatched' ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${(t.suggestions || []).map(sg => `<button class="btn sm ${sg.score >= 5 ? '' : 'sec'}" data-m="${t.id}" data-rt="${sg.ref_type}" data-ri="${sg.id}">${icon('check')}${esc(sg.no)} · ${esc(sg.party)} · ${fmt(sg.bal, 0)}</button>`).join('')}<button class="btn sm ghost" data-pick="${t.id}">${icon('search')}Find</button>${t.amount < 0 ? `<button class="btn sm ghost" data-exp="${t.id}">${icon('wallet')}Expense</button>` : ''}<button class="btn sm ghost" data-ign="${t.id}">Ignore</button></div>`
      : `${badge(t.status)} ${t.matched_to ? `<span class="mut">${esc(t.matched_to)}</span>` : ''} <button class="btn sm ghost" data-undo="${t.id}">${icon('undo')}</button>`}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="card">${empty(st === 'unmatched' ? 'check' : 'bank', st === 'unmatched' ? (s.counts.matched ? 'All caught up' : 'No statement lines yet') : 'Nothing here', st === 'unmatched' && !s.counts.matched ? 'Import a CSV statement from your net banking to start.' : '')}</div>`}`;
  const reload = () => { refreshAccounts().then(badgeCount); go(`/banking/${id}?status=${st}`); };
  $$('[data-s]').forEach(b => b.onclick = () => go(`/banking/${id}?status=${b.dataset.s}`));
  $('#imp').onclick = () => importStatement(a);
  $('#auto').onclick = async () => { const x = await post(`/bank/${id}/automatch`); toast(`${x.linked + x.recorded} matched`); reload(); };
  $$('[data-m]').forEach(b => b.onclick = async () => { try { const x = await post(`/bank/txns/${b.dataset.m}/match`, { ref_type: b.dataset.rt, ref_id: b.dataset.ri }); toast(x.partial ? 'Matched (part of this line)' : 'Matched and recorded'); reload(); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-ign]').forEach(b => b.onclick = async () => { await post(`/bank/txns/${b.dataset.ign}/status`, { status: 'ignored' }); reload(); });
  $$('[data-undo]').forEach(b => b.onclick = async () => { const t = r.txns.find(x => x.id == b.dataset.undo); if (t.status === 'matched' && t.payment_id) { if (!await confirmBox('Unmatch this line? The payment recorded from it will be cancelled.', { danger: true, ok: 'Unmatch' })) return; await post(`/payments/${t.payment_id}/cancel`); } else await post(`/bank/txns/${t.id}/status`, { status: 'unmatched' }); reload(); });
  $$('[data-exp]').forEach(b => b.onclick = () => { const t = r.txns.find(x => x.id == b.dataset.exp); drawer({ title: 'Record as expense', body: `<p class="mut">${esc(t.narration)} · <b class="neg">${fmt(t.amount)}</b></p>${fld('Category', sel('cat', EXP_CATS, 'Other'))}${fld('Description', inp('descr', t.narration.slice(0, 60)))}`, onSubmit: async d => { await post(`/bank/txns/${t.id}/expense`, d); toast('Expense recorded'); reload(); } }); });
  $$('[data-pick]').forEach(b => b.onclick = () => {
    const t = r.txns.find(x => x.id == b.dataset.pick), L = t.amount > 0 ? open.recv : open.pay;
    drawer({ title: 'Match to…', body: `<p class="mut">${esc(t.narration)} · <b>${fmt(t.amount)}</b></p>${L.length ? `<div class="tw"><table><tbody>${L.map(d => `<tr class="click" data-rt="${d.ref_type}" data-ri="${d.id}"><td><b>${esc(d.no)}</b><span class="sub">${esc(d.party)} · ${fd(d.date)}</span></td><td class="n">${fmt(d.bal)} due</td></tr>`).join('')}</tbody></table></div>` : empty('search', `No open ${t.amount > 0 ? 'invoices' : 'bills or expenses'}`)}`, onOpen: el => $$('tr[data-rt]', el).forEach(tr => tr.onclick = async () => { try { await post(`/bank/txns/${t.id}/match`, { ref_type: tr.dataset.rt, ref_id: tr.dataset.ri }); toast('Matched'); reload(); } catch (e) { toast(e.message, 'err'); } }) });
  });
});

// ---------- payments ----------
export async function paymentForm(dir, pre = {}) {
  const open = await api('/open-items'), L = (dir === 'in' ? open.recv : open.pay).filter(d => !pre.party || d.party_id === pre.party);
  if (!L.length) return dialog(`${empty('check', 'Nothing pending', dir === 'in' ? 'No customer has an unpaid invoice.' : 'No unpaid bills or expenses.')}<div class="f"><button class="btn" data-x>OK</button></div>`);
  const first = L.find(d => d.ref_type === (pre.ref_type || d.ref_type) && d.id == pre.id) || L[0];
  drawer({
    title: dir === 'in' ? 'Receive payment' : 'Make payment', submit: 'Record payment',
    body: `${fld(dir === 'in' ? 'Against invoice' : 'Against bill / expense', `<select name="ref">${L.map(d => `<option value="${d.ref_type}:${d.id}" data-b="${d.bal}"${d === first ? ' selected' : ''}>${esc(d.no)} · ${esc(d.party)} · ${fmt(d.bal)} due</option>`).join('')}</select>`)}
      <div class="grid2">${fld('Amount (₹)', inp('amt', first.bal, 'type="number" step="any" min="0" required'))}${fld('Date', inp('date', today(), 'type="date"'))}</div>
      <div class="grid2">${fld('Method', sel('method', METHODS, dir === 'in' ? 'upi' : 'bank'))}${fld('Account', sel('account_id', [['', 'Automatic'], ...accountOpts()]))}</div>
      ${fld('UPI / bank reference', inp('utr', '', 'placeholder="UTR, cheque no. (optional)"'))}${fld('Note', inp('note'))}`,
    onOpen: el => { el.ref.onchange = () => el.amt.value = el.ref.selectedOptions[0].dataset.b; },
    onSubmit: async d => { const [ref_type, ref_id] = d.ref.split(':'); await post('/payments', { ...d, ref_type, ref_id }); await refreshAccounts(); toast('Payment recorded'); go(location.hash.slice(1) || '/'); },
  });
}

// ---------- expenses ----------
export function expenseForm(pre = {}) {
  drawer({
    title: 'Add expense', submit: 'Save expense',
    body: `${fld('What is it for?', inp('descr', pre.descr, 'required placeholder="e.g. Shop rent October"'))}<div class="grid2">${fld('Category', sel('cat', EXP_CATS, pre.cat || 'Other'))}${fld('Date', inp('date', today(), 'type="date"'))}</div>
      <div class="grid2">${fld('Amount (₹)', inp('total', pre.total, 'type="number" step="any" min="0" required'))}${fld('Paid now (₹)', `<div style="display:flex;gap:6px"><input name="paid" type="number" step="any" min="0" value="0"><button type="button" class="btn sec sm" style="height:40px" id="full">Full</button></div>`)}</div>
      <div class="grid2">${fld('Method', sel('method', METHODS, 'cash'))}${fld('Account', sel('account_id', [['', 'Automatic'], ...accountOpts()]))}</div>
      <div class="grid2">${fld('Paid to', inp('payee'))}${fld('Due date (if unpaid)', inp('due', '', 'type="date"'))}</div>
      <label class="check"><input type="checkbox" name="repeat"> Repeat this every month</label>`,
    onOpen: el => { $('#full', el).onclick = () => el.paid.value = el.total.value; },
    onSubmit: async d => {
      await post('/expenses', d);
      if (d.repeat) { const n = new Date(d.date + 'T00:00'); n.setMonth(n.getMonth() + 1); await post('/recurring', { descr: d.descr, cat: d.cat, amount: d.total, payee: d.payee, freq: 'monthly', next_date: n.toISOString().slice(0, 10) }); }
      await refreshAccounts(); toast('Expense saved'); go(location.hash.slice(1) || '/');
    },
  });
}

route('/expenses', async (v, q) => {
  const tab = q.tab || 'list';
  const [E, R] = await Promise.all([api('/expenses'), api('/recurring')]);
  const month = today().slice(0, 7), mt = E.filter(e => !e.x && e.date.startsWith(month)).reduce((t, e) => t + e.total, 0), unpaid = E.filter(e => !e.x).reduce((t, e) => t + e.bal, 0);
  v.innerHTML = `<div class="ph"><div class="t"><h1>Expenses</h1><p>${fmt(mt, 0)} this month · <span class="${unpaid ? 'warn' : ''}">${fmt(unpaid, 0)} unpaid</span> · ${R.filter(r => r.active).length} recurring</p></div><div class="acts"><button class="btn sec" id="exp">${icon('download')}Export</button>${tab === 'rec' ? `<button class="btn" id="addr">${icon('plus')}Add recurring</button>` : `<button class="btn" id="add">${icon('plus')}Add expense</button>`}</div></div>
    <div class="tabs"><button data-t="list" class="${tab === 'list' ? 'on' : ''}">All expenses</button><button data-t="rec" class="${tab === 'rec' ? 'on' : ''}">${icon('repeat')}Recurring</button></div><div id="body"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => go('/expenses?tab=' + b.dataset.t));
  $('#exp').onclick = () => download(`expenses-${today()}.csv`, csv([['Date', 'Description', 'Category', 'Paid to', 'Amount', 'Unpaid', 'Cancelled'], ...E.map(e => [e.date, e.descr, e.cat, e.payee, e.total, e.bal, e.x ? 'yes' : ''])]));
  if (tab === 'rec') {
    $('#body').innerHTML = `<div class="alert tone-i">${icon('repeat')}<div><b>Set it and forget it</b>Rent, salaries and subscriptions are added as unpaid bills on their due date, show up in the cash-flow forecast, and can be matched to your bank statement.</div></div>` + (R.length ? `<div class="tw"><table><thead><tr><th>Expense</th><th>Category</th><th>Repeats</th><th>Next on</th><th class="n">Amount</th><th></th></tr></thead><tbody>${R.map(r => `<tr style="${r.active ? '' : 'opacity:.5'}"><td><b>${esc(r.descr)}</b>${r.payee ? `<span class="sub">${esc(r.payee)}</span>` : ''}</td><td>${esc(r.cat)}</td><td>${esc(r.freq)}</td><td>${r.active ? fd(r.next_date) : 'stopped'}</td><td class="n">${fmt(r.amount)}</td><td class="n">${r.active ? `<button class="btn sm ghost" data-ed="${r.id}">${icon('edit')}</button><button class="btn sm ghost" data-stop="${r.id}">Stop</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('repeat', 'No recurring expenses', 'Add rent, salaries, internet and other fixed costs.')}</div>`);
    const recForm = (r = { freq: 'monthly', next_date: today() }) => drawer({ title: r.id ? 'Edit recurring expense' : 'Add recurring expense', body: `${fld('What', inp('descr', r.descr, 'required placeholder="Shop rent"'))}<div class="grid2">${fld('Category', sel('cat', EXP_CATS, r.cat || 'Rent'))}${fld('Amount (₹)', inp('amount', r.amount, 'type="number" step="any" min="0" required'))}</div><div class="grid2">${fld('Repeats', sel('freq', [['weekly', 'Every week'], ['monthly', 'Every month'], ['quarterly', 'Every 3 months'], ['yearly', 'Every year']], r.freq))}${fld('Next due on', inp('next_date', r.next_date, 'type="date"'))}</div>${fld('Paid to', inp('payee', r.payee))}`, onSubmit: async d => { await post('/recurring', { ...d, id: r.id }); toast('Saved'); go('/expenses?tab=rec'); } });
    $('#addr').onclick = () => recForm();
    $$('[data-ed]').forEach(b => b.onclick = () => recForm(R.find(r => r.id == b.dataset.ed)));
    $$('[data-stop]').forEach(b => b.onclick = async () => { await post(`/recurring/${b.dataset.stop}/delete`); go('/expenses?tab=rec'); });
    return;
  }
  $('#add').onclick = () => expenseForm();
  $('#body').innerHTML = `<div class="toolbar"><div class="inwrap">${icon('search')}<input id="q" placeholder="Search expenses"></div><select id="c"><option value="">All categories</option>${EXP_CATS.map(c => `<option>${c}</option>`).join('')}</select></div><div id="list"></div>`;
  let qq = '', cat = '';
  const draw = () => {
    const L = E.filter(e => (!cat || e.cat === cat) && (!qq || (e.descr + ' ' + e.payee).toLowerCase().includes(qq)));
    $('#list').innerHTML = L.length ? `<div class="tw"><table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="n">Amount</th><th class="n">Unpaid</th><th></th></tr></thead><tbody>${L.map(e => `<tr style="${e.x ? 'opacity:.45' : ''}"><td>${fd(e.date)}</td><td><b>${esc(e.descr)}</b>${e.payee ? `<span class="sub">${esc(e.payee)}</span>` : ''}${e.recurring_id ? ' ' + badge('auto', 'b-b') : ''}</td><td><span class="badge plain">${esc(e.cat)}</span></td><td class="n">${fmt(e.total)}</td><td class="n ${e.bal > 0 ? 'warn' : 'mut'}">${e.x ? 'cancelled' : e.bal > 0 ? fmt(e.bal) + (e.due ? `<span class="sub ${e.due < today() ? 'neg' : ''}">due ${fd(e.due)}</span>` : '') : 'paid'}</td><td class="n">${!e.x && e.bal > 0 ? `<button class="btn sm" data-pay="${e.id}">Pay</button>` : ''}${!e.x ? `<button class="btn sm ghost" data-cx="${e.id}" title="Cancel">${icon('x')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('wallet', 'No expenses', 'Record rent, salaries, bills and other costs to see true profit.')}</div>`;
    $$('[data-pay]').forEach(b => b.onclick = () => paymentForm('out', { ref_type: 'expense', id: +b.dataset.pay }));
    $$('[data-cx]', $('#list')).forEach(b => b.onclick = async () => { if (!await confirmBox('Cancel this expense? Its payment is reversed too.', { danger: true, ok: 'Cancel expense' })) return; await post(`/expenses/${b.dataset.cx}/cancel`); await refreshAccounts(); go('/expenses'); });
  };
  $('#q').oninput = debounce(() => { qq = $('#q').value.toLowerCase(); draw(); });
  $('#c').onchange = e => { cat = e.target.value; draw(); };
  draw();
});
