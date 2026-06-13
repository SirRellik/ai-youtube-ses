const fetch = require('./src/fetcher/article-fetcher');
const filter = require('./src/fetcher/article-filter');
const dir = require('./src/director/ses-director');
const gen = require('./src/generator/video-generator');

const BAD = /update_topic|strategic_intent|Generate a long|I am starting the generation/i;

const cfg = {
  tempDir: '/tmp/ai-yt-ses', outputDir: '/opt/ai-youtube-ses/data/test-videos-v7',
  cacheDir: '/opt/ai-youtube-ses/data/image-cache',
  video: { width: 1920, height: 1080, fps: 30, minSceneSec: 8, maxSceneSec: 25 }
};
const ch = {
  name: 'SmartEnergyShare', logo: './branding/ses/logo.png',
  language: 'cs',
  voices: { cs: 'cs-CZ-VlastaNeural' },
  colors: { primary: '#00b894', secondary: '#0984e3', text: '#ffffff', bgDark: '#04162e' }
};

(async () => {
  const arts = await fetch.fetchArticles({ type: 'fs', dir: './data/articles' });
  const good = filter.selectArticles(arts).filter(a => !BAD.test((a.content || '').slice(0, 600)));
  console.log('Clean articles:', good.length);

  // Generate 3 videos from different articles
  const picks = [0, 1, 3]; // Dotace, Myčka, Fotovoltaika
  for (const idx of picks) {
    const art = good[idx];
    if (!art) continue;
    console.log(`\n========== VIDEO ${idx} ==========`);
    console.log('Article:', art.title);
    try {
      const sp = await dir.buildScreenplay(art, ch);
      console.log('Scenes:', sp.scenes.length, 'Est:', sp.estimatedDuration + 's');
      const out = await gen.generateVideo(sp, ch, cfg);
      console.log('Done:', out);
    } catch (e) {
      console.error('FAIL:', e.message);
    }
  }
  console.log('\nAll done!');
})();
