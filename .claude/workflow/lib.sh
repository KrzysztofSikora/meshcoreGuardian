# Shared by .claude/workflow/ship and .claude/workflow/address-pr. Source it from the repo root.
# shellcheck shell=bash

HERE=.claude/workflow
WF="python3 $HERE/wf.py"
# shellcheck source=config.sh
source "$HERE/config.sh"

die() { echo "$(basename "$0"): $*" >&2; exit 1; }
note() { echo "[$(basename "$0") $(date +%H:%M:%S)] $*" | tee -a "$SUMMARY" >&2; }

# Agents use only the emulator: a real phone may hold personal data (CLAUDE.md, Rules).
phones_attached() { $WF physical-devices | paste -sd, -; }

# stops_on <plan|checkpoint>: whether WORKFLOW_STOPS asks the run to stop there.
stops_on() { case ",$WORKFLOW_STOPS," in *,all,*|*",$1,"*) return 0 ;; esac; return 1; }
check_stops() {
  local s
  for s in ${WORKFLOW_STOPS//,/ }; do
    case $s in none|plan|checkpoint|all) ;; *) die "unknown stop '$s' (use none, plan, checkpoint or all)" ;; esac
  done
}

# begin_run <change-id> <title line>: branch must already be checked out.
begin_run() {
  local phones
  phones=$(phones_attached)
  [ -z "$phones" ] || die "physical Android device attached ($phones). Disconnect it (or turn off USB/wireless debugging) and start again."
  CHANGE=$1
  BRANCH=$(git branch --show-current)
  LOGS=.workflow/logs/$CHANGE
  SUMMARY=.workflow/run-summary.md
  mkdir -p "$LOGS" "context/changes/$CHANGE"
  rm -f .workflow/stuck
  printf '# %s\n\nBranch: %s · Started: %s\n\n' "$2" "$BRANCH" "$(date -Iseconds)" > "$SUMMARY"
  N=$(find "$LOGS" -name '*.jsonl' | wc -l)
  FAILED="" STOPPED=""
  $WF run start "$CHANGE" "$BRANCH"
  export WORKFLOW_RUN=$CHANGE   # hooks act only in sessions that inherit this
  trap '$WF run end' EXIT

  CLAUDE_ARGS=(--permission-mode "$WORKFLOW_PERMISSION_MODE" --permission-prompts none
    --disallowedTools AskUserQuestion --output-format stream-json --verbose
    --append-system-prompt "Autonomous run of change '$CHANGE' on branch '$BRANCH'. Nobody will answer questions until the pull request. Follow .claude/workflow/autonomy.md.")
  [ -z "$WORKFLOW_STEP_BUDGET_USD" ] || CLAUDE_ARGS+=(--max-budget-usd "$WORKFLOW_STEP_BUDGET_USD")
}

# Commit the step's documents (only context/ files) so the next step starts from a clean tree.
commit_docs() {
  local p existing=() msg=(-m "docs($CHANGE): $1")
  for p in "context/changes/$CHANGE" context/roadmap.md context/lessons.md; do
    [ -e "$p" ] && existing+=("$p")
  done
  [ -n "$(git status --porcelain -- "${existing[@]}")" ] || return 0
  [ -z "${ISSUE:-}" ] || msg+=(-m "Refs #$ISSUE")
  git add -- "${existing[@]}"
  git commit --quiet "${msg[@]}" || note "commit of $1 artifacts failed (see the hook output above)"
}

# step_model <step> <attempt (0 = first)>: the model for one session, empty for the CLI default.
step_model() {
  local var
  if [ -n "$WORKFLOW_MODEL" ]; then echo "$WORKFLOW_MODEL"; return; fi
  if [ "$2" -gt 0 ] && [ -n "$WORKFLOW_MODEL_RETRY" ]; then echo "$WORKFLOW_MODEL_RETRY"; return; fi
  var=WORKFLOW_MODEL_$(echo "$1" | tr 'a-z-' 'A-Z_')
  echo "${!var:-}"
}

# Emulators and Gradle/Kotlin daemons that a session starts outlive it and together hold 15-20 GB;
# left running, a later session runs the machine out of memory. After each session, stop the ones
# that were not running before it (an emulator the person started stays up).
heavy_pids() { { pgrep -f 'qemu-system|GradleDaemon|KotlinCompileDaemon' || true; } | sort; }
reap_leftovers() {
  local new pid
  [ "$WORKFLOW_REAP_TOOLS" = 1 ] || return 0
  new=$(comm -13 <(echo "$1") <(heavy_pids))
  [ -n "$new" ] || return 0
  note "  stopping emulator/Gradle processes left by the session: $(echo "$new" | paste -sd' ' -)"
  for pid in $new; do kill "$pid" 2>/dev/null || true; done
  for _ in $(seq 1 30); do
    for pid in $new; do kill -0 "$pid" 2>/dev/null && break; pid=""; done
    [ -n "$pid" ] || return 0
    sleep 1
  done
  for pid in $new; do kill -9 "$pid" 2>/dev/null || true; done
}

