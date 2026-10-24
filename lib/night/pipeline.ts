// NIGHT path: research -> cards -> script -> sanitize -> skeptic loop -> compliance -> PENDING approval.
// Each stage is its own agent run so /hq shows progress. Without an API key it builds an offline
// template draft (clearly logged as such) so the page and board still work on seed data.
import { endRun, insert, knownSourceIds, logStep, now, run, startRun, uid } from "../db.ts"
import { hasKey } from "../claude.ts"
import type { Approval, PageLetter, ScriptLine, SkepticScore } from "../types.ts"
import { checkCompliance } from "./compliance.ts"
import { eurPerYear, fmtEur, normalizeFormula } from "./formula.ts"
import { loadContext, research, type DraftOpportunity, type NightContext } from "./researcher.ts"
import { sanitizeClaims, sanitizeScript } from "./sanitize.ts"
import { findScale, scaleClaim } from "./scale.ts"
import { CLOSE, fitScript, writeScript } from "./script.ts"
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
  opps.forEach((o, i) => lines.push({ host: i % 2 ? "B" : "A", text: `${o.title}. ${o.claim.text} Our ${o.formula.label}: about ${fmtEur(eurPerYear(o.formula))} a year, and the formula is on the page.`, source_ids: o.claim.source_ids }))
  lines.push({ host: "B", text: CLOSE, source_ids: [] })
  const kept = fitScript(sanitizeScript(ctx.company.id, lines, runId).kept)
  logStep(runId, "info", "offline", "no ANTHROPIC_API_KEY: template script", kept.length)
  endRun(runId, "ok", `${kept.length} lines`)
  return kept
}

const savePage = (pageId: string, fields: Record<string, unknown>) => {
  const keys = Object.keys(fields)
  run(`UPDATE pages SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => fields[k]), pageId)
}

// Starts the night path and returns at once; `done` settles when it finishes. A "night_path" run (subject = page id)
// wraps the stages so /hq can show running / ok / error, and a crash is recorded there instead of escaping.
// recipient: who the page is framed for ("COO", "CFO", or the role met); null keeps "Made for <Company>".
// rewrites: skeptic-driven rewrites (default 1, the cron). "Run now" from /hq passes 0: someone is waiting, and a rewrite
// costs ~9 s for 0-1 point on min(stop, read, reply) (PROCESS.md); the score shown is still the page's real one.
export function startNightPath(companyId: string, leadId?: string | null, recipient?: string | null, rewrites = REWRITES): { page_id: string; slug: string; done: Promise<{ page_id: string; slug: string }> } {
  const ctx = loadContext(companyId, leadId)
  const pageId = uid("page")
  const slug = uid("p")
  const letter: PageLetter = { recipient: recipient?.trim().slice(0, 60) || null, scale: null, checked: null, why: null, path: null, questions: [] }
  insert("pages", { id: pageId, slug, company_id: companyId, lead_id: ctx.lead?.id ?? null, status: "draft", script: [], skeptic: [], letter, created_at: now() })
  const runId = startRun("night_path", pageId, "pipeline")
  const done = build(ctx, pageId, slug, letter, rewrites).then(
    () => { endRun(runId, "ok", `/p/${slug}`); return { page_id: pageId, slug } },
    (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        // A half-built page is useless; drop it (runs stay logged) so cron retries the lead next time.
        run("DELETE FROM pages WHERE id = ?", pageId)
        endRun(runId, "error", null, msg)
      } catch { /* the DB itself failed; nothing left to record into */ }
      throw e
    })
  return { page_id: pageId, slug, done }
}

export const runNightPath = (companyId: string, leadId?: string | null, recipient?: string | null) => startNightPath(companyId, leadId, recipient).done

// One rewrite, then the final score. A second rewrite costs two more model runs (~9 s: showrunner 5.6 s + skeptic
// 3.5 s on average) and on the two demo pages two rewrites moved min(stop, read, reply) 4 -> 5 and 4 -> 4 (PROCESS.md).
const REWRITES = 1

async function build(ctx: NightContext, pageId: string, slug: string, letter: PageLetter, rewrites: number) {
  const companyId = ctx.company.id
  const live = hasKey()

  // 0. one public size fact from the company's own site (no model). Registered companies only: a synthetic or
  // unregistered company has no site of its own to read, and guessing a domain could hit a real stranger's.
  const scaleSrc = live && ctx.company.business_id ? await findScale(ctx.company).catch(() => null) : null
  letter.scale = scaleSrc ? scaleClaim(scaleSrc, ctx.company.name) : null
  const withScale = scaleSrc ? loadContext(companyId, ctx.lead?.id) : ctx

  // 1. research -> 1-3 cards, card 1's company-level "why" and pilot "path" lines, and (no lead) the questions
  const found = live ? await research(withScale, pageId) : { opportunities: offlineOpps(withScale, pageId), why: null, path: null, questions: [] }
  const opps = found.opportunities
  letter.why = found.why
  letter.path = found.path
  letter.questions = found.questions
  opps.forEach((o, i) => insert("opportunities", { id: uid("opp"), page_id: pageId, title: o.title, claim: o.claim, formula: o.formula, position: i }))
  savePage(pageId, { letter })
  const fresh = loadContext(companyId, ctx.lead?.id) // researcher tools may have added sources

  // 2. script (sanitized and fitted inside), 3. skeptic loop (REWRITES rewrites, every round stored)
  const extra = { recipient: letter.recipient, questions: letter.questions, why: letter.why, path: letter.path }
  let lines = live ? (await writeScript(fresh, pageId, opps, undefined, extra)).lines : offlineScript(fresh, pageId, opps)
  savePage(pageId, { script: lines })
  const rounds: SkepticScore[] = []
  if (live) {
    for (let round = 0; ; round++) {
      const { score } = await skepticScore(pageId, ctx.company.name, opps, lines, letter)
      rounds.push(score)
      savePage(pageId, { skeptic: rounds })
      if (minScore(score) >= BAR || round >= rewrites) break
      lines = (await writeScript(fresh, pageId, opps, { previous: lines, score }, extra)).lines
      savePage(pageId, { script: lines })
    }
  }
  const final = rounds.at(-1)

  // 4. compliance (deterministic)
  const cRun = startRun("compliance", pageId, "deterministic")
  const compliance = checkCompliance({ companyName: ctx.company.name, lead: fresh.lead, sources: fresh.sources, opps, lines, letter })
  logStep(cRun, "info", "checks", { cards: opps.length, lines: lines.length }, compliance)
  endRun(cRun, "ok", compliance.ok ? "ok" : `${compliance.issues.length} issue(s)`)

  // 5. approval (PENDING). Nothing is sent anywhere; approve only creates a local draft to our own inbox.
  // The skeptic verdict stays internal: /hq shows it from pages.skeptic, the subject the reviewer approves does not carry it.
  const payload: Approval["payload"] = {
    subject: `${letter.recipient ? `For the ${letter.recipient}` : "Made for"} ${ctx.company.name}, Velho draft`,
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

