import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { all, get } from "@/lib/db.ts"
import { isConfidential } from "@/lib/night/compliance.ts"
import type { Company, Lead, Opportunity, Page, Source } from "@/lib/types.ts"
import { Chips, FormulaRow, Player } from "./client.tsx"
import { fiText, headline, withoutEcho } from "./letter.ts"
import s from "./page.module.css"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Velho draft", robots: { index: false, follow: false, nocache: true } }

// Placeholder identity, pending Velho's real brand: the name set in the page serif plus one accent colour.
// Not a logo, and deliberately not an imitation of one (see PROCESS.md).
const Letterhead = () => (
  <header className={s.head}>
    <span className="wordmark-name">Velho</span>
    <span className={s.headNote}>Velho draft · by Velho&apos;s AI analysts</span>
  </header>
)

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Helsinki" })

export default async function DraftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = get<Page>("SELECT * FROM pages WHERE slug = ?", slug)
  if (!page) notFound()
  if (page.status === "killed") return (
    <div className="paper"><div className={s.desk}>
      <article className={s.letter}>
        <Letterhead />
        <h1 className={s.h1}>This draft has been withdrawn</h1>
        <p className={s.deck}>Velho took this page down. If you were expecting it, reply to the person at Velho who sent you the link.</p>
      </article>
    </div></div>
  )
  const company = get<Company>("SELECT * FROM companies WHERE id = ?", page.company_id)!
  const lead = page.lead_id ? get<Lead>("SELECT * FROM leads WHERE id = ?", page.lead_id) ?? null : null
  const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", page.id)
  const sources = new Map(all<Source>("SELECT * FROM sources WHERE company_id = ?", company.id).map((x) => [x.id, x]))

  const showQuote = lead && !isConfidential(lead)
  // The trade-register row ties the page to the right legal entity with a public source.
  const prh = [...sources.values()].find((x) => x.kind === "prh")
  const hallway = showQuote ? [...sources.values()].find((x) => x.kind === "hallway" && x.lead_id === lead.id) : undefined
  // A script line citing a hidden (confidential) hallway source is not shown either.
  const script = page.script.filter((l) => showQuote || !l.source_ids.some((id) => sources.get(id)?.kind === "hallway"))

  // Number citations in reading order: quote, cards, script, then the register line in the small print.
  const order: string[] = []
  for (const id of [hallway?.id, ...opps.flatMap((o) => o.claim.source_ids), ...opps.flatMap((o) => o.formula.input_source_ids), ...script.flatMap((l) => l.source_ids), prh?.id])
    if (id && sources.has(id) && !order.includes(id)) order.push(id)
  const cited = order.map((id, i) => ({ n: i + 1, ...sources.get(id)! }))
  const num = Object.fromEntries(cited.map((c) => [c.id, c.n]))
  const synthetic = /\(synthetic\)/i.test(company.name)
  const name = company.name.replace(/\s*\(synthetic\)\s*/i, "")
  const date = new Date(page.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Helsinki" })
  // The script's closing question is the page's one ask; show it on its own, not only inside the audio.
  const ask = script.at(-1)?.text.includes("?") ? script.at(-1) : undefined
  // Lead with the question itself; the terms after it are small print, not a second paragraph to wade through.
  const q = ask ? ask.text.indexOf("?") + 1 : 0
  const top = headline(opps[0])
  // We store no event name, only when the lead was captured.
  const met = lead ? `Met in a conference hallway, ${day(lead.created_at)}` : null
  // Reply yes opens the viewer's own mail app, addressed to our inbox. The app sends nothing (CLAUDE.md rule 1).
  // No real inbox configured (the db.ts fallback is a localhost address): say what the button does instead of linking it.
  const inbox = process.env.HH_OWN_INBOX
  const yes = inbox && `mailto:${inbox}?subject=${encodeURIComponent(`Yes: the one-page teardown for ${name}`)}&body=${encodeURIComponent(`Yes, please send the teardown.\n\n(Velho draft ${slug})`)}`

  return (
    <div className="paper"><div className={s.desk}>
      <article className={s.letter}>
        <Letterhead />
        {met && <p className={s.stub}>{met}</p>}

        <p className={s.eyebrow}>Made for {name}</p>
        {top ? (
          <>
            <h1 className={s.h1}><span>{top.hours} hours a week by hand.</span> <span>About <span className={s.nowrap}>{top.eur} a year</span> to win back.</span></h1>
            <p className={s.deck}>
              <span className={s.tag}>{top.label}</span> for one fix: {opps[0].title.charAt(0).toLowerCase() + opps[0].title.slice(1)}. The working is below; change any number.
            </p>
          </>
        ) : <h1 className={s.h1}>A first look at {name}</h1>}

        {showQuote && (
          <figure className={s.quote}>
            <blockquote>“{lead.quote}”</blockquote>
            <figcaption>{lead.role}, {name} {hallway && <Chips ids={[hallway.id]} num={num} />}</figcaption>
          </figure>
        )}

        <section className={s.section} aria-labelledby="start">
          <h2 id="start" className={s.h2}>{opps.length > 1 ? `${opps.length} places to start` : opps.length ? "Where to start" : "Thin data"}</h2>
          {opps.length === 0 && <p className={s.muted}>We did not find enough evidence to suggest anything specific yet.</p>}
          <ol className={s.cards}>
            {opps.map((o, i) => (
              <li key={o.id} className={s.card}>
                <h3 className={s.h3}>{opps.length > 1 && <span className={s.cardNum}>{i + 1}.</span>}{o.title}</h3>
                <p className={s.claim}>{fiText(withoutEcho(o.claim.text, showQuote ? lead.quote : null))} <Chips ids={o.claim.source_ids} num={num} /></p>
                <FormulaRow formula={o.formula} chips={<Chips ids={o.formula.input_source_ids} num={num} />} />
              </li>
            ))}
          </ol>
        </section>

        {ask && (
          <section className={s.ask} aria-labelledby="ask">
            <h2 id="ask" className={s.h2}>One question</h2>
            <p className={s.askText}>{fiText(ask.text.slice(0, q))}</p>
            {ask.text.slice(q).trim() && <p className={s.askTerms}>{fiText(ask.text.slice(q).trim())}</p>}
            <p className={s.yesRow}>
              {yes ? <>
                <a className={s.yes} href={yes}>Reply yes</a>
                <span className={s.yesNote}>Opens your own email app, addressed to Velho. Nothing is sent until you press send.</span>
              </> : <span className={s.yesNote}>In use, a &ldquo;Reply yes&rdquo; button here opens a reply to your Velho consultant in your own email app. Nothing is sent from this page.</span>}
            </p>
          </section>
        )}

        <div className={s.sign}>
          <span className={s.signRole}>Velho consultant</span>
          <span className={s.muted}>Velho · drafted by Velho&apos;s AI analysts, checked by a person at Velho before you saw it.</span>
        </div>

        {script.length > 0 && (
          <section className={s.ps} aria-labelledby="listen">
            <h2 id="listen" className={s.h2}>P.S. Prefer to listen?</h2>
            <Player lines={script} num={num} />
          </section>
        )}

        <footer className={s.foot}>
          <p>
            A <strong>Velho draft</strong>, prepared by Velho&apos;s AI analysts from the sources below.
            Every statement links to its source. Every euro figure is an estimate: change any input and it recalculates.
          </p>
          {cited.length > 0 && (
            <ol className={s.sources}>
              {cited.map((c) => (
                <li key={c.id}>
                  <button className={s.srcLink} popoverTarget={`src-${c.id}`}>{c.title}</button>
                  <span className={s.muted}> · {c.kind === "hallway" ? "hallway note" : c.kind === "note" ? "note" : c.url ? new URL(c.url).hostname : c.kind}</span>
                </li>
              ))}
            </ol>
          )}
          <p className={s.meta}>
            Private page, not indexed · {date}
            {prh && company.business_id && <> · Y-tunnus {company.business_id} <Chips ids={[prh.id]} num={num} /></>}
            {synthetic && " · synthetic demo data"}
          </p>
        </footer>
      </article>

      {cited.map((c) => (
        <div key={c.id} id={`src-${c.id}`} popover="auto" className={s.pop}>
          <p className={s.popKind}>[{c.n}] {c.kind === "hallway" ? "Hallway note (role only, no names)" : c.kind.toUpperCase()}</p>
          <p className={s.popTitle}>{c.title}</p>
          <p className={s.popExcerpt}>“{c.excerpt}”</p>
          {c.url && <a className={s.popUrl} href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a>}
          <button className={s.popClose} popoverTarget={`src-${c.id}`} popoverTargetAction="hide">Close</button>
        </div>
      ))}
    </div></div>
  )
}
