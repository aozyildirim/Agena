'use client';

import { ReactNode } from 'react';
import { usePermissions, useCanDo } from '@/lib/permissions';
import Forbidden from '@/components/Forbidden';

export default function DoraLayout({ children }: { children: ReactNode }) {
  const { orgRole, loading } = usePermissions();
  const canDo = useCanDo();
  if (loading) {
    return <div style={{ padding: 60, color: 'var(--ink-30)', fontSize: 13, textAlign: 'center' }}>…</div>;
  }
  if (orgRole !== 'owner' && orgRole !== 'admin' && !canDo('analytics:read')) {
    return <Forbidden />;
  }
  return <>{children}</>;
}
