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
const submitted=jest.fn();
function editor(visible=true,owner='owner-A') {
 return <NativeWorkspaceOwnerContext.Provider value={owner}><ScheduleTaskEditorModal visible={visible} initiallyGuided projects={['Alpha','Beta']} projectRecords={[{id:'alpha-id',name:'Alpha'},{id:'beta-id',name:'Beta'}]} initialProjectName="Alpha" projectAreas={[]} scheduleItems={[]} onClose={()=>undefined} onSubmit={submitted}/></NativeWorkspaceOwnerContext.Provider>;
}
const voice=()=>view!.UNSAFE_getByType(DAVEVoiceCaptureSheet).props;
beforeEach(()=>{phone.reset();submitted.mockReset();transcribe.mockReset().mockRejectedValue(new Error('Synthetic no connection'));(AppState as {currentState:unknown}).currentState='active';});
afterEach(async()=>{view?.unmount();view=undefined;releaseEveryHold();await pause();});
async function readyFailedAnswer(){
 view=render(editor());
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await view.findByText('Stop & Continue');
 await act(async()=>{phone.recorder.set({durationMillis:5000});});
 fireEvent.press(view.getByText('Stop & Continue'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(1));
 await view.findByText('Recording ready');
 await settle();
}

it('saved callback from unmounted assistant cannot change real parent form or Save Task payload',async()=>{
 await readyFailedAnswer();
 const old=voice().onMemoryReady;
 await act(async()=>{view!.rerender(editor(false));});
 await act(async()=>{view!.rerender(editor(true));});
 fireEvent.changeText(view!.getByLabelText('Task or milestone'),'Independent new task');
 await act(async()=>{old({transcript:'Task: stale response'});});
 expect(view!.getByLabelText('Task or milestone').props.value).toBe('Independent new task');
 fireEvent.press(view!.getByLabelText('Save Task'));
 expect(submitted).toHaveBeenCalledWith(expect.objectContaining({taskName:'Independent new task'}));
});
it.each(['draft','project','account'])('fresh transcript cleanup released after %s switch cannot hand off or forget another origin',async change=>{
 let finish!:(value:unknown)=>void;
 transcribe.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 view=render(editor());
 fireEvent.press(view.getByLabelText('Record answer for Task'));
 await view.findByText('Stop & Continue');
 const slot=voice().keepSlot;
 await act(async()=>{phone.recorder.set({durationMillis:5100});});
 fireEvent.press(view.getByText('Stop & Continue'));
 await waitFor(()=>expect(transcribe).toHaveBeenCalledTimes(1));
 await waitFor(async()=>expect(await readKeptVoiceRecording('owner-A',slot,'Alpha')).not.toBeNull());
 const deletion=hold(phone.deleteAsync,phone.deleteAsync.getMockImplementation()!);
 await act(async()=>{finish({transcript:'Task: late cleanup old answer'});await deletion.reached;});
 if(change==='draft'){await act(async()=>{view!.rerender(editor(false));});await act(async()=>{view!.rerender(editor(true));});}
 else if(change==='project')fireEvent.changeText(view.getByLabelText('Project'),'Beta');
 else await act(async()=>{view!.rerender(editor(true,'owner-B'));});
 fireEvent.changeText(view.getByLabelText('Task or milestone'),'Independent new task');
 await act(async()=>{deletion.release();await pause();});
 expect(view.getByLabelText('Task or milestone').props.value).toBe('Independent new task');
 expect(view.getByLabelText('Answer Task').props.value).not.toContain('late cleanup');
 const kept=await readKeptVoiceRecording('owner-A',slot,'Alpha');
 expect(kept).not.toBeNull();
 expect(whatIsIn(kept!.uri)).toBe('take-1');
 await sweepKeptVoiceRecordings();
 expect(keptFiles()).toContain(kept!.uri);
});
