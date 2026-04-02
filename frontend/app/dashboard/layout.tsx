'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState, Suspense } from 'react';
import { isLoggedIn, removeToken, apiFetch, listNotifications, markAllNotificationsRead, markNotificationRead, loadPrefs, savePrefs, getOrgSlug, getOrgName, setOrgSlug, setOrgName, type NotificationItem } from '@/lib/api';
import OnboardingModal from '@/components/OnboardingModal';
import WebPushBridge from '@/components/WebPushBridge';
import LangToggle from '@/components/LangToggle';
import GuidedTour from '@/components/GuidedTour';
import { useLocale } from '@/lib/i18n';
import { RoleContext, canAccess, type Role } from '@/lib/rbac';
import { WebSocketProvider } from '@/lib/useWebSocket';

type NavChild = { href: string; key: string; icon: string; permission?: string };
type NavItem = { href: string; key: string; icon: string; permission?: string; children?: NavChild[] };

const NOTIF_EVENT = 'agena:notification';
const NOTIF_SYNC_EVENT = 'agena:notification-sync';
const LS_UNREAD_KEY = 'agena_notification_unread_count';
const LS_SIDEBAR_COLLAPSED = 'agena_sidebar_collapsed';

type NavGroup = { labelKey: string; items: NavItem[]; defaultOpen?: boolean };

const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group.workspace',
    defaultOpen: true,
    items: [
      { href: '/dashboard', key: 'nav.overview', icon: '🧭' },
      { href: '/dashboard/office', key: 'nav.office', icon: '🏢' },
      { href: '/dashboard/tasks', key: 'nav.tasks', icon: '✅', permission: 'tasks:read' as const },
      { href: '/dashboard/sprints', key: 'nav.sprints', icon: '🗂', permission: 'tasks:read' as const },
      { href: '/dashboard/sprint-performance', key: 'nav.sprintPerformance', icon: '📈', permission: 'tasks:read' as const },
      { href: '/dashboard/refinement', key: 'nav.refinement', icon: '🧪', permission: 'tasks:read' as const },
    ],
  },
  {
    labelKey: 'nav.group.ai',
    defaultOpen: true,
    items: [
      { href: '/dashboard/agents', key: 'nav.agents', icon: '🤖' },
      { href: '/dashboard/prompt-studio', key: 'nav.promptStudio', icon: '📝' },
      { href: '/dashboard/flows', key: 'nav.flows', icon: '🧠' },
      { href: '/dashboard/templates', key: 'nav.templates', icon: '🧩' },
    ],
  },
  {
    labelKey: 'nav.group.analytics',
    defaultOpen: false,
    items: [
      { href: '/dashboard/dora', key: 'nav.dora', icon: '📈', children: [
        { href: '/dashboard/dora', key: 'nav.doraOverview', icon: '📊' },
        { href: '/dashboard/dora/project', key: 'nav.doraProject', icon: '📋' },
        { href: '/dashboard/dora/development', key: 'nav.doraDev', icon: '⚡' },
        { href: '/dashboard/dora/quality', key: 'nav.doraQuality', icon: '🛡' },
        { href: '/dashboard/dora/bugs', key: 'nav.doraBugs', icon: '🐛' },
        { href: '/dashboard/dora/team', key: 'nav.doraTeam', icon: '👥' },
      ]},
    ],
  },
  {
    labelKey: 'nav.group.settings',
    defaultOpen: false,
    items: [
      { href: '/dashboard/mappings', key: 'nav.mappings', icon: '🔗' },
      { href: '/dashboard/integrations', key: 'nav.integrations', icon: '🔌', permission: 'integrations:manage' as const },
      { href: '/dashboard/team', key: 'nav.team', icon: '👥', permission: 'team:manage' as const },
      { href: '/dashboard/permissions', key: 'nav.permissions', icon: '🛡', permission: 'roles:manage' as const },
    ],
  },
];

