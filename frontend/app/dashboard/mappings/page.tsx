'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, loadPrefs, RepoMapping, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const LS_REPO_MAPPINGS = 'tiqr_repo_mappings';
type Opt = { id: string; name: string };
type AzureRepo = { id: string; name: string; remote_url: string; web_url: string };

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
  const [projects, setProjects] = useState<Opt[]>([]);
  const [selProject, setSelProject] = useState('');
  const [repos, setRepos] = useState<AzureRepo[]>([]);
  const [selRepoUrl, setSelRepoUrl] = useState('');
  const [pendingRepoUrl, setPendingRepoUrl] = useState('');
  const [path, setPath] = useState('');
  const [notes, setNotes] = useState('');
  const [repoPlaybook, setRepoPlaybook] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  useEffect(() => {
    const init = async () => {
      setItems(loadLocalMappings());
      try {
        const prefs = await loadPrefs();
        setItems(prefs.repo_mappings ?? []);
      } catch {
        // local cache fallback
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
    setRepos([]);
    setSelRepoUrl('');
    if (!selProject) return;
    setLoadingRepos(true);
    apiFetch<AzureRepo[]>('/tasks/azure/repos?project=' + encodeURIComponent(selProject))
      .then(setRepos)
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [selProject]);

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
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 1800);
    }
  }

  function resetForm() {
    setSelRepoUrl('');
    setPendingRepoUrl('');
    setPath('');
    setNotes('');
    setRepoPlaybook('');
    setEditingId(null);
  }

  function startEdit(item: RepoMapping) {
    setEditingId(item.id);
    setSelProject(item.azure_project || '');
    setPendingRepoUrl(item.azure_repo_url || '');
    setPath(item.local_path || '');
    setNotes(item.notes || '');
    setRepoPlaybook(item.repo_playbook || '');
  }

  async function upsertMapping() {
    const selectedRepo = repos.find((r) => r.remote_url === selRepoUrl);
    if (!selProject || !selectedRepo || !path.trim()) return;
    const mapping: RepoMapping = {
      id: editingId || String(Date.now()),
      name: selectedRepo.name,
      local_path: path.trim(),
      notes: notes.trim() || undefined,
      repo_playbook: repoPlaybook.trim() || undefined,
      azure_project: selProject,
      azure_repo_url: selectedRepo.remote_url,
      azure_repo_name: selectedRepo.name,
    };
    const next: RepoMapping[] = editingId
      ? items.map((m) => (m.id === editingId ? mapping : m))
      : [...items, mapping];
    await persist(next);
    setMsg(editingId ? t('mappings.updated') : t('mappings.saved'));
    resetForm();
  }

  async function removeMapping(id: string) {
    await persist(items.filter((m) => m.id !== id));
  }

  const empty = useMemo(() => items.length === 0, [items.length]);
  const selectedRepo = useMemo(() => repos.find((r) => r.remote_url === selRepoUrl), [repos, selRepoUrl]);
  const selectedRepoMappings = useMemo(
    () => (selProject && selRepoUrl ? items.filter((m) => m.azure_project === selProject && m.azure_repo_url === selRepoUrl) : []),
    [items, selProject, selRepoUrl],
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
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7dd3fc' }}>Create Mapping</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{items.length} total</div>
          </div>

          <div>
            <div style={fieldLabelStyle}>Azure Project</div>
            <select value={selProject} onChange={(e) => setSelProject(e.target.value)} style={fieldStyle}>
              <option value='' style={{ background: '#0d1117' }}>{loadingProjects ? t('mappings.loadingProjects') : t('mappings.selectProject')}</option>
              {projects.map((p) => <option key={p.id} value={p.name} style={{ background: '#0d1117' }}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div style={fieldLabelStyle}>Azure Repo</div>
            <select value={selRepoUrl} onChange={(e) => setSelRepoUrl(e.target.value)} disabled={!selProject || loadingRepos} style={fieldStyle}>
              <option value='' style={{ background: '#0d1117' }}>{loadingRepos ? t('mappings.loadingRepos') : t('mappings.selectRepo')}</option>
              {repos.map((r) => <option key={r.id} value={r.remote_url} style={{ background: '#0d1117' }}>{r.name}</option>)}
            </select>
          </div>

          {selectedRepo && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)', padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>{selectedRepo.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 2, wordBreak: 'break-all' }}>{selectedRepo.remote_url}</div>
            </div>
          )}

          <div>
            <div style={fieldLabelStyle}>Local Path</div>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('mappings.pathPlaceholder')} style={fieldStyle} />
          </div>
          <div>
            <div style={fieldLabelStyle}>Notes</div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('mappings.notesPlaceholder')} style={fieldStyle} />
          </div>
          <div>
            <div style={fieldLabelStyle}>Repo Playbook</div>
            <textarea
              value={repoPlaybook}
              onChange={(e) => setRepoPlaybook(e.target.value)}
              placeholder='Per-repo coding rules, architecture constraints, test policy...'
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
            <button onClick={() => void upsertMapping()} disabled={saving || !selProject || !selRepoUrl || !path.trim()} className='button button-primary' style={{ width: '100%' }}>
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
            Selected repo mappings: <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{selectedRepoMappings.length}</span>
          </div>
        </div>

        <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'grid', gridTemplateColumns: '1.1fr 1.2fr 0.9fr 1.1fr 140px', gap: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Azure</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Local Path</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Notes</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Repo Playbook</span>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>Action</span>
          </div>

          {empty ? (
            <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              {t('mappings.empty')}
            </div>
          ) : (
            items.map((m) => (
              <div key={m.id} style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1.1fr 1.2fr 0.9fr 1.1fr 140px', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>{m.azure_project || '-'}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.82)' }}>{m.azure_repo_name || m.name}</div>
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
    </div>
  );
}
