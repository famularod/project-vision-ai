/**
 * Stand-ins for the picture handling behind the Word report (independent
 * review R06 and R07), so the real phone/iPad resolver and the real desktop
 * resolver both run under jest with only the platform I/O replaced.
 *
 * A picture here is a grid of labels. Cropping and resizing really move
 * through that grid, so a test can read which part of a sheet ended up in the
 * report. A file is a real format signature followed by the id of the picture
 * a device would decode from it.
 */
export type FakePicture = Readonly<{
  width: number;
  height: number;
  labelAt(x: number, y: number): string;
}>;

export type FakeCrop = Readonly<{
  originX: number;
  originY: number;
  width: number;
  height: number;
  outputWidth: number;
  outputHeight: number;
}>;

export type FakeImageFormat =
  | 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'heic' | 'tiff' | 'avif' | 'avifWithMif1' | 'pdf' | 'unknown';

const text = (value: string) => Array.from(value, character => character.charCodeAt(0));

export const FAKE_SIGNATURES: Readonly<Record<FakeImageFormat, readonly number[]>> = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  gif: text('GIF89a'),
  bmp: [...text('BM'), 0x46, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00],
  webp: [...text('RIFF'), 0x24, 0x00, 0x00, 0x00, ...text('WEBPVP8 ')],
  heic: [0x00, 0x00, 0x00, 0x18, ...text('ftypheic'), 0x00, 0x00, 0x00, 0x00, ...text('mif1heic')],
  tiff: [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00],
  // A picture type the report's policy does not name, which devices can still open.
  avif: [0x00, 0x00, 0x00, 0x1c, ...text('ftypavif'), 0x00, 0x00, 0x00, 0x00, ...text('avifmiaf')],
  // The usual AVIF: it also lists mif1, the general brand an iPhone HEIC lists too.
  avifWithMif1: [0x00, 0x00, 0x00, 0x20, ...text('ftypavif'), 0x00, 0x00, 0x00, 0x00, ...text('avifmif1miaf')],
  pdf: text('%PDF-1.7\n'),
  unknown: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b],
};

/** What an iPhone or iPad decodes, and what a desktop browser (Chrome) decodes. */
const DEVICE_DECODES: readonly FakeImageFormat[] = ['jpeg', 'png', 'gif', 'bmp', 'webp', 'heic', 'tiff', 'avif', 'avifWithMif1'];
const BROWSER_DECODES: readonly FakeImageFormat[] = ['jpeg', 'png', 'gif', 'bmp', 'webp', 'avif', 'avifWithMif1'];

