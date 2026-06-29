import { StyleProp, View, ViewStyle } from 'react-native';
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
} from '../components/ProjectDetailsCard';
import { RecipientsCard } from '../components/RecipientsCard';
import { SaveUpdateBar } from '../components/SaveUpdateBar';
import { UpdateNotesCard } from '../components/UpdateNotesCard';
import type { ProjectSyncFreshnessMetadata } from '../services/ProjectIntelligenceEngine';
import type {
  ContactBook,
  ReferenceDocument,
  ScheduleItem,
} from '../types';

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
  locationStatus,
  recipientCount,
  draftSavedAt,
  onPickPhotos,
  onTakePhoto,
  onUpdatePhoto,
  onRemovePhoto,
  onMovePhoto,
  onPreviewPhoto,
  onNext,
  onChangeProject,
  onContacts,
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
  locationStatus: string | null;
  recipientCount: number;
  draftSavedAt: string | null;
  onPickPhotos: () => void;
  onTakePhoto: () => void;
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
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
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
            locationStatus={locationStatus}
            recipientCount={recipientCount}
            draftSavedAt={draftSavedAt}
            onPickPhotos={onPickPhotos}
            onTakePhoto={onTakePhoto}
            onNext={onNext}
            onChangeProject={onChangeProject}
            onContacts={onContacts}
            onConfirmArea={onConfirmArea}
            onChangeArea={onChangeArea}
            onRefreshLocation={onRefreshLocation}
          />
        </>
      }
      onUpdatePhoto={onUpdatePhoto}
      onRemovePhoto={onRemovePhoto}
      onMovePhoto={onMovePhoto}
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
  contacts,
  draftSavedAt,
  onNotesChange,
  onSendEmail,
  onSendText,
  onCopy,
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
  contacts: ProjectContact[];
  draftSavedAt: string | null;
  onNotesChange: (notes: string) => void;
  onSendEmail: () => void;
  onSendText: () => void;
  onCopy: () => void;
  onSave: () => void;
  onEditPhotos: () => void;
  onContacts: () => void;
  onConfirmArea: () => void;
  onChangeArea: (areaId: string) => void;
  onRefreshLocation: () => void;
}) {
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
        subject={subject}
        body={body}
        onSendEmail={onSendEmail}
        onSendText={onSendText}
        onCopy={onCopy}
        onSave={onSave}
        onEditPhotos={onEditPhotos}
      />
    </View>
  );
}
