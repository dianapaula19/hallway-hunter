import Link from "next/link"

// Any unknown URL, including a mistyped or incomplete /p/<slug> link.
export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>There is nothing at this address. If someone at Velho sent you a link, check that it was copied in full: the part after /p/ is case-sensitive.</p>
      <p><Link href="/">Hallway Hunter home</Link></p>
    </main>
  )
}
