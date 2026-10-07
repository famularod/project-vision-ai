import { useState, useSyncExternalStore } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { mobileArchivedDocumentScopeText, type MobileArchivedDocument } from '../services/MobileDocumentWorkspace';
import {
  dismissSharedDocumentArchiveNotices,
  sharedDocumentArchiveNoticeText,
  sharedDocumentArchiveView,
  sharedDocumentRestoreWaitingText,
  subscribeSharedDocumentArchive,
} from '../services/SharedDocumentArchive';
import { styles } from './app-shell-theme';

const noticesNow = () => sharedDocumentArchiveView().notices;
const waitingRestoresNow = () => sharedDocumentArchiveView().waitingRestores;

/**
 * "Archived (2)" under a project's Documents header (owner answer Q44, 6 Oct
 * 2026): the project's archived compliance documents, closed until tapped,
 * each with Restore. Nothing is shown when the project has none. An archived
 * document is hidden, not deleted, so this is where it is brought back from.
 *
 * Above it, always open: a line for each tap this device let go without
 * sending it, because the cloud no longer held what this device last knew
 * when he tapped (second review, P2-M1): a Restore, because the document
 * was archived again on another device; an Archive, because it was restored
 * on another device, or deleted. The line says what the document's state
 * now is. It stays until he taps OK, taps on that document again, or the
 * state it speaks of changes.
 * And a line for each Restore made here that has not reached the cloud yet
 * (L5): the document is back in this device's list and still hidden on the
 * others. That line goes by itself once the Restore has been sent.
 */
export function ArchivedDocumentsSection({ documents, onRestore }: {
  documents: readonly MobileArchivedDocument[];
  onRestore: (document: MobileArchivedDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const notices = useSyncExternalStore(subscribeSharedDocumentArchive, noticesNow, noticesNow);
  const waitingRestores = useSyncExternalStore(subscribeSharedDocumentArchive, waitingRestoresNow, waitingRestoresNow);
  if (documents.length === 0 && notices.length === 0 && waitingRestores.length === 0) return null;
  return (
    <View testID="archived-documents-section">
      {waitingRestores.map(waiting => (
        <View key={`restore:${waiting.documentId}`} style={styles.photoCard} testID="archived-document-restore-waiting">
          <Text selectable style={styles.locationDetailText}>{sharedDocumentRestoreWaitingText(waiting)}</Text>
        </View>
      ))}
      {notices.map(notice => {
        const name = notice.name || documents.find(document => document.sharedDocumentId === notice.documentId)?.name;
        return (
          <View key={`notice:${notice.documentId}`} style={styles.photoCard} testID="archived-document-notice">
            <Text selectable style={styles.locationDetailText}>{sharedDocumentArchiveNoticeText({ ...notice, name })}</Text>
            <TouchableOpacity
              style={styles.photoControlButton}
              accessibilityRole="button"
              accessibilityLabel={`OK, dismiss the note about ${name || 'the document'}`}
              onPress={() => { void dismissSharedDocumentArchiveNotices([notice.documentId]); }}
            >
              <Text style={styles.photoControlText}>OK</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      {documents.length > 0 ? (
        <TouchableOpacity
          style={styles.photoControlButton}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Archived documents, ${documents.length}. ${open ? 'Hide' : 'Show'}`}
          onPress={() => setOpen(value => !value)}
        >
          <Text style={styles.photoControlText}>{`Archived (${documents.length})`}</Text>
        </TouchableOpacity>
      ) : null}
      {open ? documents.map(document => (
        <View key={document.key} style={styles.photoCard} testID="archived-document-row">
          <Text selectable style={styles.photoTitle}>{document.name}</Text>
          <Text selectable style={styles.rowSub}>{`${document.category} · Archived`}</Text>
          <Text selectable style={styles.locationDetailText}>{mobileArchivedDocumentScopeText(document.scope)}</Text>
          <TouchableOpacity
            style={styles.photoControlButton}
            accessibilityRole="button"
            accessibilityLabel={`Restore ${document.name}`}
            onPress={() => onRestore(document)}
          >
            <Text style={styles.photoControlText}>Restore</Text>
          </TouchableOpacity>
        </View>
      )) : null}
    </View>
  );
}
