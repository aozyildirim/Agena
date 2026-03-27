export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  severity: string;
  is_read: boolean;
  task_id?: number | null;
  created_at: string;
}
