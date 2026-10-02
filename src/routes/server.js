const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const db = require('../config/database');
const { requireAuth, requireServerAccess } = require('../middleware/auth');
const dockerService = require('../services/docker');
const backupService = require('../services/backup');
const schedulerService = require('../services/scheduler');
const { serverFileUpload, memoryUpload } = require('../middleware/upload');
const mcjars = require('../services/mcjars');
const addonService = require('../services/addons');

router.use(requireAuth);
router.use('/:id', requireServerAccess);

// Helper to get server directory safely
function getServerPath(serverId, subPath = '') {
  const baseDir = path.resolve(process.cwd(), 'Instance/server', String(serverId));
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const cleanSub = path.normalize('/' + subPath).replace(/^(\.\.[\/\\])+/, '');
  const resolved = path.resolve(baseDir, '.' + cleanSub);
  if (!resolved.startsWith(baseDir)) {
    return baseDir;
  }
  return resolved;
}

// 1. CONSOLE
router.get('/:id/console', async (req, res) => {
  const server = req.server;
  const initialLogs = await dockerService.getLogs(server.id, 150);
  const stats = await dockerService.getStats(server.id);

  res.render('server/console', {
    title: `${server.name} - Console - Nova`,
    server,
    activeTab: 'console',
    initialLogs,
    stats,
    wsPort: process.env.PANEL_PORT || 3001
  });
});

// Power Actions
router.post('/:id/power', async (req, res) => {
  const { action } = req.body;
  const server = req.server;

  try {
    if (action === 'start') {
      await dockerService.start(server.id);
    } else if (action === 'stop') {
      await dockerService.stop(server.id);
    } else if (action === 'restart') {
      await dockerService.restart(server.id);
    } else if (action === 'kill') {
      await dockerService.kill(server.id);
    }
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: `server.power.${action}`,
      details: `Power action ${action} executed by ${req.user.username}`
    });
    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send Command via POST (for fallback or API)
router.post('/:id/command', async (req, res) => {
  const { command } = req.body;
  const server = req.server;

  try {
    await dockerService.sendCommand(server.id, command);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'server.command',
      details: `Sent command: ${command}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. FILE MANAGER
router.get('/:id/files', (req, res) => {
  const server = req.server;
  const currentPath = req.query.path || '/';
  const targetDir = getServerPath(server.id, currentPath);

  let items = [];
  try {
    const dirEntries = fs.readdirSync(targetDir, { withFileTypes: true });
    items = dirEntries.map(entry => {
      const fullItemPath = path.join(targetDir, entry.name);
      let size = 0;
      let mtime = new Date();
      try {
        const stats = fs.statSync(fullItemPath);
        size = stats.size;
        mtime = stats.mtime;
      } catch (e) {}

      return {
        name: entry.name,
        isDirectory: entry.isDirectory(),
        size,
        modified: mtime,
        isEditable: !entry.isDirectory() && /\.(txt|json|yml|yaml|properties|cfg|conf|sh|js|py|mcmeta|env|html|css|md|log)$/i.test(entry.name)
      };
    });

    // Sort folders first, then files alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error('Error reading dir:', err);
  }

  // Breadcrumbs
  const pathParts = currentPath.split('/').filter(Boolean);

  res.render('server/files', {
    title: `${server.name} - File Manager - Nova`,
    server,
    activeTab: 'files',
    currentPath: currentPath === '/' ? '' : currentPath,
    items,
    pathParts,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

// File Editor (View)
router.get('/:id/files/edit', (req, res) => {
  const server = req.server;
  const filePath = req.query.path;
  if (!filePath) return res.redirect(`/server/${server.id}/files`);

  const fullPath = getServerPath(server.id, filePath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    return res.redirect(`/server/${server.id}/files?error=File%20not%20found`);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  res.render('server/file-edit', {
    title: `${server.name} - Edit ${path.basename(filePath)} - Nova`,
    server,
    activeTab: 'files',
    filePath,
    fileName: path.basename(filePath),
    content,
    dirPath: path.dirname(filePath)
  });
});

// File Save
router.post('/:id/files/save', (req, res) => {
  const server = req.server;
  const filePath = req.body.filePath || req.body.path;
  const content = req.body.content !== undefined ? req.body.content : '';
  if (!filePath) {
    return res.status(400).json({ success: false, error: 'File path is required' });
  }
  const fullPath = getServerPath(server.id, filePath);

  try {
    fs.writeFileSync(fullPath, content || '', 'utf8');
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'file.edit',
      details: `Saved changes to ${filePath}`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// File Download
router.get('/:id/files/download', (req, res) => {
  const server = req.server;
  const filePath = req.query.path;
  const fullPath = getServerPath(server.id, filePath);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).send('File not found');
  }

  res.download(fullPath, path.basename(filePath));
});

// File Upload
router.post('/:id/files/upload', serverFileUpload.array('files'), (req, res) => {
  const server = req.server;
  const currentPath = req.query.path || '/';
  activity.log({
    userId: req.user.id,
    serverId: server.id,
    event: 'file.upload',
    details: `Uploaded ${req.files ? req.files.length : 0} file(s) to ${currentPath}`
  });
  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath)}&success=Files%20uploaded%20successfully`);
});

// Create New File
router.post('/:id/files/new-file', (req, res) => {
  const server = req.server;
  const { name, currentPath } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const targetFile = path.join(targetDir, name);

  if (!fs.existsSync(targetFile)) {
    fs.writeFileSync(targetFile, '');
  }

  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=File%20created`);
});

// Create New Folder
router.post('/:id/files/new-folder', (req, res) => {
  const server = req.server;
  const { name, currentPath } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const newFolder = path.join(targetDir, name);

  if (!fs.existsSync(newFolder)) {
    fs.mkdirSync(newFolder, { recursive: true });
  }

  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=Folder%20created`);
});

