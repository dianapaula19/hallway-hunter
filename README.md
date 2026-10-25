# Hallway Hunter

A Velho hackathon entry. A Velho consultant at a conference snaps a badge, types a company name or records a voice note. Within seconds they get a **cited brief of up to 120 words** to read before the conversation (the LIVE path). Overnight, every hallway lead becomes a private **"Made for <Company>, Velho draft"** page with one to three opportunity cards (only those with real evidence), a euro estimate whose formula you can edit, one concrete question, and a two-host audio briefing of at most 75 seconds. **A human approves it before anything leaves the building** (the NIGHT path).

- Every claim cites a source id from our evidence store: the PRH trade register, EU TED tenders, the company's own website, or the hallway note. A citation sanitizer drops any claim whose source it cannot find, so a gap shows as "thin data" rather than being filled in.
- Hallway quotes are stored with a role, never a name. Names are scrubbed before storage and redacted from the agent log, and every lead has a delete button.
- Everything is labelled "Velho draft, by Velho's AI analysts". Email exists only as a local draft addressed to our own inbox. There is no send path.

Rules are in [`CLAUDE.md`](CLAUDE.md), architecture and file ownership in [`CONTRACT.md`](CONTRACT.md), and how we built it in [`PROCESS.md`](PROCESS.md).

## Run it

Needs Node 24 (`node:sqlite` and `.ts` scripts). The Anthropic key is read from `../.env` (`ANTHROPIC_API_KEY`), outside this repo. Without a key everything still runs: briefs and pages are built straight from the evidence and labelled as such.

```bash
export PATH=~/.local/node-v24.22.1-linux-x64/bin:$PATH
npm install
npm run seed          # synthetic demo company + lead (co_demo)
npm run dev           # http://localhost:3100
```

| URL | What |
|---|---|
| `/capture` | Phone-first LIVE page: photo, name or Y-tunnus, brief with tappable source chips, voice note (fi-FI / en-US), leads with delete |
| `/hq` | Board, polled every 2 s: live agent runs and steps, "Run night path now", pending approvals (approve, edit, kill), outbox drafts |
| `/p/<slug>` | The private CEO page (noindex, unguessable slug, linked only from /hq) |
| `/api/health` | `{ok, model, key: boolean}`. Never returns the key itself |

Our own inbox: copy `.env.example` to `.env.local` and set `HH_OWN_INBOX` to a real address of the team (the placeholder is `your-team@velho.example`). It is the only address the app ever writes to: approving a page on /hq creates a local outbox **draft** to it, never a sent mail. It also turns on the **Reply yes** button on `/p`, a `mailto:` link to that inbox that opens in the reader's own mail app; nothing goes out until they press send there. Unset, or still the `.example` placeholder, drafts are addressed to `hallway-hunter-team@localhost` (shown in /hq's outbox) and `/p` shows no button and says nothing about one (only the `/hq` preview banner notes it is off). The demo DB runs that way.

The sender at the foot of every `/p` page ("Name · Role") comes from `HH_CONSULTANT_NAME`, `HH_CONSULTANT_ROLE` and `HH_CONSULTANT_PHONE` (also in `.env.example`). Unset, the page signs "Your Velho consultant": we never put an invented Velho employee's name on a page. The review state ("draft, not yet reviewed by a person at Velho") shows only as a banner when the page is opened from `/hq` (`?preview=1`); the company reader sees the sender, and "checked by a person at Velho" once the page is approved.

Password (optional, off by default): start with `HQ_PASSWORD=<something> npm start` (or `npm run dev`) and `proxy.ts` asks for HTTP basic auth (any username, that password) on everything except the `/p/<slug>` pages, which clients open from a link, and `/api/health`. That covers `/`, `/hq`, `/capture` and every other `/api` route, including the one that spends model credits. Leave it unset locally. A `/p` link is protected only by its unguessable slug.

Night path from cron: `npm run night` builds a page for every lead from the last 24 h that has none yet.

Checks: `npm run typecheck && npm run check && npm run build`, plus self-checks with no network:

