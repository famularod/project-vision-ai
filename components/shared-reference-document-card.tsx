import { Text, TouchableOpacity, View } from 'react-native';
import type { ReferenceDocument } from '../types';
import { referenceDocumentOpenMode } from '../services/ReferenceDocumentOpenAccess';
import { styles } from './app-shell-theme';
import { MobileDocumentECOSStatus } from './mobile-document-ecos-status';

/** Shared records are not device-owned attachments: no upload/edit/delete actions. */
export function SharedReferenceDocumentCard({ document, onOpen }: {
  document: ReferenceDocument;
  onOpen: (document: ReferenceDocument) => void;
}) {
  const mode = referenceDocumentOpenMode(document);
  return (
    <View style={styles.photoCard} testID="shared-reference-document-card">
      <Text selectable style={styles.photoTitle}>{document.name}</Text>
      <Text selectable style={styles.rowSub}>{document.category} · Shared project document</Text>
      {document.notes ? <Text selectable style={styles.locationDetailText}>{document.notes}</Text> : null}
      {document.category === 'Drawing' ? <MobileDocumentECOSStatus document={document} /> : null}
      {mode === 'unavailable' ? (
        <Text selectable style={styles.bodyText}>The original file is unavailable. Reconnect it in the desktop Documents workspace.</Text>
      ) : (
        <TouchableOpacity
          style={styles.photoControlButton}
          accessibilityRole="button"
          accessibilityLabel={`Open original ${document.name}`}
          onPress={() => onOpen(document)}
        >
          <Text style={styles.photoControlText}>{mode === 'google_drive' ? 'Open in Drive' : 'Download & Open'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
