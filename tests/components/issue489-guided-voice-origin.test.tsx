import {act,fireEvent,render,waitFor} from '@testing-library/react-native';
import {AppState} from 'react-native';
import {ScheduleTaskEditorModal} from '../../components/schedule-task-editor-modal';
import {DAVEVoiceCaptureSheet} from '../../components/DAVEVoiceCaptureSheet';
import {NativeWorkspaceOwnerContext} from '../../components/native-workspace-owner';
import {keptDraftsOnDevice} from '../../services/KeptDraftStore';
import {readKeptVoiceRecording,sweepKeptVoiceRecordings,keptVoiceRecordingExists} from '../../services/KeptVoiceRecording';
import {phone,releaseEveryHold,keptFiles,whatIsIn,hold} from '../fixtures/voice-sheet-phone';
let mockDraftId=0;
jest.mock('expo-crypto',()=>({randomUUID:()=>`draft-${++mockDraftId}`}));
jest.mock('expo-audio',()=>require('../fixtures/voice-sheet-phone').standInExpoAudio());
jest.mock('expo-file-system/legacy',()=>require('../fixtures/voice-sheet-phone').standInFileSystem());
jest.mock('@react-native-async-storage/async-storage',()=>require('../fixtures/voice-sheet-phone').standInAsyncStorage());
jest.mock('@expo/vector-icons/Ionicons',()=> 'Ionicons');
jest.mock('@react-native-community/datetimepicker',()=>({__esModule:true,default:()=>null}));
jest.mock('../../services/DAVEVoiceTranscriptionService',()=>({transcribeDAVECaptureMemoryAudio:jest.fn()}));
const transcribe=jest.requireMock('../../services/DAVEVoiceTranscriptionService').transcribeDAVECaptureMemoryAudio as jest.Mock;
const pause=()=>new Promise(resolve=>setTimeout(resolve,70));
const settle=()=>act(async()=>{await pause();});
let view:ReturnType<typeof render>|undefined;
function editor(visible=true,owner='owner-A') {
 return <NativeWorkspaceOwnerContext.Provider value={owner}><ScheduleTaskEditorModal visible={visible} initiallyGuided projects={['Alpha','Beta']} projectRecords={[{id:'alpha-id',name:'Alpha'},{id:'beta-id',name:'Beta'}]} initialProjectName="Alpha" projectAreas={[]} scheduleItems={[]} onClose={()=>undefined} onSubmit={()=>undefined}/></NativeWorkspaceOwnerContext.Provider>;
}
const voice=()=>view!.UNSAFE_getByType(DAVEVoiceCaptureSheet).props;
beforeEach(()=>{phone.reset();transcribe.mockReset().mockRejectedValue(new Error('Synthetic no connection'));(AppState as {currentState:unknown}).currentState='active';});
afterEach(async()=>{view?.unmount();view=undefined;releaseEveryHold();await pause();});
async function readyFailedAnswer(){
 view=render(editor());
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await view.findByText('Stop & Continue');
 await act(async()=>{phone.recorder.set({durationMillis:5000});});
 fireEvent.press(view.getByText('Stop & Continue'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(1));
 await view.findByText('Review this recording');
 await settle();
}
it('ancestor task editor closes: retained answer never becomes the next draft question answer',async()=>{
 await readyFailedAnswer();
 const originSlot=voice().keepSlot as string;
 expect(JSON.parse(originSlot.slice('task-fill/'.length))).toMatchObject({projectId:'alpha-id',projectName:'Alpha',field:'taskName',question:'What should this task be called?',task:'Unsaved task',draftId:expect.any(String)});
 await act(async()=>{view!.rerender(editor(false));});
 await act(async()=>{view!.rerender(editor(true));});
 fireEvent.press(view!.getByLabelText('Record answer for Task'));
 await settle();
 expect(view!.queryByText('Recording ready')).toBeNull();
 expect(transcribe).toHaveBeenCalledTimes(1);
 const kept=await readKeptVoiceRecording('owner-A',originSlot,'Alpha');
 expect(kept).toMatchObject({projectId:'alpha-id',projectName:'Alpha'});
 expect(whatIsIn(kept!.uri)).toBe('take-1');
 expect(voice().keepSlot).not.toBe(originSlot);
 await sweepKeptVoiceRecordings();
 expect(keptFiles()).toContain(kept!.uri);
 expect(await keptVoiceRecordingExists('owner-A')).toBe(true);
 expect(await keptVoiceRecordingExists('owner-B')).toBe(false);
 expect((await keptDraftsOnDevice('voice-recording'))?.some(entry=>entry.scope.startsWith(originSlot+'/'))).toBe(true);
});
it('project changes underneath open voice sheet: it closes and cannot send original answer under new project',async()=>{
 await readyFailedAnswer();
 const originSlot=voice().keepSlot as string;
 fireEvent.changeText(view!.getByLabelText('Project'),'Beta');
 await settle();
 expect(voice().visible).toBe(false);
 expect(transcribe).toHaveBeenCalledTimes(1);
 const kept=await readKeptVoiceRecording('owner-A',originSlot,'Alpha');
 expect(kept?.projectName).toBe('Alpha');
 fireEvent.press(view!.getByLabelText('Record answer for Task'));
 await settle();
 expect(view!.queryByText('Recording ready')).toBeNull();
 expect(voice().projectName).toBe('Beta');
 expect(whatIsIn(kept!.uri)).toBe('take-1');
});

it('a slow Stop finishes under the original project and origin slot after the editor project changes',async()=>{
 view=render(editor());
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await view.findByText('Stop & Continue');
 const originSlot=voice().keepSlot as string;
 await act(async()=>{phone.recorder.set({durationMillis:5000});});
 const slow=hold(phone.recorder.stop,phone.recorder.stops);
 fireEvent.press(view.getByText('Stop & Continue'));
 await act(async()=>{await slow.reached;});
 fireEvent.changeText(view.getByLabelText('Project'),'Beta');
 await act(async()=>{slow.release();await pause();});
 await waitFor(async()=>expect(await readKeptVoiceRecording('owner-A',originSlot,'Alpha')).not.toBeNull());
 const kept=await readKeptVoiceRecording('owner-A',originSlot,'Alpha');
 expect(kept).toMatchObject({projectId:'alpha-id',projectName:'Alpha'});
 expect(whatIsIn(kept!.uri)).toBe('take-1');
 expect(transcribe).not.toHaveBeenCalled();
 expect(voice().visible).toBe(false);
});
it.each(['project','account','editor'])('late transcription after %s changes cannot fill a new origin',async kind=>{
 let resolve!:(result:unknown)=>void;
 transcribe.mockImplementationOnce(()=>new Promise(yes=>{resolve=yes;}));
 view=render(editor());
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await view.findByText('Stop & Continue');
 await act(async()=>{phone.recorder.set({durationMillis:5000});});
 fireEvent.press(view.getByText('Stop & Continue'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(1));
 const oldCallback=voice().onMemoryReady;
 if(kind==='project') fireEvent.changeText(view.getByLabelText('Project'),'Beta');
 else if(kind==='account') await act(async()=>{view!.rerender(editor(true,'owner-B'));});
 else {await act(async()=>{view!.rerender(editor(false));});await act(async()=>{view!.rerender(editor(true));});}
 await settle();
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await settle();
 await act(async()=>{resolve({transcript:'Task: Wrong old origin'});oldCallback({transcript:'Task: Wrong old origin'});});
 expect(view.getByLabelText('Answer Task').props.value).not.toContain('Wrong old origin');
 expect(view.getByLabelText('Task or milestone').props.value).not.toContain('Wrong old origin');
 expect(view.queryByText('Answer recorded for: Task')).toBeNull();
});
it('the same draft question offers retained audio explicitly, without automatically retrying the failed upload',async()=>{
 await readyFailedAnswer();
 const originalSlot=voice().keepSlot;
 // Close the voice panel without changing its draft/question, as Close and Keep does.
 await act(async()=>{voice().onCancel();});
 fireEvent.press(view!.getByLabelText('Record answer for Task'));
 await settle();
 expect(voice().keepSlot).toBe(originalSlot);
 expect(transcribe).toHaveBeenCalledTimes(1);
 expect(view!.getByText('Recording ready')).toBeTruthy();
 fireEvent.press(view!.getByText('Retry Answer'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(2));
 expect(transcribe.mock.calls[1][0]).toMatchObject({projectId:'alpha-id',projectName:'Alpha'});
});

it('original-slot recovery through existing hook offers saved sent audio without automatic transmission',async()=>{
 await readyFailedAnswer();
 const originSlot=voice().keepSlot as string;
 const origin=await readKeptVoiceRecording('owner-A',originSlot,'Alpha');
 view!.unmount();
 view=render(<NativeWorkspaceOwnerContext.Provider value="owner-A"><DAVEVoiceCaptureSheet visible projectId="alpha-id" projectName="Alpha" candidateLocations={[]} keepSlot={originSlot} retryKeptRecordingAutomatically={false} title="Answer: Task" continueLabel="Retry Answer" onMemoryReady={()=>undefined} onTypeInstead={()=>undefined} onCancel={()=>undefined}/></NativeWorkspaceOwnerContext.Provider>);
 await view.findByText('Recording ready');
 await settle();
 expect(transcribe).toHaveBeenCalledTimes(1);
 expect(whatIsIn(origin!.uri)).toBe('take-1');
 fireEvent.press(view.getByText('Retry Answer'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(2));
 expect(transcribe.mock.calls[1][0]).toMatchObject({uri:origin!.uri,projectName:'Alpha',projectId:'alpha-id'});
});
