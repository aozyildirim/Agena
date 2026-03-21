type LogItem = { stage: string; message: string; created_at: string };

const stageColor: Record<string, string> = {
  fetch_context: '#5eead4',
  generate_code: '#a78bfa',
  review_code: '#38bdf8',
  finalize: '#22c55e',
};

export default function AgentTimeline({ logs }: { logs: LogItem[] }) {
  return (
    <div style={{
      borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)',
      background: 'rgba(255,255,255,0.02)', padding: 24,
    }}>
      <h3 style={{ marginTop: 0, color: 'rgba(255,255,255,0.85)', marginBottom: 20 }}>Agent Timeline</h3>
      {logs.length === 0 ? (
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No logs yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: 0 }}>
          {logs.map((log, idx) => {
            const color = stageColor[log.stage] ?? '#5eead4';
            return (
              <div key={idx} style={{ display: 'flex', gap: 16, paddingBottom: idx < logs.length - 1 ? 20 : 0 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}`, marginTop: 3 }} />
                  {idx < logs.length - 1 && <div style={{ width: 1, flex: 1, background: 'rgba(255,255,255,0.06)', marginTop: 4 }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color, marginBottom: 4 }}>{log.stage}</div>
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{log.message}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 4 }}>{new Date(log.created_at).toLocaleString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
