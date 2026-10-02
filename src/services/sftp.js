const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ssh2 = require('ssh2');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

const SFTP_PORT = parseInt(process.env.SFTP_PORT || '3004', 10);
const HOST_KEY_PATH = path.resolve(process.cwd(), 'data/sftp_host_key.pem');

const SFTP_STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
};

// Ensure SFTP host key exists
function ensureHostKey() {
  if (!fs.existsSync(HOST_KEY_PATH)) {
    const keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
    });
    fs.writeFileSync(HOST_KEY_PATH, keyPair.privateKey);
  }
  return fs.readFileSync(HOST_KEY_PATH);
}

function startSftpServer() {
  const hostKey = ensureHostKey();

  const server = new ssh2.Server({
    hostKeys: [hostKey]
  }, (client) => {
    let authUser = null;
    let targetServer = null;

    client.on('authentication', (ctx) => {
      if (ctx.method !== 'password') {
        return ctx.reject(['password']);
      }

      // Username could be: "username" or "username.serverId"
      let reqUsername = ctx.username;
      let requestedServerId = null;

      if (reqUsername.includes('.')) {
        const parts = reqUsername.split('.');
        reqUsername = parts[0];
        requestedServerId = parseInt(parts[1], 10);
      }

      const user = db.get("SELECT * FROM users WHERE (username = ? OR email = ?) AND status = 'active'", [reqUsername, reqUsername]);
      if (!user) {
        return ctx.reject();
      }

      const passMatches = bcrypt.compareSync(ctx.password, user.password);
      if (!passMatches) {
        return ctx.reject();
      }

      // Check server access
      if (requestedServerId) {
        let srv = null;
        if (user.is_admin) {
          srv = db.get('SELECT * FROM servers WHERE id = ?', [requestedServerId]);
        } else {
          srv = db.get('SELECT * FROM servers WHERE id = ? AND owner_id = ?', [requestedServerId, user.id]);
        }
        if (!srv) {
          return ctx.reject();
        }
        targetServer = srv;
      } else {
        // Find user's first available server
        let srv = null;
        if (user.is_admin) {
          srv = db.get('SELECT * FROM servers ORDER BY id ASC LIMIT 1');
        } else {
          srv = db.get('SELECT * FROM servers WHERE owner_id = ? ORDER BY id ASC LIMIT 1', [user.id]);
        }
        targetServer = srv;
      }

      authUser = user;
      return ctx.accept();
    });

    client.on('ready', () => {
      client.on('session', (accept, reject) => {
        const session = accept();

        session.on('sftp', (accept, reject) => {
          if (!targetServer) {
            return reject();
          }

          const sftp = accept();
          const baseDir = path.resolve(process.cwd(), 'Instance/server', String(targetServer.id));
          if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
          }

          function resolveSafe(relPath) {
            const normal = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
            const target = path.resolve(baseDir, '.' + normal);
            if (!target.startsWith(baseDir)) {
              return baseDir;
            }
            return target;
          }

          const openFiles = new Map();
          const openDirs = new Map();
          let handleCounter = 0;

          sftp.on('REALPATH', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            let rel = '/' + path.relative(baseDir, resolved).replace(/\\/g, '/');
            if (rel === '/.') rel = '/';
            sftp.name(reqid, [{ filename: rel, longname: rel, attrs: {} }]);
          });

          sftp.on('STAT', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.stat(resolved, (err, stat) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
              sftp.attrs(reqid, stat);
            });
          });

          sftp.on('LSTAT', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.lstat(resolved, (err, stat) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
              sftp.attrs(reqid, stat);
            });
          });

          sftp.on('OPENDIR', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.readdir(resolved, { withFileTypes: true }, (err, files) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.NO_SUCH_FILE);
              const handle = Buffer.from(String(++handleCounter));
              openDirs.set(handle.toString(), { files, index: 0, dir: resolved });
              sftp.handle(reqid, handle);
            });
          });

          sftp.on('READDIR', (reqid, handle) => {
            const d = openDirs.get(handle.toString());
            if (!d) return sftp.status(reqid, SFTP_STATUS.BAD_MESSAGE);
            if (d.index >= d.files.length) {
              return sftp.status(reqid, SFTP_STATUS.EOF);
            }

            const chunk = d.files.slice(d.index, d.index + 25);
            d.index += chunk.length;

            const names = chunk.map(entry => {
              let stats;
              try {
                stats = fs.statSync(path.join(d.dir, entry.name));
              } catch (e) {
                stats = { size: 0, mode: 0, mtime: new Date() };
              }
              return {
                filename: entry.name,
                longname: `${entry.isDirectory() ? 'd' : '-'}rw-r--r-- 1 nova nova ${stats.size || 0} Jan 1 00:00 ${entry.name}`,
                attrs: stats
              };
            });

            sftp.name(reqid, names);
          });

          sftp.on('OPEN', (reqid, filename, flags, attrs) => {
            const resolved = resolveSafe(filename);
            let stringFlags = 'r';
            if ((flags & 0x00000001) && (flags & 0x00000002)) {
              stringFlags = 'w+';
            } else if (flags & 0x00000002) {
              stringFlags = (flags & 0x00000004) ? 'a' : 'w';
            } else {
              stringFlags = 'r';
            }
            fs.open(resolved, stringFlags, (err, fd) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              const handle = Buffer.from(String(++handleCounter));
              openFiles.set(handle.toString(), fd);
              sftp.handle(reqid, handle);
            });
          });

          sftp.on('READ', (reqid, handle, offset, length) => {
            const fd = openFiles.get(handle.toString());
            if (!fd) return sftp.status(reqid, SFTP_STATUS.BAD_MESSAGE);

            const buffer = Buffer.alloc(length);
            fs.read(fd, buffer, 0, length, offset, (err, bytesRead) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              if (bytesRead === 0) return sftp.status(reqid, SFTP_STATUS.EOF);
              sftp.data(reqid, buffer.slice(0, bytesRead));
            });
          });

          sftp.on('WRITE', (reqid, handle, offset, data) => {
            const fd = openFiles.get(handle.toString());
            if (!fd) return sftp.status(reqid, SFTP_STATUS.BAD_MESSAGE);

            fs.write(fd, data, 0, data.length, offset, (err) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              sftp.status(reqid, SFTP_STATUS.OK);
            });
          });

          sftp.on('CLOSE', (reqid, handle) => {
            const key = handle.toString();
            if (openFiles.has(key)) {
              fs.close(openFiles.get(key), () => {});
              openFiles.delete(key);
            }
            if (openDirs.has(key)) {
              openDirs.delete(key);
            }
            sftp.status(reqid, SFTP_STATUS.OK);
          });

          sftp.on('REMOVE', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.unlink(resolved, (err) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              sftp.status(reqid, SFTP_STATUS.OK);
            });
          });

          sftp.on('RMDIR', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.rm(resolved, { recursive: true, force: true }, (err) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              sftp.status(reqid, SFTP_STATUS.OK);
            });
          });

          sftp.on('MKDIR', (reqid, reqPath) => {
            const resolved = resolveSafe(reqPath);
            fs.mkdir(resolved, { recursive: true }, (err) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              sftp.status(reqid, SFTP_STATUS.OK);
            });
          });

          sftp.on('RENAME', (reqid, oldPath, newPath) => {
            const rOld = resolveSafe(oldPath);
            const rNew = resolveSafe(newPath);
            fs.rename(rOld, rNew, (err) => {
              if (err) return sftp.status(reqid, SFTP_STATUS.FAILURE);
              sftp.status(reqid, SFTP_STATUS.OK);
            });
          });
        });
      });
    });
  });

  server.listen(SFTP_PORT, '0.0.0.0', () => {
    console.log(`📡 Nova SFTP Server listening on port ${SFTP_PORT}`);
  });

  return server;
}

module.exports = { startSftpServer };
