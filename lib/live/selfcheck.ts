// LIVE-lane self-check. Offline asserts use synthetic fixtures shaped like real PRH/TED responses.
//   node lib/live/selfcheck.ts          parsers, ranking, site guard, name scrub, brief fit (no network, no DB)
//   node lib/live/selfcheck.ts --live   also read-only PRH + TED lookups for 5 public companies (no DB writes)
import assert from "node:assert/strict"
import { countWords, fitBrief, signalText } from "./brief.ts"
import { scrubNames, stripNames } from "./lead.ts"
import { didYouMean, exactLive, parentLive, umlauts, isCeased, lev, parseCompany, rank, searchCompanies, type PrhCompany } from "./prh.ts"
import { allowedUrl, htmlToText } from "./site.ts"
import { parseNotices, stem, tedExcerpt, tedQuery, type TedNotice } from "./ted.ts"
import type { Brief } from "../types.ts"

const d = (fi: string, en: string) => [{ languageCode: "1", description: fi }, { languageCode: "3", description: en }]

// ---- PRH: active company with a renamed history, and a ceased one (shape of real 0595625-5) ----
const active: PrhCompany = {
  businessId: { value: "1234567-8", registrationDate: "1999-05-02" },
  names: [
    { name: "Testi Kuljetus Oy", type: "1", registrationDate: "2010-01-01" },
    { name: "Vanha Kuljetus Oy", type: "1", registrationDate: "1999-05-02", endDate: "2009-12-31" },
    { name: "TK Logistics", type: "3", registrationDate: "2012-01-01" },
  ],
  mainBusinessLine: { descriptions: d("Tieliikenteen tavarankuljetus", "Freight transport by road") },
  registeredEntries: [{ type: "1", registrationDate: "1999-05-02" }, { type: "4", registrationDate: "2001-01-01", endDate: "2001-02-01" }],
  companySituations: [],
  website: { url: "www.testikuljetus.example" },
  registrationDate: "1999-05-02",
}
const ceased: PrhCompany = {
  businessId: { value: "7654321-0" },
  names: [{ name: "Lopetettu Oy", type: "1", registrationDate: "1985-03-28", endDate: "2010-03-31" }],
  mainBusinessLine: { descriptions: d("Vuokraus", "Renting and leasing") },
  registeredEntries: [{ type: "1", registrationDate: "1985-03-28", endDate: "2010-03-30" }, { type: "4", registrationDate: "2010-03-31" }],
  registrationDate: "1985-03-28",
  endDate: "2010-03-31",
}
const pa = parseCompany(active)
assert.equal(pa.name, "Testi Kuljetus Oy", "current official name, not the ended or auxiliary one")
assert.equal(pa.line, "Freight transport by road")
assert.equal(pa.registered, "1999")
assert.equal(pa.ceased, false, "a closed type-4 entry is not ceased")
assert.equal(pa.website, "https://www.testikuljetus.example")
const pc = parseCompany(ceased)
assert.equal(pc.ceased, true)
assert.equal(pc.ceased_on, "2010-03-31")
assert.equal(pc.name, "Lopetettu Oy", "ceased firms keep their last name")
assert.equal(isCeased({ ...ceased, endDate: undefined }), true, "open type-4 entry alone means ceased")

