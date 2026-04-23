# Team Skill Catalog

Skills are **reusable solution patterns** distilled from completed tasks.
Every time a task finishes, the Skill Librarian extracts a generic
recipe (name, approach, prompt fragment, touched files, tags) and stores
it in Qdrant + MySQL. When a new task arrives that looks similar, the
top-N skills are prepended to the agent's system prompt — past
solutions compound rather than getting rediscovered.

## End-to-end flow

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. TASK COMPLETES                                                      │
├────────────────────────────────────────────────────────────────────────┤
│   task.status = 'completed'  (any execution mode)                      │
│     ▼                                                                  │
│   orchestration_service fires a fire-and-forget:                       │
│   asyncio.create_task(run_skill_extraction_job(org_id, task_id))       │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 2. EXTRACTION (Skill Librarian)                                        │
├────────────────────────────────────────────────────────────────────────┤
│   SkillExtractor.extract_from_task():                                  │
│     1. Guard: skip if a skill for this source_task_id already exists   │
│     2. Gather context = title + description + branch + PR URL +        │
│        last run's reviewed_code (up to 2.5k chars)                     │
│     3. Resolve LLM in priority order:                                  │
│          OpenAI → Claude CLI → Codex CLI                               │
│     4. Structured output: {                                            │
│          name, description, pattern_type, tags, approach_summary,      │
│          prompt_fragment, confidence                                   │
│        }                                                               │
│     5. If confidence < 50 → skip (too unique to generalise)            │
│     6. Create Skill row + Qdrant vector via SkillService.create()      │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 3. STORAGE                                                             │
├────────────────────────────────────────────────────────────────────────┤
│   MySQL 'skills' table (listing, stats, CRUD):                         │
│     id, organization_id, source_task_id, name, description,            │
│     pattern_type, tags[], touched_files[], approach_summary,           │
│     prompt_fragment, qdrant_key, usage_count, last_used_at             │
│                                                                        │
│   Qdrant 'task_memory' collection, shared with refinement but          │
│   filtered by payload.kind='skill':                                    │
│     input = name + description + approach_summary + touched_files      │
│     payload = { kind='skill', skill_id, organization_id,               │
│                 name, pattern_type, tags, touched_files }              │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 4. RETRIEVAL (before every agent run)                                  │
├────────────────────────────────────────────────────────────────────────┤
│   orchestration_service.run_ai_task() — at the top, before any         │
│   execution-mode branch:                                               │
│     ▼                                                                  │
│   SkillService.find_relevant(title, description, limit=3)              │
│     1. Embed query (title + desc) via Gemini / OpenAI                  │
│     2. Qdrant search: extra_filters={'kind': 'skill'}                  │
│     3. Drop hits below cosine 0.55 (absolute floor)                    │
│     4. Drop hits more than 0.06 below the top score (relative gap)     │
│     5. Classify tiers by absolute score:                               │
│          strong ≥ 0.82, related ≥ 0.72, weak otherwise                 │
│     6. Bump usage_count + last_used_at for returned hits               │
│     ▼                                                                  │
│   If hits → prepend to effective_description:                          │
│     --- RELEVANT TEAM SKILLS (from prior completed tasks) ---          │
│       1. [pattern_type] name                                           │
│          Yaklaşım: approach_summary                                    │
│          prompt_fragment                                               │
│          (tags: … | files: … | used N times)                           │
│     --- END SKILLS ---                                                 │
│                                                                        │
│     (followed by the original task description)                        │
│                                                                        │
│   Every execution branch — Claude CLI, Codex CLI, MCP Agent, classic   │
│   pipeline — consumes effective_description, so all four modes pick    │
│   up the skills block for free.                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Skill vs Agent vs Refinement

| | Agent | Skill | Refinement item |
|---|---|---|---|
| What | WHO does work (a role + model) | WHAT the team has learnt | Historical task used for SP estimation |
| Example | "AI Planner" | "PHP null-safety fix pattern" | "#62840 - Login throttling (3 SP, Ali)" |
| Used by | Pipeline orchestration | Any agent's system prompt | Refinement service only |
| Stored in | DB `agent_overrides` + Prompt Studio | DB `skills` + Qdrant (kind=skill) | Qdrant only (kind=completed_task) |
| Built from | Manual config | Auto-extracted from completed tasks (or manual) | Backfilled from Azure/Jira closed items |

## Key files

| Concern | File |
|---|---|
| ORM model | `packages/models/src/agena_models/models/skill.py` |
| Pydantic schemas | `packages/models/src/agena_models/schemas/skill.py` |
| CRUD + vector search | `packages/services/src/agena_services/services/skill_service.py` |
| Auto-extraction (LLM + CLI fallback) | `packages/services/src/agena_services/services/skill_extractor.py` |
| Migration (table) | `alembic/versions/7b924c519bfc_add_skills_table.py` |
| Migration (module entry) | `alembic/versions/3528e72ff789_register_skills_module.py` |
| HTTP API | `packages/api/src/agena_api/api/routes/skills.py` |
| Orchestration injection | `packages/services/src/agena_services/services/orchestration_service.py` (~line 199) |
| Catalog UI | `frontend/app/dashboard/skills/page.tsx` |

## Tuning knobs (in SkillService)

- `SIMILAR_MIN_SCORE = 0.55` — absolute floor. Below this is noise.
- `SIMILAR_MAX_GAP = 0.06` — drop hits that are much worse than the top.
- `TIER_STRONG_SCORE = 0.82` — cosine ≥ this gets the ÇOK YAKIN chip.
- `TIER_RELATED_SCORE = 0.72` — cosine ≥ this gets the yakın chip.
- `limit = 3` — hits forwarded to the LLM per run.

## Operating notes

- Skills live in the same Qdrant collection as refinement history. They
  do NOT clash because every retrieval specifies the `kind` filter.
- Extraction skips tasks whose LLM confidence comes back below 50 — the
  catalog would otherwise fill with one-off quirks that can't generalise.
- Re-running a task that already has an extracted skill is a no-op (the
  `source_task_id` guard fires first).
- UI actions: `/dashboard/skills` → search, filter by pattern type,
  click a row to expand, manual create/edit, delete.
- Each retrieval bumps `usage_count` and stamps `last_used_at`, which
  powers the catalog's "most useful skills" sort.
