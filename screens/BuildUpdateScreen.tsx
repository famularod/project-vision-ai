import {
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { PhotoCapturePanel } from '../components/PhotoCapturePanel';
import { PhotoGallery } from '../components/PhotoGallery';
import { PIEPanel } from '../components/PIEPanel';
import {
  AreaSuggestion,
  DraftSavedIndicator,
  ProjectArea,
  ProjectContact,
  ProjectDetailsCard,
  ProjectUpdate,
  ScreenTitle,
  UpdatePhoto,
  colors,
} from '../components/ProjectDetailsCard';
import { RecipientsCard } from '../components/RecipientsCard';
import { SaveUpdateBar } from '../components/SaveUpdateBar';
import { UpdateNotesCard } from '../components/UpdateNotesCard';
import type { ProjectSyncFreshnessMetadata } from '../services/ProjectIntelligenceEngine';
import type { PIEReportDraft } from '../services/PIEReporter';
import { usePIELiveAuthority } from '../providers/PIELiveAuthorityProvider';
import type {
  ContactBook,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

type UpdateMode = 'single' | 'combined';

type CombinedUpdateIncludeKey =
  | 'walkEvidence'
  | 'newPhotos'
  | 'savedUpdates'
  | 'openIssues'
  | 'safetyObservations'
  | 'scheduleChanges'
  | 'pieRecommendations';

type CombinedUpdateIncludeState = Record<CombinedUpdateIncludeKey, boolean>;

type CombinedUpdateIncludeOption = {
  key: CombinedUpdateIncludeKey;
  label: string;
};

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

export function AddPhotosScreen({
  contentStyle,
  update,
  savedUpdates,
  scheduleItems,
  projectAreas,
  contacts,
  referenceDocuments,
  syncMetadata,
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
  onUpdatePhoto,
  onRemovePhoto,
  onMovePhoto,
  onPreviewPhoto,
  onNext,
  onChangeProject,
  onContacts,
  onAcceptRecommendation,
  onConfirmArea,
  onChangeArea,
  onRefreshLocation,
}: {
  contentStyle: StyleProp<ViewStyle>;
  update: ProjectUpdate;
  savedUpdates: ProjectUpdate[];
  scheduleItems: ScheduleItem[];
  projectAreas: ProjectArea[];
  contacts?: ContactBook;
  referenceDocuments?: ReferenceDocument[];
  syncMetadata?: ProjectSyncFreshnessMetadata | null;
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
  onUpdatePhoto: (
    photoId: string,
    next: Partial<UpdatePhoto>,
  ) => void;
  onRemovePhoto: (photoId: string) => void;
  onMovePhoto: (
    photoId: string,
    direction: 'up' | 'down',
  ) => void;
  onPreviewPhoto: (photo: UpdatePhoto) => void;
  onNext: () => void;
  onChangeProject: () => void;
  onContacts: () => void;
  onAcceptRecommendation: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const liveAuthority = usePIELiveAuthority();
  const notifyCaptureEvidenceChanged = (evidenceId: string) => {
    liveAuthority.notifyEvidenceChanged(evidenceId);
  };
  const notifyCaptureEvidenceRemoved = (evidenceId: string) => {
    liveAuthority.invalidateEvidence(evidenceId);
  };
  const handleTakePhoto = () => {
    onTakePhoto();
    void liveAuthority.refreshAuthority('evidence_added');
  };
  const handlePickPhotos = () => {
    onPickPhotos();
    void liveAuthority.refreshAuthority('evidence_added');
  };
  const handleUploadDocument = onUploadDocument
    ? () => {
        onUploadDocument();
        void liveAuthority.refreshAuthority('evidence_added');
      }
    : undefined;

  return (
    <PhotoGallery
      contentStyle={contentStyle}
      update={update}
      header={
        <>
          <PIEPanel
            projectName={update.projectName}
            updates={savedUpdates}
            scheduleItems={scheduleItems}
            currentUpdate={update}
            projectAreas={projectAreas}
            contacts={contacts}
            referenceDocuments={referenceDocuments}
            syncMetadata={syncMetadata}
            title="PIE Walk Prep"
            subtitle="PIE believes this is the project and area for your field walk."
            compact
          />

          <PhotoCapturePanel
            update={update}
            projectAreas={projectAreas}
            selectedArea={selectedArea}
            areaSuggestion={areaSuggestion}
            walkLocationRecommendation={walkLocationRecommendation}
            locationStatus={locationStatus}
            photoConfirmation={photoConfirmation}
            recipientCount={recipientCount}
            draftSavedAt={draftSavedAt}
            onPickPhotos={handlePickPhotos}
            onTakePhoto={handleTakePhoto}
            onUploadDocument={handleUploadDocument}
            onNext={onNext}
            onChangeProject={onChangeProject}
            onContacts={onContacts}
            onAcceptRecommendation={onAcceptRecommendation}
            onConfirmArea={onConfirmArea}
            onChangeArea={onChangeArea}
            onRefreshLocation={onRefreshLocation}
          />
        </>
      }
      onUpdatePhoto={(photoId, next) => {
        onUpdatePhoto(photoId, next);
        notifyCaptureEvidenceChanged(photoId);
      }}
      onRemovePhoto={photoId => {
        onRemovePhoto(photoId);
        notifyCaptureEvidenceRemoved(photoId);
      }}
      onMovePhoto={(photoId, direction) => {
        onMovePhoto(photoId, direction);
        notifyCaptureEvidenceChanged(photoId);
      }}
      onPreviewPhoto={onPreviewPhoto}
      onNext={onNext}
    />
  );
}

export function BuildUpdateScreen({
  update,
  projectAreas,
  selectedArea,
  areaSuggestion,
  locationStatus,
  subject,
  body,
  pieReportDraft = null,
  contacts,
  updateMode,
  availableProjects,
  combinedProjects,
  combinedIncludes,
  combinedIncludeOptions,
  draftSavedAt,
  onUpdateModeChange,
  onToggleCombinedProject,
  onToggleCombinedInclude,
  onNotesChange,
  onSendEmail,
  onSendText,
  onCopy,
  onEmailReport,
  onCopyReport,
  onSave,
  onEditPhotos,
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
  subject: string;
  body: string;
  pieReportDraft?: PIEReportDraft | null;
  contacts: ProjectContact[];
  updateMode: UpdateMode;
  availableProjects: string[];
  combinedProjects: string[];
  combinedIncludes: CombinedUpdateIncludeState;
  combinedIncludeOptions: CombinedUpdateIncludeOption[];
  draftSavedAt: string | null;
  onUpdateModeChange: (mode: UpdateMode) => void;
  onToggleCombinedProject: (projectName: string) => void;
  onToggleCombinedInclude: (key: CombinedUpdateIncludeKey) => void;
  onNotesChange: (notes: string) => void;
  onSendEmail: () => void;
  onSendText: () => void;
  onCopy: () => void;
  onEmailReport?: (report: PIEReportDraft) => void;
  onCopyReport?: (report: PIEReportDraft) => void;
  onSave: () => void;
  onEditPhotos: () => void;
  onContacts: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
  const liveAuthority = usePIELiveAuthority();
  const authoritativeReportDraft =
    liveAuthority.reportDraft || pieReportDraft || liveAuthority.runtime.response.reportDraft;
  const reportSubject = authoritativeReportDraft.subject || subject;
  const reportBody = authoritativeReportDraft.body || body;
  const hasPhotos = update.photos.length > 0;

  const emailCount = contacts.filter(
    contact => contact.email.trim(),
  ).length;

  const phoneCount = contacts.filter(
    contact => contact.phone.trim(),
  ).length;

  return (
    <View>
      <ScreenTitle
        title="Save Walk Update"
        subtitle={
          hasPhotos
            ? `${update.projectName} - ${update.photos.length} photos`
            : `${update.projectName} - no photos`
        }
      />

      <DraftSavedIndicator
        savedAt={draftSavedAt}
      />

      <UpdateModeCard
        updateMode={updateMode}
        availableProjects={availableProjects}
        combinedProjects={combinedProjects}
        combinedIncludes={combinedIncludes}
        combinedIncludeOptions={combinedIncludeOptions}
        onUpdateModeChange={onUpdateModeChange}
        onToggleCombinedProject={onToggleCombinedProject}
        onToggleCombinedInclude={onToggleCombinedInclude}
      />

      <PIEProjectUpdateCard
        reportDraft={authoritativeReportDraft}
        authorityMessage={
          liveAuthority.policy.reportGenerationAllowed
            ? null
            : liveAuthority.policy.userMessage
        }
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
        summary={`Selected: ${emailCount} email | ${phoneCount} text`}
        onContacts={onContacts}
      />

      <UpdateNotesCard
        update={update}
        hasPhotos={hasPhotos}
        onNotesChange={onNotesChange}
      />

      <SaveUpdateBar
        subject={reportSubject}
        body={reportBody}
        onSendEmail={
          onEmailReport
            ? () => onEmailReport(authoritativeReportDraft)
            : onSendEmail
        }
        onSendText={onSendText}
        onCopy={
          onCopyReport
            ? () => onCopyReport(authoritativeReportDraft)
            : onCopy
        }
        onSave={onSave}
        onEditPhotos={onEditPhotos}
      />
    </View>
  );
}

function PIEProjectUpdateCard({
  reportDraft,
  authorityMessage,
}: {
  reportDraft: PIEReportDraft;
  authorityMessage?: string | null;
}) {
  const actionSummary =
    reportDraft.actionItems.length > 0
      ? reportDraft.actionItems
          .slice(0, 4)
          .map(item =>
            item.needsOwner
              ? `Owner needed - ${item.action}`
              : `${item.owner} - ${item.action}`,
          )
          .join('\n')
      : 'No action items extracted from selected evidence.';
  const imageSummary =
    reportDraft.imageReferences.length > 0
      ? reportDraft.imageReferences
          .map(ref => `Image ${ref.imageNumber}: ${ref.areaName}`)
          .slice(0, 6)
          .join('\n')
      : 'No image references included.';

  return (
    <View style={screenStyles.modePanel}>
      <Text style={screenStyles.modeTitle}>
        Generate PIE Project Update
      </Text>

      <Text style={screenStyles.modeHelp}>
        Review required before sending or copying. The draft follows David's location-based project update format and only uses selected project evidence.
      </Text>

      {authorityMessage ? (
        <Text style={screenStyles.reviewNote}>
          {authorityMessage}
        </Text>
      ) : null}

      <View style={screenStyles.reportMetaGrid}>
        <ReportMeta
          label="Type"
          value={reportDraft.reportType.replace(/_/g, ' ')}
        />

        <ReportMeta
          label="Readiness"
          value={reportDraft.confidence}
        />

        <ReportMeta
          label="Needs Review"
          value={reportDraft.needsReview ? 'Yes' : 'No'}
        />
      </View>

      <Text style={screenStyles.fieldLabel}>
        Action Items
      </Text>

      <Text style={screenStyles.reportPreviewText}>
        {actionSummary}
      </Text>

      <Text style={screenStyles.fieldLabel}>
        Image References
      </Text>

      <Text style={screenStyles.reportPreviewText}>
        {imageSummary}
      </Text>
    </View>
  );
}

function ReportMeta({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={screenStyles.reportMetaItem}>
      <Text style={screenStyles.reportMetaLabel}>
        {label}
      </Text>

      <Text style={screenStyles.reportMetaValue}>
        {value}
      </Text>
    </View>
  );
}

function UpdateModeCard({
  updateMode,
  availableProjects,
  combinedProjects,
  combinedIncludes,
  combinedIncludeOptions,
  onUpdateModeChange,
  onToggleCombinedProject,
  onToggleCombinedInclude,
}: {
  updateMode: UpdateMode;
  availableProjects: string[];
  combinedProjects: string[];
  combinedIncludes: CombinedUpdateIncludeState;
  combinedIncludeOptions: CombinedUpdateIncludeOption[];
  onUpdateModeChange: (mode: UpdateMode) => void;
  onToggleCombinedProject: (projectName: string) => void;
  onToggleCombinedInclude: (key: CombinedUpdateIncludeKey) => void;
}) {
  const isCombined = updateMode === 'combined';

  return (
    <View style={screenStyles.modePanel}>
      <Text style={screenStyles.modeTitle}>
        Update Type
      </Text>

      <View style={screenStyles.segmentRow}>
        <TouchableOpacity
          style={[
            screenStyles.segmentButton,
            !isCombined && screenStyles.segmentButtonActive,
          ]}
          onPress={() => onUpdateModeChange('single')}
        >
          <Text
            style={[
              screenStyles.segmentText,
              !isCombined && screenStyles.segmentTextActive,
            ]}
          >
            Single Project
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            screenStyles.segmentButton,
            isCombined && screenStyles.segmentButtonActive,
          ]}
          onPress={() => onUpdateModeChange('combined')}
        >
          <Text
            style={[
              screenStyles.segmentText,
              isCombined && screenStyles.segmentTextActive,
            ]}
          >
            Combined Update
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={screenStyles.modeHelp}>
        {isCombined
          ? 'PIE will compile selected projects and evidence into one reviewable update. Nothing is sent automatically.'
          : 'Prepare a focused update for the current project.'}
      </Text>

      {isCombined ? (
        <>
          <Text style={screenStyles.fieldLabel}>
            Include
          </Text>

          <View style={screenStyles.chipWrap}>
            {combinedIncludeOptions.map(option => {
              const selected = combinedIncludes[option.key];

              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    screenStyles.choiceChip,
                    selected && screenStyles.choiceChipSelected,
                  ]}
                  onPress={() => onToggleCombinedInclude(option.key)}
                >
                  <Text
                    style={[
                      screenStyles.choiceText,
                      selected && screenStyles.choiceTextSelected,
                    ]}
                  >
                    {selected ? '[x] ' : ''}
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={screenStyles.fieldLabel}>
            Projects
          </Text>

          <View style={screenStyles.chipWrap}>
            {availableProjects.map(projectName => {
              const selected = combinedProjects.some(project =>
                project.trim().toLowerCase() === projectName.trim().toLowerCase(),
              );

              return (
                <TouchableOpacity
                  key={projectName}
                  style={[
                    screenStyles.choiceChip,
                    selected && screenStyles.choiceChipSelected,
                  ]}
                  onPress={() => onToggleCombinedProject(projectName)}
                >
                  <Text
                    style={[
                      screenStyles.choiceText,
                      selected && screenStyles.choiceTextSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {projectName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={screenStyles.reviewNote}>
            Review required before sending or copying.
          </Text>
        </>
      ) : null}
    </View>
  );
}

const screenStyles = StyleSheet.create({
  modePanel: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    marginBottom: 14,
  },

  modeTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
  },

  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },

  segmentButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  segmentText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },

  segmentTextActive: {
    color: '#FFFFFF',
  },

  modeHelp: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: 12,
  },

  fieldLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase',
  },

  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  choiceChip: {
    maxWidth: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  choiceChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  choiceText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: 220,
  },

  choiceTextSelected: {
    color: '#FFFFFF',
  },

  reviewNote: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },

  reportMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },

  reportMetaItem: {
    flexGrow: 1,
    flexBasis: '30%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.fill,
    padding: 10,
  },

  reportMetaLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },

  reportMetaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'capitalize',
  },

  reportPreviewText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginBottom: 12,
  },
});
