import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Screen } from '../components/layout/Screen';
import { ScreenCard } from '../components/layout/ScreenCard';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import {
  analyzeProjectIntelligence,
  type ProjectIntelligenceSummary,
  type ProjectNextActionType,
  type ProjectReportHistoryMetadata,
  type ProjectSyncFreshnessMetadata,
} from '../services/ProjectIntelligenceEngine';
import {
  buildPIEMemory,
  buildProjectStory,
  getMemoryGaps,
  getMemoryInsights,
  getProjectPatterns,
  getTimelineSegments,
  type PIEMemoryGap,
  type PIEMemoryInsight,
  type PIEMemoryPattern,
  type PIEMemorySnapshot,
  type PIEProjectStory,
  type PIEProjectTimelineSegment,
} from '../services/PIEMemoryEngine';
import {
  buildPIEReasoning,
  getPIEConcerns,
  getPIEQuestions,
  getPIERecommendations,
  type PIEReasoningResult,
  type PIEThought,
} from '../services/PIEReasoningEngine';
import {
  colors,
  radius,
  spacing,
  typography,
} from '../theme';
import type {
  ContactBook,
  ProjectArea,
  ProjectUpdate,
  ReferenceDocument,
  ScheduleItem,
} from '../types';
import { formatDisplayDate } from '../utils/date';

type IconName = keyof typeof Ionicons.glyphMap;

type SuggestedQuestion = {
  id: AssistantQuestionId;
  label: string;
  icon: IconName;
};

type AssistantQuestionId =
  | 'status'
  | 'change'
  | 'attention'
  | 'schedule'
  | 'boss'
  | 'customer'
  | 'walk'
  | 'next'
  | 'story'
  | 'overTime'
  | 'missing'
  | 'recurring'
  | 'remember'
  | 'unknown';

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type AssistantMemoryContext = {
  memory: PIEMemorySnapshot;
  story: PIEProjectStory;
  gaps: PIEMemoryGap[];
  timelineSegments: PIEProjectTimelineSegment[];
  patterns: PIEMemoryPattern[];
  insights: PIEMemoryInsight[];
};

const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    id: 'status',
    label: 'What is the current project status?',
    icon: 'pulse-outline',
  },
  {
    id: 'change',
    label: 'What changed recently?',
    icon: 'newspaper-outline',
  },
  {
    id: 'story',
    label: 'What is the project story?',
    icon: 'book-outline',
  },
  {
    id: 'overTime',
    label: 'What changed over time?',
    icon: 'git-branch-outline',
  },
  {
    id: 'attention',
    label: 'What needs attention?',
    icon: 'alert-circle-outline',
  },
  {
    id: 'missing',
    label: 'What are we missing?',
    icon: 'help-circle-outline',
  },
  {
    id: 'recurring',
    label: 'Is this a recurring issue?',
    icon: 'repeat-outline',
  },
  {
    id: 'schedule',
    label: 'What is behind schedule?',
    icon: 'calendar-outline',
  },
  {
    id: 'boss',
    label: 'What should I tell my boss?',
    icon: 'briefcase-outline',
  },
  {
    id: 'customer',
    label: 'What should I tell the customer?',
    icon: 'chatbubble-ellipses-outline',
  },
  {
    id: 'next',
    label: 'What is the next action?',
    icon: 'arrow-forward-circle-outline',
  },
  {
    id: 'remember',
    label: 'What does PIE remember about this project?',
    icon: 'archive-outline',
  },
  {
    id: 'walk',
    label: 'Walk the Project',
    icon: 'walk-outline',
  },
];

