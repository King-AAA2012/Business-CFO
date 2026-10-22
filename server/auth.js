const crypto = require('crypto');
const { get, run, all, insert, setSetting } = require('./db');
const { UserError, audit } = require('./core');

const DAY = 864e5, COOKIE = 'cfo_sid';
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
function verify(pw, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c[0]))[COOKIE];

function startSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,exp) VALUES(?,?,?)', token, userId, Date.now() + 30 * DAY);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 86400}${req.secure ? '; Secure' : ''}`);
}
function currentUser(req) {
  const t = cookieOf(req);
  if (!t) return null;
  const s = get('SELECT * FROM sessions WHERE token=? AND exp>?', t, Date.now());
  return s ? get('SELECT id,name,username,role FROM users WHERE id=? AND active=1', s.user_id) : null;
}
const needsSetup = () => !get('SELECT 1 FROM users LIMIT 1');

function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: needsSetup() ? 'setup' : 'Please sign in.' });
  req.user = u;
  next();
}
const ownerOnly = (req, res, next) => req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this.' });

function routes(app) {
  app.get('/api/auth/me', (req, res) => res.json({ user: currentUser(req), setup: needsSetup() }));

  app.post('/api/auth/setup', (req, res) => {
    if (!needsSetup()) throw new UserError('Already set up.');
    const { name, username, password, business } = req.body;
    if (!name || !username || !password) throw new UserError('Fill in your name, username and password.');
    if (password.length < 6) throw new UserError('Use a password of at least 6 characters.');
    const id = insert('users', { name, username: username.toLowerCase().trim(), pass: hash(password), role: 'owner', created: new Date().toISOString() });
    if (business) setSetting('business', business);
    insert('accounts', { name: 'Cash in hand', type: 'cash', opening: 0, is_default: 1, created: new Date().toISOString() });
    audit(name, 'Business set up');
    startSession(res, req, id);
    res.json({ ok: 1 });
  });

  const tries = new Map();
  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip, t = tries.get(ip) || { n: 0, at: 0 };
    if (t.n >= 8 && Date.now() - t.at < 10 * 6e4) throw new UserError('Too many attempts. Try again in 10 minutes.', 429);
    const u = get('SELECT * FROM users WHERE username=? AND active=1', String(req.body.username || '').toLowerCase().trim());
    if (!u || !verify(String(req.body.password || ''), u.pass)) {
      tries.set(ip, { n: t.n + 1, at: Date.now() });
      throw new UserError('Wrong username or password.', 401);
    }
    tries.delete(ip);
    startSession(res, req, u.id);
    audit(u.name, 'Signed in');
    res.json({ ok: 1 });
  });

  app.post('/api/auth/logout', (req, res) => {
    run('DELETE FROM sessions WHERE token=?', cookieOf(req) || '');
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    res.json({ ok: 1 });
  });

  app.post('/api/auth/password', requireUser, (req, res) => {
    const u = get('SELECT * FROM users WHERE id=?', req.user.id);
    if (!verify(req.body.old || '', u.pass)) throw new UserError('Current password is wrong.');
    if ((req.body.password || '').length < 6) throw new UserError('Use at least 6 characters.');
    run('UPDATE users SET pass=? WHERE id=?', hash(req.body.password), u.id);
    res.json({ ok: 1 });
  });

  // staff accounts
  app.get('/api/users', requireUser, ownerOnly, (req, res) => res.json(all('SELECT id,name,username,role,active,created FROM users')));
  app.post('/api/users', requireUser, ownerOnly, (req, res) => {
    const { name, username, password, role } = req.body;
    if (!name || !username || (password || '').length < 6) throw new UserError('Name, username and a 6+ character password are needed.');
    if (get('SELECT 1 FROM users WHERE username=?', username.toLowerCase())) throw new UserError('That username is taken.');
    insert('users', { name, username: username.toLowerCase().trim(), pass: hash(password), role: role === 'owner' ? 'owner' : 'staff', created: new Date().toISOString() });
    audit(req.user.name, 'Added user ' + username);
    res.json({ ok: 1 });
  });
  app.patch('/api/users/:id', requireUser, ownerOnly, (req, res) => {
    const id = +req.params.id;
    if (id === req.user.id && req.body.active === 0) throw new UserError('You cannot disable yourself.');
    if (req.body.active != null) { run('UPDATE users SET active=? WHERE id=?', req.body.active ? 1 : 0, id); if (!req.body.active) run('DELETE FROM sessions WHERE user_id=?', id); }
    if (req.body.password) run('UPDATE users SET pass=? WHERE id=?', hash(req.body.password), id);
    if (req.body.role) run('UPDATE users SET role=? WHERE id=?', req.body.role === 'owner' ? 'owner' : 'staff', id);
    res.json({ ok: 1 });
  });
}

module.exports = { routes, requireUser, ownerOnly };
