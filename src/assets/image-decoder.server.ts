import decodeAvif, {
  init as initializeAvifDecoder,
} from "@jsquash/avif/decode";
import avifDecoderModule from "@jsquash/avif/codec/dec/avif_dec.wasm?module";
import decodeJpeg, {
  init as initializeJpegDecoder,
} from "@jsquash/jpeg/decode";
import jpegDecoderModule from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?module";
import decodePng, { init as initializePngDecoder } from "@jsquash/png/decode";
import pngDecoderModule from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm?module";
import decodeWebp, {
  init as initializeWebpDecoder,
} from "@jsquash/webp/decode";
import webpDecoderModule from "@jsquash/webp/codec/dec/webp_dec.wasm?module";

import type { AssetMimeType } from "./assets";

interface DecodedImage {
  width: number;
  height: number;
}

type EmscriptenDecoderInitializer = (
  module: WebAssembly.Module,
  options: { print: () => void; printErr: () => void },
) => Promise<void>;

const quietDecoderOptions = { print: () => {}, printErr: () => {} };
const initializedDecoders = new Set<AssetMimeType>();

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

async function initializeDecoder(mimeType: AssetMimeType): Promise<void> {
  if (initializedDecoders.has(mimeType)) return;

  if (mimeType === "image/png") {
    await initializePngDecoder(pngDecoderModule);
  } else {
    const [initialize, module] =
      mimeType === "image/avif"
        ? [initializeAvifDecoder, avifDecoderModule]
        : mimeType === "image/jpeg"
          ? [initializeJpegDecoder, jpegDecoderModule]
          : [initializeWebpDecoder, webpDecoderModule];
    await (initialize as EmscriptenDecoderInitializer)(
      module,
      quietDecoderOptions,
    );
  }

  initializedDecoders.add(mimeType);
}

export async function decodeImage(
  mimeType: AssetMimeType,
  bytes: Uint8Array,
): Promise<DecodedImage> {
  await initializeDecoder(mimeType);
  const buffer = exactArrayBuffer(bytes);
  if (mimeType === "image/avif") {
    const image = await decodeAvif(buffer);
    if (!image) throw new Error("AVIF decoder returned no image");
    return image;
  }
  if (mimeType === "image/jpeg") return decodeJpeg(buffer);
  if (mimeType === "image/png") return decodePng(buffer);
  return decodeWebp(buffer);
}
