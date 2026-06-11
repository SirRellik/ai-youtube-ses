/**
 * article-fetcher.js - Pluggable article source (api | fs)
 * Returns normalized articles incl. SES fields:
 * { id, title, perex, content, url, language, publishedAt,
 *   status, image, tags, category, keyword, slug, author, wordCount }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

function httpGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'ai-youtube-ses/1.0' } }, (res) => {
      if (res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function stableId(article) {
  if (article.id) return String(article.id);
  if (article.slug) return article.slug;
  return crypto.createHash('md5').update(article.title || JSON.stringify(article)).digest('hex').slice(0, 12);
}

function normalize(raw) {
  const title = raw.title || raw.headline || raw.name;
  const content = raw.content || raw.body || raw.text || raw.html || '';
  if (!title || !content) return null;
  return {
    id: stableId(raw),
    title: String(title),
    perex: String(raw.perex || raw.summary || raw.description || raw.excerpt || ''),
    content: String(content),
    url: raw.url || raw.link || raw.permalink || null,
    language: raw.language || raw.lang || 'cs',
    publishedAt: raw.publishedAt || raw.published_at || raw.date || null,
    status: raw.status || null,
    image: raw.image || raw.imageUrl || raw.cover || null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    category: raw.category || raw.trendCategory || null,
    keyword: raw.keyword || null,
    slug: raw.slug || null,
    author: raw.author || null,
    wordCount: raw.wordCount || null
  };
}

function extractList(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['articles', 'items', 'data', 'posts', 'results']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

async function fetchFromApi(url) {
  const data = await httpGetJson(url);
  return extractList(data).map(normalize).filter(Boolean);
}

function fetchFromDir(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d, depth) => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf8'));
          for (const raw of extractList(data).length ? extractList(data) : [data]) {
            const a = normalize(raw);
            if (a) out.push(a);
          }
        } catch (e) { /* skip unparseable */ }
      }
    }
  };
  walk(dir, 0);
  return out;
}

async function fetchArticles(sourceCfg) {
  if (sourceCfg.type === 'api') {
    try {
      const articles = await fetchFromApi(sourceCfg.url);
      if (articles.length) return articles;
      console.log('[Fetcher] API returned no articles, trying fallback dir');
    } catch (e) {
      console.log(`[Fetcher] API failed (${e.message}), trying fallback dir`);
    }
    return sourceCfg.fallbackDir ? fetchFromDir(sourceCfg.fallbackDir) : [];
  }
  if (sourceCfg.type === 'fs') return fetchFromDir(sourceCfg.dir || sourceCfg.fallbackDir);
  throw new Error(`Unknown source type: ${sourceCfg.type}`);
}

module.exports = { fetchArticles };
