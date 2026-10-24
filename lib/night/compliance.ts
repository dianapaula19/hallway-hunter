// Compliance gate: deterministic checks only (model pass skipped). Approval is blocked while ok === false.
import type { Lead, ScriptLine, Source } from "../types.ts"
import type { DraftOpportunity } from "./researcher.ts"

const PROMISE = /\b(guarantee[sd]?|guaranteed|will save|we will|we'll|promise[sd]?)\b/i
const HONORIFIC = /\b(Mr|Mrs|Ms|Dr|herra|rouva)\.?\s+\p{Lu}/u
// "between us" alone is too broad ("three hours a day between us"), so only its secrecy phrasings count.
const CONFIDENTIAL = /\b(confidential|luottamuksellinen|salainen|off the record|just between us|between you and me|(keep|is) (this|it) between us|don'?t (share|quote|repeat)|nda)\b/i
const OK_CAPS = new Set(["a", "an", "the", "so", "and", "but", "i", "we", "our", "their", "this", "that", "it", "in", "on", "at", "for", "if", "velho", "velho's", "ai", "ceo", "cfo", "cto", "eu", "ted", "prh", "oy", "oyj", "ab"])

export const isConfidential = (lead: Lead | null) => !!lead && CONFIDENTIAL.test(`${lead.quote} ${lead.pain} ${lead.next_step}`)

// Two+ consecutive capitalised words that appear nowhere in our evidence look like a personal name.
export function suspectNames(text: string, corpus: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)+/gu)) {
    // Drop allowlisted words, acronyms (SAP, RTG) and possessives; a name needs 2+ remaining words.
    const words = m[0].split(/\s+/).map((w) => w.replace(/'s$/, "")).filter((w) => !OK_CAPS.has(w.toLowerCase()) && !/^\p{Lu}{2,}$/u.test(w))
    // Known if any adjacent pair is in our evidence ("Two Luka Koper", "Luka Koper's RTG").
    const known = words.slice(1).some((w, i) => corpus.includes(`${words[i]} ${w}`.toLowerCase()))
    if (words.length >= 2 && !known) out.push(m[0])
  }
  return out
}

export function checkCompliance(input: {
  companyName: string; lead: Lead | null; sources: Source[]; opps: DraftOpportunity[]; lines: ScriptLine[]
}): { ok: boolean; issues: string[] } {
  const { companyName, lead, sources, opps, lines } = input
  const issues: string[] = []
  const corpus = [companyName, lead?.role ?? "", ...sources.flatMap((s) => [s.title, s.excerpt])].join(" ").toLowerCase()
  const texts = [...opps.flatMap((o) => [o.title, o.claim.text]), ...lines.map((l) => l.text)]

  for (const t of texts) {
    const p = t.match(PROMISE)
    if (p) issues.push(`promise language "${p[0]}": ${t.slice(0, 80)}`)
    if (HONORIFIC.test(t)) issues.push(`possible personal name: ${t.slice(0, 80)}`)
    for (const n of suspectNames(t, corpus)) issues.push(`possible personal name "${n}"`)
  }
  // An amount is "€" or plural "euros" ("five thousand euros"); "the euro figure" alone is not one.
  for (const l of lines) if (/€|\beuros\b/i.test(l.text) && !/estimate/i.test(l.text)) issues.push(`euro figure not labelled estimate: ${l.text.slice(0, 80)}`)

  if (!lines.length) issues.push("audio script is empty")
  if (!lines.some((l) => /Velho'?s AI analysts/i.test(l.text))) issues.push(`hosts never introduced as "Velho's AI analysts"`)
  const hallwayIds = new Set(sources.filter((s) => s.kind === "hallway").map((s) => s.id))
  if (!opps.length) issues.push("no opportunity card survived the sanitizer (thin data)")
  if (isConfidential(lead) && lines.some((l) => l.source_ids.some((id) => hallwayIds.has(id))))
    issues.push("lead is marked confidential but the script uses the hallway detail")

  return { ok: issues.length === 0, issues: [...new Set(issues)] }
}

// Self-check: node lib/night/compliance.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  const corpus = "buyer: luka koper, pristaniški. rahmenvertrag deutsche bahn"
  assert.deepEqual(suspectNames("Two Luka Koper awards. The Deutsche Bahn deal. Luka Koper's RTG cranes.", corpus), [])
  assert.deepEqual(suspectNames("Ask Matti Virtanen about it.", corpus), ["Ask Matti Virtanen"])
  const lead = (quote: string) => ({ quote, pain: "", next_step: "" }) as Lead
  assert.equal(isConfidential(lead("two of us retype it, three hours a day between us")), false)
  assert.equal(isConfidential(lead("Keep this between us, but the ERP is a mess.")), true)
  const euro = (text: string) => checkCompliance({ companyName: "X", lead: null, sources: [], opps: [], lines: [{ host: "A", text, source_ids: [] }] }).issues.some((i) => i.startsWith("euro"))
  assert.equal(euro("The euro figure is the smaller part."), false)
  assert.equal(euro("That is five thousand euros a year."), true)
  assert.equal(euro("About €5 800 a year, an estimate."), false)
  console.log("compliance self-check ok")
}
