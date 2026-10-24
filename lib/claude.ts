// Shared Claude tool-loop runner. Owned by tech lead.
// Every model turn and every tool call is logged to agent_runs / agent_steps (the /hq board reads them).
import Anthropic from "@anthropic-ai/sdk"
import { Anthropic as PostHogAnthropic } from "@posthog/ai/anthropic"
import { randomUUID } from "node:crypto"
import { PostHog } from "posthog-node"
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages"
import { endRun, logStep, startRun } from "./db.ts"

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"

// Key lives in the hackathon root .env (never in this repo). Never log or print it.
function loadEnv() {
  if (process.env.ANTHROPIC_API_KEY) return
  // Paths are relative to the cwd (repo root for `npm run dev` and scripts).
  try { process.loadEnvFile("../.env") } catch { /* missing is fine */ }
  try { process.loadEnvFile(".env.local") } catch { /* missing is fine */ }
}

export function hasKey(): boolean {
  loadEnv()
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

function loadPostHogEnv() {
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST) return
  try { process.loadEnvFile(".env.local") } catch { /* missing is fine */ }
  try { process.loadEnvFile(".env") } catch { /* missing is fine */ }
}

loadPostHogEnv()
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST
const posthog = posthogKey && posthogHost
  ? new PostHog(posthogKey, {
      host: posthogHost,
      privacyMode: true, // hallway notes and briefs never leave the app; PostHog gets timing, tokens and errors only
      enableExceptionAutocapture: true,
      flushAt: 1,
      flushInterval: 0,
    })
  : undefined

let _client: Anthropic | undefined
function client(): Anthropic {
  if (!hasKey()) throw new Error("ANTHROPIC_API_KEY is not set (expected in hackathon-04/.env)")
  if (!posthog) {
    // PostHog is optional: without its env vars the app runs and sends nothing.
    return (_client ??= new Anthropic())
  }
  return (_client ??= new PostHogAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, posthog }) as unknown as Anthropic)
}

export interface Tool<I = Record<string, unknown>> {
  name: string
  description: string
  input_schema: BetaTool["input_schema"]
  strict?: boolean // only if the schema has additionalProperties:false + required
  run: (input: I) => Promise<unknown> // validate input yourself; return value is JSON-stringified
}

export type Effort = "low" | "medium" | "high"

export interface AgentOptions {
  agent: string // shows on /hq, e.g. "quick_scout"
  subjectId?: string | null // company or page id
  system: string
  prompt: string | BetaContentBlockParam[] // content blocks for vision (image + text)
  tools?: Tool<any>[]
  maxToolCalls?: number // hard cap, default 5; after it, tools are refused and the model must answer
  maxTokens?: number
  effort?: Effort
  schema?: Record<string, unknown> // JSON schema for the final answer (structured output)
  timeoutMs?: number // per model call; live paths set it so a slow network falls back fast (then only 1 SDK retry)
}

export interface AgentResult<T = unknown> {
  runId: string
  text: string
  json: T | undefined // parsed final answer when `schema` was given
  toolCalls: number
}

// Strip base64 image/document payloads before they hit the step log.
function loggable(content: string | BetaContentBlockParam[]): unknown {
  if (typeof content === "string") return content
  return content.map((b) =>
    (b.type === "image" || b.type === "document") && "source" in b && b.source.type === "base64"
      ? { type: b.type, source: `[base64 ${b.source.data.length} chars]` }
      : b,
  )
}

