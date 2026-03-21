'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, removeToken, loadPrefs, savePrefs } from '@/lib/api';

type Opt = { id: string; name: string; path?: string };
type MeRes = { user_id: number; email: string; full_name: string; organization_id: number };

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<MeRes | null>(null);

  const [projects, setProjects] = useState<Opt[]>([]);
  const [teams,    setTeams]    = useState<Opt[]>([]);
  const [sprints,  setSprints]  = useState<Opt[]>([]);
  const [project,  setProject]  = useState('');
  const [team,     setTeam]     = useState('');
  const [sprint,   setSprint]   = useState('');
  const [ltm, setLtm] = useState(false);
  const [lsp, setLsp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err, setErr] = useState('');

  // İlk yükleme sırasında cascade useEffect'lerin sıfırlamasını engelle
  const initializing = useRef(true);

  useEffect(() => {
    apiFetch<MeRes>('/auth/me').then(setUser).catch(() => {});
    apiFetch<Opt[]>('/tasks/azure/projects').then(setProjects).catch(() => {});

    loadPrefs().then(async (prefs) => {
      const p = prefs.azure_project     || '';
      const t = prefs.azure_team        || '';
      const s = prefs.azure_sprint_path || '';
      if (!p) { initializing.current = false; return; }
      setProject(p);
      if (!t) { initializing.current = false; return; }
      const tms = await apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(p)).catch(() => [] as Opt[]);
      setTeams(tms);
      setTeam(t);
      if (!s) { initializing.current = false; return; }
      const sps = await apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(p) + '&team=' + encodeURIComponent(t)).catch(() => [] as Opt[]);
      setSprints(sps);
      setSprint(s);
      initializing.current = false;
    }).catch(() => {
      initializing.current = false;
    });
  }, []);

  // Proje değişince takımları yükle (sadece kullanıcı değiştirince)
  const onProjectChange = useCallback((v: string) => {
    setProject(v); setTeam(''); setTeams([]); setSprint(''); setSprints([]); setSaved(false);
    if (!v) return;
    setLtm(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(v))
      .then(setTeams).catch(() => {}).finally(() => setLtm(false));
  }, []);

  // Takım değişince sprintleri yükle
  const onTeamChange = useCallback((v: string) => {
    setTeam(v); setSprint(''); setSprints([]); setSaved(false);
    if (!v || !project) return;
    setLsp(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(v))
      .then(setSprints).catch(() => {}).finally(() => setLsp(false));
  }, [project]);

  const onSprintChange = useCallback((v: string) => {
    setSprint(v); setSaved(false);
  }, []);

  async function save() {
    setSaving(true); setErr('');
    try {
      await savePrefs({ azure_project: project, azure_team: team, azure_sprint_path: sprint });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  }

  function logout() { removeToken(); router.push('/'); }

  const selS = sprints.find((s) => (s.path ?? s.name) === sprint);

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 680 }}>
      <div>
        <div className="section-label">Profil</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginTop: 8, marginBottom: 4 }}>
          Hesap Ayarları
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.3)', margin: 0 }}>Sprint seçimini değiştir, hesap bilgilerini gör</p>
      </div>

      {user && (
        <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 24, display: 'flex', alignItems: 'center', gap: 20, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(13,148,136,0.4), transparent)' }} />
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 900, color: '#fff', flexShrink: 0 }}>
            {(user.full_name?.[0] || user.email[0]).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>{user.full_name || '—'}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>{user.email}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: 'rgba(13,148,136,0.15)', border: '1px solid rgba(13,148,136,0.3)', color: '#5eead4' }}>Pro Plan</span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', padding: '3px 10px' }}>Org #{user.organization_id}</span>
            </div>
          </div>
          <button onClick={logout} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)', color: '#f87171', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
            Çıkış Yap
          </button>
        </div>
      )}

      <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: 28, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.4), transparent)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>◎</div>
          <div>
            <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 15 }}>Aktif Sprint</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
              {sprint && selS ? selS.name : sprint ? sprint.split('\\').pop() : 'Sprint seçilmedi'}
            </div>
          </div>
          {sprint && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#22c55e' }}>Aktif</span>
          )}
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <ProfileSel label="Project" value={project} onChange={onProjectChange}
            options={projects.map((p) => ({ id: p.name, name: p.name }))}
            placeholder="Proje seç..." loading={false} disabled={false} />
          <ProfileSel label="Team" value={team} onChange={onTeamChange}
            options={teams.map((t) => ({ id: t.name, name: t.name }))}
            placeholder={project ? 'Takım seç...' : 'Önce proje seç'} loading={ltm} disabled={!project} />
          <ProfileSel label="Sprint" value={sprint} onChange={onSprintChange}
            options={sprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))}
            placeholder={team ? 'Sprint seç...' : 'Önce takım seç'} loading={lsp} disabled={!team} />
        </div>

        {err ? <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 20 }}>
          <button onClick={() => void save()} disabled={saving || !sprint}
            style={{ padding: '12px', borderRadius: 12, border: 'none', background: saved ? 'rgba(34,197,94,0.3)' : sprint ? 'linear-gradient(135deg, #7c3aed, #a78bfa)' : 'rgba(255,255,255,0.06)', color: sprint ? '#fff' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 13, cursor: sprint ? 'pointer' : 'not-allowed', transition: 'all 0.3s' }}>
            {saving ? 'Kaydediliyor…' : saved ? '✓ Kaydedildi' : 'Kaydet'}
          </button>
          <button onClick={() => router.push('/dashboard/sprints')} disabled={!sprint}
            style={{ padding: '12px', borderRadius: 12, border: '1px solid rgba(13,148,136,0.3)', background: 'rgba(13,148,136,0.08)', color: sprint ? '#5eead4' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 13, cursor: sprint ? 'pointer' : 'not-allowed' }}>
            Sprint Board →
          </button>
        </div>
      </div>

      <div style={{ borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Entegrasyon Ayarları</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>Azure PAT veya Jira token'ını güncelle</div>
        </div>
        <a href="/dashboard/integrations" style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
          Ayarlar →
        </a>
      </div>
    </div>
  );
}

function ProfileSel({ label, value, onChange, options, placeholder, loading, disabled }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Opt[]; placeholder: string; loading: boolean; disabled: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>
        {label} {loading ? <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>yükleniyor…</span> : null}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading}
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid ' + (value ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'), background: value ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.04)', color: value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', fontSize: 13, outline: 'none', appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}>
        <option value="" style={{ background: '#0d1117' }}>{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id} style={{ background: '#0d1117' }}>{o.name}</option>)}
      </select>
    </div>
  );
}
