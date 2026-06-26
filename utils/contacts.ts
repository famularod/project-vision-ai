import type * as Contacts from 'expo-contacts';
import type { ProjectContact } from '../types';

function optionalString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(
      values
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeContact(value: Partial<ProjectContact>): ProjectContact {
  const emails = uniqueStrings(
    Array.isArray(value.emails)
      ? value.emails.filter(item => typeof item === 'string')
      : [optionalString(value.email)],
  );
  const phones = uniqueStrings(
    Array.isArray(value.phones)
      ? value.phones.filter(item => typeof item === 'string')
      : [optionalString(value.phone)],
  );
  const selectedEmail =
    typeof value.selectedEmail === 'string' &&
    emails.includes(value.selectedEmail)
      ? value.selectedEmail
      : emails[0] || null;
  const selectedPhone =
    typeof value.selectedPhone === 'string' &&
    phones.includes(value.selectedPhone)
      ? value.selectedPhone
      : phones[0] || null;

  return {
    id: optionalString(value.id),
    name: optionalString(value.name) || 'Unnamed Contact',
    email: selectedEmail || emails[0] || optionalString(value.email),
    phone: selectedPhone || phones[0] || optionalString(value.phone),
    emails,
    phones,
    selectedEmail,
    selectedPhone,
  };
}

export function selectedContactEmail(contact: ProjectContact) {
  return contact.selectedEmail || contact.email;
}

export function selectedContactPhone(contact: ProjectContact) {
  return contact.selectedPhone || contact.phone;
}

function phoneContactDisplayName(contact: Contacts.ExistingContact) {
  return (
    contact.name ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    'Unnamed Contact'
  );
}

function contactEmails(contact: Contacts.ExistingContact) {
  return uniqueStrings(
    (contact.emails || [])
      .map(email => email.email)
      .filter((email): email is string => Boolean(email)),
  );
}

function contactPhones(contact: Contacts.ExistingContact) {
  return uniqueStrings(
    (contact.phoneNumbers || [])
      .map(phone => phone.number)
      .filter((phone): phone is string => Boolean(phone)),
  );
}

export function phoneContactToProjectContact(
  contact: Contacts.ExistingContact,
): ProjectContact {
  const emails = contactEmails(contact);
  const phones = contactPhones(contact);
  const selectedEmail = emails[0] || null;
  const selectedPhone = phones[0] || null;

  return {
    id: contact.id || `phone-${Date.now()}`,
    name: phoneContactDisplayName(contact),
    email: selectedEmail || '',
    phone: selectedPhone || '',
    emails,
    phones,
    selectedEmail,
    selectedPhone,
  };
}
