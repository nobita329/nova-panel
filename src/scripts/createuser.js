const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

async function ask(rl, question, defaultValue = '') {
  return new Promise((resolve) => {
    rl.question(defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `, (ans) => {
      resolve(ans.trim() || defaultValue);
    });
  });
}

async function run() {
  console.log('==================================================');
  console.log('         Nova Panel - Create User / Admin         ');
  console.log('==================================================');

  // Parse command line arguments if provided
  const args = process.argv.slice(2);
  const argObj = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      argObj[key] = val !== undefined ? val : true;
    }
  }

  let username = argObj.username;
  let email = argObj.email;
  let password = argObj.password;
  let firstName = argObj.first_name || argObj.firstname;
  let lastName = argObj.last_name || argObj.lastname;
  let isAdmin = argObj.admin !== undefined ? (argObj.admin ? 1 : 0) : null;

  if (!username || !email || !password || isAdmin === null) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (!username) username = await ask(rl, 'Username');
    if (!email) email = await ask(rl, 'Email');
    if (!firstName) firstName = await ask(rl, 'First Name', 'Nova');
    if (!lastName) lastName = await ask(rl, 'Last Name', 'Admin');
    if (!password) password = await ask(rl, 'Password');
    if (isAdmin === null) {
      const ansAdmin = await ask(rl, 'Is this user an Administrator? (yes/no)', 'yes');
      isAdmin = ['y', 'yes', 'true', '1'].includes(ansAdmin.toLowerCase()) ? 1 : 0;
    }

    rl.close();
  }

  if (!username || !email || !password) {
    console.error('❌ Error: Username, Email, and Password are required.');
    process.exit(1);
  }

  // Check if username or email already exists
  const existing = db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (existing) {
    console.error('❌ Error: User with that username or email already exists.');
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const result = db.run(
    `INSERT INTO users (first_name, last_name, username, email, password, is_admin, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [firstName || 'Nova', lastName || 'User', username, email, hashedPassword, isAdmin]
  );

  console.log('--------------------------------------------------');
  console.log(`✅ User created successfully! ID: ${result.lastInsertRowid}`);
  console.log(`   Username: ${username}`);
  console.log(`   Email:    ${email}`);
  console.log(`   Role:     ${isAdmin ? '👑 Administrator' : '👤 Regular User'}`);
  console.log('==================================================');
}

run().catch((err) => {
  console.error('❌ Error creating user:', err);
  process.exit(1);
});
