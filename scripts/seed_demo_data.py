"""Seed a demo organization with believable, fully-fictional data for live demos.

Reads the target org/user from the environment (set by scripts/setup-demo.sh):
    DEMO_ORG_ID   - organization id to seed (required)
    DEMO_USER_ID  - owner user id (required)
    DEMO_WS_ID    - workspace id (optional; resolved from the default workspace)

Run inside the backend container:
    docker-compose exec -T -e DEMO_ORG_ID=.. -e DEMO_USER_ID=.. backend \
        python - < scripts/seed_demo_data.py

Idempotent: wipes this org's previously-seeded rows before re-inserting.

NOTE: Sprint Board, Sprint Performance and New Relic pages read from a LIVE
Azure DevOps / Jira / New Relic connection and cannot be filled from the DB —
connect a real integration for those. Everything else (incl. DORA, which is
computed from the seeded git_* tables) is populated here.
"""
import asyncio
import json
import os
from datetime import datetime, timedelta

from agena_core.database import get_db_session
from agena_models.models.repo_mapping import RepoMapping
from agena_models.models.runtime import Runtime
from agena_models.models.integration_config import IntegrationConfig
from agena_models.models.skill import Skill
from agena_models.models.task_record import TaskRecord
from agena_models.models.agent_log import AgentLog
from agena_models.models.refinement_record import RefinementRecord
from agena_models.models.refinement_job import RefinementJob
from agena_models.models.pr_review import PrReview
from agena_models.models.task_review import TaskReview
from agena_models.models.triage_decision import TriageDecision
from agena_models.models.correlation import Correlation
from agena_models.models.flow_assets import FlowVersion, FlowTemplate
from agena_models.models.git_pull_request import GitPullRequest
from agena_models.models.git_commit import GitCommit
from agena_models.models.git_deployment import GitDeployment
from agena_models.models.review_backlog_nudge import ReviewBacklogNudge
from agena_models.models.integration_rule import IntegrationRule
from agena_models.models.notification_record import NotificationRecord
from agena_models.models.ai_usage_event import AIUsageEvent
from agena_models.models.user_preference import UserPreference
from agena_models.models.workspace import Workspace
from agena_models.models.module import Module, OrganizationModule
from sqlalchemy import select, delete

ORG = int(os.environ["DEMO_ORG_ID"])
USER = int(os.environ["DEMO_USER_ID"])
WS_ENV = os.environ.get("DEMO_WS_ID")
now = datetime.utcnow()


def dt(days=0, hours=0):
    return now - timedelta(days=days, hours=hours)


