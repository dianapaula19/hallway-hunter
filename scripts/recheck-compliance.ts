// Re-run today's deterministic compliance check on drafts waiting for approval (lib/night/recheck.ts).
// /api/hq already does this once per server start; this is the manual version. No model call, no network.
// Usage: node scripts/recheck-compliance.ts [--dry]   (HH_DB, default data/hh.db; the app can keep running)
import { recheckWaiting } from "../lib/night/recheck.ts"

const dry = process.argv.includes("--dry")
const rows = recheckWaiting(dry)
for (const r of rows)
  console.log(`${r.company} ${r.slug}: ${r.was?.ok ? "clear" : `${r.was?.issues.length ?? "?"} issue(s)`} -> ${r.now.ok ? "clear" : r.now.issues.join("; ")}${r.changed ? "" : " (unchanged)"}`)
console.log(`${rows.length} waiting draft(s) rechecked${dry ? " (dry run, nothing written)" : ""}.`)
