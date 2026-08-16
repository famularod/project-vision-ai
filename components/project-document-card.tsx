import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ReferenceDocument } from '../types';
import {
  PROJECT_DOCUMENT_CATEGORIES,
  type ProjectDocumentCategory,
} from '../services/ProjectDocumentClassification';
import { colors, styles } from './app-shell-theme';
import { MobileDocumentECOSStatus } from './mobile-document-ecos-status';

export type ProjectDocumentCardDocument = {
  id: string;
  name: string;
  category: ProjectDocumentCategory;
  mimeType?: string | null;
  status: 'local' | 'uploading' | 'uploaded' | 'failed';
  uploadProgress?: number | null;
  uploadedAt?: string | null;
  updatedAt: string;
  isCurrent?: boolean;
  areaId?: string | null;
  updateId?: string | null;
  note?: string | null;
  drawingNumber?: string | null;
  drawingRevision?: string | null;
  drawingDiscipline?: string | null;
  drawingStatus?: ReferenceDocument['drawingStatus'];
  drawingIssuedAt?: string | null;
};

type ProjectDocumentCardArea = {
  id: string;
  name: string;
};

type ProjectDocumentCardUpdate = {
  id: string;
  date: string;
};

function formatDisplayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatSavedTime(value: string | null | undefined) {
  if (!value) return 'Recently';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function projectDocumentStatusDetail(document: ProjectDocumentCardDocument) {
  if (document.status === 'failed') return 'Document upload failed · Retry';
  if (document.status === 'uploading') {
    const percent = typeof document.uploadProgress === 'number'
      ? Math.round(Math.min(1, Math.max(0, document.uploadProgress)) * 100)
      : null;
    return percent === null ? 'Document upload pending' : `Uploading ${percent}%`;
  }
  if (document.status === 'uploaded') {
    return `Uploaded ${formatSavedTime(document.uploadedAt || document.updatedAt)}`;
  }
  return 'Local only · not included as an uploaded attachment';
}

export function ProjectDocumentCard<TDocument extends ProjectDocumentCardDocument>({
  document,
  sharedReferenceDocument,
  projectAreas,
  updates,
  onOpen,
  onUpdate,
  onSetCurrentSchedule,
  onMakeCurrentDocument,
  onRetry,
  onReplaceFile,
  onDelete,
  editable = true,
}: {
  document: TDocument;
  sharedReferenceDocument: ReferenceDocument | null;
  projectAreas: ProjectDocumentCardArea[];
  updates: ProjectDocumentCardUpdate[];
  onOpen: () => void;
  onUpdate: (next: Partial<TDocument>) => void;
  onSetCurrentSchedule: () => void;
  onMakeCurrentDocument: (documentId: string) => void;
  onRetry: () => void;
  onReplaceFile: () => void;
  onDelete: () => void;
  editable?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const selectedUpdate = updates.find(update => update.id === document.updateId);
  const selectedArea = projectAreas.find(area => area.id === document.areaId);
  const updateDocument = (next: Partial<ProjectDocumentCardDocument>) => {
    onUpdate(next as Partial<TDocument>);
  };

  return (
    <View style={styles.photoCard}>
      <View style={styles.photoHeader}>
        <View style={styles.rowIconBubble}>
          <Ionicons
            name={document.mimeType?.includes('image') ? 'image-outline' : 'document-text-outline'}
            size={20}
            color={colors.primary}
          />
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.photoTitle}>{document.name}</Text>
          <Text style={styles.rowSub}>
            {document.category} · {projectDocumentStatusDetail(document)}
          </Text>
          {document.category === 'Schedule' && document.isCurrent ? (
            <View style={[styles.statusPill, styles.documentCurrentBadge]}>
              <Text style={[styles.statusPillText, { color: colors.success }]}>Current Schedule</Text>
            </View>
          ) : null}
          {selectedArea ? (
            <Text style={styles.locationDetailText}>Area: {selectedArea.name}</Text>
          ) : null}
          {selectedUpdate ? (
            <Text style={styles.locationDetailText}>
              Update: {formatDisplayDate(selectedUpdate.date)}
            </Text>
          ) : null}
          {document.note ? (
            <Text style={styles.locationDetailText}>{document.note}</Text>
          ) : null}
          {document.category === 'Drawing' ? (
            <Text style={styles.locationDetailText}>
              {[
                document.drawingNumber ? `Drawing ${document.drawingNumber}` : null,
                document.drawingRevision ? `Rev ${document.drawingRevision}` : null,
                document.drawingDiscipline,
                document.drawingStatus,
              ].filter(Boolean).join(' · ') || 'Drawing details not assigned'}
            </Text>
          ) : null}
        </View>
      </View>

      {document.category === 'Drawing' ? (
        <MobileDocumentECOSStatus
          document={sharedReferenceDocument}
          onMakeCurrent={() => {
            if (sharedReferenceDocument) onMakeCurrentDocument(sharedReferenceDocument.id);
          }}
        />
      ) : null}

      <View style={styles.photoControlRow}>
        <TouchableOpacity style={styles.photoControlButton} onPress={onOpen}>
          <Ionicons name="cloud-download-outline" size={17} color={colors.primary} />
          <Text style={styles.photoControlText}>Download & Open</Text>
        </TouchableOpacity>
        {(document.status === 'failed' || document.status === 'local') ? (
          <TouchableOpacity style={styles.photoControlButton} onPress={onRetry}>
            <Ionicons name="refresh-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Retry Upload</Text>
          </TouchableOpacity>
        ) : null}
        {document.status === 'failed' ? (
          <TouchableOpacity style={styles.photoControlButton} onPress={onReplaceFile}>
            <Ionicons name="document-attach-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Choose File Again</Text>
          </TouchableOpacity>
        ) : null}
        {editable ? (
          <TouchableOpacity
            style={styles.photoControlButton}
            onPress={() => setDetailsOpen(previous => !previous)}
          >
            <Ionicons name="options-outline" size={17} color={colors.primary} />
            <Text style={styles.photoControlText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {document.category === 'Schedule' ? (
        <TouchableOpacity
          style={[
            styles.photoControlButton,
            styles.documentCurrentControl,
            document.isCurrent && { backgroundColor: colors.successSoft, borderColor: colors.success },
          ]}
          onPress={onSetCurrentSchedule}
          disabled={document.isCurrent}
        >
          <Ionicons
            name={document.isCurrent ? 'checkmark-circle' : 'calendar-outline'}
            size={18}
            color={document.isCurrent ? colors.success : colors.primary}
          />
          <Text style={[
            styles.photoControlText,
            document.isCurrent && { color: colors.success },
          ]}>
            {document.isCurrent ? 'Current Schedule' : 'Make Current Schedule'}
          </Text>
        </TouchableOpacity>
      ) : null}

      {detailsOpen ? (
        <View style={styles.phase4DetailBlock}>
          <Text style={styles.label}>Rename</Text>
          <TextInput
            style={styles.input}
            value={document.name}
            onChangeText={name => updateDocument({ name })}
            placeholder="Document name"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.label}>Category</Text>
          <View style={styles.areaChipWrap}>
            {PROJECT_DOCUMENT_CATEGORIES.map(category => {
              const selected = document.category === category;
              return (
                <TouchableOpacity
                  key={category}
                  style={[styles.areaChip, selected && styles.areaChipSelected]}
                  onPress={() => updateDocument({ category })}
                >
                  <Text style={[styles.areaChipText, selected && styles.areaChipTextSelected]}>
                    {category}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {document.category === 'Drawing' ? (
            <View style={styles.phase4DetailBlock}>
              <Text style={styles.panelTitle}>Drawing Control</Text>
              <Text style={styles.bodyText}>
                Record the sheet identity and issue status so the field team can tell which drawing is authoritative.
              </Text>

              <Text style={styles.label}>Drawing Number</Text>
              <TextInput
                style={styles.input}
                value={document.drawingNumber || ''}
                onChangeText={drawingNumber => updateDocument({ drawingNumber })}
                placeholder="Example: A-201"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
              />

              <Text style={styles.label}>Revision</Text>
              <TextInput
                style={styles.input}
                value={document.drawingRevision || ''}
                onChangeText={drawingRevision => updateDocument({ drawingRevision })}
                placeholder="Example: 3"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Discipline</Text>
              <TextInput
                style={styles.input}
                value={document.drawingDiscipline || ''}
                onChangeText={drawingDiscipline => updateDocument({ drawingDiscipline })}
                placeholder="Architectural, Civil, Structural, MEP…"
                placeholderTextColor={colors.muted}
              />

              <Text style={styles.label}>Issue Status</Text>
              <View style={styles.areaChipWrap}>
                {(['Draft', 'For Review', 'For Construction', 'As-Built', 'Superseded'] as const).map(status => {
                  const selected = document.drawingStatus === status;
                  return (
                    <TouchableOpacity
                      key={status}
                      style={[styles.areaChip, selected && styles.areaChipSelected]}
                      onPress={() => updateDocument({ drawingStatus: status })}
                    >
                      <Text style={[styles.areaChipText, selected && styles.areaChipTextSelected]}>
                        {status}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Issue Date</Text>
              <TextInput
                style={styles.input}
                value={document.drawingIssuedAt || ''}
                onChangeText={drawingIssuedAt => updateDocument({ drawingIssuedAt })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          ) : null}

          <Text style={styles.label}>Attach to Area</Text>
          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[styles.areaChip, !document.areaId && styles.areaChipSelected]}
              onPress={() => updateDocument({ areaId: null })}
            >
              <Text style={[styles.areaChipText, !document.areaId && styles.areaChipTextSelected]}>
                No Area
              </Text>
            </TouchableOpacity>
            {projectAreas.map(area => {
              const selected = document.areaId === area.id;
              return (
                <TouchableOpacity
                  key={area.id}
                  style={[styles.areaChip, selected && styles.areaChipSelected]}
                  onPress={() => updateDocument({ areaId: area.id })}
                >
                  <Text style={[styles.areaChipText, selected && styles.areaChipTextSelected]}>
                    {area.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Attach to Update</Text>
          <View style={styles.areaChipWrap}>
            <TouchableOpacity
              style={[styles.areaChip, !document.updateId && styles.areaChipSelected]}
              onPress={() => updateDocument({ updateId: null })}
            >
              <Text style={[styles.areaChipText, !document.updateId && styles.areaChipTextSelected]}>
                No Update
              </Text>
            </TouchableOpacity>
            {updates.slice(0, 8).map(update => {
              const selected = document.updateId === update.id;
              return (
                <TouchableOpacity
                  key={update.id}
                  style={[styles.areaChip, selected && styles.areaChipSelected]}
                  onPress={() => updateDocument({ updateId: update.id })}
                >
                  <Text style={[styles.areaChipText, selected && styles.areaChipTextSelected]}>
                    {formatDisplayDate(update.date)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            value={document.note || ''}
            onChangeText={note => updateDocument({ note })}
            placeholder="Add note"
            placeholderTextColor={colors.muted}
            multiline
          />

          <TouchableOpacity style={styles.photoControlButton} onPress={onDelete}>
            <Ionicons name="trash-outline" size={17} color={colors.danger} />
            <Text style={[styles.photoControlText, { color: colors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}
