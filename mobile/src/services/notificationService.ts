import { apiFetch } from './apiClient';
import type { NotificationItem } from '../types/notification';

export async function listNotifications(): Promise<NotificationItem[]> {
  return apiFetch<NotificationItem[]>('/notifications');
}

export async function markRead(id: number): Promise<void> {
  await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllRead(): Promise<void> {
  await apiFetch('/notifications/read-all', { method: 'POST' });
}
