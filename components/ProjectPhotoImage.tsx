import { Image, type ImageProps } from 'react-native';
import { useProjectPhotoDisplayUri } from '../hooks/use-project-photo-display-uri';
import type { UpdatePhoto } from '../types';

/**
 * A saved photo's image: its local file, or a preview signed again when it
 * lapses or fails to load (whole-app audit A4 pass 6, 30 Sep 2026). Usable
 * inside a list's map; each image holds its own signed URL.
 */
export function ProjectPhotoImage({
  photo,
  localUri,
  ...imageProps
}: Omit<ImageProps, 'source' | 'onError'> & {
  photo: Partial<UpdatePhoto>;
  localUri: string;
}) {
  const display = useProjectPhotoDisplayUri(photo, localUri);
  return <Image {...imageProps} source={{ uri: display.uri }} onError={display.onError} />;
}
