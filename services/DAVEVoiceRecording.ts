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
