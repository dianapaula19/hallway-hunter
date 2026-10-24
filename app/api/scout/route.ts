import { SeverityNumber } from "@opentelemetry/api-logs"
import { after } from "next/server"
import { loggerProvider, posthogLogsLogger } from "@/instrumentation"
import { loadCompany, parseCompany, type PrhCompany } from "@/lib/live/prh.ts"
import { quickScout } from "@/lib/live/scout.ts"
import { latestBrief } from "@/lib/live/brief.ts"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET -> the newest stored (non-thin) brief, shown on /capture before the first lookup. No model call.
export function GET() {
  return Response.json({ example: latestBrief() })
}

// POST {business_id} -> company row + Quick Scout brief. A ceased company returns no brief, just the fact.
export async function POST(req: Request) {
  const t0 = Date.now()
  const { business_id } = (await req.json().catch(() => ({}))) as { business_id?: string }
  if (!business_id || !/^\d{7}-\d$/.test(business_id)) return Response.json({ error: "business_id (Y-tunnus) required" }, { status: 400 })
  let company
  try {
    company = await loadCompany(business_id)
  } catch (e) {
    posthogLogsLogger.emit({
      body: "quick_scout_completed",
      severityNumber: SeverityNumber.ERROR,
      attributes: { route: "/api/scout", outcome: "prh_lookup_failed", duration_ms: Date.now() - t0 },
    })
    after(async () => {
      await loggerProvider.forceFlush()
    })
    return Response.json({ error: `PRH lookup failed: ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
  const p = parseCompany(company.prh as PrhCompany)
  company = { ...company, prh: null } // raw PRH blob stays server-side
  if (p.ceased) {
    posthogLogsLogger.emit({
      body: "quick_scout_completed",
      severityNumber: SeverityNumber.INFO,
      attributes: { route: "/api/scout", outcome: "company_ceased", duration_ms: Date.now() - t0 },
    })
    after(async () => {
      await loggerProvider.forceFlush()
    })
    return Response.json({
      company, ceased: true, brief: null, sources: [],
      message: `${p.name} (${p.business_id}) has ceased${p.ceased_on ? ` (${p.ceased_on})` : ""} according to the PRH trade register. No brief: check whether the person now works for a successor company.`,
      ms: Date.now() - t0,
    })
  }
  try {
    const r = await quickScout(company)
    posthogLogsLogger.emit({
      body: "quick_scout_completed",
      severityNumber: SeverityNumber.INFO,
      attributes: { route: "/api/scout", outcome: "success", duration_ms: Date.now() - t0 },
    })
    after(async () => {
      await loggerProvider.forceFlush()
    })
    return Response.json({ company, ceased: false, situations: p.situations, ...r, ms: Date.now() - t0 })
  } catch (e) {
    posthogLogsLogger.emit({
      body: "quick_scout_completed",
      severityNumber: SeverityNumber.ERROR,
      attributes: { route: "/api/scout", outcome: "scout_failed", duration_ms: Date.now() - t0 },
    })
    after(async () => {
      await loggerProvider.forceFlush()
    })
    return Response.json({ company, error: `Scout failed: ${e instanceof Error ? e.message : e}` }, { status: 500 })
  }
}
