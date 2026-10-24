import { loadCompany, parseCompany, type PrhCompany } from "@/lib/live/prh.ts"
import { quickScout } from "@/lib/live/scout.ts"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST {business_id} -> company row + Quick Scout brief. A ceased company returns no brief, just the fact.
export async function POST(req: Request) {
  const t0 = Date.now()
  const { business_id } = (await req.json().catch(() => ({}))) as { business_id?: string }
  if (!business_id || !/^\d{7}-\d$/.test(business_id)) return Response.json({ error: "business_id (Y-tunnus) required" }, { status: 400 })
  let company
  try {
    company = await loadCompany(business_id)
  } catch (e) {
    return Response.json({ error: `PRH lookup failed: ${e instanceof Error ? e.message : e}` }, { status: 502 })
  }
  const p = parseCompany(company.prh as PrhCompany)
  company = { ...company, prh: null } // raw PRH blob stays server-side
  if (p.ceased) {
    return Response.json({
      company, ceased: true, brief: null, sources: [],
      message: `${p.name} (${p.business_id}) has ceased${p.ceased_on ? ` (${p.ceased_on})` : ""} according to the PRH trade register. No brief: check whether the person now works for a successor company.`,
      ms: Date.now() - t0,
    })
  }
  try {
    const r = await quickScout(company)
    return Response.json({ company, ceased: false, situations: p.situations, ...r, ms: Date.now() - t0 })
  } catch (e) {
    return Response.json({ company, error: `Scout failed: ${e instanceof Error ? e.message : e}` }, { status: 500 })
  }
}
