// Hallway voice note -> Lead (role, never a name) + a 'hallway' source that cascades with the lead.
import { addSource, get, insert, now, run, uid } from "../db.ts"
import { hasKey, runAgent } from "../claude.ts"
import type { Lead, Temperature } from "../types.ts"

// Deterministic first pass, before anything is logged or sent to the model:
// "my name is Matti Virtanen" / "nimeni on Liisa" / "I'm Anna" / "talked to Pekka" -> "[name]".
// ponytail: phrase-anchored regex only; free-floating names are left to the model pass (and NIGHT compliance).
const NOT_NAME = "(?!(?:Head|Chief|CEO|CFO|CTO|COO|VP|Director|Manager|Lead|Senior|Partner|Johtaja|Päällikkö|Toimitusjohtaja)\\b)"
const INTRO = new RegExp(`\\b([Mm]y name is|I am|I'm|[Tt]alked to|[Ss]poke with|[Nn]imeni on|[Pp]uhuin|[Tt]apasin)\\s+${NOT_NAME}\\p{Lu}[\\p{L}'-]+(?:\\s+${NOT_NAME}\\p{Lu}[\\p{L}'-]+)?`, "gu")
const TITLE = /\b(?:Mr|Mrs|Ms|Dr|Herra|Rouva)\.?\s+\p{Lu}[\p{L}'-]+/gu
export function scrubNames(text: string): string {
  return text.replace(INTRO, (_m, lead: string) => `${lead} [name]`).replace(TITLE, "[name]")
}

// 2..1000 teams, or null: 1 team is the pilot itself, and anything else is not an answer we can scale by.
export const teamsCount = (n: unknown) => { const v = Math.round(Number(n)); return Number.isFinite(v) && v >= 2 && v <= 1000 ? v : null }
export const hallwayExcerpt = (l: Pick<Lead, "quote" | "role" | "teams">) =>
  `"${l.quote}" (${l.role})${l.teams ? ` Asked how many teams like theirs across the company do this task: about ${l.teams}.` : ""}`

interface Extract { names: string[]; role: string; quote: string; pain: string; next_step: string; temperature: Temperature }

// Replace each listed name and its Finnish inflections ("Liisa" -> "Liisan", "Liisalle") with [name].
// ponytail: suffix heuristic; consonant-gradation forms ("Pekka" -> "Pekan") slip through.
export function stripNames(text: string, names: string[]): string {
  const stems = names.flatMap((n) => n.split(/\s+/)).map((w) => w.replace(/[^\p{L}'-]/gu, "")).filter((w) => w.length >= 2)
  return stems.reduce((t, w) => {
    const stem = (w.length >= 5 ? w.slice(0, -1) : w).replace(/[-']/g, "\\$&")
    return t.replace(new RegExp(`(?<!\\p{L})${stem}\\p{L}{0,4}(?!\\p{L})`, "giu"), "[name]")
  }, text)
}
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["names", "role", "quote", "pain", "next_step", "temperature"],
  properties: {
    names: { type: "array", items: { type: "string" }, description: "Every person's first or last name that appears in the transcript, as written (e.g. 'Liisa', 'Virtanen'). Not company or product names." },
    role: { type: "string", description: "Job title only (e.g. 'Head of Finance'); 'unknown role' if not said. Never a name." },
    quote: { type: "string", description: "The single most telling sentence, verbatim from the transcript, with any person's name replaced by [name]." },
    pain: { type: "string", description: "Their problem in <=15 words." },
    next_step: { type: "string", description: "Agreed or obvious next step in <=12 words." },
    temperature: { type: "string", enum: ["cold", "warm", "hot"] },
  },
}

// synthetic: a demo note, invented for a demo (the /capture toggle); pages label it so nobody reads it as a real quote.
// role: the job title from the badge or typed on /capture; used when the note itself does not say one.
// teams: their answer to "how many teams like yours across the company do this task?" (optional). It goes into the
// hallway source's excerpt, so the headline scaled by it cites what was actually said.
export async function extractLead(companyId: string, transcript: string, synthetic = false, role?: string | null, teams?: number | null): Promise<Lead> {
  if (!get("SELECT id FROM companies WHERE id = ?", companyId)) throw new Error("unknown company")
  const clean = scrubNames(transcript.trim()).slice(0, 4000)
  if (!clean) throw new Error("empty transcript")
  let x: Extract = { names: [], role: "unknown role", quote: clean.slice(0, 400), pain: "", next_step: "", temperature: "warm" }
  // Rule 3: the regex pass misses bare first names ("Liisa from finance"), so the raw transcript and
  // the model's name list must not stay in the run log. Keep only sizes; the scrubbed lead is the record.
  const redact = (runId: string, names: number) => {
    run("UPDATE agent_steps SET input = ? WHERE run_id = ? AND name = 'prompt'", { redacted: "hallway transcript", chars: clean.length }, runId)
    run("UPDATE agent_steps SET output = ? WHERE run_id = ? AND name = 'turn'", { redacted: "lead extract", names_scrubbed: names }, runId)
    run("UPDATE agent_runs SET output = ? WHERE id = ?", "[redacted lead extract]", runId)
  }
  if (hasKey()) {
    try {
      const r = await runAgent<Extract>({
        agent: "lead_extract", subjectId: companyId, effort: "low", maxTokens: 2000, schema: SCHEMA, timeoutMs: 15_000,
        system: "You turn a consultant's hallway voice note (Finnish or English) into a lead record. Never output a person's name anywhere: use their job title or [name].",
        prompt: `Voice note transcript:\n${clean}`,
      })
      x = r.json!
      redact(r.runId, x.names.length)
    } catch {
      // Model down or slow: redact the failed run's log and save nothing, so the user retries instead of getting a
      // silent "unknown role" lead. (No key at all is a known offline mode and keeps the regex-scrubbed note.)
      const failed = get<{ id: string }>("SELECT id FROM agent_runs WHERE agent = 'lead_extract' AND subject_id = ? ORDER BY started_at DESC LIMIT 1", companyId)
      if (failed) redact(failed.id, 0)
      throw new Error("Couldn't read the note right now, so nothing was saved. Your text is still here: try Save again in a moment.")
    }
  }
  const clip = (t: string, n: number) => stripNames(scrubNames(t ?? ""), x.names ?? []).slice(0, n)
  const lead: Lead = {
    id: uid("lead"), company_id: companyId, created_at: now(),
    role: (!/^unknown role$/i.test(x.role?.trim() ?? "") && clip(x.role, 80)) || clip(role?.trim() ?? "", 80) || "unknown role",
    quote: clip(x.quote, 500),
    pain: clip(x.pain, 200),
    next_step: clip(x.next_step, 200),
    temperature: (["cold", "warm", "hot"] as const).includes(x.temperature) ? x.temperature : "warm",
    synthetic: synthetic ? 1 : 0,
    teams: teamsCount(teams),
  }
  insert("leads", lead as unknown as Record<string, unknown>)
  addSource({ company_id: companyId, kind: "hallway", url: null, lead_id: lead.id, title: `Hallway: ${lead.role}`, excerpt: hallwayExcerpt(lead) })
  return lead
}
