import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  createFieldNote,
  createFieldNoteId,
  localFieldNoteRepository,
  updateFieldNoteDetails,
  updateFieldNoteStatus,
  type FieldNote,
  type FieldNoteActionKind,
  type FieldNoteSource,
  type FieldNoteStatus,
} from '../services/FieldNoteRepository';
import type { FieldNoteWorkspaceDataSource } from '../services/FieldNoteMobileSync';
import { colors, radius, spacing } from '../theme';

const ACTION_OPTIONS: ReadonlyArray<Readonly<{
  value: FieldNoteActionKind;
  label: string;
}>> = [
  { value: 'none', label: 'Observation only' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'task_candidate', label: 'Possible task' },
  { value: 'issue_candidate', label: 'Possible issue' },
  { value: 'safety_candidate', label: 'Safety concern' },
];

const STATUS_OPTIONS: ReadonlyArray<Readonly<{ value: FieldNoteStatus; label: string }>> = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'archived', label: 'Archived' },
];

export type FieldNoteVoiceDraft = Readonly<{
  id: string;
  text: string;
  projectName: string | null;
  locationName: string | null;
}>;

export type FieldNoteProjectOption = Readonly<{
  id: string | null;
  name: string;
}>;

const LOCAL_FIELD_NOTE_DATA_SOURCE: FieldNoteWorkspaceDataSource = Object.freeze({
  list: (ownerKey: string) => localFieldNoteRepository.list(ownerKey),
  save: (ownerKey: string, note: FieldNote) => localFieldNoteRepository.save(ownerKey, note),
  update: (ownerKey: string, note: FieldNote) => localFieldNoteRepository.replace(ownerKey, note),
});

export function FieldNotesWorkspace(props: Parameters<typeof FieldNotesWorkspaceContent>[0]) {
  // Owner changes discard drafts and callbacks as well as the displayed inbox.
  return <FieldNotesWorkspaceContent key={props.ownerKey} {...props} />;
}