export const fakeMedia = {
  /** Local files on the phone, by path. */
  files: new Map<string, Uint8Array>(),
  /** When each local file was last changed; a file not listed here reads as 0. */
  modified: new Map<string, number>(),
  /** Whether the phone refuses to move a file (a full disk, a folder that cannot be made). */
  moveFails: false,
  /** The size the phone reports for a local file, when a test needs a large one; otherwise its fake bytes' length. */
  fileSizes: new Map<string, number>(),
  /**
   * What the phone's image tool is holding (review pass 1, L6). The real tool
   * (expo-image-manipulator 57.0.21, ios/ImageManipulatorContext.swift and
   * ImageRef.swift) keeps every picture it opens, and every picture it hands
   * back, until release() is called on it or the garbage collector gets to
   * it. Saving a picture lets go of nothing. So this fake lets go only on
   * release(), and a test can read how much was held.
   *
   * deviceOpenNow / deviceOpenAtOnce: pictures opened and not yet released
   * (one per manipulate()), now and the most at once.
   * devicePicturesNow / devicePicturesAtOnce: decoded pictures in memory, now
   * and the most at once. Making a picture smaller, cropping it, or turning
   * it upright needs the picture and its copy at the same moment, so one
   * picture handled properly holds two at its peak and none afterwards.
   * devicePixelsNow / devicePixelsAtOnce: the pixels in those pictures (at
   * about 4 bytes each, the memory they stand for).
   */
  deviceOpenNow: 0,
  deviceOpenAtOnce: 0,
  devicePicturesNow: 0,
  devicePicturesAtOnce: 0,
  devicePixelsNow: 0,
  devicePixelsAtOnce: 0,
  /** The pixels held each time the tool wrote a picture to a file (the full-size one should be gone by then). */
  devicePixelsWhileSaving: [] as number[],
  /** Local pictures the phone was asked the size of (react-native Image.getSize reads the whole file to answer). */
  deviceSizeAsked: [] as string[],
  /**
   * Local pictures the phone's image tool cannot open although their type is an
   * ordinary one: a CMYK JPEG, a 16-bit grey PNG (its first step cannot make a
   * bitmap for them).
   */
  deviceCannotOpen: new Set<string>(),
  /**
   * Local pictures saved for print (CMYK) or as 16-bit grey that the phone's
   * image tool does open (expo-image-manipulator 57.0.21, Build 231). A crop
   * keeps that form; only a redraw (resize) makes it an ordinary 8-bit
   * colour picture. Saved as a JPEG without one, a CMYK picture is a CMYK
   * JPEG, and a 16-bit grey one an ordinary 8-bit grey JPEG (run on macOS
   * ImageIO, notes/impl-r06r07r10/NOTES-e1.txt).
   */
  devicePrintForm: new Map<string, 'CMYK' | '16-bit grey'>(),
  /** Pictures the phone's image tool wrote that are still CMYK, by picture id. */
  savedAsCmyk: new Set<string>(),
  /** Pictures whose file keeps them turned a quarter, by picture id: the image tool redraws these upright as it loads them. */
  storedOnItsSide: new Set<string>(),
  /** Protected cloud files the desktop downloads, by URL. */
  remote: new Map<string, { bytes: Uint8Array; contentType: string | null }>(),
  pictures: new Map<string, FakePicture>(),
  /** Every crop the phone's image tool was asked for. */
  deviceCrops: [] as FakeCrop[],
  /** Every crop the desktop canvas was asked for. */
  browserCrops: [] as FakeCrop[],
  /** Every local file the phone's image tool opened. */
  deviceOpened: [] as string[],
  /** The format the phone's image tool really writes, whatever it was asked for. */
  deviceWrites: null as FakeImageFormat | null,
  /** The format the desktop canvas really writes, whatever it was asked for. */
  browserWrites: null as FakeImageFormat | null,
  nextId: 0,
  reset() {
    this.files.clear();
    this.modified.clear();
    this.moveFails = false;
    this.fileSizes.clear();
    this.deviceOpenNow = 0;
    this.deviceOpenAtOnce = 0;
    this.devicePicturesNow = 0;
    this.devicePicturesAtOnce = 0;
    this.devicePixelsNow = 0;
    this.devicePixelsAtOnce = 0;
    this.devicePixelsWhileSaving.length = 0;
    this.deviceSizeAsked.length = 0;
    this.deviceCannotOpen.clear();
    this.devicePrintForm.clear();
    this.savedAsCmyk.clear();
    this.storedOnItsSide.clear();
    this.remote.clear();
    this.pictures.clear();
    this.deviceCrops.length = 0;
    this.browserCrops.length = 0;
    this.deviceOpened.length = 0;
    this.deviceWrites = null;
    this.browserWrites = null;
    this.nextId = 0;
  },
};

/** A sheet whose four quarters are labelled A (top left), B, C, D (bottom right). */
export function quadrantSheet(width: number, height: number): FakePicture {
  return {
    width,
    height,
    labelAt: (x, y) => (y < height / 2
      ? (x < width / 2 ? 'A' : 'B')
      : (x < width / 2 ? 'C' : 'D')),
  };
}

/** A pixel with nothing in it. What shows there depends on what the picture is put on. */
export const FAKE_TRANSPARENT = 'transparent';

/** Ink on a transparent background (a logo, a stamp, an exported sketch): an inked band across the middle. */
export function inkOnTransparent(width: number, height: number): FakePicture {
  return {
    width,
    height,
    labelAt: (_x, y) => (y >= height / 3 && y < (2 * height) / 3 ? 'ink' : FAKE_TRANSPARENT),
  };
}

/** A picture with every transparent pixel put on the given colour, as saving to a type without transparency does. */
function flattened(picture: FakePicture, onto: string): FakePicture {
  return {
    width: picture.width,
    height: picture.height,
    labelAt: (x, y) => {
      const label = picture.labelAt(x, y);
      return label === FAKE_TRANSPARENT ? onto : label;
    },
  };
}

