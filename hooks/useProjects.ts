import { useMemo } from 'react';
import type { ProjectStats } from '../types';
import { EMPTY_PROJECT_STATS } from '../types';

export function useProjects({
  activeProjects,
  archivedProjects,
  projectStatsByName,
}: {
  activeProjects: string[];
  archivedProjects: string[];
  projectStatsByName: Record<string, ProjectStats>;
}) {
  return useMemo(
    () => ({
      activeProjects,
      archivedProjects,
      projectStatsByName,
      statsForProject: (projectName: string) =>
        projectStatsByName[projectName] || EMPTY_PROJECT_STATS,
    }),
    [activeProjects, archivedProjects, projectStatsByName],
  );
}
