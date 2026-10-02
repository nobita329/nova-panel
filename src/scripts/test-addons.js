const db = require('../config/database');
const addonService = require('../services/addons');

async function runTests() {
  console.log('🧪 Starting Nova Panel Arix Addons Verification Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Database Schema Checks
  console.log('--- 1. DATABASE SCHEMA & CONFIG ---');
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").map(t => t.name);
  assert(tables.includes('installed_plugins'), 'Table installed_plugins exists');
  assert(tables.includes('subdomains_cloudflare_config'), 'Table subdomains_cloudflare_config exists');
  assert(tables.includes('subdomains_user_subdomains'), 'Table subdomains_user_subdomains exists');
  assert(tables.includes('subdomains_blocklist'), 'Table subdomains_blocklist exists');
  assert(tables.includes('multi_startup_commands'), 'Table multi_startup_commands exists');
  assert(tables.includes('admin_addons_config'), 'Table admin_addons_config exists');

  const serverCols = db.query("PRAGMA table_info(servers)").map(c => c.name);
  assert(serverCols.includes('expiration_date'), 'Column expiration_date exists on servers');
  assert(serverCols.includes('subdomain_limit'), 'Column subdomain_limit exists on servers');
  assert(serverCols.includes('mc_version'), 'Column mc_version exists on servers');

  // 2. Admin Addons Configuration
  console.log('\n--- 2. ADMIN ADDONS REGISTRY (ALL 17+ ADDONS) ---');
  const addonsConfig = addonService.getAddonsConfig();
  const requiredAddons = [
    'autoSuspend',
    'databaseImportExport',
    'eggChanger',
    'fivemArtifactChanger',
    'fivemUtils',
    'hytaleModsInstaller',
    'iconChanger',
    'eggImporter',
    'minecraftModInstaller',
    'minecraftModpackInstaller',
    'minecraftPluginInstaller',
    'propertiesEditor',
    'ratelimit',
    'recordGenerator',
    'subdomainManager',
    'startupChanger',
    'variableManager',
    'versionChanger',
    'minecraftWorldInstaller'
  ];

  for (const k of requiredAddons) {
    assert(addonsConfig[k] !== undefined, `Addon "${k}" configured in registry`);
    assert(addonsConfig[k] && addonsConfig[k].enabled === true, `Addon "${k}" is active/enabled`);
  }

  // 3. Multi-Startup Commands Presets
  console.log('\n--- 3. MULTI-STARTUP COMMANDS ---');
  const paperEgg = db.get("SELECT id FROM eggs WHERE name = 'Paper'");
  if (paperEgg) {
    const presets = addonService.getMultiStartupCommands(paperEgg.id);
    assert(presets.length >= 2, `Multi-startup commands seeded for Paper egg (found ${presets.length})`);
  }

  // 4. Properties Service
  console.log('\n--- 4. PROPERTIES EDITOR SERVICE ---');
  const defaultProps = addonService.getProperties(1);
  assert(typeof defaultProps === 'object' && defaultProps !== null, 'Properties service returns object');
  assert(defaultProps.gamemode !== undefined, 'Properties contains gamemode');
  assert(defaultProps.difficulty !== undefined, 'Properties contains difficulty');
  
  addonService.updateProperties(1, { 'motd': 'Nova Arix Test Server' });
  const updatedProps = addonService.getProperties(1);
  assert(updatedProps.motd === 'Nova Arix Test Server', 'Properties updated and persisted successfully');

  // 5. Variables Service
  console.log('\n--- 5. VARIABLES SERVICE ---');
  addonService.saveServerVariable(1, '.env', 'TEST_KEY', 'TEST_VALUE_123');
  const vars = addonService.getServerVariables(1);
  assert(vars['.env'] && vars['.env'].TEST_KEY === 'TEST_VALUE_123', 'Variable saved to .env file');
  addonService.deleteServerVariable(1, '.env', 'TEST_KEY');
  const varsAfter = addonService.getServerVariables(1);
  assert(!varsAfter['.env'] || !varsAfter['.env'].TEST_KEY, 'Variable deleted from .env file');

  // 6. Subdomain Service
  console.log('\n--- 6. SUBDOMAIN SERVICE ---');
  const targetServer = db.get('SELECT * FROM servers LIMIT 1');
  const sid = targetServer ? targetServer.id : 1;

  const subRes = await addonService.createSubdomain(sid, 'testsub', 'mcserver.io', 25565);
  assert(subRes.subdomain === 'testsub', 'Subdomain created successfully');
  const serverSubs = addonService.getServerSubdomains(sid);
  assert(serverSubs.some(s => s.subdomain === 'testsub'), 'Subdomain found in server subdomains list');
  const createdSub = serverSubs.find(s => s.subdomain === 'testsub');
  if (createdSub) {
    await addonService.deleteSubdomain(createdSub.id, sid);
    const serverSubsAfter = addonService.getServerSubdomains(sid);
    assert(!serverSubsAfter.some(s => s.subdomain === 'testsub'), 'Subdomain deleted cleanly');
  }

  // 7. Auto-Suspend Service Check
  console.log('\n--- 7. AUTO-SUSPEND SERVICE ---');
  const suspendCount = await addonService.checkAndSuspendExpiredServers();
  assert(typeof suspendCount === 'number', `Auto-suspend check ran cleanly (${suspendCount} expired suspended)`);

  // 8. HTTP Endpoint Verifications
  console.log('\n--- 8. HTTP SERVER & ADMIN ROUTE STATUS ---');
  const baseUrl = 'http://127.0.0.1:3001';

  // Login as admin to get cookie
  let sessionCookie = '';
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=adminpassword',
    redirect: 'manual'
  });
  const setCookie = loginRes.headers.get('set-cookie');
  if (setCookie) {
    sessionCookie = setCookie.split(';')[0];
  }

  const routesToTest = [
    { url: '/admin/addons', name: 'GET /admin/addons (Admin Hub)' },
    { url: `/server/${sid}/plugins`, name: `GET /server/${sid}/plugins (Plugin Installer)` },
    { url: `/server/${sid}/mods`, name: `GET /server/${sid}/mods (Mod Installer)` },
    { url: `/server/${sid}/modpacks`, name: `GET /server/${sid}/modpacks (Modpack Installer)` },
    { url: `/server/${sid}/worlds`, name: `GET /server/${sid}/worlds (World Installer)` },
    { url: `/server/${sid}/versions`, name: `GET /server/${sid}/versions (Version Changer)` },
    { url: `/server/${sid}/properties`, name: `GET /server/${sid}/properties (Properties Editor)` },
    { url: `/server/${sid}/subdomains`, name: `GET /server/${sid}/subdomains (Subdomains Manager)` },
    { url: `/server/${sid}/variables`, name: `GET /server/${sid}/variables (Variables Manager)` },
    { url: `/server/${sid}/fivem`, name: `GET /server/${sid}/fivem (FiveM Utilities)` },
    { url: `/server/${sid}/settings`, name: `GET /server/${sid}/settings (Icon & Egg Changer)` },
    { url: `/server/${sid}/network`, name: `GET /server/${sid}/network (Record Generator)` },
    { url: `/server/${sid}/databases`, name: `GET /server/${sid}/databases (Database Import/Export)` }
  ];

  for (const r of routesToTest) {
    try {
      const res = await fetch(`${baseUrl}${r.url}`, {
        headers: { 'Cookie': sessionCookie }
      });
      assert(res.status === 200, `${r.name} returned HTTP ${res.status}`);
    } catch (err) {
      assert(false, `${r.name} failed to connect: ${err.message}`);
    }
  }

  console.log(`\n==============================================`);
  console.log(`🎯 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==============================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
