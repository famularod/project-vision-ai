import { useState, useSyncExternalStore } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { mobileArchivedDocumentScopeText, type MobileArchivedDocument } from '../services/MobileDocumentWorkspace';
import {
  dismissSharedDocumentArchiveNotices,
  sharedDocumentArchiveNoticeText,
  sharedDocumentArchiveView,
  subscribeSharedDocumentArchive,
} from '../services/SharedDocumentArchive';
import { styles } from './app-shell-theme';

const noticesNow = () => sharedDocumentArchiveView().notices;

/**
 * "Archived (2)" under a project's Documents header (owner answer Q44, 6 Oct
 * 2026): the project's archived compliance documents, closed until tapped,
 * each with Restore. Nothing is shown when the project has none. An archived
 * document is hidden, not deleted, so this is where it is brought back from.
 *
 * Above it, always open: a line for each Restore this device let go without
 * sending it, because the document was archived again on another device
 * afterwards (review of D1, L2). It stays until he taps OK.
 */
export function ArchivedDocumentsSection({ documents, onRestore }: {
  documents: readonly MobileArchivedDocument[];
  onRestore: (document: MobileArchivedDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const notices = useSyncExternalStore(subscribeSharedDocumentArchive, noticesNow, noticesNow);
  if (documents.length === 0 && notices.length === 0) return null;
  return (
    <View testID="archived-documents-section">
      {notices.map(notice => {
        const name = notice.name || documents.find(document => document.sharedDocumentId === notice.documentId)?.name;
        return (
          <View key={`notice:${notice.documentId}`} style={styles.photoCard} testID="archived-document-notice">
            <Text selectable style={styles.locationDetailText}>{sharedDocumentArchiveNoticeText({ ...notice, name })}</Text>
            <TouchableOpacity
              style={styles.photoControlButton}
              accessibilityRole="button"
              accessibilityLabel={`OK, ${name || 'the document'} stays archived`}
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
