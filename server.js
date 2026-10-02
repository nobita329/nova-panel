require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const session = require('express-session');
const db = require('./src/config/database');
const { initWebSocketServer } = require('./src/services/websocket');
const { startSftpServer } = require('./src/services/sftp');
const schedulerService = require('./src/services/scheduler');

// Ensure database tables exist
try {
  require('./src/scripts/migrate');
} catch (e) {
  console.error('Migration notice:', e.message);
}

const PANEL_PORT = parseInt(process.env.PANEL_PORT || '3001', 10);
const API_PORT = parseInt(process.env.API_PORT || '3003', 10);
const SFTP_PORT = parseInt(process.env.SFTP_PORT || '3004', 10);

const app = express();
const server = http.createServer(app);

// View engine setup
app.set('views', path.join(__dirname, 'src/views'));
app.set('view engine', 'ejs');

// Body parsers
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'nova_session_secret_key_default',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true
  }
}));

// Global view variables (branding, user, settings)
app.use((req, res, next) => {
  const rawSettings = db.query('SELECT * FROM settings');
  const settings = {};
  for (const s of rawSettings) {
    settings[s.key] = s.value;
  }

  res.locals.settings = settings;
  res.locals.panelName = settings.panel_name || 'Nova';
  res.locals.panelLogo = settings.panel_logo || '';
  res.locals.panelFavicon = settings.panel_favicon || '';
  res.locals.user = req.session ? req.session.user : null;
  res.locals.currentUrl = req.originalUrl;
  res.locals.year = new Date().getFullYear();

  // Check Maintenance Mode
  if (settings.maintenance_mode === '1') {
    const isLoginPage = req.originalUrl.startsWith('/auth');
    const isAdmin = req.session && req.session.user && req.session.user.is_admin;
    if (!isLoginPage && !isAdmin) {
      return res.status(503).render('errors/maintenance', {
        title: 'Maintenance Mode - Nova',
        message: settings.maintenance_message || 'Nova Panel is undergoing scheduled maintenance.'
      });
    }
  }

  next();
});

// Import Routers
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/user');
const serverRoutes = require('./src/routes/server');
const adminRoutes = require('./src/routes/admin');
const apiRoutes = require('./src/routes/api');

// Mount Routers
app.use('/auth', authRoutes);
app.use('/', userRoutes);
app.use('/server', serverRoutes);
app.use('/admin', adminRoutes);
app.use('/api', apiRoutes);

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/auth/login');
  }
});

// 404 Handler
app.use((req, res) => {
  res.status(404).render('errors/404', {
    title: '404 Not Found - Nova',
    message: 'The page you requested could not be found.'
  });
});

// 500 Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).render('errors/500', {
    title: '500 Server Error - Nova',
    message: err.message || 'An unexpected error occurred.'
  });
});

// Initialize WebSocket for Console Terminal & Stats
initWebSocketServer(server);

// Start HTTP Panel Server
server.listen(PANEL_PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(`🚀 NOVA PANEL RUNNING`);
  console.log(`🌐 Panel Web Dashboard:  http://localhost:${PANEL_PORT}`);
  console.log(`📡 WebSocket Terminal:   ws://localhost:${PANEL_PORT}/ws/console`);
  console.log(`🔑 Application REST API: http://localhost:${API_PORT} & /api`);
  console.log(`📁 SFTP File Server:     sftp://0.0.0.0:${SFTP_PORT}`);
  console.log('==================================================');
});

// Start Dedicated API Server on port 3003
const apiApp = express();
apiApp.use(express.json());
apiApp.use('/api', apiRoutes);
apiApp.use('/', apiRoutes);
apiApp.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});
apiApp.use((err, req, res, next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});
apiApp.listen(API_PORT, '0.0.0.0', () => {
  console.log(`📡 Dedicated API listening on port ${API_PORT}`);
});

// Start Built-in SFTP Server on port 3004
try {
  startSftpServer();
} catch (err) {
  console.error('⚠️ SFTP Server start error:', err.message);
}

// Start Cron Task Scheduler
try {
  schedulerService.init();
} catch (err) {
  console.error('⚠️ Scheduler start error:', err.message);
}

module.exports = { app, server };
