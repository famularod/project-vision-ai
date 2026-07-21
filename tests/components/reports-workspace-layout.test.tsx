import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ReportsWideWorkspace } from '../../components/reports-workspace-layout';

describe('ReportsWideWorkspace', () => {
  it('keeps report preview and the simplified report check visible in separate panes', async () => {
    const screen = await render(
      <ReportsWideWorkspace
        header={<Text>Reports for Project A</Text>}
        report={<Text>Prepared report body</Text>}
        review={<Text>Ready to review</Text>}
      />,
    );

    expect(screen.getByTestId('reports-wide-workspace')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'REPORT PREVIEW' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'REPORT CHECK' })).toBeTruthy();
    expect(screen.getByText('Prepared report body')).toBeTruthy();
    expect(screen.getByText('Ready to review')).toBeTruthy();
  });
});
