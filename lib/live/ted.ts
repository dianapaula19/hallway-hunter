// TED v3 notice search (anonymous POST search, read-only). NIGHT imports tedSearch: keep the signature.
import { addSource, get } from "../db.ts"
import type { Company, Source } from "../types.ts"
import { norm } from "./prh.ts"

const SEARCH = "https://api.ted.europa.eu/v3/notices/search"
const FIELDS = ["publication-number", "notice-title", "publication-date", "buyer-name", "notice-type", "organisation-name-tenderer"]
const LEGAL = /^(oyj|oy|ab|abp|ltd|ky|ay|ry|osk|tmi|as|plc|group|finland|suomi)$/i

type Lang = Record<string, string | string[]>
export interface TedNotice {
  "publication-number": string
  "publication-date"?: string
  "notice-type"?: string
  "notice-title"?: Lang
  "buyer-name"?: Lang
  "organisation-name-tenderer"?: Lang
}

export interface TedHit { number: string; date: string; type: string; title: string; buyers: string[]; tenderers: string[]; role: "tenderer" | "buyer"; url: string }

// Distinctive name stem for TED's fuzzy `~` match: "Wärtsilä Oyj Abp" -> "Wärtsilä".
export function stem(name: string): string {
  const words = name.replace(/["()]/g, " ").split(/\s+/).filter((w) => w && !LEGAL.test(w.replace(/\.$/, "")))
  return (words.find((w) => w.length >= 4) ?? words[0] ?? name).replace(/[^\p{L}\p{N}&-]/gu, "")
}

const pick = (o?: Lang): string => {
  if (!o) return ""
  const v = o.eng ?? o.fin ?? Object.values(o)[0]
  return Array.isArray(v) ? v[0] ?? "" : v ?? ""
}
const allNames = (o?: Lang) => [...new Set(Object.values(o ?? {}).flat())]

// Keep only notices where the stem really appears in a party name (TED `~` is fuzzy).
export function parseNotices(notices: TedNotice[], companyName: string): TedHit[] {
  const s = norm(stem(companyName))
  return notices.flatMap((n): TedHit[] => {
    const tenderers = allNames(n["organisation-name-tenderer"])
    const buyers = allNames(n["buyer-name"])
    const role = tenderers.some((t) => norm(t).includes(s)) ? "tenderer" : buyers.some((b) => norm(b).includes(s)) ? "buyer" : null
    if (!role) return []
    const num = n["publication-number"]
    return [{
      number: num, date: (n["publication-date"] ?? "").slice(0, 10), type: n["notice-type"] ?? "", title: pick(n["notice-title"]),
      buyers, tenderers, role, url: `https://ted.europa.eu/en/notice/-/detail/${num}`,
    }]
  })
}

const TYPE: Record<string, string> = { "can-standard": "contract award", "cn-standard": "contract notice", "pin-only": "prior information notice" }

export function tedExcerpt(h: TedHit, companyName: string): string {
  return `${[h.date, TYPE[h.type] ?? (h.type || "notice")].filter(Boolean).join(" ")}: "${h.title}". Buyer: ${h.buyers.join(", ") || "n/a"}. ` +
    (h.role === "tenderer" ? `Tenderer/winner incl. ${h.tenderers.filter((t) => norm(t).includes(norm(stem(companyName)))).join(", ")}.` : `${companyName} is the buyer.`)
}

async function search(query: string, limit: number): Promise<TedNotice[]> {
  const res = await fetch(SEARCH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, fields: FIELDS, limit }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`TED ${res.status}`)
  return ((await res.json()) as { notices?: TedNotice[] }).notices ?? []
}

export async function tedQuery(companyName: string, limit = 3): Promise<TedHit[]> {
  const s = stem(companyName)
  // `~` is fuzzy and ignores ä/ö ("Wartsila" finds Wärtsilä), so it goes first; over-fetch, then drop false positives.
  let hits = parseNotices(await search(`(organisation-name-tenderer ~ "${s}" OR buyer-name ~ "${s}") SORT BY publication-date DESC`, Math.min(limit * 3, 15)), companyName)
  // A short stem drowns in namesakes: for "Teleste" the newest 9 fuzzy hits were all "SPL Tele GmbH" and the like, and
  // the brief came back thin. Then a prefix match on the stem ("Teleste*") finds the real notices.
  if (hits.length < limit) {
    const more = parseNotices(await search(`(organisation-name-tenderer = "${s}*" OR buyer-name = "${s}*") SORT BY publication-date DESC`, limit * 2).catch(() => []), companyName)
    hits = [...hits, ...more.filter((m) => !hits.some((h) => h.number === m.number))]
  }
  return hits.slice(0, limit)
}

// Persists each hit as a 'ted' source (reusing an existing row for the same notice) and returns them with ids.
export async function tedSearch(company: Company, limit = 3): Promise<Source[]> {
  const hits = await tedQuery(company.name, limit)
  return hits.map((h) =>
    get<Source>("SELECT * FROM sources WHERE company_id = ? AND url = ?", company.id, h.url) ??
    addSource({ company_id: company.id, kind: "ted", url: h.url, title: `TED ${h.number}: ${h.title}`, excerpt: tedExcerpt(h, company.name) }),
  )
}
