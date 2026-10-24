// Showrunner: ~75 s two-host script (A/B), opened by the hallway quote verbatim, sanitized before it is stored.
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

const SYSTEM = `You write a ~75 second spoken briefing (180-200 words total) for a busy Finnish CEO, voiced by two hosts, A and B.
The hosts are Velho's AI analysts and say so early ("We're Velho's AI analysts"). They never pretend to be human or to speak for the company.
Tone: calm, specific, Nordic understatement. Short sentences that sound natural aloud. No hype, no exclamation marks.
Rules:
- Line 1 (host A) quotes the hallway quote VERBATIM in quotation marks, says a <role> said it to a Velho consultant in a conference hallway (role only, never a name), and cites its hallway source id.
- Lead with the card closest to the hallway pain, then cover the other cards in one line each. Be confident and concrete: the page already shows every caveat and the editable formula, so say "estimate" once per euro figure and do not apologise, say "thin data", or list what you left out.
- Cite at least 2 public (non-hallway) source ids across the script. Any line with a number, €, % or a proper noun other than the company name MUST cite source ids that support it.
- A line that repeats a detail from the hallway quote (a system name, a task) cites the hallway source id too, even if it is a question.
- Never invent a source id. Lines without facts (transitions, questions) may have empty source_ids, so they must contain no digits: write "twenty minutes", not "20 minutes".
- Any euro amount is called an "estimate". No promises ("guarantee", "will save", "we will", "we'll"). No personal names.
- The last line is one low-pressure, easy-to-answer ask framed as a question, e.g. "Could someone tell us how many people do this today, so we can rerun the estimate with your number?"`

export const CLOSE = "Could someone tell us how many people do this today, so we can rerun the estimate with your real number?"

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
    rewrite ? `REWRITE. A skeptical CEO scored the previous draft stop=${rewrite.score.stop} read=${rewrite.score.read} reply=${rewrite.score.reply}. Notes: ${rewrite.score.notes}\nPrevious draft:\n${rewrite.previous.map((l) => `${l.host}: ${l.text}`).join("\n")}` : "",
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
  if (!kept.at(-1)?.text.trim().endsWith("?")) kept.push({ host: kept.at(-1)?.host === "A" ? "B" : "A", text: CLOSE, source_ids: [] })
  return { runId: r.runId, lines: kept, dropped }
}
