import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { ProjectArea } from '../types';
import {
  formatFeet,
  hasSavedAreaLocation,
  projectAreaSetupStats,
} from '../utils/locations';
import { AreaDetailModal } from './AreaDetailModal';
import {
  SecondaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';

export function ManageAreasPanel({
  projectAreas,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
  onUseCurrentLocationForArea,
}: {
  projectAreas: ProjectArea[];
  onAddArea: (name: string) => boolean;
  onUpdateArea: (areaId: string, next: Partial<ProjectArea>) => void;
  onDeleteArea: (areaId: string) => void;
  onUseCurrentLocationForArea: (areaId: string) => void;
}) {
  const [newAreaName, setNewAreaName] = useState('');
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const stats = projectAreaSetupStats(projectAreas);
  const nextMissingArea = projectAreas.find(area => !hasSavedAreaLocation(area));
  const selectedArea = selectedAreaId
    ? projectAreas.find(area => area.id === selectedAreaId) || null
    : null;

  function submitArea() {
    const added = onAddArea(newAreaName);

    if (added) setNewAreaName('');
  }

  function useNextMissingAreaLocation() {
    if (!nextMissingArea) {
      Alert.alert('GPS setup complete', 'All project areas already have saved GPS points.');
      return;
    }

    Alert.alert(
      'Save next missing GPS?',
      `Stand in ${nextMissingArea.name}, then press Save GPS to use your current location for this project area.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save GPS',
          onPress: () => onUseCurrentLocationForArea(nextMissingArea.id),
        },
      ],
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Project Areas</Text>

      <Text style={styles.bodyText}>
        Configure work areas and save GPS points for PIE location intelligence.
      </Text>

      <View style={styles.setupProgressCard}>
        <Text style={styles.projectName}>Project Area GPS Setup</Text>
        <Text style={styles.rowSub}>
          {stats.saved} of {stats.total} areas have GPS saved ({stats.percent}%).
        </Text>
        {stats.missing > 0 ? (
          <Text style={styles.locationDetailText}>
            {stats.missing} area{stats.missing === 1 ? '' : 's'} still need GPS setup.
          </Text>
        ) : (
          <Text style={styles.locationDetailText}>All project areas have saved GPS points.</Text>
        )}
      </View>

      <SecondaryButton
        label={nextMissingArea ? `Save GPS: ${nextMissingArea.name}` : 'All GPS Saved'}
        icon="navigate-outline"
        onPress={useNextMissingAreaLocation}
        compact
      />

      <Text style={styles.sectionLabel}>New Project Area</Text>
      <View style={styles.addLocationInlineRow}>
        <TextInput
          style={[styles.input, styles.addLocationInlineInput]}
          value={newAreaName}
          onChangeText={setNewAreaName}
          placeholder="Area name"
          placeholderTextColor={colors.muted}
        />

        <TouchableOpacity
          style={[
            styles.addLocationInlineButton,
            !newAreaName.trim() && styles.disabledButton,
          ]}
          onPress={submitArea}
          disabled={!newAreaName.trim()}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.areaListCard}>
        <View style={styles.areaListHeaderRow}>
          <Text style={styles.sectionLabelNoMargin}>Project Areas</Text>
          <Text style={styles.rowSub}>{projectAreas.length} total</Text>
        </View>

        {projectAreas.map(area => {
          const gpsSaved = hasSavedAreaLocation(area);

          return (
            <TouchableOpacity
              key={area.id}
              style={styles.areaListRow}
              onPress={() => setSelectedAreaId(area.id)}
            >
              <View style={styles.rowIconBubble}>
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={colors.primary}
                />
              </View>

              <View style={styles.rowMain}>
                <Text style={styles.projectName} numberOfLines={1}>
                  {area.name}
                </Text>

                <View style={styles.areaStatusLine}>
                  <View
                    style={[
                      styles.statusDot,
                      gpsSaved ? styles.statusDotSaved : styles.statusDotMissing,
                    ]}
                  />
                  <Text style={styles.rowSub}>
                    {gpsSaved ? 'GPS saved' : 'GPS missing'}
                  </Text>
                </View>
              </View>

              <Text style={styles.areaListRadius}>{formatFeet(area.radiusFeet)}</Text>

              <Ionicons
                name="chevron-forward"
                size={19}
                color={colors.tertiaryText}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <AreaDetailModal
        area={selectedArea}
        visible={Boolean(selectedArea)}
        onClose={() => setSelectedAreaId(null)}
        onUpdate={next => {
          if (selectedArea) onUpdateArea(selectedArea.id, next);
        }}
        onDelete={() => {
          if (!selectedArea) return;
          const areaId = selectedArea.id;
          setSelectedAreaId(null);
          onDeleteArea(areaId);
        }}
        onUseCurrentLocation={() => {
          if (selectedArea) onUseCurrentLocationForArea(selectedArea.id);
        }}
      />
    </View>
  );
}
