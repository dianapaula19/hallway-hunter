# Hallway Hunter: rules for every coding session

Velho hackathon entry. A photo, company name or voice note becomes a cited 120-word brief (LIVE). Overnight it becomes a private "Made for <Company>, Velho draft" page with opportunity cards and a ~75 s two-host audio briefing, which a human approves (NIGHT). Architecture and file ownership are in `CONTRACT.md`. Read it before you touch anything.

## Hard rules. NEVER violate.

1. **Never send email or contact a real company or person.** No SMTP, no Gmail send, no Telegram message to anyone except our own test chat, no form posts to company sites. Email exists only as a row in the local `outbox` table, created through `createDraft()` in `lib/db.ts`, which always addresses our own inbox (`HH_OWN_INBOX`). The DB rejects any outbox status other than `draft`. Do not add a send path, a "sent" state, or a Gmail/Matrix `send` capability.
2. **Every claim carries a source id, or it is dropped.** A claim is `{ text, source_ids }` (see `lib/types.ts`). Each id must exist in the `sources` table for that company. The citation sanitizer runs before anything is stored or shown: the brief, the cards, the audio script and the page. Never let the model invent a source id or a URL. If the evidence is thin, say "thin data". Do not pad.
3. **Hallway quotes are stored with a role, never a name.** `leads.role` (e.g. "Head of Finance") has no name column next to it, by design. Scrub personal names out of quotes and transcripts before storing them. Every lead has a delete button, and deleting it cascades to its `hallway` source row. Never put a hallway detail that a compliance check flags as confidential on a page.
4. **Label everything.** Each CEO-facing output says **"Velho draft"**, and the hosts and authors are **"by Velho's AI analysts"**. No output may pose as a human or as the company itself.
5. **Euro figures are estimates with their formula visible and editable.** Show `hours/week × people × weeks/year × €/hour × automation share`, let the viewer edit each input, and recompute in the browser. Label the figure "estimate", or "sector estimate" when no input has a company source. Never show a bare euro number.
6. **All test and demo data is synthetic.** Seed data, fixtures and screenshots use fictional companies and roles (`npm run seed`). Live lookups of public registries (PRH, TED, a company's own public site) are read-only GETs or searches.
7. **Secrets.** `ANTHROPIC_API_KEY` lives in `../.env` (the hackathon root, outside this repo). `lib/claude.ts` loads it. Never print, log, return or commit it. The same goes for `TELEGRAM_BOT_TOKEN`.
8. **Do not git commit or push.** The integrator commits.

## Stack and conventions

- Node 24: `export PATH=~/.local/node-v24.22.1-linux-x64/bin:$PATH` (the system node is 20, and `node:sqlite` plus `.ts` scripts need 24).
- Next.js 16 App Router, TypeScript, port **3100** (`npm run dev`). This Next differs from your training data. Check `node_modules/next/dist/docs/` before using an API (see `AGENTS.md`). `params` and `searchParams` are Promises.
- Storage: `node:sqlite` at `data/hh.db`, through `lib/db.ts` only (`db/get/all/run/insert`). JSON columns are parsed and stringified automatically. Schema changes go to the tech lead, because `lib/db.ts` is shared.
- Claude: only through `runAgent()` in `lib/claude.ts`. It logs every model turn and tool call to `agent_runs` / `agent_steps`, caps tool calls (default 5), and supports a JSON-schema final answer. Model: `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`. Do not construct `new Anthropic()` anywhere else.
- Imports inside `lib/` and `scripts/` are relative and include the `.ts` extension (`../lib/db.ts`), so `node scripts/x.ts` runs without a build step. Use erasable TS only: no enums, no namespaces, no parameter properties. App files may use `@/lib/...`.
- Stdlib and native first: `fetch`, `node:sqlite`, browser `speechSynthesis` / `SpeechRecognition`, `<input type="file" capture>`. No new dependency without asking the tech lead.
- Before you hand back a lane: `npm run typecheck && npm run check && npm run build`.
