import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

export default function Input({ label, error, style, ...rest }: Props) {
  return (
    <View style={styles.wrap}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[styles.input, error && styles.inputError, style]}
        placeholderTextColor="#999"
        {...rest}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#333', backgroundColor: '#1a1a2e', color: '#fff', paddingHorizontal: 16, fontSize: 15 },
  inputError: { borderColor: '#ef4444' },
  error: { fontSize: 12, color: '#ef4444', marginTop: 4 },
});
