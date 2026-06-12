#!/usr/bin/env node
/**
 * test-v6.js - generate 2 test videos with the v6 pipeline
 * (AI/Pexels photo backgrounds, Ken Burns motion, crossfade transitions,
 * progress bar, upgraded templates + thumbnail).
 * Articles: selectArticles() index 4 + 8. Output: data/test-videos-v6/
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

process.chdir(path.join(__dirname, '..'));

const cfg = {
  ...JSON.parse(fs.readFileSync('./config/default.json', 'utf8')),
  tempDir: '/tmp/ai-yt-ses',
  outputDir: '/opt/ai-youtube-ses/data/test-videos-v6',
  cacheDir: '/opt/ai-youtube-ses/data/cache',
  video: { width: 1920, height: 1080, fps: 30, format: 'mp4', minSceneSec: 5 },
  thumbnail: { width: 1280, height: 720 },
  audio: { musicVolume: 0.12 }
};

const ARTICLE_INDEXES = [4, 8];

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

function narrationIssues(screenplay) {
  const issues = [];
  for (const s of screenplay.scenes) {
    const t = String(s.narration);
    if (/https?:\/\//.test(t)) issues.push(`URL in narration: ${t.slice(0, 80)}`);
    if (/[#*`_~\[\]]/.test(t)) issues.push(`markdown in narration: ${t.slice(0, 80)}`);
    if (/<[a-z][^>]*>/i.test(t)) issues.push(`HTML in narration: ${t.slice(0, 80)}`);
  }
  return issues;
}

(async () => {
  const articles = await fetchArticles({ type: 'fs', dir: '/opt/nyx/nyx-neural-data/satellite-blogs/articles' });
  const selected = selectArticles(articles);
  console.log(`[Test-v6] ${articles.length} articles loaded, ${selected.length} selectable`);
  const picked = ARTICLE_INDEXES.map((i) => selected[i]).filter(Boolean);
  if (picked.length < ARTICLE_INDEXES.length) {
    console.error(`[Test-v6] Wanted indexes ${ARTICLE_INDEXES.join(',')} but only ${selected.length} articles available`);
    process.exit(1);
  }
  picked.forEach((a, i) => console.log(`[Test-v6] Article #${ARTICLE_INDEXES[i]}: ${a.title}`));

  const results = [];
  for (const article of picked) {
    console.log(`\n=== TEST: ${article.title} ===`);
    const screenplay = buildScreenplay(article, channel);
    console.log(`[Test-v6] ${screenplay.scenes.length} scenes (~${screenplay.estimatedDuration}s est.)`);
    const narration = narrationIssues(screenplay);
    narration.forEach((m) => console.log(`[Test-v6] NARRATION ISSUE: ${m}`));

    const videoFile = await generateVideo(screenplay, channel, cfg);
    const thumbFile = await generateThumbnail(screenplay, channel, cfg);

    const dur = parseFloat((await ffprobe(['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoFile])).trim());
    const streams = await ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoFile]);
    const pass = dur > 60 && /video/.test(streams) && /audio/.test(streams)
      && fs.existsSync(thumbFile) && narration.length === 0;
    results.push({
      title: article.title, videoFile, thumbFile, duration: dur,
      streams: streams.trim().split('\n').join('+'), narrationIssues: narration.length, pass
    });
  }

  console.log('\n===== TEST REPORT (v6 pipeline) =====');
  let ok = results.length === ARTICLE_INDEXES.length;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${Math.round(r.duration)}s | ${r.streams} | narration issues: ${r.narrationIssues} | ${r.videoFile}`);
    console.log(`       thumb: ${r.thumbFile}`);
    if (!r.pass) ok = false;
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(`[Test-v6] Fatal: ${e.stack || e.message}`);
  process.exit(1);
});
