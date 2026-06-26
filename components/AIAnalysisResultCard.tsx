import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ProjectAIAnalysisResult,
} from '../services/ProjectAIAnalysisService';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

export function AIAnalysisResultCard({
  result,
}: {
  result: ProjectAIAnalysisResult;
}) {
  const isAI = result.status === 'ai';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconBubble,
            { backgroundColor: isAI ? colors.primarySoft : colors.warningSoft },
          ]}
        >
          <Ionicons
            name={isAI ? 'sparkles-outline' : 'information-circle-outline'}
            size={20}
            color={isAI ? colors.primary : colors.warning}
          />
        </View>

        <View style={styles.headerMain}>
          <Text style={styles.title}>
            {isAI ? 'AI Analysis' : 'Rule-Based Fallback'}
          </Text>

          <Text style={styles.subtitle}>
            {result.provider} {result.model ? `- ${result.model}` : ''}
          </Text>
        </View>
      </View>

      <Text style={styles.message}>
        {result.message}
      </Text>

      <AIResultSection
        title="Executive Summary"
        text={result.analysis.executiveSummary}
        icon="briefcase-outline"
      />

      <AIResultList
        title="Accomplishments"
        items={result.analysis.accomplishments}
        icon="checkmark-circle-outline"
        tone="success"
      />

      <AIResultList
        title="Risks"
        items={result.analysis.risks}
        icon="warning-outline"
        tone="warning"
      />

      <AIResultList
        title="Recommended Actions"
        items={result.analysis.recommendedActions}
        icon="flag-outline"
      />

      <AIResultSection
        title="Health Score Explanation"
        text={result.analysis.healthScoreExplanation}
        icon="pulse-outline"
      />
    </View>
  );
}

function AIResultSection({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: IconName;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons
          name={icon}
          size={16}
          color={colors.primary}
        />

        <Text style={styles.sectionTitle}>
          {title}
        </Text>
      </View>

      <Text style={styles.bodyText}>
        {text}
      </Text>
    </View>
  );
}

function AIResultList({
  title,
  items,
  icon,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  icon: IconName;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : colors.primary;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons
          name={icon}
          size={16}
          color={color}
        />

        <Text style={styles.sectionTitle}>
          {title}
        </Text>
      </View>

      {items.map((item, index) => (
        <Text
          key={`${title}-${index}-${item}`}
          style={styles.listItem}
        >
          {index + 1}. {item}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },

  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '900',
  },

  subtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
  },

  message: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 12,
  },

  section: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 12,
    marginTop: 12,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 6,
  },

  sectionTitle: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '900',
    textTransform: 'uppercase',
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  listItem: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 4,
  },
});
