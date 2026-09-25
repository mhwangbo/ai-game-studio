/*
 * usage.js — live activity + token/cost accounting for studio workers.
 *
 * Source of truth = Claude Code transcripts (~/.claude/projects/<slug>/<session>/subagents/agent-*.jsonl
 * and the main session <session>.jsonl). Nothing depends on workers self-reporting:
 *   - worker identity:  first prompt contains  --project "<GAME_DIR>" ... --as <name>
 *   - tickets:          KEY-N ids in "Your ticket(s)" part of the prompt (split evenly)
 *   - tokens:           assistant message usage (deduped by message id)
 *   - finished:         SubagentStop hook attachment
 *   - live action:      last tool_use in the transcript
 * Parsing is incremental (per-file byte offset) so the server can rescan every few seconds.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// $ per million tokens. Cache write 5m = 1.25x input, 1h = 2x input. Override via config.pricing.
const DEFAULT_PRICING = {
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, read: 0.5 },
  'claude-opus-4': { in: 5, out: 25, read: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10, read: 0.2 },
  'claude-sonnet-4': { in: 3, out: 15, read: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, read: 0.1 },
  'claude-fable-5-1': { in: 10, out: 50, read: 0.25 },
  'claude-fable-5': { in: 10, out: 50, read: 1 },
};

const ACTIVE_MS = 90 * 1000;

function priceFor(model, pricing) {
  const table = Object.assign({}, DEFAULT_PRICING, pricing || {});
  const key = Object.keys(table).filter((k) => String(model || '').startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return table[key] || table['claude-opus-5'];
}

function costOf(t, model, pricing) {
  const p = priceFor(model, pricing);
  return (t.input * p.in + t.cw5m * p.in * 1.25 + t.cw1h * p.in * 2 + t.cacheRead * p.read + t.output * p.out) / 1e6;
}

const emptyTokens = () => ({ input: 0, output: 0, cw5m: 0, cw1h: 0, cacheRead: 0 });
const addTokens = (a, b, f = 1) => { for (const k of Object.keys(a)) a[k] += (b[k] || 0) * f; return a; };
const totalTokens = (t) => t.input + t.output + t.cw5m + t.cw1h + t.cacheRead;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n');
  return '';
}

function summarizeTool(tu) {
  const i = tu.input || {};
  const s = i.description || i.command || i.file_path || i.pattern || i.url || i.query || i.prompt || i.action || '';
  return `${tu.name}${s ? ': ' + String(s).replace(/\s+/g, ' ').slice(0, 120) : ''}`;
}

/** Per-file incremental parser state. */
class TranscriptState {
  constructor(file, kind) {
    this.file = file; this.kind = kind; this.offset = 0; this.partial = '';
    this.prompt = null; this.model = ''; this.first = 0; this.last = 0; this.finished = 0;
    this.msgs = new Map(); // message.id -> usage (max per field)
    this.lastAction = ''; this.lastActionTs = 0; this.toolCalls = 0;
  }

  update() {
    let st;
    try { st = fs.statSync(this.file); } catch { return false; }
    if (st.size < this.offset) { Object.assign(this, new TranscriptState(this.file, this.kind)); }
    if (st.size === this.offset) return false;
    const fd = fs.openSync(this.file, 'r');
    const buf = Buffer.alloc(st.size - this.offset);
    fs.readSync(fd, buf, 0, buf.length, this.offset);
    fs.closeSync(fd);
    this.offset = st.size;
    const lines = (this.partial + buf.toString('utf8')).split('\n');
    this.partial = lines.pop();
    for (const l of lines) if (l.trim()) { try { this.line(JSON.parse(l)); } catch {} }
    return true;
  }

