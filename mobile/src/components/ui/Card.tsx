import { View, StyleSheet, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

export default function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#16162a', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a4a', padding: 16 },
});
