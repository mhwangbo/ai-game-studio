#!/usr/bin/env node
/*
 * studio.js — CLI + library for the AI Game Studio.
 * Every studio worker (agent) talks to studio state ONLY through this file.
 * State lives in <project>/.studio/ (JSON + JSONL, zero dependencies).
 *
 * Run `node studio.js help` for commands.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKILL_DIR = path.resolve(__dirname, '..');
const DEFAULT_CHANNELS = ['general', 'production', 'design', 'engineering', 'art', 'audio', 'qa', 'build', 'approvals', 'blockers'];
const STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'];
const TYPES = ['feature', 'bug', 'art', 'audio', 'design', 'chore', 'spike', 'build', 'qa'];
const TEAM_CHANNEL = {
  production: 'production', design: 'design', narrative: 'design', engineering: 'engineering',
  art: 'art', audio: 'audio', qa: 'qa', build: 'build',
};
const LOOP_THRESHOLD = 3;

// ---------------------------------------------------------------- helpers
const now = () => Date.now();
const rid = () => crypto.randomBytes(4).toString('hex');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const safeName = (s) => String(s).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, '-');
const hash = (s) => crypto.createHash('sha1').update(String(s).trim().toLowerCase().replace(/\d+/g, 'N')).digest('hex').slice(0, 10);

function findProject(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.STUDIO_PROJECT) return path.resolve(process.env.STUDIO_PROJECT);
  let d = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(d, '.studio', 'config.json'))) return d;
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return process.cwd();
}

class Studio {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, '.studio');
  }

  p(...parts) { return path.join(this.dir, ...parts); }
  exists() { return fs.existsSync(this.p('config.json')); }

  readJSON(rel, def) {
    try { return JSON.parse(fs.readFileSync(this.p(rel), 'utf8')); } catch { return def; }
  }

  writeJSON(rel, obj) {
    const f = this.p(rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${rid()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    for (let i = 0; i < 20; i++) {
      try { fs.renameSync(tmp, f); return; } catch (e) { sleepSync(25); } // Windows: target may be briefly locked by a reader
    }
    fs.writeFileSync(f, JSON.stringify(obj, null, 2));
    try { fs.unlinkSync(tmp); } catch {}
  }

  // Cross-process mutex via exclusive lock file. Stale locks (>10s) are broken.
  withLock(name, fn) {
    const lock = this.p('.locks', `${name}.lock`);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const start = now();
    for (;;) {
      try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; } catch {
        try { if (now() - fs.statSync(lock).mtimeMs > 10000) fs.unlinkSync(lock); } catch {}
        if (now() - start > 15000) throw new Error(`lock timeout: ${name}`);
        sleepSync(20 + Math.random() * 30);
      }
    }
    try { return fn(); } finally { try { fs.unlinkSync(lock); } catch {} }
  }

  // ------------------------------------------------------------ init/config
  init(opts = {}) {
    fs.mkdirSync(this.p('tickets'), { recursive: true });
    fs.mkdirSync(this.p('chat'), { recursive: true });
    fs.mkdirSync(this.p('docs'), { recursive: true });
    if (!this.exists()) {
      const tpl = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'templates', 'studio.config.json'), 'utf8'));
      const cfg = Object.assign(tpl, {
        name: opts.name || path.basename(this.root),
        key: (opts.key || (opts.name || path.basename(this.root)).replace(/[^A-Za-z]/g, '').slice(0, 4) || 'GAME').toUpperCase(),
        engine: opts.engine || tpl.engine,
        tier: opts.tier || tpl.tier,
        created: now(),
      });
      this.writeJSON('config.json', cfg);
      this.writeJSON('control.json', { state: 'running', updated: now(), directives: [] });
      this.writeJSON('workers.json', {});
      this.writeJSON('approvals.json', []);
      this.writeJSON('epics.json', []);
      this.writeJSON('milestones.json', []);
      fs.writeFileSync(this.p('decisions.md'), `# Decision Log — ${cfg.name}\n\nAppend-only. Newest at bottom. Do not re-litigate without Boss approval.\n`);
      this.post('studio-bot', 'general', `Studio opened for **${cfg.name}** (engine: ${cfg.engine}, tier: ${cfg.tier}). Ticket key: ${cfg.key}.`, { role: 'system' });
    }
    return this.config();
  }

  config() { return this.readJSON('config.json', {}); }
  setConfig(patch) {
    return this.withLock('config', () => {
      const c = Object.assign(this.config(), patch);
      this.writeJSON('config.json', c);
      return c;
    });
  }

  // ------------------------------------------------------------ chat
  channels() {
    const set = new Set(DEFAULT_CHANNELS);
    try { for (const f of fs.readdirSync(this.p('chat'))) if (f.endsWith('.jsonl')) set.add(f.slice(0, -6)); } catch {}
    return [...set];
  }

  post(from, channel, text, extra = {}) {
    const ch = safeName(channel);
    const msg = { id: `${now()}-${rid()}`, ts: now(), from, role: extra.role || '', channel: ch, text: String(text) };
    if (extra.ticket) msg.ticket = extra.ticket;
    if (extra.kind) msg.kind = extra.kind;
    fs.mkdirSync(this.p('chat'), { recursive: true });
    fs.appendFileSync(this.p('chat', `${ch}.jsonl`), JSON.stringify(msg) + '\n');
    return msg;
  }

  read(channel, { since = 0, limit = 50 } = {}) {
    let lines = [];
    try { lines = fs.readFileSync(this.p('chat', `${safeName(channel)}.jsonl`), 'utf8').split('\n'); } catch {}
    const out = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try { const m = JSON.parse(l); if (m.ts > since) out.push(m); } catch {}
    }
    return limit ? out.slice(-limit) : out;
  }

  readAll({ since = 0 } = {}) {
    return this.channels().flatMap((c) => this.read(c, { since, limit: 0 })).sort((a, b) => a.ts - b.ts);
  }

  // ------------------------------------------------------------ tickets
  ticketPath(id) { return this.p('tickets', `${id}.json`); }
  getTicket(id) {
    try { return JSON.parse(fs.readFileSync(this.ticketPath(String(id).toUpperCase()), 'utf8')); } catch { return null; }
  }
  saveTicket(t) { t.updated = now(); this.writeJSON(path.join('tickets', `${t.id}.json`), t); return t; }

  listTickets(filter = {}) {
    let files = [];
    try { files = fs.readdirSync(this.p('tickets')).filter((f) => f.endsWith('.json')); } catch {}
    let ts = files.map((f) => { try { return JSON.parse(fs.readFileSync(this.p('tickets', f), 'utf8')); } catch { return null; } }).filter(Boolean);
    for (const k of ['status', 'team', 'assignee', 'epic', 'type', 'milestone']) {
      if (filter[k]) { const vals = String(filter[k]).split(','); ts = ts.filter((t) => vals.includes(String(t[k]))); }
    }
    if (filter.ready) {
      const done = new Set(ts.filter((t) => t.status === 'done').map((t) => t.id));
      const all = this.listTickets({});
      for (const t of all) if (t.status === 'done') done.add(t.id);
      ts = ts.filter((t) => t.status === 'todo' && (t.deps || []).every((d) => done.has(d)));
    }
    const pr = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return ts.sort((a, b) => (pr[a.priority] ?? 9) - (pr[b.priority] ?? 9) || a.num - b.num);
  }

  newTicket(fields, by = 'producer') {
    const num = this.withLock('config', () => {
      const c = this.config();
      c.nextTicket = (c.nextTicket || 1);
      const n = c.nextTicket++;
      this.writeJSON('config.json', c);
      return n;
    });
    const key = this.config().key || 'GAME';
    const acceptance = (fields.acceptance || []).map((a) => (typeof a === 'string' ? { text: a, done: false } : a));
    const t = {
      id: `${key}-${num}`, num,
      title: fields.title || 'Untitled',
      type: fields.type || 'feature',
      epic: fields.epic || '',
      milestone: fields.milestone || '',
      team: fields.team || 'engineering',
      assignee: fields.assignee || '',
      status: STATUSES.includes(fields.status) ? fields.status : 'todo',
      priority: fields.priority || 'P2',
      desc: fields.desc || '',
      acceptance,
      deps: fields.deps || [],
      links: fields.links || [],
      comments: [],
      history: [{ ts: now(), by, what: 'created' }],
      rejects: 0,
      created: now(),
    };
    this.saveTicket(t);
    this.post(by, TEAM_CHANNEL[t.team] || 'production', `🎫 created ${t.id} [${t.priority}] ${t.title}${t.assignee ? ` → @${t.assignee}` : ''}`, { ticket: t.id, kind: 'ticket', role: 'bot' });
    return t;
  }

  updateTicket(id, patch, by = 'unknown') {
    return this.withLock(`ticket-${id}`, () => {
      const t = this.getTicket(id);
      if (!t) throw new Error(`no ticket ${id}`);
      const changes = [];
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || k === 'id' || k === 'status') continue;
        if (JSON.stringify(t[k]) !== JSON.stringify(v)) { changes.push(`${k}`); t[k] = v; }
      }
      if (changes.length) t.history.push({ ts: now(), by, what: `updated ${changes.join(', ')}` });
      return this.saveTicket(t);
    });
  }

  moveTicket(id, status, by = 'unknown', note = '') {
    if (!STATUSES.includes(status)) throw new Error(`bad status ${status}; use ${STATUSES.join('|')}`);
    let loop = false;
    const t = this.withLock(`ticket-${id}`, () => {
      const t = this.getTicket(id);
      if (!t) throw new Error(`no ticket ${id}`);
      const from = t.status;
      if (from === status) return t;
      if (from === 'review' && (status === 'in_progress' || status === 'todo')) {
        t.rejects = (t.rejects || 0) + 1;
        if (t.rejects >= LOOP_THRESHOLD) loop = true;
      }
      if (status === 'done' && (t.acceptance || []).some((a) => !a.done)) {
        const open = t.acceptance.filter((a) => !a.done).map((a) => a.text);
        throw new Error(`cannot close ${id}: acceptance criteria not checked: ${open.join(' | ')}  (use: ticket check ${id} <n|all>)`);
      }
      t.status = status;
      t.history.push({ ts: now(), by, what: `${from} → ${status}${note ? `: ${note}` : ''}` });
      return this.saveTicket(t);
    });
    const icon = { done: '✅', review: '👀', blocked: '⛔', in_progress: '🔨', todo: '📋', backlog: '🗃️' }[status];
    this.post(by, TEAM_CHANNEL[t.team] || 'production', `${icon} ${t.id} → ${status}${note ? ` — ${note}` : ''}`, { ticket: t.id, kind: 'ticket', role: 'bot' });
    if (status === 'blocked') this.post(by, 'blockers', `⛔ ${t.id} ${t.title} blocked: ${note || '(no reason given)'}`, { ticket: t.id, kind: 'blocker' });
    if (loop) this.flagLoop(t.id, `${t.id} rejected in review ${t.rejects}x — approach is not converging. Producer must re-plan or escalate to Boss.`);
    return t;
  }

  commentTicket(id, text, by) {
    return this.withLock(`ticket-${id}`, () => {
      const t = this.getTicket(id);
      if (!t) throw new Error(`no ticket ${id}`);
      t.comments.push({ ts: now(), by, text });
      return this.saveTicket(t);
    });
  }

  checkTicket(id, which, by, done = true) {
    return this.withLock(`ticket-${id}`, () => {
      const t = this.getTicket(id);
      if (!t) throw new Error(`no ticket ${id}`);
      const idxs = which === 'all' ? t.acceptance.map((_, i) => i) : String(which).split(',').map(Number);
      for (const i of idxs) if (t.acceptance[i]) t.acceptance[i].done = done;
      t.history.push({ ts: now(), by, what: `${done ? 'checked' : 'unchecked'} AC ${idxs.join(',')}` });
      return this.saveTicket(t);
    });
  }

  flagLoop(ticket, text) {
    this.post('studio-bot', 'blockers', `🔁 LOOP DETECTED: ${text}`, { ticket, kind: 'loop', role: 'system' });
  }

  // ------------------------------------------------------------ epics / milestones
  addEpic(name, milestone = '', goal = '') {
    return this.withLock('epics', () => {
      const es = this.readJSON('epics.json', []);
      const e = { id: `E${es.length + 1}`, name, milestone, goal, created: now() };
      es.push(e);
      this.writeJSON('epics.json', es);
      return e;
    });
  }
  addMilestone(name, goal = '') {
    return this.withLock('milestones', () => {
      const ms = this.readJSON('milestones.json', []);
      const m = { id: `M${ms.length + 1}`, name, goal, status: ms.length ? 'planned' : 'active', created: now() };
      ms.push(m);
      this.writeJSON('milestones.json', ms);
      return m;
    });
  }
  setMilestone(id, status) {
    return this.withLock('milestones', () => {
      const ms = this.readJSON('milestones.json', []);
      const m = ms.find((x) => x.id === id);
      if (!m) throw new Error(`no milestone ${id}`);
      m.status = status;
      this.writeJSON('milestones.json', ms);
      return m;
    });
  }

  // ------------------------------------------------------------ control
  control() { return this.readJSON('control.json', { state: 'running', directives: [] }); }
  setControl(state, by = 'Boss') {
    const c = this.withLock('control', () => {
      const c = this.control();
      c.state = state; c.updated = now(); c.by = by;
      this.writeJSON('control.json', c);
      return c;
    });
    this.post(by, 'general', { paused: '⏸️ STUDIO PAUSED — all workers: save notes to your ticket, ack, and stop.', stopped: '🛑 STUDIO STOPPED — all workers stop now.', running: '▶️ Studio resumed.' }[state] || `state: ${state}`, { kind: 'control', role: 'boss' });
    return c;
  }
  addDirective(text, to = 'all', by = 'Boss', kind = 'directive') {
    const d = { id: `D${now()}`, ts: now(), text, to, by, kind };
    this.withLock('control', () => {
      const c = this.control();
      c.directives = (c.directives || []).concat(d).slice(-100);
      c.updated = now();
      this.writeJSON('control.json', c);
    });
    this.post(by, 'general', `📣 DIRECTIVE${to !== 'all' ? ` for @${to}` : ''}: ${text}`, { kind: 'directive', role: 'boss' });
    return d;
  }

  // ------------------------------------------------------------ workers / pulse
  workers() { return this.readJSON('workers.json', {}); }

  /**
   * Heartbeat + inbox. Workers call this before starting and between steps.
   * Returns control state, directives, @mentions and Boss messages since last pulse,
   * resolved approvals, and loop warnings.
   */
  pulse(name, opts = {}) {
    let since = 0; let loopHit = null; let w;
    this.withLock('workers', () => {
      const ws = this.workers();
      w = ws[name] || { name, joined: now(), errors: {} };
      since = w.lastPulse || 0;
      for (const k of ['role', 'team', 'ticket', 'status']) if (opts[k] !== undefined) w[k] = opts[k];
      if (opts.state) w.state = opts.state; else if (!w.state || w.state === 'idle') w.state = 'working';
      w.lastPulse = now();
      if (opts.error) {
        const h = hash(opts.error);
        w.errors = w.errors || {};
        w.errors[h] = (w.errors[h] || 0) + 1;
        if (w.errors[h] === LOOP_THRESHOLD) loopHit = opts.error;
      }
      ws[name] = w;
      this.writeJSON('workers.json', ws);
    });
    if (loopHit) this.flagLoop(w.ticket || '', `@${name} hit the same error ${LOOP_THRESHOLD}x: "${String(loopHit).slice(0, 200)}". Stop retrying; post in #blockers and try a different approach.`);

    const ctl = this.control();
    const me = new Set([name, w.role, w.team, 'all', 'everyone', 'here'].filter(Boolean).map((s) => s.toLowerCase()));
    const directives = (ctl.directives || []).filter((d) => (since ? d.ts > since : true) && me.has(String(d.to).toLowerCase())).slice(since ? 0 : -5);
    const inbox = [];
    if (since) {
      const myCh = new Set(['general', TEAM_CHANNEL[w.team] || '', `dm-${safeName(name)}`]);
      for (const m of this.readAll({ since })) {
        if (m.from === name) continue;
        const mentions = [...m.text.matchAll(/@([\w-]+)/g)].map((x) => x[1].toLowerCase());
        const isBoss = String(m.from).toLowerCase() === 'boss' && m.kind !== 'control' && m.kind !== 'directive';
        if (mentions.some((x) => me.has(x)) || (isBoss && myCh.has(m.channel)) || m.channel === `dm-${safeName(name)}`) inbox.push(m);
      }
    }
    const approvals = this.readJSON('approvals.json', []).filter((a) => a.by === name && a.status !== 'pending' && a.resolved > since);
    return { worker: name, state: ctl.state, directives, inbox, approvals, loop: !!loopHit };
  }

  setWorkerState(name, state, status) {
    this.withLock('workers', () => {
      const ws = this.workers();
      if (!ws[name]) ws[name] = { name, joined: now() };
      ws[name].state = state;
      if (status) ws[name].status = status;
      ws[name].lastPulse = now();
      this.writeJSON('workers.json', ws);
    });
  }

  // ------------------------------------------------------------ approvals
  requestApproval({ what, cost = 0, why = '', kind = 'spend', by = 'unknown', ticket = '' }) {
    const a = this.withLock('approvals', () => {
      const as = this.readJSON('approvals.json', []);
      const a = { id: `A${as.length + 1}`, ts: now(), what, cost: Number(cost) || 0, why, kind, by, ticket, status: 'pending' };
      as.push(a);
      this.writeJSON('approvals.json', as);
      return a;
    });
    this.post(by, 'approvals', `🙋 ${a.id} [${kind}${a.cost ? ` $${a.cost}` : ''}] ${what}${why ? ` — why: ${why}` : ''}  (@Boss approve in Approvals tab)`, { ticket, kind: 'approval' });
    return a;
  }
  resolveApproval(id, status, note = '', by = 'Boss') {
    const a = this.withLock('approvals', () => {
      const as = this.readJSON('approvals.json', []);
      const a = as.find((x) => x.id === id);
      if (!a) throw new Error(`no approval ${id}`);
      a.status = status; a.note = note; a.resolved = now(); a.resolvedBy = by;
      this.writeJSON('approvals.json', as);
      return a;
    });
    if (status === 'approved' && a.cost) this.setConfig({ spent: (this.config().spent || 0) + a.cost });
    this.post(by, 'approvals', `${status === 'approved' ? '✅' : '❌'} ${a.id} ${status}: ${a.what}${note ? ` — ${note}` : ''} @${a.by}`, { kind: 'approval', role: 'boss' });
    return a;
  }

  // ------------------------------------------------------------ decisions / lessons
  decide(text, by) {
    fs.appendFileSync(this.p('decisions.md'), `\n- ${new Date().toISOString().slice(0, 16)} **${by}**: ${text}\n`);
    this.post(by, 'general', `📌 DECISION: ${text}`, { kind: 'decision' });
  }

  addLesson({ area = 'process', symptom, cause = '', fix, by = 'unknown' }) {
    const line = `\n### ${new Date().toISOString().slice(0, 10)} [${area}] ${symptom}\n- cause: ${cause}\n- fix: ${fix}\n- by: ${by} (project: ${this.config().name || path.basename(this.root)})\n- status: NEW (fold into playbook at next retro)\n`;
    fs.appendFileSync(path.join(SKILL_DIR, 'lessons', 'LESSONS.md'), line);
    fs.appendFileSync(this.p('lessons.md'), line);
    this.post(by, 'blockers', `📚 lesson recorded [${area}]: ${symptom} → ${fix}`, { kind: 'lesson' });
  }

  // ------------------------------------------------------------ summaries
  board() {
    const ts = this.listTickets({});
    const by = Object.fromEntries(STATUSES.map((s) => [s, ts.filter((t) => t.status === s)]));
    const ws = Object.values(this.workers());
    const ms = this.readJSON('milestones.json', []);
    const ap = this.readJSON('approvals.json', []).filter((a) => a.status === 'pending');
    const c = this.config();
    const lines = [];
    lines.push(`== ${c.name} | engine ${c.engine} | tier ${c.tier} | state ${this.control().state} | spent $${c.spent || 0}/$${c.budget ?? 0} ==`);
    for (const m of ms) {
      const mt = ts.filter((t) => t.milestone === m.id);
      lines.push(`milestone ${m.id} ${m.name} [${m.status}] ${mt.filter((t) => t.status === 'done').length}/${mt.length} done`);
    }
    lines.push(STATUSES.map((s) => `${s}:${by[s].length}`).join('  '));
    for (const s of ['blocked', 'review', 'in_progress', 'todo']) {
      for (const t of by[s].slice(0, 15)) lines.push(`  [${s}] ${t.id} ${t.priority} ${t.team}${t.assignee ? '@' + t.assignee : ''}: ${t.title}${(t.deps || []).length ? ` (deps ${t.deps.join(',')})` : ''}`);
    }
    const ready = this.listTickets({ ready: true });
    lines.push(`ready now: ${ready.map((t) => t.id).join(', ') || '-'}`);
    lines.push(`workers: ${ws.map((w) => `${w.name}(${w.state || '?'}${w.ticket ? ' ' + w.ticket : ''}, ${Math.round((now() - (w.lastPulse || 0)) / 60000)}m)`).join(', ') || '-'}`);
    if (ap.length) lines.push(`PENDING APPROVALS: ${ap.map((a) => `${a.id} ${a.what}`).join('; ')}`);
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------- CLI
function parseArgs(argv) {
  const pos = []; const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nx = argv[i + 1];
      if (nx === undefined || nx.startsWith('--')) o[k] = true; else { o[k] = nx; i++; }
    } else pos.push(a);
  }
  return { pos, o };
}

