'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

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
  const [sprintOptions, setSprintOptions] = useState<Array<{ path: string; name: string; is_current?: boolean }>>([]);

  useEffect(() => {
    void loadMappings();
    void loadRepos();
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
      if (res.imported === 0 && res.skipped > 0) {
        setMsg(`No new errors to import — ${res.skipped} already imported before`);
      } else if (res.imported > 0 && res.skipped > 0) {
        setMsg(`${res.imported} new error(s) imported as tasks, ${res.skipped} skipped (already exists)`);
      } else if (res.imported > 0) {
        setMsg(`${res.imported} error(s) imported as tasks`);
      } else {
        setMsg('No errors found to import');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
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
    background: 'var(--panel)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--panel-border)',
    background: 'var(--glass)', color: 'var(--ink)', fontSize: 13,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1CE783', color: '#000',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  };
  const btnSmall: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--panel-border)',
    background: 'transparent', color: 'var(--ink-58)', fontSize: 11, cursor: 'pointer',
  };

  return (
    <div className='integrations-page' style={{ display: 'grid', gap: 16, maxWidth: 900, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
        {t('integrations.providerNewrelic')} — {t('integrations.newrelic.entityBrowser')}
      </h2>

      {msg && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{msg}</div>}
      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', color: '#f87171', fontSize: 12, fontWeight: 600 }}>{error}</div>}

      {/* Search */}
      <div style={cardStyle}>
        <div className='int-row' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('integrations.newrelic.entityBrowser')}
            style={{ ...inputStyle, flex: 1, minWidth: 200 }} onKeyDown={(e) => e.key === 'Enter' && searchEntities()} />
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ ...inputStyle, width: 180 }}>
            <option value="">{t('integrations.common.allTypes')}</option>
            <option value="APPLICATION">{t('integrations.newrelic.typeApm')}</option>
            <option value="BROWSER_APPLICATION">{t('integrations.newrelic.typeBrowser')}</option>
            <option value="MOBILE_APPLICATION">{t('integrations.newrelic.typeMobile')}</option>
            <option value="HOST">{t('integrations.newrelic.typeHost')}</option>
            <option value="MONITOR">{t('integrations.newrelic.typeMonitor')}</option>
          </select>
          <button onClick={() => void searchEntities()} disabled={loading} style={btnPrimary}>
            {loading ? '...' : t('integrations.common.search')}
          </button>
        </div>
      </div>

      {/* Entity results */}
      {entities.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--ink-58)' }}>{t('integrations.newrelic.entitiesCount').replace('{n}', String(entities.length))}</h3>
          <div style={{ display: 'grid', gap: 4 }}>
            {entities.map((e) => {
              const mapping = mappings.find((m) => m.entity_guid === e.guid);
              return (
                <div key={e.guid} className='int-row' style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: selectedGuid === e.guid ? 'var(--glass)' : 'transparent', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 150, color: 'var(--ink)' }}>{e.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-35)', fontWeight: 500 }}>{e.entity_type.replace('_ENTITY', '')}</span>
                  <span style={{ fontSize: 10, color: e.reporting ? '#22c55e' : '#f87171' }}>{e.reporting ? t('integrations.common.active') : t('integrations.common.inactive')}</span>
                  <button onClick={() => void fetchErrors(e.guid, e.name)} style={btnSmall}>{t('integrations.newrelic.errorsBtn')}</button>
                  {!mapping && <button onClick={() => void addMapping(e)} style={btnSmall}>{t('integrations.common.map')}</button>}
                  {mapping && (
                    <>
                      <select
                        value={mapping.repo_mapping_id ?? ''}
                        onChange={(ev) => void updateMapping(mapping.id, { repo_mapping_id: ev.target.value ? parseInt(ev.target.value) : null })}
                        style={{ ...inputStyle, width: 160, fontSize: 11, padding: '4px 8px' }}
                      >
                        <option value="">{t('integrations.common.selectRepo')}</option>
                        {repos.map((r) => (
                          <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                        ))}
                      </select>
                      <button onClick={() => void importErrors(mapping.entity_guid)} style={btnSmall}>{t('integrations.common.import')}</button>
                      <button onClick={() => void deleteMapping(mapping.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)', fontSize: 10 }}>x</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Error groups */}
      {selectedGuid && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>{t('integrations.newrelic.errorsFor').replace('{name}', selectedEntityName)}</h3>
            <button onClick={() => void importErrors(selectedGuid)} style={btnPrimary}>{t('integrations.common.importAsTasks')}</button>
          </div>
          {errorsLoading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.loading')}</div>
          ) : errors.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noErrors')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {errors.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--glass)', fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: '#f87171', minWidth: 40, textAlign: 'right' }}>{e.occurrences}x</span>
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{e.error_class}</span>
                  <span style={{ color: 'var(--ink-50)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.error_message}</span>
                  {e.last_seen && <span style={{ color: 'var(--ink-25)', fontSize: 10, flexShrink: 0 }}>{new Date(Number(e.last_seen)).toLocaleString()}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mappings */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-58)' }}>{t('integrations.newrelic.entityMappings')}</h3>
          <button onClick={() => void importErrors()} style={btnPrimary}>{t('integrations.common.importAll')}</button>
        </div>
        {mappings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-35)', padding: 12 }}>{t('integrations.common.noMappingsHint')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {mappings.map((m) => (
              <div key={m.id} className='int-row' style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--glass)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{m.entity_name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-35)' }}>{m.entity_type} • {m.repo_display_name || t('integrations.common.noRepo')}</div>
                </div>
                <select
                  value={m.repo_mapping_id ?? ''}
                  onChange={(e) => void updateMapping(m.id, { repo_mapping_id: e.target.value ? parseInt(e.target.value) : null })}
                  style={{ ...inputStyle, width: 160, fontSize: 11 }}
                >
                  <option value="">No repo</option>
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>{r.owner}/{r.repo_name}</option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: 'var(--ink-50)' }}>
                  <input type="checkbox" checked={m.auto_import} onChange={(e) => void updateMapping(m.id, { auto_import: e.target.checked })} />
                  {t('integrations.common.auto')}
                </label>
                <button onClick={() => void importErrors(m.entity_guid)} style={btnSmall}>{t('integrations.common.import')}</button>
                <button onClick={() => void openRequestModal(m)} style={btnSmall}>
                  {t('integrations.newrelic.request') || 'Request'}
                </button>
                <button onClick={() => void deleteMapping(m.id)} style={{ ...btnSmall, color: '#f87171', borderColor: 'rgba(248,113,113,0.2)' }}>x</button>
              </div>
            ))}
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
              background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 14,
              width: 'min(760px, calc(100vw - 32px))',
              maxWidth: 'calc(100vw - 32px)',
              height: 'min(80vh, 720px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 24px 60px rgba(0,0,0,0.35)', color: 'var(--ink)',
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
                    <span style={{ marginLeft: 8, color: '#1CE783', fontWeight: 600 }}>
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
                        padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                        background: isSelected ? 'rgba(28,231,131,0.10)' : 'var(--glass)',
                        border: `1px solid ${isSelected ? 'rgba(28,231,131,0.4)' : 'var(--panel-border)'}`,
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
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                          {title}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6, fontSize: 10, color: 'var(--ink-35)', flexWrap: 'wrap' }}>
                          {isImported && (
                            <a
                              href={`/tasks/${e.imported_task_id}`}
                              onClick={(ev) => ev.stopPropagation()}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(96,165,250,0.18)', color: '#60a5fa', textDecoration: 'none' }}
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
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.18)', color: '#a855f7', textDecoration: 'none' }}
                            >
                              {t('integrations.common.viewWorkItem') || 'Open work item'} ↗
                            </a>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>
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
                padding: 20, borderRadius: 14,
              }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--panel-border)', borderRadius: 12, padding: 18, width: '100%', maxWidth: 440, boxShadow: '0 20px 48px rgba(0,0,0,0.35)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
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
