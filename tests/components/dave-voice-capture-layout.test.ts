import {
  DAVE_VOICE_CAPTURE_TABLET_MAX_WIDTH,
  daveVoiceCaptureUsesTabletSheet,
} from '../../components/dave-voice-capture-layout';

describe('DAVE voice capture sheet layout', () => {
  it('keeps the existing phone sheet below the medium breakpoint', () => {
    expect(daveVoiceCaptureUsesTabletSheet(599)).toBe(false);
  });

  it('uses a bounded tablet sheet at medium and wide widths', () => {
    expect(daveVoiceCaptureUsesTabletSheet(600)).toBe(true);
    expect(daveVoiceCaptureUsesTabletSheet(1366)).toBe(true);
    expect(DAVE_VOICE_CAPTURE_TABLET_MAX_WIDTH).toBe(720);
  });
});
