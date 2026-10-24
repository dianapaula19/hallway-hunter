# CONTRACT: architecture and file ownership

Two lanes build in parallel against the shared kernel. **Edit only files your lane owns.** Anything else goes as a request to the tech lead. Hard rules are in `CLAUDE.md`.

## Architecture

```
 phone/laptop                     Next.js 16 on :3100 (node:sqlite data/hh.db)
 ─────────────                    ───────────────────────────────────────────────
 /capture  photo|name|voice ──►  LIVE  vision_extract ─► PRH lookup ─► "did you mean"
 Telegram bot (optional) ────►         quick_scout (≤5 tools: prh, ted, site) ─► brief ≤120w
                                       lead_extract (voice transcript ─► lead + hallway source)
                                          │ writes companies, sources, leads, briefs
                                          ▼
 /hq "run night path now" ───►  NIGHT  researcher ─► 3 opportunity cards (euro formula)
 scripts/night.ts (cron) ────►         showrunner ─► ~75s A/B script ─► sanitizer
                                       skeptic_ceo (score <7 ─► rewrite, ≤2 rounds) ─► compliance
                                       ─► approval (PENDING) ─► /hq approve|edit|kill
                                       ─► outbox draft (own inbox, status 'draft' only)
 /p/[slug]  "Made for <Company>, Velho draft": cards + formula editor + speechSynthesis player
```

Every Claude call goes through `runAgent()` (`lib/claude.ts`). It logs each turn and tool call to `agent_runs` / `agent_steps`, and `/hq` shows those live by polling every 2 s. **Evidence store:** the `sources` table. Every claim is `{ text, source_ids }` and cites ids from that table.

## Shared kernel (tech lead, done)

| File | What it gives you |
|---|---|
| `lib/types.ts` | Row types for every table, plus `Claim`, `Brief`, `EuroFormula`, `ScriptLine`, `SkepticScore` |
| `lib/db.ts` | `db/get/all/run/insert` (JSON columns auto-parsed), `uid(prefix)`, `now()`, `addSource()`, `knownSourceIds(companyId)`, `startRun/logStep/endRun`, `createDraft()` (the only outbox writer), `OWN_INBOX` |
| `lib/claude.ts` | `runAgent({agent, subjectId, system, prompt, tools, maxToolCalls=5, effort, schema})` returns `{runId, text, json, toolCalls}`. Also `hasKey()` and `MODEL`. A tool is `{name, description, input_schema, strict?, run(input)}`. `prompt` may be content blocks (base64 image for vision). With `schema`, the final answer is JSON-schema constrained. It throws on refusal, max_tokens or a missing key, and the run is logged as `error`. |
| `scripts/seed.ts` | Synthetic `co_demo` with a lead and 3 sources, so NIGHT can work before LIVE lands |
| `scripts/check.ts` | Schema hard-rule asserts (draft-only outbox, 120-word cap, lead-delete cascade) |
| `app/api/health` | `{ok, model, key: boolean, runs}`, never the key itself |

**Tables:** `companies`, `leads` (role, no name column), `sources` (kind prh|ted|site|hallway|note; a hallway source cascades with its lead), `briefs` (DB CHECK `word_count <= 120`), `pages`, `opportunities`, `agent_runs`, `agent_steps`, `approvals` (Bahn `agent_proposals` shape), `outbox` (CHECK `status='draft'`).

## LIVE lane: owns

```
app/capture/**                 web capture page (client): photo / type company / voice note, brief view, lead list + delete
app/api/capture/route.ts       POST multipart {image?} | {q?} → vision_extract → PRH candidates
app/api/scout/route.ts         POST {business_id} → company row + quick_scout → Brief
app/api/lead/route.ts          POST {company_id, transcript} → lead_extract → Lead (+ hallway source); GET ?company_id
app/api/lead/[id]/route.ts     DELETE → removes lead and its hallway source
lib/live/**                    vision.ts prh.ts ted.ts site.ts scout.ts brief.ts lead.ts
scripts/telegram-bot.ts        optional; no-op exit if TELEGRAM_BOT_TOKEN unset
```

