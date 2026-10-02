const db = require('../config/database');
const fs = require('fs');
const path = require('path');

console.log('🔄 Running Nova Panel Migrations...');

// Ensure instance directories exist
const instanceDirs = [
  path.resolve(process.cwd(), 'Instance/server'),
  path.resolve(process.cwd(), 'Instance/Archive'),
  path.resolve(process.cwd(), 'Instance/Backup'),
  path.resolve(process.cwd(), 'public/uploads')
];

for (const dir of instanceDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Create Tables
const migrations = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT,
  last_name TEXT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  two_factor_enabled INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity DATETIME
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_code TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location_id INTEGER,
  fqdn TEXT NOT NULL,
  scheme TEXT DEFAULT 'http',
  daemon_port INTEGER DEFAULT 3003,
  sftp_port INTEGER DEFAULT 3004,
  memory_limit INTEGER DEFAULT 16384,
  disk_limit INTEGER DEFAULT 102400,
  status TEXT DEFAULT 'online',
  maintenance_mode INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(location_id) REFERENCES locations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL,
  ip TEXT DEFAULT '0.0.0.0',
  port INTEGER NOT NULL,
  server_id INTEGER DEFAULT NULL,
  assigned INTEGER DEFAULT 0,
  notes TEXT,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS nests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  author TEXT DEFAULT 'NovaPanel',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eggs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nest_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  docker_image TEXT NOT NULL,
  docker_images TEXT,
  startup_command TEXT NOT NULL,
  config_files TEXT DEFAULT '{}',
  environment_variables TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(nest_id) REFERENCES nests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  owner_id INTEGER NOT NULL,
  node_id INTEGER DEFAULT 1,
  nest_id INTEGER NOT NULL,
  egg_id INTEGER NOT NULL,
  docker_image TEXT NOT NULL,
  startup_command TEXT NOT NULL,
  environment TEXT DEFAULT '{}',
  cpu_limit INTEGER DEFAULT 100,
  memory_limit INTEGER DEFAULT 1024,
  disk_limit INTEGER DEFAULT 5120,
  swap_limit INTEGER DEFAULT 0,
  primary_port INTEGER NOT NULL,
  container_id TEXT DEFAULT NULL,
  status TEXT DEFAULT 'offline',
  installed INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL,
  FOREIGN KEY(nest_id) REFERENCES nests(id) ON DELETE RESTRICT,
  FOREIGN KEY(egg_id) REFERENCES eggs(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS database_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  host TEXT DEFAULT '127.0.0.1',
  port INTEGER DEFAULT 3005,
  username TEXT DEFAULT 'root',
  password TEXT DEFAULT '',
  node_id INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS server_databases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  database_host_id INTEGER NOT NULL,
  database_name TEXT NOT NULL,
  db_username TEXT NOT NULL,
  db_password TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY(database_host_id) REFERENCES database_hosts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_payload TEXT,
  is_active INTEGER DEFAULT 1,
  last_run DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_subusers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  permissions TEXT DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  identifier TEXT UNIQUE NOT NULL,
  key_token TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT DEFAULT '[]',
  last_used DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  server_id INTEGER,
  event TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(migrations);
console.log('✅ Tables created successfully.');

// Seed Default Settings
const defaultSettings = [
  { key: 'panel_name', value: 'Nova' },
  { key: 'company_name', value: 'Nova Hosting' },
  { key: 'panel_logo', value: '' },
  { key: 'panel_favicon', value: '' },
  { key: 'panel_url', value: 'http://localhost:3001' },
  { key: 'timezone', value: 'UTC' },
  { key: 'default_language', value: 'en' },
  { key: 'maintenance_mode', value: '0' },
  { key: 'maintenance_message', value: 'Nova Panel is currently in maintenance mode.' },
  { key: 'smtp_host', value: '' },
  { key: 'smtp_port', value: '587' },
  { key: 'smtp_username', value: '' },
  { key: 'smtp_password', value: '' },
  { key: 'smtp_from', value: 'noreply@novapanel.io' }
];

for (const s of defaultSettings) {
  const existing = db.get('SELECT key FROM settings WHERE key = ?', [s.key]);
  if (!existing) {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [s.key, s.value]);
  }
}

// Seed Default Location
const existingLoc = db.get('SELECT id FROM locations WHERE short_code = ?', ['local']);
let locId = 1;
if (!existingLoc) {
  const res = db.run('INSERT INTO locations (short_code, description) VALUES (?, ?)', ['local', 'Default Local Location']);
  locId = res.lastInsertRowid;
} else {
  locId = existingLoc.id;
}

// Seed Default Node (Local Node)
const existingNode = db.get('SELECT id FROM nodes WHERE id = 1');
if (!existingNode) {
  db.run(`INSERT INTO nodes (id, name, location_id, fqdn, scheme, daemon_port, sftp_port, memory_limit, disk_limit, status)
    VALUES (1, 'Local Node', ?, '127.0.0.1', 'http', 3003, 3004, 16384, 102400, 'online')`, [locId]);
  console.log('✅ Local Node seeded.');
}

// Seed Default Allocations
const defaultPorts = [
  25565, 25566, 25567, 25568, 25569, 25570,
  3000, 3010, 3020, 5000, 5001, 5002, 8080, 8081
];

for (const port of defaultPorts) {
  const exists = db.get('SELECT id FROM allocations WHERE node_id = 1 AND port = ?', [port]);
  if (!exists) {
    db.run('INSERT INTO allocations (node_id, ip, port, assigned) VALUES (1, ?, ?, 0)', ['0.0.0.0', port]);
  }
}
console.log('✅ Default port allocations seeded.');

// Seed Default Database Host (Server DB on port 3005)
const existingDbHost = db.get('SELECT id FROM database_hosts WHERE id = 1');
if (!existingDbHost) {
  db.run(`INSERT INTO database_hosts (id, name, host, port, username, password, node_id)
    VALUES (1, 'Local MySQL Host', '127.0.0.1', 3005, 'root', 'NovaStudio', 1)`);
  console.log('✅ Default Database Host seeded.');
}

// Seed NESTS & EGGS (as specified in main.txt)
// 1. Minecraft Nest
let mcNest = db.get('SELECT id FROM nests WHERE name = ?', ['Minecraft']);
if (!mcNest) {
  const res = db.run('INSERT INTO nests (name, description, author) VALUES (?, ?, ?)', [
    'Minecraft',
    'Minecraft: Java Edition and Bedrock server software',
    'NovaPanel'
  ]);
  mcNest = { id: res.lastInsertRowid };
}

// 2. Node.js Apps Nest
let nodeNest = db.get('SELECT id FROM nests WHERE name = ?', ['Node.js Apps']);
if (!nodeNest) {
  const res = db.run('INSERT INTO nests (name, description, author) VALUES (?, ?, ?)', [
    'Node.js Apps',
    'Node.js web servers, Discord bots, and applications',
    'NovaPanel'
  ]);
  nodeNest = { id: res.lastInsertRowid };
}

// 3. Python Apps Nest
let pyNest = db.get('SELECT id FROM nests WHERE name = ?', ['Python Apps/Bots']);
if (!pyNest) {
  const res = db.run('INSERT INTO nests (name, description, author) VALUES (?, ?, ?)', [
    'Python Apps/Bots',
    'Python 3 applications, web services, and bots',
    'NovaPanel'
  ]);
  pyNest = { id: res.lastInsertRowid };
}

// Java images list from main.txt
const javaImages = JSON.stringify([
  { name: 'Java 26', image: 'ghcr.io/pterodactyl/yolks:java_26' },
  { name: 'Java 25', image: 'ghcr.io/pterodactyl/yolks:java_25' },
  { name: 'Java 21', image: 'ghcr.io/pterodactyl/yolks:java_21' },
  { name: 'Java 17', image: 'ghcr.io/pterodactyl/yolks:java_17' },
  { name: 'Java 16', image: 'ghcr.io/pterodactyl/yolks:java_16' },
  { name: 'Java 11', image: 'ghcr.io/pterodactyl/yolks:java_11' },
  { name: 'Java 8', image: 'ghcr.io/pterodactyl/yolks:java_8' }
]);

// Minecraft Paper Egg (Default)
const paperEgg = db.get('SELECT id FROM eggs WHERE nest_id = ? AND name = ?', [mcNest.id, 'Paper']);
if (!paperEgg) {
  db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    mcNest.id,
    'Paper',
    'High performance Minecraft server software based on Spigot with mcjars.app support',
    'ghcr.io/pterodactyl/yolks:java_21',
    javaImages,
    'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
    JSON.stringify({
      SERVER_JARFILE: 'server.jar',
      MC_TYPE: 'PAPER',
      MC_VERSION: 'latest'
    })
  ]);
}

