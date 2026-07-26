import { getCurrentSessionAccessToken, getSupabaseClient } from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';
import {
  parseDAVEVoiceUnderstandingResponse,
  type DAVEVoiceUnderstandingResponse,
} from './DAVEVoiceUnderstanding';

export const DAVE_VOICE_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
const DAVE_VOICE_CONTEXT_MAX_LOCATIONS = 100;

export async function transcribeDAVECaptureMemoryAudio({
  uri,
  projectName,
  candidateLocations,
}: {
  uri: string;
  projectName: string;
  candidateLocations: readonly string[];
}): Promise<DAVEVoiceUnderstandingResponse> {
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
  const submittedLocations = Array.from(new Set(
    candidateLocations.map(item => item.trim()).filter(Boolean),
  )).slice(0, DAVE_VOICE_CONTEXT_MAX_LOCATIONS);
  formData.append('projectName', projectName.trim());
  formData.append(
    'projectId',
    `project-${projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'unassigned'}`,
  );
  formData.append('candidateLocations', JSON.stringify(submittedLocations));

  const { data, error } = await client.functions.invoke('dave-transcribe-memory', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: formData,
  });

  if (error) throw new Error('The recording could not be transcribed. You can retry or type it instead.');
  return parseDAVEVoiceUnderstandingResponse(data, submittedLocations);
}
