// Re-run the deterministic compliance check on drafts already waiting for approval, with today's
// lib/night/compliance.ts. A hold stored by an older version of the check (e.g. the "Luka Koper's RTG"
// false positive) then clears or stays based on the current rules. No model call, no network.
// Each recheck is logged as a "compliance" run so /hq shows it. Never approves anything.
// Usage: node scripts/recheck-compliance.ts [--dry]   (HH_DB, default data/hh.db; the app can keep running)
import { all, endRun, logStep, run, startRun } from "../lib/db.ts"
import { checkCompliance } from "../lib/night/compliance.ts"
import { loadContext } from "../lib/night/researcher.ts"
import type { Approval, Opportunity, Page } from "../lib/types.ts"

const dry = process.argv.includes("--dry")
const waiting = all<Page & { approval_id: string; payload: Approval["payload"] }>(
  `SELECT p.*, a.id AS approval_id, a.payload FROM pages p JOIN approvals a ON a.ref_id = p.id
    WHERE a.status = 'PENDING' AND p.status = 'pending_approval' ORDER BY p.created_at`)

for (const p of waiting) {
  const ctx = loadContext(p.company_id, p.lead_id)
  const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", p.id)
  const now = checkCompliance({ companyName: ctx.company.name, lead: ctx.lead, sources: ctx.sources, opps, lines: p.script, letter: p.letter })
  const was = p.compliance
  const same = JSON.stringify(was) === JSON.stringify(now)
  console.log(`${ctx.company.name} ${p.slug}: ${was?.ok ? "clear" : `${was?.issues.length ?? "?"} issue(s)`} -> ${now.ok ? "clear" : now.issues.join("; ")}${same ? " (unchanged)" : ""}`)
  if (dry || same) continue
  const r = startRun("compliance", p.id, "deterministic")
  logStep(r, "info", "recheck", { was }, now)
  endRun(r, "ok", now.ok ? "ok (recheck)" : `${now.issues.length} issue(s) (recheck)`)
  run("UPDATE pages SET compliance = ? WHERE id = ?", now, p.id)
  // The approval body carries the compliance line too; keep it in step so the draft email is not stale.
  const line = now.ok ? "Compliance: ok." : `Compliance issues: ${now.issues.join("; ")}`
  const body = p.payload.body.split("\n").map((l) => (/^Compliance( issues)?:/.test(l) ? line : l)).join("\n")
  run("UPDATE approvals SET payload = ? WHERE id = ?", { ...p.payload, body }, p.approval_id)
}
console.log(`${waiting.length} waiting draft(s) rechecked${dry ? " (dry run, nothing written)" : ""}.`)
