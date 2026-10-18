import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectRefusal';
import { buildDAVETalkMemoryDraft, mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { resolveDAVEConversationContext } from '../../services/DAVEConversationContext';

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
});
