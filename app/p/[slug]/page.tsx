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
  if (!page || page.status === "killed") notFound()
  const company = get<Company>("SELECT * FROM companies WHERE id = ?", page.company_id)!
  const lead = page.lead_id ? get<Lead>("SELECT * FROM leads WHERE id = ?", page.lead_id) ?? null : null
  const opps = all<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position", page.id)
  const sources = new Map(all<Source>("SELECT * FROM sources WHERE company_id = ?", company.id).map((x) => [x.id, x]))

  const showQuote = lead && !isConfidential(lead)
  const hallway = showQuote ? [...sources.values()].find((x) => x.kind === "hallway" && x.lead_id === lead.id) : undefined
  // A script line citing a hidden (confidential) hallway source is not shown either.
  const script = page.script.filter((l) => showQuote || !l.source_ids.some((id) => sources.get(id)?.kind === "hallway"))

  // Number citations in reading order: quote, cards, script.
  const order: string[] = []
  for (const id of [hallway?.id, ...opps.flatMap((o) => o.claim.source_ids), ...opps.flatMap((o) => o.formula.input_source_ids), ...script.flatMap((l) => l.source_ids)])
    if (id && sources.has(id) && !order.includes(id)) order.push(id)
  const cited = order.map((id, i) => ({ n: i + 1, ...sources.get(id)! }))
  const num = Object.fromEntries(cited.map((c) => [c.id, c.n]))
  const synthetic = /\(synthetic\)/i.test(company.name)
  const name = company.name.replace(/\s*\(synthetic\)\s*/i, "")
  const date = new Date(page.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className={s.page}>
      <main className={s.wrap}>
        <header className={s.top}>
          <span className={s.pill}>Velho draft</span>
          <span className={s.meta}>Private page · not indexed{synthetic ? " · synthetic demo data" : ""}{page.status !== "approved" ? " · awaiting human review" : ""}</span>
        </header>

        <h1 className={s.h1}>Made for {name}</h1>
        <p className={s.byline}>A Velho draft, by Velho&apos;s AI analysts · {date}</p>

        {showQuote && (
          <figure className={s.quote}>
            <blockquote>“{lead.quote}”</blockquote>
            <figcaption>
              {lead.role}, in a hallway conversation {hallway && <Chips ids={[hallway.id]} num={num} />}
            </figcaption>
          </figure>
        )}

        <section className={s.section} aria-labelledby="listen">
          <h2 id="listen" className={s.h2}>Listen <span className={s.muted}>· about 75 seconds</span></h2>
          <Player lines={script} num={num} />
        </section>

        <section className={s.section} aria-labelledby="start">
          <h2 id="start" className={s.h2}>{opps.length === 3 ? "Three places to start" : opps.length ? "Where to start (thin data)" : "Thin data"}</h2>
          {opps.length === 0 && <p className={s.muted}>We did not find enough public evidence to suggest anything specific yet.</p>}
          <ol className={s.cards}>
            {opps.map((o, i) => (
              <li key={o.id} className={s.card}>
                <span className={s.cardNum}>{String(i + 1).padStart(2, "0")}</span>
                <h3 className={s.h3}>{o.title}</h3>
                <p className={s.claim}>{o.claim.text} <Chips ids={o.claim.source_ids} num={num} /></p>
                <FormulaRow formula={o.formula} chips={<Chips ids={o.formula.input_source_ids} num={num} />} />
              </li>
            ))}
          </ol>
        </section>

        <footer className={s.foot}>
          <p>
            This page is a <strong>Velho draft</strong>, prepared by Velho&apos;s AI analysts from public registers, public tenders, the company&apos;s own
            website and one hallway conversation. Every statement links to its source. Every euro figure is an estimate: change any input and it recalculates.
            Nothing was sent on your behalf.
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
