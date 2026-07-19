import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ReportsWideWorkspace } from '../../components/reports-workspace-layout';

describe('ReportsWideWorkspace', () => {
  it('keeps report preview and approval evidence visible in separate panes', async () => {
    const screen = await render(
      <ReportsWideWorkspace
        header={<Text>Reports for Project A</Text>}
        report={<Text>Prepared report body</Text>}
        review={<Text>Approve or correct</Text>}
        evidence={<Text>Supporting evidence</Text>}
      />,
    );

    expect(screen.getByTestId('reports-wide-workspace')).toBeTruthy();
    expect(screen.getByText('REPORT PREVIEW')).toBeTruthy();
    expect(screen.getByText('REVIEW & APPROVAL')).toBeTruthy();
    expect(screen.getByText('Prepared report body')).toBeTruthy();
    expect(screen.getByText('Supporting evidence')).toBeTruthy();
  });
});
