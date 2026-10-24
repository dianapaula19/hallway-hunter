import { after } from "next/server"
import { get } from "@/lib/db.ts"
import { startNightPath } from "@/lib/night/pipeline.ts"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// POST {company_id, lead_id?, recipient?} -> starts the night path in the background and returns 202 {page_id, slug} at once.
// The path takes 23-41 s and the Matrix OS gateway cuts any request at 30 s, so /hq polls /api/hq for the
// "night_path" run (subject_id = page_id) instead of waiting on this response.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { company_id?: unknown; lead_id?: unknown; recipient?: unknown }
  const companyId = typeof body.company_id === "string" ? body.company_id : ""
  const leadId = typeof body.lead_id === "string" && body.lead_id ? body.lead_id : null
  const recipient = typeof body.recipient === "string" ? body.recipient : null
  if (!get("SELECT id FROM companies WHERE id = ?", companyId)) return Response.json({ error: "unknown company_id" }, { status: 400 })
  try {
    const { page_id, slug, done } = startNightPath(companyId, leadId, recipient)
    after(() => done.catch(() => {})) // failure is already recorded as an error night_path run
    return Response.json({ page_id, slug }, { status: 202 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
