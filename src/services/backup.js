const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const db = require('../config/database');
const activity = require('./activity');

const backupService = {
  getBackupDir(serverId) {
    const dir = path.resolve(process.cwd(), 'Instance/Backup', String(serverId));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },

  async createBackup(serverId, name = 'Auto Backup') {
    const serverDir = path.resolve(process.cwd(), 'Instance/server', String(serverId));
    const backupDir = this.getBackupDir(serverId);
    const filename = `backup-${Date.now()}.zip`;
    const destPath = path.join(backupDir, filename);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(destPath);
      const archive = archiver('zip', { zlib: { level: 6 } });

      output.on('close', () => {
        const size = archive.pointer();
        const res = db.run(
          `INSERT INTO server_backups (server_id, name, filename, size, status)
           VALUES (?, ?, ?, ?, 'completed')`,
          [serverId, name, filename, size]
        );
        activity.log({
          serverId,
          event: 'backup.create',
          details: `Created backup "${name}" (${(size / 1024 / 1024).toFixed(2)} MB)`
        });
        resolve({ id: res.lastInsertRowid, filename, size });
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(serverDir, false);
      archive.finalize();
    });
  },

  async restoreBackup(backupId) {
    const backup = db.get('SELECT * FROM server_backups WHERE id = ?', [backupId]);
    if (!backup) throw new Error('Backup not found');

    const backupFile = path.resolve(process.cwd(), 'Instance/Backup', String(backup.server_id), backup.filename);
    if (!fs.existsSync(backupFile)) {
      throw new Error('Backup file does not exist on disk');
    }

    const serverDir = path.resolve(process.cwd(), 'Instance/server', String(backup.server_id));
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }

    const zip = new AdmZip(backupFile);
    zip.extractAllTo(serverDir, true);

    activity.log({
      serverId: backup.server_id,
      event: 'backup.restore',
      details: `Restored backup "${backup.name}"`
    });

    return { success: true };
  },

  async deleteBackup(backupId) {
    const backup = db.get('SELECT * FROM server_backups WHERE id = ?', [backupId]);
    if (!backup) return;

    const backupFile = path.resolve(process.cwd(), 'Instance/Backup', String(backup.server_id), backup.filename);
    if (fs.existsSync(backupFile)) {
      fs.unlinkSync(backupFile);
    }

    db.run('DELETE FROM server_backups WHERE id = ?', [backupId]);
    activity.log({
      serverId: backup.server_id,
      event: 'backup.delete',
      details: `Deleted backup "${backup.name}"`
    });
  }
};

module.exports = backupService;
