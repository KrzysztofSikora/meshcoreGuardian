#!/usr/bin/env bash
# Builds the fake-transport release APK, installs it on an Android emulator and runs Maestro.
# Usage: scripts/e2e.sh [--flow <file>] [maestro test options...]
#   --flow <file>     run one flow instead of every flow in apps/mobile/e2e
#   E2E_SKIP_BUILD=1  reuse the last built APK
#   E2E_BOOT_TIMEOUT  seconds to wait for a booted AVD (default 300)
#   ANDROID_SERIAL    emulator to use (`emulator-NNNN`); otherwise the first running emulator,
#                     else AVD `guardian` is booted headless. Physical phones are always refused:
#                     the release APK and `clearState` would overwrite a phone's app data.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$repo/apps/mobile"
apk="$app/android/app/build/outputs/apk/release/app-release.apk"

flows="$app/e2e"
maestro_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --flow)
      flows="${2:?--flow needs a file}"
      shift 2
      ;;
    *)
      maestro_args+=("$1")
      shift
      ;;
  esac
done

emu_tag=e2e
# shellcheck source=scripts/lib/emulator.sh
source "$repo/scripts/lib/emulator.sh"
pick_or_boot_emulator

if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
  build_fake_apk "$app"
fi

if [[ ! -f "$apk" ]]; then
  echo "e2e: no APK at $apk (run without E2E_SKIP_BUILD=1)" >&2
  exit 1
fi

adb -s "$ANDROID_SERIAL" install -r "$apk"
maestro --device "$ANDROID_SERIAL" test "${maestro_args[@]}" "$flows"
