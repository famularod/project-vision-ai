#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'screens', 'AdminScreen.tsx'), 'utf8');
const web = fs.readFileSync(
  path.join(root, 'components', 'web-shell', 'desktop-read-only-shell.tsx'),
  'utf8',
);

for (const marker of [
  'Complete backups include project records, photos, and documents.',
  'They are encrypted with a passphrase of at least 12 characters.',
  'Vitruvius cannot recover a forgotten passphrase.',
  'title="Export Complete Backup"',
  'title="Restore Complete Backup"',
]) {
  assert(admin.includes(marker), `Mobile complete-backup UI must disclose: ${marker}`);
}

for (const marker of [
  'project records, photos, and documents are encrypted',
  'Vitruvius cannot recover a forgotten passphrase.',
  'Complete backup restored',
]) {
  assert(app.includes(marker), `Mobile complete-backup messaging must include: ${marker}`);
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

console.log('Backup language PASS: mobile archives are complete and encrypted; web export limits remain explicit.');
