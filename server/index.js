process.removeAllListeners('warning'); // hide node:sqlite experimental notice
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { DATA } = require('./db');
const auth = require('./auth');
const bank = require('./routes/bank');
const { runRecurring } = require('./routes/money');

const PORT = +process.env.PORT || 4600, HTTPS_PORT = +process.env.HTTPS_PORT || 4643;
const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN' }); next(); });

app.post('/api/webhooks/razorpay', express.raw({ type: '*/*' }), bank.webhook);
app.use(express.json({ limit: '25mb' }));

// Reject cross-site writes (cookie auth + JSON API).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const o = req.headers.origin;
  if (o && new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request blocked.' });
  next();
});

auth.routes(app);
app.use('/api', auth.requireUser);
require('./routes/inventory')(app);
require('./routes/docs')(app);
require('./routes/money')(app);
bank(app);
require('./routes/reports')(app);
require('./routes/misc')(app);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('/vendor/html5-qrcode.min.js', (req, res) => res.sendFile(require.resolve('html5-qrcode/html5-qrcode.min.js')));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  const code = err.code && Number.isInteger(err.code) ? err.code : (err.type === 'entity.too.large' ? 413 : 500);
  if (code >= 500) console.error(err);
  res.status(code).json({ error: code >= 500 ? 'Something went wrong on the server: ' + err.message : err.message, confirm: err.confirm || undefined });
});

const lan = () => Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

http.createServer(app).listen(PORT, () => {
  console.log(`\n  AI Business CFO running`);
  console.log(`  This computer : http://localhost:${PORT}`);
  startHttps().catch(e => console.log('  HTTPS disabled:', e.message));
});

// Phones only allow the camera on https, so we also serve a self-signed https port for scanning on the LAN.
async function startHttps() {
  const kp = path.join(DATA, 'tls.json');
  let tls = fs.existsSync(kp) ? JSON.parse(fs.readFileSync(kp, 'utf8')) : null;
  const ips = lan();
  if (!tls || ips.some(ip => !(tls.ips || []).includes(ip))) {
    const pems = await require('selfsigned').generate([{ name: 'commonName', value: 'AI Business CFO' }], { days: 3650, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...['127.0.0.1', ...ips].map(ip => ({ type: 7, ip }))] }] });
    tls = { key: pems.private, cert: pems.cert, ips };
    fs.writeFileSync(kp, JSON.stringify(tls));
  }
  https.createServer({ key: tls.key, cert: tls.cert }, app).listen(HTTPS_PORT, () => {
    for (const ip of ips) console.log(`  Phone (scan) : https://${ip}:${HTTPS_PORT}   (accept the security warning once)`);
    console.log('');
  });
}

runRecurring();
setInterval(() => { try { runRecurring(); } catch (e) { console.error(e); } }, 36e5);
