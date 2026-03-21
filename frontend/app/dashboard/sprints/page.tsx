/* eslint-disable */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, loadPrefs } from '@/lib/api';

type Opt = { id: string; name: string; path?: string };
type WorkItem = {
  id: string; title: string; description: string; source: string; state?: string;
  assigned_to?: string; created_date?: string; activated_date?: string;
};
type ImportRes = { imported: number; skipped: number };

const STATES_ORDER = ['Backlog','To Do','In Progress','Code Review','QA To Do','Done','Closed','Resolved','Active','New'];

const STATE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  'Backlog':      { color: '#6b7280', bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.2)' },
  'To Do':        { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.2)'  },
  'New':          { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.2)'  },
  'In Progress':  { color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.2)'  },
  'Active':       { color: '#38bdf8', bg: 'rgba(56,189,248,0.07)',  border: 'rgba(56,189,248,0.2)'  },
  'Code Review':  { color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', border: 'rgba(167,139,250,0.2)' },
  'QA To Do':     { color: '#f472b6', bg: 'rgba(244,114,182,0.07)', border: 'rgba(244,114,182,0.2)' },
  'Done':         { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.2)'   },
  'Closed':       { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.2)'   },
  'Resolved':     { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.2)'   },
};
const fallbackPalette = [
  { color: '#5eead4', bg: 'rgba(94,234,212,0.07)', border: 'rgba(94,234,212,0.2)' },
  { color: '#fb923c', bg: 'rgba(251,146,60,0.07)', border: 'rgba(251,146,60,0.2)' },
];
const sc = (s: string, i: number) => STATE_COLORS[s] ?? fallbackPalette[i % fallbackPalette.length];

const LS_PROJECT = 'tiqr_sprint_project';
const LS_TEAM    = 'tiqr_sprint_team';
const LS_SPRINT  = 'tiqr_sprint_path';

function elapsed(from?: string, to?: string): string | null {
  if (!from) return null;
  const start = new Date(from).getTime();
  const end   = to ? new Date(to).getTime() : Date.now();
  const diff  = Math.max(0, end - start);
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return days + 'g ' + hours + 's';
  if (hours > 0) return hours + 's';
  return Math.floor(diff / 60000) + 'd';
}

function shortName(full?: string): string {
  if (!full) return '—';
  const parts = full.split(' ');
  if (parts.length === 1) return full;
  return parts[0] + ' ' + parts[parts.length - 1][0] + '.';
}

