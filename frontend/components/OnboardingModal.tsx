'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, savePrefs } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type Opt = { id: string; name: string; path?: string };

type Step = 'welcome' | 'provider' | 'config' | 'sprint' | 'done';

interface Props {
  userName?: string;
  onClose: () => void;
}

export default function OnboardingModal({ userName, onClose }: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<'azure' | 'jira' | null>(null);

  // Azure config
  const [azureUrl, setAzureUrl] = useState('');
  const [azurePat, setAzurePat] = useState('');

  // Jira config
  const [jiraUrl, setJiraUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  // Sprint selectors
  const [projects, setProjects] = useState<Opt[]>([]);
  const [teams, setTeams] = useState<Opt[]>([]);
  const [sprints, setSprints] = useState<Opt[]>([]);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [sprint, setSprint] = useState('');
  const [ltm, setLtm] = useState(false);
  const [lsp, setLsp] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Sprint selector cascades
  useEffect(() => {
    setTeam(''); setTeams([]); setSprint(''); setSprints([]);
    if (!project) return;
    setLtm(true);
    apiFetch<Opt[]>('/tasks/azure/teams?project=' + encodeURIComponent(project))
      .then(setTeams).catch(() => {}).finally(() => setLtm(false));
  }, [project]);

  useEffect(() => {
    setSprint(''); setSprints([]);
    if (!project || !team) return;
    setLsp(true);
    apiFetch<Opt[]>('/tasks/azure/sprints?project=' + encodeURIComponent(project) + '&team=' + encodeURIComponent(team))
      .then(setSprints).catch(() => {}).finally(() => setLsp(false));
  }, [project, team]);

  async function saveConfig() {
    setSaving(true); setErr('');
    try {
      if (provider === 'azure') {
        await apiFetch('/integrations/azure', {
          method: 'PUT',
          body: JSON.stringify({ base_url: azureUrl, secret: azurePat }),
        });
        // Projeleri yükle
        const projs = await apiFetch<Opt[]>('/tasks/azure/projects');
        setProjects(projs);
      } else {
        await apiFetch('/integrations/jira', {
          method: 'PUT',
          body: JSON.stringify({ base_url: jiraUrl, username: jiraEmail, secret: jiraToken }),
        });
      }
      setStep('sprint');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  }

  async function goToSprints() {
    if (sprint) {
      // localStorage'a da yaz (hızlı erişim için)
      localStorage.setItem('agena_sprint_project', project);
      localStorage.setItem('agena_sprint_team', team);
      localStorage.setItem('agena_sprint_path', sprint);
      // DB'ye kaydet ve bekle
      try {
        await savePrefs({ azure_project: project, azure_team: team, azure_sprint_path: sprint });
      } catch { /* localStorage'a yazıldı, devam et */ }
    }
    onClose();
    router.push('/dashboard/sprints');
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(12px)' }} onClick={step === 'welcome' ? onClose : undefined} />

      <div style={{ position: 'relative', width: '100%', maxWidth: 520, borderRadius: 28, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(8,14,30,0.98)', overflow: 'hidden', boxShadow: '0 40px 120px rgba(0,0,0,0.6)' }}>
        {/* Top gradient line */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, #0d9488, #7c3aed, #22c55e)' }} />

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, padding: '20px 28px 0' }}>
          {(['welcome','provider','config','sprint'] as Step[]).map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 99, background: ['welcome','provider','config','sprint','done'].indexOf(step) >= i ? 'linear-gradient(90deg, #0d9488, #22c55e)' : 'rgba(255,255,255,0.08)', transition: 'background 0.3s' }} />
          ))}
        </div>

        <div style={{ padding: '28px 32px 32px' }}>

          {step === 'welcome' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 52, marginBottom: 16 }}>👋</div>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginBottom: 10 }}>
                {t('onboarding.welcome')}{userName ? ', ' + userName.split(' ')[0] : ''}!
              </h2>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, marginBottom: 32 }}>
                {t('onboarding.welcomeDesc').split('\n').map((line, i) => (
                  <span key={i}>{line}{i === 0 && <br />}</span>
                ))}
              </p>
              <div style={{ display: 'grid', gap: 10 }}>
                <button onClick={() => setStep('provider')} style={{ padding: '14px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                  {t('onboarding.start')}
                </button>
                <button onClick={onClose} style={{ padding: '12px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.3)', fontSize: 13, cursor: 'pointer' }}>
                  {t('onboarding.skip')}
                </button>
              </div>
            </div>
          )}

          {step === 'provider' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>{t('onboarding.whichTool')}</h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>{t('onboarding.toolDesc')}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
                <ProviderCard
                  icon='🔷' title='Azure DevOps' desc={t('onboarding.azureEco')}
                  color='#60a5fa' selected={provider === 'azure'}
                  onClick={() => setProvider('azure')}
                />
                <ProviderCard
                  icon='🟦' title='Jira' desc={t('onboarding.jiraEco')}
                  color='#818cf8' selected={provider === 'jira'}
                  onClick={() => setProvider('jira')}
                />
              </div>
              <button onClick={() => provider && setStep('config')} disabled={!provider}
                style={{ width: '100%', padding: '13px', borderRadius: 12, border: 'none', background: provider ? 'linear-gradient(135deg, #0d9488, #22c55e)' : 'rgba(255,255,255,0.06)', color: provider ? '#fff' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 14, cursor: provider ? 'pointer' : 'not-allowed' }}>
                {t('onboarding.continue')}
              </button>
            </div>
          )}

          {step === 'config' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>
                {provider === 'azure' ? '🔷 Azure DevOps' : '🟦 Jira'}
              </h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>{t('onboarding.encrypted')}</p>

              {provider === 'azure' ? (
                <div style={{ display: 'grid', gap: 14 }}>
                  <ConfigInput label='Organization URL' value={azureUrl} onChange={setAzureUrl} placeholder='https://dev.azure.com/your-org' />
                  <ConfigInput label='Personal Access Token (PAT)' value={azurePat} onChange={setAzurePat} placeholder='Paste your PAT here' type='password' hint='Azure DevOps → User Settings → Personal Access Tokens' />
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                  <ConfigInput label='Jira URL' value={jiraUrl} onChange={setJiraUrl} placeholder='https://your-company.atlassian.net' />
                  <ConfigInput label='Email' value={jiraEmail} onChange={setJiraEmail} placeholder='you@company.com' />
                  <ConfigInput label='API Token' value={jiraToken} onChange={setJiraToken} placeholder='Paste your API token' type='password' hint='Atlassian Account → Security → API Tokens' />
                </div>
              )}

              {err ? <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 13 }}>{err}</div> : null}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 24 }}>
                <button onClick={() => setStep('provider')} style={{ padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>{t('onboarding.back')}</button>
                <button onClick={() => void saveConfig()} disabled={saving}
                  style={{ padding: '13px', borderRadius: 12, border: 'none', background: saving ? 'rgba(13,148,136,0.4)' : 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  {saving ? t('onboarding.connecting') : t('onboarding.connect')}
                </button>
              </div>
            </div>
          )}

          {step === 'sprint' && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: 'rgba(255,255,255,0.95)', marginBottom: 8 }}>{t('onboarding.selectSprint')}</h2>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 24 }}>{t('onboarding.selectSprintDesc')}</p>

              {provider === 'azure' ? (
                <div style={{ display: 'grid', gap: 14 }}>
                  <OnboardSel label='Project' value={project} onChange={setProject}
                    options={projects.map((p) => ({ id: p.name, name: p.name }))} placeholder={t('onboarding.selectProject')} loading={false} />
                  <OnboardSel label='Team' value={team} onChange={setTeam}
                    options={teams.map((t2) => ({ id: t2.name, name: t2.name }))} placeholder={project ? t('onboarding.selectTeam') : t('onboarding.selectTeamFirst')} loading={ltm} disabled={!project} />
                  <OnboardSel label='Sprint' value={sprint} onChange={setSprint}
                    options={sprints.map((s) => ({ id: s.path ?? s.name, name: s.name }))} placeholder={team ? t('onboarding.selectSprint2') : t('onboarding.selectSprintFirst')} loading={lsp} disabled={!team} />
                </div>
              ) : (
                <div style={{ padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                  {t('onboarding.jiraComingSoon')}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 24 }}>
                <button onClick={() => setStep('config')} style={{ padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 13, cursor: 'pointer' }}>{t('onboarding.back')}</button>
                <button onClick={() => void goToSprints()}
                  style={{ padding: '13px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #0d9488, #22c55e)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  {sprint ? t('onboarding.goBoard') : t('onboarding.skipSprint')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function ProviderCard({ icon, title, desc, color, selected, onClick }: {
  icon: string; title: string; desc: string; color: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{ padding: '20px 16px', borderRadius: 16, border: '2px solid ' + (selected ? color + '60' : 'rgba(255,255,255,0.08)'), background: selected ? color + '10' : 'rgba(255,255,255,0.02)', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', position: 'relative' }}>
      {selected && <div style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 800 }}>✓</div>}
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{desc}</div>
    </button>
  );
}

function ConfigInput({ label, value, onChange, placeholder, type = 'text', hint }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; hint?: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.9)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(13,148,136,0.5)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      />
      {hint ? <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 5 }}>{hint}</p> : null}
    </div>
  );
}

function OnboardSel({ label, value, onChange, options, placeholder, loading, disabled }: {
  label: string; value: string; onChange: (v: string) => void; options: Opt[]; placeholder: string; loading: boolean; disabled?: boolean;
}) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', display: 'block', marginBottom: 6 }}>
        {label} {loading ? <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400 }}>loading…</span> : null}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || loading}
        style={{ width: '100%', padding: '11px 14px', borderRadius: 10, border: '1px solid ' + (value ? 'rgba(13,148,136,0.4)' : 'rgba(255,255,255,0.1)'), background: value ? 'rgba(13,148,136,0.08)' : 'rgba(255,255,255,0.04)', color: value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)', fontSize: 13, outline: 'none', appearance: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}>
        <option value="" style={{ background: '#0d1117' }}>{placeholder}</option>
        {options.map((o) => <option key={o.id} value={o.id} style={{ background: '#0d1117' }}>{o.name}</option>)}
      </select>
    </div>
  );
}
