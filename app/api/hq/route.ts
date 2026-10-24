import { all } from "@/lib/db.ts"
import { hasKey } from "@/lib/claude.ts"
import type { AgentRun, AgentStep, Approval, OutboxDraft } from "@/lib/types.ts"

export const dynamic = "force-dynamic"

// Board snapshot; /hq polls this every 2 s. Step payloads are clipped so the poll stays small.
const clip = (v: unknown) => {
  if (v == null) return null
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return s.length > 600 ? s.slice(0, 600) + " …" : s
}

export function GET() {
  const runs = all<AgentRun>("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 20")
  const steps = runs.length
    ? all<AgentStep>(`SELECT * FROM agent_steps WHERE run_id IN (${runs.map(() => "?").join(",")}) ORDER BY seq`, ...runs.map((r) => r.id))
    : []
  return Response.json({
    key: hasKey(),
    runs: runs.map((r) => ({
      ...r, output: clip(r.output),
      steps: steps.filter((s) => s.run_id === r.id).map((s) => ({ seq: s.seq, kind: s.kind, name: s.name, ms: s.ms, input: clip(s.input), output: clip(s.output) })),
    })),
    approvals: all<Approval>(
      `SELECT a.*, p.compliance, p.skeptic, p.status AS page_status, p.company_id, c.name AS company FROM approvals a
       LEFT JOIN pages p ON p.id = a.ref_id LEFT JOIN companies c ON c.id = p.company_id WHERE a.status = 'PENDING' ORDER BY a.created_at DESC`),
    outbox: all<OutboxDraft>("SELECT * FROM outbox ORDER BY created_at DESC LIMIT 20"),
    pages: all("SELECT p.id, p.slug, p.status, p.created_at, c.name AS company FROM pages p JOIN companies c ON c.id = p.company_id ORDER BY p.created_at DESC LIMIT 20"),
    // The night path opens on the hallway quote, so only companies with a saved lead can be picked.
    companies: all("SELECT id, name FROM companies c WHERE EXISTS (SELECT 1 FROM leads l WHERE l.company_id = c.id) ORDER BY created_at DESC LIMIT 50"),
    leads: all("SELECT id, company_id, role, created_at FROM leads ORDER BY created_at DESC LIMIT 100"),
  })
}
