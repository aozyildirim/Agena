"""Flow executor — node tipine göre adımları sırayla çalıştırır."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.flow_run import FlowRun, FlowRunStep
from models.task_record import TaskRecord
from services.azure_pr_service import AzurePRService
from services.github_service import GitHubService
from services.integration_config_service import IntegrationConfigService
from services.orchestration_service import OrchestrationService

logger = logging.getLogger(__name__)


# ── Node executor dispatch ────────────────────────────────────────────────────

async def execute_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Her node tipini çalıştırır, output döndürür."""
    node_type: str = node.get('type', 'agent')

    if node_type == 'trigger':
        return {'status': 'ok', 'message': 'Triggered', 'task': context.get('task', {})}

    elif node_type == 'agent':
        return await _run_agent_node(node, context, db, organization_id)

    elif node_type == 'http':
        return await _run_http_node(node, context)

    elif node_type == 'github':
        return await _run_github_node(node, context, db, organization_id)

    elif node_type == 'azure_update':
        return await _run_azure_update_node(node, context, db, organization_id)

    elif node_type == 'notify':
        return await _run_notify_node(node, context)

    elif node_type == 'condition':
        return _run_condition_node(node, context)

    else:
        return {'status': 'skipped', 'message': f'Unknown node type: {node_type}'}


def _bool_val(raw: Any, default: bool = False) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw != 0
    if isinstance(raw, str):
        return raw.strip().lower() in {'1', 'true', 'yes', 'on'}
    return default


def _extract_handled_pr_comment_ids(description: str) -> set[str]:
    handled: set[str] = set()
    for line in (description or '').splitlines():
        s = line.strip()
        if not s.startswith('Handled PR Comment IDs:'):
            continue
        raw = s.split(':', 1)[1].strip()
        if not raw:
            continue
        for part in raw.split(','):
            cid = part.strip()
            if cid:
                handled.add(cid)
    return handled


