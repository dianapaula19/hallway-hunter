# PROCESS: how we built Hallway Hunter

Append-only, timestamped (Europe/Helsinki). Each entry covers: what we **asked** the agent, what we **checked** ourselves, and what we **threw away** and why. Judges read this, so write decisions, not diary.

## Lanes

| Lane | Owner (session) | Scope |
|---|---|---|
| Tech lead | | shared kernel, CLAUDE.md, CONTRACT.md, integration, commits |
| LIVE | | capture, vision, PRH/TED/site, Quick Scout, brief, leads, Telegram |
| NIGHT | | evidence, researcher, cards and formula, script and audio, gates, page, /hq |

## Decisions (decision, reason, alternative rejected)

- 2026-10-24: chose node:sqlite over Postgres/ORM, because it is zero services and fresh-clone safe. Rejected Drizzle + Postgres (more moving parts).
- 2026-10-24: chose browser speechSynthesis for the two-host audio, because it adds no key and no cost and works offline. Rejected ElevenLabs (budget, and a key needed on stage).
- 2026-10-24: email is a local draft only (DB CHECK status='draft', own inbox). Rejected a Gmail send scope, because it is a hard rule.

## Log

### 2026-10-24 Sat
- **~16:00 tech lead.**
  - Asked: scaffold Next 16 on :3100, shared kernel (types, db, Claude tool-loop runner with step log), hard rules, lane contract.
  - Checked: PRH v3 and TED v3 with real curl (Kesko). `npm run check`, typecheck and build all pass. `/api/health` is live.
  - Threw away: create-next-app (we hand-wrote the minimal files), PRH `status` codes as a ceased signal (unverified, so we use registeredEntries type 4).
- **~16:45 NIGHT lane.**
  - Asked: build the citation sanitizer first, then the researcher, formula, showrunner, Skeptic-CEO loop, compliance, pipeline, `/p/[slug]`, `/hq`, approvals API and `scripts/night.ts`.
  - Checked: `node lib/night/sanitize.ts` self-check passes (invented, empty or foreign ids are dropped; an uncited script line with a digit, € or a non-company proper noun is dropped). typecheck, check and build pass. The night path runs end to end on `co_demo` with no key. Curl tests: approve creates an outbox draft to our own inbox; kill without a note returns 400; a killed page returns 404; a second decision returns 409. A compliance fixture flags promise words, a two-word name, a euro figure without "estimate", and a confidential lead.
  - Threw away: a separate URL guard in the researcher (LIVE's `fetchSite` already restricts to the company's own domain); `minimum`/`maxItems` in the output schemas (structured outputs reject them, so values are clamped in code); a JS popover library (native `popover` handles source chips).
  - Added: when there is no API key, the night path builds a template draft from the evidence store. Its runs are logged with model `offline-template`, and the approval is flagged "not scored".
  - Not verified: the model path (researcher, showrunner, skeptic) has never run against the real API, because the key is empty.
- **~17:15 LIVE lane.**
  - Asked: PRH/TED/site clients, vision extract, Quick Scout brief, lead capture with delete, a mobile `/capture` page, and a parser self-check (`node lib/live/selfcheck.ts [--live]`).
  - Checked with live read-only lookups: Kesko, Wärtsilä, Ponsse, Fiskars, a small Oy (Erilava, 0956143-7) and a dissolved company (0595625-5, ceased 2010-03-31).
    - PRH `status` is "2" for live and ceased firms alike, so it is useless. "Ceased" means a top-level `endDate`, or an open `registeredEntries` entry of type "4".
    - TED `~` is fuzzy and ignores diacritics: "Wärtsilä" matches "Wartsila Portugal". We keep a notice only if the name stem appears in a party name.
  - Measured with a real key:
    - scout with model: 4-6 s;
    - capture from a synthetic badge (fictional person, real company): 3.8 s;
    - photo to brief end to end: 8.5 s, against a target under 40 s;
    - evidence-only brief with no key: 0.2-2 s.
  - Graceful paths:
    - Typo: "Ponssee" and "Fiskarss" get "did you mean" Ponsse / Fiskars. PRH name search is prefix-like, so we retry the word minus 1-2 characters and rank by edit distance.
    - Ceased company: says so and gives no brief.
    - Small Oy with no TED hits: `thin_data`.
    - Model error or no key: a brief built from the evidence.
  - Threw away:
    - Trusting the model to scrub names. It kept "Liisa" in a "verbatim" quote. Now the schema asks for the names it saw, we strip them and their inflections in code, and the raw transcript is redacted from `agent_steps`.
    - Letting the model fetch any URL. `fetchSite` allows only the company's own domain, refuses private hosts, and drops off-site redirects. Erilava's site redirects to another domain and is refused.
    - Sending the raw PRH blob to the client.
  - Changed the prompt: what_they_do drifted into background knowledge ("family-owned"), so the prompt now requires every word to be backed by the cited excerpt.
- **~16:20 Matrix OS lane** (entry added by the integrator from the lane report).
  - Asked: learn the real Matrix OS formats from the `HamedMP/matrix-os` source and write manifests, cron entries, a dry-run `deploy.sh` and a shared Agent Ops board. Mark every unverified assumption.
  - Checked in the source rather than trusting the research brief:
    - A Matrix cron job only sends a fixed message. It does not run code. So our own `box-loop.mjs` keeps the clock (22:00 night path, 07:30 digest).
    - A hand edit to `cron.json` is cached until the gateway restarts, so cron entries are registered through `POST /api/cron`.
    - `"database": "postgres"` breaks a node app's spawn.
  - Threw away:
    - writing `cron.json` directly;
    - opening sqlite directly from `feed.mjs` (it now goes through `lib/db.ts`);
    - `console.assert`, which never fails a run;
    - a vite runtime for Agent Ops;
    - any direct Telegram call (Matrix delivers the digest, and only to chats on our allow-list).
  - Not verified: anything against a real Matrix box. Assumptions A1-A10 are listed in `../MATRIX.md`.
