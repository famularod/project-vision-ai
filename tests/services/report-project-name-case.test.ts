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

import {
  buildConstructionUnderstanding,
  collectReportEvidence,
} from '../../services/PIEReporter';
import type { ProjectUpdate } from '../../types';

function update(id: string, projectName: string, areaName: string, notes: string): ProjectUpdate {
  return {
    id,
    projectName,
    date: '2026-08-30T12:00:00.000Z',
    photos: [],
    notes,
    recipients: { contactIds: [] },
    selectedAreaName: areaName,
    scheduleProjectName: projectName,
  };
}

describe('report project name capitalization', () => {
  it('keeps one project group when records differ only in letter case', () => {
    const input = {
      selectedProjectNames: ['2375 Compliance Project'],
      savedUpdates: [
        update('u1', '2375 Compliance Project', 'Canopy C', 'Ramp is in place.'),
        update('u2', '2375 compliance project', '', 'Needs to be flush with the cement.'),
      ],
      scheduleItems: [],
    };
    const understanding = buildConstructionUnderstanding(input, collectReportEvidence(input));
    expect(understanding.locationGroups.map(group => group.title)).toEqual(['2375 Compliance Project']);
    expect(understanding.workAreas.every(area => area.projectName === '2375 Compliance Project')).toBe(true);
  });
});
