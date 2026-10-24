// Shared SQLite store (node:sqlite, no ORM). Owned by tech lead.
// Server-only: import from route handlers, server components, scripts. Never from "use client" files.
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { randomBytes } from "node:crypto"
import type { AgentRun, OutboxDraft, Source, SourceKind, StepKind } from "./types.ts"

const DB_PATH = process.env.HH_DB ?? "data/hh.db" // relative to cwd = repo root
export const OWN_INBOX = process.env.HH_OWN_INBOX ?? "hallway-hunter-team@localhost"

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 3000;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  business_id TEXT UNIQUE,
  name TEXT NOT NULL,
  website TEXT,
  prh TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role TEXT NOT NULL,              -- role only; there is deliberately no name column
  quote TEXT NOT NULL,
  pain TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  temperature TEXT NOT NULL DEFAULT 'warm' CHECK (temperature IN ('cold','warm','hot')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prh','ted','site','hallway','note')),
  url TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sources_company ON sources(company_id);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  run_id TEXT,
  brief TEXT NOT NULL,
  word_count INTEGER NOT NULL CHECK (word_count <= 120),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','killed')),
  script TEXT NOT NULL DEFAULT '[]',
  skeptic TEXT NOT NULL DEFAULT '[]',
  compliance TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  claim TEXT NOT NULL,
  formula TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  subject_id TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  tool_calls INTEGER NOT NULL DEFAULT 0,
  output TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_started ON agent_runs(started_at);

CREATE TABLE IF NOT EXISTS agent_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model','tool','info','error')),
  name TEXT NOT NULL,
  input TEXT,
  output TEXT,
  ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_steps_run ON agent_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('page','email')),
  ref_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','EDITED','REJECTED')),
  note TEXT,
  final_payload TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

-- Local drafts only. No 'sent' state exists; nothing in this repo sends email.
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  approval_id TEXT NOT NULL REFERENCES approvals(id),
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
  created_at TEXT NOT NULL
);
`

// Columns stored as JSON text. get/all parse them; run/insert stringify objects.
const JSON_COLS = new Set([
  "prh", "brief", "script", "skeptic", "compliance", "claim", "formula",
  "input", "output", "payload", "final_payload", "letter",
])

// Additive columns for databases created before them. [table, column, definition, backfill run once when added]
const MIGRATIONS: [string, string, string, string?][] = [
  // 1 = a demo note, invented for a demo, shown with a "nobody at <company> said this" label.
  // Every lead stored before this column existed came from seed, test scripts or rehearsals, so the backfill marks them all.
  ["leads", "synthetic", "INTEGER NOT NULL DEFAULT 0", "UPDATE leads SET synthetic = 1"],
  // JSON PageLetter: recipient, what we checked, scale fact, questions (lib/types.ts).
  ["pages", "letter", "TEXT"],
]

const g = globalThis as unknown as { __hhdb?: DatabaseSync }

export function db(): DatabaseSync {
  if (!g.__hhdb) {
    mkdirSync(DB_PATH.slice(0, DB_PATH.lastIndexOf("/") + 1) || ".", { recursive: true })
    const d = new DatabaseSync(DB_PATH)
    d.exec(SCHEMA)
    for (const [table, col, def, backfill] of MIGRATIONS) {
      if ((d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col)) continue
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
      if (backfill) d.exec(backfill)
    }
    g.__hhdb = d
  }
  return g.__hhdb
}

export const now = () => new Date().toISOString()
export const uid = (prefix: string) => `${prefix}_${randomBytes(6).toString("base64url")}`

function bind(v: unknown): SQLInputValue {
  if (v === undefined) return null
  if (typeof v === "boolean") return v ? 1 : 0
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v)
  return v as SQLInputValue
}

function parseRow<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row) return undefined
  const out: Record<string, unknown> = { ...row }
  for (const k in out) {
    const v = out[k]
    if (JSON_COLS.has(k) && typeof v === "string") {
      try { out[k] = JSON.parse(v) } catch { /* leave raw text */ }
    }
  }
  return out as T
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params.map(bind)).map((r) => parseRow<T>(r as Record<string, unknown>)!)
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  return parseRow<T>(db().prepare(sql).get(...params.map(bind)) as Record<string, unknown> | undefined)
}

export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params.map(bind))
}

// INSERT a row from an object. Keys are trusted column names (never user input).
export function insert(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row)
  run(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, ...keys.map((k) => row[k]))
}

// ---- evidence store (both lanes write, everything cites these ids) ----

export function addSource(s: {
  company_id: string; kind: SourceKind; url?: string | null; title: string; excerpt: string; lead_id?: string | null
}): Source {
  const row: Source = {
    id: uid("src"),
    company_id: s.company_id,
    kind: s.kind,
    url: s.url ?? null,
    title: s.title.slice(0, 200),
    excerpt: s.excerpt.slice(0, 600),
    lead_id: s.lead_id ?? null,
    fetched_at: now(),
  }
  insert("sources", row as unknown as Record<string, unknown>)
  return row
}

export function knownSourceIds(companyId: string): Set<string> {
  return new Set(all<{ id: string }>("SELECT id FROM sources WHERE company_id = ?", companyId).map((r) => r.id))
}

// ---- agent run log (used by lib/claude.ts; lanes may log extra 'info' steps) ----

export function startRun(agent: string, subjectId: string | null, model: string): string {
  const id = uid("run")
  insert("agent_runs", { id, agent, subject_id: subjectId, model, status: "running", started_at: now() })
  return id
}

export function logStep(runId: string, kind: StepKind, name: string, input: unknown, output: unknown, ms = 0) {
  const seq = (get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_steps WHERE run_id = ?", runId)?.n ?? 0) + 1
  insert("agent_steps", { run_id: runId, seq, kind, name, input: input ?? null, output: output ?? null, ms, created_at: now() })
  if (kind === "tool") run("UPDATE agent_runs SET tool_calls = tool_calls + 1 WHERE id = ?", runId)
}

export function endRun(runId: string, status: Exclude<AgentRun["status"], "running">, output: string | null, error?: string) {
  run("UPDATE agent_runs SET status = ?, output = ?, error = ?, ended_at = ? WHERE id = ?", status, output, error ?? null, now(), runId)
}

// ---- outbox: the ONLY way to write an email. Always our own inbox, always a draft. ----

export function createDraft(approvalId: string, subject: string, body: string): OutboxDraft {
  const row: OutboxDraft = {
    id: uid("draft"), approval_id: approvalId, to_addr: OWN_INBOX,
    subject: `[Velho draft] ${subject}`, body, status: "draft", created_at: now(),
  }
  insert("outbox", row as unknown as Record<string, unknown>)
  return row
}
