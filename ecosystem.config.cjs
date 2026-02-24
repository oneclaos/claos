module.exports = {
  apps: [
    {
      name: 'claos',
      script: 'server/index.js',
      cwd: '/home/clawd/prod/claos',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
      },
      error_file: '/home/clawd/.pm2/logs/claos-error.log',
      out_file: '/home/clawd/.pm2/logs/claos-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
    },
  ],
}
