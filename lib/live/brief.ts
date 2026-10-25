// Brief post-processing: citation sanitizer -> thin-data flag -> 120-word fit -> store.
import { all, get, insert, now, uid } from "../db.ts"
import { sanitizeClaims } from "../night/sanitize.ts"
import type { Brief, BriefRow, Claim, Company, Source } from "../types.ts"
import { base } from "./prh.ts"

// A TED source names this company when a listed winner (or the buyer) is its registered name, legal form aside.
// tedExcerpt (ted.ts) lists only tenderers containing the stem, so "Fazer Latvija SIA" is there but is not "Karl Fazer".
export function namesCompany(s: Pick<Source, "excerpt">, name: string): boolean {
  if (s.excerpt.includes(`${name} is the buyer.`)) return true
  const won = s.excerpt.match(/Tenderer\/winner incl\. (.+?)\.?$/)?.[1] ?? ""
  return won.split(/,\s*/).some((w) => base(w) === base(name))
}

export const MAX_WORDS = 120
const words = (s: string) => s.split(/\s+/).filter(Boolean)

export const briefTexts = (b: Brief) => [b.what_they_do.text, ...b.signals.map((s) => s.text), ...b.openers, b.dont_say, b.objection.text]
export const countWords = (b: Brief) => briefTexts(b).reduce((n, t) => n + words(t).length, 0)

// Trim the longest field one word at a time until the brief fits (DB CHECK word_count <= 120).
export function fitBrief(b: Brief, max = MAX_WORDS): Brief {
  const out: Brief = structuredClone(b)
  const fields: { get: () => string; set: (s: string) => void }[] = [
    { get: () => out.what_they_do.text, set: (s) => (out.what_they_do.text = s) },
    ...out.signals.map((c) => ({ get: () => c.text, set: (s: string) => (c.text = s) })),
    ...out.openers.map((_, i) => ({ get: () => out.openers[i], set: (s: string) => (out.openers[i] = s) })),
    { get: () => out.dont_say, set: (s) => (out.dont_say = s) },
    { get: () => out.objection.text, set: (s) => (out.objection.text = s) },
  ]
  while (countWords(out) > max) {
    const f = fields.reduce((a, x) => (words(x.get()).length > words(a.get()).length ? x : a))
    const w = words(f.get())
    f.set(w.slice(0, -1).join(" ").replace(/[,;:]?$/, "…"))
  }
  return out
}

// `fallbackWhat` is the PRH business-line claim, always citable, used if the model's is dropped.
export function finalizeBrief(companyId: string, raw: Brief, fallbackWhat: Claim, runId?: string): Brief {
  const s = sanitizeClaims(companyId, [raw.what_they_do, ...(raw.signals ?? []), raw.objection], runId)
  const kept = new Set(s.kept)
  const signals = (raw.signals ?? []).filter((c) => kept.has(c)).slice(0, 2)
  const b: Brief = {
    what_they_do: kept.has(raw.what_they_do) ? raw.what_they_do : fallbackWhat,
    signals,
    openers: (raw.openers ?? []).filter((o) => typeof o === "string" && o.trim()).slice(0, 3),
    dont_say: raw.dont_say ?? "",
    objection: kept.has(raw.objection) ? raw.objection : { text: "thin data: no sourced objection", source_ids: [] },
    thin_data: Boolean(raw.thin_data) || signals.length < 2,
  }
  return fitBrief(b)
}

export function storeBrief(companyId: string, brief: Brief, runId: string | null): BriefRow {
  const row: BriefRow = { id: uid("brief"), company_id: companyId, run_id: runId, brief, word_count: countWords(brief), created_at: now() }
  insert("briefs", row as unknown as Record<string, unknown>)
  return row
}

const short = (s: string, n: number) => words(s).slice(0, n).join(" ")

