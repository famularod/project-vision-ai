#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'screens', 'AdminScreen.tsx'), 'utf8');
const backupPolicy = fs.readFileSync(path.join(root, 'services', 'BackupExportPolicy.ts'), 'utf8');
const web = fs.readFileSync(
  path.join(root, 'components', 'web-shell', 'desktop-read-only-shell.tsx'),
  'utf8',
);

for (const marker of [
  '{DEVICE_BACKUP_SCOPE_NOTICE}',
  'Use a passphrase of at least 12 characters.',
  'Vitruvius cannot recover a forgotten passphrase.',
  'title="Export Limited Device Backup"',
  'title="Restore Device Backup"',
]) {
  assert(admin.includes(marker), `Mobile device-backup UI must disclose: ${marker}`);
}

for (const marker of [
  'Field Notes are not included.',
  'not a complete account or cloud backup',
  'existing Field Notes will not be replaced',
  '128 MB archive limit',
]) {
  assert(backupPolicy.includes(marker), `Device backup limitations must disclose: ${marker}`);
}

for (const marker of [
  '${DEVICE_BACKUP_SCOPE_NOTICE}',
  '${DEVICE_BACKUP_RESTORE_NOTICE}',
  'Vitruvius cannot recover a forgotten passphrase.',
  'Device backup restored',
  'Backup share sheet closed',
  'Confirm that the file was saved',
]) {
  assert(app.includes(marker), `Mobile device-backup messaging must include: ${marker}`);
}

for (const marker of [
  'title="Data export and recovery"',
  'Download an unencrypted JSON export of project records and media metadata',
  '>Download Data Export</Text>',
  'label="Choose Vitruvius data export"',
]) {
  assert(web.includes(marker), `Web data export must disclose: ${marker}`);
}

for (const misleadingMobileClaim of [
  'Complete backups include',
  'title="Export Complete Backup"',
  'Complete backup shared',
  'Complete backup restored',
  'Create an unencrypted JSON export; photo and document files are not included',
  'This is an unencrypted JSON data export.',
  'Import this data export?',
]) {
  assert(
    !`${app}\n${admin}`.includes(misleadingMobileClaim),
    `Mobile backup UI must not retain the obsolete claim: ${misleadingMobileClaim}`,
  );
}

for (const misleading of [
  'A secure temporary folder for the backup file',
  'Download a protected copy of the shared record',
  '>Download Backup</Text>',
]) {
  assert(
    !`${app}\n${admin}\n${web}`.includes(misleading),
    `Data-export UI must not make the misleading claim: ${misleading}`,
  );
}

console.log('Backup language PASS: limited encrypted device backup excludes Field Notes and cloud restore; web export limits remain explicit.');