const HELP = `studio.js — AI Game Studio CLI   (global flags: --project <dir>  --as <worker>  --json)

  init [--name N --key KEY --engine godot|unity|unreal|web --tier jam|mobile|indie|aa|aaa]
  config [--set key=value]
  board                                   compact status of the whole studio
  pulse --as NAME [--role R --team T --ticket K --status "doing X" --error "msg" --state working|idle|paused|done]
  post <#channel> "text" --as NAME [--ticket K]
  read <#channel> [--limit 30 --since ts]
  channels
  ticket new --title T [--team T --type feature --epic E1 --milestone M1 --priority P1 --assignee A
                        --accept "crit 1|crit 2" --deps K-1,K-2 --desc "..." --status todo|backlog]
  ticket list [--status s1,s2 --team T --assignee A --epic E --milestone M --ready]
  ticket show K
  ticket move K <backlog|todo|in_progress|review|blocked|done> [--note "..."]
  ticket assign K NAME
  ticket check K <n[,n]|all> [--undo]      acceptance criteria (0-based)
  ticket comment K "text"
  ticket link K <path-or-url>
  ticket update K [--title --desc --priority --team --epic --milestone --deps]
  epic new "name" [--milestone M1 --goal "..."]   |  epic list
  milestone new "name" [--goal "..."]  |  milestone list  |  milestone set M1 active|done|planned
  control [running|paused|stopped]        read or set studio state
  directive "text" [--to all|NAME|ROLE|TEAM]
  approval request "what" [--cost 0 --why ".." --kind spend|login|download|model --ticket K]
  approval list [--status pending]  |  approval resolve A1 approved|denied [--note ..]  |  approval show A1
  decide "decision text"
  who                                     live: which agent is active, on what ticket, last action (from transcripts)
  usage [--limit 10]                      tokens + $ estimate by team / worker / milestone / ticket
  lesson add --symptom "..." --fix "..." [--cause "..." --area engine|godot|unity|unreal|web|assets|comfyui|blender|process|tooling]
  wait-boss [--timeout 540]               blocks until Boss posts / control changes / approval resolves (Producer uses this)
`;

