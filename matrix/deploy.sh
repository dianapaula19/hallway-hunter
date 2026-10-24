#!/usr/bin/env bash
# Deploy Hallway Hunter (Velho) to your Matrix OS computer. This is the procedure that ran on 24 Oct 2026.
# DRY RUN BY DEFAULT: prints every remote step. Add --apply to do it (uses the logged-in `matrix` CLI).
#
#   matrix/deploy.sh            # dry run
#   matrix/deploy.sh --apply    # deploy committed HEAD; secrets come from ../.env and .env
#
# What it does on the box:
#   1. git archive HEAD -> ~/projects/hallway-hunter
#   2. .env.local (Anthropic key, PostHog, NEXT_BASE_PATH) uploaded with --secret; never printed
#   3. npm ci + build with basePath /apps/hallway-hunter (detached; log in ~/projects/hh-setup.log)
#   4. ~/apps/hallway-hunter/matrix.json -> Matrix starts matrix/prefix-proxy.mjs, which re-adds the
#      /apps/hallway-hunter prefix the gateway strips, in front of `next start`. Open it from the Matrix desktop.
#   5. Velho's background agent loop, supervised (log in ~/projects/velho-loop.log)
# data/hh.db (node:sqlite) is not deployed; upload one with `matrix upload --force data/hh.db projects/hallway-hunter/data/hh.db`.
# Note: `matrix run` needs `-C .` (CLI 0.3.22 sends an empty cwd otherwise and the gateway answers 400).
set -euo pipefail
APPLY=0; [[ ${1:-} == --apply ]] && APPLY=1
REPO=$(cd "$(dirname "$0")/.." && pwd)
HACK=$(dirname "$REPO")
run() { if ((APPLY)); then "$@"; else printf '[dry-run]'; printf ' %q' "$@"; echo; fi; }
box() { run matrix run -C . -- sh -c "$1"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$REPO" archive --prefix=hallway-hunter/ -o "$TMP/hh.tgz" HEAD
echo "packed HEAD: $(du -h "$TMP/hh.tgz" | cut -f1)"

( umask 077
  { grep -E '^ANTHROPIC_(API_KEY|MODEL)=' "$HACK/.env" || true
    grep -E '^NEXT_PUBLIC_POSTHOG_' "$REPO/.env" 2>/dev/null || true
    echo NEXT_BASE_PATH=/apps/hallway-hunter; } > "$TMP/env.local" )
echo "secrets file keys: $(cut -d= -f1 "$TMP/env.local" | tr '\n' ' ')"

run matrix upload --force "$TMP/hh.tgz" projects/hh.tgz
box 'cd projects && mkdir -p hh-keep && { cp hallway-hunter/data/hh.db hh-keep/ 2>/dev/null || true; } && rm -rf hallway-hunter && tar xzf hh.tgz && rm hh.tgz && mkdir -p hallway-hunter/data && { mv hh-keep/hh.db hallway-hunter/data/ 2>/dev/null || true; } && rmdir hh-keep'
run matrix upload --force --secret "$TMP/env.local" projects/hallway-hunter/.env.local

box 'cd projects/hallway-hunter && setsid nohup sh -c "set -e; set -a; . ./.env.local; set +a; npm ci --no-audit --no-fund; npm run build; echo SETUP_DONE" > ../hh-setup.log 2>&1 < /dev/null &'
echo "wait for SETUP_DONE:  matrix run -C . -- tail -3 projects/hh-setup.log"

run matrix upload --force "$REPO/matrix/matrix.json" apps/hallway-hunter/matrix.json

# 5. Velho's background agent: 22:00 Helsinki night path for the day's leads, 07:30 digest (printed to the
#    log; Telegram only with MATRIX_TOKEN + an allow-listed chat). Supervised; `velho-loop` marks it.
#    Log: ~/projects/velho-loop.log
box 'pkill -f "[v]elho-loop"; true'  # separate call: the start command below names the loop, so pkill would match its own shell
box 'cd projects/hallway-hunter && setsid nohup sh -c "while true; do node --env-file-if-exists=.env.local matrix/box-loop.mjs; sleep 30; done" velho-loop >> ../velho-loop.log 2>&1 < /dev/null &'
((APPLY)) || echo "(dry run: nothing was sent. Re-run with --apply.)"
