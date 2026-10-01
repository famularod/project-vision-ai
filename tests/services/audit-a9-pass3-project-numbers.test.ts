import { findECOSProjectReferenceMismatch } from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 3 L2 (30 Sep 2026): Ask ECOS knew fewer units and reference
// words than Talk, and neither knew phone numbers, so with 2375 another project
// "555-2375", "$2375 invoice", "2375 mm", "RFI 2375", "unit 2375" or "2375 Main
// Street" were refused, and with "450 Harrison" a project, "450 kcmil" was too.
// Talk and Ask ECOS now share one number rule. Synthetic project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];
const THREE_DIGIT_PROJECTS = [...PROJECTS, '450 Harrison', '200 Oak Street', '208 Pine', '120 Elm', '100 Main Street'];

const NOT_PROJECT_2375 = [
  'Call the super at 555-2375 about the pour.',
  'Was the $2375 invoice for the rebar paid?',
  'Is the new slab 2375 mm thick?',
  'Is the main service a 2375 amp service?',
  'Which finish goes in rooms 2375 and 2376?',
  'What did RFI 2375 say about the embeds?',
  'Is the kitchen in unit 2375 finished?',
  'Was submittal 2375 approved?',
  'What does keynote 2375 call for?',
  'Who is moving into suite 2375?',
  'What is on sheet 2375?',
  'Which wall type is detail 2375?',
  'When is the delivery to 2375 Main Street?',
];
const NOT_A_THREE_DIGIT_PROJECT = [
  'Are the 450 kcmil feeders pulled?',
  'Is the new panel 200 amp?',
  'Is the service 208 V?',
  'Are the 120 volt circuits tested?',
  'Did we pour 100 cubic yards today?',
];
const NAMES_PROJECT_2375 = [
  'What was the slab thickness at 2375?',
  'Is the rebar for 2375 on site?',
  'What is overdue on 2375 Compliance?',
  'What is overdue on project 2375?',
  'What is overdue on job 2375?',
];

describe('audit A9 pass 3 L2: one number rule for Talk and Ask ECOS', () => {
  it.each(NOT_PROJECT_2375)('Ask ECOS asks "%s" for 2321 and Talk keeps the note on 2321', question => {
    expect(findECOSProjectReferenceMismatch(SELECTED, question, PROJECTS)).toBeNull();
    expect(mentionedDAVEProject(question, PROJECTS)).toBeNull();
  });

  it.each(NOT_A_THREE_DIGIT_PROJECT)('"%s" is not a 3-digit project on either side', question => {
    expect(findECOSProjectReferenceMismatch(SELECTED, question, THREE_DIGIT_PROJECTS)).toBeNull();
    expect(mentionedDAVEProject(question, THREE_DIGIT_PROJECTS)).toBeNull();
  });

  it.each(NAMES_PROJECT_2375)('"%s" still names 2375 on both sides', question => {
    expect(findECOSProjectReferenceMismatch(SELECTED, question, PROJECTS)?.referencedProjectIdentifier).toBe('2375');
    expect(mentionedDAVEProject(question, PROJECTS)).toBe(OTHER);
  });

  it('a street address that is itself the other project still names it', () => {
    const projects = [SELECTED, '1105 Oak Street'];
    expect(findECOSProjectReferenceMismatch(SELECTED, 'What is left at 1105 Oak Street?', projects)?.referencedProjectIdentifier)
      .toBe('1105');
    expect(ecosProjectNumberMentions('Deliver to 1105 Oak Street', projects)).toEqual(['1105']);
    expect(ecosProjectNumberMentions('Deliver to 1105 Oak Street', PROJECTS)).toEqual([]);
  });

  it('an ordinary lower-case phrase after the number is not read as a street', () => {
    expect(ecosProjectNumberMentions('Is the slab at 2375 by the service road done?')).toEqual(['2375']);
    expect(ecosProjectNumberMentions('When did the pour at 2375 take place?')).toEqual(['2375']);
  });

  it('Talk reads the measurement and the bare number in one note separately', () => {
    expect(ecosProjectNumberMentions('Is 2375 psi used at 2375 as well?')).toEqual(['2375']);
    expect(mentionedDAVEProject('Ordered 2375 feet of conduit for 2375', PROJECTS)).toBe(OTHER);
  });
});
