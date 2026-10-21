# Shared emulator handling for scripts/e2e.sh, a11y-shots.sh and perf-trace.sh. Source it, do not run it.
# Provides: pick_or_boot_emulator (sets and exports ANDROID_SERIAL, emulator only), on_cleanup <cmd>
# (runs <cmd> on exit, before a started emulator is stopped) and the EXIT trap that stops an
# emulator this library started. Physical phones are always refused: the scripts install apps,
# clear state and change settings, which would overwrite a phone's data.
#   E2E_AVD           AVD to boot when no emulator runs (default `guardian`)
#   E2E_BOOT_TIMEOUT  seconds to wait for a booted AVD (default 300)
#   ANDROID_SERIAL    emulator to use (`emulator-NNNN`)
# The caller sets `emu_tag` (log prefix) before calling pick_or_boot_emulator.

export JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk-17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.local/bin:$PATH"

emu_tag="${emu_tag:-emulator}"
avd="${E2E_AVD:-guardian}"
boot_timeout="${E2E_BOOT_TIMEOUT:-300}"

started_emulator_pid=""
started_serial=""
cleanup_hooks=()

on_cleanup() {
  cleanup_hooks+=("$1")
}

cleanup() {
  local hook
  for hook in "${cleanup_hooks[@]}"; do
    eval "$hook" || true
  done
  if [[ -n "$started_emulator_pid" ]]; then
    echo "$emu_tag: stopping emulator ${started_serial:-pid $started_emulator_pid}"
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
  echo "$emu_tag: booting AVD $avd headless"
  emulator -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
  started_emulator_pid=$!
  until serial="$(adb devices | awk '$1 ~ /^emulator-/ { print $1 }' | grep -vxF "$before" | head -n1)" \
    && [[ -n "$serial" ]] \
    && started_serial="$serial" \
    && [[ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do
    if ! kill -0 "$started_emulator_pid" 2>/dev/null; then
      echo "$emu_tag: emulator for AVD $avd exited before boot completed" >&2
      started_emulator_pid=""
      exit 1
    fi
    if ((waited >= boot_timeout)); then
      echo "$emu_tag: AVD $avd did not finish booting within ${boot_timeout}s" >&2
      exit 1
    fi
    sleep 5
    waited=$((waited + 5))
  done
  export ANDROID_SERIAL="$serial"
}

pick_or_boot_emulator() {
  adb start-server >/dev/null
  if [[ -z "${ANDROID_SERIAL:-}" ]]; then
    ANDROID_SERIAL="$(running_emulator)"
    if [[ -n "$ANDROID_SERIAL" ]]; then
      export ANDROID_SERIAL
    else
      boot_emulator
    fi
  fi
  if [[ "$ANDROID_SERIAL" != emulator-* ]]; then
    echo "$emu_tag: refusing to run on '$ANDROID_SERIAL': only an emulator (emulator-NNNN) is allowed" >&2
    exit 1
  fi
  echo "$emu_tag: using device $ANDROID_SERIAL ($(adb -s "$ANDROID_SERIAL" shell getprop ro.product.model | tr -d '\r'))"
}

# Builds the fake-transport release APK (the e2e, accessibility and performance scripts all run it).
build_fake_apk() {
  local app="$1"
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
}
