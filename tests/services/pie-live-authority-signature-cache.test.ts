import { authorityInputSignature } from '../../services/PIELiveAuthoritySignature';

describe('live authority signature collection cache', () => {
  test('draft typing does not traverse unchanged historical evidence again', () => {
    let historicalEvidenceReads = 0;
    const update = {
      id: 'update-1',
      projectName: '2375 Compliance Project',
      date: '2026-07-22T12:00:00.000Z',
      photos: [],
      recipients: { contactIds: [] },
      get notes() {
        historicalEvidenceReads += 1;
        return 'Verified field observation.';
      },
    };
    const updates = [update];
    const base = {
      projectName: '2375 Compliance Project',
      projectNames: ['2375 Compliance Project'],
      updates,
      scheduleItems: [],
      currentUpdate: {
        id: 'draft-1',
        projectName: '2375 Compliance Project',
        date: '2026-07-22T12:01:00.000Z',
        notes: 'A',
        photos: [],
        recipients: { contactIds: [] },
      },
    };

    const first = authorityInputSignature(base);
    const readsAfterFirstSignature = historicalEvidenceReads;
    const second = authorityInputSignature({
      ...base,
      currentUpdate: {
        ...base.currentUpdate,
        notes: 'AB',
      },
    });

    expect(second).not.toBe(first);
    expect(historicalEvidenceReads).toBe(readsAfterFirstSignature);
  });
});
