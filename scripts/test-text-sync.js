const fs = require('fs');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const { buildScreenplay } = require('../src/director/ses-director');
const { generateVideo } = require('../src/generator/video-generator');

const cfg = {
  tempDir: '/tmp/ai-yt-ses',
  outputDir: '/opt/ai-youtube-ses/data/test-videos-v7',
  cacheDir: '/opt/ai-youtube-ses/data/cache',
  video: { width: 1920, height: 1080, fps: 30, format: 'mp4', minSceneSec: 5 },
  audio: { musicVolume: 0.12 }
};

const channel = JSON.parse(fs.readFileSync('./config/channels.json', 'utf8')).ses;
const article = JSON.parse(fs.readFileSync('./data/articles/813eac58f1cd.json', 'utf8'));

(async () => {
  console.log(`[Test] Article: ${article.title}`);
  const sp = buildScreenplay(article, channel);

  console.log('\n=== SCREENPLAY SYNC CHECK ===');
  for (const s of sp.scenes) {
    console.log(`\n[${s.visual_type}] ${s.kicker}`);
    console.log(`  TITLE:     "${s.title}"`);
    if (s.bullets.length) console.log(`  BULLETS:   ${s.bullets.map(b => `"${b.slice(0, 80)}${b.length > 80 ? '...' : ''}"`).join('\n             ')}`);
    if (s.text_overlay) console.log(`  OVERLAY:   "${s.text_overlay.slice(0, 100)}${s.text_overlay.length > 100 ? '...' : ''}"`);
    console.log(`  NARRATION: "${s.narration.slice(0, 120)}${s.narration.length > 120 ? '...' : ''}"`);
    const titleInNarr = s.narration.includes(s.title.replace(/…$/, ''));
    const bulletsInNarr = s.bullets.every(b => s.narration.includes(b.replace(/…$/, '').slice(0, 40)));
    if (!titleInNarr && s.visual_type !== 'cta' && s.visual_type !== 'data_chart')
      console.log(`  !! TITLE not in narration`);
    if (s.bullets.length && !bulletsInNarr && s.visual_type !== 'cta')
      console.log(`  !! Some BULLETS not in narration`);
  }

  console.log('\n=== GENERATING VIDEO ===');
  const out = await generateVideo(sp, channel, cfg);
  console.log('Done:', out);
})();