// Minecraft Purpur Egg
const purpurEgg = db.get('SELECT id FROM eggs WHERE nest_id = ? AND name = ?', [mcNest.id, 'Purpur']);
if (!purpurEgg) {
  db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    mcNest.id,
    'Purpur',
    'Drop-in replacement for Paper servers designed for configurability and gameplay features',
    'ghcr.io/pterodactyl/yolks:java_21',
    javaImages,
    'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
    JSON.stringify({
      SERVER_JARFILE: 'server.jar',
      MC_TYPE: 'PURPUR',
      MC_VERSION: 'latest'
    })
  ]);
}

// Minecraft Vanilla Egg
const vanillaEgg = db.get('SELECT id FROM eggs WHERE nest_id = ? AND name = ?', [mcNest.id, 'Vanilla']);
if (!vanillaEgg) {
  db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    mcNest.id,
    'Vanilla',
    'Official Minecraft Vanilla server software',
    'ghcr.io/pterodactyl/yolks:java_21',
    javaImages,
    'java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}} nogui',
    JSON.stringify({
      SERVER_JARFILE: 'server.jar',
      MC_TYPE: 'VANILLA',
      MC_VERSION: 'latest'
    })
  ]);
}

// Node.js images list from main.txt
const nodeImages = JSON.stringify([
  { name: 'Nodejs 25', image: 'ghcr.io/ptero-eggs/yolks:nodejs_25' },
  { name: 'Nodejs 24', image: 'ghcr.io/ptero-eggs/yolks:nodejs_24' },
  { name: 'Nodejs 23', image: 'ghcr.io/ptero-eggs/yolks:nodejs_23' },
  { name: 'Nodejs 22', image: 'ghcr.io/ptero-eggs/yolks:nodejs_22' },
  { name: 'Nodejs 21', image: 'ghcr.io/ptero-eggs/yolks:nodejs_21' },
  { name: 'Nodejs 20', image: 'ghcr.io/pterodactyl/yolks:nodejs_20' },
  { name: 'Nodejs 19', image: 'ghcr.io/ptero-eggs/yolks:nodejs_19' },
  { name: 'Nodejs 18', image: 'ghcr.io/ptero-eggs/yolks:nodejs_18' },
  { name: 'Nodejs 17', image: 'ghcr.io/ptero-eggs/yolks:nodejs_17' },
  { name: 'Nodejs 16', image: 'ghcr.io/ptero-eggs/yolks:nodejs_16' },
  { name: 'Nodejs 14', image: 'ghcr.io/ptero-eggs/yolks:nodejs_14' },
  { name: 'Nodejs 12', image: 'ghcr.io/ptero-eggs/yolks:nodejs_12' }
]);

