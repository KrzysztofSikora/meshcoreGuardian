# Performance check (NFR-06)

Targets: the dashboard, the node screen and the battery list scroll smoothly (about 55 fps or better,
few frames over 16 ms) with 200 nodes and 1,000 runs, and a cold start reaches the Dashboard in
3 s or less on a mid-range phone.

## What the trace covers

The seed (`guardian://debug/seed/large-history`, fake build only) stores 200 nodes and 1,000 runs:
801 runs on one target node ("Seed node 1") over 30 days with battery readings, one run on each other
node. The app caps what it loads, so the screens render:

- the Dashboard: 200 rows (status varies by node);
- the node screen: 50 history rows (`RECENT_RUNS`) and 50 voltage rows (`VOLTAGE_RUNS`), read from a
  node that has 801 stored runs. There is no chart range control, so no longer span is drawn.

Rendering all 1,000 rows would need paging; that is a new change.

## Method

Emulator (automated, regression guard): `bash scripts/perf-trace.sh` builds the fake-transport
release APK (`E2E_SKIP_BUILD=1` reuses it), runs `apps/mobile/e2e/perf/large-history.yaml` (seed,
scroll the dashboard top to bottom and back, open the target node, scroll its history, expand
"Show values" and scroll the 50 voltage rows), reads `dumpsys gfxinfo` and measures 5 cold starts
with `am start -W`. Raw output: `context/changes/pilot-release/evidence/perf-emulator.txt`.
The emulator renders in software on a laptop, so its numbers show regressions, not phone speed.

Phone (human check):

1. Run the `ci` workflow with `transport=fake`:
   `gh workflow run ci.yml --ref <branch> -f transport=fake`, and download the `…-fake` APK.
2. Export your data, then uninstall Guardian. The CI APK is signed with the debug keystore and a Play
   build with the Play signing key, so one cannot be installed over the other.
3. Install the `-fake` APK and open `guardian://debug/seed/large-history`.
4. Developer options → Profile HWUI rendering → "On screen as bars". Scroll the Dashboard, a node's
   history and the expanded "Show values" list. Few bars should cross the green 16 ms line.
5. Time a cold start to the Dashboard (force-stop, open the app; ≤ 3 s).
6. Fill in the table below, uninstall, and reinstall the BLE APK.

## Results

### Emulator (2026-10-18, `sdk_gphone64_x86_64`, Android 15, x86_64 software rendering)

| Measure | Value |
|---|---|
| Frames rendered in the flow (121 s) | 3,906 |
| Janky frames | 143 (3.66 %) |
| Frame time p50 / p90 / p95 / p99 | 16 / 26 / 29 / 40 ms |
| Cold start (5 runs, ms) | 347, 313, 378, 287, 335 (median 335) |
| Seed time | about 4 s |

The 16 ms p50 is the vsync period of the emulator display, not render time. About 3.7 % of frames
missed the deadline; no optimisation is made because of this trace (plan scope: only where a trace
shows a need).

### Mid-range phone (to fill in by a person)

| Measure | Value |
|---|---|
| Phone model, Android version | |
| Frames over the 16 ms line while scrolling (few / some / many) | |
| Cold start to Dashboard (s) | |
