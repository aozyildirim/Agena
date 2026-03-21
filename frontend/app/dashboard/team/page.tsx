'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { apiFetch, loadPrefs, savePrefs, type AzureMember } from '@/lib/api';
type WorkItem = { id: string; title: string; state: string };

const STATE_COLORS: Record<string, string> = {
  'Backlog': '#6b7280', 'To Do': '#f59e0b', 'In Progress': '#38bdf8',
  'Code Review': '#a78bfa', 'QA To Do': '#f472b6', 'Done': '#22c55e',
  'Closed': '#22c55e', 'Resolved': '#22c55e', 'Active': '#38bdf8', 'New': '#f59e0b',
};
const sc = (s: string) => STATE_COLORS[s] ?? '#5eead4';

const LS_PROJECT  = 'tiqr_sprint_project';
const LS_TEAM     = 'tiqr_sprint_team';
const LS_SPRINT   = 'tiqr_sprint_path';
const LS_MY_TEAM  = 'tiqr_my_team'; // JSON string: AzureMember[]

const GRADIENTS = [
  ['#0d9488','#22c55e'], ['#7c3aed','#a78bfa'], ['#0ea5e9','#38bdf8'],
  ['#f59e0b','#fb923c'], ['#ec4899','#f472b6'], ['#14b8a6','#06b6d4'],
];
const grad = (name: string) => {
  const g = GRADIENTS[name.charCodeAt(0) % GRADIENTS.length];
  return `linear-gradient(135deg, ${g[0]}, ${g[1]})`;
};
const initials = (name: string) =>
  name.split(' ').map((n) => n[0] ?? '').join('').toUpperCase().slice(0, 2);

