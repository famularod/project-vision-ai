/**
 * R8 item 4 (the coordinator's decision on review pass 2): the guard that
 * should have caught P2-2 and P2-3.
 *
 * "This is the report you already approved / sent / saved" has to be true to
 * the reader. The app answers it by the report's fingerprint (version 2.0).
 * So: whenever a single change to anything the report recipe reads moves the
 * written report, or what is saved with an approval, the fingerprint must
 * move. A change that moves the report under one fingerprint is a false
 * "already sent".
 *
 * Random saved projects from a seeded generator of this file (real CSV
 * reader, import review and merge, lookaheads, a task that leaves and comes
 * back, field updates with photos and comparisons, a drawing with a page
 * index, GPS work areas, two earlier reports), and for each one, one change
 * at a time to every kind of input, on the phone's road and on the web's:
 *   tasks shown, their earlier (hidden) rows, field updates, photos and
 *   comparisons, schedule documents, drawings and what is cited of them,
 *   activity notes, approvals, work areas.
 * For each: the written report in every form the app writes it (the phone's
 * project manager and executive reports, the web's two), what the Word report
 * cites, and the report as Approve saves it, set against the fingerprint.
 *
 * The other direction (the fingerprint moves and no word of the report does)
 * costs one more approval and is counted, not failed.
 *
 * R9 (the coordinator's decision): the same guard on the 1.0 road, for the earlier rows. A report Build 230 saved
 * is known by the 1.0 fingerprint of its facts, which holds no earlier row: read as that report (counted from a
 * report of this build, and from one of Build 230's), no change to an earlier row may move a word of it.
 *
 * R8_SEEDS sets how many projects (default 5, for the release gate's time; R8_FIRST the first seed). Each project is
 * some ninety reports written twice over, so the tests are given time.
 */
import { daveProjectTruthAsBuilt, type DAVEProjectTruth } from '../../services/DAVEProjectTruth';
import {
  buildDAVELegacyReportSourceFingerprint, buildDAVEReportBriefing, buildDAVEReportSourceFingerprint, buildDAVEReportSourceOnPeriod, enhanceDAVEReportDraft, reportPeriodMovementLines,
} from '../../services/DAVEReportIntelligence';
import { buildDAVEReportProjectTruths } from '../../services/DAVEReportProjectTruths';
import {
  buildDAVEReportSnapshot, daveReportSnapshotScopeKey, markReportSnapshotDelivered, reportBaselineSnapshot, reportReadAsEarlierVersionReport, reportSnapshotToSave,
  sameReportSource, type DAVEReportSnapshot,
} from '../../services/DAVEReportSnapshot';
import { reconcileDAVEScheduleRecords } from '../../services/DAVEScheduleRecovery';
import { buildDAVEWebReportDraft, buildDAVEWebReportTruths, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import type { DAVEWebReadOnlySnapshot } from '../../services/DAVEWebReadOnlyRepository';
import { normalizeScheduleImport } from '../../services/PIEScheduleIntelligence';
import { selectAuthoritativeScheduleItems } from '../../services/PIEScheduleReconciliation';
import { buildDailyReportAuthorityScope } from '../../services/ReportAuthorityScope';
import { buildAutomaticReportDrawingReferences } from '../../services/ReportDrawingReferences';
import {
  compactECOSDocumentIndexForCloud, listedPageIndexOfTheListRow, referenceDocumentsCitedAsListed, withoutListedPageIndexes,
} from '../../services/ECOSDocumentIndexPersistence';
import { mergeApprovedScheduleImportItems, scheduleImportReviewPairingQuestions, scheduleItemsVisibleBeforeImport } from '../../services/ScheduleImportMerge';
import { scheduleSavedTasksOfProjects, scheduleTaskEarlierIds } from '../../services/ScheduleTaskRevisions';
import { scheduleDocumentsAfterActivation } from '../../services/SharedDocumentActivation';
import { normalizeProjectControls } from '../../services/VitruviusProjectControls';
import type { ProjectArea, ProjectItemActivity, ProjectUpdate, ReferenceDocument, ScheduleItem } from '../../types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []), multiGet: jest.fn(async () => []) },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

// ---- a saved project ----
type World = { items: ScheduleItem[]; documents: ReferenceDocument[]; updates: ProjectUpdate[]; areas: ProjectArea[] };
type Rand = () => number;
function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T,>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 16)).toISOString();   // days of September 2026, 16:00 UTC
const date = (n: number) => { const d = new Date(Date.UTC(2026, 9, 1 + n)); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const shown = (world: World) => selectAuthoritativeScheduleItems({ scheduleItems: world.items, scheduleDocuments: world.documents }) as ScheduleItem[];
const scheduleFile = (id: string, importedAt: string, role?: 'lookahead'): ReferenceDocument => ({
  id, name: id, originalFileName: `${id}.csv`, uri: '', category: 'Schedules', notes: '', isCurrent: true, importedAt,
  projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], importBatchId: `batch-${id}`, ...(role ? { scheduleRole: role } : {}),
}) as ReferenceDocument;
/** An approval as the phone makes it: the real reader, the import review's questions answered as it guesses, the merge. */
function approve(world: World, source: ReferenceDocument, lines: string[]): World {
  const lookahead = source.scheduleRole === 'lookahead';
  const imported = (normalizeScheduleImport({
    contents: ['Task,Project,Area,Start,Finish,Percent Complete,Unique ID', ...lines].join('\n'), sourceName: source.originalFileName,
    mimeType: 'text/csv', projects: ['Alpha'], projectAreas: [], now: new Date(source.importedAt as string),
  }).items as ScheduleItem[]).map((item, index) => ({
    ...item, id: `${source.id}-${index + 1}`, importBatchId: source.importBatchId, sourceDocumentId: source.id, projectControls: normalizeProjectControls(undefined), activity: [],
  } as ScheduleItem));
  let pairingChoices: Record<string, string | null> | undefined;
  scheduleImportReviewPairingQuestions({ saved: world.items, documents: [...world.documents, source], importBatchId: source.importBatchId || '', imported, overlay: lookahead })
    .forEach(question => { pairingChoices = { ...(pairingChoices || {}), ...(question as unknown as { guess: Record<string, string | null> }).guess }; });
  const merged = mergeApprovedScheduleImportItems({
    existing: world.items, imported, completionMatch: () => null, mergeCompletion: item => item,
    isCurrent: scheduleItemsVisibleBeforeImport(world.items, [...world.documents, source], source.importBatchId || ''),
    approvedAt: source.importedAt as string, overlay: lookahead, ...(pairingChoices ? { pairingChoices } : {}),
  });
  const schedules = world.documents.filter(document => document.category === 'Schedules');
  const others = world.documents.filter(document => document.category !== 'Schedules');
  return {
    ...world,
    items: reconcileDAVEScheduleRecords([...merged.additions, ...merged.next]) as ScheduleItem[],
    documents: [...(lookahead ? [...schedules, source] : scheduleDocumentsAfterActivation(source, [...schedules, source], 'project')), ...others],
  };
}
const withItem = (world: World, id: string, change: (item: ScheduleItem) => ScheduleItem): World => ({ ...world, items: world.items.map(item => (item.id === id ? change(item) : item)) });
const controls = (item: ScheduleItem, change: Record<string, unknown>): ScheduleItem => ({ ...item, projectControls: { ...normalizeProjectControls(item.projectControls), ...change } } as ScheduleItem);
const note = (id: string, message: string, createdAt: string): ProjectItemActivity => ({ id, message, author: 'David', createdAt });
const records = (item: ScheduleItem, percent: number, at: string): ScheduleItem => ({
  ...item, percentComplete: percent, status: percent >= 100 ? 'Complete' : 'In Progress', progressSource: 'project_manager', progressConfirmedAt: at, progressConfirmedBy: 'David', updatedAt: at,
} as ScheduleItem);
const COMPARISON = {
  status: 'analysis_complete', title: 'Photo comparison', summary: 'Progress photo', visibleChange: 'Primer is on the north wall.', location: 'Lot', comparisonConfidence: 'high',
  captureLimitations: [], projectProgress: 'supported', repeatPhotoGuidance: null, authorityMessage: '', currentObservation: 'North wall primed; south wall bare.',
  changedFromPrior: 'Primer applied since the prior photo.', priorUpdateUsed: 'u-0', comparability: 'strong', provenance: 'visual_only', userReview: 'confirmed',
  assessmentDisposition: 'finding', findings: [{ findingType: 'added', description: 'Primer' }],
};
const photo = (id: string, area: string, withComparison: boolean) => ({
  id, uri: `file:///phone/photos/${id}.jpg`, caption: 'Progress', category: 'Progress', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open',
  fileName: `${id}.jpg`, mimeType: 'image/jpeg', selectedAreaName: area, ...(withComparison ? { photoIntelligence: { ...COMPARISON, location: area } } : {}),
});
const fieldUpdate = (id: string, task: ScheduleItem, at: string, notes: string, photos: unknown[] = []): ProjectUpdate => ({
  id, projectName: 'Alpha', scheduleProjectName: 'Alpha', date: at, photos, recipients: { contactIds: [] }, notes,
  scheduleItemId: task.id, scheduleTaskName: task.taskName, selectedAreaName: task.locationName || '',
}) as unknown as ProjectUpdate;
const REGION = (area: string) => ({ id: `region-${area.toLowerCase()}`, label: area, areaNames: [area], confidence: 0.95, x: 0.1, y: 0.1, width: 0.4, height: 0.3 });
const drawing = (areas: string[]): ReferenceDocument => ({
  id: 'doc-a201', name: 'A-201 Site plan', originalFileName: 'A-201 Site plan.pdf', uri: 'file:///phone/documents/doc-a201.pdf', category: 'Plans', notes: '', isCurrent: true,
  importedAt: day(1), projectId: null, projectName: 'Alpha', projectNames: ['Alpha'], mimeType: 'application/pdf',
  drawingNumber: 'A-201', drawingRevision: 'C', drawingDiscipline: 'Architectural', drawingStatus: 'For Construction', drawingIssuedAt: '2026-08-28',
  extractionStatus: 'complete', extractionMethod: 'embedded_text', extractedText: 'SITE PLAN', extractedPages: [{ pageNumber: 1, sheetNumber: null, text: 'SITE PLAN', regions: areas.map(REGION) }],
}) as unknown as ReferenceDocument;

