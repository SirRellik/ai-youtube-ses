/**
 * orchestrator.js - Main entry point. Autonomous pipeline:
 * poll articles every 6h -> filter (ready, cs, >1000 chars, energy topic, newest first)
 * -> director screenplay -> video + thumbnail -> upload -> track state.
 * Generates cfg.maxVideosPerCycle (2) videos per cycle.
 * Flags: --once (single cycle then exit), --no-upload (dry run)
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const cfg = JSON.parse(fs.readFileSync('./config/default.json', 'utf8'));
const channels = JSON.parse(fs.readFileSync('./config/channels.json', 'utf8'));
const { fetchArticles } = require('./fetcher/article-fetcher');
const { selectArticles } = require('./fetcher/article-filter');
const { buildScreenplay } = require('./director/ses-director');
const { generateVideo } = require('./generator/video-generator');
const { generateThumbnail } = require('./generator/thumbnail-generator');
const { uploadVideo } = require('./uploader/youtube-uploader');
const { startDashboard } = require('./dashboard/studio');

const ONCE = process.argv.includes('--once');
const NO_UPLOAD = process.argv.includes('--no-upload');

const state = { processed: {}, lastCycle: null, busy: false };

function loadState() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'))); } catch (e) { /* fresh */ }
  state.busy = false;
}

function saveState() {
  fs.mkdirSync(path.dirname(cfg.stateFile), { recursive: true });
  const tmp = cfg.stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ processed: state.processed, lastCycle: state.lastCycle }, null, 2));
  fs.renameSync(tmp, cfg.stateFile);
}

async function processArticle(article, channelKey, channel) {
  const stateKey = `${channelKey}:${article.id}`;
  console.log(`[Orchestrator] Processing: "${article.title}" (${article.id}, published ${article.publishedAt || 'n/a'})`);
  const screenplay = buildScreenplay(article, channel);
  console.log(`[Orchestrator] Screenplay: ${screenplay.scenes.length} scenes, ~${screenplay.estimatedDuration}s | SEO: ${screenplay.seo.title}`);
  const videoFile = await generateVideo(screenplay, channel, cfg);
  const thumbFile = await generateThumbnail(screenplay, channel, cfg);
  let videoId = null;
  if (!NO_UPLOAD) {
    try {
      videoId = await uploadVideo(videoFile, thumbFile, screenplay, channel);
    } catch (e) {
      console.log(`[Orchestrator] Upload failed: ${e.message} (video kept locally, will not retry article)`);
    }
  }
  state.processed[stateKey] = {
    title: article.title,
    seoTitle: screenplay.seo.title,
    articleUrl: article.url,
    videoFile,
    thumbFile,
    videoId,
    processedAt: new Date().toISOString()
  };
  saveState();
}

async function runCycle() {
  if (state.busy) { console.log('[Orchestrator] Cycle already running, skipping'); return; }
  state.busy = true;
  try {
    for (const [channelKey, channel] of Object.entries(channels)) {
      if (!channel.enabled) continue;
      console.log(`[Orchestrator] Channel "${channelKey}": fetching articles...`);
      let articles = [];
      try {
        articles = await fetchArticles(channel.source);
      } catch (e) {
        console.log(`[Orchestrator] Fetch failed: ${e.message}`);
        continue;
      }
      const candidates = selectArticles(articles);
      const fresh = candidates.filter((a) => !state.processed[`${channelKey}:${a.id}`]);
      console.log(`[Orchestrator] ${articles.length} fetched | ${candidates.length} pass filters (ready/cs/energy/>1000 chars) | ${fresh.length} without video`);
      for (const article of fresh.slice(0, cfg.maxVideosPerCycle)) {
        try {
          await processArticle(article, channelKey, channel);
        } catch (e) {
          console.log(`[Orchestrator] Article "${article.title}" failed: ${e.message}`);
        }
      }
    }
    state.lastCycle = new Date().toISOString();
    saveState();
  } finally {
    state.busy = false;
  }
}

loadState();
if (!ONCE) {
  startDashboard(parseInt(process.env.DASHBOARD_PORT || cfg.dashboardPort, 10), () => state);
}

runCycle().then(() => {
  if (ONCE) { console.log('[Orchestrator] Single cycle done, exiting'); process.exit(0); }
  const intervalMs = cfg.pollIntervalHours * 3600 * 1000;
  console.log(`[Orchestrator] Polling every ${cfg.pollIntervalHours}h, ${cfg.maxVideosPerCycle} videos per cycle`);
  setInterval(() => runCycle().catch((e) => console.log(`[Orchestrator] Cycle error: ${e.message}`)), intervalMs);
}).catch((e) => {
  console.error(`[Orchestrator] Fatal: ${e.message}`);
  if (ONCE) process.exit(1);
});
