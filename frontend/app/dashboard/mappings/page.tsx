'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch, loadPrefs, RepoMapping, RepoProfileSummary, savePrefs, scanRepoProfile } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

const LS_REPO_MAPPINGS = 'agena_repo_mappings';
type Opt = { id: string; name: string };
type AzureRepo = { id: string; name: string; remote_url: string; web_url: string };
type GithubRepo = { id: string; name: string; full_name: string; private: boolean };

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid var(--panel-border-3)',
  background: 'var(--glass)',
  color: 'var(--ink-90)',
  fontSize: 13,
  outline: 'none',
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: 'uppercase',
  color: 'var(--ink-35)',
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
  const [pendingProject, setPendingProject] = useState('');
  const [repos, setRepos] = useState<AzureRepo[]>([]);
  const [selRepoUrl, setSelRepoUrl] = useState('');
  const [pendingRepoUrl, setPendingRepoUrl] = useState('');
  const [pendingRepoName, setPendingRepoName] = useState('');
  const [githubOwner, setGithubOwner] = useState('');
  const [githubRepos, setGithubRepos] = useState<GithubRepo[]>([]);
  const [selGithubRepo, setSelGithubRepo] = useState('');
  const [pendingGithubRepo, setPendingGithubRepo] = useState('');
  const [githubRepoCount, setGithubRepoCount] = useState(0);
  const [githubRepoError, setGithubRepoError] = useState('');
  const [path, setPath] = useState('');
  // Local-path autosuggest from the host bridge — populated whenever
  // the user picks a repo. The bridge scans common dev folders
  // (~/sites, ~/code, ~/projects, …) so the user can one-click set
  // the path instead of typing the full absolute string by hand.
  const [pathSuggestions, setPathSuggestions] = useState<{ path: string; is_git: boolean; score: number }[]>([]);
  // Track whether the path was auto-filled from a single high-confidence
  // suggestion vs. typed/clicked manually. We use this purely so the UI
  // can render a tiny "auto" hint next to the input — clobber prevention
  // is handled inside the suggest effect.
  const [pathAutoFilled, setPathAutoFilled] = useState(false);
  const [pathSuggestLoading, setPathSuggestLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [repoPlaybook, setRepoPlaybook] = useState('');
  const [analyzePrompt, setAnalyzePrompt] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingGithubRepos, setLoadingGithubRepos] = useState(false);
  const [hasGithubIntegration, setHasGithubIntegration] = useState(false);
  const [repoProfiles, setRepoProfiles] = useState<Record<string, RepoProfileSummary>>({});
  const [scanningId, setScanningId] = useState<string | null>(null);
  type IndexStatus = { indexed: boolean; points_count: number; head_sha: string | null; is_fresh: boolean; current_head_sha: string | null };
  const [indexStatuses, setIndexStatuses] = useState<Record<string, IndexStatus | 'loading' | 'error' | 'reindexing'>>({});
  const [agentsMdContent, setAgentsMdContent] = useState<string | null>(null);
  const [agentsMdViewId, setAgentsMdViewId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Array<{ name: string; is_default: boolean }>>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loadingBranches, setLoadingBranches] = useState(false);
  const githubFetchRef = useRef(0);

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
        if (github?.username && github.username.trim()) setGithubOwner(github.username.trim());
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
    if (!pendingProject || sourceProvider !== 'azure') return;
    if (projects.length === 0) return;
    const matched = projects.find((p) => p.name === pendingProject || p.id === pendingProject);
    if (matched) {
      setSelProject(matched.name);
    }
    setPendingProject('');
  }, [pendingProject, projects, sourceProvider]);

  useEffect(() => {
    if (sourceProvider !== 'azure') return;
    setRepos([]);
    if (!selProject) return;
    setLoadingRepos(true);
    apiFetch<AzureRepo[]>('/tasks/azure/repos?project=' + encodeURIComponent(selProject))
      .then((list) => {
        let nextList = list;
        const target = pendingRepoUrl || selRepoUrl;
        if (target) {
          const found = list.find((r) => r.remote_url === target);
          if (!found) {
            nextList = [
              {
                id: `pending:${target}`,
                name: pendingRepoName || target.split('/').pop() || t('mappings.selectedRepoFallback'),
                remote_url: target,
                web_url: '',
              },
              ...list,
            ];
          } else if (pendingRepoUrl) {
            setSelRepoUrl(found.remote_url);
            setPendingRepoUrl('');
            setPendingRepoName('');
          }
        }
        setRepos(nextList);
      })
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, [selProject, sourceProvider, pendingRepoUrl, pendingRepoName, selRepoUrl]);

  useEffect(() => {
    if (sourceProvider !== 'azure') return;
    if (!pendingRepoUrl) return;
    if (selRepoUrl) return;
    setSelRepoUrl(pendingRepoUrl);
  }, [sourceProvider, pendingRepoUrl, selRepoUrl]);

  useEffect(() => {
    if (sourceProvider !== 'github') return;
    const reqId = ++githubFetchRef.current;
    setGithubRepos([]);
    setGithubRepoCount(0);
    setGithubRepoError('');
    setLoadingGithubRepos(true);
    const owner = githubOwner.trim();
    const query = owner ? `?owner=${encodeURIComponent(owner)}` : '';
    apiFetch<GithubRepo[]>(`/integrations/github/repos${query}`)
      .then((list) => {
        if (reqId !== githubFetchRef.current) return;
        let nextList = list;
        if (pendingGithubRepo) {
          const matched = list.find((r) => r.full_name.toLowerCase() === pendingGithubRepo.toLowerCase());
          if (!matched) {
            const repoName = pendingGithubRepo.split('/').pop() || pendingGithubRepo;
            nextList = [{ id: `pending:${pendingGithubRepo}`, name: repoName, full_name: pendingGithubRepo, private: true }, ...list];
          } else {
            setSelGithubRepo(matched.full_name);
            setPendingGithubRepo('');
          }
        }
        setGithubRepos(nextList);
        setGithubRepoCount(Array.isArray(list) ? list.length : 0);
      })
      .catch((e: unknown) => {
        if (reqId !== githubFetchRef.current) return;
        setGithubRepos([]);
        setGithubRepoCount(0);
        setGithubRepoError(e instanceof Error ? e.message : t('mappings.githubRepoFetchFailed'));
      })
      .finally(() => {
        if (reqId !== githubFetchRef.current) return;
        setLoadingGithubRepos(false);
      });
  }, [sourceProvider, githubOwner, pendingGithubRepo]);

  useEffect(() => {
    if (!pendingRepoUrl) return;
    const exists = repos.some((r) => r.remote_url === pendingRepoUrl);
    if (!exists) return;
    setSelRepoUrl(pendingRepoUrl);
    setPendingRepoUrl('');
    setPendingRepoName('');
  }, [pendingRepoUrl, repos]);

  useEffect(() => {
    const paths = items.map((m) => m.local_path).filter(Boolean);
    if (!paths.length) return;
    let cancelled = false;
    setIndexStatuses((prev) => {
      const next = { ...prev };
      for (const p of paths) if (!next[p]) next[p] = 'loading';
      return next;
    });
    Promise.all(paths.map((p) =>
      apiFetch<IndexStatus>(`/repo-mappings/index-status?path=${encodeURIComponent(p)}`)
        .then((res) => ({ p, res, err: null as Error | null }))
        .catch((err) => ({ p, res: null, err }))
    )).then((rows) => {
      if (cancelled) return;
      setIndexStatuses((prev) => {
        const next = { ...prev };
        for (const r of rows) {
          if (r.res) next[r.p] = r.res;
          else next[r.p] = 'error';
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [items]);

  async function reindexMapping(localPath: string) {
    setIndexStatuses((prev) => ({ ...prev, [localPath]: 'reindexing' }));
    try {
      await apiFetch(`/repo-mappings/reindex?path=${encodeURIComponent(localPath)}`, { method: 'POST' });
      const poll = async () => {
        for (let i = 0; i < 60; i += 1) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const res = await apiFetch<IndexStatus>(`/repo-mappings/index-status?path=${encodeURIComponent(localPath)}`);
            setIndexStatuses((prev) => ({ ...prev, [localPath]: res }));
            if (res.is_fresh) return;
          } catch { /* keep polling */ }
        }
      };
      void poll();
    } catch {
      setIndexStatuses((prev) => ({ ...prev, [localPath]: 'error' }));
    }
  }

  async function persist(next: RepoMapping[]) {
    setSaving(true);
    setErr('');
    try {
      await savePrefs({ repo_mappings: next });
      localStorage.setItem(LS_REPO_MAPPINGS, JSON.stringify(next));
      setItems(next);

      // Mirror to the backend `repo_mappings` table so DORA / refinement
      // / multi-repo orchestration share one source of truth. The keys
      // differ between sides — this UI keeps rich fields (notes,
      // analyze_prompt) in user prefs JSON, while the DB row holds the
      // structured triple (provider, owner, repo_name) used by every
      // server-side feature. We match across the two by that triple.
      const triple = (m: RepoMapping) => {
        const provider = m.provider || 'azure';
        const owner = provider === 'github'
          ? (m.github_owner || m.github_repo_full_name?.split('/')[0] || '')
          : (m.azure_project || '');
        const repoName = provider === 'github'
          ? (m.github_repo || m.github_repo_full_name?.split('/').pop() || m.name)
          : (m.azure_repo_name || m.name);
        return { provider, owner, repoName };
      };

      type ServerMapping = {
        id: number;
        provider: string;
        owner: string;
        repo_name: string;
      };
      let existingDbRows: ServerMapping[] = [];
      try {
        existingDbRows = await apiFetch<ServerMapping[]>('/repo-mappings');
      } catch {
        // Listing failed — best-effort: fall back to POST-only and skip
        // the orphan delete pass.
      }

      const desiredKeys = new Set<string>();
      for (const m of next) {
        const { provider, owner, repoName } = triple(m);
        if (!owner || !repoName) continue;
        desiredKeys.add(`${provider}|${owner}|${repoName}`);
        try {
          await apiFetch('/repo-mappings', {
            method: 'POST',
            body: JSON.stringify({
              provider,
              owner,
              repo_name: repoName,
              base_branch: m.default_branch || 'main',
              local_repo_path: m.local_path || null,
              playbook: m.repo_playbook || null,
            }),
          });
        } catch {
          // Unique-constraint duplicate — fine, row already exists.
        }
      }

      // Drop DB rows that the user has removed from this UI, so DORA
      // doesn't keep showing dead mappings (and so a `gocrons` orphan
      // doesn't outlive its retirement here). Best-effort — a single
      // failed delete shouldn't take the whole save down.
      for (const row of existingDbRows) {
        const key = `${row.provider}|${row.owner}|${row.repo_name}`;
        if (!desiredKeys.has(key)) {
          try {
            await apiFetch(`/repo-mappings/${row.id}`, { method: 'DELETE' });
          } catch {
            // ignore — the user can clean it up manually if it really matters
          }
        }
      }

      setMsg(t('mappings.saved'));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('mappings.saveFailed'));
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 2600);
    }
  }

  function resetForm() {
    setPendingProject('');
    setSelRepoUrl('');
    setPendingRepoUrl('');
    setPendingRepoName('');
    setSelGithubRepo('');
    setPendingGithubRepo('');
    setPath('');
    setNotes('');
    setRepoPlaybook('');
    setAnalyzePrompt('');
    setEditingId(null);
    setBranches([]);
    setSelectedBranch('');
  }

  function startEdit(item: RepoMapping) {
    const inferredGithub = Boolean(
      item.provider === 'github' ||
      item.github_repo_full_name ||
      (item.github_owner && item.github_repo),
    );
    const provider: 'azure' | 'github' = inferredGithub ? 'github' : 'azure';
    setSourceProvider(provider);
    setEditingId(item.id);

    if (provider === 'azure') {
      const rawProject = item.azure_project || '';
      const normalizedProject = projects.find((p) => p.name === rawProject || p.id === rawProject)?.name || rawProject;
      const rawRepoUrl = item.azure_repo_url || '';
      const rawRepoName = item.azure_repo_name || item.name || '';
      setSelProject(normalizedProject);
      setPendingProject(rawProject);
      setPendingRepoUrl(rawRepoUrl);
      setPendingRepoName(rawRepoName);
      setSelRepoUrl(rawRepoUrl);
      setPendingGithubRepo('');
      setSelGithubRepo('');
    } else {
      const owner = item.github_owner || githubOwner;
      const fallbackRepo = item.github_repo || item.name || '';
      const targetGithubRepo =
        item.github_repo_full_name ||
        (owner && fallbackRepo ? `${owner}/${fallbackRepo}` : '') ||
        (item.name.includes('/') ? item.name : '');
      setGithubOwner(owner);
      setPendingGithubRepo(targetGithubRepo);
      setSelGithubRepo(targetGithubRepo);
      setPendingProject('');
      setSelProject('');
      setPendingRepoUrl('');
      setPendingRepoName('');
      setSelRepoUrl('');
    }

    setPath(item.local_path || '');
    setNotes(item.notes || '');
    setRepoPlaybook(item.repo_playbook || '');
    setAnalyzePrompt(item.analyze_prompt || '');
    setSelectedBranch(item.default_branch || '');
  }

  useEffect(() => {
    if (sourceProvider !== 'github') return;
    if (!editingId) return;
    if (selGithubRepo) return;
    const current = items.find((m) => m.id === editingId);
    if (!current) return;
    const owner = current.github_owner || githubOwner;
    const fallbackRepo = current.github_repo || current.name || '';
    const rebuilt =
      current.github_repo_full_name ||
      (owner && fallbackRepo ? `${owner}/${fallbackRepo}` : '') ||
      (current.name.includes('/') ? current.name : '');
    if (rebuilt) {
      setPendingGithubRepo(rebuilt);
      setSelGithubRepo(rebuilt);
    }
  }, [sourceProvider, editingId, selGithubRepo, items, githubOwner]);

  // Load branches when a repo is selected
  useEffect(() => {
    setBranches([]);
    if (sourceProvider === 'azure') {
      if (!selProject || !selRepoUrl) return;
      const repoName = repos.find((r) => r.remote_url === selRepoUrl)?.name || '';
      if (!repoName) return;
      setLoadingBranches(true);
      apiFetch<Array<{ name: string; is_default: boolean }>>(
        `/integrations/azure/branches?project=${encodeURIComponent(selProject)}&repo_name=${encodeURIComponent(repoName)}`
      ).then((list) => {
        setBranches(list);
        if (!selectedBranch) {
          const def = list.find((b) => b.is_default);
          if (def) setSelectedBranch(def.name);
        }
      }).catch(() => {}).finally(() => setLoadingBranches(false));
    } else if (sourceProvider === 'github') {
      if (!selGithubRepo) return;
      const [owner, repo] = selGithubRepo.split('/');
      if (!owner || !repo) return;
      setLoadingBranches(true);
      apiFetch<Array<{ name: string; is_default: boolean }>>(
        `/integrations/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`
      ).then((list) => {
        setBranches(list);
        if (!selectedBranch) {
          const def = list.find((b) => b.is_default);
          if (def) setSelectedBranch(def.name);
        }
      }).catch(() => {}).finally(() => setLoadingBranches(false));
    }
  }, [sourceProvider, selRepoUrl, selProject, selGithubRepo]);

  // Ask the host bridge for likely local-path matches whenever the
  // user picks a different repo. Bridge scans common dev folders (one
  // level deep) and ranks dirs by how well their name matches the
  // repo name, plus a small bonus when the dir is actually a git
  // checkout. Failure is non-fatal — the user can still type the
  // path by hand.
  // We need to read pathAutoFilled inside the suggest effect without
  // making the effect re-run on its own setter (that would cause an
  // infinite loop where the auto-fill clears its own pill which clears
  // the path which re-triggers the suggest…). A ref keeps the latest
  // value readable from inside the async callback.
  const pathAutoFilledRef = useRef(pathAutoFilled);
  useEffect(() => { pathAutoFilledRef.current = pathAutoFilled; }, [pathAutoFilled]);

  useEffect(() => {
    let cancelled = false;
    setPathSuggestions([]);
    let repoName = '';
    if (sourceProvider === 'azure') {
      repoName = repos.find((r) => r.remote_url === selRepoUrl)?.name
        || pendingRepoName
        || (selRepoUrl ? selRepoUrl.split('/').pop() || '' : '');
    } else if (sourceProvider === 'github') {
      repoName = selGithubRepo.split('/')[1] || '';
    }
    if (!repoName.trim()) return;
    // When the repo selection changes, the previously auto-filled path
    // is stale — clear it eagerly so the new repo's match can take
    // over. A user-typed path (pathAutoFilled === false) is preserved.
    if (pathAutoFilledRef.current) {
      setPath('');
      setPathAutoFilled(false);
    }
    setPathSuggestLoading(true);
    fetch(`http://localhost:9876/find-repo-paths?repo_name=${encodeURIComponent(repoName.trim())}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bridge ${r.status}`))))
      .then((data: { matches?: { path: string; is_git: boolean; score: number }[] }) => {
        if (cancelled) return;
        const matches = Array.isArray(data?.matches) ? data.matches : [];
        setPathSuggestions(matches);
        // Hybrid: auto-fill when the top match is unambiguously the
        // right one. That's either a single match with score ≥ 100,
        // or multiple matches where the leader is a clean exact-name
        // hit (≥100) AND clears the runner-up by at least 5 points
        // — which is what happens when a level-1 ~/sites/Agena beats
        // a level-3 ~/sites/Agena/skills/agena. Anything tighter
        // than that keeps the chip picker so the user picks
        // consciously.
        const top = matches[0];
        const second = matches[1];
        const topIsExact = !!top && top.score >= 100;
        const beatsRunnerUp = !second || (top.score - second.score) >= 5;
        const isHighConfidence = topIsExact && beatsRunnerUp;
        setPath((current) => {
          // Preserve any text the user typed by hand. Auto-filled
          // values were already wiped above, so an empty `current`
          // here means "nothing manual to protect."
          if (current.trim()) return current;
          if (!isHighConfidence) return current;
          setPathAutoFilled(true);
          return top.path;
        });
      })
      .catch(() => { /* bridge offline — silent fallback */ })
      .finally(() => { if (!cancelled) setPathSuggestLoading(false); });
    return () => { cancelled = true; };
  }, [sourceProvider, selRepoUrl, selGithubRepo, pendingRepoName, repos]);

  // Any manual edit clears the "auto-filled" flag so the hint stops
  // claiming credit for a value the user has changed.
  useEffect(() => { setPathAutoFilled(false); }, [editingId]);

  async function upsertMapping() {
    const currentEditing = editingId ? items.find((m) => m.id === editingId) : undefined;
    let mapping: RepoMapping;
    if (sourceProvider === 'azure') {
      const selectedRepo = repos.find((r) => r.remote_url === selRepoUrl);
      const fallbackRepoUrl = currentEditing?.azure_repo_url || '';
      const fallbackProject = currentEditing?.azure_project || '';
      const effectiveRepoUrl = selectedRepo?.remote_url || selRepoUrl || fallbackRepoUrl;
      const effectiveRepoName = selectedRepo?.name || currentEditing?.azure_repo_name || currentEditing?.name || '';
      const effectiveProject = selProject || fallbackProject;
      if (!effectiveProject || !effectiveRepoUrl || !path.trim()) return;
      mapping = {
        id: editingId || String(Date.now()),
        provider: 'azure',
        name: effectiveRepoName,
        local_path: path.trim(),
        notes: notes.trim() || undefined,
        repo_playbook: repoPlaybook.trim() || undefined,
        analyze_prompt: analyzePrompt.trim() || undefined,
        azure_project: effectiveProject,
        azure_repo_url: effectiveRepoUrl,
        azure_repo_name: effectiveRepoName,
        default_branch: selectedBranch || undefined,
      };
    } else {
      const selectedRepo = githubRepos.find((r) => r.full_name === selGithubRepo);
      const fullName = selectedRepo?.full_name || selGithubRepo || currentEditing?.github_repo_full_name || '';
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
        analyze_prompt: analyzePrompt.trim() || undefined,
        github_owner: owner,
        github_repo: repoName,
        github_repo_full_name: fullName,
        default_branch: selectedBranch || undefined,
      };
    }
    const next: RepoMapping[] = editingId
      ? items.map((m) => (m.id === editingId ? mapping : m))
      : [...items, mapping];
    await persist(next);
    setMsg(editingId ? t('mappings.updated') : t('mappings.saved'));
    const hadProfile = Boolean(repoProfiles[mapping.id]);
    const shouldScanOnUpdate = Boolean(editingId) && (() => {
      if (!currentEditing) return false;
      return (
        currentEditing.local_path !== mapping.local_path ||
        (currentEditing.provider || 'azure') !== (mapping.provider || 'azure') ||
        (currentEditing.azure_project || '') !== (mapping.azure_project || '') ||
        (currentEditing.azure_repo_url || '') !== (mapping.azure_repo_url || '') ||
        (currentEditing.github_repo_full_name || '') !== (mapping.github_repo_full_name || '')
      );
    })();
    if (!editingId) {
      await runProfileScan(mapping, { silentSuccess: true });
    } else if (!hadProfile && shouldScanOnUpdate) {
      await runProfileScan(mapping, { silentSuccess: true });
    }
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

  const empty = useMemo(() => items.length === 0, [items.length]);
  const selectedRepo = useMemo(() => repos.find((r) => r.remote_url === selRepoUrl), [repos, selRepoUrl]);
  const selectedGithubRepo = useMemo(() => githubRepos.find((r) => r.full_name === selGithubRepo), [githubRepos, selGithubRepo]);
  const githubSelectOptions = useMemo(() => {
    if (!selGithubRepo) return githubRepos;
    const found = githubRepos.some((r) => r.full_name.toLowerCase() === selGithubRepo.toLowerCase());
    if (found) return githubRepos;
    const repoName = selGithubRepo.split('/').pop() || selGithubRepo;
    return [{ id: `selected:${selGithubRepo}`, name: repoName, full_name: selGithubRepo, private: true }, ...githubRepos];
  }, [githubRepos, selGithubRepo]);
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
        <h1 style={{ fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 800, color: 'var(--ink-90)', marginTop: 6 }}>
          {t('mappings.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-35)', marginTop: 6 }}>
          {t('mappings.subtitle')}
        </p>
      </div>

      <div className="dash-grid-responsive mappings-layout" style={{ display: 'grid', gap: 14, alignItems: 'start' }}>
        <div style={{ borderRadius: 16, border: '1px solid rgba(56,189,248,0.24)', background: 'var(--surface)', padding: '12px', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#7dd3fc' }}>{t('mappings.createMapping')}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>{t('mappings.totalCount', { n: items.length })}</div>
          </div>

          <div className="dash-grid-responsive mappings-two-col" style={{ display: 'grid', gap: 8 }}>
            <button type='button' onClick={() => setSourceProvider('azure')} className='button'
              style={{ borderColor: sourceProvider === 'azure' ? 'rgba(56,189,248,0.45)' : 'var(--panel-border-3)', background: sourceProvider === 'azure' ? 'rgba(56,189,248,0.12)' : 'var(--panel-alt)', color: sourceProvider === 'azure' ? '#7dd3fc' : 'var(--ink-58)' }}>
              {t('mappings.providerAzure')}
            </button>
            <button type='button' onClick={() => setSourceProvider('github')} className='button'
              style={{ borderColor: sourceProvider === 'github' ? 'rgba(167,139,250,0.45)' : 'var(--panel-border-3)', background: sourceProvider === 'github' ? 'rgba(167,139,250,0.12)' : 'var(--panel-alt)', color: sourceProvider === 'github' ? '#c4b5fd' : 'var(--ink-58)' }}>
              {t('mappings.providerGithub')}
            </button>
          </div>

          {sourceProvider === 'azure' ? (
            <>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.azureProject')}</div>
                <select value={selProject} onChange={(e) => setSelProject(e.target.value)} style={fieldStyle}>
                  <option value='' style={{ background: 'var(--surface)' }}>{loadingProjects ? t('mappings.loadingProjects') : t('mappings.selectProject')}</option>
                  {projects.map((p) => <option key={p.id} value={p.name} style={{ background: 'var(--surface)' }}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.azureRepo')}</div>
                <select value={selRepoUrl} onChange={(e) => setSelRepoUrl(e.target.value)} disabled={!selProject || loadingRepos} style={fieldStyle}>
                  <option value='' style={{ background: 'var(--surface)' }}>{loadingRepos ? t('mappings.loadingRepos') : t('mappings.selectRepo')}</option>
                  {repos.map((r) => <option key={r.id} value={r.remote_url} style={{ background: 'var(--surface)' }}>{r.name}</option>)}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.githubOwner')}</div>
                <input value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder={t('mappings.githubOwnerPlaceholder')} style={fieldStyle} />
                <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>{t('mappings.githubOwnerHint')}</div>
              </div>
              <div>
                <div style={fieldLabelStyle}>{t('mappings.githubRepo')}</div>
                <select value={selGithubRepo} onChange={(e) => setSelGithubRepo(e.target.value)} disabled={loadingGithubRepos || !hasGithubIntegration} style={fieldStyle}>
                  <option value='' style={{ background: 'var(--surface)' }}>
                    {!hasGithubIntegration ? t('mappings.connectGithubFirst') : (loadingGithubRepos ? t('mappings.loadingGithubRepos') : t('mappings.selectGithubRepo'))}
                  </option>
                  {githubSelectOptions.map((r) => <option key={r.id} value={r.full_name} style={{ background: 'var(--surface)' }}>{r.full_name}{r.private ? ' 🔒' : ''}</option>)}
                </select>
                <div style={{ fontSize: 10, color: githubRepoError ? '#fda4af' : 'var(--ink-45)', marginTop: 4 }}>
                  {githubRepoError || `${t('mappings.githubRepoCount')}: ${githubRepoCount}`}
                </div>
              </div>
            </>
          )}

          {sourceProvider === 'azure' && selectedRepo && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(56,189,248,0.3)', background: 'rgba(56,189,248,0.08)', padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7dd3fc' }}>{selectedRepo.name}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-45)', marginTop: 2, wordBreak: 'break-all' }}>{selectedRepo.remote_url}</div>
            </div>
          )}
          {sourceProvider === 'github' && selectedGithubRepo && (
            <div style={{ borderRadius: 10, border: '1px solid rgba(167,139,250,0.3)', background: 'rgba(167,139,250,0.08)', padding: '8px 10px', minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>{selectedGithubRepo.full_name}</div>
              <div style={{ fontSize: 10, color: 'var(--ink-45)', marginTop: 2 }}>{selectedGithubRepo.private ? t('mappings.private') : t('mappings.public')}</div>
            </div>
          )}

          <div className="dash-grid-responsive mappings-two-col" style={{ display: 'grid', gap: 10 }}>
            <div>
              <div style={fieldLabelStyle}>
                {t('mappings.localPath')}
                {pathAutoFilled && (
                  <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(94,234,212,0.14)', color: '#5eead4', textTransform: 'uppercase', letterSpacing: 0.5, verticalAlign: 'middle' }}>
                    auto
                  </span>
                )}
              </div>
              <input
                value={path}
                onChange={(e) => { setPath(e.target.value); if (pathAutoFilled) setPathAutoFilled(false); }}
                placeholder={t('mappings.pathPlaceholder')}
                style={fieldStyle}
              />
              {/* Suggestion chips — only render when there's real
                  ambiguity. A clear winner has already been
                  auto-filled above (and the "auto" pill explains
                  it), so we suppress the chips to keep the row
                  quiet. We re-show them when the user manually
                  cleared the input so they can re-pick. */}
              {(pathSuggestLoading || (pathSuggestions.length > 0 && (!pathAutoFilled || !path))) && pathSuggestions.length > 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                  {pathSuggestLoading && (
                    <span style={{ fontSize: 10, color: 'var(--ink-35)' }}>{t('mappings.loading')}…</span>
                  )}
                  {pathSuggestions.map((s) => {
                    const active = s.path === path;
                    return (
                      <button
                        key={s.path}
                        type='button'
                        onClick={() => { setPath(s.path); setPathAutoFilled(false); }}
                        title={s.path}
                        style={{
                          padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                          border: `1px solid ${active ? 'rgba(94,234,212,0.55)' : 'var(--panel-border-2)'}`,
                          background: active ? 'rgba(94,234,212,0.12)' : 'var(--panel-alt)',
                          color: active ? '#5eead4' : 'var(--ink-58)',
                          cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ opacity: 0.7 }}>{s.is_git ? '⎇' : '📁'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div>
              <div style={fieldLabelStyle}>{t('mappings.branch')}</div>
              {loadingBranches ? (
                <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', color: 'var(--ink-35)', fontSize: 12 }}>{t('mappings.loading')}</div>
              ) : branches.length > 0 ? (
                <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}{b.is_default ? ` (${t('mappings.defaultBranchTag')})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)} placeholder={t('mappings.mainBranchPlaceholder')} style={fieldStyle} />
              )}
            </div>
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
          <div>
            <div style={fieldLabelStyle}>{t('mappings.analyzePrompt')}</div>
            <textarea
              value={analyzePrompt}
              onChange={(e) => setAnalyzePrompt(e.target.value)}
              placeholder={t('mappings.analyzePromptPlaceholder')}
              rows={8}
              style={{
                ...fieldStyle,
                height: 'auto',
                padding: '10px 12px',
                resize: 'vertical',
                lineHeight: 1.45,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
          </div>
          <div className="dash-grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 38 }}>
            <button
              onClick={() => void upsertMapping()}
              disabled={
                saving ||
                !path.trim() ||
                (sourceProvider === 'azure'
                  ? (!editingId && (!selProject || !selRepoUrl))
                  : (!editingId && !selGithubRepo))
              }
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

          <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>
            {t('mappings.selectedRepoMappings')}: <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{selectedRepoMappings.length}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {empty ? (
            <div style={{ padding: 20, color: 'var(--ink-50)', fontSize: 13, borderRadius: 16, border: '1px solid var(--panel-border-2)', background: 'var(--panel)' }}>
              {t('mappings.empty')}
            </div>
          ) : (
            items.map((m) => (
              <div key={m.id} style={{ borderRadius: 14, border: '1px solid var(--panel-border-2)', background: 'var(--surface)', padding: '12px 14px', display: 'grid', gap: 8, overflow: 'hidden' }}>
                {/* Header: Provider + Repo name + actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6, flexShrink: 0, background: (m.provider === 'github') ? 'rgba(167,139,250,0.12)' : 'rgba(56,189,248,0.12)', color: (m.provider === 'github') ? '#a78bfa' : '#38bdf8', border: `1px solid ${(m.provider === 'github') ? 'rgba(167,139,250,0.3)' : 'rgba(56,189,248,0.3)'}` }}>
                        {(m.provider === 'github') ? t('mappings.providerGithub') : t('mappings.providerAzure')}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {(m.provider === 'github') ? (m.github_repo_full_name || m.name) : (m.azure_repo_name || m.name)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{m.local_path}</span>
                      {m.default_branch && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 6, background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.3)', fontFamily: 'inherit', flexShrink: 0 }}>
                          {m.default_branch}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEdit(m)} className='button button-outline' style={{ padding: '5px 10px', fontSize: 11 }}>{t('mappings.edit')}</button>
                    <button onClick={() => setConfirmDeleteId(m.id)} className='button button-outline' style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>{t('mappings.delete')}</button>
                  </div>
                </div>

                {/* Details row */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--ink-58)' }}>
                  {m.azure_project && <span><b style={{ color: 'var(--ink-78)' }}>{t('mappings.col.source')}:</b> {m.azure_project}</span>}
                  {m.notes && <span><b style={{ color: 'var(--ink-78)' }}>{t('mappings.col.notes')}:</b> {m.notes}</span>}
                  {m.repo_playbook && <span title={m.repo_playbook}><b style={{ color: 'var(--ink-78)' }}>{t('mappings.playbookLabel')}:</b> {m.repo_playbook.length > 60 ? m.repo_playbook.slice(0, 60) + '…' : m.repo_playbook}</span>}
                </div>

                {/* Profile + agents.md row */}
                <div style={{ display: 'grid', gap: 4 }}>
                  {repoProfiles[m.id] ? (
                    <>
                      <div
                        title={`${(repoProfiles[m.id].stack || []).slice(0, 3).join(', ')} · ${(repoProfiles[m.id].scanned_by_provider || t('mappings.localSource'))}${repoProfiles[m.id].scanned_model ? ` / ${repoProfiles[m.id].scanned_model}` : ''}`}
                        style={{ fontSize: 11, color: '#86efac', fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {(repoProfiles[m.id].stack || []).slice(0, 2).join(', ') || t('mappings.profileReady')}
                        {' · '}
                        {(repoProfiles[m.id].scanned_by_provider || t('mappings.localSource'))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--ink-35)' }}>{t('mappings.notScanned')}</div>
                  )}
                  {m.local_path && (() => {
                    const st = indexStatuses[m.local_path];
                    let badge: { label: string; color: string; bg: string; border: string };
                    let title = '';
                    if (st === 'loading' || st === undefined) {
                      badge = { label: 'RAG · checking…', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)' };
                    } else if (st === 'reindexing') {
                      badge = { label: 'RAG · reindexing…', color: '#c4b5fd', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' };
                    } else if (st === 'error') {
                      badge = { label: 'RAG · status unavailable', color: '#fca5a5', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.3)' };
                    } else if (!st.indexed) {
                      badge = { label: 'RAG · not indexed yet', color: '#fcd34d', bg: 'rgba(252,211,77,0.10)', border: 'rgba(252,211,77,0.3)' };
                    } else if (st.is_fresh) {
                      badge = { label: `RAG · indexed (${st.points_count})`, color: '#86efac', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.3)' };
                      title = `HEAD ${(st.head_sha || '').slice(0, 8)}`;
                    } else {
                      badge = { label: `RAG · stale (${st.points_count}, HEAD moved)`, color: '#fdba74', bg: 'rgba(249,115,22,0.10)', border: 'rgba(249,115,22,0.3)' };
                      title = `indexed: ${(st.head_sha || '').slice(0, 8)} · current: ${(st.current_head_sha || '').slice(0, 8)}`;
                    }
                    const inProgress = st === 'reindexing' || st === 'loading';
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                        <span title={title} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, color: badge.color, background: badge.bg, border: `1px solid ${badge.border}` }}>
                          {badge.label}
                        </span>
                        <button
                          onClick={() => void reindexMapping(m.local_path)}
                          disabled={inProgress}
                          style={{
                            padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                            border: '1px solid rgba(167,139,250,0.35)',
                            background: 'rgba(167,139,250,0.10)',
                            color: '#c4b5fd',
                            cursor: inProgress ? 'not-allowed' : 'pointer',
                            opacity: inProgress ? 0.6 : 1,
                          }}
                        >
                          Reindex
                        </button>
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => void runProfileScan(m)}
                      disabled={scanningId === m.id}
                      style={{
                        padding: '4px 8px',
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
                    {repoProfiles[m.id]?.agents_md_path && (repoProfiles[m.id]?.agents_md_size || 0) > 0 ? (
                      <button
                        onClick={() => {
                          setAgentsMdViewId(m.id);
                          setAgentsMdContent(null);
                          apiFetch<{ content: string }>(`/preferences/repo-profile/agents-md/${m.id}`)
                            .then((r) => setAgentsMdContent(r.content))
                            .catch(() => setAgentsMdContent(t('mappings.agentsLoadFailed')));
                        }}
                        style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.35)', background: 'rgba(168,85,247,0.12)', color: '#c084fc', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {t('mappings.agentsMdButton', {
                          kb: Math.round((repoProfiles[m.id]?.agents_md_size || 0) / 1024),
                          sig: repoProfiles[m.id]?.agents_md_signatures || 0,
                        })}
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setScanningId(m.id);
                          apiFetch('/preferences/repo-profile/agents-md', {
                            method: 'POST',
                            body: JSON.stringify({ mapping_id: m.id, local_path: m.local_path, mapping_name: m.name }),
                          }).then(() => loadPrefs().then((prefs) => {
                            const fromSettings = (prefs.profile_settings?.repo_profiles ?? {}) as Record<string, RepoProfileSummary>;
                            setRepoProfiles(fromSettings);
                            setMsg(t('mappings.agentsCreated'));
                          })).catch((e) => setErr(e instanceof Error ? e.message : t('mappings.agentsCreateFailed'))).finally(() => setScanningId(null));
                        }}
                        disabled={scanningId === m.id}
                        style={{
                          padding: '4px 8px', borderRadius: 8,
                          border: '1px solid rgba(168,85,247,0.35)', background: 'rgba(168,85,247,0.12)',
                          color: '#c084fc', fontSize: 11, cursor: 'pointer', fontWeight: 700,
                        }}
                      >
                        {t('mappings.agentsCreate')}
                      </button>
                    )}
                  </div>
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

      {/* agents.md Viewer Modal */}
      {agentsMdViewId !== null && (
        <div
          onClick={() => { setAgentsMdViewId(null); setAgentsMdContent(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, width: '90vw', maxWidth: 900, maxHeight: '85vh', display: 'grid', gridTemplateRows: 'auto 1fr auto', overflow: 'hidden' }}
          >
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>{t('mappings.agentsMdTitle')}</h3>
              <button onClick={() => { setAgentsMdViewId(null); setAgentsMdContent(null); }} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ overflow: 'auto', padding: '16px 20px' }}>
              {agentsMdContent === null ? (
                <div style={{ color: 'var(--muted)', padding: 20 }}>{t('mappings.loading')}</div>
              ) : (
                <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--ink)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                  {agentsMdContent}
                </pre>
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className='button button-outline'
                onClick={() => {
                  setScanningId(agentsMdViewId);
                  const mapping = items.find((m) => m.id === agentsMdViewId);
                  if (!mapping) return;
                  apiFetch('/preferences/repo-profile/agents-md', {
                    method: 'POST',
                    body: JSON.stringify({ mapping_id: mapping.id, local_path: mapping.local_path, mapping_name: mapping.name }),
                  }).then(() => loadPrefs().then((prefs) => {
                    const fromSettings = (prefs.profile_settings?.repo_profiles ?? {}) as Record<string, RepoProfileSummary>;
                    setRepoProfiles(fromSettings);
                    return apiFetch<{ content: string }>(`/preferences/repo-profile/agents-md/${mapping.id}`);
                  }).then((r) => setAgentsMdContent(r.content))).catch((e) => setErr(e instanceof Error ? e.message : t('mappings.errorGeneric'))).finally(() => setScanningId(null));
                }}
                style={{ fontSize: 12 }}
              >
                {t('mappings.regenerate')}
              </button>
              <button className='button button-outline' onClick={() => { setAgentsMdViewId(null); setAgentsMdContent(null); }} style={{ fontSize: 12 }}>{t('mappings.close')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setConfirmDeleteId(null)}>
          <div style={{ width: 'min(400px, 90vw)', borderRadius: 16, background: 'var(--surface)', border: '1px solid rgba(239,68,68,0.2)', padding: '24px', boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>{t('mappings.confirmDeleteTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-58)', marginBottom: 6 }}>
              {items.find((m) => m.id === confirmDeleteId)?.name || ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-42)', marginBottom: 20 }}>{t('mappings.confirmDeleteDesc')}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDeleteId(null)} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 600, background: 'var(--panel)', border: '1px solid var(--panel-border)', color: 'var(--ink-58)', cursor: 'pointer' }}>{t('mappings.cancel')}</button>
              <button onClick={() => { void removeMapping(confirmDeleteId); setConfirmDeleteId(null); }} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer' }}>{t('mappings.confirmDelete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
