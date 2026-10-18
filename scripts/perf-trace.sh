#!/usr/bin/env bash
# NFR-06 trace on the emulator: seeds 200 nodes / 1,000 runs, scrolls the dashboard and the node
# screen, and records frame stats (dumpsys gfxinfo) plus the median of 5 cold starts.
# Manual tool, not a gate. Emulator only (scripts/lib/emulator.sh).
# Usage: scripts/perf-trace.sh [out-file]   (default context/changes/pilot-release/evidence/perf-emulator.txt)
#   E2E_SKIP_BUILD=1   reuse the last built fake-transport APK
#   PERF_SEED_WAIT_MS  how long the flow waits for the seed (default 30000, the seed took about 4 s here)
# The numbers come from a software-rendered x86_64 emulator: they show regressions, not phone speed.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$repo/apps/mobile"
apk="$app/android/app/build/outputs/apk/release/app-release.apk"
out="${1:-$repo/context/changes/pilot-release/evidence/perf-emulator.txt}"
pkg=io.github.krzysztofsikora.guardian

emu_tag=perf-trace
# shellcheck source=scripts/lib/emulator.sh
source "$repo/scripts/lib/emulator.sh"
pick_or_boot_emulator

if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
  build_fake_apk "$app"
fi
[[ -f "$apk" ]] || { echo "perf-trace: no APK at $apk" >&2; exit 1; }

adb_() { adb -s "$ANDROID_SERIAL" "$@"; }
adb_ install -r "$apk" >/dev/null
mkdir -p "$(dirname "$out")"
{
  echo "perf-trace: $(date -u +%FT%TZ) device $(adb_ shell getprop ro.product.model | tr -d '\r'), Android $(adb_ shell getprop ro.build.version.release | tr -d '\r')"
  echo "app: $pkg, fake transport, release build"
} >"$out"

# The flow starts the app (clearState), so gfxinfo counts frames from that launch to the end of the
# flow: the seed wait draws few frames, the scrolls draw most of them.
adb_ shell am force-stop "$pkg"
flow_start=$(date +%s)
maestro --device "$ANDROID_SERIAL" test -e SEED_WAIT_MS="${PERF_SEED_WAIT_MS:-30000}" "$app/e2e/perf/large-history.yaml"
echo "flow seconds: $(($(date +%s) - flow_start))" >>"$out"
{
  echo "--- gfxinfo (flow) ---"
  adb_ shell dumpsys gfxinfo "$pkg" | tr -d '\r' | sed -n '/Total frames rendered/,/HISTOGRAM/p' | awk '!seen[$0]++ && !/^HISTOGRAM/'
} >>"$out"

# Start to the first drawn frame (splash, before JS and the Dashboard), 5 times. Not NFR-06's
# "cold start reaches the Dashboard"; that is a human check on the phone.
times=()
for _ in 1 2 3 4 5; do
  adb_ shell am force-stop "$pkg"
  sleep 2
  t="$(adb_ shell am start -W -n "$pkg/.MainActivity" | tr -d '\r' | awk '/TotalTime/ { print $2 }')"
  times+=("$t")
done
median="$(printf '%s\n' "${times[@]}" | sort -n | sed -n 3p)"
{
  echo "--- time to first frame (am start -W TotalTime, ms; not Dashboard ready) ---"
  echo "runs: ${times[*]}"
  echo "median: $median"
} >>"$out"
cat "$out"
