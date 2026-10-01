// rule simplified A9 pass 5: when unsure, refuse
import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 6 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. The live edge function does not check
// numbers, so this rule is the only guard; when unsure, refuse (a wrong
// refusal costs a tap). Each finding below is pinned both ways: the phrase the
// review found answered from 2321 is now refused (and Talk moves), and the
// written-as-a-measurement form next to it stays allowed. Synthetic names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[], closed?: readonly string[]) =>
  ecosProjectReferenceMismatchMessage(SELECTED, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[], closed?: readonly string[]) =>
  ecosProjectReferenceMismatchMessage(SELECTED, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string) =>
  `Project 2321 is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string) =>
  `Project 2321 is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const reopenOnPhone = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;
const reopenOnDesktop = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it in the Vitruvius iPhone or iPad app, then select it above and ask again.`;

function expectRefusedOpen(question: string, projects: readonly string[], number: string, project: string) {
  expect(phone(question, projects)).toBe(switchOnPhone(number));
  expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  // Talk moves the question or note to that project.
  expect(mentionedDAVEProject(question, projects)).toBe(project);
}

function expectRefusedClosed(question: string, closed: string, number: string) {
  expect(phone(question, [SELECTED], [closed])).toBe(reopenOnPhone(number));
  expect(desktop(question, [SELECTED], [closed])).toBe(reopenOnDesktop(number));
}

function expectAllowed(question: string, projects: readonly string[], closed?: readonly string[]) {
  expect(phone(question, projects, closed)).toBeNull();
  expect(desktop(question, projects, closed)).toBeNull();
  // Talk keeps it on the selected project.
  expect(mentionedDAVEProject(question, projects)).toBeNull();
}

describe('audit A9 pass 6 M1: "units" and "sheets" are not units of measure', () => {
  it.each([
    'Are the 2375 units framed?',
    'Are the 2375 sheets issued?',
    'Are the 2375 Units framed?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it('a count of units or sheets with an open 3-digit project costs a tap', () => {
    expectRefusedOpen('Are the 200 units delivered?', [SELECTED, '200 Oak Street'], '200', '200 Oak Street');
    expectRefusedOpen('Are the 200 sheets issued?', [SELECTED, '200 Oak Street'], '200', '200 Oak Street');
  });

  it.each([
    'Did the 2375 bags of grout arrive?',
    'Are the 2375 ea anchors here?',
    'Are the 2375 EA anchors here?',
  ])('"%s" keeps bags and ea as counts', question => {
    expectAllowed(question, PROJECTS);
    expectAllowed(question, [SELECTED], [OTHER]);
  });
});

describe('audit A9 pass 6 L1: a spaced capital "A" is amps only before punctuation or the end', () => {
  it.each([
    'What is left in the 2375 A wing?',
    'Is the 2375 A building topped out?',
    'Is 2375 A or B behind?',
    'Is the service 2375 A or 2375 V?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });

  it.each([
    ['Is the panel 200 A?', [SELECTED, '200 Oak Street']],
    ['Is the main 2375 A.', PROJECTS],
    ['Is the main 2375 A, 3 phase?', PROJECTS],
    ['Is the main 2375 A', PROJECTS],
    ['Is the main breaker 2375A?', PROJECTS],
    ['Is the service 208 V or 480 V?', [SELECTED, '208 Pine', '480 Bay']],
    ['Is the service 2375 V or 480 V?', PROJECTS],
  ] as const)('"%s" is amps or volts and is allowed', (question, projects) => {
    expectAllowed(question, projects);
  });
});

describe('audit A9 pass 6 L2: a closing quote after a number is not an inch mark', () => {
  it.each([
    'The super wrote "delivered to 2375" this morning, right?',
    'The super wrote “delivered to 2375” this morning, right?',
    'Did he say "the pour at 2375" went fine?',
    'He said "ok" then wrote "send it to 2375" again?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });

  it.each([
    // No quote is open before the mark: an inch mark.
    'Is the pipe 2375" long?',
    'Is the pipe 2375” long?',
    'Is the 6" pipe 2375" long?',
    'He said "ok" and the pipe is 2375" long?',
    // A feet-inch pair is a measurement even inside a quotation.
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    'He wrote "set the sleeve at 12\' 2375" above grade" today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });
});
