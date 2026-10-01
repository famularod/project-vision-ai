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

describe('audit A9 pass 6 L1: a spaced capital "A" before a word is not amps', () => {
  it.each([
    'What is left in the 2375 A wing?',
    'Is the 2375 A building topped out?',
    'Is 2375 A or B behind?',
    'Is the service 2375 A or 2375 V?',
    // Audit A9 pass 7 L5: a spaced " A" is never amps, so these four, allowed
    // here as amps before punctuation or the end until then, are refused too
    // (the accepted trade-off; "200 amps" stays amps, and "200A" did until pass 9 L5).
    'Is the main 2375 A.',
    'Is the main 2375 A, 3 phase?',
    'Is the main 2375 A',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });

  it('pass 7 L5: "panel 200 A?" names project 200 too', () => {
    expectRefusedOpen('Is the panel 200 A?', [SELECTED, '200 Oak Street'], '200', '200 Oak Street');
  });

  // Audit A9 pass 9 L5: a glued A is never amps ("Is 2375A done?" hid the
  // project "2375 A Street"), so these four, allowed here until then, are
  // refused: the accepted trade-off; write "200 amps".
  it.each([
    ['Is the panel 200A?', [SELECTED, '200 Oak Street'], '200', '200 Oak Street'],
    ['Is the main 2375A.', PROJECTS, '2375', OTHER],
    ['Is the main 2375A, 3 phase?', PROJECTS, '2375', OTHER],
    ['Is the main breaker 2375A?', PROJECTS, '2375', OTHER],
  ] as const)('"%s" names the project since pass 9 L5', (question, projects, number, project) => {
    expectRefusedOpen(question, projects, number, project);
  });

  it.each([
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
    // Audit A9 pass 8: these four were allowed as inch marks; a lone " or ” is no longer one.
    'Is the pipe 2375" long?',
    'Is the pipe 2375” long?',
    'Is the 6" pipe 2375" long?',
    'He said "ok" and the pipe is 2375" long?',
  ])('%s is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });

  it.each([
    // A feet-inch pair is a measurement even inside a quotation.
    'He wrote "set the sleeve at 2375\'-6" above grade" today?',
    'He wrote "set the sleeve at 2375\' 6" above grade" today?',
  ])('%s is a measurement and is allowed', question => {
    expectAllowed(question, PROJECTS);
  });

  it.each([
    // Audit A9 pass 9 L4: these were allowed as feet-inch pairs; the inches
    // of a pair are now one or two digits, so 2375" names the project.
    'He wrote "set the sleeve at 12\'-2375" above grade" today?',
    'He wrote "set the sleeve at 12\' 2375" above grade" today?',
  ])('%s names 2375 since pass 9 L4', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
  });
});

