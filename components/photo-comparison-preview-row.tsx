import { createContext, useContext, useMemo } from 'react';
import { Text, View } from 'react-native';

import { styles } from './app-shell-theme';
import { ProjectPhotoImage } from './ProjectPhotoImage';
import { findDAVEExactPriorPhoto } from '../services/DAVEUpdateWorkspace';
import { projectPhotoCanBeShown } from '../services/ProjectPhotoTransport';
import type { PIEPhotoIntelligenceDisplayState } from '../services/PIEPhotoVisionMobileWorkflow';
import type { ProjectUpdate, UpdatePhoto } from '../types';

/** The saved field updates, where a photo's analysed prior photo is found. */
export const SavedFieldUpdatesContext = createContext<readonly ProjectUpdate[]>([]);

/**
 * A photo's Before/After row (whole-app audit A4 pass 7 M2, 30 Sep 2026). It
 * showed only when the photo had a `uri`, which is empty for a photo taken
 * on the other device, and "Before" was the prior photo's path as stored by
 * the device that ran the analysis, blank anywhere else. Both sides are now
 * the photos themselves: the prior one found in the saved updates (the
 * stored path only when it is not there), each shown from this device's
 * file or signed from the cloud when shown. Hidden when either side has
 * nothing to show, which includes a photo the sync marked 'unavailable'
 * (nothing uploaded; A4 pass 8 F4) unless this device holds its file.
 */
export function PhotoComparisonPreviewRow({
  result,
  photo,
  projectName,
  localUri,
}: {
  result: PIEPhotoIntelligenceDisplayState;
  photo: UpdatePhoto | undefined;
  projectName: string | undefined;
  localUri: (photo: Partial<UpdatePhoto>) => string;
}) {
  const updates = useContext(SavedFieldUpdatesContext);
  const saved = useMemo(
    () => photo && projectName
      ? findDAVEExactPriorPhoto(updates, projectName, { updateId: null, photoId: photo.id }, result)?.photo
      : undefined,
    [photo, projectName, result, updates],
  );
  const prior: Partial<UpdatePhoto> = saved || { uri: result.priorPhotoUri || '' };
  const priorUri = localUri(prior);
  const currentUri = photo ? localUri(photo) : '';
  if (!photo || !projectPhotoCanBeShown(prior, priorUri) || !projectPhotoCanBeShown(photo, currentUri)) return null;
  return (
    <View style={styles.photoComparisonPreviewRow} testID="photo-comparison-preview-row">
      <View style={styles.photoComparisonPreviewItem}>
        <ProjectPhotoImage photo={prior} localUri={priorUri} style={styles.photoComparisonPreviewImage} />
        <Text style={styles.photoComparisonPreviewLabel}>Before</Text>
      </View>
      <View style={styles.photoComparisonPreviewItem}>
        <ProjectPhotoImage photo={photo} localUri={currentUri} style={styles.photoComparisonPreviewImage} />
        <Text style={styles.photoComparisonPreviewLabel}>After</Text>
      </View>
    </View>
  );
}
