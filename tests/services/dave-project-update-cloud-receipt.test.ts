import {
  daveProjectUpdateMatchesCloudReceipt,
  daveProjectUpdatesNeedingCloudUpload,
  daveProjectUpdatesSemanticallyMatch,
} from '../../services/DAVEProjectUpdateCloudReceipt';
import { mergeDAVECloudRecoveredProjectUpdate } from '../../services/DAVECloudRecovery';
import type { ProjectUpdate } from '../../types';

function update(overrides: Partial<ProjectUpdate> = {}): ProjectUpdate {
  return {
    id: 'update-1',
    projectId: '607c7eed-5dea-4a5a-8b52-0f165c71c4b5',
    projectName: '2321 Compliance Project',
    date: '2026-08-15',
    notes: 'North wall concrete placed.',
    recipients: { contactIds: [] },
    photos: [{
      id: 'photo-1',
      uri: 'file:///phone/photo.heic',
      caption: 'North wall',
      category: 'Update',
      actionRequired: '',
      actionOwner: '',
      actionDueDate: '',
      actionStatus: 'Open',
      cloudStoragePath: '2321/update-1/photo-1.heic',
    }],
    status: 'queued',
    ...overrides,
  };
}

describe('field-update cloud receipts', () => {
  it('ignores device-only photo transport and lifecycle metadata', () => {
    const local = update({
      status: 'queued',
      sendAttempts: 7,
      lastSendAttemptAt: '2026-08-15T20:00:00.000Z',
    } as Partial<ProjectUpdate>);
    const cloud = update({
      status: 'sent',
      sendAttempts: 2,
      lastSendAttemptAt: '2026-08-14T20:00:00.000Z',
      photos: [{
        ...local.photos[0],
        uri: 'file:///ipad/recovered-photo.heic',
        cloudPreviewUri: 'https://signed.example/temporary-token',
        cloudRecoveryStatus: 'cached',
        cloudRecoveredAt: '2026-08-15T19:00:00.000Z',
      }],
    } as Partial<ProjectUpdate>);

    expect(daveProjectUpdatesSemanticallyMatch(local, cloud)).toBe(true);
  });

  it('still detects a real field edit or project-identity change', () => {
    const base = update();
    expect(daveProjectUpdatesSemanticallyMatch(base, update({ notes: 'Different work.' }))).toBe(false);
    expect(daveProjectUpdatesSemanticallyMatch(base, update({
      projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9',
    }))).toBe(false);
  });

  it('accepts one-way cloud identity enrichment without accepting a project move', () => {
    const legacyLocal = update({ projectId: null });
    const cloudBound = update();

    expect(daveProjectUpdateMatchesCloudReceipt(legacyLocal, cloudBound)).toBe(true);
    expect(daveProjectUpdateMatchesCloudReceipt(
      update({ projectId: '72e941d8-8114-4082-a976-ae5b2b5daba9' }),
      cloudBound,
    )).toBe(false);
  });

  it('stages only missing or meaningfully changed records during full sync', () => {
    const alreadyCloud = update();
    const changed = update({ id: 'update-2', notes: 'New local note.' });
    const missing = update({ id: 'update-3' });

    expect(daveProjectUpdatesNeedingCloudUpload({
      local: [alreadyCloud, changed, missing],
      cloud: [
        { id: 'update-1', updateData: update({ status: 'sent' }) },
        { id: 'update-2', updateData: update({ id: 'update-2', notes: 'Older note.' }) },
      ],
    }).map(item => item.id)).toEqual(['update-2', 'update-3']);
  });

  it('turns an exact cloud copy into a sent receipt without losing local photo meaning', () => {
    const local = update({
      status: 'queued',
      photos: [{
        ...update().photos[0],
        caption: 'Keep the phone caption',
        uri: 'https://expired.example/photo',
        cloudRecoveryStatus: 'signed_url',
        cloudSignedUrlExpiresAt: '2026-08-15T18:00:00.000Z',
      }],
    });
    const cloud = update({
      status: 'sent',
      photos: [{
        ...local.photos[0],
        uri: 'file:///fresh-cloud-cache.heic',
        cloudRecoveryStatus: 'cached',
        cloudRecoveredAt: '2026-08-15T20:00:00.000Z',
      }],
    });

    const merged = mergeDAVECloudRecoveredProjectUpdate(
      local,
      cloud,
      new Date('2026-08-15T20:00:00.000Z').getTime(),
    );

    expect(merged.status).toBe('sent');
    expect(merged.photos[0].caption).toBe('Keep the phone caption');
    expect(merged.photos[0].uri).toBe('file:///fresh-cloud-cache.heic');
  });

  it('turns a legacy unbound local copy into the cloud-bound sent receipt', () => {
    const merged = mergeDAVECloudRecoveredProjectUpdate(
      update({ projectId: null, status: 'queued' }),
      update({ status: 'sent' }),
    );

    expect(merged.projectId).toBe('607c7eed-5dea-4a5a-8b52-0f165c71c4b5');
    expect(merged.status).toBe('sent');
  });
});
