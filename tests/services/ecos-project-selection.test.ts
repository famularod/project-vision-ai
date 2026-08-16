jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/' }));
jest.mock('../../services/SupabaseService', () => ({ createPhotoSignedUrl: jest.fn() }));

import {
  buildECOSProjectSelectionOptions,
  resolveECOSProjectSelection,
} from '../../services/ECOSProjectSelection';
import { mergeProjectRecords } from '../../services/ProjectCoverPhotoService';

const projects = [
  { id: 'project-a', name: 'Shared Name' },
  { id: 'project-b', name: 'Shared Name' },
  { id: 'project-c', name: 'Unique Name' },
];

describe('ECOS immutable project selection', () => {
  it('binds duplicate-name project B only by its exact immutable ID', () => {
    expect(resolveECOSProjectSelection({
      projectId: 'project-b',
      projectName: 'Shared Name',
      projectRecords: projects,
    })).toEqual({ id: 'project-b', name: 'Shared Name' });
    expect(resolveECOSProjectSelection({
      projectId: null,
      projectName: 'Shared Name',
      projectRecords: projects,
    })).toBeNull();
  });

  it('treats a name-only sibling as ambiguity instead of silently ignoring it', () => {
    expect(resolveECOSProjectSelection({
      projectId: null,
      projectName: 'Shared Name',
      projectRecords: [
        { id: 'project-a', name: 'Shared Name' },
        { id: null, name: 'Shared Name' },
      ],
    })).toBeNull();
  });

  it('rejects ID/name rebinding and noncanonical project IDs', () => {
    expect(resolveECOSProjectSelection({
      projectId: 'project-b',
      projectName: 'Unique Name',
      projectRecords: projects,
    })).toBeNull();
    expect(resolveECOSProjectSelection({
      projectId: ' project-b ',
      projectName: 'Shared Name',
      projectRecords: projects,
    })).toBeNull();
    expect(resolveECOSProjectSelection({
      projectId: ' project-c ',
      projectName: 'Unique Name',
      projectRecords: projects,
    })).toBeNull();
  });

  it('disambiguates duplicate names in the explicit project picker', () => {
    expect(buildECOSProjectSelectionOptions({
      projectRecords: projects,
      candidateProjectNames: ['Shared Name', 'Unique Name'],
    })).toEqual([
      { id: 'project-a', name: 'Shared Name', label: 'Shared Name (project-a)' },
      { id: 'project-b', name: 'Shared Name', label: 'Shared Name (project-b)' },
      { id: 'project-c', name: 'Unique Name', label: 'Unique Name' },
    ]);
  });

  it('preserves duplicate-name immutable records through real startup merging before selecting B', () => {
    const merged = mergeProjectRecords([], [], [
      { id: 'project-a', name: 'Shared Name' },
      { id: 'project-b', name: 'Shared Name' },
      { id: null, name: 'Shared Name', data: { staleLegacy: true } },
    ]);

    expect(merged.map(project => project.id)).toEqual(['project-a', 'project-b']);
    expect(resolveECOSProjectSelection({
      projectId: 'project-b',
      projectName: 'Shared Name',
      projectRecords: merged,
    })).toEqual({ id: 'project-b', name: 'Shared Name' });
    expect(resolveECOSProjectSelection({
      projectId: null,
      projectName: 'Shared Name',
      projectRecords: merged,
    })).toBeNull();
  });
});
