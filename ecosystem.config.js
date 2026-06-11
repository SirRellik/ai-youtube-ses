module.exports = {
  apps: [{
    name: 'ai-youtube-ses',
    script: 'src/orchestrator.js',
    cwd: '/opt/ai-youtube-ses',
    max_memory_restart: '1500M',
    autorestart: true,
    restart_delay: 10000,
    out_file: 'logs/out.log',
    error_file: 'logs/err.log',
    merge_logs: true,
    env: { NODE_ENV: 'production', DASHBOARD_PORT: '3041' }
  }]
};
