import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import type { DAVEAskEvidence } from '../services/DAVEAsk';
import type { ECOSProjectQuestionAnswer } from '../services/ECOSProjectQuestion';
import { colors, spacing } from '../theme';

export function ECOSProjectAnswerSheet({
  visible,
  projectName,
  question,
  answer,
  loading,
  error,
  onOpenEvidence,
  onAskAnother,
  onClose,
}: {
  visible: boolean;
  projectName: string;
  question: string;
  answer: ECOSProjectQuestionAnswer | null;
  loading: boolean;
  error: string | null;
  onOpenEvidence: (evidence: DAVEAskEvidence) => void;
  onAskAnother: (suggestedQuestion?: string) => void;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= 700;
  const insufficientEvidence = answer?.assurance.status === 'insufficient_evidence';
  const answerLabel = insufficientEvidence
    ? 'COULD NOT VERIFY'
    : answer?.assurance.status === 'verified_with_limits'
      ? 'VERIFIED WITH LIMITS'
      : 'VERIFIED ANSWER';
  const confidenceLabel = insufficientEvidence
    ? 'Insufficient evidence'
    : answer ? `${capitalize(answer.confidence)} confidence` : '';
  const assuranceIcon = answer?.assurance.status === 'verified'
    ? 'shield-checkmark'
    : answer?.assurance.status === 'verified_with_limits'
      ? 'shield-half-outline'
      : 'alert-circle-outline';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, tablet && styles.backdropTablet]}>
        <View style={[styles.sheet, tablet && styles.sheetTablet]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.main}>
              <Text style={styles.eyebrow}>ECOS PROJECT ANSWER</Text>
              <Text style={styles.title}>Ask ECOS</Text>
              <Text style={styles.subtitle}>{projectName}</Text>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close Ask ECOS answer"
            >
              <Ionicons name="close" size={23} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.questionCard}>
              <Text style={styles.cardLabel}>YOUR QUESTION</Text>
              <Text style={styles.question}>{question}</Text>
            </View>

            {loading ? (
              <View style={styles.loadingCard} accessibilityRole="progressbar">
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.loadingTitle}>ECOS is checking project evidence…</Text>
                <Text style={styles.loadingText}>
                  Reviewing current tasks, field updates, and indexed documents. ECOS Assurance will verify the sources before the answer appears.
                </Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorCard} accessibilityRole="alert">
                <Ionicons name="alert-circle-outline" size={22} color={colors.danger} />
                <View style={styles.main}>
                  <Text style={styles.errorTitle}>The answer could not be completed</Text>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              </View>
            ) : null}

            {answer ? (
              <>
                <View style={styles.answerCard}>
                  <Text style={styles.cardLabel}>{answerLabel}</Text>
                  <Text style={styles.answer}>{answer.answer}</Text>
                  <View style={styles.statusRow}>
                    <View style={styles.confidenceBadge}>
                      <Ionicons
                        name={insufficientEvidence ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                        size={17}
                        color={colors.primary}
                      />
                      <Text style={styles.confidenceText}>{confidenceLabel}</Text>
                    </View>
                    <Text style={styles.sourceCount}>
                      {answer.supportingEvidence.length} source{answer.supportingEvidence.length === 1 ? '' : 's'}{insufficientEvidence ? ' examined' : ''}
                    </Text>
                  </View>
                </View>

                {answer.facts.filter(item => item.classification !== 'fact').length > 0 ? (
                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Interpretation and recommendations</Text>
                    {answer.facts.filter(item => item.classification !== 'fact').map(item => (
                      <View key={item.id} style={styles.factRow}>
                        <Text style={styles.factType}>{item.classification.toUpperCase()}</Text>
                        <Text style={styles.factText}>{item.statement}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {answer.supportingEvidence.length > 0 ? (
                  <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>{insufficientEvidence ? 'Evidence examined' : 'Proof'}</Text>
                    <Text style={styles.sectionGuidance}>
                      {insufficientEvidence
                        ? 'These are the indexed drawing sources ECOS checked. They did not provide a verified answer.'
                        : 'Tap a source to inspect its exact record, page, or drawing area.'}
                    </Text>
                    {answer.supportingEvidence.map((evidence, index) => (
                      <Pressable
                        key={`${evidence.sourceType}:${evidence.recordId}:${index}`}
                        style={({ pressed }) => [styles.evidenceButton, pressed && styles.pressed]}
                        onPress={() => onOpenEvidence(evidence)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${insufficientEvidence ? 'examined evidence' : 'proof'} source ${index + 1}`}
                      >
                        <View style={styles.evidenceIcon}>
                          <Ionicons
                            name={evidence.sourceType === 'document' ? 'document-text-outline' : 'checkbox-outline'}
                            size={20}
                            color={colors.primary}
                          />
                        </View>
                        <View style={styles.main}>
                          <Text style={styles.evidenceTitle}>{evidence.summary}</Text>
                          {evidence.excerpt ? <Text style={styles.evidenceExcerpt} numberOfLines={4}>{evidence.excerpt}</Text> : null}
                        </View>
                        <Ionicons name="chevron-forward" size={19} color={colors.primary} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {answer.conflicts.length > 0 ? (
                  <View style={styles.warningCard}>
                    <Text style={styles.warningTitle}>Conflicting evidence</Text>
                    {answer.conflicts.map(item => <Text key={item} style={styles.warningText}>• {item}</Text>)}
                  </View>
                ) : null}

                {answer.limitations.length > 0 ? (
                  <View style={styles.limitationsCard}>
                    <Text style={styles.warningTitle}>
                      {insufficientEvidence ? 'Why ECOS could not verify this' : 'What ECOS could not fully verify'}
                    </Text>
                    {answer.limitations.map(item => <Text key={item} style={styles.limitationText}>• {item}</Text>)}
                  </View>
                ) : null}

                <View style={styles.assuranceCard}>
                  <Ionicons name={assuranceIcon} size={22} color={colors.primary} />
                  <View style={styles.main}>
                    <Text style={styles.assuranceTitle}>ECOS Assurance</Text>
                    <Text style={styles.assuranceText}>{answer.assurance.message}</Text>
                  </View>
                </View>

                {answer.suggestedQuestions.length > 0 ? (
                  <View style={styles.suggestionSection}>
                    <Text style={styles.sectionTitle}>Ask a follow-up</Text>
                    {answer.suggestedQuestions.map(suggestion => (
                      <TouchableOpacity
                        key={suggestion}
                        style={styles.suggestionButton}
                        onPress={() => onAskAnother(suggestion)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.suggestionText}>{suggestion}</Text>
                        <Ionicons name="arrow-forward" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            {!loading ? (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => onAskAnother()}
                accessibilityRole="button"
              >
                <Ionicons name="mic" size={21} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Ask Another Question</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.providerNote}>
              Ask ECOS makes an external AI request only after you submit a question. It is read-only and cannot change project records.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,24,40,0.4)', justifyContent: 'flex-end' },
  backdropTablet: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: { maxHeight: '94%', backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetTablet: { width: '100%', maxWidth: 760, maxHeight: '90%', borderRadius: 24, overflow: 'hidden' },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginTop: 9 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.md },
  main: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 25, fontWeight: '900', marginTop: 2 },
  subtitle: { color: colors.mutedText, fontSize: 14, marginTop: 3 },
  closeButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 38, gap: spacing.md },
  questionCard: { borderRadius: 15, backgroundColor: colors.surfaceMuted, padding: spacing.md },
  cardLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  question: { color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '700', marginTop: 7 },
  loadingCard: { minHeight: 230, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: spacing.md, textAlign: 'center' },
  loadingText: { color: colors.mutedText, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center', maxWidth: 520 },
  errorCard: { flexDirection: 'row', gap: spacing.sm, borderRadius: 16, borderWidth: 1, borderColor: '#F1AAA4', backgroundColor: '#FFF1F0', padding: spacing.md },
  errorTitle: { color: colors.danger, fontSize: 16, fontWeight: '900' },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: 4 },
  answerCard: { borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, padding: spacing.lg },
  answer: { color: colors.text, fontSize: 22, lineHeight: 31, fontWeight: '900', marginTop: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: colors.primarySoft, paddingHorizontal: 10, paddingVertical: 6 },
  confidenceText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  sourceCount: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  sectionCard: { borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  sectionGuidance: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
  factRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  factType: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  factText: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: 3 },
  evidenceButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 72, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  evidenceIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  evidenceTitle: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  evidenceExcerpt: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.72 },
  warningCard: { borderRadius: 15, backgroundColor: '#FFF7E8', borderWidth: 1, borderColor: '#F4C76D', padding: spacing.md },
  limitationsCard: { borderRadius: 15, backgroundColor: colors.surfaceMuted, padding: spacing.md },
  warningTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  warningText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  limitationText: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 6 },
  assuranceCard: { flexDirection: 'row', gap: spacing.sm, borderRadius: 16, backgroundColor: colors.primarySoft, padding: spacing.md },
  assuranceTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  assuranceText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 4 },
  suggestionSection: { gap: spacing.sm },
  suggestionButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  suggestionText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  primaryButton: { minHeight: 56, borderRadius: 15, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  providerNote: { color: colors.mutedText, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: spacing.md },
});
