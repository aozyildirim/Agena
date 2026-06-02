"""PR Reviewer engine — live, sync-independent AI code review of a pull request.

Flow (Azure first; GitHub later):
  resolve repo mapping -> Azure cfg / project / repo
  -> fetch the PR's changed files (latest iteration)
  -> fetch each changed file's NEW content, number the lines
  -> reviewer agent (org default) emits structured line findings
  -> a verifier pass drops hallucinated / low-confidence findings
  -> post the surviving findings as inline discussion threads (priority
     order, capped), low-severity rolled into one summary thread
  -> persist a PrReview row + an AIUsageEvent ('pr_inline_review')

The agent is whatever the org configured (claude_cli / codex_cli via the CLI
bridge, or an API provider via LLMProvider) — same resolution review_service
uses. Everything is best-effort: a failure marks the PrReview 'failed' rather
than throwing into the request.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from agena_models.models.pr_review import PrReview
from agena_models.models.repo_mapping import RepoMapping
from agena_services.integrations.azure_client import AzureDevOpsClient
from agena_services.services.ai_usage_event_service import AIUsageEventService
from agena_services.services.integration_config_service import IntegrationConfigService

logger = logging.getLogger(__name__)

# Keep prompts bounded — only changed files, capped count + total size.
_MAX_FILES = 25
_MAX_TOTAL_CHARS = 48_000
_MAX_FILE_CHARS = 12_000
# Hard ceiling on inline threads so a noisy run can't spam a PR. Priority +
# the verifier do the real filtering; this is just a backstop.
_MAX_INLINE = 20
_SEVERITY_RANK = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3, 'clean': 4}
_INLINE_SEVERITIES = {'critical', 'high', 'medium'}


async def _azure_cfg(db: AsyncSession, organization_id: int) -> dict[str, str] | None:
    cfg_service = IntegrationConfigService(db)
    config = await cfg_service.get_config(organization_id, 'azure')
    if config is None or not config.secret:
        return None
    return {'org_url': config.base_url or '', 'pat': config.secret, 'project': config.project or ''}


async def _resolve_repo(db: AsyncSession, organization_id: int, repo_mapping_id: int) -> tuple[RepoMapping, dict[str, str]] | None:
    rm = (await db.execute(
        select(RepoMapping).where(
            RepoMapping.id == repo_mapping_id,
            RepoMapping.organization_id == organization_id,
        )
    )).scalar_one_or_none()
    if rm is None or (rm.provider or '').lower() != 'azure':
        return None
    cfg = await _azure_cfg(db, organization_id)
    if cfg is None:
        return None
    return rm, cfg


async def list_open_prs(db: AsyncSession, organization_id: int, repo_mapping_id: int) -> list[dict[str, Any]]:
    resolved = await _resolve_repo(db, organization_id, repo_mapping_id)
    if resolved is None:
        raise ValueError('Azure repo mapping or integration not configured')
    rm, cfg = resolved
    return await AzureDevOpsClient().list_open_pull_requests(cfg=cfg, project=rm.owner, repo=rm.repo_name)


def _number_lines(content: str, limit: int = _MAX_FILE_CHARS) -> str:
    body = content[:limit]
    out = []
    for i, line in enumerate(body.splitlines(), start=1):
        out.append(f'{i}: {line}')
    return '\n'.join(out)


_LANG_NAMES = {'tr': 'Turkish', 'en': 'English', 'es': 'Spanish', 'de': 'German', 'it': 'Italian', 'ja': 'Japanese', 'zh': 'Chinese'}


def _build_review_prompt(title: str, files: list[tuple[str, str]], language: str | None = None) -> str:
    blocks = []
    for path, numbered in files:
        blocks.append(f'### FILE: {path}\n{numbered}')
    files_text = '\n\n'.join(blocks)
    lang_name = _LANG_NAMES.get((language or '').lower())
    lang_directive = (
        f'Write every "comment" in {lang_name}.\n\n' if lang_name
        else ''
    )
    return (
        lang_directive +
        'Do NOT use any tools or explore the filesystem — everything you need is in this message. '
        'Respond with ONLY a JSON object (no markdown fences, no prose).\n\n'
        'You are a senior engineer reviewing a pull request. Review ONLY the changed files below '
        '(new contents, line-numbered). Report ONLY real, important problems a careful human '
        'reviewer would block or comment on: bugs, logic errors, unhandled null/exceptions, '
        'security issues (injection, unvalidated input, leaked secrets), race conditions, missing '
        'critical edge cases, data-loss or performance risks. Do NOT report formatting/style '
        'nitpicks and do NOT invent problems — if the code is fine, return no findings for it.\n\n'
        f'PR title: {title}\n\n'
        f'{files_text}\n\n'
        'Return STRICT JSON only:\n'
        '{"score": <0-100 how ready to merge>, "findings": [{'
        '"file": "<exact FILE path from a "### FILE:" header above>", '
        '"line": <integer line number from the listing where the problem actually is>, '
        '"severity": "critical|high|medium|low", '
        '"category": "bug|security|error-handling|tests|performance", '
        '"confidence": <0-100>, '
        '"comment": "<2-4 sentences IN THE SAME LANGUAGE AS THE CODE/PR: what is wrong, why it '
        'matters, and the concrete fix. Reference the actual variable/function on that line. Be '
        'specific to THIS code — no generic advice.>"}]}\n'
        'Put the whole finding in the single "comment" field (do NOT split into title/description). '
        'Each line must be a real line from the listing. Empty findings array if nothing is wrong.'
    )


def _build_verify_prompt(findings: list[dict[str, Any]], files: list[tuple[str, str]]) -> str:
    blocks = [f'### FILE: {p}\n{n}' for p, n in files]
    return (
        'You are a strict reviewer auditing another reviewer. For each finding below, decide if it '
        'is REAL and visible at the cited file+line in the code. Drop anything speculative, wrong, '
        'duplicated, or trivial nit-picking. Be conservative.\n\n'
        f'FINDINGS:\n{json.dumps(findings, ensure_ascii=False)}\n\n'
        f'CODE:\n{chr(10).join(blocks)}\n\n'
        'Return STRICT JSON only: {"findings": [<the subset that survives, same shape, '
        'with corrected severity if needed>]}'
    )


async def _run_agent(*, provider: str, model: str | None, prompt: str) -> tuple[str, dict]:
    """Run the org's reviewer agent (CLI bridge) and return (text, usage).

    The bridge runs ``claude --json`` and forwards ``stdout`` (the answer
    text), ``usage`` (input/output/cache tokens) and ``cost_usd``, so we can
    both parse the findings and bill the run accurately.
    """
    prov = (provider or '').strip().lower()
    cli = 'claude' if prov == 'claude_cli' else 'codex'
    bridge_url = os.getenv('CLI_BRIDGE_URL', 'http://cli-bridge:9876')
    async with httpx.AsyncClient(timeout=200) as client:
        resp = await client.post(
            f'{bridge_url}/{cli}',
            json={'repo_path': '/tmp', 'prompt': prompt, 'model': model or '', 'timeout': 180, 'read_only': True},
        )
        data = resp.json() if resp.content else {}
    if data.get('status') != 'ok':
        raise RuntimeError(f'{cli} bridge: {data.get("message", data.get("stderr", "unknown"))}')
    text = (data.get('stdout') or '').strip()
    u = data.get('usage') or {}
    usage = {
        'prompt_tokens': int(u.get('input_tokens', 0) or 0),
        'completion_tokens': int(u.get('output_tokens', 0) or 0),
        'cached_input_tokens': int(u.get('cache_read_input_tokens', 0) or 0),
        'cost_usd': data.get('cost_usd'),
    }
    usage['total_tokens'] = usage['prompt_tokens'] + usage['completion_tokens']
    return text, usage


def _extract_json(text: str) -> dict[str, Any]:
    if not text:
        return {}
    s = text.strip()
    # Strip ```json fences if present.
    if s.startswith('```'):
        s = s.split('```', 2)[1] if '```' in s[3:] else s
        s = s.replace('json', '', 1).strip('`\n ')
    start = s.find('{')
    end = s.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        return json.loads(s[start:end + 1])
    except Exception:
        return {}


async def review_pr(
    db: AsyncSession,
    *,
    organization_id: int,
    user_id: int | None,
    repo_mapping_id: int,
    pr_id: str,
    source_branch: str,
    pr_url: str | None = None,
    title: str | None = None,
    provider_override: str | None = None,
    model_override: str | None = None,
    language: str | None = None,
) -> PrReview:
    """Run an AI inline review of one Azure PR and post discussion threads."""
    from agena_services.services.review_service import _build_llm_for_org, _resolve_reviewer_model

    resolved = await _resolve_repo(db, organization_id, repo_mapping_id)
    record = PrReview(
        organization_id=organization_id,
        requested_by_user_id=user_id,
        provider='azure',
        repo_mapping_id=repo_mapping_id,
        repo=resolved[0].repo_name if resolved else '',
        pr_number=str(pr_id),
        pr_url=pr_url,
        title=title,
        status='running',
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    started = datetime.utcnow()
    try:
        if resolved is None:
            raise ValueError('Azure repo mapping or integration not configured')
        rm, cfg = resolved
        client = AzureDevOpsClient()

        async def _stage(name: str) -> None:
            # Live progress so the detail page can show what the review is
            # doing (overwritten by the full details payload at the end).
            record.details = json.dumps({'stage': name})
            await db.commit()

        await _stage('fetching_files')
        # 1) changed files -> numbered new content (bounded).
        changed = await client.fetch_pr_changed_files(cfg=cfg, project=rm.owner, repo=rm.repo_name, pr_id=str(pr_id))
        files: list[tuple[str, str]] = []
        total = 0
        for c in changed[:_MAX_FILES]:
            if total >= _MAX_TOTAL_CHARS:
                break
            content = await client.fetch_file_content(cfg=cfg, project=rm.owner, repo=rm.repo_name, path=c['path'], branch=source_branch)
            if not content:
                continue
            numbered = _number_lines(content)
            files.append((c['path'], numbered))
            total += len(numbered)
        if not files:
            raise RuntimeError('No reviewable changed files found on the PR')

        if provider_override:
            provider, model = provider_override, (model_override or None)
        else:
            provider, model = await _resolve_reviewer_model(db, user_id or 0, 'reviewer')
            provider = provider or 'claude_cli'

        agg_usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'cached_input_tokens': 0, 'total_tokens': 0}
        agg_cost = 0.0

        async def run(prompt: str) -> str:
            nonlocal agg_cost
            prov = (provider or '').lower()
            if prov in ('claude_cli', 'codex_cli'):
                text, u = await _run_agent(provider=prov, model=model, prompt=prompt)
            else:
                llm = await _build_llm_for_org(db, organization_id=organization_id, provider=prov, model=model)
                text, u, _m, _c = await llm.generate(system_prompt='', user_prompt=prompt, complexity_hint='normal', max_output_tokens=2500)
                u = u or {}
            for k in ('prompt_tokens', 'completion_tokens', 'cached_input_tokens', 'total_tokens'):
                agg_usage[k] += int(u.get(k, 0) or 0)
            if isinstance(u.get('cost_usd'), (int, float)):
                agg_cost += float(u['cost_usd'])
            return text or ''

        # 2) review -> 3) verify.
        await _stage('reviewing')
        review_raw = await run(_build_review_prompt(title or '', files, language=language))
        logger.info('PR review raw output (pr=%s, %d chars): %s', pr_id, len(review_raw), review_raw[:600])
        parsed = _extract_json(review_raw)
        findings = [f for f in (parsed.get('findings') or []) if isinstance(f, dict)]
        score = parsed.get('score')
        logger.info('PR review parsed: %d finding(s), score=%s', len(findings), score)
        if findings:
            await _stage('verifying')
            verify_raw = await run(_build_verify_prompt(findings, files))
            verified = _extract_json(verify_raw).get('findings')
            if isinstance(verified, list) and verified:
                findings = [f for f in verified if isinstance(f, dict)]

        # 4) rank + dedup + cap.
        valid_paths = {p for p, _ in files}
        clean: list[dict[str, Any]] = []
        seen: set[tuple[str, int]] = set()
        for f in findings:
            path = str(f.get('file') or '').strip()
            try:
                line = int(f.get('line') or 0)
            except (TypeError, ValueError):
                continue
            sev = str(f.get('severity') or 'medium').lower()
            if path not in valid_paths or line < 1:
                continue
            key = (path, line)
            if key in seen:
                continue
            seen.add(key)
            # The model may use comment / description / title interchangeably.
            ftitle = str(f.get('title') or '').strip()
            fbody = str(f.get('comment') or f.get('description') or '').strip()
            comment = f'**{ftitle}**\n\n{fbody}' if ftitle and fbody else (fbody or ftitle)
            clean.append({'file': path, 'line': line, 'severity': sev,
                          'comment': comment,
                          'category': str(f.get('category') or '').strip()})
        clean.sort(key=lambda x: _SEVERITY_RANK.get(x['severity'], 2))

        inline = [f for f in clean if f['severity'] in _INLINE_SEVERITIES][:_MAX_INLINE]
        low = [f for f in clean if f['severity'] not in _INLINE_SEVERITIES]

        # 5) post inline threads.
        await _stage('posting')
        posted = 0
        for f in inline:
            body = f"**🤖 AGENA — {f['severity'].upper()}**" + (f" · {f['category']}" if f['category'] else '') + f"\n\n{f['comment']}"
            tid = await client.post_pr_inline_thread(
                cfg=cfg, project=rm.owner, repo=rm.repo_name, pr_id=str(pr_id),
                file_path=f['file'], line=f['line'], content=body,
            )
            if tid:
                posted += 1

        # summary thread (verdict + score + rolled-up low findings).
        top_sev = clean[0]['severity'] if clean else 'clean'
        summary_lines = [f"**🤖 AGENA code review** — {len(clean)} finding(s), top severity: {top_sev}"]
        if score is not None:
            summary_lines.append(f"Readiness score: {score}/100")
        if low:
            summary_lines.append('\nMinor notes:')
            for f in low[:15]:
                summary_lines.append(f"- `{f['file']}`:{f['line']} — {f['comment']}")
        # Post the verdict as one thread anchored to the first reviewed file
        # (Azure threads need a file/line anchor; line 1 keeps it simple).
        await client.post_pr_inline_thread(
            cfg=cfg, project=rm.owner, repo=rm.repo_name, pr_id=str(pr_id),
            file_path=files[0][0], line=1, content='\n'.join(summary_lines),
        )

        # 6) persist + usage.
        record.status = 'completed'
        record.severity = top_sev
        record.score = int(score) if isinstance(score, (int, float)) else None
        record.findings_count = len(clean)
        record.threads_posted = posted
        record.threads_open = posted
        record.reviewer_provider = provider
        record.reviewer_model = model
        record.completed_at = datetime.utcnow()
        record.details = json.dumps({
            'stage': 'done',
            'inline': len(inline), 'low': len(low),
            'reviewed_files': [p for p, _ in files],
            'tokens': agg_usage.get('total_tokens', 0),
            'cost_usd': round(agg_cost, 4) if agg_cost else None,
            # Full findings so the detail page can render the AI's comments.
            'findings': clean,
        }, ensure_ascii=False)
        await db.commit()

        try:
            await AIUsageEventService(db).record_llm_usage(
                organization_id=organization_id, user_id=user_id, task_id=None,
                operation_type='pr_inline_review', provider=provider, model=model,
                usage=agg_usage, cost_usd=(agg_cost if agg_cost > 0 else None),
                started_at=started, ended_at=datetime.utcnow(),
                details={'pr': str(pr_id), 'repo': rm.repo_name, 'findings': len(clean), 'threads': posted},
            )
        except Exception:
            pass
        return record
    except Exception as exc:
        record.status = 'failed'
        record.error_message = str(exc)[:500]
        record.completed_at = datetime.utcnow()
        try:
            await db.commit()
        except Exception:
            pass
        logger.exception('PR review failed for pr=%s: %s', pr_id, exc)
        return record


async def get_review(db: AsyncSession, organization_id: int, review_id: int) -> PrReview | None:
    return (await db.execute(
        select(PrReview).where(PrReview.id == review_id, PrReview.organization_id == organization_id)
    )).scalar_one_or_none()


async def list_history(db: AsyncSession, organization_id: int, limit: int = 50) -> list[PrReview]:
    rows = (await db.execute(
        select(PrReview).where(PrReview.organization_id == organization_id)
        .order_by(PrReview.created_at.desc()).limit(limit)
    )).scalars().all()
    return list(rows)
