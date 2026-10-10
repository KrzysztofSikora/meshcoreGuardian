# MeshCore Guardian

Offline-first Android app (React Native + TypeScript) for operators of MeshCore repeaters and
room servers. It talks over BLE to a local MeshCore companion device and shows evidence-based
reachability, telemetry, diagnostic results and history — no account, no cloud. The brief is
`MeshCore_Guardian_PRD.md` (product PRD v1.0); the workflow's own artifacts live in `context/`.

## Process

Spec-driven workflow in `.claude/skills/`, described in `docs/workflow.md`.

- Project steps are interactive and run once: `/shape` → `/prd` → `/tech-stack` → `/roadmap`
  → `/test-plan`. The user approves each.
- Per-change steps are autonomous and run from `.claude/workflow/ship <roadmap ID>` (or
  `/ship`): plan → plan-review → implement (one session per phase) → mutation → review →
  fix-review → PR. They never ask; they record decisions in the plan and the PR collects them.
  The user decides at the PR, and `.claude/workflow/address-pr <n>` applies those decisions.
- Rules for autonomous runs: `.claude/workflow/autonomy.md`.
- Do not start coding a roadmap item outside that loop.

## Artifacts (`context/`)

| File | Owner |
|------|-------|
| `shape-notes.md`, `prd.md`, `tech-stack.md`, `roadmap.md`, `test-plan.md` | project skills |
| `changes/<id>/plan.md` | `/plan` (decisions, phases, human checks, deviations) |
| `changes/<id>/{plan-review,mutation,review}.md` | per-change skills |
| `changes/<id>/pr-body.md`, `changes/<id>/evidence/` | `/pr-body`, `/implement` |
| `lessons.md` | rules from reviews; binding for planning, implementing and reviewing |

Artifacts are the source of truth. If code and an artifact disagree, raise it (in an autonomous
run: a `[REVIEW]` deviation); don't silently pick one.

## Rules

- No secrets in code, commits, logs or answers. Config comes from `.env` (template:
  `.env.example`).
- No AI attribution anywhere in the repo: no `Co-Authored-By`, `Claude-Session` or "Generated with"
  lines in commits, PR descriptions or issues.
- One Conventional Commit per implemented phase, scope = change-id: `feat(<change-id>): ...`.
- Commits reference their GitHub issue with `Refs #<n>`; the PR closes it.
- Layers: UI → application/use-cases → domain diagnostics → MeshCore client abstraction → BLE
  transport; persistence only through repository interfaces. Domain code has no BLE/RN imports.
- Honest status: a timeout is `NO_RESPONSE` (cause unknown), never "offline". No color-only status.
- Radio hygiene: bounded timeouts and retries, no duplicate in-flight request per companion, no
  background polling.
- Privacy: local data only; exports exclude secrets by default; credentials only in
  Keystore-backed secure storage, never SQLite.
- Stack and layer boundaries: `context/tech-stack.md`. `domain` imports nothing; only `apps/mobile`
  imports Expo/React Native.
- `@liamcottle/meshcore.js` is pinned exactly and used only as a codec; timeouts, abort, retries and
  single-flight live in our `MeshClient`.
- Protocol/hardware behaviour is `UNVERIFIED` until confirmed on real devices (PRD §8 discovery gate).

## Gates

The autonomous skills run exactly these commands. Keep them current. `/implement` runs the
fast ones per phase; `/review` runs all of them.

| Gate | Command | Needs |
|------|---------|-------|
| typecheck | `pnpm typecheck` | - |
| lint | `pnpm lint` | - |
| unit tests | `pnpm test` | - |
| integration tests | `pnpm e2e` | Android emulator running the fake-transport dev build |
| mutation (one module) | `pnpm mutation --mutate <file>` | - |

Scripts are created by the first roadmap item (project scaffold). Until then the gates fail.
Real-hardware BLE checks are human checks with evidence, never a gate.

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Dev build on phone (real BLE) | `pnpm --filter mobile android` |
| Dev build, fake transport | `EXPO_PUBLIC_TRANSPORT=fake pnpm --filter mobile android` |
