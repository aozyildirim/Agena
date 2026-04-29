"""Curated default Skill seeds.

When a fresh org clicks "Import defaults" on /dashboard/skills (or when
auto-seeding runs on first sign-in), every entry here lands as a Skill
row + Qdrant point. The list is intentionally short and biased toward
real failure modes / patterns we've already paid for once — the kind
of thing a senior would mention in code review but rarely writes down.

Adding a new default? Keep it:
  • Universal-ish (a generic version of a real bug, not a one-off)
  • Short prompt_fragment (think "review-comment voice", not docs page)
  • Tagged with concrete tech (httpx, alembic, react, azure-devops, …)
"""
from __future__ import annotations


DEFAULT_SKILLS: list[dict] = [
    # ── Python / async ─────────────────────────────────────────────
    {
        'name': 'httpx pagination: never pass params={}',
        'description': "httpx silently strips a URL's existing query string when params is an empty dict.",
        'pattern_type': 'fix-bug',
        'tags': ['python', 'httpx', 'pagination'],
        'touched_files': [],
        'approach_summary': (
            "If the next-page URL already carries the query string (e.g. GitHub's "
            "Link header returns a fully-qualified next URL), pass params=None "
            "(or omit the kwarg). Empty dict overwrites the URL's query and you "
            "fetch page 1 forever."
        ),
        'prompt_fragment': (
            "When walking paginated APIs with httpx where the server returns a "
            "fully-qualified next-page URL: pass params=None on the follow-up "
            "calls, never params={}. Empty dict erases the URL's existing "
            "query string and pagination silently re-fetches page 1."
        ),
    },
    {
        'name': 'asyncio.create_task: hold a strong reference',
        'description': 'Fire-and-forget tasks get garbage-collected unless you keep a reference.',
        'pattern_type': 'fix-bug',
        'tags': ['python', 'asyncio', 'background-task'],
        'touched_files': [],
        'approach_summary': (
            "asyncio.create_task() returns a Task that the event loop only "
            "weakly references. If you don't store it somewhere, GC can cancel "
            "it mid-run. Stash in a module-level set; pop on done_callback."
        ),
        'prompt_fragment': (
            "When spawning fire-and-forget background tasks via "
            "asyncio.create_task(), keep a strong reference (e.g. a "
            "module-level set) and add_done_callback to discard. Otherwise "
            "Python's GC can cancel the task at any tick — you'll see the "
            "task start, run a few iterations, then silently disappear."
        ),
    },

    # ── Database / migrations ──────────────────────────────────────
    {
        'name': 'Idempotent Alembic migrations',
        'description': 'Wrap CREATE TABLE / index DDL in existence checks so re-runs against drifted DBs do not crash.',
        'pattern_type': 'migration',
        'tags': ['alembic', 'mysql', 'idempotency'],
        'touched_files': ['alembic/versions/'],
        'approach_summary': (
            "Use sa.inspect(bind).get_table_names() / get_indexes() to skip "
            "DDL that already exists. Mirror the guards in downgrade()."
        ),
        'prompt_fragment': (
            "Alembic migrations should be idempotent: before op.create_table / "
            "op.create_index, check via sa.inspect(op.get_bind()) whether the "
            "object already exists. Same for downgrade. This prevents "
            "'Table already exists' on environments where the schema drifted "
            "ahead of the alembic_version pointer."
        ),
    },
    {
        'name': 'Multi-tenant queries: always scope by organization_id',
        'description': 'Every query against shared tables must filter on organization_id.',
        'pattern_type': 'add-feature',
        'tags': ['multi-tenant', 'security', 'sqlalchemy'],
        'touched_files': [],
        'approach_summary': (
            "Forgetting organization_id is a tenant-isolation leak. Lean on "
            "the tenant dependency (CurrentTenant) and pass tenant.organization_id "
            "into every where clause."
        ),
        'prompt_fragment': (
            "This codebase is multi-tenant — EVERY SELECT / UPDATE / DELETE "
            "against a shared table must include "
            "WHERE organization_id = tenant.organization_id. Skipping it leaks "
            "data across orgs. Reviewers should reject any query that touches "
            "shared tables without that filter."
        ),
    },

    # ── Azure DevOps ───────────────────────────────────────────────
    {
        'name': 'Azure work item Story Points: write all four candidate fields',
        'description': "Different process templates store SP under different field names; PATCH all to be safe.",
        'pattern_type': 'fix-bug',
        'tags': ['azure-devops', 'wit', 'story-points'],
        'touched_files': [],
        'approach_summary': (
            "Agile uses Microsoft.VSTS.Scheduling.StoryPoints, Scrum uses "
            "Effort, CMMI uses Size. PATCH all three with the same value; "
            "Azure 200's the request and silently drops the inapplicable "
            "fields. Do NOT include OriginalEstimate — that's hours, not SP."
        ),
        'prompt_fragment': (
            "When writing Story Points back to an Azure DevOps work item, "
            "send patch ops for ALL of: Microsoft.VSTS.Scheduling.StoryPoints, "
            "Microsoft.VSTS.Scheduling.Effort, and Microsoft.VSTS.Scheduling.Size. "
            "The work item type only recognises one of them; Azure silently "
            "drops the others. Never write into Microsoft.VSTS.Scheduling."
            "OriginalEstimate — that field is HOURS, not story points, and "
            "stamping it with a SP value corrupts time tracking."
        ),
    },
    {
        'name': 'Azure pagination: $top + $skip, not nextLink',
        'description': "Azure DevOps git APIs do not return body-level nextLink — paginate via $top + $skip.",
        'pattern_type': 'fix-bug',
        'tags': ['azure-devops', 'pagination', 'git-api'],
        'touched_files': [],
        'approach_summary': (
            "GitHub-style 'check data.nextLink' silently fails on Azure git "
            "endpoints (commits, pullrequests). Azure caps at 100 by default; "
            "loop with $top=1000 + $skip until you get a short page back."
        ),
        'prompt_fragment': (
            "Azure DevOps git APIs (commits, pullrequests, …) do NOT return "
            "nextLink in the JSON body and ignore Link headers. Paginate via "
            "$top=1000 + $skip=N until a page comes back with fewer than $top "
            "items. Default $top is 100 — assuming you only need one page is "
            "how you end up with 'we have 14k commits but the dashboard shows "
            "100'."
        ),
    },

    # ── Frontend / i18n ────────────────────────────────────────────
    {
        'name': 'i18n: every UI string in all 7 locale files',
        'description': "No hardcoded text. Every visible string lives behind a t('key') call.",
        'pattern_type': 'config',
        'tags': ['i18n', 'frontend', 'locale'],
        'touched_files': ['frontend/locales/'],
        'approach_summary': (
            "Add the key to en.json, then run scripts/translate_locales.py "
            "(diff-only mode) so tr/de/es/it/ja/zh stay in sync. Inline "
            "ternaries (lang === 'tr' ? 'X' : 'Y') are a code smell."
        ),
        'prompt_fragment': (
            "All user-visible strings must go through t('key') from useLocale, "
            "not lang === 'tr' ternaries. When you add a new string: 1) add "
            "the key to frontend/locales/en.json, 2) the diff-only translator "
            "fans it out to the other six locale files. Do not commit "
            "untranslated keys; downstream locales will render English fallback."
        ),
    },

    # ── React / Next ───────────────────────────────────────────────
    {
        'name': 'React useEffect: cleanup async effects',
        'description': 'Ignore late responses from cancelled effects to avoid setState-after-unmount.',
        'pattern_type': 'fix-bug',
        'tags': ['react', 'useeffect', 'cleanup'],
        'touched_files': [],
        'approach_summary': (
            "Use a local `let active = true` flag inside the effect and "
            "guard every setState with `if (active)`. Set `active = false` "
            "in the cleanup function returned from the effect."
        ),
        'prompt_fragment': (
            "When fetching inside useEffect, guard against late responses "
            "from a stale render: declare `let active = true` at the top of "
            "the effect, gate every setState with `if (!active) return`, and "
            "set `active = false` in the cleanup. Otherwise switching repos / "
            "sprints / tabs quickly will surface 'state update on unmounted "
            "component' warnings AND mix data from the previous selection."
        ),
    },

    # ── Conventions ────────────────────────────────────────────────
    {
        'name': 'Conventional commits with scoped diffs',
        'description': 'Group changes into atomic commits with feat:/fix:/refactor: prefixes.',
        'pattern_type': 'docs',
        'tags': ['git', 'commits', 'changelog'],
        'touched_files': [],
        'approach_summary': (
            "feat: new capability · fix: bug repair · refactor: no behaviour "
            "change · test: tests only · docs: docs only · chore: tooling. "
            "One logical change per commit so the changelog reads cleanly."
        ),
        'prompt_fragment': (
            "When committing AI-generated changes, group them into atomic "
            "logical units and prefix the message with feat: / fix: / "
            "refactor: / test: / docs: / chore:. The repo's changelog tooling "
            "depends on this format. Do NOT bundle a refactor + a bugfix + a "
            "test rewrite into a single 'misc updates' commit."
        ),
    },
]
