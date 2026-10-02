const db = require('../config/database');

const activity = {
  log({ userId = null, serverId = null, event, details = '', ip = '127.0.0.1' }) {
    try {
      db.run(
        `INSERT INTO activity_logs (user_id, server_id, event, details, ip_address)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, serverId, event, typeof details === 'object' ? JSON.stringify(details) : String(details), ip]
      );
    } catch (err) {
      console.error('Failed to write activity log:', err.message);
    }
  }
};

module.exports = activity;