// ---- what the app makes of it: the phone's Reports screen and the web's Reports page ----
const SCOPE = daveReportSnapshotScopeKey(['Alpha']);
const STUB = { id: 'draft', title: '', subject: '', body: '', openingLine: 'OPENING', closingLine: 'CLOSING', locationGroups: [] } as never;
const written = (briefing: ReturnType<typeof buildDAVEReportBriefing>): string => {
  const since = reportPeriodMovementLines(briefing);
  const period = since ? { label: briefing.reportingPeriod.label, lines: since } : null;
  return (['project_manager', 'executive'] as const).flatMap(format => [
    String(enhanceDAVEReportDraft(STUB, briefing, format).body),
    String(formatDAVEWebReport(briefing, format, period)).split('\n').filter(line => !line.startsWith('Generated: ')).join('\n'),
  ]).join('\n=====\n');
};
/**
 * High item 3 (c, b2): every device cites a drawing only from the copy the document list gives: the citation key of
 * the drawing's row as its writers send it. Each world's documents as a device holds them after a list.
 */
const asListed = (documents: readonly ReferenceDocument[]): ReferenceDocument[] => documents.map(document => (document.category === 'Plans'
  ? { ...document, listedPageIndex: listedPageIndexOfTheListRow(compactECOSDocumentIndexForCloud(document)) }
  : document));
