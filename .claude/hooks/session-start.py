#!/usr/bin/env python3
"""
SessionStart hook — inject Serena memory activation reminder.
Prints a system-reminder that prompts Claude to read mem:core before starting work.
"""
import json, sys

reminder = (
    "Project memory is available in .serena/memories/. "
    "Read mem:core first to orient (source map, infra, and domain memory links). "
    "Follow mem: references for the domain you're working in. "
    "Do not rediscover what is already documented there."
)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": reminder,
    }
}))
