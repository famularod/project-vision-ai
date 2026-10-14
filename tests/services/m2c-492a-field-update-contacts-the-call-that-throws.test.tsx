/**
 * Open item 4.92 (found by the M2b fixer; the coordinator's order of 13 Oct 2026): Field Updates' "choose recipients
 * from your contacts" works on expo-contacts 57.
 *
 * Before: the Recipients screen of a field update (App.tsx ContactsScreen) called Contacts.presentContactPickerAsync()
 * from "expo-contacts". Version 57, the one this app is built with, keeps that name only to throw "Method
 * presentContactPickerAsync imported from "expo-contacts" is deprecated." The screen took any error naming that function
 * for a missing native picker and said "Rebuild needed. The installed app does not include the native contacts picker
 * yet.": the picker never opened, and the reason given was untrue.
 *
 * Now Choose Contact reads the contact as Reports' Add from Contacts does (services/ReportRecipients pickPhoneContact):
 * expo-contacts is loaded, and contacts access asked for, only when he taps; each failure says its own reason; "Rebuild
 * needed" only when the app really has no contacts module. These tests run the REAL expo-contacts 57 JavaScript, with
 * only its native half stood in (expo-modules-core's requireNativeModule), so the calls are the package's own.
 * This file: the fault itself (red before the change: the screen called the function that throws). The screen's
 * new behaviour: m2c-492b. Made-up names and numbers. No network.
 */
const mockNative = { missing: false, module: null as unknown };
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core');
  return {
    ...actual,
    requireNativeModule: (name: string) => {
      if (name === 'ExpoContactsNext' || name === 'ExpoContacts') {
        if (mockNative.missing) throw new Error(`Cannot find native module '${name}'`);
        return mockNative.module;
      }
      return actual.requireNativeModule(name);
    },
  };
});

import * as fs from 'fs';
import * as path from 'path';

type Card = { name: string; company?: string; emails: string[]; phones: Array<[string, string]>; unreadable?: boolean };
const BOOK: Record<string, Card> = {
  dana: { name: 'Dana Ruiz', emails: ['dana@example.com', 'dana@example.com', 'd.ruiz@example.com'], phones: [['work', '+1 555 0100'], ['mobile', '+1 555 0199']] },
  sam: { name: 'Sam Ortiz', emails: [], phones: [] },
  hidden: { name: 'Kept Private', emails: ['x@example.com'], phones: [], unreadable: true },
  firm: { name: '', company: 'Northside Painting', emails: ['office@example.com'], phones: [] },
};
/** The native half of expo-contacts as version 57 shapes it: a Contact class, its static picker, its readers. */
class FakeContact {
  id: string;
  constructor(id: string) { this.id = id; }
  static presentPicker = jest.fn(async (): Promise<FakeContact | null> => new FakeContact('dana'));
  private card() { const card = BOOK[this.id]; if (!card || card.unreadable) throw new Error(`ContactNotFound ${this.id}`); return card; }
  async getFullName() { return this.card().name; }
  async getCompany() { return this.card().company ?? null; }
  async getEmails() { return this.card().emails.map((address, index) => ({ id: `e${index}`, address })); }
  async getPhones() { return this.card().phones.map(([label, number], index) => ({ id: `p${index}`, label, number })); }
}
const native = {
  Contact: FakeContact,
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true, status: 'granted' })),
  addListener: jest.fn(),
  removeAllListeners: jest.fn(),
};
mockNative.module = native;

describe('4.92: the call the Field Updates screen made, on expo-contacts 57', () => {
  it('presentContactPickerAsync from "expo-contacts" throws "deprecated", whatever the device has', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Contacts = require('expo-contacts') as { presentContactPickerAsync(): Promise<unknown> };
    await expect(Contacts.presentContactPickerAsync()).rejects.toThrow('Method presentContactPickerAsync imported from "expo-contacts" is deprecated.');
  });

  it('App: the Field Updates screen no longer calls it, nor loads expo-contacts before he taps, and only wires the picker', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../App.tsx'), 'utf8');
    expect(app).not.toContain('presentContactPickerAsync');
    expect(app).not.toMatch(/^import \* as Contacts from 'expo-contacts';$/m);
    expect(app).toContain('<PhoneContactPicker onPicked={contact => onTogglePhoneContact(phoneContactToProjectContact(contact))} />');
    expect(app).not.toContain('Rebuild needed');
    expect(app.split('\n').length - 1).toBeLessThanOrEqual(21066);
  });
});
