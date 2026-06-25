import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';

type RecentActivityUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: unknown[];
  selectedAreaName?: string | null;
};

type RecentActivityProps = {
  updates: RecentActivityUpdate[];
};

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
};

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function RecentActivity({
  updates,
}: RecentActivityProps) {
  const recentUpdates = updates.slice(0, 5);

  return (
    <>
      <Text style={styles.sectionLabel}>
        Recent Activity
      </Text>

      {recentUpdates.length === 0 ? (
        <EmptyState
          title="No updates yet"
          text="Create the first project update to start building project history."
        />
      ) : (
        recentUpdates.map(update => (
          <ActivityRow
            key={update.id}
            update={update}
          />
        ))
      )}
    </>
  );
}

function ActivityRow({
  update,
}: {
  update: RecentActivityUpdate;
}) {
  return (
    <View style={styles.activityRow}>
      <View style={styles.rowIconBubble}>
        <Ionicons
          name="time-outline"
          size={20}
          color={colors.primary}
        />
      </View>

      <View style={styles.rowMain}>
        <Text style={styles.projectName}>
          {update.projectName}
        </Text>

        <Text style={styles.rowSub}>
          {formatDisplayDate(update.date)} | {update.photos.length} photo
          {update.photos.length === 1 ? '' : 's'}
          {update.selectedAreaName ? ` | ${update.selectedAreaName}` : ''}
        </Text>
      </View>
    </View>
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

  activityRow: {
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
