import { NavigationContainer } from '@react-navigation/native';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import AuthStack from './AuthStack';
import MainTabs from './MainTabs';

export default function RootNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color="#5eead4" size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: '#0a0a1a', justifyContent: 'center', alignItems: 'center' },
});
