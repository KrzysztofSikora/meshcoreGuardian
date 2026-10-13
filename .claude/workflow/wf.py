#!/usr/bin/env python3
"""State helper and Claude Code hooks for the autonomous change workflow.

Everything the runner (`.claude/workflow/ship`) and the hooks need to know is read from the
artifacts in `context/` and from `.workflow/run.json`, never from chat memory.

  wf.py resolve <S-01 | change-id | #12>     -> "<change-id>\t<roadmap-id>\t<issue>"
  wf.py progress <change-id>                 -> "<ticked> <total>"
  wf.py checkpoint <change-id>               -> "<n>: <name>" and exit 0 when the last ticked phase is a checkpoint
  wf.py verdict <change-id> plan-review|review
  wf.py open-findings <change-id>            -> number of review findings still `Decision: open`
  wf.py check <step> <change-id>             -> exit 0 when the step's artifact is complete
  wf.py run start <change-id> <branch> | step <name> [<key>=<value> ...] | end
  wf.py pr-title <change-id>                 -> PR title from pr-body.md (see pr_title_and_body)
  wf.py pr-body <change-id>                  -> pr-body.md without the line used as the title
  wf.py cost <session.jsonl>                 -> cost, turns and outcome of a `claude -p` session
  wf.py new-comments <in.jsonl> <out.json>   -> PR comments newer than the last agent reply; prints count
  wf.py physical-devices                     -> serials of attached Android devices that are not emulators
  wf.py hook pre-tool | stop                 -> Claude Code hook entry points (JSON on stdin)
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPLY_MARKER = "<!-- workflow:address-pr -->"  # in every comment the runner posts
STEP_STOP_BLOCKS = 3  # how many times the Stop hook sends the agent back per step
VERDICTS = {
    "plan-review": ("READY", "READY WITH NOTES", "NEEDS CHANGES"),
    "review": ("APPROVE", "APPROVE WITH FOLLOW-UPS", "CHANGES REQUESTED"),
}


def root() -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    return Path(out.stdout.strip() or ".")


def change_dir(change_id: str) -> Path:
    return root() / "context" / "changes" / change_id


def run_file() -> Path:
    return root() / ".workflow" / "run.json"


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


# ---------------------------------------------------------------------------- artifacts


def roadmap_rows() -> list[dict[str, str]]:
    """Rows of the first Markdown table in context/roadmap.md that has an `ID` column."""
    header: list[str] | None = None
    rows: list[dict[str, str]] = []
    for line in read_text(root() / "context" / "roadmap.md").splitlines():
        if not line.strip().startswith("|"):
            if header and rows:
                break
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if header is None:
            if any(c.lower() == "id" for c in cells):
                header = [c.lower() for c in cells]
            continue
        if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
            continue
        rows.append(dict(zip(header, cells)))
    return rows


def pr_title_and_body(change_id: str) -> tuple[str, str]:
    """Title and body for the PR. The title is the first `# ` line; without one, the first
    non-empty line when it is plain text (not a heading, list, table, quote or comment);
    otherwise a generated `wip(<change-id>): <roadmap ID>`. The line used as the title is
    dropped from the body."""
    lines = read_text(change_dir(change_id) / "pr-body.md").splitlines()
    pick = next((i for i, line in enumerate(lines) if line.startswith("# ")), None)
    if pick is not None:
        title = lines[pick][2:].strip()
    else:
        pick = next((i for i, line in enumerate(lines) if line.strip()), None)
        if pick is not None and (re.match(r"\s*(#|-|\*|\||<!--|>)", lines[pick])
                                 or len(lines[pick].strip()) > 200):
            pick = None
        title = lines[pick].strip() if pick is not None else ""
    if not title:
        pick = None
        try:
            roadmap_id = resolve(change_id)[1]
        except SystemExit:
            roadmap_id = ""
        title = f"wip({change_id}): {roadmap_id or change_id}"
    body = lines if pick is None else lines[:pick] + lines[pick + 1:]
    while body and not body[0].strip():
        body = body[1:]
    return title, "\n".join(body) + "\n"


def resolve(arg: str) -> tuple[str, str, str]:
    needle = arg.strip().lstrip("#")
    for row in roadmap_rows():
        issue = row.get("issue", "").lstrip("#")
        if needle in (row.get("id", ""), row.get("change-id", "")) or (issue and needle == issue):
            return row.get("change-id", ""), row.get("id", ""), issue
    raise SystemExit(f"'{arg}' is not in the Overview table of context/roadmap.md")


def progress(change_id: str) -> tuple[int, int]:
    text = read_text(change_dir(change_id) / "plan.md")
    section = text.split("## Progress", 1)[1] if "## Progress" in text else ""
    section = section.split("\n## ", 1)[0]
    phases = re.findall(r"^\s*- \[( |x|X)\] Phase", section, re.M)
    return sum(1 for p in phases if p.lower() == "x"), len(phases)


def checkpoint(change_id: str) -> str:
    """The last ticked phase, as "<n>: <name>", when /plan marked it "(checkpoint)"; else ""."""
    text = read_text(change_dir(change_id) / "plan.md")
    section = text.split("## Progress", 1)[1] if "## Progress" in text else ""
    section = section.split("\n## ", 1)[0]
    ticked = re.findall(r"^\s*- \[[xX]\] Phase\s+(\d+):?\s*(.*?)\s*$", section, re.M)
    if not ticked:
        return ""
    number, name = ticked[-1]
    if not re.search(r"\(checkpoint\)", name, re.I):
        return ""
    name = re.sub(r"\s*\(checkpoint\)", "", name, flags=re.I)
    return f"{number}: {name}"


def verdict(change_id: str, kind: str) -> str:
    text = read_text(change_dir(change_id) / f"{kind}.md")
    match = re.search(r"^Verdict:\s*\**\s*([A-Z][A-Z -]*[A-Z])", text, re.M)
    found = match.group(1).strip() if match else ""
    return found if found in VERDICTS[kind] else ""


def open_findings(change_id: str) -> int:
    return len(re.findall(r"^- Decision:\s*open\b", read_text(change_dir(change_id) / "review.md"), re.M))


def git_clean() -> bool:
    out = subprocess.run(["git", "status", "--porcelain"], cwd=root(), capture_output=True, text=True)
    return out.returncode == 0 and out.stdout.strip() == ""


def current_branch() -> str:
    out = subprocess.run(["git", "branch", "--show-current"], cwd=root(), capture_output=True, text=True)
    return out.stdout.strip()


# ---------------------------------------------------------------------------- run state


def load_run() -> dict:
    """The active run, or {} when none is active (missing file or the runner process died)."""
    try:
        run = json.loads(run_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    pid = run.get("pid")
    if isinstance(pid, int):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return {}
        except PermissionError:
            pass
    return run


def save_run(run: dict) -> None:
    run_file().parent.mkdir(parents=True, exist_ok=True)
    run_file().write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")


def newer(path: Path, since: float) -> bool:
    try:
        return path.stat().st_mtime >= since
    except OSError:
        return False


def check(step: str, change_id: str, run: dict) -> str:
    """Empty string when the step is complete, otherwise what is still missing."""
    if (root() / ".workflow" / "stuck").exists():
        return ""
    d = change_dir(change_id)
    since = float(run.get("step_started", 0))
    if step == "plan":
        _, total = progress(change_id)
        text = read_text(d / "plan.md")
        if total == 0:
            return f"{d / 'plan.md'} has no phases under '## Progress' ('- [ ] Phase 1: ...')."
        if "## Decisions" not in text:
            return "plan.md has no '## Decisions' table."
        return ""
    if step in VERDICTS:
        if not newer(d / f"{step}.md", since):
            return f"{d / (step + '.md')} was not written in this step."
        if not verdict(change_id, step):
            return f"{step}.md needs a 'Verdict: {' | '.join(VERDICTS[step])}' line."
        return ""
    if step == "implement":
        ticked, _ = progress(change_id)
        if ticked <= int(run.get("ticked_before", 0)):
            return "No new phase is ticked in plan.md '## Progress'. Finish and commit the phase."
        if not git_clean():
            return "The working tree is not clean. Commit the phase (files by explicit path)."
        return ""
    if step == "mutation":
        return "" if newer(d / "mutation.md", since) else "mutation.md was not written in this step."
    if step == "fix-review":
        n = open_findings(change_id)
        if n:
            return f"{n} finding(s) in review.md still have 'Decision: open'."
        if not git_clean():
            return "The working tree is not clean. Commit the fixes."
        return ""
    if step == "pr-body":
        return "" if newer(d / "pr-body.md", since) else "pr-body.md was not written in this step."
    if step == "address-pr":
        replies = root() / ".workflow" / f"pr-{run.get('pr', '')}" / "replies.md"
        if not newer(replies, since):
            return f"{replies} was not written in this step."
        if not git_clean():
            return "The working tree is not clean. Commit the changes."
        return ""
    return ""


# ---------------------------------------------------------------------------- hooks

# `git` plus global options (`-C dir`, `-c k=v`, `--no-pager`), so the rules match the
# subcommand and not a word inside a commit message.
GIT = r"\bgit\s+(?:-[Cc]\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*"

# Only enforced inside runner sessions, so interactive work is not affected.
GIT_RULES = [
    (GIT + r"push\b", "The runner pushes the branch itself. Do not push."),
    (r"\bgh\s+pr\s+(merge|create|close|ready)\b", "The runner and the person own the PR. Do not change it."),
    (r"--no-verify\b", "Never bypass git hooks. Fix what the hook reports."),
    (GIT + r"reset\s+--hard\b", "No `git reset --hard` during a run."),
    (GIT + r"clean\s+-\w*f", "No `git clean` during a run."),
    (GIT + r"add\s+(-A\b|--all\b|\.(\s|$)|-u\b|\*)", "Stage files by explicit path, not in bulk."),
    (GIT + r"(switch|rebase|merge)\b", "Stay on the change branch. Do not switch, rebase or merge."),
    (GIT + r"checkout\s+(-b\b|-B\b|main\b|master\b)", "Stay on the change branch."),
]


# Android device access (project rule: agents use the emulator only; a real phone may hold
# personal data, so it is touched only by the person, never by an autonomous session).
DEVICE_TOOLS = re.compile(
    r"\b(adb|maestro|scrcpy|gradlew\s+\S*install\w*)\b"
    r"|\bexpo\s+run:android\b|\bpnpm\b[^;&|]*\b(android|e2e)\b|\bscripts/e2e\.sh\b")
WIRELESS_ATTACH = re.compile(r"\badb\s+(?:-\S+\s+)*(connect|pair)\b")
NAMED_DEVICE = re.compile(r"(?:\badb\s+-s|--device|--serial|ANDROID_SERIAL=)\s*['\"]?([^\s'\";&|]+)")


def physical_devices() -> list[str]:
    """Serials of attached Android devices (any state) that are not emulators."""
    sdk = os.environ.get("ANDROID_HOME") or str(Path.home() / "Android" / "Sdk")
    adb = Path(sdk) / "platform-tools" / "adb"
    try:
        out = subprocess.run([str(adb) if adb.exists() else "adb", "devices"],
                             capture_output=True, text=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    serials = [line.split()[0] for line in out.splitlines()[1:] if line.strip()]
    return [s for s in serials if not s.startswith("emulator-")]


def device_violation(command: str) -> str:
    """Why a command must not run in an autonomous session, or "" when it may."""
    if not DEVICE_TOOLS.search(command):
        return ""
    if WIRELESS_ATTACH.search(command):
        return "Do not attach Android devices (adb connect/pair)."
    for serial in NAMED_DEVICE.findall(command):
        if not serial.startswith("emulator-") and not serial.startswith("$"):
            return f"Device '{serial}' is not an emulator."
    phones = physical_devices()
    if phones:
        return (f"A physical Android device is attached ({', '.join(phones)}). Device commands "
                "are blocked until it is disconnected.")
    return ""


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


def in_runner_session() -> dict:
    """The active run, but only inside a session the runner started (it exports WORKFLOW_RUN),
    so a person's interactive session in the same repo is never affected."""
    run = load_run()
    return run if run and os.environ.get("WORKFLOW_RUN") == run.get("change_id") else {}


