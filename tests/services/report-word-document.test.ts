import JSZip from 'jszip';
import {
  buildReportWordBase64,
  summarizeReportWordUnavailableMedia,
  type ReportWordMedia,
} from '../../services/ReportWordDocument';

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlL6iQAAAAASUVORK5CYII=',
    'base64',
  ),
);
const SECOND_ONE_PIXEL_PNG = Uint8Array.from([...ONE_PIXEL_PNG, 0]);

describe('ReportWordDocument', () => {
  it('creates a Word document with project photos, drawing excerpts, and honest unavailable-media text', async () => {
    const media: ReportWordMedia[] = [
      {
        id: 'photo-1',
        kind: 'photo',
        caption: 'Current field condition',
        data: SECOND_ONE_PIXEL_PNG,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        displayNumber: 4,
        projectName: '2321 Compliance Project',
        areaName: 'North Lot',
        linkedTaskName: 'PLACE ASPHALT',
        recordedAt: '7/30/2026, 12:00 PM',
        reasonForInclusion:
          'This photo is attached to the field update for PLACE ASPHALT in North Lot.',
      },
      {
        id: 'drawing-1',
        kind: 'drawing',
        caption: 'North Lot plan excerpt',
        data: ONE_PIXEL_PNG,
        mimeType: 'image/png',
        width: 1,
        height: 1,
        projectName: '2321 Compliance Project',
        areaName: 'North Lot',
        reasonForInclusion:
          'This excerpt is included so the reader can verify the reported work location.',
        citation: 'Civil Plan · Rev 3 · Sheet C2.1',
      },
    ];

    const base64 = await buildReportWordBase64({
      title: '2321 Project Status Report',
      body:
        'CURRENT WORK\n' +
        '- 2321 Compliance Project — PLACE ASPHALT (North Lot): Asphalt placement is in progress.\n' +
        'NEXT ACTIONS\n' +
        '- 2321 Compliance Project — PLACE ASPHALT (North Lot): Confirm the final paving condition.\n' +
        'SCHEDULE RISKS\n' +
        '- 2321 Compliance Project — East Driveway: Concrete placement may affect access.\n' +
        'RECENT CHANGES\n' +
        '- 2321 Compliance Project — East Driveway: Concrete placement is complete.',
      generatedAt: '2026-07-30T12:00:00.000Z',
      media,
      unavailableMedia: [
        {
          id: 'photo-missing',
          kind: 'photo',
          label: 'Photo 7',
          reason: 'The protected source file is unavailable.',
        },
      ],
    });
    const archive = await JSZip.loadAsync(Buffer.from(base64, 'base64'));
    const documentXml = await archive.file('word/document.xml')!.async('string');
    const mediaFiles = Object.keys(archive.files)
      .filter(name => name.startsWith('word/media/') && !archive.files[name].dir);

    expect(mediaFiles).toHaveLength(2);
    expect(documentXml).toContain('2321 Project Status Report');
    expect(documentXml).toContain('Project Photos');
    expect(documentXml).toContain('Photo 4');
    expect(documentXml).toContain('Recorded description:');
    expect(documentXml).toContain('Task: PLACE ASPHALT');
    expect(documentXml).toContain('Why this image is included:');
    expect(documentXml).toContain('Photo Reference Guide');
    expect(documentXml).toContain(
      'Asphalt placement is in progress. Photo 4 shows this work.',
    );
    expect(documentXml).not.toContain(
      'Concrete placement is complete. Photo 4 shows this work.',
    );
    expect(documentXml).toContain(
      'Confirm the final paving condition. Photo 4 shows this work.',
    );
    expect(documentXml).not.toContain(
      'Concrete placement may affect access. Photo 4 shows this work.',
    );
    expect(documentXml).toContain('Current Drawing References');
    expect(documentXml).toContain('North Lot plan excerpt');
    expect(documentXml).toContain('Media Requiring Review');
    expect(documentXml).toContain('The protected source file is unavailable.');
    expect(documentXml).toContain('<w:cantSplit/>');
  });

  it('explains unavailable media by actual failure category', () => {
    const summary = summarizeReportWordUnavailableMedia([
      {
        id: 'iphone-photo',
        kind: 'photo',
        label: 'Photo 1',
        reason: 'The iPhone photo could not be converted.',
      },
      {
        id: 'cloud-photo',
        kind: 'photo',
        label: 'Photo 2',
        reason: 'The protected project file could not be retrieved.',
      },
    ]);

    expect(summary).toBe(
      '1 iPhone photo could not be converted for Word. ' +
      '1 protected source file could not be retrieved.',
    );
  });
});
