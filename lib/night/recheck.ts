// Re-run the deterministic compliance check on drafts already waiting for approval, with today's compliance.ts.
// A hold stored by an older version of the check (e.g. the "Luka Koper's RTG" false positive) then clears or stays
// on the current rules. No model call, no network, never approves. /api/hq runs it once per server process, so /hq
// never opens on a stale hold; scripts/recheck-compliance.ts runs it by hand (--dry to preview).
import { all, endRun, logStep, run, startRun } from "../db.ts"
import { checkCompliance, markInference } from "./compliance.ts"
import { loadContext } from "./researcher.ts"
import type { Approval, Opportunity, Page } from "../types.ts"

export function recheckWaiting(dry = false): { slug: string; company: string; was: Page["compliance"]; now: { ok: boolean; issues: string[] }; changed: boolean }[] {
  const waiting = all<Page & { approval_id: string; payload: Approval["payload"] }>(
    `SELECT p.*, a.id AS approval_id, a.payload FROM pages p JOIN approvals a ON a.ref_id = p.id
      WHERE a.status = 'PENDING' AND p.status = 'pending_approval' ORDER BY p.created_at`)
  return waiting.map((p) => {
    const ctx = loadContext(p.company_id, p.lead_id)
    const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", p.id)
    // Today's sanitizer first: an uncited conclusion in the why line, or in an audio line citing a public source, is
    // marked as our assumption (deterministic, logged). Drafts made before that rule are repaired, not left on hold.
    const pub = new Set(ctx.sources.filter((x) => x.kind === "ted" || x.kind === "site").map((x) => x.id))
    const letter = p.letter?.why ? { ...p.letter, why: markInference(p.letter.why) } : p.letter
    const script = p.script.map((l) => (l.source_ids.some((id) => pub.has(id)) ? markInference(l) : l))
    const repaired = JSON.stringify([letter, script]) !== JSON.stringify([p.letter, p.script])
    if (repaired && !dry) {
      const r = startRun("compliance", p.id, "deterministic")
      logStep(r, "info", "mark_inference", { why: p.letter?.why?.text ?? null }, { why: letter?.why?.text ?? null, lines: script.filter((l, i) => l.text !== p.script[i].text).map((l) => l.text) })
      endRun(r, "ok", "uncited conclusion marked as our assumption (recheck)")
      run("UPDATE pages SET letter = ?, script = ? WHERE id = ?", letter, script, p.id)
    }
    const now = checkCompliance({ companyName: ctx.company.name, lead: ctx.lead, sources: ctx.sources, opps, lines: script, letter })
    const changed = repaired || JSON.stringify(p.compliance) !== JSON.stringify(now)
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
