import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type ProjectStats = {
  updates: number;
  photos: number;
  openActions: number;
  overdueActions: number;
  dueThisWeek: number;
  lastUpdate?: string;
};

type AttentionProject = {
  project: string;
  stats: ProjectStats;
};

type AttentionCardProps = {
  projectsNeedingAttention: AttentionProject[];
  onUpdateProject: (projectName: string) => void;
};

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  danger: '#FF3B30',
};

export function AttentionCard({
  projectsNeedingAttention,
  onUpdateProject,
}: AttentionCardProps) {
  return (
    <>
      <Text style={styles.sectionLabel}>
        Projects Needing Attention
      </Text>

      {projectsNeedingAttention.length === 0 ? (
        <EmptyState
          title="No urgent project items"
          text="Open issues, overdue items, and due-this-week actions will appear here."
        />
      ) : (
        projectsNeedingAttention.map(item => (
          <ProjectAttentionCard
            key={item.project}
            project={item.project}
            stats={item.stats}
            onPress={() => onUpdateProject(item.project)}
          />
        ))
      )}
    </>
  );
}

function ProjectAttentionCard({
  project,
  stats,
  onPress,
}: {
  project: string;
  stats: ProjectStats;
  onPress: () => void;
}) {
  const urgent = stats.overdueActions > 0;

  return (
    <TouchableOpacity
      style={[
        styles.attentionCard,
        urgent && styles.attentionCardUrgent,
      ]}
      onPress={onPress}
    >
      <View style={styles.rowIconBubble}>
        <Ionicons
          name={urgent ? 'warning-outline' : 'alert-circle-outline'}
          size={20}
          color={urgent ? colors.danger : colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>
          {project}
        </Text>

        <Text style={styles.rowSub}>
          {stats.openActions} open | {stats.overdueActions} overdue | {stats.dueThisWeek} due this week
        </Text>
      </View>

      <Ionicons
        name="chevron-forward-outline"
        size={20}
        color={colors.muted}
      />
    </TouchableOpacity>
  );
}

function EmptyState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>
        {title}
      </Text>

      <Text style={styles.bodyText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  attentionCard: {
    backgroundColor: colors.card,
    borderRadius: 11,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  attentionCardUrgent: {
    borderColor: '#FFD1D1',
    backgroundColor: '#FFF8F8',
  },

  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowMain: {
    flex: 1,
  },

  projectName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },

  rowSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  emptyState: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },

  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
});