export default function SprintsPage() {
  const [projects, setProjects] = useState<Opt[]>([]);
  const [teams,    setTeams]    = useState<Opt[]>([]);
  const [sprints,  setSprints]  = useState<Opt[]>([]);
  const [states,   setStates]   = useState<string[]>([]);
  const [project,  setProjectRaw]  = useState('');
  const [team,     setTeamRaw]     = useState('');
  const [sprint,   setSprintRaw]   = useState('');
  const [items,    setItems]    = useState<WorkItem[]>([]);
  const [lpj, setLpj] = useState(false);
  const [ltm, setLtm] = useState(false);
  const [lsp, setLsp] = useState(false);
  const [lbd, setLbd] = useState(false);
  const [imp, setImp] = useState('');
  const [hasAzure, setHasAzure] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState<WorkItem | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState('');

  const setProject = useCallback((v: string) => { setProjectRaw(v); localStorage.setItem(LS_PROJECT, v); }, []);
  const setTeam    = useCallback((v: string) => { setTeamRaw(v);    localStorage.setItem(LS_TEAM, v);    }, []);
  const setSprint  = useCallback((v: string) => { setSprintRaw(v);  localStorage.setItem(LS_SPRINT, v);  }, []);

  // İlk yükleme — DB'den + localStorage'dan
  useEffect(() => {
    const init = async () => {
      let savedProject = localStorage.getItem(LS_PROJECT) || '';
      let savedTeam    = localStorage.getItem(LS_TEAM)    || '';
      let savedSprint  = localStorage.getItem(LS_SPRINT)  || '';
      try {
        const prefs = await loadPrefs();
        if (prefs.azure_project)     savedProject = prefs.azure_project;
        if (prefs.azure_team)        savedTeam    = prefs.azure_team;
        if (prefs.azure_sprint_path) savedSprint  = prefs.azure_sprint_path;
      } catch { /* localStorage fallback */ }

      setLpj(true);
      try {
        const projs = await apiFetch<Opt[]>('/tasks/azure/projects');
        setProjects(projs); setHasAzure(true);
        if (!savedProject) return;
        setProjectRaw(savedProject);
        const tms = await apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(savedProject));
        setTeams(tms);
        if (!savedTeam) return;
        setTeamRaw(savedTeam);
        const sps = await apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(savedProject) + '&team=' + encodeURIComponent(savedTeam));
        setSprints(sps);
        if (!savedSprint) return;
        setSprintRaw(savedSprint);
      } catch { setHasAzure(false); }
      finally { setLpj(false); }
    };
    void init();
  }, []);

  useEffect(() => {
    setTeamRaw(''); setTeams([]); setSprintRaw(''); setSprints([]); setItems([]); setStates([]);
    if (!project) return;
    setLtm(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(project))
      .then(setTeams).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Takımlar yüklenemedi'))
      .finally(() => setLtm(false));
  }, [project]);

  useEffect(() => {
    setSprintRaw(''); setSprints([]); setItems([]);
    if (!project || !team) return;
    setLsp(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team))
      .then(setSprints).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Sprintler yüklenemedi'))
      .finally(() => setLsp(false));
  }, [project, team]);

  useEffect(() => {
    setItems([]); setStates([]); setSelected(null);
    if (!sprint || !project) return;
    setLbd(true); setErr('');
    apiFetch<string[]>('/tasks/azure/states?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team) + '&sprint_path=' + encodeURIComponent(sprint))
      .then((fetchedStates) => {
        const active = fetchedStates.length > 0 ? fetchedStates : ['Backlog','To Do','In Progress','Done'];
        setStates(active);
        return Promise.allSettled(
          active.map(async (state) => {
            const q = new URLSearchParams({ state, sprint_path: sprint });
            if (project) q.set('project', project);
            if (team)    q.set('team', team);
            const r = await apiFetch<{ items: WorkItem[] }>('/tasks/azure?' + q.toString());
            return r.items.map((item) => ({ ...item, state }));
          })
        );
      }).then((results) => {
        if (!results) return;
        const merged: WorkItem[] = [];
        results.forEach((r) => { if (r.status === 'fulfilled') merged.push(...r.value); });
        setItems(merged);
      }).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Board yüklenemedi'))
        .finally(() => setLbd(false));
  }, [sprint, project, team]);

  function doImport(state: string) {
    setImp(state); setErr('');
    apiFetch<ImportRes>('/tasks/import/azure', {
      method: 'POST',
      body: JSON.stringify({ project: project || undefined, team: team || undefined, sprint_path: sprint || undefined, state }),
    }).then((r) => setMsg('"' + state + '" — ' + String(r.imported) + ' import edildi, ' + String(r.skipped) + ' atlandı'))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Import başarısız'))
      .finally(() => setImp(''));
  }

  async function assignAI(item: WorkItem) {
    setAiLoading(true); setAiResult('');
    try {
      const res = await apiFetch<{ message: string }>('/tasks/' + item.id + '/assign-ai', { method: 'POST' });
      setAiResult(res.message || 'AI atandı');
    } catch (e) {
      setAiResult('AI atama başarısız: ' + (e instanceof Error ? e.message : 'Hata'));
    } finally {
      setAiLoading(false);
    }
  }

  // Sadece içi dolu sütunları göster (yükleme sırasında hepsini göster)
  const visibleStates = lbd
    ? states
    : states.filter((s) => items.some((i) => i.state === s));

  const selS = sprints.find((s) => (s.path ?? s.name) === sprint);
  const selT = teams.find((t) => t.name === team);
  const selP = projects.find((p) => p.name === project);
  const breadcrumb = selP && selT && selS
    ? selP.name + ' › ' + selT.name + ' › ' + selS.name
    : lpj ? 'Projeler yükleniyor…' : 'Aşağıdan proje, takım ve sprint seç';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      {/* Header */}
      <div>
        <div className="section-label">Sprints</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 6, marginBottom: 4 }}>
          Sprint Board
        </h1>
        {!hasAzure && !lpj ? (
          <p style={{ fontSize: 13, color: '#fbbf24', margin: 0 }}>
            Azure PAT yapılandırılmamış.{' '}
            <a href="/dashboard/integrations" style={{ color: '#fbbf24', textDecoration: 'underline' }}>Integrations</a> sayfasına git.
          </p>
        ) : (
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', margin: 0 }}>{breadcrumb}</p>
        )}
      </div>

      {/* Selectors */}
      <div style={{ position: 'sticky', top: 72, zIndex: 40, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(3,7,18,0.92)', backdropFilter: 'blur(24px)', padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Sel step={1} label="Project" value={project} onChange={setProject}
          options={projects.map((p: Opt) => ({ id: p.name, name: p.name }))}
          loading={lpj} placeholder="Proje seç..." active={true} />
        <Sel step={2} label="Team" value={team} onChange={setTeam}
          options={teams.map((t: Opt) => ({ id: t.name, name: t.name }))}
          loading={ltm} placeholder={project ? 'Takım seç...' : 'Önce proje seç'} active={!!project} />
        <Sel step={3} label="Sprint" value={sprint} onChange={setSprint}
          options={sprints.map((s: Opt) => ({ id: s.path ?? s.name, name: s.name }))}
          loading={lsp} placeholder={team ? 'Sprint seç...' : 'Önce takım seç'} active={!!team} />
      </div>

      {(msg || err) ? (
        <div style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, background: err ? 'rgba(248,113,113,0.1)' : 'rgba(34,197,94,0.1)', border: '1px solid ' + (err ? 'rgba(248,113,113,0.3)' : 'rgba(34,197,94,0.3)'), color: err ? '#f87171' : '#22c55e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{err || msg}</span>
          <button onClick={() => { setErr(''); setMsg(''); }} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
      ) : null}

      {/* Board + Detail Panel */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 1, minHeight: 0 }}>
        {/* Board columns */}
        {sprint ? (
          <div style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8, minWidth: 0 }}>
            {(lbd ? states : visibleStates).length === 0 && !lbd ? (
              <div style={{ flex: 1, textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>
                Bu sprintte iş kalemi bulunamadı
              </div>
            ) : (lbd ? states : visibleStates).map((state, idx) => {
              const s = sc(state, idx);
              const col = items.filter((i) => i.state === state);
              return (
                <div key={state} style={{ borderRadius: 14, border: '1px solid ' + s.border, background: s.bg, overflow: 'hidden', minWidth: 200, width: 220, flexShrink: 0 }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid ' + s.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, boxShadow: '0 0 6px ' + s.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 10, color: s.color, textTransform: 'uppercase', letterSpacing: 0.8 }}>{state}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 999, background: s.color + '22', color: s.color }}>{lbd ? '…' : col.length}</span>
                    </div>
                    {!lbd && col.length > 0 ? (
                      <button onClick={() => doImport(state)} disabled={imp === state}
                        style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: s.color + '18', border: '1px solid ' + s.color + '40', color: s.color, cursor: imp === state ? 'not-allowed' : 'pointer' }}>
                        {imp === state ? '…' : 'Import'}
                      </button>
                    ) : null}
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 100 }}>
                    {lbd ? (
                      <><SkeletonCard /><SkeletonCard /><SkeletonCard opacity={0.4} /></>
                    ) : col.map((item) => (
                      <BoardCard key={item.id} item={item} stateColor={s.color}
                        selected={selected?.id === item.id}
                        onClick={() => setSelected(selected?.id === item.id ? null : item)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: 1, textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 14, opacity: 0.1 }}>◎</div>
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14 }}>Proje › Takım › Sprint seç, board otomatik yüklenir</div>
          </div>
        )}

        {/* Detail Panel */}
        {selected && (
          <DetailPanel
            item={selected}
            onClose={() => setSelected(null)}
            aiLoading={aiLoading}
            aiResult={aiResult}
            onAssignAI={() => void assignAI(selected)}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonCard({ opacity = 1 }: { opacity?: number }) {
  return (
    <div style={{ borderRadius: 9, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.03)', padding: '10px 11px', opacity }}>
      <div style={{ height: 11, borderRadius: 4, background: 'rgba(255,255,255,0.07)', width: '80%', marginBottom: 7 }} />
      <div style={{ height: 9, borderRadius: 4, background: 'rgba(255,255,255,0.04)', width: '50%' }} />
    </div>
  );
}

function BoardCard({ item, stateColor, selected, onClick }: {
  item: WorkItem; stateColor: string; selected: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const active = selected || hovered;

  // Süre hesabı: açılıştan In Progress'e kadar (activated_date varsa), yoksa şimdiye kadar
  const timeLabel = item.activated_date
    ? elapsed(item.created_date, item.activated_date)
    : elapsed(item.created_date);

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 9, border: '1px solid ' + (active ? stateColor + '60' : 'rgba(255,255,255,0.06)'),
        background: selected ? stateColor + '10' : 'rgba(3,7,18,0.7)',
        padding: '10px 11px', transition: 'all 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: active ? '0 3px 16px ' + stateColor + '18' : 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.88)', lineHeight: 1.4, marginBottom: 6 }}>{item.title}</div>

      {/* Atanan kişi */}
      {item.assigned_to && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
            {item.assigned_to[0]?.toUpperCase()}
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shortName(item.assigned_to)}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace' }}>#{item.id}</span>
        {timeLabel && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 999, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)' }}>
            ⏱ {timeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function DetailPanel({ item, onClose, aiLoading, aiResult, onAssignAI }: {
  item: WorkItem; onClose: () => void;
  aiLoading: boolean; aiResult: string; onAssignAI: () => void;
}) {
  const stateInfo = STATE_COLORS[item.state ?? ''] ?? { color: '#5eead4', bg: 'rgba(94,234,212,0.07)', border: 'rgba(94,234,212,0.2)' };
  const openDuration  = elapsed(item.created_date);
  const toActiveDuration = item.activated_date ? elapsed(item.created_date, item.activated_date) : null;

  return (
    <div style={{
      width: 320, flexShrink: 0, borderRadius: 18,
      border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(8,14,30,0.98)',
      overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
      maxHeight: 'calc(100vh - 220px)',
      position: 'sticky', top: 160,
    }}>
      {/* Top accent */}
      <div style={{ height: 2, background: 'linear-gradient(90deg, ' + stateInfo.color + ', #7c3aed)' }} />

      {/* Header */}
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: stateInfo.color, boxShadow: '0 0 6px ' + stateInfo.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: stateInfo.color, textTransform: 'uppercase', letterSpacing: 0.8 }}>{item.state}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginLeft: 'auto' }}>#{item.id}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.92)', lineHeight: 1.4 }}>{item.title}</div>
        </div>
        <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Atanan */}
        <DetailRow icon="👤" label="Atanan">
          {item.assigned_to || '—'}
        </DetailRow>

        {/* Zaman bilgileri */}
        {item.created_date && (
          <DetailRow icon="📅" label="Açılış">
            {new Date(item.created_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
            {openDuration && <span style={{ marginLeft: 6, fontSize: 10, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 999 }}>{openDuration} önce</span>}
          </DetailRow>
        )}

        {toActiveDuration && (
          <DetailRow icon="⚡" label="Açılıştan In Progress'e">
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>{toActiveDuration}</span>
          </DetailRow>
        )}

        {!toActiveDuration && item.created_date && (
          <DetailRow icon="⏳" label="Açık süre">
            <span style={{ color: '#f59e0b', fontWeight: 700 }}>{openDuration}</span>
          </DetailRow>
        )}

        {/* Açıklama */}
        {item.description && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 6 }}>Açıklama</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
              {item.description}
            </div>
          </div>
        )}

        {/* AI sonucu */}
        {aiResult && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.25)', fontSize: 12, color: '#5eead4', lineHeight: 1.5 }}>
            🤖 {aiResult}
          </div>
        )}
      </div>

      {/* Footer — Assign AI */}
      <div style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button
          onClick={onAssignAI}
          disabled={aiLoading}
          style={{
            width: '100%', padding: '11px', borderRadius: 12, border: 'none',
            background: aiLoading ? 'rgba(13,148,136,0.3)' : 'linear-gradient(135deg, #0d9488, #7c3aed)',
            color: '#fff', fontWeight: 700, fontSize: 13, cursor: aiLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {aiLoading ? (
            <><span style={{ fontSize: 14 }}>⟳</span> AI çalışıyor…</>
          ) : (
            <><span style={{ fontSize: 14 }}>🤖</span> Assign AI</>
          )}
        </button>
        <div style={{ marginTop: 8, fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
          AI bu işi analiz edip otomatik atar
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>{children}</div>
      </div>
    </div>
  );
}

function Sel({ step, label, value, onChange, options, loading, placeholder, active }: {
  step: number; label: string; value: string; onChange: (v: string) => void;
  options: Opt[]; loading: boolean; placeholder: string; active: boolean;
}) {
  return (
    <div style={{ opacity: active ? 1 : 0.4, transition: 'opacity 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', fontSize: 9, fontWeight: 800, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: value ? 'linear-gradient(135deg, #0d9488, #22c55e)' : 'rgba(255,255,255,0.08)', color: value ? '#fff' : 'rgba(255,255,255,0.4)' }}>{step}</span>
        <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: value ? '#5eead4' : 'rgba(255,255,255,0.35)' }}>{label}</label>
        {loading ? <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>yükleniyor…</span> : null}
      </div>
      <select value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} disabled={!active || loading}
        style={{ width: '100%', border: '1px solid ' + (value ? 'rgba(13,148,136,0.4)' : 'rgba(255,255,255,0.1)'), borderRadius: 10, padding: '9px 12px', font: 'inherit', fontSize: 12, background: value ? 'rgba(13,148,136,0.08)' : 'rgba(255,255,255,0.04)', color: value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', cursor: active && !loading ? 'pointer' : 'not-allowed', appearance: 'none', outline: 'none' }}>
        <option value="" style={{ background: '#0d1117' }}>{placeholder}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id} style={{ background: '#0d1117' }}>{o.name}</option>
        ))}
      </select>
    </div>
  );
}
