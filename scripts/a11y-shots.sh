#!/usr/bin/env bash
# NFR-05 audit: walks every screen on the emulator with the system font scale at 2.0 (200 %) and
# saves one screenshot per screen. Manual tool, not a gate.
# Usage: scripts/a11y-shots.sh [out-dir]   (default context/changes/pilot-release/evidence/font-200)
#   E2E_SKIP_BUILD=1     reuse the last built fake-transport APK
#   A11Y_RESTORE_SCALE   font scale to restore on exit instead of the one found (e.g. 1.0)
# Emulator only (scripts/lib/emulator.sh). The previous font scale is restored on exit, before a
# started emulator is stopped.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$repo/apps/mobile"
apk="$app/android/app/build/outputs/apk/release/app-release.apk"
out="${1:-$repo/context/changes/pilot-release/evidence/font-200}"

emu_tag=a11y-shots
# shellcheck source=scripts/lib/emulator.sh
source "$repo/scripts/lib/emulator.sh"
pick_or_boot_emulator

if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
  build_fake_apk "$app"
fi
[[ -f "$apk" ]] || { echo "a11y-shots: no APK at $apk" >&2; exit 1; }

previous_scale="$(adb -s "$ANDROID_SERIAL" shell settings get system font_scale | tr -d '\r')"
echo "a11y-shots: font scale before the run: $previous_scale"
# An emulator whose scale was left at 2.0 by an interrupted run reads 2.0 as "before": override it.
previous_scale="${A11Y_RESTORE_SCALE:-$previous_scale}"
restore_scale() {
  if [[ -z "$previous_scale" || "$previous_scale" == "null" ]]; then
    adb -s "$ANDROID_SERIAL" shell settings delete system font_scale >/dev/null
  else
    adb -s "$ANDROID_SERIAL" shell settings put system font_scale "$previous_scale" >/dev/null
  fi
  # Settings are written to disk asynchronously; killing the emulator at once would keep the old value.
  sleep 3
  adb -s "$ANDROID_SERIAL" shell sync >/dev/null || true
  echo "a11y-shots: font scale now $(adb -s "$ANDROID_SERIAL" shell settings get system font_scale | tr -d '\r'), restored to ${previous_scale:-default}"
}
on_cleanup restore_scale

adb -s "$ANDROID_SERIAL" install -r "$apk" >/dev/null
adb -s "$ANDROID_SERIAL" shell settings put system font_scale 2.0

rm -rf "$out"
mkdir -p "$out"
maestro --device "$ANDROID_SERIAL" test --test-output-dir "$out/raw" "$app/e2e/audit/screens.yaml"
find "$out/raw" -path '*takeScreenshot/*.png' -exec mv {} "$out" \;
rm -rf "$out/raw"

# Keep every screenshot under 300 KB: 8-bit palette PNG, same size.
python3 -I - "$out" <<'PY'
import sys, pathlib
from PIL import Image
for p in sorted(pathlib.Path(sys.argv[1]).glob("*.png")):
    Image.open(p).convert("RGB").quantize(colors=64).save(p, optimize=True)
    print(f"a11y-shots: {p.name} {p.stat().st_size // 1024} KB")
PY
