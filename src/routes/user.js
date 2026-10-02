const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const activity = require('../services/activity');

router.use(['/dashboard', '/servers', '/account'], requireAuth);

// GET /dashboard
router.get('/dashboard', (req, res) => {
  let servers = [];
  if (req.user.is_admin) {
    servers = db.query(`
      SELECT s.*, n.name as node_name, e.name as egg_name
      FROM servers s
      LEFT JOIN nodes n ON s.node_id = n.id
      LEFT JOIN eggs e ON s.egg_id = e.id
      ORDER BY s.id DESC
    `);
  } else {
    servers = db.query(`
      SELECT s.*, n.name as node_name, e.name as egg_name
      FROM servers s
      LEFT JOIN nodes n ON s.node_id = n.id
      LEFT JOIN eggs e ON s.egg_id = e.id
      WHERE s.owner_id = ?
      ORDER BY s.id DESC
    `, [req.user.id]);
  }

  const onlineCount = servers.filter(s => s.status === 'online').length;
  const totalMemory = servers.reduce((acc, s) => acc + (s.memory_limit || 0), 0);
  const totalDisk = servers.reduce((acc, s) => acc + (s.disk_limit || 0), 0);

  res.render('user/dashboard', {
    title: 'Dashboard - Nova Panel',
    servers,
    stats: {
      totalServers: servers.length,
      onlineServers: onlineCount,
      totalMemory,
      totalDisk
    }
  });
});

// GET /servers
router.get('/servers', (req, res) => {
  res.redirect('/dashboard');
});

// GET /account
router.get('/account', (req, res) => {
  res.render('user/account', {
    title: 'Account Settings - Nova Panel',
    user: req.user,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /account
router.post('/account', async (req, res) => {
  const { first_name, last_name, email } = req.body;
  if (!email) {
    return res.redirect('/account?error=Email%20is%20required');
  }

  // Check email conflict
  const existing = db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
  if (existing) {
    return res.redirect('/account?error=Email%20already%20taken');
  }

  db.run(
    'UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?',
    [first_name || '', last_name || '', email, req.user.id]
  );

  req.session.user.first_name = first_name;
  req.session.user.last_name = last_name;
  req.session.user.email = email;

  activity.log({
    userId: req.user.id,
    event: 'account.update',
    details: 'User updated profile details'
  });

  res.redirect('/account?success=Profile%20updated%20successfully');
});

// POST /account/password
router.post('/account/password', async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    return res.redirect('/account?error=All%20password%20fields%20are%20required');
  }

  if (new_password !== confirm_password) {
    return res.redirect('/account?error=New%20passwords%20do%20not%20match');
  }

  if (new_password.length < 6) {
    return res.redirect('/account?error=Password%20must%20be%20at%20least%206%20characters');
  }

  const valid = await bcrypt.compare(current_password, req.user.password);
  if (!valid) {
    return res.redirect('/account?error=Current%20password%20is%20incorrect');
  }

  const hashed = await bcrypt.hash(new_password, 10);
  db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

  activity.log({
    userId: req.user.id,
    event: 'account.password_change',
    details: 'User changed account password'
  });

  res.redirect('/account?success=Password%20changed%20successfully');
});

// GET /account/api
router.get('/account/api', (req, res) => {
  const keys = db.query('SELECT * FROM api_keys WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.render('user/account-api', {
    title: 'API Credentials - Nova Panel',
    keys,
    newKey: req.query.newKey || null
  });
});

// POST /account/api
router.post('/account/api', (req, res) => {
  const { description } = req.body;
  const identifier = crypto.randomBytes(8).toString('hex');
  const token = 'nova_' + crypto.randomBytes(24).toString('hex');

  db.run(
    `INSERT INTO api_keys (user_id, identifier, key_token, description, permissions)
     VALUES (?, ?, ?, ?, '["*"]')`,
    [req.user.id, identifier, token, description || 'API Key']
  );

  activity.log({
    userId: req.user.id,
    event: 'api_key.create',
    details: `Created API key: ${description || 'API Key'}`
  });

  res.redirect(`/account/api?newKey=${token}`);
});

// POST /account/api/delete
router.post('/account/api/delete', (req, res) => {
  const { id } = req.body;
  db.run('DELETE FROM api_keys WHERE id = ? AND user_id = ?', [id, req.user.id]);
  activity.log({
    userId: req.user.id,
    event: 'api_key.delete',
    details: `Deleted API key ID ${id}`
  });
  res.redirect('/account/api');
});

// GET /account/ssh-keys
router.get('/account/ssh-keys', (req, res) => {
  const keys = db.query('SELECT * FROM ssh_keys WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.render('user/ssh-keys', {
    title: 'SSH Keys - Nova Panel',
    keys,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// POST /account/ssh-keys
router.post('/account/ssh-keys', (req, res) => {
  const { name, public_key } = req.body;
  if (!name || !public_key) {
    return res.redirect('/account/ssh-keys?error=Name%20and%20Key%20are%20required');
  }

  const fingerprint = crypto.createHash('md5').update(public_key.trim()).digest('hex');
  db.run(
    'INSERT INTO ssh_keys (user_id, name, public_key, fingerprint) VALUES (?, ?, ?, ?)',
    [req.user.id, name, public_key.trim(), fingerprint]
  );

  activity.log({
    userId: req.user.id,
    event: 'ssh_key.add',
    details: `Added SSH key: ${name}`
  });

  res.redirect('/account/ssh-keys?success=SSH%20key%20added%20successfully');
});

// POST /account/ssh-keys/delete
router.post('/account/ssh-keys/delete', (req, res) => {
  const { id } = req.body;
  db.run('DELETE FROM ssh_keys WHERE id = ? AND user_id = ?', [id, req.user.id]);
  res.redirect('/account/ssh-keys?success=SSH%20key%20deleted');
});

// GET /account/activity
router.get('/account/activity', (req, res) => {
  const logs = db.query(
    'SELECT * FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100',
    [req.user.id]
  );
  res.render('user/account-activity', {
    title: 'Account Activity - Nova Panel',
    logs
  });
});

module.exports = router;
