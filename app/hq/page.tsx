"use client"
import { useEffect, useState } from "react"
import posthog from "posthog-js"
import type { AgentRun, Approval, OutboxDraft, SkepticScore } from "@/lib/types.ts"
import { withBase, newTab } from "@/lib/base.ts"
import { Wordmark } from "../wordmark"
import s from "./hq.module.css"

type Step = { seq: number; kind: string; name: string; ms: number; input: string | null; output: string | null }
type Board = {
  key: boolean
  runs: (AgentRun & { steps: Step[] })[]
  approvals: (Approval & { compliance: { ok: boolean; issues: string[] } | null; skeptic: SkepticScore[] | null; page_status: string; company_id: string | null; company: string | null })[]
  outbox: OutboxDraft[]
  pages: { id: string; slug: string; status: string; created_at: string; company: string }[]
  companies: { id: string; name: string }[]
  leads: { id: string; company_id: string; role: string; created_at: string }[]
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
const PAGE_STATUS: Record<string, string> = { draft: "Being written", pending_approval: "Waiting", approved: "Approved", killed: "Killed" }
const DECISION: Record<string, string> = { APPROVED: "Approved. A draft email is in the outbox.", EDITED: "Approved with edits. A draft email is in the outbox.", REJECTED: "Killed." }
const AGENT: Record<string, string> = {
  night_path: "Night path", researcher: "Research", showrunner: "Audio script", skeptic_ceo: "Reader test", compliance: "Compliance check",
  quick_scout: "Quick brief", vision_extract: "Badge reading", lead_extract: "Voice note", digest: "Digest",
}
const dur = (r: AgentRun) => `${(((r.ended_at ? Date.parse(r.ended_at) : Date.now()) - Date.parse(r.started_at)) / 1000).toFixed(1)}s`

export default function HQ() {
  const [b, setB] = useState<Board | null>(null)
  const [err, setErr] = useState("")
  const [company, setCompany] = useState("")
  const [lead, setLead] = useState("")
  const [recipient, setRecipient] = useState("COO") // who the page is framed for; "" = the role met
  const [busy, setBusy] = useState("")
  const [msg, setMsg] = useState("")
  const [job, setJob] = useState<{ pageId: string; slug: string; name?: string } | null>(null) // night path started, not yet finished

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const r = await fetch(withBase("/api/hq"), { cache: "no-store" })
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
    const name = b?.companies.find((c) => c.id === co)?.name
    setBusy("night"); setMsg(`Starting the night path for ${name}…`)
    try {
      // 202 at once; the path itself runs 23-41 s server-side and the board poll below picks up the result.
      const r = await fetch(withBase("/api/night"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company_id: co, lead_id: lead || undefined, recipient: recipient || undefined }) })
      const j = await r.json()
      if (!r.ok) { setMsg(`Could not start: ${j.error}`); setBusy(""); return }
      setJob({ pageId: j.page_id, slug: j.slug, name })
      setMsg(`Night path running for ${name} (usually 25-40 s)… watch the runs below.`)
    } catch { setMsg("Could not start: lost the connection to the server. Check the runs below before running again."); setBusy("") }
  }

  // Finish the job when its "night_path" run (subject = page id) shows up as ended in the polled board.
  const jobRun = job ? b?.runs.find((r) => r.agent === "night_path" && r.subject_id === job.pageId) : undefined
  useEffect(() => {
    if (!job || !jobRun || jobRun.status === "running") return
    if (jobRun.status === "ok") {
      if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) posthog.capture("night_path_completed", { has_selected_lead: Boolean(lead) })
      setMsg(`Done: the ${job.name} page /p/${job.slug} is waiting for approval.`)
    } else setMsg(`Failed: the night path for ${job.name} stopped and no page was kept. Reason: ${jobRun.error ?? "unknown"}. Nothing was sent.`)
    setJob(null); setBusy("")
  }, [job, jobRun, lead])

  // Withdrawn pages stay reachable but fold away; the list leads with what is live.
  const live = b?.pages.filter((p) => p.status !== "killed") ?? []
  const withdrawn = b?.pages.filter((p) => p.status === "killed") ?? []
  const pageItem = (p: Board["pages"][number]) => (
    <li key={p.id}>
      <a href={withBase(`/p/${p.slug}`)} {...newTab}>{p.company}</a>
      <span className={s.status} data-s={p.status}>{PAGE_STATUS[p.status] ?? p.status}</span>
      <span className={s.time}>{when(p.created_at)}</span>
    </li>
  )

  const leads = b?.leads.filter((l) => l.company_id === (company || b?.companies[0]?.id)) ?? []

  // One group per company: the newest draft up front, older versions behind "N earlier versions" (approvals come newest first).
  const groups = new Map<string, Board["approvals"]>()
  for (const a of b?.approvals ?? []) groups.set(a.company_id ?? a.id, [...(groups.get(a.company_id ?? a.id) ?? []), a])

  return (
    <main className={`container ${s.wrap}`}>
      <header className={s.top}>
        <Wordmark product="HQ" href="/hq" />
        <span className={s.internal}>Internal · for Velho consultants</span>
      </header>
      <h1 className={s.h1}>Drafts to review</h1>
      <p className={s.lede}>Overnight drafts wait here for a person. Approving only writes a draft email to our own inbox. Nothing is sent.</p>
      {err && <p className={s.alert}>The board is offline: {err}</p>}

      <div className={s.cols}>
        <section className={s.mainCol} aria-labelledby="waiting">
          <h2 id="waiting" className={s.h2}>Waiting for approval <span className={s.count}>{groups.size}</span></h2>
          {b && !groups.size && <p className={s.muted}>Nothing waiting. New drafts appear here after the night path runs.</p>}
          {[...groups.values()].map(([latest, ...older]) => (
            <article key={latest.id} className={s.card}>
              <div className={s.cardHead}>
                <h3 className={s.company}>{latest.company ?? latest.payload.subject}</h3>
                <span className={s.status} data-s="waiting">Waiting</span>
              </div>
              <ApprovalCard a={latest} />
              {older.length > 0 && (
                <details className={s.older}>
                  <summary>{older.length} earlier {older.length === 1 ? "version" : "versions"}</summary>
                  {older.map((a) => <ApprovalCard key={a.id} a={a} older />)}
                </details>
              )}
            </article>
          ))}
        </section>

        <aside className={s.side}>
          <section className={s.card}>
            <h2 className={s.h2}>Run the night path now</h2>
            <p className={s.muted}>Research, audio script and checks for one company with a hallway note. Takes 25-40 s.</p>
            {b && !b.companies.length && <p className={s.muted}>No hallway notes yet. Save a voice note on /capture first.</p>}
            <div className={s.form}>
              <select className={s.field} value={company} disabled={!!busy} aria-label="Company" onChange={(e) => { setCompany(e.target.value); setLead("") }}>
                {b?.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className={s.field} value={lead} disabled={!!busy} aria-label="Lead" onChange={(e) => setLead(e.target.value)}>
                <option value="">Latest lead (or none)</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.role} · {when(l.created_at)}</option>)}
              </select>
              <select className={s.field} value={recipient} disabled={!!busy} aria-label="Who the page is for" onChange={(e) => setRecipient(e.target.value)}>
                <option value="COO">For the COO</option>
                <option value="CEO">For the CEO</option>
                <option value="CFO">For the CFO</option>
                <option value="">For the person we met</option>
              </select>
              <button className={s.primary} onClick={runNight} disabled={!!busy || !b?.companies.length}>{busy === "night" ? "Running…" : "Run"}</button>
            </div>
            {msg && <p className={s.note} role="status">{msg}</p>}
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Pages</h2>
            <ul className={s.list}>{live.map(pageItem)}</ul>
            {withdrawn.length > 0 && (
              <details className={s.older}>
                <summary>Show {withdrawn.length} withdrawn</summary>
                <ul className={s.list}>{withdrawn.map(pageItem)}</ul>
              </details>
            )}
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Outbox <span className={s.count}>drafts to our own inbox</span></h2>
            {b && !b.outbox.length && <p className={s.muted}>No drafts yet.</p>}
            <ul className={s.list}>
              {b?.outbox.map((o) => (
                <li key={o.id}>
                  <details>
                    <summary>{o.subject} <span className={s.time}>→ {o.to_addr}</span></summary>
                    <pre className={s.pre}>{o.body}</pre>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <details className={s.runs} open={job ? true : undefined}>
        <summary className={s.h2}>Agent runs <span className={s.count}>last 20, newest first</span></summary>
        <ul className={s.runList}>
          {b?.runs.map((r) => (
            <li key={r.id}>
              <details open={r.status === "running"}>
                <summary>
                  <span className={`${s.dot} ${s[r.status]}`} aria-label={r.status} />
                  <strong>{AGENT[r.agent] ?? r.agent}</strong>
                  <span className={s.time}>{dur(r)} · {r.tool_calls} tool calls · {time(r.started_at)}</span>
                  {r.error && <span className={s.errText}>{r.error}</span>}
                </summary>
                <p className={s.time}>{r.agent} · {r.model}</p>
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
      </details>

      <footer className={s.foot}>
        {b && <span><span className={`${s.dot} ${b.key ? s.ok : s.running}`} aria-hidden /> {b.key ? "Model connected" : "No model key: offline templates"}</span>}
        <span>Board refreshes every 2 s</span>
      </footer>
    </main>
  )
}

// The reader test in words: the three scores, then the first point of its notes.
const firstNote = (notes: string) => notes.replace(/^\s*1[).]\s*/, "").split(/(?<=[.;!?])\s+|\s+2[).]\s/)[0].replace(/[;,:]$/, ".")

// An older version can only be killed: approving it would ship a draft that a newer one replaced.
function ApprovalCard({ a, older = false }: { a: Board["approvals"][number]; older?: boolean }) {
  const [mode, setMode] = useState<"" | "edit" | "kill">("")
  const [subject, setSubject] = useState(a.payload.subject)
  const [body, setBody] = useState(a.payload.body)
  const [note, setNote] = useState("")
  const [out, setOut] = useState("")
  const [sending, setSending] = useState(false) // a double click must not POST the decision twice (second one 409s)
  const blocked = !!a.compliance && !a.compliance.ok
  const rounds = a.skeptic ?? []
  const last = rounds.at(-1)
  const low = last ? Math.min(last.stop, last.read, last.reply) : null

  const cancel = () => { setMode(""); setSubject(a.payload.subject); setBody(a.payload.body); setNote("") }

  const act = async (action: "approve" | "edit" | "kill") => {
    if (sending) return
    setSending(true)
    try {
      const r = await fetch(withBase(`/api/approvals/${a.id}`), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note, final_payload: action === "edit" ? { subject, body } : undefined }),
      })
      const j = await r.json()
      if (r.ok && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("approval_decided", { action })
      }
      setOut(r.ok ? DECISION[j.status] ?? j.status : `Not saved: ${j.error}`)
    } catch { setOut("Lost the connection; reload to see whether it went through.") } finally { setSending(false) }
  }

  return (
    <div className={s.appr}>
      <p className={s.meta}>
        <span>Draft from {when(a.created_at)}</span>
        <a href={withBase(`/p/${a.payload.page_slug}`)} {...newTab}>Open page</a>
      </p>
      {blocked && <p className={s.hold}>On hold until the compliance check is clear: {a.compliance!.issues.join("; ")}.</p>}

      {last && (
        <p className={s.reader}>
          <span className={s.readerScores} data-low={low != null && low < 7 ? "" : undefined}>
            Reader test: {`stop\u00a0${last.stop} · read\u00a0${last.read} · reply\u00a0${last.reply}`}<span className={s.time}> /10, aim 7+</span>
          </span>
          {last.notes && <span className={s.readerNote}>{firstNote(last.notes)}</span>}
        </p>
      )}
      <details className={s.checks}>
        <summary>Quality checks <span className={s.time}>
          {` · compliance ${blocked ? `${a.compliance!.issues.length} to look at` : a.compliance ? "clear" : "not run"}`}
        </span></summary>
        <dl className={s.dl}>
          <dt>Compliance</dt>
          <dd>{blocked ? <ul className={s.issues}>{a.compliance!.issues.map((x, i) => <li key={i}>{x}</li>)}</ul> : a.compliance ? "No promises, personal names or confidential details found." : "Not run."}</dd>
          <dt>Reader test <span className={s.time}>(a model reads it as the executive it is for; scores out of 10, aim 7+)</span></dt>
          <dd>{rounds.length ? (
            <ol className={s.rounds}>{rounds.map((r, i) => <li key={i}>Round {i + 1}: would stop {r.stop} · would read {r.read} · would reply {r.reply}{r.reply_why && <><br /><span className={s.time}>Why reply {r.reply}: {r.reply_why}</span></>}</li>)}</ol>
          ) : "Not run."}</dd>
          {last?.notes && <><dt>Reader notes</dt><dd>{last.notes}</dd></>}
        </dl>
      </details>

      {mode === "edit" && (
        <div className={s.edit}>
          <input className={s.field} aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className={s.field} aria-label="Email body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      )}
      {mode === "kill" && <input className={`${s.field} ${s.wide}`} placeholder="Why kill it? (required)" aria-label="Reason for killing this draft" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />}

      {out ? <p className={s.note} role="status">{out}</p> : (
        <div className={s.actions}>
          {mode === "" && <>
            {!older && <button className={s.primary} disabled={blocked || sending} title={blocked ? "On hold: see the compliance check" : ""} onClick={() => act("approve")}>Approve</button>}
            {!older && <button className={s.secondary} disabled={blocked} onClick={() => setMode("edit")}>Edit</button>}
            <button className={s.textBtn} onClick={() => setMode("kill")}>{older ? "Kill this older version…" : "Kill…"}</button>
          </>}
          {mode === "edit" && <><button className={s.primary} disabled={blocked || sending} onClick={() => act("edit")}>Save and approve</button><button className={s.textBtn} onClick={cancel}>Cancel</button></>}
          {mode === "kill" && <><button className={s.danger} disabled={!note.trim() || sending} onClick={() => act("kill")}>Kill this draft</button><button className={s.textBtn} onClick={cancel}>Cancel</button></>}
        </div>
      )}
    </div>
  )
}
