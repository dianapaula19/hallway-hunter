// Skeptic-CEO gate: scores a draft 0-10 on stop / read / reply. Below 7 on any axis -> one rewrite (pipeline).
import { runAgent } from "../claude.ts"
import type { PageLetter, ScriptLine, SkepticScore } from "../types.ts"
import type { DraftOpportunity } from "./researcher.ts"
import { eurPerYear, fmtEur } from "./formula.ts"

export const BAR = 7
export const minScore = (s: SkepticScore) => Math.min(s.stop, s.read, s.reply)

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["stop", "read", "reply", "reply_why", "notes"],
  properties: { stop: { type: "integer" }, read: { type: "integer" }, reply: { type: "integer" }, reply_why: { type: "string" }, notes: { type: "string" } },
}

const system = (reader: string, size: string) => `You are the ${reader} of a Finnish company${size}. You get 40 vendor emails a day and reply to almost none.
A manager on your team met a Velho consultant in a conference hallway and forwarded you this page. You distrust hype, vague AI talk,
invented numbers and anything that sounds like it was written for someone else. Judge it at your company's real size.
Score this private draft page, 0-10 each, integers:
- stop: would you stop scrolling and open it?
- read: would you read or listen to the end (it is at most 75 seconds)?
- reply: would you, the ${reader}, answer the ask at the end?
reply_why: one sentence, from your own point of view, on why you would or would not reply.
House rules you cannot change, so do not score them down or ask for them: the "Velho's AI analysts" label, a hallway quote attributed by role only (never a name), and euro figures shown as editable estimates.
Then give at most 3 blunt, concrete notes on what to cut or change in the wording, framing, inputs or ask (max 60 words). Be honest; 7 means genuinely good.`

const clamp = (n: unknown) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)))

export async function skepticScore(
  pageId: string, companyName: string, opps: DraftOpportunity[], lines: ScriptLine[],
  letter: Partial<PageLetter> = {},
  facts: { hours?: string | null; contracts?: string | null } = {},
): Promise<{ runId: string; score: SkepticScore }> {
  const reader = letter.recipient || "CEO"
  // The size comes from a cited public fact when we have one; otherwise the skeptic is told it is unknown, not "200 people".
  const size = letter.scale ? ` (public fact: ${letter.scale.text})` : " (size unknown to you here; do not assume one)"
  const w = letter.why ?? letter.insight
  const top = w ? `Above the fold, under the headline. Why this matters at ${companyName}: ${w.text}\n\n`
    : letter.check ? `Above the fold, under the headline. What we'd check first: ${letter.check}.\n\n` : ""
  const extras = [
    facts.hours ? `Hours, converted in code from the hallway note (this arithmetic is correct; do not recompute it or call it inconsistent): ${facts.hours}` : "",
    letter.teams && opps[0] ? `Headline, scaled by what the person met said: ${fmtEur(eurPerYear(opps[0].formula))} a year for this team × ${letter.teams.text.replace(/\.$/, "")} = about ${fmtEur(eurPerYear(opps[0].formula) * letter.teams.n)} a year (estimate; the team count is cited to the hallway note).` : "",
    facts.contracts ? `Beyond the pilot (under card 1): ${facts.contracts}` : "",
    letter.path ? `Pilot path (under card 1): ${letter.path.text}` : "",
    letter.checked ? `What we checked: ${letter.checked.text}` : "",
    letter.questions?.length ? `What we'd ask you:\n${letter.questions.map((q) => `- ${q.text}`).join("\n")}` : "",
  ].filter(Boolean).join("\n")
  const r = await runAgent<SkepticScore>({
    agent: "skeptic_ceo", subjectId: pageId, system: system(reader, size), schema: SCHEMA, effort: "low",
    prompt: `Page: "For the ${reader}, ${companyName}, Velho draft", by Velho's AI analysts. The hallway quote was said in person to a Velho consultant at a conference.\nLayout: above the fold only the headline, one "why this matters" fact (or what we'd check first), the hallway quote and the one question, printed as "Shall <sender> send you a one-page teardown of … by Friday? Reply yes is enough." with what is on it in a small line underneath; "The working" (the cards with their editable formula, the pilot, sources, audio) is folded behind one click.\n\n${top}The pilot: the euro figure covers only the team in its formula, and the page says so ("The pilot: … for a team of N").\nCards (each shows its formula, with every input editable):\n${opps.map((o) => { const f = o.formula; return `- ${o.title}: ${o.claim.text} (${o.formula.label} ${fmtEur(eurPerYear(f))}/yr = ${f.hours_per_week} h/week each × ${f.people} people × ${f.weeks_per_year} weeks × €${f.hourly_cost_eur}/h × ${f.automation_share} automatable)` }).join("\n") || "(no cards)"}${extras ? `\n\n${extras}` : ""}\n\nAudio script (the page prints the ask's terms: free, no data, no call, a yes by reply is enough):\n${lines.map((l) => `${l.host}: ${l.text}`).join("\n")}`,
  })
  const j = r.json
  return { runId: r.runId, score: { stop: clamp(j?.stop), read: clamp(j?.read), reply: clamp(j?.reply), reply_why: String(j?.reply_why ?? "").slice(0, 300), notes: String(j?.notes ?? "").slice(0, 600) } }
}
