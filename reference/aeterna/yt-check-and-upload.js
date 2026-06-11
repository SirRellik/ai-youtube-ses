const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/opt/aeterna/data/youtube';

async function main() {
  // Load credentials
  const clientSecret = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'client-secret.json')));
  const tokens = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'youtube-oauth.json')));

  const { client_id, client_secret: cs } = clientSecret.installed || clientSecret.web || {};
  if (!client_id) { console.log('ERROR: No client_id in client-secret.json'); process.exit(1); }

  const oauth2 = new google.auth.OAuth2(client_id, cs, tokens.redirect_uri || 'urn:ietf:wg:oauth:2.0:oob');
  oauth2.setCredentials(tokens);

  const youtube = google.youtube({ version: 'v3', auth: oauth2 });

  const action = process.argv[2] || 'list';

  if (action === 'list') {
    // List channel info + videos
    try {
      const ch = await youtube.channels.list({ part: 'snippet,statistics', mine: true });
      if (!ch.data.items || !ch.data.items.length) {
        console.log('No channel found. Token may be expired.');
        return;
      }
      const channel = ch.data.items[0];
      console.log(`Channel: ${channel.snippet.title}`);
      console.log(`ID: ${channel.id}`);
      console.log(`Subscribers: ${channel.statistics.subscriberCount}`);
      console.log(`Total videos: ${channel.statistics.videoCount}`);
      console.log(`Total views: ${channel.statistics.viewCount}`);

      // List videos
      const vids = await youtube.search.list({
        part: 'snippet',
        channelId: channel.id,
        maxResults: 25,
        order: 'date',
        type: 'video'
      });
      console.log('\nExisting videos:');
      for (const v of vids.data.items) {
        if (v.id.videoId) {
          console.log(`  ${v.id.videoId} | ${v.snippet.publishedAt.slice(0,10)} | ${v.snippet.title}`);
        }
      }
    } catch (e) {
      console.log('ERROR:', e.message);
      if (e.message.includes('invalid_grant') || e.message.includes('Token has been expired')) {
        console.log('TOKEN EXPIRED - need to re-authenticate');
      }
    }

  } else if (action === 'upload') {
    const videoPath = process.argv[3];
    const title = process.argv[4] || 'AETERNA Video';
    const description = process.argv[5] || 'Autonomous AI-generated content from AETERNA world.';
    const tags = (process.argv[6] || 'AETERNA,AI').split(',');

    if (!videoPath || !fs.existsSync(videoPath)) {
      console.log('ERROR: Video file not found:', videoPath);
      process.exit(1);
    }

    console.log(`Uploading: ${videoPath}`);
    console.log(`Title: ${title}`);
    console.log(`Size: ${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(1)}MB`);

    try {
      const res = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: {
            title,
            description,
            tags,
            categoryId: '28', // Science & Technology
            defaultLanguage: title.includes('kde') || title.includes('Místo') ? 'cs' : 'en'
          },
          status: {
            privacyStatus: 'public',
            selfDeclaredMadeForKids: false
          }
        },
        media: {
          body: fs.createReadStream(videoPath)
        }
      });
      console.log(`UPLOADED: https://youtube.com/watch?v=${res.data.id}`);
      console.log(`Video ID: ${res.data.id}`);
    } catch (e) {
      console.log('UPLOAD ERROR:', e.message);
    }

  } else if (action === 'delete') {
    const videoId = process.argv[3];
    if (!videoId) { console.log('ERROR: Need video ID'); process.exit(1); }
    try {
      await youtube.videos.delete({ id: videoId });
      console.log(`DELETED: ${videoId}`);
    } catch (e) {
      console.log('DELETE ERROR:', e.message);
    }
  }
}

main().catch(e => console.error('Fatal:', e.message));
