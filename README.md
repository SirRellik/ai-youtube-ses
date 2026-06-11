# ai-youtube-ses

Autonomous video pipeline that turns **SmartEnergyShare (SES)** marketing articles
into **YouTube videos** - and is generic enough to plug in any other blog/channel later.

Based on the proven AETERNA cinema pipeline (HTML -> Puppeteer -> PNG frames -> FFmpeg),
refactored into a channel-agnostic architecture.

## Pipeline

```
article-fetcher -> screenwriter -> video-generator (+thumbnail) -> narrator (edge-tts) -> youtube-uploader
                                  ^ orchestrated by src/orchestrator.js (poll every 6h)
```

1. **Fetch** - latest published articles from SES satellites (API with filesystem fallback)
2. **Screenplay** - article -> scenes (narration + on-screen text)
3. **Video** - HTML scene templates rendered via Puppeteer, encoded with FFmpeg,
   SES branding (blue `#0066CC`, green `#00AA44`), logo watermark on every scene
4. **Narration** - edge-tts, Czech `cs-CZ-VlastaNeural` (primary), English `en-US-AndrewMultilingualNeural`
5. **Thumbnail** - 1280x720 branded thumbnail
6. **Upload** - YouTube Data API v3 (OAuth2), auto title/description/tags + backlink to article
7. **State** - processed articles tracked in `data/state/processed.json` (no duplicates)

## Generic / pluggable design

- `config/channels.json` - one entry per YouTube channel (brand colors, voice, logo, source)
- Article source types: `api`, `fs` (directory of JSON), easily extensible (RSS, ...)
- Adding a new client = add a channel config + branding assets. No code changes.

## Setup

```bash
npm install
pip3 install edge-tts   # free TTS, no API key
cp .env.example .env    # fill in YouTube OAuth paths when channel is ready
pm2 start ecosystem.config.js
```

Dashboard: http://localhost:3041

## Credentials

**Never committed.** `data/`, `.env`, `*oauth*`, `*client-secret*` are gitignored.
The SES YouTube channel OAuth is a placeholder until the channel is created -
the pipeline runs end-to-end and skips upload gracefully when credentials are missing.
