import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectArea, ProjectUpdate, ScheduleItem } from '../types';
import { addTaskAreaSuggestion, hasSavedAreaLocation, type AddTaskGpsFix } from '../services/AreaSuggestion';
import { projectAreasForProject } from '../services/DAVEProjectAreaScope';

/**
 * Add Task's Location field (owner answer Q31, 1 Oct 2026). David stood in
 * one area and Add Task filled the project's first area, which read like a
 * suggestion. Location now starts blank. Each time the form opens it takes a
 * new fix, as a new update does, and while Location is not David's own it
 * shows the area that fix places him in for the chosen project
 * (addTaskAreaSuggestion), else blank; changing the project recomputes it
 * from the same fix. What David types, picks or fills is his own and no fix
 * replaces it. A failed fix leaves Location blank and says nothing.
 *
 * Q31 review (1 Oct 2026): the areas are the ones a new update offers for
 * the project (its tasks and its saved updates, L3); no fix is asked for
 * while none of them has a saved GPS point, so a new user with no areas is
 * not asked for location here (L4); and a project change drops his entry
 * when it is an area of the old project and not of the new one (L1).
 */
export function useAddTaskLocation(input: Readonly<{
  visible: boolean;
  projectName: string;
  projectAreas: readonly ProjectArea[];
  /** Every saved task and active saved update: the scope a new update uses (L3). */
  scheduleItems: readonly ScheduleItem[];
  updates?: readonly ProjectUpdate[];
  getLocationFix?: () => Promise<AddTaskGpsFix | null>;
}>) {
  const { visible, projectName, projectAreas, scheduleItems, updates } = input;
  // David's own entry ('' when he cleared or skipped it); null while it is not his.
  const [own, setOwn] = useState<string | null>(null);
  const [fix, setFix] = useState<AddTaskGpsFix | null>(null);
  const getLocationFixRef = useRef(input.getLocationFix);
  getLocationFixRef.current = input.getLocationFix;
  // This opening of the form: still open, and whether it has asked for its fix.
  const openingRef = useRef<{ open: boolean; asked: boolean } | null>(null);

  // A blank project has no areas of its own (every area would be in scope).
  const areasFor = (project: string): ProjectArea[] => project.trim()
    ? projectAreasForProject({ projectAreas, projectName: project, scheduleItems, updates })
    : [];
  const projectAreasInScope = useMemo(
    () => areasFor(projectName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectAreas, projectName, scheduleItems, updates],
  );
  const suggestionPossible = visible && projectAreasInScope.some(hasSavedAreaLocation);

  useEffect(() => {
    setFix(null);
    if (!visible) return;
    const opening = { open: true, asked: false };
    openingRef.current = opening;
    return () => {
      opening.open = false;
    };
  }, [visible]);

  // One new fix per opening, asked for once the chosen project has an area
  // with a saved point (L4); a fix landing after the form closed fills nothing.
  useEffect(() => {
    const opening = openingRef.current;
    const getLocationFix = getLocationFixRef.current;
    if (!suggestionPossible || !opening?.open || opening.asked || !getLocationFix) return;
    opening.asked = true;
    getLocationFix().then(
      next => {
        if (opening.open) setFix(next);
      },
      () => undefined,
    );
  }, [suggestionPossible, visible]);

  const suggestionFor = (project: string): string | null =>
    addTaskAreaSuggestion(fix, project === projectName ? projectAreasInScope : areasFor(project))?.area.name ?? null;
  const suggestion = own === null ? suggestionFor(projectName) : null;
  const isAreaOf = (project: string, name: string) => areasFor(project).some(area => sameName(area.name, name));

  return {
    value: own ?? suggestion ?? '',
    /** Location shows the GPS suggestion: the caption says so. */
    suggested: suggestion !== null,
    /** David typed, picked or filled it. */
    set: (value: string) => setOwn(value),
    suggestionFor,
    /** Not David's own: the GPS suggestion, or blank (a reset, or a fill naming a location the new project does not have). */
    reset: () => setOwn(null),
    /**
     * The project changed (the Project field or a fill naming no location).
     * His entry stays unless it names an area of the old project that is not
     * an area of the new one; that drops back to the GPS suggestion there,
     * else blank (Q31 review L1). Returns what Location then shows.
     */
    changeProject: (from: string, to: string): string => {
      const keep = own === null || !isAreaOf(from, own) || isAreaOf(to, own);
      if (!keep) setOwn(null);
      return (keep ? own : null) ?? suggestionFor(to) ?? '';
    },
  };
}

function sameName(a: string, b: string) {
  const normal = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return normal(a) === normal(b);
}
