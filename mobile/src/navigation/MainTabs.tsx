import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import TaskStack from './TaskStack';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import { useNotificationStore } from '../stores/notificationStore';
import { useLocale } from '../i18n';
import { useEffect } from 'react';

const Tab = createBottomTabNavigator();

const ICONS: Record<string, string> = {
  Dashboard: '🧭',
  Tasks: '✅',
  Notifications: '🔔',
  Profile: '👤',
};

export default function MainTabs() {
  const { t } = useLocale();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const fetchNotifs = useNotificationStore((s) => s.fetch);

  useEffect(() => { void fetchNotifs(); const iv = setInterval(() => void fetchNotifs(), 30000); return () => clearInterval(iv); }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: '#0f0f23', borderTopColor: '#1a1a30', borderTopWidth: 1, height: 56, paddingBottom: 6 },
        tabBarActiveTintColor: '#5eead4',
        tabBarInactiveTintColor: '#555',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarIcon: ({ color }) => (
          <View>
            <Text style={{ fontSize: 20, color }}>{ICONS[route.name] || '?'}</Text>
            {route.name === 'Notifications' && unreadCount > 0 && (
              <View style={{ position: 'absolute', top: -4, right: -10, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff' }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
        ),
      })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ tabBarLabel: t('tab.dashboard') }} />
      <Tab.Screen name="Tasks" component={TaskStack} options={{ tabBarLabel: t('tab.tasks') }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ tabBarLabel: t('tab.notifications') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: t('tab.profile') }} />
    </Tab.Navigator>
  );
}
