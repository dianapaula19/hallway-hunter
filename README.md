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

Password (optional, off by default): start with `HQ_PASSWORD=<something> npm start` (or `npm run dev`) and `proxy.ts` asks for HTTP basic auth (any username, that password) on everything except the `/p/<slug>` pages, which clients open from a link, and `/api/health`. That covers `/`, `/hq`, `/capture` and every other `/api` route, including the one that spends model credits. Leave it unset locally. A `/p` link is protected only by its unguessable slug.

Night path from cron: `npm run night` builds a page for every lead from the last 24 h that has none yet.

Checks: `npm run typecheck && npm run check && npm run build`, plus self-checks with no network:

```bash
node lib/live/selfcheck.ts            # PRH/TED parsers, ranking, did-you-mean, site guard, name scrub, 120-word fit
node lib/live/selfcheck.ts --live     # + read-only PRH/TED lookups on real companies (contacts nobody)
node lib/night/sanitize.ts            # citation sanitizer
node lib/night/compliance.ts          # name heuristic
```

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
4. **Voice note.** Record a short note in Finnish or English, edit the transcript and save. The lead shows a role, a quote, the pain point and a temperature, with no name. Show the delete button.
5. **`/hq` → Run night path now** on that lead. The board fills live: researcher, showrunner, skeptic CEO (up to 2 rewrites), then compliance. It takes about 30-40 s with a key.
6. **Open `/p/<slug>`.**
   - The page opens with the hallway quote, attributed by role only, then usually one card: we only show a card a source backs.
   - Below it, "One question": a single yes/no offer (a free one-page teardown of that process, no data, no call).
   - Press play: two browser voices read the script, the transcript opens and highlights each line.
   - Edit "people" on a card and the euro estimate recalculates.
   - Every figure says "estimate" or "sector estimate".
7. **Back in `/hq`:**
   - Show the Skeptic-CEO scores. They are honest and often below the bar, and then /hq marks the card "below bar" (internal only, not in the draft subject).
   - Approve to create a **local draft to our own inbox**, or Kill (a note is required).
   - Nothing is ever sent.

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

- The Skeptic-CEO gate scores real pages stop 5-6, read 6-7, reply 4-5 out of 10. Cutting the guessed cards lifted read to 7. Reply stayed at 4-5 through six different asks (meeting, teardown, sample, mock-up), so we treat it as the ceiling for an unsolicited page and do not pad. Such pages go to approval marked "below bar" on /hq.
- The name scrub is regex plus a model-provided name list. Finnish consonant-gradation forms (Pekka → Pekan) depend on the model listing the name.
- The site guard checks hostnames only, with no DNS resolution.
- The optional Telegram bot is not built. `npm run bot` only prints a message and exits.
- Mobile layout was checked at a real 390 px viewport in headless Chromium, not on a physical phone. Speech playback and recognition depend on the browser (Chrome or Safari).
