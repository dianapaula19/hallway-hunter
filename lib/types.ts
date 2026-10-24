// Shared types. Owned by tech lead; lanes request changes, never edit in place.
// One row type per table in lib/db.ts. JSON columns are typed here and parsed in db helpers.

export type SourceKind = "prh" | "ted" | "site" | "hallway" | "note"

// Evidence store row. `id` (e.g. "src_ab12cd") is what every claim cites.
export interface Source {
  id: string
  company_id: string
  kind: SourceKind
  url: string | null // null only for hallway / note
  title: string
  excerpt: string // the exact text the claim relies on, <= ~600 chars
  lead_id: string | null // set for kind=hallway, cascades on lead delete
  fetched_at: string // ISO
}

// A claim with no valid source id is dropped by the sanitizer, never shown.
export interface Claim {
  text: string
  source_ids: string[]
}

export interface Company {
  id: string // "co_..."
  business_id: string | null // Y-tunnus, e.g. "0109862-8"; null if PRH had no match
  name: string
  website: string | null
  prh: unknown | null // raw PRH v3 company object
  created_at: string
}

// LIVE lane output. <= 120 words total across all fields.
export interface Brief {
  what_they_do: Claim
  signals: Claim[] // exactly 2 after sanitizing, else fewer + "thin data" flag
  openers: string[] // exactly 3
  dont_say: string
  objection: Claim // likely objection, must cite a source
  thin_data: boolean
}

export interface BriefRow {
  id: string
  company_id: string
  run_id: string | null
  brief: Brief
  word_count: number
  created_at: string
}

export type Temperature = "cold" | "warm" | "hot"

// Hallway capture. Role, never a person's name. Deletable (cascades to its source row).
export interface Lead {
  id: string
  company_id: string
  role: string // "Head of Finance", not "Matti"
  quote: string // verbatim hallway line, names scrubbed
  pain: string
  next_step: string
  temperature: Temperature
  synthetic: number // 1 = demo note, invented for a demo; pages say "nobody at <company> said this"
  created_at: string
}

// Editable euro formula. Shown on the page; value always labelled an estimate.
// eur_per_year = hours_per_week * people * weeks_per_year * hourly_cost_eur * automation_share
export interface EuroFormula {
  hours_per_week: number
  people: number
  weeks_per_year: number
  hourly_cost_eur: number
  automation_share: number // 0..1
  label: "estimate" | "sector estimate"
  input_source_ids: string[] // where the inputs came from; empty => "sector estimate"
}

export interface Opportunity {
  id: string
  page_id: string
  title: string
  claim: Claim
  formula: EuroFormula
  position: number
}

export type Host = "A" | "B"
export interface ScriptLine {
  host: Host
  text: string
  source_ids: string[] // empty allowed only for pure transitions; sanitizer decides
}

export interface SkepticScore {
  stop: number // 0-10, would a CEO stop scrolling
  read: number // would they read to the end
  reply: number // would they reply
  notes: string
  reply_why?: string // one sentence: why the reader would or would not answer the ask
}

// Letter content beyond the cards, written by the night path (pages.letter).
export interface PageLetter {
  recipient: string | null // who the page is framed for: "COO", "CFO", or the role met
  scale: Claim | null // one public size fact (headcount, dealers, countries) from the company's own site
  checked: Claim | null // "What we checked": a public source tied to the same process, or that nothing public mentions it
  questions: Claim[] // no-lead pages: what we'd ask, each grounded in a public source
}

export type PageStatus = "draft" | "pending_approval" | "approved" | "killed"

// Private "Made for <Company> — Velho draft" page.
export interface Page {
  id: string
  slug: string // unguessable, used in /p/[slug]
  company_id: string
  lead_id: string | null
  status: PageStatus
  script: ScriptLine[] // ~75s two-host audio script
  skeptic: SkepticScore[] // one per round, max 2 rewrites
  compliance: { ok: boolean; issues: string[] } | null
  letter: PageLetter | null
  created_at: string
}

export type RunStatus = "running" | "ok" | "error"
export interface AgentRun {
  id: string
  agent: string // "quick_scout" | "researcher" | "skeptic" | ...
  subject_id: string | null // company or page id
  model: string
  status: RunStatus
  tool_calls: number
  output: string | null
  error: string | null
  started_at: string
  ended_at: string | null
}

export type StepKind = "model" | "tool" | "info" | "error"
export interface AgentStep {
  id: number
  run_id: string
  seq: number
  kind: StepKind
  name: string // tool name, or "turn"
  input: unknown
  output: unknown
  ms: number
  created_at: string
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "EDITED" | "REJECTED"
// Same shape as Bahn's agent_proposals: payload + review {status, note, final_payload}.
export interface Approval {
  id: string
  kind: "page" | "email"
  ref_id: string // page id
  payload: { subject: string; body: string; page_slug: string }
  status: ApprovalStatus
  note: string | null
  final_payload: Approval["payload"] | null
  created_at: string
  decided_at: string | null
}

// Local email draft. There is no "sent" state; the DB rejects anything but 'draft'.
export interface OutboxDraft {
  id: string
  approval_id: string
  to_addr: string // always our own inbox (HH_OWN_INBOX)
  subject: string
  body: string
  status: "draft"
  created_at: string
}
