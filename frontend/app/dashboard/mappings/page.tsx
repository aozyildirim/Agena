'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, getRepoAgentsDoc, loadPrefs, RepoMapping, RepoProfileSummary, savePrefs, saveRepoAgentsDoc, scanRepoProfile } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const LS_REPO_MAPPINGS = 'tiqr_repo_mappings';
type Opt = { id: string; name: string };
type AzureRepo = { id: string; name: string; remote_url: string; web_url: string };
type GithubRepo = { id: string; name: string; full_name: string; private: boolean };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)',
  fontSize: 13,
  outline: 'none',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.35)',
  marginBottom: 6,
};

function loadLocalMappings(): RepoMapping[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_REPO_MAPPINGS);
    if (!raw) return [];
    return JSON.parse(raw) as RepoMapping[];
  } catch {
    return [];
  }
}

export default function RepoMappingsPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<RepoMapping[]>([]);
  const [sourceProvider, setSourceProvider] = useState<'azure' | 'github'>('azure');
  const [projects, setProjects] = useState<Opt[]>([]);
  const [selProject, setSelProject] = useState('');
  const [repos, setRepos] = useState<AzureRepo[]>([]);
  const [selRepoUrl, setSelRepoUrl] = useState('');
  const [pendingRepoUrl, setPendingRepoUrl] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [selGithubRepo, setSelGithubRepo] = useState('');
  const [githubRepoCount, setGithubRepoCount] = useState(0);
  const [githubRepoError, setGithubRepoError] = useState('');
  const [path, setPath] = useState('');
  const [notes, setNotes] = useState('');
  const [repoPlaybook, setRepoPlaybook] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingGithubRepos, setLoadingGithubRepos] = useState(false);
  const [hasGithubIntegration, setHasGithubIntegration] = useState(false);
  const [repoProfiles, setRepoProfiles] = useState<Record<string, RepoProfileSummary>>({});
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMappingId, setEditorMappingId] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  useEffect(() => {
    const init = async () => {
      setItems(loadLocalMappings());
      try {
        const prefs = await loadPrefs();
        setItems(prefs.repo_mappings ?? []);
        const fromSettings = (prefs.profile_settings?.repo_profiles ?? {}) as Record<string, RepoProfileSummary>;
        setRepoProfiles(fromSettings && typeof fromSettings === 'object' ? fromSettings : {});
      } catch {
        // local cache fallback
      }
      try {
        const integrations = await apiFetch<Array<{ provider: string; has_secret?: boolean; username?: string | null }>>('/integrations');
        const github = integrations.find((c) => c.provider === 'github');
        setHasGithubIntegration(Boolean(github?.has_secret));
      } catch {
        setHasGithubIntegration(false);
      }
      setLoadingProjects(true);
      try {
        const ps = await apiFetch<Opt[]>('/tasks/azure/projects');
        setProjects(ps);
      } catch {
        // ignore
      } finally {
        setLoadingProjects(false);
      }
    };
    void init();
  }, []);

  useEffect(() => {
    if (sourceProvider !== 'azure') return;
    setRepos([]);
    setSelRepoUrl('');
    if (!selProject) return;
    setLoadingRepos(true);
    apiFetch<AzureRepo[]>('/tasks/azure/repos?project=' + encodeURIComponent(selProject))
      .then(setRepos)
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [selProject, sourceProvider]);

  useEffect(() => {
    if (sourceProvider !== 'github') return;
    setGithubRepos([]);
    setSelGithubRepo('');
    setGithubRepoCount(0);
    setGithubRepoError('');
    setLoadingGithubRepos(true);
    const owner = githubOwner.trim();
    const query = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    apiFetch<GithubRepo[]>(`/integrations/github/repos${query}`)
      .then((list) => {
        setGithubRepos(list);
        setGithubRepoCount(Array.isArray(list) ? list.length : 0);
      })
      .catch((e: unknown) => {
        setGithubRepos([]);
        setGithubRepoCount(0);
        setGithubRepoError(e instanceof Error ? e.message : 'GitHub repo list fetch failed');
      })
      .finally(() => setLoadingGithubRepos(false));
  }, [sourceProvider, githubOwner]);

  useEffect(() => {
    if (!pendingRepoUrl) return;
    const exists = repos.some((r) => r.remote_url === pendingRepoUrl);
    if (!exists) return;
    setSelRepoUrl(pendingRepoUrl);
    setPendingRepoUrl('');
  }, [pendingRepoUrl, repos]);

  async function persist(next: RepoMapping[]) {
    setSaving(true);
    setErr('');
    try {
      await savePrefs({ repo_mappings: next });
      localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(next));
      setItems(next);
      setMsg(t('mappings.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('mappings.saveFailed'));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 1800);
    }
  }

  function resetForm() {
    setSelRepoUrl('');
    setPendingRepoUrl('');
    setSelGithubRepo('');
    setPath('');
    setNotes('');
    setRepoPlaybook('');
    setEditingId(null);
  }

  function startEdit(item: RepoMapping) {
    const provider = item.provider === 'github' ? 'github' : 'azure';
    setSourceProvider(provider);
    setEditingId(item.id);
    setSelProject(item.azure_project || '');
    setPendingRepoUrl(item.azure_repo_url || '');
    setGithubOwner(item.github_owner || githubOwner);
    setSelGithubRepo(item.github_repo_full_name || (item.github_owner && item.github_repo ? `${item.github_owner}/${item.github_repo}` : ''));
    setPath(item.local_path || '');
    setNotes(item.notes || '');
    setRepoPlaybook(item.repo_playbook || '');
  }

  async function upsertMapping() {
    let mapping: RepoMapping;
    if (sourceProvider === 'azure') {
      const selectedRepo = repos.find((r) => r.remote_url === selRepoUrl);
      if (!selProject || !selectedRepo || !path.trim()) return;
      mapping = {
        id: editingId || String(Date.now()),
        provider: 'azure',
        name: selectedRepo.name,
        local_path: path.trim(),
        notes: notes.trim() || undefined,
        repo_playbook: repoPlaybook.trim() || undefined,
        azure_project: selProject,
        azure_repo_url: selectedRepo.remote_url,
        azure_repo_name: selectedRepo.name,
      };
    } else {
      const selectedRepo = githubRepos.find((r) => r.full_name === selGithubRepo);
      const fullName = selectedRepo?.full_name || selGithubRepo;
      if (!fullName || !path.trim()) return;
      const repoName = selectedRepo?.name || fullName.split('/').pop() || '';
      const owner = fullName.split('/')[0] || githubOwner.trim();
      mapping = {
        id: editingId || String(Date.now()),
        provider: 'github',
        name: repoName,
        local_path: path.trim(),
        notes: notes.trim() || undefined,
        repo_playbook: repoPlaybook.trim() || undefined,
        github_owner: owner,
        github_repo: repoName,
        github_repo_full_name: fullName,
      };
    }
    const next: RepoMapping[] = editingId
      ? items.map((m) => (m.id === editingId ? mapping : m))
      : [...items, mapping];
    await persist(next);
    setMsg(editingId ? t('mappings.updated') : t('mappings.saved'));
    await runProfileScan(mapping, { silentSuccess: true });
    resetForm();
  }

  async function runProfileScan(mapping: RepoMapping, opts?: { silentSuccess?: boolean }) {
    setScanningId(mapping.id);
    setErr('');
    try {
      const res = await scanRepoProfile(mapping);
      setRepoProfiles((prev) => ({ ...prev, [mapping.id]: res.profile }));
      const prefs = await loadPrefs();
      const fromSettings = (prefs.profile_settings?.repo_profiles ?? {}) as Record<string, RepoProfileSummary>;
      setRepoProfiles(fromSettings && typeof fromSettings === 'object' ? fromSettings : {});
      if (!opts?.silentSuccess) setMsg(t('mappings.profileScanned'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('mappings.scanFailed'));
    } finally {
      setScanningId(null);
      if (!opts?.silentSuccess) {
        setTimeout(() => setMsg(''), 1800);
      }
    }
  }

  async function removeMapping(id: string) {
    await persist(items.filter((m) => m.id !== id));
  }

  async function openAgentsEditor(mapping: RepoMapping) {
    setEditorOpen(true);
    setEditorMappingId(mapping.id);
    setEditorContent('');
    setEditorPath('');
    setEditorLoading(true);
    try {
      const res = await getRepoAgentsDoc(mapping.id);
      setEditorPath(res.agents_md_path);
      setEditorContent(res.content || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('mappings.agentsLoadFailed'));
      setEditorOpen(false);
      setEditorMappingId(null);
    } finally {
      setEditorLoading(false);
    }
  }

  async function saveAgentsEditor() {
    if (!editorMappingId) return;
    setEditorSaving(true);
    setErr('');
    try {
      const res = await saveRepoAgentsDoc(editorMappingId, editorContent);
      setEditorPath(res.agents_md_path);
      setMsg(t('mappings.agentsSaved'));
      setTimeout(() => setMsg(''), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('mappings.agentsSaveFailed'));
    } finally {
      setEditorSaving(false);
    }
  }

  const empty = useMemo(() => items.length === 0, [items.length]);
  const selectedRepo = useMemo(() => repos.find((r) => r.remote_url === selRepoUrl), [repos, selRepoUrl]);
  const selectedGithubRepo = useMemo(() => githubRepos.find((r) => r.full_name === selGithubRepo), [githubRepos, selGithubRepo]);
  const selectedRepoMappings = useMemo(
    () => sourceProvider === 'azure'
      ? (selProject && selRepoUrl ? items.filter((m) => (m.provider || 'azure') === 'azure' && m.azure_project === selProject && m.azure_repo_url === selRepoUrl) : [])
      : (selGithubRepo ? items.filter((m) => m.provider === 'github' && m.github_repo_full_name === selGithubRepo) : []),
    [items, selProject, selRepoUrl, selGithubRepo, sourceProvider],
  );

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 1180 }}>
      <div>
        <div className='section-label'>{t('nav.mappings')}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.94)', marginTop: 6 }}>
          {t('mappings.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.36)', marginTop: 6 }}>
          {t('mappings.subtitle')}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ borderRadius: 16, border: '1px solid rgba(56,189,248,0.24)', background: 'linear-gradient(165deg, rgba(8,20,40,0.95), rgba(7,14,28,0.95))', padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7dd3fc' }}>{t('mappings.createMapping')}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{t('mappings.totalCount', { n: items.length })}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type='button' onClick={() => setSourceProvider('azure')} className='button'
              style={{ borderColor: sourceProvider === 'azure' ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.12)', background: sourceProvider === 'azure' ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.03)', color: sourceProvider === 'azure' ? '#7dd3fc' : 'rgba(255,255,255,0.58)' }}>
              {t('mappings.providerAzure')}
            </button>
            <button type='button' onClick={() => setSourceProvider('github')} className='button'
              style={{ borderColor: sourceProvider === 'github' ? 'rgba(167,139,250,0.45)' : 'rgba(255,255,255,0.12)', background: sourceProvider === 'github' ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.03)', color: sourceProvider === 'github' ? '#c4b5fd' : 'rgba(255,255,255,0.58)' }}>
              {t('mappings.providerGithub')}
            </button>
          </div>

          {sourceProvider === 'azure' ? (
            <>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.azureProject')}</div>
                <select value={selProject} onChange={(e) => setSelProject(e.target.value)} style={fieldStyle}>
                  <option value='' style={{ background: '#0d1117' }}>{loadingProjects ? t('mappings.loadingProjects') : t('mappings.selectProject')}</option>
                  {projects.map((p) => <option key={p.id} value={p.name} style={{ background: '#0d1117' }}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.azureRepo')}</div>
                <select value={selRepoUrl} onChange={(e) => setSelRepoUrl(e.target.value)} disabled={!selProject || loadingRepos} style={fieldStyle}>
                  <option value='' style={{ background: '#0d1117' }}>{loadingRepos ? t('mappings.loadingRepos') : t('mappings.selectRepo')}</option>
                  {repos.map((r) => <option key={r.id} value={r.remote_url} style={{ background: '#0d1117' }}>{r.name}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.githubOwner')}</div>
                <input value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder={t('mappings.githubOwnerPlaceholder')} style={fieldStyle} />
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{t('mappings.githubOwnerHint')}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.githubRepo')}</div>
                <select value={selGithubRepo} onChange={(e) => setSelGithubRepo(e.target.value)} disabled={loadingGithubRepos || !hasGithubIntegration} style={fieldStyle}>
                  <option value='' style={{ background: '#0d1117' }}>
                    {!hasGithubIntegration ? t('mappings.connectGithubFirst') : (loadingGithubRepos ? t('mappings.loadingGithubRepos') : t('mappings.selectGithubRepo'))}
                  </option>
                  {githubRepos.map((r) => <option key={r.id} value={r.full_name} style={{ background: '#0d1117' }}>{r.full_name}{r.private ? ' 🔒' : ''}</option>)}
                </select>
                <div style={{ fontSize: 10, color: githubRepoError ? '#fda4af' : 'rgba(255,255,255,0.45)', marginTop: 4 }}>
                  {githubRepoError || `${t('mappings.githubRepoCount')}: ${githubRepoCount}`}
                </div>
              </div>
            </>
          )}

          {sourceProvider === 'azure' && selectedRepo && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)', padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>{selectedRepo.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2, wordBreak: 'break-all' }}>{selectedRepo.remote_url}</div>
            </div>
          )}
          {sourceProvider === 'github' && selectedGithubRepo && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.08)', padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>{selectedGithubRepo.full_name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{selectedGithubRepo.private ? 'private' : 'public'}</div>
            </div>
          )}

          <div>
            <div style={fieldLabelStyle}>{t('mappings.localPath')}</div>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('mappings.pathPlaceholder')} style={fieldStyle} />
          </div>
          <div>
            <div style={fieldLabelStyle}>{t('mappings.notes')}</div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('mappings.notesPlaceholder')} style={fieldStyle} />
          </div>
          <div>
            <div style={fieldLabelStyle}>{t('mappings.repoPlaybook')}</div>
            <textarea
              value={repoPlaybook}
              onChange={(e) => setRepoPlaybook(e.target.value)}
              placeholder={t('mappings.repoPlaybookPlaceholder')}
              rows={4}
              style={{
                ...fieldStyle,
                height: 'auto',
                padding: '10px 12px',
                resize: 'vertical',
                lineHeight: 1.45,
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 38 }}>
            <button
              onClick={() => void upsertMapping()}
              disabled={saving || !path.trim() || (sourceProvider === 'azure' ? (!selProject || !selRepoUrl) : !selGithubRepo)}
              className='button button-primary'
              style={{ width: '100%' }}
            >
              {saving ? t('mappings.saving') : editingId ? t('mappings.update') : t('mappings.add')}
            </button>
            {editingId ? (
              <button onClick={resetForm} type='button' className='button button-outline' style={{ width: '100%' }}>
                {t('mappings.cancelEdit')}
              </button>
            ) : (
              <div />
            )}
          </div>

          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
            {t('mappings.selectedRepoMappings')}: <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{selectedRepoMappings.length}</span>
          </div>
        </div>

        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'grid', gridTemplateColumns: '1fr 1.1fr 0.8fr 1fr 0.9fr 140px', gap: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.source')}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.localPath')}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.notes')}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.repoPlaybook')}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.repoProfile')}</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>{t('mappings.col.action')}</span>
          </div>

          {empty ? (
            <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              {t('mappings.empty')}
            </div>
          ) : (
            items.map((m) => (
              <div key={m.id} style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1.1fr 0.8fr 1fr 0.9fr 140px', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: (m.provider === 'github') ? '#c4b5fd' : '#7dd3fc' }}>
                    {(m.provider === 'github') ? 'GitHub' : (m.azure_project || 'Azure')}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>
                    {(m.provider === 'github') ? (m.github_repo_full_name || m.name) : (m.azure_repo_name || m.name)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.58)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.local_path}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                  {m.notes || '-'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 }}>
                  {m.repo_playbook ? (m.repo_playbook.length > 110 ? m.repo_playbook.slice(0, 110).trimEnd() + '…' : m.repo_playbook) : '-'}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {repoProfiles[m.id] ? (
                    <>
                      <div style={{ fontSize: 11, color: '#86efac', fontWeight: 700, lineHeight: 1.3 }}>
                        {(repoProfiles[m.id].stack || []).slice(0, 2).join(', ') || t('mappings.profileReady')}
                      </div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
                        {(repoProfiles[m.id].scanned_by_provider || 'local')}
                        {repoProfiles[m.id].scanned_model ? ` / ${repoProfiles[m.id].scanned_model}` : ''}
                      </div>
                      {repoProfiles[m.id].agents_md_path && (
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {repoProfiles[m.id].agents_md_path}
                        </div>
                      )}
                      <button
                        onClick={() => void openAgentsEditor(m)}
                        style={{
                          padding: '5px 8px',
                          borderRadius: 8,
                          border: '1px solid rgba(56,189,248,0.35)',
                          background: 'rgba(56,189,248,0.12)',
                          color: '#7dd3fc',
                          fontSize: 11,
                          cursor: 'pointer',
                          fontWeight: 700,
                        }}
                      >
                        Open AGENTS.md
                      </button>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)' }}>
                        {new Date(repoProfiles[m.id].scanned_at).toLocaleString()}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{t('mappings.notScanned')}</div>
                  )}
                  <button
                    onClick={() => void runProfileScan(m)}
                    disabled={scanningId === m.id}
                    style={{
                      padding: '5px 8px',
                      borderRadius: 8,
                      border: '1px solid rgba(34,197,94,0.35)',
                      background: 'rgba(34,197,94,0.12)',
                      color: '#86efac',
                      fontSize: 11,
                      cursor: scanningId === m.id ? 'not-allowed' : 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    {scanningId === m.id ? t('mappings.scanning') : t('mappings.scan')}
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button onClick={() => startEdit(m)} style={{ padding: '6px 0', width: '100%', borderRadius: 8, border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                    {t('mappings.edit')}
                  </button>
                  <button onClick={() => void removeMapping(m.id)} style={{ padding: '6px 0', width: '100%', borderRadius: 8, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                    {t('mappings.delete')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {(msg || err) && (
        <div style={{ borderRadius: 10, padding: '10px 12px', border: '1px solid ' + (err ? 'rgba(248,113,113,0.35)' : 'rgba(34,197,94,0.3)'), background: err ? 'rgba(248,113,113,0.08)' : 'rgba(34,197,94,0.08)', color: err ? '#f87171' : '#22c55e', fontSize: 13 }}>
          {err || msg}
        </div>
      )}

      {editorOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(2,6,23,0.75)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: 'min(980px, 100%)', maxHeight: '86vh', borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(7,13,24,0.98)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)', display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: 10, padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>{t('mappings.agentsEditor')}</div>
              <button onClick={() => { setEditorOpen(false); setEditorMappingId(null); }} style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {editorPath || (editorLoading ? t('mappings.loading') : '')}
            </div>
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              disabled={editorLoading || editorSaving}
              style={{
                width: '100%',
                minHeight: 380,
                height: '100%',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.92)',
                padding: 12,
                fontSize: 12,
                lineHeight: 1.5,
                resize: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => { setEditorOpen(false); setEditorMappingId(null); }}
                className='button button-outline'
                style={{ minWidth: 120 }}
              >
                {t('mappings.close')}
              </button>
              <button
                onClick={() => void saveAgentsEditor()}
                disabled={editorLoading || editorSaving || !editorMappingId}
                className='button button-primary'
                style={{ minWidth: 140 }}
              >
                {editorSaving ? t('mappings.saving') : t('mappings.saveAgents')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
