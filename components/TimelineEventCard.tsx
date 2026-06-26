import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import type { ConstructionTimelineEvent } from '../services/ConstructionTimelineService';
import {
  IconName,
  colors,
} from './ProjectDetailsCard';

const typeMeta: Record<
  ConstructionTimelineEvent['type'],
  {
    icon: IconName;
    color: string;
  }
> = {
  Updates: {
    icon: 'newspaper-outline',
    color: colors.primary,
  },
  Photos: {
    icon: 'images-outline',
    color: colors.success,
  },
  Schedule: {
    icon: 'flag-outline',
    color: colors.warning,
  },
  Safety: {
    icon: 'shield-checkmark-outline',
    color: colors.danger,
  },
  'Action Items': {
    icon: 'checkbox-outline',
    color: colors.warning,
  },
  Documents: {
    icon: 'documents-outline',
    color: colors.primary,
  },
};

export function TimelineEventCard({
  event,
}: {
  event: ConstructionTimelineEvent;
}) {
  const meta = typeMeta[event.type];
  const relatedActionPreview = event.relatedActionItems.slice(0, 2).join(', ');

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View
          style={[
            styles.iconBubble,
            { backgroundColor: `${meta.color}1A` },
          ]}
        >
          <Ionicons
            name={meta.icon}
            size={19}
            color={meta.color}
          />
        </View>

        <View style={styles.headerMain}>
          <View style={styles.titleRow}>
            <Text style={styles.dateText}>
              {event.dateLabel}
            </Text>

            <View
              style={[
                styles.typePill,
                { backgroundColor: `${meta.color}1A` },
              ]}
            >
              <Text
                style={[
                  styles.typeText,
                  { color: meta.color },
                ]}
              >
                {event.type}
              </Text>
            </View>
          </View>

          <Text style={styles.projectText}>
            {event.projectName}
          </Text>
        </View>
      </View>

      <View style={styles.locationRow}>
        <Ionicons
          name="location-outline"
          size={15}
          color={colors.muted}
        />

        <Text style={styles.locationText}>
          {event.areaName}
        </Text>
      </View>

      <Text style={styles.description}>
        {event.description}
      </Text>

      {relatedActionPreview ? (
        <Text style={styles.actionPreview}>
          Related actions: {relatedActionPreview}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <TimelineBadge
          label={event.sourceLabel}
          icon="information-circle-outline"
          color={colors.primary}
        />

        {event.relatedPhotosCount > 0 ? (
          <TimelineBadge
            label={`${event.relatedPhotosCount} photo${event.relatedPhotosCount === 1 ? '' : 's'}`}
            icon="images-outline"
            color={colors.success}
          />
        ) : null}

        {event.relatedActionItems.length > 0 ? (
          <TimelineBadge
            label={`${event.relatedActionItems.length} action${event.relatedActionItems.length === 1 ? '' : 's'}`}
            icon="checkbox-outline"
            color={colors.warning}
          />
        ) : null}

        {event.hasSafety ? (
          <TimelineBadge
            label="Safety"
            icon="shield-checkmark-outline"
            color={colors.danger}
          />
        ) : null}

        {event.hasRisk && !event.hasSafety ? (
          <TimelineBadge
            label="Risk"
            icon="alert-circle-outline"
            color={colors.warning}
          />
        ) : null}
      </View>
    </View>
  );
}

function TimelineBadge({
  label,
  icon,
  color,
}: {
  label: string;
  icon: IconName;
  color: string;
}) {
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: `${color}1A` },
      ]}
    >
      <Ionicons
        name={icon}
        size={13}
        color={color}
      />

      <Text
        style={[
          styles.badgeText,
          { color },
        ]}
        numberOfLines={1}
      >
        {label}
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
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 3,
  },

  dateText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
  },

  typePill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },

  typeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },

  projectText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
  },

  locationText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },

  description: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },

  actionPreview: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 8,
  },

  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },

  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
});
