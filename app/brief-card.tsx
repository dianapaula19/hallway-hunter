import type { Claim } from "@/lib/types.ts"
import type { LatestBrief } from "@/lib/live/brief.ts"
import s from "./brief-card.module.css"

// A real stored brief, read back from the DB (no hooks, so / renders it on the server and /capture on the client).
// Chips open native popovers with the source excerpt and url, like /p. Only sources that exist are chipped (rule 2).
const at = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki" })
const host = (url: string | null) => { try { return url ? new URL(url).hostname : null } catch { return null } }

export function BriefCard({ ex, label }: { ex: LatestBrief; label: string }) {
  const n = new Map(ex.sources.map((x, i) => [x.id, i + 1]))
  const pid = (id: string) => `brief-src-${id}`
  const Chips = ({ c }: { c: Claim }) => (
    <span className={s.chips}>
      {c.source_ids.filter((id) => n.has(id)).map((id) => (
        <button key={id} className={s.chip} popoverTarget={pid(id)} aria-label={`Source ${n.get(id)}`}>{n.get(id)}</button>
      ))}
    </span>
  )
  const b = ex.brief
  return (
    <section className={s.card} aria-label={`${label}: ${ex.name}`}>
      <p className={s.label}>{label}</p>
      <h2 className={s.name}>{ex.name}</h2>
      <p className={s.meta}>
        by Velho&apos;s AI analysts · {ex.word_count}-word brief, shortened here{ex.secs != null && <> · researched in {ex.secs.toFixed(1)} s</>} · {at(ex.created_at)}
      </p>
      <p className={s.what}>{b.what_they_do.text} <Chips c={b.what_they_do} /></p>
      <h3 className={s.h3}>Signals</h3>
      <ul className={s.list}>{b.signals.map((c, i) => <li key={i}>{c.text} <Chips c={c} /></li>)}</ul>
      <h3 className={s.h3}>Open with</h3>
      <p className={s.opener}>{b.openers[0]}</p>
      <h3 className={s.h3}>Likely objection</h3>
      <p className={s.obj}>{b.objection.text} <Chips c={b.objection} /></p>
      {ex.sources.map((x) => (
        <div key={x.id} id={pid(x.id)} popover="auto" className={s.pop}>
          <p className={s.popKind}>[{n.get(x.id)}] {x.kind.toUpperCase()}</p>
          <p className={s.popTitle}>{x.title}</p>
          <p className={s.popExcerpt}>“{x.excerpt}”</p>
          {x.url && <a className={s.popUrl} href={x.url} target="_blank" rel="noreferrer noopener">{host(x.url)}</a>}
          <button className={s.popClose} popoverTarget={pid(x.id)} popoverTargetAction="hide">Close</button>
        </div>
      ))}
    </section>
  )
}
