import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { DAVEAskAnswer, DAVEAskEvidence } from '../services/DAVEAsk';
import { colors, spacing } from '../theme';
import { KeyboardAvoidingModalCard } from './KeyboardAvoidingModalCard';

export function DAVEConversationAnswerSheet({
  visible,
  projectName,
  question,
  answer,
  onOpenEvidence,
  onAskAnother,
  onClose,
}: {
  visible: boolean;
  projectName: string;
  question: string;
  answer: DAVEAskAnswer | null;
  onOpenEvidence: (citation: DAVEAskEvidence) => void;
  onAskAnother: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingModalCard frameStyle={styles.sheet} contentContainerStyle={styles.content}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.title}>Answer</Text>
              <Text style={styles.subtitle}>{projectName}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel="Close answer">
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.question}>{question}</Text>
          <Text style={styles.answer}>{answer?.answer || 'No answer was prepared.'}</Text>
          {answer ? <Text style={styles.confidence}>Confidence: {answer.confidence}</Text> : null}
          {answer?.recommendedNextAction ? (
            <View style={styles.nextAction}>
              <Text style={styles.label}>Recommended next action</Text>
              <Text style={styles.detail}>{answer.recommendedNextAction}</Text>
            </View>
          ) : null}
          {answer?.limitations.length ? (
            <View style={styles.limitations}>
              <Text style={styles.label}>What to keep in mind</Text>
              {answer.limitations.slice(0, 3).map((item, index) => (
                <Text key={`${index}-${item}`} style={styles.detail}>• {item}</Text>
              ))}
            </View>
          ) : null}
          {answer?.supportingEvidence.length ? (
            <View style={styles.evidenceList}>
              <Text style={styles.label}>Supporting records</Text>
              {answer.supportingEvidence.map(citation => (
                <TouchableOpacity
                  key={`${citation.sourceType}:${citation.recordId}:${citation.timelineEventId || ''}`}
                  style={styles.evidenceButton}
                  onPress={() => onOpenEvidence(citation)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open supporting ${citation.sourceType}: ${citation.summary}`}
                >
                  <View style={styles.main}>
                    <Text style={styles.evidenceSummary}>{citation.summary}</Text>
                    <Text style={styles.evidenceType}>{citation.sourceType}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <TouchableOpacity style={styles.primaryButton} onPress={onAskAnother} accessibilityRole="button">
            <Ionicons name="mic-outline" size={20} color="#FFF" />
            <Text style={styles.primaryText}>Talk Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={onClose} accessibilityRole="button">
            <Text style={styles.secondaryText}>Done</Text>
          </TouchableOpacity>
        </KeyboardAvoidingModalCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.35)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 36 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.lg },
  main: { flex: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  question: { color: colors.mutedText, fontSize: 15, fontWeight: '700', marginBottom: spacing.md },
  answer: { color: colors.text, fontSize: 18, lineHeight: 27, fontWeight: '700' },
  confidence: { color: colors.mutedText, fontSize: 13, marginTop: spacing.sm, textTransform: 'capitalize' },
  nextAction: { backgroundColor: colors.primarySoft, borderRadius: 14, padding: spacing.md, marginTop: spacing.lg },
  limitations: { backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: spacing.md, marginTop: spacing.md },
  label: { color: colors.text, fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: spacing.xs },
  detail: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 3 },
  evidenceList: { marginTop: spacing.lg, gap: spacing.xs },
  evidenceButton: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  evidenceSummary: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  evidenceType: { color: colors.mutedText, fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  primaryButton: { minHeight: 54, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
});
