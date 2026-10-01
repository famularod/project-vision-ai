import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import { mentionedDAVEProject } from '../../services/DAVEConversationRouter';

// Audit A9 pass 8 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. When unsure, refuse: a wrong refusal
// costs David a tap, a missed one answers from the wrong project. Synthetic
// project names.

const SELECTED = '2321 Compliance Project';
const OTHER = '2375 Compliance Project';
const PROJECTS = [SELECTED, OTHER];

const phone = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'phone' });
const desktop = (question: string, known: readonly string[], closed?: readonly string[], selected = SELECTED) =>
  ecosProjectReferenceMismatchMessage(selected, question, known, { closedProjectNames: closed, refusalWording: 'desktop' });
const switchOnPhone = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Close this, open project ${number}, then ask again.`;
const switchOnDesktop = (number: string, selected = '2321') =>
  `Project ${selected} is selected, but this question names ${number}. Select project ${number} above, then ask again.`;
const reopenOnPhone = (number: string) =>
  `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

function expectRefusedOpen(question: string, projects: readonly string[], number: string, project: string) {
  expect(phone(question, projects)).toBe(switchOnPhone(number));
  expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  // Talk moves the question to that project.
  expect(mentionedDAVEProject(question, projects)).toBe(project);
}

function expectAllowed(question: string, projects: readonly string[], closed?: readonly string[]) {
  expect(phone(question, projects, closed)).toBeNull();
  expect(desktop(question, projects, closed)).toBeNull();
  // Talk keeps it on the selected project.
  expect(mentionedDAVEProject(question, projects, closed)).toBeNull();
}

describe('audit A9 pass 8 L1, L3: a quote mark after a number is a measurement only in a feet-inch pair', () => {
  it.each([
    // L1: the second quotation was misread, so 2375" was taken as inches.
    'Did he write "Gate 5" or "go to 2375" today?',
    // L3: smart and single quotes.
    'He wrote “the 6” pipe at 2375” this morning',
    "He wrote 'the 12' beam at 2375' this morning",
    'He wrote ‘the 12’ beam at 2375’ this morning',
    // A lone mark, straight or curly, is no longer an inch or feet mark.
    'Is the pipe 2375" long?',
    'Is the pipe 2375” long?',
    "Is the run 2375' long?",
    'Is the run 2375’ long?',
    'Is the 6" pipe 2375" long?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expect(phone(question, [SELECTED], [OTHER])).toBe(reopenOnPhone('2375'));
  });

  it.each([
    // An explicit feet-inch pair with both marks, straight, curly or prime.
    "Is the run 2375'-6\" long?",
    "Is the run 2375' 6\" long?",
    "Is the run 2375'6\" long?",
    'Is the run 2375’-6” long?',
    'Is the run 2375’ 6” long?',
    'Is the run 2375′-6″ long?',
    "He wrote 'set the sleeve at 2375'-6\" above grade' today?",
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    // Units written as words still count.
    'Is the run 2375 ft long?',
    'Is the run 2375 feet long?',
    'Is the pipe 2375 in. long?',
    'Is the pipe 2375 inch?',
    'Is the pipe 2375 inches?',
    'Is the run 2375 LF?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
    expectAllowed(question, [SELECTED], [OTHER]);
  });
});
