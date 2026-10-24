// PRH YTJ v3 open-data client (read-only GETs). NIGHT imports searchCompanies/loadCompany: keep signatures.
import { addSource, all, get, insert, now, run, uid } from "../db.ts"
import type { Company, Source } from "../types.ts"

const BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies"
const YTUNNUS = /^\d{7}-\d$/

export interface Candidate { business_id: string; name: string; line: string; registered: string; ceased: boolean }

type Desc = { languageCode: string; description: string }
type Dated = { registrationDate?: string; endDate?: string }
export interface PrhCompany extends Dated {
  businessId: { value: string; registrationDate?: string }
  names: ({ name: string; type: string } & Dated)[]
  mainBusinessLine?: { descriptions?: Desc[] } | null
  companyForms?: ({ descriptions?: Desc[] } & Dated)[]
  companySituations?: ({ descriptions?: Desc[] } & Dated)[]
  registeredEntries?: ({ type: string } & Dated)[]
  addresses?: { type?: number; postOffices?: { city: string; languageCode: string }[] }[]
  website?: { url?: string } | null
}

const en = (d?: Desc[]) => d?.find((x) => x.languageCode === "3")?.description ?? d?.find((x) => x.languageCode === "1")?.description ?? ""
const open = <T extends Dated>(xs?: T[]) => (xs ?? []).filter((x) => !x.endDate)
const latest = <T extends Dated>(xs: T[]) => [...xs].sort((a, b) => (b.registrationDate ?? "").localeCompare(a.registrationDate ?? ""))[0]

// Ceased = company endDate, or an open registered entry of type "4" ("Lakannut"). Verified on 0595625-5
// (ceased 2010). PRH `status` is "2" for both live and ceased firms, so it is ignored.
export function isCeased(c: PrhCompany): boolean {
  return Boolean(c.endDate) || open(c.registeredEntries).some((e) => e.type === "4")
}

export function parseCompany(c: PrhCompany) {
  const official = c.names.filter((n) => n.type === "1")
  const name = (open(official)[0] ?? latest(official) ?? latest(c.names))?.name ?? c.businessId.value
  const url = c.website?.url?.trim()
  return {
    business_id: c.businessId.value,
    name,
    line: en(c.mainBusinessLine?.descriptions ?? undefined),
    registered: (c.registrationDate ?? c.businessId.registrationDate ?? "").slice(0, 4),
    ceased: isCeased(c),
    ceased_on: c.endDate ?? open(c.registeredEntries).find((e) => e.type === "4")?.registrationDate ?? null,
    form: en(latest(c.companyForms ?? [])?.descriptions),
    situations: open(c.companySituations).map((s) => en(s.descriptions)).filter(Boolean),
    city: c.addresses?.[0]?.postOffices?.find((p) => p.languageCode === "1")?.city ?? c.addresses?.[0]?.postOffices?.[0]?.city ?? "",
    website: url ? (/^https?:\/\//i.test(url) ? url : `https://${url}`) : null,
  }
}

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()

// Name without its legal form, so "Vaisala" matches "Vaisala Oyj" exactly.
export const base = (s: string) => norm(s).replace(/\b(oyj|oy|abp|ab|ltd|plc|ky|tmi|ry)\b/g, "").replace(/\s+/g, " ").trim()

// Rank fuzzy PRH name hits: exact > prefix > contains > rest (legal form ignored); ceased firms last; shorter first.
export function rank(q: string, cs: Candidate[]): Candidate[] {
  const nq = base(q)
  const score = (c: Candidate) => {
    const n = base(c.name)
    return (n === nq ? 0 : n.startsWith(nq) ? 1 : n.includes(nq) ? 2 : 3) + (c.ceased ? 10 : 0)
  }
  return [...cs].sort((a, b) => score(a) - score(b) || a.name.length - b.name.length)
}

// The one live candidate whose name (legal form ignored) equals the query, if exactly one exists.
export const exactLive = (q: string, cs: Candidate[]) => {
  const hits = cs.filter((c) => !c.ceased && base(c.name) === base(q))
  return hits.length === 1 ? hits[0] : null
}

// 10-minute in-memory cache: a demo repeats the same lookups, and PRH rate-limits bursts (429).
const cache = new Map<string, { at: number; companies: PrhCompany[] }>()

async function prhGet(params: Record<string, string>): Promise<{ url: string; companies: PrhCompany[] }> {
  const url = `${BASE}?${new URLSearchParams(params)}`
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < 600_000) return { url, companies: hit.companies }
  const go = () => fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } })
    .catch((e) => { throw new Error(e?.name === "TimeoutError" ? "PRH did not answer within 8 s" : "PRH is unreachable (network)") })
  let res = await go()
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500))
    res = await go()
  }
  if (res.status === 404) return { url, companies: [] }
  if (!res.ok) throw new Error(res.status === 429 ? "PRH is rate-limiting us, try again in a minute" : `PRH ${res.status}`)
  const j = (await res.json()) as { companies?: PrhCompany[] }
  cache.set(url, { at: Date.now(), companies: j.companies ?? [] })
  return { url, companies: j.companies ?? [] }
}

// Up to 5 candidates. A Y-tunnus searches by id; anything else is PRH's fuzzy name search.
export async function searchCompanies(q: string): Promise<Candidate[]> {
  q = q.trim()
  if (!q) return []
  const id = YTUNNUS.test(q)
  let companies: PrhCompany[]
  try {
    companies = (await prhGet(id ? { businessId: q } : { name: q })).companies
  } catch (e) {
    // PRH down, slow or rate-limiting: fall back to companies we already looked up (stored PRH records).
    companies = all<{ prh: PrhCompany }>("SELECT prh FROM companies WHERE prh IS NOT NULL AND (business_id = ? OR name LIKE ?) LIMIT 20", q, `%${q}%`).map((r) => r.prh)
    if (!companies.length) throw e
  }
  const cs = companies.map((c) => {
    const p = parseCompany(c)
    return { business_id: p.business_id, name: p.name, line: p.line, registered: p.registered, ceased: p.ceased }
  })
  return rank(q, cs).slice(0, 5)
}

