import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore } from './src/stores/authStore';
import { useSettingsStore } from './src/stores/settingsStore';
import { getLang } from './src/utils/storage';

export default function App() {
  const loadSession = useAuthStore((s) => s.loadSession);
  const setLang = useSettingsStore((s) => s.setLang);

  useEffect(() => {
    void getLang().then((lang) => setLang(lang));
    void loadSession();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