const ranked = rank("Testi", [
  { business_id: "1", name: "Iso Testi Oy", line: "", registered: "", ceased: false },
  { business_id: "2", name: "Testi Oy", line: "", registered: "", ceased: true },
  { business_id: "3", name: "Testi Kuljetus Oy", line: "", registered: "", ceased: false },
])
assert.deepEqual(ranked.map((c) => c.business_id), ["3", "1", "2"], "prefix > contains, ceased last")
const vs = [
  { business_id: "1", name: "Testintien Kiinteistö Oy", line: "", registered: "", ceased: false },
  { business_id: "2", name: "Testi Oyj", line: "", registered: "", ceased: false },
  { business_id: "3", name: "Testi Oyj", line: "", registered: "", ceased: true },
]
assert.equal(rank("Testi", vs)[0].business_id, "2", "legal form ignored: 'Testi' is an exact match for 'Testi Oyj'")
assert.equal(exactLive("Testi", vs)?.business_id, "2", "one live exact match is auto-picked")
assert.equal(exactLive("Testin", vs), null)
// Real PRH "Fazer" hits (25 Oct 2026, abridged): the parent head office first, the concert agency out of the top 5.
const fz = (business_id: string, name: string, code: string, line: string) => ({ business_id, name, line, registered: "", ceased: false, code })
const fazer = [
  fz("2858322-8", "Fazer Finland Oy", "10610", "Manufacture of grain mill products"),
  fz("0728786-8", "Fazer Makeiset Oy", "10820", "Manufacture of cocoa, chocolate and sugar confectionery"),
  fz("1972442-0", "Fazer Leipomot Oy", "10710", "Manufacture of bread"),
  fz("2372155-6", "Fazer Ravintolat Oy", "56111", "Restaurants and cafeterias"),
  fz("0832083-4", "Fazer Konserttitoimisto Oy", "90209", "Other performing arts"),
  fz("2824638-7", "Lakiasiaintoimisto Pia Fazer Oy", "69102", "Legal counselling and advising activities"),
  fz("0202669-3", "Oy Karl Fazer Ab", "70100", "Activities of head offices"),
]
const fr = rank("Fazer", fazer).slice(0, 5).map((c) => c.name)
assert.equal(fr[0], "Oy Karl Fazer Ab", "the group's head office leads")
assert.ok(!fr.includes("Fazer Konserttitoimisto Oy"), "off-industry namesake pushed out of the top 5")
assert.equal(parentLive("Fazer", fazer)?.business_id, "0202669-3", "the one head office named Fazer is auto-picked")
assert.equal(parentLive("Fazer Finland", fazer), null)
assert.equal(rank("Fazer Finland", fazer)[0].name, "Fazer Finland Oy", "an exact match still wins")
const { namesCompany } = await import("./brief.ts")
assert.equal(namesCompany({ excerpt: `2026-08-01 contract award: "Food". Buyer: Aluksne. Tenderer/winner incl. Fazer Latvija SIA.` }, "Oy Karl Fazer Ab"), false, "a subsidiary abroad is not the company")
assert.equal(namesCompany({ excerpt: `2026-10-01 contract award: "x". Buyer: Stadt. Tenderer/winner incl. Kemira Oyj.` }, "Kemira Oyj"), true)

assert.equal(lev("ponssee", "ponsse"), 1)
assert.ok(umlauts("Wartsila").includes("Wärtsilä") && umlauts("Wartsila").length === 3, "ä/ö variants of the first 2 a/o")
assert.equal(lev("", "abc"), 3)

// ---- TED: fuzzy hits must be filtered to real name matches; diacritics-insensitive ----
assert.equal(stem("Wärtsilä Oyj Abp"), "Wärtsilä")
assert.equal(stem("Testi Kuljetus Oy"), "Testi")
assert.equal(stem("Oy Karl Fazer Ab"), "Fazer", "legal form first: the family name is the brand")
assert.equal(stem("Oy Hartwall Ab"), "Hartwall")
const notices: TedNotice[] = [
  { "publication-number": "111-2026", "publication-date": "2026-09-23+02:00", "notice-type": "can-standard", "notice-title": { eng: "Forest machines" }, "buyer-name": { fin: ["Kaupunki X"] }, "organisation-name-tenderer": { fin: ["TESTI Kuljetus Oy"] } },
  { "publication-number": "222-2026", "notice-type": "cn-standard", "notice-title": { fin: "Kuljetuspalvelut" }, "buyer-name": { fin: ["Testi Kuljetus Oy"] } },
  { "publication-number": "333-2026", "notice-title": { eng: "Unrelated" }, "buyer-name": { eng: ["Tester Ab"] }, "organisation-name-tenderer": { eng: ["Other Oy"] } },
]
const hits = parseNotices(notices, "Testi Kuljetus Oy")
assert.deepEqual(hits.map((h) => [h.number, h.role]), [["111-2026", "tenderer"], ["222-2026", "buyer"]])
assert.equal(hits[0].url, "https://ted.europa.eu/en/notice/-/detail/111-2026")
assert.equal(hits[0].date, "2026-09-23")
assert.equal(hits[1].title, "Kuljetuspalvelut", "falls back to Finnish title")
const sig = (h: (typeof hits)[number]) => signalText({ id: "s", company_id: "c", kind: "ted", url: h.url, title: "", excerpt: tedExcerpt(h, "Testi Kuljetus Oy"), lead_id: null, fetched_at: "" })
assert.equal(sig(hits[0]), 'Contract award: "Forest machines" from Kaupunki X (2026-09-23).')
assert.equal(sig(hits[1]), 'Ran a public tender: "Kuljetuspalvelut".')
assert.equal(parseNotices([{ "publication-number": "9", "organisation-name-tenderer": { por: ["Wartsila Portugal"] } }], "Wärtsilä Oyj Abp").length, 1)

