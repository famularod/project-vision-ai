export const DAVE_MIN_RECORDING_DURATION_MS = 1_000;

export function preserveDAVERecordingDuration(...durations: number[]): number {
  return Math.max(
    0,
    ...durations
      .filter(value => Number.isFinite(value) && value > 0)
      .map(value => Math.round(value)),
  );
}

export function daveRecordingIsLongEnough(durationMillis: number): boolean {
  return preserveDAVERecordingDuration(durationMillis) >= DAVE_MIN_RECORDING_DURATION_MS;
}

/**
 * Build 232 round, item 9 (13 Oct 2026; open item 4.57): a recording that
 * carried no sound at all.
 *
 * On the owner's iPhone his Mac was using the iPhone as its microphone
 * (Apple's Continuity). While a Mac program held it, every app on the iPhone
 * recorded silence: each try in the voice sheet ended "The voice service
 * could not understand this recording…", a call to the speech service that
 * could only fail, and words that sent him to the wrong place.
 *
 * The level is the recorder's own (expo-audio's RecorderState.metering, on
 * when RecordingOptions.isMeteringEnabled is). On an iPhone or iPad it is
 * Apple's average power of the microphone in decibels each time the sheet
 * asks: 0 is full scale and -160 the least it ever says.
 *
 * "No sound at all" is the microphone giving NOTHING for the whole
 * recording, not a recording nobody spoke in: every answer at or under
 * DAVE_NO_SOUND_LEVEL_DB, over at least DAVE_NO_SOUND_MIN_READINGS answers.
 * - The line, -110, is far under anything a working microphone reads: its
 *   own electrical hiss keeps it well above that in the emptiest room
 *   (iPhones generally read -80 to -50 there; NOT measured on the owner's
 *   phone). It is above the two values a stream of zeros is reported as
 *   (-160, Apple's least, and -120 where silence is counted as a 32-bit
 *   number).
 * - ONE answer above the line anywhere makes it a recording with sound, so
 *   a long pause, and a word at the very start or end, change nothing.
 * - Ten answers are two seconds at the sheet's 200 ms: a shorter recording
 *   (a short word) is never judged, whatever its levels, and neither is a
 *   recording whose recorder gave no level.
 * In doubt it is sent as before.
 */
export const DAVE_NO_SOUND_LEVEL_DB = -110;
export const DAVE_NO_SOUND_MIN_READINGS = 10;

/** The levels the recorder has answered with during one recording: how many, and the loudest. */
export type DAVERecordingLevels = Readonly<{ readings: number; loudest: number }>;

export const DAVE_NO_LEVELS_YET: DAVERecordingLevels = { readings: 0, loudest: Number.NEGATIVE_INFINITY };

/** One more answer of the recorder. An answer without a level (no metering, or not a number) is not counted. */
export function noteDAVERecordingLevel(levels: DAVERecordingLevels, level: number | undefined): DAVERecordingLevels {
  if (typeof level !== 'number' || Number.isNaN(level)) return levels;
  return { readings: levels.readings + 1, loudest: Math.max(levels.loudest, level) };
}

export function daveRecordingHadNoSound(levels: DAVERecordingLevels): boolean {
  return levels.readings >= DAVE_NO_SOUND_MIN_READINGS && levels.loudest <= DAVE_NO_SOUND_LEVEL_DB;
}

/** What to do about a microphone that gives nothing. The owner's was an iPhone his Mac used as its microphone; an iPad names no Mac. */
function daveNoSoundAdvice(device: 'iPhone' | 'iPad'): string {
  const holder = device === 'iPhone' ? 'your Mac or another device' : 'another device';
  return `If ${holder} is using this ${device}'s microphone, stop that, then record again. Restarting the ${device} also clears it.`;
}

/** What the voice sheet says of such a recording. */
export function daveNoSoundMessage(device: 'iPhone' | 'iPad'): string {
  return `The microphone gave no sound, so there is nothing to send. ${daveNoSoundAdvice(device)}`;
}

/**
 * Build 232 round, item 9b (13 Oct 2026; the coordinator's decision): a way
 * out. The level above has not been measured on a phone, nor on a recorder's
 * second recording, nor through AirPods or a car. Read wrong somewhere, every
 * dictation of two seconds or more was refused there until a new build, and
 * he could neither send it nor keep it. A wrong level must cost him one more
 * tap, not his dictation.
 *
 * His first tap on the sheet's own button still sends nothing; the sheet
 * then says this, naming that button as the sheet shows it. His second tap,
 * for the same recording, sends it as any recording is sent.
 */
export function daveNoSoundSendAnywayMessage(device: 'iPhone' | 'iPad', buttonLabel: string): string {
  return `${daveNoSoundMessage(device)} If you did speak, tap ${buttonLabel} again to send it anyway.`;
}

/**
 * Sent anyway, and the speech service could make nothing of it either: the
 * state of 13 Oct itself. The sheet says both things, and what to do about a
 * microphone that gives nothing; not the service's own "Record again in a
 * quieter place", which sent him to the wrong place.
 */
export function daveNoSoundAndNotUnderstoodMessage(device: 'iPhone' | 'iPad'): string {
  return 'The voice service could not make out any words in this recording, and the microphone seemed to give no sound. ' +
    daveNoSoundAdvice(device);
}

/**
 * Whether a failure is the speech service saying it could make nothing of
 * the recording: its server's 502, "transcription_provider_failed" and
 * "transcription_empty", which the service words as one sentence
 * (daveVoiceTranscriptionErrorMessage). Known by that sentence's opening;
 * the item's test holds the two together with the service's own function.
 */
export function daveVoiceServiceCouldNotUnderstand(reason: unknown): boolean {
  return reason instanceof Error && reason.message.startsWith('The voice service could not understand this recording.');
}
