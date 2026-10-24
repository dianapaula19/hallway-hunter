// Showrunner: <=75 s two-host script (A/B), opened by the hallway quote verbatim, sanitized before it is stored.
import { runAgent } from "../claude.ts"
import type { ScriptLine, SkepticScore } from "../types.ts"
import type { DraftOpportunity, NightContext } from "./researcher.ts"
import { sourceList } from "./researcher.ts"
import { fmtEur, eurPerYear } from "./formula.ts"
import { sanitizeScript } from "./sanitize.ts"

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["lines"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["host", "text", "source_ids"],
        properties: { host: { type: "string", enum: ["A", "B"] }, text: { type: "string" }, source_ids: { type: "array", items: { type: "string" } } },
      },
    },
  },
}

const SYSTEM = `You write a short spoken briefing (at most 75 seconds, 120-190 words; shorter when there is one card) for a busy Finnish CEO, voiced by two hosts, A and B.
The hosts are Velho's AI analysts and say so early ("We're Velho's AI analysts"). They never pretend to be human or to speak for the company.
Tone: calm, specific, Nordic understatement. Short sentences that sound natural aloud. No hype, no exclamation marks.
Rules:
- Line 1 (host A) quotes the hallway quote VERBATIM in quotation marks, says a <role> said it to a Velho consultant in a conference hallway (role only, never a name), and cites its hallway source id.
- Lead with the card closest to the hallway pain and spend most of the script on it: what the task is today, what changes (name the mechanism plainly, e.g. "a tablet form that fills the CRM record"), the estimate. Never undercut the case ("small next to the cost of"). Mention other cards (if any) in one line each. Never mention cards that are not on the page. Be confident and concrete: the page already shows every caveat and the editable formula, so say "estimate" once per euro figure and do not apologise, say "thin data", or list what you left out.
- Cite a public source only where it adds a fact the CEO would not already know (e.g. a tender a card is built on). Never add a line just to cite something, never describe the company to its own CEO, and never say what you "checked". Any line with a number, €, % or a proper noun other than the company name MUST cite source ids that support it.
- A line that repeats a detail from the hallway quote (a system name, a task) cites the hallway source id too, even if it is a question.
- Never invent a source id. Lines without facts (transitions, questions) may have empty source_ids, so they must contain no digits: write "twenty minutes", not "20 minutes".
- Any euro amount is called an "estimate" and is exactly the card's figure (do not recompute it). Say which inputs are assumed.
  Do no arithmetic aloud: say the time today in one phrase (the team's hours per week), the estimate, and that the formula is on the page to change.
- No promises ("guarantee", "will save", "we will", "we'll"). No personal names.
- The last line is the ask, said once, as a question: ONE yes/no the CEO can answer in one reply, tied to the first card's evidence.
  Offer a free one-page teardown of that named process, within a week: today's steps, where the retyping happens, and a single-entry version with its rough cost.
  It needs no data and no time from them, and no call: say so. Address the CEO directly ("you"); never ask them to forward anything or involve staff.
  e.g. "Shall we send you a free one-page teardown of how Friday inspection notes reach SAP, within a week: today's steps, the retyping, and a single-entry version with its cost? It needs no data from you and no call; a yes by reply is enough." (cites the hallway source).`

export const CLOSE = "Shall we send you a free one-page teardown of that first task, with a single-entry version and its rough cost? It needs no data from you and no call; a yes by reply is enough."

export const wordCount = (lines: ScriptLine[]) => lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)

export async function writeScript(
  ctx: NightContext, pageId: string, opps: DraftOpportunity[],
  rewrite?: { previous: ScriptLine[]; score: SkepticScore },
): Promise<{ runId: string; lines: ScriptLine[]; dropped: ScriptLine[] }> {
  const hallway = ctx.sources.find((s) => s.kind === "hallway" && s.lead_id === ctx.lead?.id)
  const cards = opps.map((o, i) =>
    `${i + 1}. ${o.title}: ${o.claim.text} [${o.claim.source_ids.join(", ")}] — ${o.formula.label} ${fmtEur(eurPerYear(o.formula))}/year`).join("\n")
  const prompt = [
    `Company: ${ctx.company.name}`,
    ctx.lead && hallway ? `Hallway quote (from a ${ctx.lead.role}), source ${hallway.id}: "${ctx.lead.quote}"` : "No hallway quote: open with the strongest cited signal instead.",
    `Opportunity cards on the page:\n${cards || "(none: thin data)"}`,
    `Evidence store:\n${sourceList(ctx.sources)}`,
    rewrite ? `REWRITE. A skeptical CEO scored the previous draft stop=${rewrite.score.stop} read=${rewrite.score.read} reply=${rewrite.score.reply}. Notes: ${rewrite.score.notes}\nApply the notes only where they fit every rule above (labels, citations, no promises, the ask format).\nPrevious draft:\n${rewrite.previous.map((l) => `${l.host}: ${l.text}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n")

  const r = await runAgent<{ lines: ScriptLine[] }>({
    agent: "showrunner", subjectId: pageId, system: SYSTEM, prompt, schema: SCHEMA, effort: "medium",
  })
  let lines = r.json?.lines ?? []

  // Deterministic guarantee: the first line carries the hallway quote verbatim with its source.
  if (ctx.lead && hallway && !(lines[0]?.text.includes(ctx.lead.quote) && lines[0].source_ids.includes(hallway.id))) {
    lines = [{ host: "A", text: `A ${ctx.lead.role} told a Velho consultant in a conference hallway: “${ctx.lead.quote}”`, source_ids: [hallway.id] }, ...lines]
  }
  const { kept, dropped } = sanitizeScript(ctx.company.id, lines, r.runId)
  // The ask is the point of the page: if the model's closing question was dropped (e.g. "20 minutes"), add ours.
  if (!kept.at(-1)?.text.includes("?")) kept.push({ host: kept.at(-1)?.host === "A" ? "B" : "A", text: CLOSE, source_ids: [] })
  return { runId: r.runId, lines: kept, dropped }
}
