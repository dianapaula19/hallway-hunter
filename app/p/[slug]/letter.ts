// Shared by the letter page (/p) and the landing artefact (/): one number locale and one headline.
import { eurPerYear, FIRST_STEP_EUR } from "../../../lib/night/formula.ts"
import type { EuroFormula, Opportunity, Source } from "../../../lib/types.ts"

// Finnish number style everywhere on the page: decimal comma, narrow no-break space between thousands.
export const fi = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 2 }).replace(/\s/g, " ").replace("−", "-")
export const fiEur = (n: number) => `€${fi(Math.round(Math.max(0, n) / 100) * 100)}`
// Model-written text ("7.5 h", "€18 600", "18,600") brought to the same style. Display only: the voice reads the original.
export const fiText = (t: string) =>
  t.replace(/(\d)[, ](\d{3})(?!\d)/g, "$1 $2").replace(/(\d)\.(\d)/g, "$1,$2")
// What a viewer types: "7,5", "7.5" and "1 200" all parse.
export const parseFi = (raw: string) => {
  const t = raw.replace(/[\s ]/g, "").replace(",", ".")
  return t === "" ? NaN : Number(t)
}

// The card under the pull quote should add the mechanism and the number, not say the quote again.
// Render-time: drop sentences whose content words mostly appear in the quote. Cheaper and steadier than
// regenerating cards with the model; the claim keeps its source ids. ponytail: word-prefix overlap, swap for
// a proper similarity check if it ever drops a sentence that carries new facts.
const stems = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\d-]{4,}/gu) ?? []).map((w) => w.slice(0, 5)))
export function withoutEcho(claim: string, quote: string | null | undefined): string {
  if (!quote) return claim
  const q = stems(quote)
  const sentences = claim.split(/(?<=[.!?])\s+(?=[\p{Lu}\d])/u)
  const kept = sentences.filter((x) => {
    const w = [...stems(x)]
    return !w.length || w.filter((y) => q.has(y)).length / w.length < 0.6
  })
  if (!kept.length || kept.length === sentences.length) return claim
  // "That is 7.5 h a week each" pointed back at the dropped sentence; start on the number instead.
  const first = kept[0].replace(/^(that is|that's|this is|which is)\s+/i, "")
  return [first.charAt(0).toUpperCase() + first.slice(1), ...kept.slice(1)].join(" ")
}

// The value statement for the H1, from the top card. One team's figure under FIRST_STEP_EUR is not a headline at company
// level (round 7 readers: "€18 600 is tiny for Ponsse"), so the H1 leads with the people and the hours on the named task and
// the euro estimate moves to the line below as "a first step". When two or more inputs are assumed ("assuming one visit a
// week", "a pilot team of 5"), the H1 is the card's own fact (its title) instead.
// ponytail: assumptions are counted from the claim's wording; per-input sourcing would need a schema change.
const WORDS = ["No one", "One person", "Two people", "Three people", "Four people", "Five people", "Six people", "Seven people", "Eight people", "Nine people", "Ten people"]
const who = (n: number) => WORDS[n] ?? `${fi(n)} people`
// teams: the hallway answer to "how many teams like yours do this task?" (pages.letter.teams). With 2+, the headline is the
// team's figure times that count, and the line under it shows the step ("€37 300 for this team · about 6 teams like it → ~€223 800").
export function headline(top: Opportunity | undefined, teams?: number | null): { h1: string[]; eur: string | null; label: EuroFormula["label"]; scaled?: boolean } | null {
  if (!top) return null
  const f = top.formula
  const hours = f.hours_per_week * f.people
  if (!(hours > 0)) return null
  const eurN = eurPerYear(f)
  const assumed = (top.claim.text.match(/\bassum\w*|\bpilot team\b/gi) ?? []).length
  const title = top.title.replace(/[.\s]*$/, ".")
  // No input sourced at all ("sector estimate", e.g. the offline template's defaults): the hours are a guess, not a headline.
  if (assumed >= 2 || f.label === "sector estimate") return { h1: [title], eur: `About ${fiEur(eurN)} a year to win back`, label: f.label }
  if (teams && teams >= 2) return {
    h1: [`About ${fiEur(eurN * teams)} a year to win back,`, `across about ${teams} teams like this one.`],
    eur: `The pilot: this team of ${fi(f.people)}, ${fi(hours)} h a week by hand, ${fiEur(eurN)} a year · × about ${teams} teams like it`, label: f.label, scaled: true,
  }
  if (eurN < FIRST_STEP_EUR) return { h1: [`${who(f.people)}, ${fi(hours)} hours a week:`, title.charAt(0).toLowerCase() + title.slice(1)], eur: `A first step worth about ${fiEur(eurN)} a year`, label: f.label }
  return { h1: [`${fi(hours)} hours a week by hand.`, `About ${fiEur(eurN)} a year to win back.`], eur: null, label: f.label }
}

// The one question as printed: at most ~20 words, then "Reply yes is enough." What the teardown holds goes in a small line
// under it: the script's "On it: …" sentence, or (pages from before round 8) the list after the colon of a long question.
// A question over 22 words (older pages) is replaced by the short form, so every page asks the same light way.
// Fallback contents (script.ts stays out of this file: it imports the model client, and letter.ts reaches the browser).
export const ON_IT = "where the work arrives, what is typed by hand, what software would take over, and the hours it gives back"
export function askParts(text: string, sender: string): { q: string; onIt: string } {
  const i = text.indexOf("?") + 1
  const q0 = text.slice(0, i).replace(/\ba Velho consultant\b/, sender).trim()
  const on = text.slice(i).trim().match(/^On it:\s*([^.!?]*)/)?.[1]?.trim()
  const long = q0.split(/\s+/).length > 22
  const colon = q0.lastIndexOf(":")
  const listed = on || (long && colon > 0 ? q0.slice(colon + 1).replace(/[?\s]+$/, "").trim() : "")
  return { q: `${long ? `Shall ${sender} send you a one-page teardown of this by Friday?` : q0} Reply yes is enough.`, onIt: listed || ON_IT }
}

// "What we checked", deterministic: every source behind the page by kind, with dates (TED by publication month,
// the rest by when we read them). Shows the research even where no line cites it.
const tz = "Europe/Helsinki"
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz })
const my = (iso: string, year = true) => new Date(iso).toLocaleDateString("en-GB", { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: tz })
export function checkedLine(sources: Pick<Source, "kind" | "url" | "excerpt" | "fetched_at">[]): string[] {
  const of = (k: Source["kind"]) => sources.filter((x) => x.kind === k)
  const last = (xs: { fetched_at: string }[]) => xs.map((x) => x.fetched_at).sort().at(-1)!
  const out: string[] = []
  const prh = of("prh")
  if (prh.length) out.push(`trade register (PRH), read ${dmy(last(prh))}`)
  const ted = of("ted")
  if (ted.length) {
    const d = ted.map((x) => x.excerpt.match(/^\d{4}-\d{2}-\d{2}/)?.[0]).filter((x): x is string => !!x).sort()
    const a = d[0], b = d.at(-1)
    const span = !a || !b ? "" : my(a) === my(b) ? my(a) : a.slice(0, 4) === b.slice(0, 4) ? `${my(a, false)}–${my(b)}` : `${my(a)}–${my(b)}`
    out.push(`${ted.length} EU tender notice${ted.length > 1 ? "s" : ""} (TED)${span ? `, ${span}` : ""}`)
  }
  const hosts = new Map<string, { fetched_at: string }[]>()
  for (const x of of("site")) {
    const h = x.url ? new URL(x.url).hostname.replace(/^www\./, "") : "their website"
    hosts.set(h, [...(hosts.get(h) ?? []), x])
  }
  for (const [h, xs] of hosts) out.push(`${h}${xs.length > 1 ? ` (${xs.length} pages)` : ""}, read ${dmy(last(xs))}`)
  const hall = of("hallway")
  if (hall.length) out.push(`the hallway note, ${dmy(last(hall))}`)
  return out
}

