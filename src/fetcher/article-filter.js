/**
 * article-filter.js - which articles deserve a video
 * Rules: status "ready" (or no status), Czech, content > 1000 chars,
 * energy-related (skips pure AI/tech off-topic pieces), newest first.
 */
const { stripHtml } = require('../director/ses-director');

const ENERGY_RE = /(energ|sol\u00e1r|fotovolt|fve|bateri|akumul|elekt\u0159|elektri|tepeln|\u010derpadl|komunit|distribuc|spot\u0159eb|\u00faspor|panel|wallbox|nab\u00edje|elektromobil|s\u00ed\u0165|grid|tarif|kwh|mwh|obnoviteln|v\u011btrn|emis|uhl\u00edk|plyn|vyt\u00e1p\u011b)/i;

function isEnergyTopic(a) {
  return ENERGY_RE.test([a.title, a.keyword, a.category, (a.tags || []).join(' ')].filter(Boolean).join(' '));
}

function selectArticles(articles) {
  return articles
    .filter((a) => !a.status || a.status === 'ready')
    .filter((a) => (a.language || 'cs').slice(0, 2) === 'cs')
    .filter((a) => stripHtml(a.content || '').length > 1000)
    .filter(isEnergyTopic)
    .sort((x, y) => new Date(y.publishedAt || 0) - new Date(x.publishedAt || 0));
}

module.exports = { selectArticles, isEnergyTopic };