function fmtMsg(m) {
  const t = new Date(m.ts).toTimeString().slice(0, 5);
  return `[${t}] #${m.channel} ${m.from}${m.ticket ? ` (${m.ticket})` : ''}: ${m.text}`;
}

function fmtTicket(t) {
  const out = [`${t.id} [${t.status}] ${t.priority} ${t.type} team:${t.team} assignee:${t.assignee || '-'} epic:${t.epic || '-'} ms:${t.milestone || '-'}`,
    `title: ${t.title}`];
  if (t.desc) out.push(`desc: ${t.desc}`);
  if (t.deps && t.deps.length) out.push(`deps: ${t.deps.join(', ')}`);
  out.push('acceptance:');
  t.acceptance.forEach((a, i) => out.push(`  ${i}. [${a.done ? 'x' : ' '}] ${a.text}`));
  if (t.links && t.links.length) out.push(`links: ${t.links.join(' , ')}`);
  for (const c of (t.comments || []).slice(-8)) out.push(`  💬 ${c.by}: ${c.text}`);
  out.push(`history: ${(t.history || []).slice(-5).map((h) => `${h.by} ${h.what}`).join(' | ')}`);
  if (t.rejects) out.push(`review rejects: ${t.rejects}`);
  return out.join('\n');
}

async function main() {
  const { pos, o } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || o.help) { console.log(HELP); return; }
  const s = new Studio(findProject(o.project));
  const as = o.as || process.env.STUDIO_WORKER || 'producer';
  const out = (x, txt) => console.log(o.json ? JSON.stringify(x, null, 2) : (txt ?? (typeof x === 'string' ? x : JSON.stringify(x, null, 2))));

  if (cmd === 'init') { const c = s.init({ name: o.name, key: o.key, engine: o.engine, tier: o.tier }); return out(c, `studio ready at ${s.dir} (key ${c.key})`); }
  if (!s.exists()) throw new Error(`no .studio found from ${s.root}. Run: node studio.js init --project <dir>`);

  switch (cmd) {
    case 'config': {
      if (typeof o.set === 'string') { const [k, ...v] = o.set.split('='); let val = v.join('='); try { val = JSON.parse(val); } catch {} return out(s.setConfig({ [k]: val })); }
      return out(s.config());
    }
    case 'board': return out(s.board());
    case 'channels': return out(s.channels(), s.channels().map((c) => '#' + c).join(' '));
    case 'post': {
      const m = s.post(as, pos[1] || 'general', pos.slice(2).join(' '), { ticket: o.ticket, role: o.role || (s.workers()[as] || {}).role });
      return out(m, 'posted');
    }
    case 'read': {
      const ms = s.read(pos[1] || 'general', { since: Number(o.since) || 0, limit: Number(o.limit) || 30 });
      return out(ms, ms.map(fmtMsg).join('\n') || '(no messages)');
    }
    case 'pulse': {
      const r = s.pulse(as, { role: o.role, team: o.team, ticket: o.ticket, status: o.status, error: o.error, state: o.state });
      const lines = [`STATE: ${r.state.toUpperCase()}`];
      if (r.state === 'paused') lines.push('>> PAUSED: save progress notes to your ticket (ticket comment), post a short ack, then END your task and report "paused".');
      if (r.state === 'stopped') lines.push('>> STOPPED: stop immediately, post ack, end your task.');
      for (const d of r.directives) lines.push(`DIRECTIVE from ${d.by}: ${d.text}  (obey before continuing; ack in chat)`);
      for (const m of r.inbox) lines.push(`INBOX ${fmtMsg(m)}`);
      for (const a of r.approvals) lines.push(`APPROVAL ${a.id} ${a.status.toUpperCase()}: ${a.what}${a.note ? ' — ' + a.note : ''}`);
      if (r.loop) lines.push('>> LOOP: you repeated the same error 3x. Stop retrying. Post in #blockers, move ticket to blocked with the reason, and propose a different approach.');
      if (lines.length === 1) lines.push('no new messages — continue');
      return out(r, lines.join('\n'));
    }
    case 'ticket': {
      const sub = pos[1]; const id = pos[2] && pos[2].toUpperCase();
      if (sub === 'new') {
        const t = s.newTicket({
          title: o.title, team: o.team, type: o.type, epic: o.epic, milestone: o.milestone, priority: o.priority, assignee: o.assignee,
          acceptance: o.accept ? String(o.accept).split('|').map((x) => x.trim()).filter(Boolean) : [],
          deps: o.deps ? String(o.deps).split(',').map((x) => x.trim().toUpperCase()) : [], desc: o.desc, status: o.status,
        }, as);
        return out(t, `created ${t.id}`);
      }
      if (sub === 'list') {
        const ts = s.listTickets({ status: o.status, team: o.team, assignee: o.assignee === true ? as : o.assignee, epic: o.epic, milestone: o.milestone, type: o.type, ready: o.ready });
        return out(ts, ts.map((t) => `${t.id} [${t.status}] ${t.priority} ${t.team}${t.assignee ? '@' + t.assignee : ''} ${t.title} (AC ${t.acceptance.filter((a) => a.done).length}/${t.acceptance.length})`).join('\n') || '(none)');
      }
      if (!id) throw new Error('ticket id required');
      if (sub === 'show') { const t = s.getTicket(id); if (!t) throw new Error(`no ticket ${id}`); return out(t, fmtTicket(t)); }
      if (sub === 'move') { const t = s.moveTicket(id, pos[3], as, o.note || ''); return out(t, `${t.id} → ${t.status}`); }
      if (sub === 'assign') { const t = s.updateTicket(id, { assignee: pos[3] }, as); s.post(as, TEAM_CHANNEL[t.team] || 'production', `👤 ${t.id} assigned to @${pos[3]}`, { ticket: t.id, kind: 'ticket', role: 'bot' }); return out(t, `${t.id} assignee ${pos[3]}`); }
      if (sub === 'check') { const t = s.checkTicket(id, pos[3] ?? 'all', as, !o.undo); return out(t, fmtTicket(t)); }
      if (sub === 'comment') { const t = s.commentTicket(id, pos.slice(3).join(' '), as); return out(t, 'commented'); }
      if (sub === 'link') { const t0 = s.getTicket(id); const t = s.updateTicket(id, { links: [...(t0.links || []), pos[3]] }, as); return out(t, 'linked'); }
      if (sub === 'update') {
        const patch = {};
        for (const k of ['title', 'desc', 'priority', 'team', 'epic', 'milestone', 'type']) if (typeof o[k] === 'string') patch[k] = o[k];
        if (typeof o.deps === 'string') patch.deps = o.deps.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
        if (typeof o.accept === 'string') patch.acceptance = o.accept.split('|').map((x) => ({ text: x.trim(), done: false }));
        return out(s.updateTicket(id, patch, as), 'updated');
      }
      throw new Error(`unknown ticket subcommand ${sub}`);
    }
    case 'epic': {
      if (pos[1] === 'new') { const e = s.addEpic(pos.slice(2).join(' '), o.milestone || '', o.goal || ''); return out(e, `created ${e.id}`); }
      const es = s.readJSON('epics.json', []); return out(es, es.map((e) => `${e.id} ${e.name} (ms ${e.milestone || '-'})`).join('\n') || '(none)');
    }
    case 'milestone': {
      if (pos[1] === 'new') { const m = s.addMilestone(pos.slice(2).join(' '), o.goal || ''); return out(m, `created ${m.id}`); }
      if (pos[1] === 'set') { const m = s.setMilestone(pos[2], pos[3]); s.post(as, 'general', `🏁 milestone ${m.id} ${m.name} → ${m.status}`, { kind: 'milestone' }); return out(m, `${m.id} → ${m.status}`); }
      const ms = s.readJSON('milestones.json', []); return out(ms, ms.map((m) => `${m.id} ${m.name} [${m.status}] ${m.goal || ''}`).join('\n') || '(none)');
    }
    case 'control': {
      if (pos[1]) return out(s.setControl(pos[1], as === 'producer' && o.as === undefined ? 'Boss' : as), `state → ${pos[1]}`);
      return out(s.control(), `state: ${s.control().state}`);
    }
    case 'directive': { const d = s.addDirective(pos.slice(1).join(' '), o.to || 'all', as); return out(d, 'directive posted'); }
    case 'approval': {
      const sub = pos[1];
      if (sub === 'request') { const a = s.requestApproval({ what: pos.slice(2).join(' '), cost: o.cost, why: o.why, kind: o.kind, by: as, ticket: o.ticket }); return out(a, `${a.id} pending — do NOT proceed until approved (check with pulse or approval show ${a.id})`); }
      if (sub === 'resolve') return out(s.resolveApproval(pos[2], pos[3], o.note || '', as), 'resolved');
      const as_ = s.readJSON('approvals.json', []);
      if (sub === 'show') { const a = as_.find((x) => x.id === pos[2]); return out(a, a ? `${a.id} ${a.status}: ${a.what}${a.note ? ' — ' + a.note : ''}` : 'not found'); }
      const f = o.status ? as_.filter((a) => a.status === o.status) : as_;
      return out(f, f.map((a) => `${a.id} [${a.status}] ${a.kind} $${a.cost} ${a.what} (by ${a.by})`).join('\n') || '(none)');
    }
    case 'usage':
    case 'who': {
      const { UsageTracker, fmtTok } = require('./usage.js');
      const u = new UsageTracker(s).refresh();
      const ago = (ts) => (ts ? `${Math.round((now() - ts) / 60000)}m ago` : '-');
      if (cmd === 'who') {
        const latest = {};
        for (const r of u.runs) if (!latest[r.name] || r.last > latest[r.name].last) latest[r.name] = r;
        const rows = Object.values(latest).sort((a, b) => (a.state === 'active' ? -1 : 1) - (b.state === 'active' ? -1 : 1) || b.last - a.last);
        return out(rows, rows.map((r) => `${r.state === 'active' ? '🟢' : r.state === 'done' ? '✅' : '⚪'} ${r.name.padEnd(10)} ${String(r.team).padEnd(12)} ${(r.tickets.join(',') || '-').padEnd(16)} ${ago(r.last).padEnd(8)} ${r.lastAction.slice(0, 70)}`).join('\n') || '(no agents yet)');
      }
      const line = (a) => `  ${String(a.key).padEnd(14)} ${fmtTok(a.total).padStart(8)}  $${a.cost.toFixed(2).padStart(7)}`;
      const txt = [`TOTAL ${fmtTok(u.totals.total)} tokens ≈ $${u.totals.cost.toFixed(2)}  (${u.note})`,
        'by team:', ...u.byTeam.map(line), 'by worker:', ...u.byWorker.map(line),
        'by milestone:', ...u.byMilestone.map(line), 'top tickets:', ...u.byTicket.slice(0, Number(o.limit) || 10).map(line)].join('\n');
      return out(u, txt);
    }
    case 'decide': s.decide(pos.slice(1).join(' '), as); return out('recorded');
    case 'lesson': {
      if (!o.symptom || !o.fix) throw new Error('lesson add needs --symptom and --fix');
      s.addLesson({ area: o.area, symptom: o.symptom, cause: o.cause, fix: o.fix, by: as });
      return out('lesson recorded (skill LESSONS.md + project .studio/lessons.md)');
    }
    case 'wait-boss': {
      const timeout = (Number(o.timeout) || 540) * 1000;
      const start = now();
      const since = Number(o.since) || start;
      const ctl0 = JSON.stringify(s.control());
      for (;;) {
        const boss = s.readAll({ since }).filter((m) => String(m.from).toLowerCase() === 'boss');
        const ctl = s.control();
        const ap = s.readJSON('approvals.json', []).filter((a) => a.resolved && a.resolved > since);
        if (boss.length || JSON.stringify(ctl) !== ctl0 || ap.length) {
          const lines = [`BOSS ACTIVITY (state: ${ctl.state})`];
          for (const m of boss) lines.push(fmtMsg(m));
          for (const a of ap) lines.push(`approval ${a.id} ${a.status}: ${a.what}`);
          lines.push(`next: re-arm with  wait-boss --since ${now()}`);
          return out({ boss, control: ctl, approvals: ap }, lines.join('\n'));
        }
        if (now() - start > timeout) return out({ timeout: true }, `no Boss activity (timeout). re-arm: wait-boss --since ${since}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    default: throw new Error(`unknown command ${cmd}\n${HELP}`);
  }
}

module.exports = { Studio, findProject, STATUSES, TYPES, DEFAULT_CHANNELS, TEAM_CHANNEL, SKILL_DIR };

if (require.main === module) {
  main().catch((e) => { console.error(`ERROR: ${e.message}`); process.exit(1); });
}