export function ProjectAssistantScreen({
  contentStyle,
  projectName,
  hasProject,
  updates,
  scheduleItems,
  currentUpdate,
  projectAreas,
  contacts,
  referenceDocuments,
  reportHistory,
  syncMetadata,
  onBack,
  onChooseProject,
}: {
  contentStyle?: StyleProp<ViewStyle>;
  projectName: string;
  hasProject: boolean;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  currentUpdate: ProjectUpdate | null;
  projectAreas?: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
  onBack: () => void;
  onChooseProject: () => void;
}) {
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [typedQuestion, setTypedQuestion] = useState('');
  const displayProjectName = projectName.trim() || 'Selected Project';
  const intelligence = useMemo(
    () =>
      analyzeProjectIntelligence({
        projectName: displayProjectName,
        updates,
        scheduleItems,
        currentUpdate,
        projectAreas,
        contacts,
        referenceDocuments,
        reportHistory,
        syncMetadata,
      }),
    [
      contacts,
      currentUpdate,
      displayProjectName,
      projectAreas,
      referenceDocuments,
      reportHistory,
      scheduleItems,
      syncMetadata,
      updates,
    ],
  );

  function answerQuestion(question: string) {
    const latestIntelligence = analyzeProjectIntelligence({
      projectName: displayProjectName,
      updates,
      scheduleItems,
      currentUpdate,
      projectAreas,
      contacts,
      referenceDocuments,
      reportHistory,
      syncMetadata,
    });
    const latestReasoning = buildPIEReasoning({
      projectName: displayProjectName,
      intelligence: latestIntelligence,
      updates,
      scheduleItems,
      referenceDocuments,
    });
    const latestMemory = buildAssistantMemoryContext({
      projectName: displayProjectName,
      intelligence: latestIntelligence,
      reasoning: latestReasoning,
      updates,
      scheduleItems,
      referenceDocuments,
      reportHistory,
    });
    const response = buildAssistantResponse(
      question,
      latestIntelligence,
      latestReasoning,
      latestMemory,
    );

    setConversation(previous => [
      ...previous,
      {
        id: `${Date.now()}-${previous.length}-user`,
        role: 'user',
        text: question,
      },
      {
        id: `${Date.now()}-${previous.length}-assistant`,
        role: 'assistant',
        text: response,
      },
    ]);
  }

  function answerSuggestedQuestion(question: SuggestedQuestion) {
    answerQuestion(question.label);
  }

  function submitTypedQuestion() {
    const trimmed = typedQuestion.trim();

    if (!trimmed) return;

    answerQuestion(trimmed);
    setTypedQuestion('');
  }

  if (!hasProject) {
    return (
      <Screen contentStyle={contentStyle}>
        <ScreenHeader
          title="Project Assistant"
          subtitle={`${timeGreeting()}. Choose a project to start.`}
          onBack={onBack}
        />

        <ScreenCard
          style={styles.promptCard}
          elevated
        >
          <Text style={styles.cardTitle}>
            Choose a project
          </Text>

          <Text style={styles.bodyText}>
            Project Assistant needs a current project before it can prepare a useful briefing.
          </Text>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onChooseProject}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>
              Open Projects
            </Text>

            <Ionicons
              name="folder-outline"
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </ScreenCard>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={contentStyle}>
      <ScreenHeader
        eyebrow="Project Intelligence"
        title="Project Assistant"
        subtitle={`${timeGreeting()}. Here is the current read on the project.`}
        onBack={onBack}
      />

      <ScreenCard
        style={styles.currentProjectCard}
        elevated
      >
        <Text style={styles.label}>
          Current Project
        </Text>

        <Text style={styles.projectName}>
          {displayProjectName}
        </Text>

        <Text style={styles.bodyText}>
          Using the active or last opened project.
        </Text>
      </ScreenCard>

      <ScreenCard style={styles.briefCard}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.cardTitle}>
            Project Brief
          </Text>

          <View style={styles.engineBadge}>
            <Text style={styles.engineBadgeText}>
              Powered by PIE
            </Text>
          </View>
        </View>

        <View style={styles.briefGrid}>
          <BriefMetric
            label="Health"
            value={healthLabel(intelligence)}
            icon="pulse-outline"
            danger={intelligence.healthStatus === 'at-risk'}
          />
          <BriefMetric
            label="Progress"
            value={progressLabel(intelligence)}
            icon="stats-chart-outline"
          />
          <BriefMetric
            label="Confidence"
            value={`${intelligence.confidence.score}% ${confidenceLabel(intelligence)}`}
            icon="checkmark-circle-outline"
          />
          <BriefMetric
            label="Last Update"
            value={lastUpdateLabel(intelligence)}
            icon="time-outline"
          />
        </View>

        <View style={styles.nextActionPanel}>
          <Text style={styles.label}>
            PIE Insight
          </Text>

          <Text style={styles.nextActionTitle}>
            PIE recommends: {intelligence.recommendedNextAction.label}
          </Text>

          <Text style={styles.bodyText}>
            {intelligence.recommendedNextAction.description}
          </Text>
        </View>
      </ScreenCard>

      <ScreenCard style={styles.questionsCard}>
        <Text style={styles.cardTitle}>
          Suggested Questions
        </Text>

        <View style={styles.questionStack}>
          {SUGGESTED_QUESTIONS.map(question => (
            <TouchableOpacity
              key={question.id}
              style={styles.questionButton}
              onPress={() => answerSuggestedQuestion(question)}
              accessibilityRole="button"
            >
              <Ionicons
                name={question.icon}
                size={20}
                color={colors.primary}
              />

              <Text style={styles.questionText}>
                {question.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScreenCard>

      <ScreenCard style={styles.conversationCard}>
        <Text style={styles.cardTitle}>
          Conversation
        </Text>

        <View style={styles.messageStack}>
          {conversation.length === 0 ? (
            <AssistantBubble text="Ask one of the suggested questions, or type your own. I will answer from current project information and project memory." />
          ) : (
            conversation.map(message =>
              message.role === 'assistant' ? (
                <AssistantBubble
                  key={message.id}
                  text={message.text}
                />
              ) : (
                <UserBubble
                  key={message.id}
                  text={message.text}
                />
              ),
            )
          )}
        </View>
      </ScreenCard>

      <ScreenCard style={styles.askCard}>
        <Text style={styles.cardTitle}>
          Ask Your Own Question
        </Text>

        <View style={styles.askRow}>
          <TextInput
            style={styles.questionInput}
            value={typedQuestion}
            onChangeText={setTypedQuestion}
            placeholder="Try status, story, missing, recurring, next, or walk"
            placeholderTextColor={colors.tertiaryText}
            returnKeyType="send"
            onSubmitEditing={submitTypedQuestion}
          />

          <TouchableOpacity
            style={styles.askButton}
            onPress={submitTypedQuestion}
            accessibilityRole="button"
            accessibilityLabel="Ask Project Assistant"
          >
            <Ionicons
              name="send-outline"
              size={20}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        </View>
      </ScreenCard>
    </Screen>
  );
}

function BriefMetric({
  label,
  value,
  icon,
  danger,
}: {
  label: string;
  value: string;
  icon: IconName;
  danger?: boolean;
}) {
  return (
    <View style={styles.briefMetric}>
      <View
        style={[
          styles.metricIcon,
          danger && styles.metricIconDanger,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={danger ? colors.danger : colors.primary}
        />
      </View>

      <View style={styles.metricText}>
        <Text style={styles.label}>
          {label}
        </Text>

        <Text
          style={[
            styles.metricValue,
            danger && styles.metricValueDanger,
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <View style={styles.assistantBubble}>
      <Text style={styles.messageAuthor}>
        Project Assistant
      </Text>

      <Text style={styles.messageText}>
        {text}
      </Text>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userBubble}>
      <Text style={styles.userMessageText}>
        {text}
      </Text>
    </View>
  );
}

function timeGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';

  return 'Good evening';
}

function buildAssistantMemoryContext({
  projectName,
  intelligence,
  reasoning,
  updates,
  scheduleItems,
  referenceDocuments,
  reportHistory,
}: {
  projectName: string;
  intelligence: ProjectIntelligenceSummary;
  reasoning: PIEReasoningResult;
  updates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  referenceDocuments?: ReferenceDocument[];
  reportHistory?: ProjectReportHistoryMetadata[];
}): AssistantMemoryContext {
  const memoryParams = {
    projectName,
    intelligence,
    reasoning,
    projectEvents: intelligence.recentEvents,
    updates,
    scheduleItems,
    referenceDocuments,
    reportHistory,
  };
  const memory = buildPIEMemory(memoryParams);

  return {
    memory,
    story: buildProjectStory(memoryParams),
    gaps: getMemoryGaps(memory),
    timelineSegments: getTimelineSegments(memory),
    patterns: getProjectPatterns(memory),
    insights: getMemoryInsights(memory),
  };
}

function buildAssistantResponse(
  question: string,
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
  memory: AssistantMemoryContext,
) {
  const kind = classifyQuestion(question);

  if (kind === 'status') return statusResponse(intelligence, reasoning);
  if (kind === 'change') return changeResponse(intelligence, reasoning);
  if (kind === 'story') return projectStoryResponse(intelligence, memory);
  if (kind === 'overTime') return overTimeResponse(intelligence, memory);
  if (kind === 'attention') return attentionResponse(intelligence, reasoning);
  if (kind === 'missing') return missingMemoryResponse(intelligence, memory);
  if (kind === 'recurring') {
    return recurringIssueResponse(intelligence, reasoning, memory);
  }
  if (kind === 'schedule') return scheduleResponse(intelligence, reasoning);
  if (kind === 'boss') return bossResponse(intelligence, reasoning);
  if (kind === 'customer') return customerResponse(intelligence, reasoning);
  if (kind === 'next') return nextResponse(intelligence, reasoning);
  if (kind === 'remember') return rememberResponse(intelligence, memory);
  if (kind === 'walk') {
    return "Project Walk Mode is coming soon.\n\nEventually you'll be able to walk the project while talking naturally with Project Assistant.";
  }

  return "I don't know how to answer that yet, but I'll be able to in a future version.";
}

function classifyQuestion(question: string): AssistantQuestionId {
  const normalized = question.trim().toLowerCase();

  if (!normalized) return 'unknown';
  if (normalized.includes('walk')) return 'walk';
  if (normalized.includes('story')) return 'story';
  if (
    normalized.includes('over time') ||
    normalized.includes('changed over') ||
    normalized.includes('timeline') ||
    normalized.includes('history')
  ) {
    return 'overTime';
  }
  if (
    normalized.includes('missing') ||
    normalized.includes('memory gap') ||
    normalized.includes('gaps') ||
    normalized.includes('what are we missing')
  ) {
    return 'missing';
  }
  if (
    normalized.includes('recurring') ||
    normalized.includes('pattern') ||
    normalized.includes('keeps happening') ||
    normalized.includes('repeat')
  ) {
    return 'recurring';
  }
  if (
    normalized.includes('remember') ||
    normalized.includes('memory') ||
    normalized.includes('what does pie know')
  ) {
    return 'remember';
  }
  if (normalized.includes('boss') || normalized.includes('executive')) return 'boss';
  if (normalized.includes('customer') || normalized.includes('client')) return 'customer';
  if (normalized.includes('status') || normalized.includes('current')) return 'status';
  if (normalized.includes('change') || normalized.includes('recent')) return 'change';
  if (
    normalized.includes('attention') ||
    normalized.includes('risk') ||
    normalized.includes('issue') ||
    normalized.includes('problem')
  ) {
    return 'attention';
  }
  if (
    normalized.includes('schedule') ||
    normalized.includes('behind') ||
    normalized.includes('late') ||
    normalized.includes('overdue')
  ) {
    return 'schedule';
  }
  if (normalized.includes('next') || normalized.includes('should')) return 'next';

  return 'unknown';
}

function statusResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const thought = thoughtById(reasoning, 'project-status-thought');
  const recommendation = topRecommendation(reasoning, intelligence.recommendedNextAction.action);
  const concern = firstConcern(reasoning);

  return [
    `Here is my read on ${intelligence.projectName}:`,
    `Health: ${healthLabel(intelligence)}.`,
    `Progress: ${progressLabel(intelligence)}.`,
    `Schedule: ${scheduleLabel(intelligence)}.`,
    `Why: ${thought?.summary || intelligence.healthSignal.message}`,
    evidenceLine(thought?.evidence.map(item => `${item.title}: ${item.detail}`)),
    concern ? `Watch item: ${concern.title} - ${concern.summary}` : 'Watch item: no urgent concern surfaced from current data.',
    `Confidence: ${confidenceText(thought?.confidence || intelligence.confidence.level)}.`,
    `Suggested next action: ${recommendation?.suggestedNextAction || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function changeResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const thought = thoughtById(reasoning, 'recent-activity-thought');
  const recentEvidence = thought?.evidence.length
    ? thought.evidence
    : reasoning.evidence.filter(item =>
        ['project-event', 'typed-update', 'photo-caption', 'photo-category'].includes(item.source),
      );

  if (recentEvidence.length === 0) {
    return [
      'I do not see recent project history yet.',
      'Why: there are no saved updates, photo notes, or project events available for this project.',
      'Evidence: no recent event evidence found.',
      'Confidence: Low.',
      'Suggested next action: capture a field update to establish the recent project story.',
    ].join('\n');
  }

  return [
    `Recently: ${thought?.summary || intelligence.projectStory.summary}`,
    evidenceLine(recentEvidence.map(item => `${item.title}: ${item.detail}`)),
    `Confidence: ${confidenceText(thought?.confidence || confidenceFromEvidence(recentEvidence.length))}.`,
    `Suggested next action: ${topRecommendation(reasoning, 'capture-update')?.suggestedNextAction || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function projectStoryResponse(
  intelligence: ProjectIntelligenceSummary,
  memory: AssistantMemoryContext,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const story = memory.story;

  return [
    `Project story for ${intelligence.projectName}:`,
    `What happened: ${story.whatHappened}`,
    `What changed: ${story.whatChangedOverTime}`,
    `Current phase: ${phaseLabel(story.currentPhase)}.`,
    `Major risks: ${inlineList(story.majorRisks, 'none surfaced from project memory yet')}.`,
    `Unresolved questions: ${inlineList(story.unresolvedQuestions, 'none surfaced yet')}.`,
    `Likely next step: ${story.likelyNextStep}.`,
    memoryInsightLine(memory),
    evidenceLine(memoryEvidence(memory)),
    `Confidence: ${confidenceText(story.confidence)}.`,
  ].join('\n');
}

function overTimeResponse(
  intelligence: ProjectIntelligenceSummary,
  memory: AssistantMemoryContext,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const activeSegments = memory.timelineSegments.filter(hasTimelineActivity);

  if (activeSegments.length === 0) {
    return [
      'I do not have enough timeline history to compare change over time yet.',
      'Why: project memory needs dated updates, photos, schedule items, documents, reports, or events before trends are reliable.',
      evidenceLine(memoryEvidence(memory)),
      `Confidence: ${confidenceText(memory.memory.confidence)}.`,
      'Suggested next action: capture a fresh field update and add schedule or document context.',
    ].join('\n');
  }

  const first = activeSegments[0];
  const last = activeSegments[activeSegments.length - 1];
  const timelineLine =
    first && last && first.id !== last.id
      ? `Timeline: ${first.title} to ${last.title}.`
      : `Timeline: ${first?.title || 'one timeline segment'}.`;
  const pattern = memory.patterns[0];

  return [
    `Change over time: ${memory.story.whatChangedOverTime}`,
    timelineLine,
    pattern
      ? `Pattern: ${pattern.title} - ${pattern.summary}`
      : 'Pattern: no recurring pattern is strong enough yet.',
    evidenceLine(activeSegments.slice(-3).map(segment => `${segment.title}: ${segment.summary}`)),
    `Confidence: ${confidenceText(memory.memory.confidence)}.`,
    `Suggested next action: ${topMemoryAction(memory) || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function missingMemoryResponse(
  intelligence: ProjectIntelligenceSummary,
  memory: AssistantMemoryContext,
) {
  const gaps = memory.gaps;

  if (gaps.length === 0) {
    return [
      'I do not see major project-memory gaps right now.',
      'Why: updates, schedule, photos, documents, inspections, and reports have enough coverage for the current rule-based read.',
      evidenceLine(memoryEvidence(memory)),
      `Confidence: ${confidenceText(memory.memory.confidence)}.`,
      `Suggested next action: ${intelligence.recommendedNextAction.label}.`,
    ].join('\n');
  }

  return [
    'Here is what is missing from project memory:',
    ...gaps
      .slice(0, 6)
      .map(gap => `- ${gap.title}: ${gap.summary} Impact: ${gap.impact}`),
    `Why: missing history lowers confidence and can weaken reports, status reads, and future project-walk guidance.`,
    `Confidence: ${confidenceText(gaps[0].confidence)}.`,
    `Suggested next action: ${gaps[0].suggestedAction}.`,
  ].join('\n');
}

function recurringIssueResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
  memory: AssistantMemoryContext,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const recurringPatterns = memory.patterns.filter(pattern =>
    pattern.priority !== 'low' ||
    pattern.id.includes('issue') ||
    pattern.id.includes('safety') ||
    pattern.id.includes('schedule') ||
    pattern.id.includes('waiting'),
  );
  const visiblePatterns =
    recurringPatterns.length > 0 ? recurringPatterns : memory.patterns;

  if (visiblePatterns.length === 0) {
    return [
      'I do not see a recurring issue pattern yet.',
      'Why: PIE memory needs repeated issues, schedule movement, safety observations, or photo actions before it can call something recurring.',
      evidenceLine(memoryEvidence(memory)),
      `Confidence: ${confidenceText(memory.memory.confidence)}.`,
      'Suggested next action: keep capturing updates with issue, owner, and due-date context so patterns can form.',
    ].join('\n');
  }

  const concern = firstConcern(reasoning);
  const topPattern = visiblePatterns[0];

  return [
    `Yes, I see ${visiblePatterns.length} recurring pattern${visiblePatterns.length === 1 ? '' : 's'} in memory:`,
    ...visiblePatterns
      .slice(0, 3)
      .map(pattern => `- ${pattern.title}: ${pattern.summary}`),
    `Why: ${topPattern.summary}`,
    evidenceLine(topPattern.evidence),
    concern ? `Related concern: ${concern.title} - ${concern.summary}` : 'Related concern: none urgent beyond the pattern itself.',
    `Confidence: ${confidenceText(topPattern.confidence)}.`,
    `Suggested next action: ${topMemoryAction(memory) || topPattern.summary}.`,
  ].join('\n');
}

function rememberResponse(
  intelligence: ProjectIntelligenceSummary,
  memory: AssistantMemoryContext,
) {
  const topInsight = memory.insights[0];

  return [
    `PIE remembers ${memorySourceCountLine(memory.memory)} for ${intelligence.projectName}.`,
    `Project story: ${memory.story.whatHappened}`,
    `Timeline: ${timelineSummary(memory.timelineSegments)}.`,
    `Patterns: ${inlineList(memory.patterns.slice(0, 3).map(pattern => pattern.title), 'none strong yet')}.`,
    `Gaps: ${inlineList(memory.gaps.slice(0, 3).map(gap => gap.title), 'no major gaps surfaced')}.`,
    topInsight
      ? `Best memory insight: ${topInsight.summary}`
      : 'Best memory insight: project memory is still forming.',
    `Confidence: ${confidenceText(memory.memory.confidence)}.`,
    `Suggested next action: ${topMemoryAction(memory) || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function attentionResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const concerns = getPIEConcerns(reasoning);
  const questions = getPIEQuestions(reasoning);

  if (concerns.length === 0) {
    return [
      'I do not see urgent attention items in the current project data.',
      `Why: ${intelligence.healthSignal.message}`,
      evidenceLine(reasoning.evidence.map(item => `${item.title}: ${item.detail}`)),
      `Confidence: ${confidenceText(intelligence.healthSignal.confidence)}.`,
      `Suggested next action: ${intelligence.recommendedNextAction.label}.`,
    ].join('\n');
  }

  const topConcerns = concerns
    .slice(0, 4)
    .map(concern => `- ${concern.title}: ${concern.summary}`);
  const firstQuestion = questions[0];

  return [
    'These items need attention:',
    ...topConcerns,
    `Why: ${concerns[0].impact}`,
    evidenceLine(evidenceForIds(reasoning, concerns[0].evidenceIds)),
    firstQuestion ? `Open question: ${firstQuestion.question}` : 'Open question: none surfaced yet.',
    `Confidence: ${confidenceText(concerns[0].confidence)}.`,
    `Suggested next action: ${concerns[0].suggestedNextAction}.`,
  ].join('\n');
}

function scheduleResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  const scheduleThought = thoughtById(reasoning, 'schedule-reasoning-thought');
  const concerns = getPIEConcerns(reasoning).filter(concern =>
    concern.source === 'schedule' ||
    concern.id.includes('schedule') ||
    concern.id.includes('waiting'),
  );

  if (intelligence.scheduleStatus === 'not-available') {
    return [
      'I do not see schedule data for this project yet.',
      'Why: PIE does not have schedule items to compare planned work, overdue work, or progress.',
      'Evidence: no schedule item evidence found.',
      'Confidence: Low.',
      'Suggested next action: add or import schedule items so I can identify overdue work, upcoming work, and progress.',
    ].join('\n');
  }

  const concern = concerns[0];
  const scheduleEvidence = scheduleThought?.evidence.map(item => `${item.title}: ${item.detail}`);

  return [
    concern
      ? `Schedule read: ${concern.summary}`
      : `Schedule read: ${scheduleLabel(intelligence)} with ${progressLabel(intelligence)} progress context.`,
    `Why: ${scheduleThought?.summary || 'Schedule evidence is available for this project.'}`,
    evidenceLine(scheduleEvidence),
    `Confidence: ${confidenceText(scheduleThought?.confidence || confidenceFromEvidence(intelligence.metrics.scheduleItemCount))}.`,
    `Suggested next action: ${concern?.suggestedNextAction || topRecommendation(reasoning, 'review-upcoming-schedule')?.suggestedNextAction || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function bossResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  if (hasNoProjectData(intelligence)) return emptyProjectDataResponse();

  const concerns = getPIEConcerns(reasoning);
  const recommendation = getPIERecommendations(reasoning)[0];
  const talkingPoints = reasoning.communicationInsight.talkingPoints.slice(0, 3);

  return [
    'Boss update:',
    ...talkingPoints.map(point => `- ${point}`),
    concerns[0] ? `- Main watch item: ${concerns[0].title}.` : '- Main watch item: none urgent in current data.',
    `Why: ${recommendation?.why || reasoning.communicationInsight.summary}`,
    evidenceLine(recommendation?.evidence),
    `Confidence: ${confidenceText(recommendation?.confidence || reasoning.communicationInsight.confidence)}.`,
    `Suggested next action: ${recommendation?.suggestedNextAction || intelligence.recommendedNextAction.label}.`,
  ].join('\n');
}

function customerResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  const readiness = communicationLabel(intelligence);
  const recommendation = getPIERecommendations(reasoning)[0];

  if (intelligence.communicationReadiness.level === 'not-ready') {
    return [
      'I would hold the customer update for now.',
      `Why: ${reasoning.communicationInsight.summary}`,
      reasoning.communicationInsight.missingContext.length > 0
        ? `Missing context: ${reasoning.communicationInsight.missingContext.slice(0, 3).join(' ')}`
        : 'Missing context: capture more current field or schedule detail.',
      evidenceLine(evidenceForIds(reasoning, reasoning.communicationInsight.evidenceIds)),
      `Confidence: ${confidenceText(reasoning.communicationInsight.confidence)}.`,
      'Suggested next action: capture a recent update, add notes or photos, and confirm schedule context before sending.',
    ].join('\n');
  }

  return [
    `Customer-ready summary: ${intelligence.projectName} is being actively tracked. Current health is ${healthLabel(intelligence).toLowerCase()}, and the next focus is ${intelligence.recommendedNextAction.label.toLowerCase()}.`,
    `Why: ${reasoning.communicationInsight.summary}`,
    `Communication readiness: ${readiness}.`,
    evidenceLine(evidenceForIds(reasoning, reasoning.communicationInsight.evidenceIds)),
    `Confidence: ${confidenceText(reasoning.communicationInsight.confidence)}.`,
    `Suggested next action: ${recommendation?.suggestedNextAction || 'review the wording before sending.'}`,
  ].join('\n');
}

function nextResponse(
  intelligence: ProjectIntelligenceSummary,
  reasoning: PIEReasoningResult,
) {
  const recommendation =
    topRecommendation(reasoning, intelligence.recommendedNextAction.action) ||
    getPIERecommendations(reasoning)[0];

  if (!recommendation) {
    return [
      `Next action: ${intelligence.recommendedNextAction.label}.`,
      `Why: ${intelligence.recommendedNextAction.description}`,
      'Evidence: current PIE summary only.',
      `Confidence: ${confidenceText(intelligence.recommendedNextAction.confidence)}.`,
      `Suggested next action: ${intelligence.recommendedNextAction.label}.`,
    ].join('\n');
  }

  return [
    `Next action: ${recommendation.title}.`,
    `Why: ${recommendation.why}`,
    `Impact: ${recommendation.impact}`,
    evidenceLine(recommendation.evidence),
    `Confidence: ${confidenceText(recommendation.confidence)}.`,
    `Suggested next action: ${recommendation.suggestedNextAction}.`,
  ].join('\n');
}

function hasNoProjectData(intelligence: ProjectIntelligenceSummary) {
  return (
    intelligence.updateCount === 0 &&
    intelligence.photoCount === 0 &&
    intelligence.metrics.scheduleItemCount === 0 &&
    intelligence.metrics.projectEventCount === 0
  );
}

function emptyProjectDataResponse() {
  return [
    'I do not have enough project data yet for a reliable answer.',
    'Why: I do not see saved updates, photos, schedule items, or project event history for this project.',
    'Evidence: no project evidence is available yet.',
    'Confidence: Low.',
    'Suggested next action: capture a field update or add/import schedule items to establish the project record.',
  ].join('\n');
}

function thoughtById(reasoning: PIEReasoningResult, id: string) {
  return reasoning.thoughts.find(thought => thought.id === id) ?? null;
}

function firstConcern(reasoning: PIEReasoningResult) {
  return getPIEConcerns(reasoning)[0] ?? null;
}

function topRecommendation(
  reasoning: PIEReasoningResult,
  action: ProjectNextActionType,
) {
  return (
    getPIERecommendations(reasoning).find(
      recommendation => recommendation.metadata.action === action,
    ) ?? null
  );
}

function evidenceForIds(
  reasoning: PIEReasoningResult,
  evidenceIds: string[],
) {
  const wanted = new Set(evidenceIds);

  return reasoning.evidence
    .filter(evidence => wanted.has(evidence.id))
    .map(evidence => `${evidence.title}: ${evidence.detail}`);
}

function evidenceLine(evidence?: string[]) {
  const visibleEvidence = (evidence || [])
    .filter(Boolean)
    .slice(0, 3);

  if (visibleEvidence.length === 0) {
    return 'Evidence: current project data is limited.';
  }

  return `Evidence: ${visibleEvidence.join(' | ')}`;
}

function memoryEvidence(memory: AssistantMemoryContext) {
  const activeSegment = memory.timelineSegments.find(hasTimelineActivity);
  const topPattern = memory.patterns[0];
  const topGap = memory.gaps[0];
  const topInsight = memory.insights[0];

  return [
    activeSegment ? `${activeSegment.title}: ${activeSegment.summary}` : '',
    topPattern ? `${topPattern.title}: ${topPattern.summary}` : '',
    topGap ? `${topGap.title}: ${topGap.summary}` : '',
    topInsight ? `${topInsight.title}: ${topInsight.summary}` : '',
  ];
}

function memoryInsightLine(memory: AssistantMemoryContext) {
  const insight = memory.insights[0];

  if (!insight) return 'Why: project memory is still forming.';

  return `Why: ${insight.whyItMatters} ${insight.summary}`;
}

function topMemoryAction(memory: AssistantMemoryContext) {
  return (
    memory.insights[0]?.suggestedNextAction ||
    memory.gaps[0]?.suggestedAction ||
    memory.story.likelyNextStep
  );
}

function hasTimelineActivity(segment: PIEProjectTimelineSegment) {
  return (
    segment.eventCount +
      segment.updateCount +
      segment.photoCount +
      segment.scheduleItemCount +
      segment.reportCount +
      segment.documentCount >
    0
  );
}

function timelineSummary(segments: PIEProjectTimelineSegment[]) {
  const activeSegments = segments.filter(hasTimelineActivity);

  if (activeSegments.length === 0) return 'no dated project timeline yet';

  const first = activeSegments[0];
  const last = activeSegments[activeSegments.length - 1];

  if (!first || !last || first.id === last.id) {
    return `${first?.title || 'one timeline segment'} with ${first?.summary.toLowerCase() || 'limited activity'}`;
  }

  return `${first.title} through ${last.title} across ${activeSegments.length} timeline segments`;
}

function memorySourceCountLine(memory: PIEMemorySnapshot) {
  const counts = memory.sourceCounts;

  return [
    pluralize(counts.updates, 'update'),
    pluralize(counts.photos, 'photo'),
    pluralize(counts.scheduleItems, 'schedule item'),
    pluralize(counts.documents, 'document'),
    pluralize(counts.reports, 'report'),
    pluralize(counts.projectEvents, 'project event'),
  ].join(', ');
}

function inlineList(items: string[], fallback: string) {
  const visibleItems = items
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return visibleItems.length > 0 ? visibleItems.join('; ') : fallback;
}

function pluralize(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function phaseLabel(phase: PIEProjectStory['currentPhase']) {
  if (phase === 'active-work') return 'Active Work';
  if (phase === 'risk-response') return 'Risk Response';
  if (phase === 'closeout') return 'Closeout';
  if (phase === 'reporting') return 'Reporting';
  if (phase === 'setup') return 'Setup';

  return 'Unknown';
}

function confidenceText(confidence: PIEThought['confidence']) {
  if (confidence === 'high') return 'High';
  if (confidence === 'medium') return 'Medium';

  return 'Low';
}

function confidenceFromEvidence(count: number): PIEThought['confidence'] {
  if (count >= 3) return 'high';
  if (count > 0) return 'medium';

  return 'low';
}

function healthLabel(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.healthStatus === 'healthy') return 'Healthy';
  if (intelligence.healthStatus === 'watch') return 'Watch';
  if (intelligence.healthStatus === 'at-risk') return 'At Risk';

  return 'Unknown';
}

function progressLabel(intelligence: ProjectIntelligenceSummary) {
  const progress = intelligence.metrics.averageScheduleProgress;

  if (progress === null) return 'Schedule Required';
  if (intelligence.progressStatus === 'blocked') return `${progress}% Blocked`;
  if (intelligence.progressStatus === 'complete') return 'Complete';
  if (intelligence.progressStatus === 'near-complete') return `${progress}% Near Complete`;
  if (intelligence.progressStatus === 'not-started') return `${progress}% Not Started`;

  return `${progress}% In Progress`;
}

function scheduleLabel(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.scheduleStatus === 'not-available') return 'No Schedule';
  if (intelligence.scheduleStatus === 'overdue') return 'At Risk';
  if (intelligence.scheduleStatus === 'due-soon') return 'Due Soon';
  if (intelligence.scheduleStatus === 'complete') return 'Complete';

  return 'On Track';
}

function confidenceLabel(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.confidence.level === 'high') return 'Strong';
  if (intelligence.confidence.level === 'medium') return 'Usable';

  return 'Limited';
}

function communicationLabel(intelligence: ProjectIntelligenceSummary) {
  if (intelligence.communicationReadiness.level === 'ready') {
    return `${intelligence.communicationReadiness.score}% ready`;
  }

  if (intelligence.communicationReadiness.level === 'needs-context') {
    return `${intelligence.communicationReadiness.score}% and needs context`;
  }

  return `${intelligence.communicationReadiness.score}% and not ready`;
}

function lastUpdateLabel(intelligence: ProjectIntelligenceSummary) {
  if (!intelligence.lastUpdate) return 'No saved update yet';

  return formatDisplayDate(intelligence.lastUpdate);
}

const styles = StyleSheet.create({
  promptCard: {
    gap: spacing.md,
  },

  currentProjectCard: {
    gap: spacing.xs,
  },

  briefCard: {
    gap: spacing.md,
  },

  questionsCard: {
    gap: spacing.md,
  },

  conversationCard: {
    gap: spacing.md,
  },

  askCard: {
    gap: spacing.md,
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },

  cardTitle: {
    ...typography.h2,
  },

  label: {
    ...typography.label,
  },

  bodyText: {
    ...typography.body,
  },

  projectName: {
    ...typography.display,
    fontSize: 29,
    lineHeight: 35,
  },

  engineBadge: {
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },

  engineBadgeText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  briefGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  briefMetric: {
    width: '48%',
    minWidth: 148,
    flexGrow: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.sm,
  },

  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  metricIconDanger: {
    backgroundColor: colors.dangerSoft,
  },

  metricText: {
    flex: 1,
    gap: spacing.xxs,
  },

  metricValue: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },

  metricValueDanger: {
    color: colors.danger,
  },

  nextActionPanel: {
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    padding: spacing.md,
    gap: spacing.xs,
  },

  nextActionTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  questionStack: {
    gap: spacing.sm,
  },

  questionButton: {
    minHeight: 58,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  questionText: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
  },

  messageStack: {
    gap: spacing.sm,
  },

  assistantBubble: {
    alignSelf: 'stretch',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
    gap: spacing.xs,
  },

  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    padding: spacing.md,
  },

  messageAuthor: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  messageText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },

  userMessageText: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },

  askRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  questionInput: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },

  askButton: {
    width: 50,
    height: 50,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButton: {
    minHeight: 54,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
});
