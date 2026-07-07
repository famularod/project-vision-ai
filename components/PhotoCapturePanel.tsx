import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  AreaSuggestion,
  DraftSavedIndicator,
  PrimaryButton,
  ProgressStat,
  type PhotoIntelligenceDisplayState,
  ProjectArea,
  ProjectDetailsCard,
  ProjectUpdate,
  ScreenTitle,
  SecondaryButton,
  colors,
  styles,
} from './ProjectDetailsCard';
import { RecipientsCard } from './RecipientsCard';
import { buildPIEWalkAttentionState } from '../services/PIEAttentionEngine';
import {
  buildPIEWalkExperience,
  type PIEExperienceAction,
  type PIEExperienceOutput,
} from '../services/PIEExperienceEngine';
import { usePIELiveAuthority } from '../providers/PIELiveAuthorityProvider';

type WalkLocationRecommendation = {
  projectName: string;
  areaName: string;
  confidenceScore: number;
  confidenceLabel: 'High' | 'Medium' | 'Low';
  source:
    | 'exact-gps-area'
    | 'gps-radius'
    | 'project-boundary'
    | 'schedule'
    | 'last-active-project'
    | 'last-active-area'
    | 'user-selection';
  detail: string;
  gpsUnavailable: boolean;
  needsUserSelection: boolean;
  nextAreaName: string | null;
  nextAreaReason: string | null;
};

function walkExperienceActionLabel(action: PIEExperienceAction) {
  if (action === 'capture') return 'Take Photo';
  if (action === 'correct') return 'Change Location';
  if (action === 'review') return 'Finish Capture';
  if (action === 'wait') return 'Refresh';
  if (action === 'approve') return 'Approve';
  if (action === 'communicate') return 'Communicate';

  return 'Accept Location';
}

function guidedCaptureRequest({
  walkExperience,
  selectedAreaLabel,
  photoConfirmation,
}: {
  walkExperience: PIEExperienceOutput;
  selectedAreaLabel: string;
  photoConfirmation: string | null;
}) {
  if (photoConfirmation) {
    if (walkExperience.primaryAction === 'review') {
      return `Finish this capture for ${selectedAreaLabel}.`;
    }

    if (walkExperience.primaryAction === 'capture') {
      return `Take one more progress photo for ${selectedAreaLabel}.`;
    }

    return `Add a short note about ${selectedAreaLabel}.`;
  }

  if (walkExperience.primaryAction === 'confirm') {
    return 'Confirm the project and area before collecting evidence.';
  }

  if (walkExperience.primaryAction === 'capture') {
    return `One progress photo for ${selectedAreaLabel}.`;
  }

  return walkExperience.primaryMessage;
}

function GuidedCaptureCard({
  experience,
  selectedAreaLabel,
  recommendation,
  photoConfirmation,
  onPrimaryAction,
  onSecondaryAction,
}: {
  experience: PIEExperienceOutput;
  selectedAreaLabel: string;
  recommendation: WalkLocationRecommendation;
  photoConfirmation: string | null;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
}) {
  const request = guidedCaptureRequest({
    walkExperience: experience,
    selectedAreaLabel,
    photoConfirmation,
  });
  const showLocationConfirmation =
    experience.primaryAction === 'confirm' ||
    experience.primaryAction === 'correct';

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={photoConfirmation ? 'checkmark-circle-outline' : 'sparkles-outline'}
            size={20}
            color={photoConfirmation ? colors.success : colors.primary}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>
            {photoConfirmation ? 'Photo saved.' : 'PIE needs'}
          </Text>

          <Text style={styles.rowSub}>
            {showLocationConfirmation
              ? 'Confirm location before capture.'
              : 'Minimum evidence for this step.'}
          </Text>
        </View>
      </View>

      {showLocationConfirmation ? (
        <>
          <Text style={styles.bodyText}>
            PIE believes you are at:
          </Text>

          <Text style={styles.captureMissionText}>
            {recommendation.projectName} / {recommendation.areaName}
          </Text>
        </>
      ) : null}

      <Text style={styles.bodyText}>
        {request}
      </Text>

      <Text style={styles.locationDetailText}>
        Why: {experience.reason}
      </Text>

      <PrimaryButton
        label={walkExperienceActionLabel(experience.primaryAction)}
        icon={
          experience.primaryAction === 'capture'
            ? 'camera-outline'
            : experience.primaryAction === 'correct'
              ? 'swap-horizontal-outline'
              : 'arrow-forward-outline'
        }
        onPress={onPrimaryAction}
      />

      {experience.secondaryAction && onSecondaryAction ? (
        <SecondaryButton
          label={
            showLocationConfirmation
              ? 'Correct'
              : walkExperienceActionLabel(experience.secondaryAction)
          }
          icon={
            showLocationConfirmation
              ? 'create-outline'
              : experience.secondaryAction === 'capture'
              ? 'camera-outline'
              : experience.secondaryAction === 'correct'
                ? 'create-outline'
                : 'document-text-outline'
          }
          onPress={onSecondaryAction}
        />
      ) : null}
    </View>
  );
}

