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

  return (
    <>
      <ScreenTitle
        title="Add Photos"
        subtitle={update.projectName}
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

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
        label="Choose From Library"
        icon="images-outline"
        onPress={onPickPhotos}
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
          label="Build Update"
          icon="document-text-outline"
          onPress={onNext}
        />
      ) : null}
    </>
  );
}
