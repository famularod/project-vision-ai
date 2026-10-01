import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT,
  fieldUpdateDocumentChangeWaiting,
  queuedDocumentChangesSnapshot,
  subscribeToQueuedDocumentChanges,
} from '../services/FieldUpdateDocumentChangeNotice';
import { colors } from './app-shell-theme';

/**
 * The line on a field update's card while a document change on it waits to
 * sync: its upload failed, or it has waited a while (whole-app audit A7 pass
 * 8 L2). Gone once it uploads.
 */
export function FieldUpdateDocumentChangeNotice({ updateId }: { updateId: string }) {
  const queue = useSyncExternalStore(subscribeToQueuedDocumentChanges, queuedDocumentChangesSnapshot);
  const [, setClock] = useState(0);
  const { shown, shownAt } = fieldUpdateDocumentChangeWaiting(queue, updateId);
  useEffect(() => {
    if (shown || shownAt === null) return undefined;
    const timer = setTimeout(() => setClock(tick => tick + 1), Math.max(0, shownAt - Date.now()));
    return () => clearTimeout(timer);
  }, [shown, shownAt]);
  if (!shown) return null;
  return (
    <Text style={noticeStyles.notice} accessibilityRole="text">
      {FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT}
    </Text>
  );
}

const noticeStyles = StyleSheet.create({
  notice: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: colors.warningSoft,
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
