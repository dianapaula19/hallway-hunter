// Euro estimate (hard rule 5). Pure: imported by the server pipeline AND the client formula editor.
import type { EuroFormula } from "../types.ts"

export const FORMULA_INPUTS = [
  { key: "hours_per_week", label: "hours / week", step: 0.5 },
  { key: "people", label: "people", step: 1 },
  { key: "weeks_per_year", label: "weeks / year", step: 1 },
  { key: "hourly_cost_eur", label: "€ / hour", step: 1 },
  { key: "automation_share", label: "automation share", step: 0.05 },
] as const

export type FormulaKey = (typeof FORMULA_INPUTS)[number]["key"]

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

export function eurPerYear(f: Pick<EuroFormula, FormulaKey>): number {
  return f.hours_per_week * f.people * f.weeks_per_year * f.hourly_cost_eur * f.automation_share
}

// Clamp model output into sane ranges and set the label from the sources that survived.
export function normalizeFormula(raw: Partial<EuroFormula>, known: Set<string>): EuroFormula {
  const ids = (raw.input_source_ids ?? []).filter((id) => known.has(id))
  return {
    hours_per_week: num(raw.hours_per_week, 0, 80, 2),
    people: num(raw.people, 0, 10000, 1),
    weeks_per_year: num(raw.weeks_per_year, 0, 52, 46),
    hourly_cost_eur: num(raw.hourly_cost_eur, 0, 500, 45),
    automation_share: num(raw.automation_share, 0, 1, 0.3),
    input_source_ids: ids,
    label: ids.length ? "estimate" : "sector estimate",
  }
}

// Rounded to €100, Finnish-style thin-space grouping: "€12 300".
export const fmtEur = (n: number) => `€${(Math.round(Math.max(0, n) / 100) * 100).toLocaleString("fi-FI").replace(/\s/g, " ")}`
