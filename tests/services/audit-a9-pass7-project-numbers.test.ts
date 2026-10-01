// rule simplified A9 pass 5: when unsure, refuse
import { ecosProjectReferenceMismatchMessage } from '../../services/ECOSProjectQuestion';
import {
  answerDAVEConversationContext,
  askECOSQuestionForTalk,
  resolveDAVEConversationContext,
} from '../../services/DAVEConversationContext';
import {
  buildDAVETalkMemoryDraft,
  mentionedDAVEProject,
  routeDAVEConversation,
} from '../../services/DAVEConversationRouter';
import { buildProjectIntelligence } from '../../services/DAVEIntelligence';
import { createTalkSession } from '../../hooks/use-talk-session';
import { ecosProjectNumberMentions } from '../../supabase/functions/_shared/ecos-project-reference';

// Audit A9 pass 7 (30 Sep 2026): owner answer Q20 refuses a question that
// names another known project's number (open or closed, not deleted) and
// never the selected project's own. The live edge function does not check
// numbers, so this rule is the only guard; when unsure, refuse (a wrong
// refusal costs a tap). Each finding is pinned both ways: the phrase the
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

describe('audit A9 pass 7 L1: "meters", "metres" and "pieces" are not units of measure', () => {
  it.each([
    'Are the 2375 meters set?',
    'Are the 2375 metres set?',
    'Are the 2375 pieces delivered?',
    'Are the 2375 Meters set?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it('a run in meters or a count of pieces with a 3-digit project costs a tap', () => {
    expectRefusedOpen('Is the run 300 meters?', [SELECTED, '300 Bay'], '300', '300 Bay');
    expectRefusedClosed('Did the 200 pieces of rebar arrive?', '200 Oak Street', '200');
  });

  it.each([
    ['Is the run 300 m?', '300 Bay'],
    ['Is the run 300m?', '300 Bay'],
    ['Did the 200 pcs of rebar arrive?', '200 Oak Street'],
    ['Did the 200 PCS of rebar arrive?', '200 Oak Street'],
  ])('"%s" keeps m and pcs as measurements with "%s" open or closed', (question, project) => {
    expectAllowed(question, [SELECTED, project]);
    expectAllowed(question, [SELECTED], [project]);
  });
});

describe('audit A9 pass 7 L2: a comma-grouped number that is no project is checked part by part', () => {
  const OAK = '200 Oak Street';
  const MAIN = '375 Main Street';
  const SHOP = '101 Shop';
  const YARD = '205 Yard';

  it.each([
    ['Compare 200,375', [SELECTED, OAK, MAIN], '200'],
    ['Compare 200,375?', [SELECTED, OAK, MAIN], '200'],
    ['Punch list for 101,205?', [SELECTED, SHOP, YARD], '101'],
    ['Compare 2321,375', [SELECTED, MAIN], '375'],
    ['Compare 200,375,450', [SELECTED, '450 Bay'], '450'],
  ] as const)('"%s" is refused', (question, projects, number) => {
    expect(phone(question, projects)).toBe(switchOnPhone(number));
    expect(desktop(question, projects)).toBe(switchOnDesktop(number));
  });

  it('a closed project in a comma-grouped list is refused in the closed wording', () => {
    expect(phone('Punch list for 101,205?', [SELECTED], [SHOP, YARD])).toBe(reopenOnPhone('101'));
    expect(desktop('Punch list for 101,205?', [SELECTED], [YARD])).toBe(reopenOnDesktop('205'));
  });

  it('Talk reads each part: one project moves, two do not', () => {
    expect(mentionedDAVEProject('Punch list for 101,205?', [SELECTED, YARD])).toBe(YARD);
    expect(mentionedDAVEProject('Compare 200,375', [SELECTED, OAK, MAIN])).toBeNull();
  });

  it('a grouped number that is itself a known project is read whole, not split', () => {
    expect(ecosProjectNumberMentions('What is overdue on project 2,375?', [...PROJECTS, MAIN])).toEqual(['2375']);
    expect(phone('What is overdue on project 2,375?', [...PROJECTS, MAIN])).toBe(switchOnPhone('2375'));
    // The selected project's own number is never refused, nor split into 321.
    expect(phone('What is overdue on project 2,321?', [SELECTED, '321 Pine'])).toBeNull();
    expect(desktop('What is overdue on project 2,321?', [SELECTED, '321 Pine'])).toBeNull();
  });

  it('"2,375" with a project 375 and no project 2375 now names 375 (when unsure, refuse)', () => {
    expect(ecosProjectNumberMentions('What is overdue on project 2,375?', [SELECTED, MAIN])).toEqual(['2375', '375']);
    expect(phone('What is overdue on project 2,375?', [SELECTED, MAIN])).toBe(switchOnPhone('375'));
  });

  it.each([
    ['Was the $200,375 change order approved?', [SELECTED, OAK, MAIN]],
    ['Is the slab 200,375 sqft?', [SELECTED, OAK, MAIN]],
    ['Was 101,205 dollars paid?', [SELECTED, SHOP, YARD]],
    ['Compare 200,375', [SELECTED, '2375 Days Inn']],
  ] as const)('"%s" stays allowed (money, a measurement, or no part is a project)', (question, projects) => {
    expectAllowed(question, projects);
  });
});

