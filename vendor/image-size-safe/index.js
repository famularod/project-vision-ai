'use strict';

const fs = require('node:fs');
const path = require('node:path');
const probe = require('probe-image-size/sync');

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const allowedTypes = Object.freeze([
  'bmp',
  'gif',
  'ico',
  'jpg',
  'png',
  'psd',
  'svg',
  'tiff',
  'webp',
]);
let disabledTypes = new Set();
let filesystemDisabled = false;

function ascii(input, start, end) {
  return Buffer.from(input.subarray(start, end)).toString('ascii');
}

function rejectsUnsafeContainer(input) {
  // These families are deliberately unavailable to Metro until their former
  // parser dependency has released fixes for GHSA-w3rx-r6r6-pgpr and
  // GHSA-5p2g-fcmc-qvqq. Vitruvius source assets use PNG.
  if (input.length >= 4 && ascii(input, 0, 4) === 'icns') return true;
  if (input.length >= 2 && input[0] === 0xff && input[1] === 0x0a) return true;
  if (
    input.length >= 12
    && ascii(input, 4, 8) === 'JXL '
    && input[8] === 0x0d
    && input[9] === 0x0a
    && input[10] === 0x87
    && input[11] === 0x0a
  ) return true;
  if (input.length >= 12 && ascii(input, 4, 8) === 'ftyp') return true;
  return false;
}

function canonicalType(type) {
  if (type === 'jpeg') return 'jpg';
  if (type === 'tif') return 'tiff';
  return String(type || '').toLowerCase();
}

function boundedInput(input) {
  if (typeof input === 'string') {
    if (filesystemDisabled) throw new TypeError('image-size filesystem access is disabled');
    const filePath = path.resolve(input);
    const descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) {
        throw new TypeError('image-size file is unsafe or exceeds the build limit');
      }
      const data = Buffer.allocUnsafe(stat.size);
      let offset = 0;
      while (offset < data.length) {
        const read = fs.readSync(descriptor, data, offset, data.length - offset, offset);
        if (read === 0) break;
        offset += read;
      }
      if (offset === 0) throw new TypeError('image-size file became empty');
      return data.subarray(0, offset);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('image-size accepts a regular file path or in-memory bytes');
  }
  return input;
}

function imageSize(value) {
  const input = boundedInput(value);
  if (input.byteLength === 0 || input.byteLength > MAX_INPUT_BYTES) {
    throw new TypeError('image-size input is empty or exceeds the build limit');
  }
  if (rejectsUnsafeContainer(input)) {
    throw new TypeError('unsupported image container');
  }

  const result = probe(input);
  const type = canonicalType(result?.type);
  const width = Number(result?.width);
  const height = Number(result?.height);
  if (
    !allowedTypes.includes(type)
    || disabledTypes.has(type)
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    throw new TypeError(`unsupported image type: ${type || 'unknown'}`);
  }

  return {
    width,
    height,
    type,
    ...(Number.isSafeInteger(result.orientation)
      ? { orientation: result.orientation }
      : {}),
  };
}

imageSize.imageSize = imageSize;
imageSize.default = imageSize;
imageSize.disableFS = (disabled = true) => {
  filesystemDisabled = Boolean(disabled);
};
imageSize.disableTypes = (types) => {
  if (!Array.isArray(types) || types.some(type => typeof type !== 'string')) {
    throw new TypeError('disabled image types must be strings');
  }
  disabledTypes = new Set(types.map(canonicalType));
};
imageSize.setConcurrency = () => undefined;
imageSize.types = [...allowedTypes];

module.exports = imageSize;
