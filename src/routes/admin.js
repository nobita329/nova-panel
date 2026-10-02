const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const os = require('os');
const { execSync } = require('child_process');
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const dockerService = require('../services/docker');
const mcjars = require('../services/mcjars');
const activity = require('../services/activity');
const { brandingUpload } = require('../middleware/upload');
const addonService = require('../services/addons');

router.use(requireAdmin);

// 1. ADMIN DASHBOARD
router.get('/', (req, res) => {
  const usersCount = db.get('SELECT COUNT(*) as c FROM users').c;
  const serversCount = db.get('SELECT COUNT(*) as c FROM servers').c;
  const onlineServersCount = db.get("SELECT COUNT(*) as c FROM servers WHERE status = 'online'").c;
  const nodesCount = db.get('SELECT COUNT(*) as c FROM nodes').c;
  const locationsCount = db.get('SELECT COUNT(*) as c FROM locations').c;
  const nestsCount = db.get('SELECT COUNT(*) as c FROM nests').c;
  const eggsCount = db.get('SELECT COUNT(*) as c FROM eggs').c;
  const dbHostsCount = db.get('SELECT COUNT(*) as c FROM database_hosts').c;

  // System stats
  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const usedMem = (totalMem - freeMem).toFixed(1);
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg()[0].toFixed(2);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - Nova',
    activeSection: 'dashboard',
    counts: {
      users: usersCount,
      servers: serversCount,
      onlineServers: onlineServersCount,
      nodes: nodesCount,
      locations: locationsCount,
      nests: nestsCount,
      eggs: eggsCount,
      dbHosts: dbHostsCount
    },
    system: {
      totalMem,
      usedMem,
      freeMem,
      cpuCount,
      loadAvg,
      uptime: (os.uptime() / 3600).toFixed(1),
      platform: os.platform(),
      release: os.release()
    }
  });
});

// 2. ADMIN USERS
router.get('/users', (req, res) => {
  const q = req.query.q ? `%${req.query.q.trim()}%` : null;
  let users = [];
  if (q) {
    users = db.query(
      'SELECT * FROM users WHERE username LIKE ? OR email LIKE ? OR first_name LIKE ? OR last_name LIKE ? ORDER BY id DESC',
      [q, q, q, q]
    );
  } else {
    users = db.query('SELECT * FROM users ORDER BY id DESC');
  }

  res.render('admin/users', {
    title: 'Manage Users - Nova Admin',
    activeSection: 'users',
    users,
    search: req.query.q || '',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/users/new', (req, res) => {
  res.render('admin/user-new', {
    title: 'Create User - Nova Admin',
    activeSection: 'users',
    error: null
  });
});

router.post('/users/new', async (req, res) => {
  const { first_name, last_name, username, email, password, is_admin } = req.body;

  if (!username || !email || !password) {
    return res.render('admin/user-new', {
      title: 'Create User - Nova Admin',
      activeSection: 'users',
      error: 'Username, Email, and Password are required.'
    });
  }

  const existing = db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username.trim(), email.trim()]);
  if (existing) {
    return res.render('admin/user-new', {
      title: 'Create User - Nova Admin',
      activeSection: 'users',
      error: 'A user with that username or email already exists.'
    });
  }

  const hashed = await bcrypt.hash(password, 10);
  db.run(`
    INSERT INTO users (first_name, last_name, username, email, password, is_admin, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `, [first_name || '', last_name || '', username.trim(), email.trim(), hashed, is_admin ? 1 : 0]);

  activity.log({
    userId: req.user.id,
    event: 'admin.user.create',
    details: `Created user ${username}`
  });

  res.redirect('/admin/users?success=User%20created%20successfully');
});

