#!/usr/bin/env bash
# Build the map app, export the trip and publish output/app to Vercel from this Mac.
#
#   scripts/deploy-vercel.sh                 production deploy
#   scripts/deploy-vercel.sh --preview       preview URL instead of production
#   scripts/deploy-vercel.sh --skip-export   publish output/app as it is
#   scripts/deploy-vercel.sh --dry-run       run every step and check except the upload
#   scripts/deploy-vercel.sh --project NAME  Vercel project for the first link (default tiktok-trip-map)
#
# Nothing from .env is sent: Vercel gets only the files in output/app, and the
# script stops if the server key (GOOGLE_MAPS_KEY) appears in any of them, if the
# upload passes 100 MB, or if the project is connected to Git; after a production
# deploy it checks the public URL serves exactly this export.

set -euo pipefail

VERCEL_VERSION="62.5.0"
PROJECT="${VERCEL_PROJECT:-tiktok-trip-map}"
PROD=1
EXPORT=1
DRY_RUN=0

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --preview) PROD=0 ;;
    --skip-export) EXPORT=0 ;;
    --dry-run) DRY_RUN=1 ;;
    --project) [ $# -ge 2 ] || fail "--project needs a name"; PROJECT="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "unknown option: $1" ;;
  esac
  shift
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APP_DIR="output/app"
DIST="src/tiktok_trip/export/web_dist/app/index.html"
VERCEL=(npx --yes "vercel@${VERCEL_VERSION}")
MAX_UPLOAD_MB=100
WARN_UPLOAD_MB=80

# project_field link|aliases ...: one line per field, from the Vercel API for the linked project.
project_field() {
  local link="$APP_DIR/.vercel/project.json" ids
  ids="$(uv run python -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["projectId"], d["orgId"])' "$link")"
  "${VERCEL[@]}" api "/v9/projects/${ids% *}?teamId=${ids#* }" 2>/dev/null | uv run python -c '
import json, sys
project = json.load(sys.stdin)
for field in sys.argv[1:]:
    if field == "link":
        link = project.get("link") or {}
        kind, repo = link.get("type", "git"), link.get("repo", "?")
        print(f"{kind}:{repo}" if link else "")
    elif field == "aliases":
        aliases = (project.get("targets") or {}).get("production", {}).get("alias") or []
        public = [a for a in aliases if not a.endswith("-projects.vercel.app")] or aliases
        print(f"https://{public[0]}" if public else "")
' "$@"
}

# smoke_test URL: the site answers and serves exactly the offline.json version just exported.
smoke_test() {
  local base="$1" want got attempt path
  want="$(uv run python -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$APP_DIR/offline.json")"
  for attempt in 1 2 3 4 5 6; do
    got="$(curl -fsS "$base/offline.json?check=$RANDOM" 2>/dev/null \
      | uv run python -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
    [ "$got" = "$want" ] && break
    sleep 5
  done
  [ "$got" = "$want" ] || { echo "offline.json version is '${got:-none}', expected $want"; return 1; }
  for path in "" trip.json sw.js manifest.webmanifest; do
    curl -fsS -o /dev/null "$base/$path" || { echo "GET /$path failed"; return 1; }
  done
  curl -fsSI "$base/sw.js" | grep -qi '^cache-control: no-cache' \
    || { echo "sw.js is cached: vercel.json headers missing"; return 1; }
  echo "Serving version $want: index, trip.json, sw.js and manifest OK"
}

for tool in npm npx uv; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

if [ "$DRY_RUN" -eq 0 ]; then
  step "Vercel account"
  if ! "${VERCEL[@]}" whoami >/dev/null 2>&1; then
    [ -t 0 ] || fail "not logged in to Vercel: run  npx vercel@${VERCEL_VERSION} login"
    "${VERCEL[@]}" login
  fi
  echo "Logged in as $("${VERCEL[@]}" whoami 2>/dev/null | tail -n 1)"
fi

if [ "$EXPORT" -eq 1 ]; then
  step "Web app"
  if [ ! -f web/node_modules/.package-lock.json ] \
    || [ web/package-lock.json -nt web/node_modules/.package-lock.json ]; then
    npm --prefix web ci
  fi
  changed=""
  if [ -f "$DIST" ]; then
    changed="$(find web -path web/node_modules -prune -o -path web/.dev-data -prune \
      -o -type f -newer "$DIST" -print -quit)"
  fi
  if [ ! -f "$DIST" ] || [ -n "$changed" ]; then
    npm --prefix web run build
  else
    echo "web/ unchanged since the last build"
  fi

  step "Export"
  uv run tiktok-trip export
