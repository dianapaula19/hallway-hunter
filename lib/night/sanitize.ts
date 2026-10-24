// Citation sanitizer (hard rule 2). Runs before anything is stored or shown.
// A claim survives only if every source id it cites exists in `sources` for that company.
// Self-check: node lib/night/sanitize.ts
import { get, knownSourceIds, logStep } from "../db.ts"
import type { Claim, ScriptLine } from "../types.ts"

const cited = (ids: string[] | undefined, known: Set<string>) =>
  Array.isArray(ids) && ids.length > 0 && ids.every((id) => known.has(id))

// Words allowed to be capitalised mid-sentence without a citation.
const ALWAYS_OK = new Set(["velho", "velho's", "ai", "i", "i'm", "i'd", "i'll", "ok", "ceo", "cfo", "a", "b",
  // weekdays and months are not facts about anyone ("every Friday afternoon")
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "fridays", "mondays",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"])

// Does a script line make a factual-looking claim (number, €, %, or a proper noun other than the company)?
export function needsSource(text: string, companyName: string): boolean {
  if (/[0-9€%]/.test(text)) return true
  const companyWords = new Set(companyName.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean))
  // Split into sentences; the first word of a sentence may be capitalised freely.
  for (const sentence of text.split(/(?<=[.!?:;"“”—–-])\s+/)) {
    const words = sentence.split(/\s+/).filter(Boolean)
    for (let i = 1; i < words.length; i++) {
      const w = words[i].replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "")
      if (!w || !/^\p{Lu}/u.test(w)) continue
      const lw = w.toLowerCase()
      if (ALWAYS_OK.has(lw) || companyWords.has(lw) || companyWords.has(lw.replace(/'s$/, ""))) continue
      return true
    }
  }
  return false
}

function companyName(companyId: string): string {
  return get<{ name: string }>("SELECT name FROM companies WHERE id = ?", companyId)?.name ?? ""
}

function logDropped(companyId: string, what: string, dropped: unknown[], runId?: string) {
  if (dropped.length && runId) logStep(runId, "info", `sanitize_${what}`, { company_id: companyId }, { dropped })
}

export function sanitizeClaims(companyId: string, claims: Claim[], runId?: string): { kept: Claim[]; dropped: Claim[] } {
  const known = knownSourceIds(companyId)
  const kept: Claim[] = []
  const dropped: Claim[] = []
  for (const c of claims ?? []) (c && typeof c.text === "string" && c.text.trim() && cited(c.source_ids, known) ? kept : dropped).push(c)
  logDropped(companyId, "claims", dropped, runId)
  return { kept, dropped }
}

export function sanitizeScript(companyId: string, lines: ScriptLine[], runId?: string): { kept: ScriptLine[]; dropped: ScriptLine[] } {
  const known = knownSourceIds(companyId)
  const name = companyName(companyId)
  const kept: ScriptLine[] = []
  const dropped: ScriptLine[] = []
  for (const l of lines ?? []) {
    if (!l || typeof l.text !== "string" || !l.text.trim() || (l.host !== "A" && l.host !== "B")) { dropped.push(l); continue }
    const ids = l.source_ids ?? []
    const ok = ids.length ? cited(ids, known) : !needsSource(l.text, name)
    ;(ok ? kept : dropped).push({ ...l, source_ids: ids })
  }
  logDropped(companyId, "script", dropped, runId)
  return { kept, dropped }
}

// ---- self-check (runs only when executed directly; uses a throwaway synthetic company) ----
if (import.meta.main) {
  const { insert, now, addSource, run } = await import("../db.ts")
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  const co = "co_sanitize_selftest"
  run("DELETE FROM companies WHERE id = ?", co)
  insert("companies", { id: co, business_id: null, name: "Testi Kuljetus Oy (synthetic)", website: null, prh: null, created_at: now() })
  try {
    const s = addSource({ company_id: co, kind: "note", title: "t", excerpt: "synthetic" })
    const c = sanitizeClaims(co, [
      { text: "ok", source_ids: [s.id] },
      { text: "no source", source_ids: [] },
      { text: "invented", source_ids: [s.id, "src_fake"] },
      { text: "", source_ids: [s.id] },
    ])
    assert.deepEqual(c.kept.map((k) => k.text), ["ok"])
    assert.equal(c.dropped.length, 3)
    const l = sanitizeScript(co, [
      { host: "A", text: "Welcome. We are Velho's AI analysts.", source_ids: [] },
      { host: "B", text: "So, what does Testi Kuljetus actually need?", source_ids: [] },
      { host: "A", text: "They move 40 trucks a day.", source_ids: [] },
      { host: "B", text: "And they just signed with Posti, right?", source_ids: [] },
      { host: "A", text: "They move 40 trucks a day.", source_ids: [s.id] },
      { host: "B", text: "Saves 20%.", source_ids: ["src_fake"] },
    ])
    assert.deepEqual(l.kept.map((k) => k.text), [
      "Welcome. We are Velho's AI analysts.",
      "So, what does Testi Kuljetus actually need?",
      "They move 40 trucks a day.",
    ])
    assert.equal(l.dropped.length, 3)
    assert.equal(needsSource("Ninety euros € each.", "X"), true)
    assert.equal(needsSource("They retype notes every Friday afternoon.", "X"), false)
    console.log("sanitize self-check ok")
  } finally {
    run("DELETE FROM companies WHERE id = ?", co)
  }
}
