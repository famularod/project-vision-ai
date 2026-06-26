import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';
import {
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from '../components/ProjectDetailsCard';
import type { ProjectArea, ReferenceDocument } from '../types';
import { formatFeet, hasSavedAreaLocation } from '../utils/locations';

export function DiagnosticsScreen({
  projectAreas,
  referenceDocuments,
  onBack,
}: {
  projectAreas: ProjectArea[];
  referenceDocuments: ReferenceDocument[];
  onBack: () => void;
}) {
  const areasWithGps = projectAreas.filter(area => hasSavedAreaLocation(area)).length;

  return (
    <View>
      <ScreenTitle
        title="Admin Diagnostics"
        subtitle="Basic setup status for locations, GPS, documents, and app data."
      />

      <SecondaryButton
        label="Back to Projects"
        icon="arrow-back-outline"
        onPress={onBack}
      />

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>System Check</Text>
        <Text style={styles.bodyText}>
          Project areas configured: {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          GPS locations saved: {areasWithGps} of {projectAreas.length}
        </Text>
        <Text style={styles.bodyText}>
          Reference documents saved: {referenceDocuments.length}
        </Text>
        <Text style={styles.bodyText}>
          Core navigation, storage, GPS setup, and document tracking are available.
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>GPS Setup Status</Text>
        {projectAreas.length === 0 ? (
          <Text style={styles.bodyText}>No project areas have been created yet.</Text>
        ) : (
          projectAreas.map(area => (
            <View key={area.id} style={styles.checklistRow}>
              <Ionicons
                name={hasSavedAreaLocation(area) ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={hasSavedAreaLocation(area) ? colors.success : colors.warning}
              />
              <View style={styles.rowMain}>
                <Text style={styles.projectName}>{area.name}</Text>
                <Text style={styles.rowSub}>
                  {hasSavedAreaLocation(area)
                    ? `GPS saved | Radius ${formatFeet(area.radiusFeet)}`
                    : `GPS missing | Radius ${formatFeet(area.radiusFeet)}`}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
