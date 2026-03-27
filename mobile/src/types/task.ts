export interface TaskItem {
  id: number;
  title: string;
  description: string;
  status: string;
  source: string;
  pr_url?: string | null;
  branch_name?: string | null;
  failure_reason?: string | null;
  last_mode?: string | null;
  created_at: string;
  duration_sec?: number | null;
  run_duration_sec?: number | null;
}

export interface TaskLogItem {
  id: number;
  stage: string;
  message: string;
  created_at: string;
}
