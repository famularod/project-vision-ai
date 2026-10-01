import { useEffect, useRef, useState } from 'react';

import type { ProjectArea, ScheduleItem } from '../types';
import { addTaskAreaSuggestion, type AddTaskGpsFix } from '../services/AreaSuggestion';
import { projectAreasForProject } from '../services/DAVEProjectAreaScope';

/**
 * Add Task's Location field (owner answer Q31, 1 Oct 2026). David stood in
 * one area and Add Task filled the project's first area, which read like a
 * suggestion. Location now starts blank. Each time the form opens it asks
 * for a fix (the app's recent fix while fresh, else a new one taken as a new
 * update takes it), and while Location is not David's own it shows the area
 * that fix places him in for the chosen project (addTaskAreaSuggestion),
 * else blank; changing the project recomputes it from the same fix. What
 * David types, picks or fills is his own and no fix or project change
 * replaces it. A failed fix leaves Location blank and says nothing.
 */
export function useAddTaskLocation(input: Readonly<{
  visible: boolean;
  projectName: string;
  projectAreas: readonly ProjectArea[];
  scheduleItems: readonly ScheduleItem[];
  getLocationFix?: () => Promise<AddTaskGpsFix | null>;
}>) {
  const { visible, projectName, projectAreas, scheduleItems } = input;
  // David's own entry ('' when he cleared or skipped it); null while it is not his.
  const [own, setOwn] = useState<string | null>(null);
  const [fix, setFix] = useState<AddTaskGpsFix | null>(null);
  const getLocationFixRef = useRef(input.getLocationFix);
  getLocationFixRef.current = input.getLocationFix;

  useEffect(() => {
    setFix(null);
    const getLocationFix = getLocationFixRef.current;
    if (!visible || !getLocationFix) return;
    let open = true;
    getLocationFix().then(
      next => {
        if (open) setFix(next);
      },
      () => undefined,
    );
    return () => {
      open = false;
    };
  }, [visible]);

  // A blank project has no areas of its own (every area would be in scope).
  const suggestionFor = (project: string): string | null => project.trim()
    ? addTaskAreaSuggestion(fix, projectAreasForProject({ projectAreas, projectName: project, scheduleItems }))?.area.name ?? null
    : null;
  const suggestion = own === null ? suggestionFor(projectName) : null;

  return {
    value: own ?? suggestion ?? '',
    /** Location shows the GPS suggestion: the caption says so. */
    suggested: suggestion !== null,
    /** David typed, picked or filled it. */
    set: (value: string) => setOwn(value),
    suggestionFor,
    /** Not David's own: the GPS suggestion, or blank (a reset, or a fill that changed the project naming none of its areas). */
    reset: () => setOwn(null),
  };
}