- **~16:55 integrator.**
  - Asked: merge the lanes, run the live path with a real key on 3 real Finnish companies (read-only) and the night path on 1, judge the output as a skeptical CEO would, fix the worst problems, harden the demo, then write the README and commit.
  - Measured with a real key (`claude-sonnet-5-5`):
    - Quick Scout: 5.6 s on Vaisala, 5.2 s on Konecranes, 5.4 s on Valmet. Each brief has 2 cited TED signals and comes in at 98-113 words.
    - Synthetic badge (a fictional person at Konecranes): vision and PRH 3.2 s, name dropped, role kept, company auto-picked. About 8.5 s from photo to brief.
    - Lead from a synthetic voice note: 2.4 s, name scrubbed.
    - Night path: 31-41 s for researcher, showrunner, up to 3 skeptic rounds and compliance.
  - Found and fixed:
    1. **Wrong company first.** "Vaisala" listed "Vaisalantien Kiinteistö Oy" above Vaisala Oyj, and "Konecranes" listed Konecranes Finance Oy first. Ranking now ignores the legal form (Oy, Oyj, Abp...). A single live exact match is auto-picked, which saves a tap on a judge's company.
    2. **The closing ask never reached the CEO.** On every model run the sanitizer dropped the last line ("Would a 20-minute call…") because an uncited line contains a digit. Lines mentioning "Friday" or "SAP" were dropped too. Now:
       - the prompt asks for "twenty minutes" in words and for hallway details to cite the hallway source;
       - weekday and month names count as non-facts;
       - the code appends a reply-friendly closing question if the model's was dropped.
       Script lines dropped per run went from 1-2 to 0.
    3. **Compliance blocked approval on public names.** "Two Luka Koper", "The Deutsche Bahn" and "Luka Koper's RTG" were flagged as personal names. The heuristic now ignores acronyms and possessives and accepts any word pair found in the evidence. A self-check was added (`node lib/night/compliance.ts`).
    4. **Prompt tuning from Skeptic-CEO notes:**
       - The script no longer apologises ("thin data", "we left out…"). Caveats stay on the page.
       - The hallway quote is attributed as "said to a Velho consultant in a conference hallway".
       - The researcher sizes "people" as one named team instead of an unexplained 40.
       - The skeptic now sees the formula inputs and is told which house rules it cannot change.
       Skeptic minimum score went from 3 to 4 (stop/read 5 → 6), and reply is still the weak axis.
    5. **"Wartsila" found only a ceased namesake.** Did-you-mean now tries ä/ö variants of the whole query ("Wartsila" → Wärtsilä Oyj Abp, "Hameenlinnan Energia" → Hämeenlinnan Energia Oy). It also runs when only ceased companies matched, and ranks by edit distance over the whole name.
  - Robustness for a live demo:
    - **PRH blocked us.** Our test burst got HTTP 429 and then a refused connection from `avoindata.prh.fi` for more than 10 minutes. We added a 10-minute lookup cache, one retry on 429, and plain-language errors ("PRH is unreachable"). Companies already looked up are now served from the stored PRH record, so a scouted company still works offline.
    - Live model calls now have a per-call timeout and one SDK retry: 12 s for vision, 15 s for the scout and lead extract. The scout then falls back to an evidence-only brief: with the API unreachable, that took 0.4 s.
      - First try: no retries at all. During the 5-card timing run, one vision call failed on a transient "Connection error", so we went back to one retry.
    - A failed lead extraction now keeps the regex-scrubbed note instead of failing the save, and still redacts the transcript from the failed run's log.
    - A night path that throws deletes its half-built page, so cron retries the lead.
  - Checked: typecheck, check and build; all six self-checks; every page and GET route answers 200 (an unknown slug returns 404); `/p` and `/capture` rendered at a real 390 px viewport. The lanes' "cut off on the right" was headless Chrome's 500 px minimum window, not a layout bug.
  - Not checked: `selfcheck --live` after the did-you-mean change, because PRH was refusing connections. The fallback paths were tested instead. Speech playback on a real phone was not checked.

## Eval (before / after)

| Metric | Before | After | How measured |
|---|---|---|---|
| Photo to brief latency (p50) | n/a | **8.4 s** (7.7 / 7.9 / 8.4 / 8.6 / 9.5 s), target < 40 s | 5 synthetic badges (fictional people at Vaisala, Kone, Kesko, Valmet, Fiskars), timed client-side from capture to brief; all 5 had 2 cited signals and 94-117 words |
| Brief claims dropped by sanitizer | n/a | 0 of 44 (the first 11 scout runs × 4 claims) | `sanitize_*` info steps in `agent_steps` |
| Script lines dropped by sanitizer, per night run | 1-2 (the closing ask, every run) | 0 | same, on the Konecranes synthetic lead |
| Skeptic-CEO min(stop, read, reply), round 0 → final | 3 → 3 | 4 → 4 (stop/read 6) | 3 night runs before the fixes, 1 after, same lead |

## Cut list

- WhatsApp, HubSpot, weekly stay-top-of-mind cron, index, voice clones (from the briefing).
