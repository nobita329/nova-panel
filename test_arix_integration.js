/**
 * Comprehensive Automated Verification Script for Arix Theme Integration
 */
const http = require('http');

const BASE_URL = 'http://127.0.0.1:3001';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 ARIX THEME INTEGRATION VERIFICATION TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  try {
    // 1. Check Arix Static Assets
    console.log('--- 1. Testing Arix Static Assets ---');
    const cssRes = await request('/css/arix.css');
    assert(cssRes.statusCode === 200 && cssRes.body.includes('--primary: #4A35CF'), 'Arix master stylesheet loaded with design tokens');

    const jsRes = await request('/js/arix.js');
    assert(jsRes.statusCode === 200 && jsRes.body.includes('toggleArixTheme'), 'Arix client-side interactive script loaded');

    const logoRes = await request('/arix/Arix.png');
    assert(logoRes.statusCode === 200, 'Arix logo image asset accessible');

    const bgRes = await request('/arix/background-login.png');
    assert(bgRes.statusCode === 200, 'Arix background-login asset accessible');

    const svgRes = await request('/arix/images/server_installing.svg');
    assert(svgRes.statusCode === 200, 'Arix SVG illustration accessible');

    // 2. Check Auth Pages
    console.log('\n--- 2. Testing Authentication Pages ---');
    const loginRes = await request('/auth/login');
    assert(loginRes.statusCode === 200 && loginRes.body.includes('arix.css'), 'Login page renders with Arix stylesheet');
    assert(loginRes.body.includes('background-login.png'), 'Login page has Arix background visual');

    const forgotRes = await request('/auth/forgot-password');
    assert(forgotRes.statusCode === 200 && forgotRes.body.includes('arix.css'), 'Forgot password page renders with Arix stylesheet');

    // 3. Login and Obtain Session
    console.log('\n--- 3. Testing Authentication & Session ---');
    const loginPost = await request('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'username=admin&password=novapassword'
    });

    assert(loginPost.statusCode === 302, 'Admin credentials login succeeds with redirect (302)');
    const cookieHeader = loginPost.headers['set-cookie'];
    assert(!!cookieHeader, 'Session cookie received');

    const cookie = cookieHeader ? cookieHeader[0].split(';')[0] : '';
    const authHeaders = { 'Cookie': cookie };

    // 4. Test User Dashboard & Layout
    console.log('\n--- 4. Testing User Dashboard & Layout ---');
    const dashRes = await request('/dashboard', { headers: authHeaders });
    assert(dashRes.statusCode === 200, 'Dashboard responds 200 OK');
    assert(dashRes.body.includes('arix-card'), 'Dashboard contains .arix-card components');
    assert(dashRes.body.includes('Arix v2.1.3'), 'Header contains Arix version badge');
    assert(dashRes.body.includes('arix-badge-success') || dashRes.body.includes('arix-btn'), 'Dashboard contains Arix button and badge tokens');

    // 5. Test User Account Views
    console.log('\n--- 5. Testing User Account Views ---');
    const accountRes = await request('/account', { headers: authHeaders });
    assert(accountRes.statusCode === 200 && accountRes.body.includes('Profile Information'), 'User profile (/account) responds 200 OK');

    const apiRes = await request('/account/api', { headers: authHeaders });
    assert(apiRes.statusCode === 200 && apiRes.body.includes('API Credentials'), 'User API keys (/account/api) responds 200 OK');

    const sshRes = await request('/account/ssh-keys', { headers: authHeaders });
    assert(sshRes.statusCode === 200 && sshRes.body.includes('SSH Keys'), 'User SSH keys (/account/ssh-keys) responds 200 OK');

    const actRes = await request('/account/activity', { headers: authHeaders });
    assert(actRes.statusCode === 200 && actRes.body.includes('Account Activity Log'), 'User Activity (/account/activity) responds 200 OK');

    // 6. Test Admin Views
    console.log('\n--- 6. Testing Admin Views ---');
    const adminViews = [
      { path: '/admin', title: 'Admin Overview' },
      { path: '/admin/servers', title: 'Servers Management' },
      { path: '/admin/servers/new', title: 'Deploy New Server Instance' },
      { path: '/admin/users', title: 'User Management' },
      { path: '/admin/users/new', title: 'Create New User' },
      { path: '/admin/nodes', title: 'Nodes & Ports' },
      { path: '/admin/nodes/new', title: 'Create New Node' },
      { path: '/admin/locations', title: 'Locations' },
      { path: '/admin/nests', title: 'Service Nests' },
      { path: '/admin/database', title: 'Database Hosts' },
      { path: '/admin/database/new', title: 'New Database Host' },
      { path: '/admin/api', title: 'Application API Keys' },
      { path: '/admin/activity', title: 'System Activity Audit' },
      { path: '/admin/settings', title: 'Panel Settings & Custom Branding' },
      { path: '/admin/system', title: 'System Information' },
    ];

    for (const view of adminViews) {
      const res = await request(view.path, { headers: authHeaders });
      assert(res.statusCode === 200, `Admin route ${view.path} responds 200 OK`, `Status: ${res.statusCode}`);
      assert(res.body.includes('arix-card') || res.body.includes('arix-table') || res.body.includes('arix-btn'), `${view.path} contains Arix components`);
    }

    // 7. Test Server Views
    console.log('\n--- 7. Testing Server Management Views ---');
    // Extract a server ID from dashboard
    const serverMatch = dashRes.body.match(/\/server\/(\d+)\/console/);
    if (serverMatch) {
      const serverId = serverMatch[1];
      console.log(`Discovered active server ID: ${serverId}`);

      const serverViews = [
        { path: `/server/${serverId}/console`, name: 'Console' },
        { path: `/server/${serverId}/files`, name: 'File Manager' },
        { path: `/server/${serverId}/databases`, name: 'Databases' },
        { path: `/server/${serverId}/schedules`, name: 'Schedules' },
        { path: `/server/${serverId}/backups`, name: 'Backups' },
        { path: `/server/${serverId}/network`, name: 'Network Allocations' },
        { path: `/server/${serverId}/startup`, name: 'Startup Config' },
        { path: `/server/${serverId}/users`, name: 'Sub-Users' },
        { path: `/server/${serverId}/settings`, name: 'Server Settings' },
        { path: `/server/${serverId}/activity`, name: 'Activity Log' },
      ];

      for (const sv of serverViews) {
        const res = await request(sv.path, { headers: authHeaders });
        assert(res.statusCode === 200, `Server ${sv.name} (${sv.path}) responds 200 OK`);
        assert(res.body.includes('arix.css') && res.body.includes('Arix Server Header'), `Server ${sv.name} uses Arix layout and stylesheet`);
      }
    } else {
      console.log('No server found on dashboard to test server subpages.');
    }

    // 8. Test Error Pages
    console.log('\n--- 8. Testing Error Pages ---');
    const err404 = await request('/route-that-does-not-exist-404-test');
    assert(err404.statusCode === 404, '404 route returns HTTP 404');
    assert(err404.body.includes('Page Not Found') && err404.body.includes('arix.css'), '404 page renders with Arix design and illustration');

  } catch (err) {
    console.error('Fatal error during test run:', err);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