/** One picture drawn over what a canvas already holds: its transparent pixels show what is underneath. */
function drawnOver(top: FakePicture, underneath: FakePicture | null): FakePicture {
  return {
    width: top.width,
    height: top.height,
    labelAt: (x, y) => {
      const label = top.labelAt(x, y);
      return label === FAKE_TRANSPARENT && underneath ? underneath.labelAt(x, y) : label;
    },
  };
}

/** The different labels found across a picture, in order, e.g. ["ink", "white"]. */
export function fakeLabelsOf(picture: FakePicture): string[] {
  const found = new Set<string>();
  const columns = sampled(picture.width);
  for (const y of sampled(picture.height)) {
    for (const x of columns) found.add(picture.labelAt(x, y));
  }
  return [...found].sort();
}

function cropped(picture: FakePicture, crop: Pick<FakeCrop, 'originX' | 'originY' | 'width' | 'height'>): FakePicture {
  return {
    width: crop.width,
    height: crop.height,
    labelAt: (x, y) => picture.labelAt(crop.originX + x, crop.originY + y),
  };
}

function resized(picture: FakePicture, width: number, height: number): FakePicture {
  return {
    width,
    height,
    labelAt: (x, y) => picture.labelAt(
      Math.min(picture.width - 1, Math.floor((x + 0.5) * picture.width / width)),
      Math.min(picture.height - 1, Math.floor((y + 0.5) * picture.height / height)),
    ),
  };
}

/** The labels found across a picture, corners and edges included, e.g. "B" or "ABCD". */
export function labelsIn(picture: FakePicture): string {
  const found = new Set<string>();
  const columns = sampled(picture.width);
  for (const y of sampled(picture.height)) {
    for (const x of columns) found.add(picture.labelAt(x, y));
  }
  return [...found].sort().join('');
}

function sampled(length: number) {
  const step = Math.max(1, Math.floor(length / 48));
  const points: number[] = [];
  for (let value = 0; value < length; value += step) points.push(value);
  points.push(length - 1);
  return points;
}

export type FakeImageFile = Readonly<{
  /**
   * 'stored on its side': the file keeps the picture turned a quarter and
   * says so (EXIF orientation 6, as a phone held upright writes a photo).
   * The picture given is still the upright one a device shows. JPEG and TIFF.
   */
  stored?: 'upright' | 'stored on its side';
  /** 'cut short': the file ends before the part of its header that gives the size. */
  header?: 'whole' | 'cut short';
}>;

const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const le16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const le32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];

/** A little-endian TIFF directory, as a TIFF file and an EXIF block both start. */
const tiffEntries = (entries: readonly (readonly [number, number])[]) => [
  ...le16(entries.length),
  // Orientation (274) is a 2-byte number, as cameras write it; the rest are 4-byte numbers.
  ...entries.flatMap(([tag, value]) => [...le16(tag), ...le16(tag === 274 ? 3 : 4), ...le32(1), ...le32(value)]),
  ...le32(0),
];

/**
 * The real header of a file of this type holding a picture of this size,
 * after the signature: the same bytes a camera, a scanner or an editor
 * writes there, so the app's own header reader is run on them. The id of the
 * picture a device would decode follows in a place the format allows.
 */
