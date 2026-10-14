/**
 * S1e (14 Oct 2026; the final review's F2, caused by S1d): the card text sync records what THIS device typed itself on
 * a card, field by field and when (noteOwnEdit), and gives the details typed since a time (ownEditsSince): what a Make
 * Current under way puts back. A value received from another device is never recorded. And App.tsx's card edit
 * (updateProjectDocument, compiled) records each of his edits through it. The press itself:
 * tests/services/s1e-only-what-this-device-typed-is-put-back.test.ts. Synthetic data.
 */
import { renderHook } from '@testing-library/react-native';
import { useProjectDocumentSharedRecordSync } from '../../hooks/use-project-document-shared-record-sync';
import { legacyProjectNameKey } from '../../services/OperationalProjectIdentity';
import { findSharedReferenceDocumentForProjectDocument, synchronizeSharedReferenceDocumentMetadata } from '../../services/ProjectDocumentLifecycle';
import type { ReferenceDocument } from '../../types';

const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');

const shared = (notes: string, extra: Partial<ReferenceDocument> = {}) => ({
  id: 'rev6', name: 'rev6', originalFileName: 'rev6.pdf', uri: '', storagePath: 'project-documents/alpha/rev6.pdf', category: 'Schedules',
  notes, isCurrent: false, importedAt: '2026-10-14T11:58:00.000Z', projectId: null, projectName: 'Alpha', projectNames: ['Alpha'],
  updatedAt: '2026-10-14T11:59:00.000Z', cloudUpdatedAt: '2026-10-14T11:59:00.000Z', ...extra,
}) as ReferenceDocument;
const T0 = Date.parse('2026-10-14T12:00:00.000Z');

describe('S1e: the card text sync records this device\'s own edits', () => {
  beforeEach(() => { jest.useFakeTimers({ now: T0 }); });
  afterEach(() => { jest.useRealTimers(); });

  it('only the details an edit changed, with its time; the details typed since a time; a later edit replaces', () => {
    const { result } = renderHook(() => useProjectDocumentSharedRecordSync(() => undefined));
    result.current.noteOwnEdit('rev6', shared('Rev 6'), shared('Rev 6 from the GC'));
    expect(result.current.ownEditsSince(T0)).toEqual(new Map([['rev6', { notes: 'Rev 6 from the GC' }]]));
    jest.setSystemTime(T0 + 1000);
    result.current.noteOwnEdit('rev6', shared('Rev 6 from the GC'), shared('Rev 6 from the GC', { name: 'Rev 6 (GC)' }));
    expect(result.current.ownEditsSince(T0 + 1000)).toEqual(new Map([['rev6', { name: 'Rev 6 (GC)' }]]));
    expect(result.current.ownEditsSince(T0)).toEqual(new Map([['rev6', { notes: 'Rev 6 from the GC', name: 'Rev 6 (GC)' }]]));
    expect(result.current.ownEditsSince(T0 + 2000)).toEqual(new Map());
  });

  it('an edit that changes no detail records nothing; after ten minutes an edit is let go', () => {
    const { result } = renderHook(() => useProjectDocumentSharedRecordSync(() => undefined));
    result.current.noteOwnEdit('rev6', shared('Rev 6'), shared('Rev 6', { updatedAt: '2026-10-14T12:00:00.000Z' }));
    expect(result.current.ownEditsSince(0)).toEqual(new Map());
    result.current.noteOwnEdit('rev6', shared('Rev 6'), shared('Rev 6 - Lot 4'));
    jest.setSystemTime(T0 + 11 * 60 * 1000);
    result.current.noteOwnEdit('rev7', shared('a', { id: 'rev7' }), shared('b', { id: 'rev7' }));
    expect([...result.current.ownEditsSince(0).keys()]).toEqual(['rev7']);
  });
});

describe('S1e: App.tsx\'s card edit (updateProjectDocument, compiled) records his edit; a value received is not one', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');
  function componentFunction(name: string): string {
    const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
    if (!match) throw new Error(`App.tsx has no component function ${name}`);
    const open = app.indexOf(' {\n', match.index) + 1;
    let depth = 0;
    for (let index = open; index < app.length; index += 1) {
      if (app[index] === '{') depth += 1;
      if (app[index] === '}') { depth -= 1; if (depth === 0) return app.slice(match.index + 3, index + 1); }
    }
    throw new Error('unbalanced function');
  }

  it('the note typed on the phone\'s card is his own edit; the same note arriving from the iPad is not', () => {
    const { result } = renderHook(() => useProjectDocumentSharedRecordSync(() => undefined));
    const card = { id: 'card-rev6', projectId: legacyProjectNameKey('Alpha'), name: 'rev6.pdf', category: 'Schedule', note: 'Rev 6', referenceDocumentId: 'rev6', storagePath: 'project-documents/alpha/rev6.pdf', importedAt: '2026-10-14T11:58:00.000Z', createdAt: '2026-10-14T11:58:00.000Z', updatedAt: '2026-10-14T11:58:00.000Z', status: 'uploaded' };
    const projectDocumentsCurrentRef = { current: [card] as Array<Record<string, unknown>> };
    const referenceDocumentsCurrentRef = { current: [shared('Rev 6')] };
    const deps: Record<string, unknown> = {
      updateDocumentEverywhere: (id: string, updater: (document: Record<string, unknown>) => Record<string, unknown>) => {
        projectDocumentsCurrentRef.current = projectDocumentsCurrentRef.current.map(document => (document.id === id ? updater(document) : document));
        return projectDocumentsCurrentRef.current.find(document => document.id === id) || null;
      },
      normalizeProjectDocument: (document: unknown) => document, persistProjectDocumentsImmediately: async () => undefined,
      projectDocumentsCurrentRef, reportStoragePersistenceFailure: jest.fn(), PROJECT_DOCUMENTS_STORAGE_KEY: 'projectDocuments',
      findSharedReferenceDocumentForProjectDocument, synchronizeSharedReferenceDocumentMetadata, normalizeReferenceDocument: (document: unknown) => document,
      referenceDocumentsCurrentRef, projectsCurrentRef: { current: ['Alpha'] }, authorityProjectId: legacyProjectNameKey,
      markReferenceDocumentsAuthorityReady: jest.fn(), setReferenceDocuments: jest.fn(),
      projectDocumentSharedRecordSync: result.current,
    };
    const js = ts.transpileModule(`${componentFunction('updateProjectDocument')}\nmodule.exports = updateProjectDocument;`,
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const mod = { exports: {} as unknown as (documentId: string, next: Record<string, unknown>) => void };
    new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));

    // Received from the iPad (the live feed writes the list; the card's edit is not called): nothing recorded.
    referenceDocumentsCurrentRef.current = [shared('iPad: pour moved', { updatedAt: '2026-10-14T12:00:00.500Z', cloudUpdatedAt: '2026-10-14T12:00:00.500Z' })];
    expect(result.current.ownEditsSince(0)).toEqual(new Map());
    // Typed on the phone's card: recorded as his own, with the shared copy's words.
    mod.exports('card-rev6', { note: 'Rev 6 - Lot 4 pour moved to Thursday' });
    expect(referenceDocumentsCurrentRef.current[0].notes).toBe('Rev 6 - Lot 4 pour moved to Thursday');
    expect(result.current.ownEditsSince(0)).toEqual(new Map([['rev6', { notes: 'Rev 6 - Lot 4 pour moved to Thursday' }]]));
  });
});
