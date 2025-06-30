module.exports = {
  apps: [
    {
      name: 'redactor-24h-scraper-cron',
      script: './scheduler.js',
      watch: false,
      exec_mode: 'cluster',
      instances: '1',
      max_memory_restart: '512M',
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      env: {
        RUN_ON_START: 'true',
        NODE_ENV: 'production'
      }
    }
  ]
}