// TED excerpt (see tedExcerpt) -> 'Won a "Tractors" contract award from X (2026-09-02).'
export function signalText(s: Source): string {
  const m = /^(?:(\d{4}-\d\d-\d\d) )?([^:]+): "(.*?)"\. Buyer: (.*?)\. (.*)$/.exec(s.excerpt)
  if (s.kind !== "ted" || !m) return short(s.excerpt, 18)
  const [, date, type, title, buyer, rest] = m
  const when = date ? ` (${date})` : ""
  const parts = title.split(" – ")
  const what = short(parts.length >= 3 ? parts[1] : parts.at(-1)!, 6)
  return rest.includes("is the buyer") ? `Ran a public tender: "${what}"${when}.` : `${type[0].toUpperCase()}${type.slice(1)}: "${what}" from ${short(buyer, 6)}${when}.`
}

// No key, or the model failed: a deterministic brief straight from the evidence store.
export function evidenceBrief(company: Company, prh: Source, others: Source[]): Brief {
  const line = /Main business line: ([^.]+)\./.exec(prh.excerpt)?.[1]
  const what: Claim = { text: line ? `${company.name}: ${line}.` : `${company.name}, registered in the Finnish trade register.`, source_ids: [prh.id] }
  const signals = others.slice(0, 2).map((s) => ({ text: signalText(s), source_ids: [s.id] }))
  const ted = others.find((s) => s.kind === "ted")
  return fitBrief({
    what_they_do: what,
    signals,
    openers: [
      `What is taking most of your team's time this quarter?`,
      ted ? `How do public tenders fit into your growth plans?` : `Where does manual reporting still slow you down?`,
      `Who owns process automation on your side?`,
    ],
    dont_say: "Don't pitch before asking about their priorities.",
    objection: ted
      ? { text: "Public-sector work means long procurement cycles; budgets may be locked.", source_ids: [ted.id] }
      : { text: "thin data: no sourced objection", source_ids: [] },
    thin_data: signals.length < 2,
  })
}

export type LatestBrief = { name: string; created_at: string; secs: number | null; word_count: number; brief: Brief; sources: Source[] }

// The newest stored brief that is not thin data, with only the sources it cites (same company), for the
// "this is what the live half looks like" card on / and /capture. Read-only; nothing is generated.
// Skips a brief whose signals rest only on subsidiary or namesake TED awards (the judge's "Fazer Finland Oy" brief, built on
// Fazer Latvija SIA's tenders, was what / showed).
export function latestBrief(): LatestBrief | null {
  const rows = all<BriefRow & { name: string; started_at: string | null; ended_at: string | null }>(
    `SELECT b.*, c.name, r.started_at, r.ended_at FROM briefs b JOIN companies c ON c.id = b.company_id
       LEFT JOIN agent_runs r ON r.id = b.run_id AND r.status = 'ok'
      WHERE json_extract(b.brief, '$.thin_data') = 0 ORDER BY b.created_at DESC LIMIT 20`)
  const srcOf = (row: BriefRow) => {
    const ids = [...new Set([row.brief.what_they_do, ...row.brief.signals, row.brief.objection].flatMap((c) => c.source_ids))]
    return { ids, found: ids.length ? all<Source>(`SELECT * FROM sources WHERE company_id = ? AND id IN (${ids.map(() => "?").join(",")})`, row.company_id, ...ids) : [] }
  }
  const ownSignal = (row: BriefRow & { name: string }, found: Source[]) =>
    row.brief.signals.some((c) => c.source_ids.some((id) => { const s = found.find((x) => x.id === id); return s && (s.kind !== "ted" || namesCompany(s, row.name)) }))
  const row = rows.find((r) => ownSignal(r, srcOf(r).found))
  if (!row) return null
  const b = row.brief
  const { ids, found } = srcOf(row)
  return {
    name: row.name, created_at: row.created_at, word_count: row.word_count, brief: b,
    secs: row.started_at && row.ended_at ? (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000 : null,
    sources: ids.map((id) => found.find((s) => s.id === id)).filter((s): s is Source => !!s),
  }
}
