'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/api';
import RichDescription from '@/components/RichDescription';

type SharedAttachment = {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
};

type SharedTask = {
  title: string;
  description: string;
  source: string | null;
  external_id: string | null;
  repo_mapping_name: string | null;
  attachments: SharedAttachment[];
  expires_at: string | null;
  uses_left: number;
};

export default function SharedTaskPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = String(params?.token || '');

  const [data, setData] = useState<SharedTask | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await apiFetch<SharedTask>(`/share/tasks/${token}`, undefined, false);
        if (!cancelled) setData(resp);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load shared task');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Rewrite description so any `<img src>` that points at an Azure/Jira
  // attachment is fetched through the share-token-scoped image proxy. The
  // viewer doesn't have credentials of their own, so the sharing org's PAT
  // is the only way these load.
  const descriptionWithProxiedImages = data?.description
    ? data.description.replace(
      /<img\s+([^>]*?)src\s*=\s*"([^"]+)"([^>]*)>/gi,
      (_match, before, src, after) => {
        if (!/dev\.azure\.com|_apis\/wit\/attachments|atlassian\.net/i.test(src)) {
          return _match;
        }
        const proxied = `${resolveApiBase()}/share/tasks/${encodeURIComponent(token)}/image?url=${encodeURIComponent(src)}`;
        return `<img ${before}src="${proxied}"${after}>`;
      },
    )
    : '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #0b1220)', color: 'var(--ink-90, #e5e7eb)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ marginBottom: 18, fontSize: 11, color: 'var(--ink-58, #9ca3af)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
          Shared task
        </div>

        {loading && <div style={{ fontSize: 14, color: 'var(--ink-58, #9ca3af)' }}>Loading…</div>}

        {!loading && error && (
          <div style={{
            padding: 16, borderRadius: 12, background: 'rgba(127,29,29,0.4)',
            border: '1px solid rgba(248,113,113,0.4)', color: '#fca5a5', fontSize: 14,
          }}>
            {error}
          </div>
        )}

        {!loading && data && (
          <>
            <h1 style={{ marginTop: 0, marginBottom: 8, fontSize: 22, lineHeight: 1.3, fontWeight: 800 }}>
              {data.title || 'Untitled task'}
            </h1>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18, fontSize: 11, color: 'var(--ink-58, #9ca3af)' }}>
              {data.source && (
                <span style={{ padding: '3px 8px', border: '1px solid var(--panel-border, #1f2937)', borderRadius: 6 }}>
                  {data.source}{data.external_id ? ` · #${data.external_id}` : ''}
                </span>
              )}
              {data.repo_mapping_name && (
                <span style={{ padding: '3px 8px', border: '1px solid var(--panel-border, #1f2937)', borderRadius: 6 }}>
                  Repo (sender): {data.repo_mapping_name}
                </span>
              )}
              {data.expires_at && (
                <span style={{ padding: '3px 8px', border: '1px solid var(--panel-border, #1f2937)', borderRadius: 6 }}>
                  Expires {new Date(data.expires_at).toLocaleString()}
                </span>
              )}
              <span style={{ padding: '3px 8px', border: '1px solid var(--panel-border, #1f2937)', borderRadius: 6 }}>
                {data.uses_left} use{data.uses_left === 1 ? '' : 's'} left
              </span>
            </div>

            <div style={{
              padding: 18, borderRadius: 14, border: '1px solid var(--panel-border-2, #1f2937)',
              background: 'var(--surface, #0f172a)', marginBottom: 18,
            }}>
              <RichDescription
                className='task-md'
                style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-78, #d1d5db)' }}
                html={descriptionWithProxiedImages}
              />
            </div>

            {data.attachments.length > 0 && (
              <div style={{
                padding: 14, borderRadius: 12, border: '1px solid var(--panel-border-2, #1f2937)',
                background: 'var(--surface, #0f172a)', marginBottom: 18,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--ink-35, #6b7280)', marginBottom: 8 }}>
                  Attachments ({data.attachments.length})
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {data.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={`${resolveApiBase()}/share/tasks/${encodeURIComponent(token)}/attachment/${a.id}`}
                      target='_blank'
                      rel='noreferrer'
                      style={{ fontSize: 13, color: '#5eead4', textDecoration: 'none' }}
                    >
                      {a.filename} <span style={{ color: 'var(--ink-58, #9ca3af)', fontSize: 11 }}>({Math.ceil(a.size_bytes / 1024)} KB)</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div style={{
              padding: 16, borderRadius: 12, background: 'rgba(13,148,136,0.08)',
              border: '1px solid rgba(94,234,212,0.35)', display: 'flex',
              alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 13, color: 'var(--ink-78, #d1d5db)' }}>
                Import this task into your organization to run it.
              </div>
              <button
                onClick={async () => {
                  if (!getToken()) {
                    router.push(`/auth/login?next=${encodeURIComponent(`/share/${token}`)}`);
                    return;
                  }
                  setImporting(true);
                  setImportError('');
                  try {
                    type ImportedTask = { id: number };
                    const r = await apiFetch<ImportedTask>(`/tasks/share/${token}/import`, { method: 'POST' });
                    router.push(`/dashboard/tasks/${r.id}`);
                  } catch (e) {
                    setImportError(e instanceof Error ? e.message : 'Import failed');
                  } finally {
                    setImporting(false);
                  }
                }}
                disabled={importing}
                style={{
                  fontSize: 13, fontWeight: 700, padding: '8px 18px', borderRadius: 8,
                  border: '1px solid rgba(94,234,212,0.4)', background: 'rgba(94,234,212,0.12)',
                  color: '#5eead4', cursor: importing ? 'wait' : 'pointer',
                }}
              >
                {importing ? 'Importing…' : 'Import to my org'}
              </button>
            </div>
            {importError && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#fca5a5' }}>{importError}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function resolveApiBase(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  return '';
}
