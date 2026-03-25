'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { clearAllNotifications, listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationItem } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

type GroupKey = 'all' | 'tasks' | 'prs' | 'failures' | 'queue' | 'integrations' | 'other';
const NOTIF_SYNC_EVENT = 'tiqr:notification-sync';
const LS_UNREAD_KEY = 'tiqr_notification_unread_count';

const GROUP_META: Record<Exclude<GroupKey, 'all'>, { color: string; icon: string }> = {
  tasks: { color: '#22c55e', icon: '○' },
  prs: { color: '#38bdf8', icon: '⎇' },
  failures: { color: '#ef4444', icon: '✕' },
  queue: { color: '#f59e0b', icon: '◷' },
  integrations: { color: '#a78bfa', icon: '⚡' },
  other: { color: '#94a3b8', icon: '•' },
};

const GROUP_ORDER: Exclude<GroupKey, 'all'>[] = ['tasks', 'prs', 'failures', 'queue', 'integrations', 'other'];

function getGroup(n: NotificationItem): Exclude<GroupKey, 'all'> {
  const e = n.event_type || '';
  const failedLike = n.severity === 'error' || e.includes('failed') || n.title.toLowerCase().includes('failed');
  if (failedLike) return 'failures';
  if (e.startsWith('task_')) return 'tasks';
  if (e.startsWith('pr_')) return 'prs';
  if (e.includes('integration')) return 'integrations';
  if (e.includes('queue')) return 'queue';
  return 'other';
}

export default function NotificationsPage() {
  const { t } = useLocale();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readStatus, setReadStatus] = useState<'all' | 'read' | 'unread'>('all');
  const [activeTab, setActiveTab] = useState<GroupKey>('all');

  function syncUnread(unread: number) {
    if (typeof window === 'undefined') return;
    const safe = Math.max(0, unread);
    localStorage.setItem(LS_UNREAD_KEY, String(safe));
    window.dispatchEvent(new CustomEvent(NOTIF_SYNC_EVENT, { detail: { unread: safe } }));
  }

  async function load() {
    setLoading(true);
    try {
      const res = await listNotifications(pageSize, readStatus === 'unread', {
        page, page_size: pageSize, event_type: 'all', read_status: readStatus,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
      const nextUnread = res.unread_count || 0;
      setUnreadCount(nextUnread);
      syncUnread(nextUnread);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page, readStatus]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const g of GROUP_ORDER) c[g] = 0;
    for (const n of items) c[getGroup(n)] += 1;
    return c;
  }, [items]);

  const visibleItems = useMemo(() => {
    const filtered = activeTab === 'all' ? items : items.filter((n) => getGroup(n) === activeTab);
    return filtered;
  }, [items, activeTab]);

  const groupLabel = (g: GroupKey): string => {
    const map: Record<string, string> = {
      all: t('notifications.all'),
      tasks: t('notifications.group.tasks'),
      prs: t('notifications.group.prs'),
      failures: t('notifications.group.failures'),
      queue: t('notifications.group.queue'),
      integrations: t('notifications.group.integrations'),
      other: t('notifications.group.other'),
    };
    return map[g] || g;
  };

  async function handleRead(n: NotificationItem) {
    if (n.is_read) return;
    const next = Math.max(0, unreadCount - 1);
    setUnreadCount(next);
    syncUnread(next);
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    await markNotificationRead(n.id);
    void load();
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className='section-label'>{t('notifications.section')}</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--ink)', margin: '6px 0 4px' }}>{t('notifications.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{t('notifications.unread')}: {unreadCount} • {t('notifications.total')}: {total}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}>
            {(['all', 'unread', 'read'] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setPage(1); setReadStatus(s); }}
                style={{
                  padding: '6px 10px', border: 'none', fontSize: 12, cursor: 'pointer',
                  background: readStatus === s ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: readStatus === s ? '#22c55e' : 'var(--muted)',
                }}
              >
                {s === 'all' ? t('notifications.all') : s === 'unread' ? t('notifications.unreadOnly') : t('notifications.readOnly')}
              </button>
            ))}
          </div>
          <button className='button button-outline' style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => {
            setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
            setUnreadCount(0); syncUnread(0);
            void markAllNotificationsRead().then(load);
          }}>{t('notifications.markAllRead')}</button>
          <button
            className='button button-outline'
            style={{ fontSize: 11, padding: '5px 10px', borderColor: 'rgba(239,68,68,0.35)', color: '#ef4444' }}
            onClick={() => {
              if (typeof window !== 'undefined' && !window.confirm(t('notifications.confirmDeleteAll'))) return;
              setItems([]); setTotal(0); setUnreadCount(0); syncUnread(0); setPage(1);
              void clearAllNotifications().then(load);
            }}
          >{t('notifications.clearAll')}</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', overflowX: 'auto' }}>
        {(['all', ...GROUP_ORDER] as GroupKey[]).map((g) => {
          const isActive = activeTab === g;
          const color = g === 'all' ? '#22c55e' : GROUP_META[g].color;
          const count = groupCounts[g] || 0;
          const icon = g === 'all' ? '' : GROUP_META[g].icon;
          return (
            <button
              key={g}
              onClick={() => { setActiveTab(g); }}
              style={{
                padding: '10px 16px', border: 'none', cursor: 'pointer',
                borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
                marginBottom: -2,
                background: 'transparent',
                color: isActive ? color : 'var(--muted)',
                fontSize: 13, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
              {groupLabel(g)}
              <span style={{
                minWidth: 20, height: 20, borderRadius: 999, lineHeight: '20px', textAlign: 'center',
                fontSize: 11, fontWeight: 800, padding: '0 6px',
                background: isActive ? `${color}22` : 'var(--glass)',
                color: isActive ? color : 'var(--muted)',
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--panel)' }}>
        {loading ? (
          <div style={{ padding: 20, color: 'var(--muted)' }}>{t('notifications.loading')}</div>
        ) : visibleItems.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--muted)' }}>{t('notifications.empty')}</div>
        ) : (
          visibleItems.map((n, idx) => {
            const group = getGroup(n);
            const meta = GROUP_META[group];
            return (
              <Link
                key={n.id}
                href={n.task_id ? `/tasks/${n.task_id}` : '/dashboard/tasks'}
                onClick={() => void handleRead(n)}
                style={{
                  textDecoration: 'none',
                  display: 'grid',
                  gridTemplateColumns: '4px 1fr auto',
                  gap: 0,
                  borderTop: idx === 0 ? 'none' : '1px solid var(--panel-border)',
                  background: n.is_read ? 'transparent' : `${meta.color}08`,
                }}
              >
                {/* Color bar */}
                <div style={{ background: meta.color, borderRadius: '4px 0 0 4px' }} />

                {/* Content */}
                <div style={{ padding: '12px 14px', display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{n.title}</span>
                    {!n.is_read && (
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.color, flexShrink: 0 }} />
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>
                    {n.event_type.replace(/_/g, ' ')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{n.message}</div>
                </div>

                {/* Time */}
                <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', alignSelf: 'center' }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className='button button-outline' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>{t('notifications.prev')}</button>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('notifications.page')} {page} / {pages}</div>
        <button className='button button-outline' onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>{t('notifications.next')}</button>
      </div>
    </div>
  );
}
