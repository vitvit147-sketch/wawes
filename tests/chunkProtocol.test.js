import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_PAYLOAD_SIZE, encodeChunkFrame, decodeChunkFrame } from '../src/utils/chunkProtocol.js';

test('encodeChunkFrame and decodeChunkFrame preserve transferSeq and payload bytes', () => {
  const payload = new Uint8Array([10, 20, 30, 40, 255, 0, 128]);
  const frame = encodeChunkFrame(42, payload);

  assert.equal(frame.byteLength, 4 + payload.byteLength);
  const decoded = decodeChunkFrame(frame.buffer);
  assert.equal(decoded.transferSeq, 42);
  assert.deepEqual(Array.from(decoded.payload), Array.from(payload));
});

test('chunk size keeps SCTP frame at 16384 bytes', () => {
  const maxPayload = new Uint8Array(CHUNK_PAYLOAD_SIZE);
  const frame = encodeChunkFrame(1, maxPayload);
  assert.equal(frame.byteLength, 16384);
});

test('decodeChunkFrame throws on truncated frame', () => {
  assert.throws(() => decodeChunkFrame(new Uint8Array([1, 2, 3])), /Invalid chunk frame/);
});
