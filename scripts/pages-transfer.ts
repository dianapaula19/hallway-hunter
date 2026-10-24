// Move finished pages from one copy of data/hh.db to another (a lane worktree's DB -> main's) without changing a row
// that is already there. For the merger: the cold-run pages then open on the main app.
//
//   HH_DB=<lane>/data/hh.db node scripts/pages-transfer.ts export <slug>... > pages.json
//   node scripts/pages-transfer.ts import pages.json            # dry run against HH_DB (default data/hh.db): prints the plan
//   node scripts/pages-transfer.ts import pages.json --apply    # same plan, written in one transaction
//
// A page carries its company, its lead, the company's sources (hallway rows only for that lead: other leads stay
// behind, rule 3), briefs, opportunities, approvals and their outbox drafts, and the agent runs (+ steps) whose
// subject is the page or the company. Import is insert-only: a row whose id exists is skipped when identical and
// reported as a conflict when it differs (never updated); a company whose Y-tunnus sits under another id aborts the
// whole import. No model call, no network. Afterwards: node scripts/tidy-demo.ts (kills the older draft per company)
// and node scripts/recheck-compliance.ts (or restart the server: /hq rechecks once per process).
import { readFileSync } from "node:fs"
import { db } from "../lib/db.ts"

type Row = Record<string, string | number | null>
const TABLES = ["companies", "leads", "sources", "briefs", "pages", "opportunities", "approvals", "outbox", "agent_runs", "agent_steps"] as const
type Dump = { version: 1; slugs: string[]; rows: Record<(typeof TABLES)[number], Row[]> }

// Raw rows (JSON columns stay text), so what lands is byte-identical to what left.
const q = (sql: string, ...p: (string | number | null)[]) => db().prepare(sql).all(...p) as Row[]
const ins = (sql: string, ...p: (string | number | null)[]) => (p.length ? `${sql} (${p.map(() => "?").join(",")})` : sql)

export function exportPages(slugs: string[]): Dump {
  const rows = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Dump["rows"]
  const add = (t: (typeof TABLES)[number], xs: Row[]) => { for (const x of xs) if (!rows[t].some((r) => r.id === x.id)) rows[t].push(x) }
  for (const slug of slugs) {
    const [page] = q("SELECT * FROM pages WHERE slug = ?", slug)
    if (!page) throw new Error(`no page with slug ${slug}`)
    const co = String(page.company_id), lead = page.lead_id as string | null
    add("companies", q("SELECT * FROM companies WHERE id = ?", co))
    if (lead) add("leads", q("SELECT * FROM leads WHERE id = ?", lead))
    add("sources", q("SELECT * FROM sources WHERE company_id = ? AND (kind != 'hallway' OR lead_id = ?) ORDER BY fetched_at", co, lead))
    add("briefs", q("SELECT * FROM briefs WHERE company_id = ? ORDER BY created_at", co))
    add("pages", [page])
    add("opportunities", q("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", String(page.id)))
    const appr = q("SELECT * FROM approvals WHERE ref_id = ?", String(page.id))
    add("approvals", appr)
    for (const a of appr) add("outbox", q("SELECT * FROM outbox WHERE approval_id = ?", String(a.id)))
    const runs = q("SELECT * FROM agent_runs WHERE subject_id IN (?, ?) ORDER BY started_at", String(page.id), co)
    add("agent_runs", runs)
    // Steps have an autoincrement id: matched by (run_id, seq) on import, so their own id is not carried over.
    for (const r of runs) for (const s of q("SELECT * FROM agent_steps WHERE run_id = ? ORDER BY seq", String(r.id))) { const { id: _, ...rest } = s; rows.agent_steps.push({ ...rest, id: `${s.run_id}#${s.seq}` }) }
  }
  return { version: 1, slugs, rows }
}

export function importPages(dump: Dump, apply: boolean): { insert: Record<string, number>; same: Record<string, number>; conflicts: string[] } {
  if (dump.version !== 1) throw new Error("unknown dump version")
  const insert: Record<string, number> = {}, same: Record<string, number> = {}, conflicts: string[] = []
  const d = db()
  d.exec("BEGIN IMMEDIATE")
  try {
    for (const t of TABLES) {
      for (const row of dump.rows[t] ?? []) {
        const { id, ...cols } = row
        const existing = t === "agent_steps"
          ? q("SELECT run_id, seq, kind, name, input, output, ms, created_at FROM agent_steps WHERE run_id = ? AND seq = ?", row.run_id, row.seq)[0]
          : q(`SELECT * FROM ${t} WHERE id = ?`, id)[0]
        const incoming = t === "agent_steps" ? cols : row
        if (existing) {
          const same_ = JSON.stringify(Object.keys(incoming).sort().map((k) => existing[k])) === JSON.stringify(Object.keys(incoming).sort().map((k) => incoming[k]))
          if (same_) same[t] = (same[t] ?? 0) + 1
          else conflicts.push(`${t} ${id}: already there with different content, left as it is`)
          continue
        }
        if (t === "companies" && row.business_id) {
          const other = q("SELECT id FROM companies WHERE business_id = ?", row.business_id)[0]
          if (other) throw new Error(`company ${row.name} (${row.business_id}) exists here as ${other.id}, not ${id}: nothing imported. Map it by hand.`)
        }
        const keys = Object.keys(incoming)
        d.prepare(ins(`INSERT INTO ${t} (${keys.join(",")}) VALUES`, ...keys.map((k) => incoming[k]))).run(...keys.map((k) => incoming[k]))
        insert[t] = (insert[t] ?? 0) + 1
      }
    }
    // Every imported page must open: its company exists and every source a card cites is here.
    for (const slug of dump.slugs) {
      const [p] = q("SELECT p.id, c.id AS co FROM pages p JOIN companies c ON c.id = p.company_id WHERE p.slug = ?", slug)
      if (!p) throw new Error(`page ${slug} missing after import`)
      for (const o of q("SELECT claim FROM opportunities WHERE page_id = ?", String(p.id)))
        for (const sid of (JSON.parse(String(o.claim)).source_ids as string[]))
          if (!q("SELECT 1 FROM sources WHERE id = ? AND company_id = ?", sid, String(p.co)).length) throw new Error(`page ${slug} cites ${sid}, which is not in the target DB`)
    }
    d.exec(apply ? "COMMIT" : "ROLLBACK")
  } catch (e) {
    d.exec("ROLLBACK")
    throw e
  }
  return { insert, same, conflicts }
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2)
  if (cmd === "export" && args.length) process.stdout.write(JSON.stringify(exportPages(args)) + "\n")
  else if (cmd === "import" && args[0]) {
    const apply = args.includes("--apply")
    const dump = JSON.parse(readFileSync(args[0], "utf8")) as Dump
    const r = importPages(dump, apply)
    console.log(`${apply ? "Imported" : "Dry run, nothing written. Would import"}: ${Object.entries(r.insert).map(([t, n]) => `${n} ${t}`).join(", ") || "nothing"}`)
    console.log(`Already there, identical: ${Object.entries(r.same).map(([t, n]) => `${n} ${t}`).join(", ") || "none"}`)
    for (const c of r.conflicts) console.log(`conflict: ${c}`)
    console.log(`Pages: ${dump.slugs.map((x) => `/p/${x}`).join(" ")}${apply ? "\nNext: node scripts/tidy-demo.ts --dry, then without --dry; node scripts/recheck-compliance.ts" : "\nRe-run with --apply to write."}`)
  } else {
    console.error("usage: pages-transfer.ts export <slug>... > pages.json | import pages.json [--apply]")
    process.exit(2)
  }
}
