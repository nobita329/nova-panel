const db = require('../config/database');

const authMiddleware = {
  requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect(`/auth/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    // Check if user is suspended
    const user = db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!user || user.status === 'suspended') {
      req.session.destroy();
      return res.redirect('/auth/login?error=account_suspended');
    }

    req.user = user;
    res.locals.user = user;
    next();
  },

  requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.redirect(`/auth/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    const user = db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!user || !user.is_admin) {
      return res.status(403).render('errors/403', {
        title: 'Access Denied',
        message: 'You do not have administrative permissions to view this resource.'
      });
    }

    req.user = user;
    res.locals.user = user;
    next();
  },

  requireServerAccess(req, res, next) {
    const rawId = req.params.id || req.params.server || req.body.serverId;
    if (!rawId) {
      return res.status(404).render('errors/404', { title: 'Server Not Found', message: 'Invalid server ID' });
    }

    let server;
    if (/^\d+$/.test(String(rawId).trim())) {
      server = db.get('SELECT * FROM servers WHERE id = ?', [parseInt(rawId, 10)]);
    } else {
      server = db.get('SELECT * FROM servers WHERE uuid = ?', [String(rawId).trim()]);
    }

    if (!server) {
      return res.status(404).render('errors/404', { title: 'Server Not Found', message: 'The requested server does not exist.' });
    }

    const user = req.user || req.session.user;
    if (user && user.is_admin) {
      req.server = server;
      res.locals.server = server;
      return next();
    }

    if (user && server.owner_id === user.id) {
      req.server = server;
      res.locals.server = server;
      return next();
    }

    // Check subuser permissions
    if (user) {
      const subuser = db.get('SELECT * FROM server_subusers WHERE server_id = ? AND user_id = ?', [server.id, user.id]);
      if (subuser) {
        req.server = server;
        req.serverPermissions = JSON.parse(subuser.permissions || '[]');
        res.locals.server = server;
        return next();
      }
    }

    return res.status(403).render('errors/403', {
      title: 'Forbidden',
      message: 'You do not have permission to access this server.'
    });
  }
};

module.exports = authMiddleware;
