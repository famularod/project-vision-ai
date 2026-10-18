/** Authenticated membership of one newly exported multipart backup part. */
export type BackupPartContext = Readonly<{
  version: 1;
  setNonce: string;
  backupId: string;
  partIndex: number;
  partCount: number;
  role: 'records_and_assets' | 'assets';
}>;

export const BOUND_COMPLETE_BACKUP_ARCHIVE_VERSION = 2 as const;
export const BOUND_BACKUP_PART_ENVELOPE_VERSION = 2 as const;
export const BACKUP_SET_NONCE_BYTES = 32;

/** Copy only a complete, supported context; never borrow a mutable header as authority. */
export function parseBackupPartContext(value: unknown): BackupPartContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (Object.keys(c).sort().join(',') !== 'backupId,partCount,partIndex,role,setNonce,version' ||
      c.version !== 1 || typeof c.setNonce !== 'string' || !/^[a-f0-9]{64}$/.test(c.setNonce) ||
      typeof c.backupId !== 'string' || !c.backupId.trim() || c.backupId.includes('\0') ||
      !Number.isSafeInteger(c.partIndex) || !Number.isSafeInteger(c.partCount) ||
      (c.partIndex as number) < 0 || (c.partCount as number) < 1 || (c.partIndex as number) >= (c.partCount as number) ||
      c.role !== (c.partIndex === 0 ? 'records_and_assets' : 'assets')) return null;
  const role: BackupPartContext['role'] = c.partIndex === 0 ? 'records_and_assets' : 'assets';
  return Object.freeze({ version: 1, setNonce: c.setNonce, backupId: c.backupId,
    partIndex: c.partIndex as number, partCount: c.partCount as number, role });
}

export function backupPartContextKey(context: BackupPartContext): string {
  return JSON.stringify([context.version, context.setNonce, context.backupId,
    context.partIndex, context.partCount, context.role]);
}

/** Canonical, domain-separated AAD for BOTH state and every asset. */
export function backupPartAssociatedData(context: BackupPartContext, domain: string): string {
  return JSON.stringify(['vitruvius.multipart/2', backupPartContextKey(context), domain]);
}
