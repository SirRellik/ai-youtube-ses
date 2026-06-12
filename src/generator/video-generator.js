/**
 * video-generator.js - Screenplay -> MP4 (v6)
 * Director scenes -> per-visual_type templates + AI/Pexels photos ->
 * Puppeteer renders text overlay (alpha PNG) -> FFmpeg Ken Burns zoom/pan on
 * the photo + static overlay composite -> crossfade transitions between
 * scenes -> ambient music bed.
 * Writes <id>-meta.json (SEO pack + AI image prompts) next to the video.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { execFile } = require('child_process');
const edgeNarrator = require('../voice/narrator');
const geminiNarrator = require('../voice/narrator-v2');
const { getAudioDuration } = edgeNarrator;

// Premium Gemini TTS first; edge-tts when the key is missing or quota is gone.
async function synthesize(text, voice, outFile) {
  try {
    return await geminiNarrator.synthesize(text, voice, outFile);
  } catch (e) {
    console.warn(`[VideoGen] narrator-v2 unavailable (${e.message}) - falling back to edge-tts`);
    return edgeNarrator.synthesize(text, voice, outFile);
  }
}
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
// templates that draw the scene photo as a full background -> photo gets
// Ken Burns motion in FFmpeg while the rendered text overlay stays static
const PHOTO_TEMPLATES = new Set(['hero', 'photo-overlay', 'infographic', 'comparison']);
const EMPTY_BG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const FADE_SEC = 0.5;
const SUB_FONT = '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf';
const SUB_FADE = 0.3;

const templateCache = {};
function loadTemplate(name) {
  if (!templateCache[name]) {
    const file = path.join(TEMPLATE_DIR, `${name}.html`);
    const fallback = path.join(TEMPLATE_DIR, 'scene.html');
    templateCache[name] = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8');
  }
  return templateCache[name];
}

function ffmpeg(args, timeoutMs = 600000) {
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

// function replacement so $& / $' / $1 in scene text are inserted literally
function put(html, key, val) {
  return html.replace(new RegExp(`{{${key}}}`, 'g'), () => String(val));
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
    return col(bullets.slice(0, half), 'KLÍČOVÉ BODY') + col(bullets.slice(half), 'DALŠÍ FAKTA');
  }
  if (!bullets.length) return '';
  return `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
}

/**
 * compositeBg=true renders the template with a transparent body and hidden
 * .bg layer; the photo is animated separately in FFmpeg and the PNG is
 * composited on top of it.
 */
function fillTemplate(scene, idx, total, channel, cfg, bgFile, progressPct, compositeBg) {
  const tplName = TYPE_TO_TEMPLATE[scene.visual_type] || 'photo-overlay';
  const vars = {
    WIDTH: cfg.video.width, HEIGHT: cfg.video.height,
    PRIMARY: channel.colors.primary, SECONDARY: channel.colors.secondary,
    TEXT: channel.colors.text, BG_DARK: channel.colors.bgDark || '#04162e',
    KICKER: esc(scene.kicker || ''), TITLE: esc(scene.title || ''),
    TITLE_SIZE: String(scene.title && scene.title.length > 70 ? 56 : 76),
    OVERLAY: esc(scene.text_overlay || ''),
    BODY: bodyHtml(scene, tplName),
    BODY_BG: compositeBg ? 'transparent' : (channel.colors.bgDark || '#04162e'),
    BG_DISPLAY: compositeBg || !bgFile ? 'none' : 'block',
    BG_IMAGE: !compositeBg && bgFile ? `file://${path.resolve(bgFile)}` : EMPTY_BG,
    PROGRESS: String(Math.max(2, Math.min(100, Math.round(progressPct || 0)))),
    LOGO_TAG: logoTag(channel), CHANNEL_NAME: esc(channel.name),
    SCENE_NUM: `${idx + 1} / ${total}`
  };
  return Object.entries(vars).reduce((html, [k, v]) => put(html, k, v), loadTemplate(tplName));
}

async function renderPng(browser, html, outPng, width, height, transparent) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: outPng, type: 'png', omitBackground: !!transparent });
  } finally {
    await page.close();
  }
}

/**
 * Movie-style subtitles: split narration into ~5-8 word phrases, time each
 * phrase proportionally to its word count across the narration audio, and
 * burn them in with drawtext (textfile= sidesteps drawtext escaping of
 * Czech punctuation/diacritics).
 */
function splitNarrationToChunks(narration, maxWords = 8) {
  const text = String(narration || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  // sentence boundaries first so phrases don't straddle full stops
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const chunks = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(' ').filter(Boolean);
    if (!words.length) continue;
    const parts = Math.ceil(words.length / maxWords);
    const per = Math.ceil(words.length / parts);
    for (let i = 0; i < words.length; i += per) {
      chunks.push(words.slice(i, i + per).join(' '));
    }
  }
  return chunks;
}

