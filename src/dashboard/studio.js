/**
 * studio.js - Minimal web UI to monitor the pipeline (port 3041)
 */
const express = require('express');

function startDashboard(port, getStatus) {
  const app = express();
  app.get('/api/status', (req, res) => res.json(getStatus()));
  app.get('/', (req, res) => {
    const s = getStatus();
    const rows = Object.entries(s.processed || {}).map(([id, p]) =>
      `<tr><td>${id}</td><td>${(p.title || '').slice(0, 70)}</td>` +
      `<td>${p.videoId ? `<a href="https://youtu.be/${p.videoId}">${p.videoId}</a>` : (p.videoFile ? 'local only' : '-')}</td>` +
      `<td>${p.processedAt || ''}</td></tr>`).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI-YouTube-SES Studio</title>
      <style>body{font-family:sans-serif;background:#04162e;color:#fff;padding:30px}
      h1{color:#00AA44} table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #2a4a6a;padding:8px;text-align:left}th{background:#0066CC}
      .stat{display:inline-block;background:#0066CC;padding:10px 22px;border-radius:8px;margin-right:14px}</style></head>
      <body><h1>AI-YouTube-SES Studio</h1>
      <p><span class="stat">Videos: ${Object.keys(s.processed || {}).length}</span>
      <span class="stat">Last cycle: ${s.lastCycle || 'never'}</span>
      <span class="stat">Status: ${s.busy ? 'GENERATING' : 'idle'}</span></p>
      <table><tr><th>Article</th><th>Title</th><th>YouTube</th><th>Processed</th></tr>${rows}</table>
      </body></html>`);
  });
  app.listen(port, () => console.log(`[Studio] Dashboard on http://localhost:${port}`));
  return app;
}

module.exports = { startDashboard };
