// Cold-run rehearsal through the real HTTP routes, timed per step (PRH 1 request, model 5 runs per company; --no-night: 2).
// Usage: node scripts/coldrun.mjs "<company name>" "<spoken-style note>" "<job title or empty>" [--no-night]   (BASE, default :3100)
// The note is saved as a demo note (synthetic). Space companies at least 20 s apart: PRH rate-limits bursts.
const BASE = process.env.BASE ?? "http://localhost:3100"
const [q, note, role] = process.argv.slice(2)
const noNight = process.argv.includes("--no-night")
const t = () => performance.now()
const post = async (path, body) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
const log = (step, ms, extra = "") => console.log(`${step.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(6)} s  ${extra}`)
const out = { q }

let a = t()
const cap = await post("/api/capture", { q })
log("capture (PRH search)", t() - a, `${cap.status} auto=${cap.j.auto} candidates=${(cap.j.candidates ?? []).map((c) => `${c.name} ${c.business_id}`).join(" | ")} suggestions=${(cap.j.suggestions ?? []).length}`)
const bid = cap.j.auto ?? cap.j.candidates?.find((c) => !c.ceased)?.business_id
if (!bid) { console.log("no company"); process.exit(1) }
const capMs = t() - a
a = t()
const sc = await post("/api/scout", { business_id: bid })
const scMs = t() - a
const b = sc.j.brief?.brief
log("scout (brief)", scMs, `${sc.status} mode=${sc.j.mode ?? "model"} words=${sc.j.brief?.word_count} thin=${b?.thin_data} sources=${(sc.j.sources ?? []).map((s) => s.kind).join(",")} ${sc.j.error ?? ""}`)
log("name to brief", capMs + scMs)
if (b) console.log("  what:", b.what_they_do.text, "\n  signals:", b.signals.map((s) => s.text).join(" / "))
const company = sc.j.company
out.company = company?.id

a = t()
const ld = await post("/api/lead", { company_id: company.id, transcript: note, synthetic: true, role })
log("note (lead_extract)", t() - a, `${ld.status} role=${ld.j.lead?.role} quote=${JSON.stringify(ld.j.lead?.quote)} ${ld.j.error ?? ""}`)
out.lead = ld.j.lead?.id
if (noNight) { console.log(JSON.stringify(out)); process.exit(0) }

a = t()
const nt = await post("/api/night", { company_id: company.id, lead_id: ld.j.lead.id, recipient: "COO" })
log("night start (202)", t() - a, `${nt.status} ${nt.j.slug ?? nt.j.error}`)
let run
for (;;) {
  await new Promise((r) => setTimeout(r, 2000))
  const hq = await (await fetch(BASE + "/api/hq", { cache: "no-store" })).json()
  run = hq.runs.find((r) => r.agent === "night_path" && r.subject_id === nt.j.page_id)
  if (run && run.status !== "running") {
    const stages = hq.runs.filter((r) => r.subject_id === nt.j.page_id && r.agent !== "night_path").reverse()
    for (const s of stages) console.log(`  ${s.agent.padEnd(14)} ${((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000).toFixed(1)} s ${s.status} ${s.tool_calls} tools`)
    break
  }
}
log("night path (polled)", t() - a, `${run.status} ${run.error ?? ""}`)
a = t()
const p = await fetch(`${BASE}/p/${nt.j.slug}`)
log("GET /p", t() - a, `${p.status}`)
out.slug = nt.j.slug
console.log(JSON.stringify(out))
