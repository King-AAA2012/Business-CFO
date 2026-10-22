import { $, $$, post, route, state, icon, esc } from '../core.js';

const chat = [];
// Minimal Markdown for model replies: bold, bullets, headings.
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/^\s*[*-]\s+/gm, '• ');
const SUGGEST = ['How much profit this month?', 'What should I reorder?', 'Who owes me money?', 'Will I run short of cash?', 'Which products make the most profit?', 'What stock is not selling?', 'How much GST do I owe?', 'Compare with last month', 'Where is my money going?', 'What is expiring soon?'];

route('/ai', async (v) => {
  const model = state.settings.ai?.model;
  v.innerHTML = `<div class="ph"><div class="t"><h1>${icon('sparkles')} AI CFO</h1><p>Ask anything about your business. Answers use your live figures${model ? ` and the local model <b>${esc(model)}</b> (Ollama)` : ''}. Nothing leaves this computer.</p></div></div>
    ${!model ? `<div class="alert tone-i">${icon('sparkles')}<div><b>Want natural-language answers and advice?</b>Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, run <span class="mono">ollama pull llama3.1</span>, then choose the model in <a href="#/settings?tab=ai">Settings → AI</a>. Until then, answers are worked out directly from your numbers.</div></div>` : ''}
    <div class="chips">${SUGGEST.map(q => `<button class="chip">${q}</button>`).join('')}</div>
    <div class="chat" id="chat"></div>
    <form id="f" style="position:sticky;bottom:16px;display:flex;gap:8px;background:var(--surface);padding:8px;border-radius:16px;border:1px solid var(--line);box-shadow:var(--shadow)"><input id="q" placeholder="Ask about profit, cash, stock, customers, GST…" style="border:0;box-shadow:none" autocomplete="off"><button class="btn">${icon('send')}</button></form>`;
  const draw = () => {
    $('#chat').innerHTML = chat.map(m => `<div class="msg ${m.me ? 'me' : 'ai'}">${m.wait ? '<span class="typing"><span></span><span></span><span></span></span>' : m.me ? esc(m.t) : md(m.t)}${!m.me && m.src ? `<small>${m.src === 'ollama' ? 'Answered by ' + esc(model) + ' from your data' : 'Calculated from your records'}</small>` : ''}</div>`).join('') || '<div class="empty" style="padding:30px"><div class="ic">' + icon('sparkles') + '</div><b>Your CFO is ready</b><p>Pick a question above or type your own.</p></div>';
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };
  const ask = async q => {
    if (!q.trim()) return;
    chat.push({ me: 1, t: q }, { wait: 1 }); draw();
    try { const r = await post('/ai', { q, history: chat.filter(m => !m.wait).slice(-8, -1) }); chat.splice(-1, 1, { t: r.answer, src: r.source }); }
    catch (e) { chat.splice(-1, 1, { t: 'Sorry, ' + e.message }); }
    draw();
  };
  $$('.chip', v).forEach(c => c.onclick = () => ask(c.textContent));
  $('#f').onsubmit = e => { e.preventDefault(); const q = $('#q').value; $('#q').value = ''; ask(q); };
  draw(); $('#q').focus();
});
