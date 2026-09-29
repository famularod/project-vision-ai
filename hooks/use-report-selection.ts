import { useCallback, useMemo, useState } from 'react';

import type { PIEReportType } from '../services/domains/reporting';

export type SelectableReportType = Extract<
  PIEReportType,
  'daily_project_update' | 'combined_project_update'
>;
export type ReportFormat = 'project_manager' | 'executive';

function normalizedProjectKey(name: string) {
  return name.trim().toLowerCase();
}

export function uniqueProjectNames(names: string[]) {
  return names.reduce<string[]>((result, candidate) => {
    const name = candidate.trim();
    if (!name) return result;
    if (result.some(existing => normalizedProjectKey(existing) === normalizedProjectKey(name))) {
      return result;
    }
    return [...result, name];
  }, []);
}

export function resolveReportProjectSelection({
  availableProjectNames,
  selectedProjectNames,
  selectedWorkspaceProject,
  reportType,
  initialProjectName = '',
}: {
  availableProjectNames: string[];
  selectedProjectNames: string[];
  selectedWorkspaceProject: string;
  reportType: SelectableReportType;
  initialProjectName?: string;
}) {
  const availableKeys = new Set(availableProjectNames.map(normalizedProjectKey));
  const validSelections = uniqueProjectNames(
    selectedProjectNames.filter(name => availableKeys.has(normalizedProjectKey(name))),
  );
  const availableMatch = (candidate: string) => availableProjectNames.find(
    name => normalizedProjectKey(name) === normalizedProjectKey(candidate),
  );
  const fallback = availableMatch(selectedWorkspaceProject) ||
    (initialProjectName.trim() ? availableMatch(initialProjectName) : undefined) ||
    availableProjectNames[0] || selectedWorkspaceProject;
  const selections = validSelections.length > 0 ? validSelections : [fallback];

  return reportType === 'daily_project_update'
    ? selections.slice(0, 1)
    : selections;
}

export function useReportSelection({
  availableProjectNames,
  selectedWorkspaceProject,
  initialProjectName,
}: {
  availableProjectNames: string[];
  selectedWorkspaceProject: string;
  initialProjectName: string;
}) {
  const [reportType, setReportType] = useState<SelectableReportType>(
    'daily_project_update',
  );
  const [reportFormat, setReportFormat] = useState<ReportFormat>('project_manager');
  // Null until projects are picked on the Reports screen. Until then the report
  // follows the project being worked in, so opening Reports from one project
  // never shows another project's report. A picked project list is kept.
  const [selectedProjectNames, setSelectedProjectNames] = useState<string[] | null>(null);
  const resolvedProjectNames = useMemo(
    () => resolveReportProjectSelection({
      availableProjectNames,
      selectedProjectNames: selectedProjectNames || [],
      selectedWorkspaceProject,
      reportType,
      initialProjectName,
    }),
    [availableProjectNames, initialProjectName, reportType, selectedProjectNames, selectedWorkspaceProject],
  );

  const changeReportType = useCallback((nextType: SelectableReportType) => {
    setReportType(nextType);
    setSelectedProjectNames(current => {
      if (current === null) return null;
      return nextType === 'daily_project_update'
        ? resolvedProjectNames.slice(0, 1)
        : resolvedProjectNames;
    });
  }, [resolvedProjectNames]);

  const toggleReportProject = useCallback((projectName: string) => {
    if (reportType === 'daily_project_update') {
      setSelectedProjectNames([projectName]);
      return;
    }

    const projectKey = normalizedProjectKey(projectName);
    const selected = resolvedProjectNames.some(
      name => normalizedProjectKey(name) === projectKey,
    );
    if (selected) {
      const remaining = resolvedProjectNames.filter(
        name => normalizedProjectKey(name) !== projectKey,
      );
      setSelectedProjectNames(remaining.length > 0 ? remaining : resolvedProjectNames);
      return;
    }
    setSelectedProjectNames(uniqueProjectNames([...resolvedProjectNames, projectName]));
  }, [reportType, resolvedProjectNames]);

  return {
    reportType,
    reportFormat,
    selectedProjectNames: resolvedProjectNames,
    setReportFormat,
    changeReportType,
    toggleReportProject,
  };
}
