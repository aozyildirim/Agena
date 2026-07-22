'use client';

/**
 * NavIcon — monochrome line-icon set for the enterprise dashboard shell.
 *
 * Replaces the previous emoji icons (🏠 📋 🤖 …) which read as consumer /
 * "startup" UI. Every glyph is a 24×24 stroke path that inherits the parent
 * `color` via `currentColor`, so it works in both light and dark mode and
 * picks up the active-nav ink colour automatically — no per-icon theming.
 *
 * Usage:  <NavIcon name="agents" />            (defaults to 16px)
 *         <NavIcon name="bell" size={18} />
 *
 * Unknown names fall back to a neutral dot so the UI never crashes if a nav
 * entry references a glyph that hasn't been drawn yet.
 */

export type IconName =
  | 'home' | 'tasks' | 'sprints' | 'refinement' | 'triage' | 'clock'
  | 'book' | 'terminal' | 'agents' | 'search' | 'insights' | 'flows'
  | 'pencil' | 'box' | 'trending' | 'chart' | 'clipboard' | 'zap'
  | 'shield' | 'bug' | 'users' | 'plug' | 'sliders' | 'signal'
  | 'alert' | 'activity' | 'map' | 'layers' | 'lock' | 'user-check'
  | 'grid' | 'building' | 'mail' | 'send' | 'bell' | 'logout'
  | 'chevron-right' | 'chevron-left' | 'menu' | 'close' | 'plus'
  | 'settings' | 'database' | 'chat' | 'dot';

const PATHS: Record<string, React.ReactNode> = {
  home: <><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9.5h8M8 14.5h5" /></>,
  sprints: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="0" /></>,
  refinement: <><circle cx="11" cy="11" r="6" /><path d="m20 20-3.2-3.2" /></>,
  triage: <><path d="M5 5v14M5 5h11l-2 4 2 4H5" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  book: <><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 0-2 2V4Z" /><path d="M18 6H7" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  agents: <><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M12 4v4M9 13h.01M15 13h.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></>,
  insights: <><path d="M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3Z" /><path d="M9.5 20h5" /></>,
  flows: <><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="12" r="2.5" /><path d="M6 8.5v7M8.4 7.2 15.6 11M8.4 16.8 15.6 13" /></>,
  pencil: <><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>,
  box: <><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" /><path d="m4 7 8 4 8-4M12 11v10" /></>,
  trending: <><path d="M4 17 10 11l4 4 6-7" /><path d="M16 8h4v4" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  clipboard: <><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5V3.5h6V5M9 11h6M9 15h4" /></>,
  zap: <><path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" /></>,
  shield: <><path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /></>,
  bug: <><rect x="8" y="8" width="8" height="11" rx="4" /><path d="M9 5l1.5 2M15 5l-1.5 2M4 12h4M16 12h4M4.5 17H8M16 17h3.5M4.5 8H8M16 8h3.5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.5a3 3 0 0 1 0 5.8M16.5 19a5.5 5.5 0 0 0-3-4.9" /></>,
  plug: <><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" /><path d="M12 17v4" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>,
  signal: <><path d="M5 18a8 8 0 0 1 14 0M8 18a5 5 0 0 1 8 0" /><circle cx="12" cy="18" r="1.5" /></>,
  alert: <><path d="M12 4 3 19h18L12 4Z" /><path d="M12 10v4M12 17h.01" /></>,
  activity: <><path d="M3 12h4l3 7 4-14 3 7h4" /></>,
  map: <><path d="M9 5 4 7v12l5-2 6 2 5-2V5l-5 2-6-2Z" /><path d="M9 5v12M15 7v12" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  'user-check': <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 10 0" /><path d="m15.5 13 2 2 3.5-3.5" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  send: <><path d="M21 4 3 11l7 3 3 7 8-17Z" /><path d="m10 14 4-4" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 7 2 7H4s2-2 2-7Z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  logout: <><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="M9 12h11M16 8l4 4-4 4" /></>,
  'chevron-right': <><path d="m9 5 7 7-7 7" /></>,
  'chevron-left': <><path d="m15 5-7 7 7 7" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6 18 18M18 6 6 18" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" /></>,
  database: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  chat: <><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4V6Z" /><path d="M8 9.5h8M8 13h5" /></>,
  dot: <><circle cx="12" cy="12" r="3" /></>,
};

export default function NavIcon({ name, size = 16 }: { name: string; size?: number }) {
  const path = PATHS[name] ?? PATHS.dot;
  return (
    <span className="nav-ico" aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {path}
      </svg>
    </span>
  );
}
