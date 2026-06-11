/**
 * AETERNA Autonomous YouTube Uploader
 * Checks for new videos every 2 hours, uploads if YouTube API quota available.
 * Tracks what's been uploaded to avoid duplicates.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  videoDir: '/opt/aeterna/data/youtube/videos',
  uploadedFile: '/opt/aeterna/data/youtube/uploaded.json',
  checkInterval: 2 * 3600 * 1000,
  logFile: '/opt/aeterna/data/youtube/auto-uploader.log'
};

function log(msg) {
  const line = `[${new Date().toISOString()}] [AutoUploader] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(CONFIG.logFile, line + '\n'); } catch {}
}

function getUploaded() {
  try { return JSON.parse(fs.readFileSync(CONFIG.uploadedFile, 'utf8')); }
  catch { return { videos: [] }; }
}

function saveUploaded(data) {
  fs.writeFileSync(CONFIG.uploadedFile, JSON.stringify(data, null, 2));
}

function findNewVideos() {
  const uploaded = getUploaded();
  const uploadedIds = new Set(uploaded.videos.map(v => v.id));
  const newVideos = [];

  try {
    const dirs = fs.readdirSync(CONFIG.videoDir).filter(d =>
      fs.statSync(path.join(CONFIG.videoDir, d)).isDirectory()
    );

    for (const dir of dirs) {
      if (uploadedIds.has(dir)) continue;
      const base = path.join(CONFIG.videoDir, dir);
      const finals = fs.readdirSync(base).filter(f => f.startsWith('final-') && f.endsWith('.mp4'));
      if (!finals.length) continue;

      const videoPath = path.join(base, finals[0]);
      const stat = fs.statSync(videoPath);
      if (stat.size < 50000) continue; // Skip tiny/broken videos

      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(base, 'metadata.json'), 'utf8')); } catch {}

      newVideos.push({
        id: dir,
        path: videoPath,
        title: meta.title || dir,
        description: meta.description || 'Autonomous AI-generated content from AETERNA world. https://aeterna.run',
        tags: (meta.tags || ['AETERNA', 'AI']).join(','),
        size: stat.size
      });
    }
  } catch (e) {
    log(`Scan error: ${e.message}`);
  }

  return newVideos;
}

async function uploadVideo(video) {
  try {
    const result = execSync(
      `node /opt/aeterna/yt-check-and-upload.js upload "${video.path}" "${video.title}" "${video.description}" "${video.tags}"`,
      { encoding: 'utf8', timeout: 300000 }
    );

    if (result.includes('UPLOADED:')) {
      const match = result.match(/Video ID: (.+)/);
      const videoId = match ? match[1].trim() : 'unknown';
      log(`Uploaded: ${video.id} -> YouTube ${videoId}`);
      return videoId;
    } else if (result.includes('quota')) {
      log('YouTube API quota exceeded, will retry later');
      return null;
    } else {
      log(`Upload failed: ${result.slice(0, 200)}`);
      return null;
    }
  } catch (e) {
    log(`Upload error: ${e.message.slice(0, 200)}`);
    return null;
  }
}

async function runCycle() {
  log('=== UPLOAD CYCLE ===');
  const newVideos = findNewVideos();

  if (!newVideos.length) {
    log('No new videos to upload');
    return;
  }

  log(`Found ${newVideos.length} new videos`);

  // Upload one at a time (quota management)
  for (const video of newVideos) {
    log(`Uploading: ${video.id} (${(video.size/1024).toFixed(0)}KB) - "${video.title}"`);
    const ytId = await uploadVideo(video);

    if (ytId) {
      const uploaded = getUploaded();
      uploaded.videos.push({
        id: video.id,
        youtubeId: ytId,
        title: video.title,
        uploadedAt: new Date().toISOString()
      });
      saveUploaded(uploaded);
      log(`Recorded: ${video.id} -> ${ytId}`);
    } else {
      log('Stopping uploads (quota or error)');
      break;
    }
  }

  log('=== CYCLE END ===');
}

async function main() {
  log('Auto Uploader started');
  log(`Check interval: ${CONFIG.checkInterval / 3600000}h`);

  // First cycle after 60s
  setTimeout(async () => {
    try { await runCycle(); }
    catch (e) { log(`Cycle error: ${e.message}`); }
  }, 60000);

  // Recurring
  setInterval(async () => {
    try { await runCycle(); }
    catch (e) { log(`Cycle error: ${e.message}`); }
  }, CONFIG.checkInterval);
}

main();
