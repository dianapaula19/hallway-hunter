import Link from "next/link"
import { all } from "@/lib/db.ts"

export const dynamic = "force-dynamic"

// Newest non-killed draft per company, so a first-time visitor reaches a real output in one click.
const latest = () =>
  all<{ slug: string; name: string; status: string }>(
    `SELECT p.slug, c.name, p.status FROM pages p JOIN companies c ON c.id = p.company_id
     WHERE p.status != 'killed' AND p.created_at = (SELECT MAX(created_at) FROM pages WHERE company_id = p.company_id AND status != 'killed')
     ORDER BY p.created_at DESC LIMIT 5`,
  )

export default function Home() {
  const pages = latest()
  return (
    <main>
      <h1>Hallway Hunter</h1>
      <p>
        Meet someone in a conference hallway. Snap their badge and get a cited 120-word brief before the conversation ends.
        Record what they said. Overnight, Velho&apos;s AI analysts turn it into a private one-page draft for their company:
        their own words, one to three costed processes to fix, one yes/no question and a short audio briefing. A person at Velho approves it before anything leaves.
      </p>
      <p><Link href="/capture"><strong>Try it on any Finnish company →</strong></Link></p>
      {pages.length > 0 && (
        <>
          <h2>Latest drafts</h2>
          <ul>
            {pages.map((p) => (
              <li key={p.slug}><Link href={`/p/${p.slug}`}>Made for {p.name}</Link> <span className="muted">· {p.status.replace("_", " ")}</span></li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        <Link href="/hq">/hq</Link>: agent runs, approvals, run the night path now. Every output is labelled a Velho draft, by Velho&apos;s AI analysts. Nothing here sends email or contacts anyone.
      </p>
    </main>
  )
}
