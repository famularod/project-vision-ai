import { getCurrentSessionAccessToken, getSupabaseClient } from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';

export const DAVE_VOICE_TRANSCRIPTION_SCHEMA_VERSION = 'dave-voice-transcription/1.0' as const;
export const DAVE_VOICE_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;

type DAVEVoiceTranscriptionResponse = {
  schemaVersion: typeof DAVE_VOICE_TRANSCRIPTION_SCHEMA_VERSION;
  transcript: string;
  model: string;
};

export async function transcribeDAVECaptureMemoryAudio({
  uri,
}: {
  uri: string;
}): Promise<DAVEVoiceTranscriptionResponse> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('The recording is no longer available. Record it again.');
  if (typeof info.size === 'number' && info.size > DAVE_VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new Error('This recording is too large to transcribe. Record a shorter memory.');
  }

  const client = getSupabaseClient();
  if (!client) throw new Error('Voice transcription is unavailable until Supabase is configured.');

  const tokenResult = await getCurrentSessionAccessToken();
  const token = tokenResult.data;
  if (!tokenResult.ok || token?.status !== 'token_present' || !token.accessToken) {
    throw new Error('Sign in before transcribing a recorded memory.');
  }

  const formData = new FormData();
  formData.append('audio', {
    uri,
    name: `dave-memory-${Date.now()}.m4a`,
    type: 'audio/mp4',
  } as unknown as Blob);

  const { data, error } = await client.functions.invoke('dave-transcribe-memory', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: formData,
  });

  if (error) throw new Error('DAVE could not transcribe this recording. You can retry or type it instead.');
  return parseDAVEVoiceTranscriptionResponse(data);
}

export function parseDAVEVoiceTranscriptionResponse(value: unknown): DAVEVoiceTranscriptionResponse {
  if (!value || typeof value !== 'object') throw malformedResponse();
  const candidate = value as Partial<DAVEVoiceTranscriptionResponse>;
  const transcript = typeof candidate.transcript === 'string' ? candidate.transcript.trim() : '';
  if (
    candidate.schemaVersion !== DAVE_VOICE_TRANSCRIPTION_SCHEMA_VERSION ||
    !transcript ||
    typeof candidate.model !== 'string' ||
    !candidate.model.trim()
  ) {
    throw malformedResponse();
  }
  return {
    schemaVersion: DAVE_VOICE_TRANSCRIPTION_SCHEMA_VERSION,
    transcript,
    model: candidate.model,
  };
}

function malformedResponse() {
  return new Error('DAVE received an incomplete transcription. You can retry or type it instead.');
}
