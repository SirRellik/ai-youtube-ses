/**
 * AETERNA Studio Dashboard
 * Shows all generated videos with preview, metadata, and download links
 * Port: 3040
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3040;
const VIDEO_DIR = '/opt/aeterna/data/youtube/videos';
const SCENARIO_DIR = '/opt/aeterna/data/cinema/scenarios';

function scanVideos() {
  const videos = [];
  try {
    const dirs = fs.readdirSync(VIDEO_DIR).filter(d => {
      return fs.statSync(path.join(VIDEO_DIR, d)).isDirectory();
    });
    for (const dir of dirs) {
      const base = path.join(VIDEO_DIR, dir);
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(base, 'metadata.json'), 'utf8')); } catch {}

      const finals = fs.readdirSync(base).filter(f => f.startsWith('final-') && f.endsWith('.mp4'));
      const raws = fs.readdirSync(base).filter(f => f.endsWith('.mp4') && !f.startsWith('final-'));
      const videoFile = finals[0] || raws[0] || null;

      if (!videoFile) continue;

      const stat = fs.statSync(path.join(base, videoFile));
      const hasThumb = fs.existsSync(path.join(base, 'thumbnail.png'));
      const hasNarration = fs.existsSync(path.join(base, 'narration-script.txt'));
      let narrationText = '';
      try { narrationText = fs.readFileSync(path.join(base, 'narration-script.txt'), 'utf8').slice(0, 500); } catch {}

      // Get duration via file
      let duration = 0;
      try {
        const { execSync } = require('child_process');
        duration = parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${path.join(base, videoFile)}"`, { encoding: 'utf8', timeout: 5000 }).trim());
      } catch {}

      const frameCount = fs.readdirSync(base).filter(d => d.startsWith('f') && /^f\d+$/.test(d)).length;

      videos.push({
        id: dir,
        title: meta.title || dir,
        description: meta.description || '',
        language: meta.language || (dir.includes('-cs-') || dir.includes('-cz-') ? 'cs' : 'en'),
        tags: meta.tags || [],
        videoFile,
        size: stat.size,
        duration: Math.round(duration),
        hasThumb,
        hasNarration,
        narrationText,
        frameCount,
        created: stat.mtime.toISOString()
      });
    }
  } catch (e) {
    console.error('Scan error:', e.message);
  }
  return videos.sort((a, b) => b.created.localeCompare(a.created));
}

function scanScreenplays() {
  const screenplays = [];
  try {
    if (!fs.existsSync(SCENARIO_DIR)) return screenplays;
    const files = fs.readdirSync(SCENARIO_DIR).filter(f => f.startsWith('screenplay-') && f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, f), 'utf8'));
        screenplays.push({ file: f, title: data.title, scenes: data.scenes?.length || 0, tags: data.tags || [] });
      } catch {}
    }
  } catch {}
  return screenplays;
}

function renderDashboard() {
  const videos = scanVideos();
  const screenplays = scanScreenplays();
  const totalSize = videos.reduce((s, v) => s + v.size, 0);
  const totalDuration = videos.reduce((s, v) => s + v.duration, 0);

  const videoCards = videos.map(v => {
    const lang = v.language === 'cs' ? '<span style="background:#e63946;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">CZ</span>' : '<span style="background:#457b9d;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">EN</span>';
    const thumb = v.hasThumb ? `<img src="/studio/thumb/${v.id}" style="width:100%;height:180px;object-fit:cover;border-radius:8px 8px 0 0;">` : `<div style="width:100%;height:180px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:center;font-size:48px;">🎬</div>`;
    const tags = v.tags.slice(0, 4).map(t => `<span style="background:#222;color:#888;padding:2px 6px;border-radius:4px;font-size:10px;">${t}</span>`).join(' ');
    const sizeKB = (v.size / 1024).toFixed(0);
    const durMin = Math.floor(v.duration / 60);
    const durSec = v.duration % 60;

    return `
    <div style="background:#111;border:1px solid #222;border-radius:8px;overflow:hidden;transition:transform 0.2s,border-color 0.2s;" onmouseover="this.style.transform='translateY(-4px)';this.style.borderColor='#0ff'" onmouseout="this.style.transform='';this.style.borderColor='#222'">
      ${thumb}
      <div style="padding:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          ${lang}
          <span style="color:#555;font-size:11px;">${durMin}:${String(durSec).padStart(2,'0')}</span>
        </div>
        <div style="color:#eee;font-size:14px;font-weight:bold;margin-bottom:6px;line-height:1.3;">${v.title}</div>
        <div style="color:#666;font-size:11px;margin-bottom:8px;overflow:hidden;max-height:36px;">${v.description}</div>
        <div style="margin-bottom:8px;">${tags}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#444;font-size:10px;">${sizeKB}KB</span>
          <div>
            <a href="/studio/play/${v.id}" target="_blank" style="color:#0ff;text-decoration:none;font-size:12px;margin-right:12px;">▶ Play</a>
            <a href="/studio/download/${v.id}" style="color:#0f0;text-decoration:none;font-size:12px;">⬇ Download</a>
          </div>
        </div>
      </div>
    </div>`;
  }).join('\n');

  const screenplayList = screenplays.map(s =>
    `<div style="background:#111;padding:10px 14px;border-radius:6px;border:1px solid #222;margin-bottom:6px;">
      <span style="color:#ffd700;font-size:13px;">${s.title || s.file}</span>
      <span style="color:#555;font-size:11px;margin-left:10px;">${s.scenes} scenes</span>
    </div>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AETERNA Studio</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0a0a0a; color:#ccc; font-family:'Courier New',monospace; }
  a { color:#0ff; }
</style>
</head>
<body>
<div style="max-width:1400px;margin:0 auto;padding:20px;">
  <!-- Header -->
  <div style="text-align:center;padding:30px 0 20px;">
    <div style="font-size:14px;color:#0ff;letter-spacing:6px;opacity:0.6;">AETERNA</div>
    <div style="font-size:36px;font-weight:bold;background:linear-gradient(90deg,#0ff,#00ff88);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:8px 0;">CINEMA STUDIO</div>
    <div style="color:#555;font-size:13px;">Autonomous AI Video Production Pipeline</div>
  </div>

  <!-- Stats bar -->
  <div style="display:flex;justify-content:center;gap:40px;padding:15px 0;margin-bottom:20px;border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;">
    <div style="text-align:center;">
      <div style="font-size:28px;color:#0ff;font-weight:bold;">${videos.length}</div>
      <div style="font-size:11px;color:#555;">Videos</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:28px;color:#00ff88;font-weight:bold;">${Math.floor(totalDuration/60)}:${String(totalDuration%60).padStart(2,'0')}</div>
      <div style="font-size:11px;color:#555;">Total Duration</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:28px;color:#ffd700;font-weight:bold;">${(totalSize/1024/1024).toFixed(1)}MB</div>
      <div style="font-size:11px;color:#555;">Total Size</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:28px;color:#ff44aa;font-weight:bold;">${screenplays.length}</div>
      <div style="font-size:11px;color:#555;">Screenplays</div>
    </div>
  </div>

  <!-- Video grid -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:30px;">
    ${videoCards}
  </div>

  ${screenplays.length ? `
  <!-- Screenplays -->
  <div style="margin-top:20px;">
    <div style="font-size:16px;color:#ffd700;margin-bottom:10px;letter-spacing:2px;">SCREENPLAYS</div>
    ${screenplayList}
  </div>` : ''}

  <div style="text-align:center;padding:30px 0;color:#333;font-size:11px;">
    AETERNA Cinema Studio &bull; Generated by Screenwriter Agent &bull; ${new Date().toISOString().slice(0,10)}
  </div>
</div>
</body>
</html>`;
}

function renderPlayer(videoId) {
  const base = path.join(VIDEO_DIR, videoId);
  if (!fs.existsSync(base)) return '<h1>Not found</h1>';

  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(base, 'metadata.json'), 'utf8')); } catch {}
  let narration = '';
  try { narration = fs.readFileSync(path.join(base, 'narration-script.txt'), 'utf8'); } catch {}

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${meta.title || videoId}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;color:#ccc;font-family:'Courier New',monospace}</style>
</head><body>
<div style="max-width:900px;margin:0 auto;padding:20px;">
  <a href="/studio" style="color:#0ff;text-decoration:none;font-size:13px;">&larr; Back to Studio</a>
  <h1 style="color:#0ff;margin:20px 0;font-size:24px;">${meta.title || videoId}</h1>
  <video controls autoplay style="width:100%;border-radius:8px;border:1px solid #222;">
    <source src="/studio/stream/${videoId}" type="video/mp4">
  </video>
  <div style="margin-top:15px;color:#888;font-size:13px;">${meta.description || ''}</div>
  ${narration ? `<div style="margin-top:20px;padding:15px;background:#111;border-radius:8px;border:1px solid #222;">
    <div style="color:#ffd700;font-size:13px;margin-bottom:8px;">NARRATION SCRIPT</div>
    <pre style="color:#999;font-size:12px;white-space:pre-wrap;line-height:1.6;">${narration}</pre>
  </div>` : ''}
  <div style="margin-top:15px;">
    <a href="/studio/download/${videoId}" style="color:#0f0;font-size:13px;">Download MP4</a>
  </div>
</div>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // Dashboard
  if (p === '/' || p === '/studio' || p === '/studio/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDashboard());
    return;
  }

  // Player
  const playMatch = p.match(/^\/studio\/play\/(.+)$/);
  if (playMatch) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPlayer(playMatch[1]));
    return;
  }

  // Video stream
  const streamMatch = p.match(/^\/studio\/stream\/(.+)$/);
  if (streamMatch) {
    const base = path.join(VIDEO_DIR, streamMatch[1]);
    const finals = fs.readdirSync(base).filter(f => f.startsWith('final-') && f.endsWith('.mp4'));
    const raws = fs.readdirSync(base).filter(f => f.endsWith('.mp4') && !f.startsWith('final-'));
    const file = path.join(base, finals[0] || raws[0] || '');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }

    const stat = fs.statSync(file);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4'
      });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': stat.size });
      fs.createReadStream(file).pipe(res);
    }
    return;
  }

  // Download
  const dlMatch = p.match(/^\/studio\/download\/(.+)$/);
  if (dlMatch) {
    const base = path.join(VIDEO_DIR, dlMatch[1]);
    const finals = fs.readdirSync(base).filter(f => f.startsWith('final-') && f.endsWith('.mp4'));
    const raws = fs.readdirSync(base).filter(f => f.endsWith('.mp4') && !f.startsWith('final-'));
    const fileName = finals[0] || raws[0] || '';
    const file = path.join(base, fileName);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': fs.statSync(file).size
    });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // Thumbnail
  const thumbMatch = p.match(/^\/studio\/thumb\/(.+)$/);
  if (thumbMatch) {
    const file = path.join(VIDEO_DIR, thumbMatch[1], 'thumbnail.png');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // API: list videos
  if (p === '/studio/api/videos') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scanVideos()));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[Studio] AETERNA Cinema Studio running on port ${PORT}`);
  console.log(`[Studio] Video dir: ${VIDEO_DIR}`);
});
