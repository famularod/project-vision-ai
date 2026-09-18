import { fireEvent, render } from '@testing-library/react-native';
import { BeforeYouSharePanel } from '../../screens/ReportsScreen';
import { evaluateReportApprovalPolicy } from '../../services/ReportApprovalPolicy';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const draft = { needsReview: false, reviewFlags: [] } as never;
const noCommitments = { items: [], actionableItems: [] } as never;

function panel(policy: ReturnType<typeof evaluateReportApprovalPolicy>, onAcknowledge = jest.fn()) {
  return render(
    <BeforeYouSharePanel
      reportDraft={draft}
      commitmentControl={noCommitments}
      reportApproved={false}
      reportApprovalAllowed={policy.allowed}
      approvalPolicy={policy}
      onAcknowledgeReviewItems={onAcknowledge}
    />,
  );
}

describe('Report Check panel', () => {
  it('owner-reported case: shows the real reason, not "loading", and lets the reviewer continue', () => {
    const onAcknowledge = jest.fn();
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: false, reviewFlags: [] },
      reportGenerationAllowed: false,
      authorityState: 'conflict_blocked',
    });
    const screen = panel(policy, onAcknowledge);
    expect(screen.getByText('Needs Your Review')).toBeTruthy();
    expect(screen.queryByText(/still loading/i)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: /^Mark reviewed:/ }));
    expect(onAcknowledge).toHaveBeenCalledWith(['authority:conflict_blocked']);
  });

  it('offers one action to review several items', () => {
    const onAcknowledge = jest.fn();
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: ['Some source evidence has low confidence.', 'One action needs verification.'] },
      reportGenerationAllowed: true,
      authorityState: 'ready',
    });
    const screen = panel(policy, onAcknowledge);
    fireEvent.press(screen.getByRole('button', { name: 'I reviewed all 2 items' }));
    expect(onAcknowledge).toHaveBeenCalledWith(policy.pendingAdvisoryIds);
  });

  it('says loading only while data is loading and offers nothing to acknowledge', () => {
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: false, reviewFlags: [] }, reportGenerationAllowed: false, authorityState: 'loading',
    });
    const screen = panel(policy);
    expect(screen.getByText('Loading Project Data')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a no-evidence report shows a fix instruction and no review button', () => {
    const policy = evaluateReportApprovalPolicy({
      report: { needsReview: true, reviewFlags: ['No supporting evidence was found for this period.'] },
      reportGenerationAllowed: true, authorityState: 'ready',
    });
    const screen = panel(policy);
    expect(screen.getByText('Needs Changes')).toBeTruthy();
    expect(screen.getByText(/Add a current project update before sharing/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
