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
  // The page is built on what someone at the company said. Without a note it is only questions from the public record
  // and reads weak (Tokmanni, no note: reader test 3/4/2), so a person-started run insists on one. Cron only runs leads.
  if (!get("SELECT id FROM leads WHERE company_id = ? AND (? IS NULL OR id = ?)", companyId, leadId, leadId))
    return Response.json({ error: "No hallway note for this company yet. Save one on /capture first: the page costs the task they described, and without one it is only questions." }, { status: 400 })
  try {
    // 0 rewrites: someone is watching /hq wait for this one (see startNightPath).
    const { page_id, slug, done } = startNightPath(companyId, leadId, recipient, 0)
    after(() => done.catch(() => {})) // failure is already recorded as an error night_path run
    return Response.json({ page_id, slug }, { status: 202 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
