const db = require('../config/database');

console.log('🔄 Running Arix Addons Migrations...');

// 1. Create Addon Tables
db.exec(`
CREATE TABLE IF NOT EXISTS installed_plugins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  resource_id TEXT,
  service TEXT DEFAULT 'spiget',
  version TEXT,
  file_name TEXT NOT NULL,
  install_directory TEXT DEFAULT '/plugins',
  installable_type TEXT DEFAULT 'plugin',
  icon_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subdomains_cloudflare_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_token TEXT NOT NULL,
  email TEXT,
  zone_id TEXT,
  domain TEXT NOT NULL,
  proxy_records INTEGER DEFAULT 0,
  use_alias INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subdomains_user_subdomains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  subdomain TEXT NOT NULL,
  domain TEXT NOT NULL,
  record_id TEXT,
  srv_record_id TEXT,
  port INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subdomains_blocklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS multi_startup_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  egg_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(egg_id) REFERENCES eggs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_addons_config (
  addon_key TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  config_json TEXT DEFAULT '{}'
);
`);

// 2. Add columns to servers table if missing
const serverCols = db.query("PRAGMA table_info(servers)").map(c => c.name);

if (!serverCols.includes('expiration_date')) {
  try {
    db.exec("ALTER TABLE servers ADD COLUMN expiration_date DATETIME DEFAULT NULL;");
    console.log('✅ Added expiration_date column to servers table.');
  } catch (err) {
    console.warn('Note on expiration_date column:', err.message);
  }
}

if (!serverCols.includes('subdomain_limit')) {
  try {
    db.exec("ALTER TABLE servers ADD COLUMN subdomain_limit INTEGER DEFAULT 3;");
    console.log('✅ Added subdomain_limit column to servers table.');
  } catch (err) {
    console.warn('Note on subdomain_limit column:', err.message);
  }
}

if (!serverCols.includes('mc_version')) {
  try {
    db.exec("ALTER TABLE servers ADD COLUMN mc_version TEXT DEFAULT NULL;");
    console.log('✅ Added mc_version column to servers table.');
  } catch (err) {
    console.warn('Note on mc_version column:', err.message);
  }
}