function PhotoIntelligenceCard({
  result,
}: {
  result: PhotoIntelligenceDisplayState;
}) {
  const icon =
    result.status === 'analyzing'
      ? 'sync-outline'
      : result.status === 'analysis_failed_retry'
        ? 'refresh-circle-outline'
        : result.status === 'no_suitable_prior_photo' ||
          result.status === 'comparison_unavailable'
          ? 'image-outline'
          : 'sparkles-outline';
  const iconColor =
    result.status === 'analysis_failed_retry'
      ? colors.warning
      : result.status === 'analysis_complete' ||
        result.status === 'completed_with_limitations'
        ? colors.success
        : colors.primary;

  return (
    <View style={styles.locationPanel}>
      <View style={styles.locationPanelHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={icon}
            size={20}
            color={iconColor}
          />
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.panelTitle}>
            {result.title}
          </Text>

          <Text style={styles.rowSub}>
            {progressLabel(result.projectProgress)}
          </Text>
        </View>
      </View>

      <Text style={styles.bodyText}>
        {result.summary}
      </Text>

      {result.location ? (
        <Text style={styles.locationDetailText}>
          {result.location}
        </Text>
      ) : null}

      {result.comparisonConfidence ? (
        <Text style={styles.locationDetailText}>
          Comparison strength: {result.comparisonConfidence}
        </Text>
      ) : null}

      {result.captureLimitations.length > 0 ? (
        <Text style={styles.locationDetailText}>
          Limitations: {result.captureLimitations.join(' ')}
        </Text>
      ) : null}

      {result.repeatPhotoGuidance ? (
        <Text style={styles.locationDetailText}>
          Repeat photo guidance: {result.repeatPhotoGuidance}
        </Text>
      ) : null}

      <Text style={styles.locationDetailText}>
        {result.authorityMessage}
      </Text>

      {__DEV__ && result.diagnostics ? (
        <View style={styles.captureContextPanel}>
          <Text style={styles.sectionLabel}>
            Photo comparison diagnostics
          </Text>
          <Text style={styles.locationDetailText}>
            Current asset: {result.diagnostics.currentPhotoAssetId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Prior asset: {result.diagnostics.priorPhotoAssetId || 'none'}
          </Text>
          <Text style={styles.locationDetailText}>
            Distinct hashes: {String(result.diagnostics.imageHashesDifferent)}
          </Text>
          <Text style={styles.locationDetailText}>
            Edge invoked: {String(result.diagnostics.executedStages.includes('edge_function_invoked'))}
          </Text>
          <Text style={styles.locationDetailText}>
            Provider: {result.diagnostics.providerResponseStatus || 'unknown'}
          </Text>
          <Text style={styles.locationDetailText}>
            Hydrated pair match: {String(result.diagnostics.resultPairMatchesRequestedPair)}
          </Text>
          <Text style={styles.locationDetailText}>
            Provenance: {result.diagnostics.resultProvenance}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function progressLabel(progress: PhotoIntelligenceDisplayState['projectProgress']) {
  if (progress === 'supported') return 'Project progress may be supported';
  if (progress === 'unsupported') return 'Project progress unsupported';
  return 'Project progress unable to determine';
}

export function PhotoCapturePanel({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  walkLocationRecommendation,
  locationStatus,
  photoConfirmation,
  recipientCount,
  draftSavedAt,
  onPickPhotos,
  onTakePhoto,
  onUploadDocument,
  onNext,
  onChangeProject,
  onContacts,
  onAcceptRecommendation,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  update: ProjectUpdate;
  projectAreas: ProjectArea[];
  selectedArea: ProjectArea | null;
  areaSuggestion: AreaSuggestion | null;
  walkLocationRecommendation: WalkLocationRecommendation;
  locationStatus: string | null;
  photoConfirmation: string | null;
  recipientCount: number;
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: () => void;
  onUploadDocument?: () => void;
  onNext: () => void;
  onChangeProject: () => void;
  onContacts: () => void;
  onAcceptRecommendation: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const liveAuthority = usePIELiveAuthority();
  const [showAreaChoices, setShowAreaChoices] = useState(false);
  const [showWalkOptions, setShowWalkOptions] = useState(false);
  const selectedAreaLabel =
    selectedArea?.name || update.selectedAreaName || 'Area optional';
  const repeatPhotoGuidance =
    liveAuthority.core?.photoRepeatGuidance.find(item =>
      item.needed &&
      (!item.areaName ||
        item.areaName.trim().toLowerCase() === selectedAreaLabel.trim().toLowerCase())
    ) ||
    liveAuthority.core?.photoRepeatGuidance[0] ||
    null;
  const captionedCount = update.photos.filter(
    photo => photo.caption.trim(),
  ).length;
  const latestPhotoIntelligence = [...update.photos]
    .reverse()
    .map(photo => photo.photoIntelligence)
    .find((result): result is PhotoIntelligenceDisplayState => Boolean(result));
  const walkAttentionState = buildPIEWalkAttentionState({
    projectName: update.projectName,
    areaName: selectedAreaLabel,
    recommendedProjectName: walkLocationRecommendation.projectName,
    recommendedAreaName: walkLocationRecommendation.areaName,
    recommendationReason: walkLocationRecommendation.detail,
    confidence: walkLocationRecommendation.confidenceScore,
    needsUserSelection: walkLocationRecommendation.needsUserSelection,
    gpsUnavailable: walkLocationRecommendation.gpsUnavailable,
    photoCount: update.photos.length,
    hasNote: Boolean(update.notes.trim()),
    photoConfirmation,
    nextAreaName: walkLocationRecommendation.nextAreaName,
    nextAreaReason: walkLocationRecommendation.nextAreaReason,
  });
  const walkExperience = buildPIEWalkExperience({
    attentionState: walkAttentionState,
    context: {
      currentProject: update.projectName,
      currentArea: selectedAreaLabel,
      gpsRecommendation: {
        projectName: walkLocationRecommendation.projectName,
        areaName: walkLocationRecommendation.areaName,
        confidence: walkLocationRecommendation.confidenceScore,
        reason: walkLocationRecommendation.detail,
        needsUserSelection: walkLocationRecommendation.needsUserSelection,
      },
      schedulePriority: walkLocationRecommendation.nextAreaReason,
      missingEvidence: update.photos.length === 0
        ? [`Progress photo needed for ${selectedAreaLabel}.`]
        : [],
      photoProgressStatus: photoConfirmation,
      lastCapturedPhoto: photoConfirmation,
      photoCount: update.photos.length,
      hasNote: Boolean(update.notes.trim()),
      walkCompletionState: update.photos.length > 0 && update.notes.trim()
        ? 'ready_to_finish'
        : 'active',
      nextWalkArea: walkLocationRecommendation.nextAreaName,
      nextWalkAreaReason: walkLocationRecommendation.nextAreaReason,
    },
  });
  const handleExperienceAction = (action: PIEExperienceAction) => {
    if (action === 'confirm') {
      onAcceptRecommendation();
      return;
    }

    if (action === 'capture') {
      onTakePhoto();
      return;
    }

    if (action === 'correct') {
      setShowWalkOptions(true);
      return;
    }

    if (action === 'wait') {
      onRefreshLocation();
      return;
    }

    onNext();
  };
  return (
    <>
      <ScreenTitle
        title="Capture"
        subtitle="PIE will ask for the minimum evidence needed."
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

      <GuidedCaptureCard
        experience={walkExperience}
        selectedAreaLabel={selectedAreaLabel}
        recommendation={walkLocationRecommendation}
        photoConfirmation={photoConfirmation}
        onPrimaryAction={() =>
          handleExperienceAction(walkExperience.primaryAction)
        }
        onSecondaryAction={
          walkExperience.secondaryAction
            ? () => handleExperienceAction(walkExperience.secondaryAction!)
            : undefined
        }
      />

      {liveAuthority.degraded ? (
        <View style={styles.draftSavedIndicator}>
          <Ionicons
            name="information-circle-outline"
            size={17}
            color={colors.primary}
          />

          <Text style={styles.draftSavedText}>
            {liveAuthority.policy.userMessage}
          </Text>
        </View>
      ) : null}

      {repeatPhotoGuidance ? (
        <View style={styles.locationPanel}>
          <View style={styles.locationPanelHeader}>
            <View style={styles.rowIconBubble}>
              <Ionicons
                name="scan-outline"
                size={20}
                color={colors.primary}
              />
            </View>

            <View style={styles.rowMain}>
              <Text style={styles.panelTitle}>
                Repeat photo needed
              </Text>

              <Text style={styles.rowSub}>
                {repeatPhotoGuidance.areaName || repeatPhotoGuidance.projectName}
              </Text>
            </View>
          </View>

          {repeatPhotoGuidance.referencePhotoUri ? (
            <Text style={styles.bodyText}>
              Previous reference image is available for alignment.
            </Text>
          ) : null}

          <Text style={styles.captureMissionText}>
            {repeatPhotoGuidance.instruction}
          </Text>

          <Text style={styles.locationDetailText}>
            Why: {repeatPhotoGuidance.reason} {repeatPhotoGuidance.alignmentGuide}
          </Text>
        </View>
      ) : null}

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

      <View style={styles.locationPanel}>
        <View style={styles.locationPanelHeader}>
          <View style={styles.rowIconBubble}>
            <Ionicons
              name="navigate-outline"
              size={20}
              color={colors.primary}
            />
          </View>

          <View style={styles.rowMain}>
            <Text style={styles.panelTitle}>
              Location
            </Text>

            <Text style={styles.rowSub}>
              Current capture context
            </Text>
          </View>
        </View>

        <Text style={styles.bodyText}>
          PIE believes you are at:
        </Text>

        <View style={styles.captureContextPanel}>
          <View style={styles.captureContextItem}>
            <Text style={styles.captureContextLabel}>
              Project
            </Text>

            <Text
              style={styles.captureContextValue}
              numberOfLines={1}
            >
              {walkLocationRecommendation.projectName}
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
              {walkLocationRecommendation.areaName}
            </Text>
          </View>
        </View>

        {walkLocationRecommendation.needsUserSelection ? (
          <Text style={styles.locationDetailText}>
            PIE is unsure of your location.
          </Text>
        ) : null}

        {walkLocationRecommendation.nextAreaName ? (
          <Text style={styles.locationDetailText}>
            Next Area to Visit: {walkLocationRecommendation.nextAreaName}. Reason: {walkLocationRecommendation.nextAreaReason}
          </Text>
        ) : null}

        {walkLocationRecommendation.gpsUnavailable ? (
          <Text style={styles.locationDetailText}>
            PIE is using your last active project.
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.inlineLink}
          onPress={() => setShowWalkOptions(open => !open)}
        >
          <Ionicons
            name="ellipsis-horizontal-circle-outline"
            size={17}
            color={colors.primary}
          />

          <Text style={styles.inlineLinkText}>
            Walk Options
          </Text>
        </TouchableOpacity>

        {showWalkOptions ? (
          <>
            <Text style={styles.locationDetailText}>
              Location reason: {walkLocationRecommendation.detail}
            </Text>

            <View style={styles.sendRow}>
              <SecondaryButton
                label={walkLocationRecommendation.needsUserSelection ? 'Choose Project' : 'Correct Project'}
                icon="swap-horizontal-outline"
                onPress={onChangeProject}
                compact
              />

              <SecondaryButton
                label={walkLocationRecommendation.needsUserSelection ? 'Choose Area' : 'Correct Area'}
                icon="create-outline"
                onPress={() => setShowAreaChoices(open => !open)}
                compact
              />
            </View>

            <View style={styles.sendRow}>
              {onUploadDocument ? (
                <SecondaryButton
                  label="Upload Document"
                  icon="document-attach-outline"
                  onPress={onUploadDocument}
                  compact
                />
              ) : null}

              <SecondaryButton
                label="Add Note"
                icon="create-outline"
                onPress={onNext}
                compact
              />
            </View>

            <View style={styles.sendRow}>
              <SecondaryButton
                label="Add Issue"
                icon="alert-circle-outline"
                onPress={onTakePhoto}
                compact
              />

              <SecondaryButton
                label="Add Safety"
                icon="warning-outline"
                onPress={onTakePhoto}
                compact
              />
            </View>
          </>
        ) : null}

        {showAreaChoices ? (
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
                  onPress={() => {
                    onChangeArea(area.id);
                    setShowAreaChoices(false);
                  }}
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
        ) : null}
      </View>

      {photoConfirmation ? (
        <View style={styles.draftSavedIndicator}>
          <Ionicons
            name="checkmark-circle-outline"
            size={17}
            color={colors.success}
          />

          <Text style={styles.draftSavedText}>
            Photo saved. {photoConfirmation}
          </Text>
        </View>
      ) : null}

      {latestPhotoIntelligence ? (
        <PhotoIntelligenceCard result={latestPhotoIntelligence} />
      ) : null}

      {update.photos.length > 0 ? (
        <View style={styles.captureContextPanel}>
          <View style={styles.captureContextItem}>
            <Text style={styles.captureContextLabel}>
              Current Area
            </Text>

            <Text
              style={styles.captureContextValue}
              numberOfLines={1}
            >
              {selectedAreaLabel}
            </Text>
          </View>

          <View style={styles.captureContextDivider} />

          <View style={styles.captureContextItem}>
            <Text style={styles.captureContextLabel}>
              Next Suggested Action
            </Text>

            <Text
              style={styles.captureContextValue}
              numberOfLines={1}
            >
              {walkAttentionState.recommendedAction.label}
            </Text>
          </View>
        </View>
      ) : null}

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

      {update.photos.length > 0 ? (
        <>
          <View style={styles.sendRow}>
            <SecondaryButton
              label="Add Another Photo"
              icon="camera-outline"
              onPress={onTakePhoto}
              compact
            />

            <SecondaryButton
              label={walkExperience.currentState === 'finish_walk' ? 'Finish Walk' : 'Add Note'}
              icon={walkExperience.currentState === 'finish_walk' ? 'document-text-outline' : 'create-outline'}
              onPress={onNext}
              compact
            />
          </View>

          <SecondaryButton
            label="Add From Library"
            icon="images-outline"
            onPress={onPickPhotos}
          />
        </>
      ) : (
        <>
          <SecondaryButton
            label="Add Photo From Library"
            icon="images-outline"
            onPress={onPickPhotos}
          />
        </>
      )}

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

    </>
  );
}
