import type * as ExpoContacts from 'expo-contacts';

import type { PIEReportDraft } from './PIEReporter';

/**
 * Open item 7.21, part two (the coordinator's yes, 13 Oct 2026): recipients for Email Report and Text Report can be
 * picked from his contacts.
 *
 * expo-contacts is already in the app (Field Updates' recipients) and its permission sentences are already declared
 * (iPhone: NSContactsUsageDescription; Android: READ_CONTACTS). Version 57 (this app's SDK) reads a contact through
 * its class API: the system picker (`Contact.presentPicker`) hands back the contact chosen, and reading its email
 * addresses and phone numbers needs contacts access. Access is asked for here, when he taps Add from Contacts, and
 * never before. If he says no, nothing else changes: Mail and Messages open as they do today, and he types the
 * addresses there. No new native module and no new permission.
 */
export type ReportRecipient = Readonly<{
  /** One per contact chosen. */
  key: string;
  name: string;
  /** The address Email Report fills in, if the contact has one. */
  email: string | null;
  /** The number Text Report fills in, if the contact has one (a mobile number first). */
  phone: string | null;
}>;

/** What became of a tap on Add from Contacts. */
export type ReportRecipientPick =
  | Readonly<{ status: 'picked'; recipient: ReportRecipient }>
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'denied' }>
  | Readonly<{ status: 'no_address'; name: string }>
  /** Chosen, but its details could not be read (on an iPhone that shares only some contacts with the app). */
  | Readonly<{ status: 'unreadable' }>
  | Readonly<{ status: 'unavailable' }>;

type PermissionAnswer = Readonly<{ granted: boolean; canAskAgain?: boolean }>;
type PickedContact = {
  id?: string;
  getFullName(): Promise<string | null>;
  getEmails(): Promise<ReadonlyArray<{ address?: string | null }>>;
  getPhones(): Promise<ReadonlyArray<{ number?: string | null; label?: string | null }>>;
};
/** The parts of expo-contacts used here (a stand-in in tests). */
export type ReportContactsApi = Readonly<{
  getPermissionsAsync(): Promise<PermissionAnswer>;
  requestPermissionsAsync(): Promise<PermissionAnswer>;
  presentPicker(): Promise<PickedContact | null>;
}>;

/**
 * expo-contacts, loaded when he taps Add from Contacts and not when Reports loads: the module sets up its native class
 * as it loads, and the Reports screen is also loaded where there is no native module (the screen's own tests).
 */
function contactsModule(): typeof ExpoContacts {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-contacts') as typeof ExpoContacts;
}

const expoContacts: ReportContactsApi = {
  getPermissionsAsync: () => contactsModule().getPermissionsAsync(),
  requestPermissionsAsync: () => contactsModule().requestPermissionsAsync(),
  presentPicker: () => contactsModule().Contact.presentPicker() as Promise<PickedContact | null>,
};

/**
 * He tapped Add from Contacts: asks for contacts access if it has not been given (the only place it is asked), opens
 * the system contact list, and reads the contact he chose. Never throws.
 */
export async function pickReportRecipient(api: ReportContactsApi = expoContacts): Promise<ReportRecipientPick> {
  try {
    let access = await api.getPermissionsAsync();
    if (!access.granted && access.canAskAgain !== false) access = await api.requestPermissionsAsync();
    if (!access.granted) return { status: 'denied' };
    const contact = await api.presentPicker();
    if (!contact) return { status: 'cancelled' };
    const name = clean(await contact.getFullName().catch(() => null));
    const emails = await contact.getEmails().catch(() => null);
    const phones = await contact.getPhones().catch(() => null);
    if (!emails && !phones) return { status: 'unreadable' };
    const email = (emails ?? []).map(item => clean(item.address)).find(Boolean) || null;
    const phone = ((phones ?? []).find(item => /mobile|iphone|cell/i.test(item.label ?? '') && clean(item.number)) ??
      (phones ?? []).find(item => clean(item.number)))?.number;
    if (!email && !clean(phone)) return { status: 'no_address', name: name || 'That contact' };
    return {
      status: 'picked',
      recipient: Object.freeze({
        key: clean(contact.id) || `${name}|${email ?? ''}|${clean(phone)}`,
        name: name || email || clean(phone),
        email,
        phone: clean(phone) || null,
      }),
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/** The list with `recipient` added once (the same contact chosen again is not added twice). */
export function withReportRecipient(list: readonly ReportRecipient[], recipient: ReportRecipient): ReportRecipient[] {
  return list.some(item => item.key === recipient.key) ? [...list] : [...list, recipient];
}

/** What he reads after a tap on Add from Contacts that did not add anyone; nothing for a cancel or an add. */
export function reportRecipientPickMessage(pick: ReportRecipientPick): string {
  if (pick.status === 'denied') {
    return 'Contacts access is off for Vitruvius, so your contacts could not open. ' +
      'Type the addresses in Mail or Messages as before, or turn on Contacts for Vitruvius in Settings.';
  }
  if (pick.status === 'no_address') {
    return `${pick.name} has no email address or phone number saved. Choose another contact, or type the address in Mail or Messages.`;
  }
  if (pick.status === 'unreadable') {
    return 'That contact could not be read by Vitruvius. Choose another, or type the address in Mail or Messages.';
  }
  if (pick.status === 'unavailable') {
    return 'Your contacts could not be opened on this device. Type the addresses in Mail or Messages as before.';
  }
  return '';
}

/** A report handed to Email Report or Text Report, with the recipients he chose. */
export type ReportWithRecipients = PIEReportDraft & Readonly<{ recipients?: readonly ReportRecipient[] }>;

export function withReportRecipients(report: PIEReportDraft, recipients: readonly ReportRecipient[]): ReportWithRecipients {
  return recipients.length > 0 ? { ...report, recipients } : report;
}

/** The addresses Email Report opens Mail with (none: Mail opens as before, with no one filled in). */
export function reportEmailRecipients(report: PIEReportDraft): string[] {
  return [...new Set(((report as ReportWithRecipients).recipients ?? []).map(item => item.email).filter((value): value is string => Boolean(value)))];
}

/** The numbers Text Report opens Messages with (none: Messages opens as before). */
export function reportTextRecipients(report: PIEReportDraft): string[] {
  return [...new Set(((report as ReportWithRecipients).recipients ?? []).map(item => item.phone).filter((value): value is string => Boolean(value)))];
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}