// 3. Seed All 17+ Addon Configurations
const defaultAddons = [
  {
    key: 'autoSuspend',
    enabled: 1,
    config: {
      name: 'Auto-Suspend / Server Expiration',
      description: 'Automatically suspends servers when their expiration date is reached.',
      category: 'Billing & Expiration',
      icon: 'fa-solid fa-hourglass-half'
    }
  },
  {
    key: 'databaseImportExport',
    enabled: 1,
    config: {
      name: 'Database Import & Export',
      description: 'Allows downloading full SQL dumps and importing .sql files directly into server databases.',
      category: 'Databases',
      icon: 'fa-solid fa-file-import'
    }
  },
  {
    key: 'eggChanger',
    enabled: 1,
    config: {
      name: 'Egg Changer',
      description: 'Enables users to change server egg or software dynamically with optional auto-reinstall.',
      restriction: 'nestBased',
      category: 'Software & Core',
      icon: 'fa-solid fa-egg'
    }
  },
  {
    key: 'fivemArtifactChanger',
    enabled: 1,
    config: {
      name: 'FiveM Artifacts Changer',
      description: 'Switch FiveM server artifacts (builds) easily with recommended and optional release flags.',
      category: 'Gaming',
      icon: 'fa-solid fa-car-burst'
    }
  },
  {
    key: 'fivemUtils',
    enabled: 1,
    config: {
      name: 'FiveM Utils & txAdmin',
      description: 'One-click txAdmin activation/login and cache clearing for FiveM servers.',
      category: 'Gaming',
      icon: 'fa-solid fa-shield-virus'
    }
  },
  {
    key: 'hytaleModsInstaller',
    enabled: 1,
    config: {
      name: 'Hytale Mods Installer',
      description: 'Install and manage Hytale mods directly into the /mods server directory.',
      category: 'Installers',
      icon: 'fa-solid fa-cube'
    }
  },
  {
    key: 'iconChanger',
    enabled: 1,
    config: {
      name: 'Server Icon Changer',
      description: 'Visual 64x64 server-icon.png uploader with real-time Minecraft server list preview.',
      category: 'Customization',
      icon: 'fa-solid fa-image'
    }
  },
  {
    key: 'eggImporter',
    enabled: 1,
    config: {
      name: 'Pterodactyl Egg Importer',
      description: 'Bulk import and parse Pterodactyl/ParkerVCP JSON egg templates.',
      category: 'Templates',
      icon: 'fa-solid fa-file-arrow-up'
    }
  },
  {
    key: 'minecraftModInstaller',
    enabled: 1,
    config: {
      name: 'Minecraft Mod Installer',
      description: 'Search and 1-click install mods from Modrinth and CurseForge into /mods.',
      category: 'Installers',
      icon: 'fa-solid fa-cubes'
    }
  },
  {
    key: 'minecraftModpackInstaller',
    enabled: 1,
    config: {
      name: 'Minecraft Modpack Installer',
      description: 'Download and extract entire modpack archives (Modrinth & CurseForge) with 1 click.',
      category: 'Installers',
      icon: 'fa-solid fa-boxes-packing'
    }
  },
  {
    key: 'minecraftPluginInstaller',
    enabled: 1,
    config: {
      name: 'Minecraft Plugin Installer',
      description: 'Search SpigotMC / Spiget & Modrinth with direct 1-click install into /plugins.',
      category: 'Installers',
      icon: 'fa-solid fa-puzzle-piece'
    }
  },
  {
    key: 'propertiesEditor',
    enabled: 1,
    config: {
      name: 'Properties Editor GUI',
      description: 'Visual GUI toggle and slider editor for server.properties with live search.',
      category: 'Configuration',
      icon: 'fa-solid fa-sliders'
    }
  },
  {
    key: 'ratelimit',
    enabled: 1,
    config: {
      name: 'Rate Limiting & Security',
      description: 'Configure global API rate limiting, burst controls, and authentication throttling.',
      category: 'Security',
      icon: 'fa-solid fa-shield-halved'
    }
  },
  {
    key: 'recordGenerator',
    enabled: 1,
    config: {
      name: 'Record Generator',
      description: 'Generates DNS A and SRV records with 1-click copy for custom player domains.',
      category: 'Network',
      icon: 'fa-solid fa-network-wired'
    }
  },
  {
    key: 'subdomainManager',
    enabled: 1,
    config: {
      name: 'Subdomain Manager (Cloudflare)',
      description: 'Automatic Cloudflare DNS A and SRV record generation for user server subdomains.',
      category: 'Network',
      icon: 'fa-solid fa-globe'
    }
  },
  {
    key: 'startupChanger',
    enabled: 1,
    config: {
      name: 'Startup Changer',
      description: 'Manage multiple startup command presets (Aikar flags, JVM tuning, custom).',
      category: 'Configuration',
      icon: 'fa-solid fa-terminal'
    }
  },
  {
    key: 'variableManager',
    enabled: 1,
    config: {
      name: 'Advanced Service Variables',
      description: 'Edit, manage, and backup .env service variables directly from a visual table.',
      category: 'Configuration',
      icon: 'fa-solid fa-code'
    }
  },
  {
    key: 'versionChanger',
    enabled: 1,
    config: {
      name: 'Version Changer',
      description: 'Live Minecraft runtime switcher powered by mcjars.app (Paper, Purpur, Vanilla, Fabric, Forge, Velocity, Java 25+).',
      category: 'Software & Core',
      icon: 'fa-solid fa-code-branch'
    }
  },
  {
    key: 'minecraftWorldInstaller',
    enabled: 1,
    config: {
      name: 'World Installer',
      description: '1-click installer and downloader for Minecraft custom worlds and adventure maps.',
      category: 'Installers',
      icon: 'fa-solid fa-earth-americas'
    }
  }
];

for (const addon of defaultAddons) {
  const existing = db.get('SELECT addon_key FROM admin_addons_config WHERE addon_key = ?', [addon.key]);
  if (!existing) {
    db.run(
      'INSERT INTO admin_addons_config (addon_key, enabled, config_json) VALUES (?, ?, ?)',
      [addon.key, addon.enabled, JSON.stringify(addon.config)]
    );
  }
}

// 4. Seed Multi-startup command presets for Paper / Purpur / Vanilla
const paperEgg = db.get("SELECT id FROM eggs WHERE name = 'Paper'");
if (paperEgg) {
  const existingPreset = db.get('SELECT id FROM multi_startup_commands WHERE egg_id = ?', [paperEgg.id]);
  if (!existingPreset) {
    db.run(`INSERT INTO multi_startup_commands (egg_id, name, command) VALUES (?, ?, ?)`, [
      paperEgg.id,
      "Aikar's Optimized Flags",
      "java -Xms{{SERVER_MEMORY}}M -Xmx{{SERVER_MEMORY}}M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true -jar {{SERVER_JARFILE}} nogui"
    ]);
    db.run(`INSERT INTO multi_startup_commands (egg_id, name, command) VALUES (?, ?, ?)`, [
      paperEgg.id,
      "Standard JVM Flags",
      "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui"
    ]);
    db.run(`INSERT INTO multi_startup_commands (egg_id, name, command) VALUES (?, ?, ?)`, [
      paperEgg.id,
      "Low Memory / Small Server",
      "java -Xms64M -Xmx{{SERVER_MEMORY}}M -XX:+UseSerialGC -jar {{SERVER_JARFILE}} nogui"
    ]);
  }
}

console.log('✅ Arix Addons Migrations completed successfully!');
