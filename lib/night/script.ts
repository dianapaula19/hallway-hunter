// Showrunner: <=75 s two-host script (A/B), opened by the hallway quote verbatim, sanitized before it is stored.
import { runAgent } from "../claude.ts"
import type { Claim, ScriptLine, SkepticScore } from "../types.ts"
import type { DraftOpportunity, NightContext } from "./researcher.ts"
import { sourceList } from "./researcher.ts"
import { FIRST_STEP_EUR, fmtEur, eurPerYear } from "./formula.ts"
import { markInference } from "./compliance.ts"
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
- The listener has the page open. Never read a card, the "why" line or the question aloud word for word: say each in fresh,
  shorter spoken words (line 1's hallway quote is the one verbatim line). If a company-level "why" is listed below, give it one
  short line of its own, citing its source, right after the estimate. Without one, say nothing about why now.
- With no cards, spend the script on the questions listed below: what the public record shows and the one thing we would ask.
- Cite a public source only where it adds a fact the reader would not already know (e.g. a tender a card is built on). Never add a line just to cite something, never describe the company to its own management, and never say what you "checked". Any line with a number, €, % or a proper noun other than the company name MUST cite source ids that support it.
- A line that repeats a detail from the hallway quote (a system name, a task) cites the hallway source id too, even if it is a question.
- Never invent a source id. Lines without facts (transitions, questions) may have empty source_ids, so they must contain no digits: write "twenty minutes", not "20 minutes".
- Any euro amount is called an "estimate" and is exactly the card's figure (do not recompute it). Say which inputs are assumed, in one short phrase; inputs taken from the hallway note (its hours, its headcount) are not assumed.
  Do no arithmetic aloud: say the time today in one phrase, the estimate, and that the formula is on the page to change.
- When card 1 is marked FIRST STEP below, lead with the people and the time in plain words ("two people, three hours every
  morning") and say the euro figure as a first step ("a first step, about €18 600 a year, an estimate"), never as the big number.
  Do not multiply it by anything.
- No promises ("guarantee", "will save", "we will", "we'll"). No personal names.
- Never state consequences (errors, delays, downtime, unhappy customers) that no source states.
- The last line is the ask: ONE question sentence of AT MOST 20 words, a yes/no the reader can answer with one word by
  reply, then one short sentence starting "On it:" (at most 20 words) saying what is on that page, fitted to the process:
  where the work arrives, which fields or steps are typed by hand, what software would take over (an AI reader, a form).
  Nothing after it (the page prints the terms). The question offers a one-page teardown of card 1's named process (or of
  the first question when there are no cards), sent by "a Velho consultant" (exactly those words; the page shows their
  name), by Friday. The teardown goes to the reader ("send you"). Never ask for a meeting, a call, data or staff time.
  Naming the role met or repeating a detail of the quote (a system, a document type) means citing the hallway source. No
  digits unless the line cites a source that has them.
  Example: "Shall a Velho consultant send you a one-page teardown of the utilities' PDF orders by Friday? On it: where they
  arrive, which fields get retyped into SAP, what an AI reader would take over."`

export const CLOSE = "Shall a Velho consultant send you a one-page teardown of that first task by Friday? On it: where the work arrives, what is typed by hand, what software would take over."
// The fixed terms of the offer, printed on the page under the question instead of being read aloud.
export const TERMS = "It needs nothing from you or your team: no data, no call."
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
    const i = last.text.indexOf("?") + 1
    const q = last.text.slice(0, i)
    // The question sentence, plus the "On it: …" sentence right after it (the page prints that under the question).
    const onIt = last.text.slice(i).trim().match(/^On it:[^.!?]*[.!?]?/)?.[0] ?? ""
    out[out.length - 1] = { ...last, text: `${q.slice(Math.max(0, q.search(/[^.!?]*\?$/))).trim()}${onIt ? ` ${onIt}` : ""}` }
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
  extra: { recipient?: string | null; questions?: Claim[]; why?: Claim | null; insight?: Claim | null; path?: Claim | null; teams?: (Claim & { n: number }) | null } = {},
): Promise<{ runId: string; lines: ScriptLine[]; dropped: ScriptLine[] }> {
  const hallway = ctx.sources.find((s) => s.kind === "hallway" && s.lead_id === ctx.lead?.id)
  const cards = opps.map((o, i) =>
    `${i + 1}. ${o.title}: ${o.claim.text} [${o.claim.source_ids.join(", ")}] — ${o.formula.label} ${fmtEur(eurPerYear(o.formula))}/year`).join("\n")
  const prompt = [
    `Company: ${ctx.company.name}`,
    ctx.lead && hallway ? `Hallway quote (from a ${ctx.lead.role}), source ${hallway.id}: "${ctx.lead.quote}"` : "No hallway quote: open with the strongest cited signal instead.",
    extra.recipient ? `The reader is their ${extra.recipient}; the person met in the hallway${ctx.lead ? `, their ${ctx.lead.role},` : ""} forwards it.` : "",
    `Opportunity cards on the page:\n${cards || "(none: thin data)"}`,
    opps[0] && !extra.teams && eurPerYear(opps[0].formula) < FIRST_STEP_EUR ? `Card 1 is a FIRST STEP: ${opps[0].formula.people} people, one team, ${fmtEur(eurPerYear(opps[0].formula))} a year.` : "",
    extra.why ? `Why it matters at company level (printed under card 1): ${extra.why.text} [${extra.why.source_ids.join(", ")}]` : "",
    !extra.why && extra.insight ? `Why it matters at company level (printed at the top): ${extra.insight.text} [${extra.insight.source_ids.join(", ")}] Give it one short line of its own right after the estimate, in fresh words, citing it.` : "",
    extra.path ? `Pilot path (printed under card 1): ${extra.path.text} [${extra.path.source_ids.join(", ")}]` : "",
    extra.teams && opps[0] ? `Headline scale (printed at the top): ${extra.teams.text} So card 1's ${fmtEur(eurPerYear(opps[0].formula))} for this team becomes about ${fmtEur(eurPerYear(opps[0].formula) * extra.teams.n)} a year across them, an estimate [${extra.teams.source_ids.join(", ")}]. Say that total once, right after card 1's estimate, citing the hallway source.` : "",
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
  const { kept: clean, dropped } = sanitizeScript(ctx.company.id, lines, r.runId)
  // A line citing a public source may not carry an uncited conclusion as fact; it is marked as our assumption (sanitize.ts).
  const pub = new Set(ctx.sources.filter((x) => x.kind === "ted" || x.kind === "site").map((x) => x.id))
  const kept = clean.map((l) => (l.source_ids.some((id) => pub.has(id)) ? markInference(l) : l))
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
    L("A", "Right. Shall a Velho consultant send you a one-page teardown by Friday? On it: where orders arrive. It needs no data."),
  ])
  assert.match(out[0].text, /^Velho's AI analysts here/)
  assert.equal(out.length, 3) // the pure-filler line is gone
  assert.equal(out[1].text, "Software reads each order and fills the ERP record.")
  assert.equal(out[2].text, "Shall a Velho consultant send you a one-page teardown by Friday? On it: where orders arrive.")
  assert.ok(CLOSE.slice(0, CLOSE.indexOf("?")).split(/\s+/).length <= 20)
  const long = fitScript([L("A", "Velho's AI analysts here. Start."), ...Array.from({ length: 6 }, (_, i) => L(i % 2 ? "A" : "B", "word ".repeat(40).trim() + ".")), L("A", "Yes or no?")])
  assert.ok(wordCount(long) <= MAX_WORDS || long.filter((l) => l.host === "B").length === 0)
  assert.equal(long.at(-1)!.text, "Yes or no?")
  console.log("script self-check ok")
}
