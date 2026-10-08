'use client';

import { createContext, useContext } from 'react';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type Permission =
  | 'tasks:read'
  | 'tasks:write'
  | 'integrations:manage'
  | 'team:manage'
  | 'billing:manage'
  | 'org:manage'
  | 'roles:manage'
  | 'audit:read';

const PERMISSION_MATRIX: Record<Permission, Set<Role>> = {
  'tasks:read':          new Set(['owner', 'admin', 'member', 'viewer']),
  'tasks:write':         new Set(['owner', 'admin', 'member']),
  'integrations:manage': new Set(['owner', 'admin']),
  'team:manage':         new Set(['owner', 'admin']),
  'billing:manage':      new Set(['owner']),
  'org:manage':          new Set(['owner']),
  'roles:manage':        new Set(['owner', 'admin']),
  'audit:read':          new Set(['owner', 'admin']),
};

export function canAccess(role: Role | string, permission: Permission): boolean {
  const allowed = PERMISSION_MATRIX[permission];
  if (!allowed) return false;
  return allowed.has(role as Role);
}

export interface RoleContextValue {
  role: Role;
}

export const RoleContext = createContext<RoleContextValue>({ role: 'viewer' });

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}
