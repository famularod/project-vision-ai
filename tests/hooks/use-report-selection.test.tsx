import { act, renderHook } from '@testing-library/react-native';

import {
  resolveReportProjectSelection,
  useReportSelection,
} from '../../hooks/use-report-selection';

describe('report selection domain', () => {
  it('falls back to an available workspace project and removes stale selections', () => {
    expect(resolveReportProjectSelection({
      availableProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      selectedProjectNames: ['Archived Project'],
      selectedWorkspaceProject: '2375 Compliance Project',
      reportType: 'combined_project_update',
    })).toEqual(['2375 Compliance Project']);
  });

  it('supports multi-project reports but retains at least one project', async () => {
    const { result } = await renderHook(() => useReportSelection({
      availableProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      selectedWorkspaceProject: '2321 Compliance Project',
      initialProjectName: '2321 Compliance Project',
    }));

    await act(() => result.current.changeReportType('combined_project_update'));
    await act(() => result.current.toggleReportProject('2375 Compliance Project'));
    expect(result.current.selectedProjectNames).toEqual([
      '2321 Compliance Project',
      '2375 Compliance Project',
    ]);

    await act(() => result.current.toggleReportProject('2321 Compliance Project'));
    await act(() => result.current.toggleReportProject('2375 Compliance Project'));
    expect(result.current.selectedProjectNames).toEqual(['2375 Compliance Project']);
  });

  it('limits daily reports to one selected project', async () => {
    const { result } = await renderHook(() => useReportSelection({
      availableProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      selectedWorkspaceProject: '2321 Compliance Project',
      initialProjectName: '2321 Compliance Project',
    }));

    await act(() => result.current.toggleReportProject('2375 Compliance Project'));
    expect(result.current.selectedProjectNames).toEqual(['2375 Compliance Project']);
  });
});