  line(o) {
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (ts) { if (!this.first) this.first = ts; this.last = Math.max(this.last, ts); }
    if (o.type === 'user' && this.prompt === null && o.message && o.message.role === 'user') {
      this.prompt = textOf(o.message.content);
    }
    if (o.type === 'attachment' && o.attachment && o.attachment.hookEvent === 'SubagentStop') this.finished = ts || Date.now();
    if (o.type === 'assistant' && o.message) {
      const m = o.message;
      if (m.model && m.model !== '<synthetic>') this.model = m.model;
      if (m.id && m.usage) {
        const u = m.usage; const cc = u.cache_creation || {};
        const cur = this.msgs.get(m.id) || { ts, model: m.model, t: emptyTokens() };
        const t = {
          input: u.input_tokens || 0, output: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
          cw1h: cc.ephemeral_1h_input_tokens || 0,
          cw5m: cc.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens || 0) - (cc.ephemeral_1h_input_tokens || 0)),
        };
        for (const k of Object.keys(t)) cur.t[k] = Math.max(cur.t[k], t[k]);
        this.msgs.set(m.id, cur);
      }
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'tool_use') { this.lastAction = summarizeTool(c); this.lastActionTs = ts; this.toolCalls++; }
      }
    }
  }

  tokens(sinceTs = 0) {
    const t = emptyTokens();
    for (const v of this.msgs.values()) if (!sinceTs || v.ts >= sinceTs) addTokens(t, v.t);
    return t;
  }
}

class UsageTracker {
  constructor(studio) {
    this.studio = studio;
    this.files = new Map();
    this.rootNorm = studio.root.replace(/\\/g, '/').toLowerCase();
  }

  matchesProject(text) {
    const t = String(text || '').replace(/\\/g, '/').toLowerCase();
    return t.includes(this.rootNorm);
  }

  /** Find transcripts touched since the studio was created. */
  discover() {
    const since = (this.studio.config().created || 0) - 60000;
    let slugs = [];
    try { slugs = fs.readdirSync(PROJECTS_DIR); } catch { return; }
    for (const slug of slugs) {
      const pdir = path.join(PROJECTS_DIR, slug);
      let entries = [];
      try { entries = fs.readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(pdir, e.name);
        if (e.isFile() && e.name.endsWith('.jsonl')) this.consider(full, 'main', since);
        if (e.isDirectory()) {
          const sub = path.join(full, 'subagents');
          let subs = [];
          try { subs = fs.readdirSync(sub); } catch { continue; }
          for (const f of subs) if (f.endsWith('.jsonl')) this.consider(path.join(sub, f), 'agent', since);
        }
      }
    }
  }

  consider(file, kind, since) {
    if (this.files.has(file)) return;
    try { if (fs.statSync(file).mtimeMs < since) return; } catch { return; }
    this.files.set(file, new TranscriptState(file, kind));
  }

  refresh() {
    this.discover();
    for (const s of this.files.values()) s.update();
    return this.summary();
  }

  /** Main session belongs to the studio if it ever ran this studio's CLI. Cheap check: file contains project path. */
  mainMatches(s) {
    if (s._match !== undefined) return s._match;
    try {
      const fd = fs.openSync(s.file, 'r'); const size = fs.statSync(s.file).size;
      const chunk = 4 * 1024 * 1024; const buf = Buffer.alloc(Math.min(chunk, size));
      let found = false;
      for (let pos = Math.max(0, size - buf.length); ; pos = Math.max(0, pos - buf.length + 512)) {
        const n = fs.readSync(fd, buf, 0, buf.length, pos);
        if (this.matchesProject(buf.toString('utf8', 0, n))) { found = true; break; }
        if (pos === 0) break;
      }
      fs.closeSync(fd);
      s._match = found;
    } catch { s._match = false; }
    return s._match;
  }

