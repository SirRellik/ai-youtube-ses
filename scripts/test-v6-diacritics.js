#!/usr/bin/env node
/**
 * test-v6-diacritics.js - regenerate one video after the Czech diacritics
 * fixes (entity decoding, NFC, lang="cs" templates, safe template fill).
 * Article: selectArticles() index 1 (Dotace). Output: data/test-videos-v6-fixed/
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const cfg = {
  ...JSON.parse(fs.readFileSync('./config/default.json', 'utf8')),
  tempDir: '/tmp/ai-yt-ses-fixed',
  outputDir: '/opt/ai-youtube-ses/data/test-videos-v6-fixed',
  cacheDir: '/opt/ai-youtube-ses/data/cache',
  video: { width: 1920, height: 1080, fps: 30, format: 'mp4', minSceneSec: 5 },
  thumbnail: { width: 1280, height: 720 },
  audio: { musicVolume: 0.12 }
};

const channels = JSON.parse(fs.readFileSync('./config/channels.json', 'utf8'));
const channel = channels.ses;

const { fetchArticles } = require('../src/fetcher/article-fetcher');
const { selectArticles } = require('../src/fetcher/article-filter');
const { buildScreenplay } = require('../src/director/ses-director');
const { generateVideo } = require('../src/generator/video-generator');
const { generateThumbnail } = require('../src/generator/thumbnail-generator');

function ffprobe(args) {
  return new Promise((resolve, reject) =>
    execFile('ffprobe', args, (e, so) => (e ? reject(e) : resolve(String(so)))));
}

const CZ = /[ěščřžýáíéúůďťňĚŠČŘŽÝÁÍÉÚŮĎŤŇ]/;
const BROKEN = /[�]|&#\d+;|&[a-zA-Z]+;|\\u[\da-fA-F]{4}/;

function textIssues(screenplay) {
  const issues = [];
  for (const [i, s] of screenplay.scenes.entries()) {
    for (const field of ['kicker', 'title', 'text_overlay', 'narration']) {
      const t = String(s[field] || '');
      if (BROKEN.test(t)) issues.push(`scene ${i} ${field}: broken chars in "${t.slice(0, 80)}"`);
      if (t.normalize('NFC') !== t) issues.push(`scene ${i} ${field}: not NFC normalized`);
    }
    (s.bullets || []).forEach((b, j) => {
      if (BROKEN.test(String(b))) issues.push(`scene ${i} bullet ${j}: broken chars in "${b}"`);
    });
  }
  return issues;
}

(async () => {
  const articles = await fetchArticles({ type: 'fs', dir: '/opt/nyx/nyx-neural-data/satellite-blogs/articles' });
  const article = selectArticles(articles)[1];
  if (!article) { console.error('[Test-fixed] article index 1 not found'); process.exit(1); }
  console.log(`[Test-fixed] Article: ${article.title}`);

  const screenplay = buildScreenplay(article, channel);
  console.log(`[Test-fixed] ${screenplay.scenes.length} scenes (~${screenplay.estimatedDuration}s est.)`);
  const issues = textIssues(screenplay);
  issues.forEach((m) => console.log(`[Test-fixed] TEXT ISSUE: ${m}`));
  const hasCzech = screenplay.scenes.some((s) => CZ.test(s.title) || CZ.test(s.narration));
  console.log(`[Test-fixed] Czech diacritics present in screenplay: ${hasCzech}`);

  const videoFile = await generateVideo(screenplay, channel, cfg);
  const thumbFile = await generateThumbnail(screenplay, channel, cfg);

  const dur = parseFloat((await ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoFile])).trim());
  const streams = (await ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoFile])).trim();
  const pass = dur > 60 && /video/.test(streams) && /audio/.test(streams)
    && fs.existsSync(thumbFile) && issues.length === 0 && hasCzech;

  console.log('\n===== TEST REPORT (diacritics fix) =====');
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${Math.round(dur)}s | ${streams.split('\n').join('+')} | text issues: ${issues.length} | ${videoFile}`);
  console.log(`       thumb: ${thumbFile}`);
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error(`[Test-fixed] Fatal: ${e.stack || e.message}`);
  process.exit(1);
});
