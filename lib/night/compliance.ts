// Compliance gate: deterministic checks only (model pass skipped). Approval is blocked while ok === false.
import type { Lead, PageLetter, ScriptLine, Source } from "../types.ts"
import type { DraftOpportunity } from "./researcher.ts"

const PROMISE = /\b(guarantee[sd]?|guaranteed|will save|we will|we'll|promise[sd]?)\b/i
const HONORIFIC = /\b(Mr|Mrs|Ms|Dr|herra|rouva)\.?\s+\p{Lu}/u
// "between us" alone is too broad ("three hours a day between us"), so only its secrecy phrasings count.
const CONFIDENTIAL = /\b(confidential|luottamuksellinen|salainen|off the record|just between us|between you and me|(keep|is) (this|it) between us|don'?t (share|quote|repeat)|nda)\b/i
const OK_CAPS = new Set(["a", "an", "the", "so", "and", "but", "i", "we", "our", "their", "this", "that", "it", "in", "on", "at", "for", "if", "velho", "velho's", "ai", "ceo", "cfo", "cto", "eu", "ted", "prh", "oy", "oyj", "ab"])

// "Why it matters" may state only what its sources state. The tie from a cited fact to the process ("every new framework
// adds dealer parts orders") is an inference: it must read as one, a conditional ("If those orders also arrive as PDFs, …")
// or a question, or it is marked as our assumption. ponytail: a causal-verb list; a new verb slips through until added.
export const ASSUME = "Our assumption, to check with you:"
const CAUSAL = /\b(adds?|added|brings?|means?|drives?|creates?|generates?|increases?|raises?|multipl(?:y|ies)|feeds?|leads? to|results? in|grows?|expands?|every new|each new|more (?:orders|reports|work|paperwork|reporting))\b/i
const MARKED = /^(?:if|assuming|suppose|whether|in case|could|would|does|do|is|are|how|what)\b/i
const clauses = (t: string) => t.split(/(?<=[.!?;])\s+|\s+[—–]\s+/).map((c) => c.trim()).filter(Boolean)

// The first clause that states an uncited conclusion as fact, or null. Text after the ASSUME marker is already marked.
export function uncitedInference(text: string): string | null {
  const facts = text.split(ASSUME)[0]
  return clauses(facts).find((c) => CAUSAL.test(c) && !MARKED.test(c) && !c.trim().endsWith("?")) ?? null
}

// Keeps the cited facts as they are and moves the first unmarked inference (and what follows) behind the ASSUME marker.
// When nothing factual is left in front of it, the whole text becomes the assumption (callers may drop such a line).
export function markInference<T extends { text: string }>(c: T): T {
  const bad = uncitedInference(c.text)
  if (!bad) return c
  const parts = clauses(c.text.split(ASSUME)[0])
  const i = parts.indexOf(bad)
  const facts = parts.slice(0, i).join(" ").replace(/[;,:\s]+$/, "")
  const rest = parts.slice(i).join(" ")
  const lead = facts ? `${/[.!?]$/.test(facts) ? facts : `${facts}.`} ` : ""
  return { ...c, text: `${lead}${ASSUME} ${rest.charAt(0).toLowerCase() + rest.slice(1)}` }
}

// Spoken length at the player's rate (2.6 words a second). Shared by the player, compliance and the eval.
export const speechSecs = (lines: { text: string }[]) => Math.round(lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0) / 2.6)
export const MAX_SECS = 80

// Every cited line the letter prints besides the cards: size fact, the why and pilot lines, old "checked" sentences, questions.
export const letterClaims = (letter?: PageLetter | null) =>
  [letter?.scale, letter?.why, letter?.path, letter?.checked, letter?.teams, ...(letter?.questions ?? [])].filter((c) => !!c)

export const isConfidential = (lead: Lead | null) => !!lead && CONFIDENTIAL.test(`${lead.quote} ${lead.pain} ${lead.next_step}`)

// Two+ consecutive capitalised words that appear nowhere in our evidence look like a personal name.
export function suspectNames(text: string, corpus: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+)+/gu)) {
    // Drop allowlisted words, acronyms (SAP, RTG) and possessives; a name needs 2+ remaining words.
    const words = m[0].split(/\s+/).map((w) => w.replace(/'s$/, "")).filter((w) => !OK_CAPS.has(w.toLowerCase()) && !/^\p{Lu}{2,}$/u.test(w))
    // Known if any adjacent pair is in our evidence ("Two Luka Koper", "Luka Koper's RTG"), or if fewer than 2 of the words
    // are unknown on their own: "Väylävirasto's Mipro TCS" is a TED buyer plus the company's product, not a person.
    const known = words.slice(1).some((w, i) => corpus.includes(`${words[i]} ${w}`.toLowerCase()))
    const unknown = words.filter((w) => !new RegExp(`(^|[^\\p{L}])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(corpus))
    if (words.length >= 2 && !known && unknown.length >= 2) out.push(m[0])
  }
  return out
}

export function checkCompliance(input: {
  companyName: string; lead: Lead | null; sources: Source[]; opps: DraftOpportunity[]; lines: ScriptLine[]; letter?: PageLetter | null
}): { ok: boolean; issues: string[] } {
  const { companyName, lead, sources, opps, lines, letter } = input
  const issues: string[] = []
  const corpus = [companyName, lead?.role ?? "", ...sources.flatMap((s) => [s.title, s.excerpt])].join(" ").toLowerCase()
  const extra = letterClaims(letter)
  const texts = [...opps.flatMap((o) => [o.title, o.claim.text]), ...lines.map((l) => l.text), ...extra.map((c) => c.text)]

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
  if (!opps.length && !letter?.questions?.length) issues.push("no opportunity card or question survived the sanitizer (thin data)")
  if (speechSecs(lines) > MAX_SECS) issues.push(`audio runs about ${speechSecs(lines)} s, over ${MAX_SECS} s`)
  // The letter must show research: at least one public citation (TED or site) when the store holds any. A page built on a
  // hallway card is exempt: its "What we checked" line lists every public source read, and since round 7 a public fact
  // that does not itself touch the hallway process is left off rather than tied to it by an assumption.
  const kind = new Map(sources.map((x) => [x.id, x.kind]))
  const cited = [...opps.flatMap((o) => [...o.claim.source_ids, ...o.formula.input_source_ids]), ...lines.flatMap((l) => l.source_ids), ...extra.flatMap((c) => c.source_ids)]
  const publicInStore = sources.filter((x) => x.kind === "ted" || x.kind === "site").length
  const hallwayCard = opps.some((o) => o.claim.source_ids.some((id) => kind.get(id) === "hallway"))
  if (publicInStore && !hallwayCard && !cited.some((id) => kind.get(id) === "ted" || kind.get(id) === "site"))
    issues.push(`page cites no public source (TED or site) although the store holds ${publicInStore}`)
  // A cited public fact must not carry an uncited conclusion as if the source said it (the chips would make it look sourced).
  const why = letter?.why?.text && uncitedInference(letter.why.text)
  if (why) issues.push(`"Why it matters" states an uncited conclusion as fact: ${why.slice(0, 80)}`)
  for (const l of lines) {
    const x = l.source_ids.some((id) => kind.get(id) === "ted" || kind.get(id) === "site") && uncitedInference(l.text)
    if (x) issues.push(`audio line states an uncited conclusion as fact: ${x.slice(0, 80)}`)
  }
  // The headline's team multiplier is sourced from the hallway note: its cited hallway source must state that count.
  const t = letter?.teams
  if (t && !sources.some((x) => x.kind === "hallway" && t.source_ids.includes(x.id) && x.excerpt.includes(`about ${t.n}.`)))
    issues.push(`the headline scales by ${t.n} teams, but no cited hallway note states that count`)
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
  const ted = "buyer: väylävirasto. mipro tcs ja mipro tcs-o asetinlaitteiden. tenderer/winner incl. mipro oy."
  assert.deepEqual(suspectNames("You won Väylävirasto's Mipro TCS renewal.", ted), [])
  assert.deepEqual(suspectNames("Väylävirasto said Matti Virtanen wants it.", ted), ["Matti Virtanen"])
  const lead = (quote: string) => ({ quote, pain: "", next_step: "" }) as Lead
  assert.equal(isConfidential(lead("two of us retype it, three hours a day between us")), false)
  assert.equal(isConfidential(lead("Keep this between us, but the ERP is a mess.")), true)
  const euro = (text: string) => checkCompliance({ companyName: "X", lead: null, sources: [], opps: [], lines: [{ host: "A", text, source_ids: [] }] }).issues.some((i) => i.startsWith("euro"))
  assert.equal(euro("The euro figure is the smaller part."), false)
  assert.equal(euro("That is five thousand euros a year."), true)
  assert.equal(euro("About €5 800 a year, an estimate."), false)
  const src = (id: string, k: Source["kind"]) => ({ id, kind: k, title: "t", excerpt: "x" }) as Source
  const page = (letter: PageLetter | null) => checkCompliance({
    companyName: "X", lead: null, sources: [src("s_h", "hallway"), src("s_t", "ted")], letter,
    opps: [{ title: "t", claim: { text: "c", source_ids: ["s_h"] }, formula: { input_source_ids: [] } as never }],
    lines: [{ host: "A", text: "Velho's AI analysts here.", source_ids: [] }],
  }).issues
  assert.ok(!page(null).some((i) => i.startsWith("page cites no public source"))) // hallway card: exempt
  assert.ok(checkCompliance({ companyName: "X", lead: null, sources: [src("s_n", "note"), src("s_t", "ted")], letter: null,
    opps: [{ title: "t", claim: { text: "c", source_ids: ["s_n"] }, formula: { input_source_ids: [] } as never }], lines: [] }).issues.some((i) => i.startsWith("page cites no public source")))
  assert.ok(!page({ recipient: null, scale: null, questions: [], checked: { text: "A framework.", source_ids: ["s_t"] } }).some((i) => i.startsWith("page cites")))
  // teams: accepted when the cited hallway note states the count (src() excerpts say "x", so this one must fail)
  const teams = { recipient: null, scale: null, questions: [], checked: { text: "A framework.", source_ids: ["s_t"] }, teams: { n: 6, text: "About 6 teams like this one across X, as said in the hallway.", source_ids: ["s_h"] } }
  assert.ok(page(teams).some((i) => i.includes("scales by 6 teams")))
  const said = checkCompliance({ companyName: "X", lead: null, sources: [{ ...src("s_h", "hallway"), excerpt: `"q" (Lead) Asked how many teams like theirs across the company do this task: about 6.` }, src("s_t", "ted")], letter: teams, opps: [], lines: [] }).issues
  assert.ok(!said.some((i) => i.includes("teams")))
  const long = checkCompliance({ companyName: "X", lead: null, sources: [], opps: [], letter: null, lines: [{ host: "A", text: "Velho's AI analysts. " + "word ".repeat(215), source_ids: [] }] }).issues
  assert.ok(long.some((i) => i.startsWith("audio runs about")))
  const why = (text: string) => page({ recipient: null, scale: null, questions: [], checked: null, why: { text, source_ids: ["s_t"] } })
  assert.ok(why("You won the X framework in July 2026; every new framework adds parts orders.").some((i) => i.startsWith(`"Why it matters" states`)))
  assert.ok(!why("You won the X framework in July 2026. If its orders also arrive as PDFs, they add to the retyping.").some((i) => i.startsWith(`"Why it matters" states`)))
  const whyText = "You won the Lesy ČR harvester service framework in July 2026; every new service framework adds dealer parts orders that today get retyped from PDFs into the ERP."
  assert.equal(uncitedInference(whyText), "every new service framework adds dealer parts orders that today get retyped from PDFs into the ERP.")
  assert.equal(markInference({ text: whyText }).text, `You won the Lesy ČR harvester service framework in July 2026. ${ASSUME} every new service framework adds dealer parts orders that today get retyped from PDFs into the ERP.`)
  assert.equal(uncitedInference(markInference({ text: whyText }).text), null)
  const ok = "You won the Lesy ČR harvester service framework in July 2026. If its orders also arrive as PDFs, they add to the same retyping."
  assert.equal(uncitedInference(ok), null)
  assert.equal(markInference({ text: "Each new framework adds orders." }).text, `${ASSUME} each new framework adds orders.`)
  assert.equal(uncitedInference("Does each new framework add orders the same way?"), null)
  console.log("compliance self-check ok")
}