function phoneScreen(world: World, period: DAVEReportSnapshot | null, now: string) {
  // App.tsx: the live authority input for a daily report, then the Reports screen's props.
  const scope = buildDailyReportAuthorityScope({
    selectedProjectName: 'Alpha', selectedProjectNames: ['Alpha'], projectRecords: [{ id: 'project-alpha-id', name: 'Alpha' }], updates: world.updates,
    scheduleItems: shown(world), currentUpdate: null, projectAreas: world.areas, knownScheduleItems: world.items, referenceDocuments: asListed(world.documents),
    projectDocuments: [], captureMemories: [], contacts: { contacts: [] },
  } as never);
  const truths = buildDAVEReportProjectTruths({
    projects: [{ name: 'Alpha', projectId: 'report:alpha' }], projectRecords: [{ name: 'Alpha' }] as never, updates: scope.updates, scheduleItems: scope.scheduleItems,
    knownScheduleItems: scheduleSavedTasksOfProjects(world.items, scope.scheduleItems, scope.projectNames), knownScheduleDocuments: world.documents,
    // As the Reports screen hands them (high item 3).
    projectAreas: scope.projectAreas, referenceDocuments: withoutListedPageIndexes([...scope.referenceDocuments]), drawingDocuments: referenceDocumentsCitedAsListed([...scope.referenceDocuments]), now,
  });
  // As the Reports screen works it out since HIGH item 1c: against the report it counts from (the saved period).
  const fingerprint = buildDAVEReportSourceOnPeriod(truths, period).fingerprint;
  const briefing = buildDAVEReportBriefing({
    truths, selectedProjectNames: ['Alpha'], previousSnapshot: reportBaselineSnapshot(period, fingerprint),
    readAsEarlierVersionReport: reportReadAsEarlierVersionReport(period, fingerprint), scheduleItems: scope.scheduleItems,
  });
  const cited = buildAutomaticReportDrawingReferences({ documents: referenceDocumentsCitedAsListed([...scope.referenceDocuments]), scheduleItems: [...scope.scheduleItems], selectedProjectNames: ['Alpha'] });
  const snapshot = buildDAVEReportSnapshot({
    truths, scopeKey: SCOPE, sourceFingerprint: fingerprint, capturedAt: now, reportFormat: 'project_manager',
    sourceReferences: cited.map(reference => ({ ...reference.citation, projectName: reference.projectName, areaName: reference.areaName })),
  });
  // What is saved with an approval, without the fingerprint itself. HIGH item 1d (open item 7.55, the coordinator's
  // decision: a fact is held where the report prints it): without what it saves of a task that no report prints, its
  // start date and the key of what can be edited on it (which carries its contractor, next action, start and baseline).
  // A later report reads them only to say "<task> was updated." of a task changed after the facts it counts from, which
  // is true; holding them would offer the report again with no word changed.
  const saved = JSON.stringify({
    ...snapshot, sourceFingerprint: null, supersedes: null,
    tasks: snapshot.tasks.map(task => { const { startDate: _start, contentKey: _key, ...kept } = task; return kept; }),
  });
  return { truths, fingerprint, snapshot, report: `${written(briefing)}\n=====CITES\n${cited.map(reference => `${reference.areaName}: ${reference.citation.label}`).join('\n')}\n=====SAVED\n${saved}` };
}
function webPage(world: World, period: DAVEReportSnapshot | null, now: string) {
  const snapshot = {
    projects: [{ id: 'project-alpha-id', name: 'Alpha' }], scheduleItems: shown(world), knownScheduleItems: world.items,
    // As the cloud keeps an update: the uploading device's own file path, and each photo's cloud path.
    projectUpdates: world.updates.map(update => ({ id: update.id, updateData: { ...update, photos: (update.photos ?? []).map(entry => ({ ...entry, uri: `file:///ipad/photos/${entry.id}.jpg`, cloudStoragePath: `Alpha/${update.id}/${entry.id}.jpg` })) } })),
    referenceDocuments: asListed(world.documents), refreshedAt: now,
  } as unknown as DAVEWebReadOnlySnapshot;
  const fingerprint = buildDAVEReportSourceOnPeriod(buildDAVEWebReportTruths(snapshot, 'Alpha'), period).fingerprint;
  const briefing = buildDAVEWebReportDraft(snapshot, 'Alpha', {
    previousSnapshot: reportBaselineSnapshot(period, fingerprint), readAsEarlierVersionReport: reportReadAsEarlierVersionReport(period, fingerprint), waitingForOtherDevice: false,
  });
  const cited = buildAutomaticReportDrawingReferences({ documents: referenceDocumentsCitedAsListed([...snapshot.referenceDocuments] as ReferenceDocument[]), scheduleItems: [...snapshot.scheduleItems], selectedProjectNames: ['Alpha'] });
  return { fingerprint, report: `${written(briefing)}\n=====CITES\n${cited.map(reference => `${reference.areaName}: ${reference.citation.label}`).join('\n')}` };
}

// ---- the generator ----
const NAMES = ['Paint', 'Drywall', 'Framing', 'Roofing', 'Tile', 'Cleanup', 'Electrical rough', 'Plumbing rough'];
const AREAS = ['Lot', 'Deck'];
function project(seed: number) {
  const rand = seeded(seed * 7919 + 13);
  const tasks = NAMES.slice(0, 5 + Math.floor(rand() * 3)).map((name, index) => ({ name, area: pick(rand, AREAS), start: 2 + index * 3 + Math.floor(rand() * 3), length: 3 + Math.floor(rand() * 5), uid: 101 + index }));
  const line = (task: (typeof tasks)[number], shift = 0, percent = '') => `${task.name},Alpha,${task.area},${date(task.start + shift)},${date(task.start + task.length + shift)},${percent},${task.uid}`;
  let world: World = { items: [], documents: [], updates: [], areas: [] };
  let noteNo = 0; let updateNo = 0;
  const hisDay = (world0: World, at: number): World => {
    // What he does in a day: a percent, an owner, an approval, a note, a field update.
    let next = world0;
    const list = shown(next);
    if (list.length === 0) return next;
    const task = () => pick(rand, shown(next));
    if (rand() < 0.8) { const target = task(); next = withItem(next, target.id, item => records(item, Math.min(100, (item.percentComplete || 0) + 10 + Math.floor(rand() * 4) * 10), day(at))); }
    if (rand() < 0.5) { const target = task(); next = withItem(next, target.id, item => ({ ...item, owner: pick(rand, ['Sam', 'Dana', 'Lee']), updatedAt: day(at) } as ScheduleItem)); }
    if (rand() < 0.4) { const target = task(); next = withItem(next, target.id, item => controls(item, { approvalStatus: pick(rand, ['Pending', 'Approved', 'Rejected']), estimatedScheduleImpactDays: Math.floor(rand() * 4) })); }
    if (rand() < 0.7) { const target = task(); next = withItem(next, target.id, item => ({ ...item, activity: [...(item.activity ?? []), note(`note-${++noteNo}`, pick(rand, ['Crew short today.', 'Material on site.', 'Inspector booked.', 'Rain delay.']), day(at))] } as ScheduleItem)); }
    if (rand() < 0.6) {
      const target = task();
      const filed = fieldUpdate(`u-${++updateNo}`, target, day(at), pick(rand, [`${target.taskName} about 50% done, crew on site.`, `Blocked: waiting on inspector for ${target.taskName}.`, 'Site walk, no issues.']),
        rand() < 0.5 ? [photo(`p-${updateNo}-1`, target.locationName || 'Lot', rand() < 0.7)] : []);
      // Mostly under the project; sometimes under a building's name, with the parent kept or not (older updates).
      const filing = rand();
      next = { ...next, updates: [...next.updates, filing < 0.7 ? filed : { ...filed, projectName: 'Building 7', ...(filing < 0.85 ? {} : { scheduleProjectName: undefined }) } as ProjectUpdate] };
    }
    return next;
  };
  world = approve(world, scheduleFile('MASTER M1', day(0)), tasks.map(task => line(task)));
  if (rand() < 0.6) world = { ...world, documents: [...world.documents, drawing(rand() < 0.7 ? AREAS : ['Lot'])] };
  if (rand() < 0.5) world = { ...world, areas: AREAS.map((name, index) => ({ id: `area-${name.toLowerCase()}`, projectName: 'Alpha', name, latitude: 37.1 + index / 100, longitude: -122.1 - index / 100, radiusFeet: 150 })) as unknown as ProjectArea[] };
  world = hisDay(world, 1);
  let period: DAVEReportSnapshot | null = null;
  // R9: the same reports as Build 230 saved them, each under the 1.0 fingerprint of its facts.
  let period230: DAVEReportSnapshot | null = null;
  const send = (at: number) => {
    const screen = phoneScreen(world, period, day(at));
    period = markReportSnapshotDelivered((reportSnapshotToSave(screen.snapshot, period) ?? screen.snapshot) as DAVEReportSnapshot, day(at), 'phone');
    const on230 = { ...screen.snapshot, sourceFingerprint: buildDAVELegacyReportSourceFingerprint(screen.truths) } as DAVEReportSnapshot;
    period230 = markReportSnapshotDelivered((reportSnapshotToSave(on230, period230) ?? on230) as DAVEReportSnapshot, day(at), 'phone');
  };
  send(2);
  // A revised master: some tasks move, one is left out.
  const dropped = pick(rand, tasks);
  world = approve(world, scheduleFile('MASTER M2', day(3)), tasks.filter(task => task !== dropped).map(task => line(task, rand() < 0.4 ? 4 : 0)));
  world = hisDay(world, 4);
  send(5);
  if (rand() < 0.5) {
    // A lookahead: a detail task of its own, and other dates for one the master lists.
    const listed = pick(rand, tasks.filter(task => task !== dropped));
    world = approve(world, scheduleFile('LOOKAHEAD L1', day(6), 'lookahead'), [`Punch list,Alpha,${listed.area},${date(listed.start + 1)},${date(listed.start + 3)},,901`, line(listed, 1)]);
    // A newer lookahead replaces it: it lists that task on other dates again, or no longer lists it (the task is back on the master's dates).
    if (rand() < 0.6) world = approve(world, scheduleFile('LOOKAHEAD L2', day(7), 'lookahead'), [rand() < 0.5 ? line(listed, 2) : `Punch list,Alpha,${listed.area},${date(listed.start + 2)},${date(listed.start + 4)},,901`]);
  }
  world = hisDay(world, 8);
  send(9);
  // A later master lists the task that was left out again: the same task, by its Unique ID.
  if (rand() < 0.75) world = approve(world, scheduleFile('MASTER M3', day(10)), tasks.map(task => line(task, task === dropped ? 6 : 0)));
  world = hisDay(world, 11);
  world = hisDay(world, 12);
  return { world, period: period as DAVEReportSnapshot | null, period230: period230 as DAVEReportSnapshot | null, now: day(13) };
}

