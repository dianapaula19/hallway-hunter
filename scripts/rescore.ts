// Re-run the reader test (skeptic) on stored pages with today's inputs (computed hours, team scaling) and append
// the score as a new round, so /hq shows a current reason instead of one about maths that has since been fixed.
// One model run per page; changes nothing else on the page. Usage: node scripts/rescore.ts <slug> [<slug> …]   (HH_DB)
import { all, get, run } from "../lib/db.ts"
import { hoursFromQuote } from "../lib/night/hours.ts"
import { skepticScore } from "../lib/night/skeptic.ts"
import { loadContext } from "../lib/night/researcher.ts"
import type { Opportunity, Page } from "../lib/types.ts"

for (const slug of process.argv.slice(2)) {
  const p = get<Page>("SELECT * FROM pages WHERE slug = ?", slug)
  if (!p) { console.log(`${slug}: no such page`); continue }
  const ctx = loadContext(p.company_id, p.lead_id)
  const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", p.id)
  const h = hoursFromQuote(ctx.lead?.quote)
  const { score } = await skepticScore(p.id, ctx.company.name, opps, p.script, p.letter ?? {}, { hours: h?.working ?? null })
  run("UPDATE pages SET skeptic = ? WHERE id = ?", [...p.skeptic, score], p.id)
  const was = p.skeptic.at(-1)
  console.log(`${ctx.company.name} ${slug}: ${was ? `${was.stop}/${was.read}/${was.reply}` : "none"} -> ${score.stop}/${score.read}/${score.reply}. ${score.reply_why}\n  notes: ${score.notes}`)
}
