jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), getAllKeys: jest.fn(async () => []) } }));
import { buildDailyProjectUpdate } from '../../services/PIEReporter';
import { buildFusedEvidence } from '../../services/PIEEvidenceFusion';
import type { ProjectUpdate } from '../../types';
const note = (id: string, notes: string, photos: unknown[] = []) => ({ id, projectName: 'Tower', scheduleProjectName: 'Tower', date: '2026-10-14', photos, recipients: { contactIds: [] }, notes, status: 'sent', selectedAreaName: 'Roof' }) as ProjectUpdate;
const draft = (updates: ProjectUpdate[], runtime?: unknown) => buildDailyProjectUpdate({ selectedProjectNames: ['Tower'], savedUpdates: updates, scheduleItems: [], runtime } as never);
const lines = (report: ReturnType<typeof draft>) => report.locationGroups.flatMap(g => g.workAreas.flatMap(a => a.bullets.map(b => b.text)));
it.each(['Roof inspection photos were captured for the owner.', 'Dimensions captured for the glazier.', 'Signatures were captured for the lender.'])('retains a real field note: %s', text => {
 expect(lines(draft([note('u1', text)]))).toContain(text);
});
it.each(['Roof inspection photos were captured for the owner.', 'Signatures were captured for the lender.'])('retains the runtime Latest update sentence: %s', text => {
 const updates = [note('u1', text)];
 const runtime = buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates, scheduleItems: [], knownScheduleItems: [], now: new Date('2026-10-15T12:00:00Z') });
 expect(draft(updates, { fusedEvidence: runtime, intelligentSummary: runtime.intelligentSummary }).body).toContain(`Latest update: ${text}`);
});
it('capitalizes an ownerless action after stripping Please', () => {
 expect(lines(draft([note('u1', 'Please confirm the delivery date for the storefront.')]))).toContain('Confirm the delivery date for the storefront.');
});

it.each(['iPhone delivery must be confirmed.', 'eBay receipt must be verified.', 'RFI response is needed.', 'Dana must confirm the delivery.'])('keeps case within the action: %s', text => {
 const report = draft([note('u1', `Please ${text}`)]);
 expect(report.actionItems[0]?.action).toBe(text);
});
it('machine runtime captured-for boilerplate is still suppressed', () => {
 const report = draft([], { intelligentSummary: { whatChanged: 'Roof photos captured for runtime analysis.' } });
 expect(lines(report)).toEqual([]);
});
it('keeps the three-line allowance and cites the restored note own photo', () => {
 const ownPhoto = { id: 'p1', uri: 'file:///p1.jpg', caption: 'Roof inspection', category: 'Progress', selectedAreaName: 'Roof', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open' };
 const report = draft([note('u4', 'Roof inspection photos were captured for the owner.', [ownPhoto]), note('u3', 'Roof membrane was installed.'), note('u2', 'Roof flashing was installed.'), note('u1', 'Roof curb was installed.')]);
 const area = report.locationGroups.flatMap(g => g.workAreas).find(a => a.title === 'Roof');
 expect(area?.bullets.filter(b => b.kind !== 'image_reference')).toHaveLength(3);
 expect(lines(report).filter(text => /See Image 1/.test(text))).toHaveLength(1);
 expect(lines(report).find(text => /captured for/.test(text))).toContain('See Image 1');
});

const COLLISIONS = [
 'Signatures were captured for the project area access permit.',
 'GPS was captured for the survey control check.',
 'Location was captured for the survey control check.',
 'Evidence was fused and runtime indicates signatures were captured for the permit.',
 'Photo captured for the project area access permit.',
 'Signatures were captured for the $& lender permit.',
 'GPS was captured for the \uE000 survey control check.',
];
it.each(COLLISIONS)('preserves authored captured-for words through all cleaning: %s', text => {
 const updates = [note('u1', text)];
 expect(lines(draft(updates))).toContain(text);
 const fused = buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates, scheduleItems: [], knownScheduleItems: [], now: new Date('2026-10-15T12:00:00Z') });
 const report = draft(updates, { fusedEvidence: fused, intelligentSummary: fused.intelligentSummary });
 expect(lines(report)).toContain(text);
 expect(report.body).toContain(`Latest update: ${text}`);
});
it.each(COLLISIONS)('does not exempt unauthored runtime merely for its words: %s', text => {
 expect(lines(draft([], { intelligentSummary: { whatChanged: text } }))).not.toContain(text);
});
it.each(COLLISIONS)('accepted provider text is not authored, while an owner edit is: %s', text => {
 const accepted = { ...note('u1', text), pieSuggestedNote: text, pieSuggestedNoteAccepted: true };
 expect(lines(draft([accepted]))).not.toContain(text);
 const edited = { ...accepted, notes: `${text} Field record complete.` };
 expect(lines(draft([edited]))).toContain(edited.notes);
});

it('protects only the authored Latest update span, leaving machine photo suffixes suppressed', () => {
 const text = 'GPS was captured for the survey control check.';
 const updates = [note('u1', text)];
 const fused = buildFusedEvidence({ projectName: 'Tower', projectNames: ['Tower'], updates, scheduleItems: [], knownScheduleItems: [], now: new Date('2026-10-15T12:00:00Z') });
 const report = draft(updates, { fusedEvidence: { ...fused, photoEvidence: [{ updateId: 'u1', caption: 'Roof photo captured for runtime analysis.' }] }, intelligentSummary: fused.intelligentSummary });
 expect(report.body).toContain(`Latest update: ${text}`);
 expect(report.body).not.toContain('runtime analysis');
});
it('does not grant authorship to an arbitrary runtime summary without the complete fused recipe', () => {
 const updates = [note('u1', 'Signatures were captured for the lender.')];
 const report = draft(updates, { fusedEvidence: { userUpdateEvidence: updates }, intelligentSummary: { whatChanged: 'GPS was captured for runtime analysis.' } });
 expect(report.body).not.toContain('runtime analysis');
});

it('deduplicates an intact captured-for note and keeps its own photo citation', () => {
 const text = 'GPS was captured for the survey control check.';
 const ownPhoto = { id: 'p1', uri: 'file:///p1.jpg', caption: 'Roof inspection', category: 'Progress', selectedAreaName: 'Roof', actionRequired: '', actionOwner: '', actionDueDate: '', actionStatus: 'Open' };
 const report = draft([note('u2', text, [ownPhoto]), note('u1', text)]);
 const matching = lines(report).filter(line => line.includes(text));
 expect(matching).toHaveLength(1); expect(matching[0]).toContain('See Image 1');
 expect(lines(report).filter(line => /See Image 1/.test(line))).toHaveLength(1);
});
