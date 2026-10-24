import { all } from "@/lib/db.ts"
import { extractLead } from "@/lib/live/lead.ts"
import type { Lead } from "@/lib/types.ts"

export const dynamic = "force-dynamic"

// POST {company_id, transcript} -> lead (role only, names scrubbed) + its hallway source.
export async function POST(req: Request) {
  const { company_id, transcript } = (await req.json().catch(() => ({}))) as { company_id?: string; transcript?: string }
  if (!company_id || !transcript?.trim()) return Response.json({ error: "company_id and transcript required" }, { status: 400 })
  try {
    return Response.json({ lead: await extractLead(company_id, transcript) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

// GET ?company_id= (optional) -> newest leads first, with company name.
export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("company_id")
  const sql = `SELECT l.*, c.name AS company_name FROM leads l JOIN companies c ON c.id = l.company_id ${id ? "WHERE l.company_id = ?" : ""} ORDER BY l.created_at DESC LIMIT 100`
  return Response.json({ leads: all<Lead & { company_name: string }>(sql, ...(id ? [id] : [])) })
}
