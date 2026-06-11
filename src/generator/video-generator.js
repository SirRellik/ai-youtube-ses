/**
 * video-generator.js - Screenplay -> MP4 (v2)
 * Director scenes -> per-visual_type templates + Pexels photos ->
 * Puppeteer renders -> per-scene FFmpeg encode -> concat -> ambient music bed.
 * Writes <id>-meta.json (SEO pack + AI image prompts) next to the video.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const { synthesize, getAudioDuration } = require('../voice/narrator');
const { sourceSceneImage } = require('./visual-sourcer');
const { generateMusic } = require('../audio/music-generator');
const { buildPromptsForScreenplay } = require('../director/image-prompts');

const TEMPLATE_DIR = path.join(__dirname, 'templates');
const TYPE_TO_TEMPLATE = {
  hero: 'hero', data_chart: 'data-point', data_point: 'data-point',
  comparison: 'comparison', quote: 'quote', infographic: 'infographic',
  cta: 'cta', photo: 'photo-overlay', photo_overlay: 'photo-overlay',
  product_showcase: 'photo-overlay'
};
const EMPTY_BG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const templateCache = {};
function loadTemplate(name) {
  if (!templateCache[name]) {
    const file = path.join(TEMPLATE_DIR, `${name}.html`);
    const fallback = path.join(TEMPLATE_DIR, 'scene.html');
    templateCache[name] = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8');
  }
  return templateCache[name];
}

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

function bodyHtml(scene, tplName) {
  const bullets = (scene.bullets || []).filter(Boolean);
  if (tplName === 'cta') {
    return bullets.map((b) => `<div class="chip">${esc(b)}</div>`).join('');
  }
  if (tplName === 'comparison') {
    const half = Math.ceil(bullets.length / 2) || 1;
    const col = (items, label) =>
      `<div class="col"><div class="col-label">${label}</div>${items.map((b) => `<p>${esc(b)}</p>`).join('') || '<p>&nbsp;</p>'}</div>`;
    return col(bullets.slice(0, half), 'KL\u00cd\u010cOV\u00c9 BODY') + col(bullets.slice(half), 'DAL\u0160\u00cd FAKTA');
  }
  if (!bullets.length) return '';
  return `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
}

function fillTemplate(scene, idx, total, channel, cfg, bgFile) {
  const tplName = TYPE_TO_TEMPLATE[scene.visual_type] || 'photo-overlay';
  return loadTemplate(tplName)
    .replace(/{{WIDTH}}/g, cfg.video.width).replace(/{{HEIGHT}}/g, cfg.video.height)
    .replace(/{{PRIMARY}}/g, channel.colors.primary).replace(/{{SECONDARY}}/g, channel.colors.secondary)
    .replace(/{{TEXT}}/g, channel.colors.text).replace(/{{BG_DARK}}/g, channel.colors.bgDark || '#04162e')
    .replace(/{{KICKER}}/g, esc(scene.kicker || '')).replace(/{{TITLE}}/g, esc(scene.title || ''))
    .replace(/{{TITLE_SIZE}}/g, String(scene.title && scene.title.length > 70 ? 56 : 76))
    .replace(/{{OVERLAY}}/g, esc(scene.text_overlay || ''))
    .replace(/{{BODY}}/g, bodyHtml(scene, tplName))
    .replace(/{{BG_IMAGE}}/g, bgFile ? `file://${path.resolve(bgFile)}` : EMPTY_BG)
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
  const cacheDir = cfg.cacheDir || './data/cache';
  const voice = channel.voices[screenplay.language] || channel.voices[channel.language];

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const sceneClips = [];
  let totalDur = 0;
  try {
    for (let i = 0; i < screenplay.scenes.length; i++) {
      const scene = screenplay.scenes[i];
      const png = path.join(work, `scene-${i}.png`);
      const mp3 = path.join(work, `scene-${i}.mp3`);
      const clip = path.join(work, `scene-${i}.mp4`);

      console.log(`[VideoGen] Scene ${i + 1}/${screenplay.scenes.length} [${scene.visual_type}]: ${String(scene.title).slice(0, 60)}`);
      const bgFile = await sourceSceneImage(scene, screenplay.article, cacheDir, i);
      await renderPng(browser, fillTemplate(scene, i, screenplay.scenes.length, channel, cfg, bgFile), png, cfg.video.width, cfg.video.height);
      await synthesize(scene.narration, voice, mp3);
      const audioDur = await getAudioDuration(mp3);
      const dur = Math.max(cfg.video.minSceneSec, audioDur + 0.8);
      totalDur += dur;

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
  const merged = path.join(work, 'merged.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', merged]);

  // ambient music bed under the narration
  const outFile = path.join(cfg.outputDir, `${screenplay.articleId}.mp4`);
  const musicVol = (cfg.audio && cfg.audio.musicVolume) || 0.15;
  try {
    const music = path.join(work, 'music.m4a');
    await generateMusic(totalDur, music);
    await ffmpeg([
      '-i', merged, '-i', music,
      '-filter_complex', `[1:a]volume=${musicVol}[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
      '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
      outFile
    ]);
  } catch (e) {
    console.log(`[VideoGen] Music mix failed (${String(e.message).slice(0, 160)}), shipping without music`);
    fs.copyFileSync(merged, outFile);
  }

  // metadata: SEO pack + AI image prompts for future Gemini/DALL-E/Midjourney use
  const meta = {
    articleId: screenplay.articleId,
    title: screenplay.title,
    seo: screenplay.seo,
    imagePrompts: buildPromptsForScreenplay(screenplay),
    scenes: screenplay.scenes.map((s) => ({ visual_type: s.visual_type, title: s.title, duration_hint: s.duration_hint })),
    totalDurationSec: Math.round(totalDur),
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(cfg.outputDir, `${screenplay.articleId}-meta.json`), JSON.stringify(meta, null, 2));

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`[VideoGen] Done: ${outFile} (~${Math.round(totalDur)}s)`);
  return outFile;
}

module.exports = { generateVideo };
