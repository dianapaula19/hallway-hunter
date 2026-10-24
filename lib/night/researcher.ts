// Researcher: evidence store (+ LIVE's site/TED fetchers) -> exactly 3 cited opportunities with euro formulas.
import { all, get, knownSourceIds } from "../db.ts"
import { runAgent, type Tool } from "../claude.ts"
import type { Claim, Company, EuroFormula, Lead, Source } from "../types.ts"
import { fetchSite } from "../live/site.ts"
import { tedSearch } from "../live/ted.ts"
import { normalizeFormula } from "./formula.ts"
import { sanitizeClaims } from "./sanitize.ts"

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
  type: "object", additionalProperties: false, required: ["opportunities"],
  properties: {
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
Find exactly 3 concrete, unglamorous opportunities where software or AI could remove recurring manual work.
Card 1 addresses the hallway pain, if there is one, using its concrete details (e.g. "every Friday afternoon" is about 4 h/week per person).
Cards 2 and 3 each start from one specific public signal (a named tender, award or site fact) and name the recurring manual process it makes likely.
Rules:
- Every claim cites source ids that exist in the evidence store (ids look like src_...). Never invent an id or a URL.
- If evidence is thin, say "thin data" in the claim instead of padding.
- Each opportunity gets a euro formula: hours_per_week x people x weeks_per_year x hourly_cost_eur x automation_share (0..1).
  Put a source id in input_source_ids only when that source actually supports one of the inputs; otherwise leave it empty (it becomes a sector estimate).
  people is the team that does the task. If no source gives it, size it as one plausible team or pilot site for a company of this size and say "one team of N" in the claim.
  Be conservative: Finnish loaded labour cost is typically 35-60 €/h, weeks_per_year about 46, automation_share rarely above 0.6.
- No promises ("guarantee", "will save", "we will"). No personal names. Titles max 7 words, claims max 30 words, plain CEO English.
- Tools: search_sources reads the evidence store; ted_search and fetch_site add new public evidence (read-only). Use them sparingly.`

export async function research(ctx: NightContext, pageId: string): Promise<{ runId: string; opportunities: DraftOpportunity[]; dropped: number }> {
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

  const lead = ctx.lead ? `Hallway lead (role: ${ctx.lead.role}): pain "${ctx.lead.pain}", quote "${ctx.lead.quote}".` : "No hallway lead."
  const r = await runAgent<{ opportunities: { title: string; claim: Claim; formula: Partial<EuroFormula> }[] }>({
    agent: "researcher", subjectId: pageId, system: SYSTEM, tools, maxToolCalls: 8, effort: "medium", schema: SCHEMA,
    prompt: `Company: ${company.name}${company.business_id ? ` (Y-tunnus ${company.business_id})` : ""}\n${lead}\n\nEvidence store:\n${sourceList(ctx.sources) || "(empty)"}\n\nReturn exactly 3 opportunities.`,
  })

  const raw = r.json?.opportunities ?? []
  const known = knownSourceIds(company.id) // re-read: tools may have added sources
  const { kept } = sanitizeClaims(company.id, raw.map((o) => o.claim), r.runId)
  const opportunities = raw
    .filter((o) => kept.includes(o.claim))
    .slice(0, 3)
    .map((o) => ({ title: String(o.title).slice(0, 80), claim: o.claim, formula: normalizeFormula(o.formula, known) }))
  return { runId: r.runId, opportunities, dropped: raw.length - kept.length }
}