**Must deliver:**
1. **Intake.** `<input type="file" accept="image/*" capture="environment">` or a text field. Voice uses the browser's `SpeechRecognition` / `webkitSpeechRecognition` (fi-FI / en-US toggle); show the transcript and let the user edit it before saving.
2. **Vision extract** (`runAgent` + schema, no tools) returns `{company_name, business_id|null, role|null}`. Discard any person's name on the card. Keep the role only.
3. **PRH lookup with "did you mean".** Show up to 5 candidates (name, Y-tunnus, business line, registered year). Mark ceased companies.
4. **Quick Scout** (`agent: "quick_scout"`, `maxToolCalls: 5`, `effort: "low"`). Its tools `prh_company`, `ted_search` and `fetch_site` each persist rows via `addSource()` and return them **with ids**. The final answer is the `Brief` JSON schema. Run every claim through `sanitizeClaims` (owned by NIGHT, see below), then count words, store in `briefs`, and render. The brief contains: what they do, 2 cited signals, 3 openers, 1 don't-say, and 1 likely objection with its source. If fewer than 2 signals survive, set `thin_data: true`. **Target: photo to brief in under 40 s.**
5. **Lead capture** (`agent: "lead_extract"`, schema) returns `{role, quote, pain, next_step, temperature}`, with names scrubbed. Insert the lead plus a `kind:'hallway'` source with `lead_id`. Every lead row gets a delete button.
6. **Telegram (optional).** Long-poll `getUpdates`. Answer only chats in `TELEGRAM_ALLOWED_CHAT_IDS` (our own) and ignore everything else. A photo goes to `getFile`, then the same pipeline through `http://localhost:3100/api/capture` and `/api/scout`, and the bot replies with the brief. Voice stays web-only.

**Exports NIGHT may import (read-only, keep these signatures):**
```ts
// lib/live/prh.ts
searchCompanies(q: string): Promise<{ business_id: string; name: string; line: string; registered: string; ceased: boolean }[]>
loadCompany(businessId: string): Promise<Company>       // upserts companies + one 'prh' source
// lib/live/ted.ts
tedSearch(company: Company, limit?: number): Promise<Source[]>
// lib/live/site.ts
fetchSite(company: Company, url: string): Promise<Source | null>  // GET only, text excerpt, 8s timeout
```

**Endpoints, verified with curl on 2026-10-24 (no key needed):**
- **PRH YTJ v3.**
  - `GET https://avoindata.prh.fi/opendata-ytj-api/v3/companies?businessId=0109862-8` returns `{totalResults:1, companies:[...]}` (Kesko Oyj).
  - `?name=Kesko%20Oyj` returns 1 result. `?name=Kesko` is fuzzy and returned 17, including ceased firms such as "Innovaatioyhtiö Epäkesko Oy" (ceased 2007).
  - Company keys: `businessId.value`, `names[]` (type "1" is the official name and the current one has no `endDate`; type "3" is an auxiliary name), `mainBusinessLine.descriptions[]` (languageCode 1=fi, 2=sv, 3=en), `companyForms`, `companySituations` (liquidation/bankruptcy), `registeredEntries` (a type "4" entry means "Ceased"), `addresses`, `status`, `tradeRegisterStatus`, `registrationDate`, `lastModified`.
  - There is no email or phone. Website is absent for Kesko, so treat it as optional.
  - Cite the API URL itself as the source url.
  - `status` codes are unverified. Before you trust them, test against one dissolved company.
- **TED.**
  - `POST https://api.ted.europa.eu/v3/notices/search`, JSON body `{"query":"(organisation-name-tenderer ~ \"Kesko\" OR buyer-name ~ \"Kesko\") SORT BY publication-date DESC","fields":["publication-number","notice-title","publication-date","buyer-name","notice-type"],"limit":3}`, returns `{notices[], totalNoticeCount:385}`.
  - `notice-title` and `buyer-name` are objects keyed by language (`eng` / `fin`).
  - `~` matching is fuzzy, so check that the name really appears before you call something a signal.
  - Cite `https://ted.europa.eu/en/notice/-/detail/<publication-number>`.

## NIGHT lane: owns

