import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, RefreshControl } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Badge from '../../components/ui/Badge';
import { useTaskStore } from '../../stores/taskStore';
import { useLocale } from '../../i18n';
import { timeAgo } from '../../utils/dateFormat';

const FILTERS = ['all', 'running', 'queued', 'completed', 'failed'];

export default function TaskListScreen() {
  const { t, lang } = useLocale();
  const { tasks, loading, fetchTasks } = useTaskStore();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const navigation = useNavigation<any>();

  useEffect(() => { void fetchTasks(); }, []);

  const onRefresh = useCallback(() => { void fetchTasks(); }, []);

  const filtered = tasks.filter((tk) => {
    if (filter !== 'all' && tk.status !== filter) return false;
    if (search && !tk.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('tasks.title')}</Text>

      <TextInput
        style={styles.search}
        placeholder={t('tasks.search')}
        placeholderTextColor="#666"
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f} onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? t('tasks.all') : f}
              {f !== 'all' && ` (${tasks.filter((tk) => tk.status === f).length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor="#5eead4" />}
        contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : undefined}
        ListEmptyComponent={<Text style={styles.empty}>{t('tasks.empty')}</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })} activeOpacity={0.7}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowMeta}>#{item.id} · {item.source} · {timeAgo(item.created_at, lang)}</Text>
              </View>
              <Badge status={item.status} />
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a', padding: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 14 },
  search: { height: 42, borderRadius: 10, backgroundColor: '#16162a', borderWidth: 1, borderColor: '#2a2a4a', paddingHorizontal: 14, color: '#fff', fontSize: 14, marginBottom: 12 },
  filters: { flexDirection: 'row', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#16162a', borderWidth: 1, borderColor: '#2a2a4a' },
  filterActive: { backgroundColor: 'rgba(13,148,136,0.15)', borderColor: '#0d9488' },
  filterText: { fontSize: 12, fontWeight: '600', color: '#666' },
  filterTextActive: { color: '#5eead4' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, backgroundColor: '#16162a', borderWidth: 1, borderColor: '#2a2a4a', marginBottom: 6 },
  rowLeft: { flex: 1, marginRight: 10 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: '#ddd' },
  rowMeta: { fontSize: 11, color: '#666', marginTop: 3 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: '#555', fontSize: 14, textAlign: 'center' },
});
