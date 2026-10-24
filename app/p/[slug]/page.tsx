import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { all, get } from "@/lib/db.ts"
import { ASSUME, isConfidential } from "@/lib/night/compliance.ts"
import type { Claim, Company, Lead, Opportunity, Page, Source } from "@/lib/types.ts"
import { TERMS } from "@/lib/night/script.ts"
import { hoursFromQuote } from "@/lib/night/hours.ts"
import { contractsText, contractsWon } from "@/lib/night/scale.ts"
import { Chips, Forward, FormulaRow, Player } from "./client.tsx"
import { checkedLine, fi, fiText, headline, withoutEcho } from "./letter.ts"
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

// The company-level reason. Text after the ASSUME marker is our inference: shown as such, after the chips, never cited.
function Why({ why, name, num, lead }: { why: Claim; name: string; num: Record<string, number>; lead?: boolean }) {
  const [fact, guess] = why.text.split(ASSUME)
  return (
    <p className={lead ? `${s.why} ${s.whyLead}` : s.why}>
      <span className={s.whyLabel}>Why it matters at {name}</span>
      {fiText(fact.trim())} <Chips ids={why.source_ids} num={num} />
      {guess && <span className={s.assume}> {ASSUME}{fiText(guess)}</span>}
    </p>
  )
}

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

  const letter = page.letter
  const isPublic = (c: Claim | null | undefined) => !!c && c.source_ids.some((id) => ["ted", "site", "prh"].includes(sources.get(id)?.kind ?? ""))
  // Card 1's company-level reason. Pages from before the "why" line keep their "what we checked" sentence there when it
  // cites public evidence; a "we found nothing public" sentence is not a reason and stays out of the card.
  const why = letter?.why ?? (isPublic(letter?.checked) && !/found nothing/i.test(letter!.checked!.text) ? letter!.checked : null)
  const path = letter?.path ?? null
  // Company-level quantity from cited evidence only: EU contracts the company itself won (scale.ts), never a headcount.
  const won = opps.length ? contractsWon(company.name, [...sources.values()], why?.source_ids) : null
  const checked = [letter?.scale, why, path, won && { text: "", source_ids: won.ids }].filter((c): c is Claim => !!c)
  // Everything the page rests on, by kind and date, cited or not (a hallway source from another lead is not this page's).
  const checkedItems = checkedLine([...sources.values()].filter((x) => x.kind !== "hallway" || x.id === hallway?.id))
  const questions = letter?.questions ?? []
  // Number citations in reading order: quote, cards, what we checked, questions, script, then the register line.
  const order: string[] = []
  for (const id of [hallway?.id, ...opps.flatMap((o) => o.claim.source_ids), ...opps.flatMap((o) => o.formula.input_source_ids), ...checked.flatMap((c) => c.source_ids), ...questions.flatMap((c) => c.source_ids), ...script.flatMap((l) => l.source_ids), prh?.id])
    if (id && sources.has(id) && !order.includes(id)) order.push(id)
  const cited = order.map((id, i) => ({ n: i + 1, ...sources.get(id)! }))
  const num = Object.fromEntries(cited.map((c) => [c.id, c.n]))
  const synthetic = /\(synthetic\)/i.test(company.name)
  const demoNote = !!lead?.synthetic || synthetic
  const approved = page.status === "approved"
  const reader = letter?.recipient ?? null
  const name = company.name.replace(/\s*\(synthetic\)\s*/i, "")
  const date = new Date(page.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Helsinki" })
  // The script's closing question is the page's one ask; show it on its own, not only inside the audio.
  const ask = script.at(-1)?.text.includes("?") ? script.at(-1) : undefined
  // Lead with the question itself; the terms after it are small print, not a second paragraph to wade through.
  const q = ask ? ask.text.indexOf("?") + 1 : 0
  const top = headline(opps[0])
  const pilotTeam = opps[0] ? `${fi(opps[0].formula.people)} ${opps[0].formula.people === 1 ? "person" : "people"}` : ""
  // The note's hours converted in code (hours.ts), shown only when card 1's formula uses exactly those numbers.
  const h = showQuote ? hoursFromQuote(lead.quote) : null
  // A page made before hours.ts may hold a rounded value (2 for 2.1): shown with that rounding said, never a different number.
  const hours = h && opps[0] && Math.abs(opps[0].formula.hours_per_week - h.eachPerWeek) <= 0.25 && (!h.people || opps[0].formula.people === h.people) ? h : null
  const rounded = hours && opps[0].formula.hours_per_week !== hours.eachPerWeek ? `; the formula rounds it to ${fi(opps[0].formula.hours_per_week)} h` : ""
  // Two sentences the hallway contact can forward to the executive: the process with its estimate, then the one question.
  const fwdFirst = opps[0] && top
    ? `${fiText(opps[0].claim.text.split(/(?<=[.!?])\s/)[0])} ${top.eur ?? top.h1.at(-1)!.replace(/\.$/, "")} (${top.label}; the working is on the page).`
    : questions[0] ? `What the public record shows: ${fiText(questions[0].text)}` : null
  const fwdText = fwdFirst && ask ? [why && fiText(why.text), fwdFirst, fiText(ask.text.slice(0, q))].filter(Boolean).join(" ") : null
  // We store no event name, only when the lead was captured.
  const met = lead ? `Met in a conference hallway, ${day(lead.created_at)}` : null
  // Reply yes opens the viewer's own mail app, addressed to our inbox. The app sends nothing (CLAUDE.md rule 1).
  // No real inbox configured (the db.ts fallback is a localhost address): say what the button does instead of linking it.
  // The .env.example placeholder (your-team@velho.example) counts as unset: .example addresses never receive mail.
  const inbox = process.env.HH_OWN_INBOX && !/\.example$/i.test(process.env.HH_OWN_INBOX) ? process.env.HH_OWN_INBOX : null
  const yes = inbox && `mailto:${inbox}?subject=${encodeURIComponent(`Yes: the one-page teardown for ${name}`)}&body=${encodeURIComponent(`Yes, please send the teardown.\n\n(Velho draft ${slug})`)}`

  return (
    <div className="paper"><div className={s.desk}>
      <article className={s.letter}>
        <Letterhead />
        {met && <p className={s.stub}>{met}</p>}

        <p className={s.eyebrow}>{reader ? `For the ${reader}, ${name}` : `Made for ${name}`}</p>
        {top ? (
          <>
            <h1 className={s.h1}>{top.h1.map((t) => <span key={t}>{t}</span>)}</h1>
            {why && <Why why={why} name={name} num={num} lead />}
            <p className={s.deck}>
              <span className={s.pilotLabel}>The pilot</span>{" "}
              {pilotTeam}, one task{top.h1.length === 1 && top.h1[0].startsWith(opps[0].title.slice(0, 12)) ? "" : `, ${opps[0].title.charAt(0).toLowerCase() + opps[0].title.slice(1)}`}{top.eur ? <>: {top.eur.charAt(0).toLowerCase() + top.eur.slice(1)} <span className={s.tag}>{top.label}</span></> : null}. It covers this team, not all of {name}; the working is below, change any number.
            </p>
          </>
        ) : <h1 className={s.h1}>A first look at {name}</h1>}

        {showQuote && (
          <figure className={s.quote}>
            <blockquote>“{lead.quote}”</blockquote>
            <figcaption>{lead.role}, {name} {hallway && <Chips ids={[hallway.id]} num={num} />}</figcaption>
            {demoNote && <p className={s.demoNote}>Demo note, invented for this demo; nobody at {name} said this.</p>}
          </figure>
        )}

        <section className={s.section} aria-labelledby="start">
          <h2 id="start" className={s.h2}>{opps.length > 1 ? `${opps.length} places to start` : opps.length ? "Where to start" : questions.length ? "What we'd ask you" : "Thin data"}</h2>
          {opps.length === 0 && !questions.length && <p className={s.muted}>We did not find enough evidence to suggest anything specific yet.</p>}
          {opps.length === 0 && questions.length > 0 && (
            <>
              <p className={s.muted}>No one at {name} has told us about a manual task yet, so there is no estimate. These are the questions the public record raises.</p>
              <ol className={s.questions}>
                {questions.map((x, i) => <li key={i}>{fiText(x.text)} <Chips ids={x.source_ids} num={num} /></li>)}
              </ol>
            </>
          )}
          <ol className={s.cards}>
            {opps.map((o, i) => (
              <li key={o.id} className={s.card}>
                <h3 className={s.h3}>{opps.length > 1 && <span className={s.cardNum}>{i + 1}.</span>}{o.title}</h3>
                <p className={s.claim}>{fiText(withoutEcho(o.claim.text, showQuote ? lead.quote : null))} <Chips ids={o.claim.source_ids} num={num} /></p>
                {i === 0 && !top && why && <Why why={why} name={name} num={num} />}
                <FormulaRow formula={o.formula} chips={<Chips ids={o.formula.input_source_ids} num={num} />} />
                {i === 0 && hours && <p className={s.hours}>Hours from the note, worked out: {fiText(hours.working)}{rounded}.</p>}
                {i === 0 && (path || letter?.scale || won) && (
                  <p className={s.path}>
                    {path && <><span className={s.whyLabel}>Start as a pilot</span>{fiText(path.text)} <Chips ids={path.source_ids} num={num} /> </>}
                    {won && <><span className={s.whyLabel}>Beyond the pilot</span>{fiText(contractsText(won, company.name))} <Chips ids={won.ids} num={num} /> </>}
                    {letter?.scale && <span className={s.muted}>For scale, {fiText(letter.scale.text)} <Chips ids={letter.scale.source_ids} num={num} /></span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {opps.length === 0 && letter?.scale && <p className={s.muted}>For scale, {fiText(letter.scale.text)} <Chips ids={letter.scale.source_ids} num={num} /></p>}
          {checkedItems.length > 0 && (
            <p className={s.checked}>
              <span className={s.checkedH}>What we checked</span>
              {checkedItems.join(" · ")}.{opps.length > 0 && !why && " Nothing public we found ties to this process yet."}
            </p>
          )}
        </section>

        {ask && (
          <section className={s.ask} aria-labelledby="ask">
            <h2 id="ask" className={s.h2}>One question</h2>
            <p className={s.askText}>{fiText(ask.text.slice(0, q))}</p>
            <p className={s.askTerms}>{fiText(ask.text.slice(q).trim()) || TERMS}</p>
            <p className={s.yesRow}>
              {yes ? <>
                <a className={s.yes} href={yes}>Reply yes</a>
                <span className={s.yesNote}>Opens your own email app, addressed to Velho. Nothing is sent until you press send.</span>
              </> : <span className={s.yesNote}>In use, a &ldquo;Reply yes&rdquo; button here opens a reply to your Velho consultant in your own email app. Nothing is sent from this page.</span>}
            </p>
          </section>
        )}

        {fwdText && lead && (
          <Forward reader={reader ?? "COO"} text={fwdText} subject={`For the ${reader ?? "COO"}: ${opps[0]?.title ?? `a first look at ${name}`} (Velho draft)`} />
        )}

        <div className={s.sign}>
          <span className={s.signRole}>Velho consultant</span>
          <span className={s.muted}>{approved
            ? <>Velho · drafted by Velho&apos;s AI analysts, checked by a person at Velho before you saw it.</>
            : <>Velho · drafted by Velho&apos;s AI analysts. Draft, not yet reviewed by a person at Velho.</>}</span>
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
