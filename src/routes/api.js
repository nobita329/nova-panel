const express = require('express');
const router = express.Router();
const db = require('../config/database');
const dockerService = require('../services/docker');
const mcjars = require('../services/mcjars');

// API Authentication middleware
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token' });
  }

  const token = authHeader.substring(7).trim();
  const apiKey = db.get('SELECT * FROM api_keys WHERE key_token = ?', [token]);
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }

  db.run('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?', [apiKey.id]);
  req.apiKey = apiKey;
  next();
});

// GET /v1/system and /system
router.get(['/v1/system', '/system'], (req, res) => {
  res.json({
    name: 'Nova Panel API',
    version: '1.0.0',
    status: 'healthy'
  });
});

// GET /v1/servers and /servers
router.get(['/v1/servers', '/servers'], (req, res) => {
  const servers = db.query('SELECT id, uuid, name, status, cpu_limit, memory_limit, disk_limit, primary_port FROM servers');
  res.json({ success: true, data: servers });
});

// GET /v1/nodes and /nodes
router.get(['/v1/nodes', '/nodes'], (req, res) => {
  const nodes = db.query('SELECT id, name, fqdn, daemon_port, memory_limit, disk_limit, status FROM nodes');
  res.json({ success: true, data: nodes });
});

// GET /v1/servers/:id and /servers/:id
router.get(['/v1/servers/:id', '/servers/:id'], (req, res) => {
  let server;
  if (/^\d+$/.test(String(req.params.id))) {
    server = db.get('SELECT * FROM servers WHERE id = ?', [parseInt(req.params.id, 10)]);
  } else {
    server = db.get('SELECT * FROM servers WHERE uuid = ?', [req.params.id]);
  }
  if (!server) return res.status(404).json({ error: 'Server not found' });
  res.json({ success: true, data: server });
});

// POST /api/v1/servers/:id/power
router.post('/v1/servers/:id/power', async (req, res) => {
  const { action } = req.body;
  const server = db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  if (!server) return res.status(404).json({ error: 'Server not found' });

  try {
    if (action === 'start') await dockerService.start(server.id);
    else if (action === 'stop') await dockerService.stop(server.id);
    else if (action === 'restart') await dockerService.restart(server.id);
    else if (action === 'kill') await dockerService.kill(server.id);
    else return res.status(400).json({ error: 'Invalid action. Choose: start, stop, restart, kill' });

    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/servers/:id/command
router.post('/v1/servers/:id/command', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command is required' });

  try {
    await dockerService.sendCommand(req.params.id, command);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/servers/:id/stats
router.get('/v1/servers/:id/stats', async (req, res) => {
  try {
    const stats = await dockerService.getStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/servers/:id/logs
router.get('/v1/servers/:id/logs', async (req, res) => {
  const tail = parseInt(req.query.tail || '100', 10);
  try {
    const logs = await dockerService.getLogs(req.params.id, tail);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/mcjars/types
router.get('/v1/mcjars/types', async (req, res) => {
  const types = await mcjars.getTypes();
  res.json({ success: true, types });
});

// GET /api/v1/mcjars/builds/:type
router.get('/v1/mcjars/builds/:type', async (req, res) => {
  const builds = await mcjars.getBuilds(req.params.type);
  res.json({ success: true, builds });
});

module.exports = router;
