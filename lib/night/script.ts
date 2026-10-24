// Showrunner: <=75 s two-host script (A/B), opened by the hallway quote verbatim, sanitized before it is stored.
import { runAgent } from "../claude.ts"
import type { Claim, ScriptLine, SkepticScore } from "../types.ts"
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

const SYSTEM = `You write a short spoken briefing (at most 65 seconds, 110-160 words; shorter when there is one card) for a busy Finnish executive, voiced by two hosts, A and B.
The hosts are Velho's AI analysts. The player and line 1 already say so: never add a line or sentence introducing yourselves ("We're Velho's AI analysts") or announcing what the briefing is about. They never pretend to be human or to speak for the company.
Tone: calm, specific, Nordic understatement. Short sentences that sound natural aloud. No hype, no exclamation marks.
Rules:
- Line 1 (host A) quotes the hallway quote VERBATIM in quotation marks, says a <role> said it to a Velho consultant in a conference hallway (role only, never a name), and cites its hallway source id.
  With no hallway quote, line 1 states the strongest cited public fact about a recurring process, citing it.
- Lead with the card closest to the hallway pain and spend most of the script on it: what the task is today, what changes (name the mechanism plainly, e.g. "a tablet form that fills the CRM record"), the estimate. Never undercut the case ("small next to the cost of", "the euro figure is the smaller part"). Mention other cards (if any) in one line each. Never mention cards that are not on the page. Be confident and concrete: the page already shows every caveat and the editable formula, so say "estimate" once per euro figure and do not apologise, say "thin data", or list what you left out.
- With no cards, spend the script on the questions listed below: what the public record shows and the one thing we would ask.
- Cite a public source only where it adds a fact the reader would not already know (e.g. a tender a card is built on). Never add a line just to cite something, never describe the company to its own management, and never say what you "checked". Any line with a number, €, % or a proper noun other than the company name MUST cite source ids that support it.
- A line that repeats a detail from the hallway quote (a system name, a task) cites the hallway source id too, even if it is a question.
- Never invent a source id. Lines without facts (transitions, questions) may have empty source_ids, so they must contain no digits: write "twenty minutes", not "20 minutes".
- Any euro amount is called an "estimate" and is exactly the card's figure (do not recompute it). Say which inputs are assumed, in one short phrase.
  Do no arithmetic aloud: say the time today in one phrase (the team's hours per week), the estimate, and that the formula is on the page to change.
- No promises ("guarantee", "will save", "we will", "we'll"). No personal names.
- Never state consequences (errors, delays, downtime, unhappy customers) that no source states.
- The last line is the ask: ONE question sentence of at most 30 words and nothing after it (the page prints the terms), a yes/no the reader can answer in one reply, tied to the first card's evidence (or the first question when there are no cards).
  A named author offers a free one-page teardown of that named process, within a week. e.g. "Shall a Velho consultant send you a free one-page teardown of how Friday inspection notes reach SAP, within a week?" (cites the hallway source).
  Address the reader directly ("you"); never ask them to involve staff.`

export const CLOSE = "Shall a Velho consultant send you a free one-page teardown of that first task, with a single-entry version and its rough cost, within a week?"
// The fixed terms of the offer, printed on the page under the question instead of being read aloud.
export const TERMS = "It needs no data from you and no call; a yes by reply is enough."
export const MAX_WORDS = 170 // ~65 s at the player's 2.6 words a second; compliance fails a script over 80 s