describe('audit A9 pass 6 L3: a date exempts its year only when the year is 19xx or 20xx', () => {
  it.each([
    'Pull the Sept 30 2375 daily log',
    'Did the May 3 2375 pour pass?',
    'Send the Oct 5, 2375 report',
    'Was the inspection on 5 Oct 2375 passed?',
    'Was the inspection on 9/30/2375 passed?',
    'Was the inspection on 2375-10-05 passed?',
  ])('"%s" is refused and Talk moves to 2375', question => {
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it.each([
    'Pull the Sept 30 2026 daily log',
    'Did the May 3 2026 pour pass?',
    'Send the Oct 5, 2026 report',
    'Was the inspection on 5 Oct 2026 passed?',
    'Was the inspection on 9/30/2026 passed?',
    'Was the inspection on 2026-10-05 passed?',
    'Was the inspection on 10-5-26 passed?',
  ])('"%s" is a full date, not project 2026', question => {
    expectAllowed(question, [SELECTED, '2026 Fit-Out']);
  });

  it('a 19xx year is a date year too', () => {
    expectAllowed('Was the survey on Mar 2, 1999 filed?', [SELECTED, '1999 Survey Archive']);
  });
});

describe('audit A9 pass 6 L4: a number written with thousands commas is read as its digits', () => {
  it.each([
    'What is overdue on project 2,375?',
    'Is 2,375 done?',
    'Pull the closeout docs from 2,375.',
  ])('"%s" is refused as 2375 and Talk moves to 2375', question => {
    expect(ecosProjectNumberMentions(question, PROJECTS)).toEqual(['2375']);
    expectRefusedOpen(question, PROJECTS, '2375', OTHER);
    expectRefusedClosed(question, OTHER, '2375');
  });

  it('"2,375" is read as 2375 first', () => {
    // Until audit A9 pass 7 L2 this also pinned "2,375" as allowed with only
    // a project 375. Pass 7 checks each part of a grouped number that is no
    // project's ("Compare 200,375"), so with no project 2375 it now names 375
    // (when unsure, refuse; audit-a9-pass7-project-numbers.test.ts).
    expect(ecosProjectNumberMentions('What is overdue on project 2,375?', [SELECTED, OTHER, '375 Main Street'])).toEqual(['2375']);
    expectRefusedOpen('What is overdue on project 375?', [SELECTED, '375 Main Street'], '375', '375 Main Street');
  });

  it('the selected project\'s own number with a comma is never refused', () => {
    const question = 'What is overdue on project 2,321?';
    expect(phone(question, PROJECTS)).toBeNull();
    expect(desktop(question, PROJECTS)).toBeNull();
    // Talk names the selected project itself, so it stays.
    expect(mentionedDAVEProject(question, PROJECTS)).toBe(SELECTED);
  });

  it.each([
    ['Was the $2,375 change order approved?', PROJECTS],
    ['Is the slab 2,375 sqft?', PROJECTS],
    ['Is the bearing 2,375 ksf?', [SELECTED, '375 Main Street']],
    ['Was 2,375 dollars paid?', PROJECTS],
    // "1,234,567 bricks" with projects 234 and 567 was here until audit A9
    // pass 7 L2: a grouped number that is no project's is checked part by
    // part, so it now names 234. With no 3-digit project it stays allowed.
    ['Did we lay 1,234,567 bricks?', [SELECTED, '2375 Compliance Project']],
  ] as const)('"%s" stays allowed (money, a measurement, or more than six digits)', (question, projects) => {
    expectAllowed(question, projects);
  });

  it('a list written with ", " still checks each number', () => {
    expectRefusedOpen('Are RFIs 2374, 2375 and 2376 answered?', PROJECTS, '2375', OTHER);
  });
});

describe('audit A9 pass 6 L5: units the earlier rule knew are measurements again', () => {
  it.each([
    ['Are the 500 MCM feeders pulled?', '500 Harrison'],
    ['Are the 500 mcm feeders pulled?', '500 Harrison'],
    ['Are the 500 kcmil feeders pulled?', '500 Harrison'],
    ['Is the RTU 250 MBH?', '250 Main Street'],
    ['Is the beam load 600 plf?', '600 Pine'],
    // "300 meters", "300 metres" and "200 pieces" were here until audit A9
    // pass 7 L1: those words are construction nouns ("the 2375 meters", "the
    // 2375 pieces"), so they name the project now (see the refusals below and
    // audit-a9-pass7-project-numbers.test.ts). "m" and "pcs" stay units.
    ['Is the run 300 m?', '300 Bay'],
    ['Is the heater 500 watts?', '500 Harrison'],
    ['Did the 200 pcs of rebar arrive?', '200 Oak Street'],
    ['Is the cure 120 min?', '120 Elm'],
  ])('"%s" is a measurement with "%s" open or closed', (question, project) => {
    expectAllowed(question, [SELECTED, project]);
    expectAllowed(question, [SELECTED], [project]);
  });

  it.each([
    ['Is 500 done?', '500 Harrison'],
    ['What is overdue at 250?', '250 Main Street'],
    ['Did the 200 crates of rebar arrive?', '200 Oak Street'],
    // Audit A9 pass 7 L1: no longer units.
    ['Is the run 300 meters?', '300 Bay'],
    ['Is the run 300 metres?', '300 Bay'],
    ['Did the 200 pieces of rebar arrive?', '200 Oak Street'],
  ])('"%s" still names "%s"', (question, project) => {
    const number = project.split(' ')[0];
    expectRefusedOpen(question, [SELECTED, project], number, project);
    expectRefusedClosed(question, project, number);
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

/**
 * What Talk says instead of answering, with `selected` in Talk (null: it
 * answers). App.tsx shows it in the "One detail needed" alert.
 */
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

const twoProjects = (first: string, second: string) =>
  `This question names two projects, ${first} and ${second}. Which one do you mean? Ask again about just that project.`;

describe('audit A9 pass 6 L6a: a Talk question naming two projects is not answered from the selected one', () => {
  const ANNEX = '2380 Harbor Annex';
  const THREE = [SELECTED, OTHER, ANNEX];

  it.each([
    ['Compare 2375 and 2380', THREE, '2375', '2380'],
    ['Compare 2375 and 2380?', THREE, '2375', '2380'],
    ['Compare 2321 and 2375', PROJECTS, '2321', '2375'],
    ['Compare 2321 and 2375?', PROJECTS, '2321', '2375'],
    ['Do the specs from 2321 and 2375 match?', PROJECTS, '2321', '2375'],
    ['Is 2375 Compliance Project behind 2380 Harbor Annex?', THREE, '2375', '2380'],
  ] as const)('"%s" asks which project and does not switch', (question, projects, first, second) => {
    expect(mentionedDAVEProject(question, projects)).toBeNull();
    expect(talkAnswer(question, projects)).toBe(twoProjects(first, second));
  });

  it('a note naming two projects still moves, for confirmation, to the one named in full', () => {
    const MAIN = '100 Main Street';
    expect(mentionedDAVEProject('Framing at 100 Main Street is done, 2375 is next', [SELECTED, MAIN, OTHER])).toBe(MAIN);
    expect(mentionedDAVEProject('Delivered to Oak Street today', ['Oak', 'Oak Street'])).toBe('Oak Street');
  });

  it('three projects are listed', () => {
    expect(talkAnswer('Compare 2321, 2375 and 2380?', THREE)).toBe(
      'This question names 3 projects, 2321, 2375 and 2380. Which one do you mean? Ask again about just that project.',
    );
  });

  it.each([
    // One project named: Talk moves to it and answers from it.
    ['What is left at 2375?', OTHER],
    ['Compare 2375 and 2400?', OTHER],
    ['Compare the 2375 mm slab to 2380?', ANNEX],
  ])('"%s" names one project and Talk answers from it', (question, project) => {
    expect(mentionedDAVEProject(question, THREE)).toBe(project);
    expect(talkAnswer(question, THREE, [], project)).toBeNull();
  });

  it('a question about the selected project alone is answered', () => {
    expect(talkAnswer('What is left at 2321?', THREE)).toBeNull();
    expect(talkAnswer('Is 2321 behind?', [SELECTED, '2321 Annex', OTHER])).toBeNull();
  });
});

describe('audit A9 pass 6 L6b: Talk knows closed projects and refuses them in the closed wording', () => {
  const OAK = '200 Oak Street';
  const talkReopen = (number: string) =>
    `Project 2321 is selected, but ${number} is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.`;

  it.each([
    ['Is 200 done?', OAK, '200'],
    ['What is overdue on 200?', OAK, '200'],
    ['What was the slab thickness at 2375?', OTHER, '2375'],
  ])('"%s" with "%s" closed is refused and Talk does not switch', (question, closed, number) => {
    expect(mentionedDAVEProject(question, [SELECTED], [closed])).toBeNull();
    expect(talkAnswer(question, [SELECTED], [closed])).toBe(talkReopen(number));
  });

  it.each([
    'Did the 200 bags of grout arrive?',
    'Is the crane rented for 200 days?',
  ])('"%s" is a measurement with 200 closed and is answered', question => {
    expect(mentionedDAVEProject(question, [SELECTED], [OAK])).toBeNull();
    expect(talkAnswer(question, [SELECTED], [OAK])).toBeNull();
  });

  it('an open and a closed project in one question names two projects (no switch)', () => {
    expect(mentionedDAVEProject('Is 2375 or 200 behind?', PROJECTS, [OAK])).toBeNull();
    expect(talkAnswer('Is 2375 or 200 behind?', PROJECTS, [OAK])).toBe(twoProjects('2375', '200'));
  });

  it('a number an open and a closed project share is read as the open one', () => {
    expect(mentionedDAVEProject('What is left at 2375?', PROJECTS, ['2375 Old Phase'])).toBe(OTHER);
  });
});

describe('audit A9 pass 6 L6c: a project named just a number is not matched inside an exempt span', () => {
  const BARE = '2375';
  const BARE_PROJECTS = [SELECTED, BARE];

  it.each([
    'Is the slab 2375 sqft?',
    'Call 555-2375 about the pour.',
    'Was the $2375 invoice paid?',
    'Is the main service 2375 amps?',
  ])('"%s" keeps Talk on 2321', question => {
    expect(mentionedDAVEProject(question, BARE_PROJECTS)).toBeNull();
    expect(desktop(question, BARE_PROJECTS)).toBeNull();
  });

  it('a date or a sheet ID does not match a project named by its year or number', () => {
    expect(mentionedDAVEProject('Was the inspection on 9/30/2026 passed?', [SELECTED, '2026'])).toBeNull();
    expect(mentionedDAVEProject('What is on sheet A-201?', [SELECTED, '201'])).toBeNull();
  });

  it.each([
    'What is left at 2375?',
    'Is 2375 done?',
    'Is the slab at 2375 poured?',
  ])('"%s" names project "2375" and Talk moves to it', question => {
    expect(mentionedDAVEProject(question, BARE_PROJECTS)).toBe(BARE);
    expect(desktop(question, BARE_PROJECTS)).toBe(switchOnDesktop('2375'));
  });
});

// App.tsx's own handleTalkInput, compiled from the source with the real Talk
// services (as in audit-a9-pass2-talk-session.test.ts), so the closed project
// list really reaches Talk.
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

function talkHarness(open: readonly string[], closed: readonly string[]) {
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
    talkProjectName: SELECTED,
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

describe('audit A9 pass 6 L6: App.tsx Talk', () => {
  const ANNEX = '2380 Harbor Annex';

  it('a closed project named in Talk is refused in the closed wording, on 2321, with no answer', async () => {
    const h = talkHarness([SELECTED, OTHER], ['200 Oak Street']);
    await h.handleTalkInput('Is 200 done?');
    expect(h.projectNames).toEqual([SELECTED]);
    expect(h.alert).toHaveBeenCalledWith(
      'One detail needed',
      'Project 2321 is selected, but 200 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
    expect(h.shown).toEqual([]);
  });

  it.each(['Compare 2375 and 2380', 'Compare 2375 and 2380?'])(
    '"%s" asks which project, does not switch and does not answer',
    async question => {
      const h = talkHarness([SELECTED, OTHER, ANNEX], []);
      await h.handleTalkInput(question);
      expect(h.projectNames).toEqual([SELECTED]);
      expect(h.alert).toHaveBeenCalledWith('One detail needed', twoProjects('2375', '2380'));
      expect(h.shown).toEqual([]);
    },
  );

  it('a follow-up naming two projects or a closed one is not answered from the earlier 2321 answer', async () => {
    const h = talkHarness([SELECTED, OTHER, ANNEX], ['200 Oak Street']);
    await h.handleTalkInput('What is overdue?');
    expect(h.shown).toHaveLength(1);
    await h.handleTalkInput('What about 2375 and 2380?');
    expect(h.alert).toHaveBeenLastCalledWith('One detail needed', twoProjects('2375', '2380'));
    await h.handleTalkInput('And at 200?');
    expect(h.alert).toHaveBeenLastCalledWith(
      'One detail needed',
      'Project 2321 is selected, but 200 is a closed project. Reopen it under Archived Projects on the Overview tab, then ask there.',
    );
    expect(h.shown).toHaveLength(1);
    expect(h.projectNames.every(name => name === SELECTED)).toBe(true);
  });

  it('a question naming one other project still moves Talk to it and is answered', async () => {
    const h = talkHarness([SELECTED, OTHER], ['200 Oak Street']);
    await h.handleTalkInput('What is left at 2375?');
    expect(h.projectNames).toEqual([OTHER]);
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.shown.at(-1)?.projectName).toBe(OTHER);
  });

  it('a measurement with a closed 3-digit project is answered on 2321', async () => {
    const h = talkHarness([SELECTED, OTHER], ['200 Oak Street']);
    await h.handleTalkInput('Did the 200 bags of grout arrive?');
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.shown.at(-1)?.projectName).toBe(SELECTED);
  });
});
