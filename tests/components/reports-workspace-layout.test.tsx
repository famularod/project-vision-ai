import { render } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';

import { ReportsWideWorkspace } from '../../components/reports-workspace-layout';

describe('ReportsWideWorkspace', () => {
  it('uses one full-width workspace with the report check before the report preview', async () => {
    const screen = await render(
      <ReportsWideWorkspace
        header={<Text>Reports for Project A</Text>}
        report={<Text>Prepared report body</Text>}
        review={<Text>Ready to review</Text>}
      />,
    );

    expect(screen.getByTestId('reports-wide-workspace')).toBeTruthy();
    expect(screen.getByTestId('reports-wide-scroll')).toBeTruthy();
    expect(screen.getByTestId('reports-wide-review-section')).toBeTruthy();
    expect(screen.getByTestId('reports-wide-preview-section')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'REPORT PREVIEW' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'REPORT CHECK' })).toBeTruthy();
    expect(screen.getByText('Prepared report body')).toBeTruthy();
    expect(screen.getByText('Ready to review')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);
  });
});