function fakeHeaderAfterSignature(
  format: FakeImageFormat,
  picture: FakePicture | undefined,
  id: string,
  file: FakeImageFile,
): number[] {
  const mark = text(`|${id}|`);
  if (!picture || file.header === 'cut short') return mark;
  const onItsSide = file.stored === 'stored on its side';
  const width = onItsSide ? picture.height : picture.width;
  const height = onItsSide ? picture.width : picture.height;
  if (format === 'jpeg') {
    // After FF D8 FF E0: the JFIF block, an EXIF block when turned, a comment, then the frame header.
    const exif = [...text('Exif\0\0'), 0x49, 0x49, 0x2a, 0x00, ...le32(8), ...tiffEntries([[274, 6]])];
    return width > 0xffff || height > 0xffff ? mark : [
      ...be16(16), ...text('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0,
      ...(onItsSide ? [0xff, 0xe1, ...be16(exif.length + 2), ...exif] : []),
      0xff, 0xfe, ...be16(mark.length + 2), ...mark,
      0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
      0xff, 0xda,
    ];
  }
  if (format === 'png') {
    return [
      ...be32(13), ...text('IHDR'), ...be32(width), ...be32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
      ...be32(mark.length), ...text('tEXt'), ...mark, 0, 0, 0, 0,
      ...be32(0), ...text('IDAT'), 0, 0, 0, 0,
    ];
  }
  if (format === 'gif') return width > 0xffff || height > 0xffff ? mark : [...le16(width), ...le16(height), 0, 0, 0, ...mark];
  if (format === 'bmp') return [...le32(width), ...le32(height), ...le16(1), ...le16(24), ...mark];
  if (format === 'webp') {
    // After "RIFF....WEBPVP8 ": the chunk size, a key frame's tag and start code, then 14-bit sizes.
    return width > 0x3fff || height > 0x3fff ? mark : [
      ...le32(10 + mark.length), 0x10, 0, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), ...mark,
    ];
  }
  if (format === 'tiff') {
    return [...tiffEntries([[256, width], [257, height], ...(onItsSide ? [[274, 6] as const] : [])]), ...mark];
  }
  // HEIC, AVIF and the rest keep their size deeper in the file; the app does not read it there.
  return mark;
}

/** A file in the given format that decodes to the given picture. */
export function fakeImageBytes(format: FakeImageFormat, picture?: FakePicture, file: FakeImageFile = {}): Uint8Array {
  fakeMedia.nextId += 1;
  const id = `picture-${fakeMedia.nextId}`;
  if (picture) fakeMedia.pictures.set(id, picture);
  if (file.stored === 'stored on its side') fakeMedia.storedOnItsSide.add(id);
  return Uint8Array.from([...FAKE_SIGNATURES[format], ...fakeHeaderAfterSignature(format, picture, id, file)]);
}

export function fakeFormatOf(bytes: Uint8Array): FakeImageFormat {
  const formats = Object.keys(FAKE_SIGNATURES) as FakeImageFormat[];
  return formats.find(format => format !== 'unknown' &&
    FAKE_SIGNATURES[format].every((value, index) => bytes[index] === value)) || 'unknown';
}

/** The picture a file or an embedded report image decodes to. */
export function fakePictureIn(bytes: Uint8Array): FakePicture | null {
  const id = /\|(picture-\d+)\|/.exec(String.fromCharCode(...bytes))?.[1];
  return (id && fakeMedia.pictures.get(id)) || null;
}

/** Whether a picture the phone's image tool wrote is still CMYK (it was saved with no redraw). */
export function fakeSavedAsCmyk(bytes: Uint8Array): boolean {
  const id = /\|(picture-\d+)\|/.exec(String.fromCharCode(...bytes))?.[1];
  return Boolean(id && fakeMedia.savedAsCmyk.has(id));
}

function decoded(bytes: Uint8Array, decodes: readonly FakeImageFormat[]): FakePicture | null {
  return decodes.includes(fakeFormatOf(bytes)) ? fakePictureIn(bytes) : null;
}

