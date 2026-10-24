// Cron entry: every lead from the last 24 h without a page -> runNightPath.  Usage: npm run night
import { all } from "../lib/db.ts"
import { runNightPath } from "../lib/night/pipeline.ts"

const since = new Date(Date.now() - 24 * 3600_000).toISOString()
const leads = all<{ id: string; company_id: string }>(
  "SELECT l.id, l.company_id FROM leads l WHERE l.created_at >= ? AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.lead_id = l.id)", since)
console.log(`${leads.length} lead(s) without a page`)
for (const l of leads) {
  try {
    const r = await runNightPath(l.company_id, l.id)
    console.log(`${l.id} -> /p/${r.slug}`)
  } catch (e) {
    console.error(`${l.id} failed: ${e instanceof Error ? e.message : e}`)
  }
}
