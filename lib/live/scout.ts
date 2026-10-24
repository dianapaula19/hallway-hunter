// Quick Scout: company -> cited <=120-word Brief. Evidence is pre-fetched in parallel so the model
// usually answers in one turn (the <40 s target); the tools stay available for a follow-up look.
import { all } from "../db.ts"
import { hasKey, runAgent, type Tool } from "../claude.ts"
import type { Brief, BriefRow, Claim, Company, Source } from "../types.ts"
import { evidenceBrief, finalizeBrief, storeBrief } from "./brief.ts"
import { loadCompany, prhSource } from "./prh.ts"
import { fetchSite } from "./site.ts"
import { tedSearch } from "./ted.ts"

const CLAIM = {
  type: "object", additionalProperties: false, required: ["text", "source_ids"],
  properties: { text: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } },
}
const BRIEF_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["what_they_do", "signals", "openers", "dont_say", "objection", "thin_data"],
  properties: {
    what_they_do: CLAIM,
    signals: { type: "array", items: CLAIM },
    openers: { type: "array", items: { type: "string" } },
    dont_say: { type: "string" },
    objection: CLAIM,
    thin_data: { type: "boolean" },
  },
}

const SYSTEM = `You are one of Velho's AI analysts. A Velho consultant is about to talk to someone from this company in a conference hallway and has 20 seconds to read your brief.
Rules:
- Use ONLY the sources listed (ids like src_xxx). Every claim's source_ids must be ids from that list. Never invent ids, URLs, numbers or names. Every word of a claim must be backed by the excerpt of a source it cites: no background knowledge.
- what_they_do: <=20 words. signals: exactly 2 recent, concrete facts (TED tenders/awards, site news, register changes), <=18 words each. If you cannot find 2 real signals, return fewer and set thin_data true. Do not pad.
- openers: exactly 3 short questions (<=12 words) the consultant can ask; they may only refer to facts in your cited claims.
- dont_say: one thing to avoid (<=10 words). objection: the most likely pushback (<=18 words), citing the source that makes it likely.
- Whole brief <=110 words. Plain English, no hype, no promises.
- Answer immediately if the listed sources suffice; call a tool only if a key fact is missing.`

const view = (s: Source) => ({ id: s.id, kind: s.kind, title: s.title, excerpt: s.excerpt, url: s.url })

function tools(company: Company): Tool<any>[] {
  return [
    {
      name: "prh_company", description: "Refresh the Finnish trade-register (PRH) record. Returns the stored source with its id.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => { await loadCompany(company.business_id!); return view(prhSource(company.id)!) },
    },
    {
      name: "ted_search", description: "EU public-procurement notices (TED) where the company is a tenderer or buyer. Returns sources with ids.",
      input_schema: { type: "object", properties: { limit: { type: "integer", description: "1-5, default 3" } }, additionalProperties: false },
      run: async (i: { limit?: number }) => (await tedSearch(company, Math.max(1, Math.min(5, i.limit ?? 3)))).map(view),
    },
    {
      name: "fetch_site", description: "GET one page of the company's own public website (text excerpt). Other domains are refused. Returns the source with its id, or null.",
      input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
      run: async (i: { url: string }) => { const s = await fetchSite(company, String(i.url)); return s ? view(s) : { error: "not fetched (off-site, blocked or empty)" } },
    },
  ]
}

export interface ScoutResult { brief: BriefRow; sources: Source[]; mode: "model" | "evidence"; note: string | null; ms: number }

export async function quickScout(company: Company): Promise<ScoutResult> {
  const t0 = Date.now()
  const prh = prhSource(company.id)
  if (!prh) throw new Error("company has no PRH source; call loadCompany first")
  const [ted, site] = await Promise.all([
    tedSearch(company, 3).catch(() => [] as Source[]),
    company.website ? fetchSite(company, company.website) : Promise.resolve(null),
  ])
  const evidence = [prh, ...(site ? [site] : []), ...ted]
  const fallbackWhat: Claim = evidenceBrief(company, prh, []).what_they_do

  let brief: Brief
  let runId: string | null = null
  let mode: ScoutResult["mode"] = "model"
  let note: string | null = null
  if (!hasKey()) {
    mode = "evidence"; note = "no API key: brief built straight from registry/TED evidence"
    brief = evidenceBrief(company, prh, [...ted, ...(site ? [site] : [])])
  } else {
    try {
      const r = await runAgent<Brief>({
        agent: "quick_scout", subjectId: company.id, system: SYSTEM, tools: tools(company),
        maxToolCalls: 5, effort: "low", maxTokens: 4000, schema: BRIEF_SCHEMA, timeoutMs: 15_000,
        prompt: `Company: ${company.name} (Y-tunnus ${company.business_id ?? "n/a"}, website ${company.website ?? "unknown"}).\nSources:\n${JSON.stringify(evidence.map(view), null, 1)}`,
      })
      runId = r.runId
      brief = finalizeBrief(company.id, r.json!, fallbackWhat, r.runId)
    } catch (e) {
      mode = "evidence"; note = `model failed (${e instanceof Error ? e.message : e}); evidence-only brief`
      brief = evidenceBrief(company, prh, [...ted, ...(site ? [site] : [])])
    }
  }
  if (mode === "evidence") brief = finalizeBrief(company.id, brief, fallbackWhat)
  const row = storeBrief(company.id, brief, runId)
  const sources = all<Source>("SELECT * FROM sources WHERE company_id = ?", company.id)
  const cited = new Set([brief.what_they_do, ...brief.signals, brief.objection].flatMap((c) => c.source_ids))
  return { brief: row, sources: sources.filter((s) => cited.has(s.id)), mode, note, ms: Date.now() - t0 }
}
