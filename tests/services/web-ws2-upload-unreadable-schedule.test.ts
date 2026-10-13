import {
  DAVE_WEB_UNREADABLE_LOOKAHEAD_TEXT,
  daveWebScheduleUploadRoleSuggestion,
  prepareDAVEWebDocumentUpload,
} from '../../services/DAVEWebOperations';

// Web batch WS2 item 7 (6 Oct 2026): a lookahead whose file this browser
// cannot read tasks from still has to be imported on the phone or iPad. The
// web's review did not say so: the Lookahead choice was just not there.
// Synthetic data.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

const prepare = (fileName: string, mimeType: string, contents: string | null, category = 'Schedules') => prepareDAVEWebDocumentUpload({
  fileName, mimeType, sizeBytes: 900, contents, category, projectName: 'Alpha', projects: ['Alpha'], fingerprint: 'a'.repeat(64),
});
const SAID = 'If it is a lookahead: this file could not be read here. Import it on the phone or iPad.';

describe('a schedule file the browser cannot read tasks from (WS2 item 7)', () => {
  it('a PDF with no readable text: the review says where a lookahead goes', () => {
    const prepared = prepare('Alpha 3 Week Lookahead.pdf', 'application/pdf', null);
    expect(DAVE_WEB_UNREADABLE_LOOKAHEAD_TEXT).toBe(SAID);
    expect(prepared.extractionStatus).toBe('needs_manual_review');
    expect(prepared.reviewMessage).toBe(`The schedule file can be stored now, but this browser could not extract dated activities. Keep it as a prior version, or use a CSV/text schedule so tasks can be reviewed before making it current. ${SAID}`);
  });

  it('a PDF whose text is read but whose task rows are not: the same', () => {
    const prepared = prepare('Alpha lookahead.pdf', 'application/pdf', 'Three week lookahead, printed from the scheduling program');
    expect(prepared.extractionStatus).toBe('needs_manual_review');
    expect(prepared.reviewMessage).toContain('No dated schedule activities were found.');
    expect(prepared.reviewMessage.endsWith(SAID)).toBe(true);
  });

  it('guard: no Lookahead choice is offered for such a file, and a file that is read says nothing of the kind', () => {
    const unreadable = prepare('Alpha 3 Week Lookahead.pdf', 'application/pdf', null);
    expect(daveWebScheduleUploadRoleSuggestion({ snapshot: { scheduleItems: [], referenceDocuments: [] }, prepared: unreadable })).toBeNull();
    const read = prepare('Alpha master.csv', 'text/csv', 'Task,Project,Area,Start,Finish,Percent Complete\nFraming,Alpha,Lot,10/15/2026,10/25/2026,');
    expect(read.extractionStatus).toBe('ready');
    expect(read.reviewMessage).not.toContain('phone or iPad');
    expect(prepare('permit.pdf', 'application/pdf', null, 'Permit Card').reviewMessage).not.toContain('phone or iPad');
  });
});
