from __future__ import annotations

import base64
import logging
from typing import Any
from urllib.parse import quote

import httpx

from agena_core.settings import get_settings
from agena_models.schemas.task import ExternalTask

logger = logging.getLogger(__name__)


class AzureDevOpsClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def fetch_new_work_items(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        org_url = cfg.get('org_url') or self.settings.azure_org_url
        project = cfg.get('project') or self.settings.azure_project
        pat = cfg.get('pat') or self.settings.azure_pat
        team = cfg.get('team') or ''
        sprint = cfg.get('sprint_path') or ''
        state = cfg.get('state') if cfg.get('state') is not None else 'New'

        if not org_url or not project:
            logger.warning('Azure DevOps settings are incomplete; returning empty task list.')
            return []

        wiql_url = (
            f"{org_url.rstrip('/')}/{project}"
            '/_apis/wit/wiql?api-version=7.1-preview.2'
        )
        conditions = [f'[System.State] = "{state}"'] if state else []
        iteration_path = self._build_iteration_path(project=project, team=team, sprint=sprint)
        if iteration_path:
            conditions.append(f"[System.IterationPath] UNDER '{iteration_path}'")

        where_clause = ' And '.join(conditions) if conditions else '1 = 1'
        wiql_payload = {
            'query': (
                'Select [System.Id], [System.Title], [System.Description] '
                f'From WorkItems Where {where_clause} '
                'Order By [System.ChangedDate] Desc'
            )
        }

        headers = self._headers(pat)

        async with httpx.AsyncClient(timeout=30) as client:
            details_payload = await self._fetch_details_from_wiql(
                client=client,
                wiql_url=wiql_url,
                headers=headers,
                wiql_payload=wiql_payload,
                org_url=org_url,
                fields_param=(
                    'System.Id,System.Title,System.Description,System.State,'
                    'System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ActivatedDate,'
                    'Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.TCM.ReproSteps'
                ),
            )
        return [self._to_external_task(item, org_url=org_url, project=project) for item in details_payload]

    async def fetch_sprint_work_items(self, cfg: dict[str, str] | None = None) -> list[ExternalTask]:
        cfg = cfg or {}
        org_url = cfg.get('org_url') or self.settings.azure_org_url
        project = cfg.get('project') or self.settings.azure_project
        pat = cfg.get('pat') or self.settings.azure_pat
        team = cfg.get('team') or ''
        sprint = cfg.get('sprint_path') or ''

        if not org_url or not project or not sprint:
            logger.warning('Azure sprint fetch skipped because org/project/sprint is incomplete.')
            return []

        wiql_url = (
            f"{org_url.rstrip('/')}/{project}"
            '/_apis/wit/wiql?api-version=7.1-preview.2'
        )
        iteration_path = self._build_iteration_path(project=project, team=team, sprint=sprint)
        wiql_payload = {
            'query': (
                'Select [System.Id], [System.Title], [System.State] '
                f"From WorkItems Where [System.IterationPath] UNDER '{iteration_path}' "
                'Order By [System.ChangedDate] Desc'
            )
        }
        headers = self._headers(pat)

        async with httpx.AsyncClient(timeout=40) as client:
            details_payload = await self._fetch_details_from_wiql(
                client=client,
                wiql_url=wiql_url,
                headers=headers,
                wiql_payload=wiql_payload,
                org_url=org_url,
                fields_param=(
                    'System.Id,System.Title,System.Description,System.State,'
                    'System.AssignedTo,System.CreatedDate,Microsoft.VSTS.Common.ActivatedDate,'
                    'System.WorkItemType,System.IterationPath,'
                    'Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort,'
                    'Microsoft.VSTS.Scheduling.Size,'
                    'Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.TCM.ReproSteps'
                ),
            )
        return [self._to_external_task(item, org_url=org_url, project=project) for item in details_payload]

    async def fetch_completed_work_items(
        self,
        cfg: dict[str, str] | None = None,
        *,
        since_days: int | None = 365,
        max_items: int | None = 1000,
        team: str | None = None,
    ) -> list[ExternalTask]:
        """Fetch completed work items across the project (Done/Closed/Resolved/Removed).

        Used to backfill history for refinement similarity search. Filters by
        ChangedDate to keep the result bounded; pass since_days=None for everything.
        When `team` is set, scopes to that team's area path so we don't pull in
        other teams' backlog (which also happens to dodge Azure's 20k WIQL cap
        for large projects).
        """
        cfg = cfg or {}
        org_url = cfg.get('org_url') or self.settings.azure_org_url
        project = cfg.get('project') or self.settings.azure_project
        pat = cfg.get('pat') or self.settings.azure_pat

        if not org_url or not project:
            logger.warning('Azure DevOps settings are incomplete; returning empty completed list.')
            return []

        wiql_url = (
            f"{org_url.rstrip('/')}/{project}"
            '/_apis/wit/wiql?api-version=7.1-preview.2'
        )
        fields_param = (
            'System.Id,System.Title,System.Description,System.State,'
            'System.AssignedTo,System.CreatedDate,'
            'Microsoft.VSTS.Common.ActivatedDate,Microsoft.VSTS.Common.ClosedDate,'
            'System.WorkItemType,System.IterationPath,'
            'Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.Effort,'
            'Microsoft.VSTS.Scheduling.Size,'
            'Microsoft.VSTS.Common.AcceptanceCriteria,Microsoft.VSTS.TCM.ReproSteps'
        )
        headers = self._headers(pat)

        # Azure WIQL rejects queries whose result set exceeds 20k rows
        # (VS402337). Busy projects blow through that even with filters,
        # so we slice the time window into chunks and union results.
        chunk_days = 90
        window_days = int(since_days) if since_days and since_days > 0 else 730
        # Build disjoint [lower, upper) day-offset ranges going back from today.
        chunks: list[tuple[int, int]] = []
        upper = 0
        while upper < window_days:
            lower = min(upper + chunk_days, window_days)
            chunks.append((upper, lower))
            upper = lower

        seen_ids: set[int] = set()
        details_payload: list[dict[str, Any]] = []

        async with httpx.AsyncClient(timeout=60) as client:
            for idx, (newer_offset, older_offset) in enumerate(chunks):
                state_clauses = [
                    "[System.State] = 'Done'",
                    "[System.State] = 'Closed'",
                    "[System.State] = 'Resolved'",
                ]
                # ChangedDate is in [@Today-older, @Today-newer) — newer_offset=0
                # on the most recent chunk.
                date_filter = f'[System.ChangedDate] >= @Today-{older_offset}'
                if newer_offset > 0:
                    date_filter += f' AND [System.ChangedDate] < @Today-{newer_offset}'
                parts = [
                    f"({' OR '.join(state_clauses)})",
                    '[Microsoft.VSTS.Scheduling.StoryPoints] > 0',
                    date_filter,
                ]
                if team:
                    # Area path convention: <Project>\<Team>. WIQL single-quotes
                    # need backslashes escaped.
                    area_root = f"{project}\\{team}".replace("'", "''")
                    parts.append(f"[System.AreaPath] UNDER '{area_root}'")
                where_clause = ' AND '.join(parts)
                wiql_payload = {
                    'query': (
                        'Select [System.Id], [System.Title], [System.State] '
                        f'From WorkItems Where {where_clause} '
                        'Order By [System.ChangedDate] Desc'
                    )
                }
                try:
                    chunk_rows = await self._fetch_details_from_wiql(
                        client=client,
                        wiql_url=wiql_url,
                        headers=headers,
                        wiql_payload=wiql_payload,
                        org_url=org_url,
                        fields_param=fields_param,
                    )
                except httpx.HTTPStatusError as exc:
                    body = ''
                    try:
                        body = exc.response.text[:500]
                    except Exception:
                        pass
                    logger.error(
                        'Azure WIQL chunk %d (%d-%d days) failed %s: body=%r',
                        idx, newer_offset, older_offset, exc.response.status_code, body,
                    )
                    # If a single chunk still overflows, give up on this chunk
                    # rather than the whole backfill. Continue to the next.
                    if '20000' in body or 'size limit' in body.lower():
                        logger.warning(
                            'Chunk %d exceeds 20k rows even after filters; skipping. '
                            'Consider narrowing since_days or adding WorkItemType filter.',
                            idx,
                        )
                        continue
                    detail = body or str(exc)
                    raise RuntimeError(f'Azure WIQL {exc.response.status_code}: {detail}') from exc

                for row in chunk_rows:
                    try:
                        rid = int(row.get('id') or (row.get('fields') or {}).get('System.Id') or 0)
                    except (TypeError, ValueError):
                        rid = 0
                    if rid and rid in seen_ids:
                        continue
                    if rid:
                        seen_ids.add(rid)
                    details_payload.append(row)

                if max_items and max_items > 0 and len(details_payload) >= max_items:
                    break

        if max_items and max_items > 0 and len(details_payload) > max_items:
            details_payload = details_payload[:max_items]
        return [self._to_external_task(item, org_url=org_url, project=project) for item in details_payload]

    async def writeback_refinement(
        self,
        *,
        cfg: dict[str, str],
        work_item_id: str,
        suggested_story_points: int,
        comment: str,
    ) -> None:
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat:
            raise ValueError('Azure org_url or PAT is missing')
        item_id = str(work_item_id or '').strip()
        if not item_id:
            raise ValueError('work_item_id is required')

        patch_ops: list[dict[str, Any]] = []
        if int(suggested_story_points or 0) > 0:
            patch_ops.append({
                'op': 'add',
                'path': '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
                'value': int(suggested_story_points),
            })
        if str(comment or '').strip():
            # Azure DevOps System.History accepts HTML — convert newlines to <br> and format sections
            html_comment = self._format_comment_html(str(comment).strip())
            patch_ops.append({
                'op': 'add',
                'path': '/fields/System.History',
                'value': html_comment,
            })
        if not patch_ops:
            return

        url = f"{org_url.rstrip('/')}/_apis/wit/workitems/{item_id}?api-version=7.1-preview.3"
        headers = self._headers(pat)
        headers['Content-Type'] = 'application/json-patch+json'
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.patch(url, headers=headers, json=patch_ops)
            response.raise_for_status()

    async def add_tag_to_work_item(
        self,
        *,
        cfg: dict[str, str],
        work_item_id: str,
        tag: str,
    ) -> None:
        """Append a tag to an Azure DevOps work item's System.Tags field (semicolon-separated)."""
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat:
            raise ValueError('Azure org_url or PAT is missing')
        item_id = str(work_item_id or '').strip()
        tag_value = str(tag or '').strip()
        if not item_id or not tag_value:
            return

        url_get = f"{org_url.rstrip('/')}/_apis/wit/workitems/{item_id}?fields=System.Tags&api-version=7.1-preview.3"
        headers = self._headers(pat)
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url_get, headers=headers)
            resp.raise_for_status()
            current_tags = str((resp.json().get('fields') or {}).get('System.Tags') or '').strip()

            existing = [t.strip() for t in current_tags.split(';') if t.strip()]
            if tag_value in existing:
                return
            existing.append(tag_value)
            new_tags = '; '.join(existing)

            url_patch = f"{org_url.rstrip('/')}/_apis/wit/workitems/{item_id}?api-version=7.1-preview.3"
            patch_headers = {**headers, 'Content-Type': 'application/json-patch+json'}
            patch_ops = [{'op': 'add', 'path': '/fields/System.Tags', 'value': new_tags}]
            patch_resp = await client.patch(url_patch, headers=patch_headers, json=patch_ops)
            patch_resp.raise_for_status()

    async def fetch_work_item_comments(
        self, *, cfg: dict[str, str], project: str, work_item_id: str,
    ) -> list[dict[str, Any]]:
        """Return the comments on a work item, newest-first."""
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat or not project or not work_item_id:
            return []
        url = (
            f"{org_url.rstrip('/')}/{project}/_apis/wit/workItems/{work_item_id}/comments"
            f"?api-version=7.1-preview.4&$top=200&order=desc"
        )
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, headers=self._headers(pat))
            if resp.status_code != 200:
                return []
            items = (resp.json() or {}).get('comments', []) or []
            result: list[dict[str, Any]] = []
            for c in items:
                user = c.get('createdBy') or {}
                result.append({
                    'id': c.get('id'),
                    'text': c.get('text') or '',
                    'created_by': user.get('displayName') or user.get('uniqueName') or '',
                    'created_at': c.get('createdDate') or '',
                })
            return result

    async def get_authenticated_user_upn(self, *, cfg: dict[str, str]) -> str | None:
        """Return the authenticated user's unique name (UPN/email) from Azure DevOps, or None."""
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat:
            return None
        url = f"{org_url.rstrip('/')}/_apis/connectionData?api-version=7.1-preview.1"
        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.get(url, headers=self._headers(pat))
                if resp.status_code != 200:
                    return None
                data = resp.json() or {}
                auth_user = data.get('authenticatedUser') or {}
                return (
                    (auth_user.get('properties') or {}).get('Account', {}).get('$value')
                    or auth_user.get('providerDisplayName')
                    or None
                )
            except Exception:
                return None

    async def create_work_item(
        self,
        *,
        cfg: dict[str, str],
        project: str,
        title: str,
        description: str = '',
        work_item_type: str = 'Task',
        iteration_path: str | None = None,
        area_path: str | None = None,
        assigned_to: str | None = None,
        tags: str | None = None,
        story_points: int | float | None = 2,
    ) -> dict[str, Any]:
        """Create an Azure DevOps work item and return the full response (including id & url)."""
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat:
            raise ValueError('Azure org_url or PAT is missing')
        if not project or not title:
            raise ValueError('project and title are required')

        patch_ops: list[dict[str, Any]] = [
            {'op': 'add', 'path': '/fields/System.Title', 'value': title[:255]},
        ]
        if description:
            patch_ops.append({
                'op': 'add',
                'path': '/fields/System.Description',
                'value': self._markdown_to_html(description),
            })
        if iteration_path:
            patch_ops.append({'op': 'add', 'path': '/fields/System.IterationPath', 'value': iteration_path})
        if area_path:
            patch_ops.append({'op': 'add', 'path': '/fields/System.AreaPath', 'value': area_path})
        if assigned_to:
            patch_ops.append({'op': 'add', 'path': '/fields/System.AssignedTo', 'value': assigned_to})
        if story_points is not None:
            patch_ops.append({'op': 'add', 'path': '/fields/Microsoft.VSTS.Scheduling.StoryPoints', 'value': story_points})
        if tags:
            patch_ops.append({'op': 'add', 'path': '/fields/System.Tags', 'value': tags})

        url = (
            f"{org_url.rstrip('/')}/{project}/_apis/wit/workitems/"
            f"${work_item_type}?api-version=7.1-preview.3"
        )
        headers = {**self._headers(pat), 'Content-Type': 'application/json-patch+json'}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, headers=headers, json=patch_ops)
            resp.raise_for_status()
            return resp.json()

    async def get_current_iteration(
        self,
        *,
        cfg: dict[str, str],
        project: str,
        team: str | None = None,
    ) -> dict[str, Any] | None:
        """Return the current iteration (sprint) for the given project/team, or None."""
        org_url = (cfg.get('org_url') or self.settings.azure_org_url or '').strip()
        pat = (cfg.get('pat') or self.settings.azure_pat or '').strip()
        if not org_url or not pat or not project:
            return None
        scope = f"{project}/{team}" if team else project
        url = (
            f"{org_url.rstrip('/')}/{scope}/_apis/work/teamsettings/iterations"
            f"?$timeframe=current&api-version=7.1-preview.1"
        )
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, headers=self._headers(pat))
            if resp.status_code != 200:
                return None
            items = (resp.json() or {}).get('value', []) or []
            return items[0] if items else None

    @staticmethod
    def _markdown_to_html(text: str) -> str:
        """Lightweight markdown→HTML converter sufficient for Agena-generated
        task descriptions (headings, bold, code, tables, bullets, links).
        Azure DevOps System.Description expects HTML — passing raw markdown
        shows the # and ** characters verbatim."""
        import re as _re
        import html as _html
        if not text:
            return ''

        src = text.replace('\r\n', '\n').replace('\r', '\n')

        # Extract fenced code blocks first (so we don't mangle their contents)
        code_blocks: list[str] = []

        def _stash_code(m: 're.Match[str]') -> str:
            body = m.group(2)
            escaped = _html.escape(body)
            code_blocks.append(f'<pre style="background:#f4f4f4;padding:8px;border-radius:4px;overflow:auto"><code>{escaped}</code></pre>')
            return f'\x00CODE{len(code_blocks) - 1}\x00'

        src = _re.sub(r'```([\w-]*)\n(.*?)```', _stash_code, src, flags=_re.DOTALL)

        # Extract inline code spans
        inline_codes: list[str] = []

        def _stash_inline(m: 're.Match[str]') -> str:
            escaped = _html.escape(m.group(1))
            inline_codes.append(f'<code style="background:#f4f4f4;padding:1px 4px;border-radius:3px">{escaped}</code>')
            return f'\x00INL{len(inline_codes) - 1}\x00'

        src = _re.sub(r'`([^`\n]+)`', _stash_inline, src)

        lines = src.split('\n')
        out: list[str] = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                out.append('')
                i += 1
                continue

            # Headings
            h_match = _re.match(r'^(#{1,6})\s+(.*)$', stripped)
            if h_match:
                level = min(len(h_match.group(1)), 6)
                content = h_match.group(2)
                out.append(f'<h{level}>{AzureDevOpsClient._md_inline_transform(content)}</h{level}>')
                i += 1
                continue

            # Tables — collect rows while the line matches pipe-separated cells
            if '|' in stripped and stripped.startswith('|'):
                table_rows: list[list[str]] = []
                while i < len(lines):
                    lstrip = lines[i].strip()
                    if not lstrip.startswith('|') or '|' not in lstrip:
                        break
                    # Skip separator rows like |---|---|
                    if _re.match(r'^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$', lstrip):
                        i += 1
                        continue
                    cells = [c.strip() for c in lstrip.strip('|').split('|')]
                    table_rows.append(cells)
                    i += 1
                if table_rows:
                    header = table_rows[0]
                    body_rows = table_rows[1:]
                    th = ''.join(f'<th style="border:1px solid #ddd;padding:4px 8px;text-align:left">{AzureDevOpsClient._md_inline_transform(c)}</th>' for c in header)
                    trs = ''.join(
                        '<tr>' + ''.join(f'<td style="border:1px solid #ddd;padding:4px 8px">{AzureDevOpsClient._md_inline_transform(c)}</td>' for c in row) + '</tr>'
                        for row in body_rows
                    )
                    out.append(f'<table style="border-collapse:collapse;margin:6px 0"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>')
                    continue

            # Bullet lists
            if _re.match(r'^[-*+]\s+', stripped):
                items: list[str] = []
                while i < len(lines) and _re.match(r'^[-*+]\s+', lines[i].strip()):
                    items.append(_re.sub(r'^[-*+]\s+', '', lines[i].strip()))
                    i += 1
                lis = ''.join(f'<li>{AzureDevOpsClient._md_inline_transform(it)}</li>' for it in items)
                out.append(f'<ul>{lis}</ul>')
                continue

            # Paragraph
            out.append(f'<p>{AzureDevOpsClient._md_inline_transform(stripped)}</p>')
            i += 1

        html = '\n'.join(p for p in out if p != '')

        # Restore code blocks / inline spans
        for idx, block in enumerate(code_blocks):
            html = html.replace(f'\x00CODE{idx}\x00', block)
        for idx, span in enumerate(inline_codes):
            html = html.replace(f'\x00INL{idx}\x00', span)

        return html

    @staticmethod
    def _md_inline_transform(text: str) -> str:
        """Inline markdown: bold, italic, link, auto-url. Code spans already stashed."""
        import re as _re
        import html as _html
        # Escape HTML first (avoid double-escape of already-stashed code placeholders)
        placeholders: list[str] = []

        def _protect(m: 're.Match[str]') -> str:
            placeholders.append(m.group(0))
            return f'\x00PH{len(placeholders) - 1}\x00'

        text = _re.sub(r'\x00(?:CODE|INL)\d+\x00', _protect, text)
        text = _html.escape(text)

        # Restore placeholders
        for i, ph in enumerate(placeholders):
            text = text.replace(f'\x00PH{i}\x00', ph)

        # Markdown links [label](url)
        text = _re.sub(
            r'\[([^\]]+)\]\((https?://[^)\s]+)\)',
            r'<a href="\2" target="_blank" rel="noreferrer">\1</a>',
            text,
        )
        # Bold **text**
        text = _re.sub(r'\*\*([^*\n]+)\*\*', r'<strong>\1</strong>', text)
        # Italic *text* (avoid matching bold remnants — use word boundaries)
        text = _re.sub(r'(?<![*\w])\*([^*\n]+)\*(?![*\w])', r'<em>\1</em>', text)
        # Auto-link bare URLs
        text = _re.sub(
            r'(?<!["\'>])((?:https?)://[^\s<)]+)',
            r'<a href="\1" target="_blank" rel="noreferrer">\1</a>',
            text,
        )
        return text

    @staticmethod
    def _format_comment_html(text: str) -> str:
        """Convert plain-text refinement comment to formatted HTML for Azure DevOps."""
        import html as html_mod
        lines = text.split('\n')
        html_parts: list[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                html_parts.append('<br/>')
            elif stripped.startswith('📊') or stripped.startswith('🎯') or stripped.startswith('❓') or stripped.startswith('⚠️'):
                html_parts.append(f'<p><strong>{html_mod.escape(stripped)}</strong></p>')
            elif stripped.startswith('---'):
                html_parts.append('<hr/>')
            elif stripped[0:1].isdigit() and '. ' in stripped[:4]:
                html_parts.append(f'<li>{html_mod.escape(stripped[stripped.index(". ") + 2:])}</li>')
            elif stripped.startswith('• ') or stripped.startswith('- '):
                html_parts.append(f'<li>{html_mod.escape(stripped[2:])}</li>')
            else:
                html_parts.append(f'<p>{html_mod.escape(stripped)}</p>')
        # Wrap consecutive <li> items in <ul>
        result = '\n'.join(html_parts)
        import re
        result = re.sub(r'((?:<li>.*?</li>\n?)+)', r'<ul>\1</ul>', result)
        return result

    def _headers(self, pat: str) -> dict[str, str]:
        token = base64.b64encode(f':{pat}'.encode()).decode()
        return {'Authorization': f'Basic {token}', 'Content-Type': 'application/json'}

    async def _fetch_details_from_wiql(
        self,
        *,
        client: httpx.AsyncClient,
        wiql_url: str,
        headers: dict[str, str],
        wiql_payload: dict[str, Any],
        org_url: str,
        fields_param: str,
    ) -> list[dict[str, Any]]:
        wiql_response = await client.post(wiql_url, headers=headers, json=wiql_payload)
        wiql_response.raise_for_status()
        try:
            work_item_refs = wiql_response.json().get('workItems', [])
        except Exception:
            logger.error('Azure WIQL response is not valid JSON: %s', wiql_response.text[:200])
            return []

        if not work_item_refs:
            return []

        ids = [str(item['id']) for item in work_item_refs if item.get('id')]
        details_payload: list[dict[str, Any]] = []
        for start in range(0, len(ids), 200):
            batch_ids = ','.join(ids[start:start + 200])
            details_url = (
                f"{org_url.rstrip('/')}/_apis/wit/workitems"
                f'?ids={batch_ids}&fields={fields_param}&api-version=7.1-preview.3'
            )
            details_response = await client.get(details_url, headers=headers)
            details_response.raise_for_status()
            try:
                details_payload.extend(details_response.json().get('value', []))
            except Exception:
                logger.error('Azure work items response is not valid JSON: %s', details_response.text[:200])
                return []
        return details_payload

    def _to_external_task(self, item: dict[str, Any], *, org_url: str, project: str) -> ExternalTask:
        fields = item.get('fields', {})
        assigned_raw = fields.get('System.AssignedTo')
        if isinstance(assigned_raw, dict):
            assigned_to = assigned_raw.get('displayName') or assigned_raw.get('uniqueName')
        else:
            assigned_to = assigned_raw or None

        story_points = self._coerce_float(
            fields.get('Microsoft.VSTS.Scheduling.StoryPoints'),
            fields.get('Microsoft.VSTS.Scheduling.Size'),
        )
        effort = self._coerce_float(fields.get('Microsoft.VSTS.Scheduling.Effort'))
        item_id = str(fields.get('System.Id', item.get('id', '')))
        link_value = ((item.get('_links') or {}).get('html') or {}).get('href')
        web_url = str(link_value).strip() if isinstance(link_value, str) else ''
        if not web_url:
            web_url = self._build_work_item_web_url(
                org_url=org_url,
                project=(fields.get('System.TeamProject') or project or ''),
                item_id=item_id,
            )
        description_parts = [
            str(fields.get('System.Description') or '').strip(),
            str(fields.get('Microsoft.VSTS.Common.AcceptanceCriteria') or '').strip(),
            str(fields.get('Microsoft.VSTS.TCM.ReproSteps') or '').strip(),
        ]
        merged_description = '\n\n'.join(part for part in description_parts if part)

        return ExternalTask(
            id=item_id,
            title=fields.get('System.Title', ''),
            description=merged_description,
            source='azure',
            state=fields.get('System.State'),
            assigned_to=assigned_to,
            created_date=fields.get('System.CreatedDate'),
            activated_date=fields.get('Microsoft.VSTS.Common.ActivatedDate'),
            closed_date=fields.get('Microsoft.VSTS.Common.ClosedDate'),
            story_points=story_points,
            effort=effort,
            work_item_type=fields.get('System.WorkItemType'),
            sprint_path=fields.get('System.IterationPath'),
            web_url=web_url or None,
        )

    def _build_work_item_web_url(self, *, org_url: str, project: str, item_id: str) -> str:
        base = str(org_url or '').strip().rstrip('/')
        proj = str(project or '').strip()
        wid = str(item_id or '').strip()
        if not base or not proj or not wid:
            return ''
        return f'{base}/{quote(proj, safe="")}/_workitems/edit/{quote(wid, safe="")}'

    def _coerce_float(self, *values: Any) -> float | None:
        for value in values:
            if value in (None, ''):
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    def _build_iteration_path(self, project: str, team: str, sprint: str) -> str:
        """
        Azure iteration path formatı: sprint listesinden gelen 'path' alanı
        zaten tam formattadır, örn: 'E-commerce Web Applications\\2026_06_Nankatsu'
        Bu değeri direkt kullan — project veya team ekleme.
        """
        if not sprint:
            return ''
        # Azure'dan gelen path zaten tam — backslash veya forward slash içeriyorsa direkt kullan
        if '\\' in sprint or '/' in sprint:
            return sprint.replace('/', '\\')
        # Sadece sprint adı geldiyse (eski fallback): team\sprint formatı
        if team:
            return f'{team}\\{sprint}'
        return sprint
