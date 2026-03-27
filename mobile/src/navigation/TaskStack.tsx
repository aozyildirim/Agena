import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TaskListScreen from '../screens/tasks/TaskListScreen';
import TaskDetailScreen from '../screens/tasks/TaskDetailScreen';

const Stack = createNativeStackNavigator();

export default function TaskStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a1a' } }}>
      <Stack.Screen name="TaskList" component={TaskListScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen as any} />
    </Stack.Navigator>
  );
}
