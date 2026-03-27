import { create } from 'zustand';
import * as taskService from '../services/taskService';
import type { TaskItem, TaskLogItem } from '../types/task';

interface TaskState {
  tasks: TaskItem[];
  loading: boolean;
  selectedTask: TaskItem | null;
  selectedLogs: TaskLogItem[];
  logsLoading: boolean;
  fetchTasks: () => Promise<void>;
  fetchTask: (id: number) => Promise<void>;
  fetchLogs: (id: number) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  selectedTask: null,
  selectedLogs: [],
  logsLoading: false,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const tasks = await taskService.listTasks();
      set({ tasks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchTask: async (id) => {
    try {
      const task = await taskService.getTask(id);
      set({ selectedTask: task });
    } catch { /* silent */ }
  },

  fetchLogs: async (id) => {
    set({ logsLoading: true, selectedLogs: [] });
    try {
      const logs = await taskService.getTaskLogs(id);
      set({ selectedLogs: logs, logsLoading: false });
    } catch {
      set({ logsLoading: false });
    }
  },
}));
