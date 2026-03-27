import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'outline' | 'danger';
  style?: ViewStyle;
}

const colors = {
  primary: { bg: '#0d9488', text: '#fff' },
  outline: { bg: 'transparent', text: '#0d9488' },
  danger: { bg: '#ef4444', text: '#fff' },
};

export default function Button({ title, onPress, loading, disabled, variant = 'primary', style }: Props) {
  const c = colors[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.btn,
        { backgroundColor: c.bg, borderColor: variant === 'outline' ? '#0d9488' : c.bg, borderWidth: variant === 'outline' ? 1.5 : 0, opacity: disabled ? 0.5 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={c.text} size="small" />
      ) : (
        <Text style={[styles.text, { color: c.text }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 } as ViewStyle,
  text: { fontSize: 15, fontWeight: '700' } as TextStyle,
});
