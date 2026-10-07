import { daveWebScheduleRetirementCheck } from '../../services/DAVEWebScheduleActivation';
import { daveWebScheduleRetirementLead, daveWebScheduleRetirementMessage } from '../../services/DAVEWebScheduleActivationText';
import { daveWebSupabaseGateway } from '../../services/DAVEWebSupabaseClient';
import type { ScheduleRetirementEffect } from '../../services/SharedDocumentActivation';

// Review pass 1, web L5 (6 Oct 2026; caused by WS2 item 3). The web's "Change the current schedule?" card had one
// fixed line, "Making “X” current changes more than its own project.", followed by the phone's sentences. When the
// only change is to X's OWN project (an older combined schedule made current while one of its projects shows a
// newer one) the fixed line was false, and the phone's sentence named a button the web does not have: "Set Active
// on Combined will show Combined for Alpha too." Each sentence of the card is now the web's own, and true in every
// state the card can appear in. Synthetic data; the cloud of web-ws2-schedule-make-current-warning.test.ts.

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('../../services/DAVEWebSupabaseClient', () => ({
  ...jest.requireActual('../../services/DAVEWebSupabaseClient'),
  daveWebSupabaseGateway: { loadAuthorizedRows: jest.fn(), loadAuthorizedScheduleRetirementScope: jest.fn() },
}));

const row = (id: string, importedAt: string, projects: string[], isCurrent: boolean) => ({
  id, owner_id: 'owner-1', name: id, category: 'Schedules', updated_at: '2026-10-06T12:00:00.000Z',
  document_data: {
    id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent, importedAt,
    projectId: null, projectName: projects.length === 1 ? projects[0] : null, projectNames: projects, importBatchId: `batch-${id}`,
  },
});
function cloud(documents: ReturnType<typeof row>[], scope: 'schedule' | 'project') {
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedRows).mockResolvedValue({
    projects: [], scheduleItems: [], projectUpdates: [], referenceDocuments: documents, syncTombstones: [],
  } as never);
  jest.mocked(daveWebSupabaseGateway.loadAuthorizedScheduleRetirementScope).mockResolvedValue(scope);
}
/** The card as the page shows it: its first line, then the sentences. */
async function card(target: string) {
  const check = await daveWebScheduleRetirementCheck({ id: target });
  if (!check.ok) throw new Error(check.message);
  return { asked: check.effects.length > 0, lead: daveWebScheduleRetirementLead(target, check.effects), message: check.message };
}
const PHONE_WORDS = /Set Active|until you set one/;

beforeEach(() => jest.clearAllMocks());

describe('the card when only the schedule\'s OWN project changes (review pass 1, web L5)', () => {
  // "Combined" (September) covers Alpha and Beta and is not current. Alpha shows "Alpha rev 2" (October). Beta shows nothing.
  const documents = () => [row('Combined', '2026-09-01T12:00:00.000Z', ['Alpha', 'Beta'], false), row('Alpha rev 2', '2026-10-01T12:00:00.000Z', ['Alpha'], true)];

  it.each(['schedule', 'project'] as const)('a cloud that retires by %s: the card says what changes for Alpha, in the web\'s words, and does not say "more than its own project"', async (scope) => {
    cloud(documents(), scope);
    const shown = await card('Combined');

    expect(shown).toEqual({
      asked: true,
      lead: 'Making “Combined” current replaces a newer schedule for Alpha.',
      message: 'Alpha now shows “Alpha rev 2”, which is newer. Making “Combined” current will show “Combined” for Alpha instead.',
    });
    expect(`${shown.lead} ${shown.message}`).not.toMatch(/more than its own project/);
    expect(`${shown.lead} ${shown.message}`).not.toMatch(PHONE_WORDS);
  });
});

