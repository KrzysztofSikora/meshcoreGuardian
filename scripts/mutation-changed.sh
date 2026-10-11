#!/usr/bin/env bash
# Runs Stryker on each mutation target changed against a base ref and reports the scores.
# Usage: scripts/mutation-changed.sh <base-ref>
# Targets: globs in stryker.targets (override with MUTATION_TARGETS=<file>).
# Scores go to $GITHUB_STEP_SUMMARY when set, else to stdout. Report only: a low score never fails.
set -euo pipefail

base="${1:?usage: mutation-changed.sh <base-ref>}"
targets_file="${MUTATION_TARGETS:-stryker.targets}"
# fd 3 is the report; duplicating stdout (instead of opening /dev/stdout) keeps one file offset.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  exec 3>>"$GITHUB_STEP_SUMMARY"
else
  exec 3>&1
fi

mapfile -t globs < <(grep -Ev '^[[:space:]]*(#|$)' "$targets_file")

files=()
while IFS= read -r file; do
  [[ "$file" == *.test.ts ]] && continue
  for glob in "${globs[@]}"; do
    # shellcheck disable=SC2053 # the glob is meant to match as a pattern
    if [[ "$file" == $glob ]]; then
      files+=("$file")
      break
    fi
  done
done < <(git diff --name-only --diff-filter=AMR "$base"...HEAD)

{
  echo "## Mutation report"
  echo
} >&3

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No mutation target files changed against \`$base\`." >&3
  exit 0
fi

{
  echo "| File | Mutation score |"
  echo "|------|----------------|"
} >&3

for file in "${files[@]}"; do
  log="$(mktemp)"
  if pnpm mutation --mutate "$file" >"$log" 2>&1; then
    # Clear-text reporter row: "All files | <score> | <covered> | ..."
    score="$(sed 's/\x1b\[[0-9;]*m//g' "$log" | awk -F'|' '/^All files/ { gsub(/ /, "", $2); print $2 "%" }')"
  else
    score="Stryker failed (see job log)"
    cat "$log"
  fi
  echo "| \`$file\` | ${score:-unknown} |" >&3
  rm -f "$log"
done
