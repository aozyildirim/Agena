'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'agena_dora_period_days';
const VALID = [30, 90, 180, 365];
const DEFAULT_DAYS = 90;

/**
 * Sticky DORA period preference shared across the hub and subpages.
 * Stored in localStorage so the user only picks once.
 */
export function useDoraPeriodDays(): [number, (next: number) => void] {
  const [days, setDays] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_DAYS;
    const saved = Number(window.localStorage.getItem(STORAGE_KEY) || 0);
    return saved && VALID.includes(saved) ? saved : DEFAULT_DAYS;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(days));
    }
  }, [days]);
  return [days, setDays];
}