// ---- one change to one input ----
type Change = readonly [family: string, what: string, make: (world: World, rand: Rand) => World | null];
const aTask = (world: World, rand: Rand) => { const list = shown(world); return list.length ? pick(rand, list) : null; };
const onTask = (change: (item: ScheduleItem, rand: Rand, world: World) => ScheduleItem | null) => (world: World, rand: Rand): World | null => {
  const task = aTask(world, rand);
  const changed = task ? change(task, rand, world) : null;
  return task && changed ? withItem(world, task.id, () => changed) : null;
};
/** A hidden row that a task shown answers to. */
const anEarlierRow = (world: World, rand: Rand) => {
  const visible = new Set(shown(world).map(item => item.id));
  const ids = shown(world).flatMap(item => scheduleTaskEarlierIds(item)).filter(id => !visible.has(id) && world.items.some(item => item.id === id));
  return ids.length ? world.items.find(item => item.id === pick(rand, ids)) ?? null : null;
};
const onEarlierRow = (change: (item: ScheduleItem) => ScheduleItem) => (world: World, rand: Rand): World | null => {
  const row = anEarlierRow(world, rand);
  return row ? withItem(world, row.id, change) : null;
};
const onUpdate = (change: (update: ProjectUpdate, rand: Rand, world: World) => ProjectUpdate | null) => (world: World, rand: Rand): World | null => {
  if (world.updates.length === 0) return null;
  const target = pick(rand, world.updates);
  const changed = change(target, rand, world);
  return changed ? { ...world, updates: world.updates.map(update => (update === target ? changed : update)) } : null;
};
const onPhoto = (change: (entry: Record<string, unknown>) => Record<string, unknown> | null, need: (entry: Record<string, unknown>) => boolean = () => true) => (world: World, rand: Rand): World | null => {
  const withPhotos = world.updates.filter(update => ((update.photos ?? []) as unknown as Record<string, unknown>[]).some(need));
  if (withPhotos.length === 0) return null;
  const target = pick(rand, withPhotos);
  let done = false;
  const photos = ((target.photos ?? []) as unknown as Record<string, unknown>[]).flatMap(entry => { if (done || !need(entry)) return [entry]; done = true; const changed = change(entry); return changed ? [changed] : []; });
  return { ...world, updates: world.updates.map(update => (update === target ? { ...update, photos } as unknown as ProjectUpdate : update)) };
};
const comparisonOf = (entry: Record<string, unknown>) => entry.photoIntelligence as Record<string, unknown> | undefined;
const onComparison = (change: Record<string, unknown>) => onPhoto(entry => ({ ...entry, photoIntelligence: { ...comparisonOf(entry), ...change } }), entry => Boolean(comparisonOf(entry)));
const onDocument = (which: (document: ReferenceDocument) => boolean, change: (document: ReferenceDocument) => ReferenceDocument) => (world: World, rand: Rand): World | null => {
  const candidates = world.documents.filter(which);
  if (candidates.length === 0) return null;
  const target = pick(rand, candidates);
  return { ...world, documents: world.documents.map(document => (document === target ? change(document) : document)) };
};
const currentSchedule = (document: ReferenceDocument) => document.category === 'Schedules' && document.isCurrent === true;
const isDrawing = (document: ReferenceDocument) => document.category === 'Plans';
const isLookahead = (document: ReferenceDocument) => document.category === 'Schedules' && document.scheduleRole === 'lookahead';
const pages = (document: ReferenceDocument) => ((document as unknown as { extractedPages: Array<Record<string, unknown> & { regions: Array<Record<string, unknown>> }> }).extractedPages);
const laterDate = (value: string | null | undefined) => { const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || ''); return match ? date(Math.round((Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) - Date.UTC(2026, 9, 1)) / 86_400_000) + 2) : '11/20/2026'; };
const latestNote = (item: ScheduleItem) => [...(item.activity ?? [])].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];

