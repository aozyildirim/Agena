'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TasksRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/tasks'); }, [router]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
      Redirecting to dashboard...
    </div>
  );
}
