/* eslint-disable */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type KanbanColumn = 'todo' | 'in_progress' | 'review' | 'done';

type KanbanCard = {
  id: number;
  title: string;
  column: KanbanColumn;
  status: string;
  source: string;
  external_id?: string | null;
  assigned_to?: string | null;
  pr_url?: string | null;
  priority?: string | null;
  repo_mapping_name?: string | null;
};

type BoardResponse = {
  columns: KanbanColumn[];
  cards_by_column: Record<KanbanColumn, KanbanCard[]>;
};

const FALLBACK_COLUMNS: KanbanColumn[] = ['todo', 'in_progress', 'review', 'done'];

const SOURCE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  jira:     { label: 'Jira',           bg: 'rgba(56,189,248,0.10)',  color: '#38bdf8' },
  azure:    { label: 'Azure DevOps',   bg: 'rgba(167,139,250,0.10)', color: '#a78bfa' },
  internal: { label: 'Agena',          bg: 'rgba(94,234,212,0.10)',  color: '#5eead4' },
  sentry:   { label: 'Sentry',         bg: 'rgba(244,114,182,0.10)', color: '#f472b6' },
  newrelic: { label: 'New Relic',      bg: 'rgba(34,197,94,0.10)',   color: '#22c55e' },
};

const COLUMN_ACCENT: Record<KanbanColumn, string> = {
  todo: '#f59e0b',
  in_progress: '#38bdf8',
  review: '#a78bfa',
  done: '#22c55e',
};

