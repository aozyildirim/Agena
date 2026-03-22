'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { clearAllNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type GroupKey = 'tasks' | 'prs' | 'approvals' | 'integrations' | 'queue' | 'failures' | 'other';

const GROUP_META: Record<GroupKey, { color: string }> = {
  tasks: { color: '#39ff88' },
  prs: { color: '#38bdf8' },
  approvals: { color: '#a78bfa' },
  integrations: { color: '#f59e0b' },
  queue: { color: '#22d3ee' },
  failures: { color: '#ef4444' },
  other: { color: '#94a3b8' },
};

function getGroup(n: NotificationItem): GroupKey {
  const e = n.event_type || '';
  const failedLike = n.severity === 'error' || e.includes('failed') || n.title.toLowerCase().includes('failed');
  if (failedLike) return 'failures';
  if (e.startsWith('task_')) return 'tasks';
  if (e.startsWith('pr_')) return 'prs';
  if (e.startsWith('approval_')) return 'approvals';
  if (e.includes('integration')) return 'integrations';
  if (e.includes('queue')) return 'queue';
  return 'other';
}

function eventColor(n: NotificationItem): string {
  return GROUP_META[getGroup(n)].color;
}

export default function NotificationsPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readStatus, setReadStatus] = useState<'all' | 'read' | 'unread'>('all');
  const [groupFilter, setGroupFilter] = useState<'all' | GroupKey>('all');

  async function load() {
    setLoading(true);
    try {
      const res = await listNotifications(pageSize, readStatus === 'unread', {
        page,
        page_size: pageSize,
        event_type: 'all',
        read_status: readStatus,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
      setUnreadCount(res.unread_count || 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, pageSize, readStatus]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const visibleItems = useMemo(
    () => items.filter((n) => groupFilter === 'all' || getGroup(n) === groupFilter),
    [items, groupFilter],
  );
  const groupCounts = useMemo(() => {
    const counts: Record<GroupKey, number> = {
      tasks: 0,
      prs: 0,
      approvals: 0,
      integrations: 0,
      queue: 0,
      failures: 0,
      other: 0,
    };
    for (const item of items) counts[getGroup(item)] += 1;
    return counts;
  }, [items]);
  const grouped = useMemo(() => {
    const buckets: Record<GroupKey, NotificationItem[]> = {
      tasks: [],
      prs: [],
      approvals: [],
      integrations: [],
      queue: [],
      failures: [],
      other: [],
    };
    for (const item of visibleItems) buckets[getGroup(item)].push(item);
    return buckets;
  }, [visibleItems]);

  const groupLabel = (g: GroupKey): string => {
    if (g === 'tasks') return t('notifications.group.tasks');
    if (g === 'prs') return t('notifications.group.prs');
    if (g === 'approvals') return t('notifications.group.approvals');
    if (g === 'integrations') return t('notifications.group.integrations');
    if (g === 'queue') return t('notifications.group.queue');
    if (g === 'failures') return t('notifications.group.failures');
    return t('notifications.group.other');
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <div className='section-label'>{t('notifications.section')}</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'rgba(255,255,255,0.95)', margin: '6px 0 4px' }}>{t('notifications.title')}</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{t('notifications.unread')}: {unreadCount} • {t('notifications.total')}: {total}</p>
      </div>

      <div style={{ display: 'grid', gap: 10, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, overflow: 'hidden' }}>
            {(['all', 'unread', 'read'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setPage(1); setReadStatus(s); }}
                style={{
                  padding: '6px 10px',
                  border: 'none',
                  background: readStatus === s ? 'rgba(57,255,136,0.18)' : 'transparent',
                  color: readStatus === s ? '#39ff88' : 'rgba(255,255,255,0.6)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {s === 'all' ? t('notifications.all') : s === 'unread' ? t('notifications.unreadOnly') : t('notifications.readOnly')}
              </button>
            ))}
          </div>
          <select
            value={String(pageSize)}
            onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.14)',
              background: 'rgba(2,6,23,0.92)',
              color: 'rgba(255,255,255,0.9)',
            }}
          >
            <option value='10' style={{ background: '#0b1220', color: '#e5e7eb' }}>10</option>
            <option value='20' style={{ background: '#0b1220', color: '#e5e7eb' }}>20</option>
            <option value='50' style={{ background: '#0b1220', color: '#e5e7eb' }}>50</option>
          </select>
          <button className='button button-outline' onClick={() => void markAllNotificationsRead().then(load)}>{t('notifications.markAllRead')}</button>
          <button
            className='button button-outline'
            onClick={() => {
              if (typeof window !== 'undefined' && !window.confirm(t('notifications.confirmDeleteAll'))) return;
              setItems([]);
              setTotal(0);
              setUnreadCount(0);
              setPage(1);
              void clearAllNotifications().then(load);
            }}
            style={{ borderColor: 'rgba(239,68,68,0.35)', color: '#ef4444' }}
          >
            {t('notifications.clearAll')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'tasks', 'prs', 'approvals', 'integrations', 'queue', 'failures'] as const).map((g) => {
            const selected = groupFilter === g;
            const color = g === 'all' ? '#5eead4' : GROUP_META[g].color;
            const label = g === 'all' ? t('notifications.all') : groupLabel(g);
            const count = g === 'all' ? total : groupCounts[g];
            return (
              <button
                key={g}
                onClick={() => { setPage(1); setGroupFilter(g); }}
                style={{
                  padding: '5px 8px',
                  borderRadius: 999,
                  border: `1px solid ${selected ? `${color}66` : 'rgba(255,255,255,0.12)'}`,
                  background: selected ? `${color}22` : 'rgba(255,255,255,0.03)',
                  color: selected ? color : 'rgba(255,255,255,0.6)',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {label}
                <span style={{
                  minWidth: 18,
                  height: 18,
                  borderRadius: 999,
                  background: selected ? `${color}33` : 'rgba(255,255,255,0.1)',
                  color: selected ? color : 'rgba(255,255,255,0.75)',
                  fontSize: 11,
                  lineHeight: '18px',
                  textAlign: 'center',
                  padding: '0 5px',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}>
        {loading ? (
          <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)' }}>{t('notifications.loading')}</div>
        ) : visibleItems.length === 0 ? (
          <div style={{ padding: 20, color: 'rgba(255,255,255,0.5)' }}>{t('notifications.empty')}</div>
        ) : (Object.keys(GROUP_META) as GroupKey[]).map((groupKey) => {
          const groupItems = grouped[groupKey];
          if (!groupItems.length) return null;
          const meta = GROUP_META[groupKey];
          return (
            <div key={groupKey}>
              <div style={{ padding: '7px 12px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.06)', color: meta.color, fontSize: 11, fontWeight: 800, letterSpacing: 0.9, textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between' }}>
                <span>{groupLabel(groupKey)}</span>
                <span>{groupItems.length}</span>
              </div>
              {groupItems.map((n) => (
                <Link
                  key={n.id}
                  href={n.task_id ? `/tasks/${n.task_id}` : '/dashboard/tasks'}
                  onClick={() => { if (!n.is_read) void markNotificationRead(n.id).then(load); }}
                  style={{
                    textDecoration: 'none',
                    display: 'grid',
                    gap: 3,
                    padding: '10px 12px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    borderLeft: `3px solid ${eventColor(n)}`,
                    background: n.is_read ? 'rgba(255,255,255,0.01)' : `${eventColor(n)}12`,
                  }}
                >
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.92)', fontWeight: 700 }}>{n.title}</div>
                  <div style={{ fontSize: 11, color: eventColor(n), textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{n.event_type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{new Date(n.created_at).toLocaleString()}</div>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className='button button-outline' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>{t('notifications.prev')}</button>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{t('notifications.page')} {page} / {pages}</div>
        <button className='button button-outline' onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>{t('notifications.next')}</button>
      </div>
    </div>
  );
}
