import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, spacing } from '../theme';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';

export function DAVETypedCaptureSheet({
  visible,
  projectName,
  onContinue,
  onCancel,
}: {
  visible: boolean;
  projectName: string;
  onContinue: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setError(null);
  }, [visible]);

  function continueToConfirmation() {
    const value = text.trim();
    if (!value) {
      setError('Enter what you want DAVE to remember.');
      return;
    }
    onContinue(value);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingModalCard
          frameStyle={styles.sheet}
          contentContainerStyle={styles.content}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Capture Memory</Text>
              <Text style={styles.subtitle}>{projectName}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel memory capture"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.prompt}>What should DAVE remember?</Text>
          <Text style={styles.guidance}>
            Record a commitment, decision, issue, request, schedule change, or follow-up.
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={value => {
              setText(value);
              setError(null);
            }}
            placeholder="Example: ABC Electric committed to finish conduit by Friday."
            placeholderTextColor={colors.mutedText}
            multiline
            autoFocus
            textAlignVertical="top"
            accessibilityLabel="Project memory"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.continueButton}
            onPress={continueToConfirmation}
            accessibilityRole="button"
            accessibilityLabel="Review captured memory"
          >
            <Text style={styles.continueText}>Review Memory</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onCancel}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(16,24,40,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 9,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prompt: { color: colors.text, fontSize: 18, fontWeight: '800' },
  guidance: {
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5,
  },
  input: {
    minHeight: 150,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  continueButton: {
    minHeight: 54,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  continueText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
});
