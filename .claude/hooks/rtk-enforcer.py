#!/usr/bin/env python3
"""
RTK Enforcer — PreToolUse hook (rewrite mode)
Mirrors rtk hook behavior for this repo and enforces a hard branch-creation guard.
"""
import json
import os
import re
import shlex
import sys

REWRITES = [
    (r'^grep\b',     lambda cmd: f'rtk {cmd}'),
    (r'^git\b',      lambda cmd: f'rtk {cmd}'),
    (r'^curl\b',     lambda cmd: f'rtk {cmd}'),
    (r'^ls\b',       lambda cmd: f'rtk {cmd}'),
    (r'^find\b',     lambda cmd: f'rtk {cmd}'),
    (r'^wc\b',       lambda cmd: f'rtk {cmd}'),
    (r'^ps\b',       lambda cmd: f'rtk {cmd}'),
    (r'^npx\b',      lambda cmd: f'rtk {cmd}'),
    (r'^npm\b',      lambda cmd: f'rtk {cmd}'),
    (r'^tail\b',     lambda cmd: _rewrite_tail(cmd)),
    (r'^head\b',     lambda cmd: _rewrite_head(cmd)),
    (r'^cat\b',      lambda cmd: _rewrite_cat(cmd)),
]

BRANCH_APPROVAL_ENV = "AUTOPILOT_BRANCH_APPROVAL"
BRANCH_APPROVAL_VALUES = {"1", "true", "yes", "on"}


def _is_approved_to_create_branch(cmd):
    env_val = os.getenv(BRANCH_APPROVAL_ENV, "").strip().lower()
    if env_val in BRANCH_APPROVAL_VALUES:
        return True

    try:
        tokens = shlex.split(cmd)
    except ValueError:
        return False

    if not tokens:
        return False

    for token in tokens[:3]:
        if token.startswith(f"{BRANCH_APPROVAL_ENV}="):
            val = token.split("=", 1)[1].strip().lower()
            if val in BRANCH_APPROVAL_VALUES:
                return True

    return False


def _command_is_branch_create(tokens):
    if not tokens:
        return False

    idx = 0
    if tokens[0] == "rtk":
        if len(tokens) < 2 or tokens[1] != "git":
            return False
        idx = 1

    if tokens[idx] != "git":
        return False

    if len(tokens) <= idx + 1:
        return False

    sub = tokens[idx + 1]
    args = tokens[idx + 2 :]
    options = set(a for a in args if a.startswith("-"))

    if sub == "checkout":
        return bool({"-b", "-B"} & options)

    if sub == "switch":
        return bool({"-c", "--create"} & options)

    if sub == "branch":
        # Creating branch: `git branch <new-branch>` (with optional options).
        # Avoid false positives like -d/-m operations that do not create.
        if any(x in {"-d", "-D", "-m", "-M", "-l", "-a", "--delete", "--move", "--list"} for x in options):
            return False
        return any(not a.startswith("-") for a in args)

    if sub == "worktree":
        return bool({"-b", "--branch"} & options)

    if sub == "push":
        # This can create remote tracking branch when combined with upstream flags.
        return bool({"-u", "--set-upstream", "--set-upstream-to"} & options)

    return False


def _contains_forbidden_branch_command(cmd):
    if _is_approved_to_create_branch(cmd):
        return None

    candidate_cmds = [cmd]
    if any(sep in cmd for sep in ["&&", "||", ";"]):
        # Check each segment in chained commands independently.
        candidate_cmds = [segment.strip() for seg in re.split(r"\s*&&\s*|\s*\|\|\s*|;", cmd)]

    for segment in candidate_cmds:
        if not segment:
            continue
        try:
            tokens = shlex.split(segment)
        except ValueError:
            continue
        if _command_is_branch_create(tokens):
            return segment
    return None


def _rewrite_tail(cmd):
    m_n = re.search(r'-(\d+)', cmd)
    n = m_n.group(1) if m_n else '20'
    parts = cmd.split()
    path = parts[-1] if len(parts) > 1 and not parts[-1].startswith('-') else ''
    return f'rtk read {path} --tail-lines {n}' if path else f'rtk read --tail-lines {n}'


def _rewrite_head(cmd):
    m_n = re.search(r'-(\d+)', cmd)
    n = m_n.group(1) if m_n else '10'
    parts = cmd.split()
    path = parts[-1] if len(parts) > 1 and not parts[-1].startswith('-') else ''
    return f'rtk read {path} --max-lines {n}' if path else f'rtk read --max-lines {n}'


def _rewrite_cat(cmd):
    # Never rewrite redirects or heredocs — those are write operations
    if re.search(r'>>|>(?!>)|\s<<', cmd):
        return None
    parts = cmd.split()
    args = ' '.join(parts[1:]) if len(parts) > 1 else ''
    return f'rtk read {args}' if args else None


def _try_rewrite(cmd):
    cmd = cmd.strip()
    if cmd.startswith('rtk'):
        return None
    for pattern, fn in REWRITES:
        if re.match(pattern, cmd):
            return fn(cmd)
    return None


def _rewrite_compound(cmd):
    """Rewrite every segment of a compound command independently.
    Pipe (|) is excluded — segments after a pipe read from stdin, not files."""
    for sep in ['&&', '||', ';']:
        if sep in cmd:
            segments = cmd.split(sep)
            rewritten_segments = []
            changed = False
            for seg in segments:
                rw = _try_rewrite(seg.strip())
                if rw:
                    rewritten_segments.append(rw)
                    changed = True
                else:
                    rewritten_segments.append(seg.strip())
            if changed:
                return f' {sep} '.join(rewritten_segments)
            return None
    return None


try:
    data = json.load(sys.stdin)
    tool_input = data.get('tool_input', {})
    cmd = tool_input.get('command', '').strip()

    if _contains_forbidden_branch_command(cmd):
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": (
                            "Branch creation is blocked by policy. "
                            "Set AUTOPILOT_BRANCH_APPROVAL=1 or pass "
                            "AUTOPILOT_BRANCH_APPROVAL=1 inline with the command."
                        ),
                    }
                }
            )
        )
        sys.exit(0)

    is_compound = any(sep in cmd for sep in ['&&', '||', ';'])
    if is_compound:
        new_cmd = _rewrite_compound(cmd)
        if new_cmd:
            print(json.dumps({
                'hookSpecificOutput': {
                    'hookEventName': 'PreToolUse',
                    'permissionDecision': 'allow',
                    'permissionDecisionReason': 'RTK enforcer: rewrite',
                    'updatedInput': {**tool_input, 'command': new_cmd},
                }
            }))
        sys.exit(0)

    rewritten = _try_rewrite(cmd)
    if rewritten:
        print(json.dumps({
            'hookSpecificOutput': {
                'hookEventName': 'PreToolUse',
                'permissionDecision': 'allow',
                'permissionDecisionReason': 'RTK enforcer: rewrite',
                'updatedInput': {**tool_input, 'command': rewritten},
            }
        }))

except Exception as e:
    sys.stderr.write(f'[rtk-enforcer] error: {e}\n')
