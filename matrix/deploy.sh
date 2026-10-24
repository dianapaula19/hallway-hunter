#!/usr/bin/env bash
# Sync hallway-hunter to a Matrix OS box, register the app, its cron entries and the shared Agent Ops app.
# DRY-RUN BY DEFAULT: prints every remote command. Nothing touches a Matrix account without --apply.
#
#   matrix/deploy.sh                          # dry run (packs locally, prints the plan)
#   matrix/deploy.sh --apply                  # do it, against the active `matrix` CLI profile
#   matrix/deploy.sh --apply --profile=cloud  # pick a CLI profile
#   matrix/deploy.sh --apply --secrets=FILE   # also upload FILE as ~/projects/.env (matrix upload --secret)
#
# FILE holds ANTHROPIC_API_KEY, MATRIX_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_ALLOWED_CHAT_IDS. Never printed or packed.
# Needs on the box (UNVERIFIED, preflight reports): node >= 24 (node:sqlite + .ts scripts), npm.
set -euo pipefail

NAME=hallway-hunter
SLUG=hallway-hunter
APPLY=0 PROFILE=() SECRETS=""
for a in "$@"; do
  case $a in
    --apply) APPLY=1 ;;
    --profile=*) PROFILE=(--profile "${a#*=}") ;;
    --secrets=*) SECRETS=${a#*=} ;;
    *) sed -n '2,11p' "$0"; exit 2 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(dirname "$HERE")
run() { if ((APPLY)); then "$@"; else printf '[dry-run]'; printf ' %q' "$@"; echo; fi; }
mx() { run matrix "$1" "${PROFILE[@]}" "${@:2}"; }

if ! command -v matrix >/dev/null; then
  ((APPLY)) && { echo "matrix CLI not found: npm i -g @finnaai/matrix, then matrix login" >&2; exit 1; }
  echo "note: matrix CLI not installed; dry run continues"
fi

# 1. Pack the repo locally. No node_modules, builds, databases or env files.
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
TGZ=$TMP/$NAME.tgz
tar -C "$(dirname "$REPO")" -czf "$TGZ" \
  --exclude=node_modules --exclude=.next --exclude='.env' --exclude='.env.*' \
  --exclude='*.db' --exclude='*.db-*' --exclude='*/data/uploads' --exclude='*.tsbuildinfo' --exclude=.git "$(basename "$REPO")"
if tar -tzf "$TGZ" | grep -Eq '(^|/)\.env($|\.)'; then echo "refusing: an env file got into the tarball" >&2; exit 1; fi
echo "packed $(tar -tzf "$TGZ" | wc -l) files, $(du -h "$TGZ" | cut -f1)"

# 2. Preflight on the box (read-only).
mx run -- sh -c 'node -v; npm -v'

# 3. Upload, unpack, install, seed synthetic data only if there is no DB yet, build.
mx upload --force "$TGZ" "projects/$NAME.tgz"
[[ -n $SECRETS ]] && mx upload --force --secret "$SECRETS" "projects/.env"
mx run -- sh -c "cd projects && tar xzf $NAME.tgz && rm $NAME.tgz && cd $NAME && npm ci \
  && (test -f data/hh.db || npm run seed) && npm run build"

# 4. Register the app: drop matrix.json into ~/apps/<slug>/ (the gateway lists apps from ~/apps).
mx upload --force "$HERE/matrix.json" "apps/$SLUG/matrix.json"

# 4b. Shared Agent Ops app (static, Postgres tables declared in its manifest).
mx upload --force "$HERE/agent-ops/matrix.json" "apps/agent-ops/matrix.json"
mx upload --force "$HERE/agent-ops/index.html" "apps/agent-ops/index.html"

# 5. Register cron entries through the gateway (POST /api/cron), deduped by name.
mx run -C "projects/$NAME" -- node --env-file-if-exists=../.env matrix/box-loop.mjs --register matrix/cron.json

# 6. Long-running processes need a TTY, so they are started by hand (detach: Ctrl-\ Ctrl-\).
cat <<EOF

Start these on the box (each in its own detached terminal tab):
  matrix run -it ${PROFILE[*]} -C projects/$NAME -- node --env-file-if-exists=../.env node_modules/next/dist/bin/next start -p 3100
  matrix run -it ${PROFILE[*]} -C projects/$NAME -- node --env-file-if-exists=../.env matrix/box-loop.mjs
  matrix run -it ${PROFILE[*]} -C projects/$NAME -- node --env-file-if-exists=../.env matrix/agent-ops/feed.mjs
View /hq from this laptop:
  matrix port forward ${PROFILE[*]} 3100
EOF
((APPLY)) || echo "(dry run: nothing was sent. Re-run with --apply.)"
