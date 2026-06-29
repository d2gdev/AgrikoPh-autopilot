#!/usr/bin/env python3
"""
GROW automation — runs at session Stop.
Mechanical: auto-stamps last_updated on .mex/ files changed this session.
Judgment: emits a systemMessage reminder when source files changed.
"""
import json
import re
import subprocess
from datetime import datetime
from pathlib import Path

PROJECT = Path("/mnt/c/Users/Sean/Documents/Agriko/autopilot-app")
TODAY = datetime.now().strftime("%Y-%m-%d")

try:
    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=PROJECT, capture_output=True, text=True, timeout=5
    )
    lines = result.stdout.strip().splitlines()
    all_changed = [line[3:].strip() for line in lines if line.strip()]
except Exception:
    all_changed = []

mex_changed = [f for f in all_changed if f.startswith(".mex/") and f.endswith(".md")]
source_changed = [
    f for f in all_changed
    if not f.startswith(".mex/") and not f.startswith(".claude/")
]

# Mechanical: stamp last_updated on any .mex/ file modified this session
stamped = []
for rel in mex_changed:
    path = PROJECT / rel
    if path.exists():
        content = path.read_text()
        new_content = re.sub(r"last_updated:.*", f"last_updated: {TODAY}", content)
        if new_content != content:
            path.write_text(new_content)
            stamped.append(rel)

parts = []
if stamped:
    parts.append(f"GROW: stamped last_updated on {len(stamped)} scaffold file(s).")

if source_changed:
    preview = ", ".join(source_changed[:6])
    if len(source_changed) > 6:
        preview += f" (+{len(source_changed) - 6} more)"
    parts.append(
        f"GROW reminder: {len(source_changed)} source file(s) changed this session.\n"
        f"Check .mex/ROUTER.md 'Current Project State' — update if what's working/built changed.\n"
        f"Changed: {preview}"
    )

if parts:
    print(json.dumps({"systemMessage": "\n".join(parts)}))
