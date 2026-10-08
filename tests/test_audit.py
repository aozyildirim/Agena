"""Audit trail: action derivation and the middleware's recording rules.

Runs without a database — the middleware takes an injected recorder — so a
bare checkout is enough:

    PYTHONPATH=packages/core/src:packages/services/src:packages/api/src \
        python -m pytest tests/test_audit.py
"""

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from agena_api.api.middleware.audit import AuditMiddleware
from agena_services.services.audit_actions import derive_action, derive_target, redact_query


class Tenant:
    """Shape of CurrentTenant, as the middleware reads it."""

    user_id = 7
    organization_id = 3
    email = 'ali@example.com'
    role = 'admin'
    workspace_id = None


def authed(request: Request) -> Tenant:
    tenant = Tenant()
    request.state.tenant = tenant
    return tenant


@pytest.fixture
def app_and_rows():
    rows = []

    async def recorder(**fields):
        rows.append(fields)

    app = FastAPI()
    app.add_middleware(AuditMiddleware, recorder=recorder)

    @app.post('/tasks/{task_id}/assign', tags=['tasks'])
    async def assign_task(task_id: int, tenant: Tenant = Depends(authed)):
        return {'ok': True}

    @app.get('/tasks/{task_id}', tags=['tasks'])
    async def get_task(task_id: int, tenant: Tenant = Depends(authed)):
        return {'id': task_id}

    @app.delete('/integrations/{provider}', tags=['integrations'])
    async def delete_integration(provider: str, tenant: Tenant = Depends(authed)):
        return {'deleted': provider}

    @app.post('/public/contact', tags=['public'])
    async def submit_contact():
        return {'ok': True}

    return app, rows


def test_mutating_authenticated_request_is_recorded(app_and_rows):
    app, rows = app_and_rows
    res = TestClient(app).post(
        '/tasks/12/assign?mode=mcp_agent&token=secret123',
        headers={'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'pytest'},
    )
    assert res.status_code == 200
    assert len(rows) == 1
    row = rows[0]
    assert row['action'] == 'tasks.assign_task'
    assert row['route'] == '/tasks/{task_id}/assign'
    assert row['path'] == '/tasks/12/assign'
    assert (row['target_type'], row['target_id']) == ('task', '12')
    assert row['organization_id'] == 3 and row['actor_user_id'] == 7
    assert row['actor_email'] == 'ali@example.com' and row['actor_role'] == 'admin'
    assert row['status_code'] == 200
    assert row['ip_address'] == '203.0.113.9'
    assert row['user_agent'] == 'pytest'
    assert row['details'] == {
        'path_params': {'task_id': '12'},
        'query': {'mode': 'mcp_agent', 'token': '[redacted]'},
    }


def test_reads_are_not_recorded(app_and_rows):
    app, rows = app_and_rows
    assert TestClient(app).get('/tasks/12').status_code == 200
    assert rows == []


def test_anonymous_mutations_are_not_recorded(app_and_rows):
    app, rows = app_and_rows
    assert TestClient(app).post('/public/contact').status_code == 200
    assert rows == []


def test_path_without_id_param_has_no_target(app_and_rows):
    app, rows = app_and_rows
    TestClient(app).delete('/integrations/github')
    assert rows[0]['action'] == 'integrations.delete_integration'
    assert (rows[0]['target_type'], rows[0]['target_id']) == (None, None)
    assert rows[0]['details'] == {'path_params': {'provider': 'github'}}


def test_recorder_failure_never_breaks_the_response():
    async def recorder(**fields):
        raise RuntimeError('db down')

    app = FastAPI()
    app.add_middleware(AuditMiddleware, recorder=recorder)

    @app.post('/tasks', tags=['tasks'])
    async def create_task(tenant: Tenant = Depends(authed)):
        return {'id': 1}

    assert TestClient(app).post('/tasks').json() == {'id': 1}


def test_derive_action_fallbacks():
    assert derive_action('assign_task', ['tasks'], 'POST', '/tasks/{task_id}/assign') == 'tasks.assign_task'
    assert derive_action('create_flow', [], 'POST', '/flows/templates') == 'flows.create_flow'
    assert derive_action(None, [], 'DELETE', '/') == 'root.delete'
    assert derive_action('Weird Name!', ['Audit Logs'], 'PUT', '/x') == 'audit_logs.weird_name_'


def test_derive_target():
    assert derive_target({'task_id': 12, 'attachment_id': 4}, '/tasks/12/attachments/4') == ('task', '12')
    assert derive_target({'id': 5}, '/flows/5') == ('flow', '5')
    assert derive_target({'provider': 'github'}, '/integrations/github') == (None, None)


def test_redact_query_masks_secret_shaped_keys():
    assert redact_query([('mode', 'x'), ('api_key', 'k'), ('Authorization', 'b'), ('pat_token', 't')]) == {
        'mode': 'x', 'api_key': '[redacted]', 'Authorization': '[redacted]', 'pat_token': '[redacted]',
    }
