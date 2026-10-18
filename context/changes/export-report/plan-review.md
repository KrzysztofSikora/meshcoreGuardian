# Plan review: export-report

Verdict: READY WITH NOTES

| # | Severity | Check | Finding | Suggested change |
|---|----------|-------|---------|------------------|
| 1 | major | Failure paths | Stored runs can have an empty companion key: `run-controller.ts:251` saves `companion ?? { publicKey: "", name: "", firmwareVersion: "" }`, and `companion_public_key` is unconstrained `TEXT NOT NULL` (`0002_diagnostics.sql:4`, `run-repository.ts:52` `z.string()`). The plan's schema refinement requires "every key field matches `/^[0-9a-f]{8}$/` … `/^[0-9a-f]{64}$/`" (Design, App). One such run in the range makes every export of that node fail with "Could not create the export file", and the user has no way around it. No test covers this. | Define the behaviour: make `companion_public_key` nullable in the report (or allow `""`), keep the refinement for non-empty keys only, and add a fixture run with an empty companion identity to the golden tests and to `schema.test.ts`. |
| 2 | minor | Phasing | Phase 2 adds `forNodeBetween` to both repository interfaces, but its file list leaves out the hand-written implementers, which then fail `pnpm typecheck`: `MemoryRuns implements DiagnosticRunRepository` (`apps/mobile/src/application/diagnostics/run-controller.int.test.ts:40`) and the object-literal `TelemetryRepository` in `apps/mobile/src/application/nodes/node-history.int.test.ts:166-171`. | Add both test files to the Phase 2 file list. |
| 3 | minor | Design | `TelemetryRepository.forNodeBetween` re-applies the range "joined on the run's `finished_at`", so the range rule (D-4) lives in two SQL queries that can drift apart. Runs and samples are also two separate reads, which `buildReport` already reconciles by dropping orphans. | Simpler: `TelemetryRepository.forRuns(runIds)`, called with the ids `runs.forNodeBetween` returned. The range rule then lives in one query. |
| 4 | minor | Grounding / phasing | Golden files: domain lint forbids `node:fs` (true, `eslint.config.mjs:88`), but the plan does not say how the four golden files are first produced. If they are pasted from `toJson`/`toCsv` output, the golden test proves nothing at first. Also, `import.meta.glob` typing in the adapter test comes from a local ambient declaration (`packages/meshcore-adapter/test/fixtures.int.test.ts:8-12`), and domain needs the same. | Write the golden files by hand from the fixture, or generate them once and review them line by line against the fixture values. Record which in the plan. Note the ambient `ImportMeta.glob` declaration for domain. |
| 5 | minor | Design (NFR-09) | The plan puts Export "below the run panel". The mockup cited by the plan puts it in a two-column row next to *Run diagnostic* (`docs/design/mockup/Node.dc.html:38-46`). The mockup shows a download icon, and `icons.tsx` has none yet. | Place it next to *Run diagnostic* as in the mockup, or log the difference as a `[minor]` deviation. Add the icon (the mockup has the SVG path), not "none". |
| 6 | minor | End state | The CSV columns `node_name` and `node_label` versus the JSON `reported_name` and `label` do not say whether `node_name` is `reportedName` or `displayName(node)`. The plan also does not say whether CSV times are ISO UTC like the JSON. | State both in D-2. They are part of the file format contract. |
| 7 | minor | Grounding | D-11 says the file "replaces an existing file of that name", and the Findings say `create()` throws if the file exists. The docs offer `file.create({ overwrite: true })` (docs.expo.dev/versions/latest/sdk/filesystem, `FileCreateOptions.overwrite`). | Name `create({ overwrite: true })` in Phase 4, so the second Share of the same range does not fail. Add an e2e or human step that taps Share twice. |
| 8 | minor | Agent decisions | D-7 is marked `cheap`, but the `'` prefix changes cell contents in a format that D-2 calls `costly`. Any program that reads the CSV sees `'=name`. | Mark D-7 `costly` (same reversal cost as D-2) so the PR reviewer sees it next to D-2. |

## Decisions the PR reviewer should look at
- D-1: the JSON shape (nesting, snake_case, ISO UTC). This is a contract that others may parse.
- D-2: the CSV shape (one row per run, the "first non-null" telemetry rule, `;`-joined check cells).
- D-3: 7/30/90-day presets as the "date range" of AC1, with no free date picker.
- D-7: the CSV-injection prefix alters exported text.

## What is good
- Every AC is mapped to a test. AC4 reuses the existing leak-canary recipe with a real diagnostic on the fake transport, in both formats and with redaction on and off.
- Most cited files, symbols and line ranges check out against the code (`keyPrefix`, the `finished_at` index, `Segmented` limits, the `import.meta.glob` pattern, the mockup lines, the lint rules). The expo-file-system API claims match the docs.
- Lessons are applied explicitly: idempotent `open`, context captured at `share()`, no empty notice from the loading/error state, port doubles with error paths, a full e2e run after the header grows, a preview-only e2e assertion, and a back-stack check.
- Scope is tight. S-09's stored default sits behind a one-line port (D-10). Raw payload bytes and position are excluded by default and can be added later.
- The preview manifest comes from the same constants as the serialisers, and a test ties them together.
