#!/usr/bin/env bash
set -euo pipefail

DIST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${SHOREPAY_APP_DIR:-${DIST_DIR}/../shorepay_project/shorepay}"
APP_DIR="$(cd "$APP_DIR" && pwd)"

if [ "$(git -C "$APP_DIR" branch --show-current)" != main_v2 ]; then
  echo 'ShorePay source must be on main_v2.' >&2
  exit 1
fi
if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
  echo 'ShorePay source must be clean before building a release.' >&2
  exit 1
fi
if [ "$(git -C "$APP_DIR" rev-parse HEAD)" != "$(git -C "$APP_DIR" rev-parse --verify refs/remotes/origin/main_v2 2>/dev/null || true)" ]; then
  echo 'main_v2 must match origin/main_v2 before building a release.' >&2
  exit 1
fi

MARKER="$(mktemp)"
trap 'rm -f "$MARKER"' EXIT

(
  cd "$APP_DIR"
  ./scripts/build_release.sh apk --skip-reseed
  ./scripts/build_release.sh ipa --skip-reseed
)

APK="$APP_DIR/build/app/outputs/flutter-apk/app-release.apk"
IPA="$(find "$APP_DIR/build/ios/ipa" -maxdepth 1 -name '*.ipa' -newer "$MARKER" -print | sort | awk 'NR==1')"
if [ ! -f "$APK" ] || [ ! "$APK" -nt "$MARKER" ] || [ -z "$IPA" ]; then
  echo 'A new APK and IPA were not both produced; nothing was published.' >&2
  exit 1
fi
node "$DIST_DIR/scripts/publish-local.mjs" --apk "$APK" --ipa "$IPA"
