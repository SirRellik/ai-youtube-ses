/**
 * thumbnail-generator.js - 1280x720 thumbnail (v2)
 * Pexels/article photo background + big Czech text + SES logo, brand colors.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { sourceSceneImage } = require('./visual-sourcer');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'thumbnail-v2.html'), 'utf8');
const EMPTY_BG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateThumbnail(screenplay, channel, cfg) {
  const cacheDir = cfg.cacheDir || './data/cache';
  const firstScene = screenplay.scenes && screenplay.scenes[0];
  const bgFile = await sourceSceneImage(
    { useArticleImage: true, pexels_query: (firstScene && firstScene.pexels_query) || 'solar energy' },
    screenplay.article, cacheDir, 1
  );
  const seo = screenplay.seo || {};
  const logoPath = path.resolve(channel.logo || '');
  const vars = {
    WIDTH: cfg.thumbnail.width, HEIGHT: cfg.thumbnail.height,
    PRIMARY: channel.colors.primary, SECONDARY: channel.colors.secondary,
    TEXT: channel.colors.text, BG_DARK: channel.colors.bgDark || '#04162e',
    THUMB_TEXT: esc(seo.thumbnailText || String(screenplay.title).slice(0, 24).toUpperCase()),
    TITLE: esc(String(screenplay.title).slice(0, 70)),
    BG_IMAGE: bgFile ? `file://${path.resolve(bgFile)}` : EMPTY_BG,
    LOGO_TAG: fs.existsSync(logoPath) ? `<img src="file://${logoPath}">` : '',
    CHANNEL_NAME: esc(channel.name)
  };
  // function replacement so $& / $' / $1 in text are inserted literally
  const html = Object.entries(vars).reduce(
    (h, [k, v]) => h.replace(new RegExp(`{{${k}}}`, 'g'), () => String(v)), TEMPLATE);

  fs.mkdirSync(cfg.outputDir, { recursive: true });
  const outFile = path.join(cfg.outputDir, `${screenplay.articleId}-thumb.png`);
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.thumbnail.width, height: cfg.thumbnail.height });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.screenshot({ path: outFile, type: 'png' });
  } finally {
    await browser.close();
  }
  console.log(`[Thumbnail] Done: ${outFile}`);
  return outFile;
}

module.exports = { generateThumbnail };
