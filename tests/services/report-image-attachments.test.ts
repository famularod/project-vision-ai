/**
 * Code review, 27 Sep 2026: report email and text said "See Image N" and
 * carried no images. These pin the cited-image order and what the owner is
 * told when an image cannot go with the message.
 */
import {
  expoErrorCode,
  isAttachmentReadError,
  reportCitedImages,
  resolveReportImageAttachments,
} from '../../services/ReportImageAttachments';

function report(areas: Array<Array<[string, number]>>) {
  return {
    locationGroups: [{
      id: 'group',
      title: '2321',
      workAreas: areas.map((references, index) => ({
        id: `area-${index}`,
        imageReferences: references.map(([photoId, imageNumber]) => ({ photoId, imageNumber })),
      })),
    }],
  } as never;
}

describe('report cited images', () => {
  it('lists each cited photo once, in image-number order', () => {
    expect(reportCitedImages(report([[['p3', 3], ['p1', 1]], [['p2', 2], ['p1', 1]]]))).toEqual([
      { photoId: 'p1', imageNumber: 1 },
      { photoId: 'p2', imageNumber: 2 },
      { photoId: 'p3', imageNumber: 3 },
    ]);
  });

  it('attaches local photos in image order and says nothing more when all are attached', async () => {
    const attached = await resolveReportImageAttachments({
      report: report([[['p2', 2], ['p1', 1]]]),
      limit: 20,
      findPhoto: async id => ({ uri: `file:///photos/${id}.jpg` }),
    });
    expect(attached.photos.map(photo => photo.uri)).toEqual(['file:///photos/p1.jpg', 'file:///photos/p2.jpg']);
    expect(attached.note).toBe('');
  });

  it('names images whose photo is not on the device, or is only a cloud link', async () => {
    const attached = await resolveReportImageAttachments({
      report: report([[['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]]]),
      limit: 20,
      findPhoto: async id => id === 'p1' ? { uri: 'file:///p1.jpg' }
        : id === 'p2' ? { uri: 'https://signed.example/p2.jpg' }
          : id === 'p3' ? null
            : Promise.reject(new Error('lookup failed')),
    });
    expect(attached.photos).toHaveLength(1);
    expect(attached.note).toBe('\n\nImages 2, 3 and 4 could not be attached: their photos are not on this device.');
  });

  it('stops at the limit and names the rest', async () => {
    const findPhoto = jest.fn(async (id: string) => ({ uri: `file:///${id}.jpg` }));
    const attached = await resolveReportImageAttachments({
      report: report([[['p1', 1], ['p2', 2], ['p3', 3]]]),
      limit: 2,
      findPhoto,
    });
    expect(attached.photos).toHaveLength(2);
    expect(findPhoto).toHaveBeenCalledTimes(2);
    expect(attached.note).toBe('\n\nImage 3 is not attached, to keep this message a sendable size.');
  });
});

// Review pass 3, 28 Sep 2026: only an attachment the composer could not read
// is retried as text-only; a real send failure is not.
describe('composer attachment errors', () => {
  it.each([
    { code: 'ERR_FILE_SYSTEM_READ_PERMISSION', message: 'Missing read permission for file' },
    { code: 'ERR_S_MS_FILE', message: 'Failed to attach file' },
    { code: 'ERR_S_MS_URI', message: 'Invalid URI' },
    { code: 'ERR_S_MS_MIME_TYPE', message: 'Unknown mime type' },
    { code: 'ERR_UNEXPECTED', message: 'Die Datei „photo.jpg“ konnte nicht geöffnet werden.' },
    { code: 'ERR_FILE_SYSTEM_NOT_FOUND', message: 'FileSystem module not found' },
  ])('treats $code as an attachment read error', error => {
    expect(isAttachmentReadError(error)).toBe(true);
  });

  it.each([
    { code: 'ERR_SENDING_FAILED', message: 'Sending the mail failed' },
    { code: 'ERR_S_MS_SENDING', message: 'Message failed: the device lost connection' },
    { code: 'ERR_S_MS_UNAVAILABLE', message: 'SMS is not available' },
    { code: 'ERR_OPERATION_IN_PROGRESS', message: 'Another mail composing is in progress' },
    { code: 'ERR_CANNOT_SEND_MAIL', message: 'Mail services are not available' },
    { code: 'ERR_S_MS_PENDING', message: 'file:///app/Caches/photo.jpg' },
    { code: 'ERR_MISSING_VIEW_CONTROLLER', message: 'Cannot find the current view controller' },
    { message: 'The file “photo.jpg” couldn’t be opened' },
    null,
    'odd',
  ])('does not treat %p as an attachment read error', error => {
    expect(isAttachmentReadError(error)).toBe(false);
  });
});

// Review pass 5, 28 Sep 2026: expo-sms codes are ERR_S_MS_*, not ERR_SMS_*.
describe('Expo error codes', () => {
  it('follows expo-modules-core errorCodeFromString', () => {
    expect(expoErrorCode('SMSFileException')).toBe('ERR_S_MS_FILE');
    expect(expoErrorCode('SMSMimeTypeException')).toBe('ERR_S_MS_MIME_TYPE');
    expect(expoErrorCode('FileSystemReadPermissionException')).toBe('ERR_FILE_SYSTEM_READ_PERMISSION');
    expect(expoErrorCode('SendingFailedException')).toBe('ERR_SENDING_FAILED');
    expect(expoErrorCode('UnknownResultException<MFMailComposeResult>')).toBe('ERR_UNKNOWN_RESULT');
  });

  it('matches the Swift rule and the exception classes the modules still declare', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const modules = path.resolve(__dirname, '../../node_modules');
    const codedError = fs.readFileSync(path.join(modules, 'expo-modules-core/ios/Core/Exceptions/CodedError.swift'), 'utf8');
    expect(codedError).toContain('#"(Error|Exception)?(<.*>)?$"#');
    expect(codedError).toContain('pattern: "(.)([A-Z])"');
    expect(codedError).toContain('withTemplate: "$1_$2"');
    const sms = fs.readFileSync(path.join(modules, 'expo-sms/ios/SMSExceptions.swift'), 'utf8');
    for (const name of ['SMSFileException', 'SMSUriException', 'SMSMimeTypeException']) {
      expect(sms).toContain(`class ${name}`);
    }
    const mail = fs.readFileSync(path.join(modules, 'expo-mail-composer/ios/MailComposerExceptions.swift'), 'utf8');
    for (const name of ['FileSystemReadPermissionException', 'FileSystemNotFoundException']) {
      expect(mail).toContain(`class ${name}`);
    }
  });
});

describe('attachment size budget', () => {
  it('stops at the budget, names the rest, and does not fetch photos after it', async () => {
    const sizes: Record<string, number> = { p1: 6, p2: 6, p3: 6, p4: 1 };
    const findPhoto = jest.fn(async (id: string) => ({ id, uri: `file:///${id}.jpg` }));
    const attached = await resolveReportImageAttachments({
      report: report([[['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]]]),
      limit: 20,
      maxTotalBytes: 13,
      findPhoto,
      sizeOf: async photo => sizes[photo.id],
    });
    expect(attached.photos.map(photo => photo.id)).toEqual(['p1', 'p2']);
    expect(findPhoto).toHaveBeenCalledTimes(3);
    expect(attached.note).toBe('\n\nImages 3 and 4 are not attached, to keep this message a sendable size.');
  });
});

// Review pass 9, 28 Sep 2026: a photo whose file:// path points at nothing
// made the composer refuse every image; it is now named as not on the device.
it('names a photo whose file is gone instead of attaching it, and keeps the others', async () => {
  const attached = await resolveReportImageAttachments({
    report: report([[['p1', 1], ['p2', 2], ['p3', 3]]]),
    limit: 20,
    maxTotalBytes: 1_000,
    findPhoto: async id => ({ id, uri: `file:///${id}.jpg` }),
    sizeOf: async photo => photo.id === 'p2' ? null : photo.id === 'p3' ? Promise.reject(new Error('io')) : 10,
  });
  expect(attached.photos.map(photo => photo.id)).toEqual(['p1']);
  expect(attached.note).toBe('\n\nImages 2 and 3 could not be attached: their photos are not on this device.');
});
