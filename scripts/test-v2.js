#!/usr/bin/env node
/**
 * test-v2.js - generate 2 test videos with the v2 pipeline
 * Output: data/test-videos-v2/   Verifies: video+audio streams, duration > 60s.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const cfg = JSON.parse(fs.readFileSync('./config/default.json', 'utf8'));
cfg.outputDir = './data/test-videos-v2';
cfg.tempDir = './temp';

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

(async () => {
  const articles = await fetchArticles({ type: 'fs', dir: '/opt/nyx/nyx-neural-data/satellite-blogs/articles' });
  const picked = selectArticles(articles).slice(0, 2);
  console.log(`[Test] ${articles.length} articles loaded, picked ${picked.length} Czech energy articles`);
  if (!picked.length) { console.error('[Test] No suitable articles found'); process.exit(1); }

  const results = [];
  for (const article of picked) {
    console.log(`\n=== TEST: ${article.title} ===`);
    const screenplay = buildScreenplay(article, channel);
    console.log(`[Test] ${screenplay.scenes.length} scenes (~${screenplay.estimatedDuration}s est.)`);
    console.log(`[Test] SEO title (${screenplay.seo.title.length} chars): ${screenplay.seo.title}`);
    console.log(`[Test] Thumbnail text: ${screenplay.seo.thumbnailText}`);
    const videoFile = await generateVideo(screenplay, channel, cfg);
    const thumbFile = await generateThumbnail(screenplay, channel, cfg);

    const dur = parseFloat((await ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoFile])).trim());
    const streams = await ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoFile]);
    const pass = dur > 60 && /video/.test(streams) && /audio/.test(streams) && fs.existsSync(thumbFile);
    results.push({ title: article.title, videoFile, thumbFile, duration: dur, streams: streams.trim().split('\n').join('+'), pass });
  }

  console.log('\n===== TEST REPORT (v2 pipeline) =====');
  let ok = results.length >= 1;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${Math.round(r.duration)}s | ${r.streams} | ${r.videoFile}`);
    console.log(`       thumb: ${r.thumbFile}`);
    if (!r.pass) ok = false;
  }
  console.log('Manual check reminder: listen to cs-CZ-VlastaNeural narration + review SES branding/visuals.');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(`[Test] Fatal: ${e.stack || e.message}`);
  process.exit(1);
});
