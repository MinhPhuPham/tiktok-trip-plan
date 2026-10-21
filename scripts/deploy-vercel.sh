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
# script stops if the server key (GOOGLE_MAPS_KEY) appears in any of them.

set -euo pipefail

VERCEL_VERSION="62.5.0"
PROJECT="${VERCEL_PROJECT:-tiktok-trip-map}"
PROD=1
EXPORT=1
DRY_RUN=0

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
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
  [ -d web/node_modules ] || npm --prefix web ci
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
echo "Size: $(du -sh "$APP_DIR" | cut -f1)  Files: $(find "$APP_DIR" -type f -not -path '*/.vercel/*' | wc -l | tr -d ' ')"

if [ "$DRY_RUN" -eq 1 ]; then
  step "Dry run: skipped link and upload"
  exit 0
fi

if [ ! -f "$APP_DIR/.vercel/project.json" ]; then
  step "Link $APP_DIR to Vercel project \"$PROJECT\""
  "${VERCEL[@]}" link --cwd "$APP_DIR" --project "$PROJECT" --yes
fi

target="production"
[ "$PROD" -eq 1 ] || target="preview"
step "Deploy ($target)"
args=(deploy --cwd "$APP_DIR" --yes)
[ "$PROD" -eq 1 ] && args+=(--prod)
url="$("${VERCEL[@]}" "${args[@]}" | tail -n 1)"

step "Done"
echo "$url"
echo "Open it on your phone once while online, then add it to the home screen."
