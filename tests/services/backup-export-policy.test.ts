import {
  createBackupAssetBudget, readBudgetedBackupBytes, assertBackupSerializedFits,
  DEVICE_BACKUP_SCOPE_NOTICE, DEVICE_BACKUP_RESTORE_NOTICE,
} from '../../services/BackupExportPolicy';

describe('device backup limits and truthful coverage', () => {
  test('discloses the Field Notes and cloud-restore gaps', () => {
    expect(DEVICE_BACKUP_SCOPE_NOTICE).toContain('Field Notes are not included');
    expect(DEVICE_BACKUP_SCOPE_NOTICE).toContain('not a complete account or cloud backup');
    expect(DEVICE_BACKUP_RESTORE_NOTICE).toContain('existing Field Notes will not be replaced');
  });

  test('rejects a 107 MB drawing before reading its body (encoding alone exceeds 128 MiB)', async () => {
    const read = jest.fn();
    await expect(readBudgetedBackupBytes('drawing', 107_000_000, createBackupAssetBudget(), read))
      .rejects.toThrow('128 MB');
    expect(read).not.toHaveBeenCalled();
  });

  test('accounts for cumulative encoded size before the next file read', async () => {
    const budget = createBackupAssetBudget(13);
    const first = Uint8Array.from([1, 2, 3, 4]); // 8 encoded bytes
    expect(await readBudgetedBackupBytes('one', 4, budget, async () => first)).toBe(first);
    const second = jest.fn();
    await expect(readBudgetedBackupBytes('two', 4, budget, second)).rejects.toThrow('archive limit');
    expect(second).not.toHaveBeenCalled();
  });

  test.each([undefined, null, -1, NaN, Infinity, 1.5, '12'])('rejects untrustworthy size %s before reading', async size => {
    const read = jest.fn();
    await expect(readBudgetedBackupBytes('one', size, createBackupAssetBudget(), read))
      .rejects.toThrow('trustworthy size');
    expect(read).not.toHaveBeenCalled();
  });

  test('rejects size drift after metadata lookup', async () => {
    await expect(readBudgetedBackupBytes('one', 2, createBackupAssetBudget(), async () => new Uint8Array(3)))
      .rejects.toThrow('changed');
  });

  test('does not return partial data when reading fails', async () => {
    await expect(readBudgetedBackupBytes('one', 2, createBackupAssetBudget(), async () => {
      throw new Error('disk unavailable');
    })).rejects.toThrow('disk unavailable');
  });

  test('rejects duplicate asset identities', () => {
    const budget = createBackupAssetBudget();
    budget.reserve('one', 1);
    expect(() => budget.reserve('one', 1)).toThrow('Duplicate');
  });

  test('keeps budgets separate between attempts', () => {
    const first = createBackupAssetBudget(9);
    first.reserve('one', 6);
    expect(() => createBackupAssetBudget(9).reserve('one', 6)).not.toThrow();
  });

  test('checks final UTF-8 size, including non-ASCII names and JSON overhead', () => {
    expect(() => assertBackupSerializedFits('1234', 4)).not.toThrow();
    expect(() => assertBackupSerializedFits('12345', 4)).toThrow('archive limit');
    expect('🧱🧱'.length).toBe(4);
    expect(() => assertBackupSerializedFits('🧱🧱', 4)).toThrow('archive limit');
  });
});
