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
- **~17:30 polish pass (integrator).**
  - Asked: stop forcing three cards, make the reply hook concrete, re-run the night path live on 2 synthetic leads, re-check compliance on model output, make `/p` something a Finnish CEO would read and forward, stub the bot, document a data reset.
  - Changed:
    - **1-3 cards, evidence only.** The researcher may return one card. A public signal becomes a card only if the source itself names a recurring manual task. A product sale or a site blurb is not enough. Compliance no longer flags fewer than 3 cards, only 0. Offline mode no longer pads with "signal worth a closer look" cards.
    - **One ask.** The script ends with one yes/no question tied to card 1: a free one-page teardown of the named process within a week, no data and no call. The page shows it under the card as "One question".
    - **Two bugs found by the live runs.** (1) The ask was said twice: the model's ask ended in "enough." rather than "?", so our fallback was appended. Now we check for any "?". (2) The researcher put a team total in `hours_per_week` (15 h for two people, which doubled the euro figure). The prompt now says per person, and the page and skeptic label it "hours / week each".
    - **Compliance.** "Three hours a day between us" was flagged as confidential, which would have hidden the quote; only secrecy phrasings count now. "The euro figure is the smaller part" was flagged as an unlabelled amount; only € or plural "euros" count now. Self-check asserts added for both.
    - **`/p` page.** Order is now quote, card, the one question, then audio. Serif reading face. The transcript folds away and opens on play, so lines still highlight as spoken. The "(thin data)" heading over a deliberate single card and the hard-coded "about 75 seconds" are gone. The footer no longer lists source types the page doesn't use.
    - `scripts/telegram-bot.ts` is a no-op that prints a message. README explains how to reset `data/hh.db`, either completely or keeping looked-up companies.
  - Checked:
    - Night path live (`claude-sonnet-5-5`) on two synthetic voice notes (fictional people) at Valmet and Ponsse. We reused the stored PRH rows, so there were no PRH calls. Seven rounds of prompt changes, 23-37 s per run.
    - Skeptic min(stop, read, reply) per round, final run: **Ponsse 5/6/4 → 6/7/4 → 6/7/5. Valmet 5/6/4 → 6/7/4 → 6/7/4.** Read reached 7 once the guessed cards were gone. **Reply never passed 5, so the target of 7 is not met.** Re-scored with the original "would you reply to book 20 minutes?" wording, the final pages get reply 4 (Ponsse) and 5 (Valmet).
    - Compliance re-run on stored model pages: the old Konecranes page that was blocked on "Luka Koper's RTG" now passes, so the possessive fix holds on real output. Both new pages pass.
    - `/p`, `/capture` and `/hq` screenshotted at a real 1440 and 390 px viewport (DevTools device metrics, because the headless window can't go below 500 px), light and dark, with no horizontal overflow. typecheck, check, build, all self-checks, and the offline night path on a throwaway seeded DB pass.
  - Threw away:
    - Three other asks, each scored for reply: "book 20 minutes" (3-4), "reply with one anonymised sample" (4; "sending a dealer PDF to an unknown vendor feels risky"), and "a clickable mock-up" (4; "built from what your manager described is creepy"). The skeptic's notes on the ask contradicted each other from round to round, so we stopped chasing it and kept the teardown.
    - The rule that the script cites 2 public sources. It produced "We checked this against the trade register and your website" and "Valmet is a global technology leader…" lines, which the skeptic called filler or surveillance every time. Public sources are now cited only where they add a fact.
    - Changing the skeptic's persona or bar. We changed only what described the old product ("exactly 3 cards", "book 20 minutes") and the per-person hours label.
  - Not checked: speech playback on a real phone. Stop is 5-6: a cold page labelled as AI is opened warily, and the house rules keep that label.
- **~18:00 judge pass.** Clicked through `/`, `/capture` (live: "Tokmanni" → PRH → scout brief with 2 TED signals in 6.6 s, one model call), `/hq` and both `/p` pages at 1440 and 390 px. The five things a judge sees in 30 s:
  1. `/` was a two-link dev index: no pitch and no route to an output. **Fixed:** a three-sentence pitch, "Try it on any Finnish company", and the newest non-killed draft per company.
  2. `/p` cited only the hallway note, although PRH, site and TED rows sat in the store, so "every statement links to its source" showed one source, the quote itself. The skeptic also asked whether "Valmet Oyj" was the right entity. **Fixed:** the byline carries the Y-tunnus, cited to the PRH trade-register row.
  3. "One question" was a 60-90 word paragraph. **Fixed:** the question sentence is shown large, and the terms after it are small print. The text itself is unchanged.
  4. `/hq` lists four superseded Konecranes drafts, one still marked blocked from before the compliance fix, and every title reads "below bar". **Not fixed:** that is data, not code. Kill them in `/hq` or reset the DB (README). We did not make approval decisions for the reviewer.
  5. The Valmet card's €5,800 rests on the researcher's guess of "one visit a week". **Not fixed:** it needs another live night run.
  - Checked: typecheck, check, build, and the live, sanitize and compliance self-checks. Screenshots after the fix show no horizontal overflow at 390 px.
  - Considered and skipped: a cited "what they do" line from the site excerpt under the title. It would read as the "Valmet is a global technology leader…" filler the skeptic marked down.
- **Matrix base path.** `next.config.ts` takes `basePath` from `NEXT_BASE_PATH` (empty by default) and inlines it as `NEXT_PUBLIC_BASE_PATH`. `lib/base.ts` `withBase()` wraps every raw client URL: 4 `fetch` calls in `/capture`, 3 `fetch` calls and 2 `<a href="/p/...">` in `/hq`. A grep found no other client-side absolute URLs: no `<img>`/`<audio>` src (audio is `speechSynthesis`), no `EventSource`, no `window.location`, no CSS `url()`. `<Link>` adds the prefix itself. The PostHog host is absolute. Agent Ops (`matrix/agent-ops`) has no asset or API URLs at all, only inline CSS/JS and `window.MatrixOS.db`, so nothing changed there.
  - Checked: typecheck, check, build, and the live, sanitize, compliance, box-loop and feed self-checks. With `next start` on :3100, a headless Chrome probe (playwright-core, `?synthetic=1`) loaded `/`, `/capture`, `/hq` and `/p/<slug>`. It ran once with `NEXT_BASE_PATH=/apps/hallway-hunter` (PostHog on, then off) and once without it. Every page returned 200 with no 4xx responses and no request outside the prefix. `/hq` polled `<base>/api/hq` 3 times in 4.5 s, all 200, and its page links carry the prefix. `/p` rendered its speech controls. curl shows `/apps/hallway-hunter/api/{health,hq,lead}` 200 and bare `/api/health` 404 under the prefix.
  - Found: `next start` re-reads `next.config.ts`, so the variable has to be set at start too. Matrix's gateway on `main` strips `/apps/<slug>` before proxying and health-checks the bare port. Its own Next template sets `basePath`, which contradicts that. So `deploy.sh` and `matrix.json` stay unprefixed until a box shows which one is right (see matrix/README).
  - Thrown away: `assetPrefix` plus relative URLs (A3 in MATRIX.md). It would fit the stripping gateway, but `<Link>` navigation would leave the app. Also a `basePath: false` rewrite to serve both, which Next allows only for external rewrites.
  - Slip: the first two probe runs had no `?synthetic=1` while PostHog keys were set, so a handful of untagged pageviews from localhost may be in PostHog.
- **Clumsy-user run (6 agent personas, 3 on Velho).** It found 21 issues across Bahn and Velho. The blocker (every model call 400 on the PostHog fields) was fixed in the commit before this one.
  - Fixed for Velho:
    - `/hq`, `/capture`, `/` and every `/api` route except `/api/health` can now sit behind optional basic auth (`HQ_PASSWORD`, through a Next 16 `proxy.ts`). It is off by default. `/p` pages stay open. `/hq` no longer scrolls sideways on a phone: a raw error string in the runs list didn't wrap.
    - Formula inputs on `/p` keep what you type. Only a valid number updates the estimate, and the result is clamped to the same caps the server uses (one `clampInput` in `lib/night/formula.ts`). Inputs no longer show "05" or "040", and partial input no longer gives €0.
    - Edit, then Cancel, now discards the edit. The night-path selectors are locked during a run.
    - The synthetic tag is kept in localStorage for 12 h, so `/p` tabs opened from `/hq` are tagged too.
    - The `/p` header no longer says "awaiting human review". The "[below bar]" label is out of the draft subject: `/hq` shows it as an internal badge computed from the stored skeptic rounds. The 6 pending subjects in the local DB were cleaned once.
    - A failed upload keeps the current brief and says "No connection to the server" in plain words. A blank Go gets a hint. Leaving `/capture` aborts the request in flight.
    - Mic errors and lead-save errors appear in plain words in the voice card and clear after a save. The card heading names the company.
    - If lead extraction fails, nothing is saved: the user is told and keeps the text to retry. (Running with no key still saves the regex-scrubbed note on purpose.)
    - The player falls back to the transcript when the speech engine has no voices or errors. Headless Chrome reports 19 voices and still fails, and now it shows "Audio is not available".
    - Unknown URLs get a friendly 404. A killed `/p` page now says "This draft has been withdrawn". There is an `app/icon.svg` favicon.
    - The PRH chip links to the human YTJ page (`tietopalvelu.ytj.fi/yritys/<Y-tunnus>`) instead of the JSON API, and the 11 stored PRH rows were rewritten.
  - Checked: typecheck, check (with new `clampInput` asserts), build, and the live, sanitize and compliance self-checks.
    - Headless Chrome at 1440 and 390 px: no overflow on `/hq`, `/p`, `/capture`, the withdrawn page or the 404. Typing "2.5" gives 2.5, "-40" blurs to 0, "99999999999" people blurs to 10000, and "12e" keeps the last value.
    - Edit, type, Cancel, Edit shows the original subject.
    - `/capture` with a mocked network: a failed second lookup keeps the brief, and a failed lead save keeps the text.
    - `next start` on a spare port with `HQ_PASSWORD` set: 401 without the password or with a wrong one, 200 with the right one. `/p`, its JS, `/api/health` and the icon return 200 with no auth.
  - Left:
    - "Back then Forward loses capture state": it needs state in the URL or storage, and that is too much for a demo page.
    - "Did you mean" for "Wartsila" lists Valo Corp Oy. That is a ranking heuristic, and changing it needs live PRH runs.
    - Citation chips are 18 px on phones. That is a design pass.
    - `/P/<slug>` (capital P) is a 404, now the friendly one, rather than a redirect.
    - The server keeps running a scout after the client aborts, because `runAgent` takes no signal. That is a shared-kernel change.
    - Bahn items, which are another lane.
- **Clumsy-user re-run (3 Velho personas, after the fixes).** The first run's PostHog numbers were empty for two reasons, both in the test harness, not the app. posthog-js sends no captures when `navigator.webdriver` is true, and none when the user agent says "HeadlessChrome" (its bot filter). The scripts now hide both, and every persona's event batches reach PostHog: fair-floor 38 POSTs to `/e/`, lost-visitor 40, skeptic-partner 54, all 200. Session recording sent 0 POSTs because it is switched off in the PostHog project (`sessionRecording: false` in the remote config). Turn it on there if replays are wanted.
  - Budget: 4 PRH lookups (1 badge photo, 3 typed), spaced 16 s apart across processes. 4 model-backed actions: badge vision, the scout it auto-ran, one lead, one night run. The analytics re-run blocked every PRH- and model-backed POST in the browser. The test lead was deleted (a second delete returns 404). The test night page `p_v7TGcPIY` was killed.
  - Found:
    - A double click on "Kill page" (also Approve and "Save as edited") POSTed the decision twice. The second POST got a 409 and logged a console error.
  - Fixed: the approval card disables its decision buttons while the request is in flight, and a lost connection shows a message instead of an unhandled rejection. With a mocked approvals endpoint, a double click now sends 1 POST.
  - Left:
    - "Cancel keeps the half-finished edit" came back from the script, but it is a false positive: the original subject already ends in "Velho draft", which matches the script's `/draft$/` check.
    - A chip tapped 6 px to its right on a phone opens anyway, because Chrome adjusts touch targets. A second tap then closes it. This is the 18 px chip size already on the left list.

- **Design pass on `/` and `/capture` (branch design-pass).**
  - Asked: make the landing page and the capture screen match `/p` (serif headlines, calm palette, small-caps labels, chips), phone-first for the trade-fair demo, with no new dependency and no behaviour change on `/capture`.
  - Changed:
    - The `/p` palette is now a shared `.paper` class in `globals.css` (light and dark), used by `/` and `/capture`. `/p` and `/hq` are untouched.
    - `/`: serif headline and a one-sentence promise, the CTA "Try it on any Finnish company", a 3-step flow (badge, cited brief in ~10 s, overnight page + audio approved by a person) with inline SVG icons, "Latest drafts" as cards (company, status in plain words, Helsinki time, "synthetic demo" tag), and a footer with the honesty notes and the `/hq` link. Same query, plus `created_at`.
    - `/capture`: a "Who are you talking to?" title, a 76 px "Snap badge or card" button, "or type it", then the field. An empty state explains the four steps, including that the photo is used for one lookup and not stored (true: `/api/capture` keeps it in memory, and `runAgent` strips base64 from the step log). It also shows a spinner with elapsed seconds, a skeleton while researching, plain error boxes, and the brief, voice note and leads in the `/p` card and chip style. On desktop the input column is sticky on the left and results sit on the right. The "Velho draft" pill is gone from the internal header ("Internal · for Velho consultants"); the brief says "by Velho's AI analysts".
    - All handlers, state, API calls and `withBase` uses are byte-identical (diffed lines 1-156 against the previous version: only a `Link` import was added).
  - Checked: typecheck, check and build. Headless Chrome at 1440x900 and 390x844, light and dark: `/`, and `/capture` empty, loading (request held open) and network-error (request aborted). No horizontal overflow, and no tap target under 44 px (citation chips get a 44 px hit area through `::after`).
  - Threw away: a fake brief to screenshot the result state (rule: no mocked data, and a real lookup calls PRH and the model), so the brief, voice and lead styling was only reviewed in code. A two-column hero with a sample brief, because it would have meant made-up content on the first page judges see.

- **Matrix gateway 30 s cap: night path is now start + poll.**
  - Asked: on Matrix OS the gateway aborts any proxied request after 30 s (504). `POST /api/night` held the request open for the whole night path (23-41 s), so "Run night path now" 504'd there. The work itself was not tied to the request (nothing passes `req.signal` down), so it usually finished server-side, but /hq showed a failure.
  - Changed: `startNightPath()` in `lib/night/pipeline.ts` inserts the page, opens a `night_path` run (subject = page id) and returns at once; `runNightPath()` (cron) just awaits its `done`. `POST /api/night` returns 202 `{page_id, slug}` and keeps the job alive with `after()`. A crash deletes the half-built page and ends the `night_path` run as `error` with the message, so there is no unhandled rejection. /hq watches that run in its existing 2 s poll: running, then "Done: … /p/<slug> is waiting for approval" or "Failed: … Reason: …". Budgets and gates are unchanged.
  - Checked the other routes against `agent_runs` history: capture (vision max 2.8 s), scout (max 7.1 s, p50 8.4 s client-side), lead (max 3.6 s), approvals (no model call). All stay well under 25 s, so they are left synchronous.
  - Checked: typecheck, check, build; one real night path on the synthetic Ponsse lead through /hq in headless Chrome. `POST /api/night` 202 in 59 ms, slowest `/api/hq` poll 105 ms; the path finished in 24.2 s and the test page was killed from /hq.

- **2026-10-24, UI feel pass, lane B: the /p page as a letter, and a real artefact on the landing page (branch ui-velho-b).**
  - Asked: the critique said /p, / and /hq feel like three apps with no Velho identity; the /p H1 "Made for <Company>" was a label, the card body repeated the pull quote, the calculator wrapped with × starting a row, decimal comma and dot were mixed, and there was no signature or way to say yes. The landing page was a template (eyebrow, 01/02/03 cards, an orphan card, a yellow "Waiting…" shown publicly).
  - Identity: **placeholder only, pending Velho's real brand.** "Velho" set in the page serif in the existing accent colour, used as a letterhead on /p and as the header on /. No logo drawn, nothing copied from Velho's own site. Swap it for the real mark when Velho supplies one.
  - /p: a paper sheet on a quiet desk, using the shared `.paper` tokens (so it picks up the web fonts from the other lane). Letterhead keeps both labels ("Velho draft · by Velho's AI analysts"). A stub line "Met in a conference hallway, <date>" comes from `leads.created_at`; we store no event name, so none is shown. The H1 is the top card's value ("15 hours a week by hand. About €18 600 a year to win back.") with its estimate label right under it; "Made for <Company>" is the eyebrow. Card text drops sentences that mostly repeat the pull quote at render time (`withoutEcho` in `app/p/[slug]/letter.ts`, word-prefix overlap ≥ 60 %), so no model re-run and the claim keeps its source ids. The calculator is one CSS grid: five inputs in a row on desktop, two per row on a phone, × in its own column after a term so it never starts a row, the result on its own row below. One number style on the whole page: decimal comma and a narrow no-break space for thousands (inputs are text with `inputMode="decimal"` so the browser locale cannot switch it back; "7.5" and "7,5" both parse; script text is reformatted for display only, the voice reads the original). Signature "Velho consultant" (a role, no names). Audio moved to a "P.S. Prefer to listen?".
  - "Reply yes" is a `mailto:` link to `HH_OWN_INBOX`. Checked against CLAUDE.md rule 1: the app sends nothing and contacts no one; the link only opens the reader's own mail app, addressed to us, and they choose whether to press send. The note under the button says so.
  - /: the 01/02/03 cards are replaced by one before/after artefact built in markup: a mock badge (role and company from the newest approved or in-review page's lead, a grey bar where a name would be) → a small tilted copy of that page's real letterhead, headline and quote, linking to it. Latest drafts are a plain list (company, status, date). Public status words are "In review" / "Approved" / "Being written", with no coloured dots.
  - Checked: `node app/p/[slug]/letter.ts` self-check, typecheck, check, build. Headless Chrome at 1440x900 and 390x844, light and dark, no horizontal overflow; typed 10 and 7.5 into the calculator (€24 800, then back to €18 600, field reformatted to 7,5).
  - Left: the H1 figure is computed on the server at the page's own inputs, so it does not follow edits in the calculator below (the calculator's result does). The duplicate Konecranes drafts and /hq are the other lane's.

## Eval (before / after)

| Metric | Before | After | How measured |
|---|---|---|---|
| Photo to brief latency (p50) | n/a | **8.4 s** (7.7 / 7.9 / 8.4 / 8.6 / 9.5 s), target < 40 s | 5 synthetic badges (fictional people at Vaisala, Kone, Kesko, Valmet, Fiskars), timed client-side from capture to brief; all 5 had 2 cited signals and 94-117 words |
| Brief claims dropped by sanitizer | n/a | 0 of 44 (the first 11 scout runs × 4 claims) | `sanitize_*` info steps in `agent_steps` |
| Script lines dropped by sanitizer, per night run | 1-2 (the closing ask, every run) | 0 | same, on the Konecranes synthetic lead |
| Skeptic-CEO min(stop, read, reply), round 0 → final | 3 → 3 | 4 → 4 (stop/read 6) | 3 night runs before the fixes, 1 after, same lead |
| Skeptic-CEO stop / read / reply, final page (1-3 cards, one ask) | 6 / 6 / 4 (3 cards, Konecranes) | 6 / 7 / 4-5 (1 card; Valmet, Ponsse) | final live run on 2 synthetic leads, polish pass |
| Euro figure double-counted (team hours as per-person) | 1 of 2 pages | 0 of 2 | same runs |

## Cut list

- WhatsApp, HubSpot, weekly stay-top-of-mind cron, index, voice clones (from the briefing).
