/**
 * ses-director.js - SES Video Director Agent
 * Article -> narrative screenplay (hook -> problem -> solution -> evidence -> CTA)
 * + SEO pack (title/description/tags/thumbnail text) + AI image prompts.
 * Videos are educational Czech energy content that promote smartenergyshare.com
 * naturally - never forced advertising.
 */
const { generateImagePrompt } = require('./image-prompts');
const { decodeEntities } = require('../utils/decode-entities');

const CHARS_PER_SEC = 14;   // approximate cs-CZ-VlastaNeural speaking rate
const TARGET_MIN_SEC = 75;  // aim safely above the 60s minimum
const MAX_BODY_SCENES = 6;

function stripHtml(html) {
  let s = String(html);
  // HTML removal
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<[^>]+>/g, ' ');
  // HTML entities - decode before markdown removal (which would eat the # in
  // &#345;) and never strip: Czech letters arrive as &iacute; / &#269;
  s = decodeEntities(s);
  // Markdown removal
  s = s.replace(/```[\s\S]*?```/g, '');
  s = s.replace(/`([^`]*)`/g, '$1');
  s = s.replace(/#{1,6}\s*/g, '');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/__([^_]+)__/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  s = s.replace(/~~([^~]+)~~/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  s = s.replace(/^[-*+]\s+/gm, '');
  s = s.replace(/^\d+\.\s+/gm, '');
  s = s.replace(/^>\s*/gm, '');
  s = s.replace(/\*+/g, '');
  s = s.replace(/#+/g, '');
  s = s.replace(/`+/g, '');
  s = s.replace(/~+/g, '');
  // Cleanup
  s = s.replace(/\s+/g, ' ');
  return s.trim();
}

function splitSentences(text) {
  return (String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [])
    .map((s) => s.trim()).filter((s) => s.length > 2);
}

const DATA_RE = /(%|procent|K\u010d|korun|kWh|MWh|GWh|kWp|kW|MW|milion|miliard|tis\u00edc)/i;

function extractDataPoints(sentences) {
  return sentences.filter((s) => /\d/.test(s) && DATA_RE.test(s) && s.length < 220);
}

function extractQuote(sentences) {
  return sentences.find((s) => /[\u201e\u201c"].{20,}["\u201c\u201d]/.test(s) && s.length < 240) || null;
}

function shortOverlay(sentence) {
  const m = sentence.match(/\d[\d\s.,]*\s*(%|procent\w*|K\u010d|korun\w*|kWh|MWh|GWh|kWp|kW|MW|milion\w*|miliard\w*|tis\u00edc\w*)?/);
  return (m ? m[0] : sentence.slice(0, 40)).trim();
}

const QUERY_MAP = [
  [/fotovolt|sol\u00e1r|fve|panel/i, 'solar panels house roof'],
  [/bateri|akumul|\u00falo\u017ei\u0161t/i, 'home battery energy storage'],
  [/komunit|sd\u00edlen/i, 'modern houses neighborhood solar aerial'],
  [/elektromobil|nab\u00edje|wallbox/i, 'electric car charging home'],
  [/tepeln|\u010derpadl/i, 'heat pump modern house'],
  [/v\u011btrn/i, 'wind turbines countryside'],
  [/cen|\u00faspor|tarif|\u00fa\u010dt/i, 'family home finances calculator'],
  [/s\u00ed\u0165|grid|distribuc/i, 'electricity grid power lines sunset'],
];

function pexelsQuery(article) {
  const hay = `${article.title} ${article.keyword || ''} ${article.category || ''} ${(article.tags || []).join(' ')}`;
  for (const [re, q] of QUERY_MAP) if (re.test(hay)) return q;
  return 'renewable energy modern home';
}

function durationHint(narration) {
  return Math.max(4, Math.round(String(narration).length / CHARS_PER_SEC));
}

function scene(visualType, topic, o) {
  return {
    visual_type: visualType,
    kicker: o.kicker || '',
    title: o.title || '',
    text_overlay: o.text_overlay || '',
    bullets: o.bullets || [],
    narration: o.narration,
    pexels_query: o.pexels_query || null,
    useArticleImage: !!o.useArticleImage,
    image_prompt: generateImagePrompt(topic, visualType, o.title || ''),
    duration_hint: durationHint(o.narration)
  };
}

function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }

function buildSeo(article, channel, perex) {
  const site = channel.website || 'https://smartenergyshare.com';
  let title = String(article.title).trim();
  if (title.length > 70) title = title.slice(0, 67).replace(/\s+\S*$/, '') + '\u2026';
  const yt = channel.youtube || {};
  const tags = [...new Set([
    ...(yt.baseTags || []),
    ...((article.tags || []).map(String)),
    article.keyword, article.category,
    'energie', '\u00faspora energie', 'komunitn\u00ed energetika'
  ].filter(Boolean).map((t) => String(t).slice(0, 60)))].slice(0, 25);
  const description = [
    perex.slice(0, 400),
    '',
    article.url ? `\ud83d\udcf0 Cel\u00fd \u010dl\u00e1nek: ${article.url}` : null,
    `\u26a1 Sd\u00edlen\u00ed elekt\u0159iny a komunitn\u00ed energetika: ${site}`,
    `\ud83e\udd16 AI energetick\u00fd management pro dom\u00e1cnosti i firmy: ${site}`,
    '',
    `Kl\u00ed\u010dov\u00e1 t\u00e9mata: ${tags.slice(0, 8).join(', ')}`,
    '',
    '#energie #fotovoltaika #komunitnienergetika #SmartEnergyShare'
  ].filter((l) => l !== null).join('\n');
  const base = (article.keyword && article.keyword.length < 40) ? article.keyword : article.title;
  const thumbnailText = base.split(/\s+/).slice(0, 4).join(' ').toUpperCase().slice(0, 30);
  return { title, description, tags, thumbnailText };
}