export default function KanbanBoardPage() {
  const { t } = useLocale();
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<KanbanColumn | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<BoardResponse>('/tasks/kanban/board');
      setBoard(data);
    } catch (e: any) {
      setError(String(e?.message || e || 'Failed to load board'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll for external changes (webhooks update DB → next poll picks up).
  // 8s is fast enough that a Jira "In Progress" → Agena 'review' edit feels
  // realtime without burning the API. Disabled when the user is dragging.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (savingTaskId === null && dragOver === null) refresh();
    }, 8000);
    return () => clearInterval(id);
  }, [autoRefresh, savingTaskId, dragOver, refresh]);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  };

  const moveCard = useCallback(async (taskId: number, target: KanbanColumn) => {
    if (!board) return;
    // Optimistic move — find and pluck the card, place it under the target.
    let movedCard: KanbanCard | null = null;
    let originColumn: KanbanColumn | null = null;
    const next: BoardResponse = {
      columns: board.columns,
      cards_by_column: { ...board.cards_by_column },
    };
    for (const col of board.columns) {
      const list = next.cards_by_column[col] || [];
      const idx = list.findIndex(c => c.id === taskId);
      if (idx >= 0) {
        movedCard = { ...list[idx], column: target };
        originColumn = col;
        next.cards_by_column[col] = [...list.slice(0, idx), ...list.slice(idx + 1)];
        break;
      }
    }
    if (!movedCard) return;
    if (originColumn === target) return; // no-op
    next.cards_by_column[target] = [movedCard, ...(next.cards_by_column[target] || [])];
    setBoard(next);
    setSavingTaskId(taskId);

    try {
      await apiFetch(`/tasks/${taskId}/kanban-status`, {
        method: 'PATCH',
        body: JSON.stringify({ column: target }),
      });
      const sourceLabel = movedCard.source === 'jira'
        ? 'Jira'
        : (movedCard.source === 'azure' ? 'Azure DevOps' : 'Agena');
      showToast('ok', `#${taskId} → ${target.replace('_', ' ')} (${sourceLabel})`);
    } catch (e: any) {
      // Roll back the optimistic move
      showToast('err', String(e?.message || 'Sync failed'));
      await refresh();
    } finally {
      setSavingTaskId(null);
    }
  }, [board, refresh]);

  const onDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: number) => {
    e.dataTransfer.setData('text/plain', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>, col: KanbanColumn) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== col) setDragOver(col);
  };

  const onDragLeave = () => setDragOver(null);

  const onDrop = async (e: React.DragEvent<HTMLDivElement>, col: KanbanColumn) => {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData('text/plain');
    const taskId = Number(raw);
    if (!Number.isFinite(taskId)) return;
    await moveCard(taskId, col);
  };

  const columns = board?.columns ?? FALLBACK_COLUMNS;

  const columnLabel = (col: KanbanColumn): string => {
    switch (col) {
      case 'todo': return t('board.col.todo' as any) || 'To Do';
      case 'in_progress': return t('board.col.in_progress' as any) || 'In Progress';
      case 'review': return t('board.col.review' as any) || 'Review';
      case 'done': return t('board.col.done' as any) || 'Done';
    }
  };

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1600, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
            {t('board.title' as any) || 'Kanban Board'}
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
            {t('board.subtitle' as any) || 'Drag cards between columns. Status auto-syncs with Jira & Azure DevOps.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            {t('board.autoRefresh' as any) || 'Auto-refresh'}
          </label>
          <button
            onClick={refresh}
            style={{
              fontSize: 12, padding: '6px 12px', borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.2)', background: 'transparent', color: '#cbd5e1', cursor: 'pointer',
            }}
          >
            {t('board.refresh' as any) || 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 6, background: 'rgba(239,68,68,0.10)', color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 50,
            padding: '10px 16px', borderRadius: 8, fontSize: 13,
            background: toast.kind === 'ok' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: toast.kind === 'ok' ? '#86efac' : '#fca5a5',
            border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#94a3b8', padding: 24 }}>{t('common.loading' as any) || 'Loading...'}</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns.length}, minmax(260px, 1fr))`,
            gap: 16,
            alignItems: 'start',
          }}
        >
          {columns.map((col) => {
            const items = board?.cards_by_column[col] || [];
            const accent = COLUMN_ACCENT[col];
            const isOver = dragOver === col;
            return (
              <div
                key={col}
                onDragOver={(e) => onDragOver(e, col)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, col)}
                style={{
                  borderRadius: 10,
                  padding: 12,
                  background: 'rgba(15,23,42,0.4)',
                  border: `1px solid ${isOver ? accent : 'rgba(148,163,184,0.12)'}`,
                  minHeight: 480,
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: accent }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{columnLabel(col)}</span>
                  </div>
                  <span
                    style={{
                      fontSize: 11, color: '#94a3b8', background: 'rgba(148,163,184,0.10)',
                      padding: '2px 8px', borderRadius: 10, minWidth: 22, textAlign: 'center',
                    }}
                  >
                    {items.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((card) => {
                    const badge = SOURCE_BADGE[card.source] || SOURCE_BADGE.internal;
                    const isSaving = savingTaskId === card.id;
                    return (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, card.id)}
                        style={{
                          padding: 12, borderRadius: 8,
                          background: 'rgba(30,41,59,0.7)',
                          border: '1px solid rgba(148,163,184,0.1)',
                          cursor: 'grab',
                          opacity: isSaving ? 0.55 : 1,
                          transition: 'opacity 0.15s, transform 0.1s',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
                          <Link
                            href={`/dashboard/tasks/${card.id}`}
                            style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, lineHeight: 1.4, textDecoration: 'none', flex: 1 }}
                          >
                            {card.title || `#${card.id}`}
                          </Link>
                          <span style={{ fontSize: 10, color: '#64748b' }}>#{card.id}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 4,
                              background: badge.bg, color: badge.color, fontWeight: 500,
                            }}
                          >
                            {badge.label}
                          </span>
                          {card.external_id && (
                            <span style={{ fontSize: 10, color: '#64748b' }}>
                              {card.external_id}
                            </span>
                          )}
                          {card.priority && (
                            <span
                              style={{
                                fontSize: 10, padding: '2px 6px', borderRadius: 4,
                                background: 'rgba(148,163,184,0.10)', color: '#94a3b8', textTransform: 'capitalize',
                              }}
                            >
                              {card.priority}
                            </span>
                          )}
                        </div>

                        {(card.assigned_to || card.repo_mapping_name) && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {card.assigned_to || ''}
                            </span>
                            {card.repo_mapping_name && (
                              <span style={{ color: '#94a3b8' }}>{card.repo_mapping_name}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {items.length === 0 && (
                    <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 20, fontStyle: 'italic' }}>
                      {t('board.empty' as any) || 'No tasks'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
