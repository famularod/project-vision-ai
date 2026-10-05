/**
 * Independent review R06 (Build 229), on screen: the report's drawing preview
 * showed a picture drawing whole, straight from its file, and never asked for
 * the cited area. It now asks the same resolver a PDF drawing goes through.
 */
import { act, render } from '@testing-library/react-native';
import { createElement } from 'react';
import { Image } from 'react-native';
import { ReportDrawingReferencePreview } from '../../screens/ReportsScreen';
import type { ReportDrawingReference } from '../../services/ReportDrawingReferences';
import { renderNativeReportDrawingPreview } from '../../services/ReportWordMedia.native';
import {
  fakeImageBytes,
  fakeMedia,
  fakePictureIn,
  labelsIn,
  quadrantSheet,
} from '../fixtures/report-word-media-fakes';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-file-system', () => require('../fixtures/report-word-media-fakes').fakeFileSystem());
jest.mock('expo-image-manipulator', () => require('../fixtures/report-word-media-fakes').fakeImageManipulator());
jest.mock('../../modules/dave-text-recognition', () => ({ renderPdfExcerpt: jest.fn() }));

const SHEET_URI = 'file:///documents/project-documents/site-plan.jpg';

function reference(region: { x: number; y: number; width: number; height: number }): ReportDrawingReference {
  const citation = { documentId: 'site-plan', pageNumber: 1, label: 'Site Plan · Rev 2 · Sheet C1.0' };
  return {
    id: 'ref-1',
    projectName: '2321 Compliance Project',
    areaName: 'North Lot',
    citation,
    excerpt: {
      document: { id: 'site-plan', name: 'Site Plan', originalFileName: 'site-plan.jpg', mimeType: 'image/jpeg', uri: SHEET_URI },
      pageNumber: 1,
      region,
      citation,
    },
  } as unknown as ReportDrawingReference;
}

/** As App.tsx resolves it: the cited excerpt, or nothing when it cannot be prepared. */
const resolver = (item: ReportDrawingReference) => renderNativeReportDrawingPreview(item).catch(() => null);

beforeEach(() => {
  fakeMedia.reset();
  fakeMedia.files.set(SHEET_URI, fakeImageBytes('jpeg', quadrantSheet(4000, 3000)));
});

it('shows the cited quarter of a picture drawing, not the whole sheet', async () => {
  const screen = render(createElement(ReportDrawingReferencePreview, {
    reference: reference({ x: 0.6, y: 0.1, width: 0.3, height: 0.3 }),
    onResolveDrawingPreview: resolver,
  }));
  expect(screen.getByText('Preparing the current drawing excerpt…')).toBeTruthy();
  await act(async () => { await Promise.resolve(); });

  const shown = screen.UNSAFE_getByType(Image).props.source.uri as string;
  expect(shown).not.toBe(SHEET_URI);
  expect(labelsIn(fakePictureIn(fakeMedia.files.get(shown)!)!)).toBe('B');
  expect(screen.getByLabelText('Drawing reference for North Lot')).toBeTruthy();
});

it('says the excerpt is unavailable for an invalid area instead of showing the whole sheet', async () => {
  const screen = render(createElement(ReportDrawingReferencePreview, {
    reference: reference({ x: 0.6, y: 0.1, width: 0, height: 0.3 }),
    onResolveDrawingPreview: resolver,
  }));
  await act(async () => { await Promise.resolve(); });
  expect(screen.UNSAFE_queryByType(Image)).toBeNull();
  expect(screen.getByText('The current drawing excerpt is unavailable from the authorized project files.')).toBeTruthy();
});
