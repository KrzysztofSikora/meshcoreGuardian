feat(connect-companion): connect to the companion over BLE and show its capabilities

Roadmap S-02. From the app the operator can grant Bluetooth access (`BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` only), scan, connect to the MeshCore companion, see its firmware and the five capabilities, and get an honest state when the link drops or a step fails. Covers PRD FR-01 AC1–AC5, FR-02 AC1–AC3 and FR-03 AC1–AC3. Six Maestro flows on `FakeTransport` cover permission denied, Bluetooth off, connect success, connect failure + Retry, link drop + Reconnect and an unsupported capability. The real BLE path (bonding, MTU, meshcore.js under Hermes) is only checked by the human checks below; the emulator has no BLE.
Closes #3

> **Status:** Ready for review

## ⚠ Needs your decision
- **D-7 (costly):** How is the last companion remembered across restarts? → chose **`LastCompanionStore` port on `expo-sqlite/kv-store`** (key `companion.last`, JSON `{ id, name }`, Zod-parsed). Alternatives: B: memory only until S-03 (no native module, but the companion is forgotten on every restart); C: wait for the S-03 settings table (correct long-term home, but the roadmap says "remembered" for this item); D: expo-file-system JSON (another native module with no later use). Switching costs: one file behind a port (`apps/mobile/src/platform/last-companion-store.ts`), a one-line change in `composition/platform.ts`, and the `expo-sqlite` dependency/config plugin. The persisted key `companion.last` lives outside the S-03 migrations, so S-03 must migrate or drop it (plan-review #10).
- **[REVIEW] (Phase 4) Plan-review #2 open:** `RnBlePlatform.connect` runs `connectToDevice` (15 s), service discovery and the TX subscription inside the session's 15 s `CONNECT_TIMEOUT`. The plan budgets the PIN dialog in the 30 s device-query step, but the first encrypted access may be the notification subscription in `connect`. Code: session bound unchanged. Consequence: a slow PIN entry could read `CONNECT_TIMEOUT` on first pairing. Human check 4 must note at which step the dialog appears. See [Deviations](plan.md#deviations).
- **D-5 (unverified):** capability minimums (`CAPABILITY_MIN_VER_CODE`: contacts/login/status/trace 1, telemetry 5) come from firmware comments, not observation. The firmware gives no version tag for login, status request, telemetry request or trace. Only ver code 13 was verified in S-01 (trace was not exercised). Rows are marked `UNVERIFIED` in `docs/compatibility.md`. Alternatives: B: every capability supported on tested firmware (then FR-03 AC2 can never happen); C: probe commands at connect (would transmit over LoRa without a user tap). Cheap to change (one constant).
- **Review leftovers:** none. R1–R5 are fixed (see Quality).

Reply in a review comment, e.g. `D-7: take B`, `D-5: take B`, `drop the lessons commits`, then run `.claude/workflow/address-pr <PR number>`.

## Human checks
Use the CI APK (`android-apk` artifact) on a phone, without USB debugging. Details in [plan.md](context/changes/connect-companion/plan.md#human-checks).
- [ ] 1. Fresh install, open Connect: explanation card shown; "Grant access" → system dialog asks for "Nearby devices" only, no location prompt. Evidence: none.
- [ ] 2. Deny → "Permission required" with "Open settings"; grant in settings and return → scan available without restarting the app. Evidence: none.
- [ ] 3. Bluetooth off → Scan shows "Bluetooth is off", never "No companions found". Evidence: none.
- [ ] 4. Bluetooth on → Scan lists the Heltec within 10 s; Connect. Note whether and at which step a pairing/PIN dialog appears (plan-review #2, see [REVIEW] above). Screen shows Connected, firmware `v1.17.1-…`, Heltec V3, five capabilities, no "Untested firmware". Record the MTU under Technical details. This also proves meshcore.js under Hermes (TR-07). Evidence: screenshot by the reviewer.
- [ ] 5. While connected power off the companion → "Disconnected" within ~5 s; power on, tap Reconnect → "Connected" without restart (the companion may need minutes before it advertises again). Evidence: none.
- [ ] 6. Kill and reopen the app → Connect offers the remembered companion; nothing connects until tapped. Evidence: none.
- [ ] 7. Read the Connect screen wording (permission text, failure reasons, capability reasons); accept or change. Reference: [emulator screenshot](context/changes/connect-companion/evidence/phase-5-connect-ok.png).
- [ ] 8. Fill the "Android phone" table in `docs/compatibility.md` from checks 1–6. Evidence: none.

## Other decisions made by the agent (cheap to change)
Full table with reasons: [plan.md#decisions](context/changes/connect-companion/plan.md#decisions).

| ID | Question | Chosen | Alternatives |
|----|----------|--------|--------------|
| D-1 | Where does `FakeTransport` live? | adapter package, exported from the entry point | app `platform/fake/`; adapter `test/support` |
| D-2 | How does `FakeTransport` match writes to recorded replies? | by command code in recorded order; faults `silence`, `corrupt`, `dropAfterWrites`, `drop` | exact hex match; timer replay |
| D-3 | Replay data for the fake app build | frames 0–3 of `handshake.json` as a constant, locked to the fixture by a test | import the full fixture (~290 KB); derived JSON under `fixtures/` |
| D-4 | Handshake timeouts and retries | device query 30 s (covers the PIN dialog), app start 5 s, no auto retry | one 10 s budget; retry the device query once |
| D-6 | Compatibility record (FR-03 AC3) | `TESTED_FIRMWARE = ["1.17"]` on `major.minor` | exact string; by ver code |
| D-8 | How the scan finds companions | no OS filter; client-side NUS UUID or name `MeshCore*`; stops after 10 s | OS UUID filter; list every device |
| D-9 | MTU handling | request 512, show it under Technical details, no refusal | refuse < 151; do not request |
| D-10 | Connection state and failure reasons | four kinds; a drop while connected is `disconnected` with a "Link lost" note | `failed` after a drop; free-text errors |
| D-11 | Background behaviour | scan stops; `startScan`/`connect` refused; an open link stays idle | disconnect on background; no handling |
| D-12 | Permission UX | explanation card, then "Permission required" + "Open settings" / "Try again"; re-check on app active | request on screen open; request at app start |
| D-13 | Metro and meshcore.js (`serialport`, `net`) | `metro.config.js` `resolveRequest` → empty module; bundle check passed for fake and ble | deep imports; vendor the codec |
| D-14 | How e2e picks a scenario | route `debug/scenario/[name]`, fake builds only | hidden dev menu; APK per scenario |
| D-15 | What "untested firmware" disables | nothing; shows a notice (all MVP actions are read-only) | allow only contacts |
| D-16 | Where orchestration lives | `CompanionSession` in the app application layer, Zustand vanilla store | in the adapter; React hooks only |
| D-17 | base64 conversion | own tested `base64.ts` | `atob`/`btoa`; `buffer` package |

## Quality
- Gates (round 2): typecheck ok, lint ok, unit tests ok (471/471), e2e ok (7/7 flows).
- Review: APPROVE WITH FOLLOW-UPS, round 2: fixed 5 (R1 blocker, R2/R3/R5 major, R4 minor), deferred 0, rejected 0. R1: Retry was a no-op after the Connect screen remounted. R2: BLE scan errors were shown as "No companions found". R3 and R5: `mesh-client.ts` mutation survivors and an inaccurate record. R4: stryker targets and TR-14 status.
- Mutation: `capabilities.ts` 100% → 100%; `firmware.ts` 92.9% → 92.9%; `companion-session.ts` 68.3% → 80.2%; `mesh-client.ts` 67.4% → 86.3% (82 killed / 11 survived / 2 no coverage, `--force`). `bug` mutants: none. Remaining survivors are recorded as `accept` or `equivalent` in [mutation.md](context/changes/connect-companion/mutation.md).
- Plan review: READY WITH NOTES. Notes #1 (listener isolation in transports) and #2 (PIN dialog budget) are handled in *Review response*; #2 stays open as the [REVIEW] above.
- Proposed lessons (in `context/lessons.md`): "Make screen-effect calls such as `initialize()` idempotent"; "Give every port that starts native work an error path"; "Do not accept a mutant because the shared fake cannot reach it; write a minimal port double in the test"; "Re-run mutation after the last test change and copy every survivor into `mutation.md`; never mark a mutant `strengthen` without seeing it killed". To reject them, drop the commits `66a737a` and `c947c13`.

## Follow-ups
- `TR-14`: the disabled-button e2e is left to S-04 (no action buttons exist yet); the mapping and reason text are covered now.
- Mutation gaps for the test plan: `FakeTransport` cannot inject an unsolicited frame; no platform double resolves a link in the same tick as an abort (post-link abort branch in `CompanionSession.link`).
- S-03 must migrate or drop `companion.last` from the `expo-sqlite/kv-store` (D-7).
- Removing Expo's default manifest permissions is S-10 (the manifest has LOCATION entries with `maxSdkVersion=30`, inert at minSdk 31; [evidence](context/changes/connect-companion/evidence/phase-4-manifest.txt)).

## Commits
```
1359575 docs(connect-companion): triage review round 2
c947c13 docs(connect-companion): propose lessons
1717c76 fix(connect-companion): pin mesh-client timer and close behaviour, correct mutation record (R5)
cc33ce5 docs(connect-companion): review
cf4388a docs(connect-companion): triage review round 1
66a737a docs(connect-companion): propose lessons
cfaf24a fix(connect-companion): sync stryker targets and TR-14 status (R4)
01c03c3 fix(connect-companion): hand-written transport tests for mesh-client (R3)
600d74d fix(connect-companion): idempotent initialize and scan error path (R1, R2)
888879c docs(connect-companion): review
94d707b docs(connect-companion): mutation
37d4499 test(connect-companion): strengthen assertions from mutation check
f00b775 feat(connect-companion): connect screen, dashboard status, scenarios route and e2e
c3db69b feat(connect-companion): BLE platform, persistence, composition and Metro bundle
559abf1 feat(connect-companion): companion session and fake platform
5fcf747 feat(connect-companion): FakeTransport and handshake client
ed21d12 feat(connect-companion): domain companion model
659e183 docs(connect-companion): plan-review
8aa0ebe docs(connect-companion): plan
```

<details><summary>Run</summary>

Branch `change/connect-companion`, base `main`, started 2026-10-11 17:58. Failed step: none. Draft reason: none.

| Step | Model | Cost | Result |
|------|-------|------|--------|
| plan | opus | $2.30 | success |
| plan-review | opus | $1.07 | READY WITH NOTES |
| implement ×5 | sonnet | $0.27, $0.57, $0.53, $0.57, $0.75 | success |
| mutation | sonnet | $0.45 | success |
| review round 1 | opus | $1.51 | CHANGES REQUESTED (4 findings) |
| fix-review round 1 | sonnet | $0.43 | success |
| review round 2 | opus | $0.75 | APPROVE WITH FOLLOW-UPS (1 finding) |
| fix-review round 2 | sonnet | $0.24 | success |

Phases ticked: 5/5. All steps ran at attempt 1.
</details>
