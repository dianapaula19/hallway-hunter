// One public size fact (employees, dealers, countries...) from the company's own site, stored as a cited 'site' source.
// Deterministic, no model: the homepage plus at most 2 "about" pages it links to, GET only, own domain (LIVE's guard).
// The stored excerpt is the sentence that holds the number, so the claim's source shows exactly what it relies on.
import { addSource, get } from "../db.ts"
import type { Claim, Company, Source } from "../types.ts"
import { allowedUrl, htmlToText } from "../live/site.ts"
import { stem } from "../live/ted.ts"

const UNIT = "employees|professionals|people|experts|staff|dealers|distributors|service technicians|service engineers|technicians|stores|shops|countries|työntekijää|henkilöä|myymälää"
const FACT = new RegExp(`(?:over |more than |about |around |approximately |noin |yli )?(\\d{1,3}(?:[ ,.\\u00a0\\u202f]\\d{3})+|\\d{2,6})\\s?\\+?\\s*(${UNIT})\\b`, "i")
const ABOUT = /about|company|who-we-are|in-brief|yritys|meista|tietoa|konserni/i
// Headcount beats footprint: a page that says both "18,500 professionals" and "40 countries" should lead with people.
const RANK = (unit: string) => (/countries/i.test(unit) ? 1 : 0)

// The sentence around the first size fact in a page's text, or null.
export function scaleSentence(text: string): { sentence: string; phrase: string; count: number; unit: string } | null {
  const hits = [...text.matchAll(new RegExp(FACT.source, "gi"))]
    .map((m) => ({ m, count: Number(m[1].replace(/[^\d]/g, "")), unit: m[2].toLowerCase() }))
    .filter((h) => h.count >= 10 && !(h.count >= 1900 && h.count <= 2100 && !/[ ,.  ]/.test(h.m[1]))) // "2026 employees" is a year
    .sort((a, b) => RANK(a.unit) - RANK(b.unit))
  const h = hits[0]
  if (!h) return null
  const i = h.m.index ?? 0
  const start = Math.max(text.lastIndexOf(". ", i) + 2, i - 160, 0)
  const endDot = text.indexOf(". ", i + h.m[0].length)
  const end = Math.min(endDot < 0 ? text.length : endDot + 1, i + h.m[0].length + 160)
  return { sentence: text.slice(start, end).trim(), phrase: h.m[0].trim(), count: h.count, unit: h.unit }
}

async function getPage(company: Company, url: string): Promise<{ url: string; html: string } | null> {
  const u = allowedUrl(company, url)
  if (!u) return null
  try {
    const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "HallwayHunter/0.1 (read-only research)", accept: "text/html" } })
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html") || !allowedUrl(company, res.url || u.href)) return null
    return { url: res.url || u.href, html: (await res.text()).slice(0, 800_000) }
  } catch { return null }
}

