import * as WebBrowser from 'expo-web-browser';
import type { ReferenceDocument } from '../types';
import { googleDriveReferenceDocumentUrl } from './ReferenceDocumentOpenAccess';

/** Open this exact file in a browser sheet. Linking.openURL can merely resume
 * an installed Drive app's previous preview instead of navigating to the file.
 * No OAuth session, cookie clearing, credential transfer or URL fallback here.
 * Browser dismissal is not evidence that the source was successfully viewed.
 */
export async function openGoogleDriveReferenceDocument(document: ReferenceDocument): Promise<boolean> {
  const url = googleDriveReferenceDocumentUrl(document);
  if (!url) return false;
  await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
  return true;
}
