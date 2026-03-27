import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { useTaskStore } from '../../stores/taskStore';
import { useLocale } from '../../i18n';
import { timeAgo } from '../../utils/dateFormat';
import * as taskService from '../../services/taskService';

const STAGE_COLORS: Record<string, string> = {
  agent: '#a78bfa', running: '#38bdf8', completed: '#22c55e', failed: '#ef4444',
  code_ready: '#5eead4', code_preview: '#5eead4', code_diff: '#5eead4',
  pr: '#f59e0b', queued: '#f59e0b', memory_impact: '#888',
};

export default function TaskDetailScreen({ route }: { route: { params: { taskId: number } } }) {
  const { t, lang } = useLocale();
  const { selectedTask, selectedLogs, logsLoading, fetchTask, fetchLogs } = useTaskStore();
  const [actionLoading, setActionLoading] = useState('');
  const taskId = route.params.taskId;

  useEffect(() => {
    void fetchTask(taskId);
    void fetchLogs(taskId);
  }, [taskId]);

  const handleAssign = async () => {
    setActionLoading('assign');
    try {
      await taskService.assignTask(taskId, { mode: selectedTask?.last_mode || 'ai' });
      await fetchTask(taskId);
    } catch { /* */ }
    setActionLoading('');
  };

  const handleCancel = async () => {
    setActionLoading('cancel');
    try {
      await taskService.cancelTask(taskId);
      await fetchTask(taskId);
    } catch { /* */ }
    setActionLoading('');
  };

  if (!selectedTask) return <View style={styles.loading}><ActivityIndicator color="#5eead4" size="large" /></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Badge status={selectedTask.status} />
      <Text style={styles.title}>{selectedTask.title}</Text>
      <Text style={styles.meta}>#{selectedTask.id} · {selectedTask.source} · {timeAgo(selectedTask.created_at, lang)}</Text>

      {selectedTask.pr_url && (
        <Text style={styles.prLink}>{t('tasks.prUrl')}: {selectedTask.pr_url}</Text>
      )}
      {selectedTask.failure_reason && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{selectedTask.failure_reason}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {(selectedTask.status === 'queued' || selectedTask.status === 'failed' || selectedTask.status === 'completed') && (
          <Button title={t('tasks.rerun')} onPress={handleAssign} loading={actionLoading === 'assign'} style={{ flex: 1 }} />
        )}
        {(selectedTask.status === 'queued' || selectedTask.status === 'running') && (
          <Button title={t('tasks.cancel')} onPress={handleCancel} loading={actionLoading === 'cancel'} variant="danger" style={{ flex: 1 }} />
        )}
      </View>

      {/* Logs */}
      <Text style={styles.sectionTitle}>{t('tasks.logs')}</Text>
      {logsLoading ? (
        <ActivityIndicator color="#5eead4" style={{ marginTop: 20 }} />
      ) : selectedLogs.length === 0 ? (
        <Text style={styles.empty}>{t('tasks.noLogs')}</Text>
      ) : (
        selectedLogs.map((log, i) => (
          <View key={i} style={styles.logRow}>
            <Text style={[styles.logStage, { color: STAGE_COLORS[log.stage] || '#666' }]}>{log.stage}</Text>
            <Text style={styles.logMsg} numberOfLines={6}>{log.message}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  content: { padding: 20 },
  loading: { flex: 1, backgroundColor: '#0a0a1a', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 10, marginBottom: 4 },
  meta: { fontSize: 12, color: '#666', marginBottom: 14 },
  prLink: { fontSize: 12, color: '#38bdf8', marginBottom: 10 },
  errorBox: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)' },
  errorText: { fontSize: 12, color: '#ef4444', lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#666', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 },
  empty: { color: '#555', fontSize: 13, textAlign: 'center', padding: 20 },
  logRow: { marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a30' },
  logStage: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 3 },
  logMsg: { fontSize: 11, color: '#999', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 16 },
});

import { Platform } from 'react-native';
