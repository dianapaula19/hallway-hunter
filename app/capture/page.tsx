"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import posthog from "posthog-js"
import type { Brief, Claim, Company, Lead, Source } from "@/lib/types"
import { withBase } from "@/lib/base.ts"
import s from "./capture.module.css"

type Candidate = { business_id: string; name: string; line: string; registered: string; ceased: boolean }
type CaptureRes = { q: string; extracted: { company_name: string; business_id: string | null; role: string | null } | null; candidates: Candidate[]; suggestions: Candidate[]; auto: string | null; ms: number; error?: string }
type ScoutRes = { company: Company; ceased: boolean; message?: string; brief: { brief: Brief; word_count: number } | null; sources: Source[]; mode?: string; note?: string | null; situations?: string[]; ms: number; error?: string }

// Phone photos are 3-8 MB; shrink to <=1600 px JPEG before upload (faster, under the API image limit).
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement("canvas")
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height)
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode"))), "image/jpeg", 0.85))
  } catch { return file }
}

async function post<T>(url: string, body: BodyInit, json = true, signal?: AbortSignal): Promise<T> {
  const r = await fetch(withBase(url), { method: "POST", body, signal, ...(json ? { headers: { "content-type": "application/json" } } : {}) })
  return (await r.json().catch(() => ({ error: `The server had a problem (HTTP ${r.status}). Try again.` }))) as T
}

// fetch() rejects with a bare "TypeError: Failed to fetch" when the network drops; say that in plain words.
const plain = (e: unknown) => e instanceof TypeError ? "No connection to the server. Check the network and try again." : e instanceof Error ? e.message : String(e)
const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError"

const MIC: Record<string, string> = {
  "not-allowed": "The microphone is blocked. Allow it in the browser's site settings, or type the note below.",
  "service-not-allowed": "The microphone is blocked. Allow it in the browser's site settings, or type the note below.",
  "audio-capture": "No microphone found. Type the note below instead.",
  "no-speech": "Didn't hear anything. Tap Record and speak closer to the phone, or type the note.",
  network: "Speech recognition needs a network connection. Type the note below instead.",
}

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }

