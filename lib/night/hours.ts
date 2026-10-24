// Hour conversions from the hallway quote, done in code: "three hours a day between us" -> 15 h a week for the team.
// The researcher, the formula, the page and the reader test all get these numbers, so nobody "corrects" correct maths.
// ponytail: English phrasings seen in notes so far (N hours a day/week/month, a full/half day, an afternoon, "N of us",
// "him and one colleague"); anything else returns null and the model's own numbers stand.

export interface Hours {
  phrase: string // the words in the quote the amount came from
  hours: number // amount per period, as said
  per: "day" | "week" | "month"
  scope: "each" | "team" // whose hours: one person's ("each") or the whole team's ("between us")
  scopeSaid: boolean // false: the note did not say, read as each person
  people: number | null // headcount the note states, if any
  eachPerWeek: number // one decimal, what the formula uses
  working: string // "“three hours a day between us” = 3 h × 5 working days = 15 h a week for the team of 2, 7.5 h each"
}

const WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, "a couple of": 2, "a few": 3, "half an": 0.5 }
const N = "(\\d+(?:[.,]\\d+)?|a couple of|a few|half an|an?|one|two|three|four|five|six|seven|eight|nine|ten)"
const AMOUNT = [
  { re: new RegExp(`\\b${N}\\s+hours?\\b`, "i"), h: (m: RegExpMatchArray) => WORD[m[1].toLowerCase()] ?? Number(m[1].replace(",", ".")) },
  { re: /\bhalf a day\b|\bhalf-day\b/i, h: () => 4 },
  { re: /\b(?:a|one) (?:full|whole) (?:working )?day\b|\ba full day\b|\ba (?:working )?day\b(?! a\b)/i, h: () => 8 },
  { re: /\b(?:an|one|every|each) (?:afternoon|morning)\b|\b(?:monday|tuesday|wednesday|thursday|friday) (?:afternoon|morning)s?\b/i, h: () => 4 },
]
const PERIOD: [Hours["per"], RegExp][] = [
  ["day", /\b(a|per|each|every) (working )?day\b|\bdaily\b|\b(each|every) morning\b/i],
  ["week", /\b(a|per|each|every) week\b|\bweekly\b|\b(every|on) (monday|tuesday|wednesday|thursday|friday)s?\b|\bfridays\b/i],
  ["month", /\b(a|per|each|every) month\b|\bmonthly\b/i],
]
const PER_VISIT = /\bper (visit|order|report|case|call|claim|job|delivery)\b/i
const TEAM = /\bbetween (us|them)\b|\bfor the (whole )?team\b|\btogether\b|\bin total\b|\bcombined\b/i
const EACH = /\beach\b|\bapiece\b|\bper person\b/i
const PEOPLE: [RegExp, (m: RegExpMatchArray) => number][] = [
  [new RegExp(`\\b(?:the )?${N} of (?:us|them)\\b`, "i"), (m) => WORD[m[1].toLowerCase()] ?? Number(m[1])],
  [/\b(?:him|her|me|myself|he|she|i) and (?:one|another|a) (?:other )?\w+/i, () => 2],
  [new RegExp(`\\b${N} (?:people|colleagues|buyers|coordinators|technicians|engineers|clerks|planners)\\b`, "i"), (m) => WORD[m[1].toLowerCase()] ?? Number(m[1])],
]
const r1 = (n: number) => Math.round(n * 10) / 10