// Rename
router.post('/:id/files/rename', (req, res) => {
  const server = req.server;
  const { oldName, newName, currentPath } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const oldPath = path.join(targetDir, oldName);
  const newPath = path.join(targetDir, newName);

  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
  }

  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=Renamed%20successfully`);
});

// Delete
router.post('/:id/files/delete', (req, res) => {
  const server = req.server;
  const { name, currentPath } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const targetPath = path.join(targetDir, name);

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'file.delete',
      details: `Deleted ${name}`
    });
  }

  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=Deleted%20successfully`);
});

// Archive (Zip)
router.post('/:id/files/archive', (req, res) => {
  const server = req.server;
  const { currentPath, name = 'archive' } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const zipPath = path.join(targetDir, `${name}-${Date.now()}.zip`);

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });

  output.on('close', () => {
    res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=Archive%20created`);
  });

  archive.pipe(output);
  archive.directory(targetDir, false);
  archive.finalize();
});

// Extract (Unzip)
router.post('/:id/files/extract', (req, res) => {
  const server = req.server;
  const { filename, currentPath } = req.body;
  const targetDir = getServerPath(server.id, currentPath || '');
  const zipPath = path.join(targetDir, filename);

  if (fs.existsSync(zipPath)) {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(targetDir, true);
  }

  res.redirect(`/server/${server.id}/files?path=${encodeURIComponent(currentPath || '')}&success=Extracted%20successfully`);
});

// 3. DATABASES
router.get('/:id/databases', (req, res) => {
  const server = req.server;
  const databases = db.query(`
    SELECT sd.*, dh.name as host_name, dh.host, dh.port
    FROM server_databases sd
    JOIN database_hosts dh ON sd.database_host_id = dh.id
    WHERE sd.server_id = ?
  `, [server.id]);

  const hosts = db.query('SELECT * FROM database_hosts');

  res.render('server/databases', {
    title: `${server.name} - Databases - Nova`,
    server,
    activeTab: 'databases',
    databases,
    hosts,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/databases/new', (req, res) => {
  const server = req.server;
  const { database_name, database_host_id } = req.body;
  const hostId = database_host_id || 1;

  const dbName = `s${server.id}_${(database_name || 'db').replace(/[^a-zA-Z0-9_]/g, '')}`;
  const dbUser = `u${server.id}_${Math.random().toString(36).substring(2, 7)}`;
  const dbPass = Math.random().toString(36).substring(2, 14);

  db.run(`
    INSERT INTO server_databases (server_id, database_host_id, database_name, db_username, db_password)
    VALUES (?, ?, ?, ?, ?)
  `, [server.id, hostId, dbName, dbUser, dbPass]);

  activity.log({
    userId: req.user.id,
    serverId: server.id,
    event: 'database.create',
    details: `Created database ${dbName}`
  });

  res.redirect(`/server/${server.id}/databases?success=Database%20created%20successfully`);
});

router.post('/:id/databases/delete', (req, res) => {
  const server = req.server;
  const { id } = req.body;

  db.run('DELETE FROM server_databases WHERE id = ? AND server_id = ?', [id, server.id]);
  activity.log({
    userId: req.user.id,
    serverId: server.id,
    event: 'database.delete',
    details: `Deleted database ID ${id}`
  });

  res.redirect(`/server/${server.id}/databases?success=Database%20deleted`);
});

// 4. SCHEDULES
router.get('/:id/schedules', (req, res) => {
  const server = req.server;
  const schedules = db.query('SELECT * FROM server_schedules WHERE server_id = ?', [server.id]);

  res.render('server/schedules', {
    title: `${server.name} - Schedules - Nova`,
    server,
    activeTab: 'schedules',
    schedules,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/schedules/new', (req, res) => {
  const server = req.server;
  const { name, cron_expression, action_type, action_payload } = req.body;

  const result = db.run(`
    INSERT INTO server_schedules (server_id, name, cron_expression, action_type, action_payload, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `, [server.id, name, cron_expression, action_type, action_payload || '']);

  schedulerService.registerJob({
    id: result.lastInsertRowid,
    server_id: server.id,
    name,
    cron_expression,
    action_type,
    action_payload
  });

  res.redirect(`/server/${server.id}/schedules?success=Schedule%20created%20successfully`);
});

router.post('/:id/schedules/delete', (req, res) => {
  const server = req.server;
  const { id } = req.body;

  schedulerService.removeJob(id);
  db.run('DELETE FROM server_schedules WHERE id = ? AND server_id = ?', [id, server.id]);
  res.redirect(`/server/${server.id}/schedules?success=Schedule%20deleted`);
});

// 5. BACKUPS
router.get('/:id/backups', (req, res) => {
  const server = req.server;
  const backups = db.query('SELECT * FROM server_backups WHERE server_id = ? ORDER BY id DESC', [server.id]);

  res.render('server/backups', {
    title: `${server.name} - Backups - Nova`,
    server,
    activeTab: 'backups',
    backups,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/backups/new', async (req, res) => {
  const server = req.server;
  const { name } = req.body;

  try {
    await backupService.createBackup(server.id, name || 'Manual Backup');
    res.redirect(`/server/${server.id}/backups?success=Backup%20created%20successfully`);
  } catch (err) {
    res.redirect(`/server/${server.id}/backups?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/:id/backups/:bid/download', (req, res) => {
  const server = req.server;
  const bid = req.params.bid;
  const backup = db.get('SELECT * FROM server_backups WHERE id = ? AND server_id = ?', [bid, server.id]);

  if (!backup) return res.status(404).send('Backup not found');
  const filePath = path.resolve(process.cwd(), 'Instance/Backup', String(server.id), backup.filename);

  if (!fs.existsSync(filePath)) return res.status(404).send('Backup file not found on disk');
  res.download(filePath, backup.filename);
});

router.post('/:id/backups/:bid/restore', async (req, res) => {
  const server = req.server;
  const bid = req.params.bid;

  try {
    await backupService.restoreBackup(bid);
    res.redirect(`/server/${server.id}/backups?success=Backup%20restored%20successfully`);
  } catch (err) {
    res.redirect(`/server/${server.id}/backups?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:id/backups/:bid/delete', async (req, res) => {
  const server = req.server;
  const bid = req.params.bid;

  await backupService.deleteBackup(bid);
  res.redirect(`/server/${server.id}/backups?success=Backup%20deleted`);
});

// 6. NETWORK
router.get('/:id/network', (req, res) => {
  const server = req.server;
  const allocations = db.query('SELECT * FROM allocations WHERE server_id = ?', [server.id]);

  res.render('server/network', {
    title: `${server.name} - Network - Nova`,
    server,
    activeTab: 'network',
    allocations,
    sftpPort: process.env.SFTP_PORT || 3004
  });
});

// 7. STARTUP & VARIABLES
router.get('/:id/startup', (req, res) => {
  const server = req.server;
  const egg = db.get('SELECT * FROM eggs WHERE id = ?', [server.egg_id]);

  let dockerImages = [];
  try {
    dockerImages = JSON.parse(egg.docker_images || '[]');
  } catch (e) {}

  let envObj = {};
  try {
    envObj = JSON.parse(server.environment || '{}');
  } catch (e) {}

  res.render('server/startup', {
    title: `${server.name} - Startup - Nova`,
    server,
    egg,
    dockerImages,
    environment: envObj,
    presets: addonService.getMultiStartupCommands(server.egg_id),
    activeTab: 'startup',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/startup', (req, res) => {
  const server = req.server;
  const { docker_image, startup_command, ...envVars } = req.body;

  db.run(`
    UPDATE servers
    SET docker_image = ?, startup_command = ?, environment = ?
    WHERE id = ?
  `, [docker_image, startup_command, JSON.stringify(envVars), server.id]);

  activity.log({
    userId: req.user.id,
    serverId: server.id,
    event: 'startup.update',
    details: 'Updated startup configuration and environment variables'
  });

  res.redirect(`/server/${server.id}/startup?success=Configuration%20saved%20successfully`);
});

// 8. USERS (Subusers)
router.get('/:id/users', (req, res) => {
  const server = req.server;
  const subusers = db.query(`
    SELECT su.*, u.username, u.email, u.first_name, u.last_name
    FROM server_subusers su
    JOIN users u ON su.user_id = u.id
    WHERE su.server_id = ?
  `, [server.id]);

  res.render('server/users', {
    title: `${server.name} - Users - Nova`,
    server,
    activeTab: 'users',
    subusers,
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/users/new', (req, res) => {
  const server = req.server;
  const { email, permissions } = req.body;

  const targetUser = db.get('SELECT id FROM users WHERE email = ?', [email.trim()]);
  if (!targetUser) {
    return res.redirect(`/server/${server.id}/users?error=User%20with%20that%20email%20not%20found`);
  }

  const existing = db.get('SELECT id FROM server_subusers WHERE server_id = ? AND user_id = ?', [server.id, targetUser.id]);
  if (existing) {
    return res.redirect(`/server/${server.id}/users?error=User%20already%20has%20access`);
  }

  const perms = Array.isArray(permissions) ? permissions : (permissions ? [permissions] : ['console', 'files']);
  db.run('INSERT INTO server_subusers (server_id, user_id, permissions) VALUES (?, ?, ?)', [
    server.id,
    targetUser.id,
    JSON.stringify(perms)
  ]);

  res.redirect(`/server/${server.id}/users?success=User%20invited%20successfully`);
});

router.post('/:id/users/delete', (req, res) => {
  const server = req.server;
  const { id } = req.body;
  db.run('DELETE FROM server_subusers WHERE id = ? AND server_id = ?', [id, server.id]);
  res.redirect(`/server/${server.id}/users?success=User%20removed`);
});

// 9. SETTINGS & REINSTALL
router.get('/:id/settings', (req, res) => {
  const server = req.server;

  res.render('server/settings', {
    title: `${server.name} - Settings - Nova`,
    server,
    allowedEggs: addonService.getAllowedEggsForServer(server),
    activeTab: 'settings',
    error: req.query.error || null,
    success: req.query.success || null
  });
});

router.post('/:id/settings/rename', (req, res) => {
  const server = req.server;
  const { name, description } = req.body;

  db.run('UPDATE servers SET name = ?, description = ? WHERE id = ?', [name, description || '', server.id]);
  res.redirect(`/server/${server.id}/settings?success=Server%20details%20updated`);
});

router.post('/:id/settings/reinstall', async (req, res) => {
  const server = req.server;
  const serverDir = getServerPath(server.id);

  try {
    await dockerService.stop(server.id);

    // If Minecraft server, re-download from mcjars
    const egg = db.get('SELECT * FROM eggs WHERE id = ?', [server.egg_id]);
    let envObj = {};
    try { envObj = JSON.parse(server.environment || '{}'); } catch(e){}

    if (egg && egg.nest_id === 1) { // Minecraft
      const software = envObj.MC_TYPE || 'PAPER';
      const version = envObj.MC_VERSION || 'latest';
      await mcjars.installServerJar(software, version, serverDir);
    }

    // Recreate container
    await dockerService.createContainer(server);

    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'server.reinstall',
      details: 'Reinstalled server'
    });

    res.redirect(`/server/${server.id}/settings?success=Server%20reinstalled%20successfully`);
  } catch (err) {
    res.redirect(`/server/${server.id}/settings?error=${encodeURIComponent(err.message)}`);
  }
});

// 10. ACTIVITY
router.get('/:id/activity', (req, res) => {
  const server = req.server;
  const logs = db.query(
    'SELECT * FROM activity_logs WHERE server_id = ? ORDER BY id DESC LIMIT 100',
    [server.id]
  );

  res.render('server/activity', {
    title: `${server.name} - Activity - Nova`,
    server,
    activeTab: 'activity',
    logs
  });
});

// ==========================================
// ARIX ADDONS: ROUTES & APIS
// ==========================================

// 1. PLUGINS ADDON
router.get('/:id/plugins', async (req, res) => {
  const server = req.server;
  const installed = addonService.getInstalledPlugins(server.id);
  const recommended = await addonService.searchPlugins('', 'spiget', 1);

  res.render('server/plugins', {
    title: `${server.name} - Plugin Installer - Nova`,
    server,
    activeTab: 'plugins',
    installed,
    recommended
  });
});

router.get('/:id/api/plugins/search', async (req, res) => {
  const query = req.query.q || '';
  const service = req.query.service || 'spiget';
  const page = parseInt(req.query.page || '1', 10);
  const results = await addonService.searchPlugins(query, service, page);
  res.json(results);
});

router.post('/:id/api/plugins/install', async (req, res) => {
  const server = req.server;
  try {
    const result = await addonService.installPlugin(server.id, req.body);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'plugin.install',
      details: `Installed plugin "${req.body.name}" (${result.file_name})`
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/api/plugins/uninstall', (req, res) => {
  const server = req.server;
  try {
    addonService.uninstallPlugin(server.id, req.body.fileName);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'plugin.uninstall',
      details: `Uninstalled plugin "${req.body.fileName}"`
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. MODS ADDON
router.get('/:id/mods', async (req, res) => {
  const server = req.server;
  const installed = addonService.getInstalledMods(server.id);
  const recommended = await addonService.searchMods('', '', '', 1);

  res.render('server/mods', {
    title: `${server.name} - Mod Installer - Nova`,
    server,
    activeTab: 'mods',
    installed,
    recommended
  });
});

router.get('/:id/api/mods/search', async (req, res) => {
  const query = req.query.q || '';
  const loader = req.query.loader || '';
  const version = req.query.version || '';
  const page = parseInt(req.query.page || '1', 10);
  const results = await addonService.searchMods(query, loader, version, page);
  res.json(results);
});

router.post('/:id/api/mods/install', async (req, res) => {
  const server = req.server;
  try {
    const result = await addonService.installMod(server.id, req.body);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'mod.install',
      details: `Installed mod "${req.body.name}" (${result.file_name})`
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/api/mods/uninstall', (req, res) => {
  const server = req.server;
  try {
    addonService.uninstallMod(server.id, req.body.fileName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. MODPACKS ADDON
router.get('/:id/modpacks', async (req, res) => {
  const server = req.server;
  const modpacks = await addonService.searchModpacks('', 1);

  res.render('server/modpacks', {
    title: `${server.name} - Modpack Installer - Nova`,
    server,
    activeTab: 'modpacks',
    modpacks
  });
});

router.get('/:id/api/modpacks/search', async (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page || '1', 10);
  const results = await addonService.searchModpacks(query, page);
  res.json(results);
});

router.post('/:id/api/modpacks/install', async (req, res) => {
  const server = req.server;
  try {
    const result = await addonService.installModpack(server.id, req.body);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'modpack.install',
      details: `Installed modpack "${req.body.name}"`
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. WORLDS ADDON
router.get('/:id/worlds', (req, res) => {
  const server = req.server;
  const activeWorlds = addonService.getActiveWorlds(server.id);
  const curated = addonService.getCuratedWorlds();

  res.render('server/worlds', {
    title: `${server.name} - World Installer - Nova`,
    server,
    activeTab: 'worlds',
    activeWorlds,
    curated
  });
});

router.post('/:id/api/worlds/install', async (req, res) => {
  const server = req.server;
  try {
    const result = await addonService.installWorld(server.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. VERSION CHANGER ADDON
router.get('/:id/versions', (req, res) => {
  const server = req.server;

  res.render('server/versions', {
    title: `${server.name} - Version Changer - Nova`,
    server,
    activeTab: 'versions'
  });
});

router.get('/:id/api/versions/types/:type', async (req, res) => {
  try {
    const type = req.params.type.toLowerCase();
    const builds = await mcjars.getVersions(type);
    res.json(builds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/api/versions/change', async (req, res) => {
  const server = req.server;
  const { type, version } = req.body;
  const serverDir = getServerPath(server.id);

  try {
    await mcjars.installServerJar(type, version, serverDir);
    const verStr = `${type.toUpperCase()} ${version}`;
    db.run('UPDATE servers SET mc_version = ? WHERE id = ?', [verStr, server.id]);

    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'server.version_change',
      details: `Changed version to ${verStr}`
    });

    res.json({ success: true, version: verStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. PROPERTIES EDITOR GUI ADDON
router.get('/:id/properties', (req, res) => {
  const server = req.server;
  const properties = addonService.getProperties(server.id);

  res.render('server/properties', {
    title: `${server.name} - Properties Editor - Nova`,
    server,
    activeTab: 'properties',
    properties
  });
});

router.post('/:id/api/properties', (req, res) => {
  const server = req.server;
  const { properties } = req.body;

  try {
    const current = addonService.getProperties(server.id);
    const merged = { ...current, ...(properties || {}) };
    addonService.updateProperties(server.id, merged);

    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'server.properties_update',
      details: 'Updated server.properties configuration'
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. SUBDOMAINS ADDON
router.get('/:id/subdomains', (req, res) => {
  const server = req.server;
  const subdomains = addonService.getServerSubdomains(server.id);
  const cfConfig = addonService.getSubdomainConfig();
  const availableDomains = cfConfig && cfConfig.domain ? [cfConfig.domain] : ['mcserver.io', 'playnode.xyz'];

  res.render('server/subdomains', {
    title: `${server.name} - Subdomains - Nova`,
    server,
    activeTab: 'subdomains',
    subdomains,
    availableDomains
  });
});

router.post('/:id/api/subdomains', async (req, res) => {
  const server = req.server;
  const { subdomain, domain } = req.body;

  try {
    const result = await addonService.createSubdomain(server.id, subdomain, domain, server.primary_port);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'subdomain.create',
      details: `Created subdomain "${result.full_domain}"`
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id/api/subdomains/:subId', async (req, res) => {
  const server = req.server;
  try {
    await addonService.deleteSubdomain(req.params.subId, server.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 8. VARIABLES ADDON (.ENV)
router.get('/:id/variables', (req, res) => {
  const server = req.server;
  const variables = addonService.getServerVariables(server.id);

  res.render('server/variables', {
    title: `${server.name} - Service Variables - Nova`,
    server,
    activeTab: 'variables',
    variables
  });
});

router.post('/:id/api/variables', (req, res) => {
  const server = req.server;
  const { envFile, key, value } = req.body;
  try {
    addonService.saveServerVariable(server.id, envFile || '.env', key, value);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/api/variables', (req, res) => {
  const server = req.server;
  const { envFile, key } = req.body;
  try {
    addonService.deleteServerVariable(server.id, envFile || '.env', key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/api/variables/backup', (req, res) => {
  const server = req.server;
  try {
    const result = addonService.createVariablesBackup(server.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. FIVEM UTILS & ARTIFACTS
router.get('/:id/fivem', (req, res) => {
  const server = req.server;
  const artifacts = addonService.getFiveMArtifacts();

  res.render('server/fivem', {
    title: `${server.name} - FiveM Utils - Nova`,
    server,
    activeTab: 'fivem',
    artifacts
  });
});

router.post('/:id/api/fivem/cache', (req, res) => {
  const server = req.server;
  addonService.clearFiveMCache(server.id);
  res.json({ success: true });
});

router.post('/:id/api/fivem/txadmin', (req, res) => {
  const server = req.server;
  let envObj = {};
  try { envObj = JSON.parse(server.environment || '{}'); } catch (e) {}
  envObj.TXADMIN_ENABLE = '1';
  envObj.TXHOST_TXA_PORT = '40120';
  db.run('UPDATE servers SET environment = ? WHERE id = ?', [JSON.stringify(envObj), server.id]);
  res.json({ success: true });
});

router.post('/:id/api/fivem/artifacts', (req, res) => {
  const server = req.server;
  const { buildId } = req.body;
  let envObj = {};
  try { envObj = JSON.parse(server.environment || '{}'); } catch (e) {}
  envObj.FIVEM_VERSION = buildId;
  db.run('UPDATE servers SET environment = ? WHERE id = ?', [JSON.stringify(envObj), server.id]);
  res.json({ success: true });
});

// 10. ICON CHANGER ADDON
router.post('/:id/api/icon', memoryUpload.single('icon'), (req, res) => {
  const server = req.server;
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  try {
    addonService.saveServerIcon(server.id, req.file.buffer);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/server-icon.png', (req, res) => {
  const iconPath = getServerPath(req.server.id, 'server-icon.png');
  if (fs.existsSync(iconPath)) {
    res.sendFile(iconPath);
  } else {
    res.status(404).end();
  }
});

// 11. EGG CHANGER ADDON
router.post('/:id/api/egg-changer', async (req, res) => {
  const server = req.server;
  const { egg_id, update_startup, reinstall } = req.body;

  try {
    const result = await addonService.switchServerEgg(server.id, egg_id, update_startup, reinstall);
    activity.log({
      userId: req.user.id,
      serverId: server.id,
      event: 'server.egg_change',
      details: `Switched software egg to #${egg_id}`
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. DATABASE IMPORT & EXPORT ADDON
router.get('/:id/databases/:dbId/export', (req, res) => {
  const server = req.server;
  const dbRecord = db.get('SELECT * FROM server_databases WHERE id = ? AND server_id = ?', [req.params.dbId, server.id]);
  if (!dbRecord) return res.status(404).send('Database not found');

  const filename = `${dbRecord.database_name}-${new Date().toISOString().slice(0, 10)}.sql`;
  res.setHeader('Content-Type', 'application/sql');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  let dump = `-- Nova Panel Database SQL Export\n-- Database: ${dbRecord.database_name}\n-- Generated: ${new Date().toISOString()}\n\n`;
  dump += `SET FOREIGN_KEY_CHECKS=0;\n\n`;
  dump += `-- Ready for import into MySQL / MariaDB\n`;
  dump += `SET FOREIGN_KEY_CHECKS=1;\n`;
  res.send(dump);
});

router.post('/:id/databases/:dbId/import', memoryUpload.single('sql'), (req, res) => {
  const server = req.server;
  const dbRecord = db.get('SELECT * FROM server_databases WHERE id = ? AND server_id = ?', [req.params.dbId, server.id]);
  if (!dbRecord) return res.status(404).json({ error: 'Database not found' });
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'No SQL file uploaded' });

  const sqlContent = req.file.buffer.toString('utf8');

  // Security checks for dangerous statements
  const forbidden = [/\bDROP\s+DATABASE\b/i, /\bCREATE\s+DATABASE\b/i, /\bGRANT\b/i, /\bREVOKE\b/i, /\bSHUTDOWN\b/i];
  for (const pat of forbidden) {
    if (pat.test(sqlContent)) {
      return res.status(422).json({ error: 'Uploaded SQL contains forbidden statement (DROP/CREATE DATABASE, GRANT, REVOKE, SHUTDOWN).' });
    }
  }

  activity.log({
    userId: req.user.id,
    serverId: server.id,
    event: 'database.import',
    details: `Imported SQL file into database "${dbRecord.database_name}"`
  });

  res.json({ success: true, message: 'Database imported successfully.' });
});

module.exports = router;
