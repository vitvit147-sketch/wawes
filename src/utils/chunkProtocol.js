// Протокол фрейминга бинарных чанков для WebRTC DataChannel (16 КБ безопасный SCTP-лимит)

export const CHUNK_PAYLOAD_SIZE = 16380; // + 4 байта заголовок = ровно 16384 байта

/**
 * Упаковывает бинарный кусок файла с 4-байтным заголовком transferSeq (uint32 LE).
 * Позволяет мгновенно прерывать фоновую передачу, если хост переключил трек.
 */
export function encodeChunkFrame(transferSeq, payloadBuffer) {
  const payload = payloadBuffer instanceof Uint8Array ? payloadBuffer : new Uint8Array(payloadBuffer);
  const frame = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(0, transferSeq >>> 0, true);
  frame.set(payload, 4);
  return frame;
}

/**
 * Распаковывает входящий бинарный фрейм из WebRTC DataChannel.
 */
export function decodeChunkFrame(rawData) {
  const bytes = rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData);
  if (bytes.byteLength < 4) {
    throw new Error(`Invalid chunk frame length: ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const transferSeq = view.getUint32(0, true);
  const payload = bytes.subarray(4);
  return { transferSeq, payload };
}
