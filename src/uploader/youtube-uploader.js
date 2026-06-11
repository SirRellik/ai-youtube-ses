/**
 * youtube-uploader.js - YouTube Data API v3 upload (OAuth2)
 * Gracefully skips when channel credentials are not configured yet
 * (SES channel OAuth is a placeholder until the channel exists).
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

function buildMetadata(screenplay, channel) {
  const a = screenplay.article;
  const site = channel.website;
  const descLines = [
    (screenplay.language === 'cs' ? a.perex : a.perex) || screenplay.title,
    '',
    screenplay.language === 'cs' ? `📖 Celý článek: ${a.url || site}` : `📖 Full article: ${a.url || site}`,
    `🌐 ${site}`,
    '',
    (channel.youtube.baseTags || []).map((t) => '#' + t.replace(/\s+/g, '')).slice(0, 6).join(' ')
  ];
  return {
    title: screenplay.title.slice(0, 95),
    description: descLines.join('\n').slice(0, 4900),
    tags: (channel.youtube.baseTags || []).slice(0, 15)
  };
}

async function uploadVideo(videoPath, thumbPath, screenplay, channel) {
  const credPath = path.resolve(channel.youtube.credentialsPath);
  const tokenPath = path.resolve(channel.youtube.tokenPath);
  if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) {
    console.log('[Uploader] YouTube credentials not configured yet - skipping upload (video kept in output/)');
    return null;
  }

  const secret = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const key = secret.installed || secret.web;
  const oauth2 = new google.auth.OAuth2(key.client_id, key.client_secret, (key.redirect_uris || [])[0]);
  oauth2.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  const meta = buildMetadata(screenplay, channel);
  console.log(`[Uploader] Uploading: ${meta.title}`);
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: channel.youtube.categoryId || '28',
        defaultLanguage: screenplay.language,
        defaultAudioLanguage: screenplay.language
      },
      status: { privacyStatus: channel.youtube.privacyStatus || 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fs.createReadStream(videoPath) }
  });
  const videoId = res.data.id;
  console.log(`[Uploader] Uploaded: https://youtu.be/${videoId}`);

  if (thumbPath && fs.existsSync(thumbPath)) {
    try {
      await youtube.thumbnails.set({ videoId, media: { body: fs.createReadStream(thumbPath) } });
      console.log('[Uploader] Thumbnail set');
    } catch (e) {
      console.log(`[Uploader] Thumbnail failed (non-fatal): ${e.message}`);
    }
  }
  return videoId;
}

module.exports = { uploadVideo, buildMetadata };