async def _run_agent_node(
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    """Agent node çalıştırır. İstenirse gerçek task pipeline tetikler."""
    task = context.get('task', {})
    action = node.get('action', '')
    role = node.get('role', 'developer')
    model = node.get('model', 'gpt-4o')
    action_text = str(action or '').lower()
    execute_task_pipeline = _bool_val(node.get('execute_task_pipeline'), False) or (
        str(role).strip().lower() == 'developer' and 'pr' in action_text
    )
    create_pr = _bool_val(node.get('create_pr'), True)

    if execute_task_pipeline:
        task_id = await _resolve_or_create_task_id(
            task=task,
            context=context,
            db=db,
            organization_id=organization_id,
        )
        if task_id is None:
            return {'status': 'error', 'message': 'Task id could not be resolved for pipeline execution'}

        service = OrchestrationService(db)
        result = await service.run_task_record(
            organization_id=organization_id,
            task_id=task_id,
            create_pr=create_pr,
        )
        usage = result.usage.model_dump() if hasattr(result.usage, 'model_dump') else {
            'prompt_tokens': int(getattr(result.usage, 'prompt_tokens', 0)),
            'completion_tokens': int(getattr(result.usage, 'completion_tokens', 0)),
            'total_tokens': int(getattr(result.usage, 'total_tokens', 0)),
        }
        return {
            'status': 'ok',
            'mode': 'task_pipeline',
            'role': role,
            'task_id': task_id,
            'pr_url': result.pr_url,
            'usage': usage,
            'message': 'Task pipeline executed from flow agent node',
        }

    if str(role).strip().lower() == 'lead_developer' and (
        'review pr' in action_text
        or _bool_val(node.get('review_pr'), False)
        or _bool_val(node.get('review_only'), False)
    ):
        return await _run_lead_pr_review_node(
            node=node,
            context=context,
            db=db,
            organization_id=organization_id,
        )

    # TODO: gerçek LLM çağrısı buraya
    result = (
        f"[{role.upper()}] '{task.get('title', 'Task')}' için analiz tamamlandı.\n"
        f"Görev: {action}\n"
        f"Model: {model}\n"
        f"Sonuç: İş kalemi incelendi, gerekli adımlar belirlendi."
    )
    return {'status': 'ok', 'output': result, 'role': role, 'model': model}


async def _run_http_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """HTTP isteği atar."""
    url: str = node.get('url', '')
    method: str = node.get('method', 'GET').upper()
    headers: dict[str, str] = node.get('headers', {})
    body_template: str = node.get('body', '')

    if not url:
        return {'status': 'error', 'message': 'URL belirtilmedi'}

    # Context değişkenlerini body'ye inject et
    task = context.get('task', {})
    body_str = body_template
    for k, v in task.items():
        body_str = body_str.replace(f'{{{{{k}}}}}', str(v))

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            req_kwargs: dict[str, Any] = {'headers': headers}
            if method in ('POST', 'PUT', 'PATCH') and body_str:
                try:
                    req_kwargs['json'] = json.loads(body_str)
                except Exception:
                    req_kwargs['content'] = body_str.encode()
            r = await client.request(method, url, **req_kwargs)
            try:
                resp_body = r.json()
            except Exception:
                resp_body = r.text
            return {
                'status': 'ok' if r.is_success else 'error',
                'http_status': r.status_code,
                'response': resp_body,
            }
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_github_node(
    node: dict[str, Any], context: dict[str, Any],
    db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """GitHub adımı: pipeline'dan oluşan PR bilgisini doğrular/raporlar."""
    action = node.get('github_action', 'create_pr')
    task = context.get('task', {})
    repo = node.get('repo', '')
    outputs = context.get('outputs', {})

    for output in outputs.values():
        if isinstance(output, dict) and output.get('pr_url'):
            return {
                'status': 'ok',
                'action': action,
                'repo': repo,
                'pr_url': output.get('pr_url'),
                'message': f'PR is ready: {output.get("pr_url")}',
            }

    raw_task_id = task.get('id')
    try:
        task_id = int(str(raw_task_id))
    except Exception:
        task_id = None

    if task_id is not None:
        row_result = await db.execute(
            select(TaskRecord).where(
                TaskRecord.id == task_id,
                TaskRecord.organization_id == organization_id,
            )
        )
        row = row_result.scalar_one_or_none()
        if row and row.pr_url:
            return {
                'status': 'ok',
                'action': action,
                'repo': repo,
                'pr_url': row.pr_url,
                'branch_name': row.branch_name,
                'message': f'PR already created: {row.pr_url}',
            }

    return {
        'status': 'ok',
        'action': action,
        'warning': True,
        'message': (
            'PR URL not found. Run a developer node with execute_task_pipeline=true '
            'and create_pr=true before this step.'
        ),
    }


async def _resolve_or_create_task_id(
    *,
    task: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
    create_if_missing: bool = True,
) -> int | None:
    """Flow task payload'ını mevcut TaskRecord ile eşleştirir; yoksa yeni kayıt açar."""
    raw_task_id = task.get('id')
    parsed_task_id: int | None = None
    try:
        parsed_task_id = int(str(raw_task_id))
    except Exception:
        parsed_task_id = None

    if parsed_task_id is not None:
        existing_result = await db.execute(
            select(TaskRecord.id).where(
                TaskRecord.id == parsed_task_id,
                TaskRecord.organization_id == organization_id,
            )
        )
        existing_id = existing_result.scalar_one_or_none()
        if existing_id is not None:
            return int(existing_id)

    source = str(task.get('source') or task.get('external_source') or 'internal').strip().lower()
    if source not in {'azure', 'jira', 'internal'}:
        source = 'internal'

    title = str(task.get('title') or '').strip() or f'Flow Task {raw_task_id or ""}'.strip()
    description = str(task.get('description') or '').strip()
    external_id = str(raw_task_id or '').strip() or f'flow-{int(datetime.now(timezone.utc).timestamp())}'
    user_id = int(context.get('user_id') or 0)
    if external_id:
        same_external_result = await db.execute(
            select(TaskRecord.id).where(
                TaskRecord.organization_id == organization_id,
                TaskRecord.source == source,
                TaskRecord.external_id == external_id,
            ).order_by(TaskRecord.id.desc())
        )
        same_external_id = same_external_result.scalars().first()
        if same_external_id is not None:
            return int(same_external_id)

    if not create_if_missing or user_id <= 0:
        return None

    metadata_lines: list[str] = []
    for key, label in (
        ('external_source', 'External Source'),
        ('project', 'Project'),
        ('azure_repo', 'Azure Repo'),
        ('local_repo_mapping', 'Local Repo Mapping'),
        ('local_repo_path', 'Local Repo Path'),
    ):
        value = task.get(key)
        if value:
            metadata_lines.append(f'{label}: {value}')
    if metadata_lines:
        description = (description + '\n\n---\n' + '\n'.join(metadata_lines)).strip()

    created = TaskRecord(
        organization_id=organization_id,
        created_by_user_id=user_id,
        source=source,
        external_id=external_id,
        title=title,
        description=description,
        status='queued',
    )
    db.add(created)
    await db.commit()
    await db.refresh(created)
    return int(created.id)


async def _run_lead_pr_review_node(
    *,
    node: dict[str, Any],
    context: dict[str, Any],
    db: AsyncSession,
    organization_id: int,
) -> dict[str, Any]:
    task = context.get('task', {})
    task_id = await _resolve_or_create_task_id(
        task=task,
        context=context,
        db=db,
        organization_id=organization_id,
        create_if_missing=False,
    )
    if task_id is None:
        return {'status': 'ok', 'warning': True, 'message': 'Task could not be resolved for PR review node; skipped'}

    task_row = await db.get(TaskRecord, task_id)
    if task_row is None or task_row.organization_id != organization_id:
        return {'status': 'error', 'message': f'Task not found for organization: {task_id}'}

    pr_url = ''
    outputs = context.get('outputs', {})
    for output in outputs.values():
        if isinstance(output, dict) and output.get('pr_url'):
            pr_url = str(output.get('pr_url') or '').strip()
            break
    if not pr_url:
        pr_url = str(task_row.pr_url or '').strip()
    if not pr_url:
        return {'status': 'ok', 'warning': True, 'message': 'PR not found yet; review node skipped'}

    is_azure = 'dev.azure.com' in pr_url or '/_apis/git/repositories/' in pr_url
    is_github = 'github.com' in pr_url or 'api.github.com' in pr_url
    if not is_azure and not is_github:
        return {'status': 'ok', 'warning': True, 'pr_url': pr_url, 'message': 'PR provider not recognized for review loop'}

    try:
        if is_azure:
            comments = await AzurePRService(db).list_pr_comments(organization_id, pr_url=pr_url)
        else:
            comments = await GitHubService().list_pr_comments(pr_url=pr_url)
    except Exception as exc:
        return {'status': 'error', 'message': f'PR comments could not be fetched: {exc}'}

    current_desc = str(task_row.description or '')
    handled_ids = _extract_handled_pr_comment_ids(current_desc)

    actionable = [
        c for c in comments
        if c.get('content')
        and str(c.get('id') or '') not in handled_ids
        and '[Tiqr PR Review]' not in c.get('content', '')
        and 'tiqr' not in c.get('author', '').lower()
    ]
    if not actionable:
        return {'status': 'ok', 'pr_url': pr_url, 'message': 'No new actionable PR review comments found'}

    lines = [f"- {c.get('author', 'Reviewer')}: {c.get('content', '').replace(chr(10), ' ').strip()}" for c in actionable[:8]]
    feedback_blob = '\n'.join(lines).strip()
    feedback_hash = hashlib.sha1(feedback_blob.encode('utf-8')).hexdigest()[:12]
    marker = f'Handled PR Feedback Hash: {feedback_hash}'
    handled_comment_ids = [
        str(c.get('id') or '').strip()
        for c in actionable
        if str(c.get('id') or '').strip()
    ]
    ids_marker = (
        f"Handled PR Comment IDs: {','.join(handled_comment_ids)}"
        if handled_comment_ids else
        ''
    )
    if marker in current_desc:
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'feedback_hash': feedback_hash,
            'message': 'PR comments already handled for this feedback set',
        }

    extra_markers = f'\n{marker}'
    if ids_marker:
        extra_markers += f'\n{ids_marker}'

    task_row.description = (
        current_desc.strip()
        + '\n\n---\n'
        + 'Execution Prompt: Address the following PR review comments exactly and update code accordingly.\n'
        + feedback_blob
        + extra_markers
    ).strip()
    await db.commit()

    auto_fix = _bool_val(node.get('auto_fix_from_comments'), True)
    if not auto_fix:
        if is_azure:
            comment_ref = await AzurePRService(db).post_pr_comment(
                organization_id,
                pr_url=pr_url,
                comment='[Tiqr PR Review] Review comments captured. Auto-fix is disabled for this node.',
            )
        else:
            comment_ref = await GitHubService().post_pr_comment(
                pr_url=pr_url,
                comment='[Tiqr PR Review] Review comments captured. Auto-fix is disabled for this node.',
            )
        return {
            'status': 'ok',
            'pr_url': pr_url,
            'feedback_hash': feedback_hash,
            'comment_ref': comment_ref,
            'message': 'Review comments captured; auto-fix disabled',
        }

    rerun = await OrchestrationService(db).run_task_record(
        organization_id=organization_id,
        task_id=task_id,
        create_pr=True,
    )
    if is_azure:
        comment_ref = await AzurePRService(db).post_pr_comment(
            organization_id,
            pr_url=pr_url,
            comment=(
                '[Tiqr PR Review] Reviewer feedback detected. '
                f'Auto-fix run completed. New PR: {rerun.pr_url or "n/a"}'
            ),
        )
    else:
        comment_ref = await GitHubService().post_pr_comment(
            pr_url=pr_url,
            comment=(
                '[Tiqr PR Review] Reviewer feedback detected. '
                f'Auto-fix run completed. New PR: {rerun.pr_url or "n/a"}'
            ),
        )
    return {
        'status': 'ok',
        'mode': 'pr_feedback_loop',
        'task_id': task_id,
        'pr_url': pr_url,
        'new_pr_url': rerun.pr_url,
        'feedback_hash': feedback_hash,
        'comment_ref': comment_ref,
        'message': 'PR feedback processed and developer auto-fix run executed',
    }


async def _run_azure_update_node(
    node: dict[str, Any], context: dict[str, Any],
    db: AsyncSession, organization_id: int,
) -> dict[str, Any]:
    """Azure work item state'ini günceller."""
    import base64
    task = context.get('task', {})
    new_state = node.get('new_state', 'In Progress')
    task_id = task.get('id', '')

    service = IntegrationConfigService(db)
    config = await service.get_config(organization_id, 'azure')
    if not config or not config.secret:
        return {'status': 'error', 'message': 'Azure integration not configured'}

    token = base64.b64encode(f':{config.secret}'.encode()).decode()
    headers = {'Authorization': f'Basic {token}', 'Content-Type': 'application/json-patch+json'}
    url = f"{config.base_url.rstrip('/')}/_apis/wit/workitems/{task_id}?api-version=7.1-preview.3"
    patch = [{'op': 'add', 'path': '/fields/System.State', 'value': new_state}]

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.patch(url, headers=headers, json=patch)
            return {'status': 'ok' if r.is_success else 'error', 'http_status': r.status_code, 'new_state': new_state}
    except Exception as e:
        return {'status': 'error', 'message': str(e)}


async def _run_notify_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Bildirim gönderir (webhook/slack/email)."""
    channel = node.get('channel', 'webhook')
    webhook_url = node.get('webhook_url', '')
    message_template = node.get('message', 'Flow tamamlandı: {{title}}')

    task = context.get('task', {})
    message = message_template
    for k, v in task.items():
        message = message.replace(f'{{{{{k}}}}}', str(v))

    if channel == 'webhook' and webhook_url:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(webhook_url, json={'text': message, 'task': task})
                return {'status': 'ok', 'http_status': r.status_code, 'message': message}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    # Slack, email vb. — TODO
    return {'status': 'ok', 'channel': channel, 'message': message, 'note': 'simulated'}


def _run_condition_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """Basit condition — field == value kontrolü."""
    field = node.get('condition_field', '')
    operator = node.get('condition_op', 'eq')
    value = node.get('condition_value', '')

    task = context.get('task', {})
    actual = str(task.get(field, context.get(field, '')))

    if operator == 'eq':
        result = actual == str(value)
    elif operator == 'contains':
        result = str(value).lower() in actual.lower()
    elif operator == 'neq':
        result = actual != str(value)
    else:
        result = bool(actual)

    return {'status': 'ok', 'result': result, 'branch': 'true' if result else 'false'}


# ── Main runner ───────────────────────────────────────────────────────────────

async def run_flow(
    flow: dict[str, Any],
    task: dict[str, Any],
    user_id: int,
    organization_id: int,
    db: AsyncSession,
) -> FlowRun:
    """Flow'u çalıştırır, DB'ye kaydeder, FlowRun döndürür."""
    now = datetime.now(timezone.utc)

    # FlowRun oluştur
    flow_run = FlowRun(
        flow_id=flow['id'],
        flow_name=flow['name'],
        task_id=str(task.get('id', '')),
        task_title=task.get('title', ''),
        user_id=user_id,
        status='running',
        started_at=now,
    )
    db.add(flow_run)
    await db.flush()  # id al

    nodes: list[dict[str, Any]] = flow.get('nodes', [])
    edges: list[dict[str, Any]] = flow.get('edges', [])

    # Execution order: topological sort (basit — edge sırasına göre)
    ordered = _topo_sort(nodes, edges)

    context: dict[str, Any] = {'task': task, 'outputs': {}, 'user_id': user_id}
    overall_status = 'completed'

    for node in ordered:
        step = FlowRunStep(
            run_id=flow_run.id,
            node_id=node['id'],
            node_type=node.get('type', 'agent'),
            node_label=node.get('label', ''),
            status='running',
            input_json=json.dumps({'node': node, 'context_keys': list(context.keys())}),
            started_at=datetime.now(timezone.utc),
        )
        db.add(step)
        await db.flush()

        try:
            output = await execute_node(node, context, db, organization_id)
            step.status = 'completed' if output.get('status') != 'error' else 'failed'
            step.output_json = json.dumps(output, ensure_ascii=False, default=str)
            context['outputs'][node['id']] = output

            # Condition node → branch context'e ekle
            if node.get('type') == 'condition':
                context['last_condition'] = output.get('result', False)

            if step.status == 'failed':
                overall_status = 'failed'
                # Hata durumunda dur
                step.finished_at = datetime.now(timezone.utc)
                await db.flush()
                break

        except Exception as e:
            step.status = 'failed'
            step.error_msg = str(e)
            overall_status = 'failed'
            logger.exception('Flow step failed: %s', node.get('id'))

        step.finished_at = datetime.now(timezone.utc)
        await db.flush()

    flow_run.status = overall_status
    flow_run.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(flow_run)
    return flow_run


def _topo_sort(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Basit topological sort — Kahn's algorithm."""
    node_map = {n['id']: n for n in nodes}
    in_degree: dict[str, int] = {n['id']: 0 for n in nodes}
    adj: dict[str, list[str]] = {n['id']: [] for n in nodes}

    for e in edges:
        if e['from'] in adj and e['to'] in in_degree:
            adj[e['from']].append(e['to'])
            in_degree[e['to']] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    result: list[dict[str, Any]] = []

    while queue:
        nid = queue.pop(0)
        if nid in node_map:
            result.append(node_map[nid])
        for neighbor in adj.get(nid, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # Bağlantısız node'ları da ekle
    visited = {n['id'] for n in result}
    for n in nodes:
        if n['id'] not in visited:
            result.append(n)

    return result
