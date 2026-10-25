import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { all, get } from "@/lib/db.ts"
import { ASSUME, isConfidential } from "@/lib/night/compliance.ts"
import type { Claim, Company, Lead, Opportunity, Page, Source } from "@/lib/types.ts"
import { TERMS } from "@/lib/night/script.ts"
import { Chips, Forward, FormulaRow, Player } from "./client.tsx"
import { checkedLine, fi, fiEur, fiText, headline, withoutEcho } from "./letter.ts"
import { eurPerYear } from "@/lib/night/formula.ts"
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

// ?preview=1: opened from /hq. Only then does the page say it is an unreviewed draft; the company reader never sees that line.
export default async function DraftPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { slug } = await params
  const preview = (await searchParams).preview === "1"
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
  const checked = [letter?.scale, why, path].filter((c): c is Claim => !!c)
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
  // The hallway answer to "how many teams like yours?" scales the headline, cited to the note (only when its source is here).
  const teams = letter?.teams && letter.teams.source_ids.every((id) => sources.has(id)) && showQuote ? letter.teams : null
  const top = headline(opps[0], teams?.n)
  const pilotTeam = opps[0] ? `${fi(opps[0].formula.people)} ${opps[0].formula.people === 1 ? "person" : "people"}` : ""
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
  // The script says "a Velho consultant" (no personal names in model output); the printed question names the sender.
  const askQ = ask ? ask.text.slice(0, q).replace(/\ba Velho consultant\b/, process.env.HH_CONSULTANT_NAME?.trim() || "a Velho consultant") : ""
  const yes = ask && inbox && `mailto:${inbox}?subject=${encodeURIComponent(`Yes, for ${name} (Velho draft)`)}&body=${encodeURIComponent(`Yes, please.\n\n${askQ}\n\n(Velho draft ${slug})`)}`
  // The named sender, from the deployment's env. Unset: a placeholder role, never an invented Velho employee.
  const sender = {
    name: process.env.HH_CONSULTANT_NAME?.trim() || "Your Velho consultant",
    role: process.env.HH_CONSULTANT_ROLE?.trim() || null,
    phone: process.env.HH_CONSULTANT_PHONE?.trim() || null,
  }
  const f0 = opps[0]?.formula
  const task = opps[0] ? opps[0].title.charAt(0).toLowerCase() + opps[0].title.slice(1).replace(/[.\s]+$/, "") : null
  // One line that says what is folded: the formula in short, then what else is inside.
  const workingSum = [
    f0 && top ? `${fi(f0.hours_per_week * f0.people)} h a week × ${f0.weeks_per_year} weeks × €${fi(f0.hourly_cost_eur)} × ${fi(Math.round(f0.automation_share * 100))} % = ${fiEur(eurPerYear(f0))}${teams ? ` × ${teams.n} teams` : ""}` : null,
    "sources",
    opps.length ? "editable calculator" : null,
    script.length ? "audio" : null,
  ].filter(Boolean).join(" · ")

  return (
    <div className="paper"><div className={s.desk}>
      <article className={s.letter}>
        <Letterhead />
        {preview && !approved && <p className={s.banner} role="note">Preview for Velho: draft, not yet reviewed by a person at Velho. The company reader does not see this line.</p>}
        {met && <p className={s.stub}>{met}</p>}

        <p className={s.eyebrow}>{reader ? `For the ${reader}, ${name}` : `Made for ${name}`}</p>
        {top ? (
          <>
            <h1 className={s.h1}>{top.h1.map((t) => <span key={t}>{t}</span>)}</h1>
            {top.eur && (
              <p className={s.deck}>
                {top.scaled ? top.eur : `${top.eur} for this team of ${pilotTeam}`} <span className={s.tag}>{top.label}</span>
                {top.scaled && teams && <Chips ids={teams.source_ids} num={num} />}
              </p>
            )}
          </>
        ) : <h1 className={s.h1}>A first look at {name}</h1>}

        {showQuote && (
          <figure className={s.quote}>
            <blockquote>“{lead.quote}”</blockquote>
            <figcaption>{lead.role}, {name} {hallway && <Chips ids={[hallway.id]} num={num} />}</figcaption>
            {demoNote && <p className={s.demoNote}>Demo note, invented for this demo; nobody at {name} said this.</p>}
          </figure>
        )}

        {ask && (
          <section className={s.ask} aria-labelledby="ask">
            <h2 id="ask" className={s.h2}>One question</h2>
            <p className={s.askText}>{fiText(askQ)}</p>
            <p className={s.yesRow}>
              {yes ? <>
                <a className={s.yes} href={yes}>Reply yes</a>
                <span className={s.yesNote}>Opens your own email app, addressed to Velho. Nothing is sent until you press send.</span>
              </> : <span className={s.yesNote}>In use, a &ldquo;Reply yes&rdquo; button here opens a reply to your Velho consultant in your own email app. Nothing is sent from this page.</span>}
            </p>
            <p className={s.askTerms}>{fiText(ask.text.slice(q).trim()) || TERMS}</p>
          </section>
        )}

        <div className={s.sign}>
          <span className={s.signRole}>{sender.name}</span>
          {sender.role && <span>{sender.role}, Velho</span>}
          {sender.phone && <a className={s.tel} href={`tel:${sender.phone.replace(/[^\d+]/g, "")}`}>{sender.phone}</a>}
          <span className={s.muted}>{approved
            ? <>Drafted by Velho&apos;s AI analysts, checked by a person at Velho before you saw it.</>
            : <>Drafted by Velho&apos;s AI analysts.</>}</span>
        </div>

        <details className={s.working}>
          <summary>
            <span className={s.workingH}>The working</span>
            <span className={s.workingSum}>{workingSum}</span>
          </summary>
        {top && why && <Why why={why} name={name} num={num} lead />}
        {top && (
          <p className={s.deck}>
            <span className={s.pilotLabel}>The pilot</span>{" "}
            {pilotTeam}, one task, {task}: {fiEur(eurPerYear(f0!))} a year <span className={s.tag}>{top.label}</span>. It covers this team, not all of {name}{teams ? <>; {fiText(teams.text.charAt(0).toLowerCase() + teams.text.slice(1).replace(/\.$/, ""))} <Chips ids={teams.source_ids} num={num} /></> : null}. Change any number below.
          </p>
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
                <FormulaRow formula={o.formula} chips={<Chips ids={o.formula.input_source_ids} num={num} />}
                  teams={i === 0 ? teams?.n : null} teamsChips={i === 0 && teams ? <Chips ids={teams.source_ids} num={num} /> : null} />
                {i === 0 && (path || letter?.scale) && (
                  <p className={s.path}>
                    {path && <><span className={s.whyLabel}>Start as a pilot</span>{fiText(path.text)} <Chips ids={path.source_ids} num={num} /> </>}
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

        {/* For passing the page on to the person who owns the task (the page itself is addressed to the reader). */}
        {fwdText && lead && task && (
          <Forward title={`Forward to whoever owns ${task}`} text={fwdText} subject={`${opps[0].title} (Velho draft for ${name})`} />
        )}

        {script.length > 0 && (
          <section className={s.ps} aria-labelledby="listen">
            <h2 id="listen" className={s.h2}>Prefer to listen?</h2>
            <Player lines={script} num={num} />
          </section>
        )}

        {cited.length > 0 && (
          <section className={s.ps} aria-labelledby="sources">
            <h2 id="sources" className={s.h2}>Sources</h2>
            <ol className={s.sources}>
              {cited.map((c) => (
                <li key={c.id}>
                  <button className={s.srcLink} popoverTarget={`src-${c.id}`}>{c.title}</button>
                  <span className={s.muted}> · {c.kind === "hallway" ? "hallway note" : c.kind === "note" ? "note" : c.url ? new URL(c.url).hostname : c.kind}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
        </details>

        <footer className={s.foot}>
          <p>
            A <strong>Velho draft</strong>, prepared by Velho&apos;s AI analysts. Every statement links to its source
            (under &ldquo;The working&rdquo;). Every euro figure is an estimate: change any input and it recalculates.
          </p>
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
