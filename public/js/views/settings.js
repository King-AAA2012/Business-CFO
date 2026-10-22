import { $, $$, api, post, put, route, state, icon, esc, fd, badge, empty, fld, inp, sel, drawer, toast, go, owner, readFile, shrinkImage, confirmBox } from '../core.js';
import { stateSelect } from './parties.js';

const TABS = [['business', 'Business'], ['invoice', 'Invoices'], ['users', 'Staff'], ['integrations', 'Integrations'], ['ai', 'AI'], ['data', 'Backup'], ['log', 'Activity log']];

route('/settings', async (v, q) => {
  const tab = q.tab || 'business', S = state.settings = await api('/settings'), own = owner();
  v.innerHTML = `<div class="ph"><div class="t"><h1>Settings</h1><p>${own ? 'Business details appear on invoices and labels.' : 'Some settings can only be changed by the owner.'}</p></div></div>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="b" style="max-width:820px"></div>`;
  $$('[data-t]').forEach(b => b.onclick = () => go('/settings?tab=' + b.dataset.t));
  const b = $('#b'), dis = own ? '' : 'disabled';
  const form = (k, html, after) => {
    b.innerHTML = `<form class="card pad" id="sf">${html}${own ? `<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:6px"><span class="err neg" style="flex:1"></span><button class="btn">Save</button></div>` : ''}</form>`;
    $('#sf').onsubmit = async e => {
      e.preventDefault();
      const d = {}; for (const el of e.target.elements) if (el.name) d[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      try { await put('/settings/' + k, after ? after(d) : d); state.settings = await api('/settings'); toast('Saved'); } catch (x) { $('.err', b).textContent = x.message; }
    };
  };
  if (tab === 'business') {
    const B = S.business; let logo = B.logo || '';
    form('business', `<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px"><label class="prod-img" style="width:84px;height:84px;cursor:pointer" title="Logo"><span id="lg" style="display:contents">${logo ? `<img src="${esc(logo)}" style="object-fit:contain">` : icon('image')}</span><input type="file" accept="image/*" hidden id="lf" ${dis}></label><div style="flex:1">${fld('Business name', inp('name', B.name, 'required ' + dis))}</div></div>
      <div class="grid2">${fld('Legal name (if different)', inp('legal', B.legal, dis))}${fld('GSTIN', inp('gstin', B.gstin, 'class="mono" maxlength="15" style="text-transform:uppercase" ' + dis), 'Leave empty if not registered; invoices then say "Invoice" instead of "Tax Invoice".')}</div>
      <div class="grid2">${fld('State', stateSelect('state', B.state).replace('<select', '<select ' + dis), 'Used to decide CGST+SGST vs IGST.')}${fld('PAN', inp('pan', B.pan, 'class="mono" maxlength="10" ' + dis))}</div>
      <div class="grid2">${fld('Phone', inp('phone', B.phone, dis))}${fld('Email', inp('email', B.email, dis))}</div>${fld('Address', `<textarea name="address" rows="3" ${dis}>${esc(B.address)}</textarea>`)}`, d => ({ ...d, logo }));
    $('#lf').onchange = async e => { logo = await shrinkImage(e.target.files[0], 300); $('#lg').innerHTML = `<img src="${logo}" style="object-fit:contain">`; };
  }
  if (tab === 'invoice') {
    const I = S.invoice;
    form('invoice', `${fld('Invoice number prefix', inp('prefix', I.prefix, 'class="mono" ' + dis), 'e.g. INV-, SHOP/25-26/. Numbers continue from the last invoice.')}
      <label class="check"><input type="checkbox" name="pricesIncludeGst" ${I.pricesIncludeGst ? 'checked' : ''} ${dis}> Selling prices already include GST (MRP-style pricing)</label>
      <label class="check"><input type="checkbox" name="roundOff" ${I.roundOff !== false ? 'checked' : ''} ${dis}> Round invoice totals to the nearest rupee</label>
      ${fld('Terms printed on invoices', `<textarea name="terms" rows="2" ${dis}>${esc(I.terms)}</textarea>`)}${fld('Footer / thank-you line', inp('footer', I.footer, dis))}`);
  }
  if (tab === 'users') {
    if (!own) { b.innerHTML = `<div class="card">${empty('shield', 'Owner only', 'Ask the owner to manage staff.')}</div>`; return pwBox(); }
    const U = await api('/users');
    b.innerHTML = `<div class="card"><div class="card-h"><h3>People who can sign in</h3><button class="btn sm" id="nu">${icon('plus')}Add staff</button></div><div class="card-b">${U.map(u => `<div class="list-i"><div class="avatar" style="width:34px;height:34px">${esc(u.name[0])}</div><div class="m"><b>${esc(u.name)} ${u.id === state.me.id ? '<span class="mut">(you)</span>' : ''}</b><small>@${esc(u.username)} · ${u.role === 'owner' ? 'Owner: everything' : 'Staff: billing, stock, payments; no settings or backups'}</small></div>${u.active ? badge(u.role === 'owner' ? 'Owner' : 'Staff', u.role === 'owner' ? 'b-g' : 'b-b') : badge('Disabled', 'b-r')}${u.id !== state.me.id ? `<button class="btn sm ghost" data-rs="${u.id}">Reset password</button><button class="btn sm ghost" data-tg="${u.id}" data-a="${u.active}">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</div>`).join('')}</div></div><div id="pw" style="margin-top:18px"></div>`;
    $('#nu').onclick = () => drawer({ title: 'Add staff member', body: `${fld('Name', inp('name', '', 'required'))}<div class="grid2">${fld('Username', inp('username', '', 'required autocapitalize="off"'))}${fld('Password', inp('password', '', 'type="password" required minlength="6" autocomplete="new-password"'))}</div>${fld('Role', sel('role', [['staff', 'Staff'], ['owner', 'Owner (full access)']], 'staff'))}`, onSubmit: async d => { await post('/users', d); toast('Staff added'); go('/settings?tab=users'); } });
    $$('[data-rs]').forEach(x => x.onclick = () => drawer({ title: 'Set new password', body: fld('New password', inp('password', '', 'type="password" required minlength="6" autocomplete="new-password"')), onSubmit: async d => { await api('/users/' + x.dataset.rs, { method: 'PATCH', body: d }); toast('Password changed'); } }));
    $$('[data-tg]').forEach(x => x.onclick = async () => { await api('/users/' + x.dataset.tg, { method: 'PATCH', body: { active: x.dataset.a === '1' ? 0 : 1 } }); go('/settings?tab=users'); });
    return pwBox();
  }
  if (tab === 'integrations') {
    if (!own) { b.innerHTML = `<div class="card">${empty('shield', 'Owner only')}</div>`; return; }
    const R = S.razorpay, T = S.setu;
    b.innerHTML = `<form class="card pad" id="rz" style="margin-bottom:18px"><h3>${icon('link')} Razorpay payment links</h3><p class="mut" style="margin:4px 0 14px">Send customers a link to pay by UPI, card or netbanking. Paid links mark the invoice paid. Get keys at dashboard.razorpay.com → Account & Settings → API keys.</p>
      <div class="grid2">${fld('Key ID', inp('keyId', R.keyId, 'class="mono" autocomplete="off"'))}${fld('Key secret', inp('keySecret', R.keySecret, 'type="password" autocomplete="new-password" class="mono"'))}</div>
      ${fld('Webhook secret (optional)', inp('webhookSecret', R.webhookSecret, 'type="password" autocomplete="new-password" class="mono"'), `For instant updates, add a webhook for <span class="mono">payment_link.paid</span> pointing to <span class="mono">https://YOUR-PUBLIC-URL/api/webhooks/razorpay</span>. Without it, press “Check online payment” on the invoice.`)}<div style="text-align:right"><button class="btn">Save</button></div></form>
      <form class="card pad" id="st"><h3>${icon('bank')} Live bank feed (Account Aggregator via Setu)</h3><p class="mut" style="margin:4px 0 14px">Pull bank transactions directly through RBI's Account Aggregator network. Needs an FIU account with Setu (bridge.setu.co). Use sandbox keys to try it.</p>
      <div class="grid2">${fld('Client ID', inp('clientId', T.clientId, 'class="mono" autocomplete="off"'))}${fld('Client secret', inp('clientSecret', T.clientSecret, 'type="password" autocomplete="new-password" class="mono"'))}</div>
      <div class="grid2">${fld('Product instance ID', inp('productInstanceId', T.productInstanceId, 'class="mono"'))}${fld('Environment', sel('env', [['sandbox', 'Sandbox (testing)'], ['production', 'Production']], T.env))}</div><div style="text-align:right"><button class="btn">Save</button></div></form>`;
    const save = (id, k) => $('#' + id).onsubmit = async e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.target)); try { await put('/settings/' + k, d); toast('Saved'); } catch (x) { toast(x.message, 'err'); } };
    save('rz', 'razorpay'); save('st', 'setu');
  }
  if (tab === 'ai') {
    const A = S.ai, models = await api('/ollama/models');
    form('ai', `<p class="mut" style="margin:0 0 14px">The AI CFO runs on <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> on this computer, so your figures never go to the internet. ${models.length ? `<span class="pos">${icon('check')} Ollama found with ${models.length} model(s).</span>` : '<span class="warn">Ollama not detected. Install it and run <span class="mono">ollama pull llama3.1</span>.</span>'}</p>
      ${fld('Ollama address', inp('ollamaUrl', A.ollamaUrl, 'class="mono" ' + dis))}${fld('Model', sel('model', [['', 'Off (use built-in calculated answers)'], ...models.map(m => [m, m]), ...(A.model && !models.includes(A.model) ? [[A.model, A.model + ' (not found)']] : [])], A.model, dis))}`);
  }
  if (tab === 'data') {
    b.innerHTML = `<div class="card pad" style="margin-bottom:18px"><h3>${icon('download')} Backup</h3><p class="mut" style="margin:4px 0 14px">Download everything (products, bills, payments, settings) as one file. Keep a copy on Google Drive or a pen drive every week.</p>${own ? `<a class="btn" href="/api/backup" download>${icon('download')}Download backup</a>` : '<span class="mut">Owner only.</span>'}</div>
      <div class="card pad"><h3>${icon('upload')} Restore</h3><p class="mut" style="margin:4px 0 14px">Replaces ALL current data with the backup. Download a fresh backup first.</p>${own ? `<label class="btn danger">${icon('upload')}Restore from file<input type="file" accept=".json,application/json" hidden id="rf"></label>` : '<span class="mut">Owner only.</span>'}</div>`;
    $('#rf') && ($('#rf').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      let data; try { data = JSON.parse(await readFile(f)); } catch { return toast('That file is not a valid backup', 'err'); }
      if (!await confirmBox(`Replace everything with the backup from ${data.at ? new Date(data.at).toLocaleString('en-IN') : 'this file'}? This cannot be undone.`, { danger: true, ok: 'Restore' })) return;
      try { await post('/restore', data); toast('Restored. Reloading…'); setTimeout(() => location.reload(), 900); } catch (x) { toast(x.message, 'err'); }
    });
  }
  if (tab === 'log') {
    const L = await api('/audit');
    b.innerHTML = L.length ? `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${L.map(a => `<tr><td>${new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(a.user)}</td><td style="white-space:normal">${esc(a.action)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('history', 'No activity yet')}</div>`;
  }
  function pwBox() {
    const box = $('#pw') || (b.insertAdjacentHTML('beforeend', '<div id="pw" style="margin-top:18px"></div>'), $('#pw'));
    box.innerHTML = `<form class="card pad" id="pwf"><h3>Change your password</h3><div class="grid2" style="margin-top:12px">${fld('Current password', '<input name="old" type="password" required autocomplete="current-password">')}${fld('New password', '<input name="password" type="password" required minlength="6" autocomplete="new-password">')}</div><div style="text-align:right"><button class="btn">Update password</button></div></form>`;
    $('#pwf').onsubmit = async e => { e.preventDefault(); try { await post('/auth/password', Object.fromEntries(new FormData(e.target))); toast('Password updated'); e.target.reset(); } catch (x) { toast(x.message, 'err'); } };
  }
});
