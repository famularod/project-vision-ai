import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './ProjectDetailsCard';

export type OpenActionSummary = {
  id: string;
  title: string;
  projectName: string;
  owner: string;
  dueLabel: string;
  status: string;
  isOverdue?: boolean;
};

export function OpenActionsCard({
  actions,
  title = 'Open Action Items',
  subtitle = 'Unresolved field items with owner, status, or due-date context.',
  emptyText = 'No open action items detected from saved updates.',
  danger = false,
}: {
  actions: OpenActionSummary[];
  title?: string;
  subtitle?: string;
  emptyText?: string;
  danger?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconBubble,
            danger && styles.iconBubbleDanger,
          ]}
        >
          <Ionicons
            name={danger ? 'timer-outline' : 'checkbox-outline'}
            size={20}
            color={danger ? colors.danger : colors.warning}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.title}>
            {title}
          </Text>

          <Text style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
      </View>

      {actions.length > 0 ? (
        actions.map(action => (
          <View
            key={action.id}
            style={styles.itemRow}
          >
            <View style={styles.rowMain}>
              <Text style={styles.itemTitle}>
                {action.title || 'Open action item'}
              </Text>

              <Text style={styles.itemSub}>
                {action.projectName || 'No project'} • {action.status}
              </Text>

              <Text style={styles.itemSub}>
                {action.dueLabel}
                {action.owner ? ` • ${action.owner}` : ''}
                {action.isOverdue ? ' • Overdue' : ''}
              </Text>
            </View>
          </View>
        ))
      ) : (
        <Text style={styles.emptyText}>
          {emptyText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 15,
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
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  iconBubbleDanger: {
    backgroundColor: colors.dangerSoft,
  },

  rowMain: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 2,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },

  itemRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },

  itemTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
    marginBottom: 3,
  },

  itemSub: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },

  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    paddingTop: 4,
  },
});
