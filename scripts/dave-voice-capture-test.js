const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const app = read('App.tsx');
const sheet = read('components/DAVEVoiceCaptureSheet.tsx');
const service = read('services/DAVEVoiceTranscriptionService.ts');
const understandingSource = read('services/DAVEVoiceUnderstanding.ts');
const edge = read('supabase/functions/dave-transcribe-memory/index.ts');
const appConfig = JSON.parse(read('app.json'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTypeScript(source, fileName) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleValue = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: moduleValue,
    exports: moduleValue.exports,
    require,
    Object,
    Set,
    Array,
    Error,
  }, { filename: fileName });
  return moduleValue.exports;
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
assert(service.includes("formData.append('projectName'") && service.includes("formData.append('candidateLocations'"), 'Client must send bounded project context for review preparation.');
assert(edge.includes('supabase.auth.getUser()'), 'Edge function must verify the authenticated user.');
assert(edge.includes('MAX_AUDIO_BYTES'), 'Edge function must enforce an audio size limit.');
assert(edge.includes("https://api.openai.com/v1/audio/transcriptions"), 'Edge function must use the transcription endpoint.');
assert(edge.includes("https://api.openai.com/v1/responses"), 'Edge function must prepare structured memory fields server-side.');
assert(edge.includes("type: 'json_schema'") && edge.includes('strict: true'), 'Memory understanding must use a strict structured-output contract.');
assert(edge.includes('Use only facts explicitly stated in the transcript.'), 'Memory understanding must prohibit invented facts.');
assert(edge.includes("status: 'unavailable'"), 'A failed understanding call must preserve a safe transcript-only fallback.');
assert(!edge.includes('serviceRoleKey'), 'Transcription must not require database service-role access.');
assert(!edge.includes('providerBody?.text') || !edge.includes('console.log(providerBody'), 'Transcripts must not be logged.');
assert(app.includes('fields: proposedFields') && app.includes('confirmed: false'), 'Structured proposals must remain editable and location must require PM confirmation.');

const understanding = loadTypeScript(understandingSource, 'services/DAVEVoiceUnderstanding.ts');
const parsed = understanding.parseDAVEVoiceUnderstandingResponse({
  schemaVersion: understanding.DAVE_VOICE_UNDERSTANDING_SCHEMA_VERSION,
  transcript: 'ABC Electric committed to finish conduit by Friday in Canopy B.',
  transcriptionModel: 'gpt-4o-mini-transcribe',
  understanding: {
    status: 'succeeded',
    model: 'gpt-4o-mini',
    recommendedLocation: { value: 'Canopy B', confidence: 'high' },
    fields: {
      peopleOrCompany: 'ABC Electric', commitment: 'Finish conduit', dueDate: 'Friday',
      decision: null, ownerRequest: null, inspectionChange: null, scheduleChange: null,
      issue: null, risk: null, followUp: null, generalMemory: null,
    },
  },
}, ['Canopy B']);
assert(parsed.understanding.fields.commitment === 'Finish conduit', 'Validated structured fields must reach the confirmation draft.');
assert(parsed.understanding.recommendedLocation.value === 'Canopy B', 'Only supplied location candidates may be recommended.');

const unsupportedLocation = understanding.parseDAVEVoiceUnderstandingResponse({
  ...parsed,
  understanding: {
    ...parsed.understanding,
    recommendedLocation: { value: 'Invented Area', confidence: 'high' },
  },
}, ['Canopy B']);
assert(unsupportedLocation.understanding.recommendedLocation.value === null, 'An unsupported location must be discarded client-side.');

const audioPlugin = appConfig.expo.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-audio');
assert(audioPlugin, 'expo-audio config plugin must be enabled.');
assert(audioPlugin[1].enableBackgroundRecording === false, 'Background recording must stay disabled.');
assert(Boolean(audioPlugin[1].microphonePermission), 'A microphone permission explanation is required.');

console.log('PASS dave voice capture security and live-wiring checks');