```
lib/night/**                   sanitize.ts (SHIP FIRST, LIVE imports it), researcher.ts, formula.ts, script.ts,
                               skeptic.ts, compliance.ts, pipeline.ts
app/p/[slug]/**                private page + client components (formula editor, two-voice player)
app/hq/**                      board (client, polls /api/hq every 2s)
app/api/night/route.ts         POST {company_id, lead_id?} → runNightPath, returns {page_id, slug} when done
app/api/hq/route.ts            GET → {runs (last 20 + steps), approvals PENDING, outbox, pages}
app/api/approvals/[id]/route.ts POST {action: approve|edit|kill, note?, final_payload?}
scripts/night.ts               cron entry: every lead from the last 24h without a page → runNightPath
```

**Must deliver:**
1. **`lib/night/sanitize.ts`, in the first 30 min:**
   ```ts
   sanitizeClaims(companyId: string, claims: Claim[]): { kept: Claim[]; dropped: Claim[] }
   sanitizeScript(companyId: string, lines: ScriptLine[]): { kept: ScriptLine[]; dropped: ScriptLine[] }
   ```
   - Drop any item whose `source_ids` is empty or contains an id that is not in `knownSourceIds(companyId)`.
   - Script lines may omit sources only when they contain no digits, €, % or proper nouns other than the company name.
   - Log the dropped items as an `info` step.
2. **Researcher** (`agent: "researcher"`, ≤8 tools: `search_sources` over the evidence store, plus LIVE's `fetchSite` / `tedSearch`) returns exactly 3 opportunities. Each has a `Claim`, an `EuroFormula` and `input_source_ids`. Inputs without a source get `label: "sector estimate"`.
3. **Formula.**
   - `eur_per_year = hours_per_week × people × weeks_per_year × hourly_cost_eur × automation_share`, computed in `formula.ts` and shown with every input.
   - Inputs are editable on the page and recompute client-side.
   - Every figure is labelled "estimate".
4. **Script** (`agent: "showrunner"`).
   - Two hosts A/B, introduced as "Velho's AI analysts". About 75 s, which is about 180-200 words.
   - The **first line quotes the hallway quote verbatim**, citing its hallway source id.
   - At least 2 public sources are cited.
5. **Skeptic-CEO gate** (`agent: "skeptic_ceo"`, schema `SkepticScore`).
   - If `min(stop, read, reply) < 7`, rewrite the script with the notes, for at most 2 rewrite rounds.
   - Store every round in `pages.skeptic`.
   - A page still under 7 after 2 rounds goes to approval anyway, flagged "below bar".
6. **Compliance** runs deterministic checks first: promises ("guarantee", "will save", "we will"), personal names, and any lead detail marked confidential. A model pass is optional. Store `{ok, issues}`. Approval is blocked in the UI while `ok:false`.
7. **Page `/p/[slug]`.**
   - Slug from `uid("p")`, unguessable. `robots: noindex`, linked only from /hq.
   - Header "Made for <Company>, Velho draft"; byline "by Velho's AI analysts".
   - 3 cards, each with a source chip that shows the excerpt and url on click.
   - A player built on `speechSynthesis` with two distinct voices from `getVoices()`. If only one voice exists, fall back to the same voice at a different pitch. The transcript is visible and highlights the line being spoken.
8. **/hq.**
   - Live runs with their steps, and pending approvals.
   - **Approve** or **edit** sets the approval to `APPROVED` / `EDITED` with `final_payload` and calls `createDraft()`.
   - **Kill** requires a note, sets `REJECTED` and marks the page `killed`.
   - An outbox list, and a **"Run night path now"** button with a company/lead picker.
9. **`runNightPath(companyId, leadId?)`** in `pipeline.ts`.
   - Runs research, cards, script, sanitize, skeptic loop and compliance in order, then sets the page to `pending_approval` and creates an approval with `kind:'page'`.
   - Each stage is its own `runAgent` run so /hq shows progress.
   - Develop against `npm run seed` (`co_demo`, `lead_demo`).

## Shared touch points

- `package.json` scripts already exist for `bot` and `night`; the owning lane creates the file. Adding a dependency needs the tech lead.
- `PROCESS.md` is append-only and shared. Add timestamped entries: what we asked, what we checked, what we threw away.
- Done for each lane means `npm run typecheck && npm run check && npm run build` pass, and the lane's flow works against `npm run seed` data with no API key. Show a "no key" state instead of crashing (use `hasKey()`).
