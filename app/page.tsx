import Link from "next/link"
import { all } from "@/lib/db.ts"
import type { PageStatus } from "@/lib/types.ts"
import s from "./home.module.css"

export const dynamic = "force-dynamic"

// Newest non-killed draft per company, so a first-time visitor reaches a real output in one click.
const latest = () =>
  all<{ slug: string; name: string; status: PageStatus; created_at: string }>(
    `SELECT p.slug, c.name, p.status, p.created_at FROM pages p JOIN companies c ON c.id = p.company_id
     WHERE p.status != 'killed' AND p.created_at = (SELECT MAX(created_at) FROM pages WHERE company_id = p.company_id AND status != 'killed')
     ORDER BY p.created_at DESC LIMIT 5`,
  )

const STATUS: Record<PageStatus, string> = {
  draft: "Being written",
  pending_approval: "Waiting for a person to approve",
  approved: "Approved by Velho",
  killed: "Withdrawn",
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Helsinki" })

const svg = { width: 40, height: 40, viewBox: "0 0 40 40", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const

const STEPS = [
  {
    when: "At the stand",
    title: "Snap their badge",
    text: "A photo of a badge or business card, or just the company name. We find the right legal entity in the Finnish trade register.",
    icon: (
      <svg {...svg}><rect x="9" y="8" width="22" height="27" rx="3" /><path d="M16 8V5h8v3" /><circle cx="20" cy="18" r="4" /><path d="M14 29c1.2-3 3.4-4.5 6-4.5s4.8 1.5 6 4.5" /></svg>
    ),
  },
  {
    when: "In about 10 seconds",
    title: "Read a cited brief",
    text: "120 words before the conversation ends: what they do, recent signals, openers and what not to say. Every line links to its source.",
    icon: (
      <svg {...svg}><path d="M10 5h15l6 6v24H10z" /><path d="M25 5v6h6" /><path d="M15 17h11M15 22h11M15 27h6" /><circle cx="27" cy="27" r="2.4" fill="currentColor" stroke="none" /></svg>
    ),
  },
  {
    when: "Overnight",
    title: "A page for them",
    text: "Their own words, one to three costed processes to fix, one yes/no question and a short audio briefing. A person at Velho approves it first.",
    icon: (
      <svg {...svg}><rect x="6" y="6" width="20" height="26" rx="2" /><path d="M11 13h10M11 18h10M11 23h6" /><path d="M30 14v12M34 17v6M26 19v2" /><circle cx="29" cy="31" r="5" fill="var(--card)" /><path d="m26.8 31 1.6 1.6 3-3.2" /></svg>
    ),
  },
]

export default function Home() {
  const pages = latest()
  return (
    <div className="paper">
      <main className={s.wrap}>
        <header className={s.top}>
          <span className={s.brand}>Hallway Hunter</span>
          <span className={s.by}>by Velho</span>
        </header>

        <section className={s.hero}>
          <p className={s.eyebrow}>For Velho consultants at trade fairs</p>
          <h1 className={s.h1}>Turn a hallway handshake into a page made for their company.</h1>
          <p className={s.lede}>
            Snap a badge, read a cited brief before the conversation ends, and wake up to a one-page draft that a person at Velho approves before anything leaves.
          </p>
          <Link href="/capture" className={s.cta}>Try it on any Finnish company <span aria-hidden>→</span></Link>
        </section>

        <section aria-labelledby="how">
          <h2 id="how" className={s.h2}>How it works</h2>
          <ol className={s.steps}>
            {STEPS.map((x, i) => (
              <li key={x.title} className={s.step}>
                <div className={s.stepIcon}>{x.icon}</div>
                <p className={s.stepWhen}><span>{String(i + 1).padStart(2, "0")}</span> {x.when}</p>
                <h3 className={s.h3}>{x.title}</h3>
                <p className={s.stepText}>{x.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {pages.length > 0 && (
          <section aria-labelledby="latest" className={s.latest}>
            <h2 id="latest" className={s.h2}>Latest drafts</h2>
            <ul className={s.drafts}>
              {pages.map((p) => {
                const synthetic = /\(synthetic\)/i.test(p.name)
                return (
                  <li key={p.slug}>
                    <Link href={`/p/${p.slug}`} className={s.draft}>
                      <span className={s.made}>Made for</span>
                      <span className={s.company}>{p.name.replace(/\s*\(synthetic\)\s*/i, "")}</span>
                      <span className={s.status} data-status={p.status}>{STATUS[p.status] ?? p.status}</span>
                      <span className={s.date}>{when(p.created_at)}{synthetic && " · synthetic demo"}</span>
                    </Link>
                  </li>
                )
              })}
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
