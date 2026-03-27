import { API_BASE_URL } from '../config/env';
import { getToken, getOrgSlug, removeToken } from '../utils/storage';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  const slug = await getOrgSlug();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (slug) headers['X-Tenant-Slug'] = slug;

  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const text = await res.text().catch(() => '');
    if (
      text.includes('Invalid token') ||
      text.includes('Invalid auth context') ||
      text.includes('User not found')
    ) {
      await removeToken();
      onUnauthorized?.();
    }
    throw new ApiError(text || 'Unauthorized', 401);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text || `HTTP ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}
