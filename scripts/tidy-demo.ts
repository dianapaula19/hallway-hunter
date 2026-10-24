// Tidy demo data: per company, keep the newest draft waiting for approval and kill the older waiting ones,
// exactly as /hq's Kill does (approval REJECTED with a note, page 'killed'). Never deletes a row. Idempotent.
// Usage: node scripts/tidy-demo.ts [--dry]   (HH_DB, default data/hh.db; the app can keep running)
import { all, now, run } from "../lib/db.ts"

const dry = process.argv.includes("--dry")
const NOTE = "Superseded by a newer draft for the same company (scripts/tidy-demo.ts)."

const waiting = all<{ approval_id: string; page_id: string; company_id: string; company: string; created_at: string }>(
  `SELECT a.id AS approval_id, p.id AS page_id, p.company_id, c.name AS company, p.created_at
     FROM approvals a JOIN pages p ON p.id = a.ref_id JOIN companies c ON c.id = p.company_id
    WHERE a.status = 'PENDING' AND p.status = 'pending_approval'
    ORDER BY p.company_id, p.created_at DESC`)

const seen = new Set<string>()
let killed = 0
for (const w of waiting) {
  if (!seen.has(w.company_id)) { seen.add(w.company_id); continue } // newest per company stays
  console.log(`${dry ? "would kill" : "kill"}: ${w.company} draft from ${w.created_at} (${w.page_id})`)
  if (!dry) {
    run("UPDATE approvals SET status = 'REJECTED', note = ?, decided_at = ? WHERE id = ? AND status = 'PENDING'", NOTE, now(), w.approval_id)
    run("UPDATE pages SET status = 'killed' WHERE id = ?", w.page_id)
  }
  killed++
}
console.log(`${killed} older draft(s) ${dry ? "to kill" : "killed"}; ${seen.size} company draft(s) left waiting.`)

// Self-check: after a real run no company has two drafts waiting.
const dupes = all("SELECT p.company_id FROM approvals a JOIN pages p ON p.id = a.ref_id WHERE a.status = 'PENDING' AND p.status = 'pending_approval' GROUP BY p.company_id HAVING COUNT(*) > 1")
if (!dry && dupes.length) throw new Error(`still ${dupes.length} company(ies) with more than one waiting draft`)
