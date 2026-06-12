/**
 * V7 test: movie-style subtitles synced to narration + fixed SES logo.
 * Article: selectArticles() index 3. Output: data/test-videos-v7/
 */
const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { fetchArticles } = require('../src/fetcher/article-fetcher');
const { selectArticles } = require('../src/fetcher/article-filter');
const { buildScreenplay } = require('../src/director/ses-director');
const { generateVideo } = require('../src/generator/video-generator');

const cfg = {
  ...JSON.parse(fs.readFileSync('./config/default.json', 'utf8')),
  tempDir: '/tmp/ai-yt-ses',
  outputDir: '/opt/ai-youtube-ses/data/test-videos-v7',
  cacheDir: '/opt/ai-youtube-ses/data/image-cache',
  video: { width: 1920, height: 1080, fps: 30, format: 'mp4', minSceneSec: 8, maxSceneSec: 25 }
};

const channel = JSON.parse(fs.readFileSync('./config/channels.json', 'utf8')).ses;

(async () => {
  const arts = await fetchArticles({ type: 'fs', dir: '/opt/nyx/nyx-neural-data/satellite-blogs/articles' });
  const good = selectArticles(arts);
  if (!good.length) throw new Error('no articles selected');
  const article = good[3] || good[good.length - 1];
  console.log(`[Test] Article: ${article.title}`);
  const sp = await buildScreenplay(article, channel);
  const out = await generateVideo(sp, channel, cfg);
  console.log('V7 done:', out);
})();