def hook_pre_tool(event: dict) -> None:
    run = in_runner_session()
    if not run:
        return
    tool = event.get("tool_name", "")
    if tool == "AskUserQuestion":
        deny("Autonomous run: nobody will answer. Decide using .claude/workflow/autonomy.md, "
             "record the choice in the plan's Decisions table (with alternatives and reversal "
             "cost), and continue. The person reviews it in the PR.")
        return
    if tool != "Bash":
        return
    command = str(event.get("tool_input", {}).get("command", ""))
    for pattern, reason in GIT_RULES:
        if re.search(pattern, command):
            deny(f"Autonomous run guard: {reason} See .claude/workflow/autonomy.md section 4.")
            return
    device = device_violation(command)
    if device:
        deny(f"Autonomous run guard: {device} Agents use only the `guardian` emulator; checks "
             "on a real phone are human checks in the PR (CLAUDE.md, Rules).")
        return
    if re.search(GIT + r"commit\b", command) and current_branch() != run.get("branch"):
        deny(f"Autonomous run guard: commit only on {run.get('branch')} "
             f"(current branch: {current_branch() or 'detached'}).")


def hook_stop(event: dict) -> None:
    run = in_runner_session()
    step = run.get("step")
    if not step:
        return
    missing = check(step, run.get("change_id", ""), run)
    if not missing:
        return
    blocks = int(run.get("stop_blocks", 0))
    if blocks >= STEP_STOP_BLOCKS:
        return  # let it stop; the runner records the step as failed
    run["stop_blocks"] = blocks + 1
    save_run(run)
    print(json.dumps({
        "decision": "block",
        "reason": (f"Step '{step}' is not finished: {missing} Do not ask the user; nobody is "
                   "watching. Finish the step following .claude/workflow/autonomy.md, or, if you "
                   "are truly stuck, follow its section 5 (write .workflow/stuck) and stop."),
    }))