export default function CapturePage() {
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [t0, setT0] = useState(0)
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cap, setCap] = useState<CaptureRes | null>(null)
  const [scout, setScout] = useState<ScoutRes | null>(null)
  const [total, setTotal] = useState<number | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [lang, setLang] = useState<"fi-FI" | "en-US">("en-US")
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [leads, setLeads] = useState<Lead[]>([])
  const [noteMsg, setNoteMsg] = useState<string | null>(null)
  const rec = useRef<SR | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // One request in flight; leaving the page (or starting a new lookup) cancels it.
  const ctl = useRef<AbortController | null>(null)
  const fresh = () => { ctl.current?.abort(); ctl.current = new AbortController(); return ctl.current.signal }
  useEffect(() => () => ctl.current?.abort(), [])

  useEffect(() => { if (!busy) return; const i = setInterval(() => setTick(Date.now()), 250); return () => clearInterval(i) }, [busy])
  const company = scout?.company ?? null
  useEffect(() => { if (company) void loadLeads(company.id) }, [company?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadLeads(id: string) {
    const r = await fetch(withBase(`/api/lead?company_id=${encodeURIComponent(id)}`))
    setLeads(((await r.json()) as { leads: Lead[] }).leads)
  }

  function reset() { setError(null); setCap(null); setScout(null); setTotal(null); setOpen(null); setTranscript(""); setNoteMsg(null) }

  async function runScout(business_id: string, start = Date.now(), trigger: "auto_match" | "candidate_selected" = "candidate_selected", signal = fresh()) {
    setBusy("Researching (PRH, TED, website)…")
    try {
      const r = await post<ScoutRes>("/api/scout", JSON.stringify({ business_id }), true, signal)
      if (r.error) setError(r.error)
      else if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("company_scout_completed", {
          result: r.ceased ? "ceased" : "brief_ready",
          trigger,
        })
      }
      setScout(r); setTotal(Date.now() - start)
    } catch (e) { if (!aborted(e)) setError(plain(e)) } finally { if (!signal.aborted) setBusy(null) }
  }

  // The current brief stays on screen until the new lookup succeeds, so a failed upload loses nothing.
  async function capture(body: FormData | string) {
    const signal = fresh()
    setError(null)
    const start = Date.now(); setT0(start)
    setBusy(typeof body === "string" ? "Looking up the trade register…" : "Reading the card…")
    try {
      const r = await post<CaptureRes>("/api/capture", body, typeof body === "string", signal)
      if (r.error) { setError(r.error); setBusy(null); return }
      reset()
      if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
        posthog.capture("company_lookup_completed", {
          input_method: typeof body === "string" ? "typed_query" : "card_photo",
          candidate_count: r.candidates.length,
          suggestion_count: r.suggestions.length,
          auto_match_found: Boolean(r.auto),
        })
      }
      setCap(r)
      if (r.auto) return await runScout(r.auto, start, "auto_match", signal)
      setBusy(null)
    } catch (e) { if (!aborted(e)) { setError(plain(e)); setBusy(null) } }
  }

  async function onPhoto(f: File | undefined) {
    if (!f) return
    const fd = new FormData()
    fd.append("image", await shrink(f), "card.jpg")
    await capture(fd)
    if (fileRef.current) fileRef.current.value = ""
  }

  function toggleMic() {
    if (listening) { rec.current?.stop(); return }
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
    if (!Ctor) { setNoteMsg("This browser has no speech recognition (try Chrome or Safari). Type the note below instead."); return }
    setNoteMsg(null)
    const r = new Ctor()
    r.lang = lang; r.interimResults = true; r.continuous = true
    const base = transcript ? transcript.trimEnd() + " " : ""
    r.onresult = (e) => setTranscript(base + Array.from(e.results).map((x) => x[0].transcript).join(" "))
    r.onend = () => setListening(false)
    r.onerror = (e) => { if (e.error !== "aborted") setNoteMsg(MIC[e.error] ?? `The microphone stopped (${e.error}). Type the note below instead.`); setListening(false) }
    rec.current = r; r.start(); setListening(true)
  }

  async function saveLead() {
    if (!company || !transcript.trim()) return
    setBusy("Saving lead (names scrubbed)…")
    try {
      const r = await post<{ lead?: Lead; error?: string }>("/api/lead", JSON.stringify({ company_id: company.id, transcript }))
      if (r.error) setNoteMsg(r.error); else {
        if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) posthog.capture("lead_saved")
        setTranscript(""); setNoteMsg(null); await loadLeads(company.id)
      }
    } catch (e) { setNoteMsg(`${plain(e)} Your note is still here.`) } finally { setBusy(null) }
  }

  async function del(id: string) {
    if (!confirm("Delete this lead and its hallway quote?")) return
    const r = await fetch(withBase(`/api/lead/${encodeURIComponent(id)}`), { method: "DELETE" })
    if (r.ok && process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) posthog.capture("lead_deleted")
    if (company) await loadLeads(company.id)
  }

  const srcById = new Map((scout?.sources ?? []).map((x) => [x.id, x]))
  const order = [...srcById.keys()]
  const Chips = ({ c }: { c: Claim }) => (
    <>{c.source_ids.map((id) => srcById.has(id) && (
      <button key={id} className={`${s.chip} ${open === id ? s.chipOn : ""}`} onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}
        aria-label={`Source ${order.indexOf(id) + 1}: ${srcById.get(id)!.title}`}>
        {order.indexOf(id) + 1}<span className={s.chipKind}>{srcById.get(id)!.kind}</span>
      </button>
    ))}</>
  )
  const SourceBox = () => {
    const x = open ? srcById.get(open) : null
    return x ? (
      <div className={s.source}>
        <p className={s.sourceKind}>[{order.indexOf(x.id) + 1}] {x.kind}</p>
        <p className={s.sourceTitle}>{x.title}</p>
        <p className={s.sourceExcerpt}>“{x.excerpt}”</p>
        {x.url && <a href={x.url} target="_blank" rel="noreferrer noopener">{x.url}</a>}
        <button className={s.link} onClick={() => setOpen(null)}>Close</button>
      </div>
    ) : null
  }
  const b = scout?.brief?.brief

  const list = (title: string, cs: Candidate[]) => (
    <section className={s.card}>
      <h2 className={s.h2}>{title}</h2>
      <ul className={s.cands}>
        {cs.map((c) => (
          <li key={c.business_id}>
            <button disabled={!!busy} onClick={() => { setT0(Date.now()); void runScout(c.business_id) }} className={`${s.cand} ${c.ceased ? s.ceased : ""}`}>
              <span className={s.candName}>{c.name} {c.ceased && <span className={s.tag}>ceased</span>}</span>
              <small>{c.business_id} · {c.line || "no business line"} · reg. {c.registered || "?"}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )

  const idle = !cap && !scout && !busy?.startsWith("Researching")

  return (
    <div className="paper">
      <main className={s.main}>
        <div className={s.side}>
          <header className={s.head}>
            <Link href="/" className={s.brand}>Hallway Hunter</Link>
            <span className={s.internal}>Internal · for Velho consultants</span>
          </header>
          <h1 className={s.h1}>Who are you talking to?</h1>
          <p className={s.sub}>Snap their badge or type the company. A cited brief appears in about 10 seconds.</p>

          <section className={s.panel}>
            <label className={`${s.snap} ${busy ? s.off : ""}`}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
              </svg>
              Snap badge or card
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(e) => onPhoto(e.target.files?.[0])} />
            </label>
            <p className={s.or}><span>or type it</span></p>
            <form className={s.row} onSubmit={(e) => { e.preventDefault(); if (q.trim()) void capture(JSON.stringify({ q })); else setError("Type a company name or a Y-tunnus (like 1234567-8) first.") }}>
              <input className={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company name or Y-tunnus" enterKeyHint="search" autoComplete="organization" aria-label="Company name or Y-tunnus" />
              <button className={s.go} disabled={!!busy}>Go</button>
            </form>
            {busy && (
              <p className={s.busy} role="status">
                <span className={s.spin} aria-hidden />
                <span>{busy}</span>
                <span className={s.secs}>{((Math.max(tick, t0) - t0) / 1000).toFixed(1)} s</span>
              </p>
            )}
            {error && <p className={s.error} role="alert">{error}</p>}
          </section>
        </div>

        <div className={s.results}>
          {idle && (
            <section className={s.empty} aria-labelledby="what">
              <h2 id="what" className={s.h2}>What happens</h2>
              <ol className={s.howto}>
                <li><span><b>We read the card.</b> Only the company, its Y-tunnus and the job title. The photo is used for this one lookup and is not stored. Names are never kept.</span></li>
                <li><span><b>We check public sources.</b> The Finnish trade register (PRH), public tenders (TED) and the company&apos;s own website.</span></li>
                <li><span><b>You get a 120-word brief.</b> What they do, signals, openers and what not to say. Every line has a numbered source you can tap.</span></li>
                <li><span><b>Record what they said.</b> Saved under their role, never their name. Overnight it becomes a one-page Velho draft that a person approves before it is shared.</span></li>
              </ol>
            </section>
          )}

          {busy?.startsWith("Researching") && !b && (
            <section className={s.card} aria-hidden>
              <div className={s.skel} style={{ width: "45%", height: 22 }} />
              <div className={s.skel} /><div className={s.skel} /><div className={s.skel} style={{ width: "70%" }} />
            </section>
          )}

          {cap?.extracted && (
            <p className={s.extracted}>From the card: <b>{cap.extracted.company_name || "no company found"}</b>{cap.extracted.business_id && ` · ${cap.extracted.business_id}`}{cap.extracted.role && ` · ${cap.extracted.role}`}</p>
          )}
          {cap && !scout && cap.suggestions.length > 0 && list(`No active company called "${cap.q}". Did you mean…`, cap.suggestions)}
          {cap && !cap.auto && !scout && cap.candidates.length > 0 && list(cap.suggestions.length ? "Other register matches" : "Which company?", cap.candidates)}
          {cap && !scout && !cap.candidates.length && !cap.suggestions.length &&
            <p className={s.error}>Nothing in the PRH register for &quot;{cap.q}&quot;. Check the spelling or try the Y-tunnus (it is printed on invoices and the company website).</p>}

          {scout?.ceased && <section className={`${s.card} ${s.warn}`}><h2 className={s.h2}>Ceased</h2><p className={s.title}>{scout.company.name}</p><p>{scout.message}</p></section>}

          {b && scout && (
            <section className={s.card} aria-labelledby="brief">
              <h2 id="brief" className={s.h2}>Brief</h2>
              <p className={s.title}>{scout.company.name}</p>
              <p className={s.meta}>
                by Velho&apos;s AI analysts · {scout.brief!.word_count} words · {((total ?? scout.ms) / 1000).toFixed(1)} s{scout.mode === "evidence" && " · evidence-only"}
                {b.thin_data && <span className={s.tag}>thin data</span>}
              </p>
              {scout.note && <p className={s.meta}>{scout.note}</p>}
              {scout.situations?.length ? <p className={s.error}>Register: {scout.situations.join(", ")}</p> : null}
              <p className={s.lead}>{b.what_they_do.text} <Chips c={b.what_they_do} /></p>
              <h3 className={s.h3}>Signals</h3>
              {b.signals.length ? <ul className={s.signals}>{b.signals.map((c, i) => <li key={i}>{c.text} <Chips c={c} /></li>)}</ul> : <p className={s.meta}>thin data</p>}
              <h3 className={s.h3}>Openers</h3>
              <ol className={s.openers}>{b.openers.map((o, i) => <li key={i}>{o}</li>)}</ol>
              <dl className={s.dl}>
                <div><dt>Don&apos;t say</dt><dd>{b.dont_say}</dd></div>
                <div><dt>Likely objection</dt><dd>{b.objection.text} <Chips c={b.objection} /></dd></div>
              </dl>
              <SourceBox />
            </section>
          )}

          {company && !scout?.ceased && (
            <section className={s.card} aria-labelledby="voice">
              <h2 id="voice" className={s.h2}>Voice note</h2>
              <p className={s.title}>{company.name}</p>
              <p className={s.meta}>Role only, never names. Names are scrubbed before saving.</p>
              <div className={s.row}>
                <button onClick={toggleMic} className={`${s.mic} ${listening ? s.rec : ""}`}>
                  {listening ? <span className={s.dot} aria-hidden /> : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                  )}
                  {listening ? "Stop" : "Record"}
                </button>
                <select className={s.select} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} disabled={listening} aria-label="Language">
                  <option value="en-US">English</option><option value="fi-FI">Suomi</option>
                </select>
              </div>
              {noteMsg && <p className={s.error} role="alert">{noteMsg}</p>}
              <textarea className={s.input} value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} placeholder="Transcript appears here. Edit before saving." aria-label="Voice note transcript" />
              <button className={s.primary} disabled={!!busy || !transcript.trim()} onClick={saveLead}>Save lead</button>
              {leads.length > 0 && (
                <ul className={s.leads}>
                  {leads.map((l) => (
                    <li key={l.id}>
                      <div>
                        <p className={s.leadRole}>{l.role} <span className={s.tag}>{l.temperature}</span></p>
                        <blockquote className={s.quote}>&ldquo;{l.quote}&rdquo;</blockquote>
                        <p className={s.meta}>{l.pain}{l.next_step && ` → ${l.next_step}`}</p>
                      </div>
                      <button className={s.del} onClick={() => del(l.id)} aria-label="Delete lead">Delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
