export function useCamera({
  pickPhotos,
  takePhoto,
}: {
  pickPhotos: () => void;
  takePhoto: () => void;
}) {
  return {
    pickPhotos,
    takePhoto,
  };
}
