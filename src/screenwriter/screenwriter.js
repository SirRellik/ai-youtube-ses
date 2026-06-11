/**
 * screenwriter.js - Article -> screenplay (scenes with narration + on-screen text)
 */
function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+/g) || (text ? [text] : []);
}

function buildScreenplay(article, channel) {
  const text = stripHtml(article.content);
  const perex = stripHtml(article.perex) || splitSentences(text).slice(0, 2).join(' ');
  const sentences = splitSentences(text);
  const lang = (article.language || channel.language || 'cs').slice(0, 2);
  const cs = lang === 'cs';

  const scenes = [];
  // Intro
  scenes.push({
    kicker: cs ? 'SmartEnergyShare uvádí' : 'SmartEnergyShare presents',
    title: article.title,
    bullets: [],
    narration: `${article.title}. ${perex}`
  });

  // Body: chunk sentences into max 5 scenes, 3-4 sentences each
  const bodySentences = sentences.slice(2);
  const chunkSize = Math.max(3, Math.ceil(bodySentences.length / 5));
  for (let i = 0; i < bodySentences.length && scenes.length < 6; i += chunkSize) {
    const chunk = bodySentences.slice(i, i + chunkSize);
    if (!chunk.length) break;
    scenes.push({
      kicker: cs ? `Část ${scenes.length}` : `Part ${scenes.length}`,
      title: chunk[0].trim().slice(0, 90),
      bullets: chunk.slice(1).map((s) => s.trim().slice(0, 140)),
      narration: chunk.join(' ')
    });
  }

  // Outro / CTA
  scenes.push({
    kicker: cs ? 'Zjistěte více' : 'Learn more',
    title: cs ? 'Sdílejte energii chytře' : 'Share energy smartly',
    bullets: [channel.website.replace(/^https?:\/\//, ''), article.url || ''].filter(Boolean),
    narration: cs
      ? `Celý článek najdete na ${channel.website.replace(/^https?:\/\//, '')}. Děkujeme za zhlédnutí a nezapomeňte se přihlásit k odběru.`
      : `Read the full article at ${channel.website.replace(/^https?:\/\//, '')}. Thanks for watching and don't forget to subscribe.`
  });

  return { articleId: article.id, title: article.title, language: lang, scenes, article };
}

module.exports = { buildScreenplay, stripHtml };