describe('the card when another project\'s schedule changes', () => {
  const COMBINED = row('Combined', '2026-09-01T12:00:00.000Z', ['Alpha', 'Beta'], true);
  const ALPHA_2 = row('Alpha rev 2', '2026-10-01T12:00:00.000Z', ['Alpha'], false);

  it('left with none: the web\'s words for what to do next', async () => {
    cloud([COMBINED, ALPHA_2], 'schedule');
    const shown = await card('Alpha rev 2');

    expect(shown).toEqual({
      asked: true,
      lead: 'Making “Alpha rev 2” current changes more than its own project.',
      message: 'The schedule now current for Beta will be retired too. Beta is left with no current schedule and shows no schedule tasks until a schedule is made current for it.',
    });
    expect(`${shown.lead} ${shown.message}`).not.toMatch(PHONE_WORDS);
  });

  it('guard: going back to an older schedule reads as before', async () => {
    cloud([row('Beta 2025', '2026-08-01T12:00:00.000Z', ['Beta'], true), COMBINED, ALPHA_2], 'schedule');
    const shown = await card('Alpha rev 2');

    expect(shown.lead).toBe('Making “Alpha rev 2” current changes more than its own project.');
    expect(shown.message).toBe('The schedule now current for Beta will be retired too. Beta goes back to Beta 2025, an older schedule still marked current there.');
  });
});

describe('the card when both happen at once', () => {
  it('says both, each in its own sentence', async () => {
    // "AB" (August) is current for Alpha and Beta; Alpha shows the newer "Alpha rev 2" (October); Gamma shows nothing.
    // "Site" (September) covers Alpha and Gamma. Made current on a cloud that retires whole schedules, it retires AB
    // for Beta too, and takes Alpha over from the newer schedule.
    cloud([
      row('AB', '2026-08-01T12:00:00.000Z', ['Alpha', 'Beta'], true),
      row('Alpha rev 2', '2026-10-01T12:00:00.000Z', ['Alpha'], true),
      row('Site', '2026-09-01T12:00:00.000Z', ['Alpha', 'Gamma'], false),
    ], 'schedule');
    const shown = await card('Site');

    expect(shown).toEqual({
      asked: true,
      lead: 'Making “Site” current changes more than its own project, and replaces a newer schedule for Alpha.',
      message: 'The schedule now current for Beta will be retired too. Beta is left with no current schedule and shows no schedule tasks until a schedule is made current for it. Alpha now shows “Alpha rev 2”, which is newer. Making “Site” current will show “Site” for Alpha instead.',
    });
  });
});

describe('the sentences themselves, for every kind of change the card can hold', () => {
  const other = (projectName: string, fallback: string | null = null): ScheduleRetirementEffect =>
    ({ projectName, fallbackSchedule: fallback ? { id: fallback, name: fallback } : null });
  const own = (projectName: string, newer: string): ScheduleRetirementEffect =>
    ({ projectName, fallbackSchedule: { id: 'T', name: 'T' }, newerScheduleReplaced: { id: newer, name: newer } });

  it('two of its own projects each show a newer schedule: both are named', () => {
    const effects = [own('Alpha', 'Alpha rev 2'), own('Gamma', 'Gamma rev 5')];
    expect(daveWebScheduleRetirementLead('T', effects)).toBe('Making “T” current replaces a newer schedule for each of Alpha and Gamma.');
    expect(daveWebScheduleRetirementMessage('T', effects)).toBe('Alpha now shows “Alpha rev 2”, which is newer. Making “T” current will show “T” for Alpha instead. Gamma now shows “Gamma rev 5”, which is newer. Making “T” current will show “T” for Gamma instead.');
  });

  it('two other projects: each is told what it is left with', () => {
    const effects = [other('Beta'), other('Delta', 'Delta 2025')];
    expect(daveWebScheduleRetirementLead('T', effects)).toBe('Making “T” current changes more than its own project.');
    expect(daveWebScheduleRetirementMessage('T', effects)).toBe('The schedule now current for each of Beta and Delta will be retired too. Beta is left with no current schedule and shows no schedule tasks until a schedule is made current for it. Delta goes back to Delta 2025, an older schedule still marked current there.');
  });

  it('nothing changes for any project: nothing to say', () => {
    expect([daveWebScheduleRetirementLead('T', []), daveWebScheduleRetirementMessage('T', [])]).toEqual(['', '']);
  });
});
