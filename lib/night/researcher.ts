// Researcher: evidence store (+ LIVE's site/TED fetchers) -> 1-3 cited opportunities with euro formulas (only cards with real evidence).
import { all, get, knownSourceIds } from "../db.ts"
import { runAgent, type Tool } from "../claude.ts"
import type { Claim, Company, EuroFormula, Lead, Source } from "../types.ts"
import { fetchSite } from "../live/site.ts"
import { tedSearch } from "../live/ted.ts"
import { normalizeFormula } from "./formula.ts"
import { hoursFromQuote } from "./hours.ts"
import { ASSUME, markInference } from "./compliance.ts"
import { needsSource, sanitizeClaims } from "./sanitize.ts"

// Words that make a sentence factual under the sanitizer's rule: digits, €/%, and capitalised words after a sentence start.
export const factWords = (t: string) =>
  t.split(/(?<=[.!?;:])\s+/).flatMap((s) => s.split(/\s+/).slice(1)).map((w) => w.replace(/^[^\p{L}\d€%]+|[^\p{L}\d€%]+$/gu, ""))
    .filter((w) => /[\d€%]/.test(w) || /^\p{Lu}/u.test(w))

export interface NightContext { company: Company; lead: Lead | null; sources: Source[] }
export interface DraftOpportunity { title: string; claim: Claim; formula: EuroFormula }

export function loadContext(companyId: string, leadId?: string | null): NightContext {
  const company = get<Company>("SELECT * FROM companies WHERE id = ?", companyId)
  if (!company) throw new Error(`unknown company ${companyId}`)
  const lead = leadId
    ? get<Lead>("SELECT * FROM leads WHERE id = ? AND company_id = ?", leadId, companyId) ?? null
    : get<Lead>("SELECT * FROM leads WHERE company_id = ? ORDER BY created_at DESC LIMIT 1", companyId) ?? null
  const sources = all<Source>("SELECT * FROM sources WHERE company_id = ? ORDER BY fetched_at", companyId)
    // a hallway source belonging to a different lead is not this page's evidence
    .filter((s) => s.kind !== "hallway" || !lead || s.lead_id === lead.id)
  return { company, lead, sources }
}