const CHANGES: readonly Change[] = [
  // tasks shown
  ['tasks', 'percent', onTask(item => ({ ...item, percentComplete: ((item.percentComplete || 0) + 10) % 100 } as ScheduleItem))],
  ['tasks', 'status', onTask(item => ({ ...item, status: item.status === 'Waiting' ? 'In Progress' : 'Waiting' } as ScheduleItem))],
  ['tasks', 'completed', onTask(item => records(item, 100, day(12)))],
  ['tasks', 'owner', onTask(item => ({ ...item, owner: item.owner === 'Riley' ? 'Sam' : 'Riley' } as ScheduleItem))],
  ['tasks', 'contractor', onTask(item => ({ ...item, contractor: 'Northside Builders' } as ScheduleItem))],
  ['tasks', 'finish date', onTask(item => ({ ...item, finishDate: laterDate(item.finishDate) } as ScheduleItem))],
  ['tasks', 'start date', onTask(item => ({ ...item, startDate: laterDate(item.startDate) } as ScheduleItem))],
  ['tasks', 'name', onTask(item => ({ ...item, taskName: `${item.taskName} phase 2` } as ScheduleItem))],
  ['tasks', 'area', onTask(item => ({ ...item, locationName: item.locationName === 'Lot' ? 'Deck' : 'Lot' } as ScheduleItem))],
  ['tasks', 'priority', onTask(item => ({ ...item, priority: item.priority === 'High' ? 'Low' : 'High' } as ScheduleItem))],
  ['tasks', 'notes field', onTask(item => ({ ...item, notes: 'Two coats.' } as ScheduleItem))],
  ['tasks', 'next action', onTask(item => ({ ...item, nextAction: 'Call the supplier' } as ScheduleItem))],
  ['tasks', 'milestone', onTask(item => ({ ...item, isMilestone: !item.isMilestone } as ScheduleItem))],
  ['tasks', 'schedule impact', onTask(item => controls(item, { estimatedScheduleImpactDays: (normalizeProjectControls(item.projectControls).estimatedScheduleImpactDays ?? 0) + 2 }))],
  ['tasks', 'impact notes', onTask(item => controls(item, { impactNotes: 'Waiting on the utility.' }))],
  ['tasks', 'workflow stage', onTask(item => controls(item, { workflowStage: 'In Review' }))],
  ['tasks', 'response due date', onTask(item => controls(item, { responseDueDate: '10/20/2026' }))],
  ['tasks', 'reference number', onTask(item => controls(item, { referenceNumber: 'RFI-12' }))],
  ['tasks', 'a checklist item done', onTask(item => controls(item, { checklist: [{ id: 'check-1', label: 'Walkthrough', completed: true }] }))],
  ['tasks', 'a dependency', onTask((item, rand, world) => { const other = shown(world).find(row => row.id !== item.id); return other ? { ...item, dependencies: [{ predecessorItemId: other.id, type: 'FS', lagDays: 0 }] } as unknown as ScheduleItem : null; })],
  ['tasks', 'when he confirmed the percent', onTask(item => ({ ...item, progressSource: 'project_manager', progressConfirmedAt: day(12.5), progressConfirmedBy: 'David' } as ScheduleItem))],
  ['tasks', 'the day a master completed it', onTask(item => ({ ...item, percentComplete: 100, status: 'Complete', fileProgressPeak: { percentComplete: 100, statedAt: day(12.25) } } as unknown as ScheduleItem))],
  ['tasks', 'last-saved time', onTask(item => ({ ...item, updatedAt: day(12.75) } as ScheduleItem))],
  ['tasks', 'baseline finish', onTask(item => ({ ...item, baselineFinishDate: '10/30/2026' } as ScheduleItem))],
  ['tasks', 'which earlier rows it answers to (none)', onTask(item => (scheduleTaskEarlierIds(item).some(id => id !== item.id) ? { ...item, revisedFromTaskIds: [] } as ScheduleItem : null))],
  ['tasks', 'which earlier rows it answers to (one more)', onTask((item, rand, world) => { const hidden = world.items.find(row => row.id !== item.id && !shown(world).some(visible => visible.id === row.id) && !scheduleTaskEarlierIds(item).includes(row.id)); return hidden ? { ...item, revisedFromTaskIds: [...(item.revisedFromTaskIds ?? []), hidden.id] } as ScheduleItem : null; })],
  ['tasks', 'which earlier rows it answers to (a row no longer saved)', onTask(item => ({ ...item, revisedFromTaskIds: [...(item.revisedFromTaskIds ?? []), 'a-row-deleted-long-ago'] } as ScheduleItem))],
  ['tasks', 'a row he said it is not', onTask((item, rand, world) => { const other = world.items.find(row => row.id !== item.id); return other ? { ...item, notRevisionOfTaskIds: [other.id] } as unknown as ScheduleItem : null; })],
  ['tasks', 'that a lookahead added it', onTask(item => ({ ...item, importedAsLookahead: !item.importedAsLookahead } as unknown as ScheduleItem))],
  ['tasks', 'a task removed', (world, rand) => { const task = aTask(world, rand); return task ? { ...world, items: world.items.filter(item => item.id !== task.id) } : null; }],
  // approvals
  ['approvals', 'approval status', onTask(item => controls(item, { approvalStatus: normalizeProjectControls(item.projectControls).approvalStatus === 'Approved' ? 'Rejected' : 'Approved' }))],
  // activity notes
  ['activity notes', 'a note typed', onTask(item => ({ ...item, activity: [...(item.activity ?? []), note('note-new', 'Second coat started.', day(12.5))] } as ScheduleItem))],
  ['activity notes', 'the latest note reworded', onTask(item => { const latest = latestNote(item); return latest ? { ...item, activity: (item.activity ?? []).map(entry => (entry === latest ? { ...entry, message: `${entry.message} Again tomorrow.` } : entry)) } as ScheduleItem : null; })],
  ['activity notes', 'the latest note deleted', onTask(item => { const latest = latestNote(item); return latest ? { ...item, activity: (item.activity ?? []).filter(entry => entry !== latest) } as ScheduleItem : null; })],
  ['activity notes', 'the latest note\'s time', onTask(item => { const latest = latestNote(item); return latest ? { ...item, activity: (item.activity ?? []).map(entry => (entry === latest ? { ...entry, createdAt: day(12.9) } : entry)) } as ScheduleItem : null; })],
  // earlier (hidden) rows of the tasks shown
  ['earlier rows', 'percent', onEarlierRow(item => ({ ...item, percentComplete: ((item.percentComplete || 0) + 10) % 100 } as ScheduleItem))],
  ['earlier rows', 'status', onEarlierRow(item => ({ ...item, status: item.status === 'Waiting' ? 'In Progress' : 'Waiting' } as ScheduleItem))],
  ['earlier rows', 'owner', onEarlierRow(item => ({ ...item, owner: item.owner === 'Riley' ? 'Sam' : 'Riley' } as ScheduleItem))],
  ['earlier rows', 'finish date', onEarlierRow(item => ({ ...item, finishDate: laterDate(item.finishDate) } as ScheduleItem))],
  ['earlier rows', 'approval status', onEarlierRow(item => controls(item, { approvalStatus: normalizeProjectControls(item.projectControls).approvalStatus === 'Approved' ? 'Rejected' : 'Approved' }))],
  ['earlier rows', 'schedule impact', onEarlierRow(item => controls(item, { estimatedScheduleImpactDays: (normalizeProjectControls(item.projectControls).estimatedScheduleImpactDays ?? 0) + 2 }))],
  ['earlier rows', 'name', onEarlierRow(item => ({ ...item, taskName: `${item.taskName} phase 2` } as ScheduleItem))],
  ['earlier rows', 'area', onEarlierRow(item => ({ ...item, locationName: item.locationName === 'Lot' ? 'Deck' : 'Lot' } as ScheduleItem))],
  ['earlier rows', 'when it was imported', onEarlierRow(item => ({ ...item, importedAt: day(0.5) } as ScheduleItem))],
  ['earlier rows', 'that a lookahead added it', onEarlierRow(item => ({ ...item, importedAsLookahead: !item.importedAsLookahead } as unknown as ScheduleItem))],
  ['earlier rows', 'a note typed on it', onEarlierRow(item => ({ ...item, activity: [...(item.activity ?? []), note('note-old-row', 'Typed on the old row.', day(12.5))] } as ScheduleItem))],
  ['earlier rows', 'priority', onEarlierRow(item => ({ ...item, priority: item.priority === 'High' ? 'Low' : 'High' } as ScheduleItem))],
  ['earlier rows', 'the row deleted', (world, rand) => { const row = anEarlierRow(world, rand); return row ? { ...world, items: world.items.filter(item => item.id !== row.id) } : null; }],
  // field updates
  ['field updates', 'one filed', (world, rand) => { const task = aTask(world, rand); return task ? { ...world, updates: [...world.updates, fieldUpdate('u-new', task, day(12.5), `Blocked: waiting on inspector for ${task.taskName}.`)] } : null; }],
  ['field updates', 'one deleted', (world, rand) => (world.updates.length ? { ...world, updates: world.updates.filter(update => update !== pick(rand, world.updates)) } : null)],
  ['field updates', 'its words', onUpdate(update => ({ ...update, notes: `${update.notes} Complete and inspected.` } as ProjectUpdate))],
  ['field updates', 'its date', onUpdate(update => ({ ...update, date: day(12.5) } as ProjectUpdate))],
  ['field updates', 'the task it is on', onUpdate((update, rand, world) => { const other = shown(world).find(item => item.id !== update.scheduleItemId); return other ? { ...update, scheduleItemId: other.id, scheduleTaskName: other.taskName } as ProjectUpdate : null; })],
  ['field updates', 'its area', onUpdate(update => ({ ...update, selectedAreaName: update.selectedAreaName === 'Lot' ? 'Deck' : 'Lot' } as ProjectUpdate))],
  ['field updates', 'the name it is filed under', onUpdate(update => ({ ...update, projectName: update.projectName === 'Alpha' ? 'Building 7' : 'Alpha', scheduleProjectName: undefined } as unknown as ProjectUpdate))],
  ['field updates', 'its GPS fix', onUpdate(update => ({ ...update, gpsLatitude: 37.105, gpsLongitude: -122.105, gpsAccuracy: 12, locationCapturedAt: day(12.5) } as unknown as ProjectUpdate))],
  // photos and comparisons
  ['photos', 'a photo added, its comparison confirmed', onUpdate(update => ({ ...update, photos: [...(update.photos ?? []), photo(`${update.id}-new`, update.selectedAreaName || 'Lot', true)] } as unknown as ProjectUpdate))],
  ['photos', 'a photo removed', onPhoto(() => null)],
  ['photos', 'its caption', onPhoto(entry => ({ ...entry, caption: 'North wall, after primer' }))],
  ['photos', 'its area', onPhoto(entry => ({ ...entry, selectedAreaName: entry.selectedAreaName === 'Lot' ? 'Deck' : 'Lot' }))],
  ['photos', 'an action it asks for', onPhoto(entry => ({ ...entry, actionRequired: 'Clean up debris', actionStatus: 'Open' }))],
  ['photos', 'where the file sits on the device', onPhoto(entry => ({ ...entry, uri: 'file:///another/folder/photo.jpg' }))],
  ['comparisons', 'he marked it incorrect', onComparison({ userReview: 'incorrect' })],
  ['comparisons', 'what changed since the prior photo', onComparison({ changedFromPrior: 'Second coat applied since the prior photo.' })],
  ['comparisons', 'what it shows now', onComparison({ currentObservation: 'Both walls primed.' })],
  ['comparisons', 'whether progress is supported', onComparison({ projectProgress: 'unsupported' })],
  ['comparisons', 'how well the pair compares', onComparison({ comparability: 'weak' })],
  ['comparisons', 'its findings', onComparison({ findings: [{ findingType: 'uncertain', description: 'Tape lines' }] })],
  // schedule documents
  ['documents', 'the schedule\'s name', onDocument(currentSchedule, document => ({ ...document, name: `${document.name} rev B` }))],
  ['documents', 'the schedule\'s notes', onDocument(currentSchedule, document => ({ ...document, notes: 'Issued for construction.' }))],
  ['documents', 'when the schedule was imported', onDocument(currentSchedule, document => ({ ...document, importedAt: day(12.5) }))],
  ['documents', 'the schedule no longer current', onDocument(currentSchedule, document => ({ ...document, isCurrent: false }))],
  ['documents', 'where the schedule file sits, and the device\'s note of its cloud row', onDocument(currentSchedule, document => ({ ...document, uri: 'file:///another/folder/schedule.csv', cloudUpdatedAt: day(12.5) } as ReferenceDocument))],
  ['documents', 'the text read out of the schedule file', onDocument(currentSchedule, document => ({ ...document, extractedText: 'SCHEDULE TEXT', extractionStatus: 'complete' } as unknown as ReferenceDocument))],
  // lookaheads
  ['lookaheads', 'a lookahead filed as a full schedule', onDocument(isLookahead, document => { const { scheduleRole: _role, ...rest } = document as ReferenceDocument & { scheduleRole?: string }; return rest as ReferenceDocument; })],
  ['lookaheads', 'a lookahead no longer current', onDocument(isLookahead, document => ({ ...document, isCurrent: false }))],
  ['lookaheads', 'a lookahead\'s file removed (its tasks kept)', (world, rand) => { const files = world.documents.filter(isLookahead); if (files.length === 0) return null; const gone = pick(rand, files); return { ...world, documents: world.documents.filter(document => document !== gone) }; }],
  ['lookaheads', 'when a lookahead was imported', onDocument(isLookahead, document => ({ ...document, importedAt: day(12.5) }))],
  ['lookaheads', 'a detail task\'s percent', (world, rand) => { const details = world.items.filter(item => (item as unknown as { importedAsLookahead?: boolean }).importedAsLookahead === true); if (details.length === 0) return null; const target = pick(rand, details); return withItem(world, target.id, item => ({ ...item, percentComplete: 100, status: 'Complete' } as ScheduleItem)); }],
  // drawings and what is cited of them
  ['drawings', 'its revision', onDocument(isDrawing, document => ({ ...document, drawingRevision: 'D' } as unknown as ReferenceDocument))],
  ['drawings', 'marked Superseded', onDocument(isDrawing, document => ({ ...document, drawingStatus: 'Superseded' } as unknown as ReferenceDocument))],
  ['drawings', 'no longer current', onDocument(isDrawing, document => ({ ...document, isCurrent: false }))],
  ['drawings', 'its name', onDocument(isDrawing, document => ({ ...document, name: 'A-201 Site plan (issued)' }))],
  ['drawings', 'its pages not read yet', onDocument(isDrawing, document => ({ ...document, extractionStatus: 'pending', extractedPages: [] } as unknown as ReferenceDocument))],
  ['drawings', 'the area found on another page', onDocument(isDrawing, document => ({ ...document, extractedPages: pages(document).map(page => ({ ...page, pageNumber: 2 })) } as unknown as ReferenceDocument))],
  ['drawings', 'the page\'s sheet number read', onDocument(isDrawing, document => ({ ...document, extractedPages: pages(document).map(page => ({ ...page, sheetNumber: 'A-201' })) } as unknown as ReferenceDocument))],
  ['drawings', 'the area no longer found with confidence', onDocument(isDrawing, document => ({ ...document, extractedPages: pages(document).map(page => ({ ...page, regions: page.regions.map(region => ({ ...region, confidence: 0.4 })) })) } as unknown as ReferenceDocument))],
  ['drawings', 'where on the page the area is', onDocument(isDrawing, document => ({ ...document, extractedPages: pages(document).map(page => ({ ...page, regions: page.regions.map(region => ({ ...region, x: 0.2, y: 0.2 })) })) } as unknown as ReferenceDocument))],
  ['drawings', 'where the drawing file sits, and its text', onDocument(isDrawing, document => ({ ...document, uri: 'file:///another/folder/a201.pdf', extractedText: null } as unknown as ReferenceDocument))],
  ['drawings', 'a drawing added for the project', world => (world.documents.some(isDrawing) ? null : { ...world, documents: [...world.documents, drawing(AREAS)] })],
  // GPS work areas (the phone's)
  ['areas', 'an area renamed', world => (world.areas.length ? { ...world, areas: world.areas.map((area, index) => (index === 0 ? { ...area, name: 'Parking lot' } : area)) as ProjectArea[] } : null)],
  ['areas', 'an area moved', world => (world.areas.length ? { ...world, areas: world.areas.map((area, index) => (index === 0 ? { ...area, latitude: 37.2, radiusFeet: 300 } : area)) as ProjectArea[] } : null)],
  ['areas', 'an area added', world => ({ ...world, areas: [...world.areas, { id: 'area-roof', projectName: 'Alpha', name: 'Roof', latitude: 37.3, longitude: -122.3, radiusFeet: 100 }] as unknown as ProjectArea[] })],
  ['areas', 'an area removed', world => (world.areas.length ? { ...world, areas: world.areas.slice(1) } : null)],
];

