/**
 * @jest-environment node
 */
import {
  REMEMBERED_REPORT_SCOPES,
  recallReportSessionState,
  rememberReportApproval,
  rememberReportEdits,
} from '../../services/ReportSessionState';

// R1 item 9 (8 Oct 2026, the owner's open items). What he typed into a
// report was remembered for only the 12 report scopes used most recently in
// the app session: with a dozen projects, opening each project's report once
// dropped the edits of the first without a word. The number had nothing
// behind it. The store is memory for the app session only, so it is raised
// to 200 and stays bounded. Synthetic data.

const edits = (scope: string) => ({ title: `Report ${scope}`, body: `Edited body of ${scope}`, sourceFingerprint: `facts-${scope}` });
const scope = (index: number) => `r1-item-9-project-${index}|project_manager`;

describe('R1 item 9: report edits are remembered for far more than 12 scopes, and still bounded', () => {
  it('forty scopes edited in one session: the first is still there, with its approval', () => {
    rememberReportEdits(scope(1), edits(scope(1)));
    rememberReportApproval(scope(1), 'approved-text-key', 'facts', null);
    for (let index = 2; index <= 40; index += 1) rememberReportEdits(scope(index), edits(scope(index)));
    expect(recallReportSessionState(scope(1))?.edits?.body).toBe(`Edited body of ${scope(1)}`);
    expect(recallReportSessionState(scope(1))?.approvedTextKey).toBe('approved-text-key');
    expect(recallReportSessionState(scope(13))?.edits?.body).toBe(`Edited body of ${scope(13)}`);
  });

  it('it is bounded: past the limit the scope used longest ago goes, and one used again is kept', () => {
    expect(REMEMBERED_REPORT_SCOPES).toBe(200);
    const bounded = (index: number) => `r1-item-9-bounded-${index}|executive`;
    for (let index = 1; index <= REMEMBERED_REPORT_SCOPES; index += 1) rememberReportEdits(bounded(index), edits(bounded(index)));
    // He comes back to the first one: it is the most recently used again.
    rememberReportEdits(bounded(1), edits(bounded(1)));
    rememberReportEdits(bounded(REMEMBERED_REPORT_SCOPES + 1), edits(bounded(REMEMBERED_REPORT_SCOPES + 1)));
    expect(recallReportSessionState(bounded(1))?.edits).toBeTruthy();
    expect(recallReportSessionState(bounded(2))).toBeNull();
    expect(recallReportSessionState(bounded(3))?.edits).toBeTruthy();
  });
});
