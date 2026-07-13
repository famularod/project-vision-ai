const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const app = read('App.tsx');
const sheet = read('components/DAVEVoiceCaptureSheet.tsx');
const service = read('services/DAVEVoiceTranscriptionService.ts');
const edge = read('supabase/functions/dave-transcribe-memory/index.ts');
const appConfig = JSON.parse(read('app.json'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(app.includes('<DAVEVoiceCaptureSheet'), 'Live Project Workspace must render voice capture.');
assert(app.includes('voice-transcription:'), 'Voice transcript must retain source provenance.');
assert(sheet.includes('requestRecordingPermissionsAsync'), 'Recording must request microphone permission on demand.');
assert(sheet.includes('Record Again'), 'Voice capture must support re-recording.');
assert(sheet.includes('Replay Recording'), 'Voice capture must support replay.');
assert(sheet.includes('Type Instead'), 'Voice capture must preserve typed fallback.');
assert(sheet.includes('deleteAsync'), 'Temporary recordings must be cleaned up.');
assert(service.includes("functions.invoke('dave-transcribe-memory'"), 'Client must invoke the dedicated transcription function.');
assert(service.includes('Authorization: `Bearer'), 'Client must explicitly forward the signed-in session.');
assert(edge.includes('supabase.auth.getUser()'), 'Edge function must verify the authenticated user.');
assert(edge.includes('MAX_AUDIO_BYTES'), 'Edge function must enforce an audio size limit.');
assert(edge.includes("https://api.openai.com/v1/audio/transcriptions"), 'Edge function must use the transcription endpoint.');
assert(!edge.includes('serviceRoleKey'), 'Transcription must not require database service-role access.');
assert(!edge.includes('providerBody?.text') || !edge.includes('console.log(providerBody'), 'Transcripts must not be logged.');

const audioPlugin = appConfig.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-audio');
assert(audioPlugin, 'expo-audio config plugin must be enabled.');
assert(audioPlugin[1].enableBackgroundRecording === false, 'Background recording must stay disabled.');
assert(Boolean(audioPlugin[1].microphonePermission), 'A microphone permission explanation is required.');

console.log('PASS dave voice capture security and live-wiring checks');
