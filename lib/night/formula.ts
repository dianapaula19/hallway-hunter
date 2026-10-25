// Euro estimate (hard rule 5). Pure: imported by the server pipeline AND the client formula editor.
import type { EuroFormula } from "../types.ts"

// max: the same cap applies to model output (normalizeFormula) and to what a viewer types (clampInput).
export const FORMULA_INPUTS = [
  { key: "hours_per_week", label: "hours / week each", step: 0.5, max: 80, dflt: 2 },
  { key: "people", label: "people", step: 1, max: 10000, dflt: 1 },
  { key: "weeks_per_year", label: "weeks / year", step: 1, max: 52, dflt: 46 },
  { key: "hourly_cost_eur", label: "€ / hour", step: 1, max: 500, dflt: 45 },
  { key: "automation_share", label: "automation share", step: 0.05, max: 1, dflt: 0.3 },
] as const

export type FormulaKey = (typeof FORMULA_INPUTS)[number]["key"]

// Clamp to [0, max]; not a finite number (NaN, "", "12e") -> dflt.
export function clampInput(key: FormulaKey, v: unknown, dflt?: number): number {
  const inp = FORMULA_INPUTS.find((x) => x.key === key)!
  const n = v === "" || v == null ? NaN : Number(v)
  return Number.isFinite(n) ? Math.min(inp.max, Math.max(0, n)) : dflt ?? inp.dflt
}

export function eurPerYear(f: Pick<EuroFormula, FormulaKey>): number {
  return f.hours_per_week * f.people * f.weeks_per_year * f.hourly_cost_eur * f.automation_share
}

// One team's figure below this is "a first step", not a headline: readers at Ponsse, Mipro, Kemira and Valmet all called
// €5-37k trivial at their size (round 7). The page then leads with the people and hours, and the script says "first step".
export const FIRST_STEP_EUR = 100_000

// Clamp model output into sane ranges and set the label from the sources that survived.
export function normalizeFormula(raw: Partial<EuroFormula>, known: Set<string>): EuroFormula {
  const ids = (raw.input_source_ids ?? []).filter((id) => known.has(id))
  return {
    hours_per_week: clampInput("hours_per_week", raw.hours_per_week),
    people: clampInput("people", raw.people),
    weeks_per_year: clampInput("weeks_per_year", raw.weeks_per_year),
    hourly_cost_eur: clampInput("hourly_cost_eur", raw.hourly_cost_eur),
    automation_share: clampInput("automation_share", raw.automation_share),
    input_source_ids: ids,
    label: ids.length ? "estimate" : "sector estimate",
  }
}

// Rounded to €100, Finnish-style thin-space grouping: "€12 300".
export const fmtEur = (n: number) => `€${(Math.round(Math.max(0, n) / 100) * 100).toLocaleString("fi-FI").replace(/\s/g, " ")}`