function FieldNotesWorkspaceContent({
  ownerKey,
  projects,
  projectRecords,
  initialProjectName = null,
  scopeProjectName = null,
  voiceDraft = null,
  onVoiceDraftConsumed,
  onRecordVoice,
  dataSource = LOCAL_FIELD_NOTE_DATA_SOURCE,
  presentation = 'mobile_capture',
}: {
  ownerKey: string;
  projects: readonly string[];
  projectRecords?: readonly FieldNoteProjectOption[];
  initialProjectName?: string | null;
  scopeProjectName?: string | null;
  voiceDraft?: FieldNoteVoiceDraft | null;
  onVoiceDraftConsumed?: (id: string) => void;
  onRecordVoice?: (projectName: string | null) => void;
  dataSource?: FieldNoteWorkspaceDataSource;
  presentation?: 'mobile_capture' | 'desktop_inbox';
}) {
  const { width: windowWidth } = useWindowDimensions();
  const compactMobileLayout = presentation === 'mobile_capture' && windowWidth <= 480;
  const [notes, setNotes] = useState<readonly FieldNote[]>([]);
  const [filter, setFilter] = useState<FieldNoteStatus>('open');
  const [text, setText] = useState('');
  const [source, setSource] = useState<FieldNoteSource>('typed');
  const [projectName, setProjectName] = useState(initialProjectName?.trim() || '');
  const [locationName, setLocationName] = useState('');
  const [actionKind, setActionKind] = useState<FieldNoteActionKind>('none');
  const [actionText, setActionText] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'danger' | 'info'; text: string } | null>(null);
  const [editingNote, setEditingNote] = useState<FieldNote | null>(null);
  const [editText, setEditText] = useState('');
  const [editProjectName, setEditProjectName] = useState('');
  const [editLocationName, setEditLocationName] = useState('');
  const [editActionKind, setEditActionKind] = useState<FieldNoteActionKind>('none');
  const [editActionText, setEditActionText] = useState('');
  const [editStatus, setEditStatus] = useState<FieldNoteStatus>('open');
  const consumedVoiceDraftRef = useRef<string | null>(null);
  const noteOperationRef = useRef(0);
  const projectOptions = useMemo(() => {
    const records = projectRecords?.length
      ? projectRecords
      : projects.map(name => ({ id: null, name }));
    const byName = new Map<string, FieldNoteProjectOption>();
    records.forEach(record => {
      const name = record.name.trim();
      if (name) byName.set(normalized(name), { id: record.id?.trim() || null, name });
    });
    return Array.from(byName.values());
  }, [projectRecords, projects]);

  async function loadNotes() {
    const operation = ++noteOperationRef.current;
    const isCurrent = () => operation === noteOperationRef.current;
    let localShown = false;
    setLoading(true);
    setNotice(null);
    try {
      if (dataSource.listLocal) {
        const local = await dataSource.listLocal(ownerKey);
        if (!isCurrent()) return;
        setNotes(local);
        setLoading(false);
        localShown = true;
      }
      const refreshed = await dataSource.list(ownerKey);
      if (isCurrent()) setNotes(refreshed);
    } catch (error) {
      if (!isCurrent()) return;
      if (!localShown) setNotes([]);
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Field notes could not be loaded.',
      });
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  useEffect(() => {
    setNotes([]);
    void loadNotes();
    return () => { noteOperationRef.current += 1; };
    // Owner changes intentionally re-scope the entire local inbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, ownerKey]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => undefined;
    if (dataSource.subscribe) {
      void dataSource.subscribe(
        ownerKey,
        async nextNotes => {
          const operation = noteOperationRef.current;
          // Notifications may carry an older snapshot than a just-completed save.
          try {
            const latest = dataSource.listLocal ? await dataSource.listLocal(ownerKey) : nextNotes;
            if (!disposed && operation === noteOperationRef.current) setNotes(latest);
          } catch { /* Keep the displayed local notes if a refresh cannot read. */ }
        },
        status => {
          if (disposed) return;
          if (status === 'retrying') {
            setNotice({
              tone: 'info',
              text: 'Cloud connection is reconnecting. Saved notes remain protected.',
            });
          }
        },
      ).then(cleanup => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      }).catch(() => {
        if (!disposed) {
          setNotice({
            tone: 'info',
            text: 'Field Notes are available. Cloud synchronization will retry automatically.',
          });
        }
      });
    }
    const foregroundSubscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || !dataSource.retryPending) return;
      const operation = noteOperationRef.current;
      void dataSource.retryPending(ownerKey).then(async nextNotes => {
        const latest = dataSource.listLocal ? await dataSource.listLocal(ownerKey) : nextNotes;
        if (!disposed && operation === noteOperationRef.current) setNotes(latest);
      }).catch(() => undefined);
    });
    return () => {
      disposed = true;
      unsubscribe();
      foregroundSubscription.remove();
    };
  }, [dataSource, ownerKey]);

  useEffect(() => {
    if (!voiceDraft || consumedVoiceDraftRef.current === voiceDraft.id) return;
    consumedVoiceDraftRef.current = voiceDraft.id;
    setText(voiceDraft.text.trim());
    setSource('voice');
    setCaptureOpen(true);
    if (voiceDraft.projectName?.trim()) setProjectName(voiceDraft.projectName.trim());
    if (voiceDraft.locationName?.trim()) setLocationName(voiceDraft.locationName.trim());
    setNotice({ tone: 'info', text: 'Voice note is ready. Review it, then save.' });
    onVoiceDraftConsumed?.(voiceDraft.id);
  }, [onVoiceDraftConsumed, voiceDraft]);

  const visibleNotes = notes.filter(note => {
    if (note.status !== filter) return false;
    if (!scopeProjectName?.trim()) return true;
    return normalized(note.projectName) === normalized(scopeProjectName);
  });

  async function saveNote() {
    if (!text.trim() || saving) return;
    const operation = ++noteOperationRef.current;
    setSaving(true);
    setNotice(null);
    try {
      const note = createFieldNote({
        id: createFieldNoteId(),
        text,
        source,
        projectId: projectOptions.find(option => normalized(option.name) === normalized(projectName))?.id,
        projectName,
        locationName,
        actionKind,
        actionText,
      });
      const saved = dataSource.saveLocal
        ? await dataSource.saveLocal(ownerKey, note)
        : await dataSource.save(ownerKey, note);
      if (operation !== noteOperationRef.current) return;
      setLoading(false);
      setNotes(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      setText('');
      setSource('typed');
      setLocationName('');
      setActionKind('none');
      setActionText('');
      setFilter('open');
      setCaptureOpen(false);
      setNotice({
        tone: saved.syncState === 'synced' ? 'good' : 'info',
        text: saved.syncState === 'synced'
          ? 'Field note saved and sent to the desktop inbox.'
          : 'Field note saved on this device. Vitruvius will send it to the desktop automatically.',
      });
      if (dataSource.saveLocal && dataSource.retryPending) {
        // Cloud work must not delay the verified device-save confirmation.
        void dataSource.retryPending(ownerKey).then(async synced => {
          const latest = dataSource.listLocal ? await dataSource.listLocal(ownerKey) : synced;
          if (operation === noteOperationRef.current) setNotes(latest);
        }).catch(() => undefined);
      }
    } catch (error) {
      if (operation !== noteOperationRef.current) return;
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Field note could not be saved.',
      });
    } finally {
      if (operation === noteOperationRef.current) setSaving(false);
    }
  }

  async function changeStatus(note: FieldNote, status: FieldNoteStatus) {
    if (saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await dataSource.update(
        ownerKey,
        updateFieldNoteStatus(note, status),
      );
      setNotes(current => current.map(item => item.id === updated.id ? updated : item));
      if (editingNote?.id === updated.id) beginEdit(updated);
      setNotice({
        tone: updated.syncState === 'pending' ? 'info' : 'good',
        text: updated.syncState === 'pending'
          ? 'Change saved on this device and waiting to synchronize.'
          : status === 'resolved'
            ? 'Field note marked resolved.'
            : status === 'archived'
              ? 'Field note archived.'
              : 'Field note reopened.',
      });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Field note could not be updated.',
      });
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(note: FieldNote) {
    setEditingNote(note);
    setEditText(note.originalText);
    setEditProjectName(note.projectName || '');
    setEditLocationName(note.locationName || '');
    setEditActionKind(note.actionKind);
    setEditActionText(note.actionText || '');
    setEditStatus(note.status);
    setNotice(null);
  }

  async function saveDesktopEdit() {
    if (!editingNote || !editText.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const selectedProject = projectOptions.find(
        option => normalized(option.name) === normalized(editProjectName),
      );
      const changed = updateFieldNoteDetails(editingNote, {
        text: editText,
        projectId: selectedProject?.id || null,
        projectName: selectedProject?.name || null,
        locationName: editLocationName,
        actionKind: editActionKind,
        actionText: editActionText,
        status: editStatus,
      });
      const updated = await dataSource.update(ownerKey, changed);
      setNotes(current => current.map(item => item.id === updated.id ? updated : item));
      beginEdit(updated);
      setNotice({ tone: 'good', text: 'Field note changes saved and synchronized.' });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Field note changes could not be saved.',
      });
      void dataSource.list(ownerKey).then(setNotes).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.workspace} testID="field-notes-workspace">
      <View style={styles.localBanner}>
        <Ionicons
          name={presentation === 'desktop_inbox' ? 'desktop-outline' : 'phone-portrait-outline'}
          size={19}
          color={colors.primary}
        />
        <View style={styles.grow}>
          <Text style={styles.localBannerTitle}>
            {presentation === 'desktop_inbox' ? 'Field Notes review desk' : 'Quick field memory'}
          </Text>
          <Text style={styles.localBannerText}>
            {presentation === 'desktop_inbox'
              ? 'Notes captured on iPhone and iPad arrive here for review and editing.'
              : 'Saved immediately, even offline, then securely sent to the desktop inbox. Project context is optional.'}
          </Text>
        </View>
      </View>

      {presentation === 'mobile_capture' ? <View style={[
        styles.quickCaptureCard,
        compactMobileLayout && styles.quickCaptureCardCompact,
      ]}>
        <View style={styles.grow}>
          <Text style={styles.quickCaptureTitle}>Add a field note</Text>
          <Text style={styles.quickCaptureText}>Capture it now. Add a project only when it helps.</Text>
        </View>
        <View style={[
          styles.quickCaptureActions,
          compactMobileLayout && styles.quickCaptureActionsCompact,
        ]}>
          {onRecordVoice ? (
            <Pressable
              style={({ pressed }) => [
                styles.quickRecordButton,
                compactMobileLayout && styles.quickCaptureButtonCompact,
                pressed && styles.pressed,
              ]}
              onPress={() => onRecordVoice(projectName.trim() || null)}
              accessibilityRole="button"
              accessibilityLabel="Record field note"
            >
              <Ionicons name="mic" size={19} color="#FFFFFF" />
              <Text style={styles.quickRecordButtonText}>Record note</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.quickTypeButton,
              compactMobileLayout && styles.quickCaptureButtonCompact,
              pressed && styles.pressed,
            ]}
            onPress={() => setCaptureOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Type field note"
          >
            <Ionicons name="create-outline" size={19} color={colors.primary} />
            <Text style={styles.quickTypeButtonText}>Type note</Text>
          </Pressable>
        </View>
      </View> : null}

      {notice ? (
        <View style={[
          styles.notice,
          notice.tone === 'danger' && styles.noticeDanger,
          notice.tone === 'good' && styles.noticeGood,
        ]} accessibilityRole="alert">
          <Text style={[
            styles.noticeText,
            notice.tone === 'danger' && styles.noticeTextDanger,
            notice.tone === 'good' && styles.noticeTextGood,
          ]}>{notice.text}</Text>
        </View>
      ) : null}

      {presentation === 'mobile_capture' && captureOpen ? <View style={[
        styles.captureCard,
        compactMobileLayout && styles.cardCompact,
      ]}>
        <View style={styles.sectionHeading}>
          <View style={styles.iconBubble}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>Capture a field note</Text>
            <Text style={styles.sectionDetail}>Record an observation, reminder, or possible next action.</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.captureCloseButton, pressed && styles.pressed]}
            onPress={() => setCaptureOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close field note editor"
          >
            <Ionicons name="close" size={20} color={colors.mutedText} />
          </Pressable>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>What did you notice or remember?</Text>
          <TextInput
            value={text}
            onChangeText={value => {
              setText(value);
              if (source === 'voice') setSource('typed');
            }}
            multiline
            textAlignVertical="top"
            placeholder="Example: The new parking area may need guardrails at the exposed edge."
            placeholderTextColor={colors.tertiaryText}
            style={[styles.input, styles.noteInput]}
            accessibilityLabel="Field note"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Project <Text style={styles.optional}>(optional)</Text></Text>
          <View style={styles.chipRow}>
            <ChoiceChip
              label="General / no project"
              selected={!projectName}
              onPress={() => setProjectName('')}
            />
            {projectOptions.map(project => (
              <ChoiceChip
                key={project.id || project.name}
                label={project.name}
                selected={normalized(projectName) === normalized(project.name)}
                onPress={() => setProjectName(project.name)}
              />
            ))}
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Location <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            value={locationName}
            onChangeText={setLocationName}
            placeholder="Example: 2321 North Lot"
            placeholderTextColor={colors.tertiaryText}
            style={styles.input}
            accessibilityLabel="Field note location"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>What might come from this?</Text>
          <View style={styles.chipRow}>
            {ACTION_OPTIONS.map(option => (
              <ChoiceChip
                key={option.value}
                label={option.label}
                selected={actionKind === option.value}
                onPress={() => {
                  setActionKind(option.value);
                  if (option.value === 'none') setActionText('');
                }}
              />
            ))}
          </View>
        </View>

        {actionKind !== 'none' ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Possible next step <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              value={actionText}
              onChangeText={setActionText}
              placeholder="Example: Confirm guardrail requirement with the civil engineer"
              placeholderTextColor={colors.tertiaryText}
              style={styles.input}
              accessibilityLabel="Possible field note next step"
            />
            <Text style={styles.reviewReminder}>This is a suggestion only. Formal conversion will require review.</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            (!text.trim() || saving) && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={() => { void saveNote(); }}
          disabled={!text.trim() || saving}
          accessibilityRole="button"
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="save-outline" size={20} color="#FFFFFF" />}
          <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Field Note'}</Text>
        </Pressable>
      </View> : null}

      <View style={presentation === 'desktop_inbox' ? styles.desktopReviewLayout : undefined}>
      <View style={[
        styles.inboxCard,
        presentation === 'desktop_inbox' && styles.desktopInboxCard,
        compactMobileLayout && styles.cardCompact,
      ]}>
        <View style={styles.sectionHeading}>
          <View style={styles.iconBubble}>
            <Ionicons name="file-tray-full-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>Field Notes inbox</Text>
            <Text style={styles.sectionDetail}>Review notes before they are forgotten or turned into formal work.</Text>
          </View>
        </View>

        <View style={styles.chipRow}>
          {STATUS_OPTIONS.map(option => (
            <ChoiceChip
              key={option.value}
              label={`${option.label} (${notes.filter(note => note.status === option.value).length})`}
              selected={filter === option.value}
              onPress={() => setFilter(option.value)}
            />
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.sectionDetail}>Loading field notes…</Text>
          </View>
        ) : visibleNotes.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={27} color={colors.success} />
            <Text style={styles.emptyTitle}>No {filter} field notes.</Text>
            <Text style={styles.emptyText}>
              {scopeProjectName ? `This view is filtered to ${scopeProjectName}.` : 'New observations and reminders will appear here.'}
            </Text>
          </View>
        ) : visibleNotes.map(note => (
          <FieldNoteCard
            key={note.id}
            note={note}
            disabled={saving}
            onStatusChange={status => { void changeStatus(note, status); }}
            onEdit={presentation === 'desktop_inbox' ? () => beginEdit(note) : undefined}
            showSyncState={presentation === 'mobile_capture'}
            compact={compactMobileLayout}
          />
        ))}
      </View>
      {presentation === 'desktop_inbox' ? (
        <View style={styles.desktopEditorCard}>
          <View style={styles.sectionHeading}>
            <View style={styles.iconBubble}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.grow}>
              <Text style={styles.sectionTitle}>Review and edit</Text>
              <Text style={styles.sectionDetail}>
                {editingNote
                  ? `Cloud revision ${editingNote.revision}`
                  : 'Select a note from the inbox to review its information.'}
              </Text>
            </View>
          </View>

          {editingNote ? <>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Field note</Text>
              <TextInput
                value={editText}
                onChangeText={setEditText}
                multiline
                textAlignVertical="top"
                style={[styles.input, styles.desktopNoteInput]}
                accessibilityLabel="Edit field note text"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Project <Text style={styles.optional}>(optional)</Text></Text>
              <View style={styles.chipRow}>
                <ChoiceChip
                  label="General / no project"
                  selected={!editProjectName}
                  onPress={() => setEditProjectName('')}
                />
                {projectOptions.map(project => (
                  <ChoiceChip
                    key={`edit-${project.id || project.name}`}
                    label={project.name}
                    selected={normalized(editProjectName) === normalized(project.name)}
                    onPress={() => setEditProjectName(project.name)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Location <Text style={styles.optional}>(optional)</Text></Text>
              <TextInput
                value={editLocationName}
                onChangeText={setEditLocationName}
                style={styles.input}
                accessibilityLabel="Edit field note location"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Possible result</Text>
              <View style={styles.chipRow}>
                {ACTION_OPTIONS.map(option => (
                  <ChoiceChip
                    key={`edit-${option.value}`}
                    label={option.label}
                    selected={editActionKind === option.value}
                    onPress={() => {
                      setEditActionKind(option.value);
                      if (option.value === 'none') setEditActionText('');
                    }}
                  />
                ))}
              </View>
            </View>

            {editActionKind !== 'none' ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Possible next step <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput
                  value={editActionText}
                  onChangeText={setEditActionText}
                  style={styles.input}
                  accessibilityLabel="Edit possible next step"
                />
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Status</Text>
              <View style={styles.chipRow}>
                {STATUS_OPTIONS.map(option => (
                  <ChoiceChip
                    key={`edit-status-${option.value}`}
                    label={option.label}
                    selected={editStatus === option.value}
                    onPress={() => setEditStatus(option.value)}
                  />
                ))}
              </View>
            </View>

            <View style={styles.desktopEditorActions}>
              <Pressable
                style={({ pressed }) => [styles.noteSecondaryAction, pressed && styles.pressed]}
                onPress={() => setEditingNote(null)}
                accessibilityRole="button"
              >
                <Text style={styles.noteSecondaryActionText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.saveButton,
                  styles.desktopSaveButton,
                  (!editText.trim() || saving) && styles.disabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => { void saveDesktopEdit(); }}
                disabled={!editText.trim() || saving}
                accessibilityRole="button"
                accessibilityLabel="Save field note changes"
              >
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="cloud-done-outline" size={20} color="#FFFFFF" />}
                <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
              </Pressable>
            </View>
          </> : (
            <View style={styles.emptyState}>
              <Ionicons name="arrow-back-circle-outline" size={28} color={colors.primary} />
              <Text style={styles.emptyTitle}>Choose a field note</Text>
              <Text style={styles.emptyText}>Its complete editable record will open here.</Text>
            </View>
          )}
        </View>
      ) : null}
      </View>
    </View>
  );
}

function FieldNoteCard({
  note,
  disabled,
  onStatusChange,
  onEdit,
  showSyncState,
  compact,
}: {
  note: FieldNote;
  disabled: boolean;
  onStatusChange: (status: FieldNoteStatus) => void;
  onEdit?: () => void;
  showSyncState: boolean;
  compact: boolean;
}) {
  return (
    <View style={styles.noteCard}>
      <View style={[styles.noteHeader, compact && styles.noteHeaderCompact]}>
        <View style={styles.grow}>
          <Text style={styles.noteMeta}>{formatFieldNoteDate(note.createdAt)} · {note.source === 'voice' ? 'Voice' : 'Typed'}</Text>
          <Text style={styles.noteContext}>
            {[note.projectName || 'General note', note.locationName].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View style={[styles.badgeColumn, compact && styles.badgeColumnCompact]}>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>{statusLabel(note.status)}</Text>
          </View>
          {showSyncState ? <View style={[
            styles.syncBadge,
            note.syncState === 'pending' && styles.syncBadgePending,
            note.syncState === 'conflict' && styles.syncBadgeConflict,
          ]}>
            <Text style={[
              styles.syncBadgeText,
              note.syncState === 'pending' && styles.syncBadgeTextPending,
              note.syncState === 'conflict' && styles.syncBadgeTextConflict,
            ]}>{syncStateLabel(note)}</Text>
          </View> : null}
        </View>
      </View>
      <Text style={styles.noteText}>{note.originalText}</Text>
      {note.actionKind !== 'none' ? (
        <View style={styles.actionSuggestion}>
          <Ionicons name="sparkles-outline" size={17} color={colors.warning} />
          <View style={styles.grow}>
            <Text style={styles.actionSuggestionLabel}>{actionLabel(note.actionKind)}</Text>
            {note.actionText ? <Text style={styles.actionSuggestionText}>{note.actionText}</Text> : null}
          </View>
        </View>
      ) : null}
      <View style={styles.noteActions}>
        {onEdit ? (
          <Pressable
            style={({ pressed }) => [styles.notePrimaryAction, pressed && styles.pressed]}
            onPress={onEdit}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Edit field note"
          >
            <Text style={styles.notePrimaryActionText}>Edit</Text>
          </Pressable>
        ) : null}
        {note.status === 'open' ? (
          <Pressable
            style={({ pressed }) => [styles.notePrimaryAction, pressed && styles.pressed]}
            onPress={() => onStatusChange('resolved')}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Text style={styles.notePrimaryActionText}>Mark Resolved</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.noteSecondaryAction, pressed && styles.pressed]}
            onPress={() => onStatusChange('open')}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Text style={styles.noteSecondaryActionText}>Reopen</Text>
          </Pressable>
        )}
        {note.status !== 'archived' ? (
          <Pressable
            style={({ pressed }) => [styles.noteSecondaryAction, pressed && styles.pressed]}
            onPress={() => onStatusChange('archived')}
            disabled={disabled}
            accessibilityRole="button"
          >
            <Text style={styles.noteSecondaryActionText}>Archive</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() || '';
}

function actionLabel(kind: FieldNoteActionKind): string {
  return ACTION_OPTIONS.find(option => option.value === kind)?.label || 'Possible next step';
}

function statusLabel(status: FieldNoteStatus): string {
  return STATUS_OPTIONS.find(option => option.value === status)?.label || status;
}

function syncStateLabel(note: FieldNote): string {
  if (note.syncState === 'conflict') return 'Review needed';
  if (note.syncState === 'pending') return 'Waiting to sync';
  return 'Sent to desktop';
}

function formatFieldNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  workspace: { width: '100%', minWidth: 0, gap: spacing.lg },
  grow: { flex: 1, minWidth: 0 },
  localBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: '#BED8F5', backgroundColor: colors.primarySoft },
  localBannerTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  localBannerText: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 2 },
  quickCaptureCard: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.md, borderRadius: radius.xl, borderWidth: 1, borderColor: '#BED8F5', backgroundColor: colors.surface, padding: spacing.md },
  quickCaptureCardCompact: { flexDirection: 'column', alignItems: 'stretch' },
  quickCaptureTitle: { color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '900' },
  quickCaptureText: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 2 },
  quickCaptureActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  quickCaptureActionsCompact: { width: '100%', flexWrap: 'nowrap' },
  quickCaptureButtonCompact: { flexGrow: 1, flexBasis: 0, paddingHorizontal: spacing.sm },
  quickRecordButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md },
  quickRecordButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  quickTypeButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: '#BED8F5', backgroundColor: colors.primarySoft, paddingHorizontal: spacing.md },
  quickTypeButtonText: { color: colors.primary, fontSize: 14, fontWeight: '900' },
  captureCard: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  cardCompact: { padding: spacing.md },
  captureCloseButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  inboxCard: { borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  desktopReviewLayout: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: spacing.lg },
  desktopInboxCard: { flexGrow: 1, flexBasis: 430, minWidth: 320 },
  desktopEditorCard: { flexGrow: 1, flexBasis: 500, minWidth: 320, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.md },
  desktopNoteInput: { minHeight: 150 },
  desktopEditorActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  desktopSaveButton: { minWidth: 180 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBubble: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  sectionTitle: { color: colors.text, fontSize: 21, lineHeight: 27, fontWeight: '900' },
  sectionDetail: { color: colors.mutedText, fontSize: 14, lineHeight: 20, marginTop: 2 },
  fieldGroup: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  optional: { color: colors.mutedText, fontWeight: '600' },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, color: colors.text, fontSize: 16, lineHeight: 22, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noteInput: { minHeight: 112 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  chipTextSelected: { color: '#FFFFFF' },
  reviewReminder: { color: colors.mutedText, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: radius.md, borderWidth: 1, borderColor: '#BED8F5', backgroundColor: colors.primarySoft, padding: spacing.sm },
  noticeDanger: { borderColor: '#F4B4B0', backgroundColor: colors.dangerSoft },
  noticeGood: { borderColor: '#B9E5C4', backgroundColor: colors.successSoft },
  noticeText: { color: colors.primary, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  noticeTextDanger: { color: colors.danger },
  noticeTextGood: { color: '#21763A' },
  saveButton: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, lineHeight: 21, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  emptyState: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '800', textTransform: 'capitalize' },
  emptyText: { color: colors.mutedText, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  noteCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.sm },
  noteHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  noteHeaderCompact: { flexDirection: 'column' },
  noteMeta: { color: colors.mutedText, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  noteContext: { color: colors.primary, fontSize: 13, lineHeight: 19, fontWeight: '800', marginTop: 2 },
  badgeColumn: { alignItems: 'flex-end', gap: spacing.xxs },
  badgeColumnCompact: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  statusBadge: { borderRadius: 999, backgroundColor: colors.primarySoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  statusBadgeText: { color: colors.primary, fontSize: 11, lineHeight: 15, fontWeight: '900' },
  syncBadge: { borderRadius: 999, backgroundColor: colors.successSoft, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
  syncBadgePending: { backgroundColor: colors.warningSoft },
  syncBadgeConflict: { backgroundColor: colors.dangerSoft },
  syncBadgeText: { color: '#21763A', fontSize: 10, lineHeight: 14, fontWeight: '900' },
  syncBadgeTextPending: { color: '#8A5200' },
  syncBadgeTextConflict: { color: colors.danger },
  noteText: { color: colors.text, fontSize: 16, lineHeight: 23 },
  actionSuggestion: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.warningSoft, padding: spacing.sm },
  actionSuggestionLabel: { color: '#8A5200', fontSize: 12, lineHeight: 17, fontWeight: '900' },
  actionSuggestionText: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 2 },
  noteActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  notePrimaryAction: { minHeight: 40, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: spacing.md },
  notePrimaryActionText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  noteSecondaryAction: { minHeight: 40, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  noteSecondaryActionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
});
