import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  AreaSuggestion,
  DraftSavedIndicator,
  PrimaryButton,
  ProgressStat,
  ProjectArea,
  ProjectDetailsCard,
  ProjectUpdate,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';
import { RecipientsCard } from './RecipientsCard';

export function PhotoCapturePanel({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  recipientCount,
  draftSavedAt,
  onPickPhotos,
  onTakePhoto,
  onNext,
  onChangeProject,
  onContacts,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  locationStatus: string | null;
  recipientCount: number;
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: () => void;
  onNext: () => void;
  onChangeProject: () => void;
  onContacts: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const captionedCount = update.photos.filter(
    photo => photo.caption.trim(),
  ).length;
  const selectedAreaLabel =
    selectedArea?.name || update.selectedAreaName || 'Area optional';

  return (
    <>
      <ScreenTitle
        title="Begin Project Walk"
        subtitle="PIE believes you're at:"
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

      <View style={styles.captureContextPanel}>
        <View style={styles.captureContextItem}>
          <Text style={styles.captureContextLabel}>
            Project
          </Text>

          <Text
            style={styles.captureContextValue}
            numberOfLines={1}
          >
            {update.projectName}
          </Text>
        </View>

        <View style={styles.captureContextDivider} />

        <View style={styles.captureContextItem}>
          <Text style={styles.captureContextLabel}>
            Area
          </Text>

          <Text
            style={styles.captureContextValue}
            numberOfLines={1}
          >
            {selectedAreaLabel}
          </Text>
        </View>
      </View>

      <ProjectDetailsCard
        update={update}
        projectAreas={projectAreas}
        selectedArea={selectedArea}
        areaSuggestion={areaSuggestion}
        locationStatus={locationStatus}
        onConfirmArea={onConfirmArea}
        onChangeArea={onChangeArea}
        onRefreshLocation={onRefreshLocation}
      />

      <View style={styles.captureMissionPanel}>
        <View style={styles.captureMissionHeader}>
          <Ionicons
            name="flag-outline"
            size={19}
            color={colors.primary}
          />

          <Text style={styles.captureMissionTitle}>
            Walk Mission
          </Text>
        </View>

        <Text style={styles.captureMissionText}>
          Verify the project and area, capture current field evidence, and answer what changed since the last update.
        </Text>

        <View style={styles.captureMissionList}>
          <Text style={styles.captureMissionItem}>
            What PIE wants to verify: current work, open issues, safety concerns, and inspection status.
          </Text>

          <Text style={styles.captureMissionItem}>
            Evidence PIE needs: photos, captions, notes, and any action owner or due date.
          </Text>

          <Text style={styles.captureMissionItem}>
            Questions PIE wants answered: what changed, what is blocked, and what should happen next.
          </Text>
        </View>
      </View>

      <RecipientsCard
        summary={`${recipientCount} recipient${
          recipientCount === 1 ? '' : 's'
        } selected`}
        onContacts={onContacts}
      />

      <PrimaryButton
        label="Take Photo"
        icon="camera-outline"
        onPress={onTakePhoto}
      />

      <SecondaryButton
        label="Add Photo From Library"
        icon="images-outline"
        onPress={onPickPhotos}
      />

      <SecondaryButton
        label="Add Note Instead"
        icon="create-outline"
        onPress={onNext}
      />

      <TouchableOpacity
        style={styles.inlineLink}
        onPress={onChangeProject}
      >
        <Ionicons
          name="swap-horizontal-outline"
          size={17}
          color={colors.primary}
        />

        <Text style={styles.inlineLinkText}>
          Change Project
        </Text>
      </TouchableOpacity>

      <View style={styles.progressPanel}>
        <ProgressStat
          number={update.photos.length}
          label="Photos"
        />

        <View style={styles.progressDivider} />

        <ProgressStat
          number={captionedCount}
          label="Captioned"
        />
      </View>

      {update.photos.length > 0 ? (
        <PrimaryButton
          label="Save Walk Update"
          icon="document-text-outline"
          onPress={onNext}
        />
      ) : null}
    </>
  );
}