describe('audit A9 pass 7 L3: a closing single quote after a number is not a feet mark', () => {
  it.each([
    "The super wrote 'delivered to 2375' this morning, right?",
    'The super wrote ‘delivered to 2375’ this morning, right?',
    "I don't know, he wrote 'send it to 2375' today?",
    "Did he say 'the pour at 2375' went fine?",
    "He said 'ok' then wrote 'send it to 2375' again?",
    "Is the '2375' job done?",
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it.each([
    // No single quotation is open before the mark: a feet mark.
    "Is the run 2375' long?",
    'Is the run 2375’ long?',
    "I don't think the run is 2375' long?",
    'The crew’s run is 2375’ long?',
    "He said 'ok' and the run is 2375' long?",
    // A feet-inch pair is a measurement even inside a quotation.
    "He wrote 'set the sleeve at 2375'-6\" above grade' today?",
    "He wrote 'set the sleeve at 2375' 6\" above grade' today?",
    "He wrote 'set the sleeve at 2375'6\" above grade' today?",
    'He wrote ‘set the sleeve at 2375’-6” above grade’ today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });
});

describe('audit A9 pass 7 L4: an inch mark inside a double quotation does not close it', () => {
  it.each([
    'He wrote "the 6" pipe at 2375" this morning?',
    'He wrote “the 6" pipe at 2375” this morning?',
    'He wrote "run 4" conduit, 2" sleeves to 2375" today?',
    'Is the "2375" job done?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it.each([
    'Is the 6" pipe 2375" long?',
    'Is the pipe 2375" long?',
    'He said "ok" and the pipe is 2375" long?',
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    'He wrote "set the 6" sleeve at 12\' 2375" above grade" today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });
});

describe('audit A9 pass 7 L5: a spaced "A" is never amps; a glued "A" is unless a wing letter follows', () => {
  it.each([
    'Are the 2375 A, B and C wings done?',
    'What is left at 2375 A?',
    'Is the main 2375 A.',
    'Is the main 2375 A',
    'What is left in the 2375A wing?',
    'What is left in the 2375A Wing?',
    'Are the 2375A, B and C wings done?',
    'Is 2375A/B done?',
    'Is 2375A & B done?',
    'Is 2375A and B done?',
    ...['wing', 'building', 'bldg', 'side', 'tower', 'block', 'phase', 'unit', 'level', 'area', 'wings']
      .map(word => `What is left on the 2375A ${word}?`),
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it('"panel 200 A?" now names project 200 (the accepted trade-off: write 200A or 200 amps)', () => {
    expectRefusedOpen('Is the panel 200 A?', [SELECTED, '200 Oak Street'], '200', '200 Oak Street');
    expectAllowed('Is the panel 200A?', [SELECTED, '200 Oak Street']);
  });

  it.each([
    'Is the breaker 2375A?',
    'Is the main 2375A.',
    'Is the main 2375A, 3 phase?',
    'Is the 2375A main breaker in?',
    'Is the panel 2375 amp?',
    'Is the panel 2375 amps?',
    'Is the panel 2375 amperes?',
    'Is the panel 2375 ampere?',
    'Is the service 2375 V or 480 V?',
  ])('"%s" is amps or volts and is allowed', question => {
    expectAllowed(question, PROJECTS);
    expectAllowed(question, [SELECTED], [OTHER]);
  });
});

const intelligenceFor = (projectName: string) => buildProjectIntelligence({
  projectId: `project-${projectName}`,
  projectName,
  now: '2026-09-30T12:00:00.000Z',
  updates: [],
  documents: [],
  scheduleItems: [],
} as unknown as Parameters<typeof buildProjectIntelligence>[0]);

/** What Talk says instead of answering, on `selected` ('' = no project), or null when it answers. */
function talkAnswer(question: string, open: readonly string[], closed: readonly string[] = [], selected = SELECTED) {
  expect(routeDAVEConversation({ transcript: question, intelligence: intelligenceFor(selected) }).intent).toBe('ask');
  const context = resolveDAVEConversationContext({
    transcript: question,
    history: [],
    projectId: `project-${selected}`,
    projectName: selected,
    projectNames: open,
    closedProjectNames: closed,
  });
  return context.status === 'ambiguous_follow_up' ? context.effectiveQuestion : null;
}

const talkReopen = (selected: string, closed: string) =>
  `Project ${selected} is selected, but ${closed} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;
const twoProjects = (first: string, second: string) =>
  `This question names two projects, ${first} and ${second}. Which one do you mean? Ask again about just that project.`;

describe('audit A9 pass 7 L6a: a closed project named only by its name is refused in Talk', () => {
  it.each([
    ['What is left at Harbor?', 'Harbor'],
    ['What is left at Riverside Clinic?', 'Riverside Clinic'],
    ['Is riverside clinic closed out?', 'Riverside Clinic'],
  ])('"%s" with "%s" closed is refused in the closed wording and Talk does not switch', (question, closed) => {
    expect(mentionedDAVEProject(question, PROJECTS, [closed])).toBeNull();
    expect(talkAnswer(question, PROJECTS, [closed])).toBe(talkReopen('2321', closed));
  });

  it('a selected project without a number is named in full', () => {
    const OFFICE = 'Harbor Office';
    expect(talkAnswer('What is left at Riverside Clinic?', [OFFICE, OTHER], ['Riverside Clinic'], OFFICE))
      .toBe(talkReopen(OFFICE, 'Riverside Clinic'));
  });

  it('an open project named by name still moves Talk, and the selected project itself is answered', () => {
    expect(mentionedDAVEProject('What is left at Oak Street?', [SELECTED, 'Oak Street'], ['Riverside Clinic'])).toBe('Oak Street');
    expect(talkAnswer('What is left at Oak Street?', [SELECTED, 'Oak Street'], ['Riverside Clinic'], 'Oak Street')).toBeNull();
    expect(talkAnswer('What is left at 2321 Compliance Project?', PROJECTS, ['Riverside Clinic'])).toBeNull();
  });

  it('a closed project that shares the selected number is not another project', () => {
    expect(talkAnswer('What is left at 2321 Phase 1?', PROJECTS, ['2321 Phase 1'])).toBeNull();
  });

  it('a question naming no project is answered', () => {
    expect(talkAnswer('What is overdue?', PROJECTS, ['Riverside Clinic'])).toBeNull();
  });
});

describe('audit A9 pass 7 L6b: Talk with no project selected still checks the projects a question names', () => {
  const ANNEX = '2376 Harbor Annex';
  const THREE = [SELECTED, OTHER, ANNEX];

  it.each([
    ['Compare 2375 and 2376', '2375', '2376'],
    ['Compare 2375 and 2376?', '2375', '2376'],
    ['Is 2321 behind 2375?', '2321', '2375'],
  ])('"%s" asks which project', (question, first, second) => {
    expect(mentionedDAVEProject(question, THREE)).toBeNull();
    expect(talkAnswer(question, THREE, [], '')).toBe(twoProjects(first, second));
  });

  it('a closed project is refused in the closed wording', () => {
    expect(talkAnswer('Is 200 done?', THREE, ['200 Oak Street'], '')).toBe(
      'No project is selected, and 200 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
    expect(talkAnswer('What is left at Riverside Clinic?', THREE, ['Riverside Clinic'], '')).toBe(
      'No project is selected, and Riverside Clinic is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
  });

  it('one open project named switches to it and is answered there', () => {
    expect(mentionedDAVEProject('What is left at 2375?', THREE)).toBe(OTHER);
    expect(talkAnswer('What is left at 2375?', THREE, [], OTHER)).toBeNull();
  });

  it('a question naming no project is answered as before', () => {
    expect(talkAnswer('What is overdue?', THREE, [], '')).toBeNull();
  });
});

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass6-project-numbers.test.ts), opened on
// `talkProjectName` ('' when Talk opened with no project selected).
const fs = jest.requireActual('fs') as typeof import('fs');
const path = jest.requireActual('path') as typeof import('path');
const ts = jest.requireActual('typescript') as typeof import('typescript');
const app = fs.readFileSync(path.resolve(__dirname, '../../App.tsx'), 'utf8');

function appFunction(name: string): string {
  const match = new RegExp(`\\n  (?:async )?function ${name}\\(`).exec(app);
  if (!match) throw new Error(`App.tsx has no function ${name}`);
  const start = match.index + 1;
  const open = app.indexOf(' {\n', start) + 1;
  let depth = 0;
  for (let index = open; index < app.length; index += 1) {
    if (app[index] === '{') depth += 1;
    if (app[index] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced function ${name}`);
}

function talkHarness(open: readonly string[], closed: readonly string[], talkProjectName: string) {
  const projectNames: string[] = [];
  const shown: Array<{ projectName: string; answer: { answer: string } } | null> = [];
  const alert = jest.fn();
  const deps: Record<string, unknown> = {
    setTalkAnswer: (value: { projectName: string; answer: { answer: string } } | null) => shown.push(value),
    Alert: { alert },
    talkSession: createTalkSession(),
    talkHistoryPersistence: { append: async () => undefined },
    mentionedDAVEProject,
    reportAvailableProjectNames: open,
    ecosProjectQuestion: { closedProjectNames: closed },
    talkProjectName,
    talkTaskId: null,
    authorityProjectId: (name: string) => `project-${name}`,
    uid: () => 'id-1',
    resolveDAVEConversationContext,
    answerDAVEConversationContext,
    askECOSQuestionForTalk,
    routeDAVEConversation,
    buildDAVETalkMemoryDraft,
    loadECOSTalkReferenceDocuments: async () => [],
    getSupabaseClient: () => ({}),
    referenceDocuments: [],
    projectIntelligenceForTalk: intelligenceFor,
    reportTalkAnswerPersistenceFailure: jest.fn(),
    setTalkProjectName: (name: string) => projectNames.push(name),
    setTalkTaskId: jest.fn(),
    setTalkVoiceOpen: jest.fn(),
    setTalkTypedOpen: jest.fn(),
    setTalkCaptureDraft: jest.fn(),
  };
  const js = ts.transpileModule(
    [appFunction('persistTalkAnswer'), appFunction('handleTalkInput'), 'module.exports = { handleTalkInput };'].join('\n'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const mod = { exports: {} as { handleTalkInput: (transcript: string) => Promise<void> } };
  new Function('module', 'exports', ...Object.keys(deps), js)(mod, mod.exports, ...Object.values(deps));
  return { handleTalkInput: mod.exports.handleTalkInput, projectNames, shown, alert };
}

describe('audit A9 pass 7 L6: App.tsx Talk', () => {
  const ANNEX = '2376 Harbor Annex';

  it('a closed project named by its name is refused on 2321, with no answer', async () => {
    const h = talkHarness([SELECTED, OTHER], ['Riverside Clinic'], SELECTED);
    await h.handleTalkInput('What is left at Riverside Clinic?');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.alert).toHaveBeenCalledWith('One detail needed', talkReopen('2321', 'Riverside Clinic'));
    expect(h.shown).toEqual([]);
  });

  it('with no project selected, "Compare 2375 and 2376" asks which project and is not answered', async () => {
    const h = talkHarness([SELECTED, OTHER, ANNEX], [], '');
    await h.handleTalkInput('Compare 2375 and 2376');
    expect(h.projectNames).toEqual(['']);
    expect(h.alert).toHaveBeenCalledWith('One detail needed', twoProjects('2375', '2376'));
    expect(h.shown).toEqual([]);
  });

  it('with no project selected, one open project named switches to it and is answered', async () => {
    const h = talkHarness([SELECTED, OTHER, ANNEX], [], '');
    await h.handleTalkInput('What is left at 2375?');
    expect(h.projectNames).toEqual([OTHER]);
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.shown.at(-1)?.projectName).toBe(OTHER);
  });
});
