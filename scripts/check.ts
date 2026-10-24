// Smallest check that fails if a hard rule in the schema breaks. Usage: npm run check
import { rmSync } from "node:fs"
import assert from "node:assert/strict"

process.env.HH_DB = "data/check.db"
rmSync("data/check.db", { force: true })
const { addSource, all, createDraft, insert, now, run, OWN_INBOX } = await import("../lib/db.ts")

insert("companies", { id: "co_t", name: "Test Oy (synthetic)", created_at: now() })
insert("leads", { id: "lead_t", company_id: "co_t", role: "COO", quote: "q", created_at: now() })
addSource({ company_id: "co_t", kind: "hallway", title: "t", excerpt: "q", lead_id: "lead_t" })

// deleting a lead deletes its hallway quote source
run("DELETE FROM leads WHERE id = ?", "lead_t")
assert.equal(all("SELECT id FROM sources WHERE lead_id = 'lead_t'").length, 0)

// outbox: drafts only, always to our own inbox
insert("approvals", { id: "ap_t", kind: "email", ref_id: "p", payload: { subject: "s", body: "b", page_slug: "x" }, created_at: now() })
const d = createDraft("ap_t", "s", "b")
assert.equal(d.to_addr, OWN_INBOX)
assert.throws(() => run("UPDATE outbox SET status = 'sent'"))

// briefs over 120 words are rejected by the DB
assert.throws(() => insert("briefs", { id: "b_t", company_id: "co_t", brief: {}, word_count: 121, created_at: now() }))

// formula inputs: the browser editor and the model output share one cap; junk falls back instead of becoming 0
const { clampInput } = await import("../lib/night/formula.ts")
assert.equal(clampInput("people", 99999999999), 10000)
assert.equal(clampInput("hours_per_week", -5), 0)
assert.equal(clampInput("hours_per_week", "", 2.5), 2.5)
assert.equal(clampInput("hours_per_week", "12e", 2.5), 2.5)
assert.equal(clampInput("automation_share", 2), 1)

rmSync("data/check.db", { force: true }); rmSync("data/check.db-wal", { force: true }); rmSync("data/check.db-shm", { force: true })
console.log("check ok")
