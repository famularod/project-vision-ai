import * as FileSystem from 'expo-file-system/legacy';

/**
 * Hard ceiling for any local file that will be copied, hashed, or converted to
 * base64 in one operation. Fifteen MiB preserves the app's existing project-
 * document compatibility limit while bounding peak memory use.
 */
export const MAX_SAFE_LOCAL_FILE_BYTES = 15 * 1024 * 1024;

export type FileSizePreflightErrorCode =
  | 'file_missing'
  | 'file_empty'
  | 'file_size_unavailable'
  | 'file_too_large'
  | 'file_changed'
  | 'file_read_failed';

export class FileSizePreflightError extends Error {
  readonly code: FileSizePreflightErrorCode;
  readonly recoveryState = 'retry_or_reselect' as const;
  readonly maxBytes: number;
  readonly observedSizeBytes: number | null;
  readonly cause: unknown;

  constructor({
    code,
    message,
    maxBytes,
    observedSizeBytes = null,
    cause,
  }: Readonly<{
    code: FileSizePreflightErrorCode;
    message: string;
    maxBytes: number;
    observedSizeBytes?: number | null;
    cause?: unknown;
  }>) {
    super(message);
    this.name = 'FileSizePreflightError';
    this.code = code;
    this.maxBytes = maxBytes;
    this.observedSizeBytes = observedSizeBytes;
    this.cause = cause;
  }
}

export type FileSizeProbeResult = Readonly<{
  exists: boolean;
  sizeBytes: number | null;
}>;

export type FileSizePreflightResult = Readonly<{
  uri: string;
  sizeBytes: number;
  maxBytes: number;
}>;

/**
 * Re-inspects the selected URI immediately before a whole-file operation.
 * Picker metadata is never sufficient on its own: an unavailable stat fails
 * closed so an unknown-size file cannot reach an unbounded read.
 */
export async function preflightLocalFileRead({
  uri,
  statFile,
  reportedSizeBytes,
  maxBytes = MAX_SAFE_LOCAL_FILE_BYTES,
}: Readonly<{
  uri: string;
  statFile: (fileUri: string) => Promise<FileSizeProbeResult>;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
}>): Promise<FileSizePreflightResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('File-size preflight requires a positive safe byte limit.');
  }
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new FileSizePreflightError({
      code: 'file_missing',
      message: 'The selected file is unavailable. Choose the file again and retry.',
      maxBytes,
    });
  }

  const reportedSize = knownFileSize(reportedSizeBytes);
  if (reportedSize !== null && reportedSize > maxBytes) {
    throw tooLargeError(maxBytes, reportedSize);
  }

  let stat: FileSizeProbeResult;
  try {
    stat = await statFile(uri);
  } catch (cause) {
    throw new FileSizePreflightError({
      code: 'file_size_unavailable',
      message: 'DAVE could not safely verify this file size. Choose the file again and retry.',
      maxBytes,
      cause,
    });
  }

  if (!stat.exists) {
    throw new FileSizePreflightError({
      code: 'file_missing',
      message: 'The selected file is no longer available. Choose it again and retry.',
      maxBytes,
    });
  }

  const verifiedSize = knownFileSize(stat.sizeBytes);
  if (verifiedSize === null) {
    throw new FileSizePreflightError({
      code: 'file_size_unavailable',
      message: 'DAVE could not safely verify this file size. Choose the file again and retry.',
      maxBytes,
    });
  }
  if (verifiedSize === 0) {
    throw new FileSizePreflightError({
      code: 'file_empty',
      message: 'The selected file is empty. Choose a complete file and retry.',
      maxBytes,
      observedSizeBytes: 0,
    });
  }
  if (verifiedSize > maxBytes) {
    throw tooLargeError(maxBytes, verifiedSize);
  }
  if (reportedSize !== null && reportedSize !== verifiedSize) {
    throw new FileSizePreflightError({
      code: 'file_changed',
      message: 'The selected file changed before it could be saved. Choose it again and retry.',
      maxBytes,
      observedSizeBytes: verifiedSize,
    });
  }

  return Object.freeze({ uri, sizeBytes: verifiedSize, maxBytes });
}

