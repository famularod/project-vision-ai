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
 * This file: what he sees on Choose Contact (the component the screen now wires). The fault itself: m2c-492a.
 * Made-up names and numbers. No network.
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

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PhoneContactPicker } from '../../components/phone-contact-picker';
import type { PhoneContactRead } from '../../services/ReportRecipients';

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

const picked = jest.fn((_contact: PhoneContactRead) => undefined);
beforeEach(() => {
  picked.mockClear();
  native.getPermissionsAsync.mockReset().mockImplementation(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }));
  native.requestPermissionsAsync.mockReset().mockImplementation(async () => ({ granted: true, canAskAgain: true, status: 'granted' }));
  FakeContact.presentPicker.mockReset().mockImplementation(async () => new FakeContact('dana'));
});
const SLOW = { timeout: 10_000 } as const;
const tap = async () => {
  fireEvent.press(screen.getByRole('button', { name: 'Choose Contact' }));
  await waitFor(() => expect(screen.queryByText('Opening contacts...')).toBeNull(), SLOW);
};

describe('4.92: Choose Contact on Field Updates, with the real expo-contacts 57', () => {
  it('nothing touches contacts until he taps; then access is asked for once and the contact he picks is read whole', async () => {
    render(<PhoneContactPicker onPicked={picked} />);
    expect(screen.getByText('Use the phone contact picker to search and choose one recipient at a time.')).toBeTruthy();
    expect(native.getPermissionsAsync).not.toHaveBeenCalled();
    expect(FakeContact.presentPicker).not.toHaveBeenCalled();
    await tap();
    expect(native.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(picked).toHaveBeenCalledWith({
      id: 'dana', name: 'Dana Ruiz',
      emails: ['dana@example.com', 'd.ruiz@example.com'],
      phones: ['+1 555 0199', '+1 555 0100'],
    });
    expect(screen.getByText('Use the phone contact picker to search and choose one recipient at a time.')).toBeTruthy();
  });

  it('a contact with no name is named by its company', async () => {
    FakeContact.presentPicker.mockImplementation(async () => new FakeContact('firm'));
    render(<PhoneContactPicker onPicked={picked} />);
    await tap();
    expect(picked).toHaveBeenCalledWith({ id: 'firm', name: 'Northside Painting', emails: ['office@example.com'], phones: [] });
  });

  it('he says no: "Contacts access needed", and the list does not open; refused before, he is not asked again', async () => {
    native.requestPermissionsAsync.mockImplementation(async () => ({ granted: false, canAskAgain: false, status: 'denied' }));
    render(<PhoneContactPicker onPicked={picked} />);
    await tap();
    expect(screen.getByText('Contacts access needed')).toBeTruthy();
    expect(screen.getByText('Allow contacts access in Settings, then come back here to choose recipients.')).toBeTruthy();
    expect(FakeContact.presentPicker).not.toHaveBeenCalled();
    native.getPermissionsAsync.mockImplementation(async () => ({ granted: false, canAskAgain: false, status: 'denied' }));
    native.requestPermissionsAsync.mockClear();
    await tap();
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(picked).not.toHaveBeenCalled();
  });

  it('each other failure says its own reason, and none says "Rebuild needed"', async () => {
    render(<PhoneContactPicker onPicked={picked} />);
    FakeContact.presentPicker.mockImplementation(async () => new FakeContact('sam'));
    await tap();
    expect(screen.getByText('Sam Ortiz has no email address or phone number saved. Choose a contact with one.')).toBeTruthy();
    FakeContact.presentPicker.mockImplementation(async () => new FakeContact('hidden'));
    await tap();
    expect(screen.getByText('Contact could not be read')).toBeTruthy();
    FakeContact.presentPicker.mockImplementation(async () => { throw new Error('The picker failed'); });
    await tap();
    expect(screen.getByText('Contacts unavailable')).toBeTruthy();
    FakeContact.presentPicker.mockImplementation(async () => null);
    await tap();
    expect(screen.getByText('Use the phone contact picker to search and choose one recipient at a time.')).toBeTruthy();
    expect(screen.queryByText('Rebuild needed')).toBeNull();
    expect(picked).not.toHaveBeenCalled();
  });

  it('"Rebuild needed" only when the installed app has no contacts module', async () => {
    // The package itself, loaded where its native half is missing: the read says so, and only then.
    mockNative.missing = true;
    let read: unknown = null;
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('../../services/ReportRecipients') as typeof import('../../services/ReportRecipients');
      read = await fresh.pickPhoneContact();
    });
    mockNative.missing = false;
    expect(read).toEqual({ status: 'missing_module' });
    // What he reads then.
    render(<PhoneContactPicker onPicked={picked} contactsApi={{
      getPermissionsAsync: async () => { throw new Error("Cannot find native module 'ExpoContactsNext'"); },
      requestPermissionsAsync: async () => ({ granted: false }),
      presentPicker: async () => null,
    }} />);
    await tap();
    expect(screen.getByText('Rebuild needed')).toBeTruthy();
    expect(screen.getByText('The installed app does not include the native contacts picker yet. Rebuild the app, then try again.')).toBeTruthy();
  });
});
