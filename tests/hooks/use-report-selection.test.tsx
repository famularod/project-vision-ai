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

  it('opens on the project being worked in, not the first default project', async () => {
    const { result } = await renderHook(() => useReportSelection({
      availableProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      selectedWorkspaceProject: '2375 Compliance Project',
      initialProjectName: '2321 Compliance Project',
    }));

    expect(result.current.selectedProjectNames).toEqual(['2375 Compliance Project']);
  });

  it('follows the workspace project until a project is picked, then keeps that choice', async () => {
    const availableProjectNames = ['2321 Compliance Project', '2375 Compliance Project'];
    const { result, rerender } = await renderHook(
      ({ workspace }: { workspace: string }) => useReportSelection({
        availableProjectNames,
        selectedWorkspaceProject: workspace,
        initialProjectName: '2321 Compliance Project',
      }),
      { initialProps: { workspace: '2321 Compliance Project' } },
    );

    expect(result.current.selectedProjectNames).toEqual(['2321 Compliance Project']);
    rerender({ workspace: '2375 Compliance Project' });
    expect(result.current.selectedProjectNames).toEqual(['2375 Compliance Project']);

    await act(() => result.current.toggleReportProject('2321 Compliance Project'));
    rerender({ workspace: '2375 Compliance Project' });
    expect(result.current.selectedProjectNames).toEqual(['2321 Compliance Project']);
  });

  it('uses the initial project when the workspace project has no report', async () => {
    const { result } = await renderHook(() => useReportSelection({
      availableProjectNames: ['2321 Compliance Project', '2375 Compliance Project'],
      selectedWorkspaceProject: 'Standalone Service Project',
      initialProjectName: '2375 Compliance Project',
    }));

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
