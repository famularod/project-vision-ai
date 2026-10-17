import {act,fireEvent,render,waitFor} from '@testing-library/react-native';
import {AppState} from 'react-native';
import {ScheduleTaskEditorModal} from '../../components/schedule-task-editor-modal';
import {DAVEVoiceCaptureSheet} from '../../components/DAVEVoiceCaptureSheet';
import {NativeWorkspaceOwnerContext} from '../../components/native-workspace-owner';
import {readKeptVoiceRecording,sweepKeptVoiceRecordings} from '../../services/KeptVoiceRecording';
import {phone,releaseEveryHold,keptFiles,whatIsIn} from '../fixtures/voice-sheet-phone';
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
 await view.findByText('Recording ready');
 await settle();
}
it('ancestor task editor closes: retained answer never becomes the next draft question answer',async()=>{
 await readyFailedAnswer();
 const originSlot=voice().keepSlot as string;
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