router.get('/users/:id', (req, res) => {
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.redirect('/admin/users?error=User%20not%20found');

  const userServers = db.query('SELECT * FROM servers WHERE owner_id = ?', [user.id]);

  res.render('admin/user-edit', {
    title: `Edit User: ${user.username} - Nova Admin`,
    activeSection: 'users',
    targetUser: user,
    userServers,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/users/:id', async (req, res) => {
  const { first_name, last_name, email, password, is_admin, status } = req.body;
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!user) return res.redirect('/admin/users');

  let updatePassSql = '';
  const params = [first_name || '', last_name || '', email, is_admin ? 1 : 0, status || 'active'];

  if (password && password.trim()) {
    const hashed = await bcrypt.hash(password.trim(), 10);
    params.push(hashed);
    updatePassSql = ', password = ?';
  }

  params.push(user.id);
  db.run(`
    UPDATE users
    SET first_name = ?, last_name = ?, email = ?, is_admin = ?, status = ? ${updatePassSql}
    WHERE id = ?
  `, params);

  activity.log({
    userId: req.user.id,
    event: 'admin.user.update',
    details: `Updated user ${user.username}`
  });

  res.redirect(`/admin/users/${user.id}?success=User%20updated%20successfully`);
});

router.post('/users/:id/delete', (req, res) => {
  const user = db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (user && user.id !== req.user.id) {
    db.run('DELETE FROM users WHERE id = ?', [user.id]);
    activity.log({
      userId: req.user.id,
      event: 'admin.user.delete',
      details: `Deleted user ${user.username}`
    });
  }
  res.redirect('/admin/users?success=User%20deleted');
});

// 3. ADMIN SERVERS
router.get('/servers', (req, res) => {
  const servers = db.query(`
    SELECT s.*, u.username as owner_username, n.name as node_name, e.name as egg_name
    FROM servers s
    LEFT JOIN users u ON s.owner_id = u.id
    LEFT JOIN nodes n ON s.node_id = n.id
    LEFT JOIN eggs e ON s.egg_id = e.id
    ORDER BY s.id DESC
  `);

  res.render('admin/servers', {
    title: 'Manage Servers - Nova Admin',
    activeSection: 'servers',
    servers,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/servers/new', async (req, res) => {
  const users = db.query('SELECT id, username, email FROM users ORDER BY username ASC');
  const nodes = db.query("SELECT * FROM nodes WHERE status = 'online'");
  const nests = db.query('SELECT * FROM nests ORDER BY name ASC');
  const eggs = db.query('SELECT * FROM eggs ORDER BY name ASC');
  const unassignedAllocations = db.query('SELECT * FROM allocations WHERE assigned = 0 ORDER BY port ASC');

  // Minecraft software types from mcjars
  const mcTypes = await mcjars.getTypes();

  res.render('admin/server-new', {
    title: 'Create Server - Nova Admin',
    activeSection: 'servers',
    users,
    nodes,
    nests,
    eggs,
    allocations: unassignedAllocations,
    mcTypes,
    error: null
  });
});

router.post('/servers/new', async (req, res) => {
  const {
    name, description, owner_id, node_id, allocation_id,
    cpu_limit, memory_limit, disk_limit, swap_limit,
    nest_id, egg_id, docker_image, startup_command,
    mc_type, mc_version, expiration_date
  } = req.body;

  try {
    const uuid = crypto.randomUUID();
    const egg = db.get('SELECT * FROM eggs WHERE id = ?', [egg_id]);
    const allocation = db.get('SELECT * FROM allocations WHERE id = ?', [allocation_id]);
    const port = allocation ? allocation.port : 25565;

    let finalImage = docker_image || (egg ? egg.docker_image : 'ghcr.io/pterodactyl/yolks:java_21');
    let finalStartup = startup_command || (egg ? egg.startup_command : 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui');

    const envObj = {};
    if (egg && egg.nest_id === 1) { // Minecraft
      envObj.MC_TYPE = mc_type || 'PAPER';
      envObj.MC_VERSION = mc_version || 'latest';
      envObj.SERVER_JARFILE = 'server.jar';
    } else if (egg && egg.nest_id === 2) { // Node.js
      envObj.MAIN_FILE = 'index.js';
    } else if (egg && egg.nest_id === 3) { // Python
      envObj.MAIN_FILE = 'app.py';
    }

    const expDate = expiration_date ? new Date(expiration_date).toISOString() : null;

    const result = db.run(`
      INSERT INTO servers (
        uuid, name, description, owner_id, node_id, nest_id, egg_id,
        docker_image, startup_command, environment, cpu_limit, memory_limit, disk_limit,
        swap_limit, primary_port, status, installed, expiration_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'installing', 1, ?)
    `, [
      uuid, name, description || '', owner_id, node_id || 1, nest_id, egg_id,
      finalImage, finalStartup, JSON.stringify(envObj),
      parseInt(cpu_limit || 100, 10), parseInt(memory_limit || 1024, 10), parseInt(disk_limit || 5120, 10),
      parseInt(swap_limit || 0, 10), port, expDate
    ]);

    const serverId = result.lastInsertRowid;
    if (allocation) {
      db.run('UPDATE allocations SET assigned = 1, server_id = ? WHERE id = ?', [serverId, allocation.id]);
    }

    const serverDir = path.resolve(process.cwd(), 'Instance/server', String(serverId));
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    // Auto-install Minecraft jar if Minecraft nest
    if (egg && egg.nest_id === 1) {
      try {
        console.log(`⬇️ Downloading ${mc_type || 'PAPER'} jar for server ${serverId}...`);
        await mcjars.installServerJar(mc_type || 'PAPER', mc_version || 'latest', serverDir);
      } catch (e) {
        console.error('Failed to auto-download mc jar:', e.message);
      }
    } else if (egg && egg.nest_id === 2) {
      // Default package.json for Node.js
      const pkgPath = path.join(serverDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        fs.writeFileSync(pkgPath, JSON.stringify({
          name: name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
          version: '1.0.0',
          main: 'index.js',
          scripts: { start: 'node index.js' },
          dependencies: {}
        }, null, 2));
      }
      const indexPath = path.join(serverDir, 'index.js');
      if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, `console.log("Hello from Nova Node.js Server!");\nsetInterval(() => {}, 10000);\n`);
      }
    } else if (egg && egg.nest_id === 3) {
      // Default app.py for Python
      const appPath = path.join(serverDir, 'app.py');
      if (!fs.existsSync(appPath)) {
        fs.writeFileSync(appPath, `print("Hello from Nova Python Server!")\nimport time\nwhile True:\n    time.sleep(10)\n`);
      }
    }

    // Create Docker container
    const srv = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    await dockerService.createContainer(srv);

    activity.log({
      userId: req.user.id,
      serverId,
      event: 'admin.server.create',
      details: `Admin created server ${name} (ID: ${serverId})`
    });

    res.redirect('/admin/servers?success=Server%20created%20successfully');
  } catch (err) {
    console.error('Error creating server:', err);
    res.redirect(`/admin/servers/new?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/servers/:id/delete', async (req, res) => {
  const server = db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
  if (server) {
    await dockerService.deleteContainer(server.id);
    db.run('UPDATE allocations SET assigned = 0, server_id = NULL WHERE server_id = ?', [server.id]);
    db.run('DELETE FROM servers WHERE id = ?', [server.id]);
    activity.log({
      userId: req.user.id,
      event: 'admin.server.delete',
      details: `Deleted server ${server.name} (ID: ${server.id})`
    });
  }
  res.redirect('/admin/servers?success=Server%20deleted');
});

// 4. ADMIN NODES
router.get('/nodes', (req, res) => {
  const nodes = db.query(`
    SELECT n.*, l.short_code as location_code, COUNT(s.id) as server_count
    FROM nodes n
    LEFT JOIN locations l ON n.location_id = l.id
    LEFT JOIN servers s ON s.node_id = n.id
    GROUP BY n.id
  `);

  res.render('admin/nodes', {
    title: 'Manage Nodes - Nova Admin',
    activeSection: 'nodes',
    nodes,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/nodes/new', (req, res) => {
  const locations = db.query('SELECT * FROM locations');
  res.render('admin/node-new', {
    title: 'Create Node - Nova Admin',
    activeSection: 'nodes',
    locations
  });
});

router.post('/nodes/new', (req, res) => {
  const { name, location_id, fqdn, daemon_port, sftp_port, memory_limit, disk_limit } = req.body;
  db.run(`
    INSERT INTO nodes (name, location_id, fqdn, daemon_port, sftp_port, memory_limit, disk_limit, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'online')
  `, [name, location_id || 1, fqdn || '127.0.0.1', daemon_port || 3003, sftp_port || 3004, memory_limit || 16384, disk_limit || 102400]);

  res.redirect('/admin/nodes?success=Node%20created%20successfully');
});

router.get('/nodes/:id/allocations', (req, res) => {
  const node = db.get('SELECT * FROM nodes WHERE id = ?', [req.params.id]);
  if (!node) return res.redirect('/admin/nodes');

  const allocations = db.query(`
    SELECT a.*, s.name as server_name
    FROM allocations a
    LEFT JOIN servers s ON a.server_id = s.id
    WHERE a.node_id = ?
    ORDER BY a.port ASC
  `, [node.id]);

  res.render('admin/node-allocations', {
    title: `Allocations: ${node.name} - Nova Admin`,
    activeSection: 'nodes',
    node,
    allocations,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/nodes/:id/allocations', (req, res) => {
  const nodeId = req.params.id;
  const { ip, ports } = req.body;

  // Supports single port "25565" or range "25565-25575" or comma separated "25565, 25566"
  const ipAddr = ip ? ip.trim() : '0.0.0.0';
  const parts = ports.split(/[,;\s]+/);

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(n => parseInt(n, 10));
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        for (let p = start; p <= end; p++) {
          const exists = db.get('SELECT id FROM allocations WHERE node_id = ? AND port = ?', [nodeId, p]);
          if (!exists) {
            db.run('INSERT INTO allocations (node_id, ip, port, assigned) VALUES (?, ?, ?, 0)', [nodeId, ipAddr, p]);
          }
        }
      }
    } else {
      const p = parseInt(part, 10);
      if (!isNaN(p)) {
        const exists = db.get('SELECT id FROM allocations WHERE node_id = ? AND port = ?', [nodeId, p]);
        if (!exists) {
          db.run('INSERT INTO allocations (node_id, ip, port, assigned) VALUES (?, ?, ?, 0)', [nodeId, ipAddr, p]);
        }
      }
    }
  }

  res.redirect(`/admin/nodes/${nodeId}/allocations?success=Allocations%20added%20successfully`);
});

router.post('/nodes/:id/allocations/delete', (req, res) => {
  const { allocation_id } = req.body;
  db.run('DELETE FROM allocations WHERE id = ? AND assigned = 0', [allocation_id]);
  res.redirect(`/admin/nodes/${req.params.id}/allocations?success=Allocation%20deleted`);
});

// 5. ADMIN LOCATIONS
router.get('/locations', (req, res) => {
  const locations = db.query(`
    SELECT l.*, COUNT(n.id) as node_count
    FROM locations l
    LEFT JOIN nodes n ON n.location_id = l.id
    GROUP BY l.id
  `);

  res.render('admin/locations', {
    title: 'Locations - Nova Admin',
    activeSection: 'locations',
    locations,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/locations', (req, res) => {
  const { short_code, description } = req.body;
  if (!short_code) return res.redirect('/admin/locations?error=Short%20code%20required');

  try {
    db.run('INSERT INTO locations (short_code, description) VALUES (?, ?)', [short_code.trim().toLowerCase(), description || '']);
    res.redirect('/admin/locations?success=Location%20added');
  } catch (e) {
    res.redirect('/admin/locations?error=Location%20code%20must%20be%20unique');
  }
});

// 6. ADMIN NESTS & EGGS
router.get('/nests', (req, res) => {
  const nests = db.query(`
    SELECT n.*, COUNT(e.id) as egg_count
    FROM nests n
    LEFT JOIN eggs e ON e.nest_id = n.id
    GROUP BY n.id
  `);

  res.render('admin/nests', {
    title: 'Nests - Nova Admin',
    activeSection: 'nests',
    nests,
    success: req.query.success || null
  });
});

router.post('/nests', (req, res) => {
  const { name, description } = req.body;
  if (name) {
    db.run("INSERT INTO nests (name, description, author) VALUES (?, ?, 'Nova')", [name, description || '']);
  }
  res.redirect('/admin/nests?success=Nest%20created');
});

router.get('/nests/:id/eggs', (req, res) => {
  const nest = db.get('SELECT * FROM nests WHERE id = ?', [req.params.id]);
  if (!nest) return res.redirect('/admin/nests');

  const eggs = db.query(`
    SELECT e.*, COUNT(s.id) as server_count
    FROM eggs e
    LEFT JOIN servers s ON s.egg_id = e.id
    WHERE e.nest_id = ?
    GROUP BY e.id
  `, [nest.id]);

  res.render('admin/nest-eggs', {
    title: `${nest.name} Eggs - Nova Admin`,
    activeSection: 'nests',
    nest,
    eggs,
    success: req.query.success || null
  });
});

router.get('/nests/:id/eggs/new', (req, res) => {
  const nest = db.get('SELECT * FROM nests WHERE id = ?', [req.params.id]);
  res.render('admin/egg-new', {
    title: `Create Egg for ${nest.name} - Nova Admin`,
    activeSection: 'nests',
    nest
  });
});

router.post('/nests/:id/eggs/new', (req, res) => {
  const nestId = req.params.id;
  const { name, description, docker_image, startup_command, default_variables } = req.body;

  db.run(`
    INSERT INTO eggs (nest_id, name, description, docker_image, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [nestId, name, description || '', docker_image, startup_command, default_variables || '{}']);

  res.redirect(`/admin/nests/${nestId}/eggs?success=Egg%20created`);
});

// 7. DATABASE HOSTS
router.get('/database', (req, res) => {
  const hosts = db.query(`
    SELECT dh.*, n.name as node_name, COUNT(sd.id) as database_count
    FROM database_hosts dh
    LEFT JOIN nodes n ON dh.node_id = n.id
    LEFT JOIN server_databases sd ON sd.database_host_id = dh.id
    GROUP BY dh.id
  `);

  res.render('admin/database-hosts', {
    title: 'Database Hosts - Nova Admin',
    activeSection: 'database',
    hosts,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.get('/database/new', (req, res) => {
  const nodes = db.query('SELECT * FROM nodes');
  res.render('admin/database-host-new', {
    title: 'New Database Host - Nova Admin',
    activeSection: 'database',
    nodes
  });
});

router.post('/database/new', (req, res) => {
  const { name, host, port, username, password, node_id } = req.body;
  db.run(`
    INSERT INTO database_hosts (name, host, port, username, password, node_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, host || '127.0.0.1', port || 3005, username || 'root', password || '', node_id || 1]);

  res.redirect('/admin/database?success=Database%20host%20added');
});

// 8. APPLICATION API
router.get('/api', (req, res) => {
  const keys = db.query(`
    SELECT ak.*, u.username
    FROM api_keys ak
    JOIN users u ON ak.user_id = u.id
    ORDER BY ak.id DESC
  `);

  res.render('admin/api', {
    title: 'Application API - Nova Admin',
    activeSection: 'api',
    keys,
    newKey: req.query.newKey || null
  });
});

router.post('/api/new', (req, res) => {
  const { description } = req.body;
  const identifier = crypto.randomBytes(8).toString('hex');
  const token = 'nova_admin_' + crypto.randomBytes(28).toString('hex');

  db.run(`
    INSERT INTO api_keys (user_id, identifier, key_token, description, permissions)
    VALUES (?, ?, ?, ?, '["*"]')
  `, [req.user.id, identifier, token, description || 'Admin API Key']);

  res.redirect(`/admin/api?newKey=${token}`);
});

router.post('/api/delete', (req, res) => {
  const { id } = req.body;
  db.run('DELETE FROM api_keys WHERE id = ?', [id]);
  res.redirect('/admin/api?success=Key%20revoked');
});

// 9. ACTIVITY LOGS
router.get('/activity', (req, res) => {
  const logs = db.query(`
    SELECT al.*, u.username, s.name as server_name
    FROM activity_logs al
    LEFT JOIN users u ON al.user_id = u.id
    LEFT JOIN servers s ON al.server_id = s.id
    ORDER BY al.id DESC
    LIMIT 200
  `);

  res.render('admin/activity', {
    title: 'Activity Logs - Nova Admin',
    activeSection: 'activity',
    logs
  });
});

// 10. SETTINGS & BRANDING (With live preview of logo & favicon!)
router.get('/settings', (req, res) => {
  const rawSettings = db.query('SELECT * FROM settings');
  const settings = {};
  for (const s of rawSettings) {
    settings[s.key] = s.value;
  }

  res.render('admin/settings', {
    title: 'Panel Settings - Nova Admin',
    activeSection: 'settings',
    settings,
    success: req.query.success || null,
    error: req.query.error || null
  });
});

router.post('/settings', brandingUpload.fields([{ name: 'logo', maxCount: 1 }, { name: 'favicon', maxCount: 1 }]), (req, res) => {
  const {
    panel_name, company_name, panel_url, timezone, default_language,
    panel_logo_url, panel_favicon_url, maintenance_mode, maintenance_message,
    smtp_host, smtp_port, smtp_username, smtp_password, smtp_from
  } = req.body;

  function updateSetting(key, val) {
    if (val !== undefined) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [key, val, val]);
    }
  }

  updateSetting('panel_name', panel_name);
  updateSetting('company_name', company_name);
  updateSetting('panel_url', panel_url);
  updateSetting('timezone', timezone);
  updateSetting('default_language', default_language);
  updateSetting('maintenance_mode', maintenance_mode ? '1' : '0');
  updateSetting('maintenance_message', maintenance_message);

  // Logo: either uploaded file or URL
  if (req.files && req.files.logo && req.files.logo[0]) {
    updateSetting('panel_logo', `/uploads/${req.files.logo[0].filename}`);
  } else if (panel_logo_url !== undefined) {
    updateSetting('panel_logo', panel_logo_url);
  }

  // Favicon: either uploaded file or URL
  if (req.files && req.files.favicon && req.files.favicon[0]) {
    updateSetting('panel_favicon', `/uploads/${req.files.favicon[0].filename}`);
  } else if (panel_favicon_url !== undefined) {
    updateSetting('panel_favicon', panel_favicon_url);
  }

  updateSetting('smtp_host', smtp_host);
  updateSetting('smtp_port', smtp_port);
  updateSetting('smtp_username', smtp_username);
  updateSetting('smtp_password', smtp_password);
  updateSetting('smtp_from', smtp_from);

  activity.log({
    userId: req.user.id,
    event: 'admin.settings.update',
    details: 'Admin updated panel settings and branding'
  });

  res.redirect('/admin/settings?success=Settings%20updated%20successfully');
});

// 11. SYSTEM INFORMATION
router.get('/system', (req, res) => {
  let dockerVersion = 'Unknown';
  let dockerRunning = false;
  try {
    dockerVersion = execSync('docker --version', { encoding: 'utf8' }).trim();
    dockerRunning = true;
  } catch (e) {}

  res.render('admin/system', {
    title: 'System Information - Nova Admin',
    activeSection: 'system',
    system: {
      platform: os.platform(),
      arch: os.arch(),
      osRelease: os.release(),
      hostname: os.hostname(),
      cpus: os.cpus(),
      totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      nodeVersion: process.version,
      panelVersion: '1.0.0',
      dockerVersion,
      dockerRunning,
      dbEngine: 'Native SQLite 3.53'
    }
  });
});

// ==========================================
// ARIX ADDONS HUB (ADMIN)
// ==========================================
router.get('/addons', (req, res) => {
  const addons = addonService.getAddonsConfig();
  const nests = db.query('SELECT * FROM nests ORDER BY id ASC');

  res.render('admin/addons', {
    title: 'Arix Addons Hub - Nova Admin',
    activeSection: 'addons',
    addons,
    nests
  });
});

router.post('/addons/toggle', (req, res) => {
  const { key, enabled } = req.body;
  try {
    addonService.toggleAddon(key, enabled);
    activity.log({
      userId: req.user.id,
      event: 'addon.toggle',
      details: `${enabled ? 'Enabled' : 'Disabled'} addon "${key}"`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/addons/configure', (req, res) => {
  const { key, config } = req.body;
  try {
    const updated = addonService.updateAddonConfig(key, config);
    activity.log({
      userId: req.user.id,
      event: 'addon.configure',
      details: `Configured settings for addon "${key}"`
    });
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/eggs/import', (req, res) => {
  const { nest_id, egg_json } = req.body;
  try {
    const result = addonService.importEggFromJson(nest_id, egg_json);
    activity.log({
      userId: req.user.id,
      event: 'egg.import',
      details: `Imported egg "${result.name}" into nest #${nest_id}`
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
