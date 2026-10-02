module.exports = {
  apps: [
    {
      name: 'nova-panel',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      min_uptime: '10s',
      max_restarts: 10
    }
  ]
};
