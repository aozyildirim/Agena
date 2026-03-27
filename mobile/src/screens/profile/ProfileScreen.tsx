import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../stores/authStore';
import { useLocale } from '../../i18n';
import Constants from 'expo-constants';

export default function ProfileScreen() {
  const { t, lang, toggle } = useLocale();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('profile.title')}</Text>

      <Card style={styles.card}>
        <Text style={styles.name}>{user?.full_name || '—'}</Text>
        <Text style={styles.email}>{user?.email || '—'}</Text>
        {user?.org_name && <Text style={styles.org}>{user.org_name}</Text>}
      </Card>

      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>{t('profile.language')}</Text>
          <TouchableOpacity onPress={toggle} style={styles.langToggle}>
            <Text style={[styles.langOption, lang === 'tr' && styles.langActive]}>TR</Text>
            <Text style={[styles.langOption, lang === 'en' && styles.langActive]}>EN</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>{t('profile.version')}</Text>
          <Text style={styles.value}>{Constants.expoConfig?.version || '1.0.0'}</Text>
        </View>
      </Card>

      <Button title={t('profile.logout')} onPress={() => void logout()} variant="danger" style={{ marginTop: 20 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a', padding: 20 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 20 },
  card: { marginBottom: 10 },
  name: { fontSize: 18, fontWeight: '700', color: '#fff' },
  email: { fontSize: 13, color: '#888', marginTop: 2 },
  org: { fontSize: 12, color: '#5eead4', marginTop: 6, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 14, color: '#aaa' },
  value: { fontSize: 14, color: '#666' },
  langToggle: { flexDirection: 'row', backgroundColor: '#1a1a30', borderRadius: 8, overflow: 'hidden' },
  langOption: { paddingHorizontal: 14, paddingVertical: 8, fontSize: 13, fontWeight: '700', color: '#666' },
  langActive: { backgroundColor: '#0d9488', color: '#fff' },
});
