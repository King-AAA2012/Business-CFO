// Tiny SVG charts with hover tooltips. Colours come from CSS variables so they follow the theme.
import { fmtK, fmt, fds, esc } from './core.js';

let tip;
function showTip(e, html) {
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.append(tip); }
  tip.innerHTML = html; tip.style.display = 'block';
  const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px'; tip.style.top = (e.clientY - tip.offsetHeight - 10) + 'px';
}
const hideTip = () => tip && (tip.style.display = 'none');

const nice = (max) => { if (max <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(max))), n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

// series: [{key, label, color, area}] over data rows; x label from row[xKey]
export function lineChart(el, data, series, { xKey = 'date', height = 240, xFmt = fds } = {}) {
  const W = el.clientWidth || 600, H = height, L = 48, R = 12, T = 12, B = 26;
  const vals = data.flatMap(d => series.map(s => d[s.key]));
  const max = nice(Math.max(1, ...vals)), min = Math.min(0, ...vals);
  const x = i => L + (W - L - R) * (data.length < 2 ? .5 : i / (data.length - 1)), y = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const ticks = [0, .25, .5, .75, 1].map(f => min + (max - min) * f);
  const step = Math.ceil(data.length / Math.max(2, Math.floor((W - L) / 70)));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${series.map((sr, i) => `<linearGradient id="g${i}${el.id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${sr.color}" stop-opacity=".28"/><stop offset="1" stop-color="${sr.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  s += `<g class="grid">${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmtK(t)}</text>`).join('')}</g>`;
  data.forEach((d, i) => { if (i % step === 0 || (i === data.length - 1 && i % step >= step / 2)) s +=`<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(xFmt(d[xKey]))}</text>`; });
  series.forEach((sr, si) => {
    const pts = data.map((d, i) => [x(i), y(d[sr.key])]);
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    if (sr.area) s += `<path d="${path}L${x(data.length - 1)} ${y(min)}L${x(0)} ${y(min)}Z" fill="url(#g${si}${el.id})"/>`;
    s += `<path d="${path}" fill="none" stroke="${sr.color}" stroke-width="${sr.area ? 2.4 : 1.8}" stroke-linejoin="round" stroke-linecap="round" ${sr.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
  });
  s += `<line class="hl" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--line-2)" style="display:none"/>${series.map((sr, i) => `<circle class="dot${i}" r="4.5" fill="${sr.color}" stroke="var(--surface)" stroke-width="2" style="display:none"/>`).join('')}`;
  s += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.firstChild, hl = svg.querySelector('.hl');
  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(data.length - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, data.length - 1)))));
    hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hl.style.display = '';
    series.forEach((sr, si) => { const c = svg.querySelector('.dot' + si); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(data[i][sr.key])); c.style.display = ''; });
    showTip(e, `<b>${esc(xFmt(data[i][xKey]))}</b><br>` + series.map(sr => `<span style="color:${sr.color}">●</span> ${sr.label}: ${fmt(data[i][sr.key])}`).join('<br>'));
  };
  svg.onmouseleave = () => { hideTip(); hl.style.display = 'none'; svg.querySelectorAll('circle').forEach(c => c.style.display = 'none'); };
}

export function barChart(el, data, series, { xKey = 'month', height = 240, xFmt = m => new Date(m + '-01T00:00').toLocaleDateString('en-IN', { month: 'short' }) } = {}) {
  const W = el.clientWidth || 600, H = height, L = 48, R = 8, T = 12, B = 26;
  const vals = data.flatMap(d => series.map(s => d[s.key]));
  const max = nice(Math.max(1, ...vals)), min = Math.min(0, ...vals) < 0 ? -nice(-Math.min(...vals)) : 0;
  const y = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  const gw = (W - L - R) / data.length, bw = Math.min(26, (gw - 10) / series.length);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g class="grid">${[0, .25, .5, .75, 1].map(f => { const t = min + (max - min) * f; return `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmtK(t)}</text>`; }).join('')}</g>`;
  data.forEach((d, i) => {
    const cx = L + gw * i + gw / 2;
    series.forEach((sr, si) => { const v = d[sr.key], x0 = cx - (bw * series.length) / 2 + bw * si, y0 = y(Math.max(v, 0)), h = Math.abs(y(v) - y(0)); s += `<rect data-i="${i}" x="${x0 + 1}" y="${y0}" width="${bw - 2}" height="${Math.max(h, 1)}" rx="4" fill="${v < 0 ? 'var(--danger)' : sr.color}"/>`; });
    s += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(xFmt(d[xKey]))}</text>`;
  });
  el.innerHTML = s + '</svg>';
  el.firstChild.onmousemove = e => { const i = e.target.dataset?.i; if (i == null) return hideTip(); const d = data[i]; showTip(e, `<b>${esc(xFmt(d[xKey]))}</b><br>` + series.map(sr => `<span style="color:${sr.color}">●</span> ${sr.label}: ${fmt(d[sr.key])}`).join('<br>')); };
  el.firstChild.onmouseleave = hideTip;
}

export const PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#0ea5e9', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
export function donut(el, items, { size = 170 } = {}) {
  const total = items.reduce((t, i) => t + i.value, 0) || 1, r = size / 2 - 12, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = items.map((it, i) => { const len = c * it.value / total, s = `<circle data-i="${i}" r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="20" stroke-dasharray="${Math.max(0, len - 2)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return s; }).join('');
  el.innerHTML = `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><svg class="chart" width="${size}" height="${size}" style="width:${size}px"><circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--surface-3)" stroke-width="20"/>${arcs}<text x="50%" y="48%" text-anchor="middle" style="font-size:17px;font-weight:750;fill:var(--ink)">${fmtK(total)}</text><text x="50%" y="60%" text-anchor="middle">total</text></svg><div style="flex:1;min-width:160px">${items.map((it, i) => `<div class="list-i" style="padding:6px 0"><i style="width:10px;height:10px;border-radius:3px;background:${PALETTE[i % PALETTE.length]}"></i><div class="m">${esc(it.label)}</div><b class="num">${fmt(it.value, 0)}</b><small style="width:40px;text-align:right">${Math.round(it.value / total * 100)}%</small></div>`).join('')}</div></div>`;
  el.querySelector('svg').onmousemove = e => { const i = e.target.dataset?.i; if (i == null) return hideTip(); showTip(e, `${esc(items[i].label)}: ${fmt(items[i].value)}`); };
  el.querySelector('svg').onmouseleave = hideTip;
}
export const spark = (vals, color = 'var(--brand)', w = 90, h = 28) => {
  const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
  const pts = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / (max - min || 1) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
};
