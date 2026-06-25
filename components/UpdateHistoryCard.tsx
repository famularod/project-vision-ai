import { Ionicons } from '@expo/vector-icons';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

type HistoryPhoto = {
  id: string;
  uri: string;
  caption: string;
  category: 'Open Issue' | 'Safety Concern' | 'Update';
  actionRequired: string;
  actionOwner: string;
  actionDueDate: string;
  actionStatus: 'Open' | 'In Progress' | 'Waiting' | 'Closed';
  fileName?: string | null;
  mimeType?: string | null;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
};

type RecipientSelection = {
  contactIds: string[];
};

export type HistoryUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: HistoryPhoto[];
  notes: string;
  recipients: RecipientSelection;
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
};

type UpdateHistoryCardProps = {
  update: HistoryUpdate;
  onOpen: (update: HistoryUpdate) => void;
  onDelete: (updateId: string) => void;
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

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);

  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function UpdateHistoryCard({
  update,
  onOpen,
  onDelete,
}: UpdateHistoryCardProps) {
  return (
    <View
      key={update.id}
      style={styles.savedRow}
    >
      <View style={styles.rowIconBubble}>
        <Ionicons
          name="document-text-outline"
          size={20}
          color={colors.primary}
        />
      </View>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={() =>
          onOpen(update)
        }
      >
        <Text style={styles.projectName}>
          {update.projectName}
        </Text>

        <Text style={styles.rowSub}>
          {formatDisplayDate(update.date)} - {countLabel(update.photos.length, 'photo')}
        </Text>

        {update.selectedAreaName ? (
          <Text style={styles.rowSub}>
            Area: {update.selectedAreaName}
          </Text>
        ) : null}
      </TouchableOpacity>

      <TouchableOpacity
        style={
          styles.iconOnlyDangerButton
        }
        onPress={() =>
          onDelete(update.id)
        }
      >
        <Ionicons
          name="trash-outline"
          size={19}
          color={colors.danger}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  savedRow: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
    borderColor: colors.line,
    borderWidth: 1,
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

  iconOnlyDangerButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#FFECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
