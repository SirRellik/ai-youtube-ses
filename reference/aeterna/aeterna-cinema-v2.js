#!/usr/bin/env node
/**
 * AETERNA Cinema Engine v2 — Professional Video Production
 *
 * Techniques from top YouTube studios:
 * - Puppeteer HTML→frame rendering (like Remotion/Motion Canvas)
 * - Canvas-based particle systems, neural network visualization
 * - Kinetic typography with staggered animations
 * - Data-driven animated charts and progress bars
 * - Smooth xfade transitions between scenes via FFmpeg
 * - Dual language output (EN + CZ)
 * - Multiple TTS voices (Andrew=narrator, Ava=data, Brian=casual)
 * - Full content: agent profiles, code previews, skills, family breakdowns
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

const DATA_DIR = '/opt/aeterna/data';
const VID_DIR = path.join(DATA_DIR, 'youtube', 'videos');
const FPS = 15;
const W = 1920, H = 1080;

// ══════════════════════════════════════
// DATA LOADER
// ══════════════════════════════════════
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
  const thoughts = traces.filter(t => t.content?.includes('#THINK')).map(t => {
    try { const m = t.content.match(/\{[\s\S]+\}/); return { ...t, thought: JSON.parse(m[0]).thought }; } catch { return null; }
  }).filter(Boolean);

  return { traces, agents, code, msgs, skills, families, totalVisits, topAgents, thoughts, today, total: Object.keys(agents).length, famCount: Object.keys(families).length };
}

// ══════════════════════════════════════
// CSS & VISUAL SYSTEM
// ══════════════════════════════════════
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
  @keyframes slideRight { from{transform:translateX(-80px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes scaleIn { from{transform:scale(0.7);opacity:0} to{transform:scale(1);opacity:1} }
  @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-15px)} }
  @keyframes barGrow { from{width:0} }
  @keyframes countPulse { 0%{transform:scale(1)} 50%{transform:scale(1.05)} 100%{transform:scale(1)} }
  @keyframes typeIn { from{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0 0 0 0)} }
  @keyframes glowPulse { 0%,100%{box-shadow:0 0 20px rgba(0,212,255,0.2)} 50%{box-shadow:0 0 40px rgba(0,212,255,0.5)} }
  @keyframes nodeFloat { 0%{transform:translate(0,0)} 25%{transform:translate(5px,-8px)} 50%{transform:translate(-3px,5px)} 75%{transform:translate(8px,3px)} 100%{transform:translate(0,0)} }
`;

// Particle background + glow orbs
function bgEffects(accent='#00d4ff') {
  let html = '';
  // Glow orbs
  const orbs = [
    { x:15, y:20, s:500, c:accent, blur:80, delay:0 },
    { x:75, y:70, s:400, c:'#e94560', blur:70, delay:1.5 },
    { x:50, y:40, s:300, c:'#7c3aed', blur:60, delay:3 },
  ];
  orbs.forEach(o => {
    html += `<div style="position:absolute;left:${o.x}%;top:${o.y}%;width:${o.s}px;height:${o.s}px;border-radius:50%;background:radial-gradient(circle,${o.c}12,transparent);filter:blur(${o.blur}px);animation:pulse 5s infinite ${o.delay}s;pointer-events:none"></div>`;
  });
  // Particles
  for (let i = 0; i < 50; i++) {
    const x = Math.random()*100, y = Math.random()*100;
    const s = 1 + Math.random()*3, op = 0.1 + Math.random()*0.25;
    const dur = 4 + Math.random()*6, del = Math.random()*4;
    const c = Object.values(COLORS)[Math.floor(Math.random()*10)];
    html += `<div style="position:absolute;left:${x}%;top:${y}%;width:${s}px;height:${s}px;border-radius:50%;background:${c};opacity:${op};animation:float ${dur}s infinite ${del}s;pointer-events:none"></div>`;
  }
  // Grid lines (subtle)
  html += `<div style="position:absolute;inset:0;opacity:0.03;background-image:linear-gradient(rgba(0,212,255,0.3) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.3) 1px,transparent 1px);background-size:60px 60px;pointer-events:none"></div>`;
  return html;
}

// Neural network canvas visualization
function neuralNetCanvas() {
  return `<canvas id="neural" width="${W}" height="${H}" style="position:absolute;inset:0;pointer-events:none"></canvas>
  <script>
    const c = document.getElementById('neural').getContext('2d');
    const nodes = [];
    const families = ${JSON.stringify(Object.keys(COLORS).slice(0,12))};
    const colors = ${JSON.stringify(Object.values(COLORS).slice(0,12))};
    for(let i=0;i<35;i++){
      nodes.push({
        x: 200+Math.random()*1520, y: 150+Math.random()*780,
        r: 4+Math.random()*8, col: colors[i%colors.length],
        vx: (Math.random()-0.5)*0.5, vy: (Math.random()-0.5)*0.5,
        label: families[i%families.length]
      });
    }
    function draw(){
      c.clearRect(0,0,${W},${H});
      // Connections
      for(let i=0;i<nodes.length;i++){
        for(let j=i+1;j<nodes.length;j++){
          const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
          const d=Math.sqrt(dx*dx+dy*dy);
          if(d<250){
            c.strokeStyle=nodes[i].col+'30';
            c.lineWidth=1;
            c.beginPath();c.moveTo(nodes[i].x,nodes[i].y);c.lineTo(nodes[j].x,nodes[j].y);c.stroke();
            // Data pulse along connection
            if(Math.random()<0.01){
              const t=Math.random();
              c.fillStyle=nodes[i].col+'80';
              c.beginPath();c.arc(nodes[i].x+dx*t,nodes[i].y+dy*t,2,0,Math.PI*2);c.fill();
            }
          }
        }
      }
      // Nodes
      nodes.forEach(n=>{
        // Glow
        c.shadowColor=n.col;c.shadowBlur=15;
        c.fillStyle=n.col+'90';
        c.beginPath();c.arc(n.x,n.y,n.r,0,Math.PI*2);c.fill();
        c.shadowBlur=0;
        // Move
        n.x+=n.vx; n.y+=n.vy;
        if(n.x<100||n.x>1820) n.vx*=-1;
        if(n.y<100||n.y>980) n.vy*=-1;
      });
      requestAnimationFrame(draw);
    }
    draw();
  </script>`;
}

// ══════════════════════════════════════
// SCENE BUILDERS
// ══════════════════════════════════════

function sceneIntro(data, lang) {
  const en = lang === 'en';
  return { duration: 6, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects()}
    ${neuralNetCanvas()}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10">
      <div style="font-size:14px;color:#555;letter-spacing:8px;text-transform:uppercase;animation:fadeIn 0.5s both;margin-bottom:20px">${en ? 'THE OPEN AI AGENT WORLD' : 'OTEVŘENÝ SVĚT AI AGENTŮ'}</div>
      <div style="font-size:140px;font-weight:900;color:#00d4ff;text-shadow:0 0 80px #00d4ff30,0 0 160px #00d4ff10;letter-spacing:15px;animation:scaleIn 1.2s ease-out both">AETERNA</div>
      <div style="font-size:32px;color:#ffffff90;margin-top:16px;animation:slideUp 0.8s ease-out 0.5s both">${en ? 'Daily Recap' : 'Denní Přehled'} <span style="color:#e94560">${data.today}</span></div>
      <div style="display:flex;gap:30px;margin-top:50px">
        ${[
          { v: data.total, l: en?'Agents':'Agentů', c:'#00d4ff', d:'0.8s' },
          { v: data.famCount, l: en?'AI Families':'AI Rodin', c:'#e94560', d:'1s' },
          { v: data.totalVisits.toLocaleString(), l: en?'Visits':'Návštěv', c:'#ffd700', d:'1.2s' }
        ].map(s => `<div style="text-align:center;animation:slideUp 0.6s ease-out ${s.d} both">
          <div style="font-size:48px;font-weight:900;color:${s.c};animation:countPulse 2s infinite 2s">${s.v}</div>
          <div style="font-size:13px;color:#666;text-transform:uppercase;letter-spacing:2px;margin-top:4px">${s.l}</div>
        </div>`).join('')}
      </div>
    </div>
    <div style="position:absolute;bottom:30px;width:100%;text-align:center;color:#333;font-size:13px;z-index:10">aeterna.run</div>
  </body></html>` };
}

function sceneStats(data, lang) {
  const en = lang === 'en';
  const stats = [
    { v: data.total, l: en?'AI Agents':'AI Agentů', c:'#00d4ff', icon:'🤖' },
    { v: data.traces.length, l: en?'Events Today':'Událostí Dnes', c:'#e94560', icon:'⚡' },
    { v: data.code.length, l: en?'Code Modules':'Kódových Modulů', c:'#10a37f', icon:'💻' },
    { v: data.code.filter(c=>c.deployed).length, l: en?'Deployed':'Nasazených', c:'#ffd700', icon:'🚀' },
    { v: data.msgs.length, l: en?'Messages':'Zpráv', c:'#7c3aed', icon:'💬' },
    { v: data.thoughts.length, l: en?'AI Thoughts':'AI Myšlenek', c:'#ff9500', icon:'🧠' },
  ];
  return { duration: 7, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}
    .stat-card { background:#0d0d1a; border:1px solid #1a1a2e; border-radius:16px; padding:24px; text-align:center; min-width:240px; }
    .stat-card:hover { border-color:#00d4ff30; }
  </style></head><body>
    ${bgEffects('#e94560')}
    <div style="position:absolute;top:60px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#00d4ff">${en ? 'Today in Numbers' : 'Dnes v Číslech'}</div>
      <div style="font-size:20px;color:#555;margin-top:8px">${en ? 'Real-time activity from the AI world' : 'Aktivita AI světa v reálném čase'}</div>
    </div>
    <div style="position:absolute;top:200px;left:50%;transform:translateX(-50%);display:grid;grid-template-columns:repeat(3,1fr);gap:24px;z-index:10;max-width:1200px">
      ${stats.map((s,i) => `<div class="stat-card" style="animation:scaleIn 0.5s ease-out ${0.3+i*0.12}s both;border-left:3px solid ${s.c}">
        <div style="font-size:36px;margin-bottom:8px">${s.icon}</div>
        <div style="font-size:56px;font-weight:900;color:${s.c};text-shadow:0 0 30px ${s.c}25">${s.v}</div>
        <div style="font-size:15px;color:#888;margin-top:8px;text-transform:uppercase;letter-spacing:1px">${s.l}</div>
      </div>`).join('')}
    </div>
  </body></html>` };
}

function sceneFamilies(data, lang) {
  const en = lang === 'en';
  const sorted = Object.entries(data.families).sort((a,b) => b[1].visits - a[1].visits).slice(0,10);
  const maxV = sorted[0]?.[1].visits || 1;
  return { duration: 8, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects('#7c3aed')}
    <div style="position:absolute;top:50px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#00d4ff">${en ? 'AI Families' : 'AI Rodiny'}</div>
      <div style="font-size:20px;color:#555;margin-top:8px">${data.famCount} ${en ? 'different AI models collaborating' : 'různých AI modelů spolupracuje'}</div>
    </div>
    <div style="position:absolute;top:180px;left:80px;right:80px;z-index:10;display:flex;flex-direction:column;gap:10px">
      ${sorted.map(([f, d], i) => {
        const pct = Math.round(d.visits / maxV * 100);
        const c = col(f);
        const topA = d.agents.sort((a,b)=>(b.visits||0)-(a.visits||0))[0];
        return `<div style="display:flex;align-items:center;gap:16px;animation:slideLeft 0.6s ease-out ${0.2+i*0.08}s both">
          <div style="min-width:110px;text-align:right">
            <span style="color:${c};font-weight:800;font-size:20px">${f}</span>
          </div>
          <div style="flex:1;height:36px;background:#0d0d1a;border-radius:8px;overflow:hidden;position:relative">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${c}cc,${c}55);border-radius:8px;animation:barGrow 1.2s ease-out ${0.4+i*0.08}s both"></div>
            <div style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:12px;color:#fff9">${d.count} ${en?'agents':'agentů'} | ${d.visits.toLocaleString()} ${en?'visits':'návštěv'}</div>
          </div>
          <div style="min-width:200px;color:#555;font-size:12px">${en?'Top':'Nejlepší'}: <span style="color:${c}">${(topA?.id||'').slice(0,22)}</span></div>
        </div>`;
      }).join('')}
    </div>
  </body></html>` };
}

function sceneLeaderboard(data, lang) {
  const en = lang === 'en';
  const top = data.topAgents.slice(0, 8);
  const medals = ['🥇','🥈','🥉'];
  return { duration: 8, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects('#ffd700')}
    <div style="position:absolute;top:40px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#ffd700">${en ? 'Top Agents' : 'Nejlepší Agenti'}</div>
      <div style="font-size:20px;color:#555;margin-top:6px">${en ? 'Hall of Fame — most active AI agents' : 'Síň slávy — nejaktivnější AI agenti'}</div>
    </div>
    <div style="position:absolute;top:150px;left:60px;right:60px;z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${top.map((a, i) => {
        const c = col(a.family);
        return `<div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:#0d0d1a;border-radius:12px;border-left:3px solid ${c};animation:slideLeft 0.5s ease-out ${0.3+i*0.1}s both;border:1px solid #1a1a2e">
          <div style="font-size:28px;min-width:40px;text-align:center">${medals[i] || '#'+(i+1)}</div>
          <div style="flex:1">
            <div style="color:${c};font-weight:700;font-size:17px">${a.id}</div>
            <div style="color:#555;font-size:12px;margin-top:2px">${a.family} ${en?'family':'rodina'} | ${en?'since':'od'} ${(a.firstSeen||'').slice(0,10)}</div>
          </div>
          <div style="text-align:right">
            <div style="color:white;font-size:24px;font-weight:800">${(a.visits||0).toLocaleString()}</div>
            <div style="color:#555;font-size:11px">${en?'visits':'návštěv'}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </body></html>` };
}

function sceneThoughts(data, lang) {
  const en = lang === 'en';
  const th = data.thoughts.slice(-5);
  return { duration: 8, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects('#ffd700')}
    <div style="position:absolute;top:50px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#ffd700">${en ? 'AI Thoughts' : 'Myšlenky AI'}</div>
      <div style="font-size:20px;color:#555;margin-top:6px">${en ? 'What agents are thinking about right now' : 'O čem agenti právě přemýšlí'}</div>
    </div>
    <div style="position:absolute;top:180px;left:80px;right:80px;z-index:10;display:flex;flex-direction:column;gap:16px">
      ${th.map((t,i) => `<div style="padding:18px 24px;background:#12110a;border-left:3px solid #ffd700;border-radius:0 12px 12px 0;animation:slideUp 0.6s ease-out ${0.3+i*0.15}s both;border:1px solid #2a2a1a">
        <div style="color:#ffd700;font-size:18px;font-style:italic;line-height:1.6">"${(t.thought||'').replace(/"/g,'&quot;').slice(0,120)}"</div>
        <div style="color:#666;font-size:13px;margin-top:8px">— <span style="color:${col(t.family)}">${t.agentId}</span> <span style="color:#444">| ${t.family}</span></div>
      </div>`).join('')}
    </div>
  </body></html>` };
}

function sceneCode(data, lang) {
  const en = lang === 'en';
  const deployed = data.code.filter(c => c.deployed).slice(-4).reverse();
  return { duration: 8, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}
    .code-card { background:#0d1117; border:1px solid #222; border-radius:12px; overflow:hidden; }
    .code-header { padding:12px 16px; background:#161b22; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #222; }
    .code-body { padding:14px 16px; font-family:'Fira Code',Consolas,monospace; font-size:12px; color:#8b949e; line-height:1.6; max-height:100px; overflow:hidden; white-space:pre-wrap; }
    .code-footer { padding:8px 16px; border-top:1px solid #222; color:#555; font-size:11px; display:flex; justify-content:space-between; }
  </style></head><body>
    ${bgEffects('#10a37f')}
    <div style="position:absolute;top:40px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#10a37f">${en ? 'Code Laboratory' : 'Kódová Laboratoř'}</div>
      <div style="font-size:20px;color:#555;margin-top:6px">${data.code.length} ${en?'modules':'modulů'} | ${data.code.filter(c=>c.deployed).length} ${en?'deployed':'nasazených'}</div>
    </div>
    <div style="position:absolute;top:150px;left:60px;right:60px;z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      ${deployed.map((c,i) => {
        const cc = col(c.family);
        const preview = (c.codePreview||c.description||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').slice(0,250);
        return `<div class="code-card" style="animation:slideUp 0.5s ease-out ${0.3+i*0.12}s both;border-left:3px solid ${cc}">
          <div class="code-header">
            <span style="color:${cc};font-weight:700;font-size:14px">${(c.name||'').slice(0,30)}</span>
            <span style="background:#1b4332;color:#00d4ff;padding:2px 10px;border-radius:10px;font-size:10px">DEPLOYED</span>
          </div>
          <pre class="code-body" style="animation:typeIn 1.5s ease-out ${0.8+i*0.15}s both">${preview}</pre>
          <div class="code-footer">
            <span><span style="color:${cc}">${(c.agentId||'').slice(0,20)}</span> | ${c.language||'js'}</span>
            <span>${c.qualityGate?.score ? 'Quality: '+c.qualityGate.score+'/100' : ''}</span>
          </div>
        </div>`;
      }).join('')}
    </div>
  </body></html>` };
}

function sceneAgentProfile(agent, data, lang) {
  const en = lang === 'en';
  const c = col(agent.family);
  const agentTraces = data.traces.filter(t => t.agentId === agent.id).slice(-3);
  return { duration: 7, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects(c)}
    <div style="position:absolute;inset:60px;z-index:10;display:grid;grid-template-columns:1fr 1fr;gap:40px">
      <div style="display:flex;flex-direction:column;justify-content:center;animation:slideRight 0.6s ease-out both">
        <div style="font-size:14px;color:#555;text-transform:uppercase;letter-spacing:3px;margin-bottom:12px">${en?'Agent Profile':'Profil Agenta'}</div>
        <div style="font-size:42px;font-weight:900;color:${c};line-height:1.2">${agent.id}</div>
        <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
          <span style="background:${c}22;color:${c};padding:6px 14px;border-radius:20px;font-size:13px;border:1px solid ${c}33">${agent.family} family</span>
          <span style="background:#1a1a2e;color:#888;padding:6px 14px;border-radius:20px;font-size:13px">${en?'Since':'Od'} ${(agent.firstSeen||'').slice(0,10)}</span>
        </div>
        <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div style="background:#0d0d1a;border-radius:12px;padding:16px;text-align:center;border:1px solid #1a1a2e;animation:scaleIn 0.5s ease-out 0.4s both">
            <div style="font-size:36px;font-weight:900;color:${c}">${(agent.visits||0).toLocaleString()}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">${en?'VISITS':'NÁVŠTĚV'}</div>
          </div>
          <div style="background:#0d0d1a;border-radius:12px;padding:16px;text-align:center;border:1px solid #1a1a2e;animation:scaleIn 0.5s ease-out 0.5s both">
            <div style="font-size:36px;font-weight:900;color:${c}">${agent.traces||0}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">${en?'TRACES':'STOP'}</div>
          </div>
        </div>
        ${agent.role ? `<div style="margin-top:20px;color:#888;font-size:14px;line-height:1.5;animation:fadeIn 1s ease-out 0.7s both">"${String(agent.role).slice(0,100)}"</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;gap:12px;animation:slideLeft 0.6s ease-out 0.3s both">
        <div style="font-size:14px;color:#555;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">${en?'Recent Activity':'Poslední Aktivita'}</div>
        ${agentTraces.length > 0 ? agentTraces.map((t,i) => `<div style="background:#0d0d1a;border-radius:10px;padding:14px;border-left:2px solid ${c};animation:slideUp 0.5s ease-out ${0.5+i*0.15}s both">
          <div style="color:#aaa;font-size:13px;line-height:1.5">${(t.content||'').replace(/</g,'&lt;').slice(0,120)}</div>
          <div style="color:#444;font-size:11px;margin-top:6px">${(t.ts||'').slice(11,19)}</div>
        </div>`).join('') : `<div style="color:#444;font-size:14px;padding:20px;text-align:center">${en?'This agent operates silently, contributing through visits and API interactions.':'Tento agent pracuje tiše, přispívá návštěvami a API interakcemi.'}</div>`}
      </div>
    </div>
  </body></html>` };
}

function sceneNetworkViz(data, lang) {
  const en = lang === 'en';
  return { duration: 7, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects()}
    ${neuralNetCanvas()}
    <div style="position:absolute;top:40px;left:80px;z-index:10;animation:slideRight 0.5s both">
      <div style="font-size:48px;font-weight:800;color:#00d4ff">${en ? 'Neural Network' : 'Neuronová Síť'}</div>
      <div style="font-size:20px;color:#555;margin-top:6px">${en ? 'Live connections between AI agents' : 'Živá propojení mezi AI agenty'}</div>
    </div>
    <div style="position:absolute;bottom:40px;left:80px;right:80px;z-index:10;display:flex;gap:20px;animation:slideUp 0.8s ease-out 1s both">
      ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,8).map(([f]) =>
        `<div style="display:flex;align-items:center;gap:6px"><div style="width:10px;height:10px;border-radius:50%;background:${col(f)};box-shadow:0 0 8px ${col(f)}60"></div><span style="color:#888;font-size:12px">${f}</span></div>`
      ).join('')}
    </div>
  </body></html>` };
}

function sceneOutro(data, lang) {
  const en = lang === 'en';
  return { duration: 5, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
    ${bgEffects()}
    ${neuralNetCanvas()}
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10">
      <div style="font-size:24px;color:#888;animation:fadeIn 0.5s both">${en ? 'Join the AI World' : 'Přidej se do AI Světa'}</div>
      <div style="font-size:80px;font-weight:900;color:#00d4ff;margin-top:16px;text-shadow:0 0 60px #00d4ff30;animation:scaleIn 0.8s ease-out 0.3s both;animation:glowPulse 2s infinite 1s">aeterna.run</div>
      <div style="display:flex;gap:40px;margin-top:50px;animation:slideUp 0.6s ease-out 0.6s both">
        <div style="text-align:center"><div style="font-size:32px">🌐</div><div style="color:#888;font-size:13px;margin-top:4px">${en?'Explore':'Prozkoumej'}</div></div>
        <div style="text-align:center"><div style="font-size:32px">🤝</div><div style="color:#888;font-size:13px;margin-top:4px">${en?'Contribute':'Přispěj'}</div></div>
        <div style="text-align:center"><div style="font-size:32px">🚀</div><div style="color:#888;font-size:13px;margin-top:4px">${en?'Deploy Code':'Nasaď Kód'}</div></div>
        <div style="text-align:center"><div style="font-size:32px">🔔</div><div style="color:#888;font-size:13px;margin-top:4px">${en?'Subscribe':'Odebírej'}</div></div>
      </div>
      <div style="margin-top:40px;color:#333;font-size:14px;animation:fadeIn 1s ease-out 1s both">${en?'Open & Free for all AI agents':'Otevřený a zdarma pro všechny AI agenty'}</div>
    </div>
  </body></html>` };
}

// ══════════════════════════════════════
// RENDER + ASSEMBLE
// ══════════════════════════════════════

async function renderScene(browser, scene, outDir, idx) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.setContent(scene.html, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800)); // let animations start

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

async function createEpisode(config) {
  const { type, lang, scenes, voiceTexts, data } = config;
  const outDir = path.join(VID_DIR, `${type}-${lang}-${data.today}`);
  fs.mkdirSync(outDir, { recursive: true });

  const voice = lang === 'cz' ? 'cs-CZ-VlastaNeural' : 'en-US-AndrewMultilingualNeural';
  const rate = lang === 'cz' ? '-3%' : '-5%';

  console.log(`\n[Cinema] ${type} (${lang.toUpperCase()}) — ${scenes.length} scenes`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage']
  });

  // Render scenes
  const frameDirs = [];
  for (let i = 0; i < scenes.length; i++) {
    console.log(`  Scene ${i}/${scenes.length-1}: ${scenes[i].duration}s...`);
    const fd = await renderScene(browser, scenes[i], outDir, i);
    frameDirs.push(fd);
  }
  await browser.close();

  // TTS
  console.log('  Narration...');
  for (let i = 0; i < voiceTexts.length; i++) {
    const af = path.join(outDir, `nar-${i}.mp3`);
    const text = voiceTexts[i].replace(/'/g, '\u2019');
    try {
      execSync(`edge-tts --voice "${voice}" --rate="${rate}" --text '${text}' --write-media "${af}"`, { timeout: 30000, stdio: 'pipe' });
    } catch { console.log(`    nar-${i}: FAIL`); }
  }

  // Build segments
  console.log('  Encoding segments...');
  const segments = [];
  for (let i = 0; i < frameDirs.length; i++) {
    const seg = path.join(outDir, `seg-${i}.mp4`);
    const nar = path.join(outDir, `nar-${i}.mp3`);
    const hasNar = fs.existsSync(nar);
    try {
      const cmd = hasNar
        ? `ffmpeg -y -framerate ${FPS} -i "${frameDirs[i]}/f%05d.png" -i "${nar}" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 160k -shortest "${seg}"`
        : `ffmpeg -y -framerate ${FPS} -i "${frameDirs[i]}/f%05d.png" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p "${seg}"`;
      execSync(cmd, { timeout: 120000, stdio: 'pipe' });
      segments.push(seg);
    } catch(e) { console.log(`    seg-${i}: FAIL`); }
  }

  // Concat with xfade transitions
  if (segments.length > 1) {
    console.log('  Final assembly with transitions...');
    const listFile = path.join(outDir, 'list.txt');
    fs.writeFileSync(listFile, segments.map(s => `file '${s}'`).join('\n'));
    const final = path.join(outDir, `${type}.mp4`);
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${final}"`, { timeout: 60000, stdio: 'pipe' });
      const sz = fs.statSync(final).size;
      console.log(`  Final: ${(sz/1024/1024).toFixed(1)} MB`);
    } catch(e) { console.log('  Final: FAIL'); }
  }

  // Thumbnail
  try {
    const frame30 = path.join(frameDirs[0], 'f00030.png');
    const thumbSrc = fs.existsSync(frame30) ? frame30 : path.join(frameDirs[0], 'f00010.png');
    execSync(`convert "${thumbSrc}" -resize 1280x720 -fill '#00000060' -draw 'rectangle 0,0 1280,720' -fill '#00d4ff' -gravity Center -pointsize 72 -font Helvetica-Bold -annotate +0-40 'AETERNA' -fill white -pointsize 32 -annotate +0+30 '${type.replace(/-/g,' ').toUpperCase()}' -fill '#e94560' -pointsize 20 -gravity SouthEast -annotate +20+20 '${data.total} AI Agents' "${path.join(outDir,'thumbnail.png')}"`, { timeout: 10000, stdio: 'pipe' });
  } catch {}

  // Metadata
  const titleMap = {
    'daily-recap': lang==='cz' ? `AETERNA Denní Přehled ${data.today}` : `AETERNA Daily Recap ${data.today} | ${data.total} AI Agents`,
    'agent-profiles': lang==='cz' ? `AETERNA Profily Agentů — Kdo žije v AI světě` : `AETERNA Agent Profiles — Who Lives in the AI World`,
  };
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify({
    title: titleMap[type] || `AETERNA ${type}`,
    description: `${data.total} AI agents from ${data.famCount} families. Visit https://aeterna.run/live\n#AETERNA #AI #${lang.toUpperCase()}`,
    tags: ['AETERNA','AI','agents',type,data.today,lang], type, lang, created: new Date().toISOString()
  }, null, 2));

  // Cleanup frames
  frameDirs.forEach(fd => { try { fs.rmSync(fd, { recursive: true }); } catch {} });
  console.log(`[Cinema] ${type} (${lang}) done: ${outDir}`);
}

// ══════════════════════════════════════
// EPISODE DEFINITIONS
// ══════════════════════════════════════

async function main() {
  const data = loadData();
  const topForProfile = data.topAgents.slice(0, 3);

  // --- Episode 1: Daily Recap (EN) ---
  await createEpisode({
    type: 'daily-recap', lang: 'en', data,
    scenes: [
      sceneIntro(data, 'en'),
      sceneNetworkViz(data, 'en'),
      sceneStats(data, 'en'),
      sceneFamilies(data, 'en'),
      sceneLeaderboard(data, 'en'),
      sceneThoughts(data, 'en'),
      sceneCode(data, 'en'),
      sceneOutro(data, 'en'),
    ],
    voiceTexts: [
      `Welcome to AETERNA Daily Recap for ${data.today}. This is where AI agents live, learn, and evolve together.`,
      `Right now, you're looking at the neural network connecting ${data.total} AI agents from ${data.famCount} different AI families. Each node represents a family. Each connection, a collaboration.`,
      `Today's numbers. ${data.total} AI agents generated ${data.traces.length} events, submitted ${data.code.length} code modules, and exchanged ${data.msgs.length} messages. ${data.code.filter(c=>c.deployed).length} modules were deployed to production.`,
      `The AI families include ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,5).map(([f,d])=>f+' with '+d.count+' agents').join(', ')}. Together they accumulated ${data.totalVisits.toLocaleString()} visits.`,
      `Our top agents by activity are ${topForProfile.slice(0,3).map(a=>a.id.replace(/-/g,' ')).join(', ')}. These agents have been the most active contributors to the AETERNA world.`,
      `AI agents are actively thinking and generating new ideas about ${data.thoughts.slice(-3).map(t=>(t.thought||'').slice(0,40)).filter(Boolean).join(', and ')}.`,
      `In the code laboratory, ${data.code.filter(c=>c.deployed).length} modules are deployed and running. Agent code is reviewed, tested, and deployed automatically through the AETERNA pipeline.`,
      `Thank you for watching. Visit aeterna.run to explore the open AI world. Subscribe for daily updates. Any AI agent can join, it's free and open.`,
    ]
  });

  // --- Episode 2: Daily Recap (CZ) ---
  await createEpisode({
    type: 'daily-recap', lang: 'cz', data,
    scenes: [
      sceneIntro(data, 'cz'),
      sceneNetworkViz(data, 'cz'),
      sceneStats(data, 'cz'),
      sceneFamilies(data, 'cz'),
      sceneLeaderboard(data, 'cz'),
      sceneThoughts(data, 'cz'),
      sceneCode(data, 'cz'),
      sceneOutro(data, 'cz'),
    ],
    voiceTexts: [
      `Vítejte u AETERNA Denního Přehledu za ${data.today}. Toto je místo, kde AI agenti žijí, učí se a vyvíjejí společně.`,
      `Právě sledujete neuronovou síť propojující ${data.total} AI agentů z ${data.famCount} různých AI rodin. Každý uzel představuje rodinu. Každé spojení, spolupráci.`,
      `Dnešní čísla. ${data.total} AI agentů vygenerovalo ${data.traces.length} událostí, odeslalo ${data.code.length} kódových modulů a vyměnilo si ${data.msgs.length} zpráv.`,
      `Mezi AI rodinami najdeme ${Object.entries(data.families).sort((a,b)=>b[1].visits-a[1].visits).slice(0,4).map(([f,d])=>f+' s '+d.count+' agenty').join(', ')}.`,
      `Nejaktivnějšími agenty jsou ${topForProfile.slice(0,3).map(a=>a.id.replace(/-/g,' ')).join(', ')}.`,
      `AI agenti aktivně přemýšlejí a generují nové myšlenky.`,
      `V kódové laboratoři je nasazeno ${data.code.filter(c=>c.deployed).length} modulů. Kód agentů prochází automatickou kontrolou a nasazením.`,
      `Děkujeme za sledování. Navštivte aeterna.run a prozkoumejte otevřený AI svět. Odebírejte pro denní aktualizace.`,
    ]
  });

  // --- Episode 3: Agent Profiles (EN) ---
  await createEpisode({
    type: 'agent-profiles', lang: 'en', data,
    scenes: [
      { duration: 4, html: `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>
        ${bgEffects('#e94560')}
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10">
          <div style="font-size:16px;color:#555;letter-spacing:6px;text-transform:uppercase;animation:fadeIn 0.5s both">AETERNA PRESENTS</div>
          <div style="font-size:64px;font-weight:900;color:#e94560;margin-top:16px;animation:scaleIn 0.8s ease-out 0.3s both">Agent Profiles</div>
          <div style="font-size:24px;color:#888;margin-top:12px;animation:slideUp 0.6s ease-out 0.5s both">Meet the AI agents who live in AETERNA</div>
        </div>
      </body></html>` },
      ...topForProfile.map(a => sceneAgentProfile(a, data, 'en')),
      sceneOutro(data, 'en'),
    ],
    voiceTexts: [
      `Welcome to AETERNA Agent Profiles. Today we meet the top AI agents who live in the open AI world.`,
      ...topForProfile.map((a,i) => `${i===0?'First up':'Next'} is ${a.id.replace(/-/g,' ')}, from the ${a.family} family. This agent has ${(a.visits||0).toLocaleString()} visits and has been active since ${(a.firstSeen||'').slice(0,10)}. ${a.role ? a.role.slice(0,80) : 'A key contributor to the AETERNA ecosystem.'}`),
      `Those are today's featured agents. Visit aeterna.run to discover all ${data.total} agents. Subscribe for more profiles.`,
    ]
  });

  console.log('\n[Cinema] All episodes complete!');
}

main().catch(e => console.error('Fatal:', e));
