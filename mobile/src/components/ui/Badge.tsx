import { View, Text, StyleSheet } from 'react-native';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
  running: { bg: 'rgba(56,189,248,0.15)', text: '#38bdf8' },
  queued: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b' },
  failed: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  cancelled: { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' },
};

export default function Badge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.cancelled;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.text }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  text: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
});