const nodeEgg = db.get('SELECT id FROM eggs WHERE nest_id = ? AND name = ?', [nodeNest.id, 'Node.js App']);
if (!nodeEgg) {
  db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    nodeNest.id,
    'Node.js App',
    'Run any Node.js application, Express API, or Discord bot',
    'ghcr.io/pterodactyl/yolks:nodejs_20',
    nodeImages,
    'if [ -f package.json ]; then npm install; fi; npm start',
    JSON.stringify({
      MAIN_FILE: 'index.js'
    })
  ]);
}

// Python images list from main.txt
const pythonImages = JSON.stringify([
  { name: 'Python 3.13', image: 'ghcr.io/ptero-eggs/yolks:python_3.13' },
  { name: 'Python 3.12', image: 'ghcr.io/pterodactyl/yolks:python_3.12' },
  { name: 'Python 3.11', image: 'ghcr.io/ptero-eggs/yolks:python_3.11' },
  { name: 'Python 3.10', image: 'ghcr.io/ptero-eggs/yolks:python_3.10' },
  { name: 'Python 3.9', image: 'ghcr.io/ptero-eggs/yolks:python_3.9' },
  { name: 'Python 3.8', image: 'ghcr.io/ptero-eggs/yolks:python_3.8' },
  { name: 'Python 3.7', image: 'ghcr.io/ptero-eggs/yolks:python_3.7' },
  { name: 'Python 2.7', image: 'ghcr.io/ptero-eggs/yolks:python_2.7' }
]);

const pyEgg = db.get('SELECT id FROM eggs WHERE nest_id = ? AND name = ?', [pyNest.id, 'Python App']);
if (!pyEgg) {
  db.run(`INSERT INTO eggs (nest_id, name, description, docker_image, docker_images, startup_command, environment_variables)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [
    pyNest.id,
    'Python App',
    'Run Python applications, Flask/FastAPI servers, and bots',
    'ghcr.io/pterodactyl/yolks:python_3.12',
    pythonImages,
    'if [ -f requirements.txt ]; then pip install -r requirements.txt; fi; python3 {{MAIN_FILE}}',
    JSON.stringify({
      MAIN_FILE: 'app.py'
    })
  ]);
}

console.log('✅ NESTS and EGGS seeded successfully.');
console.log('🎉 Migration completed successfully!');
