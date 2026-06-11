/**
 * thumbnail-generator.js - 1280x720 branded YouTube thumbnail via Puppeteer
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'templates', 'thumbnail.html'), 'utf8');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function generateThumbnail(screenplay, channel, cfg) {
  const logoPath = path.resolve(channel.logo || '');
  const html = TEMPLATE
    .replace(/{{WIDTH}}/g, cfg.thumbnail.width).replace(/{{HEIGHT}}/g, cfg.thumbnail.height)
    .replace(/{{PRIMARY}}/g, channel.colors.primary).replace(/{{SECONDARY}}/g, channel.colors.secondary)
    .replace(/{{TEXT}}/g, channel.colors.text).replace(/{{BG_DARK}}/g, channel.colors.bgDark || '#0a1a2f')
    .replace(/{{KICKER}}/g, screenplay.language === 'cs' ? 'ENERGIE' : 'ENERGY')
    .replace(/{{TITLE}}/g, esc(screenplay.title.slice(0, 80)))
    .replace(/{{LOGO_TAG}}/g, fs.existsSync(logoPath) ? `<img src="file://${logoPath}">` : '')
    .replace(/{{CHANNEL_NAME}}/g, esc(channel.name));

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
