import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ProjectArea } from '../types';
import { formatSavedTime } from '../utils/date';
import { formatFeet, hasSavedAreaLocation } from '../utils/locations';
import {
  PrimaryButton,
  SecondaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';

export function AreaDetailModal({
  area,
  visible,
  onClose,
  onUpdate,
  onDelete,
  onUseCurrentLocation,
}: {
  area: ProjectArea | null;
  visible: boolean;
  onClose: () => void;
  onUpdate: (next: Partial<ProjectArea>) => void;
  onDelete: () => void;
  onUseCurrentLocation: () => void;
}) {
  const [radiusText, setRadiusText] = useState(area ? String(area.radiusFeet) : '250');

  useEffect(() => {
    if (area) setRadiusText(String(area.radiusFeet));
  }, [area?.id, area?.radiusFeet]);

  if (!area) return null;

  function updateRadius(value: string) {
    setRadiusText(value);

    const parsed = Number(value.replace(/[^0-9.]/g, ''));

    if (Number.isFinite(parsed) && parsed > 0) {
      onUpdate({ radiusFeet: parsed });
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.detailModalBackdrop}>
        <View style={styles.detailModalCard}>
          <View style={styles.detailModalHeader}>
            <View>
              <Text style={styles.panelTitle}>Area Mapping Details</Text>
              <Text style={styles.rowSub}>{area.name}</Text>
            </View>

            <TouchableOpacity
              style={styles.detailCloseButton}
              onPress={onClose}
              accessibilityLabel="Close area mapping details"
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Area name</Text>
          <TextInput
            style={styles.input}
            value={area.name}
            onChangeText={name => onUpdate({ name })}
            placeholder="Area name"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>GPS radius</Text>
          <View style={styles.radiusEditRow}>
            <TextInput
              style={[styles.input, styles.radiusEditInput]}
              value={radiusText}
              onChangeText={updateRadius}
              placeholder="250"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
            />
            <Text style={styles.radiusEditUnit}>ft</Text>
          </View>

          <View style={styles.locationSummaryCard}>
            <View style={styles.areaStatusLine}>
              <View
                style={[
                  styles.statusDot,
                  hasSavedAreaLocation(area)
                    ? styles.statusDotSaved
                    : styles.statusDotMissing,
                ]}
              />
              <Text style={styles.projectName}>
                {hasSavedAreaLocation(area) ? 'GPS Saved' : 'GPS Missing'}
              </Text>
            </View>

            {hasSavedAreaLocation(area) ? (
              <>
                <Text style={styles.rowSub}>
                  {area.latitude.toFixed(6)}, {area.longitude.toFixed(6)}
                </Text>
                <Text style={styles.rowSub}>
                  Saved {formatSavedTime(area.locationCapturedAt || null)}
                </Text>
              </>
            ) : (
              <Text style={styles.rowSub}>
                Stand in this project area and tap Update GPS.
              </Text>
            )}
          </View>

          <View style={styles.locationActionRow}>
            <PrimaryButton
              label="Update GPS"
              icon="navigate-outline"
              onPress={onUseCurrentLocation}
              compact
            />
            <SecondaryButton
              label="Delete"
              icon="trash-outline"
              onPress={onDelete}
              compact
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