# run_step <name> <prompt> [key=value ...]
# One fresh headless session per attempt; retried while the step's artifact is incomplete.
run_step() {
  local name=$1 prompt=$2 attempt missing="" log phones model before
  shift 2
  for attempt in $(seq 0 "$WORKFLOW_STEP_RETRIES"); do
    phones=$(phones_attached)
    if [ -n "$phones" ]; then
      FAILED="$name: stopped because a physical Android device is attached ($phones)"
      return 1
    fi
    N=$((N + 1))
    log=$(printf '%s/%02d-%s.jsonl' "$LOGS" "$N" "$name")
    model=$(step_model "$name" "$attempt")
    note "step $name (attempt $((attempt + 1)), model ${model:-default}): $prompt"
    $WF run step "$name" "$@"
    before=$(heavy_pids)
    claude -p "$prompt" "${CLAUDE_ARGS[@]}" ${model:+--model "$model"} > "$log" 2>&1 || note "  claude exited non-zero, see $log"
    reap_leftovers "$before"
    note "  $($WF cost "$log")"
    if [ -f .workflow/stuck ]; then
      FAILED="$name: agent stuck: $(cat .workflow/stuck)"
      return 1
    fi
    if missing=$($WF check "$name" "$CHANGE"); then
      case "$name" in plan|plan-review|review|mutation|pr-body) commit_docs "$name" ;; esac
      return 0
    fi
    note "  incomplete: $missing"
  done
  FAILED="$name: incomplete after $((WORKFLOW_STEP_RETRIES + 1)) attempts: $missing"
  return 1
}

# One implement session per unticked phase. With checkpoint stops, it returns 0 with STOPPED set
# after a phase marked "(checkpoint)" when phases remain; the next run continues from there.
implement_loop() {
  local ticked total guard=0 cp
  read -r ticked total < <($WF progress "$CHANGE")
  while [ "$ticked" -lt "$total" ]; do
    guard=$((guard + 1))
    if [ "$guard" -gt "$WORKFLOW_MAX_PHASES" ]; then
      FAILED="implement: more than $WORKFLOW_MAX_PHASES phase sessions"
      return 1
    fi
    run_step implement "/implement $CHANGE" "ticked_before=$ticked" || return 1
    read -r ticked total < <($WF progress "$CHANGE")
    if [ "$ticked" -lt "$total" ] && stops_on checkpoint && cp=$($WF checkpoint "$CHANGE"); then
      STOPPED="checkpoint"
      DRAFT_REASON="Stopped at the checkpoint after Phase $cp, as asked (stops: $WORKFLOW_STOPS). Do that phase's human checks (CI APK), comment on this PR, then run \`.claude/workflow/address-pr <this PR>\` to apply the comments and continue, or \`.claude/workflow/ship $CHANGE\` to continue without changes."
      note "checkpoint: stopping after Phase $cp ($ticked/$total phases done)"
      return 0
    fi
  done
}

# review -> fix-review, up to <rounds> reviews. Open findings are triaged even when the verdict
# is APPROVE (minors); a re-review happens only after fixing blockers or majors.
review_loop() {
  local rounds=$1 round=0 verdict
  while :; do
    round=$((round + 1))
    run_step review "/review $CHANGE" || return 1
    verdict=$($WF verdict "$CHANGE" review)
    note "review round $round: $verdict, $($WF open-findings "$CHANGE") open finding(s)"
    [ "$($WF open-findings "$CHANGE")" -gt 0 ] || return 0
    run_step fix-review "/fix-review $CHANGE" || return 1
    [ "$verdict" != "APPROVE" ] && [ "$round" -lt "$rounds" ] || return 0
  done
}

