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
    this.deviceCannotOpen.clear();
    this.devicePrintForm.clear();
    this.savedAsCmyk.clear();
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

/** A file in the given format that decodes to the given picture. */
export function fakeImageBytes(format: FakeImageFormat, picture?: FakePicture): Uint8Array {
  fakeMedia.nextId += 1;
  const id = `picture-${fakeMedia.nextId}`;
  if (picture) fakeMedia.pictures.set(id, picture);
  return Uint8Array.from([...FAKE_SIGNATURES[format], ...text(`|${id}|`)]);
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
      return fakeMedia.files.get(this.uri)?.byteLength ?? 0;
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
      let offset = 0;
      return {
        size: bytes.byteLength,
        readBytes(length: number) {
          const chunk = bytes.slice(offset, offset + length);
          offset += chunk.byteLength;
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
  const source = fakeMedia.files.get(uri);
  const picture = source ? decoded(source, DEVICE_DECODES) : null;
  if (picture) success(picture.width, picture.height);
  else failure?.(new Error('The image size could not be read.'));
}

/** expo-image-manipulator: loads a local picture upright, crops, resizes and saves it. */
export function fakeImageManipulator() {
  const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const;
  const ImageManipulator = {
    manipulate(uri: string) {
      fakeMedia.deviceOpened.push(uri);
      const source = fakeMedia.files.get(uri);
      let picture = source && !fakeMedia.deviceCannotOpen.has(uri) ? decoded(source, DEVICE_DECODES) : null;
      let printForm = fakeMedia.devicePrintForm.get(uri) ?? null;
      let pendingCrop: FakeCrop | null = null;
      const context = {
        crop(rect: Pick<FakeCrop, 'originX' | 'originY' | 'width' | 'height'>) {
          pendingCrop = { ...rect, outputWidth: rect.width, outputHeight: rect.height };
          fakeMedia.deviceCrops.push(pendingCrop);
          if (picture) picture = cropped(picture, rect);
          return context;
        },
        resize(size: { width: number; height: number }) {
          if (pendingCrop) {
            // The record of this crop also carries the size it was saved at.
            fakeMedia.deviceCrops[fakeMedia.deviceCrops.length - 1] = {
              ...pendingCrop,
              outputWidth: size.width,
              outputHeight: size.height,
            };
          }
          if (picture) picture = resized(picture, size.width, size.height);
          // A resize redraws the picture into an ordinary 8-bit colour bitmap.
          printForm = null;
          return context;
        },
        async renderAsync() {
          if (!picture) throw new Error('The image data could not be read.');
          const rendered = picture;
          return {
            width: rendered.width,
            height: rendered.height,
            async saveAsync(options?: { format?: FakeImageFormat }) {
              const format = fakeMedia.deviceWrites || options?.format || 'jpeg';
              // A JPEG has no transparency. Apple's encoder puts the picture on white
              // (run on macOS ImageIO by the pass-4 reviewer, notes/p4-ecos/probe.swift).
              const bytes = fakeImageBytes(format, format === 'jpeg' ? flattened(rendered, 'white') : rendered);
              if (printForm === 'CMYK' && format === 'jpeg') fakeMedia.savedAsCmyk.add(`picture-${fakeMedia.nextId}`);
              const savedUri = `file:///cache/ImageManipulator/${fakeMedia.nextId}.${format}`;
              fakeMedia.files.set(savedUri, bytes);
              return { uri: savedUri, width: rendered.width, height: rendered.height };
            },
          };
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
