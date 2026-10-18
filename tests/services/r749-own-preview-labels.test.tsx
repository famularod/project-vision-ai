// 7.45: mounted edit/discard lifecycle with synthetic saved field notes.
const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
  getAllKeys: jest.fn(async () => Array.from(mockStorage.keys())),
  multiGet: jest.fn(async (keys: string[]) => keys.map(key => [key, mockStorage.get(key) ?? null])),
}));
jest.mock('../../services/SupabaseService', () => ({
  loadReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
  saveReportSnapshotCloud: jest.fn(async () => ({ ok: true, configured: true, data: null, stubbed: true })),
}));
let mockAuthority: Record<string, unknown>;
jest.mock('../../providers/PIELiveAuthorityProvider', () => ({
  usePIELiveAuthority: () => mockAuthority,
  useOptionalPIELiveAuthority: () => mockAuthority,
}));
jest.mock('react-native-reanimated', () => ({ getUseOfValueInStyleWarning: () => '' }));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ReportsScreen } from '../../screens/ReportsScreen';
import { forgetAllReportSessionState } from '../../services/ReportSessionState';
import { buildRuntime } from '../../services/PIERuntime';
import JSZip from 'jszip';
import { buildReportWordBase64 } from '../../services/ReportWordDocument';
import { buildDAVEWebReportDraft, formatDAVEWebReport } from '../../services/DAVEWebOperations';
import baseline from '../fixtures/r749-written-baseline.json';
import type { ProjectUpdate, ScheduleItem } from '../../types';

jest.setTimeout(120_000);

const task = (id: string, taskName: string, finishDate: string, percentComplete = 40) => ({
  id, projectName: 'Tower', locationName: 'Level 2', taskName,
  startDate: '2026-09-01', finishDate, milestone: '', owner: 'Dana', contractor: 'Acme',
  percentComplete, priority: 'Medium', status: 'In Progress', notes: '', createdAt: '2026-09-01T12:00:00.000Z',
}) as unknown as ScheduleItem;
const SAVED = [task('pour', 'Pour slab', '2027-06-30'), task('frame', 'Frame walls', '2027-03-31'), task('roof', 'Roofing', '2027-06-30'), task('dig', 'Excavate', '2026-12-15')];
const onCopyReport = jest.fn(async () => 'completed' as const);
const onEmailReport = jest.fn(async () => 'completed' as const);
const onTextReport = jest.fn(async () => 'completed' as const);
const onOutlookReport = jest.fn(async () => 'unknown' as const);
const onDownloadWordReport = jest.fn(async () => 'unknown' as const);
const shares = [onCopyReport, onEmailReport, onTextReport, onOutlookReport, onDownloadWordReport];
let notes: ProjectUpdate[] = [];
const screenFor = (scheduleItems: ScheduleItem[]) => (
  <ReportsScreen
    projectName="Tower"
    reportType="daily_project_update"
    onReportTypeChange={() => undefined}
    availableProjectNames={['Tower']}
    selectedProjectNames={['Tower']}
    onToggleProject={() => undefined}
    reportFormat="project_manager"
    onReportFormatChange={() => undefined}
    updates={notes}
    scheduleItems={scheduleItems}
    knownScheduleItems={scheduleItems}
    onSavedUpdates={() => undefined}
    onCopyReport={onCopyReport}
    onEmailReport={onEmailReport}
    onTextReport={onTextReport}
    onDownloadWordReport={onDownloadWordReport}
    onOutlookReport={onOutlookReport}
  />
);
const settled = async () => {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
  await waitFor(() => expect(screen.queryByText('The reporting period is still loading.')).toBeNull());
};

beforeEach(() => {
  mockStorage.clear();
  forgetAllReportSessionState();
  onCopyReport.mockClear();

});


// The provider boundary is local; both the incoming runtime/report and the screen's
// Project Truth/fingerprint are built by production code from synthetic saved notes.
function publishNotes(next: ProjectUpdate[]) {
  notes = next;
  const runtime = buildRuntime({ projectName: 'Tower', projectNames: ['Tower'], updates: notes,
    scheduleItems: SAVED, knownScheduleItems: SAVED, reportType: 'daily_project_update',
    now: new Date('2026-10-17T12:00:00Z') });
  mockAuthority = { state: 'ready', policy: { reportGenerationAllowed: true, layer4DecisionCreationAllowed: false },
    reportDraft: runtime.response.reportDraft, runtime, executiveJudgmentRecord: null };
}
const freshNote: ProjectUpdate = { id: 'fresh-note', projectName: 'Tower', date: '2026-10-17T11:00:00Z',
  photos: [], notes: 'The north gate inspection was completed today.', recipients: { contactIds: [] }, status: 'sent' };



