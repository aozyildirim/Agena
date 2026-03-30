'use client';

import { createContext, useContext, ReactNode, useState, useEffect } from 'react';

const TENANT_SLUG_KEY = 'agena_tenant_slug';
const TENANT_NAME_KEY = 'agena_tenant_name';

/**
 * Extract the tenant slug from the current hostname.
 * e.g. "acme.agena.app" -> "acme", "localhost" -> null
 */
export function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  // Need at least 3 parts for a subdomain (e.g. acme.agena.app)
  if (parts.length < 3) return null;
  const sub = parts[0];
  // Ignore common non-tenant subdomains
  if (['www', 'localhost', 'api'].includes(sub)) return null;
  // Ignore IP addresses
  if (/^\d+$/.test(sub)) return null;
  return sub;
}

/**
 * Get the tenant slug from URL subdomain or localStorage fallback.
 */
export function getEffectiveTenantSlug(): string | null {
  return getTenantSlug() || (typeof window !== 'undefined' ? localStorage.getItem(TENANT_SLUG_KEY) : null);
}

interface TenantContextValue {
  slug: string | null;
  orgName: string | null;
  setTenant: (slug: string, orgName?: string) => void;
}

const TenantContext = createContext<TenantContextValue>({
  slug: null,
  orgName: null,
  setTenant: () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    // Try to detect from subdomain first, then localStorage
    const detected = getTenantSlug();
    const stored = localStorage.getItem(TENANT_SLUG_KEY);
    const storedName = localStorage.getItem(TENANT_NAME_KEY);
    setSlug(detected || stored);
    setOrgName(storedName);
  }, []);

  function setTenant(newSlug: string, newOrgName?: string) {
    setSlug(newSlug);
    if (typeof window !== 'undefined') {
      localStorage.setItem(TENANT_SLUG_KEY, newSlug);
      if (newOrgName) {
        localStorage.setItem(TENANT_NAME_KEY, newOrgName);
        setOrgName(newOrgName);
      }
    }
  }

  return (
    <TenantContext.Provider value={{ slug, orgName, setTenant }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}

/**
 * In production, redirect the user to their org's subdomain if they're
 * on the bare domain (agena.dev) or wrong subdomain.
 * On localhost, this is a no-op (subdomains don't work locally).
 */
export function redirectToTenantSubdomain(slug: string): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  // Skip on localhost / IP — subdomains don't work
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return false;

  const currentSlug = getTenantSlug();
  if (currentSlug === slug) return false; // already on correct subdomain

  // Build the target URL: slug.domain.tld
  const parts = hostname.split('.');
  // Remove existing subdomain if any (e.g. wrong-slug.agena.dev → agena.dev)
  const baseDomain = parts.length >= 3 ? parts.slice(1).join('.') : hostname;
  const port = window.location.port ? `:${window.location.port}` : '';
  const target = `${window.location.protocol}//${slug}.${baseDomain}${port}${window.location.pathname}`;
  window.location.href = target;
  return true; // redirect initiated
}
