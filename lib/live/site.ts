// Company public-site fetch: GET only, 8 s timeout, text excerpt. NIGHT imports fetchSite: keep the signature.
import { addSource, get } from "../db.ts"
import type { Company, Source } from "../types.ts"
import { norm } from "./prh.ts"
import { stem } from "./ted.ts"

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "")

// Rule 6: only the company's own public site. Known website -> same domain or a subdomain;
// unknown -> the host must contain the company's name stem (kesko.fi for "Kesko Oyj").
// ponytail: hostname check only, no DNS resolve; a public name pointing at a private IP would pass.
export function allowedUrl(company: Pick<Company, "name" | "website">, url: string): URL | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || u.username || u.port) return null
  const host = bare(u.hostname)
  if (/^[\d.]+$|:|^localhost$|\.local$|\.internal$/.test(host) || !host.includes(".")) return null
  if (company.website) {
    let own: string
    try { own = bare(new URL(company.website).hostname) } catch { return null }
    return host === own || host.endsWith(`.${own}`) ? u : null
  }
  return host.replace(/[^a-z0-9]/g, "").includes(norm(stem(company.name)).replace(/[^a-z0-9]/g, "")) ? u : null
}

export function htmlToText(html: string): { title: string; description: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""
  const description = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ?? ""
  const text = html
    .replace(/<(head|script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
  const clean = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim()
  return { title: clean(title), description: clean(description), text: clean(text) }
}

export async function fetchSite(company: Company, url: string): Promise<Source | null> {
  const u = allowedUrl(company, url)
  if (!u) return null
  const existing = get<Source>("SELECT * FROM sources WHERE company_id = ? AND kind = 'site' AND url = ?", company.id, u.href)
  if (existing) return existing
  try {
    const res = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "HallwayHunter/0.1 (read-only research)", accept: "text/html" } })
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null
    if (!allowedUrl(company, res.url || u.href)) return null // redirected off-site
    const { title, description, text } = htmlToText((await res.text()).slice(0, 500_000))
    const excerpt = [description, text].filter(Boolean).join(" | ").slice(0, 600)
    if (!excerpt) return null
    return addSource({ company_id: company.id, kind: "site", url: u.href, title: title || u.hostname, excerpt })
  } catch {
    return null
  }
}
