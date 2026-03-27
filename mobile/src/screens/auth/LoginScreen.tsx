import { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../stores/authStore';
import { useLocale } from '../../i18n';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAuthStore((s) => s.login);
  const navigation = useNavigation<any>();
  const { t } = useLocale();

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch {
      setError(t('auth.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>tiqr</Text>
          <Text style={styles.subtitle}>AI Agent Platform</Text>
        </View>

        <View style={styles.form}>
          <Input
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Input
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title={t('auth.loginButton')} onPress={handleLogin} loading={loading} />
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={styles.link}>
          <Text style={styles.linkText}>{t('auth.noAccount')} <Text style={styles.linkBold}>{t('auth.signup')}</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  logo: { fontSize: 42, fontWeight: '900', color: '#5eead4', letterSpacing: -1 },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  form: { marginBottom: 24 },
  error: { color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  link: { alignItems: 'center', padding: 12 },
  linkText: { color: '#666', fontSize: 14 },
  linkBold: { color: '#5eead4', fontWeight: '700' },
});
