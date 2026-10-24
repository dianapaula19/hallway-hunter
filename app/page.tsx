import Link from "next/link"
import { all, get } from "@/lib/db.ts"
import { isConfidential } from "@/lib/night/compliance.ts"
import type { Lead, Opportunity, PageLetter, PageStatus } from "@/lib/types.ts"
import { latestBrief } from "@/lib/live/brief.ts"
import { FORMULA_INPUTS, eurPerYear } from "@/lib/night/formula.ts"
import { fi, fiEur, headline } from "./p/[slug]/letter.ts"
import { BriefCard } from "./brief-card"
import s from "./home.module.css"
import { Wordmark } from "./wordmark"

export const dynamic = "force-dynamic"

// Newest non-killed draft per company, so a first-time visitor reaches a real output in one click.
const latest = () =>
  all<{ slug: string; name: string; status: PageStatus; created_at: string }>(
    `SELECT p.slug, c.name, p.status, p.created_at FROM pages p JOIN companies c ON c.id = p.company_id
     WHERE p.status != 'killed' AND p.created_at = (SELECT MAX(created_at) FROM pages WHERE company_id = p.company_id AND status != 'killed')
     ORDER BY p.created_at DESC LIMIT 5`,
  )

// The before/after artefact: the newest approved or waiting page, preferring one with a hallway quote, drawn small in markup.
function sample() {
  const p = get<{ id: string; slug: string; name: string; lead_id: string | null; letter: PageLetter | null }>(
    `SELECT p.id, p.slug, c.name, p.lead_id, p.letter FROM pages p JOIN companies c ON c.id = p.company_id
     WHERE p.status IN ('approved', 'pending_approval') ORDER BY p.lead_id IS NOT NULL DESC, p.created_at DESC LIMIT 1`,
  )
  if (!p) return null
  const lead = p.lead_id ? get<Lead>("SELECT * FROM leads WHERE id = ?", p.lead_id) ?? null : null
  const top = get<Opportunity>("SELECT * FROM opportunities WHERE page_id = ? ORDER BY position LIMIT 1", p.id)
  return {
    slug: p.slug,
    name: clean(p.name),
    recipient: p.letter?.recipient ?? null,
    role: lead?.role ?? null,
    quote: lead && !isConfidential(lead) ? lead.quote : null,
    synthetic: !!lead?.synthetic || /\(synthetic\)/i.test(p.name),
    head: headline(top),
    formula: top?.formula ?? null,
  }
}

const clean = (name: string) => name.replace(/\s*\(synthetic\)\s*/i, "")

// Public wording: no internal queue states on the front page.
const STATUS: Record<PageStatus, string> = {
  draft: "Being written",
  pending_approval: "In review",
  approved: "Approved",
  killed: "Withdrawn",
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Helsinki" })

export default function Home() {
  const pages = latest()
  const ex = sample()
  const brief = latestBrief()
  return (
    <div className="paper">
      <main className={s.wrap}>
        <header className={s.top}>
          {/* Placeholder wordmark, pending Velho's real brand (PROCESS.md). */}
          <Wordmark product="Hallway Hunter" />
        </header>

        <div className={s.heroRow}>
        <section className={s.hero}>
          <h1 className={s.h1}>From a badge in the hallway to a page made for their company, by the next morning.</h1>
          <p className={s.lede}>
            Snap a badge and read a cited brief before the conversation ends. Overnight, Velho&apos;s AI analysts draft a one-page letter with their own words and a costed first step. A person at Velho approves it before anything leaves.
          </p>
          <Link href="/capture" className={s.cta}>Try it on any Finnish company <span aria-hidden>→</span></Link>
        </section>
        {brief && <BriefCard ex={brief} label="Live · the latest brief" />}
        </div>

        {ex && (
          <figure className={s.artefact}>
            <div className={s.side}>
              <div className={s.badge} aria-label={`Conference badge: ${ex.role ?? "visitor"}, ${ex.name}`}>
                <span className={s.slot} aria-hidden />
                <span className={s.badgeTop}>Visitor</span>
                <span className={s.badgeName} aria-hidden />
                {ex.role && <span className={s.badgeRole}>{ex.role}</span>}
                <span className={s.badgeCo}>{ex.name}</span>
              </div>
              <p className={s.caption}><strong>At the stand.</strong> A photo of the badge, or just the company name. Names are never kept, only the role.</p>
            </div>

            <div className={s.arrow} aria-hidden><span>overnight</span></div>

            <div className={s.side}>
              <Link href={`/p/${ex.slug}`} className={s.mini} aria-label={`Open the page made for ${ex.name}`}>
                <span className={s.miniHead}><span className={`wordmark-name ${s.miniMark}`}>Velho</span><span>Velho draft · by Velho&apos;s AI analysts</span></span>
                <span className={s.miniEyebrow}>{ex.recipient ? `For the ${ex.recipient}, ${ex.name}` : `Made for ${ex.name}`}</span>
                <span className={s.miniH1}>
                  {ex.head ? ex.head.h1.map((t) => <span key={t}>{t}</span>) : <>A first look at {ex.name}</>}
                </span>
                {ex.quote && <span className={s.miniQuote}>“{ex.quote}”</span>}
                {ex.quote && ex.synthetic && <span className={s.miniDemo}>Demo note, invented for this demo; nobody at {ex.name} said this.</span>}
                {ex.formula && (
                  <span className={s.miniCalc} aria-label="The estimate's formula, editable on the page">
                    {FORMULA_INPUTS.map((inp, i) => (
                      <span key={inp.key}>{i > 0 && <span className={s.op}>×</span>}<b>{inp.key === "automation_share" ? `${fi(Math.round(ex.formula![inp.key] * 100))} %` : inp.key === "hourly_cost_eur" ? `€${fi(ex.formula![inp.key])}` : fi(ex.formula![inp.key])}</b></span>
                    ))}
                    <span><span className={s.op}>=</span><b>{fiEur(eurPerYear(ex.formula))}</b> <span className={s.miniTag}>{ex.formula.label}</span></span>
                  </span>
                )}
                <span className={s.miniYes}>Reply yes</span>
              </Link>
              <p className={s.caption}><strong>Next morning.</strong> Their words, the cost worked out and editable, one question. A person at Velho approves it first.</p>
            </div>
          </figure>
        )}

        {pages.length > 0 && (
          <section aria-labelledby="latest" className={s.latest}>
            <h2 id="latest" className={s.h2}>Latest drafts</h2>
            <ul className={s.drafts}>
              {pages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/p/${p.slug}`} className={s.draft}>
                    <span className={s.company}>{clean(p.name)}</span>
                    <span className={s.status}>{STATUS[p.status] ?? p.status}</span>
                    <span className={s.date}>{when(p.created_at)}{/\(synthetic\)/i.test(p.name) && " · synthetic demo"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className={s.foot}>
          <p>
            Nothing here sends email or contacts anyone. Every output is labelled a <strong>Velho draft</strong>, by Velho&apos;s AI analysts, and every statement links to its source.
          </p>
          <p><Link href="/hq">For the Velho team: agent runs and approvals →</Link></p>
        </footer>
      </main>
    </div>
  )
}
