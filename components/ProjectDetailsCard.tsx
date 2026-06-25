import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type IconName = keyof typeof Ionicons.glyphMap;

export type PhotoCategory =
  | 'Open Issue'
  | 'Safety Concern'
  | 'Update';

export type ActionStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting'
  | 'Closed';

export type UpdatePhoto = {
  id: string;
  uri: string;
  caption: string;
  category: PhotoCategory;
  actionRequired: string;
  actionOwner: string;
  actionDueDate: string;
  actionStatus: ActionStatus;
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

export type ProjectUpdate = {
  id: string;
  projectName: string;
  date: string;
  photos: UpdatePhoto[];
  notes: string;
  recipients: {
    contactIds: string[];
  };
  selectedAreaId?: string | null;
  selectedAreaName?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAccuracy?: number | null;
  distanceFromSelectedAreaFeet?: number | null;
  locationCapturedAt?: string | null;
};

export type ProjectContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  emails?: string[];
  phones?: string[];
  selectedEmail?: string | null;
  selectedPhone?: string | null;
};

export type ProjectArea = {
  id: string;
  name: string;
  building?: string;
  latitude: number;
  longitude: number;
  radiusFeet: number;
  locationCapturedAt?: string | null;
};

export type AreaSuggestion = {
  area: ProjectArea;
  distanceFeet: number;
  withinRadius: boolean;
};

export const CATEGORIES: PhotoCategory[] = [
  'Open Issue',
  'Safety Concern',
  'Update',
];

export const CATEGORY_ICONS: Record<PhotoCategory, IconName> = {
  'Open Issue': 'alert-circle-outline',
  'Safety Concern': 'warning-outline',
  Update: 'information-circle-outline',
};

export const ACTION_STATUSES: ActionStatus[] = [
  'Open',
  'In Progress',
  'Waiting',
  'Closed',
];

export const colors = {
  bg: '#F5F5F7',
  card: '#FFFFFF',
  fill: '#F2F2F7',
  text: '#1D1D1F',
  muted: '#6E6E73',
  tertiaryText: '#9A9AA0',
  line: '#E5E5EA',
  primary: '#007AFF',
  primarySoft: '#EAF4FF',
  success: '#34C759',
  successSoft: '#EAF8EE',
  warning: '#FF9500',
  warningSoft: '#FFF4E5',
  dangerSoft: '#FFECEC',
  danger: '#FF3B30',
};

export function parseDueDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

export function isActionCategory(category: PhotoCategory) {
  return category === 'Open Issue' || category === 'Safety Concern';
}

function formatSavedTime(value: string | null) {
  if (!value) return 'Recently';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return 'Recently';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function hasSavedAreaLocation(area: ProjectArea) {
  return Boolean(area.locationCapturedAt);
}

function formatFeet(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown';
  }

  return `${Math.round(value).toLocaleString('en-US')} ft`;
}

export function DraftSavedIndicator({
  savedAt,
}: {
  savedAt: string | null;
}) {
  if (!savedAt) return null;

  return (
    <View style={styles.draftSavedIndicator}>
      <Ionicons
        name="cloud-done-outline"
        size={16}
        color={colors.success}
      />

      <Text style={styles.draftSavedText}>
        Draft saved automatically at{' '}
        {formatSavedTime(savedAt)}
      </Text>
    </View>
  );
}

