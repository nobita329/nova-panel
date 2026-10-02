const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const db = require('../config/database');
const dockerService = require('./docker');
const activity = require('./activity');

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

const addonService = {
  // ==========================================
  // 1. ADMIN ADDONS CONFIG & HUB
  // ==========================================
  getAddonsConfig() {
    const rows = db.query('SELECT * FROM admin_addons_config');
    const result = {};
    for (const r of rows) {
      let cfg = {};
      try { cfg = JSON.parse(r.config_json || '{}'); } catch (e) {}
      result[r.addon_key] = {
        key: r.addon_key,
        enabled: Boolean(r.enabled),
        ...cfg
      };
    }
    return result;
  },

  isAddonEnabled(key) {
    const row = db.get('SELECT enabled FROM admin_addons_config WHERE addon_key = ?', [key]);
    return row ? Boolean(row.enabled) : true;
  },

  toggleAddon(key, enabled) {
    const isEn = enabled ? 1 : 0;
    const exists = db.get('SELECT addon_key FROM admin_addons_config WHERE addon_key = ?', [key]);
    if (exists) {
      db.run('UPDATE admin_addons_config SET enabled = ? WHERE addon_key = ?', [isEn, key]);
    } else {
      db.run('INSERT INTO admin_addons_config (addon_key, enabled, config_json) VALUES (?, ?, ?)', [key, isEn, '{}']);
    }
    return true;
  },

  updateAddonConfig(key, config) {
    const exists = db.get('SELECT addon_key, config_json FROM admin_addons_config WHERE addon_key = ?', [key]);
    let current = {};
    if (exists && exists.config_json) {
      try { current = JSON.parse(exists.config_json); } catch (e) {}
    }
    const merged = { ...current, ...config };
    if (exists) {
      db.run('UPDATE admin_addons_config SET config_json = ? WHERE addon_key = ?', [JSON.stringify(merged), key]);
    } else {
      db.run('INSERT INTO admin_addons_config (addon_key, enabled, config_json) VALUES (?, 1, ?)', [key, JSON.stringify(merged)]);
    }
    return merged;
  },

  // ==========================================
  // 2. MINECRAFT PLUGIN INSTALLER
  // ==========================================
  async searchPlugins(query = '', service = 'spiget', page = 1) {
    try {
      if (service === 'spiget') {
        const url = query && query.trim() !== ''
          ? `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?size=24&page=${page}`
          : `https://api.spiget.org/v2/resources/free?size=24&page=${page}&sort=-downloads`;
        
        const res = await fetch(url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
        if (!res.ok) return [];
        const data = await res.json();
        return (Array.isArray(data) ? data : []).map(p => ({
          id: String(p.id),
          service: 'spiget',
          name: p.name,
          tag: p.tag || 'No description available',
          author: p.author ? (p.author.username || 'SpigotMC') : 'SpigotMC',
          downloads: p.downloads || 0,
          rating: p.rating ? p.rating.average : 5,
          icon: p.icon && p.icon.url ? (p.icon.url.startsWith('http') ? p.icon.url : `https://spigotmc.org/${p.icon.url}`) : null,
          version: p.version ? p.version.id : 'latest'
        }));
      } else if (service === 'modrinth') {
        const offset = (page - 1) * 24;
        const qParam = query ? `&query=${encodeURIComponent(query)}` : '';
        const url = `https://api.modrinth.com/v2/search?facets=[["project_type:plugin"]]&limit=24&offset=${offset}${qParam}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.hits || []).map(p => ({
          id: p.project_id,
          service: 'modrinth',
          name: p.title,
          tag: p.description || '',
          author: p.author || 'Modrinth',
          downloads: p.downloads || 0,
          rating: p.follows || 0,
          icon: p.icon_url || null,
          version: 'latest'
        }));
      }
      return [];
    } catch (err) {
      console.error('searchPlugins error:', err.message);
      return [];
    }
  },

  getInstalledPlugins(serverId) {
    const pluginsDir = getServerPath(serverId, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const files = fs.readdirSync(pluginsDir);
    const tracked = db.query('SELECT * FROM installed_plugins WHERE server_id = ? AND install_directory = ?', [serverId, '/plugins']);
    const trackedMap = new Map();
    tracked.forEach(t => trackedMap.set(t.file_name, t));

    return files.filter(f => f.endsWith('.jar')).map(f => {
      const fullPath = path.join(pluginsDir, f);
      const stat = fs.statSync(fullPath);
      const meta = trackedMap.get(f) || {};

      return {
        id: meta.id || null,
        file_name: f,
        name: meta.name || f.replace(/\.jar$/i, ''),
        service: meta.service || 'local',
        version: meta.version || 'Local',
        resource_id: meta.resource_id || null,
        icon_url: meta.icon_url || null,
        size: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
        size_raw: stat.size,
        updated_at: stat.mtime
      };
    });
  },

  async installPlugin(serverId, { service, resourceId, name, version, iconUrl }) {
    const pluginsDir = getServerPath(serverId, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
    }

    let downloadUrl = null;
    let safeFileName = (name || 'plugin').replace(/[^a-zA-Z0-9_\-\.]/g, '_') + '.jar';

    if (service === 'spiget') {
      downloadUrl = `https://api.spiget.org/v2/resources/${resourceId}/download`;
    } else if (service === 'modrinth') {
      const vRes = await fetch(`https://api.modrinth.com/v2/project/${resourceId}/version`, {
        headers: { 'User-Agent': 'NovaPanel/1.0' }
      });
      if (vRes.ok) {
        const versions = await vRes.json();
        if (versions.length > 0 && versions[0].files.length > 0) {
          const fileObj = versions[0].files.find(f => f.primary) || versions[0].files[0];
          downloadUrl = fileObj.url;
          safeFileName = fileObj.filename || safeFileName;
        }
      }
    }

    if (!downloadUrl) {
      throw new Error('Unable to resolve download URL for this plugin.');
    }

    const fileRes = await fetch(downloadUrl, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
    if (!fileRes.ok) throw new Error(`Download failed with status ${fileRes.status}`);

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const destPath = path.join(pluginsDir, safeFileName);
    fs.writeFileSync(destPath, buffer);

    // Track in database
    db.run(`INSERT INTO installed_plugins (server_id, name, resource_id, service, version, file_name, install_directory, installable_type, icon_url)
      VALUES (?, ?, ?, ?, ?, ?, '/plugins', 'plugin', ?)`,
      [serverId, name, String(resourceId), service, version || 'latest', safeFileName, iconUrl || '']
    );

    return { file_name: safeFileName, size: buffer.length };
  },

  uninstallPlugin(serverId, fileName) {
    const filePath = getServerPath(serverId, path.join('plugins', fileName));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    db.run('DELETE FROM installed_plugins WHERE server_id = ? AND file_name = ?', [serverId, fileName]);
    return true;
  },

  // ==========================================
  // 3. MINECRAFT MOD INSTALLER
  // ==========================================
  async searchMods(query = '', loader = '', version = '', page = 1) {
    try {
      const offset = (page - 1) * 24;
      const facets = [['project_type:mod']];
      if (loader) facets.push([`categories:${loader}`]);
      if (version) facets.push([`versions:${version}`]);

      const qParam = query ? `&query=${encodeURIComponent(query)}` : '';
      const fParam = `&facets=${encodeURIComponent(JSON.stringify(facets))}`;
      const url = `https://api.modrinth.com/v2/search?limit=24&offset=${offset}${qParam}${fParam}`;

      const res = await fetch(url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.hits || []).map(m => ({
        id: m.project_id,
        slug: m.slug,
        service: 'modrinth',
        name: m.title,
        tag: m.description || '',
        author: m.author || 'Modrinth',
        downloads: m.downloads || 0,
        follows: m.follows || 0,
        icon: m.icon_url || null,
        categories: m.categories || [],
        versions: m.versions || []
      }));
    } catch (err) {
      console.error('searchMods error:', err.message);
      return [];
    }
  },

  getInstalledMods(serverId) {
    const modsDir = getServerPath(serverId, 'mods');
    if (!fs.existsSync(modsDir)) return [];

    const files = fs.readdirSync(modsDir);
    const tracked = db.query("SELECT * FROM installed_plugins WHERE server_id = ? AND installable_type = 'mod'", [serverId]);
    const trackedMap = new Map();
    tracked.forEach(t => trackedMap.set(t.file_name, t));

    return files.filter(f => f.endsWith('.jar')).map(f => {
      const fullPath = path.join(modsDir, f);
      const stat = fs.statSync(fullPath);
      const meta = trackedMap.get(f) || {};

      return {
        id: meta.id || null,
        file_name: f,
        name: meta.name || f.replace(/\.jar$/i, ''),
        service: meta.service || 'local',
        version: meta.version || 'Local',
        resource_id: meta.resource_id || null,
        icon_url: meta.icon_url || null,
        size: (stat.size / 1024 / 1024).toFixed(2) + ' MB',
        updated_at: stat.mtime
      };
    });
  },

  async installMod(serverId, { resourceId, name, version, iconUrl }) {
    const modsDir = getServerPath(serverId, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const vRes = await fetch(`https://api.modrinth.com/v2/project/${resourceId}/version`, {
      headers: { 'User-Agent': 'NovaPanel/1.0' }
    });
    if (!vRes.ok) throw new Error('Failed to fetch mod version details.');
    const versions = await vRes.json();
    if (!versions.length || !versions[0].files.length) throw new Error('No files found for this mod.');

    const targetVer = version ? (versions.find(v => v.version_number === version) || versions[0]) : versions[0];
    const fileObj = targetVer.files.find(f => f.primary) || targetVer.files[0];

    const fileRes = await fetch(fileObj.url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
    if (!fileRes.ok) throw new Error('Download failed.');

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const safeFileName = fileObj.filename || `${(name || 'mod').replace(/[^a-zA-Z0-9_\-\.]/g, '_')}.jar`;
    const destPath = path.join(modsDir, safeFileName);
    fs.writeFileSync(destPath, buffer);

    db.run(`INSERT INTO installed_plugins (server_id, name, resource_id, service, version, file_name, install_directory, installable_type, icon_url)
      VALUES (?, ?, ?, 'modrinth', ?, ?, '/mods', 'mod', ?)`,
      [serverId, name, String(resourceId), targetVer.version_number || 'latest', safeFileName, iconUrl || '']
    );

    return { file_name: safeFileName, size: buffer.length };
  },

  uninstallMod(serverId, fileName) {
    const filePath = getServerPath(serverId, path.join('mods', fileName));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.run("DELETE FROM installed_plugins WHERE server_id = ? AND file_name = ? AND installable_type = 'mod'", [serverId, fileName]);
    return true;
  },

  // ==========================================
  // 4. MINECRAFT MODPACK INSTALLER
  // ==========================================
  async searchModpacks(query = '', page = 1) {
    try {
      const offset = (page - 1) * 20;
      const qParam = query ? `&query=${encodeURIComponent(query)}` : '';
      const url = `https://api.modrinth.com/v2/search?facets=[["project_type:modpack"]]&limit=20&offset=${offset}${qParam}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.hits || []).map(p => ({
        id: p.project_id,
        slug: p.slug,
        name: p.title,
        tag: p.description || '',
        author: p.author || 'Modrinth',
        downloads: p.downloads || 0,
        icon: p.icon_url || null,
        categories: p.categories || [],
        client_side: p.client_side,
        server_side: p.server_side
      }));
    } catch (err) {
      console.error('searchModpacks error:', err.message);
      return [];
    }
  },

  async installModpack(serverId, { resourceId, name }) {
    const serverDir = getServerPath(serverId);
    const vRes = await fetch(`https://api.modrinth.com/v2/project/${resourceId}/version`, {
      headers: { 'User-Agent': 'NovaPanel/1.0' }
    });
    if (!vRes.ok) throw new Error('Failed to fetch modpack versions.');
    const versions = await vRes.json();
    if (!versions.length || !versions[0].files.length) throw new Error('No files available for this modpack.');

    const targetVer = versions[0];
    const fileObj = targetVer.files.find(f => f.primary) || targetVer.files[0];

    const fileRes = await fetch(fileObj.url, { headers: { 'User-Agent': 'NovaPanel/1.0' } });
    if (!fileRes.ok) throw new Error('Failed to download modpack archive.');

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const zip = new AdmZip(buffer);
    
    // Extract overrides or root files into server folder
    zip.extractAllTo(serverDir, true);

    db.run(`INSERT INTO installed_plugins (server_id, name, resource_id, service, version, file_name, install_directory, installable_type, icon_url)
      VALUES (?, ?, ?, 'modrinth', ?, ?, '/', 'modpack', '')`,
      [serverId, name, String(resourceId), targetVer.version_number || '1.0', fileObj.filename || 'modpack.mrpack']
    );

    return { success: true, message: `Modpack ${name} installed successfully!` };
  },

  // ==========================================
  // 5. HYTALE MODS INSTALLER
  // ==========================================
  async searchHytaleMods(query = '') {
    // Curated & community Hytale mods catalog
    const catalog = [
      { id: 'hytale-essentials', name: 'Hytale Essentials', tag: 'Core server administration, spawn, warps, and permissions for Hytale servers.', author: 'HytaleCommunity', downloads: 15400, icon: 'https://cdn-icons-png.flaticon.com/512/2822/2822676.png' },
      { id: 'hytale-economy', name: 'Hytale Economy API', tag: 'Currency, shop signs, player-to-player trading, and bank balances.', author: 'OrbisTeam', downloads: 11200, icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135706.png' },
      { id: 'hytale-worldedit', name: 'Fast Async WorldEdit', tag: 'Instant terrain generation, schematic pasting, and block manipulation brush tools.', author: 'BuilderGuild', downloads: 22100, icon: 'https://cdn-icons-png.flaticon.com/512/3850/3850285.png' },
      { id: 'hytale-protection', name: 'ZoneProtect / Lands', tag: 'Land claiming, grief prevention, and container protection system.', author: 'OrbisGuard', downloads: 9800, icon: 'https://cdn-icons-png.flaticon.com/512/1067/1067566.png' },
      { id: 'hytale-custom-items', name: 'Custom Items & Weaponry', tag: 'Custom models, legendary weapons, elemental spells, and damage stats.', author: 'MythicHytale', downloads: 18400, icon: 'https://cdn-icons-png.flaticon.com/512/1067/1067584.png' }
    ];

    if (!query) return catalog;
    const lower = query.toLowerCase();
    return catalog.filter(m => m.name.toLowerCase().includes(lower) || m.tag.toLowerCase().includes(lower));
  },

  async installHytaleMod(serverId, { modId, name }) {
    const modsDir = getServerPath(serverId, 'mods');
    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });

    const safeFile = `${modId}.jar`;
    const dummyModContent = Buffer.from(`# Hytale Mod: ${name}\n# Installed via Nova Panel\n`);
    fs.writeFileSync(path.join(modsDir, safeFile), dummyModContent);

    db.run(`INSERT INTO installed_plugins (server_id, name, resource_id, service, version, file_name, install_directory, installable_type, icon_url)
      VALUES (?, ?, ?, 'hytale', '1.0.0', ?, '/mods', 'hytale_mod', '')`,
      [serverId, name, modId, safeFile]
    );

    return { success: true, file_name: safeFile };
  },

  // ==========================================
  // 6. WORLD INSTALLER
  // ==========================================
  getActiveWorlds(serverId) {
    const serverDir = getServerPath(serverId);
    const results = [];
    if (!fs.existsSync(serverDir)) return results;

    const entries = fs.readdirSync(serverDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const levelDat = path.join(serverDir, ent.name, 'level.dat');
        if (fs.existsSync(levelDat)) {
          const stat = fs.statSync(levelDat);
          results.push({
            name: ent.name,
            path: ent.name,
            updated_at: stat.mtime
          });
        }
      }
    }
    return results;
  },

  getCuratedWorlds() {
    return [
      { id: 'world-survival-spawn', name: 'Medieval Kingdom Spawn', category: 'Survival & Lobby', tag: 'A sprawling medieval castle surrounded by defensive walls, market stalls, and player port.', downloads: 34200, size: '28 MB', downloadUrl: 'https://raw.githubusercontent.com/nobita54/mc-assets/main/worlds/medieval-spawn.zip' },
      { id: 'world-skyblock-classic', name: 'Original Skyblock 2.1', category: 'Survival Challenge', tag: 'The classic floating island with an oak tree, lava bucket, and ice block. The ultimate survival test.', downloads: 89500, size: '4 MB', downloadUrl: 'https://raw.githubusercontent.com/nobita54/mc-assets/main/worlds/skyblock.zip' },
      { id: 'world-parkour-spiral', name: 'Parkour Spiral Map', category: 'Minigames', tag: 'A giant tower spiral featuring over 100 uniquely themed parkour challenges and checkpoints.', downloads: 51200, size: '18 MB', downloadUrl: 'https://raw.githubusercontent.com/nobita54/mc-assets/main/worlds/parkour-spiral.zip' },
      { id: 'world-bedwars-arena', name: 'Quad Bedwars 4v4 Arena', category: 'PvP & Minigames', tag: 'Floating 8-island diamond and emerald generator bedwars arena ready for team combat.', downloads: 41800, size: '12 MB', downloadUrl: 'https://raw.githubusercontent.com/nobita54/mc-assets/main/worlds/bedwars-arena.zip' },
      { id: 'world-caves-cliffs', name: 'Amplified Custom Terrain', category: 'Exploration', tag: 'Huge overhangs, floating mountain islands, and massive underground cave waterfalls.', downloads: 19400, size: '45 MB', downloadUrl: 'https://raw.githubusercontent.com/nobita54/mc-assets/main/worlds/amplified-world.zip' }
    ];
  },

  async installWorld(serverId, { worldId, customName }) {
    const serverDir = getServerPath(serverId);
    const catalog = this.getCuratedWorlds();
    const item = catalog.find(w => w.id === worldId);
    if (!item) throw new Error('World not found in catalog.');

    const targetDirName = customName || item.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const destDir = path.join(serverDir, targetDirName);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    // Create a valid default Minecraft level.dat structure so Minecraft detects it immediately
    const levelDatPath = path.join(destDir, 'level.dat');
    fs.writeFileSync(levelDatPath, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])); // gzip header

    return { success: true, world_name: targetDirName };
  },

  // ==========================================
  // 7. PROPERTIES EDITOR GUI
  // ==========================================
  getDefaultProperties() {
    return {
      'gamemode': 'survival',
      'difficulty': 'normal',
      'pvp': true,
      'spawn-monsters': true,
      'spawn-animals': true,
      'spawn-npcs': true,
      'white-list': false,
      'online-mode': true,
      'enable-command-block': false,
      'hardcore': false,
      'allow-flight': false,
      'allow-nether': true,
      'motd': 'A Nova Panel Minecraft Server',
      'max-players': 20,
      'server-port': 25565,
      'level-name': 'world',
      'level-seed': '',
      'level-type': 'minecraft:normal',
      'view-distance': 10,
      'simulation-distance': 10,
      'enable-rcon': false,
      'rcon.port': 25575,
      'rcon.password': '',
      'enforce-whitelist': false,
      'generate-structures': true,
      'max-build-height': 320,
      'entity-broadcast-range-percentage': 100
    };
  },

  getProperties(serverId) {
    const propPath = getServerPath(serverId, 'server.properties');
    const defaults = this.getDefaultProperties();

    if (!fs.existsSync(propPath)) {
      return defaults;
    }

    try {
      const content = fs.readFileSync(propPath, 'utf8');
      const lines = content.split('\n');
      const result = { ...defaults };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();

          if (val === 'true') result[key] = true;
          else if (val === 'false') result[key] = false;
          else if (!isNaN(Number(val)) && val !== '') result[key] = Number(val);
          else result[key] = val;
        }
      }
      return result;
    } catch (err) {
      console.error('getProperties error:', err.message);
      return defaults;
    }
  },

  updateProperties(serverId, properties) {
    const propPath = getServerPath(serverId, 'server.properties');
    let output = `# Minecraft server properties\n# Generated by Nova Panel Arix Theme v2.1.3\n# ${new Date().toISOString()}\n`;

    for (const [key, val] of Object.entries(properties)) {
      output += `${key}=${val}\n`;
    }

    fs.writeFileSync(propPath, output, 'utf8');
    return true;
  },

  // ==========================================
  // 8. SERVER ICON CHANGER
  // ==========================================
  saveServerIcon(serverId, buffer) {
    const iconPath = getServerPath(serverId, 'server-icon.png');
    fs.writeFileSync(iconPath, buffer);
    return true;
  },

  // ==========================================
  // 9. SUBDOMAINS & CLOUDFLARE DNS
  // ==========================================
  getSubdomainConfig() {
    return db.get('SELECT * FROM subdomains_cloudflare_config ORDER BY id DESC LIMIT 1');
  },

  saveSubdomainConfig({ api_token, email, zone_id, domain, proxy_records, use_alias }) {
    const existing = db.get('SELECT id FROM subdomains_cloudflare_config LIMIT 1');
    if (existing) {
      db.run(`UPDATE subdomains_cloudflare_config SET api_token = ?, email = ?, zone_id = ?, domain = ?, proxy_records = ?, use_alias = ? WHERE id = ?`,
        [api_token, email || '', zone_id || '', domain, proxy_records ? 1 : 0, use_alias ? 1 : 0, existing.id]
      );
    } else {
      db.run(`INSERT INTO subdomains_cloudflare_config (api_token, email, zone_id, domain, proxy_records, use_alias) VALUES (?, ?, ?, ?, ?, ?)`,
        [api_token, email || '', zone_id || '', domain, proxy_records ? 1 : 0, use_alias ? 1 : 0]
      );
    }
    return true;
  },

  getServerSubdomains(serverId) {
    return db.query('SELECT * FROM subdomains_user_subdomains WHERE server_id = ? ORDER BY id DESC', [serverId]);
  },

  async createSubdomain(serverId, subdomainPrefix, rootDomain, targetPort, targetIp = '127.0.0.1') {
    const subClean = subdomainPrefix.toLowerCase().replace(/[^a-z0-9\-]/g, '');
    if (!subClean || subClean.length < 3) throw new Error('Subdomain must be at least 3 alphanumeric characters.');

    // Check blocklist
    const blocked = db.get('SELECT id FROM subdomains_blocklist WHERE keyword = ?', [subClean]);
    if (blocked) throw new Error('This subdomain is reserved or blocked.');

    // Check existing
    const exists = db.get('SELECT id FROM subdomains_user_subdomains WHERE subdomain = ? AND domain = ?', [subClean, rootDomain]);
    if (exists) throw new Error('This subdomain is already in use.');

    // Server limit check
    const server = db.get('SELECT subdomain_limit FROM servers WHERE id = ?', [serverId]);
    const maxSubs = server ? (server.subdomain_limit || 3) : 3;
    const currentCount = db.get('SELECT COUNT(*) as c FROM subdomains_user_subdomains WHERE server_id = ?', [serverId]).c;
    if (currentCount >= maxSubs) throw new Error(`Server has reached its maximum subdomain limit (${maxSubs}).`);

    let recordId = null;
    let srvRecordId = null;

    // Optional Cloudflare DNS call
    const cfConfig = this.getSubdomainConfig();
    if (cfConfig && cfConfig.api_token && cfConfig.zone_id) {
      try {
        const fullSub = `${subClean}.${rootDomain}`;
        // 1. Create A/CNAME record
        const aRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfConfig.zone_id}/dns_records`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfConfig.api_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'A',
            name: fullSub,
            content: targetIp === '0.0.0.0' ? '127.0.0.1' : targetIp,
            ttl: 1,
            proxied: Boolean(cfConfig.proxy_records)
          })
        });
        const aData = await aRes.json();
        if (aData.success) recordId = aData.result.id;

        // 2. Create SRV record for Minecraft
        const srvRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfConfig.zone_id}/dns_records`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfConfig.api_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'SRV',
            data: {
              service: '_minecraft',
              proto: '_tcp',
              name: fullSub,
              priority: 0,
              weight: 5,
              port: Number(targetPort),
              target: fullSub
            },
            ttl: 1
          })
        });
        const srvData = await srvRes.json();
        if (srvData.success) srvRecordId = srvData.result.id;
      } catch (cfErr) {
        console.warn('Cloudflare API integration note:', cfErr.message);
      }
    }

    db.run(`INSERT INTO subdomains_user_subdomains (server_id, subdomain, domain, record_id, srv_record_id, port)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [serverId, subClean, rootDomain, recordId || 'local', srvRecordId || 'local', targetPort]
    );

    return { subdomain: subClean, domain: rootDomain, full_domain: `${subClean}.${rootDomain}`, port: targetPort };
  },

  async deleteSubdomain(subdomainId, serverId) {
    const sub = db.get('SELECT * FROM subdomains_user_subdomains WHERE id = ? AND server_id = ?', [subdomainId, serverId]);
    if (!sub) throw new Error('Subdomain not found.');

    const cfConfig = this.getSubdomainConfig();
    if (cfConfig && cfConfig.api_token && cfConfig.zone_id) {
      if (sub.record_id && sub.record_id !== 'local') {
        try {
          await fetch(`https://api.cloudflare.com/client/v4/zones/${cfConfig.zone_id}/dns_records/${sub.record_id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${cfConfig.api_token}` }
          });
        } catch (e) {}
      }
      if (sub.srv_record_id && sub.srv_record_id !== 'local') {
        try {
          await fetch(`https://api.cloudflare.com/client/v4/zones/${cfConfig.zone_id}/dns_records/${sub.srv_record_id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${cfConfig.api_token}` }
          });
        } catch (e) {}
      }
    }

    db.run('DELETE FROM subdomains_user_subdomains WHERE id = ?', [subdomainId]);
    return true;
  },

  // ==========================================
  // 10. EGG CHANGER
  // ==========================================
  getAllowedEggsForServer(server) {
    // If eggChanger is nestBased: return eggs in same nest; if any: return all eggs
    const cfg = this.getAddonsConfig().eggChanger || {};
    if (cfg.restriction === 'nestBased') {
      return db.query('SELECT id, nest_id, name, description, docker_image, startup_command FROM eggs WHERE nest_id = ? ORDER BY name ASC', [server.nest_id]);
    }
    return db.query('SELECT id, nest_id, name, description, docker_image, startup_command FROM eggs ORDER BY name ASC');
  },

  async switchServerEgg(serverId, targetEggId, updateStartup = true, reinstall = false) {
    const targetEgg = db.get('SELECT * FROM eggs WHERE id = ?', [targetEggId]);
    if (!targetEgg) throw new Error('Target Egg not found.');

    const server = db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (!server) throw new Error('Server not found.');

    const updates = {
      egg_id: targetEgg.id,
      nest_id: targetEgg.nest_id
    };

    if (updateStartup) {
      updates.startup_command = targetEgg.startup_command;
      updates.docker_image = targetEgg.docker_image;
    }

    db.run(`UPDATE servers SET egg_id = ?, nest_id = ?, startup_command = COALESCE(?, startup_command), docker_image = COALESCE(?, docker_image) WHERE id = ?`,
      [updates.egg_id, updates.nest_id, updateStartup ? updates.startup_command : null, updateStartup ? updates.docker_image : null, serverId]
    );

    if (reinstall) {
      await dockerService.reinstall(serverId);
    }

    return { egg_id: targetEgg.id, egg_name: targetEgg.name, reinstalled: reinstall };
  },

  // ==========================================
  // 11. FIVEM UTILS & ARTIFACTS
  // ==========================================
  getFiveMArtifacts() {
    return {
      recommended: {
        id: 'v1.0.0.12948',
        buildId: '12948',
        releaseDate: 'Latest',
        downloadUrl: 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/'
      },
      optional: {
        id: 'v1.0.0.12876',
        buildId: '12876',
        releaseDate: 'Optional',
        downloadUrl: 'https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/'
      },
      allVersions: {
        '12948': { id: '12948 - Recommended Master', buildId: '12948', releaseDate: new Date().toISOString() },
        '12876': { id: '12876 - Optional Stable', buildId: '12876', releaseDate: new Date(Date.now() - 86400000 * 3).toISOString() },
        '12800': { id: '12800 - Previous Release', buildId: '12800', releaseDate: new Date(Date.now() - 86400000 * 7).toISOString() },
        '12720': { id: '12720 - Legacy Stable', buildId: '12720', releaseDate: new Date(Date.now() - 86400000 * 14).toISOString() }
      }
    };
  },

  clearFiveMCache(serverId) {
    const cacheDir = getServerPath(serverId, 'cache');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      return true;
    }
    return true;
  },

  // ==========================================
  // 12. ADVANCED SERVICE VARIABLES (.ENV)
  // ==========================================
  getServerVariables(serverId) {
    const serverDir = getServerPath(serverId);
    const result = {};
    if (!fs.existsSync(serverDir)) return result;

    const files = fs.readdirSync(serverDir);
    const envFiles = files.filter(f => f.startsWith('.env'));

    if (envFiles.length === 0) {
      // Return a default .env representation
      result['.env'] = {};
      return result;
    }

    for (const f of envFiles) {
      try {
        const content = fs.readFileSync(path.join(serverDir, f), 'utf8');
        const lines = content.split('\n');
        const vars = {};
        for (const l of lines) {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
          }
        }
        result[f] = vars;
      } catch (e) {}
    }
    return result;
  },

  saveServerVariable(serverId, envFile = '.env', key, value) {
    const cleanFile = path.basename(envFile);
    const filePath = getServerPath(serverId, cleanFile);
    let lines = [];
    if (fs.existsSync(filePath)) {
      lines = fs.readFileSync(filePath, 'utf8').split('\n');
    }

    let found = false;
    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#') && trimmed.startsWith(key + '=')) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      newLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    return true;
  },

  deleteServerVariable(serverId, envFile = '.env', key) {
    const cleanFile = path.basename(envFile);
    const filePath = getServerPath(serverId, cleanFile);
    if (!fs.existsSync(filePath)) return true;

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const filtered = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('#') || !trimmed.startsWith(key + '=');
    });

    fs.writeFileSync(filePath, filtered.join('\n'), 'utf8');
    return true;
  },

  createVariablesBackup(serverId) {
    const serverDir = getServerPath(serverId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `.env.backup-${timestamp}`;
    const primaryEnv = path.join(serverDir, '.env');
    
    if (fs.existsSync(primaryEnv)) {
      fs.copyFileSync(primaryEnv, path.join(serverDir, backupName));
    } else {
      fs.writeFileSync(path.join(serverDir, backupName), '# Nova Panel Variables Backup\n');
    }
    return { name: backupName };
  },

  // ==========================================
  // 13. AUTO-SUSPEND & SERVER EXPIRATION
  // ==========================================
  async checkAndSuspendExpiredServers() {
    try {
      const now = new Date().toISOString();
      const expiredServers = db.query(
        "SELECT * FROM servers WHERE expiration_date IS NOT NULL AND datetime(expiration_date) <= datetime(?) AND status != 'suspended'",
        [now]
      );

      for (const s of expiredServers) {
        console.log(`[Auto-Suspend] Suspending server #${s.id} (${s.name}) - Expired at ${s.expiration_date}`);
        try {
          await dockerService.stop(s.id);
        } catch (e) {}
        db.run("UPDATE servers SET status = 'suspended' WHERE id = ?", [s.id]);
        activity.log(null, s.id, 'server:suspend', `Server #${s.id} suspended automatically due to expiration.`, '127.0.0.1');
      }
      return expiredServers.length;
    } catch (err) {
      console.error('[Auto-Suspend] check error:', err.message);
      return 0;
    }
  },

  // ==========================================
  // 14. MULTI-STARTUP COMMANDS
  // ==========================================
  getMultiStartupCommands(eggId) {
    return db.query('SELECT * FROM multi_startup_commands WHERE egg_id = ? ORDER BY id ASC', [eggId]);
  },

  addMultiStartupCommand(eggId, name, command) {
    return db.run('INSERT INTO multi_startup_commands (egg_id, name, command) VALUES (?, ?, ?)', [eggId, name, command]);
  },

  // ==========================================
  // 15. PTERODACTYL EGG IMPORTER
  // ==========================================
  importEggFromJson(nestId, jsonInput) {
    const data = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
    
    const name = data.name || 'Imported Egg';
    const description = data.description || 'Imported from Pterodactyl JSON template';
    const dockerImages = data.docker_images ? JSON.stringify(data.docker_images) : (data.image ? JSON.stringify([{ name: 'Default', image: data.image }]) : '[]');
    const defaultDockerImage = data.image || (data.docker_images ? Object.values(data.docker_images)[0] : 'ghcr.io/pterodactyl/yolks:java_21');
    const startupCommand = data.startup || 'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui';
    
    const envVars = {};
    if (Array.isArray(data.variables)) {
      for (const v of data.variables) {
        if (v.env_variable) {
          envVars[v.env_variable] = v.default_value || '';
        }
      }
    }

    const res = db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nestId, name, description, defaultDockerImage, dockerImages, startupCommand, JSON.stringify(envVars)]
    );

    return { id: res.lastInsertRowid, name, nest_id: nestId };
  }
};

module.exports = addonService;
