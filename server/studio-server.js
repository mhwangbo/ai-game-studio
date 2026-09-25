#!/usr/bin/env node
/*
 * studio-server.js — local dashboard for the AI Game Studio.
 * Slack-like chat + Jira-like board + team roster + approvals + docs.
 *
 *   node studio-server.js --project <gameDir> [--port 4747]
 *
 * Binds 127.0.0.1 only. Pushes live updates via Server-Sent Events.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Studio, findProject, STATUSES, SKILL_DIR } = require('./studio.js');
const { UsageTracker } = require('./usage.js');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const studio = new Studio(findProject(arg('project')));
if (!studio.exists()) studio.init({});
const PORT = Number(arg('port', studio.config().port || 4747));
const UI = path.join(__dirname, 'ui', 'index.html');

// ------------------------------------------------------------ SSE
const clients = new Set();
let pending = new Set(); let timer = null;
function notify(kind) {
  pending.add(kind);
  if (timer) return;
  timer = setTimeout(() => {
    const data = JSON.stringify([...pending]);
    pending = new Set(); timer = null;
    for (const res of clients) res.write(`event: change\ndata: ${data}\n\n`);
  }, 250);
}
try {
  fs.watch(studio.dir, { recursive: true }, (_ev, file) => {
    if (!file || file.includes('.locks') || file.endsWith('.tmp')) return;
    const f = file.replace(/\\/g, '/');
    notify(f.startsWith('chat/') ? `chat:${path.basename(f, '.jsonl')}` : f.split('/')[0].replace('.json', ''));
  });
} catch (e) { console.error('fs.watch failed, falling back to polling', e.message); setInterval(() => notify('poll'), 3000); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000);

// Live activity + token usage from Claude Code transcripts (rescanned incrementally).
const tracker = new UsageTracker(studio);
let usage = { runs: [], totals: { total: 0, cost: 0 }, active: [] };
let usageSig = '';
function refreshUsage() {
  try {
    usage = tracker.refresh();
    const sig = JSON.stringify([usage.totals.total, usage.runs.map((r) => [r.id, r.state, r.lastActionTs])]);
    if (sig !== usageSig) { usageSig = sig; notify('usage'); }
    // Soft budget alerts (config.usageBudget in USD, API-list-price estimate).
    const cfg = studio.config();
    if (cfg.usageBudget > 0) {
      const pct = usage.totals.cost / cfg.usageBudget;
      const level = pct >= 1 ? 100 : pct >= 0.8 ? 80 : 0;
      if (level > (cfg.usageAlerted || 0)) {
        studio.setConfig({ usageAlerted: level });
        studio.post('studio-bot', 'production', `💸 Usage at ${Math.round(pct * 100)}% of budget ($${usage.totals.cost.toFixed(2)} / $${cfg.usageBudget}). @Boss @producer ${level === 100 ? 'budget exceeded — producer: pause new spawns and ask Boss.' : 'heads-up.'}`, { kind: 'usage', role: 'system' });
      }
    }
  } catch (e) { console.error('usage scan failed:', e.message); }
}
refreshUsage();
setInterval(refreshUsage, 5000);

// ------------------------------------------------------------ helpers
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}
function docs() {
  const list = [];
  const add = (name, file) => { if (fs.existsSync(file)) list.push({ name, file }); };
  try { for (const f of fs.readdirSync(studio.p('docs'))) if (/\.(md|txt)$/i.test(f)) add(f, studio.p('docs', f)); } catch {}
  add('decisions.md', studio.p('decisions.md'));
  add('project lessons.md', studio.p('lessons.md'));
  add('STUDIO LESSONS (skill)', path.join(SKILL_DIR, 'lessons', 'LESSONS.md'));
  return list;
}
function state() {
  const unreadBase = {};
  for (const c of studio.channels()) {
    const ms = studio.read(c, { limit: 1 });
    unreadBase[c] = ms.length ? ms[ms.length - 1].ts : 0;
  }
  return {
    config: studio.config(),
    control: studio.control(),
    channels: studio.channels(),
    lastTs: unreadBase,
    tickets: studio.listTickets({}),
    workers: studio.workers(),
    approvals: studio.readJSON('approvals.json', []),
    epics: studio.readJSON('epics.json', []),
    milestones: studio.readJSON('milestones.json', []),
    docs: docs().map((d) => d.name),
    usage,
    statuses: STATUSES,
    now: Date.now(),
  };
}

// ------------------------------------------------------------ routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') return send(res, 200, fs.readFileSync(UI, 'utf8'), 'text/html; charset=utf-8');
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state') return send(res, 200, state());
    if (p === '/api/messages' && req.method === 'GET') {
      const ch = url.searchParams.get('channel');
      const ticket = url.searchParams.get('ticket');
      if (ticket) {
        const re = new RegExp(`\\b${ticket.replace(/[^A-Z0-9-]/gi, '')}\\b`, 'i');
        return send(res, 200, studio.readAll({}).filter((m) => m.ticket === ticket || re.test(m.text)).slice(-200));
      }
      return send(res, 200, studio.read(ch || 'general', { limit: Number(url.searchParams.get('limit')) || 400 }));
    }
    if (p === '/api/messages' && req.method === 'POST') {
      const b = await body(req);
      if (!b.text || !String(b.text).trim()) return send(res, 400, { error: 'empty' });
      const m = studio.post('Boss', b.channel || 'general', b.text, { ticket: b.ticket, role: 'boss' });
      return send(res, 200, m);
    }
    if (p === '/api/tickets' && req.method === 'POST') {
      const b = await body(req);
      return send(res, 200, studio.newTicket(b, 'Boss'));
    }
    const tm = p.match(/^\/api\/tickets\/([A-Za-z0-9-]+)(\/(\w+))?$/);
    if (tm) {
      const id = tm[1].toUpperCase(); const action = tm[3];
      const b = req.method === 'GET' ? {} : await body(req);
      if (req.method === 'GET') return send(res, 200, studio.getTicket(id));
      if (action === 'move') return send(res, 200, studio.moveTicket(id, b.status, 'Boss', b.note || ''));
      if (action === 'comment') {
        const t = studio.commentTicket(id, b.text, 'Boss');
        studio.post('Boss', b.channel || 'production', `💬 on ${id}: ${b.text}`, { ticket: id, role: 'boss' });
        return send(res, 200, t);
      }
      if (action === 'check') return send(res, 200, studio.checkTicket(id, String(b.index), 'Boss', !!b.done));
      return send(res, 200, studio.updateTicket(id, b, 'Boss'));
    }
    if (p === '/api/control' && req.method === 'POST') {
      const b = await body(req);
      if (b.state) return send(res, 200, studio.setControl(b.state, 'Boss'));
      if (b.playtest) {
        return send(res, 200, studio.addDirective('PLAYTEST REQUESTED: build team produce a runnable build of current main now; producer post run instructions in #build and wait for Boss feedback.', 'all', 'Boss', 'playtest'));
      }
      if (b.directive) return send(res, 200, studio.addDirective(b.directive, b.to || 'all', 'Boss'));
      return send(res, 400, { error: 'state|playtest|directive required' });
    }
    const am = p.match(/^\/api\/approvals\/(A\d+)$/);
    if (am && req.method === 'POST') {
      const b = await body(req);
      return send(res, 200, studio.resolveApproval(am[1], b.status, b.note || '', 'Boss'));
    }
    if (p === '/api/doc') {
      const d = docs().find((x) => x.name === url.searchParams.get('name'));
      return d ? send(res, 200, fs.readFileSync(d.file, 'utf8'), 'text/plain; charset=utf-8') : send(res, 404, 'not found', 'text/plain');
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`port ${PORT} busy — studio server already running? open http://127.0.0.1:${PORT}`); process.exit(2); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🎮 Studio "${studio.config().name}" dashboard: http://127.0.0.1:${PORT}   (project ${studio.root})`);
});