# Keep unfinished work for the person. Tracked changes are always committed. Untracked files
# are committed only when a step failed (they may be the agent's unfinished new files); after a
# successful run they are build output or junk, so they are listed and left alone. Hooks still
# run (e.g. a secret scan); if they refuse the commit, the work is stashed locally instead.
save_leftovers() {
  local untracked
  untracked=$(git ls-files --others --exclude-standard)
  if [ -n "$untracked" ] && [ -z "$FAILED" ]; then
    note "untracked files left in the tree (not committed; consider .gitignore): $(echo "$untracked" | tr '\n' ' ')"
  fi
  if [ -n "$FAILED" ]; then git add -A; else git add -u; fi
  git diff --cached --quiet && return 0
  local subject="wip($CHANGE): changes left after the run"
  [ -z "$FAILED" ] || subject="wip($CHANGE): unfinished work from step ${FAILED%%:*}"
  if git commit --quiet -m "$subject"; then
    note "committed leftover changes as WIP"
  else
    git reset --quiet
    git stash push --quiet --include-untracked -m "$CHANGE: leftover work"
    note "leftover changes failed the commit hooks and were stashed locally (git stash list)"
  fi
}

# write_pr_body: regenerate pr-body.md from the artifacts (fallback: the run summary).
write_pr_body() {
  local failed=$FAILED
  {
    echo
    echo "## Outcome"
    echo "- Failed step: ${failed:-none}"
    echo "- Draft reason: ${DRAFT_REASON:-none}"
    echo "- Plan review: $($WF verdict "$CHANGE" plan-review)"
    echo "- Review: $($WF verdict "$CHANGE" review) ($($WF open-findings "$CHANGE") open findings)"
    echo "- Phases ticked: $($WF progress "$CHANGE" | tr ' ' '/')"
  } >> "$SUMMARY"
  rm -f .workflow/stuck
  run_step pr-body "/pr-body $CHANGE" || {
    note "pr-body failed; falling back to the run summary"
    { echo "# wip($CHANGE): ${ROADMAP_ID:-$CHANGE}"; echo; cat "$SUMMARY"; } > "context/changes/$CHANGE/pr-body.md"
    commit_docs pr-body
  }
  FAILED=$failed
}

# check_remote_access: before any session, make sure the run can push its branch and open the
# PR, so a run never does all its work and then fails at the end. Without an origin remote the
# run ends with a local description instead, so there is nothing to check.
check_remote_access() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 0
  git ls-remote origin >/dev/null 2>&1 \
    || die "cannot read origin ($url). Fix git access (SSH agent or HTTPS credentials) and start again."
  git push --dry-run --quiet origin "HEAD:refs/heads/workflow-preflight-check" >/dev/null 2>&1 \
    || die "origin refuses a push (dry run to $url). Fix push access and start again."
  command -v gh >/dev/null || die "gh CLI not found; it is needed to open the PR"
  gh auth status >/dev/null 2>&1 || die "gh is not logged in; run: gh auth login"
}

# publish_pr <base>: push the branch, then create the PR or update its title and body.
# Prints the PR URL. A draft PR means the agent did not reach a reviewable end state.
# Uses the REST API: `gh pr edit` fails on repositories where GitHub's GraphQL still reports
# deprecated Projects (classic) fields.
publish_pr() {
  local base=$1 title body draft=false owner number
  title=$($WF pr-title "$CHANGE")
  body=.workflow/pr-body-$CHANGE.md
  mkdir -p .workflow
  $WF pr-body "$CHANGE" > "$body"
  if [ -n "$FAILED${DRAFT_REASON:-}" ] || [ "$($WF open-findings "$CHANGE")" -gt 0 ]; then
    draft=true
  fi
  if ! git remote get-url origin >/dev/null 2>&1 || ! command -v gh >/dev/null; then
    note "PR not opened (no origin remote or no gh). Description: context/changes/$CHANGE/pr-body.md"
    return 0
  fi
  if ! git push --quiet -u origin "$BRANCH"; then
    note "push of $BRANCH failed, nothing was published. Fix access, then run: .claude/workflow/ship $CHANGE --publish-only"
    return 1
  fi
  owner=$(gh api "repos/{owner}/{repo}" --jq .owner.login)
  number=$(gh api "repos/{owner}/{repo}/pulls?state=open&head=$owner:$BRANCH" --jq '.[0].number // empty')
  if [ -n "$number" ]; then
    PR_URL=$(gh api -X PATCH "repos/{owner}/{repo}/pulls/$number" -f title="$title" -F "body=@$body" --jq .html_url)
    [ "$draft" = true ] || gh pr ready "$number" >/dev/null 2>&1 || true
  else
    PR_URL=$(gh api -X POST "repos/{owner}/{repo}/pulls" -f title="$title" -f head="$BRANCH" \
      -f base="$base" -F "body=@$body" -F draft="$draft" --jq .html_url)
  fi
  note "PR: $PR_URL$([ "$draft" = true ] && echo " (draft)")"
}
