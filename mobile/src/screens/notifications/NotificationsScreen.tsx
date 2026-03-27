import { useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useNotificationStore } from '../../stores/notificationStore';
import { useLocale } from '../../i18n';
import { timeAgo } from '../../utils/dateFormat';

const SEV_COLORS: Record<string, string> = {
  success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#38bdf8',
};

export default function NotificationsScreen() {
  const { t, lang } = useLocale();
  const { items, loading, fetch, markRead, markAllRead } = useNotificationStore();
  const navigation = useNavigation<any>();

  useEffect(() => { void fetch(); }, []);
  const onRefresh = useCallback(() => { void fetch(); }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('notifications.title')}</Text>
        {items.some((n) => !n.is_read) && (
          <TouchableOpacity onPress={() => void markAllRead()}>
            <Text style={styles.markAll}>{t('notifications.markAllRead')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#5eead4" />}
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : undefined}
        ListEmptyComponent={<Text style={styles.empty}>{t('notifications.empty')}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => {
              if (!item.is_read) void markRead(item.id);
              if (item.task_id) navigation.navigate('Tasks', { screen: 'TaskDetail', params: { taskId: item.task_id } });
            }}
            activeOpacity={0.7}>
            <View style={[styles.row, !item.is_read && styles.rowUnread]}>
              <View style={[styles.dot, { backgroundColor: SEV_COLORS[item.severity] || '#666' }]} />
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowMsg} numberOfLines={2}>{item.message}</Text>
                <Text style={styles.rowTime}>{timeAgo(item.created_at, lang)}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a', padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff' },
  markAll: { fontSize: 13, color: '#5eead4', fontWeight: '600' },
  row: { flexDirection: 'row', padding: 14, borderRadius: 12, backgroundColor: '#16162a', borderWidth: 1, borderColor: '#2a2a4a', marginBottom: 6, gap: 12 },
  rowUnread: { borderColor: 'rgba(94,234,212,0.25)', backgroundColor: 'rgba(94,234,212,0.04)' },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#ddd' },
  rowMsg: { fontSize: 12, color: '#888', marginTop: 2, lineHeight: 18 },
  rowTime: { fontSize: 10, color: '#555', marginTop: 4 },
  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: '#555', fontSize: 14 },
});
