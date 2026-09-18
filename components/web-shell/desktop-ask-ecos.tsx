import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { useECOSConversation } from '../../hooks/use-ecos-conversation';
import type { ECOSConversationRequest } from '../../services/ECOSConversation';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ECOSProjectQuestionAnswer } from '../../services/ECOSProjectQuestion';
import { buildECOSDesktopDocumentProofParams } from '../../services/ECOSDesktopProofNavigation';
import { ecosEvidenceProofTierLabel } from '../../services/DAVEAsk';
import { desktopSurfaces } from './desktop-surface-palette';

const EXAMPLE_QUESTIONS = Object.freeze([
  'What work needs attention right now?',
  'What does the current drawing require at this location?',
  'Which tasks are due next, and what proof supports that?',
]);

export function DesktopAskECOSWorkspace({
  projectId,
  projectName,
  onAsk,
  ownerKey,
}: {
  projectId: string | null;
  projectName: string | null;
  ownerKey: string;
  onAsk: (input: ECOSConversationRequest & { projectId: string; projectName: string; question: string }) => Promise<ECOSProjectQuestionAnswer>;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 820;
  const conversation = useECOSConversation(JSON.stringify([ownerKey, projectId, projectName]));
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ECOSProjectQuestionAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setQuestion('');
    setAnswer(null);
    setError(null);
    setLoading(false);
  }, [conversation]);
  const ready = Boolean(projectId && projectName && question.trim().length >= 3 && !loading);
  const insufficientEvidence = answer?.assurance.status === 'insufficient_evidence';
  const answerLabel = insufficientEvidence
    ? 'COULD NOT VERIFY'
    : answer?.assurance.status === 'verified_with_limits'
      ? 'VERIFIED WITH LIMITS'
      : 'VERIFIED ANSWER';

  const submit = async (nextQuestion = question) => {
    const cleanQuestion = nextQuestion.replace(/\s+/g, ' ').trim();
    if (!projectId || !projectName || cleanQuestion.length < 3 || loading) return;
    setQuestion(cleanQuestion);
    setAnswer(null);
    setError(null);
    setLoading(true);
    const turn = conversation.begin();
    try {
      const nextAnswer = await onAsk({ projectId, projectName, question: cleanQuestion, ...turn.request });
      if (!turn.isCurrent()) return;
      turn.accept(nextAnswer.conversation);
      setAnswer(nextAnswer);
    } catch (reason) {
      if (!turn.isCurrent()) return;
      turn.accept(null);
      setError(reason instanceof Error ? reason.message : 'Ask ECOS could not complete the question.');
    } finally {
      if (turn.isCurrent()) setLoading(false);
    }
  };

  return (
    <View style={styles.workspace}>
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={29} color={desktopSurfaces.accent} />
        </View>
        <View style={styles.main}>
          <Text style={styles.heroTitle}>Ask a project question</Text>
          <Text style={styles.heroText}>
            ECOS reviews the selected project’s current tasks, field updates, field notes, and indexed documents. Every factual answer must show its proof.
          </Text>
        </View>
      </View>

      {!projectId || !projectName ? (
        <View style={styles.noticeCard} accessibilityRole="alert">
          <Ionicons name="folder-open-outline" size={22} color={desktopSurfaces.accent} />
          <Text style={styles.noticeText}>Select one project above before asking ECOS.</Text>
        </View>
      ) : (
        <View style={styles.questionCard}>
          <Text style={styles.label}>QUESTION ABOUT {projectName.toUpperCase()}</Text>
          <TextInput
            value={question}
            onChangeText={value => {
              setQuestion(value);
              setError(null);
            }}
            placeholder="Example: How thick is the new concrete on the north side?"
            placeholderTextColor="#7B8494"
            multiline
            textAlignVertical="top"
            style={styles.questionInput}
            accessibilityLabel="Project question for ECOS"
          />
          <View style={styles.askRow}>
            <Text style={styles.externalNote}>
              Submitting makes one secure external AI request. Ask ECOS is read-only and cannot change project records.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.askButton,
                !ready && styles.askButtonDisabled,
                pressed && ready && styles.pressed,
              ]}
              disabled={!ready}
              onPress={() => { void submit(); }}
              accessibilityRole="button"
            >
              {loading ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="sparkles-outline" size={20} color="#FFFFFF" />}
              <Text style={styles.askButtonText}>{loading ? 'Checking evidence…' : 'Ask ECOS'}</Text>
            </Pressable>
          </View>
          <View style={styles.examples}>
            {EXAMPLE_QUESTIONS.map(example => (
              <Pressable
                key={example}
                style={({ pressed }) => [styles.exampleButton, pressed && styles.pressed]}
                onPress={() => setQuestion(example)}
                accessibilityRole="button"
              >
                <Text style={styles.exampleText}>{example}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingCard} accessibilityRole="progressbar">
          <ActivityIndicator size="large" color={desktopSurfaces.accent} />
          <Text style={styles.loadingTitle}>ECOS is reviewing current project evidence…</Text>
          <Text style={styles.loadingText}>ECOS Assurance will independently check the citations before the answer appears.</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorCard} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={22} color="#B42318" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {answer ? (
          <View style={[styles.answerLayout, compact && styles.answerLayoutCompact]}>
          <View style={[styles.answerColumn, compact && styles.answerColumnCompact]}>
            <View style={styles.answerCard}>
              <Text style={styles.label}>{answerLabel}</Text>
              <Text style={styles.answerText}>{answer.answer}</Text>
              <View style={styles.answerMeta}>
                <View style={styles.confidenceBadge}>
                  <Ionicons
                    name={insufficientEvidence ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                    size={17}
                    color={desktopSurfaces.accent}
                  />
                  <Text style={styles.confidenceText}>
                    {insufficientEvidence ? 'Insufficient evidence' : `${capitalize(answer.confidence)} confidence`}
                  </Text>
                </View>
                <Text style={styles.metaText}>
                  {answer.supportingEvidence.length} source{answer.supportingEvidence.length === 1 ? '' : 's'}{insufficientEvidence ? ' examined' : ''}
                </Text>
              </View>
            </View>

            {answer.facts.filter(item => item.classification !== 'fact').map(item => (
              <View key={item.id} style={styles.interpretationCard}>
                <Text style={styles.interpretationType}>{item.classification.toUpperCase()}</Text>
                <Text style={styles.interpretationText}>{item.statement}</Text>
              </View>
            ))}

            {answer.conflicts.length > 0 ? (
              <View style={styles.warningCard}>
                <Text style={styles.sectionTitle}>Conflicting evidence</Text>
                {answer.conflicts.map(item => <Text key={item} style={styles.listText}>• {item}</Text>)}
              </View>
            ) : null}

            {answer.limitations.length > 0 ? (
              <View style={styles.limitationsCard}>
                <Text style={styles.sectionTitle}>
                  {insufficientEvidence ? 'Why ECOS could not verify this' : 'What ECOS could not fully verify'}
                </Text>
                {answer.limitations.map(item => <Text key={item} style={styles.listText}>• {item}</Text>)}
              </View>
            ) : null}

            <View style={styles.assuranceCard}>
              <Ionicons name="shield-checkmark-outline" size={24} color={desktopSurfaces.accent} />
              <View style={styles.main}>
                <Text style={styles.sectionTitle}>ECOS Assurance</Text>
                <Text style={styles.assuranceText}>{answer.assurance.message}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.proofColumn, compact && styles.proofColumnCompact]}>
            <Text style={styles.proofTitle}>{insufficientEvidence ? 'Evidence examined' : 'Proof'}</Text>
            <Text style={styles.proofGuidance}>
              {insufficientEvidence
                ? 'Indexed drawing sources ECOS checked before determining that the requested fact could not be verified.'
                : 'Exact records and drawing excerpts used for this answer.'}
            </Text>
            {answer.supportingEvidence.map((evidence, index) => {
              const href = evidence.sourceType === 'document' && projectName
                ? {
                    pathname: '/documents' as const,
                    params: buildECOSDesktopDocumentProofParams(evidence, projectName),
                  }
                : { pathname: '/tasks' as const, params: { project: projectName } };
              return (
                <Link key={`${evidence.recordId}:${index}`} href={href} asChild>
                  <Pressable style={({ pressed }) => [styles.proofCard, pressed && styles.pressed]} accessibilityRole="link">
                    <View style={styles.proofHeader}>
                      <Ionicons
                        name={evidence.sourceType === 'document' ? 'document-text-outline' : 'checkbox-outline'}
                        size={20}
                        color={desktopSurfaces.accent}
                      />
                      <Text style={styles.proofLabel}>{evidence.summary}</Text>
                    </View>
                    {evidence.excerpt ? <Text style={styles.proofExcerpt}>{evidence.excerpt}</Text> : null}
                    {ecosEvidenceProofTierLabel(evidence) ? (
                      <Text style={styles.proofTier}>{ecosEvidenceProofTierLabel(evidence)}</Text>
                    ) : null}
                    <Text style={styles.openSourceText}>
                      {evidence.sourceType === 'document'
                        ? evidence.proofTier === 'page_text' ? 'Open page →' : 'Open exact proof →'
                        : 'Open source →'}
                    </Text>
                  </Pressable>
                </Link>
              );
            })}
            {answer.suggestedQuestions.map(suggestion => (
              <Pressable
                key={suggestion}
                style={({ pressed }) => [styles.followUpButton, pressed && styles.pressed]}
                onPress={() => { void submit(suggestion); }}
                accessibilityRole="button"
              >
                <Text style={styles.followUpText}>{suggestion}</Text>
                <Ionicons name="arrow-forward" size={18} color={desktopSurfaces.accent} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

const styles = StyleSheet.create({
  workspace: { gap: 18 },
  heroCard: { flexDirection: 'row', gap: 16, alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: '#C5D8EE', backgroundColor: '#EAF4FF', padding: 20 },
  heroIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 },
  heroTitle: { color: desktopSurfaces.text, fontSize: 22, fontWeight: '900' },
  heroText: { color: desktopSurfaces.textMuted, fontSize: 15, lineHeight: 22, marginTop: 5, maxWidth: 920 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: '#B9D1EC', backgroundColor: '#FFFFFF', padding: 18 },
  noticeText: { color: desktopSurfaces.text, fontSize: 15, fontWeight: '800' },
  questionCard: { borderRadius: 18, borderWidth: 1, borderColor: '#C5D8EE', backgroundColor: '#FFFFFF', padding: 20 },
  label: { color: desktopSurfaces.accent, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  questionInput: { minHeight: 112, borderRadius: 14, borderWidth: 1, borderColor: '#BED0E5', backgroundColor: '#F5F8FC', padding: 16, color: desktopSurfaces.text, fontSize: 18, lineHeight: 26, fontWeight: '700', marginTop: 10 },
  askRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginTop: 14 },
  externalNote: { flex: 1, color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 18 },
  askButton: { minWidth: 180, minHeight: 52, borderRadius: 13, backgroundColor: desktopSurfaces.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  askButtonDisabled: { opacity: 0.45 },
  askButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  exampleButton: { borderRadius: 999, borderWidth: 1, borderColor: '#C6D7EA', backgroundColor: '#F5F8FC', paddingHorizontal: 13, paddingVertical: 9 },
  exampleText: { color: desktopSurfaces.accent, fontSize: 12, fontWeight: '800' },
  loadingCard: { minHeight: 210, borderRadius: 18, borderWidth: 1, borderColor: '#C5D8EE', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', padding: 28 },
  loadingTitle: { color: desktopSurfaces.text, fontSize: 19, fontWeight: '900', marginTop: 14 },
  loadingText: { color: desktopSurfaces.textMuted, fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: 'center' },
  errorCard: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: '#F0A7A0', backgroundColor: '#FFF0EF', padding: 16 },
  errorText: { flex: 1, color: '#B42318', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  answerLayout: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  answerLayoutCompact: { flexDirection: 'column' },
  answerColumn: { flex: 1.15, gap: 14, minWidth: 0 },
  answerColumnCompact: { flex: 0, width: '100%' },
  proofColumn: { flex: 0.85, gap: 10, minWidth: 0, borderRadius: 18, borderWidth: 1, borderColor: '#C5D8EE', backgroundColor: '#EAF4FF', padding: 18 },
  proofColumnCompact: { flex: 0, width: '100%' },
  answerCard: { borderRadius: 18, borderWidth: 2, borderColor: desktopSurfaces.accent, backgroundColor: '#FFFFFF', padding: 22 },
  answerText: { color: desktopSurfaces.text, fontSize: 25, lineHeight: 35, fontWeight: '900', marginTop: 10 },
  answerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18 },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, backgroundColor: '#EAF4FF', paddingHorizontal: 10, paddingVertical: 6 },
  confidenceText: { color: desktopSurfaces.accent, fontSize: 12, fontWeight: '900' },
  metaText: { color: desktopSurfaces.textMuted, fontSize: 12, fontWeight: '700' },
  interpretationCard: { borderRadius: 14, borderWidth: 1, borderColor: '#C5D8EE', backgroundColor: '#FFFFFF', padding: 16 },
  interpretationType: { color: desktopSurfaces.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  interpretationText: { color: desktopSurfaces.text, fontSize: 15, lineHeight: 22, marginTop: 5 },
  warningCard: { borderRadius: 14, borderWidth: 1, borderColor: '#F3C66F', backgroundColor: '#FFF7E8', padding: 16 },
  limitationsCard: { borderRadius: 14, backgroundColor: '#EDF1F6', padding: 16 },
  sectionTitle: { color: desktopSurfaces.text, fontSize: 15, fontWeight: '900' },
  listText: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 20, marginTop: 6 },
  assuranceCard: { flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: '#EAF4FF', padding: 16 },
  assuranceText: { color: desktopSurfaces.text, fontSize: 13, lineHeight: 20, marginTop: 4 },
  proofTitle: { color: desktopSurfaces.text, fontSize: 20, fontWeight: '900' },
  proofGuidance: { color: desktopSurfaces.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 2 },
  proofCard: { borderRadius: 14, borderWidth: 1, borderColor: '#B8CEE7', backgroundColor: '#FFFFFF', padding: 14 },
  proofHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proofLabel: { flex: 1, color: desktopSurfaces.text, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  proofExcerpt: { color: desktopSurfaces.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 },
  proofTier: { color: desktopSurfaces.accent, fontSize: 11, lineHeight: 16, marginTop: 6, fontWeight: '900' },
  openSourceText: { color: desktopSurfaces.accent, fontSize: 12, fontWeight: '900', marginTop: 8 },
  followUpButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 13, borderWidth: 1, borderColor: '#B8CEE7', backgroundColor: '#FFFFFF', paddingHorizontal: 13 },
  followUpText: { flex: 1, color: desktopSurfaces.text, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  pressed: { opacity: 0.72 },
});
