// Shared by the letter page (/p) and the landing artefact (/): one number locale and one headline.
import { eurPerYear } from "../../../lib/night/formula.ts"
import type { EuroFormula, Opportunity } from "../../../lib/types.ts"

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

// The value statement for the H1, from the top card: team hours by hand and the yearly estimate.
export function headline(top: Opportunity | undefined): { hours: string; eur: string; label: EuroFormula["label"] } | null {
  if (!top) return null
  const f = top.formula
  const hours = f.hours_per_week * f.people
  if (!(hours > 0)) return null
  return { hours: fi(hours), eur: fiEur(eurPerYear(f)), label: f.label }
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
  console.log("letter.ts ok")
}
