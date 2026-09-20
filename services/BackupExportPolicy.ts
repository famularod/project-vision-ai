// This is the current device-export capability, not a disaster-recovery claim.
// Field Notes use an owner-scoped repository outside the legacy restore journal.
export const DEVICE_BACKUP_SCOPE_NOTICE =
  'Limited device backup: includes projects (with cover photos and project data), field updates, photos, documents, schedules, contacts, work areas, and confirmed Core memories. Field Notes are not included. Also not included: report history, Vitruvius reasoning records, walk sessions, and unsent sync items. This is not a complete account or cloud backup. Keep unsynced Field Notes on this device; do not uninstall the app or clear its data.';
export const DEVICE_BACKUP_RESTORE_NOTICE =
  'Only the data included in this device backup can be restored. Field Notes are not included and existing Field Notes will not be replaced. This does not restore the entire cloud account.';
/**
 * Records-only export: every record the full backup carries, with no file
 * bytes. Photos, drawings and project documents are what exhaust the archive
 * budget, so a phone whose full backup cannot fit can still protect the data
 * that is not recoverable from anywhere else. It is a reduced export, not a
 * substitute for the full one — say so wherever it is offered.
 */
export const DEVICE_RECORDS_ONLY_SCOPE_NOTICE =
  'Records only: projects, field update details, schedules, contacts, work areas, document details, and confirmed Core memories. No photos, drawings, or document files are included, so this cannot restore your images. Use it when the full device backup is too large to fit, and keep the original files on this device.';

export const MAX_DEVICE_BACKUP_BYTES = 128 * 1024 * 1024;
export const DEVICE_BACKUP_SIZE_ERROR =
  'This device backup cannot fit within the 128 MB archive limit. Encrypted file encoding adds size; no partial backup will be shared. Keep the original files and device data.';

/** A lower bound, not a promise that encryption or the final JSON will fit.
 * Reserve from file metadata BEFORE reading bytes. Still check the actual read
 * and the final UTF-8 JSON size, because metadata can drift and JSON adds overhead.
 */
export function createBackupAssetBudget(limit = MAX_DEVICE_BACKUP_BYTES) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid backup limit.');
  const sizes = new Map<string, number>();
  let encodedBytes = 0;
  return Object.freeze({
    reserve(id: string, size: unknown) {
      if (!id || sizes.has(id)) throw new Error('Duplicate or missing backup asset identity.');
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
        throw new Error('A required backup file has no trustworthy size. No partial backup will be shared.');
      }
      const encoded = 4 * Math.ceil(size / 3);
      if (!Number.isSafeInteger(encoded) || encodedBytes + encoded >= limit) {
        throw new Error(DEVICE_BACKUP_SIZE_ERROR);
      }
      sizes.set(id, size);
      encodedBytes += encoded;
    },
    verifyRead(id: string, actualBytes: number) {
      if (!sizes.has(id) || sizes.get(id) !== actualBytes) {
        throw new Error('A backup file changed while it was being read. No partial backup will be shared.');
      }
    },
  });
}

export type BackupAssetBudget = ReturnType<typeof createBackupAssetBudget>;

export async function readBudgetedBackupBytes(
  id: string,
  size: unknown,
  budget: BackupAssetBudget,
  readBytes: () => Promise<Uint8Array>,
): Promise<Uint8Array> {
  budget.reserve(id, size);
  const bytes = await readBytes();
  budget.verifyRead(id, bytes.byteLength);
  return bytes;
}

export function assertBackupSerializedFits(serialized: string, limit = MAX_DEVICE_BACKUP_BYTES) {
  // JSON strings may contain non-ASCII filenames. UTF-16 string.length is not bytes.
  if (new TextEncoder().encode(serialized).byteLength > limit) {
    throw new Error(DEVICE_BACKUP_SIZE_ERROR);
  }
}
