import { createDraft, get, now, run } from "@/lib/db.ts"
import type { Approval, Page } from "@/lib/types.ts"

export const dynamic = "force-dynamic"

// POST {action: approve|edit|kill, note?, final_payload?}. Approve/edit only ever create a LOCAL draft to our own inbox.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { action?: string; note?: unknown; final_payload?: Partial<Approval["payload"]> }
  const a = get<Approval>("SELECT * FROM approvals WHERE id = ?", id)
  if (!a) return Response.json({ error: "not found" }, { status: 404 })
  if (a.status !== "PENDING") return Response.json({ error: `already ${a.status}` }, { status: 409 })
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : ""
  const page = get<Page>("SELECT * FROM pages WHERE id = ?", a.ref_id)

  if (body.action === "kill") {
    if (!note) return Response.json({ error: "kill requires a note" }, { status: 400 })
    run("UPDATE approvals SET status = 'REJECTED', note = ?, decided_at = ? WHERE id = ?", note, now(), id)
    if (page) run("UPDATE pages SET status = 'killed' WHERE id = ?", page.id)
    return Response.json({ ok: true, status: "REJECTED" })
  }

  if (body.action !== "approve" && body.action !== "edit") return Response.json({ error: "action must be approve|edit|kill" }, { status: 400 })
  if (page && page.compliance && !page.compliance.ok) return Response.json({ error: "blocked by compliance", issues: page.compliance.issues }, { status: 409 })

  const fp = body.final_payload ?? {}
  const final: Approval["payload"] = body.action === "edit"
    ? { subject: String(fp.subject ?? a.payload.subject).slice(0, 300), body: String(fp.body ?? a.payload.body).slice(0, 10000), page_slug: a.payload.page_slug }
    : a.payload
  const status = body.action === "edit" ? "EDITED" : "APPROVED"
  run("UPDATE approvals SET status = ?, note = ?, final_payload = ?, decided_at = ? WHERE id = ?", status, note || null, final, now(), id)
  if (page) run("UPDATE pages SET status = 'approved' WHERE id = ?", page.id)
  const draft = createDraft(id, final.subject, final.body)
  return Response.json({ ok: true, status, draft_id: draft.id })
}
