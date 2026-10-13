#!/usr/bin/env bash
# Renders the design mockup artboards to PNG (390x844) for the look comparison. Manual tool, not a gate.
# Usage: scripts/mockup-shots.sh [out-dir]   (default context/changes/app-look/evidence)
# Needs Google Chrome; the artboards load IBM Plex from Google Fonts, so run it online.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$repo/context/changes/app-look/evidence}"
chrome="${CHROME:-google-chrome}"
mkdir -p "$out"

for name in Connect Main Node Run Result Settings; do
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --virtual-time-budget=5000 --window-size=390,844 \
    --screenshot="$out/mockup-$(echo "$name" | tr '[:upper:]' '[:lower:]').png" \
    "file://$repo/docs/design/mockup/preview/$name.html" >/dev/null 2>&1
  echo "mockup-shots: $name"
done
