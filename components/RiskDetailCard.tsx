import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { ProjectRisk } from '../services/ProjectRiskService';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';
import {
  RiskPriorityBadge,
  riskSeverityColor,
} from './RiskPriorityBadge';

const categoryIcons: Record<ProjectRisk['category'], IconName> = {
  'Schedule risk': 'calendar-outline',
  'Safety risk': 'shield-checkmark-outline',
  'Action item risk': 'checkbox-outline',
  'Documentation risk': 'documents-outline',
  'Project update frequency risk': 'time-outline',
  'Photo/progress visibility risk': 'images-outline',
};

export function RiskDetailCard({
  risk,
}: {
  risk: ProjectRisk;
}) {
  const color = riskSeverityColor(risk.severity);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconBubble,
            { backgroundColor: `${color}1A` },
          ]}
        >
          <Ionicons
            name={categoryIcons[risk.category]}
            size={19}
            color={color}
          />
        </View>

        <View style={styles.headerMain}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>
              {risk.title}
            </Text>

            <RiskPriorityBadge severity={risk.severity} />
          </View>

          <Text style={styles.category}>
            {risk.category}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <RiskMeta
          label="Project"
          value={risk.relatedProject}
        />

        <RiskMeta
          label="Area"
          value={risk.relatedArea}
        />
      </View>

      <Text style={styles.detailText}>
        {risk.detail}
      </Text>

      <View style={styles.scoreRow}>
        <RiskMeasure
          label="Likelihood"
          value={risk.likelihood}
        />

        <RiskMeasure
          label="Impact"
          value={risk.impact}
        />
      </View>

      <View style={styles.actionBox}>
        <Text style={styles.actionLabel}>
          Recommended Action
        </Text>

        <Text style={styles.actionText}>
          {risk.recommendedAction}
        </Text>
      </View>
    </View>
  );
}

function RiskMeta({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>
        {label}
      </Text>

      <Text
        style={styles.metaValue}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function RiskMeasure({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.measure}>
      <Text style={styles.measureLabel}>
        {label}
      </Text>

      <Text style={styles.measureValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },

  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerMain: {
    flex: 1,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },

  title: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '900',
  },

  category: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },

  metaItem: {
    flex: 1,
    backgroundColor: colors.fill,
    borderRadius: 8,
    padding: 9,
  },

  metaLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    marginBottom: 2,
    textTransform: 'uppercase',
  },

  metaValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800',
  },

  detailText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  scoreRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  measure: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
  },

  measureLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    marginBottom: 3,
    textTransform: 'uppercase',
  },

  measureValue: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  actionBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: 8,
    padding: 11,
    marginTop: 12,
  },

  actionLabel: {
    color: colors.primary,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    marginBottom: 3,
    textTransform: 'uppercase',
  },

  actionText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
});
