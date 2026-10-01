/**
 * Whole-app audit A6 pass 10 M1, M2, L2 (30 Sep 2026): whether this device
 * has the other device's changes, told for the whole report.
 *
 * The device is behind when the report it counts from was sent by the other
 * install, with facts that differ from this device's, and this device has not
 * downloaded every task since that send. While behind, "since the last report"
 * is not counted (no deltas, no lines) and approval waits. A download that
 * started after the send ends it; so does one started at or after this app
 * session first saw the send, whatever the other device's clock said.
 */
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildDAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVEReportBriefing,
  buildDAVEReportSourceFingerprint,
  enhanceDAVEReportDraft,
} from '../../services/DAVEReportIntelligence';
import {
  buildDAVEReportSnapshot,
  daveReportSnapshotScopeKey,
  otherDeviceSendNotReceived,
  reportPeriodSend,
  type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import {
  lastScheduleCloudPull,
  onScheduleCloudPull,
  recordScheduleCloudPull,
  registerScheduleCloudPullRequest,
  reportSendFirstSeenAt,
  requestScheduleCloudPull,
  SCHEDULE_CLOUD_PULL_KEY,
} from '../../services/ScheduleCloudPull';
import type { PIEReportDraft } from '../../services/PIEReporter';
import type { ScheduleItem } from '../../types';

const NOW = '2026-09-30T15:00:00.000Z';
const SENT = '2026-09-30T12:00:00.000Z';

const item = (id: string, taskName: string, complete: boolean) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate: '2027-06-30', milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete: complete ? 100 : 40, priority: 'Medium', status: complete ? 'Complete' : 'In Progress', notes: '',
  createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const truthOf = (scheduleItems: ScheduleItem[]) => buildDAVEProjectTruth({
  projectId: 'report:tower', projectName: 'Tower', updates: [], scheduleItems, projectAreas: [], referenceDocuments: [], now: NOW,
});
const snapshotOf = (scheduleItems: ScheduleItem[], capturedAt: string, sent?: { at: string; by?: string }) => {
  const truth = truthOf(scheduleItems);
  const snapshot = buildDAVEReportSnapshot({
    truths: [truth], scopeKey: daveReportSnapshotScopeKey(['Tower']),
    sourceFingerprint: buildDAVEReportSourceFingerprint([truth]), capturedAt, reportFormat: 'project_manager',
  });
  return (sent ? { ...snapshot, deliveredAt: sent.at, ...(sent.by ? { sentBy: sent.by } : {}) } : snapshot) as DAVEReportSnapshot;
};
const phonePlan = [item('frame', 'Frame walls', false), item('roof', 'Set roof', false)];
const ipadPlan = [item('frame', 'Frame walls', true), item('punch', 'Punch list', false)];
const ipadSent = snapshotOf(ipadPlan, SENT, { at: SENT, by: 'ipad-install' });
const phoneFacts = buildDAVEReportSourceFingerprint([truthOf(phonePlan)]);
const behind = (overrides: Partial<Parameters<typeof otherDeviceSendNotReceived>[0]> = {}) => otherDeviceSendNotReceived({
  period: ipadSent,
  currentFingerprint: phoneFacts,
  ownSends: new Set(),
  pulledAt: '2026-09-30T09:00:00.000Z',
  seenAt: '2026-09-30T14:00:00.000Z',
  ...overrides,
});

describe('the device-level rule (M1, M2, L2)', () => {
  it('the other device sent after this device last downloaded the tasks: behind, on that send', () => {
    expect(behind()).toBe(ipadSent);
    expect(behind({ pulledAt: null })).toBe(ipadSent);
  });

  it('a download that started after the send ends it, whatever this device did to its tasks', () => {
    expect(behind({ pulledAt: '2026-09-30T12:00:01.000Z' })).toBeNull();
  });

  it('the other device\'s clock ahead: a download at or after this device first saw the send ends it', () => {
    const ahead = { ...ipadSent, deliveredAt: '2026-09-30T23:00:00.000Z' } as DAVEReportSnapshot;
    expect(behind({ period: ahead, pulledAt: '2026-09-30T13:59:00.000Z' })).toBe(ahead);
    expect(behind({ period: ahead, pulledAt: '2026-09-30T14:00:00.000Z' })).toBeNull();
  });

  it('never behind on its own send or on the same facts as the send', () => {
    expect(behind({ ownSends: new Set([SENT]) })).toBeNull();
    expect(behind({ currentFingerprint: ipadSent.sourceFingerprint })).toBeNull();
    // Pin changed in A6 pass 11 L3: a send without a sender id was never
    // waited on, so an iPad that could not read its Keychain at send turned
    // the rule off here. It is now the other install's unless it is one of
    // this device's own sends (known by its send time).
    const { sentBy: _sentBy, ...withoutId } = ipadSent;
    expect(behind({ period: withoutId as DAVEReportSnapshot })).toBe(withoutId);
    expect(behind({ period: withoutId as DAVEReportSnapshot, ownSends: new Set([SENT]) })).toBeNull();
    expect(behind({ period: null })).toBeNull();
  });

  it('an approval not yet sent counts from the send it superseded', () => {
    const approval = { ...snapshotOf(phonePlan, NOW), deliveredAt: null, supersedes: ipadSent } as DAVEReportSnapshot;
    expect(reportPeriodSend(approval)).toBe(ipadSent);
    expect(behind({ period: approval })).toBe(ipadSent);
  });
});

describe('"since the last report" while behind (M1, M2)', () => {
  const draft = {
    id: 'draft-1', reportType: 'daily_project_update', audience: 'owner',
    title: 'Tower update', subject: 'Tower update', body: '', openingLine: '', closingLine: '',
    executiveSummary: [], sections: [], locationGroups: [], actionItems: [], imageReferences: [],
    risks: [], decisionsNeeded: [], confidence: 'high', reportReadiness: 'high',
    needsReview: false, reviewFlags: [], sourceEvidence: [], constructionUnderstanding: {},
    generatedAt: NOW,
  } as unknown as PIEReportDraft;
  const since = (waitingForOtherDevice: boolean) => {
    const briefing = buildDAVEReportBriefing({
      truths: [truthOf(phonePlan)], selectedProjectNames: ['Tower'], previousSnapshot: ipadSent, waitingForOtherDevice,
    });
    return {
      briefing,
      bodies: (['project_manager', 'executive'] as const).map(format => {
        const body = enhanceDAVEReportDraft(draft, briefing, format).body;
        const start = body.indexOf('SINCE THE LAST APPROVED REPORT');
        return body.slice(start, body.indexOf('COMPLETED WORK', start));
      }),
    };
  };

  it('is not counted: one line says why, in both formats, with no deltas and no changes', () => {
    const { briefing, bodies } = since(true);
    expect(briefing.reportingPeriod).toMatchObject({
      completeDelta: 0, openDelta: 0, overdueDelta: 0, changes: [], changeCount: 0, waitingForOtherDevice: true,
    });
    expect(briefing.recentChanges).toEqual([]);
    for (const body of bodies) {
      expect(body.trim()).toBe("SINCE THE LAST APPROVED REPORT\n• Not counted yet: this device hasn't received your other device's latest changes.");
    }
  });

  it('once caught up the same facts are counted as before', () => {
    const { bodies } = since(false);
    for (const body of bodies) {
      expect(body).toContain('Tower: Frame walls was reopened at 40% complete.');
      expect(body).toContain('Tower: Punch list was removed from the current project plan.');
      expect(body).toContain('Tower: Set roof was added to the project plan.');
    }
  });
});

describe('when this device last downloaded every task', () => {
  beforeEach(() => mockStorage.clear());

  it('is kept under the per-account report prefix, and only ever moves later', async () => {
    expect(SCHEDULE_CLOUD_PULL_KEY.startsWith('@vitruvius/report-snapshots/')).toBe(true);
    expect(await lastScheduleCloudPull()).toBeNull();
    await recordScheduleCloudPull('2026-09-30T12:05:00.000Z');
    await recordScheduleCloudPull('2026-09-30T11:00:00.000Z');
    expect(await lastScheduleCloudPull()).toBe('2026-09-30T12:05:00.000Z');
    await recordScheduleCloudPull('not a time');
    expect(await lastScheduleCloudPull()).toBe('2026-09-30T12:05:00.000Z');
  });

  it('tells Reports as it lands, and Reports can ask the app for one', async () => {
    const heard: string[] = [];
    const stop = onScheduleCloudPull(at => heard.push(at));
    await recordScheduleCloudPull('2026-09-30T12:05:00.000Z');
    stop();
    await recordScheduleCloudPull('2026-09-30T12:06:00.000Z');
    expect(heard).toEqual(['2026-09-30T12:05:00.000Z']);

    requestScheduleCloudPull();
    const request = jest.fn();
    const unregister = registerScheduleCloudPullRequest(request);
    requestScheduleCloudPull();
    unregister();
    requestScheduleCloudPull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('the app records each complete download (every task and the deletion history) and downloads when Reports asks', () => {
    const app = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8');
    const refresh = app.slice(app.indexOf('async function refreshOperationalCollections('));
    const start = refresh.indexOf('const refreshStartedAt = new Date().toISOString();');
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(refresh.indexOf('await loadDAVEOperationalTombstones()'));
    const tasks = refresh.slice(refresh.indexOf("shouldRefresh('schedule_items')"));
    // Pin changed in A6 pass 11 (limit b): the time recorded is when the
    // deletion history used was read, which is earlier than the refresh when
    // it was handed a read already in flight (audit-a6-p11-download-start).
    expect(tasks.slice(0, 2600)).toContain('if (tombstones.cloudAuthoritative) void recordScheduleCloudPull(tombstones.readStartedAt ?? refreshStartedAt);');
    expect(app).toContain("registerScheduleCloudPullRequest(() => void refreshController.request('foreground', ['schedule_items']))");
    expect(app).toContain('stopReportPullRequests();');
  });

  it('a send is first seen once per app session', () => {
    expect(reportSendFirstSeenAt('ipad|12:00', () => 'first')).toBe('first');
    expect(reportSendFirstSeenAt('ipad|12:00', () => 'later')).toBe('first');
  });
});