export function hoursFromQuote(quote: string | null | undefined, opts: { people?: number; weeksPerYear?: number } = {}): Hours | null {
  if (!quote) return null
  const weeks = opts.weeksPerYear || 46
  let found: { m: RegExpMatchArray; h: number } | null = null
  // Patterns in order of precision: "three hours" beats "each morning" in the same note.
  for (const a of AMOUNT) { const m = quote.match(a.re); if (m) { found = { m, h: a.h(m) }; break } }
  if (!found || !(found.h > 0)) return null
  const at = (found.m.index ?? 0) + found.m[0].length
  const after = quote.slice(at, at + 40)
  if (PER_VISIT.test(after)) return null // "an hour per visit": how many visits is not in the note
  // The period right after the amount wins ("half a day a week"), else anywhere in the note ("Every month … a full day").
  const near = PERIOD.map(([p, re]) => ({ p, i: after.search(re) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0]
  const rest = quote.slice(0, found.m.index) + " " + quote.slice(at)
  const per = near?.p ?? PERIOD.find(([, re]) => re.test(rest))?.[0]
  if (!per) return null
  const pm = PEOPLE.map(([re, f]) => { const m = quote.match(re); return m ? f(m) : null }).find((x) => x && x >= 1) ?? null
  const team = TEAM.test(quote)
  const scope: Hours["scope"] = team ? "team" : "each"
  const scopeSaid = team || EACH.test(quote)
  const people = pm ?? opts.people ?? null
  const weekly = per === "day" ? found.h * 5 : per === "week" ? found.h : (found.h * 12) / weeks
  if (scope === "team" && !people) return null
  const eachPerWeek = r1(scope === "team" ? weekly / people! : weekly)
  const approx = per === "month" ? "≈ " : ""
  const conv = per === "day" ? `${r1(found.h)} h × 5 working days = ` : per === "month" ? `${r1(found.h)} h × 12 months ÷ ${weeks} working weeks ` : ""
  const periodSaid = near ? ` ${after.slice(0, near.i + (after.slice(near.i).match(PERIOD.find(([p]) => p === per)![1])![0].length))}` : ""
  const said = `“${found.m[0].trim()}${periodSaid}”`.replace(/\s+/g, " ")
  const every = near ? "" : `, every ${per}`
  const working = scope === "team"
    ? `${said}${every} between them = ${conv}${approx}${r1(weekly)} h a week for the team of ${people}, ${r1(eachPerWeek)} h each`
    : `${said}${scopeSaid && !/\beach\b/.test(said) ? " each" : ""}${every} = ${conv}${approx}${eachPerWeek} h a week each${scopeSaid ? "" : " (read as each person)"}${people && people > 1 ? `, ${r1(eachPerWeek * people)} h for the ${people} of them` : ""}`
  return { phrase: found.m[0].trim(), hours: found.h, per, scope, scopeSaid, people: pm, eachPerWeek, working: working.replace(/\s+/g, " ") }
}

// Self-check: node lib/night/hours.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  const ponsse = hoursFromQuote("Dealers send us parts orders as PDF attachments, and two of us retype every single one into the ERP each morning, three hours a day between us.")!
  assert.deepEqual([ponsse.per, ponsse.scope, ponsse.people, ponsse.eachPerWeek], ["day", "team", 2, 7.5])
  assert.equal(ponsse.working, "“three hours a day” between them = 3 h × 5 working days = 15 h a week for the team of 2, 7.5 h each")
  const mipro = hoursFromQuote("Every month they copy the fault logs out of their own system into a Word report for the track owner, by hand, him and one colleague, it takes each of them about a full day.")!
  assert.deepEqual([mipro.per, mipro.scope, mipro.people, mipro.eachPerWeek], ["month", "each", 2, 2.1])
  assert.equal(mipro.working, "“a full day” each, every month = 8 h × 12 months ÷ 46 working weeks ≈ 2.1 h a week each, 4.2 h for the 2 of them")
  const kemira = hoursFromQuote("Honestly the water utilities still email us their chemical delivery orders as PDFs, and the three of us in order handling retype every one into SAP, a couple of hours each every day.")!
  assert.deepEqual([kemira.per, kemira.scope, kemira.people, kemira.eachPerWeek], ["day", "each", 3, 10])
  const teleste = hoursFromQuote("Their field technicians still fill the display maintenance forms on paper, and on Fridays someone types the whole stack into the service system, about half a day a week for her and another coordinator.")!
  assert.deepEqual([teleste.per, teleste.scopeSaid, teleste.people, teleste.eachPerWeek], ["week", false, 2, 4])
  assert.equal(teleste.working, "“half a day a week” = 4 h a week each (read as each person), 8 h for the 2 of them")
  assert.equal(kemira.working, "“a couple of hours each every day” = 2 h × 5 working days = 10 h a week each, 30 h for the 3 of them")
  assert.equal(hoursFromQuote("The field service engineers write every mill visit report twice, about an hour per visit."), null)
  assert.equal(hoursFromQuote("It is a mess."), null)
  console.log("hours self-check ok")
}
