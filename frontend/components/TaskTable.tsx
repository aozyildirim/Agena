import Link from 'next/link';
import StatusBadge from './StatusBadge';

export type TaskItem = {
  id: number;
  title: string;
  description: string;
  source: string;
  status: string;
  pr_url?: string | null;
  duration_sec?: number | null;
  total_tokens?: number | null;
};

type Props = {
  tasks: TaskItem[];
  onAssign: (taskId: number) => void;
};

export default function TaskTable({ tasks, onAssign }: Props) {
  return (
    <div className='card'>
      <h3 style={{ marginTop: 0 }}>Agent Task Feed</h3>
      <div className='table-shell' style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>Task</th>
              <th>Source</th>
              <th>Status</th>
              <th>PR</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} style={{ borderTop: '1px solid #dde9e6' }}>
                <td>
                  <div style={{ fontWeight: 700 }}>{task.title}</div>
                  <div style={{ color: '#587376', fontSize: 13 }}>{task.description}</div>
                </td>
                <td>
                  <span className='chip' style={{ textTransform: 'capitalize' }}>
                    {task.source}
                  </span>
                </td>
                <td>
                  <StatusBadge status={task.status} />
                </td>
                <td>
                  {task.pr_url ? (
                    <a href={task.pr_url} target='_blank' rel='noreferrer'>
                      View PR
                    </a>
                  ) : (
                    <span style={{ color: '#587376' }}>-</span>
                  )}
                </td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button className='button button-primary' onClick={() => onAssign(task.id)}>
                    Assign to AI
                  </button>
                  <Link href={'/tasks/' + task.id} className='button button-outline'>
                    Details
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
