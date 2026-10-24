import Link from "next/link"

export default function Home() {
  return (
    <main>
      <h1>Hallway Hunter</h1>
      <p className="muted">Velho draft tools, by Velho&apos;s AI analysts. Nothing here sends email or contacts anyone.</p>
      <ul>
        <li><Link href="/capture">/capture</Link>: photo, company name or voice note to a 120-word brief</li>
        <li><Link href="/hq">/hq</Link>: agent runs, approvals, run the night path now</li>
      </ul>
    </main>
  )
}