// Flat list for backward compat (tourAttr, etc.)
const PRIMARY_NAV_KEYS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);


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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const notifBellRef = useRef<HTMLButtonElement>(null);
  const [userRole, setUserRole] = useState<Role>('viewer');
  const [orgSlug, setOrgSlugState] = useState('');
  const [orgNameDisplay, setOrgNameDisplay] = useState('');
  const [expandedNav, setExpandedNav] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [taskBadges, setTaskBadges] = useState<Record<string, number>>({});
  const [hasRunningTasks, setHasRunningTasks] = useState(false);
  const shouldOpenOnboarding = searchParams.get('onboarding') === '1' || searchParams.get('welcome') === '1';
  const lastUnreadRef = useRef<number | null>(null);
  const sidebarWidth = sidebarCollapsed ? 76 : 220;
  const navTooltipMap: Record<string, Parameters<typeof t>[0]> = {
    'nav.overview': 'tooltip.nav.overview',
    'nav.office': 'tooltip.nav.office',
    'nav.tasks': 'tooltip.nav.tasks',
    'nav.sprints': 'tooltip.nav.sprints',
    'nav.sprintPerformance': 'tooltip.nav.sprintPerformance',
    'nav.refinement': 'tooltip.nav.refinement',
    'nav.team': 'tooltip.nav.team',
    'nav.agents': 'tooltip.nav.agents',
    'nav.promptStudio': 'tooltip.nav.promptStudio',
    'nav.flows': 'tooltip.nav.flows',
    'nav.templates': 'tooltip.nav.templates',
    'nav.mappings': 'tooltip.nav.mappings',
    'nav.dora': 'tooltip.nav.dora',
    'nav.doraOverview': 'tooltip.nav.doraOverview',
    'nav.doraProject': 'tooltip.nav.doraProject',
    'nav.doraDev': 'tooltip.nav.doraDev',
    'nav.doraQuality': 'tooltip.nav.doraQuality',
    'nav.doraBugs': 'tooltip.nav.doraBugs',
    'nav.doraTeam': 'tooltip.nav.doraTeam',
    'nav.integrations': 'tooltip.nav.integrations',
    'nav.permissions': 'tooltip.nav.permissions',
    'nav.notifications': 'tooltip.nav.notifications',
    'nav.usage': 'tooltip.nav.usage',
    'nav.profile': 'tooltip.nav.profile',
  };
  const navTooltip = (key: string) => t((navTooltipMap[key] || key) as Parameters<typeof t>[0]);
  const tourTargetMap: Record<string, string> = {
    'nav.overview': 'nav-overview',
    'nav.office': 'nav-office',
    'nav.tasks': 'nav-tasks',
    'nav.sprints': 'nav-sprints',
    'nav.agents': 'nav-agents',
    'nav.flows': 'nav-flows',
    'nav.integrations': 'nav-integrations',
    'nav.dora': 'nav-dora',
    'nav.notifications': 'nav-notifications',
  };
  const tourAttr = (key: string) => tourTargetMap[key] || undefined;

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileSidebarOpen(false); }, [pathname]);

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    function handleClick(e: MouseEvent) {
      const bell = notifBellRef.current;
      if (bell && bell.contains(e.target as Node)) return;
      const dropdown = (e.target as HTMLElement).closest('[data-notif-dropdown]');
      if (dropdown) return;
      setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [notifOpen]);

  // Clear task badges when visiting tasks page
  useEffect(() => {
    if (pathname.startsWith('/dashboard/tasks')) {
      const current = localStorage.getItem('agena_task_current_counts');
      if (current) localStorage.setItem('agena_task_seen_counts', current);
      setTaskBadges({});
    }
  }, [pathname]);

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

      apiFetch<{ full_name?: string; email: string; org_slug?: string; org_name?: string }>('/auth/me').then((u) => {
        if (!active) return;
        setUserName(u.full_name || u.email);
        // Store org slug/name from the /me response
        if (u.org_slug) { setOrgSlugState(u.org_slug); setOrgSlug(u.org_slug); }
        if (u.org_name) { setOrgNameDisplay(u.org_name); setOrgName(u.org_name); }
        // Fetch current user's role from org members list
        apiFetch<Array<{ email: string; role: string }>>('/org/members').then((members) => {
          if (!active) return;
          const me = members.find((m) => m.email === u.email);
          if (me) setUserRole(me.role as Role);
        }).catch(() => {});
      }).catch(() => {});

      // Fetch task counts and compute unseen badges
      apiFetch<Array<{ status: string }>>('/tasks').then((tasks) => {
        if (!active) return;
        const counts: Record<string, number> = {};
        for (const tk of tasks) counts[tk.status] = (counts[tk.status] || 0) + 1;
        // Compare with last seen
        const seenRaw = localStorage.getItem('agena_task_seen_counts');
        const seen: Record<string, number> = seenRaw ? JSON.parse(seenRaw) : {};
        const badges: Record<string, number> = {};
        for (const [status, count] of Object.entries(counts)) {
          const diff = count - (seen[status] || 0);
          if (diff > 0) badges[status] = diff;
        }
        setTaskBadges(badges);
        setHasRunningTasks((counts['running'] || 0) > 0 || (counts['queued'] || 0) > 0);
        // Store current counts so we can diff next time
        localStorage.setItem('agena_task_current_counts', JSON.stringify(counts));
      }).catch(() => {});

      // Initialize org info from localStorage in case /me hasn't responded yet
      setOrgSlugState(getOrgSlug());
      setOrgNameDisplay(getOrgName());

      if (typeof window !== 'undefined' && 'Notification' in window) {
        setNotifPermission(Notification.permission);
      }
      try {
        const prefs = await loadPrefs();
        const raw = (prefs.profile_settings || {}) as Record<string, unknown>;
        setProfileSettings(raw);
        setWebPushEnabled(raw.web_push_notifications !== false);
        // Auto-redirect to onboarding if not completed (skip if already on onboarding page)
        if (!raw.onboarding_completed && !pathname.startsWith('/dashboard/onboarding')) {
          // Check if user already has integrations — if so, skip onboarding
          try {
            const integrations = await apiFetch<Array<{ has_secret: boolean; base_url?: string | null }>>('/integrations');
            const hasIntegration = integrations.some((cfg) => cfg.has_secret || Boolean(cfg.base_url));
            if (hasIntegration) {
              // Mark onboarding as completed silently
              const nextProfile = { ...raw, onboarding_completed: true };
              setProfileSettings(nextProfile);
              await savePrefs({ profile_settings: nextProfile });
            } else {
              router.replace('/dashboard/onboarding');
              return;
            }
          } catch {
            router.replace('/dashboard/onboarding');
            return;
          }
        }
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
    if (typeof window === 'undefined') return;
    const onSync = (evt: Event) => {
      const detail = (evt as CustomEvent<{ unread?: number }>).detail || {};
      if (typeof detail.unread === 'number') {
        const next = Math.max(0, detail.unread);
        setUnreadCount(next);
        localStorage.setItem(LS_UNREAD_KEY, String(next));
        lastUnreadRef.current = next;
      } else {
        void refreshNotifications(8);
      }
    };
    window.addEventListener(NOTIF_SYNC_EVENT, onSync as EventListener);
    return () => window.removeEventListener(NOTIF_SYNC_EVENT, onSync as EventListener);
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
    <RoleContext.Provider value={{ role: userRole }}>
    <div style={{ display: 'flex', minHeight: '100vh', paddingTop: 72 }}>
      {/* Mobile sidebar toggle — fixed in top-left, below navbar */}
      <button
        className='dashboard-sidebar-toggle'
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        style={{
          display: 'none', position: 'fixed', top: 126, left: 6, zIndex: 60,
          width: 32, height: 32, borderRadius: 8,
          border: '1px solid var(--panel-border-3)', background: 'var(--surface)',
          color: 'var(--ink-58)', cursor: 'pointer',
          alignItems: 'center', justifyContent: 'center', fontSize: 15,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {mobileSidebarOpen ? '✕' : '☰'}
      </button>
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className='dashboard-sidebar-overlay'
          onClick={() => setMobileSidebarOpen(false)}
          style={{ display: 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 49 }}
        />
      )}
      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${mobileSidebarOpen ? 'mobile-open' : ''}`} style={{
        width: sidebarWidth, flexShrink: 0,
        borderRight: '1px solid var(--panel-border)',
        background: 'var(--glass)', backdropFilter: 'blur(20px)',
        position: 'fixed', top: 72, bottom: 0, left: 0,
        display: 'flex', flexDirection: 'column',
        padding: '24px 12px', zIndex: 50,
        overflowY: 'auto', overflowX: 'hidden',
        transition: 'width 0.2s ease, transform 0.2s ease',
      }}>
        <button
          onClick={toggleSidebar}
          title={sidebarCollapsed ? t('notifications.expandSidebar') : t('notifications.collapseSidebar')}
          style={{
            alignSelf: sidebarCollapsed ? 'center' : 'flex-end',
            width: 28,
            height: 28,
            borderRadius: 8,
            border: '1px solid var(--panel-border-3)',
            background: 'var(--glass)',
            color: 'var(--ink)',
            cursor: 'pointer',
            marginBottom: 10,
          }}
        >
          {sidebarCollapsed ? '→' : '←'}
        </button>
        {/* Organization info */}
        {!sidebarCollapsed && (orgNameDisplay || orgSlug) && (
          <div style={{ padding: '8px 12px', marginBottom: 8, borderRadius: 10, background: 'rgba(13,148,136,0.08)', border: '1px solid rgba(13,148,136,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {orgNameDisplay || orgSlug}
            </div>
            {orgSlug && (
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>
                {orgSlug}.agena.app
              </div>
            )}
          </div>
        )}
        {sidebarCollapsed && orgSlug && (
          <div title={`${t('tooltip.action.workspaceSlug')}: ${orgNameDisplay || orgSlug} (${orgSlug}.agena.app)`} style={{ textAlign: 'center', marginBottom: 8, fontSize: 14, fontWeight: 800, color: 'var(--nav-active)' }}>
            {(orgNameDisplay || orgSlug)[0]?.toUpperCase()}
          </div>
        )}

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_GROUPS.map((group) => {
            const visibleItems = group.items.filter((item) => !item.permission || canAccess(userRole, item.permission as Parameters<typeof canAccess>[1]));
            if (!visibleItems.length) return null;
            const groupHasActive = visibleItems.some((item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)));
            const isGroupOpen = groupHasActive || (collapsedGroups[group.labelKey] !== undefined ? !collapsedGroups[group.labelKey] : (group.defaultOpen ?? true));
            return (
              <div key={group.labelKey} style={{ marginBottom: 4 }}>
                {!sidebarCollapsed && (
                  <button
                    onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.labelKey]: isGroupOpen }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                      fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: 'var(--muted)',
                      textTransform: 'uppercase', padding: '6px 12px', marginBottom: 2,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 8, transition: 'transform 0.2s', transform: isGroupOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                    {t(group.labelKey as Parameters<typeof t>[0])}
                  </button>
                )}
                {(sidebarCollapsed || isGroupOpen) && visibleItems.map((item) => {
            if (item.children) {
              const sectionActive = pathname.startsWith(item.href);
              const isExpanded = sectionActive || expandedNav === item.key;
              return (
                <div key={item.href}>
                  <button
                    onClick={() => setExpandedNav(isExpanded && !sectionActive ? null : item.key)}
                    title={navTooltip(item.key)}
                    data-tour={tourAttr(item.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: sidebarCollapsed ? '9px 10px' : '9px 12px', borderRadius: 10, fontSize: 14,
                      fontWeight: sectionActive ? 600 : 400,
                      color: sectionActive ? 'var(--nav-active)' : 'var(--muted)',
                      background: sectionActive ? 'var(--nav-active-bg)' : 'transparent',
                      border: sectionActive ? '1px solid var(--nav-active-border)' : '1px solid transparent',
                      transition: 'all 0.2s', cursor: 'pointer', justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    }}
                  >
                    <span style={{ fontSize: 16, opacity: sectionActive ? 1 : 0.5 }}>{item.icon}</span>
                    {!sidebarCollapsed && t(item.key as Parameters<typeof t>[0])}
                    {!sidebarCollapsed && <span style={{ marginLeft: 'auto', fontSize: 10, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>}
                  </button>
                  {isExpanded && !sidebarCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingLeft: 18, marginTop: 2 }}>
                      {item.children.map((child) => {
                        const childActive = child.href === '/dashboard/dora'
                          ? pathname === '/dashboard/dora'
                          : pathname.startsWith(child.href);
                        return (
                          <Link key={child.key} href={child.href} title={navTooltip(child.key)} style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '7px 10px', borderRadius: 8, fontSize: 13,
                            fontWeight: childActive ? 600 : 400,
                            color: childActive ? 'var(--nav-active)' : 'var(--muted)',
                            background: childActive ? 'var(--nav-active-bg)' : 'transparent',
                            border: childActive ? '1px solid var(--nav-active-border)' : '1px solid transparent',
                            transition: 'all 0.2s', textDecoration: 'none',
                          }}>
                            <span style={{ fontSize: 14, opacity: childActive ? 1 : 0.5 }}>{child.icon}</span>
                            {t(child.key as Parameters<typeof t>[0])}
                            {childActive && <span style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: 'var(--nav-active)' }} />}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} title={navTooltip(item.key)} data-tour={tourAttr(item.key)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: sidebarCollapsed ? '9px 10px' : '9px 12px', borderRadius: 10, fontSize: 14,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--nav-active)' : 'var(--muted)',
                background: active ? 'var(--nav-active-bg)' : (item.href === '/dashboard/tasks' && hasRunningTasks) ? 'rgba(56,189,248,0.04)' : 'transparent',
                border: active ? '1px solid var(--nav-active-border)' : (item.href === '/dashboard/tasks' && hasRunningTasks) ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent',
                animation: (item.href === '/dashboard/tasks' && hasRunningTasks && !active) ? 'running-glow-nav 2s ease-in-out infinite' : undefined,
                transition: 'all 0.2s', textDecoration: 'none', justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              }}>
                <span style={{ fontSize: 16, opacity: active ? 1 : 0.5 }}>{item.icon}</span>
                {!sidebarCollapsed && t(item.key as Parameters<typeof t>[0])}
                {!sidebarCollapsed && item.href === '/dashboard/tasks' && (() => {
                  const badges: Array<{ count: number; color: string; bg: string; key: string }> = [];
                  if (taskBadges.running) badges.push({ key: 'running', count: taskBadges.running, color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' });
                  if (taskBadges.queued) badges.push({ key: 'queued', count: taskBadges.queued, color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' });
                  if (taskBadges.failed) badges.push({ key: 'failed', count: taskBadges.failed, color: '#ef4444', bg: 'rgba(239,68,68,0.15)' });
                  if (taskBadges.completed) badges.push({ key: 'completed', count: taskBadges.completed, color: '#22c55e', bg: 'rgba(34,197,94,0.15)' });
                  if (!badges.length) return null;
                  return (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                      {badges.map((b) => (
                        <span key={b.key} style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 6, color: b.color, background: b.bg, lineHeight: '16px' }}>{b.count}</span>
                      ))}
                    </span>
                  );
                })()}
                {active && !sidebarCollapsed && !Object.keys(taskBadges).length && <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--nav-active)' }} />}
              </Link>
            );
          })}
              </div>
            );
          })}
        </nav>

      </aside>

      {/* Top bar */}
      <div className='dashboard-topbar' style={{
        position: 'fixed', top: 72, left: sidebarWidth, right: 0, height: 48, zIndex: 45,
        background: 'var(--glass)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--panel-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '0 20px', gap: 8,
        transition: 'left 0.2s ease',
      }}>
        {/* Usage link */}
        <Link href='/dashboard/usage' title={navTooltip('nav.usage')} data-tour={tourAttr('nav.usage')} style={{
          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: pathname.startsWith('/dashboard/usage') ? 'var(--nav-active-bg)' : 'transparent',
          border: pathname.startsWith('/dashboard/usage') ? '1px solid var(--nav-active-border)' : '1px solid transparent',
          color: pathname.startsWith('/dashboard/usage') ? 'var(--nav-active)' : 'var(--muted)',
          textDecoration: 'none', fontSize: 16, cursor: 'pointer', transition: 'all 0.2s',
        }}>
          📊
        </Link>

        {/* LangToggle */}
        <LangToggle style={{ width: 'auto' }} />

        {/* Notification bell */}
        <button
          ref={notifBellRef}
          onClick={openNotifications}
          title={t('tooltip.action.openNotifications')}
          data-tour={tourAttr('nav.notifications')}
          style={{
            position: 'relative', width: 32, height: 32, borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: notifOpen ? 'var(--nav-active-bg)' : 'transparent',
            border: notifOpen ? '1px solid var(--nav-active-border)' : '1px solid transparent',
            color: 'var(--muted)', cursor: 'pointer', fontSize: 16, transition: 'all 0.2s',
          }}
        >
          🔔
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', right: -4, top: -4,
              minWidth: 16, height: 16, borderRadius: 999,
              background: '#ef4444', color: '#fff',
              fontSize: 10, fontWeight: 800, lineHeight: '16px',
              textAlign: 'center', padding: '0 4px',
            }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Notification dropdown */}
        {notifOpen && (
          <div data-notif-dropdown style={{
            position: 'absolute', top: 48, right: 80, width: 360,
            border: '1px solid var(--border)', background: 'var(--surface)',
            borderRadius: 12, padding: 10, display: 'grid', gap: 8,
            maxHeight: 400, overflow: 'auto', zIndex: 100,
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 700 }}>{t('notifications.recent')}</span>
              <button title={t('tooltip.action.markAllRead')} onClick={() => void markAllReadAndRefresh()} style={{ border: 'none', background: 'transparent', color: 'var(--nav-active)', fontSize: 11, cursor: 'pointer' }}>{t('notifications.markAllRead')}</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                title={t('tooltip.action.filterAllNotifications')}
                onClick={() => setNotifFilter('all')}
                style={{
                  border: '1px solid rgba(57,255,136,0.35)',
                  background: notifFilter === 'all' ? 'rgba(57,255,136,0.16)' : 'var(--glass)',
                  color: notifFilter === 'all' ? '#39ff88' : 'var(--muted)',
                  padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                }}
              >
                {t('notifications.all')}
              </button>
              <button
                title={t('tooltip.action.filterFailedNotifications')}
                onClick={() => setNotifFilter('failed')}
                style={{
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: notifFilter === 'failed' ? 'rgba(239,68,68,0.16)' : 'var(--glass)',
                  color: notifFilter === 'failed' ? '#ef4444' : 'var(--muted)',
                  padding: '4px 8px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                }}
              >
                {t('notifications.group.failures')}
              </button>
            </div>
            {notifLoading ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('notifications.loading')}</div>
            ) : notifications.filter((n) => notifFilter === 'all' || n.severity === 'error' || n.event_type.includes('failed') || n.title.toLowerCase().includes('failed')).length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('notifications.emptyShort')}</div>
            ) : notifications
              .filter((n) => notifFilter === 'all' || n.severity === 'error' || n.event_type.includes('failed') || n.title.toLowerCase().includes('failed'))
              .map((n) => (
              <Link
                key={n.id}
                href={n.task_id ? `/tasks/${n.task_id}` : '/dashboard/tasks'}
                title={t('tooltip.action.openNotification')}
                onClick={() => {
                  if (n.is_read) return;
                  setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
                  setUnreadCount((prev) => {
                    const next = Math.max(0, prev - 1);
                    if (typeof window !== 'undefined') localStorage.setItem(LS_UNREAD_KEY, String(next));
                    return next;
                  });
                  void markNotificationRead(n.id).finally(() => void refreshNotifications(12));
                }}
                style={{ textDecoration: 'none', border: `1px solid ${notifColor(n)}44`, borderLeft: `3px solid ${notifColor(n)}`, borderRadius: 10, padding: '7px 8px', display: 'grid', gap: 3, background: n.is_read ? 'var(--panel)' : `${notifColor(n)}18` }}>
                <div style={{ fontSize: 11, color: 'var(--ink)', fontWeight: 700 }}>{n.title}</div>
                <div style={{ fontSize: 10, color: notifColor(n), textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{n.event_type.replace(/_/g, ' ')}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>{n.message}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(n.created_at).toLocaleString()}</div>
              </Link>
            ))}
            <Link href='/dashboard/notifications' title={t('tooltip.nav.notifications')} style={{ textDecoration: 'none', textAlign: 'center', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--panel-border-3)', color: '#39ff88', fontSize: 12, fontWeight: 700 }}>
              {t('notifications.viewAll')}
            </Link>
          </div>
        )}

        {/* Profile avatar */}
        {userName && (
          <a href="/dashboard/profile" title={`${t('tooltip.action.openProfile')} · ${userName}`} data-tour={tourAttr('nav.profile')} style={{
            display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none',
            padding: '4px 8px', borderRadius: 8, transition: 'background 0.2s', cursor: 'pointer',
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(139,92,246,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
          >
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #0d9488, #22c55e)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
              {userName[0]?.toUpperCase()}
            </div>
            <span className='topbar-username' style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</span>
          </a>
        )}

        {/* Logout */}
        <button onClick={logout} title={t('tooltip.action.logout')} style={{
          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: '1px solid transparent',
          color: 'var(--ink-30)', cursor: 'pointer', fontSize: 14, transition: 'all 0.2s',
        }}>
          ↩
        </button>
      </div>

      {/* Main */}
      <main className='dashboard-main' style={{ flex: 1, marginLeft: sidebarWidth, padding: '32px 40px', paddingTop: 64, minWidth: 0, transition: 'margin-left 0.2s ease' }}>
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
      <GuidedTour />
    </div>
    </RoleContext.Provider>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WebSocketProvider>
      <Suspense fallback={null}>
        <DashboardInner>{children}</DashboardInner>
      </Suspense>
    </WebSocketProvider>
  );
}
