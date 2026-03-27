import { apiFetch } from './apiClient';
import type { TaskItem, TaskLogItem } from '../types/task';

export async function listTasks(): Promise<TaskItem[]> {
  return apiFetch<TaskItem[]>('/tasks');
}

export async function getTask(id: number): Promise<TaskItem> {
  return apiFetch<TaskItem>(`/tasks/${id}`);
}

export async function getTaskLogs(id: number): Promise<TaskLogItem[]> {
  return apiFetch<TaskLogItem[]>(`/tasks/${id}/logs`);
}

export async function assignTask(
  id: number,
  options: { mode?: string; create_pr?: boolean } = {},
): Promise<void> {
  await apiFetch(`/tasks/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify({ mode: options.mode || 'ai', create_pr: options.create_pr ?? false }),
  });
}

export async function cancelTask(id: number): Promise<void> {
  await apiFetch(`/tasks/${id}/cancel`, { method: 'POST' });
}