function buildSubtitles(narration, audioDur, work, sceneIdx) {
  const chunks = splitNarrationToChunks(narration);
  const totalWords = chunks.reduce((a, c) => a + c.split(' ').length, 0);
  if (!totalWords) return [];
  let t = 0;
  return chunks.map((chunk, j) => {
    const file = path.join(work, `sub-${sceneIdx}-${j}.txt`);
    fs.writeFileSync(file, chunk);
    const dur = audioDur * (chunk.split(' ').length / totalWords);
    const sub = { file, start: t, end: t + dur };
    t += dur;
    return sub;
  });
}

function subtitleFilters(subs) {
  return subs.map((s, j) => {
    const start = s.start.toFixed(2);
    // last phrase lingers a touch into the post-narration padding
    const end = (s.end + (j === subs.length - 1 ? 0.6 : 0)).toFixed(2);
    return (
      `drawtext=textfile='${s.file}':fontfile=${SUB_FONT}:fontsize=36:fontcolor=white:` +
      `borderw=2:bordercolor=black:box=1:boxcolor=black@0.45:boxborderw=14:` +
      `x=(w-text_w)/2:y=h-90:` +
      `alpha='if(lt(t,${start}),0,if(lt(t,${start}+${SUB_FADE}),(t-${start})/${SUB_FADE},1))':` +
      `enable='between(t,${start},${end})'`
    );
  }).join(',');
}

/** Ken Burns variants - alternate zoom in / zoom out / pan L>R / pan R>L */
function kenBurns(idx, frames, zMax) {
  const fr = Math.max(frames - 1, 1);
  const z = zMax || 1.12;
  const grow = (z - 1).toFixed(4);
  const center = { x: 'iw/2-(iw/zoom/2)', y: 'ih/2-(ih/zoom/2)' };
  const variants = [
    { z: `1+${grow}*on/${fr}`, ...center },
    { z: `${z}-${grow}*on/${fr}`, ...center },
    { z: '1.10', x: `(iw-iw/zoom)*on/${fr}`, y: '(ih-ih/zoom)/2' },
    { z: '1.10', x: `(iw-iw/zoom)*(1-on/${fr})`, y: '(ih-ih/zoom)/2' }
  ];
  return variants[idx % variants.length];
}

function zoompanFilter(kb, frames, w, h, fps) {
  return `zoompan=z='${kb.z}':x='${kb.x}':y='${kb.y}':d=${frames}:s=${w}x${h}:fps=${fps}`;
}

