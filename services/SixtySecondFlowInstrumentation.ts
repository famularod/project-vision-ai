export type FieldUpdateFlowTimestamps = {
  startedAt?: string;
  cameraActionStartedAt?: string;
  firstPhotoAddedAt?: string;
  reviewOpenedAt?: string;
  sendTappedAt?: string;
  sendResolvedAt?: string;
};

export type SixtySecondFlowTimingResult = {
  startedAt: string | null;
  sendResolvedAt: string | null;
  elapsedSeconds: number | null;
  targetSeconds: number;
  withinTarget: boolean | null;
  canSendWhileAnalysisPending: boolean;
  missingMarkers: string[];
};

export function buildSixtySecondFlowTimingResult({
  timestamps,
  targetSeconds = 60,
  analysisPending,
}: {
  timestamps: FieldUpdateFlowTimestamps | null | undefined;
  targetSeconds?: number;
  analysisPending: boolean;
}): SixtySecondFlowTimingResult {
  const markers = timestamps || {};
  const required: (keyof FieldUpdateFlowTimestamps)[] = [
    'startedAt',
    'cameraActionStartedAt',
    'firstPhotoAddedAt',
    'reviewOpenedAt',
    'sendTappedAt',
    'sendResolvedAt',
  ];
  const missingMarkers = required.filter(marker => !markers[marker]);
  const started = parseTimestamp(markers.startedAt);
  const resolved = parseTimestamp(markers.sendResolvedAt);
  const elapsedSeconds =
    started !== null && resolved !== null
      ? Math.max(0, Math.round((resolved - started) / 100) / 10)
      : null;

  return {
    startedAt: markers.startedAt || null,
    sendResolvedAt: markers.sendResolvedAt || null,
    elapsedSeconds,
    targetSeconds,
    withinTarget:
      elapsedSeconds === null ? null : elapsedSeconds <= targetSeconds,
    canSendWhileAnalysisPending: Boolean(
      analysisPending && markers.sendTappedAt,
    ),
    missingMarkers,
  };
}

function parseTimestamp(value: string | undefined) {
  if (!value) return null;

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed) ? parsed : null;
}