const SEEDS = Math.max(1, Number(process.env.R8_SEEDS) || 5);
/** Working a project through every change is slow work, not waiting: a few seconds alone, more on a busy machine. */
const TIME_FOR_A_PROJECT = 240_000;
const FIRST = Math.max(1, Number(process.env.R8_FIRST) || 1);

describe('R8 item 4: whenever one change to an input moves the written report or what an approval saves, the fingerprint moves', () => {
  const tally = { projects: 0, tried: 0, movedTheReport: 0, movedOnlyTheFingerprint: 0, movedNothing: 0 };
  const byFamily = new Map<string, { tried: number; movedTheReport: number }>();
  const onlyTheFingerprint = new Map<string, number>();
  const falseMatches: string[] = [];
  const road230 = { tried: 0, stillTheSavedReport: 0 };

  it.each(Array.from({ length: SEEDS }, (_, index) => FIRST + index))('project %i', seed => {
    const { world, period, period230, now } = project(seed);
    const before = { phone: phoneScreen(world, period, now), web: webPage(world, period, now) };
    // R9, the 1.0 road: today's report as Build 230 saved it, counted from a report this build sent, and from one Build 230 sent.
    const today230 = { ...before.phone.snapshot, sourceFingerprint: buildDAVELegacyReportSourceFingerprint(before.phone.truths) } as DAVEReportSnapshot;
    const savedOn230 = [period, period230].map(countedFrom => markReportSnapshotDelivered((reportSnapshotToSave(today230, countedFrom) ?? today230) as DAVEReportSnapshot, now, 'phone'));
    const before230 = savedOn230.map(saved => ({
      phone: phoneScreen(world, saved, now).report, web: webPage(world, saved, now).report,
      // Not where today's report counts other field updates than Build 230's did: no 1.0 name stands there (R7 item A).
      taken: sameReportSource(saved.sourceFingerprint, before.phone.fingerprint),
    }));
    // (the rig) The project has a report to count from, and the phone and the web have one fingerprint for it.
    expect(period).not.toBeNull();
    expect(before.web.fingerprint).toBe(before.phone.fingerprint);
    tally.projects += 1;
    const rand = seeded(seed * 104729 + 7);
    for (const [family, what, make] of CHANGES) {
      const changed = make(world, rand);
      if (!changed) continue;
      const after = { phone: phoneScreen(changed, period, now), web: webPage(changed, period, now) };
      tally.tried += 1;
      const counts = byFamily.get(family) ?? { tried: 0, movedTheReport: 0 };
      counts.tried += 1;
      let reportMoved = false; let fingerprintMoved = false;
      for (const side of ['phone', 'web'] as const) {
        const report = after[side].report !== before[side].report;
        const fingerprint = after[side].fingerprint !== before[side].fingerprint;
        reportMoved = reportMoved || report; fingerprintMoved = fingerprintMoved || fingerprint;
        if (report && !fingerprint) {
          const was = before[side].report.split('\n'); const is = after[side].report.split('\n');
          const line = is.find(text => !was.includes(text)) ?? was.find(text => !is.includes(text)) ?? '';
          falseMatches.push(`project ${seed}, ${side}: ${family}: ${what}  =>  ${line.slice(0, 200)}`);
        }
      }
      if (family === 'earlier rows') {
        savedOn230.forEach((saved, road) => (['phone', 'web'] as const).forEach(side => {
          const is = (side === 'phone' ? phoneScreen : webPage)(changed, saved, now);
          road230.tried += 1;
          // Taken for the report Build 230 saved, before the change and after it (the 1.0 name does not hold the row):
          // then not a word may differ.
          if (!before230[road].taken || !sameReportSource(saved.sourceFingerprint, is.fingerprint)) return;
          road230.stillTheSavedReport += 1;
          if (is.report !== before230[road][side]) {
            const was = before230[road][side].split('\n'); const lines = is.report.split('\n');
            falseMatches.push(`project ${seed}, ${side}, read as the report Build 230 saved (${road === 0 ? 'counted from a report of this build' : 'counted from one of Build 230\'s'}): ${family}: ${what}  =>  ${(lines.find(text => !was.includes(text)) ?? was.find(text => !lines.includes(text)) ?? '').slice(0, 200)}`);
          }
        }));
      }
      if (reportMoved) { tally.movedTheReport += 1; counts.movedTheReport += 1; }
      else if (fingerprintMoved) { tally.movedOnlyTheFingerprint += 1; onlyTheFingerprint.set(`${family}: ${what}`, (onlyTheFingerprint.get(`${family}: ${what}`) ?? 0) + 1); }
      else tally.movedNothing += 1;
      byFamily.set(family, counts);
    }
  }, TIME_FOR_A_PROJECT);

  it('no change moved the report under one fingerprint, and every kind of input was put to the test', () => {
    if (process.env.R8_OUT) {
      require('fs').writeFileSync(process.env.R8_OUT, JSON.stringify({
        ...tally, changesOfAKind: CHANGES.length, byFamily: Object.fromEntries(byFamily), road230,
        movedOnlyTheFingerprint_byChange: Object.fromEntries([...onlyTheFingerprint].sort((left, right) => right[1] - left[1])), falseMatches,
      }, null, 1));
    }
    expect(falseMatches).toEqual([]);
    // The guard cannot pass by testing nothing: every family of input was tried, and all but the phone's GPS work
    // areas moved the report somewhere. (A work area decides nothing a report says, so the links worked out from
    // them stay out of the fingerprint, as R4 left them: the web does not have them.)
    expect([...byFamily.keys()].sort()).toEqual(['activity notes', 'approvals', 'areas', 'comparisons', 'documents', 'drawings', 'earlier rows', 'field updates', 'lookaheads', 'photos', 'tasks']);
    // Open item 7.17 (13 Oct 2026): a task that is back is read from how the last report that listed it had it, kept
    // with the reports saved since; its hidden earlier rows are read only for a report counted from one saved before
    // that record began. In this rig every report is saved with it, so a change to an earlier row moves no report
    // (the fingerprint still holds them: such a change offers the report once more, the safe side). Moved deliberately.
    expect([...byFamily].filter(([, counts]) => counts.movedTheReport === 0).map(([family]) => family).sort()).toEqual(['areas', 'earlier rows']);
    expect(tally.movedTheReport).toBeGreaterThan(tally.projects * 20);
    // R9: the 1.0 road was walked. R10 (the coordinator's decision on review pass 3, P3-2) closed it: no 1.0 name
    // stands, so today's report is never taken for one Build 230 saved and there is nothing on that road to move.
    // (This said "and the report was still taken for the one Build 230 saved": greater than 0.) The walk stays: were a
    // 1.0 name offered again, this count would rise and any report moved under it would be listed above.
    expect(road230.tried).toBeGreaterThan(0);
    expect(road230.stillTheSavedReport).toBe(0);
  });
});

