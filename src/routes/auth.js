const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const activity = require('../services/activity');

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/dashboard');
  }
  res.render('auth/login', {
    title: 'Login - Nova Panel',
    error: req.query.error || null,
    redirect: req.query.redirect || '/dashboard'
  });
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { username, password, redirect } = req.body;

  if (!username || !password) {
    return res.render('auth/login', {
      title: 'Login - Nova Panel',
      error: 'Please enter both username/email and password.',
      redirect: redirect || '/dashboard'
    });
  }

  const user = db.get(
    'SELECT * FROM users WHERE (username = ? OR email = ?)',
    [username.trim(), username.trim()]
  );

  if (!user) {
    return res.render('auth/login', {
      title: 'Login - Nova Panel',
      error: 'Invalid credentials. Please check your username and password.',
      redirect: redirect || '/dashboard'
    });
  }

  if (user.status === 'suspended') {
    return res.render('auth/login', {
      title: 'Login - Nova Panel',
      error: 'Your account has been suspended by an administrator.',
      redirect: redirect || '/dashboard'
    });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.render('auth/login', {
      title: 'Login - Nova Panel',
      error: 'Invalid credentials. Please check your username and password.',
      redirect: redirect || '/dashboard'
    });
  }

  // Update last activity
  db.run('UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    is_admin: user.is_admin
  };

  activity.log({
    userId: user.id,
    event: 'auth.login',
    details: 'User logged in successfully',
    ip: req.ip || req.connection.remoteAddress
  });

  const dest = (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) ? redirect : '/dashboard';
  res.redirect(dest);
});

// GET /auth/logout
router.get('/logout', (req, res) => {
  if (req.session && req.session.user) {
    activity.log({
      userId: req.session.user.id,
      event: 'auth.logout',
      details: 'User logged out',
      ip: req.ip
    });
  }
  req.session.destroy(() => {
    res.redirect('/auth/login');
  });
});

// GET /auth/forgot-password
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    title: 'Forgot Password - Nova Panel',
    message: null,
    error: null
  });
});

// POST /auth/forgot-password
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  res.render('auth/forgot-password', {
    title: 'Forgot Password - Nova Panel',
    message: 'If an account exists with this email, password reset instructions have been recorded.',
    error: null
  });
});

module.exports = router;
