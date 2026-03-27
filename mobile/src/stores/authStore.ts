import { create } from 'zustand';
import { setToken, removeToken, setOrgSlug, getToken, getOrgSlug } from '../utils/storage';
import { setOnUnauthorized } from '../services/apiClient';
import * as authService from '../services/authService';
import type { MeResponse } from '../types/auth';

interface AuthState {
  token: string | null;
  user: MeResponse | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, fullName: string, password: string, orgName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // Register unauthorized handler
  setOnUnauthorized(() => {
    set({ token: null, user: null, isAuthenticated: false });
  });

  return {
    token: null,
    user: null,
    isAuthenticated: false,
    loading: true,

    login: async (email, password) => {
      const res = await authService.login({ email, password });
      await setToken(res.access_token);
      if (res.org_slug) await setOrgSlug(res.org_slug);
      const user: MeResponse = {
        user_id: res.user_id,
        email: res.email,
        full_name: res.full_name,
        organization_id: res.organization_id,
        org_slug: res.org_slug,
        org_name: res.org_name,
      };
      set({ token: res.access_token, user, isAuthenticated: true });
    },

    signup: async (email, fullName, password, orgName) => {
      const res = await authService.signup({ email, full_name: fullName, password, organization_name: orgName });
      await setToken(res.access_token);
      if (res.org_slug) await setOrgSlug(res.org_slug);
      const user: MeResponse = {
        user_id: res.user_id,
        email: res.email,
        full_name: res.full_name,
        organization_id: res.organization_id,
        org_slug: res.org_slug,
        org_name: res.org_name,
      };
      set({ token: res.access_token, user, isAuthenticated: true });
    },

    logout: async () => {
      await removeToken();
      set({ token: null, user: null, isAuthenticated: false });
    },

    loadSession: async () => {
      const token = await getToken();
      if (!token) {
        set({ loading: false });
        return;
      }
      try {
        const user = await authService.getMe();
        const slug = await getOrgSlug();
        if (!slug && user.org_slug) await setOrgSlug(user.org_slug);
        set({ token, user, isAuthenticated: true, loading: false });
      } catch {
        await removeToken();
        set({ token: null, user: null, isAuthenticated: false, loading: false });
      }
    },
  };
});