/** expo-file-system: local files and folders held in memory. */
export function fakeFileSystem() {
  const join = (parent: string | { uri: string }, name?: string) => {
    const base = typeof parent === 'string' ? parent : parent.uri;
    return name ? `${base.replace(/\/+$/, '')}/${name}` : base;
  };
  class Directory {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = join(parent, name);
    }
    get exists() {
      return true;
    }
    create() {}
    /** The files directly inside this folder. */
    list() {
      const prefix = `${this.uri}/`;
      return [...fakeMedia.files.keys()]
        .filter(uri => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map(uri => new File(uri));
    }
  }
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = join(parent, name);
      // A picture handed over as data is not a file; treating it as one is a mistake to catch.
      if (this.uri.startsWith('data:')) throw new Error('Not a file address.');
    }
    get exists() {
      return fakeMedia.files.has(this.uri);
    }
    get size() {
      return fakeMedia.fileSizes.get(this.uri) ?? fakeMedia.files.get(this.uri)?.byteLength ?? 0;
    }
    get modificationTime() {
      return fakeMedia.modified.get(this.uri) ?? 0;
    }
    async move(destination: { uri: string }) {
      const bytes = fakeMedia.files.get(this.uri);
      if (!bytes || fakeMedia.moveFails) throw new Error('The file could not be moved.');
      fakeMedia.files.delete(this.uri);
      fakeMedia.files.set(destination.uri, bytes);
      this.uri = destination.uri;
    }
    async bytes() {
      const bytes = fakeMedia.files.get(this.uri);
      if (!bytes) throw new Error('No such file.');
      return bytes;
    }
    open() {
      const bytes = fakeMedia.files.get(this.uri);
      if (!bytes) throw new Error('No such file.');
      // As the real handle: reading moves on from `offset`, and `offset` can be set to read elsewhere.
      return {
        size: bytes.byteLength,
        offset: 0,
        readBytes(length: number) {
          const chunk = bytes.slice(this.offset, this.offset + length);
          this.offset += chunk.byteLength;
          return chunk;
        },
        close() {},
      };
    }
    delete() {
      fakeMedia.files.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: new Directory('file:///cache') } };
}

/** react-native Image.getSize: the size of a local picture the device can decode. */
export function fakeImageGetSize(
  uri: string,
  success: (width: number, height: number) => void,
  failure?: (error: unknown) => void,
) {
  fakeMedia.deviceSizeAsked.push(uri);
  const source = fakeMedia.files.get(uri);
  const picture = source ? decoded(source, DEVICE_DECODES) : null;
  if (picture) success(picture.width, picture.height);
  else failure?.(new Error('The image size could not be read.'));
}

/** A decoded picture in the image tool's memory, and how many of its objects still hold it. */
type FakeHeldPicture = { picture: FakePicture; holders: number };

function holdPicture(held: FakeHeldPicture) {
  held.holders += 1;
  if (held.holders > 1) return;
  fakeMedia.devicePicturesNow += 1;
  fakeMedia.devicePixelsNow += held.picture.width * held.picture.height;
  fakeMedia.devicePicturesAtOnce = Math.max(fakeMedia.devicePicturesAtOnce, fakeMedia.devicePicturesNow);
  fakeMedia.devicePixelsAtOnce = Math.max(fakeMedia.devicePixelsAtOnce, fakeMedia.devicePixelsNow);
}

function dropPicture(held: FakeHeldPicture) {
  held.holders -= 1;
  if (held.holders > 0) return;
  fakeMedia.devicePicturesNow -= 1;
  fakeMedia.devicePixelsNow -= held.picture.width * held.picture.height;
}

/** What the real objects do once released: any further use throws. */
const usedAfterRelease = () => new Error('This object was released; its picture is gone.');

/**
 * What one picture handled properly costs at its peak: the picture and the
 * copy being made from it (smaller, cropped, or turned upright).
 */
export const FAKE_DEVICE_PICTURES_FOR_ONE = 2;

/**
 * Fails the test that calls it when the phone's image tool was left holding
 * anything, or held more at once than handling one picture at a time needs
 * (review pass 1, L6). Call it after every test that uses the tool.
 */
export function expectFakeDeviceLetGoOfEveryPicture(media: typeof fakeMedia = fakeMedia) {
  const held = {
    'pictures still open (never released)': media.deviceOpenNow,
    'decoded pictures still in memory': media.devicePicturesNow,
    'most pictures open at once': media.deviceOpenAtOnce,
    'most decoded pictures in memory at once': media.devicePicturesAtOnce,
  };
  const allowed = {
    'pictures still open (never released)': 0,
    'decoded pictures still in memory': 0,
    'most pictures open at once': Math.min(1, media.deviceOpenAtOnce),
    'most decoded pictures in memory at once': Math.min(FAKE_DEVICE_PICTURES_FOR_ONE, media.devicePicturesAtOnce),
  };
  if (JSON.stringify(held) !== JSON.stringify(allowed)) {
    throw new Error(
      'The image tool was left holding pictures, or held more than one picture\'s worth at once.\n' +
      `held:    ${JSON.stringify(held)}\nallowed: ${JSON.stringify(allowed)}`,
    );
  }
}

