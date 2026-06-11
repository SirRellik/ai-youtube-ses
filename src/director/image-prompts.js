/**
 * image-prompts.js - AI image generation prompt builder (English)
 * For future integration with Gemini CLI / Grok CLI / DALL-E / Midjourney.
 * Prompts are stored in video metadata (<id>-meta.json), not executed yet.
 */
const SUBJECT_MAP = [
  [/fotovolt|sol\u00e1r|panel|fve/i, 'a modern Czech family home with solar panels on the roof, green garden, battery storage unit visible'],
  [/bateri|akumul|\u00falo\u017ei\u0161t/i, 'a sleek home battery energy storage unit mounted on a clean garage wall, status LEDs glowing'],
  [/komunit|sd\u00edlen/i, 'a Czech village neighborhood with rooftop solar panels on several family houses, people talking in a shared garden'],
  [/elektromobil|nab\u00edje|wallbox/i, 'an electric car charging at a home wallbox charger in front of a modern house'],
  [/tepeln|\u010derpadl/i, 'an air source heat pump unit beside a modern insulated family home'],
  [/s\u00ed\u0165|grid|distribuc/i, 'a smart electricity grid control room with large monitoring screens showing energy flows'],
  [/cen|\u00faspor|tarif|\u00fa\u010dt/i, 'a Czech family at the kitchen table reviewing lower electricity bills on a tablet, smiling'],
  [/v\u011btrn/i, 'wind turbines on green rolling Czech countryside hills under a clear sky'],
];

const TYPE_STYLE = {
  hero: 'wide establishing shot, warm sunset lighting, optimistic mood',
  data_chart: 'clean minimalist composition, soft natural daylight, analytical mood',
  data_point: 'clean minimalist composition, soft natural daylight, analytical mood',
  comparison: 'split balanced composition, neutral daylight, documentary mood',
  quote: 'shallow depth of field, soft window light, trustworthy intimate mood',
  infographic: 'organized composition, bright even studio lighting, informative mood',
  photo: 'documentary style candid shot, natural ambient light, authentic mood',
  product_showcase: 'product photography, studio rim lighting, premium technology aesthetic',
  cta: 'aspirational lifestyle shot, golden hour back-lighting, hopeful forward-looking mood'
};

function pickSubject(topic) {
  for (const [re, subject] of SUBJECT_MAP) if (re.test(topic)) return subject;
  return 'a modern sustainable home with renewable energy technology, solar panels and battery storage';
}

function generateImagePrompt(topic, visualType = 'photo', extraContext = '') {
  const subject = pickSubject(`${topic} ${extraContext}`);
  const style = TYPE_STYLE[visualType] || TYPE_STYLE.photo;
  return `Professional photograph of ${subject}, ${style}, green energy theme, photorealistic, high detail, 16:9 aspect ratio, no text, no watermark`;
}

function buildPromptsForScreenplay(screenplay) {
  const topic = `${screenplay.title} ${(screenplay.article && screenplay.article.keyword) || ''}`;
  return screenplay.scenes.map((s, i) => ({
    scene: i,
    visual_type: s.visual_type,
    prompt: s.image_prompt || generateImagePrompt(topic, s.visual_type, s.title || '')
  }));
}

module.exports = { generateImagePrompt, buildPromptsForScreenplay };