REPOS = [
    ("github", "northwind", "storefront-web", "main"),
    ("github", "northwind", "checkout-api", "main"),
    ("github", "northwind", "mobile-app", "develop"),
    ("azure", "Northwind Commerce", "loyalty-service", "main"),
    ("azure", "Northwind Commerce", "search-service", "main"),
    ("github", "northwind", "payments-gateway", "main"),
]
INTEGRATIONS = [
    ("github", "https://api.github.com", "northwind", "ghp_demoXXXXXXXXXXXXXXXXXXXXXXXX"),
    ("azure_devops", "https://dev.azure.com/northwind", "Northwind Commerce", "azdo_demo_pat_XXXXXXXX"),
    ("jira", "https://northwind.atlassian.net", "NWC", "jira_demo_token_XXXXXXXX"),
    ("sentry", "https://sentry.io/api/0", "northwind-storefront", "sntrys_demoXXXXXXXX"),
    ("newrelic", "https://api.eu.newrelic.com/graphql", "Storefront APM", "NRAK-DEMOXXXXXXXXXXXX"),
]
SKILLS = [
    ("Add feature flag gate", "add-feature", "Wrap a new code path behind a flag with safe defaults."),
    ("Fix N+1 query", "perf", "Detect and batch a repeated ORM query into a single eager-loaded fetch."),
    ("Stripe webhook handler", "add-feature", "Scaffold an idempotent webhook endpoint with signature verification."),
    ("Refactor to repository pattern", "refactor", "Extract data access from a service into a repository class."),
    ("Add OpenTelemetry span", "add-feature", "Instrument a function with a traced span and attributes."),
    ("Migrate column nullable", "migration", "Generate a safe, reversible migration to make a column nullable."),
    ("Add Jest test suite", "test", "Create unit tests covering happy path and edge cases."),
    ("Sanitize user input", "fix-bug", "Add validation and escaping to prevent injection on a form field."),
    ("Cache product listing", "perf", "Add a Redis cache layer with TTL and invalidation on write."),
    ("Update API docs", "docs", "Regenerate OpenAPI docs and changelog entry for changed endpoints."),
]
RUNTIMES = [
    ("Northwind-CI-Runner", "cloud", ["claude", "codex"], "ci-runner-01"),
    ("dev-macbook (local)", "local", ["claude"], "macbook-pro.local"),
]
TASKS = [
    ("Add gift-card redemption at checkout", "azure", "completed", "high", "Sprint 24", None),
    ("Fix cart total rounding on multi-currency orders", "sentry", "completed", "critical", "Sprint 24", None),
    ("Implement wishlist sharing links", "jira", "completed", "medium", "Sprint 24", None),
    ("Optimize product search latency under load", "newrelic", "completed", "high", "Sprint 24", None),
    ("Add Apple Pay to mobile checkout", "azure", "completed", "high", "Sprint 24", None),
    ("Refactor loyalty points accrual service", "jira", "completed", "medium", "Sprint 24", None),
    ("Dark mode for account settings", "manual", "completed", "low", "Sprint 24", None),
    ("Migrate user sessions to Redis", "azure", "completed", "medium", "Sprint 23", None),
    ("[Sentry] NullReference in OrderService.finalize", "sentry", "completed", "critical", "Sprint 24", None),
    ("[NewRelic] Slow query on product_variants", "newrelic", "completed", "high", "Sprint 23", None),
    ("Add inventory low-stock webhook", "jira", "running", "high", "Sprint 24", "in_progress"),
    ("Coupon stacking validation rules", "azure", "running", "medium", "Sprint 24", "in_progress"),
    ("Rewrite address autocomplete with new API", "jira", "running", "medium", "Sprint 24", "in_progress"),
    ("Add 2FA to admin login", "manual", "queued", "high", "Sprint 24", None),
    ("Bundle product recommendations on PDP", "jira", "queued", "medium", "Sprint 24", None),
    ("Fix flaky checkout E2E test", "azure", "queued", "low", "Sprint 24", None),
    ("Add GraphQL pagination to orders", "jira", "queued", "medium", "Sprint 25", None),
    ("Reduce mobile bundle size by 30%", "manual", "queued", "high", "Sprint 25", None),
    ("[Sentry] Timeout calling payments-gateway", "sentry", "failed", "critical", "Sprint 23", None),
    ("Localize emails for DE and FR", "jira", "completed", "low", "Sprint 23", None),
    ("Add abandoned-cart reminder job", "azure", "completed", "medium", "Sprint 23", None),
    ("Index orders by customer_id", "newrelic", "completed", "medium", "Sprint 23", None),
    ("Support partial refunds in admin", "jira", "queued", "high", "Sprint 25", None),
    ("Add product review moderation queue", "manual", "queued", "low", "Sprint 25", None),
]
REVIEW_TITLES = [
    ("storefront-web", "Add gift-card redemption at checkout", "high", 78, 4),
    ("checkout-api", "Idempotency keys for payment intents", "medium", 86, 2),
    ("loyalty-service", "Refactor loyalty points accrual", "low", 93, 1),
    ("storefront-web", "Wishlist sharing links", "clean", 100, 0),
    ("payments-gateway", "Retry policy for gateway timeouts", "critical", 61, 7),
    ("mobile-app", "Apple Pay integration", "high", 74, 5),
    ("search-service", "Cache product listing results", "medium", 82, 3),
    ("checkout-api", "Coupon stacking validation", "high", 70, 6),
    ("storefront-web", "Dark mode for account settings", "clean", 98, 0),
    ("loyalty-service", "Low-stock webhook emitter", "medium", 84, 2),
]
TRIAGE = [
    ("Legacy promo banner cleanup", "Active", 47, "close", 88),
    ("Investigate intermittent 502 on /cart", "In Progress", 31, "keep", 72),
    ("Old A/B test toggle removal", "Active", 63, "close", 91),
    ("Spike: evaluate Bun for build", "New", 58, "close", 80),
    ("Re-enable SCA for EU cards", "Active", 22, "keep", 69),
    ("Deprecated /v1/orders endpoint", "Active", 74, "close", 95),
    ("Flaky login test on CI", "In Progress", 19, "keep", 64),
    ("Stale feature flag: new_pdp", "Active", 41, "close", 87),
    ("Update Node 18 -> 20 in workers", "New", 28, "keep", 71),
    ("Remove unused image CDN bucket", "Active", 90, "close", 96),
    ("Audit log retention policy", "New", 35, "keep", 66),
    ("Migrate cron to scheduled jobs", "Active", 52, "close", 83),
]
CORRELATIONS = [
    ("pr_merge", "Spike in checkout 500s after deploy", "critical", 92, "A deploy of checkout-api correlates with a 6x rise in 500s and a new Sentry issue within 8 minutes."),
    ("sentry_issue", "NullReference cluster in OrderService", "high", 81, "12 Sentry events across 3 releases trace back to a single unguarded null in OrderService.finalize."),
    ("newrelic_alert", "DB connection saturation at peak", "high", 77, "A connection-pool alert aligns with the abandoned-cart job schedule each hour."),
    ("deploy", "Latency improvement after search reindex", "low", 64, "p95 search latency dropped 40% in the 30 minutes after the reindex deploy."),
    ("pr_merge", "Mobile crash rate up after Apple Pay merge", "medium", 73, "Crash-free sessions dipped 2% the day the Apple Pay PR merged on iOS 17."),
    ("sentry_issue", "Payments gateway timeouts recurring", "critical", 88, "Repeated gateway timeouts cluster around 14:00 UTC, matching a partner batch window."),
    ("newrelic_alert", "Memory growth in worker pool", "medium", 69, "Worker RSS grows linearly between restarts, suggesting a leak in the email renderer."),
    ("deploy", "Error budget recovered this week", "low", 58, "After three fixes merged, the storefront SLO error budget recovered to 99.95%."),
    ("pr_merge", "Coupon bug fixed, refunds normalized", "low", 62, "Partial-refund anomalies stopped after the coupon stacking validation PR merged."),
    ("sentry_issue", "Address autocomplete 4xx spike", "medium", 71, "A vendor API change produced a burst of 422s in address autocomplete across regions."),
]
RULES = [
    ("azure", "Critical bugs -> payments-gateway", {"work_item_type": "Bug", "tags": ["payments"]}, {"tags": ["critical", "payments"], "priority": "critical"}),
    ("azure", "Checkout items -> checkout-api + Full Pipeline", {"project": "Northwind Commerce", "tags": ["checkout"]}, {"tags": ["checkout"], "flow_id": "nw-full-pipeline"}),
    ("jira", "Search team -> search-service", {"project": "NWC", "labels": ["search"]}, {"tags": ["search"], "agent_role": "developer"}),
    ("azure", "Mobile -> mobile-app", {"tags": ["mobile", "ios", "android"]}, {"tags": ["mobile"]}),
]
NOTIFS = [
    ("pr_created", "PR opened for 'Add gift-card redemption'", "info", True),
    ("review_done", "Lead Reviewer scored checkout-api PR 86/100", "info", True),
    ("task_failed", "Task 'Timeout calling payments-gateway' failed", "high", False),
    ("pr_merged", "PR #312 merged into main", "info", True),
    ("sentry_import", "Imported 3 new Sentry errors as tasks", "medium", False),
    ("triage", "12 stale tickets flagged for triage", "medium", False),
    ("backlog", "2 PRs past the review SLA in checkout-api", "high", False),
    ("flow_run", "Nightly Sprint Refinement completed", "info", True),
]
OPEN_PRS = [
    ("storefront-web", "Add gift-card redemption at checkout", "alex.dev", 52, "high", 240, 36, 6, 3),
    ("checkout-api", "Idempotency keys for payment intents", "jordan.kim", 120, "critical", 180, 12, 4, 1),
    ("search-service", "Cache product listing results", "sam.qa", 18, "medium", 95, 8, 3, 5),
    ("checkout-api", "Coupon stacking validation rules", "alex.dev", 73, "high", 140, 22, 5, 2),
    ("mobile-app", "Apple Pay integration for iOS", "priya.m", 30, "medium", 310, 40, 9, 7),
    ("payments-gateway", "Retry policy for gateway timeouts", "jordan.kim", 156, "critical", 88, 14, 3, 0),
    ("storefront-web", "Address autocomplete v2", "sam.qa", 12, "medium", 64, 30, 2, 4),
    ("loyalty-service", "Low-stock webhook emitter", "alex.dev", 41, "high", 120, 6, 4, 2),
]
TEMPLATES = [
    ("Full Build Pipeline", "Analyzer -> Planner -> Developer -> PR -> Lead Reviewer"),
    ("Sentry Hotfix", "Import a Sentry error, fix it, open a PR, notify the team"),
    ("Nightly Refinement", "Pull the backlog and estimate story points automatically"),
    ("PR Auto-Review", "Run a lead reviewer on every opened pull request"),
    ("New Relic Triage", "Import APM errors and route them to the right repo"),
]
FLOW_ROLES = [
    ("trigger", "trigger", "Task Trigger", 60, 140), ("analyzer", "agent", "Analyzer", 220, 290),
    ("planner", "agent", "Planner", 400, 90), ("developer", "agent", "Developer", 580, 290),
    ("check_pr", "condition", "PR Created?", 760, 140), ("reviewer", "agent", "Lead Reviewer", 940, 290),
    ("notify", "notify", "Notify Slack", 1120, 140),
]
FLOW_EDGES = [("trigger", "analyzer"), ("analyzer", "planner"), ("planner", "developer"),
              ("developer", "check_pr"), ("check_pr", "reviewer"), ("reviewer", "notify")]