export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.screenTitle}>
      <Text style={styles.title}>
        {title}
      </Text>

      <Text style={styles.subtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  icon,
  onPress,
  disabled,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.primaryButton,
        compact && styles.compactButton,
        disabled && styles.disabledButton,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.buttonContent}>
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color="#FFFFFF"
          />
        ) : null}

        <Text
          style={styles.primaryButtonText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function SecondaryButton({
  label,
  icon,
  onPress,
  compact,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.secondaryButton,
        compact && styles.compactButton,
      ]}
      onPress={onPress}
    >
      <View style={styles.buttonContent}>
        {icon ? (
          <Ionicons
            name={icon}
            size={20}
            color={colors.primary}
          />
        ) : null}

        <Text
          style={styles.secondaryButtonText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function ProgressStat({
  number,
  label,
}: {
  number: number;
  label: string;
}) {
  return (
    <View style={styles.progressStat}>
      <Text style={styles.progressNumber}>
        {number}
      </Text>

      <Text style={styles.progressText}>
        {label}
      </Text>
    </View>
  );
}

export function EmptyState({
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

export function ProjectDetailsCard({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationStatus: string | null;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const hasGps =
    update.gpsLatitude !== null &&
    update.gpsLatitude !== undefined &&
    update.gpsLongitude !== null &&
    update.gpsLongitude !== undefined;

  const savedAreaLocationCount = projectAreas.filter(
    hasSavedAreaLocation,
  ).length;

  const suggestionText = areaSuggestion
    ? areaSuggestion.withinRadius
      ? `Suggested Area: ${areaSuggestion.area.name}`
      : `Closest Area: ${areaSuggestion.area.name}, but you are outside the saved radius.`
    : savedAreaLocationCount === 0
      ? 'No GPS points are saved for project areas yet. You can still select the area manually.'
      : savedAreaLocationCount < projectAreas.length
        ? 'Refresh GPS Location or choose an area manually. GPS suggestions use only areas that have saved GPS points.'
        : 'Refresh GPS Location or choose an area manually.';

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name="location-outline"
            size={20}
            color={colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>
            Project Area
          </Text>

          <Text style={styles.rowSub}>
            {selectedArea
              ? selectedArea.name
              : update.selectedAreaName || 'No area selected'}
          </Text>
        </View>
      </View>

      <Text style={styles.bodyText}>
        {suggestionText}
      </Text>

      {areaSuggestion ? (
        <Text style={styles.locationDetailText}>
          Distance: {formatFeet(areaSuggestion.distanceFeet)} | Radius:{' '}
          {formatFeet(areaSuggestion.area.radiusFeet)}
        </Text>
      ) : null}

      <Text style={styles.locationDetailText}>
        {hasGps
          ? `GPS Captured${
              update.gpsAccuracy
                ? ` | Accuracy ${formatFeet(update.gpsAccuracy)}`
                : ''
            }`
          : locationStatus || 'GPS not captured yet'}
      </Text>

      {locationStatus && hasGps ? (
        <Text style={styles.locationDetailText}>
          {locationStatus}
        </Text>
      ) : null}

      <View style={styles.locationActionRow}>
        <PrimaryButton
          label="Confirm Area"
          icon="checkmark-circle-outline"
          onPress={onConfirmArea}
          disabled={!areaSuggestion}
          compact
        />

        <SecondaryButton
          label="Refresh GPS"
          icon="navigate-outline"
          onPress={onRefreshLocation}
          compact
        />
      </View>

      <Text style={styles.sectionLabel}>
        Change Area
      </Text>

      <View style={styles.areaChipWrap}>
        {projectAreas.map(area => {
          const selected =
            area.id === update.selectedAreaId ||
            area.id === selectedArea?.id;

          return (
            <TouchableOpacity
              key={area.id}
              style={[
                styles.areaChip,
                selected && styles.areaChipSelected,
              ]}
              onPress={() => onChangeArea(area.id)}
            >
              <Text
                style={[
                  styles.areaChipText,
                  selected && styles.areaChipTextSelected,
                ]}
              >
                {area.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  appFrame: {
    flex: 1,
  },

  title: {
    color: colors.text,
    fontSize: 31,
    fontWeight: '800',
    lineHeight: 37,
  },

  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginTop: 7,
    fontWeight: '500',
  },

  screenTitle: {
    marginBottom: 12,
  },

  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  secondaryButton: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 54,
    justifyContent: 'center',
  },

  compactButton: {
    flex: 1,
    minHeight: 64,
    marginBottom: 0,
  },

  disabledButton: {
    opacity: 0.45,
  },

  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    maxWidth: '100%',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  secondaryButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },

  panel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
  },

  bodyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },

  locationPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  locationPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },

  locationDetailText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 7,
  },

  locationActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },

  areaChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  areaChip: {
    backgroundColor: colors.fill,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },

  areaChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  areaChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },

  areaChipTextSelected: {
    color: '#FFFFFF',
  },

  draftSavedIndicator: {
    backgroundColor: colors.successSoft,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 11,
    marginBottom: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },

  draftSavedText: {
    color: '#248A3D',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },

  rowMain: {
    flex: 1,
  },

  rowIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rowSub: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },

  contactSummary: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  contactSummaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },

  contactSummaryAction: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },

  inlineLink: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    marginBottom: 12,
  },

  inlineLinkText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  progressPanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
  },

  progressStat: {
    flex: 1,
    alignItems: 'center',
  },

  progressDivider: {
    width: 1,
    height: 34,
    backgroundColor: colors.line,
  },

  progressNumber: {
    color: colors.primary,
    fontSize: 28,
    fontWeight: '800',
  },

  progressText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
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

  photoCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },

  photoHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    marginBottom: 12,
  },

  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.line,
  },

  photoMeta: {
    flex: 1,
  },

  photoTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },

  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  categoryChipActive: {
    backgroundColor: colors.primary,
  },

  categoryText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  categoryTextActive: {
    color: '#FFFFFF',
  },

  photoPreviewBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionPanel: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: '#CFE6FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },

  actionPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },

  actionPanelTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },

  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  statusButton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },

  statusButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  statusButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },

  statusButtonTextActive: {
    color: '#FFFFFF',
  },

  dateHelpError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    marginTop: -7,
    marginBottom: 10,
  },

  photoControlRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  photoControlButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },

  photoControlButtonDisabled: {
    backgroundColor: colors.fill,
  },

  photoControlText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },

  photoControlTextDisabled: {
    color: colors.tertiaryText,
  },

  iconOnlyDangerButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },

  input: {
    minHeight: 46,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },

  notesInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },

  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderColor: colors.line,
    borderWidth: 1,
  },

  previewLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 7,
  },

  subjectText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },

  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: 14,
  },

  previewBody: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },

  sendRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
});
