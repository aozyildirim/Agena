'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState, Suspense } from 'react';
import { isLoggedIn, removeToken, apiFetch, listNotifications, markAllNotificationsRead, markNotificationRead, loadPrefs, savePrefs, type NotificationItem } from '@/lib/api';
import OnboardingModal from '@/components/OnboardingModal';
import WebPushBridge from '@/components/WebPushBridge';
import { useLocale } from '@/lib/i18n';

const NOTIF_EVENT = 'tiqr:notification';
const LS_UNREAD_KEY = 'tiqr_notification_unread_count';
const LS_SIDEBAR_COLLAPSED = 'tiqr_sidebar_collapsed';

const PRIMARY_NAV_KEYS = [
  { href: '/dashboard', key: 'nav.overview', icon: '🧭' },
  { href: '/dashboard/tasks', key: 'nav.tasks', icon: '✅' },
  { href: '/dashboard/sprints', key: 'nav.sprints', icon: '🗂' },
  { href: '/dashboard/team', key: 'nav.team', icon: '👥' },
  { href: '/dashboard/agents', key: 'nav.agents', icon: '🤖' },
  { href: '/dashboard/flows', key: 'nav.flows', icon: '🧠' },
  { href: '/dashboard/mappings', key: 'nav.mappings', icon: '🔗' },
  { href: '/dashboard/integrations', key: 'nav.integrations', icon: '🔌' },
] as const;

const SECONDARY_NAV_KEYS = [
  { href: '/dashboard/notifications', key: 'nav.notifications', icon: '🔔' },
  { href: '/dashboard/usage', key: 'nav.usage', icon: '📊' },
  { href: '/dashboard/profile', key: 'nav.profile', icon: '👤' },
] as const;

function DashboardInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [userName, setUserName] = useState('');
  const [checked, setChecked] = useState(false);
  const [notifPermission, setNotifPermission] = useState<'default' | 'granted' | 'denied'>('default');
  const [webPushEnabled, setWebPushEnabled] = useState(true);
  const [profileSettings, setProfileSettings] = useState<Record<string, unknown>>({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'failed'>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const shouldOpenOnboarding = searchParams.get('onboarding') === '1' || searchParams.get('welcome') === '1';
  const lastUnreadRef = useRef<number | null>(null);
  const sidebarWidth = sidebarCollapsed ? 76 : 220;

  function playNotifyTone() {
    if (typeof window === 'undefined' || !webPushEnabled) return;
    const AudioCtx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.22);
      window.setTimeout(() => void ctx.close(), 260);
    } catch {
      // no-op
    }
  }

  async function refreshNotifications(limit = 8) {
    try {
      const res = await listNotifications(limit, false);
      setNotifications(res.items || []);
      const nextUnread = Math.max(0, res.unread_count || 0);
      const prevUnread = lastUnreadRef.current;
      setUnreadCount(nextUnread);
      if (typeof window !== 'undefined') localStorage.setItem(LS_UNREAD_KEY, String(nextUnread));
      if (prevUnread !== null && nextUnread > prevUnread) {
        playNotifyTone();
        if (typeof window !== 'undefined' && webPushEnabled && 'Notification' in window && Notification.permission === 'granted') {
          const latest = (res.items || []).find((i) => !i.is_read) || (res.items || [])[0];
          if (latest) {
            new Notification(latest.title, { body: latest.message });
          }
        }
      }
      lastUnreadRef.current = nextUnread;
    } catch {
      // no-op
    }
  }

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      if (!isLoggedIn()) {
        const qs = searchParams.toString();
        const next = qs ? `${pathname}?${qs}` : pathname;
        router.replace(`/signin?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!active) return;
      setChecked(true);

      apiFetch<{ full_name?: string; email: string }>('/auth/me').then((u) => {
        if (!active) return;
        setUserName(u.full_name || u.email);
      }).catch(() => {});

      if (typeof window !== 'undefined' && 'Notification' in window) {
        setNotifPermission(Notification.permission);
      }
      try {
        const prefs = await loadPrefs();
        const raw = (prefs.profile_settings || {}) as Record<string, unknown>;
        setProfileSettings(raw);
        setWebPushEnabled(raw.web_push_notifications !== false);
      } catch {
        setWebPushEnabled(true);
      }
      if (typeof window !== 'undefined') {
        setSidebarCollapsed(localStorage.getItem(LS_SIDEBAR_COLLAPSED) === '1');
        const raw = localStorage.getItem(LS_UNREAD_KEY);
        const parsed = raw ? parseInt(raw, 10) : 0;
        setUnreadCount(Number.isFinite(parsed) ? Math.max(0, parsed) : 0);
        lastUnreadRef.current = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      }
      await refreshNotifications(8);

      if (!shouldOpenOnboarding) {
        setShowOnboarding(false);
        return;
      }

      try {
        const integrations = await apiFetch<Array<{ has_secret: boolean; base_url?: string | null }>>('/integrations');
        if (!active) return;
        const hasIntegration = integrations.some((cfg) => cfg.has_secret || Boolean(cfg.base_url));
        setShowOnboarding(!hasIntegration);
      } catch {
        if (!active) return;
        // If integration check fails, keep onboarding visible for first-login links.
        setShowOnboarding(true);
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [router, shouldOpenOnboarding]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNotif = () => {
      setUnreadCount((prev) => {
        const next = prev + 1;
        localStorage.setItem(LS_UNREAD_KEY, String(next));
        return next;
      });
    };
    window.addEventListener(NOTIF_EVENT, onNotif as EventListener);
    return () => {
      window.removeEventListener(NOTIF_EVENT, onNotif as EventListener);
    };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => void refreshNotifications(8), 6000);
    return () => clearInterval(iv);
  }, []);

  function logout() {
    removeToken();
    router.push('/');
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem(LS_SIDEBAR_COLLAPSED, next ? '1' : '0');
      if (next) setNotifOpen(false);
      return next;
    });
  }

  async function toggleBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const next = !webPushEnabled;
    const nextProfile = { ...profileSettings, web_push_notifications: next };
    setWebPushEnabled(next);
    setProfileSettings(nextProfile);
    if (next && Notification.permission === 'default') {
      const p = await Notification.requestPermission();
      setNotifPermission(p);
    } else {
      setNotifPermission(Notification.permission);
    }
    await savePrefs({ profile_settings: nextProfile });
  }

  function clearUnread() {
    setUnreadCount(0);
    if (typeof window !== 'undefined') localStorage.setItem(LS_UNREAD_KEY, '0');
  }

  async function openNotifications() {
    setNotifOpen((v) => !v);
    setNotifLoading(true);
    await refreshNotifications(12);
    setNotifLoading(false);
  }

  async function markAllReadAndRefresh() {
    // Optimistic UI: clear badge and mark panel items read immediately.
    clearUnread();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await markAllNotificationsRead();
    } finally {
      await refreshNotifications(12);
    }
  }

  function notifColor(n: NotificationItem): string {
    const failedLike = n.severity === 'error' || n.event_type.includes('failed') || n.title.toLowerCase().includes('failed');
    return failedLike ? '#ef4444' : '#39ff88';
  }

  if (!checked) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 72 }}>
      {/* Sidebar */}
      <aside style={{
        width: sidebarWidth, flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(3,7,18,0.6)', backdropFilter: 'blur(20px)',
        position: 'fixed', top: 72, bottom: 0, left: 0,
        display: 'flex', flexDirection: 'column',
        padding: '24px 12px', zIndex: 50,
        overflowY: 'auto', overflowX: 'hidden',
        transition: 'width 0.2s ease',
      }}>
        <button
          onClick={toggleSidebar}
          title={sidebarCollapsed ? t('notifications.expandSidebar') : t('notifications.collapseSidebar')}
          style={{
            alignSelf: sidebarCollapsed ? 'center' : 'flex-end',
            width: 28,
            height: 28,
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.03)',
            color: 'rgba(255,255,255,0.7)',
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          {sidebarCollapsed ? '→' : '←'}
        </button>
        {/* User info */}
        {userName && (
          <a href="/dashboard/profile" title={userName}
            style={{ textDecoration: 'none', padding: sidebarCollapsed ? '8px 6px' : '10px 12px', marginBottom: 16, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'block', transition: 'border-color 0.2s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(139,92,246,0.3)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.06)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: sidebarCollapsed ? 0 : 10, justifyContent: sidebarCollapsed ? 'center' : 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
                {userName[0]?.toUpperCase()}
              </div>
              {!sidebarCollapsed && <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{t('nav.profileHint')}</div>
              </div>}
            </div>
          </a>
        )}

        {!sidebarCollapsed && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', padding: '0 12px', marginBottom: 8 }}>
          {t('nav.workspace')}
        </div>}

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {PRIMARY_NAV_KEYS.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} title={t(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: sidebarCollapsed ? '9px 10px' : '9px 12px', borderRadius: 10, fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? '#5eead4' : 'rgba(255,255,255,0.45)',
                background: active ? 'rgba(13,148,136,0.12)' : 'transparent',
                border: active ? '1px solid rgba(13,148,136,0.2)' : '1px solid transparent',
                transition: 'all 0.2s', textDecoration: 'none', justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }}>
                <span style={{ fontSize: 16, opacity: active ? 1 : 0.5 }}>{item.icon}</span>
                {!sidebarCollapsed && t(item.key)}
                {active && !sidebarCollapsed && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#5eead4' }} />}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECONDARY_NAV_KEYS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href);
            const isNotificationItem = item.href === '/dashboard/notifications';
            const hasUnread = isNotificationItem && unreadCount > 0;
            const itemColor = hasUnread ? '#ef4444' : (active ? '#5eead4' : 'rgba(255,255,255,0.45)');
            return (
              <Link key={item.href} href={item.href} title={t(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: sidebarCollapsed ? '9px 10px' : '9px 12px', borderRadius: 10, fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: itemColor,
                background: hasUnread ? 'rgba(239,68,68,0.12)' : (active ? 'rgba(13,148,136,0.12)' : 'transparent'),
                border: hasUnread ? '1px solid rgba(239,68,68,0.28)' : (active ? '1px solid rgba(13,148,136,0.2)' : '1px solid transparent'),
                transition: 'all 0.2s', textDecoration: 'none', justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }}>
                <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18 }}>
                  <span style={{ fontSize: 16, opacity: active || hasUnread ? 1 : 0.5 }}>{item.icon}</span>
                  {hasUnread && (
                    <span style={{
                      position: 'absolute',
                      right: -8,
                      top: -8,
                      minWidth: 16,
                      height: 16,
                      borderRadius: 999,
                      background: '#ef4444',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: '16px',
                      textAlign: 'center',
                      padding: '0 4px',
                    }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                {!sidebarCollapsed && t(item.key)}
              </Link>
            );
          })}
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            onClick={openNotifications}
            title={t('notifications.section')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              padding: sidebarCollapsed ? '8px 8px' : '8px 12px', borderRadius: 10, fontSize: 13,
              background: notifPermission === 'granted' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
              border: notifPermission === 'granted' ? '1px solid rgba(34,197,94,0.28)' : '1px solid rgba(255,255,255,0.06)',
              color: notifPermission === 'granted' ? '#22c55e' : 'rgba(255,255,255,0.65)',
              cursor: 'pointer', width: '100%',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18 }}>
              <span style={{ fontSize: 14 }}>🔔</span>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  right: -7,
                  top: -7,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 999,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  lineHeight: '16px',
                  textAlign: 'center',
                  padding: '0 4px',
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </span>
            {!sidebarCollapsed && t('notifications.section')}
          </button>
          {notifOpen && !sidebarCollapsed && (
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(2,6,23,0.92)', borderRadius: 12, padding: 10, display: 'grid', gap: 8, maxHeight: 250, overflow: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', fontWeight: 700 }}>{t('notifications.recent')}</span>
                <button onClick={() => void markAllReadAndRefresh()} style={{ border: 'none', background: 'transparent', color: '#5eead4', fontSize: 11, cursor: 'pointer' }}>{t('notifications.markAllRead')}</button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setNotifFilter('all')}
                  style={{
                    border: '1px solid rgba(57,255,136,0.35)',
                    background: notifFilter === 'all' ? 'rgba(57,255,136,0.16)' : 'rgba(255,255,255,0.03)',
                    color: notifFilter === 'all' ? '#39ff88' : 'rgba(255,255,255,0.6)',
                    padding: '4px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {t('notifications.all')}
                </button>
                <button
                  onClick={() => setNotifFilter('failed')}
                  style={{
                    border: '1px solid rgba(239,68,68,0.35)',
                    background: notifFilter === 'failed' ? 'rgba(239,68,68,0.16)' : 'rgba(255,255,255,0.03)',
                    color: notifFilter === 'failed' ? '#ef4444' : 'rgba(255,255,255,0.6)',
                    padding: '4px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {t('notifications.group.failures')}
                </button>
              </div>
              {notifLoading ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('notifications.loading')}</div>
              ) : notifications.filter((n) => notifFilter === 'all' || n.severity === 'error' || n.event_type.includes('failed') || n.title.toLowerCase().includes('failed')).length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{t('notifications.emptyShort')}</div>
              ) : notifications
                .filter((n) => notifFilter === 'all' || n.severity === 'error' || n.event_type.includes('failed') || n.title.toLowerCase().includes('failed'))
                .map((n) => (
                <Link
                  key={n.id}
                  href={n.task_id ? `/tasks/${n.task_id}` : '/dashboard/tasks'}
                  onClick={() => {
                    if (n.is_read) return;
                    // Optimistic single-read update for instant badge response.
                    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
                    setUnreadCount((prev) => {
                      const next = Math.max(0, prev - 1);
                      if (typeof window !== 'undefined') localStorage.setItem(LS_UNREAD_KEY, String(next));
                      return next;
                    });
                    void markNotificationRead(n.id).finally(() => void refreshNotifications(12));
                  }}
                  style={{ textDecoration: 'none', border: `1px solid ${notifColor(n)}44`, borderLeft: `3px solid ${notifColor(n)}`, borderRadius: 10, padding: '7px 8px', display: 'grid', gap: 3, background: n.is_read ? 'rgba(255,255,255,0.01)' : `${notifColor(n)}18` }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: 700 }}>{n.title}</div>
                  <div style={{ fontSize: 10, color: notifColor(n), textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{n.event_type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>{n.message}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{new Date(n.created_at).toLocaleString()}</div>
                </Link>
              ))}
              <Link href='/dashboard/notifications' style={{ textDecoration: 'none', textAlign: 'center', padding: '7px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', color: '#39ff88', fontSize: 12, fontWeight: 700 }}>
                {t('notifications.viewAll')}
              </Link>
            </div>
          )}
          <button
            onClick={() => void toggleBrowserNotifications()}
            title={t('notifications.browserTitle')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              padding: sidebarCollapsed ? '8px 8px' : '8px 12px', borderRadius: 10, fontSize: 13,
              background: webPushEnabled ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
              border: webPushEnabled ? '1px solid rgba(34,197,94,0.28)' : '1px solid rgba(255,255,255,0.06)',
              color: webPushEnabled ? '#22c55e' : 'rgba(255,255,255,0.65)',
              cursor: 'pointer', width: '100%',
            }}
          >
            {sidebarCollapsed ? '🔔' : (webPushEnabled ? t('notifications.browserOn') : t('notifications.browserOff'))}
          </button>
          <button onClick={logout} title={t('nav.logout')} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            padding: sidebarCollapsed ? '8px 8px' : '8px 12px', borderRadius: 10, fontSize: 13,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.3)', cursor: 'pointer', width: '100%',
          }}>
            {sidebarCollapsed ? '↩' : t('nav.logout')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, marginLeft: sidebarWidth, padding: '32px 40px', minWidth: 0, transition: 'margin-left 0.2s ease' }}>
        {children}
      </main>

      {/* Onboarding modal */}
      {showOnboarding && (
        <OnboardingModal
          userName={userName}
          onClose={() => setShowOnboarding(false)}
        />
      )}
      <WebPushBridge />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <DashboardInner>{children}</DashboardInner>
    </Suspense>
  );
}