  summary() {
    const cfg = this.studio.config();
    const pricing = cfg.pricing;
    const key = cfg.key || 'GAME';
    const workers = this.studio.workers();
    const tickets = Object.fromEntries(this.studio.listTickets({}).map((t) => [t.id, t]));
    const now = Date.now();
    const runs = [];

    for (const s of this.files.values()) {
      if (s.kind === 'agent') {
        if (!s.prompt || !this.matchesProject(s.prompt)) continue;
        const asM = s.prompt.match(/--as\s+([\w-]+)/);
        const youM = s.prompt.match(/You are ([\w-]+),\s*([^.\n]+?)\s+at the game studio/i);
        const name = (asM && asM[1]) || (youM && youM[1]) || path.basename(s.file, '.jsonl');
        const role = (youM && youM[2]) || (workers[name] || {}).role || '';
        const tkRe = new RegExp(`\\b${key}-\\d+\\b`, 'g');
        const tkLine = (s.prompt.match(/Your tickets?[^\n]*(\n[^\n]*){0,1}/i) || [''])[0];
        let tks = [...new Set((tkLine.match(tkRe) || []))];
        if (!tks.length) tks = [...new Set((s.prompt.match(tkRe) || []))].slice(0, 1);
        const t = s.tokens();
        const state = s.finished ? 'done' : (now - s.last < ACTIVE_MS ? 'active' : 'stale');
        runs.push({
          id: path.basename(s.file, '.jsonl').replace(/^agent-/, ''), kind: 'agent', name, role,
          team: (workers[name] || {}).team || guessTeam(role, name), tickets: tks, model: s.model,
          start: s.first, last: s.last, finished: s.finished, state, lastAction: s.lastAction, lastActionTs: s.lastActionTs,
          toolCalls: s.toolCalls, tokens: t, total: totalTokens(t), cost: costOf(t, s.model, pricing),
        });
      } else if (this.mainMatches(s)) {
        const t = s.tokens(cfg.created || 0);
        if (!totalTokens(t)) continue;
        runs.push({
          id: path.basename(s.file, '.jsonl'), kind: 'main', name: 'producer', role: 'producer', team: 'production',
          tickets: [], model: s.model, start: Math.max(s.first, cfg.created || 0), last: s.last, finished: 0,
          state: now - s.last < ACTIVE_MS ? 'active' : 'idle', lastAction: s.lastAction, lastActionTs: s.lastActionTs,
          toolCalls: s.toolCalls, tokens: t, total: totalTokens(t), cost: costOf(t, s.model, pricing),
        });
      }
    }

    const agg = (keyFn) => {
      const out = {};
      for (const r of runs) {
        const keys = keyFn(r);
        const share = 1 / Math.max(1, keys.length);
        for (const k of keys) {
          const a = out[k] || (out[k] = { key: k, tokens: emptyTokens(), total: 0, cost: 0, runs: 0 });
          addTokens(a.tokens, r.tokens, share); a.total += r.total * share; a.cost += r.cost * share; a.runs += share;
        }
      }
      return Object.values(out).sort((a, b) => b.cost - a.cost);
    };
    const byTicket = agg((r) => (r.tickets.length ? r.tickets : [r.kind === 'main' ? '(producer)' : '(no ticket)']));
    const msOf = (k) => (tickets[k] && tickets[k].milestone) || '(none)';
    const byMilestone = agg((r) => (r.tickets.length ? r.tickets.map(msOf) : ['(overhead)']));
    const totals = { tokens: emptyTokens(), total: 0, cost: 0 };
    for (const r of runs) { addTokens(totals.tokens, r.tokens); totals.total += r.total; totals.cost += r.cost; }
    return {
      updated: now,
      totals,
      runs: runs.sort((a, b) => (b.last || 0) - (a.last || 0)),
      byWorker: agg((r) => [r.name]),
      byTeam: agg((r) => [r.team || 'unknown']),
      byTicket,
      byMilestone,
      active: runs.filter((r) => r.state === 'active').map((r) => r.name),
      note: 'API-list-price estimate from transcript token counts; subscription plans are not billed per token.',
    };
  }
}

function guessTeam(role, name) {
  const s = `${role} ${name}`.toLowerCase();
  if (/qa|test/.test(s)) return 'qa';
  if (/audio|sound|compos|^au-/.test(s)) return 'audio';
  if (/artist|art-|tech-art/.test(s)) return 'art';
  if (/design|writer|creative|^cd-|^gd-/.test(s)) return 'design';
  if (/build|release/.test(s)) return 'build';
  if (/producer/.test(s)) return 'production';
  return 'engineering';
}

const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

module.exports = { UsageTracker, costOf, priceFor, DEFAULT_PRICING, fmtTok, totalTokens };
