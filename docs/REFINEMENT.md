# Sprint Refinement — History-Grounded SP Estimation

Refinement estimates story points by **grounding the LLM on the team's own
completed work**, not on general prior knowledge. The system backfills
closed work items into a vector index; when a new item arrives, the
nearest past items (with their final SPs, assignees, PR titles, branches)
are retrieved and fed into the prompt. The LLM then suggests an SP
anchored on that distribution and *names* the items it resembles.

## End-to-end flow

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. BACKFILL (one-time or periodic)                                     │
├────────────────────────────────────────────────────────────────────────┤
│   Refinement page → "Geçmiş İşleri İndexle"                            │
│                                                                        │
│   Azure DevOps (or Jira)                                               │
│     │  WIQL / JQL: terminal states + StoryPoints > 0                   │
│     │  chunked by 90-day windows (skirts Azure's 20k WIQL cap)         │
│     │  scoped by project+team (Azure AreaPath)                         │
│     ▼                                                                  │
│   RefinementHistoryIndexer                                             │
│     │  For Azure: also parse $expand=relations for each item to get    │
│     │    branches, linked PR refs (projectId/repoId/prId), commit SHAs │
│     │  PR titles resolved in parallel (10 concurrent)                  │
│     │  For Jira: dev-status API best-effort                            │
│     ▼                                                                  │
│   Embed: title + description + acceptance + repro +                    │
│          branches + PR titles  (OpenAI text-embedding-3-small, 1536d)  │
│     ▼                                                                  │
│   Qdrant upsert to collection 'task_memory', payload:                  │
│     { kind='completed_task', organization_id, source, external_id,     │
│       title, story_points, assigned_to, url, state, work_item_type,    │
│       sprint_name, sprint_path, completed_at, created_at,              │
│       branches, pr_titles, pr_count, commit_count }                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 2. REFINE a new item                                                   │
├────────────────────────────────────────────────────────────────────────┤
│   User clicks "Refine" on an unestimated row                           │
│     ▼                                                                  │
│   Run-config modal: pick Provider + Model + Language                   │
│     ▼                                                                  │
│   RefinementService.analyze()                                          │
│     │  Per selected item:                                              │
│     │    1. Embed query = title + description                          │
│     │    2. Qdrant search: top-20 candidates filtered by               │
│     │         kind='completed_task' + organization_id                  │
│     │    3. Drop hits with cosine < 0.55 (noise guard)                 │
│     │    4. If ≥3 same-work-item-type hits survive, keep only those    │
│     │    5. Top-5 injected into the prompt as                          │
│     │         "Similar Completed Items (Historical SP Reference)"      │
│     │         with SP, %similarity, assignee, PR titles, branches      │
│     │    6. LLM call (CrewAI or CLI bridge) with structured output     │
│     │       expecting { suggested_story_points, confidence,            │
│     │          estimation_rationale (must name closest hits),          │
│     │          summary, comment, ambiguities, questions }              │
│     ▼                                                                  │
│   RefinementSuggestion returned to UI:                                 │
│     big SP pill + confidence % + rationale + writeback button          │
│     + Similar Past Items panel (SP, %similar, assignee, PRs, branches) │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 3. WRITEBACK                                                           │
├────────────────────────────────────────────────────────────────────────┤
│   "Write to Azure/Jira" on the suggestion card                         │
│     ▼                                                                  │
│   Azure: PATCH /_apis/wit/workitems/{id}                               │
│      - StoryPoints field set to suggested_story_points                 │
│      - Comment field populated with rationale (signed with             │
│        comment_signature, default "AGENA AI")                          │
│   Jira: POST /rest/api/3/issue/{key} (edit) + /comment                 │
└────────────────────────────────────────────────────────────────────────┘
```

## Key files

| Concern | File | Notes |
|---|---|---|
| Indexer | `packages/services/src/agena_services/services/refinement_history_indexer.py` | Entry point: `backfill()`, `run_backfill_job()`. In-memory job tracker in `_BACKFILL_JOBS`. |
| Azure WIQL + relations | `packages/services/src/agena_services/integrations/azure_client.py` | `fetch_completed_work_items`, `_parse_relations`, `fetch_pr_titles` |
| Jira JQL + dev info | `packages/services/src/agena_services/integrations/jira_client.py` | `fetch_completed_issues`, `fetch_dev_info` |
| Qdrant wrapper | `packages/agents/src/agena_agents/memory/qdrant.py` | `upsert_memory` (with `extra` payload), `search_similar` (with `extra_filters`), `scroll_by_filters` |
| Refinement service | `packages/services/src/agena_services/services/refinement_service.py` | `_fetch_similar_past` (threshold + type filter), `_format_similar_past_for_prompt`, `_load_prompt_config_from_db` (auto-appends grounding block if DB prompt missing placeholder) |
| Prompt template | `packages/agents/src/agena_agents/agents/config/refinement_tasks.yaml` + `prompts.py` | Contains `{similar_past_items}` placeholder |
| HTTP API | `packages/api/src/agena_api/api/routes/refinement.py` | `POST /history/backfill`, `GET /history/backfill-status`, `GET /history/preview`, `GET /history/items` (paginated) |
| Frontend — run + history link | `frontend/app/dashboard/refinement/page.tsx` | Backfill banner, run-config modal, per-row Refine button, similar-items panel |
| Frontend — history page | `frontend/app/dashboard/refinement/history/page.tsx` | SP distribution, top assignees, paginated searchable items |

## Retrieval quality knobs

In `RefinementService`:

- `SIMILAR_MIN_SCORE = 0.55` — cosine cutoff; below this the hit is dropped.
- `TYPE_MATCH_MIN_COUNT = 3` — if ≥3 same `work_item_type` hits survive
  the threshold, restrict the top-N to that type.
- `limit = 5` — hits exposed to the LLM (and to the UI panel).
- Candidate pool: `max(limit * 4, 12)` — always pull extras so we have
  room to filter.

## Prompt grounding

`_load_prompt_config_from_db()` auto-appends a `SIMILAR PAST WORK` block
and an expected-output directive if the DB-stored prompt doesn't contain
`{similar_past_items}`. This ensures retrieved hits reach the LLM even
when an admin has customised the prompt in Prompt Studio without knowing
about the new placeholder.

The rationale directive instructs the model to **name** the closest
hit(s) by ID/title and their previous assignee — or, when no hits survive,
to state that no history was found.

## Limitations

- Azure: the WIQL 20k row cap forces team-scoped backfills. A project
  with many teams needs one backfill per team.
- Jira: dev-status is best-effort. Many self-hosted instances don't
  expose it; indexing still works, just without PR / branch signals.
- Embedding cost: ~$0.02 per 1k items at `text-embedding-3-small`. A
  typical team backfill (3-5k items) costs well under $1.
- The `_BACKFILL_JOBS` tracker is in-memory per process — multi-worker
  deployments would need Redis instead. Fine for single-worker dev and
  the current production footprint.

## Operating notes

- Re-running backfill is idempotent (`key = completed:{source}:{id}`);
  existing points are upserted in place, so new signal fields (e.g. PR
  titles added in a later release) backfill cleanly.
- Status endpoint `/refinement/history/backfill-status` polls every 2s
  while indexing; the UI banner shows `processed/total` live.
- Preview endpoint aggregates SP distribution, top assignees, type
  counts, and returns 200 samples. Full paginated listing:
  `/refinement/history/items?page=&page_size=&sp=&assignee=&q=&sort=`.