const FILLER = /(?:^|(?<=[.!?]\s))[^.!?]*\b(?:(?:we'?re|we are|this is)\s+velho'?s ai analysts|(?:this|the|our) (?:briefing|draft) is about)\b[^.!?]*[.!?]\s*/gi
const LABEL = "Velho's AI analysts here, with a short draft made for you."

// Deterministic length and shape after sanitizing: one label in line 1, no self-introduction filler, the spoken ask cut to
// its question sentence, and B's middle lines dropped (longest first) while the script is over MAX_WORDS.
export function fitScript(lines: ScriptLine[]): ScriptLine[] {
  // A line left with a scrap ("Right.") after its filler sentence went is dropped; untouched short lines stay.
  let out = lines.flatMap((l, i) => {
    const text = i === 0 ? l.text : l.text.replace(FILLER, "").trim()
    return text === l.text || text.split(/\s+/).filter(Boolean).length >= 4 ? [{ ...l, text }] : []
  })
  if (out.length && !/velho'?s ai analysts/i.test(out[0].text)) out[0] = { ...out[0], text: `${LABEL} ${out[0].text}` }
  const last = out.at(-1)
  if (last && out.length > 1 && last.text.includes("?")) {
    const q = last.text.slice(0, last.text.indexOf("?") + 1)
    out[out.length - 1] = { ...last, text: q.slice(Math.max(0, q.search(/[^.!?]*\?$/))).trim() }
  }
  while (wordCount(out) > MAX_WORDS) {
    const mid = out.map((l, i) => ({ l, i })).filter(({ l, i }) => i > 0 && i < out.length - 1 && l.host === "B")
    if (!mid.length) break
    const drop = mid.sort((a, b) => b.l.text.length - a.l.text.length)[0].i
    out = out.filter((_, i) => i !== drop)
  }
  return out
}

export const wordCount = (lines: ScriptLine[]) => lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)

export async function writeScript(
  ctx: NightContext, pageId: string, opps: DraftOpportunity[],
  rewrite?: { previous: ScriptLine[]; score: SkepticScore },
  extra: { recipient?: string | null; questions?: Claim[] } = {},
): Promise<{ runId: string; lines: ScriptLine[]; dropped: ScriptLine[] }> {
  const hallway = ctx.sources.find((s) => s.kind === "hallway" && s.lead_id === ctx.lead?.id)
  const cards = opps.map((o, i) =>
    `${i + 1}. ${o.title}: ${o.claim.text} [${o.claim.source_ids.join(", ")}] — ${o.formula.label} ${fmtEur(eurPerYear(o.formula))}/year`).join("\n")
  const prompt = [
    `Company: ${ctx.company.name}`,
    ctx.lead && hallway ? `Hallway quote (from a ${ctx.lead.role}), source ${hallway.id}: "${ctx.lead.quote}"` : "No hallway quote: open with the strongest cited signal instead.",
    extra.recipient ? `The reader is their ${extra.recipient}; the person met in the hallway forwards it.` : "",
    `Opportunity cards on the page:\n${cards || "(none: thin data)"}`,
    extra.questions?.length ? `Questions on the page ("What we'd ask you"):\n${extra.questions.map((q) => `- ${q.text} [${q.source_ids.join(", ")}]`).join("\n")}` : "",
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
  return { runId: r.runId, lines: fitScript(kept), dropped }
}

// Self-check (no model call): node lib/night/script.ts
if (import.meta.main) {
  const assert: typeof import("node:assert/strict") = (await import("node:assert/strict")).default
  const L = (host: "A" | "B", text: string): ScriptLine => ({ host, text, source_ids: [] })
  const out = fitScript([
    L("A", "“Dealers send PDFs.” A Head of Parts said that to a Velho consultant in a conference hallway."),
    L("B", "We're Velho's AI analysts. This briefing is about that morning routine."),
    L("B", "We're Velho's AI analysts. Software reads each order and fills the ERP record."),
    L("A", "Shall a Velho consultant send you a free one-page teardown, within a week? It needs no data from you."),
  ])
  assert.match(out[0].text, /^Velho's AI analysts here/)
  assert.equal(out.length, 3) // the pure-filler line is gone
  assert.equal(out[1].text, "Software reads each order and fills the ERP record.")
  assert.equal(out[2].text, "Shall a Velho consultant send you a free one-page teardown, within a week?")
  const long = fitScript([L("A", "Velho's AI analysts here. Start."), ...Array.from({ length: 6 }, (_, i) => L(i % 2 ? "A" : "B", "word ".repeat(40).trim() + ".")), L("A", "Yes or no?")])
  assert.ok(wordCount(long) <= MAX_WORDS || long.filter((l) => l.host === "B").length === 0)
  assert.equal(long.at(-1)!.text, "Yes or no?")
  console.log("script self-check ok")
}
