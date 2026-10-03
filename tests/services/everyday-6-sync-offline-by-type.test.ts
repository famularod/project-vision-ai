/**
 * Everyday item 6 (2 Oct 2026): a project, task or document whose name holds
 * a word like "Network" made a sync failure read as "offline" (and be
 * retried as one): the failure's category, the sync's user-facing sentence
 * and the document upload's backoff were read from message text that carries
 * the name. Offline is now the platform's own transport failure, by the
 * error's type and code, or the platform's fixed wording with every quoted
 * name and every database row echo taken out first.
 *
 * Real SyncFailureCategory, SyncOfflineClassifier, ProjectDocumentUploadRetry
 * and SyncService's sentence.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { classifySyncFailureText, syncFailureCategoryOfError } from '../../services/SyncFailureCategory';
import { syncErrorIsTransportFailure, syncMessageWithoutNames } from '../../services/SyncOfflineClassifier';
import { projectDocumentUploadAttemptsAfterFailure } from '../../services/ProjectDocumentUploadRetry';
import { sanitizeUserFacingSyncMessage } from '../../services/SyncService';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');

const COULD_NOT_CONNECT = 'Cloud sync could not connect. Your changes remain saved and will be retried.';

describe('a name with "Network" in it no longer makes a sync failure read as offline (everyday item 6)', () => {
  it('the failure category: by the platform\'s transport failure, never by a name', () => {
    // These read as offline before; none of them is.
    expect(classifySyncFailureText(['Field update for “Fiber Network” could not sync.'])).toBe('unknown');
    expect(classifySyncFailureText(['Project “Network Rail Upgrade” could not sync.'])).toBe('unknown');
    expect(classifySyncFailureText(['Document “Offline Storage Plan” could not sync.'])).toBe('unknown');
    expect(classifySyncFailureText(['Task “Unreachable Roof Access” could not sync.'])).toBe('unknown');
    expect(classifySyncFailureText(['GPS area “Internet Connection Room” could not sync.'])).toBe('unknown');
    // A database error that echoes the row it refused, unquoted.
    expect(classifySyncFailureText([
      'duplicate key value violates unique constraint "projects_owner_name_key" Key (owner_id, name)=(u1, Fiber Network) already exists.',
    ])).toBe('malformed_payload');
    // Nor do other words in a name decide the category ("Authority", "Policy").
    expect(classifySyncFailureText(['Project “Port Authority Terminal” could not sync.'])).toBe('unknown');
    expect(classifySyncFailureText(['Document “Safety Policy” could not sync.'])).toBe('unknown');

    // The platform's own transport failures are still offline, a name beside them or not.
    for (const transport of [
      'TypeError: Network request failed',
      'Failed to fetch',
      'TypeError: Load failed',
      'The Internet connection appears to be offline.',
      'The network connection was lost.',
      'Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."',
      'connect ECONNREFUSED 10.0.0.1:443',
      'getaddrinfo ENOTFOUND example.supabase.co',
      COULD_NOT_CONNECT,
      'Field update for “Fiber Network” could not sync. TypeError: Network request failed',
    ]) {
      expect([transport, classifySyncFailureText([transport])]).toEqual([transport, 'offline']);
    }
    // What the earlier audits pinned still holds.
    expect(classifySyncFailureText(['Field update for “Network Upgrade” could not sync. Cloud sync needs service attention.'])).toBe('database_insert_failed');
    expect(classifySyncFailureText(['new row violates row-level security policy; TypeError: Network request failed'])).toBe('rls_denied');
    expect(classifySyncFailureText(['canceling statement due to statement timeout'])).toBe('unknown');
  });

  it('a thrown error: by its type and code first', () => {
    expect(syncFailureCategoryOfError(new TypeError('Network request failed'))).toBe('offline');
    expect(syncFailureCategoryOfError(Object.assign(new Error('getaddrinfo failed'), { code: 'ENOTFOUND' }))).toBe('offline');
    expect(syncFailureCategoryOfError(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }))).toBe('offline');
    expect(syncFailureCategoryOfError({ message: 'no response', status: 0 })).toBe('offline');
    // A TypeError from the code itself is not the network.
    expect(syncErrorIsTransportFailure(new TypeError("Cannot read properties of undefined (reading 'network')"))).toBe(false);
    expect(syncFailureCategoryOfError(new Error('Project “Network Rail” could not sync.'))).toBe('unknown');
    expect(syncFailureCategoryOfError(undefined)).toBe('unknown');
  });

  it('the sync\'s sentence says "could not connect" only for a connection failure', () => {
    expect(sanitizeUserFacingSyncMessage('Project “Fiber Network” could not sync.')).not.toBe(COULD_NOT_CONNECT);
    expect(sanitizeUserFacingSyncMessage('Task “Fetch Water Line” could not sync.')).not.toBe(COULD_NOT_CONNECT);
    expect(sanitizeUserFacingSyncMessage('TypeError: Network request failed')).toBe(COULD_NOT_CONNECT);
    expect(sanitizeUserFacingSyncMessage('The request timed out.')).toBe(COULD_NOT_CONNECT);
    expect(sanitizeUserFacingSyncMessage('Document “Network diagram” could not sync. Failed to fetch')).toBe(COULD_NOT_CONNECT);
  });

  it('a document named "Network" no longer has its real failures taken for missing signal in the upload backoff', () => {
    expect(projectDocumentUploadAttemptsAfterFailure(3, 'Document “Network diagram.pdf” could not sync.')).toBe(3);
    expect(projectDocumentUploadAttemptsAfterFailure(3, new TypeError('Network request failed'))).toBe(2);
    expect(projectDocumentUploadAttemptsAfterFailure(3, 'Failed to fetch')).toBe(2);
  });

  it('names are what is taken out: quoted names and row echoes, nothing else', () => {
    expect(syncMessageWithoutNames('Field update for “Fiber Network” could not sync. TypeError: Network request failed'))
      .toBe('Field update for “” could not sync. TypeError: Network request failed');
    expect(syncMessageWithoutNames('Failing row contains (1, Network Rail, x).')).toBe('Failing row contains ().');
  });

  it('the App classifies a thrown sync error by its type, and SyncService\'s sentence by the classifier (one call site each)', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
    expect(app.match(/syncFailureCategoryOfError\(error\)/g)).toHaveLength(2);
    expect(app).not.toContain("error instanceof Error ? error.message : 'unknown sync error'");
    const sync = fs.readFileSync(path.resolve(__dirname, '../../services/SyncService.ts'), 'utf8');
    expect(sync).toContain('if (syncMessageReadsAsConnectionFailure(message)) {');
    expect(sync).not.toContain('/network|fetch|offline|timeout|timed out|connection|dns/i.test(message)');
  });
});
