/**
 * Image token cost.
 *
 * VS Code counts an image part with the OpenAI tile formula: the image is
 * scaled to fit 2048x2048, then the short side to 768, and the resulting
 * number of 512x512 tiles costs 170 tokens each (plus 85). We use the same
 * formula so the extension's token estimate matches what the chat view
 * shows, and so images are not counted as "free" when the base64 payload is
 * stripped from the estimate.
 *
 * Mirrors `calculateImageTokenCost` in the VS Code Copilot extension.
 */

const TILE_SIZE = 512;
const TOKENS_PER_TILE = 170;
const BASE_TOKENS = 85;
const MAX_IMAGE_EDGE = 2048;
const TARGET_SHORT_EDGE = 768;

/** Conservative fallback for images whose dimensions cannot be read. */
const FALLBACK_BYTES_PER_TOKEN = 400;

export function imageTokenCost(
  data: Uint8Array,
  mimeType: string,
): number {
  const dimensions = readImageDimensions(data, mimeType);
  if (!dimensions) {
    return BASE_TOKENS + Math.ceil(data.length / FALLBACK_BYTES_PER_TOKEN);
  }
  let { width, height } = dimensions;
  if (width <= 0 || height <= 0) {
    return BASE_TOKENS + Math.ceil(data.length / FALLBACK_BYTES_PER_TOKEN);
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
    const scale = MAX_IMAGE_EDGE / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const scale = TARGET_SHORT_EDGE / Math.min(width, height);
  width = Math.round(width * scale);
  height = Math.round(height * scale);
  const tiles =
    Math.ceil(width / TILE_SIZE) * Math.ceil(height / TILE_SIZE);
  return tiles * TOKENS_PER_TILE + BASE_TOKENS;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function readImageDimensions(
  data: Uint8Array,
  mimeType: string,
): ImageDimensions | undefined {
  if (mimeType.includes("png")) {
    return readPngDimensions(data);
  }
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
    return readJpegDimensions(data);
  }
  if (mimeType.includes("gif")) {
    return readGifDimensions(data);
  }
  if (mimeType.includes("webp")) {
    return readWebpDimensions(data);
  }
  return undefined;
}

function readPngDimensions(data: Uint8Array): ImageDimensions | undefined {
  // 8-byte signature, then the IHDR chunk: width and height are big-endian
  // uint32 at offsets 16 and 20.
  if (data.length < 24) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readGifDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 10) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function readJpegDimensions(data: Uint8Array): ImageDimensions | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    // Start of frame markers carry the dimensions; skip the ones that do not.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength <= 0) {
      return undefined;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

function readWebpDimensions(data: Uint8Array): ImageDimensions | undefined {
  if (data.length < 30) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunk = String.fromCharCode(
    data[12],
    data[13],
    data[14],
    data[15],
  );
  if (chunk === "VP8 ") {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    return {
      width: (data[24] | (data[25] << 8) | (data[26] << 16)) + 1,
      height: (data[27] | (data[28] << 8) | (data[29] << 16)) + 1,
    };
  }
  return undefined;
}
