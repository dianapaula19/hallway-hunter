import { get } from "@/lib/db.ts"
import { hasKey, MODEL } from "@/lib/claude.ts"

export const dynamic = "force-dynamic"

// Liveness + config check. Never returns the key itself.
export function GET() {
  const runs = get<{ n: number }>("SELECT COUNT(*) AS n FROM agent_runs")?.n ?? 0
  return Response.json({ ok: true, model: MODEL, key: hasKey(), runs })
}
