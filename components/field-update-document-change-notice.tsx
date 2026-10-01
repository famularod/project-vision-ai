import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import {
  FIELD_UPDATE_CONFLICT_REVIEW_TEXT,
  FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT,
  FIELD_UPDATE_RETRY_OVER_CONFLICT_MESSAGE,
  FIELD_UPDATE_RETRY_OVER_CONFLICT_TITLE,
  fieldUpdateConflictsSnapshot,
  fieldUpdateDocumentChangeWaiting,
  fieldUpdateHasOpenConflict,
  queuedDocumentChangesSnapshot,
  subscribeToFieldUpdateConflicts,
  subscribeToQueuedDocumentChanges,
} from '../services/FieldUpdateDocumentChangeNotice';
import { colors } from './app-shell-theme';

export { FIELD_UPDATE_CONFLICT_REVIEW_LABEL } from '../services/FieldUpdateDocumentChangeNotice';

/**
 * Whether a waiting or failed field update's card reads "Needs Review": a
 * conflict for it is saved on this phone (whole-app audit A7 pass 12 M-1).
 */
export function useFieldUpdateConflictReview(updateId: string, lifecycle: string): boolean {
  const conflicts = useSyncExternalStore(subscribeToFieldUpdateConflicts, fieldUpdateConflictsSnapshot);
  return (lifecycle === 'queued' || lifecycle === 'failed') && fieldUpdateHasOpenConflict(conflicts, updateId);
}

/** The card's Retry: an explicit send, which asks first when the update needs review (A7 pass 12 M-1). */
export function retryOverConflictConfirmed(conflictReview: boolean, onRetry?: () => void): (() => void) | undefined {
  if (!conflictReview || !onRetry) return onRetry;
  return () => Alert.alert(FIELD_UPDATE_RETRY_OVER_CONFLICT_TITLE, FIELD_UPDATE_RETRY_OVER_CONFLICT_MESSAGE, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Send', onPress: onRetry },
  ]);
}

/**
 * The line on a field update's card while a document change on it waits to
 * sync: its upload failed, or it has waited a while (whole-app audit A7 pass
 * 8 L2). Gone once it uploads. And, first, where to settle a conflict the
 * update waits in (`conflictReview`, A7 pass 12 M-1).
 */
export function FieldUpdateDocumentChangeNotice({ updateId, conflictReview = false }: { updateId: string; conflictReview?: boolean }) {
  const queue = useSyncExternalStore(subscribeToQueuedDocumentChanges, queuedDocumentChangesSnapshot);
  const [, setClock] = useState(0);
  const { shown, shownAt } = fieldUpdateDocumentChangeWaiting(queue, updateId);
  useEffect(() => {
    if (shown || shownAt === null) return undefined;
    const timer = setTimeout(() => setClock(tick => tick + 1), Math.max(0, shownAt - Date.now()));
    return () => clearTimeout(timer);
  }, [shown, shownAt]);
  return (
    <>
      {conflictReview ? (
        <Text style={noticeStyles.notice} accessibilityRole="text">
          {FIELD_UPDATE_CONFLICT_REVIEW_TEXT}
        </Text>
      ) : null}
      {shown ? (
        <Text style={noticeStyles.notice} accessibilityRole="text">
          {FIELD_UPDATE_DOCUMENT_CHANGE_WAITING_TEXT}
        </Text>
      ) : null}
    </>
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
