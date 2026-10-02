const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
require('dotenv').config();

const dbPath = process.env.DB_FILE || 'data/nova.sqlite';
const fullDbPath = path.resolve(process.cwd(), dbPath);
const dbDir = path.dirname(fullDbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(fullDbPath);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

const db = {
  getRawDb() {
    return getDb();
  },

  query(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.all(...params);
  },

  get(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.get(...params);
  },

  run(sql, params = []) {
    const stmt = getDb().prepare(sql);
    return stmt.run(...params);
  },

  exec(sql) {
    return getDb().exec(sql);
  }
};

module.exports = db;
