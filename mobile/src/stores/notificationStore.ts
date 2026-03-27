import { create } from 'zustand';
import * as notifService from '../services/notificationService';
import type { NotificationItem } from '../types/notification';

interface NotifState {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  fetch: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotifState>((set, get) => ({
  items: [],
  unreadCount: 0,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const items = await notifService.listNotifications();
      set({ items, unreadCount: items.filter((n) => !n.is_read).length, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  markRead: async (id) => {
    await notifService.markRead(id);
    const items = get().items.map((n) => (n.id === id ? { ...n, is_read: true } : n));
    set({ items, unreadCount: items.filter((n) => !n.is_read).length });
  },

  markAllRead: async () => {
    await notifService.markAllRead();
    const items = get().items.map((n) => ({ ...n, is_read: true }));
    set({ items, unreadCount: 0 });
  },
}));
