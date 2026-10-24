"use client"
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react"
import posthog from "posthog-js"
import { clampInput, eurPerYear, FORMULA_INPUTS, type FormulaKey } from "@/lib/night/formula.ts"
import { speechSecs } from "@/lib/night/compliance.ts"
import { fi, fiEur, fiText, parseFi } from "./letter.ts"
import type { EuroFormula, ScriptLine } from "@/lib/types.ts"
import s from "./page.module.css"

// Citation chips open the matching native popover (rendered once per source by the page).
export function Chips({ ids, num }: { ids: string[]; num: Record<string, number> }) {
  const known = ids.filter((id) => num[id])
  if (!known.length) return null
  return (
    <span className={s.chips}>
      {known.map((id) => (
        <button key={id} className={s.chip} popoverTarget={`src-${id}`} aria-label={`Source ${num[id]}`}>{num[id]}</button>
      ))}
    </span>
  )
}

// Editable estimate: every input visible, recomputed in the browser. Text inputs, not type=number, so the
// numbers read the same Finnish way (7,5) whatever the viewer's browser locale is.
export function FormulaRow({ formula, chips }: { formula: EuroFormula; chips: ReactNode }) {
  const [f, setF] = useState(formula)
  // Inputs are uncontrolled so a half-typed "7," stays as typed; only a valid number updates the estimate.
  const shown = (k: FormulaKey, v: number) => fi(k === "automation_share" ? Math.round(v * 100) : v)
  const set = (k: FormulaKey, raw: string) => {
    const n = parseFi(raw) / (k === "automation_share" ? 100 : 1)
    if (Number.isFinite(n)) setF((p) => ({ ...p, [k]: clampInput(k, n) }))
  }
  return (
    <div className={s.formula}>
      <div className={s.calc} role="group" aria-label="Estimate formula, editable">
        {FORMULA_INPUTS.map((inp, i) => (
          <Fragment key={inp.key}>
            <label className={s.term}>
              <input
                type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
                defaultValue={shown(inp.key, f[inp.key])}
                onChange={(e) => set(inp.key, e.target.value)}
                onBlur={(e) => { e.currentTarget.value = shown(inp.key, f[inp.key]) }}
              />
              <span>{inp.key === "automation_share" ? "% automatable" : inp.label}</span>
            </label>
            {i < FORMULA_INPUTS.length - 1 && <span className={s.op} aria-hidden>×</span>}
          </Fragment>
        ))}
        <p className={s.result} aria-live="polite">
          <span className={s.eq} aria-hidden>=</span> {fiEur(eurPerYear(f))} <span className={s.per}>a year</span>
          <span className={s.tag}>{f.label}</span>
        </p>
      </div>
      <p className={s.formulaNote}>
        {f.label === "sector estimate" ? "Sector estimate: no input comes from a company source. Change any number to yours." : <>Inputs partly from {chips}. Change any number to yours.</>}
      </p>
    </div>
  )
}

type State = "idle" | "playing" | "paused"

