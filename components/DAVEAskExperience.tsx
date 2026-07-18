import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { type DAVEAskAnswer, type DAVEAskEvidence } from '../services/DAVEAsk';
import {
  appendDAVEAskHistory,
  buildDAVEAskWhyModel,
  createDAVEAskHistoryPersistence,
  DAVE_ASK_SUGGESTED_QUESTIONS,
  daveAskHistoryStorageKey,
  resolveDAVEAskEvidenceNavigation,
  resolveDAVEAskTimelineNavigation,
  type DAVEAskConversationEntry,
} from '../services/DAVEAskConversation';
import type { DAVEBriefNavigationTarget } from '../services/DAVEDailyBrief';
import type { DAVEProjectIntelligence } from '../services/DAVEIntelligence';
import {
  answerDAVEConversationContext,
  resolveDAVEConversationContext,
} from '../services/DAVEConversationContext';
import { persistStorageItem } from '../hooks/use-async-storage-persistence';

type Props = {
  intelligence: DAVEProjectIntelligence;
  onOpenSupportingRecord: (target: DAVEBriefNavigationTarget, sourceRecordId: string) => void;
};

export function DAVEAskExperience({ intelligence, onOpenSupportingRecord }: Props) {
  const [history, setHistory] = useState<DAVEAskConversationEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [clarification, setClarification] = useState<string | null>(null);
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState(false);
  const [historyLoadAttempt, setHistoryLoadAttempt] = useState(0);
  const historyRef = useRef<DAVEAskConversationEntry[]>([]);
  const storageKey = daveAskHistoryStorageKey(intelligence.projectId);
  const activeStorageKeyRef = useRef(storageKey);
  activeStorageKeyRef.current = storageKey;
  const historyPersistence = useRef(createDAVEAskHistoryPersistence({
    readItem: key => AsyncStorage.getItem(key),
    persistItem: persistStorageItem,
  })).current;

  useEffect(() => {
    let active = true;
    setHistory([]);
    setHistoryLoaded(false);
    setExpandedWhyId(null);
    setClarification(null);
    setHistoryLoadError(false);
    historyPersistence.read(intelligence.projectId)
      .then(loaded => {
        if (!active) return;
        historyRef.current = loaded;
        setHistory(loaded);
        setHistoryLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        // A failed read is not an authoritative empty history. Keep input
        // disabled so a later write cannot erase records that remain on disk.
        setHistoryLoadError(true);
        setHistoryLoaded(false);
      });
    return () => {
      active = false;
    };
  }, [historyLoadAttempt, historyPersistence, intelligence.projectId, storageKey]);

  function executeQuestion(question: string) {
    // Audit P1-50: a tap before hydration finishes would answer against an
    // empty history and then overwrite the stored history on save.
    if (!historyLoaded) return;
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;
    const context = resolveDAVEConversationContext({
      transcript: normalizedQuestion,
      history,
      projectId: intelligence.projectId,
    });
    if (context.status === 'ambiguous_follow_up') {
      setClarification(context.effectiveQuestion);
      setFollowUp('');
      return;
    }
    const answer = answerDAVEConversationContext({
      resolution: context,
      intelligence,
      interface: 'text',
    });
    if (!answer) return;
    setClarification(null);
    const createdAt = new Date().toISOString();
    const entry: DAVEAskConversationEntry = {
      id: `ask:${encodeURIComponent(intelligence.projectId)}:${createdAt}:${history.length}`,
      projectId: intelligence.projectId,
      question: normalizedQuestion,
      answer,
      createdAt,
      contextStatus: context.status,
      resolvedQuestion: context.status === 'standalone' ? null : context.effectiveQuestion,
      priorEntryId: context.priorEntryId,
    };
    const next = appendDAVEAskHistory(historyRef.current, entry);
    historyRef.current = next;
    setHistory(next);
    // Audit P1-50: same-project writes are ordered, transient failures are
    // retried, and persistent failure remains visible to the user.
    void historyPersistence.append(intelligence.projectId, entry)
      .then(persisted => {
        if (activeStorageKeyRef.current !== storageKey) return;
        historyRef.current = persisted;
        setHistory(persisted);
        setPersistenceError(false);
      })
      .catch(() => setPersistenceError(true));
    setFollowUp('');
  }

  function openEvidence(citation: DAVEAskEvidence) {
    const destination = resolveDAVEAskEvidenceNavigation(intelligence, citation);
    onOpenSupportingRecord(destination.target, destination.sourceRecordId);
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBubble}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color="#3656A7" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Project Assistant</Text>
          <Text style={styles.subtitle}>Suggested questions</Text>
        </View>
      </View>

      <View style={styles.suggestions}>
        {DAVE_ASK_SUGGESTED_QUESTIONS.map(question => (
          <TouchableOpacity
            key={question}
            style={styles.suggestion}
            onPress={() => executeQuestion(question)}
            disabled={!historyLoaded}
            accessibilityRole="button"
            accessibilityState={{ disabled: !historyLoaded }}
            accessibilityLabel={`Ask project assistant: ${question}`}
          >
            <Text style={styles.suggestionText}>• {question}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!historyLoaded && !historyLoadError ? <AskHistorySkeleton /> : null}

      {historyLoadError ? (
        <View style={styles.emptyState}>
          <Text style={styles.answerText}>Saved questions could not be opened.</Text>
          <Text style={styles.metaText}>
            Asking is paused so existing history is not overwritten.
          </Text>
          <TouchableOpacity
            style={styles.suggestion}
            onPress={() => setHistoryLoadAttempt(attempt => attempt + 1)}
            accessibilityRole="button"
            accessibilityLabel="Retry loading saved questions"
          >
            <Text style={styles.suggestionText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {persistenceError ? (
        <Text style={styles.metaText}>
          The last answer could not be saved to this phone. It stays visible here, but may be missing after an app restart.
        </Text>
      ) : null}

      {historyLoaded && history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.answerText}>Ask me about this project.</Text>
          <Text style={styles.metaText}>Examples are listed above.</Text>
        </View>
      ) : null}

      {history.map(entry => (
        <View key={entry.id} style={styles.historyEntry}>
          <Text style={styles.questionText}>{entry.question}</Text>
          {entry.resolvedQuestion ? (
            <Text style={styles.metaText}>Follow-up understood as: {entry.resolvedQuestion}</Text>
          ) : null}
          <Text style={styles.sectionLabel}>Answer</Text>
          <Text style={styles.answerText}>{entry.answer.answer}</Text>
          <Text style={styles.metaText}>Confidence: {entry.answer.confidence}</Text>
          {entry.answer.limitations.length > 0 ? (
            <AnswerList title="Limitations" items={entry.answer.limitations} />
          ) : null}
          {entry.answer.supportingEvidence.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>Supporting Evidence</Text>
              {entry.answer.supportingEvidence.map(citation => (
                <CitationButton key={citationKey(citation)} citation={citation} onPress={() => openEvidence(citation)} />
              ))}
            </View>
          ) : null}
          {entry.answer.timelineReferences.length > 0 ? (
            <View>
              <Text style={styles.sectionLabel}>Timeline References</Text>
              {entry.answer.timelineReferences.map(reference => (
                <TouchableOpacity
                  key={reference.id}
                  style={styles.citation}
                  onPress={() => {
                    const destination = resolveDAVEAskTimelineNavigation(intelligence, reference.id);
                    if (destination) onOpenSupportingRecord(destination.target, destination.sourceRecordId);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open timeline reference: ${reference.title}`}
                >
                  <Text style={styles.citationText}>{reference.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#697386" />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {entry.answer.recommendedNextAction ? (
            <View>
              <Text style={styles.sectionLabel}>Recommended Action</Text>
              <Text style={styles.answerText}>{entry.answer.recommendedNextAction}</Text>
              <TouchableOpacity
                style={styles.whyButton}
                onPress={() => setExpandedWhyId(current => current === entry.id ? null : entry.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: expandedWhyId === entry.id }}
                accessibilityLabel="Explain this recommendation"
              >
                <Text style={styles.whyText}>Why?</Text>
              </TouchableOpacity>
              {expandedWhyId === entry.id ? <DAVEWhy answer={entry.answer} onOpenEvidence={openEvidence} /> : null}
            </View>
          ) : null}
        </View>
      ))}

      {clarification ? (
        <View style={styles.emptyState} accessibilityRole="alert">
          <Text style={styles.answerText}>One detail needed</Text>
          <Text style={styles.metaText}>{clarification}</Text>
        </View>
      ) : null}

      <View style={styles.followUpRow}>
        <TextInput
          style={styles.input}
          value={followUp}
          onChangeText={setFollowUp}
          placeholder="Ask a follow-up..."
          placeholderTextColor="#858B98"
          returnKeyType="send"
          onSubmitEditing={() => executeQuestion(followUp)}
          accessibilityLabel="Ask the project assistant a follow-up question"
        />
        <TouchableOpacity
          style={[styles.askButton, !followUp.trim() && styles.askButtonDisabled]}
          disabled={!followUp.trim()}
          onPress={() => executeQuestion(followUp)}
          accessibilityRole="button"
          accessibilityLabel="Send question to the project assistant"
        >
          <Text style={styles.askButtonText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AskHistorySkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading project assistant history">
      <View style={[styles.skeletonLine, { width: '68%' }]} />
      <View style={[styles.skeletonLine, { width: '92%' }]} />
      <View style={[styles.skeletonLine, { width: '54%' }]} />
    </View>
  );
}

function DAVEWhy({
  answer,
  onOpenEvidence,
}: {
  answer: DAVEAskAnswer;
  onOpenEvidence: (citation: DAVEAskEvidence) => void;
}) {
  const why = buildDAVEAskWhyModel(answer);
  return (
    <View style={styles.whyPanel}>
      <Text style={styles.sectionLabel}>Evidence Used</Text>
      {why.evidenceUsed.map(citation => (
        <CitationButton key={`why:${citationKey(citation)}`} citation={citation} onPress={() => onOpenEvidence(citation)} />
      ))}
      <AnswerList
        title="Evidence Missing"
        items={why.evidenceMissing.length > 0 ? why.evidenceMissing : ['No additional evidence gaps identified for this answer.']}
      />
      <Text style={styles.sectionLabel}>Confidence</Text>
      <Text style={styles.metaText}>{why.confidence}</Text>
      <AnswerList title="Limitations" items={why.limitations.length > 0 ? why.limitations : ['No additional limitations recorded.']} />
      <AnswerList title="Timeline Events" items={why.timelineEvents.map(item => item.title)} />
      <Text style={styles.sectionLabel}>Supporting Records</Text>
      {why.supportingRecords.map(citation => (
        <CitationButton key={`record:${citationKey(citation)}`} citation={citation} onPress={() => onOpenEvidence(citation)} />
      ))}
    </View>
  );
}

function CitationButton({ citation, onPress }: { citation: DAVEAskEvidence; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.citation}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open supporting ${citation.sourceType}: ${citation.summary}`}
    >
      <View style={styles.flex}>
        <Text style={styles.citationText}>{citation.summary}</Text>
        <Text style={styles.metaText}>{citation.sourceType}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#697386" />
    </TouchableOpacity>
  );
}

function AnswerList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <Text style={styles.sectionLabel}>{title}</Text>
      {items.map((item, index) => <Text key={`${title}:${index}:${item}`} style={styles.metaText}>• {item}</Text>)}
    </View>
  );
}

function citationKey(citation: DAVEAskEvidence): string {
  return `${citation.sourceType}:${citation.recordId}:${citation.timelineEventId || 'no-timeline'}`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    shadowColor: '#17213A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBubble: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#EEF2FF', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: '#1E2430' },
  subtitle: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#697386', textTransform: 'uppercase' },
  suggestions: { marginTop: 10, gap: 6, flexDirection: 'row', flexWrap: 'wrap' },
  suggestion: { width: '48%', minHeight: 44, paddingVertical: 8, justifyContent: 'center' },
  suggestionText: { color: '#3656A7', fontSize: 14, fontWeight: '600' },
  emptyState: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#F7F8FB' },
  skeleton: { marginTop: 12, paddingVertical: 8, gap: 9 },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: '#F2F2F7' },
  historyEntry: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#E8EAF0' },
  questionText: { color: '#1E2430', fontSize: 15, fontWeight: '700' },
  sectionLabel: { marginTop: 10, marginBottom: 4, color: '#50596B', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  answerText: { color: '#252B36', fontSize: 14, lineHeight: 20 },
  metaText: { color: '#697386', fontSize: 12, lineHeight: 17 },
  citation: { marginTop: 6, padding: 10, borderRadius: 10, backgroundColor: '#F7F8FB', flexDirection: 'row', alignItems: 'center', gap: 8 },
  citationText: { color: '#34405A', fontSize: 13, lineHeight: 18 },
  whyButton: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#EEF2FF' },
  whyText: { color: '#3656A7', fontWeight: '700', fontSize: 13 },
  whyPanel: { marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: '#F7F8FB' },
  followUpRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#D7DAE2', borderRadius: 12, paddingHorizontal: 12, color: '#1E2430', backgroundColor: '#FFFFFF' },
  askButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3656A7' },
  askButtonDisabled: { opacity: 0.45 },
  askButtonText: { color: '#FFFFFF', fontWeight: '700' },
});