# ---------------------------------------------------------------------------- CLI


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, args = argv[0], argv[1:]
    if cmd == "resolve":
        print("\t".join(resolve(args[0])))
    elif cmd == "progress":
        print(*progress(args[0]))
    elif cmd == "checkpoint":
        found = checkpoint(args[0])
        if not found:
            return 1
        print(found)
    elif cmd == "verdict":
        print(verdict(args[0], args[1]))
    elif cmd == "open-findings":
        print(open_findings(args[0]))
    elif cmd == "check":
        missing = check(args[0], args[1], load_run())
        if missing:
            print(missing)
            return 1
    elif cmd == "run":
        sub = args[0]
        if sub == "start":
            save_run({"change_id": args[1], "branch": args[2], "pid": os.getppid(),
                      "started": time.time()})
        elif sub == "step":
            run = load_run() or json.loads(read_text(run_file()) or "{}")
            run.update({"step": args[1], "step_started": time.time() - 1, "stop_blocks": 0})
            for pair in args[2:]:
                key, _, value = pair.partition("=")
                run[key] = int(value) if value.isdigit() else value
            save_run(run)
        elif sub == "end":
            run_file().unlink(missing_ok=True)
    elif cmd == "pr-title":
        print(pr_title_and_body(args[0])[0])
    elif cmd == "pr-body":
        sys.stdout.write(pr_title_and_body(args[0])[1])
    elif cmd == "cost":
        result: dict = {}
        for line in read_text(Path(args[0])).splitlines():
            if line.startswith("{") and '"type":"result"' in line.replace(" ", ""):
                result = json.loads(line)
        if not result:
            print("no result (session crashed?)")
        else:
            print(f"${result.get('total_cost_usd', 0):.2f}, {result.get('num_turns', '?')} turns, "
                  f"{result.get('subtype', '?')}{' (error)' if result.get('is_error') else ''}")
    elif cmd == "new-comments":
        items = [json.loads(line) for line in read_text(Path(args[0])).splitlines() if line.strip()]
        replied = [i["created_at"] for i in items if REPLY_MARKER in (i.get("body") or "")]
        since = max(replied, default="")
        fresh = [i for i in items
                 if (i.get("body") or "").strip() and REPLY_MARKER not in i["body"]
                 and i["created_at"] > since]
        fresh.sort(key=lambda i: i["created_at"])
        Path(args[1]).write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")
        print(len(fresh))
    elif cmd == "physical-devices":
        print("\n".join(physical_devices()))
    elif cmd == "hook":
        try:
            event = json.load(sys.stdin)
        except ValueError:
            event = {}
        {"pre-tool": hook_pre_tool, "stop": hook_stop}[args[0]](event)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
