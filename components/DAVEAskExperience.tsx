import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { askDAVE, type DAVEAskAnswer, type DAVEAskEvidence } from '../services/DAVEAsk';
import {
  appendDAVEAskHistory,
  buildDAVEAskWhyModel,
  DAVE_ASK_SUGGESTED_QUESTIONS,
  daveAskHistoryStorageKey,
  parseDAVEAskHistory,
  resolveDAVEAskEvidenceNavigation,
  resolveDAVEAskTimelineNavigation,
  type DAVEAskConversationEntry,
} from '../services/DAVEAskConversation';
import type { DAVEBriefNavigationTarget } from '../services/DAVEDailyBrief';
import type { DAVEProjectIntelligence } from '../services/DAVEIntelligence';

type Props = {
  intelligence: DAVEProjectIntelligence;
  onOpenSupportingRecord: (target: DAVEBriefNavigationTarget, sourceRecordId: string) => void;
};

export function DAVEAskExperience({ intelligence, onOpenSupportingRecord }: Props) {
  const [history, setHistory] = useState<DAVEAskConversationEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);
  const storageKey = daveAskHistoryStorageKey(intelligence.projectId);

  useEffect(() => {
    let active = true;
    setHistory([]);
    setHistoryLoaded(false);
    setExpandedWhyId(null);
    AsyncStorage.getItem(storageKey)
      .then(value => {
        if (active) setHistory(parseDAVEAskHistory(value, intelligence.projectId));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHistoryLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [intelligence.projectId, storageKey]);

  function executeQuestion(question: string) {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;
    const answer = askDAVE({ question: normalizedQuestion, intelligence, interface: 'text' });
    const createdAt = new Date().toISOString();
    const entry: DAVEAskConversationEntry = {
      id: `ask:${encodeURIComponent(intelligence.projectId)}:${createdAt}:${history.length}`,
      projectId: intelligence.projectId,
      question: normalizedQuestion,
      answer,
      createdAt,
    };
    setHistory(current => {
      const next = appendDAVEAskHistory(current, entry);
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
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
          <Text style={styles.title}>Ask DAVE</Text>
          <Text style={styles.subtitle}>Suggested questions</Text>
        </View>
      </View>

      <View style={styles.suggestions}>
        {DAVE_ASK_SUGGESTED_QUESTIONS.map(question => (
          <TouchableOpacity
            key={question}
            style={styles.suggestion}
            onPress={() => executeQuestion(question)}
            accessibilityRole="button"
            accessibilityLabel={`Ask DAVE: ${question}`}
          >
            <Text style={styles.suggestionText}>• {question}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!historyLoaded ? <AskHistorySkeleton /> : null}

      {historyLoaded && history.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.answerText}>Ask me about this project.</Text>
          <Text style={styles.metaText}>Examples are listed above.</Text>
        </View>
      ) : null}

      {history.map(entry => (
        <View key={entry.id} style={styles.historyEntry}>
          <Text style={styles.questionText}>{entry.question}</Text>
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

      <View style={styles.followUpRow}>
        <TextInput
          style={styles.input}
          value={followUp}
          onChangeText={setFollowUp}
          placeholder="Ask a follow-up..."
          placeholderTextColor="#858B98"
          returnKeyType="send"
          onSubmitEditing={() => executeQuestion(followUp)}
          accessibilityLabel="Ask DAVE a follow-up question"
        />
        <TouchableOpacity
          style={[styles.askButton, !followUp.trim() && styles.askButtonDisabled]}
          disabled={!followUp.trim()}
          onPress={() => executeQuestion(followUp)}
          accessibilityRole="button"
          accessibilityLabel="Send question to DAVE"
        >
          <Text style={styles.askButtonText}>Ask</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AskHistorySkeleton() {
  return (
    <View style={styles.skeleton} accessible accessibilityLabel="Loading Ask DAVE history">
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
