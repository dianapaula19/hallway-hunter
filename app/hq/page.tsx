"use client"
import { useEffect, useState } from "react"
import posthog from "posthog-js"
import type { AgentRun, Approval, OutboxDraft, SkepticScore } from "@/lib/types.ts"
import s from "./hq.module.css"

type Step = { seq: number; kind: string; name: string; ms: number; input: string | null; output: string | null }
type Board = {
  key: boolean
  runs: (AgentRun & { steps: Step[] })[]
  approvals: (Approval & { compliance: { ok: boolean; issues: string[] } | null; skeptic: SkepticScore[] | null; page_status: string })[]
  outbox: OutboxDraft[]
  pages: { id: string; slug: string; status: string; created_at: string; company: string }[]
  companies: { id: string; name: string }[]
  leads: { id: string; company_id: string; role: string; created_at: string }[]
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const dur = (r: AgentRun) => `${(((r.ended_at ? Date.parse(r.ended_at) : Date.now()) - Date.parse(r.started_at)) / 1000).toFixed(1)}s`

export default function HQ() {
  const [b, setB] = useState<Board | null>(null)
  const [err, setErr] = useState("")
  const [company, setCompany] = useState("")
  const [lead, setLead] = useState("")
  const [busy, setBusy] = useState("")
  const [msg, setMsg] = useState("")

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch("/api/hq", { cache: "no-store" })
        if (alive) { setB(await r.json()); setErr("") }
      } catch (e) { if (alive) setErr(String(e)) }
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const runNight = async () => {
    const co = company || b?.companies[0]?.id
    if (!co) return
    setBusy("night"); setMsg("Night path running… watch the runs below.")
    const r = await fetch("/api/night", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company_id: co, lead_id: lead || undefined }) })
    const j = await r.json()
    if (r.ok && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      posthog.capture("night_path_completed", { has_selected_lead: Boolean(lead) })
    }
    setBusy(""); setMsg(r.ok ? `Done: /p/${j.slug} is waiting for approval.` : `Failed: ${j.error}`)
  }

  const leads = b?.leads.filter((l) => l.company_id === (company || b?.companies[0]?.id)) ?? []

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <div>
          <h1 className={s.h1}>Velho HQ</h1>
          <p className={s.muted}>Night path runs, gates and approvals. Approving only creates a local draft to our own inbox. Nothing is sent.</p>
        </div>
        {b && <span className={b.key ? s.ok : s.warn}>{b.key ? "API key loaded" : "No API key: offline templates"}</span>}
      </header>
      {err && <p className={s.warn}>Board offline: {err}</p>}

      <section className={s.panel}>
        <h2 className={s.h2}>Run night path now</h2>
        <div className={s.row}>
          <select value={company} onChange={(e) => { setCompany(e.target.value); setLead("") }}>
            {b?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">Latest lead (or none)</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.role} · {time(l.created_at)}</option>)}
          </select>
          <button className={s.primary} onClick={runNight} disabled={!!busy || !b?.companies.length}>{busy === "night" ? "Running…" : "Run"}</button>
        </div>
        {msg && <p className={s.muted}>{msg}</p>}
      </section>

      <section className={s.panel}>
        <h2 className={s.h2}>Pending approvals <span className={s.count}>{b?.approvals.length ?? 0}</span></h2>
        {!b?.approvals.length && <p className={s.muted}>Nothing waiting.</p>}
        {b?.approvals.map((a) => <ApprovalCard key={a.id} a={a} />)}
      </section>

      <section className={s.panel}>
        <h2 className={s.h2}>Agent runs <span className={s.count}>last 20</span></h2>
        <ul className={s.runs}>
          {b?.runs.map((r) => (
            <li key={r.id}>
              <details open={r.status === "running"}>
                <summary>
                  <span className={`${s.dot} ${s[r.status]}`} />
                  <strong>{r.agent}</strong>
                  <span className={s.muted}>{r.model} · {r.tool_calls} tools · {dur(r)} · {time(r.started_at)}</span>
                  {r.error && <span className={s.errText}>{r.error}</span>}
                </summary>
                <ol className={s.steps}>
                  {r.steps.map((st) => (
                    <li key={st.seq} className={s[`k_${st.kind}`]}>
                      <span className={s.stepName}>{st.kind} · {st.name}{st.ms ? ` · ${st.ms}ms` : ""}</span>
                      {st.input && st.kind !== "model" && <code>in: {st.input}</code>}
                      {st.output && <code>out: {st.output}</code>}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <div className={s.two}>
        <section className={s.panel}>
          <h2 className={s.h2}>Pages</h2>
          <ul className={s.list}>
            {b?.pages.map((p) => (
              <li key={p.id}>
                <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer">{p.company}</a> <span className={`${s.badge} ${s[`p_${p.status}`]}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={s.panel}>
          <h2 className={s.h2}>Outbox <span className={s.count}>drafts only</span></h2>
          {!b?.outbox.length && <p className={s.muted}>No drafts yet.</p>}
          <ul className={s.list}>
            {b?.outbox.map((o) => (
              <li key={o.id}>
                <details>
                  <summary>{o.subject} <span className={s.muted}>→ {o.to_addr}</span></summary>
                  <pre className={s.pre}>{o.body}</pre>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

function ApprovalCard({ a }: { a: Board["approvals"][number] }) {
  const [mode, setMode] = useState<"" | "edit" | "kill">("")
  const [subject, setSubject] = useState(a.payload.subject)
  const [body, setBody] = useState(a.payload.body)
  const [note, setNote] = useState("")
  const [out, setOut] = useState("")
  const blocked = !!a.compliance && !a.compliance.ok
  const rounds = a.skeptic ?? []
  const last = rounds.at(-1)

  const act = async (action: "approve" | "edit" | "kill") => {
    const r = await fetch(`/api/approvals/${a.id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note, final_payload: action === "edit" ? { subject, body } : undefined }),
    })
    const j = await r.json()
    if (r.ok && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      posthog.capture("approval_decided", { action })
    }
    setOut(r.ok ? j.status : j.error)
  }

  return (
    <article className={s.appr}>
      <div className={s.apprHead}>
        <strong>{a.payload.subject}</strong>
        <a href={`/p/${a.payload.page_slug}`} target="_blank" rel="noreferrer">Open page ↗</a>
      </div>
      <div className={s.gates}>
        <span className={blocked ? s.warn : s.ok}>{blocked ? `Compliance: ${a.compliance!.issues.length} issue(s)` : "Compliance ok"}</span>
        {rounds.map((r, i) => (
          <span key={i} className={Math.min(r.stop, r.read, r.reply) >= 7 ? s.ok : s.warn}>
            Skeptic r{i}: {r.stop}/{r.read}/{r.reply}
          </span>
        ))}
        {!rounds.length && <span className={s.warn}>Skeptic: not run</span>}
      </div>
      {blocked && <ul className={s.issues}>{a.compliance!.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {last?.notes && <p className={s.muted}>CEO notes: {last.notes}</p>}

      {mode === "edit" && (
        <div className={s.edit}>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      )}
      {mode === "kill" && <input className={s.note} placeholder="Why kill it? (required)" value={note} onChange={(e) => setNote(e.target.value)} />}

      <div className={s.row}>
        {mode === "" && <>
          <button className={s.primary} disabled={blocked} title={blocked ? "Blocked by compliance" : ""} onClick={() => act("approve")}>Approve</button>
          <button disabled={blocked} onClick={() => setMode("edit")}>Edit</button>
          <button onClick={() => setMode("kill")}>Kill</button>
        </>}
        {mode === "edit" && <><button className={s.primary} disabled={blocked} onClick={() => act("edit")}>Save as edited</button><button onClick={() => setMode("")}>Cancel</button></>}
        {mode === "kill" && <><button className={s.danger} disabled={!note.trim()} onClick={() => act("kill")}>Kill page</button><button onClick={() => setMode("")}>Cancel</button></>}
        {out && <span className={s.muted}>{out}</span>}
      </div>
    </article>
  )
}
