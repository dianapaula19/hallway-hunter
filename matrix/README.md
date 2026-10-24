## Running Hallway Hunter on Matrix OS

The night path needs a machine that stays on. On a [Matrix OS](https://github.com/HamedMP/matrix-os) box it runs at 22:00, and a digest reaches our own Telegram test chat at 07:30.

| piece | file | what it does |
|---|---|---|
| App manifest | `matrix/matrix.json` | Puts Hallway Hunter in the Matrix launcher (`~/apps/hallway-hunter/`, node runtime) |
| Cron entries | `matrix/cron.json` | Matrix cron notices at 22:00 and 07:30 Helsinki time, sent to our own Telegram chat |
| Box loop | `matrix/box-loop.mjs` | 22:00: `scripts/night.ts`. 07:30: posts a digest of overnight runs, pages waiting for approval and outbox drafts through Matrix |
| Agent Ops | `matrix/agent-ops/` | A shared Matrix app that shows Ring's and Velho's runs and approvals live (see below) |
| Deploy | `matrix/deploy.sh` | Packs the repo (no DB, no uploads, no env), uploads it to `~/projects/hallway-hunter`, seeds synthetic data on first run, builds, and registers the apps and cron. **Dry run unless `--apply`** |

```bash
matrix/deploy.sh                          # see the plan; nothing is sent
matrix/deploy.sh --apply --secrets=FILE   # FILE: ANTHROPIC_API_KEY, MATRIX_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_CHAT_IDS
node matrix/box-loop.mjs --digest         # print this morning's digest from the local DB
node matrix/box-loop.mjs --check          # self-test
```

**Nothing is sent to any company.** The digest goes only to `TELEGRAM_CHAT_ID`, and only if that id is also in `TELEGRAM_ALLOWED_CHAT_IDS`. Matrix delivers it as a one-shot cron job. Approve, edit and kill still happen in `/hq`, and approving creates only a local draft to our own inbox.

### Agent Ops: one board for both agents

`matrix/agent-ops/` is a static Matrix app. Its `matrix.json` declares two Matrix Postgres tables, `runs` and `approvals`. `index.html` reads them through `window.MatrixOS.db` and redraws on `db.onChange`. `feed.mjs` runs on the box every 10 s. It reads Velho's `agent_runs`/`approvals` (through `lib/db.ts`) and Ring's `ring_runs`/`ring_proposals` (Postgres), and upserts the rows by `src_key` through the gateway's `/api/bridge/query`. The board is read only.

To have Matrix's Builder generate the board on stage instead, give it this prompt. Our `index.html` is the fallback.

> Build an app called Agent Ops (slug `agent-ops`) with two tables. `runs`: src_key, product, agent, subject, status, error, clock, started_at, ended_at, all text. `approvals`: src_key, product, kind, subject, summary, status, trust_mode, clock, created_at, decided_at, all text. Show "Waiting for a person" (approvals with status PENDING, PENDING_REVIEW or APPROVED_AWAITING_EXECUTION) above "Recent agent runs" (the latest 30). Add a filter for product (bahn / velho). Make it read only, live via db.onChange, and give it empty and loading states. Mark times with clock = sim as "(sim)".
