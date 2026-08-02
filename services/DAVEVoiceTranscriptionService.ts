import { getCurrentSessionAccessToken, getSupabaseClient } from './SupabaseService';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  parseDAVEVoiceUnderstandingResponse,
  type DAVEVoiceUnderstandingResponse,
} from './DAVEVoiceUnderstanding';

export const DAVE_VOICE_TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
const DAVE_VOICE_CONTEXT_MAX_LOCATIONS = 100;
const DAVE_VOICE_FUNCTION_NAME = 'dave-transcribe-memory';
const DAVE_PROJECT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DAVEVoiceFunctionErrorBody = {
  error?: unknown;
  retryAfterSeconds?: unknown;
};

export async function transcribeDAVECaptureMemoryAudio({
  uri,
  projectId,
  projectName,
  candidateLocations,
}: {
  uri: string;
  projectId: string | null;
  projectName: string;
  candidateLocations: readonly string[];
}): Promise<DAVEVoiceUnderstandingResponse> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error('The recording is no longer available. Record it again.');
  if (typeof info.size === 'number' && info.size <= 0) {
    throw new Error('No usable audio was recorded. Record again and speak for at least one second.');
  }
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

  const submittedLocations = Array.from(new Set(
    candidateLocations.map(item => item.trim()).filter(Boolean),
  )).slice(0, DAVE_VOICE_CONTEXT_MAX_LOCATIONS);
  const submittedProjectName = projectName.trim();
  const submittedProjectId = projectId?.trim() || '';
  if (!submittedProjectName || !DAVE_PROJECT_UUID_PATTERN.test(submittedProjectId)) {
    throw new Error('This project is still loading. Close and reopen Talk, then try again.');
  }

  if (Platform.OS !== 'web') {
    const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '') || '';
    const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
    if (!projectUrl || !publishableKey) {
      throw new Error('Voice transcription is unavailable until Supabase is configured.');
    }

    let response: FileSystem.FileSystemUploadResult;
    try {
      response = await FileSystem.uploadAsync(
        `${projectUrl}/functions/v1/${DAVE_VOICE_FUNCTION_NAME}`,
        uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: 'audio',
          mimeType: 'audio/mp4',
          parameters: {
            projectName: submittedProjectName,
            projectId: submittedProjectId,
            candidateLocations: JSON.stringify(submittedLocations),
          },
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${token.accessToken}`,
          },
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        },
      );
    } catch {
      throw new Error('Could not reach voice transcription. Check the connection and try again.');
    }

    const responseBody = parseDAVEVoiceFunctionBody(response.body);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(daveVoiceTranscriptionErrorMessage(response.status, responseBody));
    }
    if (!responseBody) {
      throw new Error('Voice transcription returned an unreadable response. Record again and retry.');
    }
    return parseDAVEVoiceUnderstandingResponse(responseBody, submittedLocations);
  }

  const formData = new FormData();
  formData.append('audio', {
    uri,
    name: `dave-memory-${Date.now()}.m4a`,
    type: 'audio/mp4',
  } as unknown as Blob);
  formData.append('projectName', submittedProjectName);
  formData.append('projectId', submittedProjectId);
  formData.append('candidateLocations', JSON.stringify(submittedLocations));

  const { data, error, response } = await client.functions.invoke('dave-transcribe-memory', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    body: formData,
  });

  if (error) {
    const responseBody = response
      ? parseDAVEVoiceFunctionBody(await response.text().catch(() => ''))
      : null;
    throw new Error(daveVoiceTranscriptionErrorMessage(response?.status ?? 0, responseBody));
  }
  return parseDAVEVoiceUnderstandingResponse(data, submittedLocations);
}

function parseDAVEVoiceFunctionBody(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function daveVoiceTranscriptionErrorMessage(
  status: number,
  body: DAVEVoiceFunctionErrorBody | null,
): string {
  const code = typeof body?.error === 'string' ? body.error : '';
  if (code === 'audio_file_empty' || code === 'audio_file_required') {
    return 'No usable audio was recorded. Record again and speak for at least one second.';
  }
  if (status === 401 || code === 'unauthorized') {
    return 'Your sign-in could not be verified for voice transcription. Sign in again, then retry.';
  }
  if (status === 403 || code === 'forbidden') {
    return 'Voice transcription is not authorized for this account.';
  }
  if (status === 409 || code === 'transcription_in_progress') {
    return 'This recording is already being prepared. Wait a moment, then retry.';
  }
  if (status === 429 || code === 'transcription_rate_limited') {
    return 'Voice transcription is busy. Wait a minute, then retry.';
  }
  if (status === 502 || code === 'transcription_provider_failed' || code === 'transcription_empty') {
    return 'The voice service could not understand this recording. Record again in a quieter place or type the answer.';
  }
  if (status === 503 || code === 'authorization_unavailable' || code === 'ai_operation_control_unavailable') {
    return 'Voice transcription is temporarily unavailable. Try again shortly or type the answer.';
  }
  if (status === 0) {
    return 'Could not reach voice transcription. Check the connection and try again.';
  }
  return 'The recording could not be transcribed. Record again or type the answer instead.';
}