// ---- site guard: own domain only, no private hosts ----
const co = { name: "Testi Kuljetus Oy", website: "https://www.testikuljetus.example" }
assert.ok(allowedUrl(co, "https://testikuljetus.example/news"))
assert.ok(allowedUrl(co, "https://careers.testikuljetus.example/"))
for (const bad of ["https://evil.example/", "http://localhost:3100/api/health", "http://127.0.0.1/", "file:///etc/passwd", "https://testikuljetus.example.evil.com/"])
  assert.equal(allowedUrl(co, bad), null, bad)
assert.ok(allowedUrl({ name: "Testi Kuljetus Oy", website: null }, "https://testi.example/"), "no website: stem in host")
const h = htmlToText(`<html><head><title>Testi &amp; Co</title><meta name="description" content="We move goods."></head><body><script>x()</script><p>Hello   world</p></body></html>`)
assert.deepEqual(h, { title: "Testi & Co", description: "We move goods.", text: "Hello world" })

// ---- name scrub: names out, roles kept ----
assert.equal(scrubNames("Hi, my name is Matti Virtanen and I'm Head of Finance."), "Hi, my name is [name] and I'm Head of Finance.")
assert.equal(scrubNames("Tapasin Liisan messuilla, Dr. Korhonen myös."), "Tapasin [name] messuilla, [name] myös.")
assert.equal(scrubNames("I am going to call them."), "I am going to call them.")
assert.equal(stripNames("Liisa agrees; ask Liisalta and Virtanen. Liikevaihto ok.", ["Liisa", "Matti Virtanen"]), "[name] agrees; ask [name] and [name]. Liikevaihto ok.")
assert.equal(stripNames("Anna sent the Annual report.", ["Anna"]), "[name] sent the Annual report.")

// ---- brief fit: never above 120 words ----
const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ")
const big: Brief = {
  what_they_do: { text: long(40), source_ids: ["a"] }, signals: [{ text: long(40), source_ids: ["a"] }, { text: long(30), source_ids: ["a"] }],
  openers: [long(15), long(15), long(15)], dont_say: long(12), objection: { text: long(25), source_ids: ["a"] }, thin_data: false,
}
const fit = fitBrief(big)
assert.ok(countWords(fit) <= 120, `fit to ${countWords(fit)}`)
assert.equal(countWords(fitBrief(fit)), countWords(fit), "already-fitting brief is untouched")
console.log("live self-check ok (offline)")

// ---- live, read-only: real public registries. Contacts nobody, writes nothing. ----
if (process.argv.includes("--live")) {
  const names = ["Kesko Oyj", "Wärtsilä Oyj Abp", "Ponsse Oyj", "Fiskars Oyj Abp", "Erilava Oy", "0595625-5"]
  for (const n of names) {
    const t = Date.now()
    const [c] = await searchCompanies(n)
    assert.ok(c, `PRH found ${n}`)
    const ted = c.ceased ? [] : await tedQuery(c.name, 3)
    console.log(`${n.padEnd(18)} -> ${c.business_id} ${c.name}${c.ceased ? " [CEASED]" : ""} | ${c.line.slice(0, 40)} | TED ${ted.length}: ${ted.map((x) => `${x.date} ${x.role}`).join(", ")} | ${Date.now() - t} ms`)
  }
  assert.equal((await searchCompanies("0595625-5"))[0].ceased, true, "known dissolved company flagged")
  assert.equal((await didYouMean("Ponssee Oyj"))[0]?.name, "Ponsse Oyj", "typo -> did you mean")
  assert.equal((await didYouMean("Fiskarss Oyj"))[0]?.name, "Fiskars Oyj Abp", "typo with a ceased near-miss")
  assert.equal((await didYouMean("Wartsila"))[0]?.name, "Wärtsilä Oyj Abp", "missing ä/ö")
  console.log("live self-check ok (PRH + TED)")
}
