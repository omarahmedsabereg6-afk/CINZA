/**
 * Zero-dependency image inspection.
 *
 * We read width/height and the real MIME type straight from the file headers
 * rather than pulling in a native image library. Two reasons:
 *   1. `sharp` needs platform binaries — the API should boot without them.
 *   2. We must verify the bytes match the *declared* content type. Trusting a
 *      client-supplied `Content-Type` is a classic upload vulnerability
 *      (section 28), and this makes that check exact.
 *
 * Only header parsing happens here — pixels are never decoded server-side.
 */

const SIGNATURES = [
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/webp',
    test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
  { mime: 'image/gif', test: (b) => b.length > 6 && b.toString('ascii', 0, 3) === 'GIF' },
  { mime: 'image/heic', test: (b) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /heic|heix|mif1/.test(b.toString('ascii', 8, 12)) },
  {
    mime: 'video/mp4',
    test: (b) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp' && /isom|mp42|avc1|iso2|dash/.test(b.toString('ascii', 8, 12)),
  },
  { mime: 'video/webm', test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

/** Real MIME type from magic bytes, or null when unrecognised. */
export function sniffMime(buffer) {
  if (!buffer || buffer.length < 4) return null;
  for (const sig of SIGNATURES) {
    if (sig.test(buffer)) return sig.mime;
  }
  return null;
}

export function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

export function isVideoMime(mime) {
  return typeof mime === 'string' && mime.startsWith('video/');
}

/* ------------------------------- PNG ------------------------------- */
function pngSize(b) {
  if (b.length < 24) return null;
  // signature (8) + length (4) + 'IHDR' (4) => width at 16, height at 20
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/* ------------------------------- JPEG ------------------------------ */
function jpegSize(b) {
  let offset = 2;
  const len = b.length;
  while (offset + 9 < len) {
    if (b[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = b[offset + 1];
    // Standalone markers carry no payload
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = b.readUInt16BE(offset + 2);
    // SOF0..SOF15 except DHT (0xc4), JPG (0xc8) and DAC (0xcc)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/* ------------------------------- WEBP ------------------------------ */
function webpSize(b) {
  if (b.length < 30) return null;
  const format = b.toString('ascii', 12, 16);
  if (format === 'VP8X') {
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    return { width, height };
  }
  if (format === 'VP8 ') {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/* -------------------------------- GIF ------------------------------ */
function gifSize(b) {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

/**
 * Inspect a buffer.
 * @returns {{mime:string|null, width:number|null, height:number|null, ok:boolean}}
 */
export function probeImage(buffer) {
  const mime = sniffMime(buffer);
  let size = null;
  if (mime === 'image/png') size = pngSize(buffer);
  else if (mime === 'image/jpeg') size = jpegSize(buffer);
  else if (mime === 'image/webp') size = webpSize(buffer);
  else if (mime === 'image/gif') size = gifSize(buffer);

  return {
    mime,
    width: size?.width ?? null,
    height: size?.height ?? null,
    ok: Boolean(mime && isImageMime(mime)),
  };
}

export default { sniffMime, probeImage, isImageMime, isVideoMime };
