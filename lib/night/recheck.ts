// Re-run the deterministic compliance check on drafts already waiting for approval, with today's compliance.ts.
// A hold stored by an older version of the check (e.g. the "Luka Koper's RTG" false positive) then clears or stays
// on the current rules. No model call, no network, never approves. /api/hq runs it once per server process, so /hq
// never opens on a stale hold; scripts/recheck-compliance.ts runs it by hand (--dry to preview).
import { all, endRun, logStep, run, startRun } from "../db.ts"
import { checkCompliance } from "./compliance.ts"
import { loadContext } from "./researcher.ts"
import type { Approval, Opportunity, Page } from "../types.ts"

export function recheckWaiting(dry = false): { slug: string; company: string; was: Page["compliance"]; now: { ok: boolean; issues: string[] }; changed: boolean }[] {
  const waiting = all<Page & { approval_id: string; payload: Approval["payload"] }>(
    `SELECT p.*, a.id AS approval_id, a.payload FROM pages p JOIN approvals a ON a.ref_id = p.id
      WHERE a.status = 'PENDING' AND p.status = 'pending_approval' ORDER BY p.created_at`)
  return waiting.map((p) => {
    const ctx = loadContext(p.company_id, p.lead_id)
    const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", p.id)
    const now = checkCompliance({ companyName: ctx.company.name, lead: ctx.lead, sources: ctx.sources, opps, lines: p.script, letter: p.letter })
    const changed = JSON.stringify(p.compliance) !== JSON.stringify(now)
    if (changed && !dry) {
      const r = startRun("compliance", p.id, "deterministic")
      logStep(r, "info", "recheck", { was: p.compliance }, now)
      endRun(r, "ok", now.ok ? "ok (recheck)" : `${now.issues.length} issue(s) (recheck)`)
      run("UPDATE pages SET compliance = ? WHERE id = ?", now, p.id)
      // The approval body carries the compliance line too; keep it in step so the draft email is not stale.
      const line = now.ok ? "Compliance: ok." : `Compliance issues: ${now.issues.join("; ")}`
      const body = p.payload.body.split("\n").map((l) => (/^Compliance( issues)?:/.test(l) ? line : l)).join("\n")
      run("UPDATE approvals SET payload = ? WHERE id = ?", { ...p.payload, body }, p.approval_id)
    }
    return { slug: p.slug, company: ctx.company.name, was: p.compliance, now, changed }
  })
}
