# Mutation check: protocol-feasibility-gate

Targets (files changed on the branch that hold logic where a silent bug hurts):
- `packages/meshcore-adapter/src/decode/{bytes,decode-frame,device-info,path,status}.ts`: test-plan target; companion frames → decoded records and the corrections of meshcore.js misreads (TR-06, TR-16).
- `packages/meshcore-adapter/src/fixtures/format.ts`: input validation of every fixture S-02/S-03/S-04 will replay (D-3, D-14).
- `tools/capture/src/redact.ts`: privacy; PIN, password, positions and chat names must not reach a committed fixture (D-4, D-13, D-20, TR-09).
- `tools/capture/src/budget.ts`: radio hygiene; per-run limits and 60 s spacing (D-6, D-8, TR-23).
- `tools/capture/src/config.ts`: `.env` input validation (TR-23).
- `tools/capture/src/recorder.ts`: redaction applied to the recorded copy, fixture summary.
- `tools/capture/src/capture.ts`: reply matching and request outcome mapping (`responded / rejected / error / no_response`), abort reasons (D-15, D-16, D-19).

Skipped: `node-ble-transport.ts`, `main.ts`, `cli.ts`, `hex.ts`, `mesh-core-connection.ts`, `mesh-transport.ts`, `index.ts`, type declarations (BLE and process wiring, re-exports, types).

Tests: `stryker.config.mjs` (vitest runner, `perTest` coverage, incremental), `pnpm mutation --mutate <the 11 files>`; the final number comes from a `--force` run (see *Gaps*).

Score (target files only): 92.7% -> 97.1%
- before: 722 killed / 55 survived / 2 no coverage / 1 timeout
- after: 756 killed / 23 survived / 0 no coverage / 1 timeout

Per file after: bytes, device-info, path, status, redact 100%; decode-frame 95.7%; format 95.0%; capture 96.7%; budget 96.2%; config 97.4%; recorder 97.5%.

