jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('../../services/SupabaseService', () => ({
  listPIEExecutiveJudgmentsCloud: jest.fn(),
  savePIEExecutiveJudgmentCloud: jest.fn(),
}));

import { collectReportEvidence } from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

function update(
  id: string,
  projectName: string,
  scheduleProjectName: string | null,
  notes: string,
): ProjectUpdate {
  return {
    id,
    projectName,
    date: '2026-09-27T12:00:00.000Z',
    photos: [],
    notes,
    recipients: { contactIds: [] },
    selectedAreaName: 'Canopy C',
    scheduleProjectName,
  };
}

describe('updates logged from a sub-project task', () => {
  // createNewUpdateForScheduleTask saves the update under the sub-project's
  // own name and records the parent in scheduleProjectName. The report
  // picker only offers parents, so the parent's report must carry it.
  it('are carried by the parent project report', () => {
    const input = {
      selectedProjectNames: ['2375 Compliance Project'],
      savedUpdates: [
        update('parent', '2375 Compliance Project', '2375 Compliance Project', 'Ramp is in place.'),
        update('task', 'Canopy C Package', '2375 Compliance Project', 'Footings poured at grid C4.'),
      ],
      scheduleItems: [],
    };

    const evidenceText = JSON.stringify(collectReportEvidence(input));
    expect(evidenceText).toContain('Ramp is in place.');
    expect(evidenceText).toContain('Footings poured at grid C4.');
  });

  it('still leave out updates from other projects', () => {
    const input = {
      selectedProjectNames: ['2375 Compliance Project'],
      savedUpdates: [
        update('other', '2321 Compliance Project', '2321 Compliance Project', 'Other job note.'),
        update('other-task', 'Canopy A Package', '2321 Compliance Project', 'Other job task note.'),
      ],
      scheduleItems: [],
    };

    const evidenceText = JSON.stringify(collectReportEvidence(input));
    expect(evidenceText).not.toContain('Other job note.');
    expect(evidenceText).not.toContain('Other job task note.');
  });
});