/** Native Expo adapter reusable by project documents, references, schedules, and uploads. */
export function preflightExpoFileRead(input: Readonly<{
  uri: string;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
}>): Promise<FileSizePreflightResult> {
  return preflightLocalFileRead({
    ...input,
    statFile: async fileUri => {
      const info = await FileSystem.getInfoAsync(fileUri);
      return {
        exists: info.exists,
        sizeBytes:
          info.exists && typeof info.size === 'number'
            ? info.size
            : null,
      };
    },
  });
}

/**
 * Builds a bounded upload payload. The verified stat happens before the
 * base64 read, and a changed encoded length is rejected before ArrayBuffer
 * allocation. Decoding writes directly into a pre-sized byte array.
 */
export async function prepareExpoFileUploadPayload(input: Readonly<{
  uri: string;
  reportedSizeBytes?: number | null;
  maxBytes?: number;
}>): Promise<Readonly<{ data: ArrayBuffer; sizeBytes: number }>> {
  const preflight = await preflightExpoFileRead(input);
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(input.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (cause) {
    throw new FileSizePreflightError({
      code: 'file_read_failed',
      message: 'DAVE could not read this file. Choose it again and retry.',
      maxBytes: preflight.maxBytes,
      observedSizeBytes: preflight.sizeBytes,
      cause,
    });
  }

  const expectedEncodedCharacters = Math.ceil(preflight.sizeBytes / 3) * 4;
  if (base64.length !== expectedEncodedCharacters) {
    throw changedFileError(preflight);
  }

  let data: ArrayBuffer;
  try {
    data = decodeCanonicalBase64(base64);
  } catch (cause) {
    throw new FileSizePreflightError({
      code: 'file_read_failed',
      message: 'DAVE could not prepare this file. Choose it again and retry.',
      maxBytes: preflight.maxBytes,
      observedSizeBytes: preflight.sizeBytes,
      cause,
    });
  }
  if (data.byteLength !== preflight.sizeBytes) {
    throw changedFileError(preflight);
  }

  return Object.freeze({ data, sizeBytes: preflight.sizeBytes });
}

function knownFileSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function tooLargeError(maxBytes: number, observedSizeBytes: number) {
  return new FileSizePreflightError({
    code: 'file_too_large',
    message: `This file is larger than ${formatMiB(maxBytes)}. Choose a smaller file and retry.`,
    maxBytes,
    observedSizeBytes,
  });
}

function formatMiB(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} MB`;
}

function changedFileError(preflight: FileSizePreflightResult) {
  return new FileSizePreflightError({
    code: 'file_changed',
    message: 'The selected file changed before upload. Choose it again and retry.',
    maxBytes: preflight.maxBytes,
    observedSizeBytes: preflight.sizeBytes,
  });
}

function decodeCanonicalBase64(base64: string): ArrayBuffer {
  if (base64.length === 0 || base64.length % 4 !== 0) {
    throw new Error('Invalid base64 length.');
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((base64.length / 4) * 3 - padding);
  let outputIndex = 0;

  for (let index = 0; index < base64.length; index += 4) {
    const lastGroup = index + 4 === base64.length;
    const first = base64Value(base64.charCodeAt(index));
    const second = base64Value(base64.charCodeAt(index + 1));
    const thirdCode = base64.charCodeAt(index + 2);
    const fourthCode = base64.charCodeAt(index + 3);
    const thirdPadding = thirdCode === 61;
    const fourthPadding = fourthCode === 61;
    const third = thirdPadding ? 0 : base64Value(thirdCode);
    const fourth = fourthPadding ? 0 : base64Value(fourthCode);

    if (
      first < 0 ||
      second < 0 ||
      third < 0 ||
      fourth < 0 ||
      (!lastGroup && (thirdPadding || fourthPadding)) ||
      (thirdPadding && !fourthPadding)
    ) {
      throw new Error('Invalid base64 payload.');
    }

    const group = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < output.length) output[outputIndex++] = (group >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (group >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = group & 0xff;
  }

  return output.buffer;
}

function base64Value(charCode: number): number {
  if (charCode >= 65 && charCode <= 90) return charCode - 65;
  if (charCode >= 97 && charCode <= 122) return charCode - 71;
  if (charCode >= 48 && charCode <= 57) return charCode + 4;
  if (charCode === 43) return 62;
  if (charCode === 47) return 63;
  return -1;
}