export const sourceList = (sources: Source[]) =>
  sources.map((s) => `- ${s.id} [${s.kind}] ${s.title}: ${s.excerpt.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")

const brief = (s: Source) => ({ id: s.id, kind: s.kind, title: s.title, url: s.url, excerpt: s.excerpt })

const CLAIM = {
  type: "object", additionalProperties: false, required: ["text", "source_ids"],
  properties: { text: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } },
}
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["opportunities", "why", "path", "questions"],
  properties: {
    why: CLAIM,
    path: CLAIM,
    questions: { type: "array", items: CLAIM },
    opportunities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "claim", "formula"],
        properties: {
          title: { type: "string" },
          claim: CLAIM,
          formula: {
            type: "object", additionalProperties: false,
            required: ["hours_per_week", "people", "weeks_per_year", "hourly_cost_eur", "automation_share", "input_source_ids"],
            properties: {
              hours_per_week: { type: "number" }, people: { type: "number" }, weeks_per_year: { type: "number" },
              hourly_cost_eur: { type: "number" }, automation_share: { type: "number" },
              input_source_ids: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  },
}

const SYSTEM = `You are one of Velho's AI analysts preparing a private one-page draft for a Finnish company's CEO.
Return 1 to 3 concrete, unglamorous opportunities where software or AI could remove recurring manual work. Fewer is better:
one sharp card the CEO recognises beats three guesses. A card exists only if a cited source itself names the manual task.
- Card 1 is the hallway pain, if there is one, using its concrete details (e.g. "every Friday afternoon" is about 4 h/week per person).
- Add a card 2 or 3 only when a public source (a named tender, award or site page) explicitly describes a recurring process
  (e.g. a multi-year maintenance framework, per-site reporting). A product sale, a single delivery or a generic site blurb is NOT
  enough: do not infer paperwork from it. If in doubt, leave the card out.
Rules:
- Every claim cites source ids that exist in the evidence store (ids look like src_...). Never invent an id or a URL.
  If a public source genuinely corroborates the hallway card (e.g. their own site describes the service that task belongs to), cite it too.
- Write claims as plain statements of what the source shows. No "likely", "points to", "thin data" or apologies.
- Each opportunity gets a euro formula: hours_per_week x people x weeks_per_year x hourly_cost_eur x automation_share (0..1).
  Put a source id in input_source_ids only when that source actually supports one of the inputs; otherwise leave it empty (it becomes a sector estimate).
  hours_per_week is PER PERSON: if the source gives a team total ("two of us, three hours a day"), divide it (people 2, 7.5 h/week each).
  If an input is assumed rather than stated, say so in the claim ("assuming four visits a week"), and say why the automation share ("a person still checks each order").
  State hours both ways in the claim: per person and for the team ("7.5 h a week each, 15 h for the team").
  people is the team that does the task. If no source gives it, use a small pilot team (2-5) and say "a pilot team of N" in the claim.
  Be conservative: Finnish loaded labour cost is typically 35-60 €/h, weeks_per_year about 46, automation_share rarely above 0.6.
- No promises ("guarantee", "will save", "we will"). No personal names. Titles max 7 words, claims max 40 words, plain CEO English.
- Tools: search_sources reads the evidence store; ted_search and fetch_site add new public evidence (read-only). Use them sparingly.
- Never scale people to the company's headcount, dealer count or store count: nobody said those people do this task. The company-level case goes in "why" and "path" below, in words.
Also return:
- why: ONE or TWO short sentences (max 40 words) the COO or CEO reads FIRST, at the top of the page: the company-level reason
  this process matters, from a PUBLIC source in the store (a TED award or framework with its month, the company's own site such
  as its dealer network, service offer or size, or the trade register's industry line). First the public fact, stated only as
  far as the cited source states it. Then the tie to card 1's process, which no source states, so write it as a clearly marked
  conditional or question, never as fact: e.g. "You won the Lesy ČR harvester service framework in July 2026. If its service
  orders reach your dealers' parts desk as PDFs too, they join the retyping." Never "every new framework adds orders" or
  "this brings more reporting" as a statement. Cite the public source (and the hallway source if you repeat its detail).
  A public source unrelated to the process or the company's scale (e.g. a one-off sale of one machine) is not a reason: then
  return empty text and empty source_ids. No company blurb, no number in the tie.
- path: ONE sentence (max 30 words) framing card 1 as a pilot when its team is small (people 5 or fewer): start with card 1's
  process, then name what the same fix reaches next, e.g. "Start with dealer parts orders; the same reader then handles warranty
  claims and service reports." Name a further process only if a cited source mentions it, and cite it; cite the hallway source
  when you repeat its detail. Otherwise write it with no
  digits and no names ("then the next document type your team retypes") and empty source_ids. Empty text when there is no card.
- questions: only when there is NO hallway lead: 2 or 3 short questions we would ask their COO, each tied to one public source
  that shows a recurring process (a framework, many call-offs, many sites or stores), citing it, e.g. "You supply 14 municipalities
  under one food framework (TED ...): how do their call-off orders reach your order system today?". No questions about
  what a source does not show. With a hallway lead, return an empty list.`

export async function research(ctx: NightContext, pageId: string): Promise<{ runId: string; opportunities: DraftOpportunity[]; why: Claim | null; path: Claim | null; questions: Claim[]; dropped: number }> {
  const { company } = ctx
  const tools: Tool<any>[] = [
    {
      name: "search_sources",
      description: "Search this company's evidence store (title + excerpt, case-insensitive). Empty query returns everything. Returns sources with ids to cite.",
      input_schema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
      strict: true,
      run: async ({ query }: { query: string }) => {
        const q = `%${String(query ?? "").slice(0, 100)}%`
        return all<Source>("SELECT * FROM sources WHERE company_id = ? AND (title LIKE ? OR excerpt LIKE ?) LIMIT 20", company.id, q, q).map(brief)
      },
    },
    {
      name: "ted_search",
      description: "Search EU public procurement notices (TED) mentioning this company. Persists hits as sources and returns them with ids.",
      input_schema: { type: "object", additionalProperties: false, required: [], properties: {} },
      run: async () => (await tedSearch(company, 3)).map(brief),
    },
    {
      name: "fetch_site",
      description: "GET one page of the company's own public website and store a text excerpt as a source. Only URLs on the company's own domain; anything else returns nothing.",
      input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } },
      strict: true,
      run: async ({ url }: { url: string }) => {
        const s = await fetchSite(company, url) // LIVE's guard: own domain only, GET, 8 s timeout
        return s ? brief(s) : "nothing fetched"
      },
    },
  ]

  const h = hoursFromQuote(ctx.lead?.quote)
  const lead = ctx.lead ? `Hallway lead (role: ${ctx.lead.role}): pain "${ctx.lead.pain}", quote "${ctx.lead.quote}".${h ? `\nHours, converted in code from the quote (use exactly these numbers in card 1's claim and formula): ${h.working}.` : ""}${ctx.lead.teams ? `\nAsked in the hallway, they said about ${ctx.lead.teams} teams like theirs across the company do this task. The page scales the headline by that count itself: keep card 1's people as the one team met.` : ""}` : "No hallway lead."
  const r = await runAgent<{ opportunities: { title: string; claim: Claim; formula: Partial<EuroFormula> }[]; why?: Claim; path?: Claim; questions?: Claim[] }>({
    agent: "researcher", subjectId: pageId, system: SYSTEM, tools, maxToolCalls: 8, effort: "medium", schema: SCHEMA,
    prompt: `Company: ${company.name}${company.business_id ? ` (Y-tunnus ${company.business_id})` : ""}\n${lead}\n\nEvidence store:\n${sourceList(ctx.sources) || "(empty)"}\n\nReturn 1-3 opportunities, only those a cited source directly supports.`,
  })

  const raw = r.json?.opportunities ?? []
  const known = knownSourceIds(company.id) // re-read: tools may have added sources
  const { kept } = sanitizeClaims(company.id, raw.map((o) => o.claim), r.runId)
  const opportunities = raw
    .filter((o) => kept.includes(o.claim))
    .slice(0, 3)
    .map((o) => ({ title: String(o.title).slice(0, 80), claim: o.claim, formula: normalizeFormula(o.formula, known) }))
  // "why" must lean on a public source (TED, own site or the trade register); anything else is dropped, not shown uncited.
  const pub = new Set(all<{ id: string }>("SELECT id FROM sources WHERE company_id = ? AND kind IN ('ted', 'site', 'prh')", company.id).map((x) => x.id))
  const w = r.json?.why
  // Then the uncited tie is marked as our assumption (sanitize.ts); a line that is only an assumption is no reason at all.
  const cleanWhy = w?.text?.trim() && opportunities.length
    ? sanitizeClaims(company.id, [w], r.runId).kept.find((k) => k.source_ids.some((id) => pub.has(id))) ?? null
    : null
  const why = cleanWhy && !markInference(cleanWhy).text.startsWith(ASSUME) ? markInference(cleanWhy) : null
  // "path" may go uncited only when it states no fact (no digit, €, % or proper noun), the script-line rule. When its only
  // facts are card 1's own words ("Start with PDF orders into SAP; …"), it cites card 1's sources rather than being dropped.
  const pt = r.json?.path
  const card1 = opportunities[0] ? `${opportunities[0].title} ${opportunities[0].claim.text} ${ctx.lead?.quote ?? ""}`.toLowerCase() : ""
  const path = pt?.text?.trim() && opportunities.length
    ? pt.source_ids?.length ? sanitizeClaims(company.id, [pt], r.runId).kept[0] ?? null
      : !needsSource(pt.text, company.name) ? { text: pt.text.trim(), source_ids: [] }
      : factWords(pt.text).every((w) => card1.includes(w.toLowerCase())) ? { text: pt.text.trim(), source_ids: opportunities[0].claim.source_ids }
      : null
    : null
  const questions = ctx.lead ? [] : sanitizeClaims(company.id, r.json?.questions ?? [], r.runId).kept.slice(0, 3)
  return { runId: r.runId, opportunities, why, path, questions, dropped: raw.length - kept.length }
}

// Self-check (no model call): node lib/night/researcher.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  assert.deepEqual(factWords("Start with emailed PDF orders into SAP; the same reader then handles the next type."), ["PDF", "SAP"])
  assert.deepEqual(factWords("Start small, then the next document type your team retypes."), [])
  assert.deepEqual(factWords("Then warranty claims for 40 Dealers."), ["40", "Dealers"])
  console.log("researcher self-check ok")
}
