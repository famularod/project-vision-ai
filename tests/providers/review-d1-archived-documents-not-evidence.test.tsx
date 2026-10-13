/**
 * Review of D1 (independent review P5, pass 1), L10: Project Truth and the
 * report draft counted an archived shared document among the "related
 * documents" (owner answer Q44: archived = hidden on every device). The
 * provider is where the app's evidence enters both; an archived document is
 * left out there. With nothing archived the supplied list goes through
 * untouched, so nothing built from it is built again.
 */
import { act, render } from '@testing-library/react-native';
import { InteractionManager, Text } from 'react-native';

import { PIELiveAuthorityProvider, type PIELiveAuthorityInput } from '../../providers/PIELiveAuthorityProvider';
import { buildLivePIECoreIntelligence } from '../../services/PIECoreIntelligence';
import { buildRuntime } from '../../services/PIERuntime';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import { createDAVEProjectTruthRepository } from '../../services/DAVEProjectTruthRepository';
import { noteSharedDocumentArchiveLiveRow, openSharedDocumentArchive, sharedDocumentArchiveSettled } from '../../services/SharedDocumentArchive';
import type { ReferenceDocument } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../services/PIECoreIntelligence', () => ({ buildLivePIECoreIntelligence: jest.fn() }));
jest.mock('../../services/PIERuntime', () => ({
  buildRuntime: jest.fn(() => ({ generatedAt: '2026-10-06T12:00:00.000Z', response: {} })),
}));
jest.mock('../../services/DAVEProjectTruth', () => ({
  daveProjectTruthUpdatesFor: jest.fn((input: { updates: unknown[] }) => input.updates),
  buildDAVEProjectTruth: jest.fn((input: { projectId: string; projectName: string }) => ({ projectId: input.projectId, projectName: input.projectName })),
}));
jest.mock('../../services/DAVEProjectTruthRepository', () => ({ createDAVEProjectTruthRepository: jest.fn() }));
jest.mock('../../services/StartupDiagnostics', () => ({ logStartupDiagnostic: jest.fn(), startupErrorMessage: (error: unknown) => String(error) }));
jest.mock('../../services/PIEPhotoProgressIntelligenceStorage', () => ({ savePhotoProgressIntelligence: jest.fn(async () => undefined) }));

const buildCoreMock = buildLivePIECoreIntelligence as jest.MockedFunction<typeof buildLivePIECoreIntelligence>;
const buildRuntimeMock = buildRuntime as jest.MockedFunction<typeof buildRuntime>;
const buildTruthMock = buildDAVEProjectTruth as jest.MockedFunction<typeof buildDAVEProjectTruth>;
const createRepositoryMock = createDAVEProjectTruthRepository as jest.MockedFunction<typeof createDAVEProjectTruthRepository>;

const shared = (id: string, category: string): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.pdf`, uri: '', category, notes: '', isCurrent: false, importedAt: '2026-10-01T10:00:00.000Z',
  projectId: 'project-1', projectName: 'Project One', projectNames: ['Project One'], importBatchId: null,
}) as ReferenceDocument;
const DOCUMENTS = [shared('drawing-a101', 'Drawings'), shared('permit', 'Permit Card')];
const INPUT: PIELiveAuthorityInput = {
  hydrated: true, organizationId: 'organization-1', projectId: 'project-1', projectName: 'Project One', projectNames: ['Project One'],
  updates: [], scheduleItems: [], projectAreas: [], referenceDocuments: DOCUMENTS, projectDocuments: [], captureMemories: [],
  currentUpdate: null, identityTrusted: true, cloudAvailable: false, asOfDay: '2026-10-06',
};
const flush = () => act(async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await sharedDocumentArchiveSettled();
});
const lastRuntimeDocuments = () => (buildRuntimeMock.mock.calls[buildRuntimeMock.mock.calls.length - 1][0] as { referenceDocuments: ReferenceDocument[] }).referenceDocuments;
const lastTruthDocuments = () => (buildTruthMock.mock.calls[buildTruthMock.mock.calls.length - 1][0] as { referenceDocuments: ReferenceDocument[] }).referenceDocuments;

describe('review of D1, L10: an archived shared document is not evidence for Project Truth or the report draft', () => {
  let owners = 0;
  let owner = 'owner-0';
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(callback => {
      if (typeof callback === 'function') callback();
      return { cancel: jest.fn() } as never;
    });
    buildCoreMock.mockReset();
    buildCoreMock.mockImplementation(async coreInput => ({
      runtime: coreInput?.runtime, authorityRuntime: coreInput?.runtime,
      realityAuthority: { modelId: 'project-1', persistenceStatus: 'authoritative_local' },
      realityModel: { organizationId: 'organization-1', projectId: 'project-1', evidenceConflicts: [], activeUncertainties: [] },
    }) as never);
    buildRuntimeMock.mockClear();
    buildTruthMock.mockClear();
    createRepositoryMock.mockReset();
    createRepositoryMock.mockReturnValue({ save: jest.fn(async () => ({ snapshot: { revision: 1 }, created: false, cloudStatus: 'local_only' })) } as never);
    owners += 1;
    owner = `owner-${owners}`;
    await openSharedDocumentArchive(owner);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('with nothing archived the supplied list itself is what both are built from', async () => {
    const tree = render(<PIELiveAuthorityProvider input={INPUT}><Text>probe</Text></PIELiveAuthorityProvider>);
    await flush();
    expect(lastRuntimeDocuments()).toBe(DOCUMENTS);
    expect(lastTruthDocuments()).toBe(DOCUMENTS);
    tree.unmount();
  });

  it('archived on another device while the app is open: left out of both from then on; restored: counted again, from the supplied list itself', async () => {
    const tree = render(<PIELiveAuthorityProvider input={INPUT}><Text>probe</Text></PIELiveAuthorityProvider>);
    await flush();
    await act(async () => {
      await noteSharedDocumentArchiveLiveRow({ ownerId: owner, eventType: 'UPDATE', newRow: { id: 'permit', owner_id: owner, archived_at: '2026-10-06T10:00:00.000Z' }, oldRow: null });
    });
    await flush();
    await act(async () => { jest.advanceTimersByTime(1000); });
    await flush();
    expect(lastRuntimeDocuments().map(document => document.id)).toEqual(['drawing-a101']);
    expect(lastTruthDocuments().map(document => document.id)).toEqual(['drawing-a101']);

    await act(async () => {
      await noteSharedDocumentArchiveLiveRow({ ownerId: owner, eventType: 'UPDATE', newRow: { id: 'permit', owner_id: owner, archived_at: null }, oldRow: null });
    });
    await flush();
    await act(async () => { jest.advanceTimersByTime(1000); });
    await flush();
    // (The runtime of the full list was built at the start and is kept: only Project Truth is built again.)
    expect(lastTruthDocuments()).toBe(DOCUMENTS);
    tree.unmount();
  });
});
