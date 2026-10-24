// NIGHT path: research -> cards -> script -> sanitize -> skeptic loop -> compliance -> PENDING approval.
// Each stage is its own agent run so /hq shows progress. Without an API key it builds an offline
// template draft (clearly logged as such) so the page and board still work on seed data.
import { endRun, insert, knownSourceIds, logStep, now, run, startRun, uid } from "../db.ts"
import { hasKey } from "../claude.ts"
import type { Approval, ScriptLine, SkepticScore } from "../types.ts"
import { checkCompliance } from "./compliance.ts"
import { eurPerYear, fmtEur, normalizeFormula } from "./formula.ts"
import { loadContext, research, type DraftOpportunity, type NightContext } from "./researcher.ts"
import { sanitizeClaims, sanitizeScript } from "./sanitize.ts"
import { CLOSE, writeScript } from "./script.ts"
import { BAR, minScore, skepticScore } from "./skeptic.ts"

const OFFLINE = "offline-template"

function offlineOpps(ctx: NightContext, pageId: string): DraftOpportunity[] {
  const runId = startRun("researcher", pageId, OFFLINE)
  const known = knownSourceIds(ctx.company.id)
  const hallway = ctx.sources.find((s) => s.kind === "hallway")
  const others = ctx.sources.filter((s) => s.kind !== "hallway")
  const raw: DraftOpportunity[] = []
  if (ctx.lead && hallway) raw.push({ title: `Take the ${ctx.lead.pain} off the team`, claim: { text: `A ${ctx.lead.role} described it in the hallway: ${ctx.lead.pain}.`, source_ids: [hallway.id] }, formula: normalizeFormula({ hours_per_week: 6, people: 3, input_source_ids: [hallway.id] }, known) })
  // Only the hallway card has real evidence of a manual task; a public signal stands in only when there is no lead.
  if (!raw.length) for (const s of others.slice(0, 1)) raw.push({ title: s.title.slice(0, 60), claim: { text: `Signal worth a closer look: ${s.excerpt.split(/(?<=\.)\s/)[0].slice(0, 160)}`, source_ids: [s.id] }, formula: normalizeFormula({}, known) })
  const { kept } = sanitizeClaims(ctx.company.id, raw.map((o) => o.claim), runId)
  logStep(runId, "info", "offline", "no ANTHROPIC_API_KEY: template cards from the evidence store", raw.length)
  endRun(runId, "ok", `${kept.length} template cards`)
  return raw.filter((o) => kept.includes(o.claim))
}

function offlineScript(ctx: NightContext, pageId: string, opps: DraftOpportunity[]): ScriptLine[] {
  const runId = startRun("showrunner", pageId, OFFLINE)
  const hallway = ctx.sources.find((s) => s.kind === "hallway")
  const lines: ScriptLine[] = []
  if (ctx.lead && hallway) lines.push({ host: "A", text: `A ${ctx.lead.role} told a Velho consultant in a conference hallway: “${ctx.lead.quote}”`, source_ids: [hallway.id] })
  lines.push({ host: "B", text: "We're Velho's AI analysts. This is a short draft, made only for you.", source_ids: [] })
  opps.forEach((o, i) => lines.push({ host: i % 2 ? "B" : "A", text: `${o.title}. ${o.claim.text} Our ${o.formula.label}: about ${fmtEur(eurPerYear(o.formula))} a year, and the formula is on the page.`, source_ids: o.claim.source_ids }))
  lines.push({ host: "B", text: CLOSE, source_ids: [] })
  const { kept } = sanitizeScript(ctx.company.id, lines, runId)
  logStep(runId, "info", "offline", "no ANTHROPIC_API_KEY: template script", kept.length)
  endRun(runId, "ok", `${kept.length} lines`)
  return kept
}

const savePage = (pageId: string, fields: Record<string, unknown>) => {
  const keys = Object.keys(fields)
  run(`UPDATE pages SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k]), pageId)
}

export async function runNightPath(companyId: string, leadId?: string | null): Promise<{ page_id: string; slug: string }> {
  const ctx = loadContext(companyId, leadId)
  const pageId = uid("page")
  const slug = uid("p")
  insert("pages", { id: pageId, slug, company_id: companyId, lead_id: ctx.lead?.id ?? null, status: "draft", script: [], skeptic: [], created_at: now() })
  try {
    await build(ctx, pageId, slug)
  } catch (e) {
    // A half-built page is useless; drop it (runs stay logged) so cron retries the lead next time.
    run("DELETE FROM pages WHERE id = ?", pageId)
    throw e
  }
  return { page_id: pageId, slug }
}

async function build(ctx: NightContext, pageId: string, slug: string) {
  const companyId = ctx.company.id
  const live = hasKey()

  // 1. research -> 3 cards
  const opps = live ? (await research(ctx, pageId)).opportunities : offlineOpps(ctx, pageId)
  opps.forEach((o, i) => insert("opportunities", { id: uid("opp"), page_id: pageId, title: o.title, claim: o.claim, formula: o.formula, position: i }))
  const fresh = loadContext(companyId, ctx.lead?.id) // researcher tools may have added sources

  // 2. script (sanitized inside), 3. skeptic loop (<= 2 rewrites, every round stored)
  let lines = live ? (await writeScript(fresh, pageId, opps)).lines : offlineScript(fresh, pageId, opps)
  savePage(pageId, { script: lines })
  const rounds: SkepticScore[] = []
  if (live) {
    for (let round = 0; ; round++) {
      const { score } = await skepticScore(pageId, ctx.company.name, opps, lines)
      rounds.push(score)
      savePage(pageId, { skeptic: rounds })
      if (minScore(score) >= BAR || round >= 2) break
      lines = (await writeScript(fresh, pageId, opps, { previous: lines, score })).lines
      savePage(pageId, { script: lines })
    }
  }
  const final = rounds.at(-1)

  // 4. compliance (deterministic)
  const cRun = startRun("compliance", pageId, "deterministic")
  const compliance = checkCompliance({ companyName: ctx.company.name, lead: fresh.lead, sources: fresh.sources, opps, lines })
  logStep(cRun, "info", "checks", { cards: opps.length, lines: lines.length }, compliance)
  endRun(cRun, "ok", compliance.ok ? "ok" : `${compliance.issues.length} issue(s)`)

  // 5. approval (PENDING). Nothing is sent anywhere; approve only creates a local draft to our own inbox.
  // The skeptic verdict stays internal: /hq shows it from pages.skeptic, the subject the reviewer approves does not carry it.
  const payload: Approval["payload"] = {
    subject: `Made for ${ctx.company.name}, Velho draft`,
    body: [
      `Velho draft, by Velho's AI analysts. Internal review copy.`,
      `Page: /p/${slug}`,
      ...opps.map((o) => `- ${o.title} (${o.formula.label} ${fmtEur(eurPerYear(o.formula))}/yr)`),
      final ? `Skeptic-CEO: stop ${final.stop}, read ${final.read}, reply ${final.reply}. ${final.notes}` : "Skeptic-CEO: not run.",
      compliance.ok ? "Compliance: ok." : `Compliance issues: ${compliance.issues.join("; ")}`,
    ].join("\n"),
    page_slug: slug,
  }
  savePage(pageId, { compliance, status: "pending_approval" })
  insert("approvals", { id: uid("appr"), kind: "page", ref_id: pageId, payload, status: "PENDING", created_at: now() })
}