fi

step "Checks"
for file in index.html trip.json offline.json sw.js manifest.webmanifest; do
  [ -f "$APP_DIR/$file" ] || fail "$APP_DIR/$file is missing: run without --skip-export"
done
if find "$APP_DIR" -name '.env*' -print -quit | grep -q .; then
  fail "a .env file is inside $APP_DIR: remove it before deploying"
fi
uv run python - "$APP_DIR" <<'PY'
import sys
from pathlib import Path

from tiktok_trip.config import Secrets
from tiktok_trip.export.secrets_guard import find_secret

root = Path(sys.argv[1])
key = Secrets.load(Path(".env")).google_maps_key
hits = find_secret(root, key) if key else []
if hits:
    names = ", ".join(str(path.relative_to(root)) for path in hits)
    sys.exit(f"GOOGLE_MAPS_KEY (server key) found in {names}. Not deploying.")
print("No server key in", root)
PY
if grep -q 'maps.googleapis.com' "$APP_DIR/trip.json"; then
  echo "Note: trip.json embeds GOOGLE_MAPS_BROWSER_KEY (export.google_map: true)."
  echo "      Make sure that key is restricted to your site's referrer in Google Cloud."
  if [ "$DRY_RUN" -eq 0 ] && [ -t 0 ]; then
    read -r -p "Deploy anyway? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || fail "cancelled"
  fi
fi
size_mb="$(du -sm "$APP_DIR" | cut -f1)"
echo "Size: ${size_mb} MB  Files: $(find "$APP_DIR" -type f -not -path '*/.vercel/*' | wc -l | tr -d ' ')"
[ "$size_mb" -lt "$MAX_UPLOAD_MB" ] || fail "$APP_DIR is ${size_mb} MB; Vercel CLI uploads are capped at 100 MB (lower export.max_frames_per_place)"
[ "$size_mb" -lt "$WARN_UPLOAD_MB" ] || echo "Warning: ${size_mb} MB is close to Vercel's 100 MB upload cap."

if [ "$DRY_RUN" -eq 1 ]; then
  step "Dry run: skipped link and upload"
  exit 0
fi

if [ ! -f "$APP_DIR/.vercel/project.json" ]; then
  step "Link $APP_DIR to Vercel project \"$PROJECT\""
  "${VERCEL[@]}" link --cwd "$APP_DIR" --project "$PROJECT" --yes
fi

step "Vercel project"
project_info="$(project_field link aliases)" || fail "could not read the Vercel project settings"
git_link="$(sed -n 1p <<<"$project_info")"
public_url="$(sed -n 2p <<<"$project_info")"
if [ -n "$git_link" ]; then
  fail "the Vercel project is connected to Git ($git_link). Every push would replace the site with an
       empty build (output/ is not in Git). Disconnect it: (cd $APP_DIR && npx vercel@${VERCEL_VERSION} git disconnect)"
fi
echo "No Git connection. Public URL: ${public_url:-unknown}"

target="production"
[ "$PROD" -eq 1 ] || target="preview"
step "Deploy ($target)"
args=(deploy --cwd "$APP_DIR" --yes --format json)
[ "$PROD" -eq 1 ] && args+=(--prod)
url="$("${VERCEL[@]}" "${args[@]}" | uv run python -c '
import json, sys
result = json.load(sys.stdin)
deployment = result.get("deployment", result)
url = deployment.get("url", "")
print(url if not url or url.startswith("https://") else f"https://{url}")
')" || fail "vercel deploy failed"
echo "Deployment: ${url:-unknown}"

if [ "$PROD" -eq 1 ] && [ -n "$public_url" ]; then
  step "Live check $public_url"
  smoke_test "$public_url" || fail "the live site does not serve this build. Roll back to the previous
       deployment with: (cd $APP_DIR && npx vercel@${VERCEL_VERSION} rollback)"
fi

step "Done"
echo "${public_url:-$url}"
echo "Open it on your phone once while online, then add it to the home screen."
