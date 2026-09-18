import { fireEvent, render } from '@testing-library/react-native';

import { MobileDocumentECOSStatus } from '../../components/mobile-document-ecos-status';
import type { ReferenceDocument } from '../../types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const BASE_DOCUMENT: ReferenceDocument = {
  id: 'drawing-a2.01-r3',
  name: 'A2.01',
  originalFileName: 'A2.01.pdf',
  uri: '',
  category: 'Drawing',
  notes: '',
  isCurrent: false,
  importedAt: '2026-08-09T08:00:00.000Z',
  projectId: 'project-2375',
  projectName: '2375 Compliance Project',
  drawingNumber: 'A2.01',
  drawingRevision: '3',
  drawingStatus: 'For Construction',
};

describe('MobileDocumentECOSStatus', () => {
  it('shows hosted preparation and withholds Make Current while Assurance is incomplete', () => {
    const screen = render(
      <MobileDocumentECOSStatus
        document={{
          ...BASE_DOCUMENT,
          ecosHostedIndexStatus: 'Preparing',
          ecosHostedIndexProgressPercent: 42,
        }}
        onMakeCurrent={jest.fn()}
      />,
    );

    expect(screen.getByText('Preparing')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make Current for ECOS' })).toBeNull();
    expect(screen.getByText(/only after ECOS preparation and Assurance checks/i)).toBeTruthy();
  });

  it('exposes Make Current only after hosted ECOS preparation passed', () => {
    const onMakeCurrent = jest.fn();
    const screen = render(
      <MobileDocumentECOSStatus
        document={{ ...BASE_DOCUMENT, ecosHostedIndexStatus: 'Prepared' }}
        onMakeCurrent={onMakeCurrent}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Make Current for ECOS' }));
    expect(onMakeCurrent).toHaveBeenCalledTimes(1);
  });

  it('identifies the activated revision without offering the action again', () => {
    const screen = render(
      <MobileDocumentECOSStatus
        document={{
          ...BASE_DOCUMENT,
          isCurrent: true,
          ecosHostedIndexStatus: 'Ready for ECOS',
        }}
        onMakeCurrent={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Current for ECOS')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make Current for ECOS' })).toBeNull();
  });

  it('shows a current limited revision as usable but visibly review-required', () => {
    const screen = render(
      <MobileDocumentECOSStatus
        document={{
          ...BASE_DOCUMENT,
          isCurrent: true,
          ecosHostedIndexStatus: 'Ready with limitations',
          ecosHostedIndexCustomerMessage: '2 accepted pages passed ECOS Assurance with review limitations.',
          ecosHostedIndexLimitationCount: 2,
        }}
        onMakeCurrent={jest.fn()}
      />,
    );

    expect(screen.getByText('Ready with limitations')).toBeTruthy();
    expect(screen.getByText('2 accepted pages passed ECOS Assurance with review limitations.')).toBeTruthy();
    expect(screen.getByLabelText('Current for ECOS')).toBeTruthy();
  });

  it('allows a prepared limited prior revision to be made current', () => {
    const onMakeCurrent = jest.fn();
    const screen = render(
      <MobileDocumentECOSStatus
        document={{
          ...BASE_DOCUMENT,
          ecosHostedIndexStatus: 'Prepared with limitations',
          ecosHostedIndexCustomerMessage: '1 accepted page passed ECOS Assurance with review limitations.',
          ecosHostedIndexLimitationCount: 1,
        }}
        onMakeCurrent={onMakeCurrent}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Make Current for ECOS' }));
    expect(onMakeCurrent).toHaveBeenCalledTimes(1);
  });
});

describe('MobileDocumentECOSStatus retry', () => {
  it('offers Try again only when preparation stopped', () => {
    const stopped = render(
      <MobileDocumentECOSStatus
        document={{ ...BASE_DOCUMENT, ecosHostedIndexStatus: 'Temporarily Unavailable' }}
      />,
    );
    expect(stopped.getByLabelText('Try preparing this document again')).toBeTruthy();

    const preparing = render(
      <MobileDocumentECOSStatus
        document={{ ...BASE_DOCUMENT, ecosHostedIndexStatus: 'Preparing' }}
      />,
    );
    expect(preparing.queryByLabelText('Try preparing this document again')).toBeNull();
  });
});
