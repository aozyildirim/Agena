#!/usr/bin/env python3
"""Rewrite import paths for monorepo package split.

Usage: python scripts/rewrite_imports.py [--dry-run]
"""
import os
import re
import sys

# Longest prefix first to avoid partial matches
REPLACEMENTS = [
    # from X.y import z
    ("from integrations.", "from agena_services.integrations."),
    ("from services.",     "from agena_services.services."),
    ("from security.",     "from agena_core.security."),
    ("from config.",       "from agena_core.config."),
    ("from models.",       "from agena_models.models."),
    ("from schemas.",      "from agena_models.schemas."),
    ("from agents.",       "from agena_agents.agents."),
    ("from memory.",       "from agena_agents.memory."),
    ("from workers.",      "from agena_worker.workers."),
    ("from core.",         "from agena_core."),
    ("from db.",           "from agena_core.db."),
    ("from api.",          "from agena_api.api."),
    # import X.y
    ("import integrations.", "import agena_services.integrations."),
    ("import services.",     "import agena_services.services."),
    ("import security.",     "import agena_core.security."),
    ("import config.",       "import agena_core.config."),
    ("import models.",       "import agena_models.models."),
    ("import schemas.",      "import agena_models.schemas."),
    ("import agents.",       "import agena_agents.agents."),
    ("import memory.",       "import agena_agents.memory."),
    ("import workers.",      "import agena_worker.workers."),
    ("import core.",         "import agena_core."),
    ("import db.",           "import agena_core.db."),
    ("import api.",          "import agena_api.api."),
]

# Directories to scan (new package locations)
SCAN_DIRS = [
    "packages/core/src",
    "packages/models/src",
    "packages/services/src",
    "packages/agents/src",
    "packages/api/src",
    "packages/worker/src",
    "alembic",
]

SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".next", "frontend"}


def rewrite_line(line: str) -> str:
    stripped = line.lstrip()
    for old, new in REPLACEMENTS:
        if stripped.startswith(old):
            return line.replace(old, new, 1)
    return line


def process_file(filepath: str, dry_run: bool) -> int:
    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    lines = original.split("\n")
    new_lines = [rewrite_line(line) for line in lines]
    new_content = "\n".join(new_lines)

    if new_content == original:
        return 0

    changes = sum(1 for o, n in zip(lines, new_lines) if o != n)

    if dry_run:
        print(f"  {filepath} ({changes} lines)")
        for i, (o, n) in enumerate(zip(lines, new_lines), 1):
            if o != n:
                print(f"    L{i}: {o.strip()}")
                print(f"      → {n.strip()}")
    else:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"  {filepath} ({changes} rewrites)")

    return changes


def main():
    dry_run = "--dry-run" in sys.argv
    total = 0

    if dry_run:
        print("=== DRY RUN — no files will be modified ===\n")

    for scan_dir in SCAN_DIRS:
        for root, dirs, files in os.walk(scan_dir):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if not f.endswith(".py"):
                    continue
                total += process_file(os.path.join(root, f), dry_run)

    print(f"\nTotal rewrites: {total}")


if __name__ == "__main__":
    main()