// Self-check: node app/p/[slug]/letter.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  assert.equal(fi(7.5), "7,5")
  assert.equal(fiEur(18630), "€18 600")
  assert.equal(fiText("That is 7.5 h a week, about €18 600 or 18,600."), "That is 7,5 h a week, about €18 600 or 18 600.")
  assert.equal(parseFi("7,5"), 7.5)
  assert.equal(parseFi("1 200"), 1200)
  assert.ok(Number.isNaN(parseFi("")))
  const quote = "Dealers send us parts orders as PDF attachments, and two of us retype every single one into the ERP each morning, three hours a day between us."
  const claim = "Dealers send parts orders as PDF attachments, and two people retype each one into the ERP every morning, three hours a day for the team. That is 7.5 h a week each, 15 h for the team. A person still checks each order."
  assert.equal(withoutEcho(claim, quote), "7.5 h a week each, 15 h for the team. A person still checks each order.")
  assert.equal(withoutEcho(claim, null), claim)
  assert.equal(withoutEcho("Unrelated tender signal from 2026.", quote), "Unrelated tender signal from 2026.")
  const opp = (claim: string, hours: number, people: number) => ({ title: "Mill visit reports written twice", claim: { text: claim, source_ids: [] }, formula: { hours_per_week: hours, people, weeks_per_year: 46, hourly_cost_eur: 50, automation_share: 0.5, label: "estimate", input_source_ids: [] } }) as unknown as Opportunity
  assert.deepEqual(headline(opp("Assuming one visit a week, a pilot team of 5.", 1, 5))!.h1, ["Mill visit reports written twice."])
  assert.deepEqual(headline(opp("Two people retype each order.", 7.5, 2))!.h1, ["Two people, 15 hours a week:", "mill visit reports written twice."])
  assert.equal(headline(opp("Two people retype each order.", 7.5, 2))!.eur, `A first step worth about ${fiEur(17250)} a year`)
  assert.equal(headline(opp("Forty people retype.", 7.5, 40))!.h1.length, 2)
  assert.equal(headline(opp("Forty people retype.", 7.5, 40))!.eur, null)
  const scaled = headline(opp("Three of us retype.", 10, 3), 6)!
  assert.deepEqual(scaled.h1, [`About ${fiEur(34500 * 6)} a year to win back,`, "across about 6 teams like this one."])
  assert.equal(scaled.eur, `The pilot: this team of 3, 30 h a week by hand, ${fiEur(34500)} a year · × about 6 teams like it`)
  const oldAsk = "Shall a Velho consultant send you a one-page teardown by Friday, built from what your Head of Spare Parts Logistics already told us: where the dealer PDF orders arrive, which fields get retyped into the ERP, and what an AI reader would take over?"
  assert.deepEqual(askParts(oldAsk, "Diana"), { q: "Shall Diana send you a one-page teardown of this by Friday? Reply yes is enough.", onIt: "where the dealer PDF orders arrive, which fields get retyped into the ERP, and what an AI reader would take over" })
  const newAsk = askParts("Shall a Velho consultant send you a one-page teardown of the PDF orders by Friday? On it: where they arrive, what gets retyped.", "a Velho consultant")
  assert.deepEqual(newAsk, { q: "Shall a Velho consultant send you a one-page teardown of the PDF orders by Friday? Reply yes is enough.", onIt: "where they arrive, what gets retyped" })
  assert.ok(newAsk.q.split(/\s+/).length <= 22)
  assert.equal(askParts("Shall a Velho consultant send you a teardown?", "X").onIt, ON_IT)
  assert.deepEqual(headline(opp("Three of us retype.", 10, 3), null)!.h1, ["Three people, 30 hours a week:", "mill visit reports written twice."])
  const guess = opp("Two people retype each order.", 6, 3); guess.formula.label = "sector estimate"
  assert.deepEqual(headline(guess)!.h1, ["Mill visit reports written twice."])
  const src = (kind: Source["kind"], excerpt: string, url: string | null, at = "2026-10-24T10:00:00Z") => ({ kind, excerpt, url, fetched_at: at })
  // en-GB in Node 24's ICU writes "Sept"
  assert.deepEqual(checkedLine([
    src("prh", "x", "https://tietopalvelu.ytj.fi/yritys/1"), src("ted", "2026-07-27 contract award", "t"), src("ted", "2026-09-23 contract award", "t"),
    src("site", "a", "https://www.ponsse.com/"), src("site", "b", "https://www.ponsse.com/about"), src("hallway", "q", null),
  ]), ["trade register (PRH), read 24 Oct 2026", "2 EU tender notices (TED), Jul–Sept 2026", "ponsse.com (2 pages), read 24 Oct 2026", "the hallway note, 24 Oct 2026"])
  assert.deepEqual(checkedLine([src("ted", "2025-12-01 x", "t"), src("ted", "2026-02-01 x", "t")]), ["2 EU tender notices (TED), Dec 2025–Feb 2026"])
  console.log("letter.ts ok")
}
