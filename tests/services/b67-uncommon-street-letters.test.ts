import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { buildDAVETalkMemoryDraft, mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';
import { askECOSProjectQuestion } from '../../services/ECOSProjectQuestion';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ecosQuestionMayNameAProject, findECOSProjectReferenceMismatch } from '../../supabase/functions/_shared/ecos-project-reference';
import { ECOS_PROJECT_REFERENCE_VECTORS } from '../../supabase/functions/_shared/ecos-project-reference-test-vectors';

const selected = '2321 Compliance Project';
const elm = '450 Elm St';

describe('whole 4.36: uncommon suffixes disambiguate the letter in a known project name', () => {
  it.each(['Mews', 'Close', 'Gardens', 'Landing', 'Burgs', 'Junctions', 'Stravenue', 'Throughway', 'Viaduct', 'Lndng', 'Strvnue', 'Vdct'])(
    '%s follows the same Ask and Talk routes as a capital street letter', suffix => {
      const name = `24117 - 450 a ${suffix}`;
      const projects = [selected, elm, name];
      const question = 'What is left at 450 A?';
      for (const wording of ['phone', 'desktop'] as const) {
        const expected = wording === 'phone'
          ? `Project 450 is selected, but this question names 450 (${name}). Close this, open project 450 (${name}), then ask again.`
          : `Project 450 is selected, but this question names 450 (${name}). Select project 450 (${name}) above, then ask again.`;
        expect(ecosProjectReferenceMismatchMessage(elm, question, projects, { refusalWording: wording })).toBe(expected);
        expect(ecosProjectReferenceMismatchMessage(name, question, projects, { refusalWording: wording })).toBeNull();
      }
      expect(mentionedDAVEProject(question, projects)).toBe(name);
      const context = resolveDAVEConversationContext({ transcript: question, history: [], projectId: 'synthetic', projectName: elm, projectNames: projects });
      expect(context.status).toBe('ambiguous_follow_up');
      const note = 'Crew finished framing at 450 A today';
      const draft = buildDAVETalkMemoryDraft({ id: 'synthetic', createdAt: '2026-10-17T12:00:00.000Z', projectName: elm, switchedProject: false, projectNames: [selected, elm], closedProjectNames: [name], transcript: note, fields: { generalMemory: note } });
      expect(draft.recommendedProject.confirmed).toBe(false);
      expect(ecosProjectReferenceMismatchMessage(elm, 'Is 450 a priority this week?', projects)).toBeNull();
    },
  );

  it.each(['Mews', 'Close', 'Gardens', 'Landing'])('the %s mismatch stops the actual request before authentication or invocation', async suffix => {
    const getSession = jest.fn();
    const invoke = jest.fn();
    const client = { auth: { getSession }, functions: { invoke } } as unknown as SupabaseClient;
    const name = `24117 - 450 a ${suffix}`;
    await expect(askECOSProjectQuestion({ client, projectId: 'synthetic', projectName: elm, question: 'What is left at 450 A?', knownProjectNames: [elm, name] }))
      .rejects.toMatchObject({ code: 'project_reference_mismatch' });
    expect(getSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['new roof', 'priority upgrade', 'Closely managed job', 'Mewsland', 'Landingzone', 'Gardenscape', 'Straße', 'Rua', 'Chemin'])(
    '%s does not trigger suffix inference', rest => {
      const name = `24117 - 450 a ${rest}`;
      expect(ecosProjectReferenceMismatchMessage(elm, 'What is left at 450 A?', [elm, name])).toBeNull();
    },
  );

  it('adding suffix spellings does not equate their short forms in questions', () => {
    const landing = '24117 - 450 a Landing';
    const lndg = '23088 - 450 a Lndg';
    expect(mentionedDAVEProject('Open 450 a Landing', [landing, lndg])).toBe(landing);
    expect(mentionedDAVEProject('Open 450 a Lndg', [landing, lndg])).toBe(lndg);
  });

  // Same pure shared-module contract as Deno; no JSR resolution or server access.
  it('every app/edge shared vector retains its complete refusal contract offline', () => {
    for (const vector of ECOS_PROJECT_REFERENCE_VECTORS) {
      const mismatch = findECOSProjectReferenceMismatch(vector.projectName, vector.question, vector.knownProjectNames, vector.closedProjectNames);
      expect([vector.name, mismatch?.referencedProjectIdentifier ?? null]).toEqual([vector.name, vector.refused]);
      if (vector.refused) {
        expect(mismatch?.referencedProjectClosed).toBe(vector.refusedClosed ?? false);
        expect(mismatch?.selectedProjectIdentifier).toBe(vector.refusedSelected ?? '2321');
        expect(mismatch?.namedProjects).toEqual(vector.refusedTogether);
        expect(ecosQuestionMayNameAProject(vector.question)).toBe(true);
      }
    }
  });
});
