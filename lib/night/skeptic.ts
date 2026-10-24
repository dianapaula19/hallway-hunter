// Skeptic-CEO gate: scores a draft 0-10 on stop / read / reply. Below 7 on any axis -> rewrite (pipeline, max 2 rounds).
import { runAgent } from "../claude.ts"
import type { ScriptLine, SkepticScore } from "../types.ts"
import type { DraftOpportunity } from "./researcher.ts"
import { eurPerYear, fmtEur } from "./formula.ts"

export const BAR = 7
export const minScore = (s: SkepticScore) => Math.min(s.stop, s.read, s.reply)

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["stop", "read", "reply", "notes"],
  properties: { stop: { type: "integer" }, read: { type: "integer" }, reply: { type: "integer" }, notes: { type: "string" } },
}

const SYSTEM = `You are the CEO of a 200-person Finnish company. You get 40 vendor emails a day and reply to almost none.
You distrust hype, vague AI talk, invented numbers and anything that sounds like it was written for someone else.
Score this unsolicited private draft page, 0-10 each, integers:
- stop: would you stop scrolling and open it?
- read: would you read or listen to the end (it is at most 75 seconds)?
- reply: would you answer the ask at the end of the script?
House rules you cannot change, so do not score them down or ask for them: the "Velho's AI analysts" label, a hallway quote attributed by role only (never a name), and euro figures shown as editable estimates.
Then give at most 3 blunt, concrete notes on what to cut or change in the wording, framing, inputs or ask (max 60 words). Be honest; 7 means genuinely good.`

const clamp = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)))

export async function skepticScore(pageId: string, companyName: string, opps: DraftOpportunity[], lines: ScriptLine[]): Promise<{ runId: string; score: SkepticScore }> {
  const r = await runAgent<SkepticScore>({
    agent: "skeptic_ceo", subjectId: pageId, system: SYSTEM, schema: SCHEMA, effort: "low",
    prompt: `Page: "Made for ${companyName}, Velho draft", by Velho's AI analysts. The hallway quote was said in person to a Velho consultant at a conference.\n\nCards (each shows its formula, with every input editable):\n${opps.map((o) => { const f = o.formula; return `- ${o.title}: ${o.claim.text} (${o.formula.label} ${fmtEur(eurPerYear(f))}/yr = ${f.hours_per_week} h/week each × ${f.people} people × ${f.weeks_per_year} weeks × €${f.hourly_cost_eur}/h × ${f.automation_share} automatable)` }).join("\n")}\n\nAudio script:\n${lines.map((l) => `${l.host}: ${l.text}`).join("\n")}`,
  })
  const j = r.json
  return { runId: r.runId, score: { stop: clamp(j?.stop), read: clamp(j?.read), reply: clamp(j?.reply), notes: String(j?.notes ?? "").slice(0, 600) } }
}
