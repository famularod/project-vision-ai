import Ionicons from '@expo/vector-icons/Ionicons';
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
  title = 'Capture Memory',
  prompt = 'What should be saved to project memory?',
  guidance = 'Record a commitment, decision, issue, request, schedule change, or follow-up.',
  placeholder = 'Example: ABC Electric committed to finish conduit by Friday.',
  continueLabel = 'Review Memory',
  accessibilityLabel = 'Project memory',
  operationLabel,
  operationGuidance,
  onContinue,
  onOperation,
  onCancel,
}: {
  visible: boolean;
  projectName: string;
  title?: string;
  prompt?: string;
  guidance?: string;
  placeholder?: string;
  continueLabel?: string;
  accessibilityLabel?: string;
  operationLabel?: string;
  operationGuidance?: string;
  onContinue: (text: string) => void;
  onOperation?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setText('');
    setError(null);
    setSubmitted(false);
  }, [visible]);

  function continueToConfirmation() {
    // Audit P1-50: Continue is not re-entrant; a double tap must not launch
    // two competing captures. The flag resets when the sheet reopens.
    if (submitted) return;
    const value = text.trim();
    if (!value) {
      setError('Enter a question or project information.');
      return;
    }
    setSubmitted(true);
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
              <Text style={styles.title}>{title}</Text>
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

          {onOperation && operationLabel ? (
            <TouchableOpacity
              style={styles.operationCard}
              onPress={onOperation}
              accessibilityRole="button"
              accessibilityLabel={operationLabel}
            >
              <View style={styles.operationIcon}>
                <Ionicons name="list-outline" size={21} color={colors.primary} />
              </View>
              <View style={styles.main}>
                <Text style={styles.operationLabel}>{operationLabel}</Text>
                {operationGuidance ? <Text style={styles.operationGuidance}>{operationGuidance}</Text> : null}
              </View>
              <Ionicons name="chevron-forward-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}

          <Text style={styles.prompt}>{prompt}</Text>
          <Text style={styles.guidance}>{guidance}</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={value => {
              setText(value);
              setError(null);
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedText}
            multiline
            autoFocus
            textAlignVertical="top"
            accessibilityLabel={accessibilityLabel}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.continueButton}
            onPress={continueToConfirmation}
            accessibilityRole="button"
            accessibilityLabel="Review captured memory"
          >
            <Text style={styles.continueText}>{continueLabel}</Text>
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
  operationCard: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  operationIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  operationLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  operationGuidance: { color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 2 },
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