/**
 * expo-image-manipulator: loads a local picture upright, crops, resizes and
 * saves it. Like the real tool it holds every picture until release():
 * manipulate() gives a context that keeps the picture it is working on,
 * renderAsync() gives a second object that keeps that picture too, and
 * saveAsync() writes a file and lets go of nothing.
 */
export function fakeImageManipulator() {
  const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const;
  const ImageManipulator = {
    manipulate(uri: string) {
      fakeMedia.deviceOpened.push(uri);
      const source = fakeMedia.files.get(uri);
      const loaded = source && !fakeMedia.deviceCannotOpen.has(uri) ? decoded(source, DEVICE_DECODES) : null;
      let printForm = fakeMedia.devicePrintForm.get(uri) ?? null;
      let pendingCrop: FakeCrop | null = null;
      let contextReleased = false;
      fakeMedia.deviceOpenNow += 1;
      fakeMedia.deviceOpenAtOnce = Math.max(fakeMedia.deviceOpenAtOnce, fakeMedia.deviceOpenNow);
      // The picture the context is working on. Each step makes a new one from it and lets the old one go.
      let current: FakeHeldPicture | null = null;
      const moveOnTo = (picture: FakePicture) => {
        const next = { picture, holders: 0 };
        holdPicture(next);
        if (current) dropPicture(current);
        current = next;
      };
      if (loaded) {
        moveOnTo(loaded);
        // A picture stored on its side is redrawn upright, at full size, as it is loaded.
        const id = /\|(picture-\d+)\|/.exec(String.fromCharCode(...source!))?.[1];
        if (id && fakeMedia.storedOnItsSide.has(id)) moveOnTo(loaded);
      }
      const context = {
        crop(rect: Pick<FakeCrop, 'originX' | 'originY' | 'width' | 'height'>) {
          if (contextReleased) throw usedAfterRelease();
          pendingCrop = { ...rect, outputWidth: rect.width, outputHeight: rect.height };
          fakeMedia.deviceCrops.push(pendingCrop);
          if (current) moveOnTo(cropped(current.picture, rect));
          return context;
        },
        resize(size: { width: number; height: number }) {
          if (contextReleased) throw usedAfterRelease();
          if (pendingCrop) {
            // The record of this crop also carries the size it was saved at.
            fakeMedia.deviceCrops[fakeMedia.deviceCrops.length - 1] = {
              ...pendingCrop,
              outputWidth: size.width,
              outputHeight: size.height,
            };
          }
          if (current) moveOnTo(resized(current.picture, size.width, size.height));
          // A resize redraws the picture into an ordinary 8-bit colour bitmap.
          printForm = null;
          return context;
        },
        async renderAsync() {
          if (contextReleased) throw usedAfterRelease();
          if (!current) throw new Error('The image data could not be read.');
          const held = current;
          const rendered = held.picture;
          // The object handed back keeps the picture as well, until it is released itself.
          holdPicture(held);
          let imageReleased = false;
          return {
            width: rendered.width,
            height: rendered.height,
            async saveAsync(options?: { format?: FakeImageFormat }) {
              if (imageReleased) throw usedAfterRelease();
              fakeMedia.devicePixelsWhileSaving.push(fakeMedia.devicePixelsNow);
              const format = fakeMedia.deviceWrites || options?.format || 'jpeg';
              // A JPEG has no transparency. Apple's encoder puts the picture on white
              // (run on macOS ImageIO by the pass-4 reviewer, notes/p4-ecos/probe.swift).
              const bytes = fakeImageBytes(format, format === 'jpeg' ? flattened(rendered, 'white') : rendered);
              if (printForm === 'CMYK' && format === 'jpeg') fakeMedia.savedAsCmyk.add(`picture-${fakeMedia.nextId}`);
              const savedUri = `file:///cache/ImageManipulator/${fakeMedia.nextId}.${format}`;
              fakeMedia.files.set(savedUri, bytes);
              // Writing takes a moment: work started meanwhile would overlap this picture.
              await Promise.resolve();
              return { uri: savedUri, width: rendered.width, height: rendered.height };
            },
            release() {
              if (!imageReleased) dropPicture(held);
              imageReleased = true;
            },
          };
        },
        release() {
          if (contextReleased) return;
          contextReleased = true;
          fakeMedia.deviceOpenNow -= 1;
          if (current) dropPicture(current);
          current = null;
        },
      };
      return context;
    },
  };
  return { ImageManipulator, SaveFormat };
}

