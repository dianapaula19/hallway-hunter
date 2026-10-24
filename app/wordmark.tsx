import Link from "next/link"

// Placeholder typographic identity ("Velho" in Source Serif + one navy accent dot), pending Velho's real brand.
// Not their logo; styles are .wordmark* in globals.css. See PROCESS.md.
export function Wordmark({ product, href = "/" }: { product?: string; href?: string }) {
  return (
    <Link href={href} className="wordmark">
      <span className="wordmark-name">Velho</span>
      {product && <span className="wordmark-product">{product}</span>}
    </Link>
  )
}