function buildScreenplay(article, channel) {
  const text = stripHtml(article.content);
  const sentences = splitSentences(text);
  const perex = stripHtml(article.perex || article.excerpt || '') || sentences.slice(0, 2).join(' ');
  const dataPoints = extractDataPoints(sentences);
  const quote = extractQuote(sentences);
  const site = String(channel.website || 'https://smartenergyshare.com').replace(/^https?:\/\//, '');
  const topic = `${article.title} ${article.keyword || ''} ${article.category || ''}`;
  const query = pexelsQuery(article);
  const scenes = [];

  // HOOK - attention grabber taken from the article itself
  const hookNarration = dataPoints[0]
    ? dataPoints[0].replace(/[.!?]+$/, '') + '. ' + article.title + '. Poj\u010fme se na to pod\u00edvat zbl\u00edzka.'
    : article.title + '. ' + perex + ' Poj\u010fme se na to pod\u00edvat zbl\u00edzka.';
  scenes.push(scene('hero', topic, {
    kicker: 'SmartEnergyShare',
    title: article.title,
    text_overlay: perex.slice(0, 110),
    narration: hookNarration,
    pexels_query: query,
    useArticleImage: true
  }));

  // BODY - problem -> solution -> context, expanded until the video is long enough
  const body = sentences.slice(2);
  const chunks = [];
  for (let i = 0; i < body.length; i += 3) chunks.push(body.slice(i, i + 3));
  const bodyKickers = ['V \u010dem je probl\u00e9m', 'Jak to \u0159e\u0161it', 'Jak to funguje', 'Co to znamen\u00e1 pro v\u00e1s', 'Souvislosti', 'Detailn\u00ed pohled'];
  const bodyTypes = ['photo', 'infographic', 'photo', 'comparison', 'photo', 'infographic'];
  const ctaEstimate = 16;
  const estTotal = () => scenes.reduce((a, s) => a + s.duration_hint, 0) + ctaEstimate;
  let bi = 0;
  while (bi < chunks.length && bi < MAX_BODY_SCENES && (bi < 2 || estTotal() < TARGET_MIN_SEC)) {
    const chunk = chunks[bi];
    scenes.push(scene(bodyTypes[bi], topic, {
      kicker: bodyKickers[bi],
      title: chunk[0].slice(0, 90),
      bullets: chunk.slice(1).map((s) => s.slice(0, 130)),
      narration: chunk.join(' '),
      pexels_query: query
    }));
    bi++;
  }

  // EVIDENCE - hard numbers shown big on screen
  for (const dp of dataPoints.slice(0, 2)) {
    scenes.push(scene('data_chart', topic, {
      kicker: 'Kl\u00ed\u010dov\u00e9 \u010d\u00edslo',
      title: dp.slice(0, 120),
      text_overlay: shortOverlay(dp),
      narration: `Zapamatujte si jedno kl\u00ed\u010dov\u00e9 \u010d\u00edslo. ${dp}`
    }));
  }

  // QUOTE - only when the article actually contains one
  if (quote) {
    scenes.push(scene('quote', topic, {
      kicker: 'Stoj\u00ed za zm\u00ednku',
      title: article.author || 'Z \u010dl\u00e1nku',
      text_overlay: quote.replace(/[\u201e\u201c"\u201d]/g, '').slice(0, 160),
      narration: quote
    }));
  }

  // CTA - natural promotion of the SES platform
  scenes.push(scene('cta', topic, {
    kicker: 'Zjist\u011bte v\u00edce',
    title: 'Sd\u00edlejte energii chyt\u0159e',
    text_overlay: site,
    bullets: ['Sd\u00edlen\u00ed elekt\u0159iny z FVE', 'Komunitn\u00ed energetika', 'AI energetick\u00fd management'],
    narration: `Pokud v\u00e1s t\u00e9ma zaujalo, cel\u00fd \u010dl\u00e1nek najdete v popisku videa. A pokud chcete sd\u00edlet elekt\u0159inu z vlastn\u00ed fotovoltaiky, sn\u00ed\u017eit \u00fa\u010dty za energie nebo se zapojit do komunitn\u00ed energetiky, pod\u00edvejte se na platformu SmartEnergyShare na adrese ${site.replace(/\./g, ' te\u010dka ')}. D\u011bkujeme za zhl\u00e9dnut\u00ed a budeme r\u00e1di, kdy\u017e se p\u0159ihl\u00e1s\u00edte k odb\u011bru.`
  }));

  return {
    articleId: article.id,
    title: article.title,
    language: (article.language || channel.language || 'cs').slice(0, 2),
    scenes,
    seo: buildSeo(article, channel, perex),
    article,
    estimatedDuration: scenes.reduce((a, s) => a + s.duration_hint, 0)
  };
}

module.exports = { buildScreenplay, buildSeo, stripHtml };
