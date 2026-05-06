'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, isLoggedIn } from '@/lib/api';

type MeResponse = {
  user_id: number;
  email: string;
  full_name: string;
  organization_id: number;
  org_slug: string;
  org_name: string;
  is_platform_admin: boolean;
  org_role: string;
  permissions: string[];
};

type PermissionsCtx = {
  permissions: Set<string>;
  orgRole: string;
  loading: boolean;
  refresh: () => Promise<void>;
  canDo: (perm: string) => boolean;
};

const Ctx = createContext<PermissionsCtx>({
  permissions: new Set(),
  orgRole: 'member',
  loading: true,
  refresh: async () => {},
  canDo: () => true, // graceful degradation if provider missing
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [orgRole, setOrgRole] = useState<string>('member');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isLoggedIn()) {
      setPermissions(new Set());
      setOrgRole('member');
      setLoading(false);
      return;
    }
    try {
      const me = await apiFetch<MeResponse>('/auth/me');
      setPermissions(new Set(me.permissions || []));
      setOrgRole(me.org_role || 'member');
    } catch {
      // /auth/me failed — keep previous state, just stop loading
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-fetch permissions when the active workspace changes
  useEffect(() => {
    function handler() { void refresh(); }
    window.addEventListener('agena:workspace-changed', handler);
    return () => window.removeEventListener('agena:workspace-changed', handler);
  }, [refresh]);

  const canDo = useCallback((perm: string) => {
    // Org owner shortcut — backend would also allow, but the UI shouldn't
    // wait on /auth/me to render owner-only buttons.
    if (orgRole === 'owner') return true;
    return permissions.has(perm);
  }, [permissions, orgRole]);

  return <Ctx.Provider value={{ permissions, orgRole, loading, refresh, canDo }}>{children}</Ctx.Provider>;
}

export function usePermissions(): PermissionsCtx {
  return useContext(Ctx);
}

export function useCanDo(): (perm: string) => boolean {
  return useContext(Ctx).canDo;
}
