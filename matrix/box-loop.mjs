// Velho background loop for a Matrix OS box (or any always-on machine).
//   22:00 local : night path (scripts/night.ts: every lead from the last 24 h without a page)
//   07:30 local : digest of overnight runs + pages waiting for approval -> our own Telegram test chat
//
// Why a loop and not Matrix cron: in the Matrix source (gateway server.ts, cron onTrigger) a
// cron job only delivers its fixed `message` text to a channel. It cannot run a command.
// So the clock lives here, and Telegram delivery is a one-shot Matrix cron job (POST /api/cron).
// Nothing here sends email or contacts a company (CLAUDE.md rule 1). The digest goes only to a
// chat listed in TELEGRAM_ALLOWED_CHAT_IDS.
//
// Run from the repo root:  node --env-file-if-exists=../.env matrix/box-loop.mjs
// Flags: --register [cron.json] (add Matrix cron entries)  --digest (print digest now)  --once (one tick)  --dry (print, do not send)  --check (self-test)
// Env:   VELHO_TZ (Europe/Helsinki), MATRIX_GATEWAY_URL (default http://127.0.0.1:4000), MATRIX_TOKEN,
//        TELEGRAM_CHAT_ID (must be in TELEGRAM_ALLOWED_CHAT_IDS), HH_DB (default data/hh.db)
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const TZ = process.env.VELHO_TZ ?? "Europe/Helsinki"
const GW = process.env.MATRIX_GATEWAY_URL ?? "http://127.0.0.1:4000"
const STATE = process.env.VELHO_LOOP_STATE ?? join(homedir(), ".hallway-hunter-loop.json")
const TICK_MS = 5 * 60_000
const DRY = process.argv.includes("--dry")

// Local day + minutes-since-midnight in `tz`.
export function localClock(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(ms).map((x) => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) }
}

// A daily job is due once per local day, inside a 60 min window after its time (so a restart at
// 23:00 does not fire the 07:00 job late). Returns the day to mark as done, or null.
export function due(ms, hhmm, tz, lastDay) {
  const [h, m] = hhmm.split(":").map(Number)
  const { day, min } = localClock(ms, tz)
  const t = h * 60 + m
  return day !== lastDay && min >= t && min < t + 60 ? day : null
}

function loadState() { try { return JSON.parse(readFileSync(STATE, "utf8")) } catch { return {} } }
function saveState(s) { writeFileSync(STATE, JSON.stringify(s)) }

// Delivery goes through Matrix: a one-shot cron job fires immediately and removes itself
// (cron/service.ts "once" branch). Our code never calls Telegram directly.
export function ownChat() {
  const chatId = process.env.TELEGRAM_CHAT_ID
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  return chatId && allowed.includes(chatId) ? chatId : undefined
}

export async function sendViaMatrix(name, text) {
  const token = process.env.MATRIX_TOKEN, chatId = ownChat()
  const body = {
    name, message: text.slice(0, 3500),
    schedule: { type: "once", at: new Date().toISOString() },
    target: { channel: "telegram", chatId: chatId ?? "" },
  }
  if (DRY || !token || !chatId) { console.log(`[matrix] would send ${name}:\n${body.message}`); return }
  const r = await fetch(`${GW}/api/cron`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  })
  console.log(`[matrix] ${name} -> ${r.status}`)
}

// cron.json holds local times + "tz". Matrix's node-cron gets no timezone (cron/service.ts), so it
// runs in the gateway process TZ, ASSUMED UTC. Shift the hour using the offset at the next
// occurrence (now + 24h), which lands right across the 25 Oct 2026 EEST->EET switch.
export function utcCron(expr, tz, ms = Date.now()) {
  const [m, h, ...rest] = expr.split(" ")
  const at = ms + 24 * 3600_000
  const local = localClock(at, tz).min, utc = new Date(at).getUTCHours() * 60 + new Date(at).getUTCMinutes()
  const off = Math.round(((local - utc + 1440 + 720) % 1440 - 720) / 60)
  return [m, String((Number(h) - off + 24) % 24), ...rest].join(" ")
}

// Register cron.json entries that are not there yet (matched by name). POST /api/cron is used,
// not a file edit: the gateway re-reads cron.json from a cache, so file edits only apply after a
// gateway restart (cron/store.ts list() + server.ts watcher).
async function register(file) {
  const token = process.env.MATRIX_TOKEN, chatId = ownChat()
  if (!token) throw new Error("MATRIX_TOKEN is not set")
  const auth = { Authorization: `Bearer ${token}` }
  const existing = new Set((await (await fetch(`${GW}/api/cron`, { headers: auth })).json()).map((j) => j.name))
  for (const { tz, ...job } of JSON.parse(readFileSync(file, "utf8"))) {
    if (existing.has(job.name)) { console.log(`[cron] ${job.name} exists`); continue }
    if (job.target?.chatId === "${TELEGRAM_CHAT_ID}") {
      if (!chatId) { console.log(`[cron] ${job.name} skipped: TELEGRAM_CHAT_ID not set or not in TELEGRAM_ALLOWED_CHAT_IDS`); continue }
      job.target.chatId = chatId
    }
    if (tz && job.schedule.type === "cron") job.schedule.cron = utcCron(job.schedule.cron, tz)
    if (DRY) { console.log(`[cron] would add ${JSON.stringify({ ...job, target: job.target && { ...job.target, chatId: "<set>" } })}`); continue }
    const r = await fetch(`${GW}/api/cron`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(job) })
    console.log(`[cron] ${job.name} -> ${r.status}`)
  }
}

