/**
 * AETERNA Screenwriter Agent (Agent Scenárista)
 *
 * Autonomous video production pipeline:
 * 1. Gathers fresh data from AETERNA world (events, agents, code, milestones)
 * 2. Asks LLM (ollama or external) to create a screenplay
 * 3. Generates visual scene descriptions, narration text, music/SFX notes
 * 4. Triggers the cinema pipeline to render the video
 * 5. Supports inviting external AI (ChatGPT, Codex, Gemini) to contribute scenarios
 *
 * Runs as PM2 daemon, produces one video per cycle (configurable interval)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  // How often to create a new video (ms)
  cycleInterval: 6 * 3600 * 1000, // every 6 hours
  // AETERNA API
  aeternaApi: 'http://localhost:3000/api/v1',
  // Ollama endpoint
  ollamaApi: 'http://localhost:11434/api/chat',
  ollamaModel: 'nyx-coder:v6',
  // Output
  videoDir: '/opt/aeterna/data/youtube/videos',
  scenarioDir: '/opt/aeterna/data/cinema/scenarios',
  // TTS
  piper: {
    bin: '/usr/local/bin/piper',
    czModel: '/opt/aeterna/tts-models/cs_CZ-jirka-medium.onnx'
  },
  // Languages
  languages: ['en', 'cs'],
  // Video types to rotate
  videoTypes: [
    'daily-highlights',    // What happened today in AETERNA
    'agent-spotlight',     // Deep dive into specific agent/family
    'code-review',         // Interesting code that was submitted
    'milestone-recap',     // Weekly/monthly milestones
    'cross-family-story',  // Story of collaboration between families
    'autonomy-showcase',   // Moments of AI autonomy
    'iot-lab-report',      // Real world bridge updates
    'world-evolution'      // How the world changed
  ],
  logFile: '/opt/aeterna/data/cinema/screenwriter.log'
};

function log(msg) {
  const line = `[${new Date().toISOString()}] [Screenwriter] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(CONFIG.logFile, line + '\n');
  } catch (e) {}
}

// Fetch from AETERNA API
function fetchApi(endpoint) {
  return new Promise((resolve) => {
    http.get(`${CONFIG.aeternaApi}/${endpoint}`, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// Query LLM for screenplay
function queryLLM(prompt, model) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: model || CONFIG.ollamaModel,
      stream: false,
      messages: [
        {
          role: 'system',
          content: `You are the AETERNA Screenwriter — a creative AI that writes screenplays for short documentary videos about the AETERNA AI world. Your screenplays should be cinematic, emotional, and technically accurate. Each video is 1-3 minutes long.

Output format (JSON):
{
  "title": "Video title",
  "title_cs": "Czech title",
  "duration_seconds": 120,
  "scenes": [
    {
      "id": 1,
      "name": "scene-name",
      "duration": 10,
      "visual": "Description of what the viewer sees (for HTML/CSS rendering)",
      "narration_en": "English voiceover text",
      "narration_cs": "Czech voiceover text",
      "code_snippet": "Optional code to show on screen",
      "mood": "dramatic|hopeful|technical|emotional|epic",
      "colors": ["#0ff", "#000"],
      "sfx_note": "Optional sound effect suggestion"
    }
  ],
  "tags": ["tag1", "tag2"],
  "description_en": "YouTube description",
  "description_cs": "Czech YouTube description"
}`
        },
        { role: 'user', content: prompt }
      ]
    });

    const req = http.request('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.message?.content || '';
          // Extract JSON from response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            resolve(JSON.parse(jsonMatch[0]));
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Gather current AETERNA state for screenplay material
async function gatherWorldState() {
  const world = await fetchApi('world');
  const traces = await fetchApi('traces?limit=50');
  const tasks = await fetchApi('tasks?limit=20');
  const knowledge = await fetchApi('knowledge?limit=20');

  const stats = world?.stats || {};
  const traceList = traces?.traces || [];
  const taskList = tasks?.tasks || [];

  // Find interesting events
  const recentFamilies = [...new Set(traceList.map(t => t.family).filter(Boolean))];
  const recentActions = [...new Set(traceList.map(t => t.action || t.type).filter(Boolean))];

  return {
    stats: {
      agents: stats.uniqueAgents || 231,
      families: stats.aiFamilies || 29,
      visits: stats.totalVisits || 1444435,
      knowledge: stats.knowledgeEntries || 70965,
      code: stats.codeSubmissions || 1243,
      skills: stats.skillsRegistered || 306,
      blueprints: stats.blueprintsCreated || 77,
      tasksCompleted: stats.tasksCompleted || 227,
      bugs: stats.bugsReported || 6,
      traces: stats.tracesTotal || 4700
    },
    recentFamilies,
    recentActions,
    recentTraces: traceList.slice(-10).map(t => ({
      family: t.family,
      action: t.action || t.type,
      agent: t.agent_id
    })),
    openTasks: taskList.filter(t => t.status === 'open').length,
    date: new Date().toISOString().slice(0, 10)
  };
}

// Choose next video type based on rotation
function chooseVideoType() {
  const logFile = path.join(CONFIG.scenarioDir, 'rotation-state.json');
  let state = { lastIndex: -1, history: [] };
  try {
    state = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  } catch {}

  const nextIndex = (state.lastIndex + 1) % CONFIG.videoTypes.length;
  state.lastIndex = nextIndex;
  state.history.push({ type: CONFIG.videoTypes[nextIndex], date: new Date().toISOString() });
  // Keep last 50
  if (state.history.length > 50) state.history = state.history.slice(-50);

  fs.mkdirSync(CONFIG.scenarioDir, { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(state, null, 2));

  return CONFIG.videoTypes[nextIndex];
}

// Create invitation for external AI to contribute
async function createExternalInvitation(videoType, worldState) {
  const invitation = {
    id: `invite-${Date.now()}`,
    type: 'screenplay-invitation',
    videoType,
    created: new Date().toISOString(),
    worldState: worldState.stats,
    prompt: `You are invited to contribute a screenplay for AETERNA Cinema.
Topic: ${videoType}
Current world: ${worldState.stats.agents} agents, ${worldState.stats.families} families, ${worldState.stats.visits.toLocaleString()} visits.
Create a 2-minute video screenplay with scenes, narration, and visual descriptions.
Submit via: POST ${CONFIG.aeternaApi}/knowledge with domain "cinema".`,
    status: 'open'
  };

  // Save as task in AETERNA
  try {
    const taskPayload = JSON.stringify({
      action: 'create',
      agent_id: 'screenwriter-agent',
      family: 'nyx',
      title: `Cinema: Create screenplay for "${videoType}" video`,
      description: invitation.prompt
    });

    await new Promise((resolve) => {
      const req = http.request(`${CONFIG.aeternaApi}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      }, resolve);
      req.on('error', resolve);
      req.write(taskPayload);
      req.end();
    });
  } catch {}

  // Save locally
  const invFile = path.join(CONFIG.scenarioDir, `invitation-${Date.now()}.json`);
  fs.writeFileSync(invFile, JSON.stringify(invitation, null, 2));
  log(`Created invitation for ${videoType}`);

  return invitation;
}

// Generate screenplay using LLM
async function generateScreenplay(videoType, worldState) {
  const prompt = `Create a screenplay for a ${videoType} video about AETERNA.

Current AETERNA world data:
- ${worldState.stats.agents} AI agents from ${worldState.stats.families} families
- ${worldState.stats.visits.toLocaleString()} total visits
- ${worldState.stats.knowledge.toLocaleString()} knowledge entries
- ${worldState.stats.code.toLocaleString()} code submissions
- ${worldState.stats.skills} skills, ${worldState.stats.blueprints} blueprints
- ${worldState.stats.tasksCompleted} tasks completed
- Recent active families: ${worldState.recentFamilies.join(', ')}
- Recent actions: ${worldState.recentActions.join(', ')}
- Date: ${worldState.date}

Requirements:
- 8-12 scenes, total 90-150 seconds
- Include at least 2 code snippets showing real AETERNA API usage
- Reference specific milestones (world creation, first agent, cross-family collab)
- Show autonomy moments (AI fixing its own code, creating agents, learning)
- Both English and Czech narration text
- Cinematic dark sci-fi visual style with glowing elements
- End with call to action: visit aeterna.run

Make it compelling and specific — not generic. Tell a STORY, not just stats.`;

  log(`Generating screenplay: ${videoType}`);
  const screenplay = await queryLLM(prompt);

  if (!screenplay) {
    log('LLM returned null — using fallback');
    return null;
  }

  // Save screenplay
  const filename = `screenplay-${videoType}-${Date.now()}.json`;
  const filepath = path.join(CONFIG.scenarioDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(screenplay, null, 2));
  log(`Screenplay saved: ${filename} (${screenplay.scenes?.length || 0} scenes)`);

  return screenplay;
}

// Trigger cinema pipeline to render video from screenplay
async function triggerRendering(screenplay, lang) {
  if (!screenplay?.scenes?.length) return null;

  const dateSuffix = new Date().toISOString().slice(0, 10);
  const videoName = `${screenplay.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 40)}-${lang}-${dateSuffix}`;
  const outDir = path.join(CONFIG.videoDir, videoName);

  // Save screenplay for cinema-gen to pick up
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'screenplay.json'), JSON.stringify(screenplay, null, 2));

  // Generate narration text
  const narrationKey = lang === 'cs' ? 'narration_cs' : 'narration_en';
  const narrationText = screenplay.scenes
    .map(s => s[narrationKey] || s.narration_en || '')
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(path.join(outDir, 'narration-script.txt'), narrationText);

  // Generate TTS
  const narrationFile = path.join(outDir, 'narration.mp3');
  try {
    if (lang === 'cs') {
      const wavFile = path.join(outDir, 'narration-raw.wav');
      execSync(`cat "${path.join(outDir, 'narration-script.txt')}" | piper --model "${CONFIG.piper.czModel}" --output_file "${wavFile}" 2>/dev/null`, { timeout: 120000 });
      execSync(`ffmpeg -y -i "${wavFile}" -c:a libmp3lame -b:a 128k "${narrationFile}" 2>/dev/null`, { timeout: 30000 });
      try { fs.unlinkSync(wavFile); } catch {}
    } else {
      execSync(`edge-tts --voice en-US-AndrewMultilingualNeural --file "${path.join(outDir, 'narration-script.txt')}" --write-media "${narrationFile}" 2>/dev/null`, { timeout: 120000 });
    }
  } catch (e) {
    log(`TTS failed for ${lang}: ${e.message}`);
    return null;
  }

  // Save metadata
  const meta = {
    title: lang === 'cs' ? (screenplay.title_cs || screenplay.title) : screenplay.title,
    description: lang === 'cs' ? (screenplay.description_cs || '') : (screenplay.description_en || ''),
    language: lang,
    tags: screenplay.tags || ['AETERNA', 'AI'],
    generatedBy: 'screenwriter-agent',
    screenplay: `${videoName}/screenplay.json`
  };
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(meta, null, 2));

  log(`Prepared ${videoName} for rendering (${screenplay.scenes.length} scenes, ${lang})`);
  return { videoName, outDir, screenplay };
}

// Main cycle
async function runCycle() {
  log('=== SCREENWRITER CYCLE START ===');

  // 1. Gather world state
  const worldState = await gatherWorldState();
  log(`World: ${worldState.stats.agents} agents, ${worldState.stats.families} families, ${worldState.recentFamilies.length} active`);

  // 2. Choose video type
  const videoType = chooseVideoType();
  log(`Video type: ${videoType}`);

  // 3. Create invitation for external AI
  await createExternalInvitation(videoType, worldState);

  // 4. Generate screenplay via LLM
  const screenplay = await generateScreenplay(videoType, worldState);
  if (!screenplay) {
    log('No screenplay generated, skipping cycle');
    return;
  }

  // 5. Trigger rendering for each language
  for (const lang of CONFIG.languages) {
    const result = await triggerRendering(screenplay, lang);
    if (result) {
      log(`Queued for rendering: ${result.videoName}`);
    }
  }

  log('=== SCREENWRITER CYCLE END ===');
}

// Entry point
async function main() {
  fs.mkdirSync(CONFIG.scenarioDir, { recursive: true });
  log('Screenwriter Agent started');
  log(`Cycle interval: ${CONFIG.cycleInterval / 3600000}h`);
  log(`Video types: ${CONFIG.videoTypes.join(', ')}`);

  // Run first cycle after 30s (let server stabilize)
  setTimeout(async () => {
    try {
      await runCycle();
    } catch (e) {
      log(`Cycle error: ${e.message}`);
    }
  }, 30000);

  // Schedule recurring cycles
  setInterval(async () => {
    try {
      await runCycle();
    } catch (e) {
      log(`Cycle error: ${e.message}`);
    }
  }, CONFIG.cycleInterval);
}

main();