type FakeCanvas = {
  width: number;
  height: number;
  picture: FakePicture | null;
  getContext(kind: string): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawImage(source: { picture: FakePicture | null }, ...values: number[]): void;
  };
  toBlob(callback: (blob: Blob | null) => void, type?: string): void;
};

function fakeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    picture: null,
    getContext: () => ({
      fillStyle: '#000000',
      fillRect(x, y, width, height) {
        const colour = /^(#fff(fff)?|white)$/i.test(this.fillStyle) ? 'white' : this.fillStyle;
        const underneath = canvas.picture;
        // An opaque fill covers whatever was drawn there before it.
        canvas.picture = {
          width: canvas.width,
          height: canvas.height,
          labelAt: (px, py) => (px >= x && px < x + width && py >= y && py < y + height
            ? colour
            : underneath ? underneath.labelAt(px, py) : FAKE_TRANSPARENT),
        };
      },
      drawImage(source, ...values) {
        if (!source.picture) throw new Error('Nothing was drawn on the source.');
        const underneath = canvas.picture;
        if (values.length === 2) {
          canvas.picture = drawnOver(source.picture, underneath);
        } else if (values.length === 4) {
          canvas.picture = drawnOver(resized(source.picture, values[2], values[3]), underneath);
        } else {
          const crop = {
            originX: values[0],
            originY: values[1],
            width: values[2],
            height: values[3],
            outputWidth: values[6],
            outputHeight: values[7],
          };
          fakeMedia.browserCrops.push(crop);
          canvas.picture = drawnOver(resized(cropped(source.picture, crop), crop.outputWidth, crop.outputHeight), underneath);
        }
      },
    }),
    toBlob(callback, type) {
      if (!canvas.picture) {
        callback(null);
        return;
      }
      const format = fakeMedia.browserWrites || (type === 'image/png' ? 'png' : 'jpeg');
      // The HTML rule for a type without transparency: the canvas is put on opaque black.
      const bytes = fakeImageBytes(format, format === 'jpeg' ? flattened(canvas.picture, 'black') : canvas.picture);
      callback(new Blob([bytes.slice().buffer], { type }));
    },
  };
  return canvas;
}

/**
 * The parts of a browser the desktop resolver uses: fetch, an <img> that
 * decodes a blob, a canvas, and object URLs. Returns a function that puts the
 * real ones back.
 */
export function installFakeBrowser(): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = {
    document: scope.document,
    fetch: scope.fetch,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const blobs = new Map<string, Blob>();
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:fake/${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
  };
  scope.fetch = async (url: string) => {
    const entry = fakeMedia.remote.get(url);
    return {
      ok: Boolean(entry),
      status: entry ? 200 : 404,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? entry?.contentType ?? null : null) },
      arrayBuffer: async () => (entry?.bytes ?? new Uint8Array()).slice().buffer,
    };
  };
  scope.document = {
    createElement(tag: string) {
      if (tag === 'canvas') return fakeCanvas();
      if (tag !== 'img') throw new Error(`Unexpected element ${tag}.`);
      const image = {
        naturalWidth: 0,
        naturalHeight: 0,
        picture: null as FakePicture | null,
        onload: null as (() => void) | null,
        onerror: null as (() => void) | null,
        address: '',
        get src() {
          return this.address;
        },
        set src(value: string) {
          this.address = value;
          const blob = blobs.get(value);
          void (async () => {
            const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array();
            const picture = decoded(bytes, BROWSER_DECODES);
            if (!picture) {
              this.onerror?.();
              return;
            }
            this.picture = picture;
            this.naturalWidth = picture.width;
            this.naturalHeight = picture.height;
            this.onload?.();
          })();
        },
      };
      return image;
    },
  };
  return () => {
    scope.document = previous.document;
    scope.fetch = previous.fetch;
    URL.createObjectURL = previous.createObjectURL;
    URL.revokeObjectURL = previous.revokeObjectURL;
  };
}