const fixture = (mode:'plain'|'photo'|'progress'):ProjectUpdate => ({...freshNote,id:`label-${mode}`,date:'2026-10-17T11:00:00Z',selectedAreaName:'Level 2',notes:mode==='plain'?'Radio batteries were swapped.':mode==='progress'?'Concrete columns installed in the east bay.':'',photos:mode==='photo'?[{id:'label-photo',uri:'file:///synthetic/label-photo.jpg',caption:'Concrete slab was placed at the east bay.',category:'Update',selectedAreaName:'Level 2',actionRequired:'',actionOwner:'',actionDueDate:'',actionStatus:'Open'}]:[]} as ProjectUpdate);
function publishLabelFixture(mode:'plain'|'photo'|'progress'){
 notes=[fixture(mode)];const runtime=buildRuntime({projectName:'Tower',projectNames:['Tower'],updates:notes,scheduleItems:[],knownScheduleItems:[],reportType:'daily_project_update',now:new Date('2026-10-17T12:00:00Z')});mockAuthority={state:'ready',policy:{reportGenerationAllowed:true,layer4DecisionCreationAllowed:false},reportDraft:runtime.response.reportDraft,runtime,executiveJudgmentRecord:null};expect(runtime.photoProgress.acceptedEvidence).toEqual([]);return runtime.response.reportDraft;
}
it.each([['plain','Field note'],['photo','Photo']] as const)('7.49 actual %s producer and mounted own area card classify truthfully',async(mode,label)=>{
 const draft=publishLabelFixture(mode);const words=mode==='plain'?'Radio batteries were swapped':'Concrete slab was placed';const bullet=draft.locationGroups.flatMap(g=>g.workAreas).flatMap(a=>a.bullets).find(b=>b.text.includes(words));expect(bullet).toBeTruthy();expect(bullet!.kind).toBe('progress');expect(bullet!.needsReview).toBe(baseline[mode].bullet.needsReview);expect(bullet!.id).toBe(baseline[mode].bullet.id);expect(bullet!.sourceEvidenceIds).toEqual(baseline[mode].bullet.sourceEvidenceIds);expect(draft.body).toBe(baseline[mode].body);expect(draft.locationGroups.flatMap(g=>g.workAreas).flatMap(a=>a.bullets).filter(b=>b.kind==='progress').every(b=>b.previewKind===(mode==='plain'?'field_note':'photo'))).toBe(true);console.log('R749_PRODUCTION_FIXTURE',JSON.stringify({mode,bullet,body:draft.body}));
 const view=render(screenFor([]));await settled();expect(screen.getAllByText(new RegExp(`^${label}: ${words}`)).length).toBeGreaterThan(0);expect(notes).toEqual([fixture(mode)]);for(const share of shares)expect(share).not.toHaveBeenCalled();view.unmount();
});
it('7.49 an actual authored construction progress line remains Progress',async()=>{const draft=publishLabelFixture('progress');expect(draft.locationGroups.flatMap(g=>g.workAreas).flatMap(a=>a.bullets).some(b=>b.text.includes('Concrete columns installed'))).toBe(true);const view=render(screenFor([]));await settled();expect(screen.getAllByText('Progress:',{exact:false}).length).toBeGreaterThan(0);view.unmount();});

it.each(['plain','photo'] as const)('7.49 %s written native/Word/desktop consumers keep established words',async mode=>{
 const draft=publishLabelFixture(mode);expect(draft.body).toBe(baseline[mode].body);expect(draft.body).not.toContain('Field note:');
 const zip=await JSZip.loadAsync(Buffer.from(await buildReportWordBase64({title:draft.title,body:draft.body,generatedAt:'2026-10-17T12:00:00Z'}),'base64'));const xml=await zip.file('word/document.xml')!.async('string');expect(xml).toContain(mode==='plain'?'Progress: Radio batteries were swapped.':'Progress: Concrete slab was placed at the east bay.');expect(xml).not.toContain('Field note:');
 const web={projects:[{id:'tower',name:'Tower'}],scheduleItems:[],knownScheduleItems:[],projectUpdates:notes.map(updateData=>({updateData})),referenceDocuments:[],projectAreas:[],refreshedAt:'2026-10-17T12:00:00Z',tasksPulledAt:'2026-10-17T12:00:00Z'};const text=formatDAVEWebReport(buildDAVEWebReportDraft(web as never,null),'project_manager');expect(text).not.toContain('Field note:');expect(notes).toEqual([fixture(mode)]);
});
