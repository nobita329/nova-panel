const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🏗️  Building Nova Panel...');

// Ensure required runtime directories
const requiredDirs = [
  'data',
  'public/uploads',
  'public/css',
  'public/js',
  'Instance/server',
  'Instance/Archive',
  'Instance/Backup'
];

for (const dir of requiredDirs) {
  const fullPath = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

// Verify Docker presence
try {
  const dockerVersion = execSync('docker --version', { encoding: 'utf8' }).trim();
  console.log(`🐳 Docker verified: ${dockerVersion}`);
} catch (err) {
  console.warn('⚠️  Docker command warning: Docker might not be accessible directly or permissions are needed.');
}

// Run migrations to ensure schema is fresh
try {
  require('./migrate');
} catch (err) {
  console.error('❌ Migration failed during build:', err);
  process.exit(1);
}

console.log('🎉 Nova Panel build completed successfully!');
