import AsyncStorage from '@react-native-async-storage/async-storage';

import { removedFieldUpdateDocumentKey, type RemovedFieldUpdateDocuments } from './FieldUpdateDocumentPatch';

/**
 * Documents this device took off a field update on purpose, kept on the
 * device: an older copy the iPad sends afterwards still lists one, and the
 * refresh keeps it off and takes it off the cloud copy again. Owner-sensitive
 * prefix: an account switch moves it with that owner's data.
 */
export const REMOVED_FIELD_UPDATE_DOCUMENTS_STORAGE_KEY = 'projectPhotoUpdate.removedFieldUpdateDocuments.v1';
const REMOVED_FIELD_UPDATE_DOCUMENTS_LIMIT = 500;

let removedDocumentsWrite: Promise<unknown> = Promise.resolve();

export async function loadRemovedFieldUpdateDocuments(): Promise<RemovedFieldUpdateDocuments> {
  await removedDocumentsWrite;
  return new Set(await readRemovedDocumentKeys());
}

export function recordRemovedFieldUpdateDocument(updateId: string, documentId: string): Promise<void> {
  const key = removedFieldUpdateDocumentKey(updateId, documentId);
  const write = removedDocumentsWrite.then(async () => {
    const keys = (await readRemovedDocumentKeys()).filter(existing => existing !== key);
    await AsyncStorage.setItem(
      REMOVED_FIELD_UPDATE_DOCUMENTS_STORAGE_KEY,
      JSON.stringify([...keys, key].slice(-REMOVED_FIELD_UPDATE_DOCUMENTS_LIMIT)),
    );
  });
  removedDocumentsWrite = write.catch(() => undefined);
  return write;
}

async function readRemovedDocumentKeys(): Promise<string[]> {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(REMOVED_FIELD_UPDATE_DOCUMENTS_STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string' && key.includes('\n')) : [];
  } catch {
    return [];
  }
}
