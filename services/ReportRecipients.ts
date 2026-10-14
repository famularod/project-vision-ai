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
  | Exclude<PhoneContactPick, Readonly<{ status: 'picked' }>>;

/**
 * Open item 4.92 (the coordinator's order, 13 Oct 2026): one read of a contact he chooses, for Reports' Add from
 * Contacts and for Field Updates' Choose Contact. Field Updates called the function version 57 removed
 * (presentContactPickerAsync now throws "deprecated"), and took that for a missing native picker: "Rebuild needed".
 */
export type PhoneContactRead = Readonly<{
  /** The address book's own id. */
  id: string;
  /** His name for the contact, or its company; '' when it has neither. */
  name: string;
  /** Every email address, in the address book's order, each once. */
  emails: readonly string[];
  /** Every phone number, a mobile number first, each once. */
  phones: readonly string[];
}>;

/** What became of a tap on Choose Contact or Add from Contacts, each with its true reason. */
export type PhoneContactPick =
  | Readonly<{ status: 'picked'; contact: PhoneContactRead }>
  | Readonly<{ status: 'cancelled' }>
  /** He said no to contacts access, now or before. */
  | Readonly<{ status: 'denied' }>
  | Readonly<{ status: 'no_address'; name: string }>
  /** Chosen, but its details could not be read (on an iPhone that shares only some contacts with the app). */
  | Readonly<{ status: 'unreadable' }>
  /** The contact list could not be opened (the system said no, or it failed). */
  | Readonly<{ status: 'unavailable' }>
  /** The installed app has no contacts module at all: only then does a new build help. */
  | Readonly<{ status: 'missing_module' }>;

type PermissionAnswer = Readonly<{ granted: boolean; canAskAgain?: boolean }>;
type PickedContact = {
  id?: string;
  getFullName(): Promise<string | null>;
  getCompany?(): Promise<string | null>;
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
 * expo-contacts, loaded when he taps Add from Contacts or Choose Contact and not before: the module sets up its native
 * class as it loads (an app without the module would stop there), and the screens are also loaded where there is no
 * native module (their own tests).
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

/** expo-modules-core's own words when an app was built without a native module. */
function isMissingNativeModule(error: unknown): boolean {
  return error instanceof Error && /Cannot find native module/i.test(error.message);
}

/**
 * He tapped Choose Contact or Add from Contacts: asks for contacts access if it has not been given (the only place
 * it is asked; never again after he said no), opens the system contact list, and reads the contact he chose. Never
 * throws.
 */
export async function pickPhoneContact(api: ReportContactsApi = expoContacts): Promise<PhoneContactPick> {
  try {
    let access = await api.getPermissionsAsync();
    if (!access.granted && access.canAskAgain !== false) access = await api.requestPermissionsAsync();
    if (!access.granted) return { status: 'denied' };
    const contact = await api.presentPicker();
    if (!contact) return { status: 'cancelled' };
    const name = clean(await contact.getFullName().catch(() => null)) ||
      clean(await (contact.getCompany?.() ?? Promise.resolve(null)).catch(() => null));
    const emailRecords = await contact.getEmails().catch(() => null);
    const phoneRecords = await contact.getPhones().catch(() => null);
    if (!emailRecords && !phoneRecords) return { status: 'unreadable' };
    const emails = [...new Set((emailRecords ?? []).map(item => clean(item.address)).filter(Boolean))];
    const mobileFirst = [
      ...(phoneRecords ?? []).filter(item => /mobile|iphone|cell/i.test(item.label ?? '')),
      ...(phoneRecords ?? []).filter(item => !/mobile|iphone|cell/i.test(item.label ?? '')),
    ];
    const phones = [...new Set(mobileFirst.map(item => clean(item.number)).filter(Boolean))];
    if (emails.length === 0 && phones.length === 0) return { status: 'no_address', name: name || 'That contact' };
    return {
      status: 'picked',
      contact: Object.freeze({
        id: clean(contact.id) || `${name}|${emails[0] ?? ''}|${phones[0] ?? ''}`,
        name,
        emails: Object.freeze(emails),
        phones: Object.freeze(phones),
      }),
    };
  } catch (error) {
    return isMissingNativeModule(error) ? { status: 'missing_module' } : { status: 'unavailable' };
  }
}

/**
 * He tapped Add from Contacts on Reports: the contact he chose, with the address Email Report fills in and the number
 * Text Report fills in. Never throws.
 */
export async function pickReportRecipient(api: ReportContactsApi = expoContacts): Promise<ReportRecipientPick> {
  const pick = await pickPhoneContact(api);
  if (pick.status !== 'picked') return pick;
  const { contact } = pick;
  const email = contact.emails[0] ?? null;
  const phone = contact.phones[0] ?? null;
  return {
    status: 'picked',
    recipient: Object.freeze({
      key: contact.id,
      name: contact.name || email || phone || '',
      email,
      phone,
    }),
  };
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
  if (pick.status === 'missing_module') {
    return 'This installed app has no contact picker; a new build of the app adds it. Type the addresses in Mail or Messages meanwhile.';
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