export function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

// "Did you mean": PRH name search is prefix-ish, so a typo ("Ponssee") finds nothing. Retry each
// distinctive word, then the word minus 1-2 trailing chars ("Ponss"), and rank by edit distance.
// Also tries ä/ö for the first 2 a/o ("Wartsila" -> "Wärtsilä"), since visitors type on English keyboards.
// ponytail: 2 positions = 3 extra PRH calls; PRH rate-limits (429) bursts, so don't widen this casually.
export function umlauts(w: string): string[] {
  const at = [...w.matchAll(/[ao]/gi)].slice(0, 2).map((m) => m.index!)
  const out: string[] = []
  for (let mask = 1; mask < 1 << at.length; mask++) {
    const cs = [...w]
    at.forEach((i, b) => { if (mask & (1 << b)) cs[i] = ({ a: "ä", o: "ö", A: "Ä", O: "Ö" } as Record<string, string>)[cs[i]] })
    out.push(cs.join(""))
  }
  return out
}

export async function didYouMean(q: string): Promise<Candidate[]> {
  const words = q.split(/[\s,.]+/).filter((w) => w.length >= 4 && !/^(oyj|abp|ltd|group|finland)$/i.test(w))
  // Round 1: the whole query with ä/ö ("Hameenlinnan Energia"). Then each word, trimmed and with ä/ö.
  const rounds = [umlauts(q), ...words.map((w) => [w, w.slice(0, -1), w.slice(0, -2)].filter((t, i) => i === 0 || t.length >= 5))]
  const nq = base(q)
  const d = (c: Candidate) => lev(base(c.name), nq) + (c.ceased ? 100 : 0)
  let fallback: Candidate[] = []
  for (const tries of rounds) {
    if (!tries.length) continue
    const pages = await Promise.all(tries.map((t) => prhGet({ name: t }).then((r) => r.companies, () => [] as PrhCompany[])))
    const seen = new Map<string, Candidate>()
    for (const c of pages.flat()) {
      const p = parseCompany(c)
      seen.set(p.business_id, { business_id: p.business_id, name: p.name, line: p.line, registered: p.registered, ceased: p.ceased })
    }
    const ranked = [...seen.values()].sort((a, b) => d(a) - d(b) || a.name.length - b.name.length).slice(0, 5)
    if (ranked.some((c) => !c.ceased)) return ranked
    if (!fallback.length) fallback = ranked // only ceased namesakes so far; keep looking for a live one
  }
  return fallback
}

export function prhExcerpt(p: ReturnType<typeof parseCompany>): string {
  return [
    `${p.name} (${p.business_id})${p.form ? `, ${p.form}` : ""}.`,
    p.line && `Main business line: ${p.line}.`,
    p.registered && `Registered ${p.registered}.`,
    p.city && `Registered address: ${p.city}.`,
    p.ceased ? `Status: CEASED${p.ceased_on ? ` on ${p.ceased_on}` : ""}.` : "Status: active in the trade register.",
    p.situations.length ? `Situation: ${p.situations.join(", ")}.` : "",
    p.website && `Website: ${p.website}.`,
  ].filter(Boolean).join(" ")
}

// Upserts the company; adds a 'prh' source only when the record changed. It is fetched from the open-data API but
// cited by the human YTJ page for the same Y-tunnus, so a reader who taps the chip gets a page, not raw JSON.
const ytjUrl = (businessId: string) => `https://tietopalvelu.ytj.fi/yritys/${businessId}`
export async function loadCompany(businessId: string): Promise<Company> {
  if (!YTUNNUS.test(businessId)) throw new Error(`not a Y-tunnus: ${businessId}`)
  let companies: PrhCompany[]
  try {
    ({ companies } = await prhGet({ businessId }))
  } catch (e) {
    const stored = get<Company>("SELECT * FROM companies WHERE business_id = ? AND prh IS NOT NULL", businessId)
    if (stored && prhSource(stored.id)) return stored // PRH unreachable: reuse the record and source we already cite
    throw e
  }
  const raw = companies[0]
  if (!raw) throw new Error(`PRH has no company ${businessId}`)
  const p = parseCompany(raw)
  let co = get<Company>("SELECT * FROM companies WHERE business_id = ?", businessId)
  if (co) {
    run("UPDATE companies SET name = ?, website = COALESCE(?, website), prh = ? WHERE id = ?", p.name, p.website, raw, co.id)
  } else {
    insert("companies", { id: uid("co"), business_id: businessId, name: p.name, website: p.website, prh: raw, created_at: now() })
  }
  co = get<Company>("SELECT * FROM companies WHERE business_id = ?", businessId)!
  const excerpt = prhExcerpt(p)
  const prev = prhSource(co.id)
  // Keep the old id when nothing changed, so earlier citations stay valid.
  if (!prev || prev.excerpt !== excerpt.slice(0, 600)) addSource({ company_id: co.id, kind: "prh", url: ytjUrl(businessId), title: `PRH trade register: ${p.name}`, excerpt })
  return co
}

export const prhSource = (companyId: string) =>
  get<Source>("SELECT * FROM sources WHERE company_id = ? AND kind = 'prh' ORDER BY fetched_at DESC LIMIT 1", companyId)
