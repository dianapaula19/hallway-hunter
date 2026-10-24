// Agent Ops feeder: copies recent agent runs and approvals from both products into the
// Agent Ops app's Matrix tables (POST /api/bridge/query), so the app updates live via db.onChange.
// Read only on both sources. It never approves, edits or executes anything.
//
//   Velho : sqlite  agent_runs, approvals          (through lib/db.ts, HH_DB default data/hh.db; SELECT only)
//   Bahn  : postgres ring_runs, ring_proposals     (BAHN_DIR for its `postgres` package, BAHN_DATABASE_URL)
//
// Run from the hallway-hunter root:  node --env-file-if-exists=../.env matrix/agent-ops/feed.mjs [--once] [--dry]
// Env: MATRIX_GATEWAY_URL (default http://127.0.0.1:4000), MATRIX_TOKEN,
//      BAHN_DIR (default ../bahn-ring/starter), BAHN_DATABASE_URL (default: the starter's local compose DB)
import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

const GW = process.env.MATRIX_GATEWAY_URL ?? "http://127.0.0.1:4000"
const APP = "agent-ops"
const LIMIT = 200 // bridge bulk ops cap at 200 rows
const DRY = process.argv.includes("--dry")
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v) } catch { return null } }

async function velho() {
  if (!existsSync(process.env.HH_DB ?? "data/hh.db")) return { runs: [], approvals: [] }
  const { all } = await import("../../lib/db.ts")
  const runs = all("SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?", LIMIT).map((r) => ({
    src_key: `velho:${r.id}`, product: "velho", agent: r.agent, subject: r.subject_id ?? null, status: r.status,
    error: r.error ?? null, clock: "real", started_at: r.started_at, ended_at: r.ended_at ?? null,
  }))
  const approvals = all("SELECT * FROM approvals ORDER BY created_at DESC LIMIT ?", LIMIT).map((a) => ({
    src_key: `velho:${a.id}`, product: "velho", kind: a.kind, subject: a.ref_id, summary: parse(a.payload)?.subject ?? a.kind,
    status: a.status, trust_mode: "ask", clock: "real", created_at: a.created_at, decided_at: a.decided_at ?? null,
  }))
  return { runs, approvals }
}

async function bahn() {
  const dir = resolve(process.env.BAHN_DIR ?? "../bahn-ring/starter")
  if (!existsSync(join(dir, "node_modules/postgres"))) return { runs: [], approvals: [] }
  const postgres = createRequire(join(dir, "package.json"))("postgres")
  // Synthetic local-only credentials from the starter's .env.example; override on the box.
  const sql = postgres(process.env.BAHN_DATABASE_URL ?? "postgres://controlroom:controlroom@localhost:5438/controlroom", { max: 1 })
  try {
    const runs = (await sql`SELECT * FROM ring_runs ORDER BY started_at DESC LIMIT ${LIMIT}`).map((r) => ({
      src_key: `bahn:${r.id}`, product: "bahn", agent: `ring (${r.trigger})`, subject: r.order_id, status: r.status,
      error: r.error ?? null, clock: "sim", started_at: iso(r.started_at), ended_at: iso(r.ended_at),
    }))
    const approvals = (await sql`SELECT * FROM ring_proposals ORDER BY created_at DESC LIMIT ${LIMIT}`).map((p) => ({
      src_key: `bahn:${p.id}`, product: "bahn", kind: p.action_type, subject: p.order_id, summary: p.summary,
      status: p.status, trust_mode: p.trust_mode ?? null, clock: "sim", created_at: iso(p.created_at),
      decided_at: iso(p.review?.reviewedAt),
    }))
    return { runs, approvals }
  } catch (e) {
    console.error(`[bahn] ${e.message}`) // ring tables may not exist yet
    return { runs: [], approvals: [] }
  } finally { await sql.end() }
}

async function bridge(body) {
  const r = await fetch(`${GW}/api/bridge/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.MATRIX_TOKEN}` },
    body: JSON.stringify({ app: APP, ...body }),
  })
  if (!r.ok) throw new Error(`bridge ${body.action} ${body.table}: ${r.status} ${await r.text()}`)
  return r.json()
}

// Upsert by src_key: insert new rows, update rows whose fields changed, leave the rest.
export function diff(existing, incoming) {
  const byKey = new Map(existing.map((e) => [e.src_key, e]))
  const inserts = [], updates = []
  for (const row of incoming) {
    const old = byKey.get(row.src_key)
    if (!old) inserts.push(row)
    else if (Object.keys(row).some((k) => (old[k] ?? null) !== row[k])) updates.push({ id: old.id, data: row })
  }
  return { inserts, updates }
}

async function sync(table, rows, products) {
  if (DRY) return console.log(`[dry] ${table}: ${rows.length} source rows`)
  const existing = await bridge({ action: "find", table, filter: { product: { $in: products } }, limit: 10000 })
  const { inserts, updates } = diff(existing, rows)
  for (let i = 0; i < inserts.length; i += LIMIT) await bridge({ action: "bulkInsert", table, rows: inserts.slice(i, i + LIMIT) })
  for (let i = 0; i < updates.length; i += LIMIT) await bridge({ action: "bulkUpdate", table, updates: updates.slice(i, i + LIMIT) })
  if (inserts.length || updates.length) console.log(`[sync] ${table}: +${inserts.length} ~${updates.length}`)
}

async function tick() {
  const [v, b] = [await velho(), await bahn()]
  await sync("runs", [...v.runs, ...b.runs], ["velho", "bahn"])
  await sync("approvals", [...v.approvals, ...b.approvals], ["velho", "bahn"])
}

if (process.argv.includes("--check")) {
  const { default: assert } = await import("node:assert/strict")
  const d = diff([{ id: "u1", src_key: "a", status: "running" }, { id: "u2", src_key: "b", status: "ok" }],
    [{ src_key: "a", status: "ok" }, { src_key: "b", status: "ok" }, { src_key: "c", status: "running" }])
  assert.deepEqual(d.inserts.map((r) => r.src_key), ["c"])
  assert.deepEqual(d.updates, [{ id: "u1", data: { src_key: "a", status: "ok" } }])
  console.log("feed check ok")
} else {
  if (!DRY && !process.env.MATRIX_TOKEN) { console.error("MATRIX_TOKEN is not set (use --dry to test locally)"); process.exit(1) }
  const once = process.argv.includes("--once")
  do {
    try { await tick() } catch (e) { console.error(`[feed] ${e.message}`) }
    if (!once) await new Promise((r) => setTimeout(r, 10_000))
  } while (!once)
}
