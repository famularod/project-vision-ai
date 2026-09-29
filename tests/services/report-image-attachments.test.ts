/**
 * Code review, 27 Sep 2026: report email and text said "See Image N" and
 * carried no images. These pin the cited-image order and what the owner is
 * told when an image cannot go with the message.
 */
import {
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