export default function TeamPage() {
  const [project,    setProject]    = useState('');
  const [team,       setTeam]       = useState('');
  const [sprintPath, setSprintPath] = useState('');

  // Tüm Azure üyeleri (arama için)
  const [allMembers, setAllMembers] = useState<AzureMember[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  // Benim seçtiğim takım
  const [myTeam, setMyTeam] = useState<AzureMember[]>([]);

  // Arama & panel
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // İş detayları
  const [workItems,    setWorkItems]    = useState<Record<string, WorkItem[]>>({});
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState<string | null>(null);
  const [err, setErr] = useState('');

  // İlk yükleme
  useEffect(() => {
    // DB'den tercihleri çek
    loadPrefs().then((prefs) => {
      const p = prefs.azure_project    || localStorage.getItem(LS_PROJECT) || '';
      const t = prefs.azure_team       || localStorage.getItem(LS_TEAM)    || '';
      const s = prefs.azure_sprint_path || localStorage.getItem(LS_SPRINT) || '';
      setProject(p); setTeam(t); setSprintPath(s);
      if (prefs.my_team?.length) {
        setMyTeam(prefs.my_team as AzureMember[]);
      } else {
        try {
          const saved = localStorage.getItem(LS_MY_TEAM);
          if (saved) setMyTeam(JSON.parse(saved) as AzureMember[]);
        } catch { /* ignore */ }
      }
      // Tüm Azure üyelerini çek (picker için)
      if (!p) return;
      setLoadingAll(true);
      apiFetch<AzureMember[]>('/tasks/azure/members')
        .then(setAllMembers)
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Üyeler yüklenemedi'))
        .finally(() => setLoadingAll(false));
    }).catch(() => {
      const p = localStorage.getItem(LS_PROJECT) || '';
      const t = localStorage.getItem(LS_TEAM)    || '';
      const s = localStorage.getItem(LS_SPRINT)  || '';
      setProject(p); setTeam(t); setSprintPath(s);
      try {
        const saved = localStorage.getItem(LS_MY_TEAM);
        if (saved) setMyTeam(JSON.parse(saved) as AzureMember[]);
      } catch { /* ignore */ }
      if (!p) return;
      setLoadingAll(true);
      apiFetch<AzureMember[]>('/tasks/azure/members')
        .then(setAllMembers)
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Üyeler yüklenemedi'))
        .finally(() => setLoadingAll(false));
    });
  }, []);

  // Takıma ekle / çıkar — DB'ye de kaydet
  function toggleMember(m: AzureMember) {
    setMyTeam((prev) => {
      const exists = prev.some((x) => x.id === m.id);
      const next = exists ? prev.filter((x) => x.id !== m.id) : [...prev, m];
      localStorage.setItem(LS_MY_TEAM, JSON.stringify(next));
      void savePrefs({ my_team: next });
      return next;
    });
  }

  // Arama filtresi
  const filtered = useMemo(() =>
    allMembers.filter((m) =>
      m.displayName.toLowerCase().includes(search.toLowerCase()) ||
      m.uniqueName.toLowerCase().includes(search.toLowerCase())
    ), [allMembers, search]);

  // İş detayı aç/kapat
  async function loadWorkItems(member: AzureMember) {
    if (expanded === member.id) { setExpanded(null); return; }
    setExpanded(member.id);
    if (workItems[member.id] !== undefined || !sprintPath) return;
    setLoadingItems(member.id);
    try {
      const items = await apiFetch<WorkItem[]>(
        '/tasks/azure/member/workitems' +
        '?project=' + encodeURIComponent(project) +
        '&team=' + encodeURIComponent(team) +
        '&sprint_path=' + encodeURIComponent(sprintPath) +
        '&assigned_to=' + encodeURIComponent(member.uniqueName)
      );
      setWorkItems((prev) => ({ ...prev, [member.id]: items }));
    } catch {
      setWorkItems((prev) => ({ ...prev, [member.id]: [] }));
    } finally {
      setLoadingItems(null);
    }
  }

  const hasConfig = !!(project && team);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div className="section-label">Team</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
            Takımım
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 14, margin: 0 }}>
            {myTeam.length > 0
              ? myTeam.length + ' kişi · ' + (sprintPath ? 'Sprint iş dağılımı' : 'Sprint seçilmedi')
              : 'Sağdaki butondan takım arkadaşlarını ekle'}
          </p>
        </div>
        {hasConfig && (
          <button onClick={() => setShowPicker(true)}
            style={{ flexShrink: 0, padding: '10px 18px', borderRadius: 12, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.1)', color: '#5eead4', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>+</span> Üye Ekle / Düzenle
          </button>
        )}
      </div>

      {!hasConfig && (
        <div style={{ padding: '20px 24px', borderRadius: 16, border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, color: '#fbbf24', fontSize: 14 }}>Azure takımı seçilmedi</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>Profil sayfasından proje ve takım seç</div>
          </div>
          <a href="/dashboard/profile" style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Profil →
          </a>
        </div>
      )}

      {err && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div>
      )}

      {/* Benim takımım — kart listesi */}
      {myTeam.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {myTeam.map((member) => {
            const isExpanded = expanded === member.id;
            const items = workItems[member.id];
            const isLoadingItems = loadingItems === member.id;
            return (
              <div key={member.id} style={{ borderRadius: 16, border: '1px solid ' + (isExpanded ? 'rgba(94,234,212,0.2)' : 'rgba(255,255,255,0.06)'), background: isExpanded ? 'rgba(13,148,136,0.04)' : 'rgba(255,255,255,0.02)', overflow: 'hidden', transition: 'border-color 0.2s' }}>
                <button onClick={() => void loadWorkItems(member)}
                  style={{ width: '100%', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: grad(member.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                    {initials(member.displayName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>{member.displayName}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.uniqueName}</div>
                  </div>
                  {sprintPath && items !== undefined && (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: items.length > 0 ? 'rgba(94,234,212,0.1)' : 'rgba(255,255,255,0.05)', border: '1px solid ' + (items.length > 0 ? 'rgba(94,234,212,0.25)' : 'rgba(255,255,255,0.08)'), color: items.length > 0 ? '#5eead4' : 'rgba(255,255,255,0.3)' }}>
                      {items.length} iş
                    </span>
                  )}
                  {sprintPath && (
                    <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.2)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>⌄</span>
                  )}
                </button>

                {isExpanded && sprintPath && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '10px 20px 14px' }}>
                    {isLoadingItems ? (
                      <div style={{ display: 'grid', gap: 6 }}><Skel /><Skel /><Skel opacity={0.4} /></div>
                    ) : !items || items.length === 0 ? (
                      <div style={{ padding: '14px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>Bu sprintte atanmış iş yok</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 6 }}>
                        {items.map((item) => (
                          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: sc(item.state), boxShadow: '0 0 5px ' + sc(item.state), flexShrink: 0 }} />
                            <span style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{item.title}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: sc(item.state) + '18', border: '1px solid ' + sc(item.state) + '35', color: sc(item.state), whiteSpace: 'nowrap' }}>{item.state}</span>
                            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>#{item.id}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : hasConfig && !loadingAll ? (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 48, opacity: 0.1, marginBottom: 16 }}>◉</div>
          <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14, marginBottom: 20 }}>Henüz takım üyesi eklenmedi</div>
          <button onClick={() => setShowPicker(true)}
            style={{ padding: '10px 20px', borderRadius: 12, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.1)', color: '#5eead4', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            + Üye Ekle
          </button>
        </div>
      ) : null}

      {/* Picker Modal */}
      {showPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(12px)' }} onClick={() => setShowPicker(false)} />
          <div style={{ position: 'relative', width: '100%', maxWidth: 480, borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(8,14,30,0.98)', overflow: 'hidden', boxShadow: '0 40px 100px rgba(0,0,0,0.6)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 2, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #22c55e)', flexShrink: 0 }} />

            <div style={{ padding: '24px 24px 16px', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.95)' }}>Takım Üyelerini Seç</h3>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{myTeam.length} seçili · {allMembers.length} kişi</p>
                </div>
                <button onClick={() => setShowPicker(false)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>

              {/* Search */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'rgba(255,255,255,0.25)' }}>⌕</span>
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="İsim veya email ara..."
                  autoFocus
                  style={{ width: '100%', padding: '10px 14px 10px 34px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            {/* Liste */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 16px' }}>
              {loadingAll ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Yükleniyor…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>Sonuç bulunamadı</div>
              ) : (
                <div style={{ display: 'grid', gap: 4 }}>
                  {filtered.map((m) => {
                    const selected = myTeam.some((x) => x.id === m.id);
                    return (
                      <button key={m.id} onClick={() => toggleMember(m)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, border: '1px solid ' + (selected ? 'rgba(13,148,136,0.35)' : 'rgba(255,255,255,0.05)'), background: selected ? 'rgba(13,148,136,0.1)' : 'rgba(255,255,255,0.02)', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: grad(m.displayName), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                          {initials(m.displayName)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{m.displayName}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.uniqueName}</div>
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid ' + (selected ? '#0d9488' : 'rgba(255,255,255,0.15)'), background: selected ? '#0d9488' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                          {selected && <span style={{ fontSize: 10, color: '#fff', fontWeight: 800 }}>✓</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding: '14px 24px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              <button onClick={() => setShowPicker(false)}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Tamam — {myTeam.length} kişi seçildi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Skel({ opacity = 1 }: { opacity?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', opacity }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
      <div style={{ flex: 1, height: 11, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ width: 55, height: 18, borderRadius: 999, background: 'rgba(255,255,255,0.04)' }} />
    </div>
  );
}