// Two-host briefing on the browser's own speech engine. Two distinct voices when available, else pitch-shifted.
export function Player({ lines, num }: { lines: ScriptLine[]; num: Record<string, number> }) {
  const [state, setState] = useState<State>("idle")
  const [cur, setCur] = useState(-1)
  const [supported, setSupported] = useState(true)
  const voices = useRef<{ A?: SpeechSynthesisVoice; B?: SpeechSynthesisVoice; same: boolean }>({ same: true })
  const gen = useRef(0) // bumps on every start/stop so stale onend callbacks are ignored
  const [voiceNote, setVoiceNote] = useState("")
  const [showText, setShowText] = useState(false) // transcript folds away to keep the page short; opens on play

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { setSupported(false); return }
    const synth = window.speechSynthesis
    const load = () => {
      const all = synth.getVoices()
      const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"))
      const pool = en.length ? en : all
      const A = pool.find((v) => /en-gb/i.test(v.lang)) ?? pool[0]
      const B = pool.find((v) => v !== A && v.lang === A?.lang) ?? pool.find((v) => v !== A)
      voices.current = { A, B: B ?? A, same: !B }
      setVoiceNote(A ? (B ? "Two synthetic voices" : "One synthetic voice, two pitches") : "")
    }
    load()
    synth.addEventListener("voiceschanged", load)
    return () => { synth.removeEventListener("voiceschanged", load); gen.current++; synth.cancel() }
  }, [])

  const speak = (i: number, g: number) => {
    if (g !== gen.current) return
    const synth = window.speechSynthesis
    if (i >= lines.length) { setState("idle"); setCur(-1); return }
    setCur(i)
    const l = lines[i]
    const u = new SpeechSynthesisUtterance(l.text.replace(/[“”]/g, '"'))
    const v = voices.current
    u.voice = (l.host === "A" ? v.A : v.B) ?? null
    if (u.voice) u.lang = u.voice.lang
    u.pitch = v.same ? (l.host === "A" ? 0.9 : 1.25) : 1
    u.rate = 1.02
    u.onend = () => speak(i + 1, g)
    // A browser with the API but no working engine errors out instead of ending: fall back to the transcript.
    u.onerror = (e) => { if (g === gen.current && e.error !== "interrupted" && e.error !== "canceled") noAudio() }
    synth.speak(u)
  }

  const noAudio = () => { gen.current++; window.speechSynthesis.cancel(); setSupported(false); setState("idle"); setCur(-1); setShowText(true) }

  const start = (from: number) => {
    const synth = window.speechSynthesis
    if (!synth.getVoices().length) return noAudio() // no voices installed: speak() would hang on line 1
    const g = ++gen.current
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) {
      posthog.capture("briefing_started", { start_position: from + 1 })
    }
    synth.cancel()
    setState("playing")
    setShowText(true)
    speak(from, g)
  }
  const toggle = () => {
    const synth = window.speechSynthesis
    if (state === "playing") { synth.pause(); setState("paused") }
    else if (state === "paused") { synth.resume(); setState("playing") }
    else start(0)
  }
  const stop = () => { gen.current++; window.speechSynthesis.cancel(); setState("idle"); setCur(-1) }

  const secs = speechSecs(lines)

  return (
    <div className={s.player}>
      <div className={s.controls}>
        <button className={s.play} onClick={toggle} disabled={!supported || !lines.length} aria-label={state === "playing" ? "Pause" : "Play"}>
          {state === "playing" ? (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className={s.playMeta}>
          <span className={s.playTitle}>Briefing by Velho&apos;s AI analysts</span>
          <span className={s.muted}>
            {supported ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${voiceNote || "browser voice"} · ${state === "idle" ? "tap a line to start there" : `line ${cur + 1} of ${lines.length}`}` : "Audio is not available in this browser. The transcript is below."}
          </span>
        </div>
        {state !== "idle" && <button className={s.stop} onClick={stop}>Stop</button>}
      </div>
      <div className={s.bar} aria-hidden><span style={{ width: `${cur < 0 ? 0 : ((cur + 1) / lines.length) * 100}%` }} /></div>
      <details className={s.tx} open={showText} onToggle={(e) => setShowText(e.currentTarget.open)}>
      <summary>{showText ? "Hide the transcript" : "Read the transcript"}</summary>
      <ol className={s.transcript}>
        {lines.map((l, i) => (
          <li key={i} className={i === cur ? s.now : undefined} aria-current={i === cur ? "true" : undefined}>
            <button className={s.host} onClick={() => supported && start(i)} title="Play from here">{l.host === "A" ? "Analyst A" : "Analyst B"}</button>
            <span>{fiText(l.text)} <Chips ids={l.source_ids} num={num} /></span>
          </li>
        ))}
      </ol>
      </details>
    </div>
  )
}

// Two sentences the person we met can pass up to the executive, with this page's link. Copy, or open the
// viewer's own mail app with no recipient filled in: the viewer picks who gets it and presses send (CLAUDE.md rule 1).
export function Forward({ reader, text, subject }: { reader: string; text: string; subject: string }) {
  const [copied, setCopied] = useState(false)
  const [href, setHref] = useState("")
  useEffect(() => setHref(window.location.href.split("?")[0]), [])
  const full = `${text}\n\n${href}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch { setCopied(false) }
  }
  return (
    <section className={s.fwd} aria-labelledby="fwd">
      <h2 id="fwd" className={s.h2}>Forward to your {reader}</h2>
      <p className={s.fwdText}>{text}</p>
      <p className={s.fwdRow}>
        <button className={s.fwdBtn} onClick={copy}>{copied ? "Copied" : "Copy text and link"}</button>
        <a className={s.fwdBtn} href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(full)}`}>Email it</a>
        <span className={s.yesNote}>Opens your own email app with no recipient filled in. Nothing is sent until you press send.</span>
      </p>
    </section>
  )
}