def make_flow_json(fid, name, desc):
    nodes = []
    for nid, ntype, label, x, y in FLOW_ROLES:
        n = {"id": nid, "type": ntype, "role": nid, "label": label, "x": x, "y": y}
        if ntype == "agent":
            n.update({"model": "sonnet", "provider": "claude_cli", "prompt_slug": "", "action": f"{label} step."})
        nodes.append(n)
    return json.dumps({"id": fid, "name": name, "description": desc, "createdAt": "2026-05-01T10:00:00Z",
                       "nodes": nodes, "edges": [{"from": a, "to": b} for a, b in FLOW_EDGES]})


async def main():
    async for db in get_db_session():
        # resolve workspace
        if WS_ENV:
            WS = int(WS_ENV)
        else:
            ws_row = (await db.execute(select(Workspace).where(
                Workspace.organization_id == ORG).order_by(Workspace.is_default.desc(), Workspace.id))).scalars().first()
            if not ws_row:
                print("ERROR: no workspace for org", ORG); return
            WS = ws_row.id

        # wipe prior demo rows for this org
        for M in (AgentLog, TaskReview, PrReview, TriageDecision, Correlation, RefinementRecord,
                  RefinementJob, FlowVersion, FlowTemplate, ReviewBacklogNudge, GitPullRequest,
                  GitCommit, GitDeployment, IntegrationRule, NotificationRecord, AIUsageEvent,
                  Skill, Runtime, IntegrationConfig, RepoMapping, TaskRecord):
            await db.execute(delete(M).where(M.organization_id == ORG))
        await db.commit()

        # enable every module
        await db.execute(delete(OrganizationModule).where(OrganizationModule.organization_id == ORG))
        for m in (await db.execute(select(Module))).scalars().all():
            db.add(OrganizationModule(organization_id=ORG, module_slug=m.slug, enabled=True))

        # repos
        repo_ids = {}
        for i, (prov, owner, name, base) in enumerate(REPOS):
            r = RepoMapping(organization_id=ORG, workspace_id=WS, provider=prov, owner=owner,
                            repo_name=name, base_branch=base, is_default=(i == 0), is_active=True)
            db.add(r); await db.flush(); repo_ids[name] = r.id

        for name, kind, clis, host in RUNTIMES:
            db.add(Runtime(organization_id=ORG, registered_by_user_id=USER, name=name, kind=kind,
                           status="active", available_clis=clis, host=host, daemon_version="1.4.0",
                           last_heartbeat_at=dt(hours=0)))
        for prov, url, project, secret in INTEGRATIONS:
            db.add(IntegrationConfig(organization_id=ORG, provider=prov, base_url=url, project=project, secret=secret))
        for name, ptype, desc in SKILLS:
            db.add(Skill(organization_id=ORG, created_by_user_id=USER, name=name, pattern_type=ptype,
                         description=desc, is_public=False, is_active=True, source="extracted",
                         usage_count=(hash(name) % 18) + 1, tags=[ptype]))

        # tasks (+ agent logs for running ones)
        repo_cycle = list(repo_ids.values())
        running_log = {10: "Step 3/3: Developer generating code", 11: "Step 2/3: PM analyzing requirements",
                       12: "Reviewing generated changes"}
        for idx, (title, source, status, prio, sprint, substatus) in enumerate(TASKS):
            t = TaskRecord(organization_id=ORG, created_by_user_id=USER, workspace_id=WS, source=source,
                           external_id=f"DEMO-{1000 + idx}", title=title,
                           description=f"{title}. Demo item for the Northwind Commerce workspace.",
                           status=status, priority=prio, sprint_name=sprint,
                           sprint_path=f"Northwind Commerce\\Web Apps\\{sprint}", substatus=substatus,
                           repo_mapping_id=repo_cycle[idx % len(repo_cycle)], external_work_item_id=str(64000 + idx))
            if source in ("sentry", "newrelic"):
                t.occurrences = (idx * 7) % 140 + 3; t.first_seen_at = dt(days=9); t.last_seen_at = dt(hours=2)
                t.is_unhandled = True; t.fixability_score = round(0.4 + (idx % 5) * 0.1, 2)
            if status == "completed":
                t.branch_name = f"agena/demo-{1000 + idx}"
                t.pr_url = f"https://github.com/northwind/storefront-web/pull/{300 + idx}"
            db.add(t); await db.flush()
            if idx in running_log:
                db.add(AgentLog(organization_id=ORG, task_id=t.id, stage="running", message=running_log[idx]))

        for i, (title, *_r) in enumerate(TASKS + TASKS[:6]):
            db.add(RefinementRecord(organization_id=ORG, user_id=USER, provider="azure_devops",
                                    external_item_id=str(70000 + i), phase="analysis", status="completed",
                                    item_title=title, item_url=f"https://dev.azure.com/northwind/_workitems/edit/{70000+i}",
                                    suggested_story_points=[1, 2, 3, 5, 8][i % 5], confidence=60 + (i * 7) % 40,
                                    sprint_name="Sprint 24" if i % 2 else "Sprint 25",
                                    summary="Estimated from scope and historical velocity for similar items."))
        for i in range(3):
            db.add(RefinementJob(organization_id=ORG, user_id=USER, status=["completed", "running", "completed"][i],
                                 provider="azure_devops", sprint_ref="Sprint 24", payload={"sprint": "Sprint 24", "count": 12 + i},
                                 result={"estimated": 12 + i} if i != 1 else None))

        for i, (repo, title, sev, score, findings) in enumerate(REVIEW_TITLES):
            db.add(PrReview(organization_id=ORG, requested_by_user_id=USER,
                            provider="github" if "service" not in repo else "azure", repo=repo, pr_number=str(300 + i),
                            pr_url=f"https://github.com/northwind/{repo}/pull/{300+i}", title=title, status="completed",
                            reviewer_role="lead_reviewer", reviewer_provider="claude_cli", reviewer_model="sonnet",
                            severity=sev, score=score, findings_count=findings, threads_posted=findings,
                            threads_open=max(0, findings - 2), completed_at=dt(days=i % 5)))
        completed = (await db.execute(select(TaskRecord).where(
            TaskRecord.organization_id == ORG, TaskRecord.status == "completed").limit(4))).scalars().all()
        for i, t in enumerate(completed):
            db.add(TaskReview(organization_id=ORG, task_id=t.id, requested_by_user_id=USER, reviewer_agent_role="qa",
                              status="completed", reviewer_provider="claude_cli", reviewer_model="sonnet",
                              score=[88, 92, 76, 95][i], findings_count=[2, 1, 4, 0][i],
                              severity=["medium", "low", "high", "clean"][i],
                              output="### Review\nLooks solid overall. Minor suggestions inline.", completed_at=dt(days=i)))

        for i, (title, state, idle, verdict, conf) in enumerate(TRIAGE):
            db.add(TriageDecision(organization_id=ORG, source="azure_devops", external_id=str(50000 + i),
                                  project_key="NWC", ticket_title=title, ticket_state=state,
                                  ticket_url=f"https://dev.azure.com/northwind/_workitems/edit/{50000+i}",
                                  idle_days=idle, ai_confidence=conf, status="pending", ai_verdict=verdict,
                                  source_updated_at=dt(days=idle).isoformat(),
                                  ai_reasoning=f"No activity for {idle} days; recommendation: {verdict}."))
        for i, (kind, label, sev, conf, narrative) in enumerate(CORRELATIONS):
            db.add(Correlation(organization_id=ORG, window_start=dt(days=i, hours=2), window_end=dt(days=i),
                               primary_kind=kind, primary_ref=f"ref-{i}", primary_label=label,
                               fingerprint=f"demo-corr-{ORG}-{i}", confidence=conf, severity=sev, narrative=narrative,
                               related_events=[{"kind": "pr_merge", "ref": f"PR #{300+i}", "label": "checkout-api deploy"},
                                               {"kind": "sentry_issue", "ref": f"NWC-{i}", "label": "500 error spike"}]))

        for fid, name, desc in [("nw-full-pipeline", "Full Build Pipeline", "Analyzer -> Planner -> Developer -> PR -> Reviewer"),
                                ("nw-hotfix", "Sentry Hotfix Flow", "Import Sentry error -> Developer -> PR -> Notify"),
                                ("nw-refine", "Nightly Sprint Refinement", "Pull backlog -> estimate -> write back")]:
            db.add(FlowVersion(organization_id=ORG, user_id=USER, flow_id=fid, flow_name=name, label="v1",
                               flow_json=make_flow_json(fid, name, desc)))
        for name, desc in TEMPLATES:
            db.add(FlowTemplate(organization_id=ORG, created_by_user_id=USER, name=name, description=desc,
                                flow_json=make_flow_json(name.lower().replace(' ', '-'), name, desc)))

        for i, (prov, name, match, action) in enumerate(RULES):
            db.add(IntegrationRule(organization_id=ORG, provider=prov, name=name, match_json=json.dumps(match),
                                   action_json=json.dumps(action), is_active=True, sort_order=i))
        for i, (etype, title, sev, read) in enumerate(NOTIFS):
            db.add(NotificationRecord(organization_id=ORG, user_id=USER, event_type=etype, title=title,
                                      message=title + ".", severity=sev, is_read=read))
        usage_models = [("claude_cli", "sonnet"), ("openai", "gpt-5"), ("claude_cli", "opus"), ("gemini", "gemini-2.0")]
        usage_ops = ["analyze", "plan", "generate_code", "review", "finalize"]
        for i in range(36):
            prov, model = usage_models[i % len(usage_models)]
            pt = 1800 + (i * 137) % 9000; ct = 600 + (i * 91) % 4000
            db.add(AIUsageEvent(organization_id=ORG, user_id=USER, operation_type=usage_ops[i % len(usage_ops)],
                                provider=prov, model=model, status="success" if i % 11 else "error",
                                prompt_tokens=pt, completion_tokens=ct, total_tokens=pt + ct,
                                cost_usd=round((pt + ct) / 1_000_000 * 4.5, 4), cache_hit=(i % 3 == 0),
                                duration_ms=2000 + (i * 211) % 18000))

        # open PRs + nudges (Review Backlog)
        for i, (repo, title, author, age, sev, adds, dels, commits, comments) in enumerate(OPEN_PRS):
            rid = repo_ids[repo]; prov = "azure" if repo in ("loyalty-service", "search-service") else "github"
            pr = GitPullRequest(organization_id=ORG, repo_mapping_id=str(rid), provider=prov, external_id=str(400 + i),
                                title=title, author=author, status="active" if prov == "azure" else "open",
                                source_branch=f"feature/demo-{400+i}", target_branch="main", created_at_ext=dt(hours=age),
                                additions=adds, deletions=dels, commits_count=commits, review_comments=comments, is_draft=False)
            db.add(pr); await db.flush()
            db.add(ReviewBacklogNudge(organization_id=ORG, pr_id=pr.id, repo_mapping_id=str(rid), age_hours=age,
                                      severity=sev, nudge_count=(i % 3) + 1, last_nudged_at=dt(hours=age // 2),
                                      last_nudge_channel="slack", resolved_at=None))

        # git history for DORA (merged PRs + commits + deployments over ~30 days)
        for rid in repo_ids.values():
            for j in range(8):  # merged PRs
                day = (j * 30) // 8
                created = dt(days=day + 1, hours=6)
                merged = dt(days=day, hours=2)
                db.add(GitPullRequest(organization_id=ORG, repo_mapping_id=str(rid), provider="github",
                                      external_id=f"m{rid}-{j}", title=f"Merged change {j} on repo {rid}", author="alex.dev",
                                      status="merged", source_branch=f"feature/{rid}-{j}", target_branch="main",
                                      created_at_ext=created, merged_at=merged, first_commit_at=created,
                                      additions=40 + j * 9, deletions=10 + j,
                                      commits_count=2 + j % 4, review_comments=j % 3, is_draft=False))
            for j in range(24):  # commits
                db.add(GitCommit(organization_id=ORG, repo_mapping_id=str(rid), sha=f"{rid:02d}{j:04d}deadbeef",
                                 additions=20 + (j * 7) % 120, deletions=5 + (j * 3) % 40, files_changed=1 + j % 6,
                                 committed_at=dt(days=(j * 30) // 24, hours=j % 12)))
            for j in range(6):  # deployments
                db.add(GitDeployment(organization_id=ORG, repo_mapping_id=str(rid), environment="production",
                                     deployed_at=dt(days=(j * 30) // 6, hours=3)))

        # user prefs (repo list + auto-selected sprint) + workspace sprint config
        repos_pref = [
            {"id": "1", "name": "storefront-web", "local_path": "~/repos/storefront-web", "provider": "github",
             "github_owner": "northwind", "github_repo": "storefront-web", "github_repo_full_name": "northwind/storefront-web",
             "default_branch": "main", "notes": "Customer-facing storefront (Next.js)"},
            {"id": "2", "name": "checkout-api", "local_path": "~/repos/checkout-api", "provider": "github",
             "github_owner": "northwind", "github_repo": "checkout-api", "github_repo_full_name": "northwind/checkout-api",
             "default_branch": "main", "notes": "Checkout & payments service"},
            {"id": "3", "name": "mobile-app", "local_path": "~/repos/mobile-app", "provider": "github",
             "github_owner": "northwind", "github_repo": "mobile-app", "github_repo_full_name": "northwind/mobile-app",
             "default_branch": "develop", "notes": "React Native app"},
            {"id": "4", "name": "loyalty-service", "local_path": "~/repos/loyalty-service", "provider": "azure",
             "azure_project": "Northwind Commerce", "azure_repo_name": "loyalty-service",
             "azure_repo_url": "https://dev.azure.com/northwind/_git/loyalty-service", "default_branch": "main",
             "notes": "Loyalty & points engine"},
        ]
        pref = (await db.execute(select(UserPreference).where(UserPreference.user_id == USER))).scalar_one_or_none()
        if not pref:
            pref = UserPreference(user_id=USER); db.add(pref)
        pref.repo_mappings_json = json.dumps(repos_pref)
        pref.azure_project = "Northwind Commerce"
        pref.azure_team = "Web Apps Team"
        pref.azure_sprint_path = "Northwind Commerce\\Web Apps\\Sprint 24"

        ws = (await db.execute(select(Workspace).where(Workspace.id == WS))).scalar_one()
        ws.sprint_provider = "azure"; ws.sprint_project = "Northwind Commerce"
        ws.sprint_team = "Web Apps"; ws.sprint_board = "Web Apps"
        ws.sprint_path = "Northwind Commerce\\Web Apps\\Sprint 24"

        await db.commit()

        from sqlalchemy import func as f
        print(f"\n  seeded org={ORG} user={USER} workspace={WS}")
        for M, label in [(TaskRecord, "tasks"), (RepoMapping, "repos"), (Skill, "skills"),
                         (RefinementRecord, "refinement"), (PrReview, "pr_reviews"), (TriageDecision, "triage"),
                         (Correlation, "insights"), (FlowVersion, "flows"), (FlowTemplate, "templates"),
                         (IntegrationRule, "rules"), (NotificationRecord, "notifications"),
                         (AIUsageEvent, "usage_events"), (GitPullRequest, "git_prs"), (GitDeployment, "deployments")]:
            c = (await db.execute(select(f.count()).select_from(M).where(M.organization_id == ORG))).scalar()
            print(f"    {label:14} {c}")
        print("  DONE")
        break


asyncio.run(main())
