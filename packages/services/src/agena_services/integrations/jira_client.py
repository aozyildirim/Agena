from __future__ import annotations

import logging
from typing import Any

import httpx

from agena_core.settings import get_settings
from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class JiraClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def fetch_todo_issues(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        base_url = cfg.get('base_url') or self.settings.jira_base_url
        email = cfg.get('email') or self.settings.jira_email
        api_token = cfg.get('api_token') or self.settings.jira_api_token

        if not base_url:
            logger.warning('JIRA_BASE_URL is not set; returning empty task list.')
            return []

        url = f"{base_url.rstrip('/')}/rest/api/3/search"
        params = {
            'jql': 'status = "To Do"',
            'fields': 'summary,description,reporter,issuetype,project,labels,assignee,status',
            'maxResults': 50,
        }

        auth = (email, api_token)
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=auth)
            response.raise_for_status()
            data = response.json()

        return [self._to_external_task(issue) for issue in data.get('issues', [])]

    async def fetch_projects(self, cfg: dict[str, str] | None = None) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []
        search_url = f"{base_url.rstrip('/')}/rest/api/3/project/search"
        list_url = f"{base_url.rstrip('/')}/rest/api/3/project"
        params = {'maxResults': 100}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(search_url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
            values = data.get('values', []) if isinstance(data, dict) else []
            projects = self._normalize_projects(values)
            if projects:
                return projects
            # Jira variants/fallback: some tenants return projects from /project directly.
            fallback = await client.get(list_url, auth=(email, api_token))
            fallback.raise_for_status()
            fallback_data = fallback.json()
        return self._normalize_projects(fallback_data if isinstance(fallback_data, list) else [])

    def _normalize_projects(self, rows: list[dict[str, Any]]) -> list[dict[str, str]]:
        return [
            {
                'id': str(p.get('id', '')),
                'key': str(p.get('key', '')),
                'name': str(p.get('name', '')),
            }
            for p in rows
            if p.get('key') and p.get('name')
        ]

    async def fetch_boards(
        self,
        cfg: dict[str, str] | None = None,
        *,
        project_key: str | None = None,
    ) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board"
        params: dict[str, str | int] = {'maxResults': 100}
        if project_key:
            params['projectKeyOrId'] = project_key.strip()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        return [
            {
                'id': str(b.get('id', '')),
                'name': str(b.get('name', '')),
                'type': str(b.get('type', '')),
            }
            for b in data.get('values', [])
            if b.get('id') and b.get('name')
        ]

    async def fetch_sprints(self, cfg: dict[str, str] | None = None, *, board_id: str) -> list[dict[str, str]]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/sprint"
        params = {'state': 'active,future,closed', 'maxResults': 100}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, params=params, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        return [
            {
                'id': str(s.get('id', '')),
                'name': str(s.get('name', '')),
                'state': str(s.get('state', '')),
                'start_date': str(s.get('startDate', '') or ''),
                'finish_date': str(s.get('endDate', '') or ''),
            }
            for s in data.get('values', [])
            if s.get('id') and s.get('name')
        ]

    async def fetch_board_states(self, cfg: dict[str, str] | None = None, *, board_id: str) -> list[str]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/configuration"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, auth=(email, api_token))
            response.raise_for_status()
            data = response.json()
        seen: list[str] = []
        for col in (data.get('columnConfig') or {}).get('columns', []) or []:
            for st in col.get('statuses', []) or []:
                name = str(st.get('name', '')).strip()
                if name and name not in seen:
                    seen.append(name)
        return seen

    async def fetch_board_issues(
        self,
        cfg: dict[str, str] | None = None,
        *,
        board_id: str,
        sprint_id: str | None = None,
        state: str | None = None,
    ) -> list[ExternalTask]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id:
            return []

        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/issue"
        params: dict[str, str | int] = {
            'maxResults': 100,
            'fields': 'summary,description,status,assignee,created,reporter,issuetype,project,labels',
        }
        if sprint_id:
            params['sprint'] = sprint_id
        if state:
            escaped = state.replace('"', '\\"')
            params['jql'] = f'status = "{escaped}"'

        async with httpx.AsyncClient(timeout=40) as client:
            try:
                response = await client.get(url, params=params, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPStatusError as exc:
                # Some Jira boards reject status-based JQL in this endpoint with 400.
                # Fall back to plain board/sprint query and filter by issue status locally.
                if state and exc.response is not None and exc.response.status_code == 400:
                    logger.warning(
                        'Jira board issue query rejected status JQL; falling back to local filtering. '
                        'board_id=%s sprint_id=%s state=%s',
                        board_id,
                        sprint_id,
                        state,
                    )
                    fallback_params = dict(params)
                    fallback_params.pop('jql', None)
                    fallback_response = await client.get(url, params=fallback_params, auth=(email, api_token))
                    fallback_response.raise_for_status()
                    data = fallback_response.json()
                else:
                    raise
        items = [self._to_external_task(issue) for issue in data.get('issues', [])]
        if state:
            target = self._normalize_status(state)
            return [item for item in items if self._normalize_status(item.state) == target]
        return items

    async def fetch_completed_issues(
        self,
        cfg: dict[str, str] | None = None,
        *,
        project: str | None = None,
        board_id: str | None = None,
        since_days: int | None = 730,
        max_items: int = 5000,
    ) -> list[ExternalTask]:
        """JQL search for terminal-state issues with story points — used
        to backfill the refinement similarity index.

        Scope prefers project key when provided; otherwise uses the board's
        inferred scope. StoryPoints filter keeps the result set bounded.
        """
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url:
            return []

        story_point_field: str | None = None
        if board_id:
            story_point_field = await self._fetch_story_point_field_id(
                base_url=base_url, email=email, api_token=api_token, board_id=board_id,
            )
        # Fallback well-known field id — most Jira instances use customfield_10016
        # or customfield_10026 for Story Points. Try both in JQL via name syntax.
        sp_field = story_point_field or 'customfield_10016'

        jql_parts: list[str] = ['statusCategory = Done']
        if project:
            # project key or name; quote if it has spaces
            safe = str(project).replace('"', '\\"')
            jql_parts.append(f'project = "{safe}"')
        # 'Story Points' by field name — works on most Jira instances
        jql_parts.append('"Story Points" is not EMPTY')
        jql_parts.append('"Story Points" > 0')
        if since_days and since_days > 0:
            jql_parts.append(f'resolutiondate >= -{int(since_days)}d')
        jql = ' AND '.join(jql_parts) + ' ORDER BY resolutiondate DESC'

        url = f"{base_url.rstrip('/')}/rest/api/3/search"
        # Always request the numeric SP custom field so we can coerce it, and
        # include *all so the sprint custom field (varies by instance) comes
        # through without us having to guess its id.
        fields_list = ['summary', 'description', 'status', 'assignee', 'created', 'resolutiondate', 'issuetype', sp_field, '*all']
        items: list[ExternalTask] = []
        start_at = 0
        page_size = 100

        async with httpx.AsyncClient(timeout=60) as client:
            while True:
                params: dict[str, str | int] = {
                    'jql': jql,
                    'fields': ','.join(fields_list),
                    'maxResults': page_size,
                    'startAt': start_at,
                }
                try:
                    response = await client.get(url, params=params, auth=(email, api_token))
                    response.raise_for_status()
                    data = response.json()
                except httpx.HTTPStatusError as exc:
                    body = ''
                    try:
                        body = exc.response.text[:500]
                    except Exception:
                        pass
                    logger.error(
                        'Jira completed JQL failed %s: body=%r jql=%r',
                        exc.response.status_code, body, jql,
                    )
                    raise RuntimeError(f'Jira search {exc.response.status_code}: {body or exc}') from exc

                issues = data.get('issues', []) or []
                for issue in issues:
                    task = self._to_external_task(issue, story_point_field=sp_field)
                    task.web_url = self._build_issue_browse_url(base_url, task.id)
                    # Surface issue type into work_item_type so the UI groups by it
                    issuetype = (issue.get('fields') or {}).get('issuetype') or {}
                    if isinstance(issuetype, dict):
                        task.work_item_type = issuetype.get('name')
                    items.append(task)

                total = int(data.get('total') or 0)
                fetched = len(issues)
                start_at += max(fetched, page_size)
                if fetched == 0 or start_at >= total or len(items) >= max_items:
                    break

        if max_items and max_items > 0 and len(items) > max_items:
            items = items[:max_items]
        return items

    async def fetch_sprint_work_items(
        self,
        cfg: dict[str, str] | None = None,
        *,
        board_id: str,
        sprint_id: str,
    ) -> list[ExternalTask]:
        base_url, email, api_token = self._resolve_config(cfg)
        if not base_url or not board_id or not sprint_id:
            return []

        story_point_field = await self._fetch_story_point_field_id(
            base_url=base_url,
            email=email,
            api_token=api_token,
            board_id=board_id,
        )
        fields = ['summary', 'description', 'status', 'assignee', 'created']
        if story_point_field:
            fields.append(story_point_field)

        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/issue"
        start_at = 0
        max_results = 100
        items: list[ExternalTask] = []

        async with httpx.AsyncClient(timeout=40) as client:
            while True:
                params: dict[str, str | int] = {
                    'sprint': sprint_id,
                    'fields': ','.join(fields),
                    'maxResults': max_results,
                    'startAt': start_at,
                }
                response = await client.get(url, params=params, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
                issues = data.get('issues', [])
                for issue in issues:
                    task = self._to_external_task(issue, story_point_field=story_point_field)
                    task.sprint_id = sprint_id
                    task.web_url = self._build_issue_browse_url(base_url, task.id)
                    items.append(task)

                total = int(data.get('total') or 0)
                fetched = int(data.get('maxResults') or max_results)
                start_at += fetched
                if not issues or start_at >= total:
                    break
        return items

    async def fetch_issue_images(
        self,
        issue_key: str,
        *,
        cfg: dict[str, str] | None = None,
        max_images: int = 6,
    ) -> list[tuple[str, bytes, str]]:
        """Pull image attachments referenced from a Jira issue's description
        and comments. Returns up to `max_images` tuples of
        (filename, raw_bytes, mime_type) so the caller can decide whether
        to send them as base64 data URLs (API providers) or write to disk
        and reference by path (CLI bridge).

        Strategy: ask Jira for the *rendered* description + comment HTML
        (`expand=renderedFields,renderedBody`). That HTML embeds inline
        attachments as `<img src="...">` pointing at
        `/rest/api/3/attachment/content/{id}`, exactly like Azure's
        in-description image flow. Walking ADF media nodes directly would
        require an extra hop to convert the media UUID → attachment id, so
        we lean on Jira's own renderer instead.
        """
        import re as _re
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            return []
        host = base_url.rstrip('/')
        auth = (email, api_token)

        html_chunks: list[str] = []
        async with httpx.AsyncClient(timeout=20) as client:
            # Description, rendered as HTML
            try:
                resp = await client.get(
                    f"{host}/rest/api/3/issue/{key}",
                    params={'expand': 'renderedFields', 'fields': 'description'},
                    auth=auth,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    rendered = (data.get('renderedFields') or {}).get('description')
                    if isinstance(rendered, str) and rendered:
                        html_chunks.append(rendered)
            except Exception as exc:
                logger.info('Jira description render fetch failed for %s: %s', key, exc)
            # Comments, rendered as HTML
            try:
                resp = await client.get(
                    f"{host}/rest/api/3/issue/{key}/comment",
                    params={'expand': 'renderedBody', 'maxResults': 50, 'orderBy': '-created'},
                    auth=auth,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for c in data.get('comments', []) or []:
                        rb = c.get('renderedBody')
                        if isinstance(rb, str) and rb:
                            html_chunks.append(rb)
            except Exception as exc:
                logger.info('Jira comment render fetch failed for %s: %s', key, exc)

        if not html_chunks:
            return []

        # Pull every <img src=...>. Jira may emit the URL as absolute
        # (https://your-domain.atlassian.net/...) or as a path-relative
        # reference (/rest/api/3/attachment/...). Normalise to absolute.
        urls: list[str] = []
        seen: set[str] = set()
        for chunk in html_chunks:
            for match in _re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', chunk, flags=_re.IGNORECASE):
                raw = match.group(1).strip()
                if not raw or raw.startswith('data:'):
                    continue
                if raw.startswith('//'):
                    abs_url = 'https:' + raw
                elif raw.startswith('/'):
                    abs_url = host + raw
                else:
                    abs_url = raw
                # Only pull URLs that look like Jira-hosted attachments —
                # Basic auth scope we have only works there. Public CDN
                # links would 401 noisily and pollute logs.
                lower = abs_url.lower()
                host_ok = (
                    lower.startswith(host.lower())
                    or '/rest/api/3/attachment/' in lower
                    or '/secure/attachment/' in lower
                )
                if not host_ok:
                    continue
                if abs_url in seen:
                    continue
                seen.add(abs_url)
                urls.append(abs_url)
                if len(urls) >= max_images:
                    break
            if len(urls) >= max_images:
                break
        if not urls:
            return []

        results: list[tuple[str, bytes, str]] = []
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            for idx, url in enumerate(urls):
                try:
                    resp = await client.get(url, auth=auth)
                    if resp.status_code != 200:
                        logger.info('Skip Jira image %s — HTTP %s', url, resp.status_code)
                        continue
                    mime = (resp.headers.get('content-type') or '').split(';')[0].strip().lower()
                    if not mime.startswith('image/'):
                        continue
                    name = ''
                    cd = resp.headers.get('content-disposition') or ''
                    fn_match = _re.search(r'filename="?([^";]+)"?', cd)
                    if fn_match:
                        name = fn_match.group(1).strip()
                    if not name:
                        # Last-resort: last path segment, or seq number
                        tail = url.rsplit('/', 1)[-1].split('?')[0]
                        name = tail or f'jira-{idx + 1}'
                    results.append((name, resp.content, mime))
                except Exception as exc:
                    logger.info('Jira image fetch failed for %s: %s', url, exc)
        return results

    async def fetch_issue_attachments(
        self,
        issue_key: str,
        cfg: dict[str, str] | None = None,
        *,
        max_files: int = 6,
        max_bytes_per_file: int = 8 * 1024 * 1024,
    ) -> list[tuple[str, bytes, str]]:
        """Pull non-image attachments declared on a Jira issue. Mirrors
        Azure's `fetch_work_item_attachments` shape so the import path
        can call both clients with the same downstream handling. Inline
        screenshots are handled by `fetch_issue_images`; this method
        covers PDFs, Word/Excel docs and the like that PMs hang off the
        ticket. Best-effort — never raises."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            return []
        host = base_url.rstrip('/')
        auth = (email, api_token)
        results: list[tuple[str, bytes, str]] = []
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            try:
                resp = await client.get(
                    f"{host}/rest/api/3/issue/{key}",
                    params={'fields': 'attachment'},
                    auth=auth,
                )
            except Exception as exc:
                logger.info('Jira attachment list fetch failed for %s: %s', key, exc)
                return []
            if resp.status_code != 200:
                logger.info('Jira attachment list HTTP %s for %s', resp.status_code, key)
                return []
            data = resp.json() or {}
            attachments = ((data.get('fields') or {}).get('attachment') or [])
            for att in attachments:
                if len(results) >= max_files:
                    break
                if not isinstance(att, dict):
                    continue
                content_url = str(att.get('content') or '').strip()
                name = str(att.get('filename') or '').strip()
                if not content_url:
                    continue
                # Skip image attachments — covered by fetch_issue_images
                ext = (name.rsplit('.', 1)[-1] if '.' in name else '').lower()
                if ext in {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'}:
                    continue
                size = int(att.get('size') or 0)
                if size and size > max_bytes_per_file:
                    logger.info('Skip Jira attachment %s: %s bytes', name, size)
                    continue
                try:
                    bin_resp = await client.get(content_url, auth=auth)
                except Exception as exc:
                    logger.info('Jira attachment download failed for %s: %s', name, exc)
                    continue
                if bin_resp.status_code != 200:
                    logger.info('Jira attachment %s HTTP %s', name, bin_resp.status_code)
                    continue
                if len(bin_resp.content) > max_bytes_per_file:
                    continue
                mime = str(att.get('mimeType') or bin_resp.headers.get('content-type') or '').split(';')[0].strip().lower()
                if not name:
                    name = f'jira-attachment-{len(results) + 1}.bin'
                results.append((name, bin_resp.content, mime or 'application/octet-stream'))
        return results

    async def fetch_issue_fields(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
    ) -> dict[str, Any] | None:
        """Pull the latest summary + description (+ status / assignee) for
        a single Jira issue. Used by the refresh-from-source path so the
        task can be rebuilt against whatever has been edited upstream
        since import. Returns None if the issue can't be fetched.
        """
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            return None
        url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}"
        params = {'fields': 'summary,description,status,assignee'}
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.get(url, params=params, auth=(email, api_token))
        except Exception as exc:
            logger.info('fetch_issue_fields network error for %s: %s', key, exc)
            return None
        if resp.status_code != 200:
            logger.info('fetch_issue_fields HTTP %s for %s', resp.status_code, key)
            return None
        data = resp.json() or {}
        fields = data.get('fields') or {}
        status = fields.get('status') if isinstance(fields.get('status'), dict) else {}
        assignee = fields.get('assignee') if isinstance(fields.get('assignee'), dict) else {}
        return {
            'title': str(fields.get('summary') or '').strip(),
            'description': self._parse_jira_description(fields.get('description')),
            'state': str((status or {}).get('name') or '').strip(),
            'assigned_to': str((assignee or {}).get('displayName') or '').strip(),
        }

    async def fetch_issue_comments(
        self, *, cfg: dict[str, str] | None, issue_key: str,
    ) -> list[dict[str, Any]]:
        """Return comments on a Jira issue, newest-first, with plain-text body."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            return []
        url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}/comment"
        params = {'orderBy': '-created', 'maxResults': 50}
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params, auth=(email, api_token))
            if resp.status_code != 200:
                return []
            data = resp.json()
        out: list[dict[str, Any]] = []
        for c in data.get('comments', []) or []:
            body = c.get('body') or {}
            text = self._flatten_adf_text(body) if isinstance(body, dict) else str(body or '')
            out.append({
                'id': c.get('id'),
                'text': text,
                'created_by': (c.get('author') or {}).get('displayName') or '',
                'created_at': c.get('created') or c.get('updated') or '',
            })
        return out

    @staticmethod
    def _flatten_adf_text(node: dict[str, Any]) -> str:
        # Atlassian Document Format → plain text (depth-first concat of text nodes).
        if not isinstance(node, dict):
            return ''
        if node.get('type') == 'text':
            return str(node.get('text') or '')
        parts: list[str] = []
        for child in node.get('content') or []:
            parts.append(JiraClient._flatten_adf_text(child))
        return ''.join(parts).strip()

    async def transition_issue(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
        target_status: str,
    ) -> str | None:
        """Move a Jira issue to the named workflow state.

        Jira does not let you set `status` directly — you fetch the list of
        available transitions for the current state and POST the transition
        whose target status matches. Returns the transition id used, or
        None when no matching transition exists (caller can decide whether
        that is fatal for sync).
        """
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        target = str(target_status or '').strip()
        if not base_url or not key or not target:
            raise ValueError('Jira base_url, issue_key and target_status are required')

        host = base_url.rstrip('/')
        target_norm = self._normalize_status(target)
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                f'{host}/rest/api/3/issue/{key}/transitions',
                auth=(email, api_token),
            )
            resp.raise_for_status()
            transitions = (resp.json() or {}).get('transitions', []) or []
            picked: dict[str, Any] | None = None
            for tr in transitions:
                if not isinstance(tr, dict):
                    continue
                to = tr.get('to') if isinstance(tr.get('to'), dict) else {}
                if self._normalize_status((to or {}).get('name')) == target_norm:
                    picked = tr
                    break
                if self._normalize_status(tr.get('name')) == target_norm:
                    picked = tr
                    break
            if not picked:
                logger.info(
                    'Jira: no transition to %r for %s (available: %s)',
                    target, key,
                    [str((t.get('to') or {}).get('name', '')) for t in transitions if isinstance(t, dict)],
                )
                return None
            tr_id = str(picked.get('id') or '').strip()
            if not tr_id:
                return None
            post = await client.post(
                f'{host}/rest/api/3/issue/{key}/transitions',
                json={'transition': {'id': tr_id}},
                auth=(email, api_token),
            )
            if post.status_code >= 400:
                raise RuntimeError(f'Jira transition {post.status_code}: {post.text[:200]}')
        return tr_id

    async def writeback_refinement(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
        suggested_story_points: int,
        comment: str,
        board_id: str,
        assignee_email: str | None = None,
    ) -> None:
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        if not base_url or not key:
            raise ValueError('Jira base_url or issue key is missing')

        story_field = await self._fetch_story_point_field_id(
            base_url=base_url,
            email=email,
            api_token=api_token,
            board_id=board_id,
        ) if board_id else None

        async with httpx.AsyncClient(timeout=30) as client:
            if story_field and int(suggested_story_points or 0) > 0:
                issue_url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}"
                payload = {'fields': {story_field: int(suggested_story_points)}}
                response = await client.put(issue_url, json=payload, auth=(email, api_token))
                response.raise_for_status()

            comment_text = str(comment or '').strip()
            if comment_text:
                comment_url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}/comment"
                comment_payload = {
                    'body': self._format_comment_adf(comment_text),
                }
                response = await client.post(comment_url, json=comment_payload, auth=(email, api_token))
                response.raise_for_status()

            assignee = (assignee_email or '').strip()
            if assignee:
                # Jira Cloud accepts {emailAddress}; Data Center wants {name}.
                assignee_url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}/assignee"
                response = await client.put(
                    assignee_url, json={'emailAddress': assignee}, auth=(email, api_token),
                )
                if response.status_code >= 400:
                    raise RuntimeError(f'Jira assignee PUT {response.status_code}: {response.text[:200]}')

    async def create_issue(
        self,
        *,
        cfg: dict[str, str] | None,
        project_key: str,
        summary: str,
        description: str = '',
        issue_type: str = 'Bug',
        labels: list[str] | None = None,
    ) -> dict[str, Any]:
        """Create a Jira issue and return the response (includes id + key)."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(project_key or '').strip()
        if not base_url or not key or not summary:
            raise ValueError('Jira base_url, project_key and summary are required')

        fields: dict[str, Any] = {
            'project': {'key': key},
            'summary': summary[:255],
            'issuetype': {'name': issue_type or 'Bug'},
        }
        if description:
            fields['description'] = self._format_comment_adf(description)
        if labels:
            fields['labels'] = [str(lbl) for lbl in labels if lbl]

        url = f"{base_url.rstrip('/')}/rest/api/3/issue"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json={'fields': fields}, auth=(email, api_token))
            resp.raise_for_status()
            return resp.json()

    async def add_label_to_issue(
        self,
        *,
        cfg: dict[str, str] | None,
        issue_key: str,
        label: str,
    ) -> None:
        """Append a label to a Jira issue. Idempotent — uses the 'update' op to avoid duplicates."""
        base_url, email, api_token = self._resolve_config(cfg)
        key = str(issue_key or '').strip()
        label_value = str(label or '').strip()
        if not base_url or not key or not label_value:
            return

        url = f"{base_url.rstrip('/')}/rest/api/3/issue/{key}"
        payload = {'update': {'labels': [{'add': label_value}]}}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.put(url, json=payload, auth=(email, api_token))
            response.raise_for_status()

    @staticmethod
    def _format_comment_adf(text: str) -> dict:
        """Convert plain-text refinement comment to Jira ADF (Atlassian Document Format)."""
        content: list[dict] = []
        lines = text.split('\n')
        list_items: list[dict] = []

        def flush_list():
            nonlocal list_items
            if list_items:
                content.append({'type': 'bulletList', 'content': list_items})
                list_items = []

        for line in lines:
            stripped = line.strip()
            if not stripped:
                flush_list()
                continue
            elif stripped.startswith('📊') or stripped.startswith('🎯') or stripped.startswith('❓') or stripped.startswith('⚠️'):
                flush_list()
                content.append({
                    'type': 'heading', 'attrs': {'level': 3},
                    'content': [{'type': 'text', 'text': stripped}],
                })
            elif stripped.startswith('---'):
                flush_list()
                content.append({'type': 'rule'})
            elif stripped[0:1].isdigit() and '. ' in stripped[:4]:
                list_items.append({
                    'type': 'listItem',
                    'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': stripped[stripped.index('. ') + 2:]}]}],
                })
            elif stripped.startswith('• ') or stripped.startswith('- '):
                list_items.append({
                    'type': 'listItem',
                    'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': stripped[2:]}]}],
                })
            else:
                flush_list()
                content.append({
                    'type': 'paragraph',
                    'content': [{'type': 'text', 'text': stripped}],
                })

        flush_list()
        if not content:
            content.append({'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]})
        return {'type': 'doc', 'version': 1, 'content': content}

    def _resolve_config(self, cfg: dict[str, str] | None) -> tuple[str, str, str]:
        cfg = cfg or {}
        base_url = cfg.get('base_url') or self.settings.jira_base_url
        email = cfg.get('email') or self.settings.jira_email
        api_token = cfg.get('api_token') or self.settings.jira_api_token
        return base_url, email, api_token

    async def _fetch_story_point_field_id(
        self,
        *,
        base_url: str,
        email: str,
        api_token: str,
        board_id: str,
    ) -> str | None:
        url = f"{base_url.rstrip('/')}/rest/agile/1.0/board/{board_id}/configuration"
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                response = await client.get(url, auth=(email, api_token))
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPError:
                return None
        estimation = data.get('estimation') or {}
        field = estimation.get('field') if isinstance(estimation, dict) else {}
        if not isinstance(field, dict):
            return None
        value = str(field.get('fieldId') or '').strip()
        return value or None

    async def fetch_dev_info(
        self,
        cfg: dict[str, str],
        *,
        issue_id: str,
        concurrency_note: str = '',
    ) -> dict[str, list[str]]:
        """Best-effort fetch of development info (branches, PRs, commits) from
        Jira's dev-status endpoint. Returns {branches, pr_titles, pr_count,
        commit_count}. Silently returns empty for instances that don't expose
        this API (self-hosted, or without a dev tool integration configured).

        Tries common applicationTypes: github, bitbucket, stash, GitLab.
        """
        base_url, email, api_token = self._resolve_config(cfg)
        empty: dict[str, Any] = {
            'branches': [], 'pr_titles': [], 'pr_count': 0, 'commit_count': 0,
            'primary_pr_url': None, 'primary_branch_name': None,
        }
        if not base_url or not issue_id:
            return empty
        url = f"{base_url.rstrip('/')}/rest/dev-status/1.0/issue/detail"
        branches: list[str] = []
        pr_titles: list[str] = []
        # Track full PR records so we can pick the most relevant one (open
        # first, otherwise most recently merged) and surface its URL +
        # source branch to the importer.
        pr_records: list[dict[str, Any]] = []
        pr_count = 0
        commit_count = 0
        async with httpx.AsyncClient(timeout=15) as client:
            for app_type, data_type in (
                ('GitHub', 'pullrequest'),
                ('bitbucket', 'pullrequest'),
                ('stash', 'pullrequest'),
                ('GitLab', 'pullrequest'),
                ('GitHub', 'branch'),
                ('bitbucket', 'branch'),
                ('GitHub', 'repository'),  # commits
            ):
                try:
                    resp = await client.get(
                        url,
                        params={'issueId': issue_id, 'applicationType': app_type, 'dataType': data_type},
                        auth=(email, api_token),
                    )
                    if resp.status_code != 200:
                        continue
                    detail = resp.json().get('detail') or []
                    for entry in detail:
                        if not isinstance(entry, dict):
                            continue
                        for pr in entry.get('pullRequests') or []:
                            if isinstance(pr, dict) and pr.get('name'):
                                pr_titles.append(str(pr['name'])[:300])
                                pr_count += 1
                                pr_records.append({
                                    'url': str(pr.get('url') or '').strip(),
                                    'status': str(pr.get('status') or '').strip().lower(),
                                    'source_branch': str(pr.get('source', {}).get('branch') or '').strip()
                                        if isinstance(pr.get('source'), dict) else '',
                                    'last_update': str(pr.get('lastUpdate') or '').strip(),
                                })
                        for br in entry.get('branches') or []:
                            if isinstance(br, dict) and br.get('name'):
                                branches.append(str(br['name']))
                        for repo in entry.get('repositories') or []:
                            if isinstance(repo, dict):
                                commit_count += len(repo.get('commits') or [])
                except Exception:
                    continue

        # Dedup
        def _dedup(xs: list[str]) -> list[str]:
            seen: set[str] = set()
            out: list[str] = []
            for x in xs:
                if x and x not in seen:
                    seen.add(x)
                    out.append(x)
            return out

        # Pick the primary PR: prefer 'open', fall back to most recent
        # 'merged'. Skip 'declined' / 'closed' / 'abandoned'.
        primary_pr_url: str | None = None
        primary_branch_name: str | None = None
        ranked = sorted(
            pr_records,
            key=lambda p: (
                0 if p['status'] == 'open' else (1 if p['status'] == 'merged' else 2),
                # Newer lastUpdate wins within the same status bucket. We
                # invert by string sort since Jira returns ISO-8601 timestamps.
                -1 * (sum(ord(c) for c in (p.get('last_update') or ''))),
            ),
        )
        for p in ranked:
            if p['status'] in ('declined', 'closed', 'abandoned'):
                continue
            if p['url']:
                primary_pr_url = p['url']
                primary_branch_name = p['source_branch'] or None
                break

        return {
            'branches': _dedup(branches)[:10],
            'pr_titles': _dedup(pr_titles)[:10],
            'pr_count': len(_dedup(pr_titles)),
            'commit_count': commit_count,
            'primary_pr_url': primary_pr_url,
            'primary_branch_name': primary_branch_name,
        }

    def _to_external_task(self, issue: dict[str, Any], *, story_point_field: str | None = None) -> ExternalTask:
        fields = issue.get('fields', {})
        story_points = None
        if story_point_field:
            story_points = self._coerce_float(fields.get(story_point_field))
        # Jira sprint lives in a customfield_NNNNN; we don't know the exact id
        # across instances, so scan values for an array of sprint-shaped objects
        # and pick the most recent/active one.
        sprint_name: str | None = None
        sprint_id: str | None = None
        for fk, fv in (fields or {}).items():
            if not isinstance(fk, str) or not fk.startswith('customfield_'):
                continue
            if isinstance(fv, list) and fv and isinstance(fv[0], dict) and fv[0].get('name') and ('state' in fv[0] or 'boardId' in fv[0]):
                # pick active sprint if any, else last (most recent) entry
                active = next((s for s in fv if isinstance(s, dict) and str(s.get('state', '')).lower() == 'active'), None)
                closed = [s for s in fv if isinstance(s, dict) and str(s.get('state', '')).lower() == 'closed']
                picked = active or (closed[-1] if closed else fv[-1] if isinstance(fv[-1], dict) else None)
                if picked:
                    sprint_name = picked.get('name')
                    sprint_id = str(picked.get('id')) if picked.get('id') is not None else None
                break
        # Reporter / issue type / project / labels — used by the rule engine
        # to auto-tag and auto-route imported tasks.
        reporter = fields.get('reporter') if isinstance(fields.get('reporter'), dict) else None
        reporter_email = str((reporter or {}).get('emailAddress') or '').strip() or None
        reporter_name = str((reporter or {}).get('displayName') or '').strip() or None
        issuetype = fields.get('issuetype') if isinstance(fields.get('issuetype'), dict) else None
        issue_type = str((issuetype or {}).get('name') or '').strip() or None
        project = fields.get('project') if isinstance(fields.get('project'), dict) else None
        project_key = str((project or {}).get('key') or '').strip() or None
        labels_raw = fields.get('labels') or []
        labels = [str(x) for x in labels_raw if isinstance(x, str)] if isinstance(labels_raw, list) else []

        return ExternalTask(
            id=issue.get('key', '') or issue.get('id', ''),
            internal_id=str(issue.get('id')) if issue.get('id') is not None else None,
            title=fields.get('summary', ''),
            description=self._parse_jira_description(fields.get('description')),
            source='jira',
            state=((fields.get('status') or {}).get('name') if isinstance(fields.get('status'), dict) else None),
            assigned_to=((fields.get('assignee') or {}).get('displayName') if isinstance(fields.get('assignee'), dict) else None),
            created_date=fields.get('created'),
            closed_date=fields.get('resolutiondate'),
            story_points=story_points,
            sprint_id=sprint_id,
            sprint_name=sprint_name,
            reporter_email=reporter_email,
            reporter_name=reporter_name,
            issue_type=issue_type,
            project_key=project_key,
            labels=labels,
        )

    def _parse_jira_description(self, payload: Any) -> str:
        if not payload:
            return ''
        if isinstance(payload, str):
            return payload

        parts: list[str] = []
        for block in payload.get('content', []):
            for child in block.get('content', []):
                text = child.get('text')
                if text:
                    parts.append(text)
        return '\n'.join(parts)

    def _normalize_status(self, value: str | None) -> str:
        return str(value or '').strip().casefold()

    def _coerce_float(self, value: Any) -> float | None:
        if value in (None, ''):
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _build_issue_browse_url(self, base_url: str, key: str) -> str | None:
        normalized = str(key or '').strip()
        if not normalized:
            return None
        return f"{base_url.rstrip('/')}/browse/{normalized}"
