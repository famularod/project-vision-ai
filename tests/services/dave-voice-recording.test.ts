import {
  DAVE_MIN_RECORDING_DURATION_MS,
  daveRecordingIsLongEnough,
  preserveDAVERecordingDuration,
} from '../../services/DAVEVoiceRecording';

describe('DAVE voice recording duration', () => {
  it('preserves the last non-zero duration after the native recorder resets on stop', () => {
    expect(preserveDAVERecordingDuration(2_450, 0, 0)).toBe(2_450);
  });

  it('uses the most current recorder duration', () => {
    expect(preserveDAVERecordingDuration(800, 1_125.4, 1_100)).toBe(1_125);
  });

  it('rejects a genuinely short recording', () => {
    expect(daveRecordingIsLongEnough(DAVE_MIN_RECORDING_DURATION_MS - 1)).toBe(false);
    expect(daveRecordingIsLongEnough(DAVE_MIN_RECORDING_DURATION_MS)).toBe(true);
  });
});