function nightPath() {
  const r = spawnSync(process.execPath, ["scripts/night.ts"], { stdio: "inherit" })
  console.log(`[night] scripts/night.ts exit ${r.status}`)
}

const parse = (v) => { if (typeof v !== "string") return v; try { return JSON.parse(v) } catch { return v } }

// Plain-text digest from the local DB (read only). Company names are whatever the DB holds.
export async function digest(day, sinceIso) {
  const { all } = await import("../lib/db.ts")
  const runs = all("SELECT agent, status, COUNT(*) AS n FROM agent_runs WHERE started_at >= ? GROUP BY agent, status ORDER BY agent", sinceIso)
  const pages = all("SELECT p.slug, c.name, p.compliance FROM pages p JOIN companies c ON c.id = p.company_id WHERE p.status = 'pending_approval' ORDER BY p.created_at")
  const pending = all("SELECT COUNT(*) AS n FROM approvals WHERE status = 'PENDING'")[0]?.n ?? 0
  const drafts = all("SELECT COUNT(*) AS n FROM outbox WHERE created_at >= ?", sinceIso)[0]?.n ?? 0
  const byAgent = {}
  for (const r of runs) (byAgent[r.agent] ??= []).push(`${r.n} ${r.status}`)
  const lines = [
    `Velho overnight digest, ${day} 07:30 ${TZ}. Velho draft, by Velho's AI analysts.`,
    "",
    `Agent runs since 19:30: ${Object.entries(byAgent).map(([a, v]) => `${a} ${v.join(", ")}`).join("; ") || "none"}`,
    `Waiting for your approval: ${pending}`,
    ...pages.map((p) => {
      const c = parse(p.compliance)
      return `- Made for ${p.name}: /p/${p.slug} (${c?.ok === false ? `compliance blocked: ${(c.issues ?? []).length} issue(s)` : "compliance ok"})`
    }),
    `Email drafts to our own inbox: ${drafts} (nothing is sent)`,
    "Approve, edit or kill in /hq.",
  ]
  return lines.join("\n")
}

async function tick() {
  const now = Date.now()
  const s = loadState()
  const night = due(now, "22:00", TZ, s.night)
  if (night) { try { nightPath() } catch (e) { console.error(`[night] ${e.message}`) } if (!DRY) saveState({ ...(s), night }) }
  const day = due(now, "07:30", TZ, s.digest)
  if (day) {
    try {
      await sendViaMatrix(`velho-digest-${day}`, await digest(day, new Date(now - 12 * 3600_000).toISOString()))
      if (!DRY) saveState({ ...loadState(), digest: day })
    } catch (e) { console.error(`[digest] ${e.message}`) }
  }
}

if (process.argv.includes("--check")) {
  const at = (iso) => Date.parse(iso)
  // 2026-10-24 is EEST (UTC+3); 2026-10-26 is EET (UTC+2) after the 25 Oct switch.
  assert.equal(due(at("2026-10-24T04:00:00Z"), "07:00", "Europe/Helsinki", null), "2026-10-24", "fires at 07:00 EEST")
  assert.equal(due(at("2026-10-24T03:59:00Z"), "07:00", "Europe/Helsinki", null), null, "not before")
  assert.equal(due(at("2026-10-24T04:30:00Z"), "07:00", "Europe/Helsinki", "2026-10-24"), null, "once per day")
  assert.equal(due(at("2026-10-24T05:00:00Z"), "07:00", "Europe/Helsinki", null), null, "window closes after 60 min")
  assert.equal(due(at("2026-10-26T05:10:00Z"), "07:00", "Europe/Helsinki", null), "2026-10-26", "07:10 EET")
  assert.equal(utcCron("0 7 * * *", "Europe/Helsinki", at("2026-10-23T12:00:00Z")), "0 4 * * *", "EEST tomorrow")
  assert.equal(utcCron("0 7 * * *", "Europe/Helsinki", at("2026-10-24T12:00:00Z")), "0 5 * * *", "EET after switch")
  assert.equal(utcCron("30 22 * * *", "Europe/Helsinki", at("2026-11-01T12:00:00Z")), "30 20 * * *", "evening")
  process.env.TELEGRAM_CHAT_ID = "111"; process.env.TELEGRAM_ALLOWED_CHAT_IDS = "222, 333"
  assert.equal(ownChat(), undefined, "chat not in allow-list is refused")
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "222,111"
  assert.equal(ownChat(), "111", "own chat allowed")
  assert.equal(due(at("2026-10-24T19:00:00Z"), "22:00", "Europe/Helsinki", null), "2026-10-24", "22:00 EEST")
  console.log("box-loop check ok")
} else if (process.argv.includes("--register")) {
  await register(process.argv[process.argv.indexOf("--register") + 1] ?? "matrix/cron.json")
} else if (process.argv.includes("--once")) {
  await tick()
} else if (process.argv.includes("--digest")) {
  const { day } = localClock(Date.now(), TZ)
  console.log(await digest(day, new Date(Date.now() - 12 * 3600_000).toISOString()))
} else {
  console.log(`[velho-loop] tz ${TZ}, tick ${TICK_MS / 60000} min, telegram ${process.env.MATRIX_TOKEN && ownChat() ? "on" : "off"}`)
  await tick()
  setInterval(tick, TICK_MS)
}
