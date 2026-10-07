/**
 * Sync batch Y4, item 1. When a recovery record that could not be read was
 * set aside so that the app could start (services/DurableLocalTransaction.ts:
 * setAsideIfUnreadable), that is written down beside the record, and said
 * here: one plain sentence, once.
 *
 * "Once" is until he has tapped OK. A start that is closed while the sentence
 * is on the screen says it again at the next start, so it cannot be missed;
 * after OK it is never said again. It is not said twice in one run of the app
 * (Retry Recovery runs the startup recovery again).
 */
import { BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY } from './BackupRestoreRuntime';
import { durableJournalSetAsideNoticeKey } from './DurableLocalTransaction';

export type RecoveryRecordNoticeStorage = Readonly<{
  getItem: (key: string) => Promise<string | null>;
  removeItem: (key: string) => Promise<void>;
}>;

/** The app's alert: a title, a message and its buttons. */
export type RecoveryRecordNoticeAlert = (
  title: string,
  message: string,
  buttons: Array<{ text: string; onPress: () => void }>,
) => void;

export const RESTORE_RECORD_SET_ASIDE_TITLE = 'Restore not finished';
// Review pass 1, sync (the reviewer's remark on this sentence): "left as they are" may be a MIX. Each of the lists a
// restore writes is by then wholly the backup's or wholly the one from before it, and he cannot tell which.
export const RESTORE_RECORD_SET_ASIDE_MESSAGE =
  'A restore that was interrupted could not be finished because its record on this device could not be read, so your saved records were left as they are, which may be a mix of what the backup held and what was here before it: restore the backup again if anything is missing.';
export const FIELD_UPDATE_RECORD_SET_ASIDE_TITLE = 'Update save not finished';
export const FIELD_UPDATE_RECORD_SET_ASIDE_MESSAGE =
  'A field update that was being saved when the app closed could not be finished because its record on this device could not be read, so your draft and your saved updates were left as they are: check the last update you sent, and send it again if it is missing.';

const saidThisRun = new Set<string>();

/**
 * Says each waiting notice, the restore's first. Called once the startup
 * recovery has succeeded. Never rejects: a notice that cannot be read now
 * waits for the next start.
 */
export async function sayRecoveryRecordsSetAsideOnce(
  storage: RecoveryRecordNoticeStorage,
  fieldUpdateJournalKey: string,
  alert: RecoveryRecordNoticeAlert,
  restoreJournalKey: string = BACKUP_RESTORE_TRANSACTION_JOURNAL_KEY,
): Promise<void> {
  const notices = [
    { journalKey: restoreJournalKey, title: RESTORE_RECORD_SET_ASIDE_TITLE, message: RESTORE_RECORD_SET_ASIDE_MESSAGE },
    { journalKey: fieldUpdateJournalKey, title: FIELD_UPDATE_RECORD_SET_ASIDE_TITLE, message: FIELD_UPDATE_RECORD_SET_ASIDE_MESSAGE },
  ];
  for (const notice of notices) {
    const noticeKey = durableJournalSetAsideNoticeKey(notice.journalKey);
    try {
      if (saidThisRun.has(noticeKey) || await storage.getItem(noticeKey) === null) continue;
      saidThisRun.add(noticeKey);
      alert(notice.title, notice.message, [{
        text: 'OK',
        onPress: () => {
          void storage.removeItem(noticeKey).then(() => { saidThisRun.delete(noticeKey); }, () => undefined);
        },
      }]);
    } catch {
      // Not readable now: said at the next start.
    }
  }
}

/** For tests: a new run of the app. */
export function resetRecoveryRecordNoticesForTests(): void {
  saidThisRun.clear();
}
