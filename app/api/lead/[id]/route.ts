import { run } from "@/lib/db.ts"

export const dynamic = "force-dynamic"

// Deletes the lead; FK ON DELETE CASCADE removes its hallway source row.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const r = run("DELETE FROM leads WHERE id = ?", id)
  return r.changes ? Response.json({ ok: true }) : Response.json({ error: "not found" }, { status: 404 })
}
