'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';
import NavIcon from '@/components/NavIcon';
import MappingHub from '@/components/integrations/MappingHub';

interface NREntity {
  guid: string;
  name: string;
  entity_type: string;
  domain: string;
  account_id: number;
  reporting: boolean;
}

interface NRErrorGroup {
  error_class: string;
  error_message: string;
  occurrences: number;
  last_seen: string | null;
  fingerprint: string;
  imported_task_id?: number | null;
  imported_work_item_url?: string | null;
}

interface NRMapping {
  id: number;
  entity_guid: string;
  entity_name: string;
  entity_type: string;
  account_id: number;
  repo_mapping_id: number | null;
  repo_display_name: string | null;
  flow_id: string | null;
  auto_import: boolean;
  import_interval_minutes: number;
  last_import_at: string | null;
  is_active: boolean;
}

interface RepoMapping {
  id: number;
  provider: string;
  owner: string;
  repo_name: string;
}

function Pill({ children, color = 'var(--muted)', bg }: { children: React.ReactNode; color?: string; bg?: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 4,
      color, background: bg ?? `${color}1f`,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

export default function NewRelicPage() {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entities, setEntities] = useState<NREntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [selectedGuid, setSelectedGuid] = useState('');
  const [errors, setErrors] = useState<NRErrorGroup[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [selectedEntityName, setSelectedEntityName] = useState('');

  const [mappings, setMappings] = useState<NRMapping[]>([]);
  const [repos, setRepos] = useState<RepoMapping[]>([]);

  const [modalMapping, setModalMapping] = useState<NRMapping | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalErrors, setModalErrors] = useState<NRErrorGroup[]>([]);
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set());
  const [modalImporting, setModalImporting] = useState(false);
  const [modalSince, setModalSince] = useState('30 minutes ago');
  const [modalMirror, setModalMirror] = useState<'auto' | 'azure' | 'jira' | 'both' | 'none'>('auto');
  const [modalStoryPoints, setModalStoryPoints] = useState<number>(2);
  const [modalSprintPath, setModalSprintPath] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmImportAll, setConfirmImportAll] = useState(false);
  const [sprintOptions, setSprintOptions] = useState<Array<{ path: string; name: string; is_current?: boolean }>>([]);

  const [runningGuid, setRunningGuid] = useState<string | null>(null);
  const [rowResult, setRowResult] = useState<Record<string, { kind: 'ok' | 'err'; text: string; ts: number }>>({});
  const [entityFilter, setEntityFilter] = useState('');
  const [mapFilter, setMapFilter] = useState<'all' | 'mapped' | 'unmapped'>('all');

  useEffect(() => {
    void loadMappings();
    void loadRepos();
    // Auto-load entities so landing isn't an empty form.
    void searchEntities();
  }, []);

  useEffect(() => {
    if (msg) {
      const t = setTimeout(() => setMsg(''), 3000);
      return () => clearTimeout(t);
    }
  }, [msg]);

  async function loadMappings() {
    try {
      const data = await apiFetch<NRMapping[]>('/newrelic/mappings');
      setMappings(data);
    } catch { /* ignore if not configured */ }
  }

  async function loadRepos() {
    try {
      const data = await apiFetch<RepoMapping[]>('/repo-mappings');
      setRepos(data);
    } catch { /* ignore */ }
  }

  async function searchEntities() {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (entityType) params.set('entity_type', entityType);
      const data = await apiFetch<NREntity[]>(`/newrelic/entities?${params}`);
      setEntities(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch entities');
    } finally {
      setLoading(false);
    }
  }

  async function fetchErrors(guid: string, entityName: string) {
    setSelectedGuid(guid);
    setSelectedEntityName(entityName);
    setErrorsLoading(true);
    try {
      const data = await apiFetch<{ errors: NRErrorGroup[] }>(`/newrelic/entities/${guid}/errors`);
      setErrors(data.errors || []);
    } catch {
      setErrors([]);
    } finally {
      setErrorsLoading(false);
    }
  }

  async function addMapping(entity: NREntity) {
    try {
      await apiFetch('/newrelic/mappings', {
        method: 'POST',
        body: JSON.stringify({
          entity_guid: entity.guid,
          entity_name: entity.name,
          entity_type: entity.entity_type,
          account_id: entity.account_id,
        }),
      });
      setMsg((t('integrations.newrelic.mapped') || '"{name}" mapped — select a repo').replace('{name}', entity.name));
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add mapping');
    }
  }

  // One-step map: create the mapping already linked to a repo (the backend
  // accepts repo_mapping_id on create), so the user picks a repo directly on
  // an unmapped entity instead of "Map" then "select repo".
  async function mapEntityToRepo(entity: NREntity, repoId: number) {
    try {
      await apiFetch('/newrelic/mappings', {
        method: 'POST',
        body: JSON.stringify({
          entity_guid: entity.guid,
          entity_name: entity.name,
          entity_type: entity.entity_type,
          account_id: entity.account_id,
          repo_mapping_id: repoId,
        }),
      });
      setMsg((t('integrations.newrelic.mapped') || '"{name}" mapped').replace('{name}', entity.name));
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add mapping');
    }
  }

  async function updateMapping(id: number, updates: Record<string, unknown>) {
    try {
      await apiFetch(`/newrelic/mappings/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update mapping');
    }
  }

  async function deleteMapping(id: number) {
    try {
      await apiFetch(`/newrelic/mappings/${id}`, { method: 'DELETE' });
      await loadMappings();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete mapping');
    }
  }

  async function importErrors(entityGuid?: string) {
    setError('');
    setMsg('');
    const rowKey = entityGuid || '__all__';
    setRunningGuid(rowKey);
    try {
      const body: Record<string, unknown> = {};
      if (entityGuid) body.entity_guid = entityGuid;
      const res = await apiFetch<{ imported: number; skipped: number; manual_azure_urls?: string[] }>('/tasks/import/newrelic', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      (res.manual_azure_urls || []).forEach((url) => {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      });
      let summary = '';
      if (res.imported === 0 && res.skipped > 0) {
        summary = (t('integrations.sentry.allAlreadyImported') || 'All {n} already imported').replace('{n}', String(res.skipped));
      } else if (res.imported > 0 && res.skipped > 0) {
        summary = (t('integrations.sentry.importedSomeSkipped') || '+{i} imported, {s} skipped').replace('{i}', String(res.imported)).replace('{s}', String(res.skipped));
      } else if (res.imported > 0) {
        summary = (t('integrations.sentry.importedN') || '+{n} imported').replace('{n}', String(res.imported));
      } else {
        summary = t('integrations.sentry.noNewIssues') || 'No new issues';
      }
      setMsg(summary);
      setRowResult((prev) => ({ ...prev, [rowKey]: { kind: 'ok', text: summary, ts: Date.now() } }));
      void loadMappings();
    } catch (e) {
      const errText = e instanceof Error ? e.message : 'Import failed';
      setError(errText);
      setRowResult((prev) => ({ ...prev, [rowKey]: { kind: 'err', text: errText, ts: Date.now() } }));
    } finally {
      setRunningGuid(null);
      setTimeout(() => {
        setRowResult((prev) => {
          if (!prev[rowKey] || Date.now() - prev[rowKey].ts < 5800) return prev;
          const next = { ...prev };
          delete next[rowKey];
          return next;
        });
      }, 6000);
    }
  }

  async function openRequestModal(mapping: NRMapping) {
    setError('');
    setMsg('');
    setModalMapping(mapping);
    setModalErrors([]);
    setModalSelected(new Set());
    setModalSince('30 minutes ago');
    await fetchModalErrors(mapping, '30 minutes ago');
  }

  async function fetchModalErrors(mapping: NRMapping, since: string) {
    setModalLoading(true);
    try {
      const params = new URLSearchParams({ since });
      const data = await apiFetch<{ errors: NRErrorGroup[] }>(`/newrelic/entities/${mapping.entity_guid}/errors?${params}`);
      setModalErrors(data.errors || []);
      setModalSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch errors');
    } finally {
      setModalLoading(false);
    }
  }

  function closeRequestModal() {
    setModalMapping(null);
    setModalErrors([]);
    setModalSelected(new Set());
  }

  function toggleModalSelected(fp: string) {
    setModalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  }

  function modalSelectAll() {
    setModalSelected(new Set(modalErrors.filter((e) => !e.imported_task_id).map((e) => e.fingerprint)));
  }

  function modalDeselectAll() {
    setModalSelected(new Set());
  }

  async function importModalSelected() {
    if (!modalMapping || modalSelected.size === 0) return;
    setModalImporting(true);
    try {
      const res = await apiFetch<{ imported: number; skipped: number; manual_azure_urls?: string[] }>('/tasks/import/newrelic', {
        method: 'POST',
        body: JSON.stringify({
          entity_guid: modalMapping.entity_guid,
          fingerprints: Array.from(modalSelected),
          since: modalSince,
          mirror_target: modalMirror,
          story_points: modalStoryPoints,
          iteration_path: modalSprintPath || null,
        }),
      });
      (res.manual_azure_urls || []).forEach((url) => {
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
      });
      const msgTpl = t('integrations.newrelic.importResult') || '{imported} imported, {skipped} skipped';
      setMsg(msgTpl.replace('{imported}', String(res.imported)).replace('{skipped}', String(res.skipped)));
      setConfirmOpen(false);
      closeRequestModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setModalImporting(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)',
    background: 'var(--panel-alt)', color: 'var(--ink)', fontSize: 13,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--acc)', color: '#fff',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };
  const btnSmall: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };

  const totalMappings = mappings.length;
  const autoMappings = mappings.filter((m) => m.auto_import).length;
  const repoMappingsCount = mappings.filter((m) => m.repo_mapping_id != null).length;

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
      <style>{`
        .nr-row-card {
          display: flex !important;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .nr-row-card > .nr-row-icon { flex: 0 0 auto; }
        .nr-row-card > .nr-row-title { flex: 1 1 180px; min-width: 0; }
        .nr-row-card > .nr-row-actions { flex: 0 0 auto; margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; justify-content: flex-end; }
        @media (max-width: 700px) {
          .nr-row-card > .nr-row-actions { flex: 1 1 100% !important; margin-left: 0 !important; padding-top: 8px; margin-top: 2px; border-top: 1px dashed var(--panel-border); justify-content: flex-start !important; }
          .nr-row-actions select { flex: 1 1 auto; min-width: 0; max-width: 220px; }
        }
        .nr-icon-btn { width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; padding: 0 !important; font-size: 13px !important; }
        @keyframes nr-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* Hero header */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--panel-border)',
        background: 'var(--surface)',
        padding: '20px 22px',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'var(--panel-border)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--acc-soft)', border: '1px solid var(--panel-border)',
            color: 'var(--acc)',
          }}><NavIcon name="signal" size={22} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink-90)', letterSpacing: -0.3 }}>
              {t('integrations.providerNewrelic')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-58)', marginTop: 3, lineHeight: 1.5 }}>
              {t('integrations.newrelic.heroSubtitle') || 'Auto-import APM errors from your New Relic entities, route them to the right repo, let AI fix and ship the patch.'}
            </div>
          </div>
        </div>
        {totalMappings > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: t('integrations.sentry.statMapped') || 'Mapped projects', value: totalMappings, color: 'var(--ink-90)' },
              { label: t('integrations.sentry.statWithRepo') || 'Linked to a repo', value: `${repoMappingsCount}/${totalMappings}`, color: 'var(--acc)' },
              { label: t('integrations.sentry.statAuto') || 'Auto-import on', value: autoMappings, color: 'var(--acc)' },
            ].map((tile) => (
              <div key={tile.label} style={{
                flex: 1, minWidth: 130,
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>{tile.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: tile.color, marginTop: 4 }}>{tile.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Floating toast */}
      {(runningGuid || msg || error) && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: '50%', bottom: 28, transform: 'translateX(-50%)',
          zIndex: 9999, maxWidth: 'min(94vw, 460px)',
          padding: '12px 18px', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 700,
          color: error ? '#cf5b57' : runningGuid ? '#c98a2b' : '#3f9d6a',
          background: 'var(--surface)',
          border: `1px solid ${error ? '#cf5b57' : runningGuid ? '#c98a2b' : '#3f9d6a'}`,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
        }}>
          {runningGuid ? (
            <>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid var(--panel-border)', borderTopColor: '#c98a2b', borderRadius: '50%', animation: 'nr-spin 0.7s linear infinite' }} />
              <span>{t('integrations.sentry.toastImporting') || 'Importing…'}</span>
            </>
          ) : error ? (
            <>
              <NavIcon name="alert" size={16} />
              <span style={{ flex: 1 }}>{error}</span>
              <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: '#cf5b57', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          ) : (
            <>
              <NavIcon name="signal" size={16} />
              <span style={{ flex: 1 }}>{msg}</span>
              <button onClick={() => setMsg('')} style={{ background: 'transparent', border: 'none', color: '#3f9d6a', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Search */}
      <div style={cardStyle}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', marginBottom: 8 }}>
          {t('integrations.newrelic.findEntityLabel') || 'Find an entity to map'}
        </div>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('integrations.newrelic.entityBrowser')}
            style={{ ...inputStyle, flex: 1, minWidth: 200, height: 38 }} onKeyDown={(e) => e.key === 'Enter' && searchEntities()} />
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ ...inputStyle, width: 180, height: 38 }}>
            <option value="">{t('integrations.common.allTypes')}</option>
            <option value="APPLICATION">{t('integrations.newrelic.typeApm')}</option>
            <option value="BROWSER_APPLICATION">{t('integrations.newrelic.typeBrowser')}</option>
            <option value="MOBILE_APPLICATION">{t('integrations.newrelic.typeMobile')}</option>
            <option value="HOST">{t('integrations.newrelic.typeHost')}</option>
            <option value="MONITOR">{t('integrations.newrelic.typeMonitor')}</option>
          </select>
          <button onClick={() => void searchEntities()} disabled={loading} style={{ ...btnPrimary, padding: '10px 18px' }}>
            {loading ? '…' : t('integrations.common.search')}
          </button>
        </div>
      </div>

      {/* Entity → repo mapping (shared guided MappingHub) */}
      <MappingHub
        title='New Relic'
        logo={<NavIcon name='signal' size={15} />}
        loading={loading}
        hint={t('integrations.newrelic.heroSubtitle') || 'Map an entity to a repo so AI can auto-fix its production errors and ship the patch.'}
        searchPlaceholder={t('integrations.newrelic.searchPlaceholderN').replace('{n}', String(entities.length))}
        onboardingSteps={[
          t('integrations.newrelic.onboardingStep1'),
          t('integrations.newrelic.onboardingStep2'),
          t('integrations.newrelic.onboardingStep3'),
        ]}
        repos={repos.map((r) => ({ id: r.id, label: `${r.owner}/${r.repo_name}` }))}
        items={entities.map((e) => {
          const m = mappings.find((mm) => mm.entity_guid === e.guid);
          return {
            id: e.guid,
            name: e.name,
            sublabel: `${e.entity_type.replace('_APPLICATION', '').replace('_ENTITY', '')} · ${e.reporting ? 'live' : 'inactive'}`,
            live: e.reporting,
            mappedRepoId: m?.repo_mapping_id ?? null,
            autoImport: m?.auto_import,
          };
        })}
        onMapRepo={(item, repoId) => {
          const e = entities.find((x) => x.guid === item.id);
          const m = mappings.find((mm) => mm.entity_guid === item.id);
          if (m) void updateMapping(m.id, { repo_mapping_id: repoId });
          else if (e && repoId != null) void mapEntityToRepo(e, repoId);
        }}
        onToggleAuto={(item) => {
          const m = mappings.find((mm) => mm.entity_guid === item.id);
          if (m) void updateMapping(m.id, { auto_import: !m.auto_import });
        }}
        renderActions={(item) => {
          const m = mappings.find((mm) => mm.entity_guid === item.id);
          return (
            <>
              <button onClick={() => void fetchErrors(item.id, item.name)} title={t('integrations.newrelic.errorsBtn')} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><NavIcon name='bug' size={13} /></button>
              {m && (
                <button onClick={() => void importErrors(m.entity_guid)} disabled={runningGuid === m.entity_guid} title={t('integrations.common.import')} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: runningGuid === m.entity_guid ? 0.6 : 1 }}>{runningGuid === m.entity_guid ? '…' : <NavIcon name='send' size={13} />}</button>
              )}
              {m && (
                <button onClick={() => void deleteMapping(m.id)} title={t('integrations.common.unmap') || 'Unmap'} style={{ ...btnSmall, height: 32, width: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cf5b57', borderColor: 'var(--panel-border)' }}><NavIcon name='close' size={13} /></button>
              )}
              {rowResult[item.id] && (
                <span style={{ fontSize: 10, fontWeight: 700, color: rowResult[item.id].kind === 'ok' ? '#3f9d6a' : '#cf5b57', whiteSpace: 'nowrap' }}>{rowResult[item.id].text}</span>
              )}
            </>
          );
        }}
      />

      {/* Error groups */}
      {selectedGuid && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)' }}>
                {t('integrations.newrelic.errorsFor').replace('{name}', selectedEntityName)}
              </div>
              {!errorsLoading && errors.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 3 }}>
                  {errors.length} {t('integrations.newrelic.errors') || 'error groups'}
                  {' · '}
                  <strong style={{ color: '#cf5b57' }}>{errors.reduce((s, e) => s + (e.occurrences || 0), 0).toLocaleString()}</strong>{' '}
                  {(t('integrations.sentry.healthEvents') || 'events').toLowerCase()}
                </div>
              )}
            </div>
            <button onClick={() => void importErrors(selectedGuid)} disabled={runningGuid === selectedGuid} style={{ ...btnPrimary, opacity: runningGuid === selectedGuid ? 0.6 : 1 }}>
              {runningGuid === selectedGuid ? '…' : t('integrations.common.importAsTasks')}
            </button>
          </div>
          {errorsLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : errors.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noErrors')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {errors.map((e, i) => (
                <div key={i} style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
                }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                    <Pill color='#cf5b57'>{e.occurrences.toLocaleString()}× ERR</Pill>
                    {e.imported_task_id && (
                      <a href={`/tasks/${e.imported_task_id}`} style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}>
                        TASK #{e.imported_task_id}
                      </a>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.error_class}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.error_message}
                  </div>
                  {e.last_seen && (
                    <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 4 }}>
                      {(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(Number(e.last_seen)).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mappings — premium cards */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--ink-35)', margin: 0 }}>
            {t('integrations.newrelic.entityMappings')}
          </h3>
          {mappings.length > 0 && (
            <button onClick={() => setConfirmImportAll(true)} disabled={runningGuid === '__all__'} style={{ ...btnPrimary, opacity: runningGuid === '__all__' ? 0.6 : 1 }}>
              {runningGuid === '__all__' ? '…' : t('integrations.common.importAll')}
            </button>
          )}
        </div>

        {confirmImportAll && typeof document !== 'undefined' && createPortal(
          <div onClick={() => setConfirmImportAll(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 20, width: 'min(460px, calc(100vw - 24px))', boxShadow: '0 20px 48px rgba(0,0,0,0.22)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-90)', marginBottom: 8 }}>{t('integrations.newrelic.importAllConfirmTitle')}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-58)', lineHeight: 1.55, marginBottom: 16 }}>
                {t('integrations.newrelic.importAllConfirmBody').replace('{n}', String(totalMappings))}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setConfirmImportAll(false)} style={btnSmall}>{t('integrations.common.cancel')}</button>
                <button onClick={() => { setConfirmImportAll(false); void importErrors(); }} style={btnPrimary}>{t('integrations.newrelic.importAllConfirmCta')}</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
        {mappings.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', borderRadius: 8, background: 'var(--panel-alt)', border: '1px dashed var(--panel-border)' }}>
            <div style={{ marginBottom: 6, color: 'var(--ink-35)', display: 'flex', justifyContent: 'center' }}><NavIcon name="signal" size={28} /></div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-90)' }}>
              {t('integrations.newrelic.noMappingsTitle') || 'No entity mappings yet'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-50)', marginTop: 4, lineHeight: 1.5, maxWidth: 380, margin: '4px auto 0' }}>
              {t('integrations.common.noMappingsHint')}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {mappings.map((m) => {
              const lastImport = m.last_import_at ? new Date(m.last_import_at) : null;
              const lastImportRel = lastImport ? (() => {
                const diffMs = Date.now() - lastImport.getTime();
                const mins = Math.floor(diffMs / 60000);
                if (mins < 1) return t('integrations.sentry.justNow') || 'just now';
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                const days = Math.floor(hrs / 24);
                return `${days}d ago`;
              })() : null;
              const nextRunRel = m.auto_import && lastImport ? (() => {
                const nextDue = lastImport.getTime() + m.import_interval_minutes * 60000;
                const diffMs = nextDue - Date.now();
                if (diffMs <= 0) return t('integrations.sentry.dueNow') || 'due now';
                const mins = Math.ceil(diffMs / 60000);
                if (mins < 60) return (t('integrations.sentry.nextInM') || 'next in {n}m').replace('{n}', String(mins));
                const hrs = Math.ceil(mins / 60);
                return (t('integrations.sentry.nextInH') || 'next in {n}h').replace('{n}', String(hrs));
              })() : null;
              return (
                <div key={m.id} className='nr-row-card' style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'var(--panel-alt)', border: '1px solid var(--panel-border)',
                }}>
                  <div className='nr-row-icon' style={{
                    width: 36, height: 36, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--acc-soft)',
                    border: '1px solid var(--panel-border)',
                    color: 'var(--acc)',
                  }}>
                    <NavIcon name={m.auto_import ? 'zap' : 'plug'} size={16} />
                  </div>
                  <div className='nr-row-title'>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)' }}>{m.entity_name}</span>
                      {m.repo_display_name ? (
                        <span style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 600 }}>→ {m.repo_display_name}</span>
                      ) : (
                        <Pill color='#c98a2b'>{(t('integrations.sentry.noRepoLinked') || 'no repo linked').toUpperCase()}</Pill>
                      )}
                      {m.auto_import && <Pill color='var(--acc)'>AUTO</Pill>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-35)', marginTop: 3, fontFamily: 'monospace' }}>
                      {m.entity_type.replace('_ENTITY', '').replace('_APPLICATION', '')}
                      {lastImportRel && <span style={{ color: 'var(--ink-50)', fontFamily: 'inherit', marginLeft: 8 }}>· {(t('integrations.sentry.lastImport') || 'Last import')}: {lastImportRel}</span>}
                      {nextRunRel && <span style={{ color: 'var(--acc)', fontFamily: 'inherit', marginLeft: 8 }}>· {nextRunRel}</span>}
                    </div>
                  </div>
                  <div className='nr-row-actions'>
                    <select
                      value={m.repo_mapping_id ?? ''}
                      onChange={(e) => void updateMapping(m.id, { repo_mapping_id: e.target.value ? parseInt(e.target.value) : null })}
                      style={{ ...inputStyle, width: 150, fontSize: 11, height: 30 }}
                    >
                      <option value="">{t('integrations.common.noRepo') || 'No repo'}</option>
                      {repos.map((r) => (
                        <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                      ))}
                    </select>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      color: m.auto_import ? 'var(--acc)' : 'var(--ink-50)',
                      padding: '6px 10px', borderRadius: 6,
                      background: m.auto_import ? 'var(--acc-soft)' : 'transparent',
                      border: `1px solid ${m.auto_import ? 'var(--acc)' : 'var(--panel-border)'}`,
                    }}>
                      <input type='checkbox' checked={m.auto_import} onChange={(e) => void updateMapping(m.id, { auto_import: e.target.checked })} style={{ margin: 0 }} />
                      {t('integrations.common.auto').toUpperCase()}
                    </label>
                    <button onClick={() => void importErrors(m.entity_guid)} disabled={runningGuid === m.entity_guid}
                      title={t('integrations.sentry.runNow') || 'Run now'} className='nr-icon-btn' style={{ ...btnSmall, color: 'var(--acc)', borderColor: 'var(--acc)', opacity: runningGuid === m.entity_guid ? 0.6 : 1 }}>
                      {runningGuid === m.entity_guid ? '…' : <NavIcon name="activity" size={14} />}
                    </button>
                    {rowResult[m.entity_guid] && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6,
                        color: rowResult[m.entity_guid].kind === 'ok' ? '#3f9d6a' : '#cf5b57',
                        background: 'var(--panel-alt)',
                        whiteSpace: 'nowrap',
                      }}>{rowResult[m.entity_guid].text}</span>
                    )}
                    <button onClick={() => void openRequestModal(m)} style={{ ...btnSmall, height: 30 }}>
                      {t('integrations.newrelic.request') || 'Request'}
                    </button>
                    <button onClick={() => void deleteMapping(m.id)} title={t('integrations.common.unmap') || 'Unmap'} className='nr-icon-btn' style={{ ...btnSmall, color: '#cf5b57', borderColor: 'var(--panel-border)' }}><NavIcon name="close" size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modalMapping && typeof document !== 'undefined' && createPortal(
        <div
          onClick={closeRequestModal}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
          }}
        >
          <div
            onClick={(ev) => ev.stopPropagation()}
            style={{
              position: 'fixed',
              top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10,
              width: 'min(760px, calc(100vw - 32px))',
              maxWidth: 'calc(100vw - 32px)',
              height: 'min(80vh, 720px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.18)', color: 'var(--ink)',
              boxSizing: 'border-box',
            }}
          >
            {/* Header */}
            <div style={{ flex: '0 0 auto', padding: '14px 18px', borderBottom: '1px solid var(--panel-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {modalMapping.entity_name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-35)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {modalLoading
                    ? (t('integrations.newrelic.fetchingAll') || 'Fetching errors...')
                    : `${modalErrors.length} ${t('integrations.newrelic.errors') || 'errors'}`}
                  {modalSelected.size > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--acc)', fontWeight: 600 }}>
                      · {(t('integrations.newrelic.selectedCount') || '{n} selected').replace('{n}', String(modalSelected.size))}
                    </span>
                  )}
                </div>
              </div>
              <select
                value={modalSince}
                onChange={(ev) => {
                  setModalSince(ev.target.value);
                  if (modalMapping) void fetchModalErrors(modalMapping, ev.target.value);
                }}
                disabled={modalLoading}
                style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11, flex: '0 0 auto' }}
              >
                <option value='30 minutes ago'>{t('integrations.newrelic.range30m') || 'Last 30 min'}</option>
                <option value='1 hour ago'>{t('integrations.newrelic.range1h') || 'Last 1 hour'}</option>
                <option value='3 hours ago'>{t('integrations.newrelic.range3h') || 'Last 3 hours'}</option>
                <option value='24 hours ago'>{t('integrations.newrelic.range24h') || 'Last 24 hours'}</option>
                <option value='7 days ago'>{t('integrations.newrelic.range7d') || 'Last 7 days'}</option>
              </select>
              <button onClick={closeRequestModal} aria-label="Close" style={{ ...btnSmall, fontSize: 16, padding: '2px 10px', flex: '0 0 auto' }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: 14, display: 'block' }}>
              {modalLoading ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-35)' }}>
                  {t('integrations.newrelic.fetchingAll') || 'Fetching errors...'}
                </div>
              ) : modalErrors.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--ink-35)' }}>
                  {t('integrations.newrelic.noErrorsAll') || 'No errors found'}
                </div>
              ) : (
                modalErrors.map((e) => {
                  const isSelected = modalSelected.has(e.fingerprint);
                  const isImported = Boolean(e.imported_task_id);
                  const title = `${e.error_class}: ${e.error_message}`;
                  return (
                    <label
                      key={e.fingerprint}
                      style={{
                        display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: 10,
                        alignItems: 'start',
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px', borderRadius: 8, marginBottom: 6,
                        background: isSelected ? 'var(--acc-soft)' : 'var(--panel-alt)',
                        border: `1px solid ${isSelected ? 'var(--acc)' : 'var(--panel-border)'}`,
                        cursor: isImported ? 'not-allowed' : 'pointer',
                        opacity: isImported ? 0.55 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => !isImported && toggleModalSelected(e.fingerprint)}
                        disabled={isImported}
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-90)', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                          {title}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-35)', flexWrap: 'wrap' }}>
                          {isImported && (
                            <a
                              href={`/tasks/${e.imported_task_id}`}
                              onClick={(ev) => ev.stopPropagation()}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}
                            >
                              {(t('integrations.common.alreadyImported') || 'Already imported — task #{id}').replace('{id}', String(e.imported_task_id))}
                            </a>
                          )}
                          {isImported && e.imported_work_item_url && (
                            <a
                              href={e.imported_work_item_url}
                              target='_blank'
                              rel='noreferrer'
                              onClick={(ev) => ev.stopPropagation()}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--acc-soft)', color: 'var(--acc)', textDecoration: 'none' }}
                            >
                              {t('integrations.common.viewWorkItem') || 'Open work item'} ↗
                            </a>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6, background: 'var(--panel-alt)', color: '#cf5b57' }}>
                            {(t('integrations.common.countX') || '{n} times').replace('{n}', e.occurrences.toLocaleString())}
                          </span>
                          {e.last_seen && (
                            <span>
                              {(t('integrations.common.lastSeen') || 'Last seen')}: {new Date(Number(e.last_seen)).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div style={{ flex: '0 0 auto', padding: '12px 18px', borderTop: '1px solid var(--panel-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={modalSelectAll} disabled={modalErrors.length === 0} style={btnSmall}>
                {t('integrations.newrelic.selectAll') || 'Select all'}
              </button>
              <button onClick={modalDeselectAll} disabled={modalSelected.size === 0} style={btnSmall}>
                {t('integrations.newrelic.deselectAll') || 'Deselect all'}
              </button>
              <label style={{ fontSize: 11, color: 'var(--ink-50)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('integrations.newrelic.mirrorTargetLabel') || 'Open in'}:
                <select
                  value={modalMirror}
                  onChange={(ev) => setModalMirror(ev.target.value as 'auto' | 'azure' | 'jira' | 'both' | 'none')}
                  style={{ ...inputStyle, width: 'auto', padding: '4px 8px', fontSize: 11 }}
                >
                  <option value='auto'>{t('integrations.newrelic.mirrorAuto') || 'Auto'}</option>
                  <option value='azure'>{t('integrations.newrelic.mirrorAzure') || 'Azure DevOps'}</option>
                  <option value='jira'>{t('integrations.newrelic.mirrorJira') || 'Jira'}</option>
                  <option value='both'>{t('integrations.newrelic.mirrorBoth') || 'Azure + Jira'}</option>
                  <option value='none'>{t('integrations.newrelic.mirrorNone') || 'None'}</option>
                </select>
              </label>
              <div style={{ flex: 1 }} />
              <button onClick={closeRequestModal} style={btnSmall}>{t('integrations.common.cancel')}</button>
              <button
                onClick={async () => {
                  if (modalMirror === 'none') {
                    void importModalSelected();
                    return;
                  }
                  setModalStoryPoints(2);
                  setModalSprintPath('');
                  setConfirmOpen(true);
                  try {
                    const prefs = await apiFetch<{ azure_project?: string | null; azure_team?: string | null; azure_sprint_path?: string | null }>('/preferences');
                    const proj = (prefs?.azure_project || '').trim();
                    const team = (prefs?.azure_team || '').trim();
                    if (proj && team) {
                      const params = new URLSearchParams({ project: proj, team });
                      const sprints = await apiFetch<Array<{ path: string; name: string; is_current?: boolean }>>(`/tasks/azure/sprints?${params}`);
                      setSprintOptions(sprints || []);
                      const current = (sprints || []).find((s) => s.is_current);
                      if (current && !modalSprintPath) setModalSprintPath(current.path);
                      else if ((prefs?.azure_sprint_path || '').trim() && !modalSprintPath) setModalSprintPath(String(prefs.azure_sprint_path));
                    }
                  } catch { /* ignore */ }
                }}
                disabled={modalSelected.size === 0 || modalImporting}
                style={{ ...btnPrimary, opacity: modalSelected.size === 0 || modalImporting ? 0.5 : 1 }}
              >
                {modalImporting ? '...' : (t('integrations.newrelic.importSelected') || 'Import selected')}
              </button>
            </div>

            {confirmOpen && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20, borderRadius: 10,
              }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 10, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.18)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-90)', marginBottom: 8 }}>
                    {t('integrations.common.confirmImportTitle') || 'Onayla ve oluştur'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-58)', marginBottom: 12 }}>
                    {(t('integrations.common.confirmImportBody') || '{n} iş Agena’ya alınacak ve {target} üzerinde work item olarak açılacak.')
                      .replace('{n}', String(modalSelected.size))
                      .replace('{target}', modalMirror === 'none' ? 'hiçbir yer' : modalMirror)}
                  </div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
                    {t('integrations.common.storyPointsLabel') || 'Story Points'}
                  </label>
                  <input
                    type='number' min={0} step={1}
                    value={modalStoryPoints}
                    onChange={(ev) => setModalStoryPoints(parseInt(ev.target.value) || 0)}
                    style={{ ...inputStyle, marginBottom: 10 }}
                  />
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--ink-50)', marginBottom: 4 }}>
                    {t('integrations.common.iterationPathLabel') || 'Sprint (override, boş = aktif)'}
                  </label>
                  <select
                    value={modalSprintPath}
                    onChange={(ev) => setModalSprintPath(ev.target.value)}
                    style={{ ...inputStyle, marginBottom: 14 }}
                  >
                    <option value=''>{t('integrations.common.currentSprintAuto') || 'Aktif sprint (otomatik)'}</option>
                    {sprintOptions.map((s) => (
                      <option key={s.path} value={s.path}>
                        {s.name}{s.is_current ? ' • ' + (t('integrations.common.currentMark') || 'current') : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setConfirmOpen(false)} style={btnSmall}>{t('integrations.common.cancel')}</button>
                    <button
                      onClick={() => void importModalSelected()}
                      disabled={modalImporting}
                      style={{ ...btnPrimary, opacity: modalImporting ? 0.5 : 1 }}
                    >
                      {modalImporting ? '...' : (t('integrations.common.confirmImportCta') || 'Onayla ve oluştur')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
