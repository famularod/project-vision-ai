import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AreaFilterChips } from '../components/AreaFilterChips';
import {
  UpdateHistoryCard,
} from '../components/UpdateHistoryCard';
import type { HistoryUpdate } from '../components/UpdateHistoryCard';

type ProjectArea = {
  id: string;
  name: string;
};

type HistoryScreenProps = {
  contentStyle: StyleProp<ViewStyle>;
  updates: HistoryUpdate[];
  projectAreas: ProjectArea[];
  onOpen: (update: HistoryUpdate) => void;
  onDelete: (updateId: string) => void;
  onNewUpdate: () => void;
};

type IconName = keyof typeof Ionicons.glyphMap;

const colors = {
  card: '#FFFFFF',
  text: '#1D1D1F',
  muted: '#6E6E73',
  line: '#E5E5EA',
  primary: '#007AFF',
};

export function HistoryScreen({
  contentStyle,
  updates,
  projectAreas,
  onOpen,
  onDelete,
  onNewUpdate,
}: HistoryScreenProps) {
  const [areaFilterId, setAreaFilterId] = useState<string | null>(
    null,
  );

  const filteredUpdates = areaFilterId
    ? updates.filter(
        update =>
          update.selectedAreaId === areaFilterId ||
          update.photos.some(
            photo => photo.selectedAreaId === areaFilterId,
          ),
      )
    : updates;

  const renderUpdate = ({ item: update }: { item: HistoryUpdate }) => (
    <UpdateHistoryCard
      update={update}
      onOpen={onOpen}
      onDelete={onDelete}
    />
  );

  return (
    <FlatList
      style={styles.appFrame}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      data={filteredUpdates}
      keyExtractor={update => update.id}
      renderItem={renderUpdate}
      ListHeaderComponent={
        <>
          <ScreenTitle
            title="Saved Updates"
            subtitle="Open a saved update to copy, send, or revise it."
          />

          <Text style={styles.sectionLabel}>
            Filter by Area
          </Text>

          <AreaFilterChips
            projectAreas={projectAreas}
            areaFilterId={areaFilterId}
            onChangeAreaFilter={setAreaFilterId}
          />
        </>
      }
      ListEmptyComponent={
        updates.length === 0 ? (
          <EmptyState
            title="No saved updates"
            text="Save an update after building the message preview."
          />
        ) : (
          <EmptyState
            title="No updates for this area"
            text="Choose All Areas or save an update tagged to this project area."
          />
        )
      }
      ListFooterComponent={
        <PrimaryButton
          label="New Update"
          icon="add-circle-outline"
          onPress={onNewUpdate}
        />
      }
    />
  );
}

function ScreenTitle({
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

function PrimaryButton({
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
  appFrame: {
    flex: 1,
  },

  screenTitle: {
    marginBottom: 12,
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
