import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { all, get } from "@/lib/db.ts"
import { isConfidential } from "@/lib/night/compliance.ts"
import type { Company, Lead, Opportunity, Page, Source } from "@/lib/types.ts"
import { Chips, FormulaRow, Player } from "./client.tsx"
import s from "./page.module.css"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Velho draft", robots: { index: false, follow: false, nocache: true } }

export default async function DraftPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = get<Page>("SELECT * FROM pages WHERE slug = ?", slug)
  if (!page) notFound()
  if (page.status === "killed") return (
    <div className={s.page}>
      <main className={s.wrap}>
        <header className={s.top}><span className={s.pill}>Velho draft</span></header>
        <h1 className={s.h1}>This draft has been withdrawn</h1>
        <p className={s.byline}>Velho took this page down. If you were expecting it, reply to the person at Velho who sent you the link.</p>
      </main>
    </div>
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

  // Number citations in reading order: quote, cards, script.
  const order: string[] = []
  for (const id of [prh?.id, hallway?.id, ...opps.flatMap((o) => o.claim.source_ids), ...opps.flatMap((o) => o.formula.input_source_ids), ...script.flatMap((l) => l.source_ids)])
    if (id && sources.has(id) && !order.includes(id)) order.push(id)
  const cited = order.map((id, i) => ({ n: i + 1, ...sources.get(id)! }))
  const num = Object.fromEntries(cited.map((c) => [c.id, c.n]))
  const synthetic = /\(synthetic\)/i.test(company.name)
  const name = company.name.replace(/\s*\(synthetic\)\s*/i, "")
  const date = new Date(page.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  // The script's closing question is the page's one ask; show it on its own, not only inside the audio.
  const ask = script.at(-1)?.text.includes("?") ? script.at(-1) : undefined
  // Lead with the question itself; the terms after it are small print, not a second paragraph to wade through.
  const q = ask ? ask.text.indexOf("?") + 1 : 0

  return (
    <div className={s.page}>
      <main className={s.wrap}>
        <header className={s.top}>
          <span className={s.pill}>Velho draft</span>
          <span className={s.meta}>Private page · not indexed{synthetic ? " · synthetic demo data" : ""}</span>
        </header>

        <h1 className={s.h1}>Made for {name}</h1>
        <p className={s.byline}>A Velho draft, by Velho&apos;s AI analysts · {date}
          {prh && company.business_id && <> · Y-tunnus {company.business_id} <Chips ids={[prh.id]} num={num} /></>}
        </p>

        {showQuote && (
          <figure className={s.quote}>
            <blockquote>“{lead.quote}”</blockquote>
            <figcaption>
              {lead.role}, to a Velho consultant in a conference hallway {hallway && <Chips ids={[hallway.id]} num={num} />}
            </figcaption>
          </figure>
        )}

        <section className={s.section} aria-labelledby="start">
          <h2 id="start" className={s.h2}>{opps.length > 1 ? `${opps.length} places to start` : opps.length ? "Where to start" : "Thin data"}</h2>
          {opps.length === 0 && <p className={s.muted}>We did not find enough evidence to suggest anything specific yet.</p>}
          <ol className={s.cards}>
            {opps.map((o, i) => (
              <li key={o.id} className={s.card}>
                {opps.length > 1 && <span className={s.cardNum}>{String(i + 1).padStart(2, "0")}</span>}
                <h3 className={s.h3}>{o.title}</h3>
                <p className={s.claim}>{o.claim.text} <Chips ids={o.claim.source_ids} num={num} /></p>
                <FormulaRow formula={o.formula} chips={<Chips ids={o.formula.input_source_ids} num={num} />} />
              </li>
            ))}
          </ol>
        </section>

        {ask && (
          <section className={s.ask} aria-labelledby="ask">
            <h2 id="ask" className={s.h2}>One question</h2>
            <p className={s.askText}>{ask.text.slice(0, q)}</p>
            {ask.text.slice(q).trim() && <p className={s.askTerms}>{ask.text.slice(q).trim()}</p>}
          </section>
        )}

        {script.length > 0 && (
          <section className={s.section} aria-labelledby="listen">
            <h2 id="listen" className={s.h2}>Listen</h2>
            <Player lines={script} num={num} />
          </section>
        )}

        <footer className={s.foot}>
          <p>
            A <strong>Velho draft</strong>, prepared by Velho&apos;s AI analysts from the sources below. A person at Velho approves every draft before it is shared.
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
        </footer>
      </main>

      {cited.map((c) => (
        <div key={c.id} id={`src-${c.id}`} popover="auto" className={s.pop}>
          <p className={s.popKind}>[{c.n}] {c.kind === "hallway" ? "Hallway note (role only, no names)" : c.kind.toUpperCase()}</p>
          <p className={s.popTitle}>{c.title}</p>
          <p className={s.popExcerpt}>“{c.excerpt}”</p>
          {c.url && <a className={s.popUrl} href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a>}
          <button className={s.popClose} popoverTarget={`src-${c.id}`} popoverTargetAction="hide">Close</button>
        </div>
      ))}
    </div>
  )
}
