'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import AgentTimeline from '@/components/AgentTimeline';
import StatusBadge from '@/components/StatusBadge';

type TaskDetail = {
  id: number;
  title: string;
  description: string;
  source: string;
  status: string;
  pr_url?: string | null;
  created_at: string;
};

type TaskLog = {
  stage: string;
  message: string;
  created_at: string;
};

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const taskId = params.id;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [error, setError] = useState('');

  async function loadData() {
    try {
      const [taskData, logsData] = await Promise.all([
        apiFetch<TaskDetail>('/tasks/' + taskId),
        apiFetch<TaskLog[]>('/tasks/' + taskId + '/logs'),
      ]);
      setTask(taskData);
      setLogs(logsData);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task');
    }
  }

  useEffect(() => {
    if (!taskId) return;
    void loadData();
    const interval = setInterval(() => void loadData(), 5000);
    return () => clearInterval(interval);
  }, [taskId]);

  return (
    <div className='grid'>
      <section className='card'>
        <h1 style={{ marginTop: 0 }}>{task?.title ?? 'Task'}</h1>
        {task ? (
          <>
            <p>{task.description}</p>
            <StatusBadge status={task.status} />
            <p style={{ color: '#667085', textTransform: 'capitalize' }}>Source: {task.source}</p>
            <p style={{ color: '#667085' }}>Created: {new Date(task.created_at).toLocaleString()}</p>
            {task.pr_url ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={task.pr_url} target='_blank' rel='noreferrer' className='button button-outline'>
                  Open Pull Request
                </a>
                <button
                  className='button button-outline'
                  onClick={() => navigator.clipboard.writeText(task.pr_url ?? '')}
                >
                  Share PR Link
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      </section>

      <AgentTimeline logs={logs} />
    </div>
  );
}
