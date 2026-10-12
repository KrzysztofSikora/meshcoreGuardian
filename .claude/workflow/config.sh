# Defaults for .claude/workflow/ship and address-pr. Override any of them in the environment.

# Permission mode for the headless sessions. `auto` lets a classifier approve tool calls;
# anything it would ask about is denied (--permission-prompts none), never prompted.
# Use `acceptEdits` together with a `permissions.allow` list in .claude/settings.json if auto
# mode is not available on your plan. `bypassPermissions` only inside a disposable container.
: "${WORKFLOW_PERMISSION_MODE:=auto}"

# Model per step (alias or id). Strong models where decisions are made or bugs are hunted,
# cheaper ones where a written plan or list is executed and gates check the result.
# WORKFLOW_MODEL, when set, overrides every step (and retries).
: "${WORKFLOW_MODEL:=}"
: "${WORKFLOW_MODEL_PLAN:=opus}"
: "${WORKFLOW_MODEL_PLAN_REVIEW:=opus}"
: "${WORKFLOW_MODEL_IMPLEMENT:=sonnet}"
: "${WORKFLOW_MODEL_MUTATION:=sonnet}"
: "${WORKFLOW_MODEL_REVIEW:=opus}"
: "${WORKFLOW_MODEL_FIX_REVIEW:=sonnet}"
: "${WORKFLOW_MODEL_PR_BODY:=sonnet}"
: "${WORKFLOW_MODEL_ADDRESS_PR:=sonnet}"
# Model for a retry of a step whose artifact was left incomplete; empty keeps the step's model.
: "${WORKFLOW_MODEL_RETRY:=opus}"

# Optional: a dollar cap per step (API-key auth only).
: "${WORKFLOW_STEP_BUDGET_USD:=}"

# Loop limits. When a limit is hit the run does not stop for a person: it opens a draft PR.
: "${WORKFLOW_PLAN_REVIEW_ROUNDS:=2}"   # plan-review / plan-revise rounds
: "${WORKFLOW_REVIEW_ROUNDS:=2}"        # review / fix-review rounds
: "${WORKFLOW_MAX_PHASES:=12}"          # implement sessions per change
: "${WORKFLOW_STEP_RETRIES:=1}"         # extra sessions when a step leaves its artifact incomplete

# 1: after each session, stop emulators and Gradle/Kotlin daemons it started (they hold 15-20 GB).
# 0: leave them running, e.g. to inspect the emulator after a step.
: "${WORKFLOW_REAP_TOOLS:=1}"