## Mutants
| File:line | Mutator | Change | Decision | Note / test added |
|-----------|---------|--------|----------|-------------------|
| decode/bytes.ts:10 | BooleanLiteral | `getInt32(at, false)` | strengthen | `bytes.test.ts`: `i32le` read on an asymmetric value (`fe ff ff ff` → -2). `i32le` is not used by production code yet. |
| decode/device-info.ts:32–34 | ArithmeticOperator ×3 | field width `a - b` → `a + b` (build date, manufacturer, firmware version) | strengthen | `device-info.test.ts`: "reads strings that fill their whole field without spilling into the next one". A full-width field must not run into the next field. |
| decode/decode-frame.ts:131 | ConditionalExpression, StringLiteral | `if (event !== "rx")` → `true` / `!== ""` | equivalent | meshcore.js emits `rx` before the parsed event, so the parsed payload always overwrites it. |
| decode/decode-frame.ts:228 | ConditionalExpression | `path.kind === "known" ? … : 0` → always multiply | equivalent | For an unknown path `hashSize × hops` is `NaN`, and `subarray(start, NaN)` is empty, the same as length 0. |
| decode/decode-frame.ts:271 | ConditionalExpression | `error instanceof RangeError` → `true` | accept | CayenneLpp only throws `RangeError` for cut-short values; other errors can't be reached without mocking the library. |
| fixtures/format.ts:73 | Regex | `([0-9a-f]{2})*` → exactly one byte | strengthen | `format.test.ts`: the valid fixture now has a multi-byte frame (`1603`). |
| fixtures/format.ts:75 | StringLiteral | drop `"rejected"` from outcomes | strengthen | `format.test.ts`: the valid fixture has a `rejected` login request. |
| fixtures/format.ts:108, 119, 135, 144, 161 | StringLiteral ×5 | empty field path in the error | strengthen | `format.test.ts` table: string firmware, missing libraries, string redaction list, numeric hex, non-object request. `readFixture` promises to name the bad field. |
| fixtures/format.ts:92 | StringLiteral | `"a string"` → `""` | strengthen | Killed by the numeric-hex row (`frames[0].hex: expected a string`). |
| fixtures/format.ts:97, 102, 145 | StringLiteral ×3 | `"a number"`, `" | "` join, hex message → `""` | accept | Wording of the expected-value text; the field path is pinned. |
| fixtures/format.ts:68; budget.ts:22; config.ts:11 | StringLiteral ×3 | error class `name` → `""` | accept | Callers and tests match on the class (`instanceof`), not `name`. |
| fixtures/format.ts:97 | LogicalOperator, ConditionalExpression | `typeof !== "number" \|\| !isFinite` → `&&` / `false \|\|` | equivalent | `Number.isFinite` does not coerce, so it is already false for every non-number. |
| fixtures/format.ts:102 | ConditionalExpression | `typeof !== "string" \|\|` → `false \|\|` | equivalent | `allowed.includes` of a non-string is already false. |
| redact.ts:68, 72, 86 | EqualityOperator ×3 | `>=` → `>` on PIN, self position and chat position bounds | strengthen | `redact.test.ts`: "redacts frames that end right after the redacted bytes" (8, 44 and 144 bytes). |
| redact.ts:85 | ConditionalExpression | contact/advert code check → `true` | strengthen | `redact.test.ts`: "leaves other rx frames with a chat type byte at the contact offset alone". |
| redact.ts:89 | StringLiteral | key join `","` → `""` | strengthen | `redact.test.ts`: keys `01 17…` and `0c 03…` must get `chat-1` and `chat-2`. |
| redact.ts:92 | CallExpression | drop zeroing of the contact name field | strengthen | The chat-rename test now uses `Alice Liddell`. Without the fill, the tail of the real name stayed in the fixture (privacy). |
| capture.ts:93, 245 | BlockStatement, CallExpression | `clear()` no-op / not called before a remote request | strengthen | Status-reply table now checks every status outcome: a reply that arrives after the wait must not count as the retry's reply. |
| capture.ts:133 | CallExpression | drop `clearTimeout` | strengthen | Trickle test now spans two gaps below the idle timeout (8 s in total). Without the fix, a stale timer ended the sync as `contact_sync_stalled`. |
| capture.ts:104 | ConditionalExpression (+ NoCoverage string) | `next()` ignores a lost link | strengthen | "reports a disconnect during a write as a disconnect, not as no response". |
| capture.ts:122 | BlockStatement (NoCoverage) | undecodable frame no longer skipped | strengthen | "skips a frame it cannot decode and keeps waiting for the reply". |
| capture.ts:146–149, 263 | ConditionalExpression, LogicalOperator ×7 | reply kind ignored; any frame accepted as the reply | strengthen | The "ignores a reply of another kind" test became a table per request kind: wrong-kind pushes (and an advert) arrive before or instead of the real reply. |
| capture.ts:178 | ConditionalExpression | every error reported as an abort | strengthen | "fails instead of reporting an abort when the budget refuses a request". |
| capture.ts:201, 212 | StringLiteral ×2 | `budget.take("")` | strengthen | "counts its handshake and contact sync against the run budget". |
| capture.ts:78, 202 | ArrayDeclaration, CallExpression | junk initial queue entry / no `clear()` before the handshake | equivalent | Each alone: the queue is empty when the run starts, and `clear()` drops the junk entry. |
| capture.ts:113, 115 | BlockStatement, ArrowFunction | `dispose` does not settle the pending waiter | equivalent | Every `next()` is awaited, so nothing is pending when `dispose` runs. |
| capture.ts:114, 183–184 | CallExpression, BlockStatement | link listeners not removed after the run | accept | Has no effect inside a run; `main.ts` closes the transport straight after. The only way to pin it would be to count listeners. |
| capture.ts:194 | ConditionalExpression | `CaptureAborted` from a command rewrapped | equivalent | Commands are meshcore.js writes and never throw `CaptureAborted`. |
| recorder.ts:115 | CallExpression | `listeners.clear()` on close | equivalent | The inner subscription is removed first, so no frame reaches the listeners after close. |
| recorder.ts:134 | ConditionalExpression | `summary.aborted = undefined` always set | equivalent | `JSON.stringify` drops undefined keys, so the written file is the same. |

## Dead-weight tests
No copy-paste duplicates. A test-to-kill map from the report lists tests that kill nothing, but Stryker stops at the first failing test, so that map undercounts. The zero-kill tests are rows of existing tables (`rejects the root %j`, infrastructure contact types, status-reply bounds) or privacy guards that no mutation operator models (canary not logged, password dropped). Keep them.

## Gaps for the test plan
- `context/test-plan.md` *Mutation targets* has no row for `packages/meshcore-adapter/src/fixtures/format.ts` or for `tools/capture/src/{redact,budget,capture}.ts`. `redact.ts` guards secrets in committed files and deserves a row (proposed 80%).
- Incremental mode reused stale *Survived* results for static (module-level) mutants after the tests changed: `HEX` and `OUTCOMES` were only reported killed after `--force`. Use `--force` for the final run of a mutation check.
- The `HEX` mutant first survived even though `test/fixtures.int.test.ts` parses the real multi-byte fixtures. That file calls `readFixture` at import time, and a failure while loading a file was not counted as a kill. Fixture-shape checks that should guard mutants belong inside an `it`.
- `i32le` in `decode/bytes.ts` is exported and tested but not used by production code.

## Proposed lessons
- Check every field-width and bound with input that fills the field exactly. The width mutants in `device-info.ts`, the `>=` bounds in `redact.ts` and the name-tail leak (short test names never exercised the zero-fill) survived because every fixture value was shorter than its field.
