const fetch = require('./src/fetcher/article-fetcher');
const filter = require('./src/fetcher/article-filter');
const dir = require('./src/director/ses-director');
const gen = require('./src/generator/video-generator');

const BAD = /update_topic|strategic_intent|Generate a long|I am starting the generation/i;
const cfg = {
  tempDir: '/tmp/ai-yt-ses', outputDir: '/opt/ai-youtube-ses/data/test-videos-v8-voice',
  cacheDir: '/opt/ai-youtube-ses/data/image-cache',
  video: { width: 1920, height: 1080, fps: 30, minSceneSec: 8, maxSceneSec: 25 }
};
const ch = {
  name: 'SmartEnergyShare', logo: './branding/ses/logo.png',
  language: 'cs', voices: { cs: 'cs-CZ-VlastaNeural' },
  colors: { primary: '#00b894', secondary: '#0984e3', text: '#ffffff', bgDark: '#04162e' }
};

(async () => {
  const arts = await fetch.fetchArticles({ type: 'fs', dir: './data/articles' });
  const good = filter.selectArticles(arts).filter(a => !BAD.test((a.content || '').slice(0, 600)));
  console.log('Articles:', good.length);
  const sp = await dir.buildScreenplay(good[0], ch);
  console.log('V8 for:', sp.title, 'scenes:', sp.scenes.length);
  const out = await gen.generateVideo(sp, ch, cfg);
  console.log('V8 done:', out);
})().catch(e => { console.error(e.message, e.stack); process.exit(1); });