```bash
node lib/live/selfcheck.ts            # PRH/TED parsers, ranking, did-you-mean, site guard, name scrub, 120-word fit
node lib/live/selfcheck.ts --live     # + read-only PRH/TED lookups on real companies (contacts nobody)
node lib/night/sanitize.ts            # citation sanitizer
node lib/night/compliance.ts          # name heuristic, audio length, public-citation rule
node lib/night/script.ts              # script fitting: one label, no filler, ask = one question, ≤170 words
node lib/night/scale.ts               # company-size fact parser, EU contracts won (namesakes left out)
node lib/night/hours.ts               # hour conversions from the note ("three hours a day between us" -> 15 h a week)
node lib/night/pipeline.ts            # offline template: word-boundary clipping, foreign TED titles -> "<category> in <country>"
```

Output eval, repeatable and with no model call: `npm run eval` reads the stored briefs and pages and writes [`evals/results.md`](evals/results.md) (brief words ≤ 120, citations, public sources cited, audio seconds ≤ 75, labelled euro figures, skeptic scores, compliance re-run with today's rules). `node scripts/eval.ts --recheck` also stores that fresh compliance on drafts waiting for approval.

Re-run the reader test on stored pages (one model run each, appended as a new round so /hq shows a current reason): `node scripts/rescore.ts <slug> …`.

Move pages between two copies of the DB (a lane worktree's `data/hh.db` into main's) without changing any row already there:

```bash
HH_DB=<lane>/data/hh.db node scripts/pages-transfer.ts export p_7Rrc_JGH p_MicoMWeT p_AhbpxCx8 > pages.json
node scripts/pages-transfer.ts import pages.json            # dry run on data/hh.db: prints what it would insert
node scripts/pages-transfer.ts import pages.json --apply    # one transaction; then:
node scripts/tidy-demo.ts && node scripts/recheck-compliance.ts
```

A page travels with its company, lead (the other leads' hallway rows stay behind), sources, briefs, cards, approval and agent runs. Import only inserts: an identical row is skipped, a different row with the same id is reported as a conflict and left alone, and a company whose Y-tunnus sits under another id stops the import. `tidy-demo` then kills the older draft per company, and the recheck applies today's rules to every waiting draft (it also marks an old why line's uncited conclusion as our assumption).

Reset the local data (`data/hh.db` is gitignored and holds every test lead, page, run and outbox draft):

```bash
# stop npm run dev first
rm -f data/hh.db data/hh.db-wal data/hh.db-shm && npm run seed     # everything, back to the synthetic demo
node -e 'const d=new (require("node:sqlite").DatabaseSync)("data/hh.db");d.exec("PRAGMA foreign_keys=ON;DELETE FROM outbox;DELETE FROM approvals;DELETE FROM pages;DELETE FROM leads;DELETE FROM agent_runs")'   # keep looked-up companies and sources (PRH rate-limits re-lookups), drop the rest
```

Model: `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`. Every call goes through `runAgent()` in `lib/claude.ts`, which logs each turn and tool call to `agent_runs` / `agent_steps`.

## Live demo script (about 4 minutes)

1. **Phone on `/capture`.** Ask a judge to name any Finnish company. Type it, or snap a synthetic badge (a fictional person at a real company).
   - The vision step reads the company and role and drops the person's name. PRH returns candidates, and an exact name match is picked automatically.
   - **p50 8.4 s from photo to brief** across 5 synthetic badges (7.7-9.5 s), measured on 2026-10-24 with a real key. The target is under 40 s.
2. **Read the brief aloud.** It has what they do, two cited signals (usually recent TED awards), three openers, one thing not to say, and the likely objection. Tap a source chip to show the excerpt and the PRH or TED URL behind it.
3. **Edge cases, if the judge tries to break it:**
   - typo or no ä/ö ("Ponssee", "Wartsila"): a "did you mean" list;
   - a dissolved company (e.g. Y-tunnus `0595625-5`): "ceased in the trade register", and no brief;
   - a small private Oy with no tenders: the brief is marked **thin data** and is not padded;
   - nonsense: "Nothing in the PRH register", with a hint to use the Y-tunnus.
4. **Voice note (main path, rehearse it).** **Stage move: ask the judge for one real annoyance at their company** ("what does someone on your team still retype or copy by hand?") and record their answer as the note, in their words, with their job title. Then ask the follow-up the page needs: **"how many teams like that across the company?"** and type the number into the optional field under the job title. The quote on the page is then "said by a judge today", not invented, and the headline scales by their answer ("€37 300 for this team · about 6 teams like it → ~€223 800", cited to the note). Untick "Demo note" only for that real answer; if the judge prefers not to, fall back to a made-up note.
   Fallback: speak a short, made-up note about the judge's company in Finnish or English ("their two buyers retype supplier PDFs every morning"), edit the transcript and save. "Demo note" is ticked by default, so every page labels the quote "invented for this demo; nobody at <company> said this". The lead shows a role, a quote, the pain point and a temperature, with no name. Show the delete button.
   - Type their job title in the field under the note if the note does not say it (a badge photo fills it in). Without one the page says "unknown role".
   - **No note, no page.** "Run" on /hq lists only companies with a saved note, and `/api/night` answers 400 with the reason: the page costs the task someone described. A page without a note is only questions from the public record and read weak (Tokmanni: stop 3, read 4, reply 2).
5. **`/hq` → Run night path now** on that lead, "For the COO" (or CEO, CFO, the person met). The board fills live: a size fact from the company's own site, researcher, showrunner, skeptic (reading as that executive), then compliance. Started from /hq it skips the rewrite round, because someone is waiting: 16-18 s on the cold run below.
6. **Open `/p/<slug>`.** About 230 words above the fold:
   - The headline (the people and hours on the task, "Two people, 15 hours a week: …", with the euro under it as "a first step"; scaled by the teams answer when there is one, the step shown under it and cited to the note), the hallway quote attributed by role only, **one question** that names the sender and what they send ("Shall <consultant> send you a one-page teardown by Friday, a five-minute read built from what your team already told us: where the utilities' PDF orders arrive, which fields get retyped into SAP, what an AI reader would take over…?") and **Reply yes** right under it (when `HH_OWN_INBOX` is set), then the named sender.
   - Everything else is folded into **"The working"** (closed, with a one-line summary of the formula): why it matters at that company (only when a public source naming the company itself describes the task; otherwise left out), the pilot line, the card with its editable calculator (and an editable "teams like it" multiplier), what we checked, a block to forward the page to whoever owns the task, the audio and the sources.
   - Open "The working", edit "people" or "teams like it" and the estimate recalculates. Every figure says "estimate" or "sector estimate".
7. **Back in `/hq`:**
   - Show the Skeptic-CEO scores. They are honest and often below the bar, and then /hq marks the card "below bar" (internal only, not in the draft subject).
   - Approve to create a **local draft to our own inbox**, or Kill (a note is required).
   - Nothing is ever sent.

## Live demo: cold run

Rehearsed on 2026-10-24 on three Finnish companies that were not in the database and that nobody had prepared, through the real routes on a production build (`next start`): capture by name, brief, a short spoken-style note (invented, marked "Demo note"), night path, `/p`. The times are wall-clock from `scripts/coldrun.mjs`, which calls the same HTTP routes the pages call (`node scripts/coldrun.mjs "Kemira Oyj" "<note>" "<job title>"`; it spends 1 PRH request and 5 model runs per company).

| Company (size) | Name → brief | Note saved | Night path | `/p` | What broke, and the fix |
|---|---|---|---|---|---|
| Kemira Oyj (large, listed; its site says 4,900 people) | 5.3 s (PRH 1.1 + scout 4.2) | 1.9 s | 18.1 s (research 8.7, script 4.1, reader test 3.7) | 0.1 s | The note named no role, so the letter says "unknown role": /capture now has a job-title field, filled from the badge. The pilot line was dropped because "PDF" counted as an uncited proper noun: it now cites card 1's sources when its only facts are card 1's. |
| Mipro Oy (small private Oy, rail signalling) | 5.7 s (1.3 + 4.4) | 2.0 s | 16.3 s (3.9, 4.3, 4.9) | 0.3 s | Compliance held the page over "Väylävirasto's Mipro TCS" (a TED buyer and a product read as a person's name). The check now needs 2+ words unknown to the evidence; the hold cleared on the next /hq load. |
| Teleste Oyj (mid-size, listed) | 8.9 s (1.5 + 7.4) | 2.0 s | 0.0 s, offline template (model-down fallback, no key in that process) | n/a | The brief came back **thin**: TED's fuzzy match returned 9 "SPL Tele GmbH"-type namesakes. TED now retries with a prefix match ("Teleste*") and finds the real awards. The offline template was poor (pain text pasted twice, inputs cited to a note that did not state them): fixed, and it now states the newest TED award as a cited fact. |

Each company cost one PRH request (the scout now reuses the record the name search returned), 3 in total. Model runs: 12 (Kemira 5, Mipro 5, Teleste 2).

**Round 5 re-run, so the pages exist and open.** The round-4 Kemira and Teleste pages lived only in that lane's DB, which was deleted, so they gave 404 on main. Re-run on 2026-10-25 with the same notes (Kemira now with a job title) on a production build, after the round-5 changes (why lead, pilot framing, hours in code), and moved to main with `scripts/pages-transfer.ts`:

| Company | Name → brief | Note saved | Night path | Page | Reader test (as COO) |
|---|---|---|---|---|---|
| Kemira Oyj | 5.7 s (PRH 1.4 + scout 4.2) | 2.4 s | 14.1 s (research 3.7, script 4.7, reader test 4.3) | `/p/p_7Rrc_JGH` | 4/6/3 (round 4: 4/6/2) |
| Teleste Oyj | 7.2 s (1.4 + 5.8), **not thin**: 2 cited TED awards after the prefix retry | 2.4 s | 0.06 s, offline template (model-down fallback, no key in that process) | `/p/p_MicoMWeT` | not run (no model) |
| Valmet Oyj (old draft, re-run) | stored | stored | 20.3 s (research 11.8 incl. the size fact from valmet.com, script 4.8, reader test 3.3) | `/p/p_AhbpxCx8` | 5/6/3 (old draft 6/7/4) |

The Teleste template now reads the hours out of the note ("“half a day a week” = 4 h a week each (read as each person), 8 h for the 2 of them"), so its card is an "estimate" cited to the note, not a sector guess. 2 PRH requests and 10 model runs.

**Round 6 live check: "Fazer"** (the judge's failing case), production build on 2026-10-25. Name → candidates 1.6 s: Oy Karl Fazer Ab (the group's head office) is now first and auto-picked, the concert agency is out of the top 5. The first scout run exposed a stem bug (it guessed www.karl.com, Karl Lagerfeld, and found Karl Storz tenders); fixed, the re-run brief took 4.6 s (PRH + TED + site + model), so name → brief ≈ 6.2 s. It now says what Fazer does from fazer.com ("chocolates, sweets, gifts, recipes and seasonal ideas, with an online shop"), names the Latvian award as Fazer Latvija SIA's ("a subsidiary"), asks openers about Fazer's own work, says "Don't treat the Latvian tenders as this company's wins", and is marked **thin** (one own signal). The night path on a demo note with a teams answer took 14.1 s; that page was built on the bad store and is withdrawn, kept for the record.

**Steps on stage** (laptop on `/hq`, phone on `/capture`):

1. The judge names a company. Type it on `/capture` and press Go. Brief in 5-9 s.
2. Read one signal aloud and tap its chip.
3. Ask the judge for one real annoyance at their company and record it in their words ("their order team retypes … every morning, two of us, two hours each"), fill the job title, ask "how many teams like that across the company?" and type the number, Save lead (2 s). Tap "make the page on /hq".
4. On `/hq`, Run (For the COO). The board shows research, script and reader test; the page is ready in about 16-20 s.
5. Open `/p`: the headline (scaled by their teams answer), the quote, the one question tied to the cited signal, Reply yes. Then open "The working": why it matters, the pilot, the calculator, the sources, the audio.

**Fallbacks:**

- PRH slow or rate-limited: companies already looked up come from the DB; otherwise type the Y-tunnus. Keep at most one lookup every 20 s; a 429 is retried once.
- Brief comes back thin (no TED, no site): say so, it is the honest output; the night path still works from the note.
- Model slow or down: the brief falls back to evidence-only, and the night path builds the template page (as with Teleste above). It is labelled "sector estimate" and gets no reader test.
- Night path fails: /hq says why and keeps no half page; run it again or open a page made in rehearsal.

If the venue network is slow:

- PRH and TED calls time out after 8 s.
- Model calls on the live path time out after 12-15 s, with one retry. The page then shows a brief built from the evidence, labelled "evidence-only".
- Companies already looked up are served from the local DB when PRH can't be reached.
- PRH rate-limits bursts (HTTP 429), so lookups are cached for 10 minutes and a 429 is retried once.

## Matrix OS deploy

The night path needs a machine that stays on. `matrix/` packages the app for a [Matrix OS](https://github.com/HamedMP/matrix-os) box:

- `matrix/box-loop.mjs` runs `scripts/night.ts` at 22:00 Helsinki time and posts a 07:30 digest to **our own** Telegram test chat through a Matrix one-shot cron job.
- `matrix/agent-ops/` is a shared live board of runs and approvals for Velho and Ring.

```bash
matrix/deploy.sh                          # dry run: prints the full plan, sends nothing
matrix/deploy.sh --apply --secrets=FILE   # FILE: ANTHROPIC_API_KEY, MATRIX_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_CHAT_IDS
node matrix/box-loop.mjs --check          # self-test (clock, DST switch, allow-list)
node matrix/box-loop.mjs --digest         # print this morning's digest from the local DB
node matrix/agent-ops/feed.mjs --check
```

- Details and the facts verified from the Matrix source are in [`matrix/README.md`](matrix/README.md) and `../MATRIX.md`.
- **Not yet run against a real Matrix account.** The assumptions to check on a box are listed as A1-A10 in MATRIX.md, for example Node 24 being present and the Next app being served under `/apps/<slug>/`.
- For the demo, view the app with `matrix port forward 3100`.

## Known limits

- **Reply scores stay at 3-4 out of 10.** Round 6 (short page, signal-anchored ask, teams scaling) re-ran Kemira 4/6/3 → 5/6/3 and Valmet 5/6/3 → 5/6/3; neither note says how many teams do the task, so neither page is scaled, and both readers still ask for exactly that ("show what it means across all order desks"). The teams question on /capture is the answer to that, and it only works when someone asks it in the hallway. Re-scored as they stand today, Ponsse 5/6/4 → 6/6/4 and Mipro 5/6/3 → 6/6/4. Round 5 led the page with the company-level reason, framed the euro figure as "the pilot", and marked every uncited link as an assumption. Kemira moved 4/6/2 → 4/6/3, Valmet's re-run scored 5/6/3, and a measurement re-score with the hours computed in code moved Mipro 5/6/3 → 5/6/4 and kept Ponsse at 5/6/4. The math complaints are gone ("7.5 h × 2 is not 3 h a day"; "a full day conflicts with 2 h a week"), but the readers now call the marked assumption "unproven" and ask to lead with the quote, and still find a team-sized pilot small next to the company. We did not tune the reader test to say otherwise.
- The skeptic gate scores real pages stop 5-6, read 6-7, reply 4-5 out of 10 as a CEO. Since it reads as the executive the page is for and judges at the company's real size, the Ponsse page scores 5/6/4: its stated reason is that €18 600 is small for Ponsse. We keep the pilot figure honest rather than scale it to a headcount nobody said does the task; the page says the estimate covers the formula's team only and shows the size fact next to it. Pages under the bar still go to approval, marked "below bar" on /hq, with the skeptic's one-line reason for its reply score. The cited "why it matters" line did not lift it: on the cold run Kemira scored 4/6/2 ("€37k is trivial for a 4,900-person company") and Mipro 5/6/3 (the euro figure too small; frame it around the new contract's reporting load).
- The name scrub is regex plus a model-provided name list. Finnish consonant-gradation forms (Pekka → Pekan) depend on the model listing the name.
- The site guard checks hostnames only, with no DNS resolution.
- The optional Telegram bot is not built. `npm run bot` only prints a message and exits.
- Mobile layout was checked at a real 390 px viewport in headless Chromium, not on a physical phone. Speech playback and recognition depend on the browser (Chrome or Safari).
