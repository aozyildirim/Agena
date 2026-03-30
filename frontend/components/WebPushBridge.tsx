'use client';

import { useEffect, useRef } from 'react';
import { apiFetch, loadPrefs } from '@/lib/api';

type TaskLite = {
  id: number;
  title: string;
  status: string;
};

const LS_STATUS_KEY = 'agena_last_task_status_map';
const NOTIF_EVENT = 'agena:notification';

function loadLastMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_STATUS_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveLastMap(map: Record<string, string>): void {
  localStorage.setItem(LS_STATUS_KEY, JSON.stringify(map));
}

function playNotificationTone(): void {
  if (typeof window === 'undefined') return;
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
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
    window.setTimeout(() => void ctx.close(), 320);
  } catch {
    // no-op
  }
}

export default function WebPushBridge() {
  const initialized = useRef(false);
  const enabledRef = useRef(true);

  useEffect(() => {
    loadPrefs().then((prefs) => {
      const profile = (prefs.profile_settings || {}) as Record<string, unknown>;
      enabledRef.current = profile.web_push_notifications !== false;
      if (enabledRef.current && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || !enabledRef.current) return;
      try {
        const res = await apiFetch<{ items: TaskLite[]; total: number; page: number; page_size: number }>('/tasks/search?page=1&page_size=25');
        const items = res.items || [];
        const prev = loadLastMap();
        const next: Record<string, string> = {};
        for (const t of items) {
          const id = String(t.id);
          const old = prev[id];
          next[id] = t.status;
          if (!initialized.current) continue;
          if (old === t.status) continue;
          if (t.status !== 'completed' && t.status !== 'failed') continue;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(NOTIF_EVENT, { detail: { taskId: t.id, status: t.status, title: t.title } }));
          }
          playNotificationTone();
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            const prefix = t.status === 'completed' ? 'Completed' : 'Failed';
            new Notification(`Task ${prefix}`, { body: `#${t.id} ${t.title}` });
          }
        }
        saveLastMap({ ...prev, ...next });
        initialized.current = true;
      } catch {
        // no-op
      }
    };

    void poll();
    const iv = setInterval(() => void poll(), 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  return null;
}
