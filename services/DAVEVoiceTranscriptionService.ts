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
  purpose = 'memory',
  isRequestCurrent = () => true,
}: {
  uri: string;
  projectId: string | null;
  projectName: string;
  candidateLocations: readonly string[];
  purpose?: 'memory' | 'question';
  isRequestCurrent?: () => boolean;
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

    const response = await uploadDAVEVoiceWithRecovery(() => FileSystem.uploadAsync(
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
            purpose,
          },
          headers: {
            apikey: publishableKey,
            Authorization: `Bearer ${token.accessToken}`,
          },
          sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        },
      ), isRequestCurrent);

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
  formData.append('purpose', purpose);

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

async function uploadDAVEVoiceWithRecovery(
  upload: () => Promise<FileSystem.FileSystemUploadResult>,
  isRequestCurrent: () => boolean,
): Promise<FileSystem.FileSystemUploadResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!isRequestCurrent()) throw new Error('Voice upload cancelled. (VOICE-CANCELLED)');
    try {
      return await upload();
    } catch (error) {
      const failure = classifyDAVEVoiceUploadFailure(error);
      // The server keys voice operations by the audio bytes AND exact project/
      // purpose context. Reuse this same upload; never create a new recording or
      // broaden authorization to recover an ambiguous transport failure.
      if (attempt === 0 && failure.retryable) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      throw new Error(failure.message);
    }
  }
  throw new Error('The recording could not be uploaded. Retry this recording or type instead. (VOICE-UPLOAD)');
}

export function classifyDAVEVoiceUploadFailure(error: unknown): { retryable: boolean; message: string } {
  // Native NSError descriptions may contain signed URLs, local paths and request
  // headers. Inspect only the system domain/code; never display or log the raw error.
  const message = error instanceof Error ? error.message : '';
  const match = /\bDomain=NSURLErrorDomain\s+Code=(-?\d+)\b/.exec(message);
  const code = match ? Number(match[1]) : null;
  if (code === -1001) return { retryable: true, message: 'The voice upload timed out. Retry this recording or type instead. (VOICE-TIMEOUT)' };
  if (code === -1005 || code === -1003 || code === -1004) {
    return { retryable: true, message: 'The connection was interrupted while uploading. Retry this recording or type instead. (VOICE-CONNECTION)' };
  }
  if (code === -1009) return { retryable: false, message: 'This device is offline. Reconnect, then retry this recording or type instead. (VOICE-OFFLINE)' };
  if (code === -999) return { retryable: false, message: 'The voice upload was interrupted. Keep Vitruvius open and retry this recording. (VOICE-CANCELLED)' };
  if (code !== null && code <= -1200 && code >= -1206) {
    return { retryable: false, message: 'A secure connection to voice transcription could not be verified. Do not bypass security warnings. (VOICE-SECURITY)' };
  }
  return { retryable: false, message: 'The recording could not be uploaded. Retry this recording or type instead. (VOICE-UPLOAD)' };
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
