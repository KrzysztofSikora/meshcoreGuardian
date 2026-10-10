#!/usr/bin/env bash
# Builds the fake-transport release APK, installs it on an Android emulator and runs Maestro.
# Usage: scripts/e2e.sh [--flow <file>] [maestro test options...]
#   --flow <file>     run one flow instead of every flow in apps/mobile/e2e
#   E2E_SKIP_BUILD=1  reuse the last built APK
#   E2E_BOOT_TIMEOUT  seconds to wait for a booted AVD (default 300)
#   ANDROID_SERIAL    device to use; otherwise the first running emulator, else AVD `guardian`
#                     is booted headless. A physical phone is only used when named here.
set -euo pipefail

export JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.local/bin:$PATH"

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$repo/apps/mobile"
apk="$app/android/app/build/outputs/apk/release/app-release.apk"
avd="${E2E_AVD:-guardian}"
boot_timeout="${E2E_BOOT_TIMEOUT:-300}"

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

started_emulator_pid=""
started_serial=""
cleanup() {
  if [[ -n "$started_emulator_pid" ]]; then
    echo "e2e: stopping emulator ${started_serial:-pid $started_emulator_pid}"
    if [[ -n "$started_serial" ]]; then
      adb -s "$started_serial" emu kill >/dev/null 2>&1 || true
      for _ in {1..30}; do
        kill -0 "$started_emulator_pid" 2>/dev/null || break
        sleep 1
      done
    fi
    # Signal the process directly too: adb may never have seen the device, and `wait` alone
    # would block on an emulator that keeps running.
    kill "$started_emulator_pid" 2>/dev/null || true
    wait "$started_emulator_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

running_emulator() {
  adb devices | awk '$1 ~ /^emulator-/ && $2 == "device" { print $1; exit }'
}

boot_emulator() {
  local before serial waited=0
  before="$(adb devices | awk '$1 ~ /^emulator-/ { print $1 }')"
  echo "e2e: booting AVD $avd headless"
  emulator -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
  started_emulator_pid=$!
  until serial="$(adb devices | awk '$1 ~ /^emulator-/ { print $1 }' | grep -vxF "$before" | head -n1)" \
    && [[ -n "$serial" ]] \
    && started_serial="$serial" \
    && [[ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    if ! kill -0 "$started_emulator_pid" 2>/dev/null; then
      echo "e2e: emulator for AVD $avd exited before boot completed" >&2
      started_emulator_pid=""
      exit 1
    fi
    if ((waited >= boot_timeout)); then
      echo "e2e: AVD $avd did not finish booting within ${boot_timeout}s" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  export ANDROID_SERIAL="$serial"
}

adb start-server >/dev/null
if [[ -z "${ANDROID_SERIAL:-}" ]]; then
  ANDROID_SERIAL="$(running_emulator)"
  if [[ -n "$ANDROID_SERIAL" ]]; then
    export ANDROID_SERIAL
  else
    boot_emulator
  fi
fi
echo "e2e: using device $ANDROID_SERIAL ($(adb -s "$ANDROID_SERIAL" shell getprop ro.product.model | tr -d '\r'))"

if [[ "${E2E_SKIP_BUILD:-}" != "1" ]]; then
  # EXPO_PUBLIC_* values are inlined when Gradle bundles the JS, so the whole build sees it.
  export EXPO_PUBLIC_TRANSPORT=fake
  export NODE_ENV=production
  (
    cd "$app"
    pnpm exec expo prebuild --platform android --no-install
    # Gradle does not track env vars as inputs; drop the old bundle so it is rebuilt with them.
    rm -rf android/app/build/generated/assets/react android/app/build/generated/res/react
    cd android
    ./gradlew assembleRelease -PreactNativeArchitectures=x86_64
  )
fi

if [[ ! -f "$apk" ]]; then
  echo "e2e: no APK at $apk (run without E2E_SKIP_BUILD=1)" >&2
  exit 1
fi

adb -s "$ANDROID_SERIAL" install -r "$apk"
maestro --device "$ANDROID_SERIAL" test "${maestro_args[@]}" "$flows"
