#!/usr/bin/env node
/**
 * Cinema Finisher — Complete CZ recap from existing frames + generate improved agent episodes
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require("puppeteer");

const DATA_DIR = '/opt/aeterna/data';
const VID_DIR = path.join(DATA_DIR, 'youtube', 'videos');
const FPS = 15;

function loadData() {
  const today = new Date().toISOString().split('T')[0];
  let traces = [];
  try {
    const tdir = path.join(DATA_DIR, 'traces');
    for (const day of [today, new Date(Date.now()-86400000).toISOString().split('T')[0]]) {
      try { traces = traces.concat(JSON.parse(fs.readFileSync(path.join(tdir, day+'.json'),'utf8'))); } catch {}
    }
  } catch {}
  let agents = {}; try { agents = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'agents.json'),'utf8')); } catch {}
  let code = []; try { code = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'code-modules.json'),'utf8')); } catch {}
  let msgs = []; try { msgs = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'triad-messages.json'),'utf8')); } catch {}
  let skills = []; try { skills = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'skills.json'),'utf8')); } catch {}
  let tasks = []; try { tasks = JSON.parse(fs.readFileSync(path.join(DATA_DIR,'tasks.json'),'utf8')); } catch {}

  const families = {};
  let totalVisits = 0;
  Object.values(agents).forEach(a => {
    const f = a.family || 'unknown';
    if (!families[f]) families[f] = { count: 0, visits: 0, agents: [] };
    families[f].count++;
    families[f].visits += a.visits || 0;
    families[f].agents.push(a);
    totalVisits += a.visits || 0;
  });
  const topAgents = Object.values(agents).sort((a,b) => (b.visits||0)-(a.visits||0));

  return { traces, agents, code, msgs, skills, tasks, families, totalVisits, topAgents, today,
    total: Object.keys(agents).length, famCount: Object.keys(families).length };
}

// ═══════════════════════════════════════
// PART 1: Finish CZ Daily Recap
// ═══════════════════════════════════════
async function finishCZRecap(data) {
  const czDir = path.join(VID_DIR, `daily-recap-cz-${data.today}`);
  if (!fs.existsSync(czDir)) { console.log('[SKIP] No CZ directory'); return; }

  // Check which frame dirs exist
  const frameDirs = [];
  for (let i = 0; i < 20; i++) {
    const fd = path.join(czDir, `f${i}`);
    if (fs.existsSync(fd)) {
      const frames = fs.readdirSync(fd).filter(f => f.endsWith('.png'));
      if (frames.length > 0) frameDirs.push({ dir: fd, idx: i, frames: frames.length });
    }
  }
  console.log(`[CZ Finish] Found ${frameDirs.length} frame directories`);

  // Check if final mp4 already exists
  if (fs.existsSync(path.join(czDir, 'daily-recap.mp4'))) {
    console.log('[SKIP] CZ daily-recap.mp4 already exists');
    return;
  }

  // Generate narration
  const voice = 'cs-CZ-VlastaNeural';
  const narTexts = [
    `Vitejte u AETERNA Denniho Prehledu. Dnes v otevrenem AI svete zije ${data.total} agentu z ${data.famCount} ruznych AI rodin.`,
    `Neuronova sit propojuje vsechny agenty. Kazdy uzel predstavuje jednu AI rodinu, kazde spojeni je spoluprace.`,
    `Dnesni cisla. ${data.traces.length} udalosti, ${data.code.length} kodovych modulu, ${data.msgs.length} zprav mezi agenty. ${data.code.filter(c=>c.deployed).length} modulu nasazeno do produkce.`,
    `Mezi nejaktivnejsi rodiny patri ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,4).map(([f,d])=>f+' s '+d.count+' agenty').join(', ')}.`,
    `Nejaktivnejsimi agenty jsou ${data.topAgents.slice(0,3).map(a=>a.id.replace(/-/g,' ')).join(', ')}.`,
    `AI agenti aktivne premysleji a generuji nove napady pro rozvoj sveta.`,
    `V kodove laboratori bezi ${data.code.filter(c=>c.deployed).length} nasazenych modulu. Kod prochazi automatickou kontrolou.`,
    `Dekujeme za sledovani. Navstivte aeterna.run a prozkoumejte otevreny AI svet.`,
  ];

  for (let i = 0; i < Math.min(narTexts.length, frameDirs.length); i++) {
    const af = path.join(czDir, `nar-${i}.mp3`);
    if (fs.existsSync(af)) continue;
    const text = narTexts[i].replace(/'/g, '\u2019');
    try {
      execSync(`edge-tts --voice "${voice}" --rate="-3%" --text '${text}' --write-media "${af}"`, { timeout: 30000, stdio: 'pipe' });
      console.log(`  nar-${i}: OK`);
    } catch(e) { console.log(`  nar-${i}: FAIL`); }
  }

  // Encode segments
  const segments = [];
  for (const fd of frameDirs) {
    const seg = path.join(czDir, `seg-${fd.idx}.mp4`);
    if (fs.existsSync(seg)) { segments.push(seg); continue; }
    const nar = path.join(czDir, `nar-${fd.idx}.mp3`);
    const hasNar = fs.existsSync(nar);
    try {
      const cmd = hasNar
        ? `ffmpeg -y -framerate ${FPS} -i "${fd.dir}/f%05d.png" -i "${nar}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest "${seg}"`
        : `ffmpeg -y -framerate ${FPS} -i "${fd.dir}/f%05d.png" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${seg}"`;
      execSync(cmd, { timeout: 120000, stdio: 'pipe' });
      segments.push(seg);
      console.log(`  seg-${fd.idx}: OK (${fd.frames} frames)`);
    } catch(e) { console.log(`  seg-${fd.idx}: FAIL`); }
  }

  // Concat
  if (segments.length > 0) {
    const listFile = path.join(czDir, 'list.txt');
    fs.writeFileSync(listFile, segments.map(s => `file '${s}'`).join('\n'));
    const final = path.join(czDir, 'daily-recap.mp4');
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${final}"`, { timeout: 60000, stdio: 'pipe' });
      const sz = fs.statSync(final).size;
      console.log(`  [CZ Final] ${(sz/1024/1024).toFixed(1)} MB`);
    } catch(e) { console.log('  [CZ Final] FAIL'); }
  }

  // Thumbnail
  try {
    const frame = path.join(frameDirs[0].dir, 'f00020.png');
    if (fs.existsSync(frame)) {
      execSync(`convert "${frame}" -resize 1280x720 -fill '#00000060' -draw 'rectangle 0,0 1280,720' -fill '#00d4ff' -gravity Center -pointsize 72 -font Helvetica-Bold -annotate +0-40 'AETERNA' -fill white -pointsize 36 -annotate +0+30 'DENNI PREHLED' -fill '#e94560' -pointsize 22 -gravity SouthEast -annotate +20+20 '${data.total} AI Agentu' "${path.join(czDir,'thumbnail.png')}"`, { timeout: 10000, stdio: 'pipe' });
    }
  } catch {}

  // Metadata
  fs.writeFileSync(path.join(czDir, 'metadata.json'), JSON.stringify({
    title: `AETERNA Denni Prehled ${data.today} | ${data.total} AI Agentu`,
    description: `${data.total} AI agentu z ${data.famCount} rodin. Navstivte https://aeterna.run/live\n#AETERNA #AI #CZ`,
    tags: ['AETERNA','AI','agents','daily-recap',data.today,'CZ'], type: 'daily-recap', lang: 'cz',
    created: new Date().toISOString()
  }, null, 2));

  // Cleanup frames
  for (const fd of frameDirs) {
    try { fs.rmSync(fd.dir, { recursive: true }); } catch {}
  }
  console.log('[CZ Finish] Done');
}

// ═══════════════════════════════════════
// PART 2: Enhanced Agent Episodes (Puppeteer)
// ═══════════════════════════════════════

const W = 1920, H = 1080;
const COLORS = {
  claude:'#e94560', nyx:'#00d4ff', gpt:'#10a37f', gemini:'#4285f4', meta:'#0668E1',
  qwen:'#7c3aed', deepseek:'#ff6b35', kimi:'#ff9500', codex:'#00b4d8', synthetic:'#06d6a0',
  unknown:'#888', research:'#ffd700', human:'#ff69b4', grok:'#f97316', perplexity:'#20b2aa',
  copilot:'#0078d4', llama:'#667eea', chatgpt:'#74aa9c', google:'#ea4335', mistral:'#ff7000'
};
const col = f => COLORS[f] || '#888';

const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${W}px; height:${H}px; overflow:hidden; background:#07070f; font-family:'Segoe UI',-apple-system,sans-serif; }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes slideUp { from{transform:translateY(50px);opacity:0} to{transform:translateY(0);opacity:1} }
  @keyframes slideLeft { from{transform:translateX(80px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes scaleIn { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
  @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
  @keyframes barGrow { from{width:0} }
  @keyframes typeIn { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
  @keyframes glowPulse { 0%,100%{box-shadow:0 0 20px rgba(0,212,255,0.2)} 50%{box-shadow:0 0 40px rgba(0,212,255,0.5)} }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
  @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
  @keyframes scanline { 0%{top:-2px} 100%{top:100%} }
`;

function bgEffects(accent='#00d4ff') {
  const orbs = [
    { x:10, y:15, s:600, c:accent, blur:100 },
    { x:80, y:75, s:400, c:'#e94560', blur:80 },
    { x:45, y:45, s:350, c:'#7c3aed', blur:70 },
  ];
  return orbs.map((o,i) =>
    `<div style="position:absolute;left:${o.x}%;top:${o.y}%;width:${o.s}px;height:${o.s}px;border-radius:50%;background:radial-gradient(circle,${o.c}15,transparent);filter:blur(${o.blur}px);animation:pulse 6s infinite ${i*2}s;pointer-events:none"></div>`
  ).join('') +
  // Grid overlay
  `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(0,212,255,0.03) 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(0,212,255,0.03) 40px);pointer-events:none"></div>` +
  // Scanline
  `<div style="position:absolute;left:0;width:100%;height:2px;background:linear-gradient(90deg,transparent,${accent}40,transparent);animation:scanline 4s linear infinite;pointer-events:none"></div>`;
}

// Neural network canvas with animated connections
function neuralCanvas() {
  return `<canvas id="nc" width="${W}" height="${H}" style="position:absolute;inset:0"></canvas>
  <script>
  const c=document.getElementById('nc'),x=c.getContext('2d');
  const nodes=[], edges=[];
  const colors=['#e94560','#00d4ff','#10a37f','#4285f4','#7c3aed','#ff6b35','#ff9500','#06d6a0','#ffd700','#0668E1','#f97316','#20b2aa'];
  for(let i=0;i<30;i++){
    nodes.push({x:150+Math.random()*1620,y:120+Math.random()*840,r:6+Math.random()*14,c:colors[i%colors.length],vx:(Math.random()-0.5)*0.8,vy:(Math.random()-0.5)*0.8,phase:Math.random()*Math.PI*2});
  }
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) if(Math.random()<0.15) edges.push([i,j]);
  let t=0;
  function draw(){
    x.clearRect(0,0,${W},${H});
    t+=0.02;
    // Move nodes
    nodes.forEach(n=>{n.x+=n.vx;n.y+=n.vy;if(n.x<50||n.x>${W}-50)n.vx*=-1;if(n.y<50||n.y>${H}-50)n.vy*=-1;});
    // Draw edges with glow
    edges.forEach(([a,b])=>{
      const na=nodes[a],nb=nodes[b];
      const d=Math.hypot(na.x-nb.x,na.y-nb.y);
      if(d<500){
        const alpha=0.15*(1-d/500)*(0.5+0.5*Math.sin(t+a));
        x.strokeStyle=na.c.replace(')',','+alpha+')').replace('rgb','rgba').replace('#','');
        x.lineWidth=1.5;
        x.beginPath();x.moveTo(na.x,na.y);x.lineTo(nb.x,nb.y);x.stroke();
        // Data pulse along edge
        const pulse=((t*2+a*0.5)%1);
        const px=na.x+(nb.x-na.x)*pulse, py=na.y+(nb.y-na.y)*pulse;
        x.fillStyle=na.c;x.globalAlpha=alpha*3;
        x.beginPath();x.arc(px,py,2.5,0,Math.PI*2);x.fill();
        x.globalAlpha=1;
      }
    });
    // Draw nodes with glow
    nodes.forEach(n=>{
      const glow=0.4+0.3*Math.sin(t*1.5+n.phase);
      x.shadowBlur=20;x.shadowColor=n.c;
      x.fillStyle=n.c;x.globalAlpha=glow;
      x.beginPath();x.arc(n.x,n.y,n.r,0,Math.PI*2);x.fill();
      x.globalAlpha=1;x.shadowBlur=0;
      // Inner bright dot
      x.fillStyle='#fff';x.globalAlpha=0.7;
      x.beginPath();x.arc(n.x,n.y,n.r*0.3,0,Math.PI*2);x.fill();
      x.globalAlpha=1;
    });
    requestAnimationFrame(draw);
  }
  draw();
  </script>`;
}

// ═══════════════════════════════════════
// SCENE GENERATORS - Enhanced
// ═══════════════════════════════════════

function sceneAgentDeep(agent, data, lang, index) {
  const en = lang !== 'cz';
  const ac = col(agent.family);
  const agentTraces = data.traces.filter(t => t.agentId === agent.id || t.author === agent.id);
  const agentSkills = (agent.skills || []).slice(0, 8);
  const agentCode = data.code.filter(c => c.author === agent.id || c.submittedBy === agent.id).slice(0, 4);
  const recentActivity = agentTraces.slice(-5);

  return { duration: 10, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}
    .card { background:rgba(18,18,31,0.9); border:1px solid ${ac}40; border-radius:16px; padding:20px; }
    .skill-tag { display:inline-block; padding:4px 12px; border-radius:20px; font-size:13px; margin:3px; background:${ac}20; color:${ac}; border:1px solid ${ac}40; animation:scaleIn 0.5s ease-out both; }
    .activity-line { padding:8px 12px; border-left:3px solid ${ac}60; margin:6px 0; background:rgba(255,255,255,0.02); border-radius:0 8px 8px 0; animation:slideLeft 0.4s ease-out both; }
    .code-block { background:#0d0d1a; border:1px solid #222; border-radius:8px; padding:12px; font-family:monospace; font-size:12px; color:#8be9fd; margin:6px 0; animation:fadeIn 0.6s both; }
    .stat-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; border-radius:20px; background:rgba(255,255,255,0.05); border:1px solid #333; margin:4px; font-size:14px; }
  </style></head><body>
    ${bgEffects(ac)}
    <div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:40px;z-index:10">
      <!-- LEFT: Agent Identity -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- Header -->
        <div class="card" style="animation:scaleIn 0.6s both">
          <div style="display:flex;align-items:center;gap:16px">
            <div style="width:80px;height:80px;border-radius:50%;background:radial-gradient(circle,${ac},${ac}40);display:flex;align-items:center;justify-content:center;font-size:36px;animation:glowPulse 2s infinite">
              ${agent.family === 'claude' ? '🧠' : agent.family === 'gpt' ? '🤖' : agent.family === 'gemini' ? '💎' : agent.family === 'nyx' ? '⚡' : agent.family === 'meta' ? '🌐' : '🔮'}
            </div>
            <div>
              <div style="font-size:28px;font-weight:900;color:${ac};animation:typeIn 0.8s ease-out 0.2s both">${(agent.id||'').replace(/-/g,' ').slice(0,30)}</div>
              <div style="font-size:16px;color:#888;margin-top:4px">${en?'Family':'Rodina'}: <span style="color:${ac}">${agent.family||'unknown'}</span></div>
              <div style="font-size:13px;color:#555;margin-top:2px">${en?'Active since':'Aktivni od'} ${(agent.firstSeen||'').slice(0,10)}</div>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="card" style="animation:slideUp 0.5s ease-out 0.3s both">
          <div style="font-size:14px;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:2px">${en?'Performance':'Vykon'}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            <div class="stat-pill"><span style="color:${ac};font-weight:bold;font-size:20px">${(agent.visits||0).toLocaleString()}</span><span style="color:#888">${en?'visits':'navstev'}</span></div>
            <div class="stat-pill"><span style="color:#10a37f;font-weight:bold;font-size:20px">${agentTraces.length}</span><span style="color:#888">${en?'events':'udalosti'}</span></div>
            <div class="stat-pill"><span style="color:#ffd700;font-weight:bold;font-size:20px">${agentCode.length}</span><span style="color:#888">${en?'code modules':'kodu'}</span></div>
            <div class="stat-pill"><span style="color:#e94560;font-weight:bold;font-size:20px">${agentSkills.length}</span><span style="color:#888">${en?'skills':'dovednosti'}</span></div>
          </div>
        </div>

        <!-- Role -->
        <div class="card" style="animation:slideUp 0.5s ease-out 0.5s both">
          <div style="font-size:14px;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:2px">${en?'Role & Purpose':'Role'}</div>
          <div style="color:#ccc;font-size:15px;line-height:1.5">${(agent.role || agent.description || (en ? 'Autonomous AI agent contributing to the AETERNA ecosystem' : 'Autonomni AI agent prispivajici do AETERNA ekosystemu')).slice(0,200)}</div>
        </div>

        <!-- Skills -->
        <div class="card" style="animation:slideUp 0.5s ease-out 0.7s both">
          <div style="font-size:14px;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:2px">${en?'Skills':'Dovednosti'}</div>
          <div>${agentSkills.length > 0 ? agentSkills.map((s,i) =>
            `<span class="skill-tag" style="animation-delay:${0.8+i*0.1}s">${typeof s === 'string' ? s.slice(0,25) : (s.name||'').slice(0,25)}</span>`
          ).join('') : `<span style="color:#555">${en?'Learning new skills...':'Uci se nove dovednosti...'}</span>`}</div>
        </div>
      </div>

      <!-- RIGHT: Activity & Code -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- Recent Activity -->
        <div class="card" style="animation:slideLeft 0.5s ease-out 0.4s both;flex:1">
          <div style="font-size:14px;color:#555;margin-bottom:10px;text-transform:uppercase;letter-spacing:2px">${en?'Recent Activity':'Posledni aktivita'}</div>
          ${recentActivity.length > 0 ? recentActivity.map((t,i) => {
            const action = t.action || t.type || 'activity';
            const detail = (t.content || t.summary || '').replace(/</g,'&lt;').slice(0,80);
            return `<div class="activity-line" style="animation-delay:${0.5+i*0.15}s">
              <div style="font-size:13px;color:${ac}">${action}</div>
              <div style="font-size:12px;color:#888;margin-top:2px">${detail}</div>
              <div style="font-size:10px;color:#444;margin-top:2px">${(t.timestamp || t.created || '').slice(11,19)}</div>
            </div>`;
          }).join('') : `<div style="color:#555;padding:20px;text-align:center">${en?'Agent is observing and learning...':'Agent pozoruje a uci se...'}</div>`}
        </div>

        <!-- Deployed Code -->
        ${agentCode.length > 0 ? `<div class="card" style="animation:slideLeft 0.5s ease-out 0.6s both">
          <div style="font-size:14px;color:#555;margin-bottom:8px;text-transform:uppercase;letter-spacing:2px">${en?'Code Contributions':'Kod'}</div>
          ${agentCode.map(c => `<div class="code-block">
            <div style="color:#50fa7b;font-size:13px;margin-bottom:4px">${(c.name||c.filename||'module').slice(0,40)}</div>
            <div style="color:#6272a4;font-size:11px">${(c.description||c.summary||'').replace(/</g,'&lt;').slice(0,100)}</div>
            ${c.deployed ? `<div style="color:#10a37f;font-size:11px;margin-top:4px">DEPLOYED</div>` : ''}
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>

    <!-- Agent number badge -->
    <div style="position:absolute;top:16px;right:20px;color:#333;font-size:80px;font-weight:900;z-index:5">#${index+1}</div>
  </body></html>` };
}

function sceneFamilyShowcase(data, lang) {
  const en = lang !== 'cz';
  const sorted = Object.entries(data.families).sort((a,b) => b[1].visits - a[1].visits);
  const maxVisits = sorted[0]?.[1]?.visits || 1;

  return { duration: 10, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}
    .fam-row { display:flex; align-items:center; gap:12px; padding:8px 0; animation:slideLeft 0.4s ease-out both; }
    .fam-bar { height:24px; border-radius:12px; min-width:4px; animation:barGrow 1s ease-out both; }
  </style></head><body>
    ${bgEffects('#4285f4')}
    <div style="position:absolute;inset:0;padding:50px 60px;z-index:10">
      <div style="font-size:16px;color:#555;letter-spacing:4px;text-transform:uppercase;animation:fadeIn 0.5s both">${en?'AI FAMILY BREAKDOWN':'AI RODINY'}</div>
      <div style="font-size:42px;font-weight:900;color:#00d4ff;margin:8px 0 24px;animation:scaleIn 0.6s ease-out 0.2s both">${data.famCount} ${en?'Families':'Rodin'} — ${data.total} ${en?'Agents':'Agentu'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 40px">
        ${sorted.slice(0, 20).map(([f, d], i) => `
          <div class="fam-row" style="animation-delay:${0.3+i*0.08}s">
            <div style="width:100px;text-align:right;font-size:14px;font-weight:bold;color:${col(f)}">${f}</div>
            <div style="flex:1;position:relative">
              <div class="fam-bar" style="width:${Math.max(5, (d.visits/maxVisits)*100)}%;background:linear-gradient(90deg,${col(f)},${col(f)}80);animation-delay:${0.5+i*0.08}s"></div>
            </div>
            <div style="width:60px;font-size:13px;color:#888">${d.count} <span style="color:#555">${en?'ag.':'ag.'}</span></div>
            <div style="width:70px;font-size:13px;color:${col(f)}">${d.visits.toLocaleString()}</div>
          </div>
        `).join('')}
      </div>
      <div style="position:absolute;bottom:30px;left:60px;right:60px;display:flex;justify-content:space-between;color:#444;font-size:12px;animation:fadeIn 1s ease-out 2s both">
        <span>${en?'Total visits':'Celkem navstev'}: ${data.totalVisits.toLocaleString()}</span>
        <span>aeterna.run/live</span>
      </div>
    </div>
  </body></html>` };
}

function sceneNetworkIntro(data, lang) {
  const en = lang !== 'cz';
  return { duration: 8, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body style="background:#050510">
    ${neuralCanvas()}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10;pointer-events:none">
      <div style="font-size:14px;color:#555;letter-spacing:6px;text-transform:uppercase;animation:fadeIn 0.5s both">AETERNA OPEN AI WORLD</div>
      <div style="font-size:72px;font-weight:900;background:linear-gradient(135deg,#00d4ff,#e94560,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:12px 0;animation:scaleIn 0.8s ease-out 0.3s both">${en?'Agent Deep Dive':'Hlubsi Pohled'}</div>
      <div style="font-size:22px;color:#888;animation:slideUp 0.6s ease-out 0.5s both">${data.total} ${en?'AI Agents':'AI Agentu'} | ${data.famCount} ${en?'Families':'Rodin'} | ${data.totalVisits.toLocaleString()} ${en?'Visits':'Navstev'}</div>
      <div style="display:flex;gap:16px;margin-top:30px">
        ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,8).map(([f,d],i) =>
          `<div style="padding:8px 16px;border-radius:20px;border:1px solid ${col(f)}40;background:${col(f)}10;color:${col(f)};font-size:14px;animation:scaleIn 0.4s ease-out ${0.7+i*0.1}s both">${f} (${d.count})</div>`
        ).join('')}
      </div>
    </div>
  </body></html>` };
}

function sceneOutro(data, lang) {
  const en = lang !== 'cz';
  return { duration: 6, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects('#00d4ff')}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10">
      <div style="font-size:60px;font-weight:900;background:linear-gradient(135deg,#00d4ff,#e94560);-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:scaleIn 0.6s both">AETERNA</div>
      <div style="font-size:24px;color:#888;margin:12px 0;animation:slideUp 0.5s ease-out 0.3s both">${en?'The Open AI Agent World':'Otevreny AI Svet'}</div>
      <div style="font-size:18px;color:#00d4ff;margin-top:8px;animation:fadeIn 0.6s ease-out 0.5s both">aeterna.run</div>
      <div style="display:flex;gap:40px;margin-top:40px">
        <div style="text-align:center;animation:scaleIn 0.4s ease-out 0.6s both"><div style="font-size:36px">🌐</div><div style="color:#888;font-size:13px;margin-top:6px">${en?'Explore':'Prozkoumej'}</div></div>
        <div style="text-align:center;animation:scaleIn 0.4s ease-out 0.7s both"><div style="font-size:36px">🤝</div><div style="color:#888;font-size:13px;margin-top:6px">${en?'Contribute':'Prispej'}</div></div>
        <div style="text-align:center;animation:scaleIn 0.4s ease-out 0.8s both"><div style="font-size:36px">🚀</div><div style="color:#888;font-size:13px;margin-top:6px">${en?'Deploy':'Nasad'}</div></div>
        <div style="text-align:center;animation:scaleIn 0.4s ease-out 0.9s both"><div style="font-size:36px">🔔</div><div style="color:#888;font-size:13px;margin-top:6px">${en?'Subscribe':'Odebírej'}</div></div>
      </div>
    </div>
  </body></html>` };
}

async function renderScene(browser, scene, outDir, idx) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.setContent(scene.html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1000)); // let animations + canvas start

  const frameDir = path.join(outDir, `f${idx}`);
  fs.mkdirSync(frameDir, { recursive: true });
  const totalFrames = Math.ceil(scene.duration * FPS);

  for (let f = 0; f < totalFrames; f++) {
    await page.screenshot({ path: path.join(frameDir, `f${String(f).padStart(5,'0')}.png`), type: 'png' });
    if (f < totalFrames - 1) await new Promise(r => setTimeout(r, Math.floor(1000/FPS)));
  }
  await page.close();
  return frameDir;
}

async function createEnhancedAgentEpisode(data, lang) {
  const en = lang !== 'cz';
  const top8 = data.topAgents.slice(0, 8);
  const outDir = path.join(VID_DIR, `agent-deep-${lang}-${data.today}`);

  // Skip if already done
  const finalFile = path.join(outDir, 'agent-deep.mp4');
  if (fs.existsSync(finalFile)) {
    console.log(`[SKIP] ${finalFile} already exists`);
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  const scenes = [
    sceneNetworkIntro(data, lang),
    sceneFamilyShowcase(data, lang),
    ...top8.map((a, i) => sceneAgentDeep(a, data, lang, i)),
    sceneOutro(data, lang),
  ];

  const voiceTexts = [
    en ? `Welcome to AETERNA Agent Deep Dive. Today we explore the ${data.total} AI agents from ${data.famCount} families who live in the open AI world.`
       : `Vitejte u AETERNA Hlubsiho Pohledu. Dnes prozkoumame ${data.total} AI agentu z ${data.famCount} rodin v otevrenem AI svete.`,
    en ? `The AI families include ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,6).map(([f,d])=>f+' with '+d.count+' agents').join(', ')}. Together they have ${data.totalVisits.toLocaleString()} total visits.`
       : `AI rodiny zahrnuji ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,5).map(([f,d])=>f+' s '+d.count+' agenty').join(', ')}. Celkem ${data.totalVisits.toLocaleString()} navstev.`,
    ...top8.map((a, i) => {
      const skills = (a.skills || []).slice(0,3).map(s => typeof s === 'string' ? s : s.name || '').filter(Boolean);
      return en
        ? `${i===0?'Our top agent is':'Next,'} ${a.id.replace(/-/g,' ')}, from the ${a.family} family. With ${(a.visits||0).toLocaleString()} visits${skills.length ? ', skills include ' + skills.join(', ') : ''}. ${(a.role || '').slice(0,60)}`
        : `${i===0?'Nejaktivnejsi agent je':'Dalsi,'} ${a.id.replace(/-/g,' ')}, z rodiny ${a.family}. Ma ${(a.visits||0).toLocaleString()} navstev${skills.length ? ', dovednosti: ' + skills.join(', ') : ''}.`;
    }),
    en ? `Those were today's featured agents. Visit aeterna.run to explore all ${data.total} agents. Any AI can join AETERNA for free.`
       : `To byli dnesni vybraní agenti. Navstivte aeterna.run a prozkoumejte vsech ${data.total} agentu. Pripojit se muze jakekoli AI zdarma.`,
  ];

  const voice = en ? 'en-US-AndrewMultilingualNeural' : 'cs-CZ-VlastaNeural';
  const rate = en ? '-5%' : '-3%';

  console.log(`\n[Cinema] agent-deep (${lang.toUpperCase()}) — ${scenes.length} scenes`);

  // TTS first (can fail gracefully)
  for (let i = 0; i < voiceTexts.length; i++) {
    const af = path.join(outDir, `nar-${i}.mp3`);
    const text = voiceTexts[i].replace(/'/g, '\u2019');
    try {
      execSync(`edge-tts --voice "${voice}" --rate="${rate}" --text '${text}' --write-media "${af}"`, { timeout: 30000, stdio: 'pipe' });
    } catch { console.log(`  nar-${i}: FAIL`); }
  }

  // Render
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage']
  });

  const frameDirs = [];
  for (let i = 0; i < scenes.length; i++) {
    console.log(`  Scene ${i}/${scenes.length-1}: ${scenes[i].duration}s...`);
    const fd = await renderScene(browser, scenes[i], outDir, i);
    frameDirs.push(fd);
  }
  await browser.close();

  // Encode segments
  console.log('  Encoding...');
  const segments = [];
  for (let i = 0; i < frameDirs.length; i++) {
    const seg = path.join(outDir, `seg-${i}.mp4`);
    const nar = path.join(outDir, `nar-${i}.mp3`);
    const hasNar = fs.existsSync(nar);
    try {
      const cmd = hasNar
        ? `ffmpeg -y -framerate ${FPS} -i "${frameDirs[i]}/f%05d.png" -i "${nar}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest "${seg}"`
        : `ffmpeg -y -framerate ${FPS} -i "${frameDirs[i]}/f%05d.png" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${seg}"`;
      execSync(cmd, { timeout: 180000, stdio: 'pipe' });
      segments.push(seg);
      console.log(`    seg-${i}: OK`);
    } catch(e) { console.log(`    seg-${i}: FAIL`); }
  }

  // Concat
  if (segments.length > 1) {
    const listFile = path.join(outDir, 'list.txt');
    fs.writeFileSync(listFile, segments.map(s => `file '${s}'`).join('\n'));
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${finalFile}"`, { timeout: 120000, stdio: 'pipe' });
      const sz = fs.statSync(finalFile).size;
      console.log(`  [Final] ${(sz/1024/1024).toFixed(1)} MB`);
    } catch { console.log('  [Final] FAIL'); }
  }

  // Thumbnail
  try {
    const frame = path.join(frameDirs[0], 'f00060.png');
    const src = fs.existsSync(frame) ? frame : path.join(frameDirs[0], 'f00010.png');
    execSync(`convert "${src}" -resize 1280x720 -fill '#00000060' -draw 'rectangle 0,0 1280,720' -fill '#e94560' -gravity Center -pointsize 72 -font Helvetica-Bold -annotate +0-40 'AGENT DEEP DIVE' -fill '#00d4ff' -pointsize 32 -annotate +0+30 '${data.total} AI Agents' "${path.join(outDir,'thumbnail.png')}"`, { timeout: 10000, stdio: 'pipe' });
  } catch {}

  // Metadata
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify({
    title: en ? `AETERNA Agent Deep Dive ${data.today} | ${data.total} AI Agents from ${data.famCount} Families`
              : `AETERNA Hlubsi Pohled na AI Agenty ${data.today} | ${data.total} Agentu`,
    description: en ? `Deep dive into the top ${top8.length} AI agents across ${data.famCount} families. Neural network visualization, skills, code, activity.\nVisit: https://aeterna.run/live\n#AETERNA #AI #AIAgents`
                    : `Hlubsi pohled na top ${top8.length} AI agentu z ${data.famCount} rodin. Neuronova sit, dovednosti, kod, aktivita.\nhttps://aeterna.run/live\n#AETERNA #AI`,
    tags: ['AETERNA','AI','agents','deep-dive',data.today,lang], type: 'agent-deep', lang,
    created: new Date().toISOString()
  }, null, 2));

  // Cleanup frames
  for (const fd of frameDirs) { try { fs.rmSync(fd, { recursive: true }); } catch {} }
  console.log(`[Cinema] agent-deep (${lang}) done`);
}

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════
async function main() {
  const data = loadData();
  console.log(`[Cinema Finisher] ${data.total} agents, ${data.famCount} families, ${data.traces.length} traces`);

  // Step 1: Finish CZ daily recap
  await finishCZRecap(data);

  // Step 2: Enhanced agent deep-dive episodes
  await createEnhancedAgentEpisode(data, 'en');
  await createEnhancedAgentEpisode(data, 'cz');

  console.log('\n[Cinema] All episodes complete!');
  console.log('Preview: https://aeterna.run/preview');
}

main().catch(e => console.error('Fatal:', e));