export async function runAgent<T = unknown>(o: AgentOptions): Promise<AgentResult<T>> {
  const tools = o.tools ?? []
  const maxToolCalls = o.maxToolCalls ?? 5
  const runId = startRun(o.agent, o.subjectId ?? null, MODEL)
  const traceId = randomUUID()
  const sessionId = `agent-run-${runId}`
  logStep(runId, "info", "prompt", { system: o.system, prompt: loggable(o.prompt) }, null)

  const messages: BetaMessageParam[] = [{ role: "user", content: o.prompt }]
  let toolCalls = 0

  try {
    for (let turn = 0; turn < maxToolCalls + 3; turn++) {
      const budgetLeft = toolCalls < maxToolCalls
      const t0 = Date.now()
      const request = {
        model: MODEL,
        max_tokens: o.maxTokens ?? 8000,
        system: o.system,
        messages,
        output_config: {
          effort: o.effort ?? "medium",
          ...(o.schema ? { format: { type: "json_schema" as const, schema: o.schema } } : {}),
        },
        ...(tools.length
          ? {
              tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, ...(t.strict ? { strict: true } : {}) })),
              tool_choice: budgetLeft ? { type: "auto" as const } : { type: "none" as const },
            }
          : {}),
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
        posthogTraceId: traceId,
        posthogProperties: { $ai_session_id: sessionId },
      }
      const res = await client().beta.messages.create(request, o.timeoutMs ? { timeout: o.timeoutMs, maxRetries: 1 } : undefined)
      await posthog?.flush()
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
      const uses = res.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use")
      logStep(runId, "model", "turn", { turn }, { stop_reason: res.stop_reason, text, tool_uses: uses.map((u) => ({ name: u.name, input: u.input })), usage: res.usage, model: res.model }, Date.now() - t0)

      if (res.stop_reason === "refusal") throw new Error(`model declined (${res.stop_details?.category ?? "unknown"})`)
      if (res.stop_reason === "max_tokens") throw new Error("hit max_tokens before finishing")

      messages.push({ role: "assistant", content: res.content }) // keeps thinking blocks intact
      if (res.stop_reason === "pause_turn") continue

      if (!uses.length) {
        let json: T | undefined
        if (o.schema) json = JSON.parse(text) as T
        endRun(runId, "ok", text)
        return { runId, text, json, toolCalls }
      }

      // Run this turn's calls in parallel; all results go back in ONE user message.
      const results: BetaToolResultBlockParam[] = await Promise.all(
        uses.map(async (u): Promise<BetaToolResultBlockParam> => {
          const tool = tools.find((t) => t.name === u.name)
          if (!tool) return { type: "tool_result", tool_use_id: u.id, content: `unknown tool ${u.name}`, is_error: true }
          if (toolCalls >= maxToolCalls) {
            return { type: "tool_result", tool_use_id: u.id, content: "Tool budget exhausted. Answer now with what you have.", is_error: true }
          }
          toolCalls++
          const t1 = Date.now()
          try {
            const out = await tool.run(u.input as Record<string, unknown>)
            const content = typeof out === "string" ? out : JSON.stringify(out)
            posthog?.capture({
              event: "$ai_span",
              properties: {
                $ai_trace_id: traceId,
                $ai_session_id: sessionId,
                $ai_span_id: randomUUID(),
                $ai_span_name: u.name,
                $ai_input_state: u.input,
                $ai_output_state: out,
                $ai_latency: (Date.now() - t1) / 1000,
              },
            })
            logStep(runId, "tool", u.name, u.input, out, Date.now() - t1)
            return { type: "tool_result", tool_use_id: u.id, content }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            posthog?.capture({
              event: "$ai_span",
              properties: {
                $ai_trace_id: traceId,
                $ai_session_id: sessionId,
                $ai_span_id: randomUUID(),
                $ai_span_name: u.name,
                $ai_input_state: u.input,
                $ai_output_state: msg,
                $ai_latency: (Date.now() - t1) / 1000,
                $ai_is_error: true,
                $ai_error: msg,
              },
            })
            logStep(runId, "error", u.name, u.input, msg, Date.now() - t1)
            return { type: "tool_result", tool_use_id: u.id, content: `error: ${msg}`, is_error: true }
          }
        }),
      )
      await posthog?.flush()
      messages.push({ role: "user", content: results })
    }
    throw new Error("turn limit reached without a final answer")
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : e instanceof Error ? e.message : String(e)
    logStep(runId, "error", "run", null, msg)
    endRun(runId, "error", null, msg)
    await posthog?.flush()
    throw e
  }
}
