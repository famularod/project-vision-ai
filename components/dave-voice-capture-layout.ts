export const DAVE_VOICE_CAPTURE_TABLET_BREAKPOINT = 600;
export const DAVE_VOICE_CAPTURE_TABLET_MAX_WIDTH = 720;

export function daveVoiceCaptureUsesTabletSheet(width: number) {
  return Number.isFinite(width) && width >= DAVE_VOICE_CAPTURE_TABLET_BREAKPOINT;
}
