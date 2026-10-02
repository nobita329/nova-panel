const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Storage for branding uploads (logo, favicon)
const brandingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.resolve(process.cwd(), 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const prefix = file.fieldname === 'logo' ? 'logo' : 'favicon';
    cb(null, `${prefix}-${Date.now()}${ext}`);
  }
});

const brandingUpload = multer({
  storage: brandingStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Storage for server file manager uploads
const serverFileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const serverId = req.params.id || req.body.serverId;
    const subPath = req.query.path || req.body.path || '';
    const baseDir = path.resolve(process.cwd(), 'Instance/server', String(serverId));
    const targetDir = path.resolve(baseDir, '.' + path.normalize('/' + subPath));

    if (!targetDir.startsWith(baseDir)) {
      return cb(new Error('Invalid destination path'));
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const serverFileUpload = multer({
  storage: serverFileStorage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

module.exports = { brandingUpload, serverFileUpload, memoryUpload };
