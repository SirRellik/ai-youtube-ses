/**
 * video-generator.js - Screenplay -> MP4
 * HTML scene templates -> Puppeteer screenshots -> per-scene FFmpeg encode -> concat
 * (same approach as AETERNA cinema-v2, channel-agnostic)
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { synthesize, getAudioDuration } = require('../voice/narrator');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'scene.html'), 'utf8');

function ffmpeg(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', ...args], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, so, se) => {
      if (err) return reject(new Error(`ffmpeg failed: ${String(se).slice(-800)}`));
      resolve();
    });
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function logoTag(channel) {
  const p = path.resolve(channel.logo || '');
  return fs.existsSync(p) ? `<img src="file://${p}">` : '';
}

function fillTemplate(scene, idx, total, channel, cfg) {
  const bullets = (scene.bullets || []).filter(Boolean);
  const body = bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  return TEMPLATE
    .replace(/{{WIDTH}}/g, cfg.video.width).replace(/{{HEIGHT}}/g, cfg.video.height)
    .replace(/{{PRIMARY}}/g, channel.colors.primary).replace(/{{SECONDARY}}/g, channel.colors.secondary)
    .replace(/{{TEXT}}/g, channel.colors.text).replace(/{{BG_DARK}}/g, channel.colors.bgDark || '#0a1a2f')
    .replace(/{{KICKER}}/g, esc(scene.kicker || '')).replace(/{{TITLE}}/g, esc(scene.title || ''))
    .replace(/{{TITLE_SIZE}}/g, String(scene.title && scene.title.length > 70 ? 64 : 84))
    .replace(/{{BODY}}/g, body)
    .replace(/{{LOGO_TAG}}/g, logoTag(channel)).replace(/{{CHANNEL_NAME}}/g, esc(channel.name))
    .replace(/{{SCENE_NUM}}/g, `${idx + 1} / ${total}`);
}

async function renderPng(browser, html, outPng, width, height) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: outPng, type: 'png' });
  } finally {
    await page.close();
  }
}

async function generateVideo(screenplay, channel, cfg) {
  const work = path.join(cfg.tempDir, `video-${screenplay.articleId}`);
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  const voice = channel.voices[screenplay.language] || channel.voices[channel.language];

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const sceneClips = [];
  try {
    for (let i = 0; i < screenplay.scenes.length; i++) {
      const scene = screenplay.scenes[i];
      const png = path.join(work, `scene-${i}.png`);
      const mp3 = path.join(work, `scene-${i}.mp3`);
      const clip = path.join(work, `scene-${i}.mp4`);

      console.log(`[VideoGen] Scene ${i + 1}/${screenplay.scenes.length}: ${scene.title.slice(0, 60)}`);
      await renderPng(browser, fillTemplate(scene, i, screenplay.scenes.length, channel, cfg), png, cfg.video.width, cfg.video.height);
      await synthesize(scene.narration, voice, mp3);
      const audioDur = await getAudioDuration(mp3);
      const dur = Math.max(cfg.video.minSceneSec, audioDur + 0.7);

      await ffmpeg([
        '-loop', '1', '-i', png, '-i', mp3,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-r', String(cfg.video.fps),
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
        '-af', 'apad', '-t', dur.toFixed(2),
        clip
      ]);
      sceneClips.push(clip);
    }
  } finally {
    await browser.close();
  }

  const listFile = path.join(work, 'concat.txt');
  fs.writeFileSync(listFile, sceneClips.map((c) => `file '${path.resolve(c)}'`).join('\n'));
  const outFile = path.join(cfg.outputDir, `${screenplay.articleId}.mp4`);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outFile]);

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`[VideoGen] Done: ${outFile}`);
  return outFile;
}

module.exports = { generateVideo };
