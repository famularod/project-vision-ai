import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2';

const SCHEMA_VERSION = 'dave-voice-transcription/1.0';
const MODEL = 'gpt-4o-mini-transcribe';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/wav',
  'audio/webm',
]);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

    const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

    const form = await request.formData().catch(() => null);
    const audio = form?.get('audio');
    if (!(audio instanceof File)) return json({ error: 'audio_file_required' }, 400);
    if (audio.size <= 0) return json({ error: 'audio_file_empty' }, 400);
    if (audio.size > MAX_AUDIO_BYTES) return json({ error: 'audio_file_too_large' }, 413);
    if (audio.type && !ALLOWED_AUDIO_TYPES.has(audio.type.toLowerCase())) {
      return json({ error: 'audio_type_not_supported' }, 415);
    }

    const providerForm = new FormData();
    providerForm.append('file', audio, safeAudioFileName(audio));
    providerForm.append('model', MODEL);
    providerForm.append('language', 'en');
    providerForm.append(
      'prompt',
      'Construction project field note. Preserve names, companies, locations, dates, commitments, decisions, issues, requests, schedule changes, and follow-ups exactly as spoken. Do not add facts.',
    );

    const providerResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${requiredEnv('PIE_OPENAI_API_KEY')}` },
      body: providerForm,
      signal: AbortSignal.timeout(60_000),
    });

    if (!providerResponse.ok) {
      console.error(JSON.stringify({
        event: 'dave_voice_transcription_failed',
        providerStatus: providerResponse.status,
        audioBytes: audio.size,
        audioType: audio.type || null,
      }));
      return json({ error: 'transcription_provider_failed' }, 502);
    }

    const providerBody = await providerResponse.json().catch(() => null) as { text?: unknown } | null;
    const transcript = typeof providerBody?.text === 'string' ? providerBody.text.trim() : '';
    if (!transcript) return json({ error: 'transcription_empty' }, 502);

    console.log(JSON.stringify({
      event: 'dave_voice_transcription_succeeded',
      model: MODEL,
      audioBytes: audio.size,
      audioType: audio.type || null,
    }));

    return json({ schemaVersion: SCHEMA_VERSION, transcript, model: MODEL });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'dave_voice_transcription_error',
      reason: error instanceof Error ? error.name : 'unknown_error',
    }));
    return json({ error: 'transcription_unavailable' }, 500);
  }
});

function safeAudioFileName(audio: File) {
  const extension = audio.type.includes('wav')
    ? 'wav'
    : audio.type.includes('webm')
      ? 'webm'
      : audio.type.includes('mpeg')
        ? 'mp3'
        : 'm4a';
  return `dave-memory.${extension}`;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