/** Encode one scene clip: animated photo bg + static overlay, or animated full frame. */
async function encodeScene({ idx, bgFile, overlayPng, fullPng, mp3, clipDur, cfg, outClip, subs }) {
  const { width: W, height: H, fps } = cfg.video;
  const frames = Math.ceil(clipDur * fps) + 2;
  const subChain = subs && subs.length ? `,${subtitleFilters(subs)}` : '';
  const common = [
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-t', clipDur.toFixed(2), outClip
  ];
  if (bgFile && overlayPng) {
    // photo gets Ken Burns motion, text overlay stays crisp and static
    const kb = kenBurns(idx, frames, 1.12);
    const upW = W + (W >> 1), upH = H + (H >> 1); // 1.5x upscale reduces zoompan jitter
    await ffmpeg([
      '-i', bgFile, '-i', overlayPng, '-i', mp3,
      '-filter_complex',
      `[0:v]scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},` +
      `${zoompanFilter(kb, frames, W, H, fps)}[bg];` +
      `[bg][1:v]overlay=0:0${subChain},format=yuv420p[v];[2:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', ...common
    ]);
  } else {
    // gradient/text scene: static frame (zooming would crop the progress bar)
    await ffmpeg([
      '-loop', '1', '-framerate', String(fps), '-i', fullPng, '-i', mp3,
      '-filter_complex', `[0:v]format=yuv420p${subChain}[v];[1:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', '-r', String(fps), ...common
    ]);
  }
}

/** Merge scene clips with video crossfades + audio crossfades. */
async function mergeWithTransitions(clips, clipDurs, merged, cfg) {
  if (clips.length === 1) {
    fs.copyFileSync(clips[0], merged);
    return;
  }
  const inputs = clips.flatMap((c) => ['-i', c]);
  const vParts = [];
  const aParts = [];
  let offset = 0;
  let vPrev = '[0:v]', aPrev = '[0:a]';
  for (let i = 1; i < clips.length; i++) {
    offset += clipDurs[i - 1] - FADE_SEC;
    const vOut = i === clips.length - 1 ? '[vout]' : `[v${i}]`;
    const aOut = i === clips.length - 1 ? '[aout]' : `[a${i}]`;
    vParts.push(`${vPrev}[${i}:v]xfade=transition=fade:duration=${FADE_SEC}:offset=${offset.toFixed(2)}${vOut}`);
    // c2=nofade: incoming narration starts at full volume, outgoing padded silence fades
    aParts.push(`${aPrev}[${i}:a]acrossfade=d=${FADE_SEC}:c1=tri:c2=nofade${aOut}`);
    vPrev = vOut;
    aPrev = aOut;
  }
  await ffmpeg([
    ...inputs,
    '-filter_complex', [...vParts, ...aParts].join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-r', String(cfg.video.fps),
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    merged
  ]);
}

async function generateVideo(screenplay, channel, cfg) {
  const work = path.join(cfg.tempDir, `video-${screenplay.articleId}`);
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(cfg.outputDir, { recursive: true });
  const cacheDir = cfg.cacheDir || './data/cache';
  const voice = channel.voices[screenplay.language] || channel.voices[channel.language];
  const scenes = screenplay.scenes;
  const n = scenes.length;

  // Pass 1: narration for every scene first, so scene timing (and the
  // progress bar) is known before any frame is rendered.
  const mp3s = [];
  const durs = []; // visible scene length on the final timeline
  const audioDurs = []; // narration length - subtitle phrases are timed over this
  for (let i = 0; i < n; i++) {
    const mp3 = path.join(work, `scene-${i}.mp3`);
    await synthesize(scenes[i].narration, voice, mp3);
    const audioDur = await getAudioDuration(mp3);
    durs.push(Math.max(cfg.video.minSceneSec, audioDur + 0.8));
    audioDurs.push(audioDur);
    mp3s.push(mp3);
  }
  const totalDur = durs.reduce((a, b) => a + b, 0);

  // Pass 2: visuals - source image, render overlay, encode Ken Burns clip
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const sceneClips = [];
  const clipDurs = [];
  let elapsed = 0;
  try {
    for (let i = 0; i < n; i++) {
      const scene = scenes[i];
      console.log(`[VideoGen] Scene ${i + 1}/${n} [${scene.visual_type}]: ${String(scene.title).slice(0, 60)}`);
      const tplName = TYPE_TO_TEMPLATE[scene.visual_type] || 'photo-overlay';
      const bgFile = PHOTO_TEMPLATES.has(tplName)
        ? await sourceSceneImage(scene, screenplay.article, cacheDir, i)
        : null;
      elapsed += durs[i];
      const progressPct = (elapsed / totalDur) * 100;
      const composite = !!bgFile;
      const png = path.join(work, `scene-${i}.png`);
      const html = fillTemplate(scene, i, n, channel, cfg, bgFile, progressPct, composite);
      await renderPng(browser, html, png, cfg.video.width, cfg.video.height, composite);

      // crossfade overlap eats FADE_SEC, pad every clip except the last
      const clipDur = durs[i] + (i < n - 1 ? FADE_SEC : 0);
      const clip = path.join(work, `scene-${i}.mp4`);
      const subs = buildSubtitles(scene.narration, audioDurs[i], work, i);
      await encodeScene({
        idx: i, bgFile, overlayPng: composite ? png : null, fullPng: png,
        mp3: mp3s[i], clipDur, cfg, outClip: clip, subs
      });
      sceneClips.push(clip);
      clipDurs.push(clipDur);
    }
  } finally {
    await browser.close();
  }

  const merged = path.join(work, 'merged.mp4');
  await mergeWithTransitions(sceneClips, clipDurs, merged, cfg);

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

  // metadata: SEO pack + AI image prompts
  const meta = {
    articleId: screenplay.articleId,
    title: screenplay.title,
    seo: screenplay.seo,
    imagePrompts: buildPromptsForScreenplay(screenplay),
    scenes: screenplay.scenes.map((s) => ({ visual_type: s.visual_type, title: s.title, duration_hint: s.duration_hint })),
    totalDurationSec: Math.round(totalDur),
    effects: { kenBurns: true, crossfadeSec: FADE_SEC, subtitles: true },
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(cfg.outputDir, `${screenplay.articleId}-meta.json`), JSON.stringify(meta, null, 2));

  fs.rmSync(work, { recursive: true, force: true });
  console.log(`[VideoGen] Done: ${outFile} (~${Math.round(totalDur)}s)`);
  return outFile;
}

module.exports = { generateVideo };
