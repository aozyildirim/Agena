import { useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { useTaskStore } from '../../stores/taskStore';
import { useAuthStore } from '../../stores/authStore';
import { useLocale } from '../../i18n';
import { timeAgo } from '../../utils/dateFormat';

export default function DashboardScreen() {
  const { t, lang } = useLocale();
  const user = useAuthStore((s) => s.user);
  const { tasks, loading, fetchTasks } = useTaskStore();
  const navigation = useNavigation<any>();

  useEffect(() => { void fetchTasks(); }, []);

  const onRefresh = useCallback(() => { void fetchTasks(); }, []);

  const counts = {
    total: tasks.length,
    running: tasks.filter((tk) => tk.status === 'running').length,
    completed: tasks.filter((tk) => tk.status === 'completed').length,
    failed: tasks.filter((tk) => tk.status === 'failed').length,
    queued: tasks.filter((tk) => tk.status === 'queued').length,
  };

  const kpis: Array<{ label: string; value: number; color: string }> = [
    { label: t('dashboard.totalTasks'), value: counts.total, color: '#a78bfa' },
    { label: t('dashboard.running'), value: counts.running, color: '#38bdf8' },
    { label: t('dashboard.completed'), value: counts.completed, color: '#22c55e' },
    { label: t('dashboard.failed'), value: counts.failed, color: '#ef4444' },
  ];

  const recent = tasks.slice(0, 8);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#5eead4" />}>

      <Text style={styles.greeting}>{user?.full_name || user?.email || ''}</Text>
      <Text style={styles.title}>{t('dashboard.title')}</Text>

      {/* KPI Grid */}
      <View style={styles.kpiGrid}>
        {kpis.map((kpi) => (
          <Card key={kpi.label} style={styles.kpiCard}>
            <Text style={[styles.kpiValue, { color: kpi.color }]}>{kpi.value}</Text>
            <Text style={styles.kpiLabel}>{kpi.label}</Text>
          </Card>
        ))}
      </View>

      {/* Recent Tasks */}
      <Text style={styles.sectionTitle}>{t('dashboard.recentTasks')}</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>{t('dashboard.noTasks')}</Text>
      ) : (
        recent.map((task) => (
          <TouchableOpacity key={task.id} onPress={() => navigation.navigate('Tasks', { screen: 'TaskDetail', params: { taskId: task.id } })} activeOpacity={0.7}>
            <Card style={styles.taskRow}>
              <View style={styles.taskHeader}>
                <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
                <Badge status={task.status} />
              </View>
              <Text style={styles.taskMeta}>#{task.id} · {timeAgo(task.created_at, lang)}</Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  content: { padding: 20 },
  greeting: { fontSize: 13, color: '#666', marginBottom: 2 },
  title: { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 20 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  kpiCard: { width: '47%', alignItems: 'center', paddingVertical: 20 },
  kpiValue: { fontSize: 32, fontWeight: '900' },
  kpiLabel: { fontSize: 11, color: '#888', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  empty: { color: '#555', fontSize: 14, textAlign: 'center', padding: 40 },
  taskRow: { marginBottom: 8 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#ddd', flex: 1 },
  taskMeta: { fontSize: 11, color: '#666', marginTop: 4 },
});