// Returns the stored source (reused if this company already has one), or null when no page states a size.
export async function findScale(company: Company): Promise<Source | null> {
  const known = get<Source>("SELECT * FROM sources WHERE company_id = ? AND kind = 'site' AND title LIKE 'Size: %' ORDER BY fetched_at DESC LIMIT 1", company.id)
  if (known) return known
  const s = stem(company.name).toLowerCase().normalize("NFD").replace(/[^a-z0-9-]/g, "")
  const homes = company.website ? [company.website] : [`https://www.${s}.com/`, `https://www.${s}.fi/`]
  for (const home of homes) {
    const first = await getPage(company, home)
    if (!first) continue
    const links = [...new Set([...first.html.matchAll(/href="([^"#?]+)"/gi)].map((m) => { try { return new URL(m[1], first.url).href } catch { return "" } }))]
      .filter((h) => h && ABOUT.test(new URL(h).pathname) && allowedUrl(company, h))
      .sort((a, b) => a.length - b.length)
      .slice(0, 2)
    for (const page of [first, ...(await Promise.all(links.map((l) => getPage(company, l))))]) {
      if (!page) continue
      const { title, text } = htmlToText(page.html)
      const hit = scaleSentence(text)
      if (hit) return addSource({ company_id: company.id, kind: "site", url: page.url, title: `Size: ${title || new URL(page.url).hostname}`, excerpt: hit.sentence })
    }
  }
  return null
}

// The cited line the page shows and the skeptic reads: "Valmet's own site: “18,500 employees”."
export function scaleClaim(s: Source, companyName: string): Claim | null {
  const hit = scaleSentence(s.excerpt)
  return hit ? { text: `${stem(companyName)}'s own site: “${hit.phrase}”.`, source_ids: [s.id] } : null
}

// A company-level quantity from cited evidence, never a headcount guess: the EU contracts won by the company itself.
// Counts TED award (or VEAT) sources whose winner line names the company's registered name, plus any TED source the page
// already cites (the why line). Namesakes abroad ("MIPRO d.o.o." for Mipro Oy) and subsidiaries are left out: undercounting
// is the honest direction. Two or more, or it is not a scale line.
export function contractsWon(companyName: string, sources: Pick<Source, "id" | "kind" | "excerpt">[], cited: string[] = []): { n: number; ids: string[]; from: string; to: string } | null {
  const name = companyName.replace(/\s*\(synthetic\)\s*/i, "").toLowerCase()
  const won = sources.filter((x) => x.kind === "ted" && /^\d{4}-\d{2}-\d{2} (contract award|veat)\b/.test(x.excerpt) &&
    (cited.includes(x.id) || (x.excerpt.match(/Tenderer\/winner incl\. (.+)$/)?.[1] ?? "").toLowerCase().split(/,\s*/).some((w) => w.replace(/\.$/, "") === name)))
  if (won.length < 2) return null
  const dates = won.map((x) => x.excerpt.slice(0, 10)).sort()
  return { n: won.length, ids: won.map((x) => x.id), from: dates[0], to: dates.at(-1)! }
}

// The page's and the reader test's wording of it: the cited count, then the scaling as a marked question, no euro number.
export function contractsText(c: { n: number; from: string; to: string }, companyName: string): string {
  const my = (d: string, year = true) => new Date(d).toLocaleDateString("en-GB", { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Europe/Helsinki" })
  const span = my(c.from) === my(c.to) ? my(c.from) : c.from.slice(0, 4) === c.to.slice(0, 4) ? `${my(c.from, false)}–${my(c.to)}` : `${my(c.from)}–${my(c.to)}`
  return `${c.n} EU contracts won by ${stem(companyName)} on the public record, ${span} (TED). If each brings work like this, the pilot's working repeats per contract; how many do is a question for you, not a number we can source.`
}

// Self-check (no network): node lib/night/scale.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  assert.deepEqual(
    (({ count, unit }) => ({ count, unit }))(scaleSentence("We operate in 40 countries. Valmet has over 18,500 professionals around the world. Join us.")!),
    { count: 18500, unit: "professionals" })
  assert.equal(scaleSentence("Our 2,400+ employees serve customers.")?.count, 2400)
  assert.equal(scaleSentence("Founded in 2026 employees? no. Nothing else here."), null)
  assert.equal(scaleSentence("Results for 2025 people. Read more.")?.count ?? null, null)
  assert.match(scaleSentence("Intro text. Ponsse has around 2 100 employees and 40 dealers. Next.")!.sentence, /^Ponsse has around 2 100 employees/)
  const ted = (id: string, excerpt: string) => ({ id, kind: "ted" as const, excerpt })
  const mipro = [
    ted("a", '2026-10-08 contract award: "x". Buyer: LUKA KOPER. Tenderer/winner incl. MIPRO, trgovina in storitve, d.o.o..'),
    ted("b", '2026-09-02 veat: "x". Buyer: Väylävirasto. Tenderer/winner incl. Mipro Oy.'),
    ted("c", '2026-09-02 veat: "y". Buyer: Väylävirasto. Tenderer/winner incl. Mipro Oy.'),
  ]
  assert.deepEqual(contractsWon("Mipro Oy", mipro), { n: 2, ids: ["b", "c"], from: "2026-09-02", to: "2026-09-02" })
  assert.equal(contractsWon("Mipro Oy", mipro.slice(0, 2)), null)
  assert.equal(contractsWon("Ponsse Oyj", [ted("d", '2026-07-27 contract award: "x". Buyer: Lesy. Tenderer/winner incl. Ponsse Czech s.r.o..'), ted("e", '2026-09-02 contract award: "x". Buyer: E. Tenderer/winner incl. Ponsse Oyj.')], ["d"])?.n, 2)
  console.log("scale self-check ok")
}
