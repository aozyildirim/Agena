"""Flow executor — node tipine göre adımları sırayla çalıştırır."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from models.flow_run import FlowRun, FlowRunStep
from services.integration_config_service import IntegrationConfigService

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
        return await _run_agent_node(node, context)

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


async def _run_agent_node(node: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """LLM agent çalıştırır — şimdilik mock, gerçek LLM entegrasyonu sonra."""
    task = context.get('task', {})
    action = node.get('action', '')
    role = node.get('role', 'developer')
    model = node.get('model', 'gpt-4o')

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
    """GitHub PR açar / branch oluşturur."""
    action = node.get('github_action', 'create_pr')
    task = context.get('task', {})
    repo = node.get('repo', '')

    # TODO: gerçek GitHub API entegrasyonu
    return {
        'status': 'ok',
        'action': action,
        'message': f"GitHub {action} simüle edildi — repo: {repo}, task: {task.get('title', '')}",
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

    context: dict[str, Any] = {'task': task, 'outputs': {}}
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
