import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import type { ProjectStats } from '../types';
import { formatDisplayDate } from '../utils/date';
import { colors, styles } from './ProjectDetailsCard';

export function ProjectFinderRow({
  project,
  stats,
  archived,
  favorite,
  onPress,
  onFavorite,
  onRename,
  onClose,
  onRestore,
  onDelete,
}: {
  project: string;
  stats: ProjectStats;
  archived: boolean;
  favorite: boolean;
  onPress: () => void;
  onFavorite: () => void;
  onRename: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.projectFinderRow}>
      <TouchableOpacity
        style={styles.favoriteButton}
        onPress={onFavorite}
      >
        <Ionicons
          name={favorite ? 'star' : 'star-outline'}
          size={22}
          color={favorite ? colors.warning : colors.muted}
        />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.rowMain}
        onPress={onPress}
      >
        <Text style={styles.projectName}>
          {project}
        </Text>

        <Text style={styles.rowSub}>
          {archived ? 'Archived' : 'Active'} | Last update:{' '}
          {stats.lastUpdate ? formatDisplayDate(stats.lastUpdate) : 'None yet'}
        </Text>

        <View style={styles.compactStatsRow}>
          <Text style={styles.compactStatText}>
            Open {stats.openActions}
          </Text>

          <Text
            style={[
              styles.compactStatText,
              stats.overdueActions > 0 && styles.compactStatDanger,
            ]}
          >
            Overdue {stats.overdueActions}
          </Text>

          <Text style={styles.compactStatText}>
            Due {stats.dueThisWeek}
          </Text>

          <Text style={styles.compactStatText}>
            Photos {stats.photos}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.projectFinderActions}>
        <TouchableOpacity
          style={styles.smallAction}
          onPress={archived ? onRestore || onPress : onPress}
        >
          <Text style={styles.smallActionText}>
            {archived ? 'Restore' : 'Update'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.smallAction}
          onPress={onRename}
        >
          <Text style={styles.smallActionText}>
            Rename
          </Text>
        </TouchableOpacity>

        {onClose ? (
          <TouchableOpacity
            style={styles.smallAction}
            onPress={onClose}
          >
            <Text style={styles.smallActionText}>
              Archive
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.smallAction, styles.smallActionDanger]}
          onPress={onDelete}
        >
          <Text style={styles.smallActionDangerText}>
            Delete
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