describe('R8 items 3 and 4: what today\'s fingerprint version holds that the earlier version leaves out', () => {
  /** The report's own records, by where they sit: on the truth, or on each task of it. */
  const ON_THE_TRUTH = ['earlierRows', 'lookaheadAddedTaskIds', 'lookaheadReplacement'] as const;
  const ON_A_TASK = ['earlierTaskIds', 'notTaskIds', 'onLookaheadDates', 'replacedLookaheadDates'] as const;
  const without = (truth: DAVEProjectTruth, field: string): DAVEProjectTruth => {
    const { [field]: _gone, ...rest } = truth as unknown as Record<string, unknown>;
    return { ...rest, schedule: truth.schedule.map(task => { const { [field]: _taken, ...kept } = task as unknown as Record<string, unknown>; return kept; }) } as unknown as DAVEProjectTruth;
  };
  const holds = (truth: DAVEProjectTruth, field: string) => (ON_THE_TRUTH as readonly string[]).includes(field)
    ? (truth as unknown as Record<string, unknown>)[field] !== undefined
    : truth.schedule.some(task => (task as unknown as Record<string, unknown>)[field] !== undefined);

  // HIGH item 1d (open item 7.55): the earlier rows are held where they print ("since the last report", counted from the
  // report it counts from; R8 item 3's own test asks that rule), not as records: taking them away from a truth moves
  // today's version only where a word moves. The others are records the Project Manager report's WORK AREAS section is
  // written from, held as such.
  const HELD_WHERE_PRINTED = ['earlierRows'];
  it('each of them moves today\'s version when it is taken away (the earlier rows: where they print), and never the version an earlier build wrote', () => {
    const met = new Set<string>();
    for (let seed = 1; seed <= 14; seed += 1) {
      const { world, period, now } = project(seed);
      // He has also said of one task that it is not a row of an earlier schedule (the import review's "New work").
      const answered = withItem(world, shown(world)[0].id, item => ({ ...item, notRevisionOfTaskIds: [world.items[0].id] } as unknown as ScheduleItem));
      const [truth] = phoneScreen(answered, period, now).truths;
      for (const field of [...ON_THE_TRUTH, ...ON_A_TASK]) {
        if (!holds(truth, field)) continue;
        met.add(field);
        if (!HELD_WHERE_PRINTED.includes(field)) {
          expect([field, buildDAVEReportSourceFingerprint([without(truth, field)]) === buildDAVEReportSourceFingerprint([truth])]).toEqual([field, false]);
        }
        const asBuilt = daveProjectTruthAsBuilt(truth);
        expect([field, buildDAVELegacyReportSourceFingerprint([without(asBuilt, field)])]).toEqual([field, buildDAVELegacyReportSourceFingerprint([asBuilt])]);
      }
    }
    // Every one of them was met in these projects, so none is passed over.
    expect([...met].sort()).toEqual([...ON_THE_TRUTH, ...ON_A_TASK].sort());
  }, TIME_FOR_A_PROJECT);
});
